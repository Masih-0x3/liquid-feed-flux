## Goal

When a tweet contains a video (or GIF), automatically resolve the highest-quality MP4 using the **same fxtwitter / vxtwitter proxy** logic that powers the `/downloader` page, download it into our `temp-media` bucket, and attach it to the translated Telegram post — all **without consuming X API quota**.

## Why this works (and avoids X API)

- The known limitation `mem://limitations/video-ingestion`: RSS only delivers `pic.twitter.com` short-links and image thumbnails — never direct `video.twimg.com` URLs.
- The `/downloader` page already proves we can resolve any tweet's full media list (including bitrate-ranked MP4 variants) via the **public fxtwitter API** with zero auth. Falling back to `vxtwitter` covers edge cases.
- We only need the numeric tweet ID + author handle, both already stored on `posts` (`tweet_id`, `url`, `author_handle`).
- X API hydration stays reserved for **text** truncation (current behavior, untouched).

## Detection rule (decide once, at ingest)

In `webhooks-rssapp/index.ts`, after `parseMediaFromRSSItem`, check for a **video signal**:
1. RSS already produced a `kind = 'video'` row, OR
2. RSS body contains `pic.twitter.com/...` AND/OR a `video.twimg.com` reference, OR
3. RSS thumbnail looks like a video poster (`tweet_video_thumb` / `amplify_video_thumb` / `ext_tw_video_thumb` in the URL — strong indicator that a video exists).

If any of those is true → enqueue a new `resolve_media` job (priority similar to `hydrate_tweet`, idempotency key `resolve_media:${tweetId}`). If false → keep current path (image-only `download_media` job as today).

## New worker job: `resolve_media`

A new handler in `supabase/functions/worker/index.ts` mirroring `hydrate_tweet` style:

1. Load post (`tweet_id`, `url`, `author_handle`).
2. Extract numeric ID + handle.
3. Call `https://api.fxtwitter.com/{handle}/status/{id}` — pick highest-bitrate MP4 from `media.videos[].variants[]` (reuse the exact `pickBestVideoVariant` logic from `Downloader.tsx`).
4. Fallback to `https://api.vxtwitter.com/{handle}/status/{id}` if fx fails.
5. Also collect any `media.photos` upgraded with `?name=orig` (reuse `upgradeImageUrl`) — overwrites the lower-quality RSS thumbnail.
6. Upsert resolved rows into `media` table:
   - For videos: `kind='video'`, real `src_url`, `width`, `height`, `duration_ms`, fresh `src_url_hash`.
   - For images: replace the placeholder thumbnail row with the orig URL.
7. Enqueue a `download_media` job (existing handler in `media-processor`) so files land in the `temp-media` bucket exactly as today.
8. On total failure (both proxies down / no media found) → log, mark post `has_media=false` so delivery isn't blocked, and proceed.

No new secrets, no X API calls, no schema changes. Resilient: if proxies are temporarily down the job retries via the existing job-retry/lease machinery; ultimately falls through to text-only delivery.

## Pipeline sequencing

Current order (per `mem://architecture/pipeline-sequencing`): ingest → (hydrate?) → translate → download_media → deliver.

New order when video detected:
```text
ingest → resolve_media (proxy, no X API) → download_media → translate (parallel-safe) → deliver
```
`resolve_media` is enqueued in parallel with `hydrate_tweet`/`translate`. Delivery already waits for `translated_at`; we add a small guard in the deliver handler to also wait until `media` rows for that tweet either have `storage_path` set OR `failed` flag set, so the video is attached. (Same guard pattern used today for image-only posts — verify and reuse.)

## UI / Monitoring touch

- `Monitoring` page already shows media counts via `MediaThumbnails`; will pick up resolved videos automatically.
- Add a tiny pipeline_event for visibility: `step='resolve_media'`, `status='completed'|'failed'`, with `meta.source='fxtwitter'|'vxtwitter'`.

## Files to change / create

- **edit** `supabase/functions/webhooks-rssapp/index.ts` — add video-signal detection + enqueue `resolve_media` job.
- **edit** `supabase/functions/worker/index.ts` — add `resolve_media` case in switch + new `handleResolveMediaJob` function (proxy logic copied from `Downloader.tsx`, server-flavored).
- **edit** `supabase/functions/worker/index.ts` — small deliver-side guard so video posts wait for `storage_path` (only if not already in place).
- **no DB migration needed** — `media`, `jobs`, `pipeline_events` already support everything required.
- **no secrets needed**.

## Out of scope

- Live-stream / Twitter Spaces audio.
- Posting the video back to X (the existing `x-poster` flow already supports videos when `media.storage_path` is filled, so it benefits automatically).
