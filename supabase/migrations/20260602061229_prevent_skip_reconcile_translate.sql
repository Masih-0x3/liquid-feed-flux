-- Prevent reconcile from re-scoring posts that V2 has already decided to skip.
-- Skipped posts intentionally have no translation; they should not be treated
-- as missing translate work unless an explicit admin/manual path changes them.

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
    AND (p.delivery_decision IS NULL OR p.delivery_decision = 'deliver')
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

UPDATE public.jobs j
SET status = 'completed',
    last_error = 'Cancelled: skipped post does not require reconcile translation',
    completed_at = COALESCE(j.completed_at, now()),
    result_meta = COALESCE(j.result_meta, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by', 'prevent_skip_reconcile_translate',
      'cancelled_at', now()
    )
FROM public.posts p
WHERE j.type = 'translate'
  AND j.status = 'pending'
  AND j.idempotency_key LIKE 'translate:reconcile:%'
  AND (j.payload->>'tweet_id') = p.tweet_id
  AND p.delivery_decision = 'skip';

CREATE OR REPLACE FUNCTION public.get_system_resource_usage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  db_bytes bigint := 0;
  temp_media_bytes bigint := 0;
  temp_media_objects integer := 0;
  cron_jobs jsonb := '[]'::jsonb;
  cron_failures_24h integer := NULL;
  duplicate_translate_jobs_24h integer := 0;
BEGIN
  SELECT pg_database_size(current_database()) INTO db_bytes;

  SELECT
    COALESCE(sum((o.metadata->>'size')::bigint), 0),
    count(*)::integer
  INTO temp_media_bytes, temp_media_objects
  FROM storage.objects o
  WHERE o.bucket_id = 'temp-media';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jobname', j.jobname,
    'schedule', j.schedule,
    'active', j.active
  ) ORDER BY j.jobname), '[]'::jsonb)
  INTO cron_jobs
  FROM cron.job j
  WHERE j.jobname IN (
    'invoke-worker-every-1m',
    'invoke-worker-every-2m',
    'invoke-worker-every-15s',
    'x-poster-tick',
    'reconcile-stuck-jobs-every-10m',
    'invoke-media-cleanup-6h',
    'invoke-db-cleanup-daily',
    'x-followers-snapshot-daily'
  );

  SELECT COALESCE(sum(job_count - 1), 0)::integer
  INTO duplicate_translate_jobs_24h
  FROM (
    SELECT j.payload->>'tweet_id' AS tweet_id, count(*)::integer AS job_count
    FROM public.jobs j
    WHERE j.type = 'translate'
      AND j.created_at >= now() - interval '24 hours'
      AND NULLIF(j.payload->>'tweet_id', '') IS NOT NULL
    GROUP BY j.payload->>'tweet_id'
    HAVING count(*) > 1
  ) duplicates;

  BEGIN
    EXECUTE $sql$
      SELECT count(*)::integer
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.start_time >= now() - interval '24 hours'
        AND COALESCE(d.status, '') <> 'succeeded'
        AND j.jobname IN (
          'invoke-worker-every-1m',
          'invoke-worker-every-2m',
          'invoke-worker-every-15s',
          'x-poster-tick',
          'reconcile-stuck-jobs-every-10m',
          'invoke-media-cleanup-6h',
          'invoke-db-cleanup-daily',
          'x-followers-snapshot-daily'
        )
    $sql$ INTO cron_failures_24h;
  EXCEPTION WHEN OTHERS THEN
    cron_failures_24h := NULL;
  END;

  RETURN jsonb_build_object(
    'db_bytes', COALESCE(db_bytes, 0),
    'db_limit_bytes', 500000000,
    'temp_media_bytes', COALESCE(temp_media_bytes, 0),
    'temp_media_objects', COALESCE(temp_media_objects, 0),
    'storage_limit_bytes', 1000000000,
    'edge_monthly_limit', 500000,
    'cron_jobs', cron_jobs,
    'cron_failures_24h', cron_failures_24h,
    'duplicate_translate_jobs_24h', COALESCE(duplicate_translate_jobs_24h, 0)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'available', false,
    'error', SQLERRM,
    'db_limit_bytes', 500000000,
    'storage_limit_bytes', 1000000000,
    'edge_monthly_limit', 500000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_resource_usage() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_resource_usage() TO service_role;
