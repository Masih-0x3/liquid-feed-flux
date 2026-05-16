-- X API usage ledger and cost-control defaults.
-- This table is the source of truth for local X API attempt/usage reporting.
CREATE TABLE IF NOT EXISTS public.x_api_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  source_action text NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  tweet_id text,
  x_user_id text,
  http_status integer,
  ok boolean NOT NULL DEFAULT false,
  error text,
  rate_limit_limit integer,
  rate_limit_remaining integer,
  rate_limit_reset_at timestamptz,
  estimated_billable_unit text,
  request_counted boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_x_api_events_created_at
  ON public.x_api_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_api_events_source
  ON public.x_api_events (source, source_action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_api_events_endpoint
  ON public.x_api_events (endpoint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_api_events_tweet_id
  ON public.x_api_events (tweet_id, created_at DESC)
  WHERE tweet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_x_api_events_status
  ON public.x_api_events (http_status, created_at DESC)
  WHERE http_status IS NOT NULL;

ALTER TABLE public.x_api_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage x_api_events" ON public.x_api_events;
CREATE POLICY "Admins can manage x_api_events" ON public.x_api_events
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.x_api_events FROM anon, authenticated;
GRANT ALL ON public.x_api_events TO service_role;

INSERT INTO public.settings (key, value, description, updated_at)
VALUES (
  'x_api_controls',
  jsonb_build_object(
    'verify_cache_minutes', 15,
    'follower_snapshot_stale_minutes', 60,
    'usage_sync_interval_hours', 6,
    'backfill_max_hydrate_jobs_per_run', 100,
    'warning_thresholds', jsonb_build_array(70, 90)
  ),
  'X API cost-control cache windows, backfill guardrails, and warning thresholds',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.settings.value || EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

-- Keep the cron automation enabled, but skip invoking the Edge Function when
-- the database can prove that no posts are eligible. This avoids one function
-- invocation per minute on empty queues without reducing configured budgets.
CREATE OR REPLACE FUNCTION public.invoke_x_poster_if_enabled()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  cfg jsonb;
  enabled boolean;
  min_score numeric;
  dedupe_window_hours numeric;
  start_from timestamptz;
  dedupe_cutoff timestamptz;
  effective_cutoff timestamptz;
  require_decision_deliver boolean;
  has_candidate boolean;
BEGIN
  SELECT value
  INTO cfg
  FROM public.settings
  WHERE key = 'x_posting_config'
  LIMIT 1;

  enabled := COALESCE((cfg->>'enabled')::boolean, false);
  IF NOT enabled THEN
    RETURN;
  END IF;

  min_score := COALESCE(NULLIF(cfg->>'min_score', '')::numeric, 14);
  dedupe_window_hours := COALESCE(NULLIF(cfg->>'dedupe_window_hours', '')::numeric, 48);
  start_from := NULLIF(cfg->>'start_posting_from', '')::timestamptz;
  require_decision_deliver := COALESCE((cfg->>'post_only_decision_deliver')::boolean, true);
  dedupe_cutoff := now() - make_interval(hours => dedupe_window_hours::integer);
  effective_cutoff := GREATEST(COALESCE(start_from, dedupe_cutoff), dedupe_cutoff);

  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.created_at >= effective_cutoff
      AND p.text_translated IS NOT NULL
      AND (COALESCE(p.final_score, p.importance_score)::numeric >= min_score)
      AND (NOT require_decision_deliver OR p.delivery_decision = 'deliver')
      AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM public.x_deliveries xd
        WHERE xd.post_id = p.tweet_id
          AND xd.status = 'posted'
          AND xd.created_at >= dedupe_cutoff
      )
    LIMIT 1
  )
  INTO has_candidate;

  IF NOT has_candidate THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-poster',
    headers := public._cron_internal_headers(),
    body := jsonb_build_object('source', 'cron', 'ts', now(), 'precheck', 'eligible_candidate')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_x_poster_if_enabled() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_x_poster_if_enabled() TO postgres;

-- Dashboard summary should derive X read attempts from the ledger when the
-- ledger exists. The legacy settings.x_api_usage arrays remain only a cache.
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb; since timestamptz := now() - interval '24 hours';
  posts_ingested int; posts_translated int; posts_delivered int; failed_jobs int;
  total_jobs int; completed_jobs int; pending_jobs int; running_jobs int; stale_running_jobs int; active_feeds int;
  avg_latency_sec numeric; recent_posts jsonb; truncated_24h int; hydrated_24h int;
  x_api_calls_24h int; x_summary jsonb; heartbeat jsonb; last_reconcile jsonb;
BEGIN
  SELECT count(*) INTO posts_ingested FROM public.posts WHERE created_at >= since;
  SELECT count(*) INTO posts_translated FROM public.posts WHERE created_at >= since AND text_translated IS NOT NULL;
  SELECT count(*) INTO posts_delivered FROM public.deliveries WHERE created_at >= since AND status = 'posted' AND subject_type = 'post';
  SELECT count(*) INTO failed_jobs FROM public.jobs WHERE created_at >= since AND status = 'failed';
  SELECT count(*) INTO total_jobs FROM public.jobs WHERE created_at >= since;
  SELECT count(*) INTO completed_jobs FROM public.jobs WHERE created_at >= since AND status = 'completed';
  SELECT count(*) INTO pending_jobs FROM public.jobs WHERE created_at >= since AND status = 'pending';
  SELECT count(*) INTO running_jobs FROM public.jobs WHERE status = 'running';
  SELECT count(*) INTO stale_running_jobs
  FROM public.jobs
  WHERE status = 'running'
    AND (
      (lease_expires_at IS NOT NULL AND lease_expires_at < now())
      OR (lease_expires_at IS NULL AND COALESCE(locked_at, created_at) < now() - interval '30 minutes')
    );
  SELECT count(*) INTO active_feeds FROM public.accounts WHERE enabled = true;
  SELECT count(*) INTO truncated_24h FROM public.posts WHERE created_at >= since AND (is_truncated = true OR hydrated_at IS NOT NULL);
  SELECT count(*) INTO hydrated_24h FROM public.posts WHERE hydrated_at IS NOT NULL AND hydrated_at >= since;
  SELECT count(*) INTO x_api_calls_24h
  FROM public.x_api_events
  WHERE created_at >= since
    AND request_counted = true;

  SELECT coalesce(avg(EXTRACT(EPOCH FROM (d.created_at - p.created_at))), 0) INTO avg_latency_sec
  FROM public.deliveries d JOIN public.posts p ON p.tweet_id = d.subject_id
  WHERE d.status = 'posted' AND d.subject_type = 'post' AND d.created_at >= since AND p.created_at >= since;
  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO recent_posts FROM (
    SELECT p.tweet_id, p.text_original, p.created_at, p.text_translated, a.handle as account_handle
    FROM public.posts p JOIN public.accounts a ON a.id = p.account_id
    ORDER BY p.created_at DESC LIMIT 10
  ) r;
  SELECT to_jsonb(r) INTO last_reconcile
  FROM (
    SELECT ran_at, expired_leases_released, stale_running_released,
           missing_translates_created, missing_deliveries_created,
           missing_hydrations_created, missing_media_created
    FROM public.queue_reconcile_runs
    ORDER BY ran_at DESC
    LIMIT 1
  ) r;
  x_summary := public.get_x_posting_summary();
  heartbeat := public.get_ingest_heartbeat();
  result := jsonb_build_object(
    'metrics', jsonb_build_object(
      'posts_ingested', posts_ingested, 'posts_translated', posts_translated,
      'posts_delivered', posts_delivered, 'failed_jobs', failed_jobs,
      'posts_truncated_24h', truncated_24h, 'posts_hydrated_24h', hydrated_24h,
      'x_api_calls_24h', x_api_calls_24h,
      'x_posts_24h', x_summary->'posted_24h',
      'x_failed_24h', x_summary->'failed_24h',
      'x_skipped_no_media_24h', x_summary->'skipped_no_media_24h',
      'x_media_uploads_24h', x_summary->'media_uploads_24h'
    ),
    'health', jsonb_build_object(
      'success_rate', CASE WHEN total_jobs > 0 THEN round((completed_jobs::numeric / total_jobs::numeric) * 100, 1) ELSE 100 END,
      'avg_latency', round(avg_latency_sec::numeric, 1),
      'active_feeds', active_feeds,
      'queue_size', pending_jobs,
      'queue_running', running_jobs,
      'queue_stale_running_30m', stale_running_jobs,
      'last_reconcile', COALESCE(last_reconcile, '{}'::jsonb),
      'is_online', stale_running_jobs = 0,
      'x_success_rate', x_summary->'success_rate',
      'x_avg_latency_ms', x_summary->'avg_latency_ms',
      'x_monthly_posts', x_summary->'monthly_posts',
      'x_monthly_budget', x_summary->'monthly_budget',
      'x_budget_used_pct', x_summary->'budget_used_pct'
    ),
    'x_posting', x_summary,
    'ingest_heartbeat', heartbeat,
    'recent_posts', recent_posts
  );
  RETURN result;
END;
$function$;
