
# Plan: Per-Author Content Filtering (Single Feed)

## Status

| Step | Description | Status |
|------|-------------|--------|
| 1 | DB migration: add columns + backfill author_handle | ✅ Done |
| 2 | Webhook: extract and save author_handle on new posts | ✅ Done |
| 3 | Worker: add scoring to translate job, apply author rules, gate delivery | ✅ Done |
| 4 | Settings UI: "Content Filter" tab with all controls | ✅ Done |
| 5 | Monitoring: show scores, author, force deliver | 🔲 Todo |
| 6 | Fix delivery priority to 20 | ✅ Done (in worker translate job) |

## What Was Implemented

### Database
- Added `author_handle`, `importance_score`, `importance_tags`, `delivery_decision` columns to `posts`
- Backfilled 115k+ posts with extracted author handles from URLs
- Added indexes on all new columns

### Webhook (webhooks-rssapp)
- `extractAuthorFromUrl()` parses twitter.com/x.com URLs to get handle
- Saves `author_handle` on every new post upsert

### Worker (translate job)
- When content filtering is enabled, uses OpenAI tool calling to get translation + importance score + tags in a single API call
- Applies author-specific rules (always deliver, always skip, custom threshold) before falling back to default threshold
- Sets `delivery_decision` on the post
- Only creates deliver job if decision is `deliver`
- Delivery jobs now created with priority 20

### Settings UI
- New "Content Filter" tab in Settings page
- Master toggle to enable/disable filtering
- Default threshold slider (1-10)
- Editorial guidelines textarea (plain language instructions for AI)
- Priority/low-priority topic chips
- Per-author rules table auto-populated from database with rule dropdown + custom threshold slider

### Remaining
- Monitoring enhancements (importance badges, force deliver button)
