-- Enforce immutable historical delivery jobs before the V2 activation window.
-- This append-only successor removes historical settlement from reconciliation,
-- preserves normal non-delivery maintenance, and blocks every historical job
-- UPDATE or DELETE before the older compatibility trigger can allow it.
BEGIN;

CREATE OR REPLACE FUNCTION public.settle_delivery_cutover_blocked(
  p_job_id uuid,
  p_reason text DEFAULT 'delivery_cutover_blocked'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
BEGIN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  expired_leases int := 0;
  stale_running int := 0;
  missing_dedupes int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  dedupe_enabled boolean := false;
  v_cutover timestamptz;
  result jsonb;
BEGIN
  v_cutover := public.get_delivery_cutover();

  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO dedupe_enabled
  FROM public.settings
  WHERE key = 'story_memory'
  LIMIT 1;

  -- Historical delivery rows are excluded by each release predicate before
  -- any UPDATE can lock or mutate them.
  UPDATE public.jobs AS j
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE j.status = 'running'
    AND j.lease_expires_at IS NOT NULL
    AND j.lease_expires_at < now()
    AND (
      j.type <> 'deliver'
      OR public.delivery_cutover_allows_job(
        j.created_at,
        NULLIF(btrim(j.payload->>'tweet_id'), '')
      )
    );
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  UPDATE public.jobs AS j
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: stale running job without active lease'
  WHERE j.status = 'running'
    AND j.lease_expires_at IS NULL
    AND COALESCE(j.locked_at, j.created_at) < now() - interval '30 minutes'
    AND (
      j.type <> 'deliver'
      OR public.delivery_cutover_allows_job(
        j.created_at,
        NULLIF(btrim(j.payload->>'tweet_id'), '')
      )
    );
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  IF dedupe_enabled THEN
    INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
    SELECT 'dedupe', jsonb_build_object('tweet_id', p.tweet_id, 'source', 'reconcile'),
      'pending', 'dedupe:reconcile:' || p.tweet_id, now(), 11
    FROM public.posts AS p
    WHERE p.created_at > now() - interval '24 hours'
      AND p.text_original IS NOT NULL
      AND (
        p.dedupe_status IS NULL
        OR (
          p.dedupe_status = 'pending'
          AND COALESCE(p.dedupe_checked_at, p.created_at) < now() - interval '5 minutes'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs AS j
        WHERE j.type IN ('dedupe', 'compute_signature')
          AND (j.payload->>'tweet_id') = p.tweet_id
          AND j.status IN ('pending', 'running')
      )
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS missing_dedupes = ROW_COUNT;
  END IF;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'translate:reconcile:' || p.tweet_id, now(), 10
  FROM public.posts AS p
  WHERE p.translated_at IS NULL
    AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND (p.delivery_decision IS NULL OR p.delivery_decision = 'deliver')
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('dedupe', 'compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'translate'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'deliver:reconcile:' || p.tweet_id, now()
  FROM public.posts AS p
  WHERE v_cutover IS NOT NULL
    AND public.delivery_cutover_allows_post(p.tweet_id)
    AND p.created_at > v_cutover
    AND p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.deliveries AS d
      WHERE d.subject_type = 'post'
        AND d.subject_id = p.tweet_id
        AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('dedupe', 'compute_signature')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'deliver'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'hydrate:reconcile:' || p.tweet_id, now(), 15
  FROM public.posts AS p
  WHERE p.is_truncated = true
    AND p.hydrated_at IS NULL
    AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  INSERT INTO public.jobs(type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media', jsonb_build_object('tweet_id', p.tweet_id), 'pending',
    'resolve_media:reconcile:' || p.tweet_id, now(), 12
  FROM public.posts AS p
  WHERE p.has_media = true
    AND p.created_at > now() - interval '24 hours'
    AND COALESCE(p.dedupe_status, 'unique') <> 'pending'
    AND NOT (
      p.dedupe_status = 'duplicate'
      OR (
        p.dup_of_tweet_id IS NOT NULL
        AND COALESCE(p.dedupe_status, '') NOT IN ('coverage_gap', 'uncertain', 'related_new_info')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.media AS m
      WHERE m.tweet_id = p.tweet_id
        AND m.downloaded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.jobs AS j
      WHERE j.type IN ('resolve_media', 'download_media')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'stale_running_released', stale_running,
    'missing_dedupes_created', missing_dedupes,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now(),
    'delivery_cutover', v_cutover
  );

  INSERT INTO public.queue_reconcile_runs(
    result,
    expired_leases_released,
    stale_running_released,
    missing_dedupes_created,
    missing_translates_created,
    missing_deliveries_created,
    missing_hydrations_created,
    missing_media_created
  )
  VALUES (
    result,
    expired_leases,
    stale_running,
    missing_dedupes,
    missing_translates,
    missing_deliveries,
    missing_hydrations,
    missing_media
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_jobs()
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.guard_historical_delivery_job_zero_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
BEGIN
  IF OLD.type = 'deliver' THEN
    v_tweet_id := NULLIF(btrim(COALESCE(OLD.payload->>'tweet_id', '')), '');
    IF NOT public.delivery_cutover_allows_job(OLD.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_deliver_job_zero_write';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_historical_delivery_job_zero_write()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_historical_delivery_job_zero_write()
  TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_00_historical_delivery_job_zero_write
  ON public.jobs;
CREATE TRIGGER trg_00_historical_delivery_job_zero_write
  BEFORE UPDATE OR DELETE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_historical_delivery_job_zero_write();

COMMIT;
