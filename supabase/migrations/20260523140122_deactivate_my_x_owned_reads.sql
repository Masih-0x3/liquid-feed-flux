-- Disable My X follower/following snapshots to stop expensive X owned reads.
-- The underlying tables and function source remain in place for future reuse.

INSERT INTO public.settings (key, value, updated_at)
VALUES (
  'x_api_controls',
  jsonb_build_object(
    'my_x_enabled', false,
    'verify_cache_minutes', 15,
    'follower_snapshot_stale_minutes', 60,
    'usage_sync_interval_hours', 6,
    'backfill_max_hydrate_jobs_per_run', 100,
    'warning_thresholds', jsonb_build_array(70, 90)
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET
  value = COALESCE(settings.value, '{}'::jsonb) || jsonb_build_object('my_x_enabled', false),
  updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'x-followers-snapshot-daily') THEN
    PERFORM cron.unschedule('x-followers-snapshot-daily');
  END IF;
END $$;
