-- E6 additive B3A repair: preserve the accepted migration and correct only the
-- expired-claim requeue CTE reference in the reconcile function.
CREATE OR REPLACE FUNCTION public.reconcile_expired_job_claims(
  p_max_claims integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_requeued integer := 0;
  v_ambiguous integer := 0;
  v_now timestamptz := now();
BEGIN
  WITH requeueable AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.status = 'running'
      AND j.claim_state IN ('preparing', 'ready')
      AND (j.claim_expires_at IS NULL OR j.claim_expires_at < v_now)
      AND j.provider_started_at IS NULL
    LIMIT GREATEST(1, COALESCE(p_max_claims, 100))
    FOR UPDATE SKIP LOCKED
  ), do_requeue AS (
    UPDATE public.jobs j
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_token = NULL,
      claim_generation = COALESCE(j.claim_generation, 0),
      claim_state = 'idle',
      claim_started_at = NULL,
      claim_expires_at = NULL,
      provider_started_at = NULL
    FROM requeueable r
    WHERE j.id = r.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_requeued FROM do_requeue;

  SELECT count(*) INTO v_ambiguous
  FROM public.jobs j
  WHERE j.status = 'running'
    AND j.claim_state = 'posting'
    AND (j.claim_expires_at IS NULL OR j.claim_expires_at < v_now)
    AND j.provider_started_at IS NOT NULL;

  RETURN jsonb_build_object(
    'requeued', v_requeued,
    'ambiguous', v_ambiguous,
    'reconciled_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_expired_job_claims(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_job_claims(integer) TO service_role;
