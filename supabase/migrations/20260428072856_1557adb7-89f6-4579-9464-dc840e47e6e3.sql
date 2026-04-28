
-- 1. Reconcile stuck jobs now
SELECT public.reconcile_stuck_jobs();

-- 2. Heartbeat thresholds (minutes)
INSERT INTO public.settings (key, value, description)
VALUES (
  'ingest_heartbeat',
  '{"warn_minutes": 120, "critical_minutes": 360}'::jsonb,
  'Thresholds for ingest heartbeat alert based on minutes since last post ingest.'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Heartbeat RPC
CREATE OR REPLACE FUNCTION public.get_ingest_heartbeat()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  last_post_at timestamptz;
  age_seconds numeric;
  warn_minutes int;
  crit_minutes int;
  cfg jsonb;
  state text;
BEGIN
  SELECT max(created_at) INTO last_post_at FROM public.posts;
  SELECT value INTO cfg FROM public.settings WHERE key = 'ingest_heartbeat';
  warn_minutes := COALESCE((cfg->>'warn_minutes')::int, 120);
  crit_minutes := COALESCE((cfg->>'critical_minutes')::int, 360);

  IF last_post_at IS NULL THEN
    age_seconds := NULL;
    state := 'critical';
  ELSE
    age_seconds := EXTRACT(EPOCH FROM (now() - last_post_at));
    IF age_seconds >= crit_minutes * 60 THEN state := 'critical';
    ELSIF age_seconds >= warn_minutes * 60 THEN state := 'warning';
    ELSE state := 'ok';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'last_post_at', last_post_at,
    'age_seconds', age_seconds,
    'warn_minutes', warn_minutes,
    'critical_minutes', crit_minutes,
    'state', state
  );
END;
$$;

-- 4. Extend dashboard summary to include heartbeat
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb; since timestamptz := now() - interval '24 hours';
  posts_ingested int; posts_translated int; posts_delivered int; failed_jobs int;
  total_jobs int; completed_jobs int; pending_jobs int; active_feeds int;
  avg_latency_sec numeric; recent_posts jsonb; truncated_24h int; hydrated_24h int;
  x_api_calls_24h int; x_api_usage_row jsonb; x_summary jsonb; heartbeat jsonb;
BEGIN
  SELECT count(*) INTO posts_ingested FROM public.posts WHERE created_at >= since;
  SELECT count(*) INTO posts_translated FROM public.posts WHERE created_at >= since AND text_translated IS NOT NULL;
  SELECT count(*) INTO posts_delivered FROM public.deliveries WHERE created_at >= since AND status = 'posted' AND subject_type = 'post';
  SELECT count(*) INTO failed_jobs FROM public.jobs WHERE created_at >= since AND status = 'failed';
  SELECT count(*) INTO total_jobs FROM public.jobs WHERE created_at >= since;
  SELECT count(*) INTO completed_jobs FROM public.jobs WHERE created_at >= since AND status = 'completed';
  SELECT count(*) INTO pending_jobs FROM public.jobs WHERE created_at >= since AND status = 'pending';
  SELECT count(*) INTO active_feeds FROM public.accounts WHERE enabled = true;
  SELECT count(*) INTO truncated_24h FROM public.posts WHERE created_at >= since AND (is_truncated = true OR hydrated_at IS NOT NULL);
  SELECT count(*) INTO hydrated_24h FROM public.posts WHERE hydrated_at IS NOT NULL AND hydrated_at >= since;
  SELECT value INTO x_api_usage_row FROM public.settings WHERE key = 'x_api_usage';
  IF x_api_usage_row IS NULL THEN x_api_calls_24h := 0;
  ELSE
    SELECT count(*) INTO x_api_calls_24h FROM jsonb_array_elements_text(coalesce(x_api_usage_row->'calls_24h', '[]'::jsonb)) ts WHERE (ts)::timestamptz >= since;
  END IF;
  SELECT coalesce(avg(EXTRACT(EPOCH FROM (d.created_at - p.created_at))), 0) INTO avg_latency_sec
  FROM public.deliveries d JOIN public.posts p ON p.tweet_id = d.subject_id
  WHERE d.status = 'posted' AND d.subject_type = 'post' AND d.created_at >= since AND p.created_at >= since;
  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO recent_posts FROM (
    SELECT p.tweet_id, p.text_original, p.created_at, p.text_translated, a.handle as account_handle
    FROM public.posts p JOIN public.accounts a ON a.id = p.account_id
    ORDER BY p.created_at DESC LIMIT 10
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
      'active_feeds', active_feeds, 'queue_size', pending_jobs, 'is_online', true,
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
END; $function$;
