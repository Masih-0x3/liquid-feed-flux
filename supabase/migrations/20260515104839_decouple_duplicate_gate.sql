-- Decouple duplicate detection from scoring/content filtering.
-- This keeps the existing story_signatures storage but makes the duplicate
-- gate explicit on posts and adds an embedding-only candidate lookup.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS dedupe_status text,
  ADD COLUMN IF NOT EXISTS dedupe_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_method text,
  ADD COLUMN IF NOT EXISTS dedupe_confidence numeric,
  ADD COLUMN IF NOT EXISTS dedupe_reason text,
  ADD COLUMN IF NOT EXISTS dedupe_new_facts text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_dedupe_status_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_dedupe_status_check
      CHECK (
        dedupe_status IS NULL OR dedupe_status IN (
          'pending',
          'unique',
          'duplicate',
          'related_new_info',
          'uncertain',
          'failed'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_dedupe_method_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_dedupe_method_check
      CHECK (
        dedupe_method IS NULL OR dedupe_method IN (
          'none',
          'exact_tweet',
          'exact_url',
          'semantic_auto',
          'semantic_ai'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_dedupe_confidence_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_dedupe_confidence_check
      CHECK (
        dedupe_confidence IS NULL
        OR (dedupe_confidence >= 0 AND dedupe_confidence <= 1)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_dedupe_status_idx
  ON public.posts (dedupe_status, created_at DESC);

CREATE INDEX IF NOT EXISTS posts_dedupe_checked_at_idx
  ON public.posts (dedupe_checked_at DESC)
  WHERE dedupe_checked_at IS NOT NULL;

-- New semantic candidate lookup. SimHash remains stored for old rows, but is
-- no longer required in the decision path.
CREATE OR REPLACE FUNCTION public.find_story_candidates_v3(
  query_embedding vector(1536),
  exclude_tweet_id text,
  window_hours int DEFAULT 48,
  candidate_min_similarity numeric DEFAULT 0.78,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  tweet_id text,
  story_cluster_id uuid,
  similarity numeric,
  normalized_text text,
  text_original text,
  text_translated text,
  author_handle text,
  url text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.tweet_id,
    s.story_cluster_id,
    (1 - (s.embedding <=> query_embedding))::numeric AS similarity,
    s.normalized_text,
    p.text_original,
    p.text_translated,
    p.author_handle,
    p.url,
    p.created_at
  FROM public.story_signatures s
  INNER JOIN public.posts p ON p.tweet_id = s.tweet_id
  WHERE s.tweet_id <> exclude_tweet_id
    AND s.created_at >= now() - (window_hours || ' hours')::interval
    AND s.embedding IS NOT NULL
    AND (1 - (s.embedding <=> query_embedding)) >= candidate_min_similarity
    AND NOT EXISTS (
      SELECT 1 FROM public.story_pair_blocklist bl
      WHERE bl.tweet_a = LEAST(s.tweet_id, exclude_tweet_id)
        AND bl.tweet_b = GREATEST(s.tweet_id, exclude_tweet_id)
    )
  ORDER BY s.embedding <=> query_embedding ASC
  LIMIT LEAST(GREATEST(match_limit, 1), 10);
$$;

REVOKE ALL ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int) TO authenticated, service_role;
