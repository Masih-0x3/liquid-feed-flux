DROP FUNCTION IF EXISTS public.get_post_pipeline_status(text[]);

-- 1. x_deliveries table
CREATE TABLE IF NOT EXISTS public.x_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id text NOT NULL,
  x_tweet_id text,
  status text NOT NULL DEFAULT 'pending',
  skip_reason text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  media_count integer NOT NULL DEFAULT 0,
  media_bytes bigint NOT NULL DEFAULT 0,
  media_kind text,
  posted_at timestamptz,
  latency_ms integer,
  api_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_x_deliveries_post_id ON public.x_deliveries(post_id);
CREATE INDEX IF NOT EXISTS idx_x_deliveries_status ON public.x_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_x_deliveries_created_at ON public.x_deliveries(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_x_deliveries_post_posted
  ON public.x_deliveries(post_id) WHERE status = 'posted';

ALTER TABLE public.x_deliveries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='x_deliveries' AND policyname='Admins can manage x_deliveries') THEN
    CREATE POLICY "Admins can manage x_deliveries" ON public.x_deliveries FOR ALL TO authenticated
      USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='x_deliveries' AND policyname='Authenticated can view x_deliveries') THEN
    CREATE POLICY "Authenticated can view x_deliveries" ON public.x_deliveries FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_x_deliveries_updated_at ON public.x_deliveries;
CREATE TRIGGER trg_x_deliveries_updated_at
  BEFORE UPDATE ON public.x_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Default settings rows
INSERT INTO public.settings (key, value, description)
VALUES (
  'x_posting_config',
  jsonb_build_object(
    'enabled', false, 'min_score', 14, 'require_media', true, 'allow_video', false,
    'post_template', '{leading_emoji} {translated_text}', 'leading_emoji', '📰',
    'hashtags', '', 'max_chars', 280, 'dedupe_window_hours', 48, 'post_only_decision_deliver', true
  ),
  'X (Twitter) posting pipeline configuration'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description)
VALUES (
  'x_rate_limits',
  jsonb_build_object('posts_per_hour', 20, 'posts_per_day', 100, 'monthly_post_budget', 2500, 'media_uploads_per_day', 200),
  'X (Twitter) posting quota and rate limits'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description)
VALUES (
  'x_api_usage',
  jsonb_build_object('calls_24h', '[]'::jsonb, 'posts_24h', '[]'::jsonb, 'posts_total', 0,
    'media_uploads_24h', '[]'::jsonb, 'media_bytes_24h', 0, 'last_post_error', null),
  'X API usage counters'
) ON CONFLICT (key) DO NOTHING;

-- 3. RPC: get_x_posting_summary
CREATE OR REPLACE FUNCTION public.get_x_posting_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  result jsonb; since timestamptz := now() - interval '24 hours';
  posted_24h int; failed_24h int; skipped_24h int; skipped_no_media_24h int;
  avg_latency numeric; media_uploads_24h int; monthly_budget int; posts_30d int; rate_row jsonb;
BEGIN
  SELECT count(*) INTO posted_24h FROM public.x_deliveries WHERE created_at >= since AND status = 'posted';
  SELECT count(*) INTO failed_24h FROM public.x_deliveries WHERE created_at >= since AND status = 'failed';
  SELECT count(*) INTO skipped_24h FROM public.x_deliveries WHERE created_at >= since AND status = 'skipped';
  SELECT count(*) INTO skipped_no_media_24h FROM public.x_deliveries WHERE created_at >= since AND status = 'skipped' AND skip_reason = 'no_media';
  SELECT coalesce(avg(latency_ms), 0) INTO avg_latency FROM public.x_deliveries WHERE created_at >= since AND status = 'posted' AND latency_ms IS NOT NULL;
  SELECT coalesce(sum(media_count), 0) INTO media_uploads_24h FROM public.x_deliveries WHERE created_at >= since AND status = 'posted';
  SELECT count(*) INTO posts_30d FROM public.x_deliveries WHERE created_at >= now() - interval '30 days' AND status = 'posted';
  SELECT value INTO rate_row FROM public.settings WHERE key = 'x_rate_limits';
  monthly_budget := coalesce((rate_row->>'monthly_post_budget')::int, 2500);
  result := jsonb_build_object(
    'posted_24h', posted_24h, 'failed_24h', failed_24h, 'skipped_24h', skipped_24h,
    'skipped_no_media_24h', skipped_no_media_24h,
    'success_rate', CASE WHEN (posted_24h + failed_24h) > 0 THEN round((posted_24h::numeric / (posted_24h + failed_24h)::numeric) * 100, 1) ELSE 100 END,
    'avg_latency_ms', round(avg_latency, 0),
    'media_uploads_24h', media_uploads_24h,
    'monthly_posts', posts_30d, 'monthly_budget', monthly_budget,
    'budget_used_pct', CASE WHEN monthly_budget > 0 THEN round((posts_30d::numeric / monthly_budget::numeric) * 100, 1) ELSE 0 END
  );
  RETURN result;
