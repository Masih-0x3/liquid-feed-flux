-- 1) Tighten x_deliveries: remove broad authenticated SELECT (api_response may contain
--    sensitive Twitter API metadata). Admin ALL policy remains for the admin panel.
DROP POLICY IF EXISTS "Authenticated can view x_deliveries" ON public.x_deliveries;

-- Provide a safe view for non-admin authenticated users that excludes raw api_response.
CREATE OR REPLACE VIEW public.x_deliveries_safe
WITH (security_invoker = on) AS
SELECT id, post_id, x_tweet_id, status, skip_reason, attempts, last_error,
       media_count, media_bytes, media_kind, posted_at, latency_ms,
       created_at, updated_at
FROM public.x_deliveries;

-- Allow authenticated users to read the safe view (RLS on underlying table still applies
-- via security_invoker, so only admins can read; this view simply documents the safe shape
-- and prevents accidental exposure of api_response if a permissive policy is ever added).
GRANT SELECT ON public.x_deliveries_safe TO authenticated;

-- 2) Defensive: explicitly ensure no broad SELECT exists on settings (it stores config JSON
--    that may include sensitive values). Admin ALL policy is the only access path.
DROP POLICY IF EXISTS "Authenticated can view settings" ON public.settings;