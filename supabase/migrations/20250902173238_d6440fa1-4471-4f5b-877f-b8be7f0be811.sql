-- Move extensions from public schema to their dedicated schemas
DROP EXTENSION IF EXISTS pg_cron;
DROP EXTENSION IF EXISTS pg_net;

-- Create extensions in their proper schemas (not public)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule the worker function to run every minute using the correct schema
SELECT cron.schedule(
  'process-jobs',
  '* * * * *', -- every minute
  $$
  SELECT
    net.http_post(
        url:='https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
        ),
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);
