-- B3: durable job + X-delivery claim fencing (AIR-005 / AIR-003 receipt identity).
--
-- Adds a durable fencing token + monotonic generation + owner + provider-started
-- boundary to the public worker queue, and mirrors the already-accepted Telegram
-- semantics (20260724... / 202606... telegram_delivery_claims) onto X deliveries
-- WITHOUT editing any prior migration. This file is additive and over-REPLACEs the
-- X delivery functions it must extend only by CREATE OR REPLACE in its own body.
--
-- Guarantees this file establishes (source-side fences are enforced additively in
-- supabase/functions/worker/jobLifecycle.ts and xPostDeliveryClaim.ts):
--   * claim_jobs atomically mints a fresh cryptographically-random claim_token and a
--     strictly-increasing claim_generation together with the lease and the owner.
--   * Every checked terminal/mid-flight write is fenced by job/delivery id + owner
--     + claim_token + claim_generation + valid in-flight claim_state, so a stale
--     worker after expiry/reclaim receives only a zero-row (false) rejection.
--   * provider_started_at is durably recorded BEFORE the provider may accept; if
--     that marker cannot be written the provider is never called.
--   * provider-started-but-DB-failed becomes 'ambiguous', never 'success'.
--
-- Claim-state vocabulary (single-sourced; mirrored into TS helpers):
--   idle -> preparing -> ready -> posting -> posted
--                          \-> (provider-started, DB fail) -> ambiguous
--                          \-> (pre-provider abort)           -> preparing/pending back
--   X delivery keeps status='posting' until posted/failed; claim_state rides alongside.
--
-- Adversarial seals fail closed if any of the following are removed/mutated:
--   * empty closed SET search_path on every SECURITY DEFINER function
--   * fully-qualified public.* object references
--   * REVOKE from public/anon/authenticated + GRANT to service_role only
--   * FOR UPDATE SKIP LOCKED preserved in claim_jobs
--   * provider_started boundary enforced before provider calls in the source helpers

