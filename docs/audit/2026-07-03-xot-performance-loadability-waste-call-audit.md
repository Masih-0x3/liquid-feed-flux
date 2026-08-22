# XOT Performance, Loadability, and Waste-Call Audit

Generated: 2026-07-03  
Mode: read-only orchestrated audit with parent verification  
Repo: `/Users/stevmq/Finalized XOT`  
Branch snapshot: `main...origin/main`  
Live Supabase project checked: `jzirqfzzvlbxwfzndaer`  
Vercel project snapshot: `xot`, project `prj_1qO6i3hZ2d9lqYFFWxuRTIhG8ep9`, team `team_FZFzyiblNRBueeZRHhDlsnXJ`

## Executive Verdict

The dashboard is slow primarily because the first dashboard request is not a fast dashboard request. It is a combined dashboard, diagnostics, process observability, resource, queue, X usage, OpenAI usage, budget, and performance-window request. Several sections fetch thousands of rows and then aggregate in Edge Function code. Some of the same domains are fetched more than once inside the same response.

The highest-return fix is to split the dashboard into a fast core summary plus lazy diagnostic panels, backed by aggregate RPCs or rollups. The second priority is to put hard deadlines and stale data behavior around every slow dashboard section. The third priority is to remove avoidable external-call waste by moving idempotency claims before provider calls and by adding active lease tokens for renderer work.

There was no evidence of a current P0 outage in the read-only snapshot. Live status showed the video renderer online, no stale `x_deliveries.posting` rows, and no stale `video_renders.running` rows. The findings below are performance and robustness risks, not proof of a current production incident.

## Audit Anchor

Surfaces inspected:

- Frontend dashboard load path: `src/pages/Dashboard.tsx`, `src/hooks/useDashboardData.ts`, `src/hooks/useDashboardProcessHudData.ts`, `src/api/dashboardData.ts`, `src/api/dashboardProcessHud.ts`, `src/api/adminActions.ts`.
- Supabase Edge/admin API path: `supabase/functions/admin-actions/index.ts`, `supabase/functions/admin-actions/dashboardSummaries.ts`, `supabase/functions/admin-actions/monitoringReads.ts`, `supabase/functions/admin-actions/xApiSummary.ts`.
- Database shape and live advisory state: Supabase MCP read-only SQL and performance advisors for project `jzirqfzzvlbxwfzndaer`.
- External-call waste paths: `supabase/functions/worker/index.ts`, `supabase/functions/worker/telegramDelivery.ts`, `supabase/functions/x-poster/index.ts`, `supabase/functions/_shared/dedupe.ts`, `services/video-renderer/src/server.js`, `services/video-renderer/src/renderer.js`.
- Runtime/deploy config: `package.json`, `deno.json`, `vercel.json`, `.vercel/project.json`, `docs/operations/release-runbook.md`.

Local project instructions:

- No project-root `AGENTS.md` was found in the repo root scan.
- User-supplied AGENTS instructions were applied.
- Memory was used only as routing context; live and local checks were re-run before findings were accepted.

## Orchestration Receipt

Skill invoked: `/Users/stevmq/.agents/skills/audit-orchestrator/SKILL.md`

Mode decision: full worker run.

Worker lanes:

- Frontend/loadability worker: dashboard route, hooks, bundle shape, hidden fetches.
- Edge/API worker: `admin-actions` dashboard summary fan-out, deadlines, payload normalization.
- DB/index worker: hot reporting reads, local schema drift, index candidates.
- Worker/external-call worker: Telegram, X, renderer, OpenAI, Deepgram, Foglamp waste-call boundaries.

Parent verification:

- Accepted: findings with direct source lines or live Supabase evidence.
- Downgraded: local-only claims that contradicted live DB state. In particular, live DB does have `pipeline_events_subject_idx` and `deliveries_subject_idx`, so these are not reported as missing live indexes. They remain query-shape/rollup candidates requiring `EXPLAIN`.
- Rejected: unsupported production latency claims. No authenticated browser timing, Edge logs, or `EXPLAIN ANALYZE` were run.

## Live Snapshot

Read-only Supabase checks were run against `jzirqfzzvlbxwfzndaer` around 2026-07-03 17:02 UTC.

### Edge Functions

Active functions included:

- `admin-actions` version 205, `verify_jwt=true`, updated `1783096425128`.
- `worker` version 279, `verify_jwt=false`, updated `1783070240323`.
- `x-poster` version 154, `verify_jwt=false`, updated `1783070249355`.
- `digest-compiler` version 127, `verify_jwt=false`.

