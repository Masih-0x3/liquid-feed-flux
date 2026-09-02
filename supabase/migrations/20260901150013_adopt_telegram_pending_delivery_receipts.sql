-- Adopt the chat-agnostic pending receipt created by render-release enqueue
-- paths before the durable Telegram claim runs. This prevents a second
-- bookkeeping row while preserving the provider idempotency boundary.
--
-- Historical delivery rows remain fail-closed: the cutover guard runs before
-- any lookup or write. Failed/ambiguous rows and rows for another non-null chat
-- are never adopted.
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
  v_pending_id uuid;
BEGIN
  IF v_key IS NULL OR v_subject_id IS NULL OR v_chat_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_delivery_key');
  END IF;

  IF NOT public.delivery_cutover_allows_post(v_subject_id) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_cutover_blocked');
  END IF;

  -- Do not bind an old placeholder when this subject is already posted. The
  -- unchecked claimer returns the durable already_posted receipt unchanged.
  IF EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.subject_type = 'post'
      AND d.subject_id = v_subject_id
      AND d.telegram_chat_id = v_chat_id
      AND d.status = 'posted'
  ) THEN
    RETURN public.claim_telegram_delivery_unchecked(
      v_key,
      v_subject_id,
      v_chat_id,
      p_source,
      p_claim_ttl_seconds
    );
  END IF;

  SELECT d.id
  INTO v_pending_id
  FROM public.deliveries d
  WHERE d.subject_type = 'post'
    AND d.subject_id = v_subject_id
    AND d.telegram_chat_id IS NULL
    AND d.delivery_key IS NULL
    AND d.status = 'pending'
    AND d.claim_state = 'idle'
    AND d.provider_started_at IS NULL
    AND COALESCE(cardinality(d.provider_message_ids), 0) = 0
    AND COALESCE(cardinality(d.telegram_message_ids), 0) = 0
  ORDER BY d.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.deliveries
    SET telegram_chat_id = v_chat_id
    WHERE id = v_pending_id
      AND telegram_chat_id IS NULL
      AND delivery_key IS NULL
      AND status = 'pending'
      AND claim_state = 'idle'
      AND provider_started_at IS NULL
      AND COALESCE(cardinality(provider_message_ids), 0) = 0
      AND COALESCE(cardinality(telegram_message_ids), 0) = 0;
  END IF;

  RETURN public.claim_telegram_delivery_unchecked(
    v_key,
    v_subject_id,
    v_chat_id,
    p_source,
    p_claim_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery(text,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(text,text,text,text,integer)
  TO service_role;
