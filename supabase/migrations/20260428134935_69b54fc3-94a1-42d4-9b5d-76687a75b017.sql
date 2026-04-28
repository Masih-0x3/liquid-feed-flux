-- 1. Drop duplicate indexes
DROP INDEX IF EXISTS public.idx_deliveries_subject;
DROP INDEX IF EXISTS public.idx_pipeline_events_subject;

-- 2. Reindex bloated tables
REINDEX TABLE public.deliveries;
REINDEX TABLE public.posts;
REINDEX TABLE public.pipeline_events;
REINDEX TABLE public.jobs;
REINDEX TABLE public.media;

-- 3. Update cleanup function with aggressive cron retention
CREATE OR REPLACE FUNCTION public.cleanup_old_data(retention_days integer DEFAULT 7, batch_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '180s'
AS $function$
DECLARE
  deleted_pipeline_events integer := 0;
  deleted_jobs integer := 0;
  deleted_deliveries integer := 0;
  deleted_message_analytics integer := 0;
  deleted_moderation_events integer := 0;
  deleted_cron_logs integer := 0;
  deleted_http_responses integer := 0;
  deleted_posts integer := 0;
  deleted_media integer := 0;
  deleted_dead_letter integer := 0;
  batch_deleted integer;
  cutoff_ts timestamptz;
  cron_cutoff timestamptz;
BEGIN
  cutoff_ts := NOW() - INTERVAL '1 day' * retention_days;
  cron_cutoff := NOW() - INTERVAL '1 day';

  LOOP
    DELETE FROM public.pipeline_events
    WHERE id IN (SELECT id FROM public.pipeline_events WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_pipeline_events := deleted_pipeline_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.jobs
    WHERE id IN (SELECT id FROM public.jobs WHERE status IN ('completed','failed') AND created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_jobs := deleted_jobs + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.deliveries
    WHERE id IN (SELECT id FROM public.deliveries WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_deliveries := deleted_deliveries + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.telegram_message_analytics
    WHERE id IN (SELECT id FROM public.telegram_message_analytics WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_message_analytics := deleted_message_analytics + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.moderation_events
    WHERE id IN (SELECT id FROM public.moderation_events WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_moderation_events := deleted_moderation_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.media
    WHERE id IN (SELECT id FROM public.media WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_media := deleted_media + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.posts
    WHERE tweet_id IN (SELECT tweet_id FROM public.posts WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_posts := deleted_posts + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  LOOP
    DELETE FROM public.dead_letter_jobs
    WHERE id IN (SELECT id FROM public.dead_letter_jobs WHERE created_at < cutoff_ts LIMIT batch_limit);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_dead_letter := deleted_dead_letter + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  DELETE FROM cron.job_run_details WHERE end_time < cron_cutoff OR (end_time IS NULL AND start_time < cron_cutoff);
  GET DIAGNOSTICS deleted_cron_logs = ROW_COUNT;

  DELETE FROM net._http_response WHERE created < cron_cutoff;
  GET DIAGNOSTICS deleted_http_responses = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_pipeline_events', deleted_pipeline_events,
    'deleted_jobs', deleted_jobs,
    'deleted_deliveries', deleted_deliveries,
    'deleted_message_analytics', deleted_message_analytics,
    'deleted_moderation_events', deleted_moderation_events,
    'deleted_posts', deleted_posts,
    'deleted_media', deleted_media,
    'deleted_dead_letter', deleted_dead_letter,
    'deleted_cron_logs', deleted_cron_logs,
    'deleted_http_responses', deleted_http_responses
  );
END;
$function$;

-- 4. Immediately purge cron logs and http responses
DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '1 day' OR (end_time IS NULL AND start_time < NOW() - INTERVAL '1 day');
DELETE FROM net._http_response WHERE created < NOW() - INTERVAL '1 day';