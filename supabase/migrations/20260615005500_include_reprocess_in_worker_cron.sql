-- Allow operator-queued reprocess jobs to be claimed by the worker fallback cron.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-1m') THEN
    PERFORM cron.unschedule('invoke-worker-every-1m');
  END IF;
END $$;

SELECT cron.schedule(
  'invoke-worker-every-1m',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron","job_types":["reprocess","dedupe","resolve_media","download_media","hydrate_tweet","translate","deliver"],"batch_size":20,"chain_depth":0}'::jsonb
  );
  $cron$
);
