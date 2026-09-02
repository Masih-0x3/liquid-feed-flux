-- B3b1 (AIR-003): durable RSS webhook receipt/inbox.
--
-- Additive forward migration, ordinal #115 (no historical/protected/archive migration
-- is edited). Establishes a deterministic-material-identity receipt table with a
-- minted claim token + monotonic generation + lease, fenced checked terminal writes,
-- an active-claim block, an expired/incomplete safe reclaim, and a reconcile path.
--
-- Material receipt identity (INV-1): the receipt_key is derived ONLY from the
-- normalized feed/source identity concatenated with the canonical sorted stable-item
-- and normalized materialization-content fingerprints (computed in the edge source).
-- The key MUST NOT include timestamp, random, or auth_mode material; auth_mode is
-- stored as metadata on the row, never as dedup key material. token vs signed delivery
-- of the same normalized feed + canonical item set resolve to the SAME receipt_key, so
-- repeat identical POSTs are idempotent (reserved=true, reason=already_completed).
--
-- Claim-state vocabulary (single-sourced; mirrored into webhooks-rssapp/index.ts):
--   received   // idle         (row created, not yet materialized)
--   materializing // received  (lease claimed, materialization started)
--   completed  // posted       (all fenced terminal writes durable)
--   failed     // failed       (aborted before irreversible materialization)
--   failed     // ambiguous    (materialization began; provider ack / DB unknown)
--
-- Active/expired claim semantics: an ACTIVE lease (claim_expires_at in the future) is
-- blocked from re-claim. An expired incomplete claim is safe to reclaim ONLY when it
-- never started materialization (provider_started_at NULL); once provider_started_at
-- is set it can never be silently re-claimed (it is ambiguous / reconciliation
-- required), matching G5 fail-closed behavior.
--
-- Adversarial seals (enforced fail-closed by check-rss-webhook-receipt-contract.mjs):
--   * closed SET search_path on every SECURITY DEFINER function
--   * fully-qualified public.* table/function references
--   * REVOKE from public/anon/authenticated + GRANT EXECUTE to service_role only
--   * RLS enabled on the table; anon/authenticated hold no read/write capability
--   * PRIMARY KEY (receipt_key) + NOT NULL guard columns + status/claim_state checks
--   * claim-token + claim-generation fences on every checked terminal transition

-- =============================================================================
-- 1. Durable receipt table.
-- =============================================================================
CREATE TABLE public.webhook_receipts (
  receipt_key text PRIMARY KEY,
  auth_mode text NOT NULL,
  feed_id text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  claim_token uuid,
  claim_generation bigint NOT NULL DEFAULT 0,
  claim_state text NOT NULL DEFAULT 'idle',
  provider_started_at timestamptz,
  claim_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  item_outcomes jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.webhook_receipts
  DROP CONSTRAINT IF EXISTS webhook_receipts_status_check;

ALTER TABLE public.webhook_receipts
  ADD CONSTRAINT webhook_receipts_status_check
  CHECK (status IN ('received', 'materializing', 'completed', 'failed', 'ambiguous'));

ALTER TABLE public.webhook_receipts
  DROP CONSTRAINT IF EXISTS webhook_receipts_claim_state_check;

ALTER TABLE public.webhook_receipts
  ADD CONSTRAINT webhook_receipts_claim_state_check
  CHECK (claim_state IN ('idle', 'received', 'posted', 'failed', 'ambiguous'));

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_claim_expires_at
  ON public.webhook_receipts(claim_expires_at)
  WHERE claim_state IN ('received');

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_feed_auth
  ON public.webhook_receipts(feed_id, auth_mode);

-- RLS on the durable inbox. service_role bypasses RLS by default; anon and
-- authenticated get NO policy, so neither can read or write receipts.
ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.webhook_receipts FROM public, anon, authenticated;

-- =============================================================================
-- 2. reserve_webhook_receipt: idempotently create and claim a receipt.
--    - Creates the row (recording the material identity) then atomically claims it
--      with a fresh random token + incremented generation.
--    - identical replay of a completed receipt -> reserved=true, already_completed.
--    - active lease        -> reserved=false, active (blocked, never re-minted).
--    - provider_started_at set -> reserved=false, ambiguous_active (G5).
--    - expired + never-provider-started -> atomically reclaimed with a fresh fence.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reserve_webhook_receipt(
  p_receipt_key text,
  p_auth_mode text DEFAULT 'token',
  p_feed_id text DEFAULT 'unknown',
  p_ttl_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_receipt_key, '')), '');
  v_feed text := left(COALESCE(NULLIF(btrim(p_feed_id), ''), 'unknown'), 512);
  v_auth text := CASE WHEN p_auth_mode IN ('token', 'signed') THEN p_auth_mode ELSE 'token' END;
  v_ttl integer := GREATEST(30, LEAST(COALESCE(p_ttl_seconds, 300), 7200));
  v_new_token uuid := gen_random_uuid();
  v_status text;
  v_claim_state text;
  v_token uuid;
  v_generation bigint;
  v_provider timestamptz;
  v_expires timestamptz;
  v_claimed_row integer := 0;
