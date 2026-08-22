# XOT Dashboard HUD Truth And Debloat Implementation Plan

Date: 2026-07-03
Repo: `/Users/stevmq/Finalized XOT`
Branch at planning time: `main`
Source audit: `docs/audit/2026-07-03-xot-dashboard-hud-bloat-ux-logic-audit.md`
Planning mode: planning-orchestrator, full worker run with three read-only lanes
Product code edited in this planning pass: no

## Executive Goal

Turn Dashboard into a compact, high-trust process cockpit and make the Post process HUD the primary way to inspect every post's pipeline state.

The implementation must fix the current truth problem first: below-threshold, duplicate-blocked, skipped, completed, pending, running, failed, and manual states must mean the same thing in the backend payload, trace mapper, HUD chips, Dashboard summary, and tests. Once the state contract is reliable, the Dashboard can be debloated safely by moving secondary diagnostics behind tabs/collapsibles and removing duplicate budget, process, and health surfaces.

## Operator Outcome

When an operator opens Dashboard, the first viewport should answer these questions without scanning redundant cards:

- What needs attention right now?
- What post is being processed now?
- Where is that post in the process?
- Did it post to Telegram or X, and how long ago?
- Did it stop because it failed, because it was below threshold, because it was duplicate-blocked, or because it needs manual enrichment?
- Are X posting, AI budget, Foglamp tracing, ingest, and storage guardrails healthy enough to keep running?

Detailed queue, funnel, usage, and controls should remain available, but they should not compete with the HUD in the main scan path.

## Current Evidence Summary

The audit findings are supported by current repo evidence:

- `supabase/functions/admin-actions/monitoringReads.ts` initializes `telegram_state` and `x_state` from raw delivery fields before below-threshold logic, so stale pending can survive terminal skip decisions.
- `src/lib/processTraceMap.ts` applies Telegram and X raw statuses before skip fallback logic, so frontend traces can repeat the same stale pending problem.
- `src/lib/processTraceMap.ts` counts `pending` as `running` in summary logic.
- `src/components/monitoring/MonitoringProcessHud.tsx` treats pending as live in status mapping, sort priority, duration behavior, and auto-selection.
- `src/components/monitoring/MonitoringProcessHud.tsx` flattens non-unknown chips into the green-ish `used` state.
- `src/lib/processTraceMap.ts` labels enrichment as manual but types it as `ai`.
- `src/components/monitoring/MonitoringProcessHud.tsx` lacks a left-list freshness slot such as `X posted 12m ago`.
- `src/pages/Dashboard.tsx` already has the HUD in the Dashboard, but six triage cards plus separate guard, speed, resource, funnel, X cost, OpenAI, X detail, and controls surfaces still create redundant page weight.
- `src/components/dashboard/DashboardMetrics.tsx` and legacy `recent_posts` data remain cleanup candidates even though visible Recent Activity has already been removed.

## Source Of Truth Contract

### Authoritative Per-Post Source

`get_dashboard_process_hud` should become the single authoritative per-post process source for Dashboard. Dashboard summary data should remain aggregate-only: totals, guardrails, health, and headline alerts.

Primary backend surface:

- `supabase/functions/admin-actions/monitoringReads.ts`
- `getDashboardProcessHud`
- `deriveMonitoringState`
- `toMonitoringEntry`
- `applyJobStateToRpc`

Primary frontend data surface:

- `src/api/dashboardProcessHud.ts`
- `src/api/monitoringData.ts`
- `src/hooks/useDashboardProcessHudData.ts`
- `src/lib/processTraceMap.ts`

### Required Entry Fields

Extend and normalize each process HUD entry with these fields, using snake_case in payloads and typed equivalents in frontend code:

- `last_post_at`: latest successful Telegram or X post timestamp, or null.
- `last_telegram_posted_at`: Telegram delivery `posted_at`, or null.
- `last_x_posted_at`: X delivery `posted_at`, or null.
- `process_terminal_reason`: stable reason such as `below_threshold`, `duplicate_blocked`, `manual_enrichment_required`, `posted`, `failed`, `skipped`, `unknown`, when available.
- `telegram_state`: terminal-aware stage state.
- `x_state`: terminal-aware stage state.
- `enrichment_state`: `manual_required`, `manual_complete`, `skipped`, `running`, `failed`, `not_required`, or equivalent normalized stage state.

