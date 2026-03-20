

# Remaining Issues — Comprehensive Status & Plan

## What's Already Done (from previous rounds)
- **Issue 1** (partial): `.mcp.json` deleted, `.env.example` created, `.gitignore` updated. Git history scrub still manual.
- **Issue 3**: `config.toml` updated with all functions declared.
- **Issue 4** (partial): `admin-retry` and `admin-actions` have `requireAdmin()`. Worker, db-cleanup, media-processor, media-cleanup still lack auth.
- **Issue 6**: `user_roles` table + `has_role()` function created. `AuthContext` loads roles. `AppLayout` blocks non-admins.
- **Issue 7**: RLS policies rewritten with `has_role()` for all tables.
- **Issue 8** (partial): `admin-actions` edge function created. Settings.tsx and Threads.tsx use it. Monitoring.tsx uses it for edits/retries.
- **Issue 9**: Secret fields removed from Settings UI.
- **Issue 14** (partial): `dead_letter_jobs`, queue fields, indexes added via migration.
- **Issue 16** (partial): `todo_analytics.md` moved to `docs/roadmap/`.
- **Issue 17**: `claim_jobs` RPC created (but worker doesn't use it yet).
- **Issue 18**: Queue fields (`locked_at`, `locked_by`, `lease_expires_at`, `idempotency_key`) added.
- **Issue 19** (partial): `admin-actions` uses idempotency keys for reprocess. Worker/webhook don't.
- **Issue 20**: `dead_letter_jobs` table created.
- **Issue 23** (partial): `db-cleanup` supports `dry_run` parameter. `media-processor` does not.
- **Issue 24** (partial): `tailwind.config.ts` converted to ESM.
- **Issue 27**: Admin route guard in `AppLayout`.
- **Issue 28**: Split/Merge buttons removed from Threads.
- **Issue 35** (partial): `get_system_health` RPC created, `admin-actions` exposes it.
- **Issue 37**: `docs/operations/runbooks.md` created.
- **Issue 38**: `docs/operations/backup-restore.md` created.
- **Issue 39**: Route-level code splitting with `React.lazy` done.
- **Issue 47** (partial): Some indexes added in migration.
- **Issue 48** (partial): `src_url_hash` column added to media. Worker/webhook don't use it.
- **Issue 49** (partial): `bun.lock` deleted, but `bun.lockb` may still exist and `packageManager` not set.
- **Issue 50**: CI workflow created.

---

## Remaining Issues (30 items)

### Batch 1: Security & Auth Completion (4 items)

**Issue 4 (remaining)**: Worker, db-cleanup, media-processor, media-cleanup lack auth.
- Worker and db-cleanup are invoked by cron/internal — add `x-internal-token` header validation using a shared secret env var.
- media-processor is called by worker and db-cleanup — same internal token check.
- media-cleanup calls media-processor — add token forwarding.

**Issue 5**: Cron migration still embeds bearer token in SQL (`20260226203309`).
- Create new migration that updates the cron job entries to use `current_setting('app.settings.service_role_key')` or remove the hardcoded token and rely on internal-token validation in the functions.

**Issue 10**: Worker hardcodes translation prompt and model (`gpt-4o-mini`, line 276-293).
- Create shared config loader that reads `translation_prompt` and `openai_config` from `settings` table with fallback defaults.
- Worker uses loaded config for model, temperature, prompt.

**Issue 11**: Telegram config inconsistency.
- Worker uses env vars for `bot_token` and `chat_id`; admin-retry test_template also uses env vars. This is already consistent. Mark as done after confirming `parse_mode` is read from settings.

### Batch 2: Config Validation & Edge Function Hardening (3 items) — ✅ DONE

**Issue 12**: ✅ Settings validation added to `admin-actions` with per-key schema checks (type, range, length).

**Issue 13**: ✅ Payload validation added to `webhooks-rssapp` (JSON parse guard), `db-cleanup` (clamped numeric params). `media-processor` already validated.

**Issue 21**: ✅ Retry policy standardized: per-type MAX_ATTEMPTS, exponential backoff (30s base), Telegram 429 `retry_after` handling, dead-lettering after max attempts.

### Batch 3: Queue Reliability (3 items)

**Issue 17 (remaining)**: Worker still uses naive select-then-update (line 25-31) instead of `claim_jobs` RPC.
- Refactor worker to call `claim_jobs` RPC instead of manual select+update.

**Issue 19 (remaining)**: Webhook and worker don't use idempotency keys for translate/deliver jobs.
- Add deterministic `idempotency_key` generation in `webhooks-rssapp` and worker when inserting jobs.

**Issue 22**: No reconciliation jobs.
- Create `reconcile_stuck_jobs` RPC that detects: expired leases, orphaned pending deliveries, translated posts missing delivery jobs.
- Optionally wire to cron.

### Batch 4: Schema Drift (2 items)

**Issue 14 (remaining)**: Telegram analytics tables (`telegram_channel_stats`, `telegram_daily_stats`, `telegram_member_events`, `telegram_message_analytics`, views `telegram_channel_current`, `telegram_member_growth`, `telegram_message_performance`) exist in live DB but have no migration files.
- Create a migration that captures these tables, their columns, indexes, and RLS policies.

**Issue 15**: Regenerate types after schema alignment.
- After Issue 14 migration, regenerate `types.ts`.

### Batch 5: Frontend Refactoring (5 items)

**Issue 24 (remaining)**: Lint errors still exist.
- Fix remaining `any` types, hook dependency arrays, lexical declarations in switch/case across all pages.
- Fix `react-refresh/only-export-components` warnings if present.

**Issue 25**: Pages still oversized (Settings 636 lines, Monitoring 546 lines, Dashboard 336 lines).
- Extract: `SettingsTranslationTab`, `SettingsMessagesTab`, `SettingsOpenAITab`, `SettingsTelegramTab`, `useSettingsConfig` hook.
- Extract: `MonitoringFilters`, `MonitoringEntryCard`, `MonitoringTimelineDrawer`, `useMonitoringFeed` hook.
- Extract: `DashboardMetrics`, `DashboardActivity`, `DashboardHealth`, `useDashboardData` hook.

**Issue 26**: No React Query usage — all pages use `useEffect` + `useState`.
- Replace with `useQuery` for data fetching and `useMutation` for actions.
- Define query keys, stale times, and invalidation patterns.

**Issue 29**: Text encoding issues — `&rarr;` HTML entities in JSX (Dashboard line 208, Monitoring line 363, AppLayout line 57).
- Replace with Unicode arrows `→` or proper JSX.

**Issue 32**: Monitoring still does mixed client-side status inference (lines 198-220) despite having `get_post_pipeline_status` RPC.
- Rely fully on RPC result; remove fallback heuristics.

### Batch 6: Product & Docs (4 items)

**Issue 16 (remaining)**: `docs/todo_monitoring.md` still describes planned features as current.
- Update to reflect actual shipped state.

**Issue 30**: Thread operations — page is view-only + post, which is correct. Mark as done.

**Issue 31**: Analytics not shipped, doc moved to roadmap. Mark as done.

**Issue 54**: README is still the Lovable boilerplate.
- Rewrite with: project purpose, architecture, function inventory, local setup, secrets handling, deployment.

### Batch 7: Performance (7 items)

**Issue 40**: No lazy-loaded subtrees within pages.
- Lazy-load Settings tab content and Monitoring drawer.

**Issue 41**: Dashboard fetches full tables client-side (lines 61-67 — fetches all posts, deliveries, jobs from last 24h).
- Create `get_dashboard_summary` RPC returning counts and metrics.
- Replace 5 parallel queries with 1 RPC call.

**Issue 42**: Pages use broad `select()` with many columns. Already improved (no `select('*')` found). Partially done — verify and mark.

**Issue 43**: Monitoring loads all 100 posts at once with no pagination.
- Add cursor/page pagination with a "Load More" pattern.

**Issue 44**: Dashboard subscribes to all changes on 3 tables and re-fetches everything on each change (line 139-142).
- Debounce realtime callbacks. Use query invalidation instead of full refetch.

**Issue 45**: No bundle analysis or manual chunks.
- Add `rollup-plugin-visualizer` to vite config. Define `manualChunks` for large vendors (recharts, radix, supabase).

**Issue 46**: No React Query caching tuning.
- Set `staleTime` and `gcTime` per query type after Issue 26.

### Batch 8: Tooling (4 items)

**Issue 49 (remaining)**: No `packageManager` field in `package.json`. Check if `bun.lockb` still exists.
- Add `"packageManager": "npm@10.x.x"` to package.json.
- Ensure `bun.lockb` is in `.gitignore`.

**Issue 51**: No test infrastructure.
- Add Vitest + React Testing Library config.
- Write minimum tests for auth guard and settings validation.

**Issue 52**: Dependency audit.
- Run `npm audit` and upgrade flagged packages.

**Issue 53**: No pre-commit hooks.
- Add lint-staged + husky for pre-commit lint checks.

### Batch 9: Remaining Docs & Observability (3 items)

**Issue 33**: No structured logging in most functions.
- Worker partially logs. Add JSON structured logs to all functions with `function`, `action`, `status`, `latency_ms`.

**Issue 34**: No alerts/observability.
- Document alert thresholds in runbooks. Implementation depends on external services.

**Issue 55**: Operator docs incomplete.
- Expand `docs/operations/` with prompt management, secret rotation, incident response sections.

---

## Proposed Execution Order

Given that each Lovable message can handle a limited amount of changes, here's the recommended batching:

**Round 1** — Security & Worker Config (Issues 4r, 5, 10, 11)
Wire internal-token auth for worker/cleanup functions. Make worker read config from settings table. Fix cron token.

**Round 2** — Config Validation & Retry (Issues 12, 13, 21)
Add Zod validation to settings saves and edge function payloads. Standardize retry policy with dead-lettering.

**Round 3** — Queue Reliability (Issues 17r, 19r, 22)
Worker uses `claim_jobs` RPC. Add idempotency keys to webhook/worker. Create reconciliation RPC.

**Round 4** — Schema Drift & Types (Issues 14r, 15)
Migration for telegram analytics tables. Regenerate types.

**Round 5** — Frontend: Split Pages + React Query (Issues 25, 26)
Extract subcomponents and hooks from Settings, Monitoring, Dashboard. Migrate to `useQuery`/`useMutation`.

**Round 6** — Frontend: Fixes & Polish (Issues 24r, 29, 32)
Fix remaining lint errors, text encoding, monitoring status logic.

**Round 7** — Performance (Issues 40, 41, 43, 44, 45, 46)
Lazy subtrees, dashboard RPC, monitoring pagination, debounced realtime, bundle chunks, query cache tuning.

**Round 8** — Tooling & Docs (Issues 49r, 51, 52, 53, 54, 55, 16r, 33, 34)
Package manager field, test infra, dependency audit, pre-commit hooks, README rewrite, operator docs, structured logging.

---

## Summary

| Status | Count |
|--------|-------|
| Fully complete | ~22 |
| Partially complete | ~8 |
| Not started | ~22 |
| **Remaining work items** | **~30** |

The 30 remaining items are organized into 8 implementation rounds. Shall I proceed with Round 1?

