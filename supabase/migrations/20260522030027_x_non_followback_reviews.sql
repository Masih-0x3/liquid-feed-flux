-- Persistent review state for the non-API "people I follow who do not follow me"
-- workflow in My X. This table stores human review/opening state only; it does
-- not automate X actions and does not trigger any X API usage.

CREATE TABLE IF NOT EXISTS public.x_non_followback_reviews (
  user_id text PRIMARY KEY,
  username text,
  name text,
  profile_image_url text,
  status text NOT NULL DEFAULT 'opened',
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  opened_count integer NOT NULL DEFAULT 0,
  reviewed_at timestamptz,
  reviewed_by uuid DEFAULT auth.uid(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT x_non_followback_reviews_status_check
    CHECK (status IN ('opened', 'kept', 'unfollowed_manually', 'skipped', 'whitelisted')),
  CONSTRAINT x_non_followback_reviews_opened_count_check
    CHECK (opened_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_x_non_followback_reviews_status
  ON public.x_non_followback_reviews (status);

CREATE INDEX IF NOT EXISTS idx_x_non_followback_reviews_last_opened_at
  ON public.x_non_followback_reviews (last_opened_at DESC)
  WHERE last_opened_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x_non_followback_reviews_reviewed_at
  ON public.x_non_followback_reviews (reviewed_at DESC)
  WHERE reviewed_at IS NOT NULL;

ALTER TABLE public.x_non_followback_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage x_non_followback_reviews" ON public.x_non_followback_reviews;
CREATE POLICY "Admins can manage x_non_followback_reviews"
  ON public.x_non_followback_reviews
  FOR ALL
  TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP TRIGGER IF EXISTS trg_x_non_followback_reviews_updated_at ON public.x_non_followback_reviews;
CREATE TRIGGER trg_x_non_followback_reviews_updated_at
  BEFORE UPDATE ON public.x_non_followback_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.x_non_followback_reviews TO authenticated;
