
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  -- Metrics
  SELECT count(*) INTO posts_ingested FROM public.posts WHERE created_at >= since;
  SELECT count(*) INTO posts_translated FROM public.posts WHERE created_at >= since AND text_translated IS NOT NULL;
  SELECT count(*) INTO posts_delivered FROM public.deliveries WHERE created_at >= since AND status = 'posted' AND subject_type = 'post';
  SELECT count(*) INTO failed_jobs FROM public.jobs WHERE created_at >= since AND status = 'failed';
  SELECT count(*) INTO total_jobs FROM public.jobs WHERE created_at >= since;
  SELECT count(*) INTO completed_jobs FROM public.jobs WHERE created_at >= since AND status = 'completed';
  SELECT count(*) INTO pending_jobs FROM public.jobs WHERE created_at >= since AND status = 'pending';
  SELECT count(*) INTO active_feeds FROM public.accounts WHERE enabled = true;

  -- Avg latency: time from post creation to successful delivery
  SELECT coalesce(avg(EXTRACT(EPOCH FROM (d.created_at - p.created_at))), 0)
  INTO avg_latency_sec
  FROM public.deliveries d
  JOIN public.posts p ON p.tweet_id = d.subject_id
  WHERE d.status = 'posted' AND d.subject_type = 'post'
    AND d.created_at >= since AND p.created_at >= since;

  -- Recent posts (last 10)
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
      'failed_jobs', failed_jobs
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
$$;
