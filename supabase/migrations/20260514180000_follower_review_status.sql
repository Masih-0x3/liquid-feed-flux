-- Add reviewed boolean to x_follower_changes for daily unfollower review workflow
ALTER TABLE public.x_follower_changes
  ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_x_follower_changes_unreviewed
  ON public.x_follower_changes (detected_at DESC)
  WHERE change_type = 'unfollowed' AND reviewed = false;
