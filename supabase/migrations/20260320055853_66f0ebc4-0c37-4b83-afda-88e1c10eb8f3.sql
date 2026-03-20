
-- Issue 5: Update cron jobs to not hardcode the anon key
-- Instead use the WEBHOOK_SHARED_SECRET or service_role_key from vault

-- First, drop existing cron jobs that may have hardcoded tokens
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('invoke-worker-every-15s', 'invoke-db-cleanup-daily', 'invoke-media-cleanup-daily');

-- Recreate cron jobs using service_role_key from current_setting
-- Worker: every 15 seconds
SELECT cron.schedule(
  'invoke-worker-every-15s',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);

-- DB cleanup: daily at 3 AM UTC
SELECT cron.schedule(
  'invoke-db-cleanup-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/db-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"retention_days":7}'::jsonb
  );
  $$
);

-- Media cleanup: daily at 4 AM UTC
SELECT cron.schedule(
  'invoke-media-cleanup-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Issue 22: Create reconcile_stuck_jobs RPC
CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  expired_leases int := 0;
  orphaned_translates int := 0;
  missing_deliveries int := 0;
  result jsonb;
BEGIN
  -- 1. Release jobs with expired leases (stuck in 'running' state)
  UPDATE public.jobs
  SET status = 'pending', locked_at = NULL, locked_by = NULL, lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  -- 2. Find translated posts with no delivery job and no successful delivery
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'deliver:reconcile:' || p.tweet_id,
         now()
  FROM public.posts p
  WHERE p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running')
    )
    AND p.created_at > now() - interval '7 days'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'missing_deliveries_created', missing_deliveries,
    'reconciled_at', now()
  );

  RETURN result;
END;
$$;
