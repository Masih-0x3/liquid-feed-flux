
-- Add hydrations_per_day budget to existing x_rate_limits row (default 100)
UPDATE public.settings
SET value = value || jsonb_build_object('hydrations_per_day', 100),
    updated_at = now()
WHERE key = 'x_rate_limits' AND NOT (value ? 'hydrations_per_day');

-- Replace reconcile_stuck_jobs:
--   * Hydration retries are now ONLY for posts that already passed the editorial gate
--     (delivery_decision = 'deliver'), and only within the last 24 hours.
--   * Posts not yet translated/scored will re-enter the pipeline naturally via the
--     translate reconcile path (which is unchanged conceptually but rebuilt below).
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

  -- 2) Re-queue translate for posts ingested but never translated/scored (last 24h).
  --    This is the safety net for the new flow where every post (truncated or not)
  --    must be translated+scored first.
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

  -- 3) Re-queue deliver for translated posts that passed the gate but have no posted delivery
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
    -- If post is truncated and not yet hydrated, do NOT enqueue deliver here;
    -- the hydration reconcile below will pick it up and the post-hydrate translate
    -- will re-enqueue deliver.
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

  -- 4) Re-queue hydration ONLY for translated posts that PASSED the editorial gate
  --    AND are still truncated. Window tightened from 7 days to 24 hours to avoid
  --    burning X API reads on stale content.
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

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'reconciled_at', now()
  );

  RETURN result;
END;
$function$;
