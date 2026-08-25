-- XOT v1 delivery continuity cutover.
--
-- This migration deliberately uses a separate singleton instead of extending
-- runtime_controls. A later preview branch owns that table's exact shape.
-- The singleton is empty until the operator initializes it once with the
-- database clock. All posting paths fail closed while it is empty.

BEGIN;

CREATE TABLE IF NOT EXISTS public.delivery_cutover (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  delivery_cutover_at timestamptz NOT NULL,
  disposition text NOT NULL DEFAULT 'historical_unsent'
    CHECK (disposition = 'historical_unsent'),
  initialized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  initialized_by text
);

CREATE OR REPLACE FUNCTION public.prevent_delivery_cutover_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'delivery_cutover is immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_cutover_immutable
  ON public.delivery_cutover;
CREATE TRIGGER trg_delivery_cutover_immutable
  BEFORE UPDATE OR DELETE ON public.delivery_cutover
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delivery_cutover_mutation();

CREATE OR REPLACE FUNCTION public.initialize_delivery_cutover(
  p_initialized_by text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_cutover timestamptz;
  v_inserted boolean := false;
BEGIN
  INSERT INTO public.delivery_cutover (
    singleton_key,
    delivery_cutover_at,
    initialized_by
  )
  VALUES (true, clock_timestamp(), left(NULLIF(btrim(p_initialized_by), ''), 120))
  ON CONFLICT (singleton_key) DO NOTHING;

  v_inserted := FOUND;
  SELECT d.delivery_cutover_at
  INTO v_cutover
  FROM public.delivery_cutover d
  WHERE d.singleton_key = true;

  IF v_cutover IS NULL THEN
    RAISE EXCEPTION 'delivery_cutover_not_initialized';
  END IF;

  -- Bind X's admission floor exactly once. Keep it disabled until the
  -- operator explicitly opens the X stage after the Telegram canary.
  IF v_inserted THEN
    INSERT INTO public.settings (key, value, description)
    VALUES (
      'x_posting_config',
      jsonb_build_object('enabled', false, 'start_posting_from', v_cutover::text),
      'X posting configuration'
    )
    ON CONFLICT (key) DO UPDATE
    SET value = jsonb_set(
      COALESCE(public.settings.value, '{}'::jsonb),
      '{start_posting_from}',
      to_jsonb(v_cutover::text),
      true
    ) || jsonb_build_object('enabled', false);
  END IF;

  RETURN v_cutover;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_delivery_cutover()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  SELECT CASE
    WHEN count(*) = 1 THEN max(d.delivery_cutover_at)
    ELSE NULL
  END
  FROM public.delivery_cutover d;
$$;

CREATE OR REPLACE FUNCTION public.delivery_cutover_allows_post(p_tweet_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT count(*) = 1
      AND max(p.created_at) > max(c.delivery_cutover_at)
    FROM public.delivery_cutover c
    JOIN public.posts p ON p.tweet_id = NULLIF(btrim(p_tweet_id), '')
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.delivery_cutover_allows_job(
  p_created_at timestamptz,
  p_tweet_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  SELECT COALESCE(
    p_created_at > public.get_delivery_cutover()
      AND public.delivery_cutover_allows_post(p_tweet_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_delivery_cutover_post(p_tweet_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
BEGIN
  IF NOT public.delivery_cutover_allows_post(p_tweet_id) THEN
    RAISE EXCEPTION 'delivery_cutover_blocked:missing_or_historical_lineage';
  END IF;
END;
$$;

-- A job can be claimed just before a final lineage check observes the
-- immutable floor. Never release that row to pending: settle it terminally
-- as blocked, and only when it is still the same running deliver job.
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

  UPDATE public.jobs
  SET status = 'failed',
      last_error = left(COALESCE(NULLIF(p_reason, ''), 'delivery_cutover_blocked'), 1000),
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

-- Posting-related rows cannot be backdated, requeued, cleaned, or otherwise
-- mutated after T. Translation/media/render work may still update its own
-- fields on historical posts.
CREATE OR REPLACE FUNCTION public.guard_delivery_cutover_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
  v_historical boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    v_tweet_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.tweet_id ELSE NEW.tweet_id END;
    v_historical := NOT public.delivery_cutover_allows_post(v_tweet_id);
    IF TG_OP = 'DELETE' AND v_historical THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_post_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:post_admission_time_immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND v_historical AND (
      NEW.tweet_id IS DISTINCT FROM OLD.tweet_id OR
      NEW.account_id IS DISTINCT FROM OLD.account_id OR
      NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_post_mutation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'jobs' THEN
    v_tweet_id := NULLIF(btrim(COALESCE(
      (CASE WHEN TG_OP = 'DELETE' THEN OLD.payload ELSE NEW.payload END)->>'tweet_id',
      ''
    )), '');
    IF TG_OP = 'INSERT' AND NEW.type = 'deliver'
      AND NOT public.delivery_cutover_allows_job(NEW.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:deliver_job_lineage';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.type = 'deliver'
      AND NOT public.delivery_cutover_allows_job(NEW.created_at, v_tweet_id)
      AND NOT (
        NEW.status = 'failed' AND
        COALESCE(NEW.last_error, '') LIKE 'delivery_cutover_blocked%'
      ) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:deliver_job_lineage';
    END IF;
    IF TG_OP = 'DELETE' AND OLD.type = 'deliver'
      AND (OLD.created_at <= public.get_delivery_cutover()
        OR public.get_delivery_cutover() IS NULL) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_job_delete';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.type = 'deliver'
      AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:deliver_job_created_at_immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.type = 'deliver'
      AND NOT public.delivery_cutover_allows_job(OLD.created_at, v_tweet_id)
      AND NOT (
        NEW.status = 'failed' AND
        COALESCE(NEW.last_error, '') LIKE 'delivery_cutover_blocked%'
      ) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_deliver_job_mutation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'deliveries' THEN
    v_tweet_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.subject_id ELSE NEW.subject_id END;
    IF (TG_OP = 'DELETE' AND OLD.subject_type IS DISTINCT FROM 'post') OR
       (TG_OP <> 'DELETE' AND NEW.subject_type IS DISTINCT FROM 'post') THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:non_post_delivery_unsupported';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:telegram_created_at_immutable';
    END IF;
    IF TG_OP = 'INSERT' AND NOT public.delivery_cutover_allows_job(NEW.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:telegram_delivery_lineage';
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE')
      AND NOT public.delivery_cutover_allows_job(OLD.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_telegram_mutation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'x_deliveries' THEN
    v_tweet_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
    IF TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:x_created_at_immutable';
    END IF;
    IF TG_OP = 'INSERT' AND NOT public.delivery_cutover_allows_job(NEW.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:x_delivery_lineage';
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE')
      AND NOT public.delivery_cutover_allows_job(OLD.created_at, v_tweet_id) THEN
      RAISE EXCEPTION 'delivery_cutover_blocked:historical_x_mutation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_delivery_cutover ON public.posts;
CREATE TRIGGER trg_posts_delivery_cutover
  BEFORE UPDATE OR DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_cutover_rows();

DROP TRIGGER IF EXISTS trg_jobs_delivery_cutover ON public.jobs;
CREATE TRIGGER trg_jobs_delivery_cutover
  BEFORE INSERT OR UPDATE OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_cutover_rows();

DROP TRIGGER IF EXISTS trg_deliveries_delivery_cutover ON public.deliveries;
CREATE TRIGGER trg_deliveries_delivery_cutover
  BEFORE INSERT OR UPDATE OR DELETE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_cutover_rows();

DROP TRIGGER IF EXISTS trg_x_deliveries_delivery_cutover ON public.x_deliveries;
CREATE TRIGGER trg_x_deliveries_delivery_cutover
  BEFORE INSERT OR UPDATE OR DELETE ON public.x_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_cutover_rows();

-- The X start floor is not an independent operator-controlled cutoff.
CREATE OR REPLACE FUNCTION public.guard_x_posting_cutover_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_cutover timestamptz;
  v_start timestamptz;
BEGIN
  IF NEW.key <> 'x_posting_config' THEN RETURN NEW; END IF;
  v_cutover := public.get_delivery_cutover();
  IF v_cutover IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_start := NULLIF(NEW.value->>'start_posting_from', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_start := NULL;
  END;
  IF v_start IS DISTINCT FROM v_cutover THEN
    RAISE EXCEPTION 'delivery_cutover_blocked:x_start_posting_from_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_x_posting_cutover_setting ON public.settings;
CREATE TRIGGER trg_x_posting_cutover_setting
  BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_x_posting_cutover_setting();

-- Preserve the existing claim contract while excluding every historical or
-- ambiguous deliver job at the transactional claim boundary.
CREATE OR REPLACE FUNCTION public.claim_jobs(
  batch_size int DEFAULT 10,
  job_types text[] DEFAULT NULL,
  worker_id text DEFAULT 'default'
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lease_duration interval := interval '5 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.jobs
  SET
    status = 'running',
    locked_at = now(),
    locked_by = worker_id,
    lease_expires_at = now() + lease_duration,
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1
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

-- X candidate selection and claim both enforce the same immutable T.
CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(
  p_post_id text,
  p_source text DEFAULT 'unknown',
  p_force_retry boolean DEFAULT false,
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_post_id text := NULLIF(btrim(COALESCE(p_post_id, '')), '');
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'unknown'), 120);
  v_ttl integer := GREATEST(60, LEAST(COALESCE(p_claim_ttl_seconds, 1800), 7200));
  v_delivery_id uuid;
  v_claim_token uuid := gen_random_uuid();
  v_existing record;
BEGIN
  IF v_post_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_post_id');
  END IF;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'delivery_cutover_blocked');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.x_deliveries xd
    WHERE xd.post_id = v_post_id
      AND (public.get_delivery_cutover() IS NULL OR xd.created_at <= public.get_delivery_cutover())
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'historical_x_delivery');
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id AND status = 'posted'
  ORDER BY COALESCE(posted_at, created_at) DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_posted',
      'delivery_id', v_existing.id, 'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id);
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id AND status = 'posting'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('claimed', false,
      'reason', CASE WHEN v_existing.claim_expires_at IS NOT NULL
        AND v_existing.claim_expires_at < now() THEN 'stale_posting' ELSE 'already_posting' END,
      'delivery_id', v_existing.id, 'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_expires_at', v_existing.claim_expires_at);
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries WHERE post_id = v_post_id
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_existing.status IN ('pending', 'running') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'active_x_' || v_existing.status,
      'delivery_id', v_existing.id, 'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_expires_at', v_existing.claim_expires_at);
  END IF;
  IF FOUND AND v_existing.status IN ('failed', 'skipped')
    AND NOT COALESCE(p_force_retry, false) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'previous_x_' || v_existing.status,
      'delivery_id', v_existing.id, 'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id);
  END IF;

  INSERT INTO public.x_deliveries (
    post_id, status, attempts, claim_token, claim_source,
    claim_started_at, claim_expires_at, created_at, updated_at
  ) VALUES (
    v_post_id, 'posting', 0, v_claim_token, v_source,
    now(), now() + make_interval(secs => v_ttl), now(), now()
  ) ON CONFLICT DO NOTHING RETURNING id INTO v_delivery_id;

  IF v_delivery_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'reason', 'claimed',
      'delivery_id', v_delivery_id, 'claim_token', v_claim_token,
      'claim_expires_at', now() + make_interval(secs => v_ttl));
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing FROM public.x_deliveries
  WHERE post_id = v_post_id AND status IN ('posting', 'posted')
  ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('claimed', false,
    'reason', CASE WHEN v_existing.status = 'posted' THEN 'already_posted'
      WHEN v_existing.status = 'posting' THEN 'already_posting' ELSE 'claim_conflict' END,
    'delivery_id', v_existing.id, 'existing_status', v_existing.status,
    'existing_x_tweet_id', v_existing.x_tweet_id,
    'claim_expires_at', v_existing.claim_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;

-- Keep completion/failure RPCs from mutating a row that did not pass the same
-- claim boundary. The existing update fencing remains intact.
CREATE OR REPLACE FUNCTION public.complete_x_post_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_x_tweet_id text,
  p_media_count integer DEFAULT 0, p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL, p_posted_at timestamptz DEFAULT now(),
  p_latency_ms integer DEFAULT NULL, p_api_response jsonb DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE v_post_id text; v_updated integer := 0;
BEGIN
  SELECT post_id INTO v_post_id FROM public.x_deliveries WHERE id = p_delivery_id;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN RETURN false; END IF;
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR NULLIF(btrim(p_x_tweet_id), '') IS NULL THEN RETURN false; END IF;
  UPDATE public.x_deliveries SET status='posted', x_tweet_id=NULLIF(btrim(p_x_tweet_id), ''),
    media_count=GREATEST(COALESCE(p_media_count,0),0), media_bytes=GREATEST(COALESCE(p_media_bytes,0),0),
    media_kind=p_media_kind, posted_at=COALESCE(p_posted_at,now()), latency_ms=p_latency_ms,
    api_response=p_api_response, last_error=p_last_error, attempts=GREATEST(COALESCE(attempts,0)+1,1),
    claim_released_at=now(), claim_release_reason='completed', last_claim_error=NULL, updated_at=now()
  WHERE id=p_delivery_id AND claim_token=p_claim_token AND status='posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT; RETURN v_updated=1;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_status text DEFAULT 'failed',
  p_error text DEFAULT NULL, p_api_response jsonb DEFAULT NULL,
  p_next_retry_at timestamptz DEFAULT NULL, p_skip_reason text DEFAULT NULL,
  p_media_count integer DEFAULT 0, p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE v_post_id text; v_updated integer := 0; v_status text := CASE WHEN p_status IN ('failed','skipped') THEN p_status ELSE 'failed' END;
BEGIN
  SELECT post_id INTO v_post_id FROM public.x_deliveries WHERE id = p_delivery_id;
  IF NOT public.delivery_cutover_allows_post(v_post_id) THEN RETURN false; END IF;
  IF p_delivery_id IS NULL OR p_claim_token IS NULL THEN RETURN false; END IF;
  UPDATE public.x_deliveries SET status=v_status, last_error=left(COALESCE(p_error,'x_post_delivery_failed'),1000),
    last_claim_error=left(COALESCE(p_error,'x_post_delivery_failed'),1000), api_response=p_api_response,
    next_retry_at=p_next_retry_at, skip_reason=p_skip_reason,
    media_count=GREATEST(COALESCE(p_media_count,0),0), media_bytes=GREATEST(COALESCE(p_media_bytes,0),0),
    media_kind=p_media_kind, attempts=GREATEST(COALESCE(attempts,0)+1,1), claim_released_at=now(),
    claim_release_reason=v_status, updated_at=now()
  WHERE id=p_delivery_id AND claim_token=p_claim_token AND status='posting';
  GET DIAGNOSTICS v_updated = ROW_COUNT; RETURN v_updated=1;
END; $$;

REVOKE ALL ON FUNCTION public.complete_x_post_delivery(uuid,uuid,text,integer,bigint,text,timestamptz,integer,jsonb,text)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_x_post_delivery(uuid,uuid,text,text,jsonb,timestamptz,text,integer,bigint,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(uuid,uuid,text,integer,bigint,text,timestamptz,integer,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(uuid,uuid,text,text,jsonb,timestamptz,text,integer,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_x_post_candidates(
  candidate_limit int DEFAULT 20, target_tweet_id text DEFAULT NULL
)
RETURNS TABLE (
  tweet_id text, text_translated text, text_original text, author_handle text,
  has_media boolean, importance_score integer, final_score numeric,
  delivery_decision text, decision_reason text, url text, is_truncated boolean,
  hydrated_at timestamptz, created_at timestamptz, final_x_text text,
  composed_post_text text, post_format_hint text, humanized_commentary text,
  commentary_hook text, commentary_question text, narrative_callback text,
  thread_continuation text, enrich_status text, dedupe_status text,
  dup_of_tweet_id text, dup_similarity numeric, dedupe_reason text,
  account_handle text, candidate_reason text, candidate_age_ms numeric,
  dispatch_source text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE
  x_cfg jsonb := '{}'::jsonb; min_score numeric := 14;
  decision_must_deliver boolean := true; dedupe_hours integer := 48;
  dedupe_cutoff timestamptz; start_from timestamptz := NULL;
  freshness_cutoff timestamptz; v_cutover timestamptz;
  effective_cutoff timestamptz; max_candidate_age_minutes integer := 30;
  max_posts_per_run integer := 1;
BEGIN
  v_cutover := public.get_delivery_cutover();
  IF v_cutover IS NULL THEN RETURN; END IF;
  SELECT COALESCE(value::jsonb,'{}'::jsonb) INTO x_cfg FROM public.settings WHERE key='x_posting_config';
  x_cfg := COALESCE(x_cfg, '{}'::jsonb);
  min_score := CASE
    WHEN x_cfg->>'min_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (x_cfg->>'min_score')::numeric
    ELSE 14
  END;
  decision_must_deliver := COALESCE(NULLIF(x_cfg->>'post_only_decision_deliver','')::boolean,true);
  dedupe_hours := CASE
    WHEN x_cfg->>'dedupe_window_hours' ~ '^[0-9]+$'
      THEN GREATEST(1, (x_cfg->>'dedupe_window_hours')::integer)
    ELSE 48
  END;
  max_candidate_age_minutes := CASE
    WHEN x_cfg->>'max_candidate_age_minutes' ~ '^[0-9]+$'
      THEN LEAST(1440, GREATEST(1, (x_cfg->>'max_candidate_age_minutes')::integer))
    ELSE 30
  END;
  max_posts_per_run := CASE
    WHEN x_cfg->>'max_posts_per_run' ~ '^[0-9]+$'
      THEN LEAST(20, GREATEST(1, (x_cfg->>'max_posts_per_run')::integer))
    ELSE 1
  END;
  BEGIN start_from := NULLIF(x_cfg->>'start_posting_from','')::timestamptz; EXCEPTION WHEN OTHERS THEN start_from := NULL; END;
  IF start_from IS DISTINCT FROM v_cutover THEN RETURN; END IF;
  dedupe_cutoff := now() - make_interval(hours => dedupe_hours);
  freshness_cutoff := now() - make_interval(mins => max_candidate_age_minutes);
  effective_cutoff := GREATEST(
    dedupe_cutoff,
    freshness_cutoff,
    v_cutover
  );
  RETURN QUERY SELECT p.tweet_id,p.text_translated,p.text_original,p.author_handle,
    COALESCE(p.has_media,false),p.importance_score,p.final_score,p.delivery_decision,p.decision_reason,p.url,
    COALESCE(p.is_truncated,false),p.hydrated_at,p.created_at,p.final_x_text,p.composed_post_text,p.post_format_hint,
    p.humanized_commentary,p.commentary_hook,p.commentary_question,p.narrative_callback,p.thread_continuation,
    p.enrich_status,p.dedupe_status,p.dup_of_tweet_id,p.dup_similarity,p.dedupe_reason,a.handle,
    CASE WHEN target_tweet_id IS NOT NULL THEN 'target_fresh_gate' ELSE 'fresh_gate' END,
    EXTRACT(EPOCH FROM (now()-p.created_at))*1000,
    CASE WHEN target_tweet_id IS NOT NULL THEN 'event' ELSE 'cron' END
  FROM public.posts p JOIN public.accounts a ON a.id=p.account_id
  WHERE (target_tweet_id IS NULL OR p.tweet_id=target_tweet_id)
    AND public.delivery_cutover_allows_post(p.tweet_id)
    AND p.created_at > v_cutover AND p.created_at >= effective_cutoff
    AND p.text_translated IS NOT NULL AND btrim(p.text_translated)<>''
    AND COALESCE(
      p.x_gate_score,
      CASE WHEN p.score_breakdown->>'x_gate_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (p.score_breakdown->>'x_gate_score')::numeric END,
      CASE WHEN p.score_breakdown->>'x_gate' ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (p.score_breakdown->>'x_gate')::numeric END,
      CASE WHEN p.score_breakdown->>'base' ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (p.score_breakdown->>'base')::numeric END,
      CASE WHEN p.score_breakdown->>'ai' ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (p.score_breakdown->>'ai')::numeric END,
      p.final_score,
      p.importance_score::numeric
    ) >= min_score
    AND (NOT decision_must_deliver OR p.delivery_decision='deliver')
    AND (COALESCE(p.is_truncated,false)=false OR p.hydrated_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.x_deliveries xd WHERE xd.post_id=p.tweet_id
      AND xd.status IN ('posted','skipped','failed','posting','pending','running'))
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_video_intakes mvi
      WHERE mvi.tweet_id = p.tweet_id
        AND mvi.blocks_auto_delivery = true
        AND mvi.status NOT IN ('posted','canceled')
    )
    AND (COALESCE(p.has_media,false)=false OR EXISTS (SELECT 1 FROM public.media m
      WHERE m.tweet_id=p.tweet_id AND m.storage_path IS NOT NULL AND m.downloaded_at IS NOT NULL))
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(candidate_limit,20), max_posts_per_run, 100));
END; $$;

REVOKE ALL ON FUNCTION public.get_x_post_candidates(integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_x_post_candidates(integer,text) TO service_role;

-- Admin retry and reconciliation use this same RPC. A direct retry of a
-- historical post therefore fails before it can insert a delivery job/event.
CREATE OR REPLACE FUNCTION public.retry_step(tweet_id text, step text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE job_type text;
BEGIN
  IF step='translate' THEN job_type:='translate';
  ELSIF step='deliver' THEN
    PERFORM public.assert_delivery_cutover_post(tweet_id); job_type:='deliver';
  ELSIF step='media' THEN job_type:='download_media';
  ELSIF step='moderate' THEN job_type:='moderate';
  ELSE RAISE EXCEPTION 'Unknown step %', step; END IF;
  INSERT INTO public.jobs(type,payload,status,next_run_at)
    VALUES(job_type,jsonb_build_object('tweet_id',tweet_id,'subject_type','post','subject_id',tweet_id),'pending',now());
  INSERT INTO public.pipeline_events(subject_type,subject_id,step,status,started_at,meta)
    VALUES('post',tweet_id,step,'queued',now(),jsonb_build_object('source','rpc.retry_step'));
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.retry_step(text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_step(text,text) TO service_role;

-- Reconciliation remains useful for translation, dedupe, hydration, and
-- media work on historical posts. It must skip (rather than roll back on)
-- historical deliver-row creation and running-deliver lease mutation.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_catalog AS $$
DECLARE
  expired_leases int := 0; stale_running int := 0; missing_dedupes int := 0;
  missing_deliveries int := 0; missing_hydrations int := 0;
  missing_translates int := 0; missing_media int := 0;
  dedupe_enabled boolean := false; v_cutover timestamptz; result jsonb;
BEGIN
  v_cutover := public.get_delivery_cutover();
  SELECT COALESCE((value->>'enabled')::boolean, false) INTO dedupe_enabled
  FROM public.settings WHERE key = 'story_memory' LIMIT 1;

  UPDATE public.jobs j SET status='pending', locked_at=NULL, locked_by=NULL,
    lease_expires_at=NULL, last_error='Released: lease expired'
  WHERE j.status='running' AND j.lease_expires_at IS NOT NULL
    AND j.lease_expires_at < now()
    AND (j.type <> 'deliver' OR public.delivery_cutover_allows_job(
      j.created_at, NULLIF(btrim(j.payload->>'tweet_id'),'')
    ));
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  UPDATE public.jobs j SET status='pending', locked_at=NULL, locked_by=NULL,
    lease_expires_at=NULL, last_error='Released: stale running job without active lease'
  WHERE j.status='running' AND j.lease_expires_at IS NULL
    AND COALESCE(j.locked_at,j.created_at) < now() - interval '30 minutes'
    AND (j.type <> 'deliver' OR public.delivery_cutover_allows_job(
      j.created_at, NULLIF(btrim(j.payload->>'tweet_id'),'')
    ));
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  IF dedupe_enabled THEN
    INSERT INTO public.jobs(type,payload,status,idempotency_key,next_run_at,priority)
    SELECT 'dedupe',jsonb_build_object('tweet_id',p.tweet_id,'source','reconcile'),
      'pending','dedupe:reconcile:'||p.tweet_id,now(),11
    FROM public.posts p
    WHERE p.created_at > now()-interval '24 hours' AND p.text_original IS NOT NULL
      AND (p.dedupe_status IS NULL OR (p.dedupe_status='pending'
        AND COALESCE(p.dedupe_checked_at,p.created_at)<now()-interval '5 minutes'))
      AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe','compute_signature')
        AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS missing_dedupes = ROW_COUNT;
  END IF;

  INSERT INTO public.jobs(type,payload,status,idempotency_key,next_run_at,priority)
  SELECT 'translate',jsonb_build_object('tweet_id',p.tweet_id),'pending',
    'translate:reconcile:'||p.tweet_id,now(),10
  FROM public.posts p
  WHERE p.translated_at IS NULL AND p.text_translated IS NULL
    AND p.created_at > now()-interval '24 hours'
    AND (p.delivery_decision IS NULL OR p.delivery_decision='deliver')
    AND COALESCE(p.dedupe_status,'unique') <> 'pending'
    AND NOT (p.dedupe_status='duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status,'') NOT IN ('coverage_gap','uncertain','related_new_info')))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe','compute_signature')
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type='translate'
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  INSERT INTO public.jobs(type,payload,status,idempotency_key,next_run_at)
  SELECT 'deliver',jsonb_build_object('tweet_id',p.tweet_id),'pending',
    'deliver:reconcile:'||p.tweet_id,now()
  FROM public.posts p
  WHERE v_cutover IS NOT NULL
    AND public.delivery_cutover_allows_post(p.tweet_id)
    AND p.created_at > v_cutover
    AND p.translated_at IS NOT NULL AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision,'deliver')='deliver'
    AND COALESCE(p.dedupe_status,'unique') <> 'pending'
    AND NOT (p.dedupe_status='duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status,'') NOT IN ('coverage_gap','uncertain','related_new_info')))
    AND NOT (p.is_truncated=true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.deliveries d WHERE d.subject_type='post'
      AND d.subject_id=p.tweet_id AND d.status='posted')
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('dedupe','compute_signature')
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type='deliver'
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs(type,payload,status,idempotency_key,next_run_at,priority)
  SELECT 'hydrate_tweet',jsonb_build_object('tweet_id',p.tweet_id),'pending',
    'hydrate:reconcile:'||p.tweet_id,now(),15
  FROM public.posts p
  WHERE p.is_truncated=true AND p.hydrated_at IS NULL AND p.translated_at IS NOT NULL
    AND p.delivery_decision='deliver' AND COALESCE(p.dedupe_status,'unique') <> 'pending'
    AND NOT (p.dedupe_status='duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status,'') NOT IN ('coverage_gap','uncertain','related_new_info')))
    AND p.created_at > now()-interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type='hydrate_tweet'
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  INSERT INTO public.jobs(type,payload,status,idempotency_key,next_run_at,priority)
  SELECT 'resolve_media',jsonb_build_object('tweet_id',p.tweet_id),'pending',
    'resolve_media:reconcile:'||p.tweet_id,now(),12
  FROM public.posts p
  WHERE p.has_media=true AND p.created_at > now()-interval '24 hours'
    AND COALESCE(p.dedupe_status,'unique') <> 'pending'
    AND NOT (p.dedupe_status='duplicate' OR (p.dup_of_tweet_id IS NOT NULL
      AND COALESCE(p.dedupe_status,'') NOT IN ('coverage_gap','uncertain','related_new_info')))
    AND NOT EXISTS (SELECT 1 FROM public.media m WHERE m.tweet_id=p.tweet_id AND m.downloaded_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.type IN ('resolve_media','download_media')
      AND (j.payload->>'tweet_id')=p.tweet_id AND j.status IN ('pending','running'))
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  result := jsonb_build_object('expired_leases_released',expired_leases,
    'stale_running_released',stale_running,'missing_dedupes_created',missing_dedupes,
    'missing_translates_created',missing_translates,'missing_deliveries_created',missing_deliveries,
    'missing_hydrations_created',missing_hydrations,'missing_media_created',missing_media,
    'reconciled_at',now(),'delivery_cutover',v_cutover);
  INSERT INTO public.queue_reconcile_runs(result,expired_leases_released,stale_running_released,
    missing_dedupes_created,missing_translates_created,missing_deliveries_created,
    missing_hydrations_created,missing_media_created)
  VALUES(result,expired_leases,stale_running,missing_dedupes,missing_translates,
    missing_deliveries,missing_hydrations,missing_media);
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_jobs() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_jobs() TO postgres, service_role;

REVOKE ALL ON FUNCTION public.initialize_delivery_cutover(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_delivery_cutover() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delivery_cutover_allows_post(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delivery_cutover_allows_job(timestamptz,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_delivery_cutover_post(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_delivery_cutover(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_delivery_cutover() TO service_role;
GRANT EXECUTE ON FUNCTION public.delivery_cutover_allows_post(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delivery_cutover_allows_job(timestamptz,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_delivery_cutover_post(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_delivery_cutover_blocked(uuid,text) TO service_role;

ALTER TABLE public.delivery_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_cutover FROM public, anon, authenticated;
GRANT SELECT ON public.delivery_cutover TO service_role;

COMMIT;
