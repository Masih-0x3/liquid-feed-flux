

# Plan: Per-Author Content Filtering (Single Feed)

## The Reality

One RSS feed → one webhook → all posts land with one account. But each post's `url` contains the real Twitter author (e.g., `twitter.com/FirstSquawk/status/...`). We extract that and filter on it.

## Database Changes

1. Add `author_handle` (text, nullable) column to `posts` table
2. Add `importance_score` (integer, nullable) to `posts`
3. Add `importance_tags` (text[], nullable) to `posts`
4. Add `delivery_decision` (text, nullable) to `posts` — values: `deliver`, `digest`, `skip`
5. Backfill existing posts: `UPDATE posts SET author_handle = substring(url from 'twitter\.com/([^/]+)') WHERE url LIKE '%twitter.com%'`

## Webhook Change

In `webhooks-rssapp/index.ts`, extract author handle from the item URL before upserting the post:
```
const authorHandle = extractAuthorFromUrl(url); // parse twitter.com/{handle}
```
Save it to the `author_handle` column on the post.

## Worker Change (translate job)

When translating, load the `content_filter` setting and the post's `author_handle`. Build the OpenAI prompt to return both translation AND importance score/tags (via tool calling — single API call, no extra cost). Then apply:

1. Check author-specific rules first (always deliver, always skip, custom threshold)
2. If no author rule, use AI score vs default threshold
3. Set `delivery_decision` on the post
4. Only create a `deliver` job if decision is `deliver`

## Settings UI — New "Content Filter" Tab

All stored as a `content_filter` key in `settings` table:

- **Master toggle**: Enable/disable filtering (off = deliver everything like today)
- **Default threshold slider** (1–10): Posts below this score are skipped
- **Editorial guidelines textarea**: Plain-language instructions injected into the AI scoring prompt (e.g., "Prioritize Iran war, GCC, sanctions, major world events. Deprioritize economy, sports, entertainment.")
- **Author rules table**: Auto-populated from distinct `author_handle` values in posts. Each row shows:
  - Author handle (e.g., `FirstSquawk`)
  - Post count (so you know who's noisy)
  - Rule dropdown: `Use AI scoring` / `Always deliver` / `Always skip` / `Custom threshold`
  - Custom threshold slider (only visible if "Custom threshold" selected)
- **Priority/low-priority topic chips**: Tag inputs for topics that boost or lower scores

## Monitoring Enhancement

- Show `importance_score` as a colored badge and `author_handle` on each post row
- Filter by author and score range
- "Force Deliver" button for skipped posts

## Implementation Order

1. DB migration: add columns + backfill `author_handle`
2. Webhook: extract and save `author_handle` on new posts
3. Worker: add scoring to translate job, apply author rules, gate delivery
4. Settings UI: "Content Filter" tab with all controls
5. Monitoring: show scores, author, force deliver
6. Fix delivery priority to 20 (solves the immediate queue starvation)

## Technical Notes

- Author extraction regex: `twitter.com/([^/]+)` — already proven to work on 115k posts
- Single OpenAI call handles translation + scoring (tool/function calling) — zero extra API cost
- All config in `settings` table, read at runtime — no deploys needed to tune
- The author rules table in the UI auto-discovers authors from the database, so as new authors appear in the feed, they show up automatically

