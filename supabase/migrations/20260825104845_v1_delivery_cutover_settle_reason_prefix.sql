-- Keep terminal blocked settlement errors machine-detectable even when an
-- internal caller supplies a short or unprefixed reason.
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
  v_updated integer;
  v_reason text;
BEGIN
  SELECT NULLIF(btrim(j.payload->>'tweet_id'), '')
    INTO v_tweet_id
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.type = 'deliver'
    AND j.status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.delivery_cutover_allows_job(
    (SELECT j.created_at FROM public.jobs j WHERE j.id = p_job_id),
    v_tweet_id
  ) THEN
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
      last_error = v_reason,
      completed_at = COALESCE(completed_at, clock_timestamp()),
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL
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
