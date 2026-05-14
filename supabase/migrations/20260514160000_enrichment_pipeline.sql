-- Multi-Agent News Commentary Pipeline: enrichment storage layer
-- Adds columns to posts for the 5-agent enrichment pipeline output.
-- Seeds enrichment_config and voice_samples settings.

-- ============================================================
-- 1. New columns on posts for enrichment output
-- ============================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS background_context jsonb,
  ADD COLUMN IF NOT EXISTS editorial_commentary text,
  ADD COLUMN IF NOT EXISTS humanized_commentary text,
  ADD COLUMN IF NOT EXISTS commentary_hook text,
  ADD COLUMN IF NOT EXISTS commentary_question text,
  ADD COLUMN IF NOT EXISTS narrative_callback text,
  ADD COLUMN IF NOT EXISTS narrative_ref_post_id text REFERENCES public.posts(tweet_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS composed_post_text text,
  ADD COLUMN IF NOT EXISTS post_format_hint text,
  ADD COLUMN IF NOT EXISTS thread_continuation text,
  ADD COLUMN IF NOT EXISTS enrich_status text DEFAULT 'pending'
    CHECK (enrich_status IN ('pending', 'completed', 'failed', 'awaiting_approval', 'approved', 'rejected', 'skipped')),
  ADD COLUMN IF NOT EXISTS enrich_model text,
  ADD COLUMN IF NOT EXISTS enrich_tokens integer,
  ADD COLUMN IF NOT EXISTS enrich_duration_ms integer;

CREATE INDEX IF NOT EXISTS idx_posts_enrich_status
  ON public.posts (enrich_status) WHERE enrich_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_narrative_ref
  ON public.posts (narrative_ref_post_id) WHERE narrative_ref_post_id IS NOT NULL;

-- ============================================================
-- 2. Seed enrichment_config setting
-- ============================================================
INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'enrichment_config',
  '{
    "enabled": false,
    "model": "gpt-5.4-mini",
    "analyst_prompt": "You are a sharp, direct Iranian political commentator. You are skeptical of the Islamic Republic regime, care about facts over emotions, and connect news to the bigger picture. You never use flowery diplomatic language. Write analysis in Persian.",
    "researcher_prompt": "You are a senior news researcher specializing in Iran, the Middle East, and US foreign policy. Given a news item, search the web to find background context, related recent events, and key figures. Return structured facts only -- no opinions.",
    "humanizer_prompt": "Rewrite the following Persian commentary to sound natural and human. Mix sentence lengths aggressively. Use colloquial Persian. Add one natural imperfection per commentary. Never use AI-tell patterns.",
    "archivist_prompt": "You are an editorial archivist. Given a new story and recent posts, identify narrative connections. Only suggest a callback if it genuinely adds value. If nothing is related, return null.",
    "composer_prompt": "You are a social media editor for a Persian news account on X. Assemble the final post from components. Vary format across posts. The translation is core -- commentary enhances it. Never exceed 280 characters.",
    "max_research_tokens": 4000,
    "max_analysis_tokens": 2000,
    "max_humanizer_tokens": 2000,
    "max_archivist_tokens": 2000,
    "max_composer_tokens": 2000,
    "skip_research_below_score": 16,
    "archivist_lookback_days": 3,
    "archivist_max_posts": 10,
    "require_approval": true,
    "thread_above_score": 18
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. Seed voice_samples setting (empty initially, user fills in)
-- ============================================================
INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'voice_samples',
  '{"samples": [], "updated_at": null}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
