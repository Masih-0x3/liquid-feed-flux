-- Speed/quota tuning: shorten worker scheduler wait without returning to the
-- old high-frequency cron, and make media/resource diagnostics safer.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-15s') THEN
    PERFORM cron.unschedule('invoke-worker-every-15s');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-2m') THEN
    PERFORM cron.unschedule('invoke-worker-every-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-1m') THEN
    PERFORM cron.unschedule('invoke-worker-every-1m');
  END IF;
END $$;

SELECT cron.schedule(
  'invoke-worker-every-1m',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron"}'::jsonb
  );
  $cron$
);

CREATE OR REPLACE FUNCTION public.get_old_media(days_old integer DEFAULT 30)
RETURNS TABLE (
  id uuid,
  storage_path text,
  tweet_id text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.storage_path, m.tweet_id
  FROM public.media m
  WHERE m.downloaded_at IS NOT NULL
    AND m.downloaded_at < (now() - interval '1 day' * greatest(days_old, 1))
    AND m.storage_path IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.status IN ('pending', 'running')
        AND j.type IN ('download_media', 'resolve_media', 'hydrate_tweet')
        AND j.payload->>'tweet_id' = m.tweet_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.deliveries d
      WHERE d.subject_type = 'post'
        AND d.subject_id = m.tweet_id
        AND d.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.x_deliveries xd
      WHERE xd.post_id = m.tweet_id
        AND xd.status IN ('pending', 'running')
    )
    AND NOT (
      m.kind IN ('video', 'gif')
      AND (m.mime_type IS NULL OR m.mime_type NOT LIKE 'video/%')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_old_media(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_old_media(integer) TO service_role;

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
    'cron_failures_24h', cron_failures_24h
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
