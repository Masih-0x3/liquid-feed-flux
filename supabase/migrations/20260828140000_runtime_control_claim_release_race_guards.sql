-- Close runtime-control races at claim and delivery-release boundaries without
-- changing the established delivery cutover contract.
BEGIN;

CREATE OR REPLACE FUNCTION public.lock_runtime_controls()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('xot.runtime_controls', 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_runtime_controls()
  FROM public, anon, authenticated, service_role;

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
  IF job_types IS NULL OR job_types && ARRAY[
    'dedupe',
    'compute_signature',
    'translate',
    'enrich',
    'deliver'
  ]::text[] THEN
    PERFORM public.lock_runtime_controls();
  END IF;

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
        j.type <> 'deliver'
        OR public.delivery_cutover_allows_job(
          j.created_at,
          NULLIF(btrim(j.payload->>'tweet_id'), '')
        )
      )
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
    ORDER BY j.priority DESC, j.next_run_at ASC NULLS FIRST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer, text[], text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.runtime_controls_delivery_release_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  controls public.runtime_controls;
BEGIN
  IF TG_TABLE_NAME = 'jobs'
     AND NEW.type = 'deliver'
     AND NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    PERFORM public.lock_runtime_controls();

    SELECT * INTO controls
    FROM public.runtime_controls
    WHERE singleton_id IS TRUE AND singleton_key IS TRUE
    FOR UPDATE;

    IF NOT FOUND OR controls.environment <> 'production'
       OR controls.posting_mode <> 'enabled' THEN
      RAISE EXCEPTION 'runtime_controls_posting_blocked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS runtime_controls_delivery_release_guard ON public.jobs;
CREATE TRIGGER runtime_controls_delivery_release_guard
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.runtime_controls_delivery_release_guard();

REVOKE ALL ON FUNCTION public.runtime_controls_delivery_release_guard()
  FROM public, anon, authenticated, service_role;

-- Preserve the legacy two-field RPC as one atomic update while serializing it
-- with claims and delivery releases.
CREATE OR REPLACE FUNCTION public.update_runtime_controls(
  p_dedupe_enabled boolean,
  p_translation_enabled boolean
)
RETURNS public.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  updated_row public.runtime_controls;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_runtime_controls();

  UPDATE public.runtime_controls
  SET dedupe_enabled = p_dedupe_enabled,
      translation_enabled = p_translation_enabled,
      updated_at = clock_timestamp(),
      updated_by = (SELECT auth.uid())
  WHERE singleton_id IS TRUE AND singleton_key IS TRUE
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'runtime controls unavailable';
  END IF;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_runtime_controls(boolean, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_runtime_controls(boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_runtime_control(
  p_control_name text,
  p_enabled boolean
)
RETURNS public.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  updated_row public.runtime_controls;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_control_name NOT IN ('dedupe_enabled', 'translation_enabled') THEN
    RAISE EXCEPTION 'runtime control name invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_runtime_controls();

  PERFORM 1
  FROM public.runtime_controls
  WHERE singleton_id IS TRUE AND singleton_key IS TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'runtime controls unavailable';
  END IF;

  IF p_control_name = 'dedupe_enabled' THEN
    UPDATE public.runtime_controls
    SET dedupe_enabled = p_enabled,
        updated_at = clock_timestamp(),
        updated_by = (SELECT auth.uid())
    WHERE singleton_id IS TRUE AND singleton_key IS TRUE
    RETURNING * INTO updated_row;
  ELSE
    UPDATE public.runtime_controls
    SET translation_enabled = p_enabled,
        updated_at = clock_timestamp(),
        updated_by = (SELECT auth.uid())
    WHERE singleton_id IS TRUE AND singleton_key IS TRUE
    RETURNING * INTO updated_row;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'runtime controls unavailable';
  END IF;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_runtime_control(text, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_runtime_control(text, boolean) TO authenticated;

COMMIT;
