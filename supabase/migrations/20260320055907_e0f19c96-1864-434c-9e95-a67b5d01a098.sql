
-- Fix search_path on reconcile_stuck_jobs (already set, but let's be explicit)
-- Fix search_path on pre-existing functions that are missing it

ALTER FUNCTION public.calculate_growth_rate(text, integer) SET search_path = 'public';
ALTER FUNCTION public.get_top_performing_posts(integer) SET search_path = 'public';
ALTER FUNCTION public.retry_step(text, text) SET search_path = 'public';
ALTER FUNCTION public.get_post_pipeline_status(text[]) SET search_path = 'public';