### Table Scale

Largest live tables in the checked set:

| Table | Estimated rows | Total size |
| --- | ---: | ---: |
| `pipeline_events` | 48,152 | 49 MB |
| `jobs` | 8,429 | 27 MB |
| `posts` | 3,433 | 19 MB |
| `x_deliveries` | 11,994 | 12 MB |
| `x_api_events` | 11,012 | 7,960 kB |
| `deliveries` | 1,390 | 3,200 kB |
| `budget_ledger` | 628 | 632 kB |
| `ai_call_ledger` | 369 | 536 kB |
| `workflow_runs` | 250 | 448 kB |

24h live volumes:

| Metric | Count |
| --- | ---: |
| `pipeline_events_24h` | 6,040 |
| `jobs_24h` | 1,049 |
| `posts_24h` | 417 |
| `ai_call_ledger_24h` | 369 |
| `deliveries_24h` | 140 |
| `x_deliveries_24h` | 60 |
| `budget_ledger_current_month` | 628 |

Current budget ledger:

| Period | Provider | Unit | Rows | Quantity |
| --- | --- | --- | ---: | ---: |
| `2026-07` | `foglamp` | `estimated_span_skipped` | 259 | 489 |
| `2026-07` | `openai` | `token` | 369 | 1,129,719 |

Queue/claim snapshot:

- Jobs: one `translate` pending and one `translate` running; most jobs completed.
- `x_deliveries`: no stale `posting` rows in the snapshot.
- `video_renders`: no stale `running` rows in the snapshot.
- `video_renderer_heartbeats`: `hermes-masih-1` online, version `0.1.0`, render version `persian-subtitles-masihh-v1`, running `0`, processed `27`, failed `0`, last seen `2026-07-03 17:02:14.063+00`.

Supabase performance advisors:

- Unindexed foreign keys: `manual_video_intakes.selected_render_id`, `video_render_feedback.tweet_id`, `workflow_runs.job_id`.
- RLS initplan warnings: `user_roles`, `workflow_runs`, `video_renders`, `video_render_feedback`, `video_renderer_heartbeats`, `manual_video_intakes`, `ai_call_ledger`, `budget_ledger`.
- Multiple permissive policy warnings on several observability/video/manual tables.
- Duplicate indexes: `jobs` has `idx_jobs_type_status` and `jobs_type_status_idx`; `telegram_daily_stats` has `idx_daily_stats_chat_date` and `idx_tds_chat_date`; `telegram_message_analytics` has `idx_message_analytics_post_id` and `idx_tma_post_id`.
- Unused-index warnings exist for new/low-traffic observability/manual tables. Treat these as review candidates, not immediate drops.

## Findings

### P1: Dashboard Summary Is Too Heavy for the First Screen

Evidence:

- Frontend loads one query, `['dashboard']`, via `fetchDashboardData`: `src/hooks/useDashboardData.ts:27-33`.
- `fetchDashboardData` invokes one Edge action, `get_dashboard_summary`: `src/api/dashboardData.ts:660-663`.
- `admin-actions` routes `get_dashboard_summary` to `getEnhancedDashboardSummary`: `supabase/functions/admin-actions/index.ts:296-298`.
- `getEnhancedDashboardSummary` calls the base RPC and then concurrently launches posts, Telegram deliveries, X deliveries, queue breakdown, X local usage, OpenAI usage, process observability, system performance, and scoring tuning: `supabase/functions/admin-actions/dashboardSummaries.ts:1140-1265`.
- `getSystemPerformanceSummary` independently runs 6h and 24h performance windows, resource usage, and queue breakdown: `supabase/functions/admin-actions/dashboardSummaries.ts:1024-1031`.
- Several sections use 5k to 10k bounded row reads: jobs at `dashboardSummaries.ts:310-317` and `479-499`, performance windows at `861-902`, budget ledger at `397-402`.

Impact:

- First dashboard paint waits on diagnostics that are not needed to make the first screen usable.
- One slow section can make the whole route feel slow.
- The same user action transfers and reduces overlapping `posts`, `jobs`, `deliveries`, `x_deliveries`, `pipeline_events`, `budget_ledger`, and `ai_call_ledger` rows.

Recommended fix:

