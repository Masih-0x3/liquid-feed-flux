-- Feedback must be tied to the exact render state an operator reviewed.
-- This migration is source-only until the release gate applies it before the
-- admin-actions/frontend cutover.

ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS render_revision bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_video_render_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, pg_catalog
AS $$
BEGIN
  NEW.render_revision := COALESCE(OLD.render_revision, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_video_renders_render_revision ON public.video_renders;
CREATE TRIGGER trg_video_renders_render_revision
  BEFORE UPDATE ON public.video_renders
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_video_render_revision();

CREATE OR REPLACE FUNCTION public.save_video_render_feedback_if_current(
  p_render_id uuid,
  p_expected_render_version text,
  p_expected_render_revision bigint,
  p_label text,
  p_note text,
  p_metadata jsonb,
  p_created_by uuid
)
RETURNS TABLE (
  id uuid,
  tweet_id text,
  label text,
  note text,
  created_at timestamptz,
  render_version text,
  render_revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_render public.video_renders%ROWTYPE;
BEGIN
  IF p_expected_render_version IS NULL OR btrim(p_expected_render_version) = '' THEN
    RAISE EXCEPTION 'p_expected_render_version is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_render_revision IS NULL OR p_expected_render_revision < 1 THEN
    RAISE EXCEPTION 'p_expected_render_revision must be positive'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_render
  FROM public.video_renders
  WHERE id = p_render_id
    AND render_version = btrim(p_expected_render_version)
    AND render_revision = p_expected_render_revision
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.video_render_feedback (
      render_id,
      tweet_id,
      label,
      note,
      metadata,
      created_by
    )
    VALUES (
      v_render.id,
      v_render.tweet_id,
      p_label,
      p_note,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'render_version', v_render.render_version,
        'render_revision', v_render.render_revision
      ),
      p_created_by
    )
    RETURNING id, tweet_id, label, note, created_at
  )
  SELECT
    inserted.id,
    inserted.tweet_id,
    inserted.label,
    inserted.note,
    inserted.created_at,
    v_render.render_version,
    v_render.render_revision
  FROM inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.save_video_render_feedback_if_current(
  uuid,
  text,
  bigint,
  text,
  text,
  jsonb,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_video_render_feedback_if_current(
  uuid,
  text,
  bigint,
  text,
  text,
  jsonb,
  uuid
) TO service_role;
