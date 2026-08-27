-- Repair the effective claim contract after the delivery-cutover migration.
-- 20260825091418 redefined claim_jobs without the B3 durable fence fields.  This
-- additive successor keeps its strict delivery admission predicate and restores
-- the token/generation/state envelope used by every worker lifecycle write.
BEGIN;

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
      AND (
        j.type <> 'deliver'
        OR public.delivery_cutover_allows_job(
          j.created_at,
          NULLIF(btrim(j.payload->>'tweet_id'), '')
        )
      )
    ORDER BY j.priority DESC, j.next_run_at ASC NULLS FIRST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer,text[],text) TO service_role;

-- Terminal cutover settlement must also close the durable claim envelope.  The
-- trigger permits only a failed row with the canonical reason prefix, while the
-- claim state prevents reconciliation from treating this as active work.
CREATE OR REPLACE FUNCTION public.settle_delivery_cutover_blocked(
  p_job_id uuid,
  p_reason text DEFAULT 'delivery_cutover_blocked'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
  v_created_at timestamptz;
  v_updated integer;
  v_reason text;
BEGIN
  SELECT NULLIF(btrim(j.payload->>'tweet_id'), ''), j.created_at
    INTO v_tweet_id, v_created_at
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.type = 'deliver'
    AND j.status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.delivery_cutover_allows_job(v_created_at, v_tweet_id) THEN
    RETURN false;
  END IF;

  v_reason := left(
    COALESCE(NULLIF(btrim(p_reason), ''), 'delivery_cutover_blocked'),
    1000
  );
  IF v_reason NOT LIKE 'delivery_cutover_blocked%' THEN
    v_reason := left('delivery_cutover_blocked:' || v_reason, 1000);
  END IF;

  UPDATE public.jobs
  SET status = 'failed',
      claim_state = 'failed',
      last_error = v_reason,
      completed_at = COALESCE(completed_at, clock_timestamp()),
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_expires_at = NULL,
      provider_started_at = NULL
  WHERE id = p_job_id
    AND type = 'deliver'
    AND status = 'running';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text)
  TO service_role;

-- The original Telegram claimer predates the immutable cutover and relies on
-- the row trigger.  Preserve its implementation behind a private name, then
-- return a structured blocked result before any lookup or INSERT.  This also
-- protects the V2 bridge, which delegates to the legacy signature.
ALTER FUNCTION public.claim_telegram_delivery(text,text,text,text,integer)
  RENAME TO claim_telegram_delivery_unchecked;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery_unchecked(text,text,text,text,integer)
  FROM public, anon, authenticated, service_role;

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
BEGIN
  IF v_key IS NULL OR v_subject_id IS NULL OR v_chat_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_delivery_key');
  END IF;
  IF NOT public.delivery_cutover_allows_post(v_subject_id) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_cutover_blocked');
  END IF;
  RETURN public.claim_telegram_delivery_unchecked(
    v_key, v_subject_id, v_chat_id, p_source, p_claim_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery(text,text,text,text,integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(text,text,text,text,integer)
  TO service_role;

-- Rebind the V2 bridge after the legacy function rename so it cannot retain a
-- dependency on the unchecked implementation.
CREATE OR REPLACE FUNCTION public.claim_telegram_delivery_v2(
  p_delivery_key text,
  p_subject_id text,
  p_chat_id text,
  p_lineage_time timestamptz,
  p_epoch_generation bigint,
  p_source text DEFAULT 'v2',
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_runtime_v2_activation();

  IF NOT public.runtime_v2_allows_lineage(p_lineage_time, p_epoch_generation) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_v2_cutover_blocked');
  END IF;
  RETURN public.claim_telegram_delivery(
    p_delivery_key, p_subject_id, p_chat_id, p_source, p_claim_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery_v2(text, text, text, timestamptz, bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery_v2(text, text, text, timestamptz, bigint, text, integer)
  TO service_role;

COMMIT;