Do not derive posted recency from duration. Duration is process runtime; recency is delivery freshness.

### State Dominance Rule

Terminal evidence must dominate stale active fields.

Order of authority:

1. Actual success or failure evidence: Telegram posted, X posted, explicit delivery failed, explicit X failed.
2. Terminal skip evidence: below threshold, duplicate blocked, unsupported media, manually skipped, not eligible.
3. Explicit manual gate: enrichment required or manual approval waiting.
4. Active job tied to a valid non-terminal run.
5. Raw pending/default fields.
6. Unknown.

Concrete rule: a below-threshold post with stale `delivery_status: pending` and `x_status: pending` must render Telegram and X as skipped/not needed, not pending.

### Pending Is Not Running

`pending` means waiting, queued, gated, or not started. It must not:

- Animate like running.
- Count as running.
- Auto-sort above actually running work.
- Use the same color as running or done.
- Drive live-follow selection as if a process is executing.

Only `running` and equivalent active execution states should animate.

### Manual Is Not AI

Enrichment is manual-only in this app. The trace model must not render manual enrichment as an AI step unless the backend explicitly records a real AI enrichment call.

Add a `manual` or `approval` node kind, or otherwise render enrichment with manual/waiting semantics. It should be clear when a human action is required and when the process intentionally stops there.

## Native Planning Superiority

This plan uses Foglamp's compact HUD style as the interaction reference, but the XOT implementation should stay native:

- Foglamp SaaS is for AI trace ingestion and hosted trace viewing.
- XOT Dashboard is for XOT process operations.
- XOT process state includes post eligibility, score threshold, dedupe, translation, manual enrichment, Telegram, X gate, X post, and local budget controls.
- The Dashboard must not depend on querying Foglamp for post process truth.

The implementation should borrow the compact trace-list/detail interaction pattern, not the Foglamp data model.

## Orchestration Decision

Mode: full worker run.

Worker lanes used during planning:

- Backend/process truth: Supabase admin-action payload, terminal state dominance, timestamp propagation.
- Dashboard product hierarchy: first viewport, duplicate surfaces, Dashboard vs Monitoring responsibility.
- HUD UI/accessibility: status semantics, shadcn/Radix opportunities, focus/keyboard behavior, chip visual language.

Implementation should use one primary implementation-orchestrator run with checkpoint gates. Do not split into unmanaged parallel coding unless write scopes are separated cleanly.

Recommended implementation skill sequence:

1. `implementation-orchestrator`: own the full implementation.
2. `checkpoint-quality-loop`: run after each phase below, not only at the end.
3. `frontend-design` or `design-taste-frontend`: review the Dashboard/HUD visual hierarchy before final browser QA.
4. `engineering-acceptance-review`: final read-only review before deploy or production push.

## Background Browser Lane

Planning does not need a live browser lane. Implementation does.

Browser QA targets:

- Local Dashboard route.
- Local Monitoring route with a `search` param.
- Desktop width.
- Tablet width around 768px.
- Mobile width around 390px.
- Reduced-motion mode if browser tooling supports it.

Do not trigger real X posting, Telegram posting, or synthetic first traces. Use existing data and read-only views.

## Research And Component Guidance

Context7 shadcn/ui docs were checked for current component guidance. Use existing repo primitives before adding anything new.

Recommended shadcn/Radix mapping:

- `Badge` or a small `StatusBadge` wrapper for semantic statuses.
- `Tooltip` or `HoverCard` for compact detail on guardrail chips.
- `Collapsible` or `Accordion` for secondary diagnostic sections and trace row expansion if it reduces custom state code.
- `Tabs` for Pipeline, X, and Controls secondary areas.
- `Table` for queue/detail diagnostics.
- `Progress` for usage and budget bars.
- `Separator` for dense HUD detail sections.
- `Button` for icon controls and action chips.

Avoid introducing a new visual library. Keep the operational tool dense, matte, compact, and keyboard accessible.

## Desired Future Layout

### Dashboard First Viewport

1. Header:
   - Page title.
   - Refresh control.
   - Online/offline status.
   - Last updated timestamp.

2. Primary alert:
   - One compact alert only when action is needed.
   - No duplicate status ribbon if header already carries online/updated.

3. Triage command chips:
   - Needs attention.
   - Failed/stuck.
   - Ready to deliver.
   - Translation queue.
   - X failed.
   - Stale jobs.
   - Use compact badges/buttons, not full cards.

