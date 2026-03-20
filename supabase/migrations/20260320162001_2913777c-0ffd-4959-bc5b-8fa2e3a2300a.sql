-- Create the unique index (this is the critical fix)
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_key_unique 
ON public.jobs (idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- Clear zombie running jobs
UPDATE public.jobs 
SET status = 'failed', 
    last_error = 'Manually cleared: stuck in running with no lease', 
    completed_at = now() 
WHERE status = 'running' 
  AND lease_expires_at IS NULL;