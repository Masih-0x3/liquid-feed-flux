-- Qualify columns that collide with RETURNS TABLE output variables.
-- Preserve the existing function signature, revision guard, owner and grants.
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

  SELECT r.*
  INTO v_render
  FROM public.video_renders AS r
  WHERE r.id = p_render_id
    AND r.render_version = btrim(p_expected_render_version)
    AND r.render_revision = p_expected_render_revision
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.video_render_feedback AS f (
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
    RETURNING f.id, f.tweet_id, f.label, f.note, f.created_at
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