4. Post process HUD:
   - Dominant first-viewport component.
   - Left list with state, actor/source, post freshness, tokens, duration, warnings.
   - Right/detail area with step waterfall and compact metadata.
   - Finished posts stop animating.
   - New or active post stays prominent; completed posts move into the list.

5. Guardrail strip:
   - X budget status.
   - AI token/cost aggregate.
   - Foglamp cap/local trace status.
   - Ingest/backlog status.
   - Storage/resource risk.

### Secondary Diagnostics

Move these below the first viewport or behind tabs/collapsibles:

- Queue breakdown.
- Pipeline funnel.
- Detailed OpenAI usage.
- Detailed X usage.
- Resource risk detail.
- Controls and settings shortcuts.

### Monitoring Route

Monitoring remains the workbench:

- Search/filter/table/detail.
- Manual intervention actions.
- Score/translation/dedupe/Telegram/X/hydrate/enrichment actions.
- Deep per-post debugging.

Dashboard may link to `/monitoring?search=<tweet_id>`, but should remain read-only.

## Phase Plan

### Phase 0: Implementation Guardrails

Objective: protect the current branch and lock scope before editing.

Tasks:

- Confirm branch and dirty state with `git status --short --branch`.
- Preserve untracked audit artifacts.
- Confirm no repo-local `AGENTS.md` changes the instruction set.
- Confirm npm package manager from `package.json`.
- Do not add dependencies unless absolutely necessary.
- Do not add smoke endpoints, demo scripts, synthetic trace producers, or real posting tests.

Acceptance:

- The implementation starts with a known dirty-worktree inventory.
- The implementer knows the audit and this plan are local planning artifacts.
- No unrelated files are edited.

Checkpoint quality loop:

- Verify the planned write set before editing.
- Confirm no production credentials or generated env files are touched.

### Phase 1: Backend Terminal Truth And Freshness

Objective: make the admin-action payload terminal-aware so frontend rendering does not need to guess.

Primary files:

- `supabase/functions/admin-actions/monitoringReads.ts`
- `supabase/functions/admin-actions/monitoringReads.test.ts`
- `src/api/monitoringData.ts`
- `src/api/dashboardProcessHud.ts`
- `src/test/dashboard-data.test.ts`

Tasks:

- Update `deriveMonitoringState` so below-threshold and duplicate-blocked states rewrite downstream Telegram/X state to skipped/not-needed unless success/failure evidence exists.
- Update `applyJobStateToRpc` so active jobs cannot demote terminal posted/skipped/failure evidence to pending.
- Add a helper such as `normalizeStageStateFromTerminalReason` if that keeps dominance rules explicit.
- Add `last_post_at`, `last_telegram_posted_at`, and `last_x_posted_at` to `toMonitoringEntry`.
- Carry those timestamp fields through frontend API normalization.
- Ensure partial/degraded payload paths safely default those fields to null.

Tests:

- Below-threshold post plus stale pending Telegram/X returns skipped/not-needed downstream.
- Duplicate-blocked post plus stale pending Telegram/X returns skipped/not-needed downstream.
- Posted Telegram or posted X is not overwritten by stale active delivery jobs.
- Explicit delivery failure remains failed and is not hidden by skip fallback.
- Timestamp fields propagate through admin-action payload and frontend normalizer.
- Malformed payload still degrades safely.

Acceptance:

- Backend payload can represent why downstream stages will not run.
- HUD can display post freshness without inferring it from duration.
- No row can show Telegram/X pending solely because stale raw delivery fields survived a terminal skip.

Checkpoint quality loop:

- Run focused Deno tests for admin actions.
- Run focused frontend data normalizer tests.
- Review one sample payload shape manually.

### Phase 2: Trace Mapper Semantics

Objective: align frontend process maps with the backend truth contract.

Primary files:

- `src/lib/processTraceMap.ts`
- `src/test/monitoring-components.test.tsx`
- Any trace-map focused tests if they exist or are added.

Tasks:

- Apply terminal dominance before raw Telegram/X pending statuses.
- Split `pending` from `running` in `ProcessTraceSummary`.
- Add a pending count if summary copy needs it.
- Update `toneForStatus` so pending, running, completed, skipped, blocked, and failed have distinct tones.
- Update `edgeToneFromNode` so pending does not share running/done visuals.
- Add a `manual` or `approval` `ProcessTraceNodeKind`.
- Change canonical enrichment node from AI to manual/approval.
- Ensure skipped downstream nodes still show useful detail: below threshold score, duplicate reason, manual-required reason, or configured gate.

