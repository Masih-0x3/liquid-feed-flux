# XOT Spaghetti Map

Date: 2026-06-14
Branch: `codex/xot-cleanup-03-spaghetti-map`
Worktree: `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup`

This audit maps the cleanup targets that make XOT confusing to work with. It is intentionally read-only except for this document. Production should not be changed from this phase.

## Evidence Used

- Baseline checks in `docs/operations/cleanup-baseline.md`.
- System inventory in `docs/operations/xot-system-inventory.md`.
- Release runbook in `docs/operations/release-runbook.md`.
- Local source metrics from `find ... | wc -l`.
- Direct source inspection with `rg`, `nl`, and package manifests.
- Live read-only release-state refresh through `npm run check:release-state`.

Tool limitation: Codegraph refused to index this cleanup worktree because it is under `/Users/stevmq/.config/...`; this audit uses direct repository evidence instead.

## Top Cleanup Findings

| ID | Severity | Area | Finding | Primary cleanup action |
| --- | --- | --- | --- | --- |
| SM-01 | P1 | Supabase functions | `admin-actions` is the largest control-plane file and handles too many unrelated domains. | Split by action domain behind one stable dispatcher. |
| SM-02 | P1 | Supabase functions | `worker` mixes queue claim, scoring, translation, Telegram delivery, media, hydration, enrichment, X dispatch, and retry policy. | Extract job handlers and shared job lifecycle helpers. |
| SM-03 | P1 | Frontend | `Monitoring.tsx` is both a page, API client, action registry, detail surface, bulk-action controller, and rendering layer. | Move admin action client and view-model builders out of the page. |
| SM-04 | P1 | Contracts | Frontend action payloads and `admin-actions` switch cases are duplicated as string literals. | Add typed admin action contract module before splitting code. |
| SM-05 | P1 | Frontend data | Monitoring and dashboard data paths use fallbacks and casts that keep local UI usable while hiding schema drift. | Move fallbacks into API modules and sunset them after migration/type repair. |
| SM-06 | P2 | Types | Supabase generated types lag the actual schema, causing `any`, `unknown`, and fallback query branches. | Regenerate types after migration drift is understood. |
| SM-07 | P1 | Database | Migration history drift and advisor findings are real; schema cleanup must not use blind `db push`. | Create a migration trust phase before schema edits. |
| SM-08 | P2 | Renderer | Renderer and preview pipelines duplicate helpers and carry a large env/config surface. | Extract shared renderer config and preflight orchestration. |
| SM-09 | P1 | Renderer auth | Renderer HTTP auth is fail-open when `VIDEO_RENDERER_TOKEN` is missing, and that secret is not observed in Supabase Edge secrets. | Add a fail-closed server-auth guard and tests before broader renderer cleanup. |
| SM-10 | P2 | Runtime/deps | Repo declares Node 20.x while observed Vercel runtime is Node 24.x; root audit is already failing. | Align runtime and dependency policy in a separate phase. |
| SM-11 | P2 | Function auth/security | Several functions intentionally run with `verify_jwt=false`; webhook query-token compatibility still exists. | Keep function-by-function auth matrix and phase out query tokens after signed RSS.app webhook cutover. |

## File Size Hotspots

Largest local source files:

| File | Lines | Notes |
| --- | ---: | --- |
| `supabase/functions/admin-actions/index.ts` | 6213 | 128 function declarations; one large request dispatcher. |
| `supabase/functions/worker/index.ts` | 3600 | 75 function declarations; many job domains in one file. |
| `src/pages/Monitoring.tsx` | 2850 | 44 function declarations; page, API client, action router, and view rendering mixed. |
| `services/video-renderer/src/preflight.js` | 2020 | 83 function declarations; watermark/OCR/preflight policy hub. |
| `supabase/functions/_shared/enrich.ts` | 1712 | Enrichment agents and voice/profile logic. |
| `src/integrations/supabase/types.ts` | 1657 | Generated types, but still incomplete for newer X/video tables. |
| `services/video-renderer/src/openai.js` | 1237 | Transcription, translation, cleanup, and vision calls in one module. |
| `supabase/functions/_shared/dedupe.ts` | 1182 | Story memory, embeddings, AI dedupe, update helpers. |
| `supabase/functions/x-poster/index.ts` | 1104 | X media, dedupe gates, posting, telemetry, fallback behavior. |
| `src/pages/XAccount.tsx` | 1102 | X account review surface. |

