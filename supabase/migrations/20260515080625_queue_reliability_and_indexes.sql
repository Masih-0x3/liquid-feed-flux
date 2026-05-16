-- Record queue reconciliation outcomes so stale lease recovery is observable.
CREATE TABLE IF NOT EXISTS public.queue_reconcile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  expired_leases_released integer NOT NULL DEFAULT 0,
  stale_running_released integer NOT NULL DEFAULT 0,
  missing_translates_created integer NOT NULL DEFAULT 0,
  missing_deliveries_created integer NOT NULL DEFAULT 0,
  missing_hydrations_created integer NOT NULL DEFAULT 0,
  missing_media_created integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_queue_reconcile_runs_ran_at
  ON public.queue_reconcile_runs (ran_at DESC);

ALTER TABLE public.queue_reconcile_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage queue_reconcile_runs" ON public.queue_reconcile_runs;
CREATE POLICY "Admins can manage queue_reconcile_runs" ON public.queue_reconcile_runs
  FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

REVOKE ALL ON public.queue_reconcile_runs FROM anon, authenticated;
GRANT ALL ON public.queue_reconcile_runs TO service_role;

-- Performance advisor: foreign-key lookups on snapshot delete/update need indexes.
CREATE INDEX IF NOT EXISTS idx_x_follower_changes_prev_snapshot_id
  ON public.x_follower_changes (prev_snapshot_id)
  WHERE prev_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x_follower_changes_curr_snapshot_id
  ON public.x_follower_changes (curr_snapshot_id)
  WHERE curr_snapshot_id IS NOT NULL;

-- Duplicate of jobs_idempotency_key_unique, which is the index required for upsert.
DROP INDEX IF EXISTS public.idx_jobs_idempotency;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  expired_leases int := 0;
  stale_running int := 0;
  missing_deliveries int := 0;
  missing_hydrations int := 0;
  missing_translates int := 0;
  missing_media int := 0;
  result jsonb;
BEGIN
  -- 1) Release jobs whose explicit lease expired.
  UPDATE public.jobs
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: lease expired'
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < now();
  GET DIAGNOSTICS expired_leases = ROW_COUNT;

  -- 2) Release old running jobs that have no active lease marker.
  UPDATE public.jobs
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = 'Released: stale running job without active lease'
  WHERE status = 'running'
    AND lease_expires_at IS NULL
    AND COALESCE(locked_at, created_at) < now() - interval '30 minutes';
  GET DIAGNOSTICS stale_running = ROW_COUNT;

  -- 3) Re-queue translate.
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'translate',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'translate:reconcile:' || p.tweet_id,
         now(),
         10
  FROM public.posts p
  WHERE p.translated_at IS NULL
    AND p.text_translated IS NULL
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'translate'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_translates = ROW_COUNT;

  -- 4) Re-queue deliver.
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
  SELECT 'deliver',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'deliver:reconcile:' || p.tweet_id,
         now()
  FROM public.posts p
  WHERE p.translated_at IS NOT NULL
    AND p.text_translated IS NOT NULL
    AND COALESCE(p.delivery_decision, 'deliver') = 'deliver'
    AND NOT (p.is_truncated = true AND p.hydrated_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id AND d.status = 'posted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'deliver'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
    AND p.created_at > now() - interval '24 hours'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_deliveries = ROW_COUNT;

  -- 5) Re-queue hydration.
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
    AND p.translated_at IS NOT NULL
    AND p.delivery_decision = 'deliver'
    AND p.created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type = 'hydrate_tweet'
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_hydrations = ROW_COUNT;

  -- 6) Re-queue resolve_media for posts that flagged media but have no downloaded rows.
  INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
  SELECT 'resolve_media',
         jsonb_build_object('tweet_id', p.tweet_id),
         'pending',
         'resolve_media:reconcile:' || p.tweet_id,
         now(),
         12
  FROM public.posts p
  WHERE p.has_media = true
    AND p.created_at > now() - interval '24 hours'
    AND p.tweet_id <> 'https://twitter.com/Osint613/status/2052532719637180730'
    AND NOT EXISTS (
      SELECT 1 FROM public.media m
      WHERE m.tweet_id = p.tweet_id AND m.downloaded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.type IN ('resolve_media','download_media')
        AND (j.payload->>'tweet_id') = p.tweet_id
        AND j.status IN ('pending','running')
    )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS missing_media = ROW_COUNT;

  -- 7) Mark the manually-posted Osint613 resolve_media job as completed.
  UPDATE public.jobs
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      last_error = COALESCE(last_error, 'manually posted; superseded')
  WHERE type = 'resolve_media'
    AND status IN ('pending','running')
    AND (payload->>'tweet_id') = 'https://twitter.com/Osint613/status/2052532719637180730';

  result := jsonb_build_object(
    'expired_leases_released', expired_leases,
    'stale_running_released', stale_running,
    'missing_translates_created', missing_translates,
    'missing_deliveries_created', missing_deliveries,
    'missing_hydrations_created', missing_hydrations,
    'missing_media_created', missing_media,
    'reconciled_at', now()
  );

  INSERT INTO public.queue_reconcile_runs (
    result,
    expired_leases_released,
    stale_running_released,
    missing_translates_created,
    missing_deliveries_created,
    missing_hydrations_created,
    missing_media_created
  )
  VALUES (
    result,
    expired_leases,
    stale_running,
    missing_translates,
    missing_deliveries,
    missing_hydrations,
    missing_media
  );

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_system_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_count int;
  running_count int;
  stale_running_count int;
  failed_24h int;
  completed_24h int;
  oldest_pending_age interval;
  dlq_count int;
  last_reconcile jsonb;
