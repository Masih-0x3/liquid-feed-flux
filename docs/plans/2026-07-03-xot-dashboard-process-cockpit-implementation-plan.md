# XOT Dashboard Process Cockpit Implementation Plan

## Planner Metadata

- Date: 2026-07-03
- Repo: `/Users/stevmq/Finalized XOT`
- Branch observed: `main`
- Planner mode: planning-orchestrator
- Implementation status: not started
- User intent: reduce dashboard bloat, move the post process HUD into the Dashboard as the primary operator view, retire Recent Activity, and keep Monitoring as the deeper intervention workbench.
- Existing work intentionally left alone: `docs/plans/2026-07-03-xot-visual-process-trace-map-implementation-plan.md` was already untracked before this plan.

## Executive Goal

Transform the Dashboard from a collection of overlapping status cards into a compact operator cockpit:

1. Dashboard becomes the place to see the live and recent lifecycle of posts.
2. The Foglamp-style XOT process HUD is promoted to the Dashboard first viewport.
3. Recent Activity is removed from the primary dashboard because it duplicates lower-quality information.
4. Monitoring becomes the workbench for filtering, opening, and manually intervening on posts.
5. The data path stays bounded, read-only, and safe: dashboard loading must not call X, hydrate tweets, sync usage, enqueue jobs, or write ledgers.

The implementation should be able to run as one main implementation-orchestrator goal with explicit quality checkpoints and browser verification.

## Source Of Truth Contract

### Product Truth

- Dashboard is the live operating cockpit.
- Monitoring is the deep post workbench.
- The process HUD is based on XOT-native pipeline data, not on the hosted Foglamp dashboard.
- Foglamp-style visual behavior is inspiration and parity target for compact trace presentation, but the product truth is XOT's own post lifecycle: ingest, dedupe, score, translate, manual enrichment, Telegram, X gate, X post, and trace detail.

### Data Truth

Authoritative backend tables and summaries:

- `posts`
- `jobs`
- `deliveries`
- `x_deliveries`
- `workflow_runs`
- `ai_call_ledger`
- `budget_ledger`
- Supabase Edge Function `admin-actions`

Current Dashboard data:

- `src/hooks/useDashboardData.ts`
- `src/api/dashboardData.ts`
- `supabase/functions/admin-actions/dashboardSummaries.ts`

Current Monitoring and HUD data:

- `src/hooks/useMonitoringData.ts`
- `src/api/monitoringData.ts`
- `src/components/monitoring/MonitoringProcessHud.tsx`
- `src/lib/processTraceMap.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`

### Behavioral Truth

- Finished posts must not keep active/live animation running.
- Manual enrichment is a manual process and must be shown as such, not implied as an automatic always-on step.
- Dashboard HUD should distinguish active, failed, waiting/manual, skipped, and completed states.
- One-off process visibility belongs as a `traceName`/detail, but Dashboard is centered on post workflow instances.
- The monthly Foglamp hosted span cap is separate from XOT's native HUD. The native HUD should continue to work even if hosted Foglamp export is capped, disabled, or unavailable.

## Native Planning Superiority

Target score: 5.

This plan avoids a generic "move component" refactor because the current data contracts make that unsafe. `MonitoringProcessHud` is visually close to the desired experience, but it consumes `MonitoringEntry[]` with `process_observability`. Dashboard only has aggregate `processObservability`. The correct implementation requires a bounded Dashboard HUD read path rather than importing Monitoring's whole paginated workbench into Dashboard.

Planning decisions:

- Prefer a small Dashboard process HUD payload over full Monitoring query reuse.
- Keep Dashboard loads side-effect free.
- Remove obsolete Dashboard activity UI rather than restyling it.
- Keep the detailed post intervention tools in Monitoring.
- Use the existing HUD, trace map, dashboard hooks, and admin-action patterns instead of inventing a new observability model.

## Orchestration Decision

- Mode: lightweight workers.
- Worker count used in planning: 2 read-only explorers.
- Decision reason: the work spans dashboard UX, Monitoring route responsibility, frontend data hooks, Supabase admin-action read contracts, tests, and browser QA, but all within one product surface family.
- Independent planning surfaces:
  - Dashboard UX/workflow restructuring.
  - Data/API/architecture handoff for a bounded Dashboard HUD read path.
