
-- Ensure Vault is available
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Seed an empty WEBHOOK_SHARED_SECRET in Vault if missing.
-- The user must update its value in Supabase Studio → Vault to match the
-- WEBHOOK_SHARED_SECRET edge-function secret. Cron jobs read from here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'WEBHOOK_SHARED_SECRET') THEN
    PERFORM vault.create_secret('REPLACE_ME', 'WEBHOOK_SHARED_SECRET', 'Shared secret for internal edge function calls from pg_cron');
  END IF;
END $$;

-- Helper: build internal headers JSON pulling secret from Vault at call time.
CREATE OR REPLACE FUNCTION public._cron_internal_headers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-token', COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'WEBHOOK_SHARED_SECRET' LIMIT 1),
      ''
    )
  );
$$;
REVOKE ALL ON FUNCTION public._cron_internal_headers() FROM public, anon, authenticated;

-- Reschedule each cron job with x-internal-token instead of anon Bearer.
SELECT cron.unschedule('x-poster-tick');
SELECT cron.schedule(
  'x-poster-tick',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := public._cron_internal_headers(),
    body := jsonb_build_object('source','cron','ts', now())
  );
  $cron$
);

SELECT cron.unschedule('x-followers-snapshot-daily');
SELECT cron.schedule(
  'x-followers-snapshot-daily',
  '0 3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-followers-snapshot',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron"}'::jsonb
  );
  $cron$
);

SELECT cron.unschedule('invoke-db-cleanup-daily');
SELECT cron.schedule(
  'invoke-db-cleanup-daily',
  '0 3 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/db-cleanup',
    headers := public._cron_internal_headers(),
    body := '{"retention_days":7}'::jsonb
  );
  $cron$
);

SELECT cron.unschedule('invoke-worker-every-15s');
SELECT cron.schedule(
  'invoke-worker-every-15s',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron"}'::jsonb
  );
  $cron$
);

SELECT cron.unschedule('invoke-media-cleanup-6h');
SELECT cron.schedule(
  'invoke-media-cleanup-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/media-cleanup',
    headers := public._cron_internal_headers(),
    body := '{"days_old":1}'::jsonb
  );
  $cron$
);
