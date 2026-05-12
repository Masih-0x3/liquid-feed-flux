-- Enable pgvector for semantic similarity
CREATE EXTENSION IF NOT EXISTS vector;

-- Per-post fingerprint table
CREATE TABLE IF NOT EXISTS public.story_signatures (
  tweet_id text PRIMARY KEY,
  simhash bigint,
  embedding vector(1536),
  story_cluster_id uuid NOT NULL DEFAULT gen_random_uuid(),
  coverage_count integer NOT NULL DEFAULT 1,
  normalized_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_signatures_created_at_idx
  ON public.story_signatures (created_at DESC);

CREATE INDEX IF NOT EXISTS story_signatures_cluster_idx
  ON public.story_signatures (story_cluster_id);

-- ivfflat index for cosine similarity (lists=100 is fine for our scale)
CREATE INDEX IF NOT EXISTS story_signatures_embedding_idx
  ON public.story_signatures
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.story_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage story_signatures"
  ON public.story_signatures
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view story_signatures"
  ON public.story_signatures
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Add dup tracking columns to posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS dup_of_tweet_id text,
  ADD COLUMN IF NOT EXISTS story_cluster_id uuid,
  ADD COLUMN IF NOT EXISTS dup_similarity numeric;

CREATE INDEX IF NOT EXISTS posts_dup_of_tweet_id_idx ON public.posts (dup_of_tweet_id);
CREATE INDEX IF NOT EXISTS posts_story_cluster_id_idx ON public.posts (story_cluster_id);

-- RPC: find nearest neighbor within a time window
CREATE OR REPLACE FUNCTION public.find_similar_story(
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
    -- popcount of XOR = Hamming distance; cast to int
    COALESCE(length(replace((s.simhash # query_simhash)::bit(64)::text, '0','')), 64) AS simhash_distance
  FROM public.story_signatures s
  WHERE s.tweet_id <> exclude_tweet_id
    AND s.created_at >= now() - (window_hours || ' hours')::interval
    AND s.embedding IS NOT NULL
    AND (1 - (s.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY s.embedding <=> query_embedding ASC
  LIMIT 1;
$$;

-- Hook into existing 7-day retention: cleanup old signatures alongside posts
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
  batch_deleted integer;
  cutoff_ts timestamptz;
  cron_cutoff timestamptz;
BEGIN
  cutoff_ts := NOW() - INTERVAL '1 day' * retention_days;
  cron_cutoff := NOW() - INTERVAL '1 day';

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
    'deleted_cron_logs', deleted_cron_logs,
    'deleted_http_responses', deleted_http_responses
  );
END;
$function$;