-- Optimize cron job frequency based on job volume
-- Increase batch size to 20 jobs and run every 15 seconds for better efficiency
-- This reduces API calls while maintaining low latency (max 15s delay)
SELECT cron.alter_job(1, schedule => '*/15 * * * * *');

-- Create index for faster job queries  
CREATE INDEX IF NOT EXISTS idx_jobs_pending_next_run 
ON jobs (status, next_run_at) 
WHERE status = 'pending';

-- Create index for faster job type queries
CREATE INDEX IF NOT EXISTS idx_jobs_type_status 
ON jobs (type, status);

-- Optimize the worker query performance with better indexing
CREATE INDEX IF NOT EXISTS idx_jobs_created_at_pending 
ON jobs (created_at) 
WHERE status = 'pending';