Cleanup rule: split only after adding or identifying tests around the affected workflow. Do not split these files just to reduce line count.

## Detailed Findings

### SM-01: `admin-actions` is the main control-plane knot

Evidence:

- `supabase/functions/admin-actions/index.ts` is 6213 lines.
- It contains 128 function declarations.
- Request body parsing uses `any` at `supabase/functions/admin-actions/index.ts:4935`.
- The main authenticated dispatcher starts at `supabase/functions/admin-actions/index.ts:4941`.
- The dispatcher creates a service-role client as `createClient<any, any>` at `supabase/functions/admin-actions/index.ts:4944`.
- The action switch runs from `supabase/functions/admin-actions/index.ts:4954` through `supabase/functions/admin-actions/index.ts:6206`.
- The main request switch has 61 action cases.
- The switch includes settings, monitoring reads, dashboard reads, video render actions, scoring, dedupe, X diagnostics/posting, follower snapshot, translation, enrichment, and backfills.
- Frontend code invokes `admin-actions` 49 times.

Risk:

- Every admin workflow shares one blast radius.
- Reviewers have to understand unrelated systems to review small admin changes.
- Action strings are not centrally typed, so frontend/backend drift is easy.
- The file uses many `deno-lint-ignore no-explicit-any` blocks and service-role clients.

Cleanup plan:

1. Create `supabase/functions/admin-actions/actions/` modules with no behavior change.
2. Move only pure helpers and action handlers first, keeping the top-level switch stable.
3. Add an `AdminActionName` union and action handler registry.
4. Split in this order:
   - version/settings
   - monitoring read models
   - dashboard/system health
   - video render admin
   - scoring/dedupe admin
   - X diagnostics/posting controls
   - enrichment admin
   - bulk/retry/backfill operations
5. After every split, run:
   ```bash
   npm run lint:functions
   npm run check:functions
   npm run test:functions
   npm test
   ```

Exit criteria:

- The dispatcher is mostly routing and auth.
- Each action domain can be reviewed independently.
- Existing action names and response shapes stay compatible.

### SM-02: `worker` mixes too many job domains

Evidence:

- `supabase/functions/worker/index.ts` is 3600 lines.
- It contains 75 function declarations.
- The job dispatch switch starts at `supabase/functions/worker/index.ts:480`.
- `handleTranslateJob` starts at `supabase/functions/worker/index.ts:929` and includes duplicate gating, scoring prompt construction, scoring policy, translation, delivery decision, and next-job routing.
- `handleDeliverJob` starts at `supabase/functions/worker/index.ts:1848` and includes Telegram idempotency, URL dedupe, final duplicate assertion, video-render gating, media selection, Telegram API calls, delivery inserts, and render-posted marking.
- Retry/dead-letter policy starts around `supabase/functions/worker/index.ts:2476`.
- Media download delegates to `media-processor` at `supabase/functions/worker/index.ts:2613`.

Risk:

- Queue behavior is hard to change safely because job lifecycle, business rules, and external API handling are interleaved.
- Delivery, scoring, and dedupe fixes can accidentally affect retry or media behavior.
- Large local variables and inline prompt/tool schemas make smaller changes noisy.

Cleanup plan:

1. Extract shared job lifecycle helpers:
   - `jobError`
   - `MAX_ATTEMPTS`
   - retry/backoff/dead-letter update
   - pipeline event helpers
2. Extract one job handler at a time:
   - `translate`
   - `deliver`
   - `download_media`
   - `hydrate_tweet`
   - `resolve_media`
   - `enrich`
   - `reprocess`
3. Move scoring prompt/tool schema construction out of `handleTranslateJob`.
4. Move Telegram delivery helpers behind a `telegramDelivery` module.
5. Keep queue claim/dispatch in `worker/index.ts`.

