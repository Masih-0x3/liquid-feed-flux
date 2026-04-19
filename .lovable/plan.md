

## Threads Posting Pipeline — Mirror of X Automation

Build a complete Threads (Meta) posting pipeline that mirrors the existing X pipeline 1:1: score-gated, media-aware, forward-only-floor, dedupe, dry-run, dashboard + monitoring integration.

### Threads API essentials (research summary)
- **Endpoint base**: `https://graph.threads.net/v1.0`
- **Auth**: Single long-lived OAuth access token (60 days, refreshable). Much simpler than X — just `Authorization: Bearer <token>` (no OAuth 1.0a signing).
- **Two-step publish**: `POST /{user_id}/threads` (create container w/ `media_type=TEXT|IMAGE|VIDEO|CAROUSEL`) → `POST /{user_id}/threads_publish` (publish using returned `creation_id`).
- **Images**: passed by **public URL** (`image_url=...`), not binary upload → we'll use signed URLs from `temp-media` bucket.
- **Limits**: 500 char text, 250 posts / 24h per user, 10 carousel items max.

### 1. Secrets (user must add)
Three new secrets via the secrets tool:
- `THREADS_ACCESS_TOKEN` (long-lived)
- `THREADS_USER_ID`
- `THREADS_APP_SECRET` (for optional refresh; can be added later)

### 2. Database migration (one migration)
- **New settings rows**:
  - `threads_posting_config` — `{ enabled, min_score, require_media, post_template, leading_emoji, hashtags, max_chars (default 500), dedupe_window_hours, post_only_decision_deliver, start_posting_from }`
  - `threads_rate_limits` — `{ posts_per_hour, posts_per_day (default 250), monthly_post_budget }`
  - `threads_api_usage` — `{ posts_24h: [], posts_total, last_post_error }`
- **New table `threads_deliveries`** — exact parallel of `x_deliveries`:
  ```
  id, post_id, threads_post_id, status, skip_reason, attempts,
  last_error, media_count, media_kind, posted_at, latency_ms,
  api_response, created_at, updated_at
  ```
  RLS: admin manage / authenticated select (same pattern).
- **New RPC `get_threads_posting_summary()`** — mirrors `get_x_posting_summary()` (24h posted/failed/skipped, success rate, latency, monthly projection).
- **Extend `get_dashboard_summary()` and `get_post_pipeline_status()`** to include Threads columns/metrics.

### 3. Edge function: `threads-poster` (new)
Mirror of `x-poster`. Pipeline per candidate:
1. Select candidates: `posts` w/ `delivery_decision='deliver'`, `importance_score ≥ min_score`, `created_at ≥ start_posting_from`, no row in `threads_deliveries`.
2. Quota check against `threads_api_usage` → skip with `skip_reason='rate_limit'`.
3. Media validation: if `require_media`, ensure ≥1 downloaded media row; else skip with `no_media`.
4. Generate **signed URLs** for images from `temp-media` bucket (Threads needs public URLs).
5. Format text from `post_template` (placeholders `{leading_emoji}`, `{translated_text}`, `{hashtags}`, `{author_handle}`). Truncate to 500.
6. **Step A** — `POST /{user_id}/threads` with `media_type`, `text`, `image_url` (or carousel children). Get `creation_id`.
7. **Step B** — `POST /{user_id}/threads_publish` with `creation_id`. Get final `threads_post_id`.
8. Persist `threads_deliveries` row, increment `threads_api_usage.posts_24h`.
9. Errors: 4xx → `failed`; 429/5xx → retry up to 3x with backoff.

### 4. Frontend (mirror of X UI)
- **New components**:
  - `src/components/settings/ThreadsPostingConfig.tsx` (clone of `XPostingConfig.tsx` — same fields, same live preview, same dry-run button).
  - `src/components/settings/ThreadsRateLimits.tsx` (clone of `XRateLimits.tsx`).
  - `src/components/settings/ThreadsAutomationSettings.tsx` (clone of `XAutomationSettings.tsx`) — wraps the two cards.
  - `src/hooks/useThreadsDeliveries.ts` (clone of `useXDeliveries.ts`).
- **New tab in Settings page**: add "Threads Automation" tab next to "X Automation".
- **Forward-only floor**: same loosening detection in `admin-actions` — re-stamp `start_posting_from` when `min_score` is lowered, `require_media` disabled, `post_only_decision_deliver` disabled, or transitioning from disabled → enabled.

### 5. admin-actions extensions
Add validators + actions:
- Validators for `threads_posting_config` and `threads_rate_limits` (Zod, same shape as X).
- Actions: `dry_run_threads_post`, `retry_threads_post`, `get_threads_posting_status`.
- Same forward-only re-stamp logic for Threads loosening events.

### 6. Cron wiring
New pg_cron job `threads-poster-tick` every 60s → calls `threads-poster` with hardcoded URL + anon key (per established cron memory rule). Mirror of `x-poster-tick`.

### 7. Dashboard + Monitoring integration
- **Dashboard**: extend `get_dashboard_summary` to include `threads_posts_24h`, `threads_failed_24h`, `threads_skipped_no_media_24h`, `threads_success_rate`, `threads_monthly_posts/budget`. Add cards in `DashboardMetrics.tsx` and a Threads channel row in `DashboardHealth.tsx`.
- **Monitoring**: extend `get_post_pipeline_status` with `threads_status`, `threads_post_id`, `threads_posted_at`, `threads_error`, `threads_skip_reason`. Add a "Threads" status pill column with link to `https://threads.net/@{user}/post/{id}` and a "Retry on Threads" action.

### 8. config.toml
Add `[functions.threads-poster] verify_jwt = false`.

### Files touched
**New (8)**: migration SQL, `supabase/functions/threads-poster/index.ts`, `ThreadsPostingConfig.tsx`, `ThreadsRateLimits.tsx`, `ThreadsAutomationSettings.tsx`, `useThreadsDeliveries.ts`.

**Modified (7)**: `admin-actions/index.ts` (validators + actions + loosening logic), `Settings.tsx` (new tab), `useSettingsData.ts` (types + defaults), `useDashboardData.ts` + `DashboardMetrics.tsx` + `DashboardHealth.tsx`, `useMonitoringData.ts` + `Monitoring.tsx`, `supabase/config.toml`.

### Open questions

1. Do you have a **Meta App with Threads API access already approved**, or will you need to set that up first? (It requires app review for production.)
2. Which **Threads access token model**: long-lived static (simplest, you paste it once and refresh manually every ~60d) or auto-refreshing (we add refresh logic + store the latest token in `settings`)?
3. Should the **Threads daily limit default to Meta's 250/day** (same as platform cap) or something more conservative like 100/day for safety?
4. Should Threads share the **same `start_posting_from` floor as X**, or have its own independent floor (so changing one doesn't affect the other)?