-- =============================================================================
-- 1. Durable fencing columns on the queue table.
-- =============================================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS claim_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_started_at timestamptz;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_claim_state_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_claim_state_check
  CHECK (claim_state IN ('idle', 'preparing', 'ready', 'posting', 'posted', 'failed', 'ambiguous', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_jobs_claim_expires_at
  ON public.jobs(claim_expires_at)
  WHERE claim_state IN ('preparing', 'ready', 'posting');

CREATE INDEX IF NOT EXISTS idx_jobs_claim_owner_active
  ON public.jobs(locked_by)
  WHERE claim_state IN ('preparing', 'ready', 'posting');

-- =============================================================================
-- 2. claim_jobs: transactional atomic claim acquiring a fresh token+generation
--    together with the lease. SKIP LOCKED and ordering are preserved verbatim.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_jobs(
  batch_size int DEFAULT 10,
  job_types text[] DEFAULT NULL,
  worker_id text DEFAULT 'default'
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  lease_duration interval := interval '5 minutes';
  fresh_claim_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  UPDATE public.jobs
  SET
    status = 'running',
    locked_at = now(),
    locked_by = COALESCE(NULLIF(btrim(worker_id), ''), 'default'),
    lease_expires_at = now() + lease_duration,
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1,
    claim_token = fresh_claim_token,
    claim_generation = COALESCE(claim_generation, 0) + 1,
    claim_state = 'preparing',
    claim_started_at = now(),
    claim_expires_at = now() + lease_duration,
    provider_started_at = NULL
  WHERE id IN (
    SELECT j.id
    FROM public.jobs j
    WHERE j.status = 'pending'
      AND (j.next_run_at IS NULL OR j.next_run_at <= now())
      AND (job_types IS NULL OR j.type = ANY(job_types))
    ORDER BY j.priority DESC, j.next_run_at ASC NULLS FIRST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

-- SF5: claim_jobs must be revoked from public, anon, AND authenticated (matching
-- the accepted 20260602 baseline) and granted solely to service_role. Omitting
-- authenticated would widen the EXECUTE surface for an authenticated role that may
-- hold a default grant; seal it fail-closed.
REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer,text[],text) TO service_role;

-- =============================================================================
-- 3. Provider-start boundary for queue jobs. Called immediately before the worker
--    performs its first irreversible provider call. If this write returns false the
--    worker MUST NOT call the provider (the boundary is durably authoritative).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_job_provider_started(
  p_job_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.jobs
  SET
    claim_state = 'posting',
    provider_started_at = now(),
    claim_expires_at = now() + interval '5 minutes'
  WHERE id = p_job_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND locked_by IS NOT NULL
    AND status = 'running'
    AND claim_state = 'preparing'
    AND (claim_expires_at IS NULL OR claim_expires_at > now());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_job_provider_started(uuid,uuid,bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_provider_started(uuid,uuid,bigint) TO service_role;

-- =============================================================================
-- 4. Authoritative terminal complete path for queue jobs driven through the fu —
--    (the worker's checked updateJobOrThrow applies the same id+owner+token+gen+state
--    fence; this function is the equivalent SQL surface for reconcile/operator use).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_completed_at timestamptz DEFAULT now(),
  p_last_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
  v_error text := left(NULLIF(btrim(COALESCE(p_last_error, '')), ''), 1000);
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.jobs
  SET
    status = 'completed',
    claim_state = 'posted',
    completed_at = COALESCE(p_completed_at, now()),
    last_error = NULLIF(v_error, ''),
    claim_expires_at = NULL
  WHERE id = p_job_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND locked_by IS NOT NULL
    AND status = 'running'
    AND claim_state IN ('preparing', 'posting');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_job(uuid,uuid,bigint,timestamptz,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid,uuid,bigint,timestamptz,text) TO service_role;

-- =============================================================================
-- 4b. recover_expired_job_claims (SF7): reconcile queue jobs whose claim lease
--     expired while still 'running'. Token semantics:
--       * An ACTIVE lease (claim_expires_at in the future) is left untouched.
--       * An expired claim with provider_started_at NULL never touched the
--         provider -> atomically return the job to 'pending', invalidating the old
--         token/owner/lease and bumping nothing (the next claim_jobs mints a fresh
--         token + incremented generation). Re-running the same worker's stale write
--         after this is impossible because its OLD token/gen no longer match.
--       * An expired claim with provider_started_at NOT NULL may have hit the
--         provider -> durable 'ambiguous', never silently requeued. A human/operator
--         reconcile is required; the job is NOT re-runnable by claim_jobs (which
--         only selects status='pending').
--     Fully-qualified, service_role-only, closed search_path. Reachable from the
--     worker maintenance path (see worker lifecycle reconcile_) exactly as the
--     membership runs periodically.
CREATE OR REPLACE FUNCTION public.reconcile_expired_job_claims(
  p_max_claims integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_requeued integer := 0;
  v_ambiguous integer := 0;
  v_now timestamptz := now();
BEGIN
  WITH requeueable AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.status = 'running'
      AND j.claim_state IN ('preparing', 'ready')
      AND (j.claim_expires_at IS NULL OR j.claim_expires_at < v_now)
      AND j.provider_started_at IS NULL
    LIMIT GREATEST(1, COALESCE(p_max_claims, 100))
    FOR UPDATE SKIP LOCKED
  ), do_requeue AS (
    UPDATE public.jobs j
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_token = NULL,
      claim_generation = COALESCE(j.claim_generation, 0),
      claim_state = 'idle',
      claim_started_at = NULL,
      claim_expires_at = NULL,
      provider_started_at = NULL
    FROM requeue r
    WHERE j.id = r.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_requeued FROM do_requeue;

  SELECT count(*) INTO v_ambiguous
  FROM public.jobs j
  WHERE j.status = 'running'
    AND j.claim_state = 'posting'
    AND (j.claim_expires_at IS NULL OR j.claim_expires_at < v_now)
    AND j.provider_started_at IS NOT NULL;

  RETURN jsonb_build_object(
    'requeued', v_requeued,
    'ambiguous', v_ambiguous,
    'reconciled_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_expired_job_claims(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_job_claims(integer) TO service_role;

-- =============================================================================
-- 5. X_deliveries: generation/claim_state/provider_started boundary mirroring the
--    accepted Telegram delivery-claims semantics. CREATE OR REPLACE keeps the prior
--    migration file untouched while this forward migration owns the new signatures.
-- =============================================================================
ALTER TABLE public.x_deliveries
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS provider_started_at timestamptz;

ALTER TABLE public.x_deliveries
  DROP CONSTRAINT IF EXISTS x_deliveries_claim_state_check;

ALTER TABLE public.x_deliveries
  ADD CONSTRAINT x_deliveries_claim_state_check
  CHECK (claim_state IN ('idle', 'preparing', 'ready', 'posting', 'posted', 'failed', 'ambiguous', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_x_deliveries_claim_generation
  ON public.x_deliveries(claim_generation)
  WHERE claim_state IN ('preparing', 'posting');

-- 5a. claim_x_post_delivery: same signature, now mints a monotonic generation and a
--     provider-start boundary gate. The seed row claims with claim_generation=1 and
--     claim_state='preparing'; provider boundary transfers to 'posting' afterwards.
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
  v_delivery_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_existing record;
BEGIN
  IF v_post_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_post_id');
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_generation, claim_state,
         claim_expires_at, provider_started_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status = 'posted'
  ORDER BY COALESCE(posted_at, created_at) DESC, created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'already_posted',
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_generation', v_existing.claim_generation
    );
  END IF;

  -- SF4: authoritative prior failed/skipped receipt gate. A delivery that failed
  -- or was skipped by this (or a prior) pipeline must NOT be re-claimed into a
  -- fresh posting unless the caller explicitly passes force_retry=true. This
  -- restores the server-side force-retry guarantee the pre-B2B claim carried at
  -- 20260617224908 (a dead p_force_retry must not silently create a duplicate
  -- post). Enforcement uses the authoritative receipt state (status in failed /
  -- skipped) rather than the TS layer, so ANY non-x-poster caller is protected.
  SELECT id, status, x_tweet_id, claim_token, claim_generation, claim_state,
         claim_expires_at, provider_started_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status IN ('failed', 'skipped')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND AND NOT COALESCE(p_force_retry, false) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'previous_x_' || v_existing.status,
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_generation', v_existing.claim_generation
    );
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at,
         claim_generation, provider_started_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status = 'posting'
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    -- A provider that already started is never reclaimable; it is ambiguous.
    IF v_existing.provider_started_at IS NOT NULL
      AND (v_existing.claim_expires_at IS NULL OR v_existing.claim_expires_at > now()) THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'ambiguous',
        'delivery_id', v_existing.id,
        'existing_status', v_existing.status,
        'existing_x_tweet_id', v_existing.x_tweet_id,
        'claim_generation', v_existing.claim_generation,
        'claim_expires_at', v_existing.claim_expires_at
      );
    END IF;
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', CASE WHEN v_existing.claim_expires_at IS NOT NULL
        AND (v_existing.claim_expires_at < now())
        THEN 'stale_posting' ELSE 'already_posting' END,
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_generation', v_existing.claim_generation,
      'claim_expires_at', v_existing.claim_expires_at
    );
  END IF;

  INSERT INTO public.x_deliveries (
    post_id,
    status,
    attempts,
    claim_token,
    claim_generation,
    claim_state,
    claim_source,
    claim_started_at,
    claim_expires_at,
    created_at,
    updated_at
  )
  VALUES (
    v_post_id,
    'posting',
    0,
    v_claim_token,
    1,
    'preparing',
    v_source,
    now(),
    now() + make_interval(secs => v_ttl),
    now(),
    now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_delivery_id;

  IF v_delivery_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'reason', 'claimed',
      'delivery_id', v_delivery_id,
      'claim_token', v_claim_token,
      'claim_generation', 1,
      'claim_expires_at', now() + make_interval(secs => v_ttl)
    );
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_generation,
         claim_expires_at, provider_started_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status IN ('posting', 'posted')
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'claimed', false,
    'reason', CASE
      WHEN v_existing.status = 'posted' THEN 'already_posted'
      WHEN v_existing.provider_started_at IS NOT NULL THEN 'ambiguous'
      WHEN v_existing.status = 'posting' THEN 'already_posting'
      ELSE 'claim_conflict'
    END,
    'delivery_id', v_existing.id,
    'existing_status', v_existing.status,
    'existing_x_tweet_id', v_existing.x_tweet_id,
    'claim_generation', v_existing.claim_generation,
    'claim_expires_at', v_existing.claim_expires_at
  );
END;
$$;

-- 5aa. Drop the pre-generation 10-argument overloads of complete/fail_x_post_delivery
--      (SF3). CREATE OR REPLACE with a different argument list does NOT replace a
--      prior overload in PostgreSQL; it silently adds a second overload and leaves
--	  the fenceless original EXECUTE-granted to service_role. Drop both old
--      signatures explicitly so no completion / retirement path can bypass the
--      claim_generation fence. See 20260617224908 (the prior owning migration) for
--      the old 10-arg signatures being removed here.
DROP FUNCTION IF EXISTS public.complete_x_post_delivery(uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.fail_x_post_delivery(uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text);

-- 5b. mark_x_delivery_provider_started: the durable boundary that MUST succeed before
--     any irreversible X call. Mirrors start_telegram_delivery.
CREATE OR REPLACE FUNCTION public.mark_x_delivery_provider_started(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.x_deliveries
  SET
    claim_state = 'posting',
    provider_started_at = now(),
    claim_expires_at = now() + interval '5 minutes'
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'posting'
    AND claim_state = 'preparing'
    AND (claim_expires_at IS NULL OR claim_expires_at > now());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 5c. complete_x_post_delivery: add the generation fence; a stale token OR stale
--     generation can no longer complete the delivery.
CREATE OR REPLACE FUNCTION public.complete_x_post_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_x_tweet_id text,
  p_media_count integer DEFAULT 0,
  p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL,
  p_posted_at timestamptz DEFAULT now(),
  p_latency_ms integer DEFAULT NULL,
  p_api_response jsonb DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
  v_x_tweet_id text := NULLIF(btrim(COALESCE(p_x_tweet_id, '')), '');
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR v_x_tweet_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.x_deliveries
  SET
    status = 'posted',
    claim_state = 'posted',
    x_tweet_id = v_x_tweet_id,
    media_count = GREATEST(COALESCE(p_media_count, 0), 0),
    media_bytes = GREATEST(COALESCE(p_media_bytes, 0), 0),
    media_kind = p_media_kind,
    posted_at = COALESCE(p_posted_at, now()),
    latency_ms = p_latency_ms,
    api_response = p_api_response,
    last_error = p_last_error,
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1),
    claim_expires_at = NULL,
    claim_released_at = now(),
    claim_release_reason = 'completed',
    last_claim_error = NULL,
    updated_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'posting'
    AND claim_state IN ('preparing', 'posting');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 5d. fail_x_post_delivery: add the generation fence; a provider-started-but-DB-failed
--     worker fails into claim_state='ambiguous'; a stale token/gen cannot mark at all.
CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_status text DEFAULT 'failed',
  p_error text DEFAULT NULL,
  p_api_response jsonb DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL,
  p_skip_reason text DEFAULT NULL,
  p_media_count integer DEFAULT 0,
  p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
  v_status text := CASE WHEN p_status IN ('failed', 'skipped') THEN p_status ELSE 'failed' END;
  v_error text := left(COALESCE(p_error, 'x_post_delivery_failed'), 1000);
  v_ambiguous boolean;
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL THEN
    RETURN false;
  END IF;

  -- A provider-started claim that failed after the provider may accept is ambiguous
  -- unless explicitly skipped by an operator.
  v_ambiguous := p_status IN ('failed') AND p_skip_reason IS NULL;

  UPDATE public.x_deliveries
  SET
    status = CASE WHEN v_ambiguous THEN 'failed' ELSE v_status END,
    claim_state = CASE WHEN v_ambiguous THEN 'ambiguous' ELSE v_status END,
    last_error = v_error,
    last_claim_error = v_error,
    api_response = p_api_response,
    next_retry_at = CASE WHEN v_ambiguous THEN NULL ELSE p_next_retry_at END,
    skip_reason = p_skip_reason,
    media_count = GREATEST(COALESCE(p_media_count, 0), 0),
    media_bytes = GREATEST(COALESCE(p_media_bytes, 0), 0),
    media_kind = p_media_kind,
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1),
    claim_expires_at = CASE WHEN v_ambiguous THEN NULL ELSE NULL END,
    claim_released_at = now(),
    claim_release_reason = 'retired',
    updated_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'posting'
    AND claim_state IN ('preparing', 'posting');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 5e. Grant/revoke cleanup for the X function surface (new signatures).
REVOKE ALL ON FUNCTION public.complete_x_post_delivery(uuid,uuid,bigint,text,integer,bigint,text,timestamptz,integer,jsonb,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(uuid,uuid,bigint,text,integer,bigint,text,timestamptz,integer,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text) TO service_role;

-- The claim/provider-start functions keep their full-signature REVOKEs/GRANTs.
REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_x_delivery_provider_started(uuid,uuid,bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_x_delivery_provider_started(uuid,uuid,bigint) TO service_role;