Validation:

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm test
npm run check:release-state
```

Exit criteria:

- Each job type has a single handler module.
- Retry semantics and pipeline events are unchanged.
- Tests cover scoring, delivery duplicate gates, video render gates, and failure handling before behavior changes.

### SM-03: `Monitoring.tsx` is page, API client, action registry, and renderer

Evidence:

- `src/pages/Monitoring.tsx` is 2850 lines.
- Direct admin action wrappers are defined at `src/pages/Monitoring.tsx:98` through `src/pages/Monitoring.tsx:168`.
- Local action and diagnostic types run through `src/pages/Monitoring.tsx:171` through `src/pages/Monitoring.tsx:212`.
- Page state starts at `src/pages/Monitoring.tsx:697`, while data hooks and direct settings reads start around `src/pages/Monitoring.tsx:729` and `src/pages/Monitoring.tsx:733`.
- The detail drawer directly queries `pipeline_events` at `src/pages/Monitoring.tsx:877`.
- Confirmation action routing runs through `src/pages/Monitoring.tsx:1039` through `src/pages/Monitoring.tsx:1134`.
- Row actions are rendered inline at `src/pages/Monitoring.tsx:1392`, and the main page JSX starts at `src/pages/Monitoring.tsx:1582`.
- The page imports many data and display helpers, then still owns a large amount of action logic.
- Existing Dashboard render coverage starts at `src/test/dashboard.test.tsx:267`, while Monitoring tests are helper-level files such as `src/test/monitoring-state.test.ts:1` and `src/test/scoring-v2-monitoring.test.ts:1`; no test currently renders the full Monitoring page.

Risk:

- Adding a single Monitoring button requires touching a page that already owns many unrelated workflows.
- Frontend action payloads can drift from `admin-actions`.
- UI tests cover some layout and dashboard behavior, but not enough for every action path in this page.

Cleanup plan:

1. Create `src/lib/adminActions.ts` or `src/api/adminActions.ts`.
2. Move the direct `supabase.functions.invoke('admin-actions')` wrappers there.
3. Create a typed `MonitoringAction` map that links UI action type to admin action call.
4. Move action titles/descriptions into a small static module.
5. Move duplicate cluster and grouping helpers into `src/lib/monitoringViewModel.ts`.
6. Only after this split, consider component extraction:
   - filters toolbar
   - queue cards
   - row renderer
   - detail drawer
   - action confirmation dialog

Validation:

```bash
npm run lint
npm run check:strict
npm test -- src/test/monitoring-state.test.ts src/test/timeline-display.test.ts src/test/app-layout.test.tsx
npm run build
```

Exit criteria:

- `Monitoring.tsx` becomes page composition, not the action API.
- Every existing Monitoring action still uses the same backend action name.

### SM-04: Admin action contracts are duplicated across frontend and backend

Evidence:

- Frontend invokes `admin-actions` 49 times.
- `src/hooks/useVideoRenderData.ts:141` defines a generic admin action caller for video render actions.
- `src/pages/Monitoring.tsx:98` through `src/pages/Monitoring.tsx:168` defines another set of direct admin action wrappers.
- `src/components/dashboard/DashboardHealth.tsx:50` through `src/components/dashboard/DashboardHealth.tsx:70` invokes `admin-retry` and `admin-actions` directly from UI action handling.
- `src/hooks/useDashboardData.ts:565` calls `get_dashboard_summary` through `admin-actions`.
- `src/hooks/useSettingsData.ts:482` and `src/hooks/useSettingsData.ts:526` call settings and translation preview actions.
- `src/pages/Settings.tsx:536` and `src/pages/Settings.tsx:683` invoke live `admin-retry` actions directly from dialog handlers.
- `src/components/settings/XAutomationSettings.tsx:77` invokes `get_x_status` directly.
- `src/hooks/useSettingsData.ts:476` provides a shared `useSaveSettings` path through `admin-actions`, but `src/components/settings/EnrichmentSettings.tsx:176` through `src/components/settings/EnrichmentSettings.tsx:235` reads and writes the `settings` table directly.
- Backend switch cases are string literals in `supabase/functions/admin-actions/index.ts:4954` through `supabase/functions/admin-actions/index.ts:6206`.

Risk:

- Contract drift appears at runtime, not compile time.
- Local UI can run ahead of deployed functions, which already forced fallback logic in hooks.
- Settings writes have multiple code paths, so audit, role, and validation behavior can drift by component.

Cleanup plan:

1. Add a shared action-name list used by frontend tests and backend dispatch tests.
2. Add small TypeScript types for high-traffic actions first:
   - `get_dashboard_summary`
   - `get_monitoring_entries`
   - `retry_x_post`
   - `run_dedupe`
   - `get_video_render_queue`
3. Add tests that assert every frontend action name exists in the backend registry.
4. Do not attempt a huge schema framework until the action list is centralized.

Validation:

```bash
npm run check:strict
npm test
npm run lint:functions
npm run check:functions
```

### SM-05: Monitoring data has fallback schema branches that hide drift

Evidence:

- `src/hooks/useMonitoringData.ts:388` through `src/hooks/useMonitoringData.ts:392` detects missing dedupe/scoring/enrichment columns by regex.
- `src/hooks/useMonitoringData.ts:440` through `src/hooks/useMonitoringData.ts:452` retries with progressively older column sets and casts query rows through `unknown`.
- `src/hooks/useMonitoringData.ts:461` through `src/hooks/useMonitoringData.ts:471` swallows deployed-function status lookup failures for compatibility.
- The newer `admin-actions` path falls back to legacy local queries at `src/hooks/useMonitoringData.ts:629` through `src/hooks/useMonitoringData.ts:658`.
- `src/hooks/useMonitoringData.ts:649` casts returned `admin-actions` entries directly to `MonitoringEntry[]`.
- Dashboard normalization uses multiple `Record<string, unknown>` bridges, including `src/hooks/useDashboardData.ts:379`, `src/hooks/useDashboardData.ts:414`, and `src/hooks/useDashboardData.ts:561`.
- `docs/operations/xot-system-inventory.md:187` through `docs/operations/xot-system-inventory.md:190` records production alignment plus migration drift and runtime drift as baseline risks.

Risk:

- Fallbacks keep the UI usable, but they also make it unclear which schema is canonical.
- Local UI can appear to work while production functions are behind.

Cleanup plan:

1. Keep the fallback until migration drift is repaired.
2. Add a documented sunset condition: remove fallback only after generated types include current columns and production function SHA matches `main`.
3. Move fallback query logic out of the hook into `src/api/monitoringData.ts`.
4. Add a test for fallback behavior so it can be safely removed later.

Validation:

```bash
npm run check:strict
npm test -- src/test/monitoring-state.test.ts
npm run check:release-state
```

### SM-06: Supabase types are behind current schema

Evidence:

- `src/hooks/useXDeliveries.ts:22` through `src/hooks/useXDeliveries.ts:31` casts through `unknown` because `x_deliveries` types may not be regenerated.
- `src/hooks/useFollowerData.ts:207`, `src/hooks/useFollowerData.ts:225`, `src/hooks/useFollowerData.ts:250`, and `src/hooks/useFollowerData.ts:297` use `any` casts for newer X review tables.
- Edge functions use `createClient<any, any>` in multiple functions, including `supabase/functions/admin-actions/index.ts:4944`.

Risk:

- Table/column drift is normalized into casts.
- Errors that generated types should catch can pass through to runtime.

Cleanup plan:

1. Do not regenerate types until migration history is understood.
2. After migration trust repair, regenerate Supabase types from the linked project.
3. Replace local handwritten casts with generated table types.
4. Add a lint/test gate for new `as any` and `createClient<any, any>` only after the existing set is reduced.

Validation:

```bash
npm run check:strict
npm run lint
npm run lint:functions
npm run check:functions
```

### SM-07: Database drift and advisor findings need their own phase

Evidence:

- There are 96 local migration files.
- `docs/operations/xot-system-inventory.md:102` through `docs/operations/xot-system-inventory.md:107` records the latest shared migration, local-only migrations, historical drift, and the rule not to run blind `db push`.
- Advisor highlights include public `vector`, GraphQL exposure, permissive video policies, and duplicate indexes at `docs/operations/xot-system-inventory.md:174` through `docs/operations/xot-system-inventory.md:183`.
- `supabase/migrations/20260320004655_04a925c9-fd01-4fa6-a88e-c48f93ad480e.sql:7` through `supabase/migrations/20260320004655_04a925c9-fd01-4fa6-a88e-c48f93ad480e.sql:14` created admin manage policies but also broad authenticated read policies for core tables.
- `supabase/migrations/20260515075613_harden_admin_surface.sql:197` through `supabase/migrations/20260515075613_harden_admin_surface.sql:205` later closes privileged RPC execution through the admin-actions path.
- `docs/operations/release-runbook.md` now blocks migration release until a reviewed migration trust plan exists.

Risk:

- Schema cleanup can break production if local migration history is treated as source of truth without reconciliation.
- Type regeneration before drift repair may encode the wrong assumptions.

Cleanup plan:

1. Create a migration trust document:
   - remote-only migrations
   - local-only migrations
   - matched migrations
   - intentionally abandoned local files
2. Decide whether to repair history with Supabase migration repair commands or new forward-only migrations.
3. Review RLS/GraphQL exposure separately from code cleanup.
4. Remove duplicate indexes only after query plan review.

Validation:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
npm run check:release-state
```