1. Split `get_dashboard_summary` into a fast core action and lazy actions:
   - `get_dashboard_core`: base health, ingest heartbeat, active queue count, last activity, critical blockers.
   - `get_dashboard_process_hud`: already exists, but should be lazy and slimmer.
   - `get_dashboard_diagnostics`: system performance, budget, OpenAI usage, scoring tuning.
   - `get_dashboard_x_usage`: X local/official usage.
2. Render the first dashboard screen from core data only.
3. Load diagnostics after core success with `useQuery({ enabled })`, visible-panel gating, and stale previous data.
4. Add a small cached dashboard summary table or RPC for 24h aggregates.

Expected gain:

- Faster first meaningful paint.
- Lower PostgREST bandwidth.
- Better degradation when one diagnostic source is slow.

### P1: External Side Effects Are Not Always Behind a Strong Idempotency Claim

Evidence:

- Telegram delivery checks existing posted rows before sending: `supabase/functions/worker/index.ts:2720-2729`.
- Telegram API calls happen before the `deliveries` row is inserted: `worker/index.ts:2920`, `2941`, `2959`, `2970`, then insert at `3012-3022`.
- Live indexes for `deliveries` include `deliveries_pkey`, `deliveries_subject_idx(subject_type, subject_id, status)`, and `idx_deliveries_status`; no unique idempotency boundary for posted Telegram delivery was present in the live index list.
- X has a stronger active/posted unique claim boundary, but some work still occurs before the claim. `x-poster` checks latest delivery at `supabase/functions/x-poster/index.ts:1403-1434`, runs final duplicate assertion at `1446-1455`, fetches media rows at `1527-1531`, prepares media bytes at `1710-1716`, and only then calls `claimXPostDelivery` at `1739-1746`.

Impact:

- Parallel/retried Telegram `deliver` jobs can duplicate provider sends if both pass the read-before-send check.
- X can spend duplicate/adjudication/render/media work before discovering that a delivery cannot be claimed.

Recommended fix:

1. Add a Telegram delivery claim table or claim columns before Telegram API calls.
2. Add a partial unique index for active/posted Telegram post+chat delivery.
3. Complete/fail/release the claim after the API result.
4. Move the X delivery claim before costful final duplicate assertion, render dispatch, and media byte download. Release or fail the claim if later validation blocks the post.

### P1: Video Renderer Lease Can Expire During Paid Work

Evidence:

- `claim_video_renders` uses a fixed 10-minute lease and can reclaim expired `running` rows: `supabase/migrations/20260609201533_video_render_pipeline.sql:390-425`.
- Completion updates by `id` only and clears lease fields: `20260609201533_video_render_pipeline.sql:492-517`.
- Failure updates by `id` only and clears lease fields: `20260609201533_video_render_pipeline.sql:624-633`.
- Renderer heartbeat reports service state but does not refresh the active render row lease during processing: `services/video-renderer/src/server.js:176-187`.
- Paid and heavy work occurs inside one render path, including OpenAI vision `services/video-renderer/src/renderer.js:547-560`, transcription `renderer.js:750-777`, and translation `renderer.js:896-908`.

Live status:

- No stale `video_renders.running` rows were present in the snapshot.

Impact:

- A long render can outlive the 10-minute lease, be reclaimed by another renderer, and duplicate OpenAI/Deepgram/storage work.
- A stale worker can complete/fail a row after another worker has reclaimed it because completion is not owner/token gated.

Recommended fix:

1. Add render claim tokens/owner fields to the claim RPC result.
2. Refresh `lease_expires_at` during processing or before each paid phase.
3. Make complete/fail/block RPCs conditional on `id + claim_token + locked_by`.
4. Emit a recoverable "lost lease" result if completion no longer owns the render.

### P2: Dashboard Has No Explicit Deadlines for Slow Sections

Evidence:

- Frontend admin action wrapper calls `supabase.functions.invoke` without an abort signal or deadline: `src/api/adminActions.ts:44-49`.
- `withDashboardFallback` catches rejected promises but does not time out never-settling or slow work: `supabase/functions/admin-actions/dashboardSummaries.ts:37-49`.
- Dashboard section `Promise.all` starts at `dashboardSummaries.ts:1168-1265`.
- System performance is caught, but still has no section deadline: `dashboardSummaries.ts:1252-1255`.

Impact:

- A slow query or external usage sync can hold the route longer than the UI should tolerate.
- Degraded fallback behavior exists for errors, not for slow-but-not-failed work.

Recommended fix:

