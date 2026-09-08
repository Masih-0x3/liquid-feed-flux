-- Reserve a whole media batch before provider start. Reservations conservatively
-- count failed/ambiguous uploads and concurrent runs; pre-provider release refunds
-- them atomically with the delivery claim. Units are media items, not chunk calls.
BEGIN;
CREATE TABLE public.x_media_upload_reservations (
  delivery_id uuid NOT NULL REFERENCES public.x_deliveries(id) ON DELETE CASCADE,
  claim_token uuid NOT NULL,
  claim_generation bigint NOT NULL,
  media_count integer NOT NULL CHECK (media_count BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  PRIMARY KEY (delivery_id, claim_token, claim_generation)
);
ALTER TABLE public.x_media_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.x_media_upload_reservations FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.x_media_upload_reservations TO service_role;
CREATE INDEX x_media_upload_reservations_window ON public.x_media_upload_reservations(created_at) WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_x_media_upload_usage()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
  SELECT COALESCE((SELECT sum(r.media_count) FROM public.x_media_upload_reservations r
    WHERE r.released_at IS NULL AND r.created_at >= now() - interval '24 hours'), 0)
  + COALESCE((SELECT sum(GREATEST(COALESCE(d.media_count, 0), 0)) FROM public.x_deliveries d
    WHERE d.created_at >= now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM public.x_media_upload_reservations r WHERE r.delivery_id = d.id)), 0);
$$;

CREATE OR REPLACE FUNCTION public.reserve_x_media_uploads(
  p_delivery_id uuid, p_claim_token uuid, p_claim_generation bigint, p_media_count integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE
  v_limit_text text;
  v_limit integer;
  v_usage bigint;
  v_existing integer;
BEGIN
  IF p_media_count IS NULL OR p_media_count NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'x_media_quota_invalid_count';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('x_media_upload_quota', 0));
  PERFORM 1 FROM public.x_deliveries WHERE id = p_delivery_id
    AND claim_token = p_claim_token AND claim_generation = p_claim_generation
    AND status = 'posting' AND claim_state = 'preparing'
    AND provider_started_at IS NULL AND claim_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reserved', false, 'reason', 'claim_lost'); END IF;
  SELECT value->>'media_uploads_per_day' INTO v_limit_text FROM public.settings WHERE key = 'x_rate_limits';
  IF v_limit_text IS NULL OR v_limit_text !~ '^[1-9][0-9]{0,4}$' THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'quota_unavailable');
  END IF;
  v_limit := v_limit_text::integer;
  IF v_limit > 10000 THEN RETURN jsonb_build_object('reserved', false, 'reason', 'quota_unavailable'); END IF;
  SELECT media_count INTO v_existing FROM public.x_media_upload_reservations
    WHERE delivery_id = p_delivery_id AND claim_token = p_claim_token
      AND claim_generation = p_claim_generation AND released_at IS NULL;
  v_usage := public.get_x_media_upload_usage();
  IF v_existing IS NOT NULL THEN
    IF v_existing <> p_media_count THEN RAISE EXCEPTION 'x_media_quota_reservation_mismatch'; END IF;
    RETURN jsonb_build_object('reserved', true, 'media_uploads_24h', v_usage);
  END IF;
  IF v_usage + p_media_count > v_limit THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'rate_limit_media', 'media_uploads_24h', v_usage);
  END IF;
  INSERT INTO public.x_media_upload_reservations(delivery_id, claim_token, claim_generation, media_count)
    VALUES (p_delivery_id, p_claim_token, p_claim_generation, p_media_count);
  RETURN jsonb_build_object('reserved', true, 'media_uploads_24h', v_usage + p_media_count);
END;
$$;
REVOKE ALL ON FUNCTION public.get_x_media_upload_usage() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_x_media_uploads(uuid, uuid, bigint, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_x_media_upload_usage() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_x_media_uploads(uuid, uuid, bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_x_post_delivery_for_retry(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_error text DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT now(),
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
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR p_claim_generation IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.x_deliveries
  SET
    status = 'pending',
    claim_state = 'idle',
    claim_token = NULL,
    claim_expires_at = NULL,
    claim_released_at = now(),
    claim_release_reason = 'pre_provider_retry',
    last_error = left(COALESCE(p_error, 'x_post_delivery_pre_provider_failed'), 1000),
    last_claim_error = left(COALESCE(p_error, 'x_post_delivery_pre_provider_failed'), 1000),
    next_retry_at = p_next_retry_at,
    media_count = GREATEST(COALESCE(p_media_count, 0), 0),
    media_bytes = GREATEST(COALESCE(p_media_bytes, 0), 0),
    media_kind = p_media_kind,
    updated_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND status = 'posting'
    AND claim_state = 'preparing'
    AND provider_started_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    UPDATE public.x_media_upload_reservations SET released_at = now()
      WHERE delivery_id = p_delivery_id AND claim_token = p_claim_token
        AND claim_generation = p_claim_generation AND released_at IS NULL;
  END IF;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.release_x_post_delivery_for_retry(uuid, uuid, bigint, text, timestamptz, integer, bigint, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_x_post_delivery_for_retry(uuid, uuid, bigint, text, timestamptz, integer, bigint, text)
  TO service_role;

COMMIT;
