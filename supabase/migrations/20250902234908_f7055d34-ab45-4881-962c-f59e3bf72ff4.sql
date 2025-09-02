-- Remove the problematic triggers that can't make HTTP calls
DROP TRIGGER IF EXISTS trigger_worker_on_job_insert ON jobs;
DROP TRIGGER IF EXISTS trigger_worker_on_job_retry ON jobs;
DROP FUNCTION IF EXISTS trigger_worker_immediately();

-- Instead, let's optimize the cron job to run more frequently
-- Update the existing cron job to run every 10 seconds instead of every minute
SELECT cron.alter_job(1, schedule => '*/10 * * * * *');