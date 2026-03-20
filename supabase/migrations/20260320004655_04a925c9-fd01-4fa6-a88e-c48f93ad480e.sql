-- Issue 7: Rewrite RLS policies to use admin RBAC
-- Replace all "auth.uid() IS NOT NULL" policies with has_role() admin checks

-- ===== accounts =====
DROP POLICY IF EXISTS "Users can manage accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can view all accounts" ON public.accounts;
CREATE POLICY "Admins can manage accounts" ON public.accounts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view accounts" ON public.accounts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== settings =====
DROP POLICY IF EXISTS "Users can manage settings" ON public.settings;
DROP POLICY IF EXISTS "Users can view all settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view settings" ON public.settings FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== posts =====
DROP POLICY IF EXISTS "Users can manage posts" ON public.posts;
DROP POLICY IF EXISTS "Users can view all posts" ON public.posts;
CREATE POLICY "Admins can manage posts" ON public.posts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view posts" ON public.posts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== jobs =====
DROP POLICY IF EXISTS "Users can manage jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can view all jobs" ON public.jobs;
CREATE POLICY "Admins can manage jobs" ON public.jobs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view jobs" ON public.jobs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== deliveries =====
DROP POLICY IF EXISTS "Users can manage deliveries" ON public.deliveries;
DROP POLICY IF EXISTS "Users can view all deliveries" ON public.deliveries;
CREATE POLICY "Admins can manage deliveries" ON public.deliveries FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view deliveries" ON public.deliveries FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== media =====
DROP POLICY IF EXISTS "Users can manage media" ON public.media;
DROP POLICY IF EXISTS "Users can view all media" ON public.media;
CREATE POLICY "Admins can manage media" ON public.media FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view media" ON public.media FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== threads =====
DROP POLICY IF EXISTS "Users can manage threads" ON public.threads;
DROP POLICY IF EXISTS "Users can view all threads" ON public.threads;
CREATE POLICY "Admins can manage threads" ON public.threads FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view threads" ON public.threads FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== moderation_events =====
DROP POLICY IF EXISTS "Users can manage moderation events" ON public.moderation_events;
DROP POLICY IF EXISTS "Users can view all moderation events" ON public.moderation_events;
CREATE POLICY "Admins can manage moderation_events" ON public.moderation_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view moderation_events" ON public.moderation_events FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== feeds =====
DROP POLICY IF EXISTS "Users can manage feeds" ON public.feeds;
DROP POLICY IF EXISTS "Users can view all feeds" ON public.feeds;
CREATE POLICY "Admins can manage feeds" ON public.feeds FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view feeds" ON public.feeds FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== telegram_channel_stats =====
DROP POLICY IF EXISTS "Users can manage channel stats" ON public.telegram_channel_stats;
DROP POLICY IF EXISTS "Users can view channel stats" ON public.telegram_channel_stats;
CREATE POLICY "Admins can manage telegram_channel_stats" ON public.telegram_channel_stats FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view telegram_channel_stats" ON public.telegram_channel_stats FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== telegram_daily_stats =====
DROP POLICY IF EXISTS "Users can manage daily stats" ON public.telegram_daily_stats;
DROP POLICY IF EXISTS "Users can view daily stats" ON public.telegram_daily_stats;
CREATE POLICY "Admins can manage telegram_daily_stats" ON public.telegram_daily_stats FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view telegram_daily_stats" ON public.telegram_daily_stats FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== telegram_member_events =====
DROP POLICY IF EXISTS "Users can manage member events" ON public.telegram_member_events;
DROP POLICY IF EXISTS "Users can view member events" ON public.telegram_member_events;
CREATE POLICY "Admins can manage telegram_member_events" ON public.telegram_member_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view telegram_member_events" ON public.telegram_member_events FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== telegram_message_analytics =====
DROP POLICY IF EXISTS "Users can manage message analytics" ON public.telegram_message_analytics;
DROP POLICY IF EXISTS "Users can view message analytics" ON public.telegram_message_analytics;
CREATE POLICY "Admins can manage telegram_message_analytics" ON public.telegram_message_analytics FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view telegram_message_analytics" ON public.telegram_message_analytics FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== pipeline_events (enable RLS first) =====
ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage pipeline_events" ON public.pipeline_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view pipeline_events" ON public.pipeline_events FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== Issue 18: Add durable queue fields to jobs =====
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS priority int DEFAULT 0;

-- Add indexes for queue operations
CREATE INDEX IF NOT EXISTS idx_jobs_queue_poll ON public.jobs (status, type, next_run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON public.jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===== Issue 47: Optimize indexes =====
CREATE INDEX IF NOT EXISTS idx_deliveries_subject ON public.deliveries (subject_type, subject_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_subject ON public.pipeline_events (subject_type, subject_id, created_at DESC);

-- ===== Issue 17: Transactional job claiming RPC =====
CREATE OR REPLACE FUNCTION public.claim_jobs(batch_size int DEFAULT 10, job_types text[] DEFAULT NULL, worker_id text DEFAULT 'default')
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lease_duration interval := interval '5 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.jobs
  SET 
    status = 'running',
    locked_at = now(),
    locked_by = worker_id,
    lease_expires_at = now() + lease_duration,
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1
  WHERE id IN (
    SELECT j.id FROM public.jobs j
    WHERE j.status = 'pending'
      AND (j.next_run_at IS NULL OR j.next_run_at <= now())
      AND (job_types IS NULL OR j.type = ANY(job_types))
    ORDER BY j.priority DESC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

-- ===== Issue 20: Dead-letter queue =====
CREATE TABLE IF NOT EXISTS public.dead_letter_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id uuid,
  type text NOT NULL,
  payload jsonb,
  attempts int DEFAULT 0,
  last_error text,
  result_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'worker'
);

ALTER TABLE public.dead_letter_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage dead_letter_jobs" ON public.dead_letter_jobs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view dead_letter_jobs" ON public.dead_letter_jobs FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ===== Issue 48: Media deduplication =====
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS src_url_hash text;
CREATE INDEX IF NOT EXISTS idx_media_url_hash ON public.media (src_url_hash) WHERE src_url_hash IS NOT NULL;

-- ===== Issue 35: Health dashboard RPC =====
CREATE OR REPLACE FUNCTION public.get_system_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  pending_count int;
  running_count int;
  failed_24h int;
  completed_24h int;
  oldest_pending_age interval;
  dlq_count int;
BEGIN
  SELECT count(*) INTO pending_count FROM public.jobs WHERE status = 'pending';
  SELECT count(*) INTO running_count FROM public.jobs WHERE status = 'running';
  SELECT count(*) INTO failed_24h FROM public.jobs WHERE status = 'failed' AND created_at > now() - interval '24 hours';
  SELECT count(*) INTO completed_24h FROM public.jobs WHERE status = 'completed' AND created_at > now() - interval '24 hours';
  SELECT now() - min(created_at) INTO oldest_pending_age FROM public.jobs WHERE status = 'pending';
  SELECT count(*) INTO dlq_count FROM public.dead_letter_jobs;

  result := jsonb_build_object(
    'queue_pending', pending_count,
    'queue_running', running_count,
    'failed_24h', failed_24h,
    'completed_24h', completed_24h,
    'oldest_pending_age_seconds', COALESCE(EXTRACT(EPOCH FROM oldest_pending_age), 0),
    'dead_letter_count', dlq_count,
    'success_rate_24h', CASE WHEN (completed_24h + failed_24h) > 0 
      THEN round((completed_24h::numeric / (completed_24h + failed_24h)::numeric) * 100, 1) 
      ELSE 100 END
  );
  
  RETURN result;
END;
$$;