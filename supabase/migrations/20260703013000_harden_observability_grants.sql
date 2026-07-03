-- Harden XOT-owned process observability table grants.
--
-- The first observability migration enables RLS and limits authenticated access
-- with admin-only SELECT policies. This migration also removes broad table
-- privileges that can be inherited from default role grants, leaving
-- authenticated users with only SELECT behind the admin RLS policy.

REVOKE ALL ON TABLE public.workflow_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.ai_call_ledger FROM anon, authenticated;
REVOKE ALL ON TABLE public.budget_ledger FROM anon, authenticated;

GRANT SELECT ON public.workflow_runs TO authenticated;
GRANT SELECT ON public.ai_call_ledger TO authenticated;
GRANT SELECT ON public.budget_ledger TO authenticated;

GRANT ALL ON public.workflow_runs TO service_role;
GRANT ALL ON public.ai_call_ledger TO service_role;
GRANT ALL ON public.budget_ledger TO service_role;
