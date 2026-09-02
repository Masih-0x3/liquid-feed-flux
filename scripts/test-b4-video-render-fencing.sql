\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE public.media (
  id uuid PRIMARY KEY,
  storage_path text,
  mime_type text
);

CREATE TABLE public.video_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id text NOT NULL,
  source_media_id uuid NOT NULL REFERENCES public.media(id),
  status text NOT NULL DEFAULT 'queued',
  failure_policy text NOT NULL DEFAULT 'post_original',
  render_version text NOT NULL DEFAULT 'renderer-v2',
  output_storage_path text,
  output_mime_type text,
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

CREATE TABLE public.pipeline_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_type text,
  subject_id text,
  step text,
  status text,
  ended_at timestamptz,
  error text,
  meta jsonb
);

CREATE TABLE public.delivery_release_calls (
  tweet_id text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public._video_render_queue_delivery(
  p_tweet_id text,
  p_source text DEFAULT 'video_render'
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.delivery_release_calls(tweet_id, source)
  VALUES (p_tweet_id, p_source);
  RETURN true;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END;
$$;

INSERT INTO public.media(id, storage_path, mime_type) VALUES
  ('10000000-0000-4000-8000-000000000001', 'source/a.mp4', 'video/mp4'),
  ('10000000-0000-4000-8000-000000000002', 'source/b.mp4', 'video/mp4'),
  ('10000000-0000-4000-8000-000000000003', 'source/c.mp4', 'video/mp4'),
  ('10000000-0000-4000-8000-000000000004', 'source/d.mp4', 'video/mp4');

INSERT INTO public.video_renders(
  id, tweet_id, source_media_id, status, locked_by, lease_expires_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'tweet-complete',
    '10000000-0000-4000-8000-000000000001',
    'running',
    'legacy-worker',
    now() + interval '10 minutes'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'tweet-block',
    '10000000-0000-4000-8000-000000000002',
    'queued',
    NULL,
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'tweet-fail',
    '10000000-0000-4000-8000-000000000003',
    'queued',
    NULL,
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'tweet-renew-expired',
    '10000000-0000-4000-8000-000000000004',
    'queued',
    NULL,
    NULL
  );

\ir ../supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql

DO $$
DECLARE
  v_claim_a public.video_renders;
  v_claim_b public.video_renders;
  v_claim_block public.video_renders;
  v_claim_fail public.video_renders;
  v_claim_expired public.video_renders;
  v_result jsonb;
  v_count integer;
BEGIN
  IF (SELECT status FROM public.video_renders WHERE id = '20000000-0000-4000-8000-000000000001') <> 'queued' THEN
    RAISE EXCEPTION 'legacy unfenced running claim was not requeued';
  END IF;

  SELECT * INTO v_claim_a
  FROM public.claim_video_render_by_id(
    '20000000-0000-4000-8000-000000000001',
    'renderer-a'
  );
  IF v_claim_a.claim_token IS NULL OR v_claim_a.claim_generation <> 1 THEN
    RAISE EXCEPTION 'first claim did not mint token generation 1';
  END IF;
  IF NOT public.renew_video_render_lease(
    v_claim_a.id, 'renderer-a', v_claim_a.claim_token, v_claim_a.claim_generation, 600
  ) THEN
    RAISE EXCEPTION 'current claim renewal was rejected';
  END IF;
  IF public.renew_video_render_lease(
    v_claim_a.id, 'renderer-a', gen_random_uuid(), v_claim_a.claim_generation, 600
  ) THEN
    RAISE EXCEPTION 'stale-token renewal was accepted';
  END IF;
  IF public.renew_video_render_lease(
    v_claim_a.id, 'renderer-a', v_claim_a.claim_token, v_claim_a.claim_generation + 1, 600
  ) THEN
    RAISE EXCEPTION 'stale-generation renewal was accepted';
  END IF;

  UPDATE public.video_renders
  SET lease_expires_at = now() - interval '1 second'
  WHERE id = v_claim_a.id;
  SELECT * INTO v_claim_b
  FROM public.claim_video_render_by_id(v_claim_a.id, 'renderer-b');
  IF v_claim_b.claim_token = v_claim_a.claim_token OR v_claim_b.claim_generation <> 2 THEN
    RAISE EXCEPTION 'expired reclaim did not rotate the fence';
  END IF;

  v_result := public.complete_video_render(
    v_claim_a.id,
    'renderer-a',
    v_claim_a.claim_token,
    v_claim_a.claim_generation,
    'processed/renderer-v2/2026/08/tweet-complete/' || v_claim_a.id || '/g1.mp4'
  );
  IF COALESCE((v_result->>'accepted')::boolean, false) THEN
    RAISE EXCEPTION 'stale worker completed a reclaimed render';
  END IF;
  SELECT count(*) INTO v_count FROM public.delivery_release_calls;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'stale completion released downstream delivery';
  END IF;

  v_result := public.complete_video_render(
    v_claim_b.id,
    'renderer-b',
    v_claim_b.claim_token,
    v_claim_b.claim_generation,
    'processed/renderer-v2/2026/08/tweet-complete/' || v_claim_b.id || '/g2.mp4'
  );
  IF NOT COALESCE((v_result->>'accepted')::boolean, false) THEN
    RAISE EXCEPTION 'current worker completion was rejected';
  END IF;
  IF (SELECT output_storage_path FROM public.video_renders WHERE id = v_claim_b.id) NOT LIKE '%/g2.mp4' THEN
    RAISE EXCEPTION 'current generation output was not persisted';
  END IF;

  v_result := public.complete_video_render(
    v_claim_b.id,
    'renderer-b',
    v_claim_b.claim_token,
    v_claim_b.claim_generation,
    'processed/duplicate.mp4'
  );
  IF COALESCE((v_result->>'accepted')::boolean, false) THEN
    RAISE EXCEPTION 'double completion was accepted';
  END IF;
  SELECT count(*) INTO v_count FROM public.delivery_release_calls;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'double completion duplicated delivery release';
  END IF;

  SELECT * INTO v_claim_block
  FROM public.claim_video_render_by_id(
    '20000000-0000-4000-8000-000000000002',
    'renderer-a'
  );
  v_result := public.block_video_render(
    v_claim_block.id,
    'renderer-a',
    v_claim_block.claim_token,
    v_claim_block.claim_generation,
    'unsafe_overlay'
  );
  IF NOT COALESCE((v_result->>'accepted')::boolean, false) OR
     (SELECT status FROM public.video_renders WHERE id = v_claim_block.id) <> 'blocked' THEN
    RAISE EXCEPTION 'current block was not accepted';
  END IF;
  v_result := public.fail_video_render(
    v_claim_block.id,
    'renderer-a',
    v_claim_block.claim_token,
    v_claim_block.claim_generation,
    'late failure'
  );
  IF COALESCE((v_result->>'accepted')::boolean, false) THEN
    RAISE EXCEPTION 'fail after block was accepted';
  END IF;

  SELECT * INTO v_claim_fail
  FROM public.claim_video_render_by_id(
    '20000000-0000-4000-8000-000000000003',
    'renderer-a'
  );
  v_result := public.fail_video_render(
    v_claim_fail.id,
    'renderer-a',
    v_claim_fail.claim_token,
    v_claim_fail.claim_generation,
    'ffmpeg failed'
  );
  IF NOT COALESCE((v_result->>'accepted')::boolean, false) OR
     (SELECT status FROM public.video_renders WHERE id = v_claim_fail.id) <> 'failed' THEN
    RAISE EXCEPTION 'current failure was not accepted';
  END IF;

  SELECT * INTO v_claim_expired
  FROM public.claim_video_render_by_id(
    '20000000-0000-4000-8000-000000000004',
    'renderer-a'
  );
  UPDATE public.video_renders
  SET lease_expires_at = now() - interval '1 second'
  WHERE id = v_claim_expired.id;
  IF public.renew_video_render_lease(
    v_claim_expired.id,
    'renderer-a',
    v_claim_expired.claim_token,
    v_claim_expired.claim_generation,
    600
  ) THEN
    RAISE EXCEPTION 'expired lease was resurrected by renewal';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.pipeline_events
  WHERE step = 'video_render';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'expected exactly three accepted terminal events, got %', v_count;
  END IF;
END;
$$;

SELECT 'B4_VIDEO_RENDER_FENCE_SQL_PASS' AS result;
