-- Repair the final X delivery claim contract after the V1 cutover.
--
-- The V1 cutover re-created the legacy claim shape after B3 had added the
-- durable claim token/generation envelope. Restore that envelope while
-- retaining the immutable delivery cutoff and the no-replay historical-row
-- guard at the claim boundary.
BEGIN;

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
  v_has_ambiguous_history boolean;
BEGIN
  IF v_post_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_post_id');
  END IF;

  -- Apply the immutable post cutoff before inspecting or creating a claim.
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_cutover_blocked');
  END IF;

  -- A pre-cutover receipt remains historical even when its linked post was
  -- ingested after T. Never create a second X delivery row for that lineage.
  IF EXISTS (
    SELECT 1
    FROM public.x_deliveries xd
    WHERE xd.post_id = v_post_id
      AND (public.get_delivery_cutover() IS NULL OR xd.created_at <= public.get_delivery_cutover())
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'historical_x_delivery');
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

  SELECT EXISTS (
    SELECT 1
    FROM public.x_deliveries h
    WHERE h.post_id = v_post_id
      AND h.status <> 'posted'
      AND (h.claim_state = 'ambiguous' OR h.provider_started_at IS NOT NULL)
  ) INTO v_has_ambiguous_history;
  IF v_has_ambiguous_history THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'ambiguous');
  END IF;

  -- A failed/skipped receipt is authoritative unless the caller explicitly
  -- requests a retry. This preserves the existing idempotency contract.
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

REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)
  TO service_role;

-- Keep the V1 completion/failure overloads available during the database
-- pre-stage. They retain the immutable cutoff guard, and 130000 retires them
-- only after the V2 lifecycle is active.
CREATE OR REPLACE FUNCTION public.complete_x_post_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_x_tweet_id text,
  p_media_count integer DEFAULT 0, p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL, p_posted_at timestamptz DEFAULT now(),
  p_latency_ms integer DEFAULT NULL, p_api_response jsonb DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE v_post_id text; v_updated integer := 0;
BEGIN
  SELECT post_id INTO v_post_id FROM public.x_deliveries WHERE id = p_delivery_id;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN RETURN false; END IF;
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR NULLIF(btrim(p_x_tweet_id), '') IS NULL THEN RETURN false; END IF;
  UPDATE public.x_deliveries SET status='posted', x_tweet_id=NULLIF(btrim(p_x_tweet_id), ''),
    media_count=GREATEST(COALESCE(p_media_count,0),0), media_bytes=GREATEST(COALESCE(p_media_bytes,0),0),
    media_kind=p_media_kind, posted_at=COALESCE(p_posted_at,now()), latency_ms=p_latency_ms,
    api_response=p_api_response, last_error=p_last_error, attempts=GREATEST(COALESCE(attempts,0)+1,1),
    claim_state='posted', claim_expires_at=NULL,
    claim_released_at=now(), claim_release_reason='completed', last_claim_error=NULL, updated_at=now()
  WHERE id=p_delivery_id AND claim_token=p_claim_token AND status='posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT; RETURN v_updated=1;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_status text DEFAULT 'failed',
  p_error text DEFAULT NULL, p_api_response jsonb DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL, p_skip_reason text DEFAULT NULL,
  p_media_count integer DEFAULT 0, p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE v_post_id text; v_updated integer := 0; v_status text := CASE WHEN p_status IN ('failed','skipped') THEN p_status ELSE 'failed' END;
BEGIN
  SELECT post_id INTO v_post_id FROM public.x_deliveries WHERE id = p_delivery_id;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN RETURN false; END IF;
  IF p_delivery_id IS NULL OR p_claim_token IS NULL THEN RETURN false; END IF;
  UPDATE public.x_deliveries SET status=v_status, last_error=left(COALESCE(p_error,'x_post_delivery_failed'),1000),
    last_claim_error=left(COALESCE(p_error,'x_post_delivery_failed'),1000), api_response=p_api_response,
    next_retry_at=p_next_retry_at, skip_reason=p_skip_reason,
    media_count=GREATEST(COALESCE(p_media_count,0),0), media_bytes=GREATEST(COALESCE(p_media_bytes,0),0),
    media_kind=p_media_kind, attempts=GREATEST(COALESCE(attempts,0)+1,1),
    claim_state=v_status, claim_expires_at=NULL, claim_released_at=now(),
    claim_release_reason=v_status, updated_at=now()
  WHERE id=p_delivery_id AND claim_token=p_claim_token AND status='posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT; RETURN v_updated=1;
END; $$;

REVOKE ALL ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text
) TO service_role;
REVOKE ALL ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text
) TO service_role;

REVOKE ALL ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, bigint, text, integer, bigint, text, timestamptz, integer, jsonb, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, bigint, text, integer, bigint, text, timestamptz, integer, jsonb, text
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, bigint, text, text, jsonb, timestamptz, text, integer, bigint, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, bigint, text, text, jsonb, timestamptz, text, integer, bigint, text
) TO service_role;

COMMIT;
