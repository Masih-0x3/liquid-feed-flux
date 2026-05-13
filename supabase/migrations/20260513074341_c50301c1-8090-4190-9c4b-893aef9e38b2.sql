
-- Atomic coverage_count incrementer for story_signatures
CREATE OR REPLACE FUNCTION public.bump_coverage_count(p_tweet_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.story_signatures
  SET coverage_count = coverage_count + 1
  WHERE tweet_id = p_tweet_id;
$$;

REVOKE ALL ON FUNCTION public.bump_coverage_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_coverage_count(text) TO authenticated, service_role;

-- Idempotent seed: editorial_profiles default ("Iran-war default")
INSERT INTO public.settings (key, value, description)
VALUES (
  'editorial_profiles',
  jsonb_build_object(
    'profiles', jsonb_build_array(
      jsonb_build_object(
        'id', 'iran-war-default',
        'name', 'Iran-war default',
        'weights', jsonb_build_object(
          'iran_relevance', 4,
          'severity', 3,
          'novelty', 2,
          'credibility', 2,
          'actionability', 1,
          'noise', 4,
          'corroboration', 1
        ),
        'threshold', 14,
        'must_include_keywords', '[]'::jsonb,
        'must_exclude_keywords', '[]'::jsonb,
        'required_tags_any', '[]'::jsonb,
        'blocked_tags', '[]'::jsonb,
        'author_overrides', '{}'::jsonb,
        'editorial_note', 'Auto-seeded from legacy content_filter. Tune weights as needed.'
      )
    )
  ),
  'Active editorial scoring profiles (PR2)'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description)
VALUES (
  'active_profile_id',
  jsonb_build_object('id', 'iran-war-default'),
  'Currently active editorial profile id'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description)
VALUES (
  'story_memory',
  jsonb_build_object(
    'enabled', true,
    'window_hours', 12,
    'similarity_threshold', 0.86,
    'action', 'skip',
    'bypass_authors', '[]'::jsonb
  ),
  'Story Memory (PR3) — semantic near-duplicate detection across outlets'
)
ON CONFLICT (key) DO NOTHING;