- Workers used:
  - UI/workflow explorer for Dashboard, Monitoring, HUD, and CSS ownership.
  - Data/API explorer for Dashboard summary, Monitoring entries, admin-actions, and test contracts.
- Workers skipped:
  - External research worker. The relevant visual target came from the user-provided Foglamp HUD screenshots and current XOT implementation.
- Thread decision: no separate user-visible thread; this is a parent-owned plan artifact.
- Reconsider trigger: add another worker only if implementation expands into Settings, deployment automation, or a full navigation redesign.

## Current State Findings

### Dashboard

Files:

- `src/pages/Dashboard.tsx`
- `src/components/dashboard/DashboardActivity.tsx`
- `src/components/dashboard/DashboardHealth.tsx`
- `src/api/dashboardData.ts`
- `src/hooks/useDashboardData.ts`

Observed state:

- Dashboard already contains many competing surfaces: status strip, primary alert, six triage cards, Pipeline Speed, Resource Risk, Pipeline Funnel, X Cost Guard, tabs, Recent Activity, Process Observability, X Usage, and Controls.
- Default tab is still `activity`.
- `DashboardActivity` renders `Recent Activity`, but this is lower quality than the process HUD because it flattens events and lacks the trace timeline, step state, manual enrichment state, call details, and costs.
- The Process Observability card is buried in the Pipeline tab and is aggregate-only.
- Dashboard realtime invalidation currently listens to `posts` only, which is safer but insufficient for live trace HUD updates.

### Monitoring

Files:

- `src/pages/Monitoring.tsx`
- `src/components/monitoring/MonitoringProcessHud.tsx`
- `src/hooks/useMonitoringData.ts`
- `src/api/monitoringData.ts`
- `src/lib/processTraceMap.ts`

Observed state:

- Monitoring currently owns the richer `Post process HUD`.
- Monitoring also owns filters, search, queue cards, table/mobile cards, detail drawer, row actions, bulk actions, scoring, translation, dedupe, and delivery intervention.
- This makes Monitoring do two jobs: live process awareness and manual intervention.
- The durable role for Monitoring is the workbench. The live awareness role belongs on Dashboard.

### Backend

Files:

- `supabase/functions/admin-actions/dashboardSummaries.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`

Observed state:

- Dashboard summary has aggregate observability from `workflow_runs`, `ai_call_ledger`, and `budget_ledger`.
- Monitoring read path fetches rich per-post state and attaches `process_observability`.
- The HUD cannot be moved cleanly to Dashboard using only existing Dashboard summary data.

## Future State

### Dashboard First Viewport

The first viewport should show:

1. Compact service status and last updated timestamp.
2. Primary alert if something needs action.
3. A tight triage command strip for:
   - Needs attention
   - Failed or stuck
   - Ready to deliver
   - Translation queue
   - X failed
   - Stale jobs
4. Primary `Post process HUD` showing active and recent post workflows.
5. A compact right rail or top summary for limits and risk:
   - OpenAI tokens and cost
   - Foglamp hosted export cap state
   - X cost guard
   - Ingest heartbeat
   - Storage/media risk

### Dashboard Secondary Surfaces

Keep only surfaces that improve operational decisions:

- Pipeline pressure summary.
- Resource and budget risk.
- Confirmed controls behind secondary placement.

Remove or demote:

- `Recent Activity`.
- Activity tab.
- Duplicate standalone Process Observability card once the HUD header provides the same summary.
- Excess queue/funnel cards that repeat the HUD and triage strip.

### Monitoring Future Role

Monitoring should become:

- Search and filter workbench.
- Bulk action surface.
- Post table and mobile cards.
- Per-post detail drawer.
- Manual enrichment, score, translate, dedupe, Telegram, and X interventions.
- Deep trace detail when opened from Dashboard or from a row.

The top-level HUD should be removed from Monitoring or collapsed behind a secondary "process map" toggle after Dashboard owns the primary HUD.

## Visual Direction

Use the user-provided Foglamp HUD screenshots as the compactness and clarity target:

