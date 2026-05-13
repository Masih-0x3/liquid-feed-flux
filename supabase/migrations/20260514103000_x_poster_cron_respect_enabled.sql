-- Gate x-poster cron on x_posting_config.enabled so disabling X in Settings
-- stops Edge invocations and avoids log noise. Telegram/worker crons unchanged.
CREATE OR REPLACE FUNCTION public.invoke_x_poster_if_enabled()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  enabled boolean;
BEGIN
  SELECT COALESCE((value->>'enabled')::boolean, false)
  INTO enabled
  FROM public.settings
  WHERE key = 'x_posting_config'
  LIMIT 1;

  IF NOT enabled THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := public._cron_internal_headers(),
    body := jsonb_build_object('source', 'cron', 'ts', now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_x_poster_if_enabled() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_x_poster_if_enabled() TO postgres;

SELECT cron.unschedule('x-poster-tick');
SELECT cron.schedule(
  'x-poster-tick',
  '* * * * *',
  $cron$
  SELECT public.invoke_x_poster_if_enabled();
  $cron$
);
