-- Create a daily cron job to clean up old media files
-- This will run every day at 2 AM UTC
SELECT cron.schedule(
  'daily-media-cleanup',
  '0 2 * * *',
  $$
  SELECT 
    net.http_post(
      url := concat(
        current_setting('app.settings.supabase_url', true), 
        '/functions/v1/media-cleanup'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key', true))
      ),
      body := jsonb_build_object()
    ) as request_id;
  $$
);