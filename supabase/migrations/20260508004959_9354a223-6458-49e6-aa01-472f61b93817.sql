-- Reset media bytes for the disclosetv Pope Leo tweet
UPDATE public.media
SET storage_path = NULL, downloaded_at = NULL, file_size = NULL, mime_type = NULL
WHERE tweet_id = 'https://twitter.com/disclosetv/status/2052548244970897491';

-- Wipe deliveries so they re-run
DELETE FROM public.x_deliveries
WHERE post_id = 'https://twitter.com/disclosetv/status/2052548244970897491';

DELETE FROM public.deliveries
WHERE subject_type = 'post'
  AND subject_id = 'https://twitter.com/disclosetv/status/2052548244970897491';

-- Re-enqueue resolve_media (idempotency key suffixed so it doesn't collide with the completed one)
INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
VALUES (
  'resolve_media',
  jsonb_build_object('tweet_id','https://twitter.com/disclosetv/status/2052548244970897491'),
  'pending',
  'resolve_media:repost:2052548244970897491',
  now(),
  12
)
ON CONFLICT (idempotency_key) DO NOTHING;

-- Re-enqueue deliver (Telegram) — will fire after media is downloaded
INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
VALUES (
  'deliver',
  jsonb_build_object('tweet_id','https://twitter.com/disclosetv/status/2052548244970897491'),
  'pending',
  'deliver:repost:2052548244970897491',
  now() + interval '90 seconds'
)
ON CONFLICT (idempotency_key) DO NOTHING;