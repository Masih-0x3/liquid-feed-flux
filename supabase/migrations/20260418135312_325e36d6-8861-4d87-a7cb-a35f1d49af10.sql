-- Remove prior schedule if it exists (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('x-poster-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'x-poster-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXJxZnp6dmxieHdmem5kYWVyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjgzMDE3OCwiZXhwIjoyMDcyNDA2MTc4fQ.G_xwxAzbjg6JF7Z9BW_KZeeIYM1xlGWN4HwmiL2hRvU"}'::jsonb,
    body := jsonb_build_object('source', 'cron', 'ts', now())
  ) AS request_id;
  $$
);