- Dark matte shell.
- Dense trace list.
- Small colored status markers.
- Horizontal timeline with now marker.
- Clickable rows.
- Step-level waterfall detail.
- Cost, tokens, duration, and warnings visible without card sprawl.
- Native scrollbars rather than heavy custom scroll treatment.
- Animation only for active/in-flight work.
- Completed entries should become still, readable history.

XOT-specific adaptations:

- Use post author, tweet URL, and pipeline state instead of generic agent cards.
- Include manual enrichment as a manual/waiting step.
- Preserve XOT action chips: ingest, dedupe, score, translate, enrich, Telegram, X gate, X post, trace.
- Keep route-to-Monitoring behavior for full intervention.
- Do not add decorative cards around the HUD.

## Non-Goals

- Do not build fake demo traces.
- Do not write smoke endpoints just to generate traces.
- Do not depend on the hosted Foglamp dashboard for Dashboard rendering.
- Do not upgrade the AI SDK or Foglamp packages as part of this UI change.
- Do not make Dashboard loads mutate state.
- Do not call X from Dashboard load.
- Do not remove Monitoring's intervention actions.
- Do not expose secrets or hosted Foglamp API keys to the browser.
- Do not rewrite the whole navigation system.

## Proposed Data Contract

### Preferred Backend Contract

Add a separate read-only admin action:

```ts
get_dashboard_process_hud
```

Return shape:

```ts
type DashboardProcessHudPayload = {
  available: boolean;
  generated_at: string;
  window_hours: number;
  source: 'local-ledger';
  truncated: boolean;
  partial_reason?: string | null;
  error?: string | null;
  entries: ProcessHudEntry[];
};
```

Each `ProcessHudEntry` should include only what the HUD and trace map need:

```ts
type ProcessHudEntry = {
  tweet_id: string;
  tweet_url?: string | null;
  source_handle?: string | null;
  text?: string | null;
  created_at?: string | null;
  status?: string | null;
  monitoring_state?: string | null;
  translation_status?: string | null;
  enrichment_status?: 'manual' | 'not_started' | 'in_progress' | 'complete' | 'skipped' | 'failed' | null;
  telegram_status?: string | null;
  x_delivery_status?: string | null;
  latest_error?: string | null;
  process_observability?: MonitoringProcessObservability | null;
};
```

Selection order:

1. Active workflows first.
2. Failed/stuck workflows next.
3. Waiting/manual enrichment next.
4. Latest completed workflows last.

Bound:

- Default max entries: 30.
- Default window: 24 hours, with failed/stuck allowed to remain visible longer if already part of the dashboard summary contract.
- Payload must be deterministic and truncated explicitly.

### Why Not Reuse Full Monitoring Query

Reusing `get_monitoring_entries` is fastest but risky:

- It overfetches table and action data.
- It couples Dashboard to Monitoring pagination and filters.
- It may add unnecessary realtime churn.
- It makes Dashboard performance depend on workbench concerns.

The implementation may reuse helper functions from `monitoringReads.ts`, but Dashboard should expose a bounded cockpit-specific contract.

### Realtime Strategy

Add a dedicated hook:

```ts
useDashboardProcessHudData()
```

Recommended subscriptions:

- `workflow_runs`
- `ai_call_ledger`
- selected `posts` changes
- selected `jobs` changes
- selected `deliveries` changes
- selected `x_deliveries` changes

Guardrails:

- Debounce or throttle invalidations.
- Do not refetch the entire `get_dashboard_summary` on every AI call ledger insert.
- Keep `useDashboardData()` for slower summary data and `useDashboardProcessHudData()` for the faster process feed.

## Component Plan

### Process HUD Ownership

Current:

- `src/components/monitoring/MonitoringProcessHud.tsx`

Future options:

1. Move to `src/components/process/ProcessHud.tsx`.
2. Keep implementation file temporarily but export a neutral wrapper.

Preferred:

- Create `src/components/process/ProcessHud.tsx` and `src/components/process/ProcessTraceDetail.tsx`.
- Keep a compatibility wrapper only if needed for tests.

New props:

