-- Temporary compatibility telemetry used to prove old aliases are unused before
-- removal. Rows intentionally avoid storing request bodies, auth tokens, or
-- query strings.
CREATE TABLE IF NOT EXISTS public.compatibility_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  feature text NOT NULL,
  legacy_value text,
  canonical_value text,
  action text,
  actor_id text,
  request_method text,
  request_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_compatibility_usage_events_created_at
  ON public.compatibility_usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compatibility_usage_events_feature
  ON public.compatibility_usage_events (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compatibility_usage_events_source_action
  ON public.compatibility_usage_events (source, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compatibility_usage_events_legacy
  ON public.compatibility_usage_events (legacy_value, created_at DESC)
  WHERE legacy_value IS NOT NULL;

ALTER TABLE public.compatibility_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.compatibility_usage_events FROM anon, authenticated;
GRANT ALL ON public.compatibility_usage_events TO service_role;
