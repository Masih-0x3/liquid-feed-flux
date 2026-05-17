-- Make duplicate gating authoritative for production delivery/X posting.
-- Correctness matters more than approximate vector speed at current volume.

ALTER TABLE public.queue_reconcile_runs
  ADD COLUMN IF NOT EXISTS missing_dedupes_created integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.find_story_candidates_v3(vector(1536), text, int, numeric, int);

CREATE FUNCTION public.find_story_candidates_v3(
  query_embedding vector(1536),
  exclude_tweet_id text,
  window_hours int DEFAULT 48,
  candidate_min_similarity numeric DEFAULT 0.78,
  match_limit int DEFAULT 3
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
  candidate_delivery_decision text
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
      p.delivery_decision AS candidate_delivery_decision
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
      r.candidate_delivery_decision
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
    s.candidate_delivery_decision
  FROM scored s
  WHERE s.similarity >= candidate_min_similarity
  ORDER BY s.similarity DESC, s.created_at ASC
  LIMIT LEAST(GREATEST(match_limit, 1), 10);
$$;

REVOKE ALL ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
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
    AND NOT (p.dedupe_status = 'duplicate' OR p.dup_of_tweet_id IS NOT NULL)
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
    AND NOT (p.dedupe_status = 'duplicate' OR p.dup_of_tweet_id IS NOT NULL)
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
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
    AND NOT (p.dedupe_status = 'duplicate' OR p.dup_of_tweet_id IS NOT NULL)
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
    AND p.tweet_id <> 'https://twitter.com/Osint613/status/2052532719637180730'
    AND NOT (p.dedupe_status = 'duplicate' OR p.dup_of_tweet_id IS NOT NULL)
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

  UPDATE public.jobs
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      last_error = COALESCE(last_error, 'manually posted; superseded')
  WHERE type = 'resolve_media'
    AND status IN ('pending','running')
    AND (payload->>'tweet_id') = 'https://twitter.com/Osint613/status/2052532719637180730';

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