### SM-08: Renderer config and preview/production pipelines duplicate logic

Evidence:

- `services/video-renderer/src/preflight.js` is 2020 lines and has 83 function declarations.
- `services/video-renderer/src/openai.js` is 1237 lines and has 51 function declarations.
- `services/video-renderer/src/renderer.js` loads a large env config surface at `services/video-renderer/src/renderer.js:24` through `services/video-renderer/src/renderer.js:96`.
- Edge config includes `failurePolicy` and `rendererUrl` at `supabase/functions/_shared/videoRenderConfig.ts:10` through `supabase/functions/_shared/videoRenderConfig.ts:12`; the Node renderer settings loader does not own those fields.
- Edge config clamps subtitle `fontScale` to `0.8..1.8` at `supabase/functions/_shared/videoRenderConfig.ts:173`, while the renderer settings loader clamps `font_scale` to `0.75..1.35` at `services/video-renderer/src/settings.js:73`.
- Edge config allows `max_regions` up to `6` at `supabase/functions/_shared/videoRenderConfig.ts:181`, while the renderer settings loader allows up to `4` at `services/video-renderer/src/settings.js:79`.
- `services/video-renderer/src/preview.js` repeats helpers that also exist in production renderer flow, including `parseCsv`, `shouldRequireLocalDelogoCoordinates`, `watermarkProtectedRegions`, `compactContextText`, subtitle context, source language, and OpenCV option assembly.
- Golden batch execution records `completed` when preview exits successfully at `services/video-renderer/golden/run-golden-batch.js:101` through `services/video-renderer/golden/run-golden-batch.js:103`, and summary verdicts in `services/video-renderer/golden/summarize-batch.js:52` through `services/video-renderer/golden/summarize-batch.js:61` are review labels rather than an enforceable acceptance threshold.