BEGIN
  SELECT count(*) INTO pending_count FROM public.jobs WHERE status = 'pending';
  SELECT count(*) INTO running_count FROM public.jobs WHERE status = 'running';
  SELECT count(*) INTO stale_running_count
  FROM public.jobs
  WHERE status = 'running'
    AND (
      (lease_expires_at IS NOT NULL AND lease_expires_at < now())
      OR (lease_expires_at IS NULL AND COALESCE(locked_at, created_at) < now() - interval '30 minutes')
    );
  SELECT count(*) INTO failed_24h FROM public.jobs WHERE status = 'failed' AND created_at > now() - interval '24 hours';
  SELECT count(*) INTO completed_24h FROM public.jobs WHERE status = 'completed' AND created_at > now() - interval '24 hours';
  SELECT now() - min(created_at) INTO oldest_pending_age FROM public.jobs WHERE status = 'pending';
  SELECT count(*) INTO dlq_count FROM public.dead_letter_jobs;
  SELECT to_jsonb(r) INTO last_reconcile
  FROM (
    SELECT ran_at, expired_leases_released, stale_running_released,
           missing_translates_created, missing_deliveries_created,
           missing_hydrations_created, missing_media_created
    FROM public.queue_reconcile_runs
    ORDER BY ran_at DESC
    LIMIT 1
  ) r;

  RETURN jsonb_build_object(
    'queue_pending', pending_count,
    'queue_running', running_count,
    'queue_stale_running_30m', stale_running_count,
    'failed_24h', failed_24h,
    'completed_24h', completed_24h,
    'oldest_pending_age_seconds', COALESCE(EXTRACT(EPOCH FROM oldest_pending_age), 0),
    'dead_letter_count', dlq_count,
    'last_reconcile', COALESCE(last_reconcile, '{}'::jsonb),
    'success_rate_24h', CASE WHEN (completed_24h + failed_24h) > 0
      THEN round((completed_24h::numeric / (completed_24h + failed_24h)::numeric) * 100, 1)
      ELSE 100 END
  );
END;
$$;

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
  x_api_calls_24h int; x_api_usage_row jsonb; x_summary jsonb; heartbeat jsonb; last_reconcile jsonb;
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
END; $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stuck-jobs-every-10m') THEN
    PERFORM cron.unschedule('reconcile-stuck-jobs-every-10m');
  END IF;
END $$;

SELECT cron.schedule(
  'reconcile-stuck-jobs-every-10m',
  '*/10 * * * *',
  $cron$
  SELECT public.reconcile_stuck_jobs();
  $cron$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-15s') THEN
    PERFORM cron.unschedule('invoke-worker-every-15s');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-worker-every-2m') THEN
    PERFORM cron.unschedule('invoke-worker-every-2m');
  END IF;
END $$;

SELECT cron.schedule(
  'invoke-worker-every-2m',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
    headers := public._cron_internal_headers(),
    body := '{"trigger":"cron"}'::jsonb
  );
  $cron$
);