Tests:

- Below-threshold trace renders Telegram/X as skipped.
- Duplicate-blocked trace renders Telegram/X as skipped.
- Manual enrichment renders manual/approval, not AI.
- Pending is counted separately from running.
- Completed traces do not contain running edges.

Acceptance:

- The HUD receives semantically correct nodes.
- Pending is visually and logically waiting, not running.
- Manual enrichment is represented honestly.

Checkpoint quality loop:

- Run trace/HUD focused Vitest tests.
- Review status snapshots for all terminal and non-terminal states.

### Phase 3: Shared Status System

Objective: remove fragmented color/status logic from Dashboard and HUD.

Primary files:

- `src/components/ui/badge.tsx`
- New or existing shared status helper, for example `src/lib/processStatus.ts` or `src/components/process/statusTone.ts`
- `src/pages/Dashboard.tsx`
- `src/components/monitoring/MonitoringProcessHud.tsx`
- `src/index.css`

Tasks:

- Add semantic badge variants or a `StatusBadge` wrapper:
  - `success`
  - `warning`
  - `danger`
  - `info`
  - `neutral`
  - `muted`
  - optional `running`
  - optional `pending`
- Centralize mapping from process state to tone.
- Replace local Dashboard severity classes where practical.
- Replace HUD `.used` chip logic with per-status tone classes.
- Ensure pending is not purple/indigo if that tone also means done.
- Ensure done/completed is visually stable and non-animated.
- Document status meanings in code with a short comment near the mapping.

Status palette contract:

- Running: active accent, animated only while active.
- Pending/waiting: neutral or amber waiting tone, no run animation.
- Completed/posted: success tone.
- Skipped/not needed: muted neutral tone.
- Manual required: warning tone.
- Failed/error: danger tone.
- Blocked/stuck: danger or warning depending severity.
- Unknown: muted.

Tests:

- Chip rendering uses state-specific classes/variants.
- Pending and completed do not share the same variant.
- Failed rows still expose danger semantics.

Acceptance:

- Operators can read state by color and label consistently across Dashboard, HUD, and Monitoring.
- The UI no longer says every non-unknown step was simply `used`.

Checkpoint quality loop:

- Inspect CSS for one-off raw state colors.
- Confirm no color-only state without text/aria label.

### Phase 4: HUD Component Quality And Accessibility

Objective: make the HUD compact like the reference while keeping it native, accessible, and easier to maintain.

Primary files:

- `src/components/monitoring/MonitoringProcessHud.tsx`
- Optional wrapper or move target: `src/components/process/PostProcessHud.tsx`
- `src/index.css`
- `src/components/ui/*` wrappers as needed.
- `src/test/monitoring-components.test.tsx`

Tasks:

- Add `lastPostAt`, `lastTelegramPostedAt`, and `lastXPostedAt` to `HudTrace`.
- Render left-list recency:
  - `X posted 12m ago`
  - `Telegram posted 18m ago`
  - `not posted`
  - `waiting on manual enrichment`
  - `below threshold`
- Keep duration as runtime, not freshness.
- Change `isLive` so only running/active execution states count as live.
- Keep `isAnimatingStatus` restricted to running.
- Adjust trace sorting so running rows surface first, then attention/failure/manual, then recent completed/skipped rows.
- Add visible `focus-visible` styles for:
  - timeline segments
  - trace list rows
  - detail waterfall rows
  - follow/back/retry/export buttons
- Add `aria-current` or `aria-pressed` for selected trace rows.
- Expand button labels with post title/source, status, duration, warning count, and token count where useful.
- Consider wrapping detail rows in `Collapsible` or `Accordion` only if it reduces manual aria/state code.
- Keep native scrollbars or subtle OS-default scrollbars; do not force chunky custom scrollbars.
- Respect reduced motion for all pulse/run animation.

Ownership cleanup:

- Prefer a neutral component name for Dashboard ownership, such as `PostProcessHud`.
- If a full move creates too much churn, create a wrapper under `src/components/process/` and leave the existing component path as an implementation detail for now.

Tests:

