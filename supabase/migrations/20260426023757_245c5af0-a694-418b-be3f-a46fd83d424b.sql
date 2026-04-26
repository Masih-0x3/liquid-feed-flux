INSERT INTO public.jobs (type, payload, status, priority, idempotency_key, next_run_at)
VALUES (
  'resolve_media',
  jsonb_build_object('tweet_id', 'https://twitter.com/sentdefender/status/2048219040766669160'),
  'pending',
  20,
  'resolve_media:backfill:2048219040766669160',
  now()
)
ON CONFLICT (idempotency_key) DO NOTHING;