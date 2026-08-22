-- B3b2 (AIR-066): deterministic digest compilation checkpoints.
--
-- A digest compiler invocation owns one deterministic run_key and one immutable
-- input_fingerprint. The run is fenced before the OpenAI call, persists one
-- canonical output, and records that delivery is deliberately disabled. The
-- compiler no longer calls X directly; ordered thread delivery remains separately
-- gated by BR-THREAD-01 / AIR-010.

ALTER TABLE public.digests
  ADD COLUMN IF NOT EXISTS run_key text,
  ADD COLUMN IF NOT EXISTS output_key text,
  ADD COLUMN IF NOT EXISTS formatted_tweets jsonb;

CREATE UNIQUE INDEX digests_run_key_unique
  ON public.digests(run_key)
  WHERE run_key IS NOT NULL;

CREATE UNIQUE INDEX digests_output_key_unique
  ON public.digests(output_key)
  WHERE output_key IS NOT NULL;

CREATE TABLE public.digest_runs (
  run_key text PRIMARY KEY,
  input_fingerprint text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  post_ids text[] NOT NULL DEFAULT '{}'::text[],
  state text NOT NULL DEFAULT 'reserved',
  claim_token uuid,
  claim_generation bigint NOT NULL DEFAULT 0,
  claim_expires_at timestamptz,
  provider_started_at timestamptz,
  output_persisted_at timestamptz,
  output_digest_id uuid REFERENCES public.digests(id),
  output_key text,
  delivery_key text NOT NULL UNIQUE,
  delivery_state text NOT NULL DEFAULT 'disabled',
  delivery_checkpoint_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digest_runs_input_fingerprint_check
    CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT digest_runs_output_key_check
    CHECK (output_key IS NULL OR output_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT digest_runs_state_check
    CHECK (state IN ('reserved', 'provider_started', 'output_ready', 'completed', 'failed', 'ambiguous')),
  CONSTRAINT digest_runs_delivery_state_check
    CHECK (delivery_state IN ('disabled', 'pending', 'enqueued')),
  CONSTRAINT digest_runs_period_check
    CHECK (period_end > period_start)
);

ALTER TABLE public.digest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digest_runs FROM public, anon, authenticated;

CREATE INDEX digest_runs_active_lease_idx
  ON public.digest_runs(claim_expires_at)
  WHERE state IN ('reserved', 'provider_started');

CREATE INDEX digest_runs_state_updated_idx
  ON public.digest_runs(state, updated_at DESC);

CREATE OR REPLACE FUNCTION public.reserve_digest_run(
  p_run_key text,
  p_input_fingerprint text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_post_ids text[] DEFAULT '{}'::text[],
  p_delivery_key text DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_run_key text := NULLIF(btrim(COALESCE(p_run_key, '')), '');
  v_fingerprint text := lower(NULLIF(btrim(COALESCE(p_input_fingerprint, '')), ''));
  v_delivery_key text := NULLIF(btrim(COALESCE(p_delivery_key, '')), '');
  v_lease integer := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 1800));
  v_token uuid := gen_random_uuid();
  v_inserted boolean := false;
  v_row public.digest_runs%ROWTYPE;
