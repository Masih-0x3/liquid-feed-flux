-- 1. Replace posts created_at index (ASC → DESC)
DROP INDEX IF EXISTS public.idx_posts_created_at;
CREATE INDEX idx_posts_created_at_desc ON public.posts
  USING btree (created_at DESC);

-- 2. Expression index for pipeline status lookups on jobs
CREATE INDEX idx_jobs_type_tweet_created
  ON public.jobs (type, ((payload->>'tweet_id')), created_at DESC);

-- 3. Rewrite get_post_pipeline_status with LATERAL joins
CREATE OR REPLACE FUNCTION public.get_post_pipeline_status(tweet_ids text[])
RETURNS TABLE(
  tweet_id text, ingest_at timestamptz,
  media_total int, media_downloaded int,
  lang_original text, translated_at timestamptz,
  translate_status text, translate_error text,
  delivery_status text, posted_at timestamptz,
  delivery_error text, attempts int
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT
    p.tweet_id,
    p.created_at AS ingest_at,
    coalesce(mc.total, 0)  AS media_total,
    coalesce(mc.downloaded, 0) AS media_downloaded,
    p.lang_original,
    p.translated_at,
    coalesce(tj.status, CASE WHEN p.translated_at IS NOT NULL THEN 'completed' ELSE 'pending' END) AS translate_status,
    tj.last_error AS translate_error,
    coalesce(dl.status, 'pending') AS delivery_status,
    dl.posted_at,
    coalesce(dl.last_error, dj.last_error) AS delivery_error,
    coalesce(dl.attempts, 0) AS attempts
  FROM public.posts p
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE m.downloaded_at IS NOT NULL) AS downloaded
    FROM public.media m WHERE m.tweet_id = p.tweet_id
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT j.status, j.last_error
    FROM public.jobs j
    WHERE j.type = 'translate' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) tj ON true
  LEFT JOIN LATERAL (
    SELECT j.last_error
    FROM public.jobs j
    WHERE j.type = 'deliver' AND (j.payload->>'tweet_id') = p.tweet_id
    ORDER BY j.created_at DESC LIMIT 1
  ) dj ON true
  LEFT JOIN LATERAL (
    SELECT d.status, d.posted_at, d.last_error, d.attempts
    FROM public.deliveries d
    WHERE d.subject_type = 'post' AND d.subject_id = p.tweet_id
    ORDER BY d.created_at DESC LIMIT 1
  ) dl ON true
  WHERE p.tweet_id = ANY(tweet_ids)
  ORDER BY p.created_at DESC;
$$;