Risk:

- Preview and production render behavior can drift.
- Env names become the implicit API.
- Watermark/subtitle changes are high risk because they touch OpenAI, OCR, ffmpeg, OpenCV, storage, and posting dispatch.

Cleanup plan:

1. Extract shared config parsing into `services/video-renderer/src/config.js`.
2. Extract shared preflight context helpers from `renderer.js` and `preview.js`.
3. Keep the one-pass ffmpeg render principle intact.
4. Split `openai.js` only by API family after tests:
   - transcription cleanup
   - translation
   - vision/watermark
5. Add config tests before moving env parsing.

Validation:

```bash
npm --prefix services/video-renderer test
```

### SM-09: Renderer HTTP auth is fail-open when token is missing

Evidence:

- `services/video-renderer/src/server.js:29` through `services/video-renderer/src/server.js:31` returns authorized when no token is configured.
- `services/video-renderer/src/server.js:37` defaults the server token to `process.env.VIDEO_RENDERER_TOKEN ?? ""`.
- Worker dispatch reads `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` at `supabase/functions/worker/index.ts:708` through `supabase/functions/worker/index.ts:710`.
- X poster dispatch repeats the same env contract at `supabase/functions/x-poster/index.ts:138` through `supabase/functions/x-poster/index.ts:140`.
- `docs/operations/xot-system-inventory.md:166` through `docs/operations/xot-system-inventory.md:172` records that `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` were not observed in Supabase Edge secret names.
- Test discovery found renderer unit tests for effects, subtitles, ffmpeg, transcription, OpenAI, Deepgram, and preflight, but no nearby HTTP auth test for `server.js`.