- Finished posts do not animate.
- Pending posts do not animate.
- Running posts animate unless reduced motion is active.
- Left row recency renders from post timestamps.
- Manual enrichment renders manual/waiting semantics.
- Selected list row has accessible selected/current state.
- Detail rows can be opened with keyboard.

Acceptance:

- HUD is the primary compact trace surface.
- A row gives enough state to understand what happened without opening it.
- Clicking or keyboard-opening a step gives the same detail as before, with cleaner state semantics.
- The scroll experience looks native and does not visually dominate the HUD.

Checkpoint quality loop:

- Run focused component tests.
- Use browser QA to inspect active, completed, skipped, failed, and manual-required rows.
- Verify no text overflow at mobile width.

### Phase 5: Dashboard Debloat And Hierarchy

Objective: remove repeated surfaces and make Dashboard read as one coherent operating cockpit.

Primary files:

- `src/pages/Dashboard.tsx`
- `src/components/dashboard/DashboardHealth.tsx`
- `src/components/dashboard/DashboardMetrics.tsx`
- `src/api/dashboardData.ts`
- `src/test/dashboard.test.tsx`

Tasks:

- Move the HUD immediately after the primary alert.
- Convert six triage cards into a compact command/status chip row.
- Remove the duplicate online/updated strip if the header already contains it.
- Keep one first-viewport X budget readout.
- Keep one secondary X details surface in the X tab.
- Keep one first-viewport OpenAI aggregate.
- Keep one secondary OpenAI details surface in a diagnostics tab.
- Move Pipeline Funnel into the Pipeline tab or a collapsed diagnostics section.
- Move Resource Risk detail below the first viewport or into a collapsible diagnostics area.
- Keep controls in the Controls tab.
- Remove or retire `DashboardMetrics.tsx` if confirmed unused.
- Remove obsolete `recent_posts` from Dashboard-facing contracts only after confirming no other route still depends on it.

Recommended first-viewport structure:

```text
Dashboard header
Primary alert, conditional
Triage chips
PostProcessHud
GuardrailRail
SecondaryDiagnostics tabs/collapsibles
```

Deduplication rules:

- X budget appears once in main cockpit, with detail in X tab only.
- OpenAI usage appears once in main cockpit, with detail in Pipeline/OpenAI diagnostics only.
- Pipeline funnel appears only in diagnostics, not as a main card.
- Online/updated appears in header only.
- Recent Activity stays absent.

Tests:

- HUD appears before diagnostics.
- Recent Activity remains absent.
- Duplicate X budget headings are not present in the main flow.
- Duplicate OpenAI usage headings are not present in the main flow.
- Pipeline Funnel is not in the first-viewport main flow.
- Dashboard still links to Monitoring with search params.

Acceptance:

- Dashboard is calmer and denser.
- Main information hierarchy is clear in one scan.
- Operators can still reach all diagnostics, but secondary details no longer crowd the primary process view.

Checkpoint quality loop:

- Run Dashboard tests.
- Inspect DOM headings for duplicate concepts.
- Browser-check first viewport at desktop and mobile widths.

### Phase 6: Route Responsibility Cleanup

Objective: keep Dashboard read-only and Monitoring intervention-oriented.

Primary files:

- `src/pages/Dashboard.tsx`
- `src/pages/Monitoring.tsx`
- `src/test/dashboard.test.tsx`
- Monitoring tests if present.

Tasks:

- Keep Dashboard row action as navigation to `/monitoring?search=<tweet_id>` or equivalent.
- Keep manual score, translation, dedupe, Telegram, X, hydrate, and enrichment actions in Monitoring.
- Preserve Monitoring search auto-open behavior.
- Add or keep tests proving Dashboard can route to Monitoring detail but does not mutate post process state.

Acceptance:

- Dashboard answers "what is happening?"
- Monitoring answers "what can I inspect or manually fix?"

Checkpoint quality loop:

- Confirm no mutation hooks/actions are imported into Dashboard during debloat.

### Phase 7: Final Verification And Release Readiness

Objective: prove the implementation is ready before any production push.

Commands:

```bash
npx --yes deno test --allow-env --allow-read supabase/functions/admin-actions/monitoringReads.test.ts
npm test -- --run src/test/monitoring-components.test.tsx src/test/dashboard.test.tsx src/test/dashboard-data.test.ts
npm run lint
npm run check:strict
npm test
npm run build
```

