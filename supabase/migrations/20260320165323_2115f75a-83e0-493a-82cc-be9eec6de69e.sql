-- Backfill translate jobs for untranslated posts (avoid ON CONFLICT with partial index)
INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
SELECT 
  'translate',
  jsonb_build_object('tweet_id', p.tweet_id),
  'pending',
  'translate:' || p.tweet_id,
  now()
FROM public.posts p
WHERE p.text_translated IS NULL
  AND p.translated_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.jobs j 
    WHERE j.idempotency_key = 'translate:' || p.tweet_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.jobs j 
    WHERE j.type = 'translate' 
      AND (j.payload->>'tweet_id') = p.tweet_id 
      AND j.status IN ('pending', 'running')
  );

-- Backfill media download jobs
INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
SELECT 
  'download_media',
  jsonb_build_object('tweet_id', sq.tid),
  'pending',
  'download_media:' || sq.tid,
  now()
FROM (
  SELECT DISTINCT p.tweet_id as tid
  FROM public.posts p
  JOIN public.media m ON m.tweet_id = p.tweet_id
  WHERE m.downloaded_at IS NULL
    AND m.storage_path IS NULL
) sq
WHERE NOT EXISTS (
  SELECT 1 FROM public.jobs j 
  WHERE j.idempotency_key = 'download_media:' || sq.tid
)
AND NOT EXISTS (
  SELECT 1 FROM public.jobs j 
  WHERE j.type = 'download_media' 
    AND (j.payload->>'tweet_id') = sq.tid 
    AND j.status IN ('pending', 'running')
);