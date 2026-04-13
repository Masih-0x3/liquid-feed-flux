
-- Run cleanup immediately
SELECT public.cleanup_old_data(7, 10000);

-- Reconcile stuck jobs
SELECT public.reconcile_stuck_jobs();