END; $$;

-- 4. Extend get_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  result jsonb; since timestamptz := now() - interval '24 hours';
  posts_ingested int; posts_translated int; posts_delivered int; failed_jobs int;
  total_jobs int; completed_jobs int; pending_jobs int; active_feeds int;
  avg_latency_sec numeric; recent_posts jsonb; truncated_24h int; hydrated_24h int;
  x_api_calls_24h int; x_api_usage_row jsonb; x_summary jsonb;
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
    'recent_posts', recent_posts
  );
  RETURN result;
END; $$;

-- 5. Recreate get_post_pipeline_status with X delivery info
CREATE OR REPLACE FUNCTION public.get_post_pipeline_status(tweet_ids text[])
RETURNS TABLE(
  tweet_id text, ingest_at timestamptz, media_total integer, media_downloaded integer,
  lang_original text, translated_at timestamptz, translate_status text, translate_error text,
  delivery_status text, posted_at timestamptz, delivery_error text, attempts integer,
  is_truncated boolean, hydrated_at timestamptz, hydration_source text,
  x_status text, x_tweet_id text, x_posted_at timestamptz, x_error text, x_skip_reason text
)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    p.tweet_id, p.created_at AS ingest_at,
    coalesce(mc.total, 0) AS media_total, coalesce(mc.downloaded, 0) AS media_downloaded,
    p.lang_original, p.translated_at,
    coalesce(tj.status, CASE WHEN p.translated_at IS NOT NULL THEN 'completed' ELSE 'pending' END) AS translate_status,
    tj.last_error AS translate_error,
    coalesce(dl.status, 'pending') AS delivery_status, dl.posted_at,
    coalesce(dl.last_error, dj.last_error) AS delivery_error,
    coalesce(dl.attempts, 0) AS attempts,
    coalesce(p.is_truncated, false) AS is_truncated, p.hydrated_at, p.hydration_source,
    xd.status AS x_status, xd.x_tweet_id, xd.posted_at AS x_posted_at,
    xd.last_error AS x_error, xd.skip_reason AS x_skip_reason
  FROM public.posts p
  LEFT JOIN LATERAL (
    SELECT count(*) AS total, count(*) FILTER (WHERE m.downloaded_at IS NOT NULL) AS downloaded
    FROM public.media m WHERE m.tweet_id = p.tweet_id
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT j.status, j.last_error FROM public.jobs j
    WHERE j.type = 'translate' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) tj ON true
  LEFT JOIN LATERAL (
    SELECT j.last_error FROM public.jobs j
    WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) dj ON true
  LEFT JOIN LATERAL (
    SELECT d.status, d.posted_at, d.last_error, d.attempts FROM public.deliveries d
    WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id
    ORDER BY d.created_at DESC LIMIT 1
  ) dl ON true
  LEFT JOIN LATERAL (
    SELECT x.status, x.x_tweet_id, x.posted_at, x.last_error, x.skip_reason
    FROM public.x_deliveries x WHERE x.post_id = p.tweet_id
    ORDER BY x.created_at DESC LIMIT 1
  ) xd ON true
  WHERE p.tweet_id = ANY(tweet_ids)
  ORDER BY p.created_at DESC;
$$;