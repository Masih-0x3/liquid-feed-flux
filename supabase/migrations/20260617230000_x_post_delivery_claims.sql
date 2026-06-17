-- X posting idempotency: claim a delivery row before any public X side effect.
ALTER TABLE public.x_deliveries
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_source text,
  ADD COLUMN IF NOT EXISTS claim_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_release_reason text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_claim_error text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_x_deliveries_post_active_or_posted
  ON public.x_deliveries(post_id)
  WHERE status IN ('posting', 'posted');

CREATE INDEX IF NOT EXISTS idx_x_deliveries_active_claims
  ON public.x_deliveries(claim_expires_at)
  WHERE status = 'posting';

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

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status = 'posted'
  ORDER BY COALESCE(posted_at, created_at) DESC, created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'already_posted',
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id
    );
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status = 'posting'
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', CASE WHEN v_existing.claim_expires_at IS NOT NULL AND v_existing.claim_expires_at < now()
        THEN 'stale_posting'
        ELSE 'already_posting'
      END,
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_expires_at', v_existing.claim_expires_at
    );
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND AND v_existing.status IN ('pending', 'running') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'active_x_' || v_existing.status,
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id,
      'claim_expires_at', v_existing.claim_expires_at
    );
  END IF;
  IF FOUND AND v_existing.status IN ('failed', 'skipped') AND NOT COALESCE(p_force_retry, false) THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'previous_x_' || v_existing.status,
      'delivery_id', v_existing.id,
      'existing_status', v_existing.status,
      'existing_x_tweet_id', v_existing.x_tweet_id
    );
  END IF;

  INSERT INTO public.x_deliveries (
    post_id,
    status,
    attempts,
    claim_token,
    claim_source,
    claim_started_at,
    claim_expires_at,
    created_at,
    updated_at
  )
  VALUES (
    v_post_id,
    'posting',
    0,
    v_claim_token,
    v_source,
    now(),
    now() + make_interval(secs => v_ttl),
    now(),
    now()
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_delivery_id;

  IF v_delivery_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'reason', 'claimed',
      'delivery_id', v_delivery_id,
      'claim_token', v_claim_token,
      'claim_expires_at', now() + make_interval(secs => v_ttl)
    );
  END IF;

  SELECT id, status, x_tweet_id, claim_token, claim_expires_at
  INTO v_existing
  FROM public.x_deliveries
  WHERE post_id = v_post_id
    AND status IN ('posting', 'posted')
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'claimed', false,
    'reason', CASE
      WHEN v_existing.status = 'posted' THEN 'already_posted'
      WHEN v_existing.status = 'posting' THEN 'already_posting'
      ELSE 'claim_conflict'
    END,
    'delivery_id', v_existing.id,
    'existing_status', v_existing.status,
    'existing_x_tweet_id', v_existing.x_tweet_id,
    'claim_expires_at', v_existing.claim_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_x_post_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_x_tweet_id text,
  p_media_count integer DEFAULT 0,
  p_media_bytes bigint DEFAULT 0,
  p_media_kind text DEFAULT NULL,
  p_posted_at timestamptz DEFAULT now(),
  p_latency_ms integer DEFAULT NULL,
  p_api_response jsonb DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
  v_x_tweet_id text := NULLIF(btrim(COALESCE(p_x_tweet_id, '')), '');
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL OR v_x_tweet_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.x_deliveries
  SET
    status = 'posted',
    x_tweet_id = v_x_tweet_id,
    media_count = GREATEST(COALESCE(p_media_count, 0), 0),
    media_bytes = GREATEST(COALESCE(p_media_bytes, 0), 0),
    media_kind = p_media_kind,
    posted_at = COALESCE(p_posted_at, now()),
    latency_ms = p_latency_ms,
    api_response = p_api_response,
    last_error = p_last_error,
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1),
    claim_released_at = now(),
    claim_release_reason = 'completed',
    last_claim_error = NULL,
    updated_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND status = 'posting';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
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
BEGIN
  IF p_delivery_id IS NULL OR p_claim_token IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.x_deliveries
  SET
    status = v_status,
    last_error = v_error,
    last_claim_error = v_error,
    api_response = p_api_response,
    next_retry_at = p_next_retry_at,
    skip_reason = p_skip_reason,
    media_count = GREATEST(COALESCE(p_media_count, 0), 0),
    media_bytes = GREATEST(COALESCE(p_media_bytes, 0), 0),
    media_kind = p_media_kind,
    attempts = GREATEST(COALESCE(attempts, 0) + 1, 1),
    claim_released_at = now(),
    claim_release_reason = v_status,
    updated_at = now()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND status = 'posting';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_x_post_delivery(uuid,uuid,text,integer,bigint,text,timestamptz,integer,jsonb,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_x_post_delivery(uuid,uuid,text,text,jsonb,timestamptz,text,integer,bigint,text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(uuid,uuid,text,integer,bigint,text,timestamptz,integer,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(uuid,uuid,text,text,jsonb,timestamptz,text,integer,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_x_post_candidates(
  candidate_limit int DEFAULT 20,
  target_tweet_id text DEFAULT NULL
)
RETURNS TABLE (
  tweet_id text,
  text_translated text,
  text_original text,
  author_handle text,
  has_media boolean,
  importance_score integer,
  final_score numeric,
  delivery_decision text,
  decision_reason text,
  url text,
  is_truncated boolean,
  hydrated_at timestamptz,
  created_at timestamptz,
  final_x_text text,
  composed_post_text text,
  post_format_hint text,
  humanized_commentary text,
  commentary_hook text,
  commentary_question text,
  narrative_callback text,
  thread_continuation text,
  enrich_status text,
  dedupe_status text,
  dup_of_tweet_id text,
  dup_similarity numeric,
  dedupe_reason text,
  account_handle text,
  candidate_reason text,
  candidate_age_ms numeric,
  dispatch_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  x_cfg jsonb := '{}'::jsonb;
  min_score numeric := 14;
  decision_must_deliver boolean := true;
  dedupe_hours integer := 48;
  dedupe_cutoff timestamptz;
  start_from timestamptz := NULL;
  effective_cutoff timestamptz;
BEGIN
  SELECT COALESCE(value::jsonb, '{}'::jsonb)
  INTO x_cfg
  FROM public.settings
  WHERE key = 'x_posting_config';

  x_cfg := COALESCE(x_cfg, '{}'::jsonb);
  min_score := COALESCE(NULLIF(x_cfg->>'min_score', '')::numeric, 14);
  decision_must_deliver := COALESCE(NULLIF(x_cfg->>'post_only_decision_deliver', '')::boolean, true);
  dedupe_hours := GREATEST(1, COALESCE(NULLIF(x_cfg->>'dedupe_window_hours', '')::integer, 48));
  dedupe_cutoff := now() - make_interval(hours => dedupe_hours);

  BEGIN
    start_from := NULLIF(x_cfg->>'start_posting_from', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    start_from := NULL;
  END;

  effective_cutoff := GREATEST(dedupe_cutoff, COALESCE(start_from, dedupe_cutoff));

  RETURN QUERY
  SELECT
    p.tweet_id,
    p.text_translated,
    p.text_original,
    p.author_handle,
    COALESCE(p.has_media, false),
    p.importance_score,
    p.final_score,
    p.delivery_decision,
    p.decision_reason,
    p.url,
    COALESCE(p.is_truncated, false),
    p.hydrated_at,
    p.created_at,
    p.final_x_text,
    p.composed_post_text,
    p.post_format_hint,
    p.humanized_commentary,
    p.commentary_hook,
    p.commentary_question,
    p.narrative_callback,
    p.thread_continuation,
    p.enrich_status,
    p.dedupe_status,
    p.dup_of_tweet_id,
    p.dup_similarity,
    p.dedupe_reason,
    a.handle AS account_handle,
    CASE
      WHEN target_tweet_id IS NOT NULL THEN 'target_normal_gate'
      ELSE 'normal_gate'
    END AS candidate_reason,
    EXTRACT(EPOCH FROM (now() - p.created_at)) * 1000 AS candidate_age_ms,
    CASE
      WHEN target_tweet_id IS NOT NULL THEN 'event'
      ELSE 'cron'
    END AS dispatch_source
  FROM public.posts p
  JOIN public.accounts a ON a.id = p.account_id
  WHERE (target_tweet_id IS NULL OR p.tweet_id = target_tweet_id)
    AND p.created_at >= effective_cutoff
    AND p.text_translated IS NOT NULL
    AND btrim(p.text_translated) <> ''
    AND COALESCE(p.final_score, p.importance_score::numeric) >= min_score
    AND (NOT decision_must_deliver OR p.delivery_decision = 'deliver')
    AND (COALESCE(p.is_truncated, false) = false OR p.hydrated_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.x_deliveries xd
      WHERE xd.post_id = p.tweet_id
        AND xd.status IN ('posting', 'posted', 'pending', 'running', 'skipped', 'failed')
    )
    AND (
      COALESCE(p.has_media, false) = false
      OR EXISTS (
        SELECT 1
        FROM public.media m
        WHERE m.tweet_id = p.tweet_id
          AND m.storage_path IS NOT NULL
          AND m.downloaded_at IS NOT NULL
      )
    )
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(candidate_limit, 20), 100));
END;
$$;

REVOKE ALL ON FUNCTION public.get_x_post_candidates(integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_x_post_candidates(integer,text) TO service_role;
