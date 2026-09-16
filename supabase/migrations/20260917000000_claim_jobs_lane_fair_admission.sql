-- 0X3-672: lane-fair claim admission.
--
-- Incident: the single global ordering admitted only priority-20 'deliver'
-- jobs while blocked media/render deliveries stayed due and were repeatedly
-- re-claimed, starving all model/fast work (605+ pending translations, fresh
-- arrivals unserved for hours, X's 30-minute freshness gate then expired them).
-- Lane concurrency was applied after the global LIMIT, so unused model
-- capacity could never help jobs that were never admitted.
--
-- Admission is now two bounded passes inside one transaction and one claim
-- token:
--   pass 1: non-'deliver' types, capped at batch_size - delivery_floor,
--           ordered by priority, then a fresh-work boost, then due order;
--   pass 2: 'deliver' jobs fill every remaining batch slot.
--
-- 'deliver' is the only delivery-lane type; every other type is model/fast.
-- The delivery floor bounds blocked deliveries to a quarter of the batch
-- (minimum one) when 'deliver' is in scope, while a delivery-only backlog can
-- still fill the entire batch -- fairness is symmetric, not inverted.
--
-- Preserved verbatim: FOR UPDATE SKIP LOCKED selection, runtime-control
-- gating, delivery cutover, the 5-minute lease, claim token/generation,
-- claim_state='preparing', attempts increment, and provider_started_at reset.
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
  -- Fresh work must not strand behind hours of catch-up backlog: jobs created
  -- inside this window are admitted ahead of older same-priority backlog. The
  -- window deliberately stays inside X's 30-minute freshness gate so a post
  -- translated promptly remains publishable.
  fresh_window interval := interval '25 minutes';
  delivery_floor int := 0;
  non_delivery_claimed int := 0;
BEGIN
  IF job_types IS NULL OR job_types && ARRAY[
    'dedupe',
    'compute_signature',
    'translate',
    'enrich',
    'deliver'
  ]::text[] THEN
    PERFORM public.lock_runtime_controls();
  END IF;

  -- Reserve a bounded share of each mixed claim for delivery work only when
  -- 'deliver' is claimable in this call. Scoped claims keep their full batch.
  IF job_types IS NULL OR 'deliver' = ANY(job_types) THEN
    delivery_floor := LEAST(GREATEST(batch_size / 4, 1), GREATEST(batch_size - 1, 0));
  END IF;

  -- Pass 1: model/fast admission. Identical eligibility predicates; ordering
  -- keeps priority first, then the fresh-work boost, then due order.
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
    FROM public.jobs AS j
    WHERE j.status = 'pending'
      AND (j.next_run_at IS NULL OR j.next_run_at <= now())
      AND j.type <> 'deliver'
      AND (job_types IS NULL OR j.type = ANY(job_types))
      AND (
        j.type NOT IN ('dedupe', 'compute_signature', 'translate', 'enrich', 'deliver')
        OR EXISTS (
          SELECT 1
          FROM public.runtime_controls AS controls
          WHERE controls.singleton_id IS TRUE
            AND controls.singleton_key IS TRUE
            AND (
              (j.type IN ('dedupe', 'compute_signature') AND controls.dedupe_enabled IS TRUE)
              OR (j.type IN ('translate', 'enrich') AND controls.translation_enabled IS TRUE)
              OR (
                j.type = 'deliver'
                AND controls.environment = 'production'
                AND controls.posting_mode = 'enabled'
              )
            )
        )
      )
    ORDER BY
      j.priority DESC,
      (j.created_at > now() - fresh_window) DESC,
      j.next_run_at ASC NULLS FIRST,
      j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(batch_size - delivery_floor, 0)
  )
  RETURNING *;
  GET DIAGNOSTICS non_delivery_claimed = ROW_COUNT;

  -- Pass 2: delivery admission fills every slot pass 1 left unused. The
  -- delivery cutover predicate and the posting-mode control gate are
  -- unchanged.
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
    FROM public.jobs AS j
    WHERE j.status = 'pending'
      AND (j.next_run_at IS NULL OR j.next_run_at <= now())
      AND j.type = 'deliver'
      AND (job_types IS NULL OR j.type = ANY(job_types))
      AND public.delivery_cutover_allows_job(
        j.created_at,
        NULLIF(btrim(j.payload->>'tweet_id'), '')
      )
      AND EXISTS (
        SELECT 1
        FROM public.runtime_controls AS controls
        WHERE controls.singleton_id IS TRUE
          AND controls.singleton_key IS TRUE
          AND controls.environment = 'production'
          AND controls.posting_mode = 'enabled'
      )
    ORDER BY j.priority DESC, j.next_run_at ASC NULLS FIRST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(batch_size - non_delivery_claimed, 0)
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer, text[], text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer, text[], text) TO service_role;

COMMIT;
