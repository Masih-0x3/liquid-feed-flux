-- Make learned feedback calibration explicit and prevent weak negative priors
-- from silently lowering otherwise X-eligible posts below the posting gate.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS base_score numeric,
  ADD COLUMN IF NOT EXISTS learned_score numeric,
  ADD COLUMN IF NOT EXISTS learned_delta numeric,
  ADD COLUMN IF NOT EXISTS x_gate_score numeric,
  ADD COLUMN IF NOT EXISTS learning_confidence jsonb;

CREATE INDEX IF NOT EXISTS idx_posts_x_gate_candidates
  ON public.posts (created_at DESC, x_gate_score)
  WHERE text_translated IS NOT NULL;

UPDATE public.settings
SET
  value = jsonb_set(
    jsonb_set(
      COALESCE(value::jsonb, '{}'::jsonb),
      '{mode}',
      '"shadow"'::jsonb,
      true
    ),
    '{learning}',
    COALESCE(value::jsonb->'learning', '{}'::jsonb) ||
      jsonb_build_object('mode', 'shadow'),
    true
  ),
  updated_at = now()
WHERE key = 'scoring_policy';

UPDATE public.posts
SET
  base_score = COALESCE(
    base_score,
    CASE WHEN score_breakdown->>'base' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'base')::numeric END,
    CASE WHEN score_breakdown->>'ai' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'ai')::numeric END,
    final_score,
    importance_score::numeric
  ),
  learned_score = COALESCE(
    learned_score,
    CASE WHEN score_breakdown->>'learned' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'learned')::numeric END,
    CASE WHEN score_breakdown->>'final' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'final')::numeric END,
    final_score
  ),
  x_gate_score = COALESCE(
    x_gate_score,
    CASE WHEN score_breakdown->>'x_gate_score' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'x_gate_score')::numeric END,
    CASE WHEN score_breakdown->>'x_gate' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'x_gate')::numeric END,
    CASE WHEN score_breakdown->>'base' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'base')::numeric END,
    CASE WHEN score_breakdown->>'ai' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (score_breakdown->>'ai')::numeric END,
    final_score,
    importance_score::numeric
  )
WHERE base_score IS NULL
  OR learned_score IS NULL
  OR x_gate_score IS NULL;

UPDATE public.posts
SET learned_delta = ROUND((learned_score - base_score)::numeric, 3)
WHERE learned_delta IS NULL
  AND learned_score IS NOT NULL
  AND base_score IS NOT NULL;

