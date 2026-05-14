-- Add following_ids to snapshots so we can compute mutual follow status
ALTER TABLE public.x_follower_snapshots
  ADD COLUMN IF NOT EXISTS following_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0;
