
## X (Twitter) Posting Pipeline — Implementation Plan

### Goal
Mirror the Telegram pipeline for X. Score-gated, **media-required** posts get formatted (`📰 + translated text + media`) and posted to X via OAuth 1.0a v2 with media upload. All settings configurable from a new **"X Posting"** section in the X Automation tab. Full metrics surfaced on Dashboard + Monitoring.

---

### 1. Database changes (one migration)

**`settings` rows (new, JSON-driven, no hardcoded values):**
- `x_posting_config` — `{ enabled, min_score, require_media, allow_video, post_template, leading_emoji, hashtags, max_chars, dedupe_window_hours, post_only_decision_deliver }`
- `x_rate_limits` — `{ posts_per_hour, posts_per_day, monthly_post_budget, media_uploads_per_day }`

**New table `x_deliveries`** (parallels `deliveries`):
```
id uuid pk, post_id text (tweet_id of source post), x_tweet_id text,
status text ('pending'|'posted'|'failed'|'skipped'),
skip_reason text, attempts int, last_error text,
media_count int, media_bytes bigint, media_kind text,
posted_at timestamptz, latency_ms int,
api_response jsonb, created_at timestamptz default now()
```
RLS: admin manage / authenticated select (same pattern as `deliveries`).

**Extend `settings.x_api_usage`** (no schema change — just new JSON keys):
- `posts_24h: string[]`, `posts_total`, `media_uploads_24h: string[]`, `media_bytes_24h`, `last_post_error`.

**New RPC `get_x_posting_summary()`** → returns 24h posted/failed/skipped counts, success rate, avg latency, projected monthly posts, media upload total — fed to Dashboard.

---

### 2. Edge function: `x-poster` (new)

Worker-style function invoked by `pg_cron` every ~60s and on-demand from `admin-actions`.

Pipeline per candidate post:
1. **Select candidates**: `posts` where `delivery_decision='deliver'`, `importance_score >= x_posting_config.min_score`, `has_media=true` (if `require_media`), no row in `x_deliveries` (dedupe), within `dedupe_window_hours`.
2. **Quota check**: read `x_api_usage`, refuse if hourly/daily/monthly caps exceeded → insert `x_deliveries` row `status='skipped' skip_reason='rate_limit'`.
3. **Media validation** (before any API call):
   - Confirm `media` rows exist with `downloaded_at IS NOT NULL` and `storage_path` set.
   - Filter unsupported MIME types; cap at 4 images OR 1 video per X rules.
   - If `allow_video=false`, skip videos.
   - If validation fails → `skipped, skip_reason='no_media'`. **No API call made → no cost.**
4. **Media upload** — `POST https://upload.twitter.com/1.1/media/upload.json` (chunked INIT/APPEND/FINALIZE for video, simple base64 for images). OAuth 1.0a (reuse helpers from `digest-compiler`). Track `media_uploads_24h` / `media_bytes_24h`.
5. **Format text** from `x_posting_config.post_template` — placeholders `{leading_emoji}`, `{translated_text}`, `{hashtags}`, `{author_handle}`. Default: `{leading_emoji} {translated_text}\n\n{hashtags}`. Truncate to `max_chars` (default 280) with ellipsis.
6. **Post tweet** — `POST https://api.x.com/2/tweets` with `media.media_ids`. Record latency.
7. **Persist** → `x_deliveries` row `status='posted'`, `x_tweet_id`, `latency_ms`, `api_response`. Increment `x_api_usage.posts_24h/posts_total`.
8. **Errors**: 429 → backoff, increment `attempts`, status stays `pending` (retry next tick); 4xx → `failed` (no retry); 5xx → retry up to 3 with exponential backoff.

All quotas/templates read from `settings` — zero hardcoded values (per established memory rule).

---

### 3. Frontend: new sub-section in X Automation tab

Extend `XAutomationSettings.tsx` with two new cards (no new tab — keeps it grouped):