CREATE OR REPLACE FUNCTION public.feedback_score_residual(
  feedback_meta jsonb,
  polarity smallint
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH parsed AS (
    SELECT
      CASE
        WHEN COALESCE(feedback_meta, '{}'::jsonb)->>'old_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (feedback_meta->>'old_score')::numeric
        ELSE NULL
      END AS old_score,
      CASE
        WHEN COALESCE(feedback_meta, '{}'::jsonb)->>'manual_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (feedback_meta->>'manual_score')::numeric
        WHEN COALESCE(feedback_meta, '{}'::jsonb)->>'new_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN (feedback_meta->>'new_score')::numeric
        ELSE NULL
      END AS target_score
  )
  SELECT LEAST(2, GREATEST(-2, COALESCE(
    CASE
      WHEN old_score IS NOT NULL AND target_score IS NOT NULL
        THEN target_score - old_score
      ELSE NULL
    END,
    NULLIF(polarity, 0)::numeric,
    0
  )))
  FROM parsed;
$$;

REVOKE ALL ON FUNCTION public.feedback_score_residual(jsonb, smallint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.feedback_score_residual(jsonb, smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.knn_feedback_prior_details(
  query_embedding vector(1536),
  exclude_tweet_id text,
  k int DEFAULT 10,
  half_life_days numeric DEFAULT 30,
  min_similarity numeric DEFAULT 0.65
)
RETURNS TABLE (
  prior numeric,
  neighbor_count integer,
  positive_count integer,
  negative_count integer,
  recent_negative_count integer,
  mean_similarity numeric,
  max_similarity numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH neighbors AS (
    SELECT
      public.feedback_score_residual(fe.meta, fe.polarity) AS residual,
      sim.cosine_sim,
      fe.created_at,
      exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days) AS decay
    FROM public.story_signatures ss
    INNER JOIN public.feedback_events fe ON fe.tweet_id = ss.tweet_id
    CROSS JOIN LATERAL (
      SELECT (1 - (ss.embedding <=> query_embedding))::numeric AS cosine_sim
    ) sim
    WHERE ss.tweet_id <> exclude_tweet_id
      AND ss.embedding IS NOT NULL
      AND fe.action NOT IN ('not_duplicate', 'confirm_duplicate')
      AND public.feedback_score_residual(fe.meta, fe.polarity) <> 0
      AND sim.cosine_sim >= min_similarity
    ORDER BY ss.embedding <=> query_embedding ASC
    LIMIT GREATEST(1, LEAST(COALESCE(k, 10), 50))
  )
  SELECT
    COALESCE(
      LEAST(2, GREATEST(-2,
        SUM(cosine_sim * residual * decay) / NULLIF(SUM(cosine_sim * decay), 0)
      )),
      0
    )::numeric AS prior,
    COUNT(*)::integer AS neighbor_count,
    COUNT(*) FILTER (WHERE residual > 0)::integer AS positive_count,
    COUNT(*) FILTER (WHERE residual < 0)::integer AS negative_count,
    COUNT(*) FILTER (
      WHERE residual < 0 AND created_at >= now() - interval '14 days'
    )::integer AS recent_negative_count,
    COALESCE(AVG(cosine_sim), 0)::numeric AS mean_similarity,
    COALESCE(MAX(cosine_sim), 0)::numeric AS max_similarity
  FROM neighbors;
$$;

REVOKE ALL ON FUNCTION public.knn_feedback_prior_details(vector(1536), text, int, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.knn_feedback_prior_details(vector(1536), text, int, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.knn_feedback_prior(
  query_embedding vector(1536),
  exclude_tweet_id text,
  k int DEFAULT 10,
  half_life_days numeric DEFAULT 30
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT prior
  FROM public.knn_feedback_prior_details(
    query_embedding,
    exclude_tweet_id,
    k,
    half_life_days
  );
$$;

REVOKE ALL ON FUNCTION public.knn_feedback_prior(vector(1536), text, int, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.knn_feedback_prior(vector(1536), text, int, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rebuild_learned_biases(
  half_life_days numeric DEFAULT 30,
  per_key_cap numeric DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  author_biases jsonb := '{}';
  tag_biases jsonb := '{}';
  kw_biases jsonb := '{}';
  r record;
BEGIN
  FOR r IN
    SELECT
      p.author_handle AS key,
      LEAST(per_key_cap, GREATEST(-per_key_cap,
        SUM(
          public.feedback_score_residual(fe.meta, fe.polarity) * 0.25
          * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
        )
      )) AS bias
    FROM public.feedback_events fe
    JOIN public.posts p ON p.tweet_id = fe.tweet_id
    WHERE p.author_handle IS NOT NULL
      AND public.feedback_score_residual(fe.meta, fe.polarity) <> 0
      AND fe.action NOT IN ('not_duplicate', 'confirm_duplicate')
    GROUP BY p.author_handle
    HAVING ABS(SUM(
      public.feedback_score_residual(fe.meta, fe.polarity) * 0.25
      * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
    )) > 0.01
  LOOP
    author_biases := jsonb_set(author_biases, ARRAY[r.key], to_jsonb(ROUND(r.bias::numeric, 3)));
  END LOOP;

  FOR r IN
    SELECT
      tag AS key,
      LEAST(per_key_cap, GREATEST(-per_key_cap,
        SUM(
          public.feedback_score_residual(fe.meta, fe.polarity) * 0.1
          * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
        )
      )) AS bias
    FROM public.feedback_events fe
    JOIN public.posts p ON p.tweet_id = fe.tweet_id,
    LATERAL unnest(COALESCE(p.importance_tags, '{}')) AS tag
    WHERE public.feedback_score_residual(fe.meta, fe.polarity) <> 0
      AND fe.action NOT IN ('not_duplicate', 'confirm_duplicate')
    GROUP BY tag
    HAVING ABS(SUM(
      public.feedback_score_residual(fe.meta, fe.polarity) * 0.1
      * exp(-ln(2.0) * EXTRACT(EPOCH FROM (now() - fe.created_at)) / 86400.0 / half_life_days)
    )) > 0.01
  LOOP
    tag_biases := jsonb_set(tag_biases, ARRAY[r.key], to_jsonb(ROUND(r.bias::numeric, 3)));
  END LOOP;

  result := jsonb_build_object(
    'author_bias', author_biases,
    'tag_bias', tag_biases,
    'keyword_bias', kw_biases,
    'rebuilt_at', now(),
    'learning_model', 'residual_v1'
  );

  INSERT INTO public.settings (key, value, updated_at)
  VALUES ('learned_biases', result, now())
  ON CONFLICT (key) DO UPDATE SET value = result, updated_at = now();

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_learned_biases(numeric, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_learned_biases(numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.get_x_post_candidates(
  candidate_limit int DEFAULT 20,
  target_tweet_id text DEFAULT NULL
)
RETURNS TABLE (
  tweet_id text,
  text_translated text,
  text_original text,
  author_handle text,
  has_media boolean,
  importance_score integer,
  final_score numeric,
  delivery_decision text,
  decision_reason text,
  url text,
  is_truncated boolean,
  hydrated_at timestamptz,
  created_at timestamptz,
  final_x_text text,
  composed_post_text text,
  post_format_hint text,
  humanized_commentary text,
  commentary_hook text,
  commentary_question text,
  narrative_callback text,
  thread_continuation text,
  enrich_status text,
  dedupe_status text,
  dup_of_tweet_id text,
  dup_similarity numeric,
  dedupe_reason text,
  account_handle text,
  candidate_reason text,
  candidate_age_ms numeric,
  dispatch_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  x_cfg jsonb := '{}'::jsonb;
  min_score numeric := 14;
  decision_must_deliver boolean := true;
  dedupe_hours integer := 48;
  dedupe_cutoff timestamptz;
  start_from timestamptz := NULL;
  effective_cutoff timestamptz;
BEGIN
  SELECT COALESCE(value::jsonb, '{}'::jsonb)
  INTO x_cfg
  FROM public.settings
  WHERE key = 'x_posting_config';

  x_cfg := COALESCE(x_cfg, '{}'::jsonb);
  min_score := COALESCE(NULLIF(x_cfg->>'min_score', '')::numeric, 14);
  decision_must_deliver := COALESCE(NULLIF(x_cfg->>'post_only_decision_deliver', '')::boolean, true);
  dedupe_hours := GREATEST(1, COALESCE(NULLIF(x_cfg->>'dedupe_window_hours', '')::integer, 48));
  dedupe_cutoff := now() - make_interval(hours => dedupe_hours);

  BEGIN
    start_from := NULLIF(x_cfg->>'start_posting_from', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    start_from := NULL;
  END;

  effective_cutoff := GREATEST(dedupe_cutoff, COALESCE(start_from, dedupe_cutoff));

  RETURN QUERY
  SELECT
    p.tweet_id,
    p.text_translated,
    p.text_original,
    p.author_handle,
    COALESCE(p.has_media, false),
    p.importance_score,
    p.final_score,
    p.delivery_decision,
    p.decision_reason,
    p.url,
    COALESCE(p.is_truncated, false),
    p.hydrated_at,
    p.created_at,
    p.final_x_text,
    p.composed_post_text,
    p.post_format_hint,
    p.humanized_commentary,
    p.commentary_hook,
    p.commentary_question,
    p.narrative_callback,
    p.thread_continuation,
    p.enrich_status,
    p.dedupe_status,
    p.dup_of_tweet_id,
    p.dup_similarity,
    p.dedupe_reason,
    a.handle AS account_handle,
    CASE
      WHEN target_tweet_id IS NOT NULL THEN 'target_normal_gate'
      ELSE 'normal_gate'
    END AS candidate_reason,
    EXTRACT(EPOCH FROM (now() - p.created_at)) * 1000 AS candidate_age_ms,
    CASE
      WHEN target_tweet_id IS NOT NULL THEN 'event'
      ELSE 'cron'
    END AS dispatch_source
  FROM public.posts p
  JOIN public.accounts a ON a.id = p.account_id
  WHERE (target_tweet_id IS NULL OR p.tweet_id = target_tweet_id)
    AND p.created_at >= effective_cutoff
    AND p.text_translated IS NOT NULL
    AND btrim(p.text_translated) <> ''
    AND COALESCE(
      p.x_gate_score,
      CASE WHEN p.score_breakdown->>'x_gate_score' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p.score_breakdown->>'x_gate_score')::numeric END,
      CASE WHEN p.score_breakdown->>'x_gate' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p.score_breakdown->>'x_gate')::numeric END,
      CASE WHEN p.score_breakdown->>'base' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p.score_breakdown->>'base')::numeric END,
      CASE WHEN p.score_breakdown->>'ai' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p.score_breakdown->>'ai')::numeric END,
      p.final_score,
      p.importance_score::numeric
    ) >= min_score
    AND (NOT decision_must_deliver OR p.delivery_decision = 'deliver')
    AND (COALESCE(p.is_truncated, false) = false OR p.hydrated_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.x_deliveries xd
      WHERE xd.post_id = p.tweet_id
        AND xd.status IN ('posting', 'posted', 'pending', 'running', 'skipped', 'failed')
    )
    AND (
      COALESCE(p.has_media, false) = false
      OR EXISTS (
        SELECT 1
        FROM public.media m
        WHERE m.tweet_id = p.tweet_id
          AND m.storage_path IS NOT NULL
          AND m.downloaded_at IS NOT NULL
      )
    )
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(candidate_limit, 20), 100));
END;
$$;

REVOKE ALL ON FUNCTION public.get_x_post_candidates(integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_x_post_candidates(integer,text) TO service_role;
