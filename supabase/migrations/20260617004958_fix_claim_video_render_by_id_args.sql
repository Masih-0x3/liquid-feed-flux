CREATE OR REPLACE FUNCTION public.claim_video_render_by_id(
  render_id uuid,
  worker_id text DEFAULT 'renderer'
)
RETURNS SETOF public.video_renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  lease_duration interval := interval '10 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.video_renders vr
  SET status = 'running',
      locked_at = now(),
      locked_by = COALESCE($2, 'renderer'),
      lease_expires_at = now() + lease_duration,
      started_at = COALESCE(vr.started_at, now()),
      attempts = COALESCE(vr.attempts, 0) + 1,
      error = NULL
  WHERE vr.id IN (
    SELECT q.id
    FROM public.video_renders q
    JOIN public.media m ON m.id = q.source_media_id
    WHERE q.id = $1
      AND (
        q.status = 'queued'
        OR (q.status = 'running' AND q.lease_expires_at IS NOT NULL AND q.lease_expires_at < now())
      )
      AND m.storage_path IS NOT NULL
      AND COALESCE(m.mime_type, '') LIKE 'video/%'
    FOR UPDATE SKIP LOCKED
  )
  RETURNING vr.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_video_render_by_id(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_render_by_id(uuid,text) TO service_role;
