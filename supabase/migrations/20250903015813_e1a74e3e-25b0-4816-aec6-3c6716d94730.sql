-- Update old pending translation jobs to use correct target language (Persian)
UPDATE jobs 
SET payload = jsonb_set(payload, '{target_lang}', '"fa"'::jsonb)
WHERE type = 'translate' 
  AND status = 'pending' 
  AND payload->>'target_lang' = 'en';

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension if not already enabled  
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a cron job to run the worker every minute
SELECT cron.schedule(
  'process-pending-jobs',
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