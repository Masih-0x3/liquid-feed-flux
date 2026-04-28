SELECT public.cleanup_old_data(7, 5000);

DELETE FROM public.jobs
WHERE status IN ('failed','completed')
  AND created_at < now() - interval '1 day';