```ts
type ProcessHudProps = {
  entries: ProcessHudEntry[];
  isLoading?: boolean;
  error?: Error | null;
  emptyReason?: string | null;
  mode?: 'dashboard' | 'monitoring';
  maxEntries?: number;
  onOpenPost?: (tweetId: string) => void;
  onRetry?: () => void;
};
```

Required states:

- Loading skeleton.
- Empty but available.
- Partial/ledger unavailable.
- Error with retry.
- Active.
- Failed.
- Waiting/manual.
- Completed.

Animation behavior:

- Active rows can pulse or show moving progress.
- Waiting/manual rows can show a static wait state.
- Failed rows can show error highlight.
- Completed rows must not animate.

Scroll behavior:

- Use native scrollbar behavior.
- Avoid thick custom scrollbar rails.
- Keep detail and list independently scrollable only where needed.
- No layout shift when scrollbars appear.

### Dashboard Composition

Modify:

- `src/pages/Dashboard.tsx`

Changes:

1. Remove `activity` from `DASHBOARD_TAB_IDS`.
2. Remove `DashboardActivity` from the primary render path.
3. Place `ProcessHud` directly after the status strip, primary alert, and triage row.
4. Fold aggregate process counts into HUD header or adjacent summary rail.
5. Reposition X cost, Foglamp cap, OpenAI usage, and ingest heartbeat as a compact guardrail rail.
6. Move controls below the cockpit or into a secondary maintenance section.
7. Keep clear provenance copy that Dashboard loads do not call X.

### Monitoring Composition

Modify:

- `src/pages/Monitoring.tsx`

Changes:

1. Remove top-level `MonitoringProcessHud` from the default Monitoring layout after Dashboard owns it.
2. Preserve trace detail in drawer or row expansion.
3. Support direct route from Dashboard:

```txt
/monitoring?search=<tweet_id>
```

4. If feasible, auto-focus or open the matching post detail drawer after entries load.
5. Keep filters, table, mobile cards, bulk actions, and dialogs as Monitoring's main job.

### Dashboard Health And Controls

Modify:

- `src/components/dashboard/DashboardHealth.tsx`

Plan:

- Split into read-only `SystemSnapshot` and mutating `DashboardControls` if implementation scope allows.
- Keep dangerous/live controls confirmed and secondary.
- Do not let controls compete with the post process HUD.

## Implementation Phases

### Phase 0: Anchor And Guard

Owner: implementation orchestrator.

Tasks:

- Confirm current branch and dirty worktree.
- Read README, package scripts, and relevant files.
- Confirm no repo-local `AGENTS.md` exists, or obey it if one appears.
- Record pre-change status.
- Do not touch the existing untracked visual trace-map plan unless explicitly needed.

Deliverables:

- Implementation-orchestrator goal created for this plan.
- Initial working set declared.

Checkpoint:

- Run `checkpoint-quality-loop` as a preflight with a focus on scope and safety.

### Phase 1: Dashboard HUD Read Contract

Owner: backend/data slice.

Files:

- `supabase/functions/admin-actions/dashboardSummaries.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`
- `src/api/dashboardData.ts` or new `src/api/dashboardProcessHud.ts`
- `src/hooks/useDashboardData.ts` or new `src/hooks/useDashboardProcessHudData.ts`

Tasks:

- Add read-only `get_dashboard_process_hud`.
- Reuse monitoring read helpers where practical.
- Return bounded `ProcessHudEntry[]`.
- Include `available`, `partial_reason`, `truncated`, and `generated_at`.
- Add frontend normalizer.
- Add dedicated TanStack Query hook.
- Add debounced realtime invalidation for relevant process tables.

Acceptance:

- Dashboard can fetch process entries without fetching the full Monitoring workbench.
- Missing ledger/schema data does not crash Dashboard.
- Dashboard HUD read path has no side effects.

Checkpoint:

- Run `checkpoint-quality-loop` after data contract and normalizer tests pass.

### Phase 2: Neutral Process HUD Component

Owner: frontend component slice.

Files:

- `src/components/monitoring/MonitoringProcessHud.tsx`
- New `src/components/process/ProcessHud.tsx` if extracted.
- `src/lib/processTraceMap.ts`
- `src/index.css`

