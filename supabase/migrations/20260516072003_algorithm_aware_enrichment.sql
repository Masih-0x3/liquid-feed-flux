-- Algorithm-aware enrichment v2: creator-analysis drafts, risk signals, and
-- research caching. Browser access continues through admin-actions; new public
-- tables are RLS-protected and only granted to service_role.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS enrichment_version text,
  ADD COLUMN IF NOT EXISTS creator_angle text,
  ADD COLUMN IF NOT EXISTS why_it_matters text,
  ADD COLUMN IF NOT EXISTS source_context jsonb,
  ADD COLUMN IF NOT EXISTS algorithm_signal_scores jsonb,
  ADD COLUMN IF NOT EXISTS aggregator_risk_score numeric,
  ADD COLUMN IF NOT EXISTS ai_voice_risk_score numeric,
  ADD COLUMN IF NOT EXISTS monetization_risk_flags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS enrichment_review_reason text,
  ADD COLUMN IF NOT EXISTS final_x_text text;

CREATE INDEX IF NOT EXISTS idx_posts_enrichment_review
  ON public.posts (enrich_status, aggregator_risk_score, ai_voice_risk_score)
  WHERE enrich_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.post_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id text NOT NULL REFERENCES public.posts(tweet_id) ON DELETE CASCADE,
  version text NOT NULL DEFAULT 'creator-analysis-v2',
  status text NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('completed', 'awaiting_approval', 'approved', 'rejected', 'failed', 'skipped')),
  model text NOT NULL,
  creator_angle text,
  why_it_matters text,
  source_context jsonb,
  algorithm_signal_scores jsonb NOT NULL DEFAULT '{}',
  aggregator_risk_score numeric,
  ai_voice_risk_score numeric,
  monetization_risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  enrichment_review_reason text,
  final_x_text text,
  thread_continuation text,
  format_used text,
  critic_output jsonb NOT NULL DEFAULT '{}',
  feedback_label text,
  feedback_note text,
  feedback_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_enrichments_post_created
  ON public.post_enrichments (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_enrichments_status_created
  ON public.post_enrichments (status, created_at DESC);

ALTER TABLE public.post_enrichments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage post_enrichments" ON public.post_enrichments;
CREATE POLICY "Admins can manage post_enrichments"
  ON public.post_enrichments
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.post_enrichments FROM anon, authenticated;
GRANT ALL ON public.post_enrichments TO service_role;

CREATE TABLE IF NOT EXISTS public.enrichment_research_cache (
  cache_key text PRIMARY KEY,
  post_id text REFERENCES public.posts(tweet_id) ON DELETE SET NULL,
  source_url text,
  source_hash text,
  research jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enrichment_research_cache_expires
  ON public.enrichment_research_cache (expires_at);

ALTER TABLE public.enrichment_research_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage enrichment_research_cache" ON public.enrichment_research_cache;
CREATE POLICY "Admins can manage enrichment_research_cache"
  ON public.enrichment_research_cache
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.enrichment_research_cache FROM anon, authenticated;
GRANT ALL ON public.enrichment_research_cache TO service_role;

INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'enrichment_config',
  '{
    "enabled": false,
    "version": "creator-analysis-v2",
    "mode": "creator_analysis",
    "review_mode": "shadow_review",
    "source_attribution_policy": "compact",
    "banned_phrases": ["BREAKING", "Breaking", "فوری", "قابل توجه است", "جالب است که", "لازم به ذکر است", "در همین راستا"],
    "critic_prompt": "You are a strict X creator-quality critic. Judge whether this Persian post adds original creator value, avoids aggregator/clickbait patterns, and is likely to earn healthy replies, reposts, dwell, profile clicks, and follows without causing mute/block/report/not-interested reactions. Be conservative.",
    "max_critic_tokens": 2000,
    "aggregator_review_threshold": 35,
    "aggregator_reject_threshold": 70,
    "ai_voice_review_threshold": 35,
    "ai_voice_reject_threshold": 70,
    "same_source_window_hours": 6,
    "same_source_review_threshold": 3,
    "research_cache_hours": 24,
    "min_creator_angle_chars": 80
  }',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = (
    '{
      "version": "creator-analysis-v2",
      "mode": "creator_analysis",
      "review_mode": "shadow_review",
      "source_attribution_policy": "compact",
      "banned_phrases": ["BREAKING", "Breaking", "فوری", "قابل توجه است", "جالب است که", "لازم به ذکر است", "در همین راستا"],
      "critic_prompt": "You are a strict X creator-quality critic. Judge whether this Persian post adds original creator value, avoids aggregator/clickbait patterns, and is likely to earn healthy replies, reposts, dwell, profile clicks, and follows without causing mute/block/report/not-interested reactions. Be conservative.",
      "max_critic_tokens": 2000,
      "aggregator_review_threshold": 35,
      "aggregator_reject_threshold": 70,
      "ai_voice_review_threshold": 35,
      "ai_voice_reject_threshold": 70,
      "same_source_window_hours": 6,
      "same_source_review_threshold": 3,
      "research_cache_hours": 24,
      "min_creator_angle_chars": 80
    }'::jsonb || public.settings.value::jsonb
  ),
  updated_at = now();
