-- SR-RLS-01: raw render/intake records are server-only.
--
-- The browser reads operational projections through the authenticated
-- admin-actions boundary. It must not query these raw tables directly: they
-- can contain source URLs, storage paths, renderer diagnostics, and operator
-- intake data that are intentionally redacted from action responses.
--
-- This is deliberately forward-only. Apply it only after the migration
-- baseline/release ledger proves the target database has the expected
-- predecessor policy state.

BEGIN;

-- video_renders
ALTER TABLE public.video_renders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view video renders" ON public.video_renders;
DROP POLICY IF EXISTS "Authenticated can view video renders" ON public.video_renders;
DROP POLICY IF EXISTS "Admins can manage video renders" ON public.video_renders;
DROP POLICY IF EXISTS "Authenticated can manage video renders" ON public.video_renders;
DROP POLICY IF EXISTS "Service role can manage video renders" ON public.video_renders;
REVOKE ALL ON TABLE public.video_renders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_renders TO service_role;
CREATE POLICY "Service role can manage video renders"
  ON public.video_renders
  FOR ALL
  TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- video_render_feedback
ALTER TABLE public.video_render_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view video render feedback" ON public.video_render_feedback;
DROP POLICY IF EXISTS "Authenticated can view video render feedback" ON public.video_render_feedback;
DROP POLICY IF EXISTS "Admins can manage video render feedback" ON public.video_render_feedback;
DROP POLICY IF EXISTS "Authenticated can manage video render feedback" ON public.video_render_feedback;
DROP POLICY IF EXISTS "Service role can manage video render feedback" ON public.video_render_feedback;
REVOKE ALL ON TABLE public.video_render_feedback FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_render_feedback TO service_role;
CREATE POLICY "Service role can manage video render feedback"
  ON public.video_render_feedback
  FOR ALL
  TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- video_renderer_heartbeats
ALTER TABLE public.video_renderer_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view video renderer heartbeats" ON public.video_renderer_heartbeats;
DROP POLICY IF EXISTS "Authenticated can view video renderer heartbeats" ON public.video_renderer_heartbeats;
DROP POLICY IF EXISTS "Admins can manage video renderer heartbeats" ON public.video_renderer_heartbeats;
DROP POLICY IF EXISTS "Authenticated can manage video renderer heartbeats" ON public.video_renderer_heartbeats;
DROP POLICY IF EXISTS "Service role can manage video renderer heartbeats" ON public.video_renderer_heartbeats;
REVOKE ALL ON TABLE public.video_renderer_heartbeats FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.video_renderer_heartbeats TO service_role;
CREATE POLICY "Service role can manage video renderer heartbeats"
  ON public.video_renderer_heartbeats
  FOR ALL
  TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- manual_video_intakes
ALTER TABLE public.manual_video_intakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view manual video intakes" ON public.manual_video_intakes;
DROP POLICY IF EXISTS "Authenticated can view manual video intakes" ON public.manual_video_intakes;
DROP POLICY IF EXISTS "Admins can manage manual video intakes" ON public.manual_video_intakes;
DROP POLICY IF EXISTS "Authenticated can manage manual video intakes" ON public.manual_video_intakes;
DROP POLICY IF EXISTS "Service role can manage manual video intakes" ON public.manual_video_intakes;
REVOKE ALL ON TABLE public.manual_video_intakes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.manual_video_intakes TO service_role;
CREATE POLICY "Service role can manage manual video intakes"
  ON public.manual_video_intakes
  FOR ALL
  TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

COMMIT;