Tasks:

- Extract or adapt HUD to accept the new `ProcessHudEntry` contract.
- Add loading/error/empty/partial states.
- Ensure completed rows do not animate.
- Represent manual enrichment as manual/waiting when not complete.
- Keep compact, native-scroll, Foglamp-style visual behavior.
- Preserve reduced-motion behavior.
- Preserve or improve existing tests.

Acceptance:

- HUD renders active, failed, waiting/manual, and completed rows.
- Clicking a row shows step detail.
- Step detail includes timing, status, token/cost metadata when available.
- Native scroll appearance replaces the ugly custom scroll rail.

Checkpoint:

- Run `design-taste-frontend` or `frontend-design` review on the component before wiring it into Dashboard.

### Phase 3: Dashboard Cockpit Layout

Owner: dashboard page slice.

Files:

- `src/pages/Dashboard.tsx`
- `src/components/dashboard/DashboardActivity.tsx`
- `src/components/dashboard/DashboardHealth.tsx`
- `src/components/dashboard/*` as needed.

Tasks:

- Remove Activity as the default tab.
- Remove visible `Recent Activity`.
- Add process HUD as the main Dashboard surface.
- Consolidate or demote duplicate process/funnel/speed cards.
- Create a compact risk/limits rail.
- Keep triage cards as quick routes to Monitoring filters.
- Route HUD "Full post" or row open action to `/monitoring?search=<tweet_id>`.

Acceptance:

- Dashboard first viewport shows status, primary alert/triage, and the process HUD.
- No visible "Recent Activity" label remains.
- Controls are not in the primary scan path.
- Dashboard remains dense and calm, with no nested card sprawl around the HUD.

Checkpoint:

- Run `checkpoint-quality-loop` after Dashboard layout is wired.

### Phase 4: Monitoring Workbench Cleanup

Owner: monitoring page slice.

Files:

- `src/pages/Monitoring.tsx`
- related tests under `src/test`

Tasks:

- Remove or collapse top-level HUD from Monitoring.
- Keep queue cards, filters, table, mobile cards, detail drawer, row actions, and bulk actions.
- Implement Dashboard drill-through support.
- Ensure manual enrichment action remains available and obvious in Monitoring detail/workbench context.

Acceptance:

- Monitoring opens cleanly as a workbench.
- Dashboard drill-through focuses or opens the matching post.
- Existing manual workflows still work.

Checkpoint:

- Run `checkpoint-quality-loop` after Monitoring cleanup.

### Phase 5: Tests, Browser QA, And Docs

Owner: verification slice.

Files:

- `src/test/dashboard.test.tsx`
- `src/test/monitoring-components.test.tsx`
- `src/test/monitoring-data.test.ts`
- Supabase admin-action tests if present/applicable.
- `README.md`

Tasks:

- Update Dashboard tests to assert the HUD is present and Recent Activity is absent.
- Add/adjust process HUD tests for animation/state behavior.
- Add data normalizer tests for missing/partial payloads.
- Add backend tests for `get_dashboard_process_hud` if the admin-action test harness supports it.
- Update README descriptions for Dashboard and Monitoring.
- Run browser QA on Dashboard and Monitoring.

Acceptance:

- Test suite and build pass.
- Local browser view confirms no overflow/overlap at desktop and mobile widths.
- Dashboard does not show obsolete Recent Activity.
- Monitoring still supports interventions.

Checkpoint:

- Run `engineering-acceptance-review` after tests and browser QA.

## Task Backlog

### Backend And API

- Add `get_dashboard_process_hud` route to `admin-actions`.
- Extract shared read helper if needed from `monitoringReads.ts`.
- Add process HUD payload normalizer.
- Add partial/error payload handling.
- Add bounded ordering for active, failed, waiting/manual, latest complete.

### Frontend Data

- Add `useDashboardProcessHudData()`.
- Add separate query key from full dashboard summary.
- Add throttled realtime invalidation.
- Add retry support.
- Keep Dashboard summary hook stable.

### Frontend UI

- Extract process HUD to neutral component namespace.
- Add Dashboard mode layout.
- Use native scrollbars.
- Stop animation for completed rows.
- Include manual enrichment state.
- Preserve compact trace step detail.
- Route to Monitoring for full post action.