1. Add request-level deadlines on frontend admin invocations.
2. Add Edge helper `withDashboardDeadline(section, promise, fallback, ms)`.
3. Use shorter deadlines for diagnostics than core health.
4. Return partial section metadata: `{ available: false, partial_reason: 'timeout', generated_at }`.

### P2: Hidden HUD Work Starts Before the Dashboard Is Usable

Evidence:

- `Dashboard` starts both `useDashboardData()` and `useDashboardProcessHudData()` immediately: `src/pages/Dashboard.tsx:236-239`.
- Loading and error returns hide the HUD UI: `Dashboard.tsx:248-269`.
- HUD query has no `enabled` guard: `src/hooks/useDashboardProcessHudData.ts:17-24`.
- HUD opens six realtime subscriptions on `posts`, `jobs`, `deliveries`, `x_deliveries`, `workflow_runs`, and `ai_call_ledger`: `useDashboardProcessHudData.ts:33-40`.
- HUD fetch requests 30 entries over 24h: `src/api/dashboardProcessHud.ts:55-65`.
- Backend builds HUD entries from the broad monitoring projection and related status maps: `supabase/functions/admin-actions/monitoringReads.ts:147-180` and `1858-1948`.

Impact:

- Dashboard loading and error states can still spend backend work on a hidden panel.
- Keeping the dashboard open can trigger repeated HUD work under table churn.

Recommended fix:

1. Gate `useDashboardProcessHudData` with `enabled: Boolean(data && !isLoading && !isError)`.
2. Lazy-load `MonitoringProcessHud` after core summary success.
3. Replace broad realtime table subscriptions with one coalesced dashboard revision signal, slower polling, or visibility-aware refresh.
4. Add a slim HUD projection instead of returning full `MonitoringEntry` objects.

### P2: Duplicate Scans Happen Inside One Dashboard Response

Evidence:

- Top-level summary calls `loadDashboardQueueBreakdown`: `dashboardSummaries.ts:1203-1205`.
- `getSystemPerformanceSummary` calls `loadDashboardQueueBreakdown` again: `dashboardSummaries.ts:1024-1031`.
- `x_deliveries` is read in the top-level delivery section: `dashboardSummaries.ts:1193-1199`.
- `x_deliveries` is also read by X local usage and performance windows.
- Performance windows run twice, 6h and 24h: `dashboardSummaries.ts:1027-1029`.

Impact:

- Extra DB reads, extra JS reduction, and extra payload handling for a single UI refresh.

Recommended fix:

1. Compute queue breakdown once and pass it into system performance.
2. Use aggregate RPCs for performance windows.
3. Avoid rereading the same 24h delivery slices for summary and diagnostics.

### P2: Live Database Advisors Show RLS, Duplicate Index, and FK Performance Debt

Evidence:

- Supabase performance advisors flagged unindexed FKs on `manual_video_intakes`, `video_render_feedback`, and `workflow_runs`.
- Advisors flagged RLS initplan warnings on `user_roles`, `workflow_runs`, `video_renders`, `video_render_feedback`, `video_renderer_heartbeats`, `manual_video_intakes`, `ai_call_ledger`, and `budget_ledger`.
- Advisors flagged duplicate indexes on `jobs`, `telegram_daily_stats`, and `telegram_message_analytics`.

Impact:

- RLS policy evaluation can get unnecessarily expensive at scale.
- Duplicate indexes waste write work and storage.
- Unindexed FKs can slow joins and deletes/updates involving referenced rows.

Recommended fix:

1. Add the missing FK covering indexes in a measured migration.
2. Rewrite RLS policy auth calls to use select-wrapped stable calls where appropriate, for example `(select auth.uid())`.
3. Consolidate duplicate indexes after confirming no migration dependency or naming convention requires both.
4. Treat unused-index advisories as candidates only; confirm with `pg_stat_user_indexes` across a meaningful traffic window before dropping.

### P2: Reporting Paths Need Rollups or Aggregate RPCs

Evidence:

- Dashboard performance windows read `posts`, `deliveries`, `x_deliveries`, and `pipeline_events` up to 10k rows per window: `dashboardSummaries.ts:861-902`.
- Queue breakdown reads up to 5k recent jobs and 5k active jobs: `dashboardSummaries.ts:479-499`.
- Process observability reads monthly `budget_ledger` rows up to 10k: `dashboardSummaries.ts:397-402`.
- Foglamp budget checks also fetch `budget_ledger.quantity` rows and sum client-side: `supabase/functions/_shared/observability.ts:363-375`.
- Live July ledger had 628 rows already, including 369 OpenAI token rows and 259 Foglamp skipped-span rows.

