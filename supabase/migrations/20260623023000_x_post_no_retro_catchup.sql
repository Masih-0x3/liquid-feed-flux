-- Separate X duplicate lookback from automatic posting catch-up.
-- A scoring or deployment fix must not drain old missed posts into X.

UPDATE public.settings
SET
  value = COALESCE(value::jsonb, '{}'::jsonb)
    || jsonb_build_object(
      'max_candidate_age_minutes',
      CASE
        WHEN COALESCE(value::jsonb, '{}'::jsonb)->>'max_candidate_age_minutes' ~ '^[0-9]+$'
          THEN LEAST(1440, GREATEST(1, (value::jsonb->>'max_candidate_age_minutes')::integer))
        ELSE 30
      END,
      'max_posts_per_run',
      CASE
        WHEN COALESCE(value::jsonb, '{}'::jsonb)->>'max_posts_per_run' ~ '^[0-9]+$'
          THEN LEAST(20, GREATEST(1, (value::jsonb->>'max_posts_per_run')::integer))
        ELSE 1
      END,
      'start_posting_from',
      now()
    ),
  updated_at = now()
WHERE key = 'x_posting_config';

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
  max_candidate_age_minutes integer := 30;
  max_posts_per_run integer := 1;
  dedupe_cutoff timestamptz;
  freshness_cutoff timestamptz;
  start_from timestamptz := NULL;
  effective_cutoff timestamptz;
BEGIN
  SELECT COALESCE(value::jsonb, '{}'::jsonb)
  INTO x_cfg
  FROM public.settings
  WHERE key = 'x_posting_config';

  x_cfg := COALESCE(x_cfg, '{}'::jsonb);
  min_score := CASE
    WHEN x_cfg->>'min_score' ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (x_cfg->>'min_score')::numeric
    ELSE 14
  END;
  decision_must_deliver := COALESCE(NULLIF(x_cfg->>'post_only_decision_deliver', '')::boolean, true);
  dedupe_hours := CASE
    WHEN x_cfg->>'dedupe_window_hours' ~ '^[0-9]+$'
      THEN GREATEST(1, (x_cfg->>'dedupe_window_hours')::integer)
    ELSE 48
  END;
  max_candidate_age_minutes := CASE
    WHEN x_cfg->>'max_candidate_age_minutes' ~ '^[0-9]+$'
      THEN LEAST(1440, GREATEST(1, (x_cfg->>'max_candidate_age_minutes')::integer))
    ELSE 30
  END;
  max_posts_per_run := CASE
    WHEN x_cfg->>'max_posts_per_run' ~ '^[0-9]+$'
      THEN LEAST(20, GREATEST(1, (x_cfg->>'max_posts_per_run')::integer))
    ELSE 1
  END;
  dedupe_cutoff := now() - make_interval(hours => dedupe_hours);
  freshness_cutoff := now() - make_interval(mins => max_candidate_age_minutes);

  BEGIN
    start_from := NULLIF(x_cfg->>'start_posting_from', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    start_from := NULL;
  END;

  effective_cutoff := GREATEST(
    dedupe_cutoff,
    freshness_cutoff,
    COALESCE(start_from, freshness_cutoff)
  );

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
      WHEN target_tweet_id IS NOT NULL THEN 'target_fresh_gate'
      ELSE 'fresh_gate'
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
  LIMIT GREATEST(1, LEAST(COALESCE(candidate_limit, 20), max_posts_per_run, 100));
END;
$$;

REVOKE ALL ON FUNCTION public.get_x_post_candidates(integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_x_post_candidates(integer,text) TO service_role;
