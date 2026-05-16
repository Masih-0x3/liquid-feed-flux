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
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
        ),
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);
