-- E6 additive B3A repair: preserve the accepted migration and replace only the
-- fail_x_post_delivery lease-clear expression whose NULL CASE resolves as text.
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
    claim_expires_at = NULL,
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

REVOKE ALL ON FUNCTION public.fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text) TO service_role;
