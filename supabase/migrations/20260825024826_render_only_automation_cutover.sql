BEGIN;

CREATE TABLE IF NOT EXISTS public.runtime_controls (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  environment text NOT NULL CHECK (environment IN ('production', 'preview')),
  posting_mode text NOT NULL DEFAULT 'blocked' CHECK (posting_mode IN ('blocked', 'enabled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE OR REPLACE FUNCTION public.enforce_runtime_controls_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF NEW.singleton_key IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'runtime_controls requires singleton_key=true';
  END IF;
  IF NEW.environment = 'preview' AND NEW.posting_mode <> 'blocked' THEN
    RAISE EXCEPTION 'preview runtime_controls must keep posting_mode=blocked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_runtime_controls_invariants ON public.runtime_controls;
CREATE TRIGGER trg_runtime_controls_invariants
  BEFORE INSERT OR UPDATE ON public.runtime_controls
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_runtime_controls_invariants();

ALTER TABLE public.runtime_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view runtime controls" ON public.runtime_controls;
CREATE POLICY "Authenticated users can view runtime controls"
ON public.runtime_controls
FOR SELECT
USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.runtime_controls TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.runtime_controls TO service_role;

CREATE OR REPLACE FUNCTION public.claim_video_render_after(
  p_queued_after timestamptz,
  worker_id text DEFAULT 'renderer'
)
RETURNS SETOF public.video_renders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_render_id uuid;
BEGIN
  IF p_queued_after IS NULL THEN
    RETURN;
  END IF;

  SELECT q.id
  INTO v_render_id
  FROM public.video_renders q
  JOIN public.media m ON m.id = q.source_media_id
  WHERE q.queued_at > p_queued_after
    AND (
      q.status = 'queued'
      OR (
        q.status = 'running'
        AND q.lease_expires_at IS NOT NULL
        AND q.lease_expires_at < now()
      )
    )
    AND m.storage_path IS NOT NULL
    AND COALESCE(m.mime_type, '') LIKE 'video/%'
  ORDER BY q.queued_at, q.id
  FOR UPDATE OF q SKIP LOCKED
  LIMIT 1;

  IF v_render_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_video_render_by_id(v_render_id, worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._video_render_should_release(p_tweet_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  WITH cfg AS (
    SELECT COALESCE(
      s.value->>'mode',
      CASE WHEN s.value->>'enabled' = 'true' THEN 'enabled' ELSE 'disabled' END
    ) AS mode
    FROM public.settings s
    WHERE s.key = 'video_render_config'
  ), runtime AS (
    SELECT
      count(*) AS row_count,
      bool_and(rc.environment = 'production' AND rc.posting_mode = 'enabled') AS posting_enabled
    FROM public.runtime_controls rc
  )
  SELECT COALESCE((SELECT mode FROM cfg), 'disabled') = 'enabled'
    AND COALESCE((SELECT row_count = 1 AND posting_enabled FROM runtime), false)
    AND NOT EXISTS (
      SELECT 1
      FROM public.manual_video_intakes mvi
      WHERE mvi.tweet_id = p_tweet_id
        AND mvi.blocks_auto_delivery = true
        AND mvi.status NOT IN ('posted', 'canceled')
    )
    AND EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.tweet_id = p_tweet_id
        AND p.delivery_decision = 'deliver'
        AND p.text_translated IS NOT NULL
        AND btrim(p.text_translated) <> ''
        AND (COALESCE(p.is_truncated, false) = false OR p.hydrated_at IS NOT NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.claim_video_render_after(timestamptz,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_render_after(timestamptz,text) TO service_role;

REVOKE ALL ON FUNCTION public._video_render_should_release(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._video_render_should_release(text) TO service_role;

COMMIT;
