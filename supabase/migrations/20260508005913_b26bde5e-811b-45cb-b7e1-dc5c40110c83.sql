UPDATE public.media
SET storage_path = NULL, downloaded_at = NULL, file_size = NULL, mime_type = NULL
WHERE tweet_id = 'https://twitter.com/disclosetv/status/2052548244970897491';

DELETE FROM public.x_deliveries
WHERE post_id = 'https://twitter.com/disclosetv/status/2052548244970897491';

DELETE FROM public.deliveries
WHERE subject_type='post' AND subject_id='https://twitter.com/disclosetv/status/2052548244970897491';

INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at, priority)
VALUES (
  'download_media',
  jsonb_build_object('tweet_id','https://twitter.com/disclosetv/status/2052548244970897491'),
  'pending',
  'download_media:repost3:2052548244970897491',
  now(),
  12
);

INSERT INTO public.jobs (type, payload, status, idempotency_key, next_run_at)
VALUES (
  'deliver',
  jsonb_build_object('tweet_id','https://twitter.com/disclosetv/status/2052548244970897491'),
  'pending',
  'deliver:repost3:2052548244970897491',
  now() + interval '120 seconds'
);