BEGIN
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_key');
  END IF;

  -- Ensure a receipt row exists (records the material identity) before any claim.
  INSERT INTO public.webhook_receipts (
    receipt_key, auth_mode, feed_id, status, claim_token,
    claim_generation, claim_state, updated_at, item_outcomes
  )
  VALUES (v_key, v_auth, v_feed, 'received', NULL, 0, 'idle', now(), '{}')
  ON CONFLICT (receipt_key) DO NOTHING;

  -- Read the authoritative current row state.
  SELECT status, claim_state, claim_token, claim_generation,
         provider_started_at, claim_expires_at
  INTO v_status, v_claim_state, v_token, v_generation, v_provider, v_expires
  FROM public.webhook_receipts
  WHERE receipt_key = v_key;

  -- Idempotent replay of a completed receipt: re-acknowledge, never duplicate.
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'already_completed',
      'claim_token', v_token, 'claim_generation', v_generation);
  END IF;

  -- An active lease is authoritative and must NOT be re-claimed.
  IF (v_expires IS NULL OR v_expires > now()) AND v_claim_state = 'received' THEN
    IF v_provider IS NOT NULL THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'ambiguous_active',
        'claim_token', v_token, 'claim_generation', v_generation);
    END IF;
    RETURN jsonb_build_object('reserved', false, 'reason', 'active',
      'claim_token', v_token, 'claim_generation', v_generation);
  END IF;

  -- A provider-acknowledged receipt (provider_started_at set) is NEVER reclaimed.
  IF v_provider IS NOT NULL THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'provider_started',
      'claim_token', v_token, 'claim_generation', v_generation);
  END IF;

  -- Expired / inactive / never-provider-started: atomically claim with a fresh
  -- token + an incremented generation. A stale token/gen can no longer match.
  UPDATE public.webhook_receipts
  SET status = 'materializing',
      claim_token = v_new_token,
      claim_generation = claim_generation + 1,
      claim_state = 'received',
      started_at = coalesce(started_at, now()),
      claim_expires_at = now() + make_interval(secs => v_ttl),
      updated_at = now()
  WHERE receipt_key = v_key
    AND status <> 'completed'
    AND provider_started_at IS NULL
    AND (claim_expires_at IS NULL OR claim_expires_at < now());

  GET DIAGNOSTICS v_claimed_row = ROW_COUNT;
  IF v_claimed_row = 1 THEN
    RETURN jsonb_build_object('reserved', true, 'reason', 'claimed',
      'claim_token', v_new_token, 'claim_generation', v_generation + 1,
      'claim_expires_at', now() + make_interval(secs => v_ttl));
  END IF;

  RETURN jsonb_build_object('reserved', false, 'reason', 'claim_conflict',
    'claim_token', v_token, 'claim_generation', v_generation);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_webhook_receipt(text,text,text,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_webhook_receipt(text,text,text,integer) TO service_role;

-- =============================================================================
-- 3. complete_webhook_receipt: fenced terminal 'completed'. Requires the exact
--    claim token + generation the caller minted; a stale token or stale generation
--    (after a reclaim/replay) yields a zero-row false rejection.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.complete_webhook_receipt(
  p_receipt_key text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_item_outcomes jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_receipt_key, '')), '');
  v_updated integer := 0;
