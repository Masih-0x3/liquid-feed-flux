-- Production Persian video render gate.
-- Supabase owns queue state and posting release; external Ubuntu renderers own
-- OpenAI/ffmpeg work and write processed MP4s back into temp-media/processed.

CREATE TABLE IF NOT EXISTS public.video_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id text NOT NULL REFERENCES public.posts(tweet_id) ON DELETE CASCADE,
  source_media_id uuid NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired', 'blocked')),
  failure_policy text NOT NULL DEFAULT 'post_original'
    CHECK (failure_policy IN ('post_original', 'block')),
  render_version text NOT NULL DEFAULT 'persian-subtitles-masihh-v1',
  output_storage_path text,
  output_mime_type text DEFAULT 'video/mp4',
  output_file_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  original_srt text,
  persian_srt text,
  translated_srt text,
  ass_subtitles text,
  source_language text,
  target_language text,
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  block_reason text,
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  blocked_at timestamptz,
  posted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.video_render_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id uuid NOT NULL REFERENCES public.video_renders(id) ON DELETE CASCADE,
  tweet_id text NOT NULL REFERENCES public.posts(tweet_id) ON DELETE CASCADE,
  label text NOT NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.video_renderer_heartbeats (
  renderer_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'online'
    CHECK (status IN ('online', 'draining', 'paused', 'offline', 'error')),
  version text,
  render_version text,
  running integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_render_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_renderer_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view video renders" ON public.video_renders;
CREATE POLICY "Users can view video renders"
ON public.video_renders
FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role can manage video renders" ON public.video_renders;
CREATE POLICY "Service role can manage video renders"
ON public.video_renders
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.video_renders TO authenticated;
GRANT ALL ON public.video_renders TO service_role;

DROP POLICY IF EXISTS "Users can view video render feedback" ON public.video_render_feedback;
CREATE POLICY "Users can view video render feedback"
ON public.video_render_feedback
FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role can manage video render feedback" ON public.video_render_feedback;
CREATE POLICY "Service role can manage video render feedback"
ON public.video_render_feedback
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.video_render_feedback TO authenticated;
GRANT ALL ON public.video_render_feedback TO service_role;

DROP POLICY IF EXISTS "Users can view video renderer heartbeats" ON public.video_renderer_heartbeats;
CREATE POLICY "Users can view video renderer heartbeats"
ON public.video_renderer_heartbeats
FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role can manage video renderer heartbeats" ON public.video_renderer_heartbeats;
CREATE POLICY "Service role can manage video renderer heartbeats"
ON public.video_renderer_heartbeats
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.video_renderer_heartbeats TO authenticated;
GRANT ALL ON public.video_renderer_heartbeats TO service_role;

DROP TRIGGER IF EXISTS trg_video_renders_updated_at ON public.video_renders;
CREATE TRIGGER trg_video_renders_updated_at
  BEFORE UPDATE ON public.video_renders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_video_renderer_heartbeats_updated_at ON public.video_renderer_heartbeats;
CREATE TRIGGER trg_video_renderer_heartbeats_updated_at
  BEFORE UPDATE ON public.video_renderer_heartbeats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.video_renders
  DROP CONSTRAINT IF EXISTS video_renders_source_version_key;
ALTER TABLE public.video_renders
  ADD CONSTRAINT video_renders_source_version_key UNIQUE (source_media_id, render_version);

CREATE INDEX IF NOT EXISTS idx_video_renders_status_lease
  ON public.video_renders (status, lease_expires_at, queued_at);

CREATE INDEX IF NOT EXISTS idx_video_renders_tweet_status
  ON public.video_renders (tweet_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_renders_expiry
  ON public.video_renders (expires_at)
  WHERE status = 'completed' AND output_storage_path IS NOT NULL AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_renders_blocked
  ON public.video_renders (status, blocked_at DESC)
  WHERE status = 'blocked';

CREATE INDEX IF NOT EXISTS idx_video_render_feedback_render_created
  ON public.video_render_feedback (render_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_renderer_heartbeats_seen
  ON public.video_renderer_heartbeats (last_seen_at DESC);

INSERT INTO public.settings (key, value, description, updated_at)
VALUES (
  'video_render_config',
  '{
    "mode": "disabled",
    "enabled": false,
    "render_version": "persian-subtitles-masihh-v1",
    "failure_policy": "post_original",
    "retention_hours": 24,
    "renderer_url": null,
    "transcription_provider": "deepgram",
    "transcription_model": "nova-3",
    "translation_model": "gpt-5.4-mini",
    "vision_model": "gpt-5.4-mini",
    "target_language_rule": "fa_except_fa_to_en",
    "subtitle_style": {
      "text_color": "#FFE45C",
      "background_color": "#000000",
      "font_scale": 1.18,
      "max_width_pct": 0.92,
      "bottom_padding_pct": 0.06,
      "collision_gap_pct": 0.015
    },
    "delogo": {
      "vision_mode": "always",
      "engine": "opencv",
      "max_regions": 2,
      "max_single_area_ratio": 0.10,
      "max_total_area_ratio": 0.15,
      "opencv_radius": 2,
      "opencv_kernel": 7,
      "opencv_dilate_iterations": 2,
      "opencv_feather": 0
    },
    "watermark": {
      "apply_when": "subtitle_track",
      "opacity": 0.16,
      "top_right_opacity": 0.34,
      "cover_opacity": 0.34,
      "multiple": true,
      "cover_delogo": true,
      "cover_padding_pct": 0
    }
  }'::jsonb,
  'Video subtitle, delogo, and @Masihh watermark renderer configuration',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value || public.settings.value,
    description = EXCLUDED.description,
    updated_at = now();

UPDATE storage.buckets
SET file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 536870912),
    allowed_mime_types = (
      SELECT array_agg(DISTINCT mime ORDER BY mime)
      FROM unnest(
        COALESCE(allowed_mime_types, ARRAY[]::text[]) || ARRAY[
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/webm',
          'video/quicktime',
          'audio/mp3',
          'audio/wav',
          'audio/ogg'
        ]::text[]
      ) AS merged(mime)
    )
WHERE id = 'temp-media';

CREATE OR REPLACE FUNCTION public._video_render_should_release(p_tweet_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  WITH cfg AS (
    SELECT COALESCE(
      s.value->>'mode',
      CASE WHEN s.value->>'enabled' = 'true' THEN 'enabled' ELSE 'disabled' END
    ) AS mode
    FROM public.settings s
    WHERE s.key = 'video_render_config'
  )
  SELECT COALESCE((SELECT mode FROM cfg), 'disabled') = 'enabled'
    AND EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.tweet_id = p_tweet_id
        AND p.delivery_decision = 'deliver'
        AND p.text_translated IS NOT NULL
        AND btrim(p.text_translated) <> ''
        AND (COALESCE(p.is_truncated, false) = false OR p.hydrated_at IS NOT NULL)
    );
$$;

CREATE OR REPLACE FUNCTION public._video_render_queue_delivery(p_tweet_id text, p_source text DEFAULT 'video_render')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  should_release boolean;
BEGIN
  should_release := public._video_render_should_release(p_tweet_id);
  IF NOT should_release THEN
    RETURN false;
  END IF;

  INSERT INTO public.jobs (
    type, payload, status, priority, idempotency_key, next_run_at,
    locked_at, locked_by, lease_expires_at, last_error, attempts
  )
  VALUES (
    'deliver',
    jsonb_build_object('tweet_id', p_tweet_id, 'source', p_source),
    'pending',
    20,
    'deliver:' || p_tweet_id,
    now(),
    NULL,
    NULL,
    NULL,
    NULL,
    0
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET status = 'pending',
      next_run_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      attempts = 0,
      priority = GREATEST(public.jobs.priority, EXCLUDED.priority);

  INSERT INTO public.deliveries (subject_type, subject_id, status, attempts)
  SELECT 'post', p_tweet_id, 'pending', 0
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.subject_type = 'post'
      AND d.subject_id = p_tweet_id
      AND d.status IN ('pending', 'posted')
  );

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, started_at, meta)
  VALUES('post', p_tweet_id, 'deliver', 'queued', now(), jsonb_build_object('source', p_source))
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_video_render(
  p_tweet_id text,
  p_source_media_id uuid,
  p_render_version text DEFAULT 'persian-subtitles-masihh-v1',
  p_failure_policy text DEFAULT 'post_original'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_failure_policy NOT IN ('post_original', 'block') THEN
    RAISE EXCEPTION 'Invalid failure policy: %', p_failure_policy;
  END IF;

  INSERT INTO public.video_renders (
    tweet_id, source_media_id, status, failure_policy, render_version,
    queued_at, error, locked_at, locked_by, lease_expires_at
  )
  VALUES (
    p_tweet_id, p_source_media_id, 'queued', p_failure_policy, p_render_version,
    now(), NULL, NULL, NULL, NULL
  )
  ON CONFLICT (source_media_id, render_version) DO UPDATE
  SET tweet_id = EXCLUDED.tweet_id,
      failure_policy = EXCLUDED.failure_policy,
      status = CASE
        WHEN public.video_renders.status IN ('expired') THEN 'queued'
        ELSE public.video_renders.status
      END,
      queued_at = CASE
        WHEN public.video_renders.status IN ('expired') THEN now()
        ELSE public.video_renders.queued_at
      END,
      error = CASE
        WHEN public.video_renders.status IN ('expired') THEN NULL
        ELSE public.video_renders.error
      END,
      locked_at = CASE
        WHEN public.video_renders.status IN ('expired') THEN NULL
        ELSE public.video_renders.locked_at
      END,
      locked_by = CASE
        WHEN public.video_renders.status IN ('expired') THEN NULL
        ELSE public.video_renders.locked_by
      END,
      lease_expires_at = CASE
        WHEN public.video_renders.status IN ('expired') THEN NULL
        ELSE public.video_renders.lease_expires_at
      END
  RETURNING id INTO v_id;

  INSERT INTO public.pipeline_events(subject_type, subject_id, step, status, started_at, meta)
  VALUES(
    'post',
    p_tweet_id,
    'video_render',
    'queued',
    now(),
    jsonb_build_object('render_id', v_id, 'source_media_id', p_source_media_id, 'render_version', p_render_version)
  )
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$$;

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
      locked_by = worker_id,
      lease_expires_at = now() + lease_duration,
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
      locked_by = worker_id,
      lease_expires_at = now() + lease_duration,
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

CREATE OR REPLACE FUNCTION public.complete_video_render(
  p_render_id uuid,
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
      lease_expires_at = NULL
  WHERE id = p_render_id
  RETURNING tweet_id INTO v_tweet_id;

  IF v_tweet_id IS NULL THEN
    RAISE EXCEPTION 'video render not found: %', p_render_id;
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
      'output_storage_path', p_output_storage_path,
      'source_language', p_source_language,
      'target_language', p_target_language,
      'preflight', COALESCE(p_preflight, '{}'::jsonb),
      'metrics', COALESCE(p_metrics, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'tweet_id', v_tweet_id,
    'queued_deliver', v_queued,
    'dispatch_x', v_queued
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.block_video_render(
  p_render_id uuid,
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
      lease_expires_at = NULL
  WHERE id = p_render_id
  RETURNING tweet_id INTO v_tweet_id;

  IF v_tweet_id IS NULL THEN
    RAISE EXCEPTION 'video render not found: %', p_render_id;
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
      'reason', v_reason,
      'preflight', COALESCE(p_preflight, '{}'::jsonb),
      'metrics', COALESCE(p_metrics, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'tweet_id', v_tweet_id,
    'queued_deliver', false,
    'dispatch_x', false,
    'blocked', true,
    'reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_video_render(
  p_render_id uuid,
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
      lease_expires_at = NULL
  WHERE id = p_render_id
  RETURNING tweet_id, failure_policy INTO v_tweet_id, v_policy;

  IF v_tweet_id IS NULL THEN
    RAISE EXCEPTION 'video render not found: %', p_render_id;
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
    jsonb_build_object('render_id', p_render_id, 'failure_policy', v_policy, 'metrics', COALESCE(p_metrics, '{}'::jsonb))
  );

  RETURN jsonb_build_object(
    'tweet_id', v_tweet_id,
    'queued_deliver', v_queued,
    'dispatch_x', v_queued
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_video_render_posted(
  p_tweet_id text,
  p_retention_hours integer DEFAULT 24
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.video_renders
  SET posted_at = COALESCE(posted_at, now()),
      expires_at = COALESCE(expires_at, now() + make_interval(hours => GREATEST(1, COALESCE(p_retention_hours, 24))))
  WHERE tweet_id = p_tweet_id
    AND status = 'completed'
    AND output_storage_path IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_expired_video_render_paths(limit_count integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  output_storage_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  SELECT vr.id, vr.output_storage_path
  FROM public.video_renders vr
  WHERE vr.status = 'completed'
    AND vr.output_storage_path IS NOT NULL
    AND vr.expires_at IS NOT NULL
    AND vr.expires_at <= now()
  ORDER BY vr.expires_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(limit_count, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.mark_video_renders_expired(render_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.video_renders
  SET status = 'expired',
      metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('expired_storage_path', output_storage_path, 'expired_at', now()),
      output_storage_path = NULL,
      output_file_size = NULL
  WHERE id = ANY(render_ids)
    AND status = 'completed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._video_render_should_release(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._video_render_queue_delivery(text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_video_render(text,uuid,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_video_renders(integer,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_video_render_by_id(uuid,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_video_render(uuid,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_video_render(uuid,text,jsonb,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_video_render(uuid,text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_video_render_posted(text,integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_expired_video_render_paths(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_video_renders_expired(uuid[]) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._video_render_should_release(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._video_render_queue_delivery(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_video_render(text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_render_by_id(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_video_render(uuid,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_video_render(uuid,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_video_render(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_render_posted(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_expired_video_render_paths(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_renders_expired(uuid[]) TO service_role;
