-- Harden public Supabase API/RPC surface for the admin-only XOT panel.
-- This migration intentionally keeps authenticated table privileges in place
-- for admin users, but removes anon object grants and broad "any signed-in user"
-- RLS policies.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Keep public.has_role for migration compatibility only; remove API execution.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- Remove unauthenticated object discovery/read access from public schema.
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

-- Recreate admin policies with a private helper so the helper itself is not
-- exposed as a public REST/GraphQL RPC.
DROP POLICY IF EXISTS "Admins can manage accounts" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated can view accounts" ON public.accounts;
CREATE POLICY "Admins can manage accounts" ON public.accounts FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated can view settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage posts" ON public.posts;
DROP POLICY IF EXISTS "Authenticated can view posts" ON public.posts;
CREATE POLICY "Admins can manage posts" ON public.posts FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage jobs" ON public.jobs;
DROP POLICY IF EXISTS "Authenticated can view jobs" ON public.jobs;
CREATE POLICY "Admins can manage jobs" ON public.jobs FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "Authenticated can view deliveries" ON public.deliveries;
CREATE POLICY "Admins can manage deliveries" ON public.deliveries FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage media" ON public.media;
DROP POLICY IF EXISTS "Authenticated can view media" ON public.media;
CREATE POLICY "Admins can manage media" ON public.media FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage threads" ON public.threads;
DROP POLICY IF EXISTS "Authenticated can view threads" ON public.threads;
CREATE POLICY "Admins can manage threads" ON public.threads FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage moderation_events" ON public.moderation_events;
DROP POLICY IF EXISTS "Authenticated can view moderation_events" ON public.moderation_events;
CREATE POLICY "Admins can manage moderation_events" ON public.moderation_events FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage feeds" ON public.feeds;
DROP POLICY IF EXISTS "Authenticated can view feeds" ON public.feeds;
CREATE POLICY "Admins can manage feeds" ON public.feeds FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage telegram_channel_stats" ON public.telegram_channel_stats;
DROP POLICY IF EXISTS "Authenticated can view telegram_channel_stats" ON public.telegram_channel_stats;
CREATE POLICY "Admins can manage telegram_channel_stats" ON public.telegram_channel_stats FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage telegram_daily_stats" ON public.telegram_daily_stats;
DROP POLICY IF EXISTS "Authenticated can view telegram_daily_stats" ON public.telegram_daily_stats;
CREATE POLICY "Admins can manage telegram_daily_stats" ON public.telegram_daily_stats FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage telegram_member_events" ON public.telegram_member_events;
DROP POLICY IF EXISTS "Authenticated can view telegram_member_events" ON public.telegram_member_events;
CREATE POLICY "Admins can manage telegram_member_events" ON public.telegram_member_events FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage telegram_message_analytics" ON public.telegram_message_analytics;
DROP POLICY IF EXISTS "Authenticated can view telegram_message_analytics" ON public.telegram_message_analytics;
CREATE POLICY "Admins can manage telegram_message_analytics" ON public.telegram_message_analytics FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage pipeline_events" ON public.pipeline_events;
DROP POLICY IF EXISTS "Authenticated can view pipeline_events" ON public.pipeline_events;
CREATE POLICY "Admins can manage pipeline_events" ON public.pipeline_events FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage dead_letter_jobs" ON public.dead_letter_jobs;
DROP POLICY IF EXISTS "Authenticated can view dead_letter_jobs" ON public.dead_letter_jobs;
CREATE POLICY "Admins can manage dead_letter_jobs" ON public.dead_letter_jobs FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage digests" ON public.digests;
DROP POLICY IF EXISTS "Authenticated can view digests" ON public.digests;
CREATE POLICY "Admins can manage digests" ON public.digests FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage x_deliveries" ON public.x_deliveries;
DROP POLICY IF EXISTS "Authenticated can view x_deliveries" ON public.x_deliveries;
CREATE POLICY "Admins can manage x_deliveries" ON public.x_deliveries FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage x_follower_snapshots" ON public.x_follower_snapshots;
DROP POLICY IF EXISTS "Authenticated can view x_follower_snapshots" ON public.x_follower_snapshots;
CREATE POLICY "Admins can manage x_follower_snapshots" ON public.x_follower_snapshots FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage x_followers_cache" ON public.x_followers_cache;
DROP POLICY IF EXISTS "Authenticated can view x_followers_cache" ON public.x_followers_cache;
CREATE POLICY "Admins can manage x_followers_cache" ON public.x_followers_cache FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage x_follower_changes" ON public.x_follower_changes;
DROP POLICY IF EXISTS "Authenticated can view x_follower_changes" ON public.x_follower_changes;
CREATE POLICY "Admins can manage x_follower_changes" ON public.x_follower_changes FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage story_signatures" ON public.story_signatures;
DROP POLICY IF EXISTS "Authenticated can view story_signatures" ON public.story_signatures;
CREATE POLICY "Admins can manage story_signatures" ON public.story_signatures FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage feedback_events" ON public.feedback_events;
CREATE POLICY "Admins can manage feedback_events" ON public.feedback_events FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage story_pair_blocklist" ON public.story_pair_blocklist;
CREATE POLICY "Admins can manage story_pair_blocklist" ON public.story_pair_blocklist FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (private.has_role((SELECT auth.uid()), 'admin'));

-- Harden view execution/visibility where Postgres supports security invoker.
DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'telegram_channel_current',
    'telegram_member_growth',
    'telegram_message_performance',
    'x_deliveries_safe'
  ]
  LOOP
    IF to_regclass('public.' || view_name) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', view_name);
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', view_name);
    END IF;
  END LOOP;
END $$;

-- Close privileged RPC execution. Frontend callers now go through admin-actions,
-- which validates the Supabase user and admin role before using service role.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.claim_jobs(integer,text[],text)',
    'public.cleanup_old_data(integer,integer)',
    'public.retry_step(text,text)',
    'public.reconcile_stuck_jobs()',
    'public.get_system_health()',
    'public.get_x_posting_summary()',
    'public.get_dashboard_summary()',
    'public.get_post_pipeline_status(text[])',
    'public.get_ingest_heartbeat()',
    'public.get_old_media(integer)',
    'public.verify_webhook_internal_token(text)',
    'public.find_similar_story(vector,bigint,text,integer,numeric)',
    'public.find_similar_story_v2(vector,bigint,text,integer,numeric)',
    'public.knn_feedback_prior(vector,text,integer,numeric)',
    'public.rebuild_learned_biases(numeric,numeric)',
    'public.bump_coverage_count(text)'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
