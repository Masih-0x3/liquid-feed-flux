UPDATE public.jobs
SET status = 'failed',
    last_error = 'cancelled_by_admin: backlog discarded after DB recovery',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    completed_at = now()
WHERE status = 'running';