### Dashboard Cleanup

- Remove `DashboardActivity` import/render.
- Remove `activity` tab.
- Remove or demote duplicate process/funnel cards.
- Create compact guardrail rail.
- Keep confirmed controls below primary surface.

### Monitoring Cleanup

- Remove primary HUD from Monitoring default page.
- Preserve per-post trace detail.
- Support direct open/focus by search param.
- Keep all manual intervention actions.

### Tests And Docs

- Update Dashboard tests.
- Update Monitoring component tests.
- Add Dashboard HUD data tests.
- Add admin-action tests if harness exists.
- Update README.

## Skill Loop Plan For Implementation Orchestrator

The implementation orchestrator should treat this as one main goal:

> Implement the XOT Dashboard process cockpit redesign from `docs/plans/2026-07-03-xot-dashboard-process-cockpit-implementation-plan.md`, promoting the post process HUD to Dashboard, removing Recent Activity, keeping Monitoring as the intervention workbench, and validating locally and in browser.

Required skill sequence:

1. `implementation-orchestrator`
   - Create the main goal.
   - Declare worktree/branch/dirty-state guard.
   - Split the work into data, HUD component, Dashboard layout, Monitoring cleanup, and verification slices.
2. `checkpoint-quality-loop`
   - Preflight scope check before edits.
   - After data contract.
   - After HUD extraction/state work.
   - After Dashboard/Monitoring layout changes.
   - After verification failures are fixed.
3. `design-taste-frontend`
   - Review the Dashboard cockpit and HUD visual quality.
   - Specifically check density, scroll behavior, animation discipline, text overflow, and whether controls are visually secondary.
4. `engineering-acceptance-review`
   - Final code review posture.
   - Findings first if anything remains risky.
   - Confirm no side-effectful dashboard reads.
5. `background-browser-operator` or browser control skill if available
   - Local authenticated Dashboard and Monitoring browser QA.
   - Desktop and mobile screenshots.

Recommended checkpoint prompts:

- Preflight: "Audit this plan against current repo state; identify scope risks before edits."
- Data checkpoint: "Verify the Dashboard HUD read path is bounded, read-only, and not coupled to full Monitoring pagination."
- UI checkpoint: "Verify the HUD is compact, finished posts are not animated, manual enrichment is represented correctly, and native scrolling is used."
- Dashboard checkpoint: "Verify Recent Activity is removed and Dashboard first viewport is a cockpit, not a card collection."
- Monitoring checkpoint: "Verify Monitoring remains the intervention workbench and drill-through works."
- Final checkpoint: "Run acceptance review against tests, browser QA, and no-side-effect constraints."

## Acceptance Criteria

### Product

- Dashboard first viewport shows the live/recent post process HUD.
- Recent Activity is gone from Dashboard.
- Monitoring is clearly the workbench for search, filters, bulk actions, detail, and manual intervention.
- Manual enrichment is represented as manual/waiting when applicable.
- Completed post rows are still and readable, not animated as if still running.
- Clicking a Dashboard process row can reach the full post context in Monitoring.

### Technical

- Dashboard process HUD data is fetched through a bounded read-only contract.
- Dashboard load does not call X, hydrate tweets, sync official usage, snapshot followers, enqueue jobs, or write ledgers.
- Missing observability rows do not crash the Dashboard.
- Hosted Foglamp cap state remains visible as a guardrail, but the native HUD does not depend on hosted Foglamp availability.
- No secrets are exposed to the browser.

### Visual

- HUD is compact and close to the Foglamp visual standard shown by the user.
- Native scroll behavior is used.
- No visible horizontal overflow on 390px, 768px, or desktop widths.
- No text overlap in long handles, long URLs, model names, or error detail.
- The Dashboard no longer feels like a pile of unrelated cards.

### Operational

- Tests pass.
- Build passes.
- Browser QA passes locally.
- README reflects the new Dashboard/Monitoring split.

## Validation Plan

Run in order:

```bash
npm run lint
npm run check:strict
npm test -- src/test/dashboard.test.tsx src/test/monitoring-components.test.tsx src/test/monitoring-data.test.ts
npm test
npm run build
```

