-- Make duplicate coverage gaps first-class and improve duplicate-audit tooling.

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_dedupe_status_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_dedupe_status_check
  CHECK (
    dedupe_status IS NULL OR dedupe_status IN (
      'pending',
      'unique',
      'duplicate',
      'related_new_info',
      'uncertain',
      'coverage_gap',
      'failed',
      'disabled'
    )
  );

UPDATE public.settings
SET value =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(value, '{}'::jsonb),
          '{window_hours}',
          to_jsonb(
            GREATEST(
              48,
              CASE
                WHEN COALESCE(value->>'window_hours', '') ~ '^[0-9]+$'
                  THEN (value->>'window_hours')::int
                ELSE 48
              END
            )
          ),
          true
        ),
        '{candidate_min_similarity}',
        COALESCE(value->'candidate_min_similarity', '0.78'::jsonb),
        true
      ),
      '{auto_duplicate_similarity}',
      COALESCE(value->'auto_duplicate_similarity', '0.94'::jsonb),
      true
    ),
    '{similarity_threshold}',
    COALESCE(value->'similarity_threshold', '0.86'::jsonb),
    true
  )
WHERE key = 'story_memory';

DROP FUNCTION IF EXISTS public.find_story_candidates_v3(vector(1536), text, int, numeric, int);

