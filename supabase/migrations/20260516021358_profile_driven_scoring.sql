-- Profile-driven scoring v2
-- Adds explicit audience-fit state, labeled examples, and evaluation storage.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS scoring_version text,
  ADD COLUMN IF NOT EXISTS scoring_profile_id text,
  ADD COLUMN IF NOT EXISTS audience_class text,
  ADD COLUMN IF NOT EXISTS audience_confidence numeric,
  ADD COLUMN IF NOT EXISTS audience_reason text,
  ADD COLUMN IF NOT EXISTS global_exception_class text,
  ADD COLUMN IF NOT EXISTS score_review_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_audience_class_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_audience_class_check
      CHECK (audience_class IS NULL OR audience_class IN ('direct_focus', 'adjacent', 'global_exception', 'off_topic'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_score_review_status_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_score_review_status_check
      CHECK (score_review_status IS NULL OR score_review_status IN ('none', 'shadow', 'needs_review', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_audience_confidence_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_audience_confidence_check
      CHECK (audience_confidence IS NULL OR (audience_confidence >= 0 AND audience_confidence <= 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_scoring_profile
  ON public.posts (scoring_profile_id, created_at DESC)
  WHERE scoring_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_audience_class
  ON public.posts (audience_class, created_at DESC)
  WHERE audience_class IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_score_review_status
  ON public.posts (score_review_status, created_at DESC)
  WHERE score_review_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.scoring_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id text REFERENCES public.posts(tweet_id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'admin',
  profile_id text NOT NULL,
  text_original text NOT NULL,
  author_handle text,
  expected_audience_class text NOT NULL CHECK (expected_audience_class IN ('direct_focus', 'adjacent', 'global_exception', 'off_topic')),
  expected_decision text NOT NULL CHECK (expected_decision IN ('deliver', 'skip', 'review')),
  expected_score numeric CHECK (expected_score IS NULL OR (expected_score >= 1 AND expected_score <= 20)),
  expected_global_exception_class text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scoring_examples_profile_created
  ON public.scoring_examples (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scoring_examples_tweet
  ON public.scoring_examples (tweet_id)
  WHERE tweet_id IS NOT NULL;

ALTER TABLE public.scoring_examples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage scoring_examples" ON public.scoring_examples;
CREATE POLICY "Admins can manage scoring_examples"
  ON public.scoring_examples
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.scoring_examples FROM anon, authenticated;
GRANT ALL ON public.scoring_examples TO service_role;

CREATE TABLE IF NOT EXISTS public.scoring_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text NOT NULL,
  scoring_version text NOT NULL,
  model text NOT NULL,
  example_count integer NOT NULL DEFAULT 0,
  accuracy numeric,
  false_positive_count integer NOT NULL DEFAULT 0,
  false_negative_count integer NOT NULL DEFAULT 0,
  ambiguous_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}',
  results jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scoring_evaluations_profile_created
  ON public.scoring_evaluations (profile_id, created_at DESC);

ALTER TABLE public.scoring_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage scoring_evaluations" ON public.scoring_evaluations;
CREATE POLICY "Admins can manage scoring_evaluations"
  ON public.scoring_evaluations
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.scoring_evaluations FROM anon, authenticated;
GRANT ALL ON public.scoring_evaluations TO service_role;

INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'scoring_policy',
  '{
    "enabled": false,
    "version": "audience-fit-v2",
    "mode": "shadow",
    "active_profile_id": "iran-first",
    "profiles": [
      {
        "id": "iran-first",
        "name": "Iran-first",
        "audience_description": "Iranian audiences on X who want concise, high-signal updates about Iran, Iran-adjacent geopolitics, and exceptional global events that materially affect politics, security, oil, markets, or public attention.",
        "focus_entities": ["Iran", "Islamic Republic", "IRGC", "Quds Force", "Iran nuclear program", "Hormuz", "Persian Gulf", "sanctions on Iran", "Israel-Iran", "US-Iran", "Hezbollah", "Houthis", "Iraqi PMF"],
        "aliases": ["Tehran", "Khamenei", "IRGC", "Sepah", "JCPOA", "Persian Gulf", "Strait of Hormuz"],
        "geographies": ["Iran", "Middle East", "Persian Gulf", "Iraq", "Syria", "Lebanon", "Yemen", "Israel", "GCC"],
        "blocked_categories": ["sports", "entertainment", "celebrity", "weather", "product launch", "routine tech earnings"],
        "prompt_notes": "Do not down-score an item merely because the speaker or dateline is American or Western. Score the subject matter and audience value. Related world events pass only when they are major enough that an Iran-focused audience would reasonably expect coverage.",
        "thresholds": {
          "direct_focus": { "threshold": 12, "cap": 20 },
          "adjacent": { "threshold": 13, "cap": 16 },
          "global_exception": { "threshold": 15, "cap": 16 },
          "off_topic": { "threshold": 99, "cap": 8 }
        },
        "global_exceptions": [
          { "id": "world_shock", "label": "World shock", "description": "Coup, war outbreak, assassination, regime change, major terror attack, or systemic event with global attention.", "cap": 18, "threshold": 15, "examples": ["coup d etat", "prime minister assassination", "new war", "major terror attack"] },
          { "id": "oil_energy", "label": "Oil / energy shock", "description": "Major oil, gas, shipping, OPEC, or energy-security event that may affect Iran, the region, or global markets.", "cap": 16, "threshold": 15, "examples": ["oil price shock", "OPEC surprise cut", "prime minister comments on oil supply"] },
          { "id": "bitcoin_milestone", "label": "Bitcoin milestone", "description": "Major Bitcoin price or policy milestone large enough to become a broad political/economic story.", "cap": 16, "threshold": 15, "examples": ["Bitcoin breaks a major all-time high", "country adopts Bitcoin reserve"] },
          { "id": "major_leader_statement", "label": "Major leader statement", "description": "A prime minister, president, monarch, foreign minister, or central-bank head makes a material comment on war, oil, sanctions, or regional security.", "cap": 16, "threshold": 15, "examples": ["prime minister comments on oil", "president announces sanctions strategy"] }
        ],
        "axis_weights": {
          "focus_relevance": 1.8,
          "geopolitical_weight": 1.35,
          "audience_value": 1.2,
          "materiality": 1.25,
          "freshness": 0.8,
          "credibility": 0.7,
          "noise_penalty": 1.0
        },
        "author_overrides": {}
      }
    ],
    "adjudication": {
      "enabled": true,
      "model": "gpt-5.4-mini",
      "reasoning_effort": "low",
      "verbosity": "low",
      "confidence_threshold": 0.72,
      "borderline_margin": 1.0
    },
    "learning": {
      "mode": "shadow",
      "min_examples": 8,
      "max_adjustment": 2
    }
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- The existing check constraint was created before manual score and v2 feedback labels existed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.feedback_events'::regclass
      AND conname = 'feedback_events_action_check'
  ) THEN
    ALTER TABLE public.feedback_events DROP CONSTRAINT feedback_events_action_check;
  END IF;
END $$;

ALTER TABLE public.feedback_events
  ADD CONSTRAINT feedback_events_action_check
  CHECK (action IN (
    'force_deliver', 'force_x', 'confirm_deliver', 'confirm_x',
    'dispute_high', 'dispute_low', 'not_duplicate', 'confirm_duplicate',
    'reprocess', 'edit_translation', 'manual_score', 'score_too_low',
    'score_too_high', 'correct_deliver', 'correct_skip',
    'should_pass_audience', 'should_skip_audience', 'wrong_relevance_class',
    'global_exception_worth_covering', 'not_global_exception'
  ));
