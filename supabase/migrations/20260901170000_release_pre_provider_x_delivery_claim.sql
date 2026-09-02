-- Release an X delivery claim only when the provider-start boundary was not
-- crossed. This is a forward-only successor used when preparation fails after
-- the claim but before any irreversible X request.
BEGIN;

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
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.release_x_post_delivery_for_retry(uuid, uuid, bigint, text, timestamptz, integer, bigint, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_x_post_delivery_for_retry(uuid, uuid, bigint, text, timestamptz, integer, bigint, text)
  TO service_role;

COMMIT;
