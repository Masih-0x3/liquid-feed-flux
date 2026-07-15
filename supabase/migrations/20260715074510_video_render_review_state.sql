-- Preserve the real render outcome while giving operators a reversible way to
-- clear historical failed/blocked rows from the actionable Video queue.

ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_renders'::regclass
      AND conname = 'video_renders_review_state_check'
  ) THEN
    ALTER TABLE public.video_renders
      ADD CONSTRAINT video_renders_review_state_check
      CHECK (reviewed_at IS NOT NULL OR reviewed_by IS NULL)
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.video_renders
  VALIDATE CONSTRAINT video_renders_review_state_check;

CREATE INDEX IF NOT EXISTS idx_video_renders_unreviewed_issues
  ON public.video_renders (updated_at DESC)
  WHERE status IN ('failed', 'blocked') AND reviewed_at IS NULL;

COMMENT ON COLUMN public.video_renders.reviewed_at IS
  'Operator acknowledgement time for failed or blocked renders; does not change render status.';

COMMENT ON COLUMN public.video_renders.reviewed_by IS
  'Authenticated admin user who last acknowledged the failed or blocked render.';
