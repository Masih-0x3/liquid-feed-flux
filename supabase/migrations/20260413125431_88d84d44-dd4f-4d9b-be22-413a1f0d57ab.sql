
CREATE OR REPLACE FUNCTION public.cleanup_old_data(retention_days integer DEFAULT 7, batch_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  deleted_pipeline_events integer := 0;
  deleted_jobs integer := 0;
  deleted_deliveries integer := 0;
  deleted_message_analytics integer := 0;
  deleted_moderation_events integer := 0;
  deleted_cron_logs integer := 0;
  deleted_http_responses integer := 0;
  batch_deleted integer;
  cutoff_ts timestamptz;
BEGIN
  cutoff_ts := NOW() - INTERVAL '1 day' * retention_days;

  -- Batch delete pipeline_events
  LOOP
    DELETE FROM public.pipeline_events 
    WHERE id IN (
      SELECT id FROM public.pipeline_events 
      WHERE created_at < cutoff_ts 
      LIMIT batch_limit
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_pipeline_events := deleted_pipeline_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- Batch delete completed/failed jobs
  LOOP
    DELETE FROM public.jobs 
    WHERE id IN (
      SELECT id FROM public.jobs 
      WHERE status IN ('completed', 'failed') 
        AND created_at < cutoff_ts 
      LIMIT batch_limit
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_jobs := deleted_jobs + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- Batch delete old deliveries
  LOOP
    DELETE FROM public.deliveries 
    WHERE id IN (
      SELECT id FROM public.deliveries 
      WHERE created_at < cutoff_ts 
      LIMIT batch_limit
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_deliveries := deleted_deliveries + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- Batch delete old telegram_message_analytics
  LOOP
    DELETE FROM public.telegram_message_analytics 
    WHERE id IN (
      SELECT id FROM public.telegram_message_analytics 
      WHERE created_at < cutoff_ts 
      LIMIT batch_limit
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_message_analytics := deleted_message_analytics + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- Batch delete old moderation_events
  LOOP
    DELETE FROM public.moderation_events 
    WHERE id IN (
      SELECT id FROM public.moderation_events 
      WHERE created_at < cutoff_ts 
      LIMIT batch_limit
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    deleted_moderation_events := deleted_moderation_events + batch_deleted;
    EXIT WHEN batch_deleted < batch_limit;
  END LOOP;

  -- Clean cron logs
  DELETE FROM cron.job_run_details WHERE end_time < cutoff_ts;
  GET DIAGNOSTICS deleted_cron_logs = ROW_COUNT;

  -- Clean net responses  
  DELETE FROM net._http_response WHERE created < cutoff_ts;
  GET DIAGNOSTICS deleted_http_responses = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_pipeline_events', deleted_pipeline_events,
    'deleted_jobs', deleted_jobs,
    'deleted_deliveries', deleted_deliveries,
    'deleted_message_analytics', deleted_message_analytics,
    'deleted_moderation_events', deleted_moderation_events,
    'deleted_cron_logs', deleted_cron_logs,
    'deleted_http_responses', deleted_http_responses
  );
END;
$function$;
