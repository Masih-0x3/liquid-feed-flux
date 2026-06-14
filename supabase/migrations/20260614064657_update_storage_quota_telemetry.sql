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
  storage_limit_text text := current_setting('app.settings.storage_limit_bytes', true);
  storage_limit_bytes bigint := 100000000000;
BEGIN
  IF storage_limit_text ~ '^[0-9]+$' THEN
    storage_limit_bytes := storage_limit_text::bigint;
  END IF;

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
    'storage_limit_bytes', storage_limit_bytes,
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
    'storage_limit_bytes', 100000000000,
    'edge_monthly_limit', 500000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_resource_usage() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_resource_usage() TO service_role;
