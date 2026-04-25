
-- Snapshots table
CREATE TABLE public.x_follower_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL DEFAULT 'cron',
  follower_count integer NOT NULL DEFAULT 0,
  follower_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'partial',
  pages_fetched integer NOT NULL DEFAULT 0,
  api_calls_used integer NOT NULL DEFAULT 0,
  next_token text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_x_follower_snapshots_taken_at ON public.x_follower_snapshots(taken_at DESC);
CREATE INDEX idx_x_follower_snapshots_status ON public.x_follower_snapshots(status);

ALTER TABLE public.x_follower_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage x_follower_snapshots" ON public.x_follower_snapshots
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can view x_follower_snapshots" ON public.x_follower_snapshots
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Cache table
CREATE TABLE public.x_followers_cache (
  user_id text PRIMARY KEY,
  username text,
  name text,
  profile_image_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_x_followers_cache_username ON public.x_followers_cache(username);

ALTER TABLE public.x_followers_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage x_followers_cache" ON public.x_followers_cache
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can view x_followers_cache" ON public.x_followers_cache
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Changes table
CREATE TABLE public.x_follower_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  username text,
  name text,
  profile_image_url text,
  change_type text NOT NULL,
  prev_snapshot_id uuid REFERENCES public.x_follower_snapshots(id) ON DELETE SET NULL,
  curr_snapshot_id uuid REFERENCES public.x_follower_snapshots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_x_follower_changes_detected_at ON public.x_follower_changes(detected_at DESC);
CREATE INDEX idx_x_follower_changes_change_type ON public.x_follower_changes(change_type);
CREATE INDEX idx_x_follower_changes_user_id ON public.x_follower_changes(user_id);

ALTER TABLE public.x_follower_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage x_follower_changes" ON public.x_follower_changes
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can view x_follower_changes" ON public.x_follower_changes
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Daily cron job at 03:00 UTC
SELECT cron.schedule(
  'x-followers-snapshot-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url:='https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/x-followers-snapshot',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXJxZnp6dmxieHdmem5kYWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNzgsImV4cCI6MjA3MjQwNjE3OH0.bdVRQeXKONOLTjMlBoa0-MvxMGRVMRGyZS5uynejj4g"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  ) AS request_id;
  $$
);
