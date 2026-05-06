# Fix Video Delivery + Cost-Aware X Media Tiering

## Goals
1. Native Twitter videos actually get downloaded into `temp-media`.
2. `x-poster` can upload videos to X via chunked upload.
3. X posting strictly follows a media-tier policy to avoid any wasted upload-API calls:
   - **Text only** → `tweets` only, no `media/upload` calls.
   - **Has image, no video** → upload up to 4 images, attach.
   - **Has video** (with or without images) → upload **only the video**, ignore images.

## Bug 1 — `resolve_media` never re-downloads the video

`worker/index.ts` (line ~1765) re-enqueues `download_media` with key `download_media:<tweet_id>`, but the original RSS-thumbnail download already used that exact key and is `completed`. With `ignoreDuplicates: true`, the upsert is a no-op, so the freshly-inserted video row stays at `storage_path = NULL` forever.

**Fix**
- In `resolve_media` success path, enqueue with a distinct key: `download_media:resolve:<tweet_id>`.
- Same pattern as the recent `translate:hydrate:` fix.
- Optional safety: also clear `downloaded_at`/`storage_path` on any leftover rows (already handled by the `delete()` before insert, so no extra change needed).

## Bug 2 — `x-poster` cannot upload video, and over-uses the upload API

Today `selectUploadable` only accepts `image/jpeg|png|webp|gif`. Video rows fall through to `skip_reason = no_supported_media`. There is no chunked `INIT/APPEND/FINALIZE` path and no STATUS polling.

**Fix — media tier selection (cost-first)**

Replace `selectUploadable` with a tiered selector that runs *before* any X API call:

```
downloaded = rows where storage_path AND downloaded_at
video      = first downloaded row with kind=video OR mime starts with 'video/'
images     = downloaded rows with mime in ALLOWED_IMAGE and size <= 5MB

if video exists and within video limits → return { tier: 'video', items: [video] }
else if images.length > 0               → return { tier: 'image', items: images.slice(0,4) }
else                                     → return { tier: 'text',  items: [] }
```

Then in the main handler:
- `tier === 'text'` → call `postTweet(text, [], ...)` directly. **Zero `media/upload` calls.**
- `tier === 'image'` → call `uploadImage` for each (existing path).
- `tier === 'video'` → call new `uploadVideoChunked` once, attach single media_id.

This guarantees we never invoke `media/upload` for media we don't physically have, and never upload images when a video will be attached.

**Fix — chunked video upload** (`x-poster/index.ts`)

Add `uploadVideoChunked(bytes, mime, ...)` implementing X v1.1 upload:
1. `INIT` — POST `command=INIT&media_type=<mime>&total_bytes=<n>&media_category=tweet_video`
2. `APPEND` — POST `command=APPEND&media_id=...&segment_index=i` with 4 MB chunks (`multipart/form-data`, field `media`)
3. `FINALIZE` — POST `command=FINALIZE&media_id=...`
4. If response contains `processing_info` → poll `command=STATUS&media_id=...` every `check_after_secs` until `state=succeeded` (or fail on `failed`); cap total wait at 60s to stay within Edge Function budget.

Guards (skip + log `skip_reason='video_too_large'` instead of attempting upload, to stay cheap):
- `mime` must start with `video/` (prefer `video/mp4`).
- `file_size <= 50 MB` (well under X's 512MB cap; protects function memory + time).
- Optional: skip if `duration_ms > 140_000` when known.

Use the existing OAuth 1.0a `oauthHeader` helper. For `APPEND`, OAuth signs only the URL + query params (the multipart body is not part of the signature base) — same approach as the standard Twitter docs.

## Files to change

- `supabase/functions/worker/index.ts` — change one line: idempotency key in `resolve_media` re-enqueue.
- `supabase/functions/x-poster/index.ts` — replace `selectUploadable`, add `uploadVideoChunked` + `pollMediaStatus`, branch in main handler by tier.

## Out of scope
- No backfill of historical tweets that already shipped without video (per your earlier preference).
- Telegram already has a `sendVideo` path; once Bug 1 is fixed the storage_path will exist and Telegram videos will start working again automatically — no Telegram code change needed.

## Memory update
Add a Core rule: "X posting is media-tiered: video > image > text. Never call X media/upload for media we don't have downloaded. Video uses chunked INIT/APPEND/FINALIZE/STATUS." Plus a memory file under `mem://features/x-posting-pipeline` covering tier rules and the `resolve_media` re-download key.
