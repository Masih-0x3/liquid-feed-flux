-- 1. Add hydration columns to posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hydrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS hydration_source text;

CREATE INDEX IF NOT EXISTS idx_posts_truncated_unhydrated
  ON public.posts (created_at DESC)
  WHERE is_truncated = true AND hydrated_at IS NULL;

-- 2. Seed settings rows
INSERT INTO public.settings (key, value, description)
VALUES (
  'twitter_hydration',
  '{"enabled": true, "max_attempts": 3}'::jsonb,
  'Configuration for hydrating truncated tweets via the X API v2'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value, description)
VALUES (
  'x_api_usage',
  '{"total": 0, "calls_24h": [], "last_call_at": null, "last_error": null}'::jsonb,
  'Rolling counter of X API hydration calls (calls_24h is an array of ISO timestamps trimmed to 24h)'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Update get_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  since timestamptz := now() - interval '24 hours';
  posts_ingested int;
  posts_translated int;
  posts_delivered int;
  failed_jobs int;
  total_jobs int;
  completed_jobs int;
  pending_jobs int;
  active_feeds int;
  avg_latency_sec numeric;
  recent_posts jsonb;
  truncated_24h int;
  hydrated_24h int;
  x_api_calls_24h int;
  x_api_usage_row jsonb;
BEGIN
  SELECT count(*) INTO posts_ingested FROM public.posts WHERE created_at >= since;
  SELECT count(*) INTO posts_translated FROM public.posts WHERE created_at >= since AND text_translated IS NOT NULL;
  SELECT count(*) INTO posts_delivered FROM public.deliveries WHERE created_at >= since AND status = 'posted' AND subject_type = 'post';
  SELECT count(*) INTO failed_jobs FROM public.jobs WHERE created_at >= since AND status = 'failed';
  SELECT count(*) INTO total_jobs FROM public.jobs WHERE created_at >= since;
  SELECT count(*) INTO completed_jobs FROM public.jobs WHERE created_at >= since AND status = 'completed';
  SELECT count(*) INTO pending_jobs FROM public.jobs WHERE created_at >= since AND status = 'pending';
  SELECT count(*) INTO active_feeds FROM public.accounts WHERE enabled = true;

  SELECT count(*) INTO truncated_24h
    FROM public.posts
   WHERE created_at >= since AND (is_truncated = true OR hydrated_at IS NOT NULL);

  SELECT count(*) INTO hydrated_24h
    FROM public.posts
   WHERE hydrated_at IS NOT NULL AND hydrated_at >= since;

  SELECT value INTO x_api_usage_row FROM public.settings WHERE key = 'x_api_usage';
  IF x_api_usage_row IS NULL THEN
    x_api_calls_24h := 0;
  ELSE
    SELECT count(*) INTO x_api_calls_24h
      FROM jsonb_array_elements_text(coalesce(x_api_usage_row->'calls_24h', '[]'::jsonb)) ts
     WHERE (ts)::timestamptz >= since;
  END IF;

  SELECT coalesce(avg(EXTRACT(EPOCH FROM (d.created_at - p.created_at))), 0)
  INTO avg_latency_sec
  FROM public.deliveries d
  JOIN public.posts p ON p.tweet_id = d.subject_id
  WHERE d.status = 'posted' AND d.subject_type = 'post'
    AND d.created_at >= since AND p.created_at >= since;

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
  INTO recent_posts
  FROM (
    SELECT p.tweet_id, p.text_original, p.created_at, p.text_translated,
           a.handle as account_handle
    FROM public.posts p
    JOIN public.accounts a ON a.id = p.account_id
    ORDER BY p.created_at DESC
    LIMIT 10
  ) r;

  result := jsonb_build_object(
    'metrics', jsonb_build_object(
      'posts_ingested', posts_ingested,
      'posts_translated', posts_translated,
      'posts_delivered', posts_delivered,
      'failed_jobs', failed_jobs,
      'posts_truncated_24h', truncated_24h,
      'posts_hydrated_24h', hydrated_24h,
      'x_api_calls_24h', x_api_calls_24h
    ),
    'health', jsonb_build_object(
      'success_rate', CASE WHEN total_jobs > 0 THEN round((completed_jobs::numeric / total_jobs::numeric) * 100, 1) ELSE 100 END,
      'avg_latency', round(avg_latency_sec::numeric, 1),
      'active_feeds', active_feeds,
      'queue_size', pending_jobs,
      'is_online', true
    ),
    'recent_posts', recent_posts
  );

  RETURN result;
END;
$function$;

-- 4. Drop & recreate get_post_pipeline_status with new return columns
DROP FUNCTION IF EXISTS public.get_post_pipeline_status(text[]);

CREATE FUNCTION public.get_post_pipeline_status(tweet_ids text[])
 RETURNS TABLE(tweet_id text, ingest_at timestamp with time zone, media_total integer, media_downloaded integer, lang_original text, translated_at timestamp with time zone, translate_status text, translate_error text, delivery_status text, posted_at timestamp with time zone, delivery_error text, attempts integer, is_truncated boolean, hydrated_at timestamp with time zone, hydration_source text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    p.tweet_id,
    p.created_at AS ingest_at,
    coalesce(mc.total, 0)  AS media_total,
    coalesce(mc.downloaded, 0) AS media_downloaded,
    p.lang_original,
    p.translated_at,
    coalesce(tj.status, CASE WHEN p.translated_at IS NOT NULL THEN 'completed' ELSE 'pending' END) AS translate_status,
    tj.last_error AS translate_error,
    coalesce(dl.status, 'pending') AS delivery_status,
    dl.posted_at,
    coalesce(dl.last_error, dj.last_error) AS delivery_error,
    coalesce(dl.attempts, 0) AS attempts,
    coalesce(p.is_truncated, false) AS is_truncated,
    p.hydrated_at,
    p.hydration_source
  FROM public.posts p
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE m.downloaded_at IS NOT NULL) AS downloaded
    FROM public.media m WHERE m.tweet_id = p.tweet_id
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT j.status, j.last_error
    FROM public.jobs j
    WHERE j.type = 'translate' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) tj ON true
  LEFT JOIN LATERAL (
    SELECT j.last_error
    FROM public.jobs j
    WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) dj ON true
  LEFT JOIN LATERAL (
    SELECT d.status, d.posted_at, d.last_error, d.attempts
    FROM public.deliveries d
    WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id
    ORDER BY d.created_at DESC LIMIT 1
  ) dl ON true
  WHERE p.tweet_id = ANY(tweet_ids)
  ORDER BY p.created_at DESC;
$function$;

-- 5. Update reconcile_stuck_jobs
CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  expired_leases int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  result jsonb;
BEGIN
  UPDATE public.jobs
  SET status = 'pending', locked_at = NULL, locked_by = NULL, lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'deliver:reconcile:' || p.tweet_id,
         now()
  FROM public.posts p
  WHERE p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id AND j.status IN ('pending', 'running')
    )
    AND p.created_at > now() - interval '7 days'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'hydrate_tweet',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'hydrate:reconcile:' || p.tweet_id,
         now(),
         15
  FROM public.posts p
  WHERE p.is_truncated = true
    AND p.hydrated_at IS NULL
    AND p.created_at > now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending', 'running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'reconciled_at', now()
  );

  RETURN result;
END;
$function$;