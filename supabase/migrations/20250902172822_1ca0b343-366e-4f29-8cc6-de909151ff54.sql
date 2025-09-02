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
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXJxZnp6dmxieHdmem5kYWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNzgsImV4cCI6MjA3MjQwNjE3OH0.bdVRQeXKONOLTjMlBoa0-MvxMGRVMRGyZS5uynejj4g"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);