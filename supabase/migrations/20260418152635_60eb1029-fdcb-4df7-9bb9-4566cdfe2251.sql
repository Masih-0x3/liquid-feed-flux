SELECT cron.unschedule('x-poster-tick');

SELECT cron.schedule(
  'x-poster-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := jsonb_build_object('source', 'cron', 'ts', now())
  ) AS request_id;
  $$
);