Browser QA:

- Start local Vite using the repo's normal local command.
- Open Dashboard.
- Open Monitoring with a representative search param.
- Verify desktop, tablet, and mobile widths.
- Verify:
  - No text overlap.
  - No sticky line/scroll artifact.
  - Native-looking scrollbars.
  - Only running rows animate.
  - Finished rows are still.
  - Pending is not purple/done-coded.
  - Below-threshold rows do not show Telegram/X pending.
  - Manual enrichment is visibly manual.
  - Left list shows post recency where data exists.
  - Keyboard focus is visible.
  - Opening a step shows detail without layout jump.

Production readiness:

- If backend admin-action code changed, deploy Supabase functions using the repo's existing deploy path.
- If frontend changed, deploy through the existing Vercel path.
- Run production read-only smoke only:
  - Load Dashboard.
  - Load Monitoring.
  - Inspect an existing post.
  - Do not force X posting.
  - Do not create demo traces.

Acceptance:

- All focused and full checks pass, or any remaining blocker is explicitly documented.
- Local browser QA confirms the Dashboard/HUD quality target.
- Production push is safe to perform as a separate explicit step if requested.

## Issue Coverage Matrix

| Audit Issue | Plan Coverage | Acceptance |
| --- | --- | --- |
| P1 below-threshold/skipped posts can show Telegram/X pending | Phases 1 and 2 | Terminal skip dominates stale pending in backend and trace mapper |
| HUD present but not primary enough | Phase 5 | HUD sits directly after alert and before diagnostics |
| X budget repeated | Phase 5 | One main X readout, one X detail surface |
| OpenAI observability repeated | Phase 5 | One main AI aggregate, one detail surface |
| Competing process recency contracts | Phases 1, 4, 5 | Dashboard HUD is per-post truth, summary stays aggregate-only |
| Chips flatten states into `used` | Phase 3 | Per-status chip variants/classes |
| Pending shares live/running/done semantics | Phases 2, 3, 4 | Pending is non-animated waiting state |
| Left HUD list lacks last-post recency | Phases 1 and 4 | Rows show X/Telegram/not-posted freshness |
| Status colors fragmented | Phase 3 | Shared process status tone helper |
| HUD controls lack focus/accessibility | Phase 4 | Keyboard focus and selected states are visible/announced |
| Manual enrichment rendered as AI | Phases 2 and 4 | Manual/approval kind and visual treatment |
| Pipeline Funnel and queue diagnostics too high | Phase 5 | Moved to diagnostics/tabs/collapsibles |
| Header/status metadata duplicated | Phase 5 | Header owns online/updated |
| Obsolete `DashboardMetrics` / `recent_posts` | Phase 5 | Remove only after dependency check |

## Data Contract Details

### Stage State Names

Use a small normalized set internally:

- `running`
- `pending`
- `completed`
- `posted`
- `failed`
- `skipped`
- `blocked`
- `manual_required`
- `not_required`
- `unknown`

If existing API names differ, map them at the boundary and keep display logic on the normalized set.

### Freshness Display Rules

For a row:

- If `last_x_posted_at` exists, prefer `X posted <relative time>`.
- Else if `last_telegram_posted_at` exists, show `Telegram posted <relative time>`.
- Else if terminal reason is below threshold, show `below threshold`.
- Else if terminal reason is duplicate blocked, show `duplicate blocked`.
- Else if enrichment is manual required, show `manual enrichment`.
- Else if running, show `running now`.
- Else if pending, show `waiting`.
- Else show `not posted`.

For detail:

- Show exact timestamp in tooltip/detail.
- Keep duration visible separately.

### Attention Ranking

Suggested sort order:

1. Running now.
2. Failed/stuck/manual-required.
3. Pending but eligible.
4. Recently completed/posted.
5. Recently skipped.
6. Older completed/skipped.

Do not put stale pending above active running work.

## Test Backlog

Backend Deno:

- Below threshold terminal dominance.
- Duplicate blocked terminal dominance.
- Posted Telegram not demoted by active delivery job.
- Posted X not demoted by active X job.
- Explicit failure survives terminal fallback.
- Freshness timestamps emitted.
- Dashboard HUD bounded payload still returns stable shape.

Frontend data:

- `fetchDashboardProcessHud` preserves freshness fields.
- Unavailable admin action returns fallback payload safely.
- Partial payload does not crash HUD.

