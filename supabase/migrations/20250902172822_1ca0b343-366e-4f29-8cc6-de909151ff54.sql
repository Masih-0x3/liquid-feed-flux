-- Enable the pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable the pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the worker function to run every minute
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
