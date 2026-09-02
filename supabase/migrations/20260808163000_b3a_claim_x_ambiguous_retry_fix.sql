-- E6 additive B3A repair: preserve failed/skipped receipts that durably reached
-- claim_state='ambiguous' even when a caller requests force_retry.
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
  IF FOUND AND (v_existing.claim_state = 'ambiguous' OR NOT COALESCE(p_force_retry, false)) THEN
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

REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;