Risk:

- If the renderer server is reachable over HTTP without a token, mutating routes can be called without bearer auth.
- Edge functions may believe they are dispatching with a token while the renderer is actually running fail-open.
- This is a guardrail defect, not just a refactor target; fix it before broad renderer extraction.

Cleanup plan:

1. Add a renderer server auth test that proves mutating HTTP routes reject requests when no token is configured.
2. Change `authorized(req, token)` or server creation so HTTP dispatch routes fail closed unless an explicit token is configured.
3. Preserve a local-only bypass only if it is passed as an explicit test/dev option, not as the production default.
4. Update renderer README and env examples to mark `VIDEO_RENDERER_TOKEN` as required for HTTP dispatch.
5. Confirm Edge functions log or skip HTTP dispatch cleanly when URL/token is incomplete.

Validation:

```bash
npm --prefix services/video-renderer test
npm run lint:functions
npm run check:functions
npm run check:release-state
```

### SM-10: Runtime and dependency hygiene are not aligned

Evidence:

- Root `package.json:7` through `package.json:10` declares npm `10.8.2`, Node `20.x`, and npm `10.x`.
- `services/video-renderer/package.json` declares Node `20.x`.
- `services/video-renderer/Dockerfile:1` uses `node:20-bookworm-slim`.
- `docs/operations/xot-system-inventory.md:190` records Vercel runtime as Node `24.x`.
- `docs/operations/cleanup-baseline.md:40` through `docs/operations/cleanup-baseline.md:46` records root audit failures and Monitoring bundle size as pre-existing cleanup targets.
- The root lockfile currently contains vulnerable production packages from the audit set at `package-lock.json:7096`, `package-lock.json:7111`, and `package-lock.json:8641`.
- Both `bun.lock` and `bun.lockb` are tracked even though `package.json:7` declares npm as the package manager.
- `README.md:32` still describes Vite 5, while `package.json:109` declares Vite 7.
- Renderer docs and env defaults conflict on ffmpeg output settings: `services/video-renderer/README.md:43` through `services/video-renderer/README.md:44` says `veryfast`/`23`, while `services/video-renderer/.env.example:23` through `services/video-renderer/.env.example:24` says `fast`/`20`.

Risk:

- Local, CI, and Vercel behavior may diverge.
- Dependency upgrades can be mixed accidentally with refactors.

Cleanup plan:

1. Decide whether production should move to Node 20 or repo should move to Node 24.
2. Make the runtime decision in a dedicated branch.
3. Upgrade production vulnerabilities separately from dev-only vulnerabilities.
4. Re-run the full validation gate after every dependency change.

Validation:

```bash
node --version
npm --version
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
npm run build
npm test
```

### SM-11: Auth surface should be documented per function

Evidence:

- `supabase/config.toml` has `verify_jwt=false` for `webhooks-rssapp`, `worker`, `db-cleanup`, `media-processor`, `media-cleanup`, `x-poster`, `x-followers-snapshot`, and `digest-compiler`.
- `supabase/config.toml` has `verify_jwt=true` for `admin-retry` and `admin-actions`.
- `supabase/functions/_shared/internalAuth.ts:44` through `supabase/functions/_shared/internalAuth.ts:70` still supports RSS query tokens for compatibility.
- `supabase/functions/_shared/internalAuth.ts:64` through `supabase/functions/_shared/internalAuth.ts:67` defaults query-token allowance to enabled unless explicitly disabled.
- Missing edge secret names include `RSSAPP_ALLOW_QUERY_TOKEN`, `RSSAPP_SIGNING_SECRET`, `RSSAPP_WEBHOOK_TOKEN`, `VIDEO_RENDERER_URL`, `VIDEO_RENDERER_TOKEN`, and `DEEPGRAM_API_KEY` at `docs/operations/xot-system-inventory.md:166` through `docs/operations/xot-system-inventory.md:173`.

Risk:

- Custom auth is valid for cron/webhook paths, but the policy is scattered.
- Query token compatibility is operationally useful but should not become permanent.

Cleanup plan:

