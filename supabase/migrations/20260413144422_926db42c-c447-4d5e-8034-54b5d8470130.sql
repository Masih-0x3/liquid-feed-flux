
-- Remove broken cron jobs
SELECT cron.unschedule('invoke-worker-every-15s');
SELECT cron.unschedule('invoke-db-cleanup-daily');
SELECT cron.unschedule('invoke-media-cleanup-daily');

-- Recreate with runtime project settings instead of hardcoded keys.
SELECT cron.schedule(
  'invoke-worker-every-15s',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'invoke-db-cleanup-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/db-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{"retention_days":7}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'invoke-media-cleanup-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