BEGIN
  IF v_key IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.webhook_receipts
  SET status = 'completed',
      claim_state = 'posted',
      completed_at = coalesce(completed_at, now()),
      updated_at = now(),
      claim_expires_at = NULL,
      last_error = NULL,
      item_outcomes = COALESCE(p_item_outcomes, item_outcomes)
  WHERE receipt_key = v_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status IN ('received', 'materializing')
    AND claim_state IN ('idle', 'received');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_webhook_receipt(text,uuid,bigint,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_webhook_receipt(text,uuid,bigint,jsonb) TO service_role;

-- =============================================================================
-- 4. fail_webhook_receipt: fenced terminal 'failed'. A provider-acknowledged
--    receipt (provider_started_at set) that failed is intercepted as 'ambiguous',
--    never a silent plain 'failed' that a future claim could treat as completable,
--    matching G5 fail-closed behavior over ambiguous outcomes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fail_webhook_receipt(
  p_receipt_key text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_receipt_key, '')), '');
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'webhook_receipt_failed'), 1000);
  v_updated integer := 0;
  v_provider timestamptz;
BEGIN
  IF v_key IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;

  SELECT provider_started_at INTO v_provider
  FROM public.webhook_receipts
  WHERE receipt_key = v_key;

  UPDATE public.webhook_receipts
  SET status = CASE WHEN v_provider IS NOT NULL THEN 'ambiguous' ELSE 'failed' END,
      claim_state = CASE WHEN v_provider IS NOT NULL THEN 'ambiguous' ELSE 'failed' END,
      updated_at = now(),
      last_error = v_reason,
      claim_expires_at = NULL
  WHERE receipt_key = v_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status <> 'completed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_webhook_receipt(text,uuid,bigint,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_webhook_receipt(text,uuid,bigint,text) TO service_role;

-- =============================================================================
-- 5. reconcile_expired_webhook_receipts: maintenance reclaim + ambiguity detection.
--    - An expired claim that never reached the provider is atomically returned to
--      'received'/'idle', invalidating the stale token/gen (a stale token write can
--      no longer match), so the next reserve mints a fresh fence.
--    - An expired claim whose provider_started_at IS NOT NULL may have partially
--      materialized -> durable 'ambiguous', never silently re-queued.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reconcile_expired_webhook_receipts(
  p_max_receipts integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_reclaimed integer := 0;
  v_ambiguous integer := 0;
  v_now timestamptz := now();
BEGIN
  WITH reclaimable AS (
    SELECT r.receipt_key
    FROM public.webhook_receipts r
    WHERE r.status IN ('received', 'materializing')
      AND (r.claim_expires_at IS NULL OR r.claim_expires_at < v_now)
      AND r.provider_started_at IS NULL
    LIMIT GREATEST(1, COALESCE(p_max_receipts, 100))
    FOR UPDATE SKIP LOCKED
  ), do_reclaim AS (
    UPDATE public.webhook_receipts r
    SET status = 'received',
        claim_state = 'idle',
        claim_token = NULL,
        claim_generation = COALESCE(r.claim_generation, 0),
        provider_started_at = NULL,
        claim_expires_at = NULL,
        started_at = NULL,
        updated_at = v_now
    FROM reclaimable a
    WHERE r.receipt_key = a.receipt_key
    RETURNING r.receipt_key
  )
  SELECT count(*) INTO v_reclaimed FROM do_reclaim;

  SELECT count(*) INTO v_ambiguous
  FROM public.webhook_receipts r
  WHERE r.status = 'materializing'
    AND r.provider_started_at IS NOT NULL
    AND (r.claim_expires_at IS NULL OR r.claim_expires_at < v_now);

  RETURN jsonb_build_object(
    'reclaimed', v_reclaimed,
    'ambiguous', v_ambiguous,
    'reconciled_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_expired_webhook_receipts(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_webhook_receipts(integer) TO service_role;
