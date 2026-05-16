-- Create a database function to trigger worker immediately when jobs are created
CREATE OR REPLACE FUNCTION trigger_worker_immediately()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for translate and deliver jobs to avoid infinite loops
  IF NEW.type IN ('translate', 'deliver', 'moderate', 'download_media') THEN
    PERFORM net.http_post(
      url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      ),
      body := '{"trigger": "job_created"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to fire worker immediately when new jobs are inserted
DROP TRIGGER IF EXISTS trigger_worker_on_job_insert ON jobs;
CREATE TRIGGER trigger_worker_on_job_insert
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_worker_immediately();

-- Also create a trigger for when jobs are updated to pending status (retries)
DROP TRIGGER IF EXISTS trigger_worker_on_job_retry ON jobs;
CREATE TRIGGER trigger_worker_on_job_retry
  AFTER UPDATE ON jobs
  FOR EACH ROW
  WHEN (OLD.status != 'pending' AND NEW.status = 'pending')
  EXECUTE FUNCTION trigger_worker_immediately();
