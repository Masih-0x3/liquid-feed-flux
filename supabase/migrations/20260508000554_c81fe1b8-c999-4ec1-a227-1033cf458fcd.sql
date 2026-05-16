SELECT cron.unschedule(10);
SELECT cron.schedule(
  'invoke-media-cleanup-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{"days_old":1}'::jsonb
  );
  $$
);
