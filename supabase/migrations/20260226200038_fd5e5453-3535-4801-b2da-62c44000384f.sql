
-- Create a cleanup function that can be called to purge old data
CREATE OR REPLACE FUNCTION public.cleanup_old_data(retention_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_pipeline_events integer;
  deleted_jobs integer;
  deleted_cron_logs integer;
  deleted_http_responses integer;
BEGIN
  -- Delete old pipeline_events
  DELETE FROM public.pipeline_events 
  WHERE created_at < NOW() - INTERVAL '1 day' * retention_days;
  GET DIAGNOSTICS deleted_pipeline_events = ROW_COUNT;

  -- Delete completed/failed jobs older than retention period
  DELETE FROM public.jobs 
  WHERE status IN ('completed', 'failed') 
    AND created_at < NOW() - INTERVAL '1 day' * retention_days;
  GET DIAGNOSTICS deleted_jobs = ROW_COUNT;

  -- Delete old cron job run details
  DELETE FROM cron.job_run_details 
  WHERE end_time < NOW() - INTERVAL '1 day' * retention_days;
  GET DIAGNOSTICS deleted_cron_logs = ROW_COUNT;

  -- Delete old net._http_response entries
  DELETE FROM net._http_response 
  WHERE created < NOW() - INTERVAL '1 day' * retention_days;
  GET DIAGNOSTICS deleted_http_responses = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_pipeline_events', deleted_pipeline_events,
    'deleted_jobs', deleted_jobs,
    'deleted_cron_logs', deleted_cron_logs,
    'deleted_http_responses', deleted_http_responses
  );
END;
$$;