**Card A: "X Posting Configuration"**
- Enable toggle.
- Min importance score slider (1–20, default reads from settings).
- "Require media" + "Allow video" checkboxes.
- `PromptEditor` for `post_template` with placeholder buttons (`{leading_emoji}`, `{translated_text}`, `{hashtags}`, `{author_handle}`).
- Leading emoji input (default `📰`), hashtags input, max chars number.
- Live preview using a sample post (reuses `samplesQuery`).
- "Save" + "Post a sample now" (dry-run that picks the most recent eligible post, validates media, returns formatted preview WITHOUT calling X API).

**Card B: "Rate Limits & Quotas"**
- Inputs for posts/hour, posts/day, monthly budget, media uploads/day.
- Live readout of current usage from `x_api_usage` with progress bars (green/amber/red at 70/90%).

All changes routed through `useSaveSettings` → `admin-actions` (existing validated mutation pattern). Add `x_posting_config` and `x_rate_limits` to the validator in `admin-actions/index.ts`.

---

### 4. Dashboard & Monitoring integration

**Dashboard (`useDashboardData` + `DashboardMetrics`)**
- Extend `get_dashboard_summary()` RPC to merge `get_x_posting_summary()` output.
- New metric cards: "X Posts (24h)", "X Failures (24h)", "X Media Uploads (24h)", "X Posts Skipped — no media".
- Add X channel to `DashboardHealth` (success rate, projected monthly vs. budget).

**Monitoring (`useMonitoringData` + Monitoring page)**
- Extend `get_post_pipeline_status` RPC to also LATERAL-join `x_deliveries` → expose `x_status`, `x_tweet_id`, `x_posted_at`, `x_error`, `x_skip_reason`.
- Add an "X" status pill column (posted / pending / failed / skipped) with link to `https://x.com/i/status/{x_tweet_id}`.
- Add "Retry on X" action (calls `admin-actions` with `action: 'retry_x_post', tweet_id`).

---

### 5. Cron + admin-actions wiring

- pg_cron job `x-poster-tick` every 60s → calls `x-poster` with hardcoded URL+service-role header (per existing cron memory rule).
- `admin-actions` gains: `get_x_posting_status`, `dry_run_x_post`, `retry_x_post`, plus validators for the two new settings keys.

---

### 6. Engagement metrics (phase 2 — included in plan, optional flag)

Optional `x-engagement-poller` cron (every 6h) fetches `public_metrics` (likes, retweets, replies, impressions) for posted tweets ≤7 days old and stores into `x_deliveries.api_response.metrics`. Off by default to preserve quota.

---

### Files touched

**New**
- `supabase/migrations/<ts>_x_posting.sql` (table, settings rows, RPC, cron)
- `supabase/functions/x-poster/index.ts`
- `src/components/settings/XPostingConfig.tsx`
- `src/components/settings/XRateLimits.tsx`
- `src/hooks/useXDeliveries.ts`

**Modified**
- `supabase/functions/admin-actions/index.ts` (+ new actions, + validators for `x_posting_config` / `x_rate_limits`)
- `src/components/settings/XAutomationSettings.tsx` (mount the two new cards)
- `src/hooks/useSettingsData.ts` (types + defaults)
- `src/hooks/useDashboardData.ts` + `DashboardMetrics.tsx` + `DashboardHealth.tsx`
- `src/hooks/useMonitoringData.ts` + Monitoring page columns
- DB function `get_dashboard_summary` and `get_post_pipeline_status` (extended)

---

### Open questions

Before I implement, please confirm a few choices:

1. **Where should the X posting controls live?** Inside the existing X Automation tab (recommended) or a brand-new top-level "X Posting" tab?
2. **Should video uploads be enabled by default** (chunked upload is heavier and slower) or images-only at launch?
3. **What hard monthly post budget** should we cap at (X Basic tier = 3,000 writes/mo)? Suggest defaulting to **2,500** to leave headroom for hydration + retries.
4. **Engagement polling (phase 2)** — include now behind an off-by-default toggle, or defer entirely?
