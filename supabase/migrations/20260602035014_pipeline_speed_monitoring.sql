-- Pipeline speed and monitoring rollout.
-- Event-driven worker dispatch is additive; this migration keeps the 1-minute
-- worker cron as fallback and improves queue/candidate query plans.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-15s') THEN
    PERFORM cron.unschedule('invoke-worker-every-15s');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-2m') THEN
    PERFORM cron.unschedule('invoke-worker-every-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-1m') THEN
    PERFORM cron.unschedule('invoke-worker-every-1m');
  END IF;
END $$;

SELECT cron.schedule(
  'invoke-worker-every-1m',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron","job_types":["dedupe","resolve_media","download_media","hydrate_tweet","translate","deliver"],"batch_size":20,"chain_depth":0}'::jsonb
  );
  $cron$
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending_priority_created
  ON public.jobs (priority DESC, next_run_at ASC NULLS FIRST, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_jobs_pending_type_priority_created
  ON public.jobs (type, priority DESC, next_run_at ASC NULLS FIRST, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_enrichment_research_cache_post_id
  ON public.enrichment_research_cache (post_id);

DO $$
BEGIN
  IF to_regclass('public.story_pair_blocklist') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.story_pair_blocklist'::regclass
        AND contype = 'p'
    )
  THEN
    IF to_regclass('public.idx_story_pair_blocklist_pair') IS NOT NULL THEN
      ALTER TABLE public.story_pair_blocklist
        ADD CONSTRAINT story_pair_blocklist_pkey
        PRIMARY KEY USING INDEX idx_story_pair_blocklist_pair;
    ELSE
      ALTER TABLE public.story_pair_blocklist
        ADD CONSTRAINT story_pair_blocklist_pkey
        PRIMARY KEY (tweet_a, tweet_b);
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_jobs(batch_size int DEFAULT 10, job_types text[] DEFAULT NULL, worker_id text DEFAULT 'default')
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lease_duration interval := interval '5 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.jobs
  SET
    status = 'running',
    locked_at = now(),
    locked_by = worker_id,
    lease_expires_at = now() + lease_duration,
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1
  WHERE id IN (
    SELECT j.id
    FROM public.jobs j
    WHERE j.status = 'pending'
      AND (j.next_run_at IS NULL OR j.next_run_at <= now())
      AND (job_types IS NULL OR j.type = ANY(job_types))
    ORDER BY j.priority DESC, j.next_run_at ASC NULLS FIRST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer,text[],text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer,text[],text) TO service_role;

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
    AND COALESCE(p.final_score, p.importance_score::numeric) >= min_score
    AND (NOT decision_must_deliver OR p.delivery_decision = 'deliver')
    AND (COALESCE(p.is_truncated, false) = false OR p.hydrated_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.x_deliveries xd
      WHERE xd.post_id = p.tweet_id
        AND xd.status IN ('posted', 'skipped', 'failed')
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
