-- Telegram delivery idempotency: claim a durable delivery row before the
-- first provider call and preserve post-call ambiguity for reconciliation.
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS delivery_key text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS claim_source text,
  ADD COLUMN IF NOT EXISTS claim_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_ids text[],
  ADD COLUMN IF NOT EXISTS claim_last_error text;

ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_claim_state_check;

ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_claim_state_check
  CHECK (claim_state IN ('idle', 'preparing', 'posting', 'posted', 'failed', 'ambiguous', 'skipped'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_telegram_delivery_key
  ON public.deliveries(delivery_key)
  WHERE delivery_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deliveries_telegram_active_claims
  ON public.deliveries(claim_expires_at)
  WHERE claim_state IN ('preparing', 'posting');

CREATE OR REPLACE FUNCTION public.claim_telegram_delivery(
  p_delivery_key text,
  p_subject_id text,
  p_chat_id text,
  p_source text DEFAULT 'unknown',
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_key text := left(NULLIF(btrim(COALESCE(p_delivery_key, '')), ''), 512);
  v_subject_id text := left(NULLIF(btrim(COALESCE(p_subject_id, '')), ''), 256);
  v_chat_id text := left(NULLIF(btrim(COALESCE(p_chat_id, '')), ''), 128);
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'unknown'), 120);
  v_ttl integer := GREATEST(60, LEAST(COALESCE(p_claim_ttl_seconds, 1800), 7200));
  v_claim_token uuid := gen_random_uuid();
  v_existing public.deliveries%ROWTYPE;
  v_delivery_id uuid;
  v_generation bigint;
BEGIN
  IF v_key IS NULL OR v_subject_id IS NULL OR v_chat_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_delivery_key');
  END IF;

  -- Reconcile legacy rows that predate delivery_key before admitting a new
  -- claim. This keeps the additive rollout from duplicating an already-posted
  -- receipt while old workers drain.
  SELECT *
  INTO v_existing
  FROM public.deliveries
  WHERE subject_type = 'post'
    AND subject_id = v_subject_id
    AND telegram_chat_id = v_chat_id
    AND status = 'posted'
  ORDER BY COALESCE(posted_at, created_at) DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'already_posted',
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'claim_generation', v_existing.claim_generation
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.deliveries
  WHERE delivery_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT *
    INTO v_existing
    FROM public.deliveries
    WHERE subject_type = 'post'
      AND subject_id = v_subject_id
      AND telegram_chat_id = v_chat_id
      AND delivery_key IS NULL
      AND status IN ('pending', 'failed')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      UPDATE public.deliveries
      SET delivery_key = v_key
      WHERE id = v_existing.id;
    END IF;
  END IF;

  IF FOUND THEN
    IF v_existing.status = 'posted' OR v_existing.claim_state = 'posted' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'already_posted',
        'delivery_id', v_existing.id,
        'existing_status', v_existing.status,
        'claim_generation', v_existing.claim_generation
      );
    END IF;
    IF v_existing.claim_state = 'ambiguous' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'ambiguous',
        'delivery_id', v_existing.id,
        'existing_status', v_existing.status,
        'claim_generation', v_existing.claim_generation,
        'claim_expires_at', v_existing.claim_expires_at
      );
    END IF;
    IF v_existing.claim_state IN ('preparing', 'posting')
      AND v_existing.claim_expires_at IS NOT NULL
      AND v_existing.claim_expires_at > now() THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'already_claimed',
        'delivery_id', v_existing.id,
        'existing_status', v_existing.status,
        'claim_generation', v_existing.claim_generation,
        'claim_expires_at', v_existing.claim_expires_at
      );
    END IF;
    IF v_existing.provider_started_at IS NOT NULL
      AND v_existing.claim_state IN ('preparing', 'posting') THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'ambiguous',
        'delivery_id', v_existing.id,
        'existing_status', v_existing.status,
        'claim_generation', v_existing.claim_generation,
        'claim_expires_at', v_existing.claim_expires_at
      );
    END IF;

    v_generation := GREATEST(COALESCE(v_existing.claim_generation, 0) + 1, 1);
    UPDATE public.deliveries
    SET
      subject_type = 'post',
      subject_id = v_subject_id,
      telegram_chat_id = v_chat_id,
      status = 'pending',
      claim_token = v_claim_token,
      claim_generation = v_generation,
      claim_state = 'preparing',
      claim_source = v_source,
      claim_started_at = now(),
      claim_expires_at = now() + make_interval(secs => v_ttl),
      provider_started_at = NULL,
      provider_message_ids = NULL,
      claim_last_error = NULL,
      last_error = NULL,
      attempts = COALESCE(attempts, 0)
    WHERE id = v_existing.id;

    RETURN jsonb_build_object(
      'claimed', true,
      'reason', 'claimed',
      'delivery_id', v_existing.id,
      'claim_token', v_claim_token,
      'claim_generation', v_generation,
      'claim_expires_at', now() + make_interval(secs => v_ttl)
    );
  END IF;

  INSERT INTO public.deliveries (
    subject_type,
    subject_id,
    telegram_chat_id,
    delivery_key,
    status,
    attempts,
    claim_token,
    claim_generation,
    claim_state,
    claim_source,
    claim_started_at,
    claim_expires_at
  )
  VALUES (
    'post',
    v_subject_id,
    v_chat_id,
    v_key,
    'pending',
    0,
    v_claim_token,
    1,
    'preparing',
    v_source,
    now(),
    now() + make_interval(secs => v_ttl)
  )
  ON CONFLICT DO NOTHING
  RETURNING id, claim_generation INTO v_delivery_id, v_generation;

  IF v_delivery_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'reason', 'claimed',
      'delivery_id', v_delivery_id,
      'claim_token', v_claim_token,
      'claim_generation', v_generation,
      'claim_expires_at', now() + make_interval(secs => v_ttl)
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.deliveries
  WHERE delivery_key = v_key;
  IF v_existing.claim_state = 'ambiguous' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'ambiguous',
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'claim_generation', v_existing.claim_generation,
      'claim_expires_at', v_existing.claim_expires_at
    );
  END IF;
  RETURN jsonb_build_object(
    'claimed', false,
    'reason', CASE WHEN v_existing.status = 'posted' THEN 'already_posted' ELSE 'already_claimed' END,
    'delivery_id', v_existing.id,
    'existing_status', v_existing.status,
    'claim_generation', v_existing.claim_generation,
    'claim_expires_at', v_existing.claim_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_telegram_delivery(
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
  UPDATE public.deliveries
  SET
    claim_state = 'posting',
    provider_started_at = now(),
    last_attempt_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'pending'
    AND claim_state = 'preparing'
    AND (claim_expires_at IS NULL OR claim_expires_at > now());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_telegram_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_message_ids text[] DEFAULT '{}'::text[]
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
  UPDATE public.deliveries
  SET
    status = 'posted',
    claim_state = 'posted',
    telegram_message_ids = COALESCE(p_message_ids, '{}'::text[]),
    provider_message_ids = COALESCE(p_message_ids, '{}'::text[]),
    posted_at = now(),
    last_attempt_at = now(),
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1),
    claim_expires_at = NULL,
    claim_last_error = NULL,
    last_error = NULL
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'pending'
    AND claim_state = 'posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_telegram_delivery_ambiguous(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_message_ids text[] DEFAULT '{}'::text[],
  p_error text DEFAULT 'telegram_delivery_provider_outcome_unknown'
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
  v_error text := left(COALESCE(NULLIF(btrim(p_error), ''), 'telegram_delivery_provider_outcome_unknown'), 256);
BEGIN
  UPDATE public.deliveries
  SET
    status = 'failed',
    claim_state = 'ambiguous',
    telegram_message_ids = COALESCE(p_message_ids, '{}'::text[]),
    provider_message_ids = COALESCE(p_message_ids, '{}'::text[]),
    claim_expires_at = NULL,
    claim_last_error = v_error,
    last_error = v_error,
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1)
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND claim_state = 'posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery(text, text, text, text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_telegram_delivery(uuid, uuid, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_delivery(uuid, uuid, bigint, text[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_telegram_delivery_ambiguous(uuid, uuid, bigint, text[], text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_telegram_delivery(uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_telegram_delivery(uuid, uuid, bigint, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_telegram_delivery_ambiguous(uuid, uuid, bigint, text[], text) TO service_role;
