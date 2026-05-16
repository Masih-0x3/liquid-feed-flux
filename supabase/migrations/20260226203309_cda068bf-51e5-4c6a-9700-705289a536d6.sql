
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule daily cleanup at 3 AM UTC
SELECT cron.schedule(
  'daily-db-cleanup',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url:='https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/db-cleanup',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body:='{"retention_days": 7, "batch_limit": 5000}'::jsonb
  ) as request_id;
  $$
);
