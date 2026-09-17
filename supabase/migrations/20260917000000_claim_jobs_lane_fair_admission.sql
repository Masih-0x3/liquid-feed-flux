-- 0X3-672: lane-fair claim admission.
--
-- Incident: the single global ordering admitted only priority-20 'deliver'
-- jobs while blocked media/render deliveries stayed due and were repeatedly
-- re-claimed, starving all model/fast work (605+ pending translations, fresh
-- arrivals unserved for hours, X's 30-minute freshness gate then expired them).
-- Lane concurrency was applied after the global LIMIT, so unused model
-- capacity could never help jobs that were never admitted.
--
-- Admission is now per-lane bounded passes inside one transaction and one
-- claim token. Lane membership mirrors workerUtils.jobLane():
--   model    = 'translate' + 'enrich'   (provider-bound publishability path)
--   delivery = 'deliver'
--   fast     = every other type         (dedupe, hydrate, media, future types)
--
--   pass 1: model,    capped at batch_size - fast_reserve - delivery_reserve
--   pass 2: fast,     capped at batch_size - claimed_model - delivery_reserve
--   pass 3: deliver,  fills every slot model and fast left unused
--   pass 4: fill,     any still-eligible in-scope job by priority/fresh/due
--
-- Reservations (a quarter of the batch, minimum one) apply only when a claim
-- spans multiple lanes; a single-lane scope keeps the whole batch. Under a
-- saturated mixed backlog every lane keeps a nonzero share, so a deep or
-- continuously replenished fast backlog can no longer starve translations,
-- and blocked deliveries still cannot crowd out the rest. A delivery-only or
-- model-only backlog can still fill the entire batch -- fairness is
-- symmetric, not inverted.
--
-- Ordering inside every pass keeps priority first, then a fresh-work boost,
-- then due order. Fresh work (created inside the 25-minute window, within X's
-- 30-minute freshness gate) is admitted ahead of older same-priority backlog.
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
  fresh_window interval := interval '25 minutes';
  lane_model boolean := false;
  lane_delivery boolean := false;
  lane_fast boolean := false;
  lane_count int := 0;
  delivery_reserve int := 0;
  fast_reserve int := 0;
  claimed_model int := 0;
  claimed_fast int := 0;
  claimed_delivery int := 0;
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

  -- Lane scope resolution. 'deliver' and the model pair are explicit; every
  -- other type in scope counts as fast, matching jobLane()'s default.
  lane_model := job_types IS NULL OR job_types && ARRAY['translate', 'enrich']::text[];
  lane_delivery := job_types IS NULL OR 'deliver' = ANY(job_types);
  lane_fast := job_types IS NULL OR EXISTS (
    SELECT 1
    FROM unnest(job_types) AS scope_type
    WHERE scope_type NOT IN ('translate', 'enrich', 'deliver')
  );
  lane_count := lane_model::int + lane_delivery::int + lane_fast::int;

  -- Reservations bind only across multiple lanes. The fast reserve also
  -- leaves room for the model share and at least one model slot when model
  -- is in scope.
  IF lane_count > 1 THEN
    IF lane_delivery THEN
      delivery_reserve := LEAST(GREATEST(batch_size / 4, 1), GREATEST(batch_size - 1, 0));
    END IF;
    IF lane_fast THEN
      fast_reserve := LEAST(
        GREATEST(batch_size / 4, 1),
        GREATEST(batch_size - delivery_reserve - lane_model::int, 0)
      );
    END IF;
  END IF;

  -- Pass 1: model admission (the publishability path) is capped only by the
  -- other lanes' reservations, so it keeps the dominant share under a fully
  -- saturated backlog and can never be starved by fast/delivery depth.
  IF lane_model THEN
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
        AND j.type IN ('translate', 'enrich')
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
      LIMIT GREATEST(batch_size - fast_reserve - delivery_reserve, 0)
    )
    RETURNING *;
    GET DIAGNOSTICS claimed_model = ROW_COUNT;
  END IF;

  -- Pass 2: fast admission keeps its reserve and anything model did not use.
  IF lane_fast THEN
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
        AND j.type NOT IN ('translate', 'enrich', 'deliver')
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
      LIMIT GREATEST(batch_size - claimed_model - delivery_reserve, 0)
    )
    RETURNING *;
    GET DIAGNOSTICS claimed_fast = ROW_COUNT;
  END IF;

  -- Pass 3: delivery admission fills every slot model and fast left unused.
  -- The delivery cutover predicate and the posting-mode control gate are
  -- unchanged.
  IF lane_delivery THEN
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
      LIMIT GREATEST(batch_size - claimed_model - claimed_fast, 0)
    )
    RETURNING *;
    GET DIAGNOSTICS claimed_delivery = ROW_COUNT;
  END IF;

  -- Pass 4: shared fill. When a lane under-claims its reserve, the leftover
  -- capacity goes to whichever eligible in-scope jobs remain, in the same
  -- priority/fresh/due order. Reservations already hold, so the slack cannot
  -- reopen starvation.
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
      AND (
        j.type <> 'deliver'
        OR public.delivery_cutover_allows_job(
          j.created_at,
          NULLIF(btrim(j.payload->>'tweet_id'), '')
        )
      )
    ORDER BY
      j.priority DESC,
      (j.created_at > now() - fresh_window) DESC,
      j.next_run_at ASC NULLS FIRST,
      j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(batch_size - claimed_model - claimed_fast - claimed_delivery, 0)
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer, text[], text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer, text[], text) TO service_role;

COMMIT;
