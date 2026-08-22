-- B4 / AIR-018: fence external video-render ownership across claims, lease
-- renewal, terminal writes, immutable output generations, and delivery release.

ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE public.video_renders
  DROP CONSTRAINT IF EXISTS video_renders_claim_generation_nonnegative;
ALTER TABLE public.video_renders
  ADD CONSTRAINT video_renders_claim_generation_nonnegative
  CHECK (claim_generation >= 0);

-- A renderer started before this migration cannot prove ownership under the
-- new protocol. Re-queue those rows atomically with the RPC replacement so a
-- new worker can mint a valid fence after the migration commits.
UPDATE public.video_renders
SET status = 'queued',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    claim_token = NULL,
    error = left(
      concat_ws('; ', NULLIF(error, ''), 'legacy_unfenced_claim_requeued'),
      2000
    )
WHERE status = 'running'
  AND claim_token IS NULL;

CREATE OR REPLACE FUNCTION public.claim_video_renders(
  batch_size int DEFAULT 1,
  worker_id text DEFAULT 'renderer'
)
RETURNS SETOF public.video_renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  lease_duration interval := interval '10 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.video_renders vr
  SET status = 'running',
      locked_at = now(),
      locked_by = COALESCE(NULLIF(btrim(worker_id), ''), 'renderer'),
      lease_expires_at = now() + lease_duration,
      claim_token = gen_random_uuid(),
      claim_generation = COALESCE(vr.claim_generation, 0) + 1,
      started_at = COALESCE(vr.started_at, now()),
      attempts = COALESCE(vr.attempts, 0) + 1,
      error = NULL
  WHERE vr.id IN (
    SELECT q.id
    FROM public.video_renders q
    JOIN public.media m ON m.id = q.source_media_id
    WHERE (
        q.status = 'queued'
        OR (q.status = 'running' AND q.lease_expires_at IS NOT NULL AND q.lease_expires_at < now())
      )
      AND m.storage_path IS NOT NULL
      AND COALESCE(m.mime_type, '') LIKE 'video/%'
    ORDER BY q.queued_at ASC, q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(batch_size, 1), 4))
  )
  RETURNING vr.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_video_render_by_id(
  render_id uuid,
  worker_id text DEFAULT 'renderer'
)
RETURNS SETOF public.video_renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  lease_duration interval := interval '10 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.video_renders vr
  SET status = 'running',
      locked_at = now(),
      locked_by = COALESCE(NULLIF(btrim(worker_id), ''), 'renderer'),
      lease_expires_at = now() + lease_duration,
      claim_token = gen_random_uuid(),
      claim_generation = COALESCE(vr.claim_generation, 0) + 1,
      started_at = COALESCE(vr.started_at, now()),
      attempts = COALESCE(vr.attempts, 0) + 1,
      error = NULL
  WHERE vr.id IN (
    SELECT q.id
    FROM public.video_renders q
    JOIN public.media m ON m.id = q.source_media_id
    WHERE q.id = render_id
      AND (
        q.status = 'queued'
        OR (q.status = 'running' AND q.lease_expires_at IS NOT NULL AND q.lease_expires_at < now())
      )
      AND m.storage_path IS NOT NULL
      AND COALESCE(m.mime_type, '') LIKE 'video/%'
    FOR UPDATE SKIP LOCKED
  )
  RETURNING vr.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_video_render_lease(
  p_render_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_lease_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.video_renders
  SET lease_expires_at = now() + make_interval(
        secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 600), 3600))
      ),
      locked_at = now()
  WHERE id = p_render_id
    AND status = 'running'
    AND locked_by = p_worker_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_video_render(
  uuid,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb
);
DROP FUNCTION IF EXISTS public.block_video_render(uuid,text,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.fail_video_render(uuid,text,jsonb);

CREATE FUNCTION public.complete_video_render(
  p_render_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_output_storage_path text,
  p_output_file_size bigint DEFAULT NULL,
  p_persian_srt text DEFAULT NULL,
  p_original_srt text DEFAULT NULL,
  p_ass_subtitles text DEFAULT NULL,
  p_metrics jsonb DEFAULT '{}'::jsonb,
  p_duration_ms integer DEFAULT NULL,
  p_width integer DEFAULT NULL,
  p_height integer DEFAULT NULL,
  p_source_language text DEFAULT NULL,
  p_target_language text DEFAULT NULL,
  p_translated_srt text DEFAULT NULL,
  p_preflight jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
  v_queued boolean := false;
BEGIN
  UPDATE public.video_renders
  SET status = 'completed',
      output_storage_path = p_output_storage_path,
      output_mime_type = 'video/mp4',
      output_file_size = p_output_file_size,
      persian_srt = p_persian_srt,
      translated_srt = COALESCE(p_translated_srt, p_persian_srt),
      original_srt = p_original_srt,
      ass_subtitles = p_ass_subtitles,
      metrics = COALESCE(p_metrics, '{}'::jsonb),
      preflight = COALESCE(p_preflight, '{}'::jsonb),
      source_language = p_source_language,
      target_language = p_target_language,
      duration_ms = p_duration_ms,
      width = p_width,
      height = p_height,
      error = NULL,
      block_reason = NULL,
      completed_at = now(),
      failed_at = NULL,
      blocked_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_token = NULL
  WHERE id = p_render_id
    AND status = 'running'
    AND locked_by = p_worker_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
  RETURNING tweet_id INTO v_tweet_id;

  IF v_tweet_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'stale_video_render_claim');
  END IF;

  v_queued := public._video_render_queue_delivery(v_tweet_id, 'video_render_completed');

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, ended_at, meta)
  VALUES(
    'post',
    v_tweet_id,
    'video_render',
    'completed',
    now(),
    jsonb_build_object(
      'render_id', p_render_id,
      'claim_generation', p_claim_generation,
      'output_storage_path', p_output_storage_path,
      'source_language', p_source_language,
      'target_language', p_target_language,
      'preflight', COALESCE(p_preflight, '{}'::jsonb),
      'metrics', COALESCE(p_metrics, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'tweet_id', v_tweet_id,
    'queued_deliver', v_queued,
    'dispatch_x', v_queued,
    'claim_generation', p_claim_generation
  );
END;
$$;

CREATE FUNCTION public.block_video_render(
  p_render_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_reason text,
  p_preflight jsonb DEFAULT '{}'::jsonb,
  p_metrics jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
  v_reason text := left(COALESCE(NULLIF(btrim(p_reason), ''), 'video_render_blocked'), 200);
BEGIN
  UPDATE public.video_renders
  SET status = 'blocked',
      block_reason = v_reason,
      error = v_reason,
      preflight = COALESCE(p_preflight, '{}'::jsonb),
      metrics = COALESCE(metrics, '{}'::jsonb) || COALESCE(p_metrics, '{}'::jsonb),
      blocked_at = now(),
      failed_at = NULL,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_token = NULL
  WHERE id = p_render_id
    AND status = 'running'
    AND locked_by = p_worker_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
  RETURNING tweet_id INTO v_tweet_id;

  IF v_tweet_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'stale_video_render_claim');
  END IF;

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, ended_at, error, meta)
  VALUES(
    'post',
    v_tweet_id,
    'video_render',
    'blocked',
    now(),
    v_reason,
    jsonb_build_object(
      'render_id', p_render_id,
      'claim_generation', p_claim_generation,
      'reason', v_reason,
      'preflight', COALESCE(p_preflight, '{}'::jsonb),
      'metrics', COALESCE(p_metrics, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'tweet_id', v_tweet_id,
    'queued_deliver', false,
    'dispatch_x', false,
    'blocked', true,
    'reason', v_reason,
    'claim_generation', p_claim_generation
  );
END;
$$;

CREATE FUNCTION public.fail_video_render(
  p_render_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_claim_generation bigint,
  p_error text,
  p_metrics jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_tweet_id text;
  v_policy text;
  v_queued boolean := false;
BEGIN
  UPDATE public.video_renders
  SET status = 'failed',
      error = left(COALESCE(p_error, 'unknown_error'), 2000),
      metrics = COALESCE(metrics, '{}'::jsonb) || COALESCE(p_metrics, '{}'::jsonb),
      failed_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      claim_token = NULL
  WHERE id = p_render_id
    AND status = 'running'
    AND locked_by = p_worker_id
    AND claim_token = p_claim_token
    AND claim_generation = p_claim_generation
  RETURNING tweet_id, failure_policy INTO v_tweet_id, v_policy;

  IF v_tweet_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'stale_video_render_claim');
  END IF;

  IF v_policy = 'post_original' THEN
    v_queued := public._video_render_queue_delivery(v_tweet_id, 'video_render_failed_post_original');
  END IF;

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, ended_at, error, meta)
  VALUES(
    'post',
    v_tweet_id,
    'video_render',
    'failed',
    now(),
    left(COALESCE(p_error, 'unknown_error'), 2000),
    jsonb_build_object(
      'render_id', p_render_id,
      'claim_generation', p_claim_generation,
      'failure_policy', v_policy,
      'metrics', COALESCE(p_metrics, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'accepted', true,
    'tweet_id', v_tweet_id,
    'queued_deliver', v_queued,
    'dispatch_x', v_queued,
    'claim_generation', p_claim_generation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_renders(integer,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_video_render_by_id(uuid,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_video_render_lease(uuid,text,uuid,bigint,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_video_render(uuid,text,uuid,bigint,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_video_render(uuid,text,uuid,bigint,text,jsonb,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_video_render(uuid,text,uuid,bigint,text,jsonb) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_render_by_id(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_video_render_lease(uuid,text,uuid,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_video_render(uuid,text,uuid,bigint,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_video_render(uuid,text,uuid,bigint,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_video_render(uuid,text,uuid,bigint,text,jsonb) TO service_role;
