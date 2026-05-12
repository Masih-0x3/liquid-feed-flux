ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS score_axes jsonb,
  ADD COLUMN IF NOT EXISTS final_score numeric,
  ADD COLUMN IF NOT EXISTS decision_reason text;

CREATE INDEX IF NOT EXISTS idx_posts_final_score ON public.posts (final_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_decision_reason ON public.posts (decision_reason) WHERE decision_reason IS NOT NULL;