Impact:

- Dashboard cost grows with operational volume.
- Foglamp/OpenAI budget reporting spends bandwidth to compute simple sums.

Recommended fix:

1. Add aggregate RPCs for dashboard windows:
   - posts created/translated/dedupe counts.
   - Telegram/X delivery counts and latency.
   - pipeline score counts and stage durations.
2. Add monthly budget aggregate RPC keyed by `period_key, provider, unit`.
3. Consider hourly rollup tables for charting and dashboard trends.

### P2: Stale X Posting Claims Are Detected but Not Reclaimed

Evidence:

- `claim_x_post_delivery` returns `stale_posting` when it finds an expired posting claim, but does not release or reclaim it: `supabase/migrations/20260617224908_x_post_delivery_claims.sql:61-79`.
- `x-poster` separately defers stale posting rows before attempting a claim: `supabase/functions/x-poster/index.ts:1424-1433`.

Live status:

- No stale `x_deliveries.posting` rows were present in the snapshot.

Impact:

- If a stale posting claim appears, retries can defer indefinitely until manual cleanup or another process clears it.

Recommended fix:

1. Add `release_stale_x_post_delivery` or make `claim_x_post_delivery` atomically reclaim expired `posting` rows.
2. Preserve the old claim metadata in `claim_released_at`, `claim_release_reason`, and `last_claim_error`.

### P2: Telegram Retry Errors Lose the Retry Response

Evidence:

- Text send parse-error fallback throws using the first response if the fallback retry fails: `supabase/functions/worker/index.ts:2987-3005`.
- Media helpers repeat the same pattern: `supabase/functions/worker/telegramDelivery.ts:144-152`, `309-317`, and `345-363`.

Impact:

- A parse-error retry followed by a `429` or provider failure can lose the retry response details.
- Backoff extraction can miss the real `retry_after`.

Recommended fix:

1. Throw using the retry response when retry fails.
2. Add regression tests for "Markdown parse error first, 429 retry second".
3. Include method, retry status, and `retry_after` in structured pipeline event metadata.

### P3: Frontend Bundle Is Not the Main Bottleneck, but First Route Can Be Leaner

Evidence:

- Temp Vite build passed.
- Dashboard chunk: `Dashboard-CfVFhOOY.js` 48.09 kB, 11.07 kB gzip.
- HUD chunk: `MonitoringProcessHud-BSVkRNjJ.js` 36.90 kB, 10.87 kB gzip.
- Main vendor chunks are larger: `vendor-radix` 240.34 kB, gzip 76.65 kB; `vendor-supabase` 117.44 kB, gzip 31.86 kB; app `index` 124.22 kB, gzip 39.45 kB.
- Build warned that Browserslist data is 13 months old.

Impact:

- Bundle size is not the core reason the dashboard is laggy, but lazy HUD loading and dependency pruning can improve slow-device perception.

Recommended fix:

1. Lazy-load HUD and secondary diagnostics after core summary success.
2. Keep operational pages chunked by route.
3. Refresh Browserslist data as routine maintenance.

### P3: Runtime Config Has a Node Version Mismatch

Evidence:

- `package.json` declares Node `20.x` and npm `10.x`.
- `.vercel/project.json` has `nodeVersion: "24.x"`.
- CI workflow uses Node 20.

Impact:

- Static Vite output reduces blast radius, but install/build behavior and toolchain bugs can differ between CI/local and Vercel.

Recommended fix:

1. Align Vercel Node with `package.json` and CI, or intentionally update all three to Node 24.
2. Record the decision in the release runbook.

### P3: Performance Contracts Are Not Tested

Evidence:

- Focused dashboard and admin tests passed.
- Existing tests cover behavior and degradation but do not fail when dashboard query counts grow, when duplicate scans are introduced, or when a section never settles.

Recommended fix:

1. Add a fake Supabase client that counts table/RPC calls for `getEnhancedDashboardSummary`.
2. Add a deadline test with a never-settling section.
3. Add a HUD projection test that rejects full monitoring payload bloat.
4. Add idempotency tests for Telegram claims and X claim ordering before provider work.

## Candidates Requiring More Evidence

Do not implement these blindly from static code alone:

