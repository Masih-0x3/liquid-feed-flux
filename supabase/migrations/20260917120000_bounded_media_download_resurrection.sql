-- 0X3-672: atomic bounded resurrection for video-render download jobs.
--
-- The wait_media gate used to read the download_media row and then upsert a
-- fresh retry budget in a second statement. Two concurrent gate evaluations
-- could read the same failed row; after one resurrected it and a worker
-- claimed it, the other's stale upsert overwrote the running row — clearing
-- the lease, resetting attempts, and spending retry budget twice.
--
-- This function performs the whole decision under one row lock:
--   SELECT ... FOR UPDATE serializes concurrent evaluators, a still-open row
--   is left untouched, a closed row is resurrected at most
--   p_max_resurrections times per media identity (video_render_retry_cycle
--   counts resurrections already spent: a fresh row starts at 0, so the row
--   may be resurrected exactly p_max_resurrections times before exhaustion),
--   and exhaustion is reported without rewriting the row.
--
-- Returns one of: 'inserted' | 'resurrected' | 'open' | 'exhausted'.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_bounded_media_download(
  p_idempotency_key text,
  p_tweet_id text,
  p_media_id text,
  p_max_resurrections int DEFAULT 3
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  existing record;
  stored_media text;
  stored_cycle int;
  next_cycle int;
BEGIN
  SELECT id, status, result_meta
    INTO existing
    FROM public.jobs
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF NOT FOUND THEN
    -- No row yet: create the first attempt. A concurrent evaluator may insert
    -- first; ON CONFLICT keeps exactly one winner and the loser reports the
    -- now-open row.
    INSERT INTO public.jobs (
      type, payload, status, priority, attempts, next_run_at,
      idempotency_key, result_meta
    ) VALUES (
      'download_media',
      jsonb_build_object('tweet_id', p_tweet_id, 'source', 'video_render_gate'),
      'pending', 12, 0, now(),
      p_idempotency_key,
      jsonb_build_object(
        'video_render_retry_cycle', 0,
        'video_render_retry_media', p_media_id
      )
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN
      RETURN 'inserted';
    END IF;
    RETURN 'open';
  END IF;

  IF existing.status IN ('pending', 'running') THEN
    RETURN 'open';
  END IF;

  stored_media := existing.result_meta ->> 'video_render_retry_media';
  IF stored_media IS NULL OR stored_media IS NOT DISTINCT FROM p_media_id THEN
    stored_cycle := COALESCE((existing.result_meta ->> 'video_render_retry_cycle')::int, 0);
    next_cycle := stored_cycle + 1;
  ELSE
    -- A genuinely new source media resets the resurrection budget.
    next_cycle := 1;
  END IF;

  IF next_cycle > p_max_resurrections THEN
    RETURN 'exhausted';
  END IF;

  UPDATE public.jobs
    SET status = 'pending',
        payload = jsonb_build_object('tweet_id', p_tweet_id, 'source', 'video_render_gate'),
        attempts = 0,
        next_run_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        result_meta = COALESCE(existing.result_meta, '{}'::jsonb)
          || jsonb_build_object(
               'video_render_retry_cycle', next_cycle,
               'video_render_retry_media', p_media_id
             )
          -- When the media identity changed, keep the superseded identity in
          -- the row's lineage so audit consumers can still see which media the
          -- earlier attempts ran against.
          || CASE WHEN stored_media IS DISTINCT FROM p_media_id
               THEN jsonb_build_object('video_render_retry_prev_media', stored_media)
               ELSE '{}'::jsonb
             END
  WHERE id = existing.id;

  RETURN 'resurrected';
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_bounded_media_download(text, text, text, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bounded_media_download(text, text, text, int)
  TO service_role;

COMMIT;
