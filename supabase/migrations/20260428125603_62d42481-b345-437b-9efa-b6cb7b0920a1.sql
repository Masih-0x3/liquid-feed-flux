-- Cancel all pending jobs to discard backlog after DB recovery
UPDATE public.jobs
SET status = 'failed',
    last_error = 'cancelled_by_admin: backlog discarded after DB recovery',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    next_run_at = NULL,
    completed_at = now()
WHERE status = 'pending';

-- Release any stuck running jobs whose leases expired
UPDATE public.jobs
SET status = 'failed',
    last_error = 'cancelled_by_admin: backlog discarded after DB recovery',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    completed_at = now()
WHERE status = 'running'
  AND (lease_expires_at IS NULL OR lease_expires_at < now());

-- Cancel pending deliveries so old Telegram/X sends don't fire
UPDATE public.deliveries
SET status = 'failed',
    last_error = 'cancelled_by_admin: backlog discarded after DB recovery',
    last_attempt_at = now()
WHERE status = 'pending';

UPDATE public.x_deliveries
SET status = 'failed',
    last_error = 'cancelled_by_admin: backlog discarded after DB recovery',
    updated_at = now()
WHERE status = 'pending';

-- Prune pipeline_events older than 1 hour to immediately reduce I/O pressure
DELETE FROM public.pipeline_events
WHERE created_at < now() - interval '1 hour';