- `EXPLAIN (ANALYZE, BUFFERS)` for dashboard hot queries:
  - `pipeline_events` score window: `subject_type='post'`, `step='score'`, `status in (...)`, `created_at >= since`.
  - `deliveries` window: `subject_type='post'`, `status='posted'`, `created_at >= since`.
  - `jobs` reporting: `type in ('translate','enrich')`, `created_at >= since`, ordered by `created_at desc`.
  - exact URL duplicate lookup on `posts.url`.
- Browser network trace for authenticated dashboard:
  - first load request count.
  - dashboard summary latency.
  - HUD latency and payload bytes.
  - realtime-triggered refetch count over 5 to 10 minutes of pipeline activity.
- Edge Function logs/timing for `admin-actions`:
  - per-section timings.
  - error/fallback frequency.
  - official X usage sync latency/failure.
- Provider-side waste checks:
  - Telegram duplicate-send evidence.
  - X claim rejection after media/OpenAI work.
  - renderer jobs longer than 10 minutes.

## No-Action / Good Signs

- Main dashboard summary realtime subscription is already narrowed to `posts` inserts with a 2s debounce in `src/hooks/useDashboardData.ts:42-50`.
- X delivery has partial unique indexes for active/posted and posted states in live DB:
  - `uq_x_deliveries_post_active_or_posted`.
  - `uq_x_deliveries_post_posted`.
- Renderer heartbeat was online in the live snapshot.
- Current live snapshot did not show stale `x_deliveries.posting` or stale `video_renders.running`.
- Focused tests and a temp Vite build passed.

## Verification Run

Passed:

```bash
npm test -- src/test/dashboard-data.test.ts src/test/admin-actions-contract.test.ts src/test/dashboard.test.tsx
```

Result: 3 files passed, 20 tests passed.

Passed:

```bash
npx --yes deno test --allow-env supabase/functions/admin-actions/dashboardSummaries.test.ts supabase/functions/admin-actions/monitoringReads.test.ts supabase/functions/admin-actions/xApiSummary.test.ts
```

Result: 18 tests passed.

Passed:

```bash
npx vite build --mode development --outDir /tmp/xot-performance-audit-build
```

Result: build passed in 2.82s. Output was written outside the repo.

Blocked or not run:

- No authenticated browser/network trace.
- No `EXPLAIN ANALYZE`.
- No Supabase Edge logs.
- No provider API calls.
- No schema migrations or app code changes.
- No deployment.

## Remediation Backlog

### Phase 1: Make Dashboard Load Fast and Degrade Cleanly

1. Split `get_dashboard_summary` into fast core and lazy diagnostics.
2. Gate and lazy-load `useDashboardProcessHudData`.
3. Add section deadlines in Edge and request deadlines in the frontend.
4. Reuse queue/delivery slices inside one response or move them to aggregate RPCs.
5. Add performance-contract tests for dashboard query count and timeouts.

### Phase 2: Reduce DB Bandwidth and CPU Waste

1. Replace 5k to 10k dashboard row pulls with aggregate RPCs.
2. Add monthly `budget_ledger` aggregate RPC or rollup table.
3. Run targeted `EXPLAIN ANALYZE` for dashboard, monitoring, and dedupe hot queries.
4. Add only measured indexes, then re-run advisors.
5. Consolidate duplicate indexes after usage review.

### Phase 3: Reduce Provider Waste and Duplicate Side Effects

1. Add Telegram delivery claim/idempotency before API send.
2. Move X claim before OpenAI/render/media preparation.
3. Reclaim stale X posting claims.
4. Add renderer claim tokens, lease refresh, and owner-gated completion/failure.
5. Cache renderer preflight results by render/config hash.
6. Fix Telegram retry error reporting.

### Phase 4: Operational Visibility

1. Add per-section timing to `admin-actions` dashboard responses.
2. Add payload byte estimates for dashboard and HUD.
3. Add daily dashboard cost counters: DB rows fetched, Edge duration, OpenAI/Foglamp tokens/spans, provider retries.
4. Add an authenticated browser smoke that records dashboard request count and largest payload.

## Recommended Next Step

Implement Phase 1 first. The smallest high-return slice is:

1. Add `enabled` gating and lazy HUD loading in the dashboard.
2. Add `withDashboardDeadline` around heavy dashboard sections.
3. Split diagnostics out of `get_dashboard_summary` or add `include` flags so first load can request core only.
4. Add tests proving the first dashboard action does not call heavy diagnostics by default.

This should improve perceived dashboard speed without touching production schema or provider-side flows.