Trace map:

- Pending not counted as running.
- Manual enrichment node kind.
- Below-threshold downstream skipped.
- Duplicate-blocked downstream skipped.
- Skipped edge tone not running tone.

HUD component:

- Completed row has no live animation class.
- Pending row has no live animation class.
- Running row has active animation class.
- Reduced-motion disables animation.
- Left row recency text renders.
- Status chips use state-specific class/variant.
- Selected row exposes `aria-current` or `aria-pressed`.
- Detail disclosure works by keyboard.

Dashboard:

- HUD before diagnostics.
- Recent Activity remains absent.
- Triage rendered as compact chips.
- X main readout is not duplicated in first viewport.
- OpenAI main readout is not duplicated in first viewport.
- Pipeline Funnel moved below/inside diagnostics.
- Header owns online/updated.

## Validation Checklist

Before calling implementation complete:

- [ ] Backend terminal-state tests pass.
- [ ] Frontend data normalization tests pass.
- [ ] HUD component tests pass.
- [ ] Dashboard tests pass.
- [ ] `npm run lint` passes.
- [ ] `npm run check:strict` passes.
- [ ] `npm test` passes or failures are unrelated and documented.
- [ ] `npm run build` passes.
- [ ] Browser QA screenshots reviewed on desktop/tablet/mobile.
- [ ] No real X/Telegram posting was triggered.
- [ ] No synthetic trace endpoints/scripts were added.
- [ ] Dirty worktree contains only intended implementation files and existing local artifacts.

## Risks And Mitigations

### Risk: Legitimate Retry Looks Like Stale Pending

Mitigation:

- Active job should win only when it is tied to an explicit valid retry/run and no stronger terminal skip/post/failure evidence exists.
- Tests must cover terminal posted and terminal skipped with stale active jobs.

### Risk: Payload Changes Break Monitoring

Mitigation:

- Add optional fields first.
- Keep backward-compatible defaults.
- Test partial payload paths.
- Avoid removing legacy fields until dependency search proves they are unused.

### Risk: Dashboard Debloat Removes Useful Detail

Mitigation:

- Move detail behind tabs/collapsibles before deleting it.
- Delete only surfaces that are true duplicates or unused.
- Keep Monitoring as the deep workbench.

### Risk: Visual Polish Hides State

Mitigation:

- Every color state must have text, icon, aria label, or tooltip.
- Keyboard focus must be visible.
- Keep compactness without requiring hover-only discovery.

### Risk: Component Rename Causes Churn

Mitigation:

- Prefer adding a `PostProcessHud` wrapper first.
- Move implementation files only if imports/tests remain simple.

## Implementation Handoff

The implementation orchestrator should execute in this order:

1. Establish branch/dirty state and confirm write set.
2. Implement Phase 1 backend/data truth.
3. Run checkpoint-quality-loop for Phase 1.
4. Implement Phase 2 trace mapper semantics.
5. Run checkpoint-quality-loop for Phase 2.
6. Implement Phase 3 shared status tones.
7. Implement Phase 4 HUD quality/accessibility.
8. Run checkpoint-quality-loop for Phases 3 and 4.
9. Implement Phase 5 Dashboard debloat.
10. Implement Phase 6 route responsibility cleanup.
11. Run checkpoint-quality-loop for Dashboard/route changes.
12. Run full verification.
13. Perform frontend design review and browser QA.
14. Produce release-readiness summary with exact commands, results, and any blocked checks.

Stop conditions:

- If backend terminal-state behavior cannot be proven with tests, stop before visual debloat.
- If fresh timestamp source cannot be verified, add nullable fields and render `not posted`/terminal reason rather than guessing.
- If browser QA shows overlap or unreadable mobile layout, do not push to production.

## Closeout Criteria

The work is ready to push only when:

- The HUD accurately shows every post process without stale pending lies.
- Finished posts no longer animate.
- Pending is not visually or logically done/running.
- Manual enrichment is shown as manual.
- Dashboard first viewport is HUD-led and compact.
- Duplicate X/OpenAI/process panels are removed or moved to secondary diagnostics.
- Tests and build pass.
- Browser QA confirms desktop and mobile readability.

Cognee memory receipt: queried `project_finalized_xot` and `tooling_local`; no grounded HUD-specific facts were returned, so this plan uses the audit report and repo files as source of truth. Memory writes: none.
