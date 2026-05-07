-- Extend reconcile_stuck_jobs() to also recover posts whose media never downloaded.
-- This fixes the Osint613-class bug where a resolve_media insert error left
-- a post with has_media=true but zero downloaded media rows, so x-poster
-- silently posted text-only.

CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  expired_leases int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  result jsonb;
BEGIN
  -- 1) Release expired leases on running jobs
  UPDATE public.jobs
  SET status = 'pending', locked_at = NULL, locked_by = NULL, lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  -- 2) Re-queue translate
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'translate:reconcile:' || p.tweet_id,
         now(),
         10
  FROM public.posts p
  WHERE p.translated_at IS NULL
    AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'translate'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  -- 3) Re-queue deliver
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'deliver:reconcile:' || p.tweet_id,
         now()
  FROM public.posts p
  WHERE p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
    AND p.created_at > now() - interval '24 hours'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  -- 4) Re-queue hydration
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'hydrate:reconcile:' || p.tweet_id,
         now(),
         15
  FROM public.posts p
  WHERE p.is_truncated = true
    AND p.hydrated_at IS NULL
    AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver'
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  -- 5) Re-queue resolve_media for posts that flagged media but have no downloaded rows
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'resolve_media:reconcile:' || p.tweet_id,
         now(),
         12
  FROM public.posts p
  WHERE p.has_media = true
    AND p.created_at > now() - interval '24 hours'
    -- Skip the manually-handled Osint613 video tweet
    AND p.tweet_id <> 'https://twitter.com/Osint613/status/2052532719637180730'
    AND NOT EXISTS (
      SELECT 1 FROM public.media m
      WHERE m.tweet_id = p.tweet_id AND m.downloaded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type IN ('resolve_media','download_media')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  -- 6) Mark the manually-posted Osint613 resolve_media job as completed
  UPDATE public.jobs
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      last_error = COALESCE(last_error, 'manually posted; superseded')
  WHERE type = 'resolve_media'
    AND status IN ('pending','running')
    AND (payload->>'tweet_id') = 'https://twitter.com/Osint613/status/2052532719637180730';

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now()
  );

  RETURN result;
END;
$function$;