-- Queue settlement P1 repair.
--
-- The V1 cutover successor accidentally left the legacy reconciliation UPDATE
-- broad enough to return provider-started jobs to pending.  This migration keeps
-- the existing reconciliation work, but only releases a running job while its
-- durable claim is still pre-provider.  Provider-started and ambiguous claims
-- remain running/ambiguous for operator reconciliation and retain the evidence
-- needed to explain why they were not requeued.
BEGIN;

CREATE OR REPLACE FUNCTION public.retry_step(tweet_id text, step text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  job_type text;
  retry_key text;
BEGIN
  IF step = 'translate' THEN
    job_type := 'translate';
  ELSIF step = 'deliver' THEN
    PERFORM public.assert_delivery_cutover_post(tweet_id);
    job_type := 'deliver';
  ELSIF step = 'media' THEN
    job_type := 'download_media';
  ELSIF step = 'moderate' THEN
    job_type := 'moderate';
  ELSE
    RAISE EXCEPTION 'Unknown step %', step;
  END IF;

  retry_key := left(lower(step) || ':manual_retry:' || tweet_id, 512);
  INSERT INTO public.jobs(
    type, payload, status, idempotency_key, next_run_at,
    locked_at, locked_by, lease_expires_at,
    claim_token, claim_state, claim_started_at, claim_expires_at,
    provider_started_at
  )
  VALUES (
    job_type,
    jsonb_build_object(
      'tweet_id', tweet_id,
      'subject_type', 'post',
      'subject_id', tweet_id,
      'source', 'rpc.retry_step'
    ),
    'pending', retry_key, now(),
    NULL, NULL, NULL,
    NULL, 'idle', NULL, NULL,
    NULL
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET
    status = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN 'pending'
      ELSE public.jobs.status
    END,
    next_run_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN now()
      ELSE public.jobs.next_run_at
    END,
    last_error = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.last_error
    END,
    locked_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.locked_at
    END,
    locked_by = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.locked_by
    END,
    lease_expires_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.lease_expires_at
    END,
    claim_token = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.claim_token
    END,
    claim_state = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN 'idle'
      ELSE public.jobs.claim_state
    END,
    claim_started_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.claim_started_at
    END,
    claim_expires_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.claim_expires_at
    END,
    provider_started_at = CASE
      WHEN public.jobs.status IN ('failed', 'completed') THEN NULL
      ELSE public.jobs.provider_started_at
    END;

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, started_at, meta)
  VALUES (
    'post', tweet_id, step, 'queued', now(),
    jsonb_build_object('source', 'rpc.retry_step', 'idempotency_key', retry_key)
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_step(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_step(text, text) TO service_role;

-- Keep the reconciliation body in one authoritative latest definition while
-- narrowing only the queue-lease settlement predicate. The claim token is
-- cleared when work is returned to pending, while generation is retained so
-- claim_jobs can mint a strictly newer identity. Provider evidence is never
-- cleared because it is the reason a claim cannot be safely retried.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  expired_leases int := 0;
  stale_running int := 0;
  missing_dedupes int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  dedupe_enabled boolean := false;
  v_cutover timestamptz;
  result jsonb;
BEGIN
  v_cutover := public.get_delivery_cutover();
  SELECT COALESCE((value->>'enabled')::boolean, false) INTO dedupe_enabled
  FROM public.settings WHERE key = 'story_memory' LIMIT 1;

  UPDATE public.jobs j SET
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    claim_token = NULL,
    claim_generation = COALESCE(j.claim_generation, 0),
    claim_state = 'idle',
    claim_started_at = NULL,
    claim_expires_at = NULL,
    provider_started_at = NULL,
    last_error = 'Released: pre-provider lease expired'
  WHERE j.status = 'running'
    AND COALESCE(j.claim_state, 'idle') IN ('idle', 'preparing', 'ready')
    AND j.provider_started_at IS NULL
    AND (
      (j.lease_expires_at IS NOT NULL AND j.lease_expires_at < now())
      OR (j.claim_expires_at IS NOT NULL AND j.claim_expires_at < now())
    )
    AND (j.type <> 'deliver' OR public.delivery_cutover_allows_job(
      j.created_at, NULLIF(btrim(j.payload->>'tweet_id'), '')
    ));
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  UPDATE public.jobs j SET
    status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    claim_token = NULL,
    claim_generation = COALESCE(j.claim_generation, 0),
    claim_state = 'idle',
    claim_started_at = NULL,
    claim_expires_at = NULL,
    provider_started_at = NULL,
    last_error = 'Released: pre-provider stale running job without active lease'
  WHERE j.status = 'running'
    AND COALESCE(j.claim_state, 'idle') IN ('idle', 'preparing', 'ready')
    AND j.provider_started_at IS NULL
    AND j.lease_expires_at IS NULL
    AND j.claim_expires_at IS NULL
    AND COALESCE(j.locked_at, j.created_at) < now() - interval '30 minutes'
    AND (j.type <> 'deliver' OR public.delivery_cutover_allows_job(
      j.created_at, NULLIF(btrim(j.payload->>'tweet_id'), '')
    ));
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  IF dedupe_enabled THEN
    INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
    SELECT 'dedupe', jsonb_build_object('tweet_id', p.tweet_id, 'source', 'reconcile'),
      'pending', 'dedupe:reconcile:' || p.tweet_id, now(), 11
    FROM public.posts p
    WHERE p.created_at > now() - interval '24 hours' AND p.text_original IS NOT NULL
      AND (p.dedupe_status IS NULL OR (p.dedupe_status = 'pending'
        AND COALESCE(p.dedupe_checked_at, p.created_at) < now() - interval '5 minutes'))
      AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe', 'compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS missing_dedupes = ROW_COUNT;
  END IF;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'translate:reconcile:' || p.tweet_id, now(), 10
  FROM public.posts p
  WHERE p.translated_at IS NULL AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND (p.delivery_decision IS NULL OR p.delivery_decision = 'deliver')
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (p.dedupe_status = 'duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe', 'compute_signature')
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type = 'translate'
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'deliver:reconcile:' || p.tweet_id, now()
  FROM public.posts p
  WHERE v_cutover IS NOT NULL
    AND public.delivery_cutover_allows_post(p.tweet_id)
    AND p.created_at > v_cutover
    AND p.translated_at IS NOT NULL AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (p.dedupe_status = 'duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')))
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.deliveries d WHERE d.subject_type = 'post'
      AND d.subject_id = p.tweet_id AND d.status = 'posted')
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe', 'compute_signature')
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type = 'deliver'
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'hydrate:reconcile:' || p.tweet_id, now(), 15
  FROM public.posts p
  WHERE p.is_truncated = true AND p.hydrated_at IS NULL AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver' AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (p.dedupe_status = 'duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')))
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type = 'hydrate_tweet'
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'resolve_media:reconcile:' || p.tweet_id, now(), 12
  FROM public.posts p
  WHERE p.has_media = true AND p.created_at > now() - interval '24 hours'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (p.dedupe_status = 'duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')))
    AND NOT EXISTS (SELECT 1 FROM public.media m WHERE m.tweet_id = p.tweet_id AND m.downloaded_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('resolve_media', 'download_media')
      AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'stale_running_released', stale_running,
    'missing_dedupes_created', missing_dedupes,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now(),
    'delivery_cutover', v_cutover
  );
  INSERT INTO public.queue_reconcile_runs(
    result, expired_leases_released, stale_running_released,
    missing_dedupes_created, missing_translates_created, missing_deliveries_created,
    missing_hydrations_created, missing_media_created
  )
  VALUES (
    result, expired_leases, stale_running, missing_dedupes, missing_translates,
    missing_deliveries, missing_hydrations, missing_media
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_jobs() TO postgres, service_role;

-- An X claim that expired before the provider boundary is safe to reclaim in
-- place. A fresh token and generation invalidate any stale worker that still
-- holds the old claim. Claims with provider evidence, an ambiguous state, or a
-- missing expiry remain untouched and therefore cannot be replayed.
ALTER FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)
  RENAME TO claim_x_post_delivery_unchecked;

CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(
  p_post_id text,
  p_source text DEFAULT 'unknown',
  p_force_retry boolean DEFAULT false,
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_post_id text := NULLIF(btrim(COALESCE(p_post_id, '')), '');
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'unknown'), 120);
  v_ttl integer := GREATEST(60, LEAST(COALESCE(p_claim_ttl_seconds, 1800), 7200));
  v_claim_token uuid := gen_random_uuid();
  v_delivery_id uuid;
  v_generation bigint;
  v_expires_at timestamptz;
  v_existing record;
BEGIN
  IF v_post_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_post_id');
  END IF;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_cutover_blocked');
  END IF;

  SELECT id, status, claim_token, claim_generation, claim_state,
         claim_expires_at, provider_started_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status = 'posting'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND
    AND v_existing.claim_expires_at IS NOT NULL
    AND v_existing.claim_expires_at < now()
    AND v_existing.provider_started_at IS NULL
    AND COALESCE(v_existing.claim_state, 'preparing') IN ('preparing', 'ready', 'posting')
  THEN
    v_expires_at := now() + make_interval(secs => v_ttl);
    UPDATE public.x_deliveries
    SET claim_token = v_claim_token,
        claim_generation = COALESCE(claim_generation, 0) + 1,
        claim_state = 'preparing',
        claim_source = v_source,
        claim_started_at = now(),
        claim_expires_at = v_expires_at,
        last_error = NULL,
        last_claim_error = NULL,
        next_retry_at = NULL,
        updated_at = now()
    WHERE id = v_existing.id
      AND status = 'posting'
      AND provider_started_at IS NULL
      AND claim_expires_at < now()
      AND COALESCE(claim_state, 'preparing') IN ('preparing', 'ready', 'posting')
    RETURNING id, claim_generation INTO v_delivery_id, v_generation;
    IF v_delivery_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'claimed', true,
        'reason', 'reclaimed_pre_provider',
        'delivery_id', v_delivery_id,
        'claim_token', v_claim_token,
        'claim_generation', v_generation,
        'claim_expires_at', v_expires_at
      );
    END IF;
  END IF;

  RETURN public.claim_x_post_delivery_unchecked(
    v_post_id, v_source, p_force_retry, p_claim_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_x_post_delivery_unchecked(text, text, boolean, integer)
  FROM public, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)
  TO service_role;

COMMIT;