If Supabase function tests exist for admin-actions, run the focused admin-action test command already used in the repo. If no harness exists, verify by unit-level normalizer tests plus local/manual Edge Function smoke only if it does not mutate state.

Browser QA:

```bash
npm run dev
```

Routes:

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/dashboard` if routed separately
- `http://127.0.0.1:5173/monitoring`
- `http://127.0.0.1:5173/monitoring?search=<known_tweet_id>`

Widths:

- 390px mobile
- 768px tablet
- 1280px desktop
- wide desktop if already problematic

Visual checks:

- Dashboard first viewport includes process HUD.
- Recent Activity is absent.
- Completed rows are not animated.
- Active rows animate only while active.
- Native scrollbars look acceptable.
- Manual enrichment is visible as manual/waiting when not complete.
- Monitoring drill-through opens or focuses the right post.
- No overlapping text.
- No horizontal overflow.

Production readiness checks after implementation but before deploy:

- `git diff` confirms no unrelated refactors.
- No `.env` or secret files changed.
- No demo endpoints/scripts/traces added.
- Admin action is read-only.
- Vercel/build env still passes.

## Risks And Mitigations

### Risk: Dashboard HUD Overfetches

Mitigation:

- Use `get_dashboard_process_hud` with max entries and bounded window.
- Do not import the full Monitoring infinite query into Dashboard.

### Risk: Realtime Churn

Mitigation:

- Use dedicated query key.
- Debounce invalidations.
- Avoid full dashboard summary refetch on every `ai_call_ledger` insert.

### Risk: Wrong Workflow Identity

Mitigation:

- Validate `workflow_runs.tweet_id` in implementation.
- If missing, support `subject_type`/`subject_id` fallback only if current rows require it.
- Keep missing state partial, not fatal.

### Risk: Monitoring Loses Useful Context

Mitigation:

- Keep per-post trace detail in the drawer.
- Preserve all intervention actions.
- Add Dashboard drill-through.

### Risk: Visual Regression

Mitigation:

- Run design review after first browser pass.
- Test mobile and desktop.
- Make native scrollbars acceptable rather than custom thick rails.

### Risk: Existing Tests Encode Old Activity Tab

Mitigation:

- Update tests to assert the new product contract.
- Delete stale assertions rather than preserving obsolete UI.

## Implementation Orchestrator Handoff

Use this exact high-level command intent:

> Invoke `implementation-orchestrator` and implement `docs/plans/2026-07-03-xot-dashboard-process-cockpit-implementation-plan.md` end to end. Preserve existing dirty work, do not touch unrelated untracked plans, use checkpoint-quality-loop between phases, and verify with tests, build, and browser QA.

Suggested implementation order:

1. Preflight and branch/worktree status.
2. Add Dashboard process HUD data contract.
3. Add frontend hook and normalizer.
4. Extract/adapt HUD component.
5. Move HUD onto Dashboard and remove Recent Activity.
6. Clean Monitoring into workbench role.
7. Update tests.
8. Run lint, strict check, tests, build.
9. Run local browser QA.
10. Run final engineering acceptance review.

Do not mark the implementation goal complete until:

- All required validation either passes or has a precise, honest blocker.
- Browser QA has inspected Dashboard and Monitoring.
- The final response distinguishes local validation, live production validation, pushed state, deployed state, and any remaining manual steps.

## Orchestration Closeout

Planning artifacts produced:

- `docs/plans/2026-07-03-xot-dashboard-process-cockpit-implementation-plan.md`

Planning worker outputs incorporated:

- Dashboard UX/workflow findings.
- Dashboard/Monitoring data contract findings.

Memory use:

- Cognee queried `project_finalized_xot` and `tooling_local`.
- No grounded Cognee recall was found for this exact HUD contract.
- Source files and current repo state were used as source of truth.
- No memory writes were made.

Open implementation decision:

- The implementation should decide whether to physically move `MonitoringProcessHud.tsx` immediately or add a neutral wrapper first. Preferred long-term location is `src/components/process/`.

Ready for implementation:

- Yes, pending the implementation orchestrator run.
