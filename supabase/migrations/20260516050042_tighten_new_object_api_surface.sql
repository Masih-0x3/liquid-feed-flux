-- Tighten the new production-readiness objects so the browser talks to them
-- through admin-actions rather than direct REST/GraphQL object grants.

REVOKE ALL ON public.queue_reconcile_runs FROM anon, authenticated;
GRANT ALL ON public.queue_reconcile_runs TO service_role;

REVOKE ALL ON public.x_api_events FROM anon, authenticated;
GRANT ALL ON public.x_api_events TO service_role;

REVOKE ALL ON public.scoring_examples FROM anon, authenticated;
GRANT ALL ON public.scoring_examples TO service_role;

REVOKE ALL ON public.scoring_evaluations FROM anon, authenticated;
GRANT ALL ON public.scoring_evaluations TO service_role;

REVOKE ALL ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_story_candidates_v3(vector(1536), text, int, numeric, int)
  TO service_role;
