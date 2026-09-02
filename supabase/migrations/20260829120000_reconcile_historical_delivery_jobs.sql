-- Reconcile historical delivery jobs without allowing a cutover trigger to
-- abort the maintenance batch. Historical Telegram/X work may continue through
-- translation, hydration, media, and rendering, but it must never be released
-- to pending or admitted to provider delivery.
--
-- This is an append-only successor to the V1 cutover reconcile definition. It
-- settles only expired/stale historical deliver jobs through the existing
-- terminal settlement RPC, then applies the normal new-only reconcile guards.
BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  expired_leases int := 0;
  stale_running int := 0;
  historical_deliveries_settled int := 0;
  missing_dedupes int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  dedupe_enabled boolean := false;
  v_cutover timestamptz;
  v_historical_job_id uuid;
  result jsonb;
BEGIN
  v_cutover := public.get_delivery_cutover();

  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO dedupe_enabled
  FROM public.settings
  WHERE key = 'story_memory'
  LIMIT 1;

  -- A historical deliver job cannot be released to pending. Settle only the
  -- expired/stale rows that this maintenance run would otherwise inspect;
  -- settle_delivery_cutover_blocked closes the durable claim envelope and does
  -- not perform provider work.
  IF v_cutover IS NOT NULL THEN
    FOR v_historical_job_id IN
      SELECT j.id
      FROM public.jobs AS j
      WHERE j.type = 'deliver'
        AND j.status = 'running'
        AND (
          (j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now())
          OR (
            j.lease_expires_at IS NULL
            AND COALESCE(j.locked_at, j.created_at) < now() - interval '30 minutes'
          )
        )
        AND NOT public.delivery_cutover_allows_job(
          j.created_at,
          NULLIF(btrim(j.payload->>'tweet_id'), '')
        )
      ORDER BY j.created_at ASC
    LOOP
      IF public.settle_delivery_cutover_blocked(
        v_historical_job_id,
        'delivery_cutover_blocked:reconcile_historical_deliver'
      ) THEN
        historical_deliveries_settled := historical_deliveries_settled + 1;
      END IF;
    END LOOP;
  END IF;

  -- Release only non-delivery jobs and eligible post-cutover delivery jobs.
  -- The explicit predicate remains in place even after historical settlement,
  -- so a concurrent or newly discovered historical row cannot be requeued.
  UPDATE public.jobs AS j
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE j.status = 'running'
    AND j.lease_expires_at IS NOT NULL
    AND j.lease_expires_at < now()
    AND (
      j.type <> 'deliver'
      OR public.delivery_cutover_allows_job(
        j.created_at,
        NULLIF(btrim(j.payload->>'tweet_id'), '')
      )
    );
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  UPDATE public.jobs AS j
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: stale running job without active lease'
  WHERE j.status = 'running'
    AND j.lease_expires_at IS NULL
    AND COALESCE(j.locked_at, j.created_at) < now() - interval '30 minutes'
    AND (
      j.type <> 'deliver'
      OR public.delivery_cutover_allows_job(
        j.created_at,
        NULLIF(btrim(j.payload->>'tweet_id'), '')
      )
    );
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  IF dedupe_enabled THEN
    INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
    SELECT 'dedupe', jsonb_build_object('tweet_id', p.tweet_id, 'source', 'reconcile'),
      'pending', 'dedupe:reconcile:' || p.tweet_id, now(), 11
    FROM public.posts AS p
    WHERE p.created_at > now() - interval '24 hours'
      AND p.text_original IS NOT NULL
      AND (
        p.dedupe_status IS NULL
        OR (
          p.dedupe_status = 'pending'
          AND COALESCE(p.dedupe_checked_at, p.created_at) < now() - interval '5 minutes'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs AS j
        WHERE j.type IN ('dedupe', 'compute_signature')
          AND (j.payload->>'tweet_id') = p.tweet_id
          AND j.status IN ('pending', 'running')
      )
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS missing_dedupes = ROW_COUNT;
  END IF;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'translate:reconcile:' || p.tweet_id, now(), 10
  FROM public.posts AS p
  WHERE p.translated_at IS NULL
    AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND (p.delivery_decision IS NULL OR p.delivery_decision = 'deliver')
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('dedupe', 'compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'translate'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'deliver:reconcile:' || p.tweet_id, now()
  FROM public.posts AS p
  WHERE v_cutover IS NOT NULL
    AND public.delivery_cutover_allows_post(p.tweet_id)
    AND p.created_at > v_cutover
    AND p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.deliveries AS d
      WHERE d.subject_type = 'post'
        AND d.subject_id = p.tweet_id
        AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('dedupe', 'compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'deliver'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'hydrate:reconcile:' || p.tweet_id, now(), 15
  FROM public.posts AS p
  WHERE p.is_truncated = true
    AND p.hydrated_at IS NULL
    AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'resolve_media:reconcile:' || p.tweet_id, now(), 12
  FROM public.posts AS p
  WHERE p.has_media = true
    AND p.created_at > now() - interval '24 hours'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.media AS m
      WHERE m.tweet_id = p.tweet_id
        AND m.downloaded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('resolve_media', 'download_media')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'stale_running_released', stale_running,
    'historical_deliveries_settled', historical_deliveries_settled,
    'missing_dedupes_created', missing_dedupes,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now(),
    'delivery_cutover', v_cutover
  );

  INSERT INTO public.queue_reconcile_runs(
    result,
    expired_leases_released,
    stale_running_released,
    missing_dedupes_created,
    missing_translates_created,
    missing_deliveries_created,
    missing_hydrations_created,
    missing_media_created
  )
  VALUES (
    result,
    expired_leases,
    stale_running,
    missing_dedupes,
    missing_translates,
    missing_deliveries,
    missing_hydrations,
    missing_media
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_jobs()
  TO postgres, service_role;

COMMIT;