CREATE FUNCTION public.find_story_candidates_v3(
  query_embedding vector(1536),
  exclude_tweet_id text,
  window_hours int DEFAULT 48,
  candidate_min_similarity numeric DEFAULT 0.78,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  tweet_id text,
  story_cluster_id uuid,
  similarity numeric,
  normalized_text text,
  text_original text,
  text_translated text,
  author_handle text,
  url text,
  created_at timestamptz,
  candidate_dedupe_status text,
  candidate_dup_of_tweet_id text,
  candidate_delivery_decision text,
  candidate_final_score numeric,
  candidate_importance_score integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS MATERIALIZED (
    SELECT
      s.tweet_id,
      s.story_cluster_id,
      s.normalized_text,
      s.embedding,
      p.text_original,
      p.text_translated,
      p.author_handle,
      p.url,
      p.created_at,
      p.dedupe_status AS candidate_dedupe_status,
      p.dup_of_tweet_id AS candidate_dup_of_tweet_id,
      p.delivery_decision AS candidate_delivery_decision,
      p.final_score AS candidate_final_score,
      p.importance_score AS candidate_importance_score
    FROM public.story_signatures s
    INNER JOIN public.posts p ON p.tweet_id = s.tweet_id
    WHERE s.tweet_id <> exclude_tweet_id
      AND s.created_at >= now() - (window_hours || ' hours')::interval
      AND s.embedding IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.story_pair_blocklist bl
        WHERE bl.tweet_a = LEAST(s.tweet_id, exclude_tweet_id)
          AND bl.tweet_b = GREATEST(s.tweet_id, exclude_tweet_id)
      )
  ),
  scored AS (
    SELECT
      r.tweet_id,
      r.story_cluster_id,
      (1 - (r.embedding <=> query_embedding))::numeric AS similarity,
      r.normalized_text,
      r.text_original,
      r.text_translated,
      r.author_handle,
      r.url,
      r.created_at,
      r.candidate_dedupe_status,
      r.candidate_dup_of_tweet_id,
      r.candidate_delivery_decision,
      r.candidate_final_score,
      r.candidate_importance_score
    FROM recent r
  )
  SELECT
    s.tweet_id,
    s.story_cluster_id,
    s.similarity,
    s.normalized_text,
    s.text_original,
    s.text_translated,
    s.author_handle,
    s.url,
    s.created_at,
    s.candidate_dedupe_status,
    s.candidate_dup_of_tweet_id,
    s.candidate_delivery_decision,
    s.candidate_final_score,
    s.candidate_importance_score
  FROM scored s
  WHERE s.similarity >= candidate_min_similarity
  ORDER BY s.similarity DESC, s.created_at ASC
  LIMIT LEAST(GREATEST(match_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
  TO service_role;

CREATE OR REPLACE FUNCTION public.audit_duplicate_candidates(
  window_hours int DEFAULT 48,
  candidate_min_similarity numeric DEFAULT 0.78,
  match_limit int DEFAULT 500
)
RETURNS TABLE (
  a_tweet_id text,
  b_tweet_id text,
  similarity numeric,
  a_created_at timestamptz,
  b_created_at timestamptz,
  a_author_handle text,
  b_author_handle text,
  a_dedupe_status text,
  b_dedupe_status text,
  a_dup_of_tweet_id text,
  b_dup_of_tweet_id text,
  a_delivery_decision text,
  b_delivery_decision text,
  a_final_score numeric,
  b_final_score numeric,
  a_telegram_status text,
  b_telegram_status text,
  a_x_status text,
  b_x_status text,
  a_text text,
  b_text text,
  proposed_status text,
  proposed_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_telegram AS (
    SELECT DISTINCT ON (subject_id)
      subject_id,
      status
    FROM public.deliveries
    WHERE subject_type = 'post'
    ORDER BY subject_id, created_at DESC
  ),
  latest_x AS (
    SELECT DISTINCT ON (post_id)
      post_id,
      status
    FROM public.x_deliveries
    ORDER BY post_id, created_at DESC
  ),
  recent AS MATERIALIZED (
    SELECT
      p.tweet_id,
      p.created_at,
      p.author_handle,
      p.dedupe_status,
      p.dup_of_tweet_id,
      p.delivery_decision,
      p.final_score,
      p.importance_score,
      left(regexp_replace(COALESCE(p.text_original, ''), '\s+', ' ', 'g'), 260) AS text_excerpt,
      s.embedding,
      COALESCE(t.status, 'none') AS telegram_status,
      COALESCE(x.status, 'none') AS x_status
    FROM public.posts p
    INNER JOIN public.story_signatures s ON s.tweet_id = p.tweet_id
    LEFT JOIN latest_telegram t ON t.subject_id = p.tweet_id
    LEFT JOIN latest_x x ON x.post_id = p.tweet_id
    WHERE p.created_at >= now() - (window_hours || ' hours')::interval
      AND s.embedding IS NOT NULL
  ),
  pairs AS (
    SELECT
      a.tweet_id AS a_tweet_id,
      b.tweet_id AS b_tweet_id,
      (1 - (a.embedding <=> b.embedding))::numeric AS similarity,
      a.created_at AS a_created_at,
      b.created_at AS b_created_at,
      a.author_handle AS a_author_handle,
      b.author_handle AS b_author_handle,
      a.dedupe_status AS a_dedupe_status,
      b.dedupe_status AS b_dedupe_status,
      a.dup_of_tweet_id AS a_dup_of_tweet_id,
      b.dup_of_tweet_id AS b_dup_of_tweet_id,
      a.delivery_decision AS a_delivery_decision,
      b.delivery_decision AS b_delivery_decision,
      COALESCE(a.final_score, a.importance_score::numeric) AS a_final_score,
      COALESCE(b.final_score, b.importance_score::numeric) AS b_final_score,
      a.telegram_status AS a_telegram_status,
      b.telegram_status AS b_telegram_status,
      a.x_status AS a_x_status,
      b.x_status AS b_x_status,
      a.text_excerpt AS a_text,
      b.text_excerpt AS b_text
    FROM recent a
    INNER JOIN recent b ON a.created_at < b.created_at
    WHERE (1 - (a.embedding <=> b.embedding)) >= candidate_min_similarity
      AND NOT EXISTS (
        SELECT 1 FROM public.story_pair_blocklist bl
        WHERE bl.tweet_a = LEAST(a.tweet_id, b.tweet_id)
          AND bl.tweet_b = GREATEST(a.tweet_id, b.tweet_id)
      )
  )
  SELECT
    p.*,
    CASE
      WHEN p.b_dedupe_status = 'duplicate'
        OR (p.a_dedupe_status = 'duplicate' AND p.a_dup_of_tweet_id = p.b_tweet_id)
        OR (p.b_dup_of_tweet_id IS NOT NULL AND p.b_dup_of_tweet_id = p.a_tweet_id)
        OR (
          p.a_dup_of_tweet_id IS NOT NULL
          AND p.b_dup_of_tweet_id IS NOT NULL
          AND p.a_dup_of_tweet_id = p.b_dup_of_tweet_id
        )
        THEN 'already_duplicate'
      WHEN p.b_dedupe_status = 'related_new_info'
        OR (p.a_dedupe_status = 'related_new_info' AND p.a_dup_of_tweet_id = p.b_tweet_id)
        THEN 'already_related_new_info'
      WHEN p.similarity >= 0.86 AND p.b_dedupe_status = 'unique' THEN 'review_duplicate_miss'
      WHEN p.similarity >= 0.86 AND p.b_dedupe_status IS NULL THEN 'review_missing_dedupe_state'
      ELSE 'candidate'
    END AS proposed_status,
    CASE
      WHEN p.similarity >= 0.86 AND COALESCE(p.b_dedupe_status, '') NOT IN ('duplicate', 'related_new_info')
        THEN 'High-similarity later item is not duplicate-blocked; inspect for missed duplicate or material new facts.'
      ELSE 'Candidate pair for duplicate audit.'
    END AS proposed_reason
  FROM pairs p
  ORDER BY p.similarity DESC, p.b_created_at DESC
  LIMIT LEAST(GREATEST(match_limit, 1), 5000);
$$;

REVOKE ALL ON FUNCTION public.audit_duplicate_candidates(int, numeric, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_duplicate_candidates(int, numeric, int)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  expired_leases int := 0;
  stale_running int := 0;
  missing_dedupes int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  dedupe_enabled boolean := false;
  result jsonb;
BEGIN
  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO dedupe_enabled
  FROM public.settings
  WHERE key = 'story_memory'
  LIMIT 1;

  UPDATE public.jobs
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  UPDATE public.jobs
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: stale running job without active lease'
  WHERE status = 'running'
    AND lease_expires_at IS NULL
    AND COALESCE(locked_at, created_at) < now() - interval '30 minutes';
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  IF dedupe_enabled THEN
    INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
    SELECT 'dedupe',
           jsonb_build_object('tweet_id', p.tweet_id, 'source', 'reconcile'),
           'pending',
           'dedupe:reconcile:' || p.tweet_id,
           now(),
           11
    FROM public.posts p
    WHERE p.created_at > now() - interval '24 hours'
      AND p.text_original IS NOT NULL
      AND (
        p.dedupe_status IS NULL
        OR (
          p.dedupe_status = 'pending'
          AND COALESCE(p.dedupe_checked_at, p.created_at) < now() - interval '5 minutes'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.type IN ('dedupe','compute_signature')
          AND (j.payload->>'tweet_id') = p.tweet_id
          AND j.status IN ('pending','running')
      )
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS missing_dedupes = ROW_COUNT;
  END IF;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'translate:reconcile:' || p.tweet_id,
         now(),
         10
  FROM public.posts p
  WHERE p.translated_at IS NULL
    AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type IN ('dedupe','compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'translate'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'deliver:reconcile:' || p.tweet_id,
         now()
  FROM public.posts p
  WHERE p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type IN ('dedupe','compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'deliver'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
    AND p.created_at > now() - interval '24 hours'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'hydrate:reconcile:' || p.tweet_id,
         now(),
         15
  FROM public.posts p
  WHERE p.is_truncated = true
    AND p.hydrated_at IS NULL
    AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'resolve_media:reconcile:' || p.tweet_id,
         now(),
         12
  FROM public.posts p
  WHERE p.has_media = true
    AND p.created_at > now() - interval '24 hours'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.media m
      WHERE m.tweet_id = p.tweet_id AND m.downloaded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type IN ('resolve_media','download_media')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'stale_running_released', stale_running,
    'missing_dedupes_created', missing_dedupes,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now()
  );

  INSERT INTO public.queue_reconcile_runs (
    result,
    expired_leases_released,
    stale_running_released,
    missing_dedupes_created,
    missing_translates_created,
    missing_deliveries_created,
    missing_hydrations_created,
    missing_media_created
  )
  VALUES (
    result,
    expired_leases,
    stale_running,
    missing_dedupes,
    missing_translates,
    missing_deliveries,
    missing_hydrations,
    missing_media
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_jobs() TO postgres, service_role;