BEGIN
  IF v_run_key IS NULL OR v_fingerprint !~ '^[a-f0-9]{64}$'
     OR p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_input');
  END IF;
  v_delivery_key := COALESCE(v_delivery_key, 'digest-delivery:' || v_run_key);

  INSERT INTO public.digest_runs (
    run_key, input_fingerprint, period_start, period_end, post_ids, state,
    claim_token, claim_generation, claim_expires_at, delivery_key, delivery_state
  ) VALUES (
    v_run_key, v_fingerprint, p_period_start, p_period_end, COALESCE(p_post_ids, '{}'),
    'reserved', v_token, 1, now() + make_interval(secs => v_lease),
    v_delivery_key, 'disabled'
  )
  ON CONFLICT (run_key) DO NOTHING
  RETURNING true INTO v_inserted;

  SELECT * INTO v_row
  FROM public.digest_runs
  WHERE run_key = v_run_key
  FOR UPDATE;

  IF v_inserted THEN
    RETURN jsonb_build_object(
      'reserved', true,
      'reason', 'claimed',
      'claim_token', v_row.claim_token,
      'claim_generation', v_row.claim_generation
    );
  END IF;

  IF v_row.input_fingerprint <> v_fingerprint THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'input_conflict');
  END IF;
  IF v_row.state = 'completed' THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'reason', 'already_completed',
      'digest_id', v_row.output_digest_id,
      'output_key', v_row.output_key
    );
  END IF;
  IF v_row.state = 'output_ready' THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'reason', 'output_ready',
      'digest_id', v_row.output_digest_id,
      'output_key', v_row.output_key
    );
  END IF;
  IF v_row.state = 'ambiguous' THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'ambiguous');
  END IF;
  IF v_row.claim_expires_at IS NOT NULL AND v_row.claim_expires_at > now() THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'active');
  END IF;

  -- Once a provider call may have started, expiration is ambiguous. It is never
  -- silently reclaimed because the provider may have consumed tokens or returned
  -- an output that the caller failed to persist.
  IF v_row.provider_started_at IS NOT NULL THEN
    UPDATE public.digest_runs
    SET state = 'ambiguous',
        claim_expires_at = NULL,
        last_error = 'digest_provider_outcome_unknown',
        updated_at = now()
    WHERE run_key = v_run_key;
    RETURN jsonb_build_object('reserved', false, 'reason', 'ambiguous');
  END IF;

  UPDATE public.digest_runs
  SET state = 'reserved',
      claim_token = v_token,
      claim_generation = claim_generation + 1,
      claim_expires_at = now() + make_interval(secs => v_lease),
      last_error = NULL,
      updated_at = now()
  WHERE run_key = v_run_key
    AND provider_started_at IS NULL;

  RETURN jsonb_build_object(
    'reserved', true,
    'reason', 'reclaimed',
    'claim_token', v_token,
    'claim_generation', v_row.claim_generation + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_digest_run(text,text,timestamptz,timestamptz,text[],text,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_digest_run(text,text,timestamptz,timestamptz,text[],text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_digest_provider_started(
  p_run_key text,
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
  IF p_run_key IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.digest_runs
  SET state = 'provider_started',
      provider_started_at = now(),
      updated_at = now()
  WHERE run_key = p_run_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND state = 'reserved'
    AND claim_expires_at > now()
    AND provider_started_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_digest_provider_started(text,uuid,bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_digest_provider_started(text,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.persist_digest_output(
  p_run_key text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_output_key text,
  p_summary_text text,
  p_formatted_tweets jsonb,
  p_status text DEFAULT 'compiled'
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_run public.digest_runs%ROWTYPE;
  v_digest_id uuid;
  v_existing_output_key text;
  v_output_key text := lower(NULLIF(btrim(COALESCE(p_output_key, '')), ''));
BEGIN
  IF p_run_key IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL
     OR v_output_key !~ '^[a-f0-9]{64}$' OR NULLIF(btrim(COALESCE(p_summary_text, '')), '') IS NULL
     OR jsonb_typeof(p_formatted_tweets) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_formatted_tweets) item WHERE jsonb_typeof(item) <> 'string') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_run
  FROM public.digest_runs
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND OR v_run.claim_token <> p_claim_token
     OR v_run.claim_generation <> p_claim_generation
     OR v_run.state <> 'provider_started' OR v_run.provider_started_at IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.digests (
    period_start, period_end, post_ids, summary_text, twitter_tweet_ids,
    status, run_key, output_key, formatted_tweets
  ) VALUES (
    v_run.period_start, v_run.period_end, v_run.post_ids, p_summary_text, '{}',
    COALESCE(NULLIF(btrim(p_status), ''), 'compiled'), p_run_key, v_output_key, p_formatted_tweets
  )
  ON CONFLICT (run_key) WHERE run_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_digest_id;

  IF v_digest_id IS NULL THEN
    SELECT id, output_key INTO v_digest_id, v_existing_output_key
    FROM public.digests
    WHERE run_key = p_run_key;
    IF v_digest_id IS NULL OR v_existing_output_key <> v_output_key THEN
      UPDATE public.digest_runs
      SET state = 'ambiguous',
          claim_expires_at = NULL,
          last_error = 'digest_output_identity_conflict',
          updated_at = now()
      WHERE run_key = p_run_key;
      RETURN false;
    END IF;
  END IF;

  UPDATE public.digest_runs
  SET state = 'output_ready',
      output_digest_id = v_digest_id,
      output_key = v_output_key,
      output_persisted_at = COALESCE(output_persisted_at, now()),
      last_error = NULL,
      updated_at = now()
  WHERE run_key = p_run_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND state = 'provider_started';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_digest_output(text,uuid,bigint,text,text,jsonb,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_digest_output(text,uuid,bigint,text,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.persist_skipped_digest(
  p_run_key text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_output_key text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_run public.digest_runs%ROWTYPE;
  v_digest_id uuid;
  v_existing_output_key text;
  v_output_key text := lower(NULLIF(btrim(COALESCE(p_output_key, '')), ''));
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'digest_skipped'), 1000);
BEGIN
  IF p_run_key IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL
     OR v_output_key !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_run
  FROM public.digest_runs
  WHERE run_key = p_run_key
  FOR UPDATE;

  IF NOT FOUND OR v_run.claim_token <> p_claim_token
     OR v_run.claim_generation <> p_claim_generation
     OR v_run.state <> 'reserved' OR v_run.provider_started_at IS NOT NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.digests (
    period_start, period_end, post_ids, twitter_tweet_ids, status, error,
    run_key, output_key, formatted_tweets
  ) VALUES (
    v_run.period_start, v_run.period_end, v_run.post_ids, '{}', 'skipped', v_reason,
    p_run_key, v_output_key, '[]'::jsonb
  )
  ON CONFLICT (run_key) WHERE run_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_digest_id;

  IF v_digest_id IS NULL THEN
    SELECT id, output_key INTO v_digest_id, v_existing_output_key
    FROM public.digests
    WHERE run_key = p_run_key;
    IF v_digest_id IS NULL OR v_existing_output_key <> v_output_key THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.digest_runs
  SET state = 'completed',
      output_digest_id = v_digest_id,
      output_key = v_output_key,
      output_persisted_at = COALESCE(output_persisted_at, now()),
      delivery_state = 'disabled',
      delivery_checkpoint_at = COALESCE(delivery_checkpoint_at, now()),
      completed_at = COALESCE(completed_at, now()),
      claim_expires_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE run_key = p_run_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND state = 'reserved';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_skipped_digest(text,uuid,bigint,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_skipped_digest(text,uuid,bigint,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_digest_run(
  p_run_key text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_reason text DEFAULT 'digest_provider_outcome_unknown'
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
  UPDATE public.digest_runs
  SET state = CASE WHEN provider_started_at IS NOT NULL THEN 'ambiguous' ELSE 'failed' END,
      claim_expires_at = NULL,
      last_error = left(COALESCE(NULLIF(btrim(p_reason), ''), 'digest_failed'), 1000),
      updated_at = now()
  WHERE run_key = p_run_key
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND state IN ('reserved', 'provider_started');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_digest_run(text,uuid,bigint,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_digest_run(text,uuid,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.checkpoint_digest_delivery_disabled(
  p_run_key text,
  p_input_fingerprint text
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
  UPDATE public.digest_runs
  SET state = 'completed',
      delivery_state = 'disabled',
      delivery_checkpoint_at = COALESCE(delivery_checkpoint_at, now()),
      completed_at = COALESCE(completed_at, now()),
      claim_expires_at = NULL,
      updated_at = now()
  WHERE run_key = p_run_key
    AND input_fingerprint = lower(p_input_fingerprint)
    AND state IN ('output_ready', 'completed')
    AND output_digest_id IS NOT NULL
    AND output_key IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.checkpoint_digest_delivery_disabled(text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_digest_delivery_disabled(text,text) TO service_role;
