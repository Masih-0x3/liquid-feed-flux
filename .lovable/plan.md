# Video Delivery Hardening

The Osint613 video missed X because `resolve_media` tried to insert
fxtwitter's `duration: 5.9` (seconds) into `media.duration_ms` (integer).
That insert failure was already preceded by a `DELETE` of all media rows
for the tweet, leaving zero downloadable assets — so x-poster posted
text-only. The seconds→ms conversion is already deployed; this plan
prevents the broader class of bug.

**Hands-off:** Tweet `2052532719637180730` was posted manually. The
reconcile step explicitly excludes it.

## Changes

### 1. `supabase/functions/worker/index.ts` — `resolve_media` safe upsert
Today: `DELETE` rows, then `INSERT`. Any insert error wipes media.
New flow:
- Build & validate rows (rounding numerics) first.
- `upsert` on `(tweet_id, ordering)` in one call.
- Only after a successful upsert, `DELETE` rows whose `ordering >= rows.length`.
- On insert error: log to `pipeline_events` (`status='failed'`,
  `error=<db msg>`) and return `false` so the job retries with old rows
  intact.

### 2. `supabase/functions/x-poster/index.ts` — media-pending gate
After fetching `mediaRows` for a candidate:
- If `posts.has_media = true` AND no row has `downloaded_at`, query
  `jobs` for any pending/running `resolve_media` or `download_media`
  for that tweet.
- If a job is in flight AND post age < 10 min → skip iteration WITHOUT
  inserting into `x_deliveries` (so it remains eligible next tick). Log
  `media_pending`.
- If post age ≥ 10 min → fall through to text-only as today (with
  `last_error='media_pending_timeout'`).

### 3. `supabase/functions/media-processor/index.ts` — MIME normalization
When upstream `Content-Type` is missing, generic
(`application/octet-stream`, `binary/octet-stream`) or doesn't start
with `image/`/`video/`, infer from URL extension:
- `.mp4` → `video/mp4`, `.mov` → `video/quicktime`,
  `.webm` → `video/webm`, `.m4v` → `video/mp4`
- `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`,
  `.webp` → `image/webp`, `.gif` → `image/gif`
- Fallback: keep original.

Persist the normalized value as `mime_type` so x-poster's
`selectMediaTier` matches `video/` correctly.

### 4. Surface `resolve_media` / `download_media` failures
Add a `pipeline_events` row with `status='failed'` whenever an
upsert/upload error occurs in `resolve_media` (worker) or
`downloadMediaForTweet` (media-processor). Keeps monitoring honest.

### 5. One-shot SQL reconcile (data, not schema → insert tool)
For posts created in the last 24h where:
- `has_media = true`
- AND no `media` row with `downloaded_at IS NOT NULL`
- AND no pending/running `resolve_media` or `download_media` job
- AND `tweet_id <> 'https://twitter.com/Osint613/status/2052532719637180730'`

Insert a `resolve_media` job with idempotency key
`resolve_media:audit:<tweet_id>`.

Also mark the existing stuck `resolve_media` job for the Osint613 tweet
as `completed` so the worker doesn't reprocess it.

## Out of scope
- Telegram delivery loop (already correctly iterates `videos` via `sendVideo`).
- Chunked X video upload (correct).
- Schema change for `duration_ms` — int is fine once we round.

## Rollout
1. Edit three edge functions.
2. Run the one-shot SQL reconcile via insert tool.
3. Auto-deploy + watch worker / x-poster logs through one ingest cycle
   to confirm a video tweet flows end-to-end (resolve → download →
   x-poster picks tier `video` → chunked upload → posted).
