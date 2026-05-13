-- Feedback-driven learning: storage layer
-- Tables: feedback_events, story_pair_blocklist
-- Columns: posts.feedback_locked, posts.score_breakdown
-- Settings key: learned_biases
-- RPC: find_similar_story_v2 (blocklist-aware)
-- RPC: rebuild_learned_biases (decay + aggregation)

-- ============================================================
-- 1. feedback_events — append-only audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedback_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id    text NOT NULL,
  related_tweet_id text,
  action      text NOT NULL CHECK (action IN (
    'force_deliver', 'force_x', 'confirm_deliver', 'confirm_x',
    'dispute_high', 'dispute_low', 'not_duplicate', 'confirm_duplicate',
    'reprocess', 'edit_translation'
  )),
  polarity    smallint NOT NULL DEFAULT 0 CHECK (polarity BETWEEN -2 AND 2),
  meta        jsonb DEFAULT '{}',
  source      text DEFAULT 'admin_action',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_tweet
  ON public.feedback_events (tweet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_events_created
  ON public.feedback_events (created_at);

ALTER TABLE public.feedback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage feedback_events"
  ON public.feedback_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 2. story_pair_blocklist — unordered (A,B) pairs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.story_pair_blocklist (
  tweet_a    text NOT NULL,
  tweet_b    text NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_pair_blocklist_ordered CHECK (tweet_a < tweet_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_pair_blocklist_pair
  ON public.story_pair_blocklist (tweet_a, tweet_b);

ALTER TABLE public.story_pair_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage story_pair_blocklist"
  ON public.story_pair_blocklist
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 3. New columns on posts
-- ============================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS feedback_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

-- ============================================================
-- 4. Seed learned_biases in settings (no-op if already exists)
-- ============================================================
INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'learned_biases',
  '{"author_bias":{},"tag_bias":{},"keyword_bias":{}}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. find_similar_story_v2 — same as v1 but excludes blocked pairs
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_similar_story_v2(
  query_embedding vector(1536),
  query_simhash bigint,
  exclude_tweet_id text,
  window_hours int DEFAULT 12,
  similarity_threshold numeric DEFAULT 0.86
)
RETURNS TABLE (
  tweet_id text,
  story_cluster_id uuid,
  similarity numeric,
  simhash_distance int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.tweet_id,
    s.story_cluster_id,
    (1 - (s.embedding <=> query_embedding))::numeric AS similarity,
    COALESCE(length(replace((s.simhash # query_simhash)::bit(64)::text, '0','')), 64) AS simhash_distance
  FROM public.story_signatures s
  WHERE s.tweet_id <> exclude_tweet_id
    AND s.created_at >= now() - (window_hours || ' hours')::interval
    AND s.embedding IS NOT NULL
    AND (1 - (s.embedding <=> query_embedding)) >= similarity_threshold
    -- Exclude pairs in blocklist (unordered: always store least first)
    AND NOT EXISTS (
      SELECT 1 FROM public.story_pair_blocklist bl
      WHERE bl.tweet_a = LEAST(s.tweet_id, exclude_tweet_id)
        AND bl.tweet_b = GREATEST(s.tweet_id, exclude_tweet_id)
    )
  ORDER BY s.embedding <=> query_embedding ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_similar_story_v2(vector(1536), bigint, text, int, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_similar_story_v2(vector(1536), bigint, text, int, numeric) TO authenticated, service_role;

-- ============================================================
-- 6. kNN feedback prior — find labeled neighbors for score bias
-- ============================================================
CREATE OR REPLACE FUNCTION public.knn_feedback_prior(
  query_embedding vector(1536),
  exclude_tweet_id text,
  k int DEFAULT 10,
  half_life_days numeric DEFAULT 30
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH neighbors AS (
    SELECT
      fe.polarity,
      (1 - (ss.embedding <=> query_embedding))::numeric AS cosine_sim,
      fe.created_at,
      exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days) AS decay
    FROM public.story_signatures ss
    INNER JOIN public.feedback_events fe ON fe.tweet_id = ss.tweet_id
    WHERE ss.tweet_id <> exclude_tweet_id
      AND ss.embedding IS NOT NULL
      AND fe.polarity <> 0
    ORDER BY ss.embedding <=> query_embedding ASC
    LIMIT k
  )
  SELECT COALESCE(
    LEAST(2, GREATEST(-2,
      SUM(cosine_sim * polarity * decay) / GREATEST(COUNT(*), 1)
    )),
    0
  )::numeric
  FROM neighbors;
$$;

REVOKE ALL ON FUNCTION public.knn_feedback_prior(vector(1536), text, int, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.knn_feedback_prior(vector(1536), text, int, numeric) TO authenticated, service_role;

-- ============================================================
-- 7. rebuild_learned_biases — full recompute with decay
-- ============================================================
CREATE OR REPLACE FUNCTION public.rebuild_learned_biases(
  half_life_days numeric DEFAULT 30,
  per_key_cap numeric DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  author_biases jsonb := '{}';
  tag_biases jsonb := '{}';
  kw_biases jsonb := '{}';
  r record;
BEGIN
  -- Author biases from feedback on posts
  FOR r IN
    SELECT
      p.author_handle AS key,
      LEAST(per_key_cap, GREATEST(-per_key_cap,
        SUM(
          fe.polarity * 0.6
          * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
        )
      )) AS bias
    FROM public.feedback_events fe
    JOIN public.posts p ON p.tweet_id = fe.tweet_id
    WHERE p.author_handle IS NOT NULL
      AND fe.polarity <> 0
      AND fe.action NOT IN ('not_duplicate', 'confirm_duplicate')
    GROUP BY p.author_handle
    HAVING ABS(SUM(
      fe.polarity * 0.6
      * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
    )) > 0.01
  LOOP
    author_biases := jsonb_set(author_biases, ARRAY[r.key], to_jsonb(ROUND(r.bias::numeric, 3)));
  END LOOP;

  -- Tag biases
  FOR r IN
    SELECT
      tag AS key,
      LEAST(per_key_cap, GREATEST(-per_key_cap,
        SUM(
          fe.polarity * 0.2
          * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
        )
      )) AS bias
    FROM public.feedback_events fe
    JOIN public.posts p ON p.tweet_id = fe.tweet_id,
    LATERAL unnest(COALESCE(p.importance_tags, '{}')) AS tag
    WHERE fe.polarity <> 0
      AND fe.action NOT IN ('not_duplicate', 'confirm_duplicate')
    GROUP BY tag
    HAVING ABS(SUM(
      fe.polarity * 0.2
      * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
    )) > 0.01
  LOOP
    tag_biases := jsonb_set(tag_biases, ARRAY[r.key], to_jsonb(ROUND(r.bias::numeric, 3)));
  END LOOP;

  result := jsonb_build_object(
    'author_bias', author_biases,
    'tag_bias', tag_biases,
    'keyword_bias', kw_biases,
    'rebuilt_at', now()
  );

  INSERT INTO public.settings (key, value, updated_at)
  VALUES ('learned_biases', result, now())
  ON CONFLICT (key) DO UPDATE SET value = result, updated_at = now();

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_learned_biases(numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_learned_biases(numeric, numeric) TO service_role;

-- ============================================================
-- 8. Update cleanup_old_data to handle feedback_events (180d)
--    and story_pair_blocklist (365d)
-- ============================================================
-- ============================================================
-- 9. Cron: rebuild learned biases every 6 hours with decay
-- ============================================================
SELECT cron.schedule(
  'rebuild-learned-biases-6h',
  '0 */6 * * *',
  $cron$
  SELECT public.rebuild_learned_biases(30, 3);
  $cron$
);

-- ============================================================
-- 8. Update cleanup_old_data to handle feedback_events (180d)
--    and story_pair_blocklist (365d)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_data(retention_days integer DEFAULT 7, batch_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
DECLARE
  deleted_pipeline_events integer := 0;
  deleted_jobs integer := 0;
  deleted_deliveries integer := 0;
  deleted_message_analytics integer := 0;
  deleted_moderation_events integer := 0;
  deleted_cron_logs integer := 0;
  deleted_http_responses integer := 0;
  deleted_posts integer := 0;
  deleted_media integer := 0;
  deleted_dead_letter integer := 0;
  deleted_signatures integer := 0;
  deleted_feedback integer := 0;
  deleted_pair_blocklist integer := 0;
  batch_deleted integer;
  cutoff_ts timestamptz;
  cron_cutoff timestamptz;
  feedback_cutoff timestamptz;
  blocklist_cutoff timestamptz;
BEGIN
  cutoff_ts := NOW() - INTERVAL '1 day' * retention_days;
  cron_cutoff := NOW() - INTERVAL '1 day';
  feedback_cutoff := NOW() - INTERVAL '180 days';
  blocklist_cutoff := NOW() - INTERVAL '365 days';

  LOOP
    DELETE FROM public.pipeline_events
    WHERE id IN (SELECT id FROM public.pipeline_events WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_pipeline_events := deleted_pipeline_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.jobs
    WHERE id IN (SELECT id FROM public.jobs WHERE status IN ('completed','failed') AND created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_jobs := deleted_jobs + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.deliveries
    WHERE id IN (SELECT id FROM public.deliveries WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_deliveries := deleted_deliveries + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.telegram_message_analytics
    WHERE id IN (SELECT id FROM public.telegram_message_analytics WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_message_analytics := deleted_message_analytics + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.moderation_events
    WHERE id IN (SELECT id FROM public.moderation_events WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_moderation_events := deleted_moderation_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.media
    WHERE id IN (SELECT id FROM public.media WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_media := deleted_media + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.story_signatures
    WHERE tweet_id IN (SELECT tweet_id FROM public.story_signatures WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_signatures := deleted_signatures + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.posts
    WHERE tweet_id IN (SELECT tweet_id FROM public.posts WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_posts := deleted_posts + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.dead_letter_jobs
    WHERE id IN (SELECT id FROM public.dead_letter_jobs WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_dead_letter := deleted_dead_letter + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- feedback_events: 180 day retention
  LOOP
    DELETE FROM public.feedback_events
    WHERE id IN (SELECT id FROM public.feedback_events WHERE created_at < feedback_cutoff LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_feedback := deleted_feedback + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- story_pair_blocklist: 365 day retention
  DELETE FROM public.story_pair_blocklist WHERE created_at < blocklist_cutoff;
  GET DIAGNOSTICS deleted_pair_blocklist = ROW_COUNT;

  DELETE FROM cron.job_run_details WHERE end_time < cron_cutoff OR (end_time IS NULL AND start_time < cron_cutoff);
  GET DIAGNOSTICS deleted_cron_logs = ROW_COUNT;

  DELETE FROM net._http_response WHERE created < cron_cutoff;
  GET DIAGNOSTICS deleted_http_responses = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_pipeline_events', deleted_pipeline_events,
    'deleted_jobs', deleted_jobs,
    'deleted_deliveries', deleted_deliveries,
    'deleted_message_analytics', deleted_message_analytics,
    'deleted_moderation_events', deleted_moderation_events,
    'deleted_posts', deleted_posts,
    'deleted_media', deleted_media,
    'deleted_dead_letter', deleted_dead_letter,
    'deleted_signatures', deleted_signatures,
    'deleted_feedback', deleted_feedback,
    'deleted_pair_blocklist', deleted_pair_blocklist,
    'deleted_cron_logs', deleted_cron_logs,
    'deleted_http_responses', deleted_http_responses
  );
END;
$function$;