1. Add `docs/architecture/function-auth-matrix.md`.
2. For each function, document:
   - trigger
   - `verify_jwt`
   - accepted auth headers
   - required secrets
   - caller functions or cron jobs
   - whether browser calls are expected
3. Phase out RSS query-token auth only after RSS.app is moved to signed webhook auth or header-token fallback.

Validation:

```bash
npm run check:function-inventory
npm run check:release-state
npm run lint:functions
npm run check:functions
```

## Cleanup Sequencing

### Phase 3A: Commit this map

Scope:

- Add this document.
- Do not refactor code.
- Validate docs-only branch with cheap checks.

Commands:

```bash
git diff --check
npm run check:release-state
```

### Phase 3B: Immediate renderer auth guardrail

Scope:

- Add a focused renderer server auth test.
- Make HTTP dispatch routes fail closed when `VIDEO_RENDERER_TOKEN` is missing.
- Update renderer docs and env examples for the required token contract.
- Do not change render output, ffmpeg filters, watermark behavior, subtitle behavior, or production deployment.

Files likely touched:

- `services/video-renderer/src/server.js`
- `services/video-renderer/test/server.test.js`
- `services/video-renderer/README.md`
- `services/video-renderer/.env.example`

Validation:

```bash
npm --prefix services/video-renderer test
git diff --check
```

### Phase 3C: Contract preparation

Scope:

- Add typed admin action names and a frontend/backend consistency test.
- No action behavior changes.

Files likely touched:

- `src/api/adminActions.ts`
- `supabase/functions/admin-actions/actionNames.ts`
- `src/test/admin-actions-contract.test.ts`

Validation:

```bash
npm run check:strict
npm test
npm run lint:functions
npm run check:functions
```

### Phase 4: Test harness before refactor

Priority tests:

1. Renderer HTTP auth fail-closed behavior.
2. Admin action name coverage.
3. Monitoring action wrapper payloads.
4. Worker job lifecycle failure/retry behavior.
5. Telegram final duplicate assertion behavior.
6. Renderer config parsing.

### Phase 5: Frontend cleanup

Order:

1. Move admin action wrappers.
2. Move Monitoring view-model helpers.
3. Split confirmation/action registry.
4. Split visual components only after behavior is isolated.

### Phase 6: Supabase function cleanup

Order:

1. Add admin action registry.
2. Split settings/dashboard/monitoring read handlers.
3. Split video render admin handlers.
4. Split scoring/dedupe handlers.
5. Split X/enrichment handlers.
6. Split worker job handlers.

### Phase 7: Database trust repair

Order:

1. Document local/remote migration mismatch.
2. Decide repair strategy.
3. Regenerate Supabase types.
4. Remove temporary schema fallback code.

### Phase 8: Renderer cleanup

Order:

1. Extract config parser with tests.
2. Extract shared preview/renderer helpers.
3. Split OpenAI module by API family.
4. Keep ffmpeg command tests green after every move.

### Phase 9: Runtime/dependency cleanup

Order:

1. Align Node version.
2. Fix production dependency audit.
3. Then dev dependency audit.
4. Re-run build and browser smoke.

## Do Not Do Yet

- Do not remove Monitoring schema fallbacks before migration drift is resolved.
- Do not regenerate Supabase types until migration trust is documented.
- Do not split `worker` and change job behavior in the same commit.
- Do not split `admin-actions` without a contract test for action names.
- Do not change function `verify_jwt` flags without a caller/auth matrix.
- Do not change renderer watermark/subtitle behavior while extracting config.
- Do not expose renderer HTTP dispatch routes without an explicit token or documented private network boundary.
- Do not deploy any cleanup branch to production.

## Success Criteria For The Full Cleanup Program

- `main` and production remain connected by recorded Git SHA and release ledger.
- `npm run check:release-state` passes before and after every production release.
- Admin action names are centralized and tested.
- `Monitoring.tsx`, `admin-actions/index.ts`, and `worker/index.ts` are reduced by moving responsibilities into named modules without behavior drift.
- Supabase migration drift is either repaired or explicitly documented with a forward-only policy.
- Generated Supabase types cover current X/video/scoring tables.
- Renderer config and preview/production helpers are shared where behavior must match.
- Renderer HTTP dispatch fails closed when auth configuration is missing.
- Runtime and dependency decisions are explicit and validated.
