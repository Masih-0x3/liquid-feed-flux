-- XOT-owned process observability ledgers.
--
-- These tables make the dashboard independent from hosted Foglamp reads. Hosted
-- Foglamp trace ids remain correlation metadata; Supabase rows are the product
-- source of truth for workflow, AI-call, and budget accounting.

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  workflow_name text NOT NULL,
  workflow_run_id text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  source text,
  source_function text,
  subject_type text,
  subject_id text,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  tweet_id text REFERENCES public.posts(tweet_id) ON DELETE SET NULL,
  root_trace_id text,
  foglamp_workflow_run_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view workflow runs" ON public.workflow_runs;
DROP POLICY IF EXISTS "Admins can view workflow runs" ON public.workflow_runs;
CREATE POLICY "Admins can view workflow runs"
ON public.workflow_runs
FOR SELECT
TO authenticated
USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Service role can manage workflow runs" ON public.workflow_runs;
CREATE POLICY "Service role can manage workflow runs"
ON public.workflow_runs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.workflow_runs TO authenticated;
GRANT ALL ON public.workflow_runs TO service_role;

DROP TRIGGER IF EXISTS trg_workflow_runs_updated_at ON public.workflow_runs;
CREATE TRIGGER trg_workflow_runs_updated_at
  BEFORE UPDATE ON public.workflow_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_started
  ON public.workflow_runs (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started
  ON public.workflow_runs (workflow_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_tweet_started
  ON public.workflow_runs (tweet_id, started_at DESC)
  WHERE tweet_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_call_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_key text NOT NULL REFERENCES public.workflow_runs(run_key) ON DELETE CASCADE,
  trace_name text NOT NULL,
  operation_name text NOT NULL,
  agent_name text,
  provider text NOT NULL DEFAULT 'openai',
  model text,
  endpoint text,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed', 'skipped')),
  http_status integer,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  reasoning_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(14, 6),
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_message text,
  foglamp_exported boolean NOT NULL DEFAULT false,
  foglamp_span_estimate integer NOT NULL DEFAULT 0,
  foglamp_skip_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_call_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view ai call ledger" ON public.ai_call_ledger;
DROP POLICY IF EXISTS "Admins can view ai call ledger" ON public.ai_call_ledger;
CREATE POLICY "Admins can view ai call ledger"
ON public.ai_call_ledger
FOR SELECT
TO authenticated
USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Service role can manage ai call ledger" ON public.ai_call_ledger;
CREATE POLICY "Service role can manage ai call ledger"
ON public.ai_call_ledger
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.ai_call_ledger TO authenticated;
GRANT ALL ON public.ai_call_ledger TO service_role;

CREATE INDEX IF NOT EXISTS idx_ai_call_ledger_started
  ON public.ai_call_ledger (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_ledger_workflow
  ON public.ai_call_ledger (workflow_run_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_ledger_status_started
  ON public.ai_call_ledger (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.budget_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  unit text NOT NULL,
  quantity numeric(18, 6) NOT NULL DEFAULT 0,
  period_key text NOT NULL,
  workflow_run_key text REFERENCES public.workflow_runs(run_key) ON DELETE SET NULL,
  source_table text,
  source_id text,
  estimated_cost_usd numeric(14, 6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view budget ledger" ON public.budget_ledger;
DROP POLICY IF EXISTS "Admins can view budget ledger" ON public.budget_ledger;
CREATE POLICY "Admins can view budget ledger"
ON public.budget_ledger
FOR SELECT
TO authenticated
USING (private.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Service role can manage budget ledger" ON public.budget_ledger;
CREATE POLICY "Service role can manage budget ledger"
ON public.budget_ledger
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.budget_ledger TO authenticated;
GRANT ALL ON public.budget_ledger TO service_role;

CREATE INDEX IF NOT EXISTS idx_budget_ledger_period_provider_unit
  ON public.budget_ledger (period_key, provider, unit, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_workflow
  ON public.budget_ledger (workflow_run_key, created_at DESC)
  WHERE workflow_run_key IS NOT NULL;
