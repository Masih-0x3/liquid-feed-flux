# Plan — Video Delivery Hardening

## Context
Root cause of the missing Osint613 video was a type mismatch:
`api.fxtwitter.com` returns `duration` as **seconds (float, e.g. 5.9)** but
`media.duration_ms` is **INTEGER** → `resolve_media` insert blew up with
`invalid input syntax for type integer: "5.9"`. Since the handler `DELETE`s
existing media rows *before* re-inserting, the tweet was left with **zero**
media rows, `download_media` never ran, and `x-poster` posted text-only.

The seconds→ms + rounding fix is already deployed (last turn). This plan
addresses the broader class of bugs to prevent recurrence.

> **Hands-off:** Osint613 tweet `2052532719637180730` was manually posted
> with the video. Do **not** re-deliver it. The pending `resolve_media` job
> for it should be marked completed so the worker doesn't reprocess it.

## Audit findings & fixes

### 1. ✅ FIXED — fxtwitter `duration` seconds vs `duration_ms` int
- Convert seconds → ms with `Math.round(v.duration * 1000)`
- Round `width`, `height`, `duration_ms` to int defensively in the insert row

### 2. Destructive delete-then-insert in `resolve_media`
**Risk:** Any future insert error wipes all media for the tweet permanently
until the next scheduled retry. Same class of failure mode that masked bug #1.

**Fix:** Reorder — build & validate the rows first, then *upsert* on
`(tweet_id, ordering)` in one call, and only `DELETE` rows whose `ordering`
is no longer present after a successful upsert. If the upsert errors, the
old rows survive.

### 3. x-poster race with in-flight `resolve_media` / `download_media`
**Risk:** If a post passes the editorial gate before `resolve_media` +
`download_media` complete, x-poster will post text-only (selectMediaTier
returns `text` because `downloaded_at` is null), permanently spending the
post's one chance.

**Fix:** In `x-poster` candidate selection, if `posts.has_media = true`
AND the tweet has any media row with `downloaded_at IS NULL` AND there's
a pending/running `resolve_media` or `download_media` job for that tweet
→ skip this iteration with `skip_reason='media_pending'` (do **not** insert
into `x_deliveries` so it remains eligible next tick). Cap the wait so
posts don't get stuck forever (e.g. 10 min after `posts.created_at` →
post text-only as fallback).

### 4. MIME normalization in `media-processor`
**Risk:** If the upstream server returns `application/octet-stream` or a
generic `binary/octet-stream`, x-poster's `selectMediaTier` won't match
the `video/` prefix and will demote the post to text-only.

**Fix:** In `media-processor.downloadMediaForTweet`, when `Content-Type`
doesn't start with `image/` or `video/`, infer from the file extension
(`.mp4 → video/mp4`, `.mov → video/quicktime`, `.webp → image/webp`,
etc.) before persisting `mime_type`. Also persist the resolved `kind`
when it disagrees with the URL-derived guess from `resolve_media`.

### 5. vxtwitter duration_millis defensive rounding
Already covered by the global `Math.round(m.duration_ms)` we added in the
upsert row builder, but make sure the same helper is used for both source
adapters and any future ones.

### 6. Surface insert/upsert failures as `pipeline_events`
`resolve_media` currently only `console.error`s an insert failure and
returns `false`. Add a `pipeline_events` row with `status='failed'` and
the DB error message so monitoring/dashboard surfaces the problem instead
of silently retrying. Same for `download_media` upload errors that loop.

### 7. Reconcile bad media rows
A one-shot SQL cleanup to re-enqueue `resolve_media` for any post in the
last 24h where:
- `posts.has_media = true`
- no `media` row with `downloaded_at IS NOT NULL` exists, AND
- no `pending/running` `resolve_media` job exists.

Use idempotency key `resolve_media:audit:<tweet_id>` so it can't collide
with existing keys.

## Out of scope (not changing)
- Telegram delivery path: already iterates `videos` correctly via
  `sendVideo`; bug #3 is about x-poster only.
- The chunked X video upload (`uploadVideoChunked`): code is correct.
- Bumping `media.duration_ms` to `bigint` — int is fine once we round.

## Rollout order
1. Code: x-poster `media_pending` gate (#3) + media-processor MIME
   normalization (#4) + resolve_media safe-upsert (#2) + pipeline_events
   on failure (#6).
2. SQL one-shot: mark Osint613 `resolve_media` job completed; reconcile
   bad media rows (#7).
3. Deploy `worker`, `media-processor`, `x-poster`. Watch logs for one
   ingest cycle to confirm a video tweet flows end-to-end.
