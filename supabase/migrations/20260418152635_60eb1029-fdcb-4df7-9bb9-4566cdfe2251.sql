SELECT cron.unschedule('x-poster-tick');

SELECT cron.schedule(
  'x-poster-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXJxZnp6dmxieHdmem5kYWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNzgsImV4cCI6MjA3MjQwNjE3OH0.bdVRQeXKONOLTjMlBoa0-MvxMGRVMRGyZS5uynejj4g"}'::jsonb,
    body := jsonb_build_object('source', 'cron', 'ts', now())
  ) AS request_id;
  $$
);