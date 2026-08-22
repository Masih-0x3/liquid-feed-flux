# XOT Dashboard and Post Process HUD Bloat, UX, and Logic Audit

Date: 2026-07-03
Repo: `/Users/stevmq/Finalized XOT`
Branch observed: `main`
Audit mode: `audit-orchestrator`
Report status: read-only audit, no product code edited

## Executive Verdict

The Dashboard cockpit direction is correct: the Post process HUD belongs on the Dashboard and the old visible `Recent Activity` surface is gone.

The current implementation still feels bloated because the HUD is surrounded by aggregate dashboard cards that repeat the same operational concepts under different labels. The HUD also has real state-semantics problems: a terminal skipped/below-threshold post can still display downstream Telegram or X as pending, pending is visually too close to active/done semantics, and the left run list does not expose the recency operators need.

The main implementation goal should be:

> Make Dashboard a compact process cockpit, with the HUD as the authoritative per-post process surface, and move secondary diagnostics behind tabs/collapsibles.

## Audit Scope

User concerns explicitly targeted:

- Dashboard has bloat and redundant tiles that should be merged.
- Shadcn/Radix components could improve readability and reduce custom UI.
- HUD tags and information are inconsistent.
- If a post does not pass threshold, downstream Telegram should not show pending.
- Pending should not be purple or visually close to done.
- The HUD left list should show key operational information such as last post recency.
- Manual enrichment is manual and should be represented accurately.

Primary files reviewed:

- `src/pages/Dashboard.tsx`
- `src/components/monitoring/MonitoringProcessHud.tsx`
- `src/lib/processTraceMap.ts`
- `src/api/dashboardProcessHud.ts`
- `src/hooks/useDashboardProcessHudData.ts`
- `src/api/dashboardData.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`
- `supabase/functions/admin-actions/dashboardSummaries.ts`
- `src/index.css`
- `src/components/dashboard/DashboardHealth.tsx`
- `src/components/dashboard/DashboardMetrics.tsx`
- `src/test/dashboard.test.tsx`
- `src/test/monitoring-components.test.tsx`
- `src/test/dashboard-data.test.ts`
- `supabase/functions/admin-actions/monitoringReads.test.ts`

Validation run during audit:

- `npm test -- --run src/test/dashboard.test.tsx src/test/monitoring-components.test.tsx src/test/dashboard-data.test.ts`
  - Result: 3 files passed, 30 tests passed.
- `npx --yes deno test --allow-env --allow-read supabase/functions/admin-actions/monitoringReads.test.ts`
  - Result: 9 tests passed.

Important evidence boundary: these checks prove the current regression tests pass. They do not cover several UX and state-semantics failures listed below.

## Orchestration Record

Audit workers used:

- Dashboard hierarchy worker: reviewed bloat, redundant tiles, route responsibility, and whether the HUD is primary enough.
- HUD logic worker: reviewed status derivation, threshold skip behavior, pending/running semantics, manual enrichment, and left-list data.
- Frontend quality worker: reviewed visual hierarchy, shadcn/Radix opportunities, accessibility, focus states, and color semantics.

Parent verification:

- Re-read the cited source sections directly.
- Re-ran focused baseline tests.
- Used current shadcn/ui docs through Context7 to validate that existing local components such as `Badge`, `Tabs`, `Collapsible`, `Accordion`, `ScrollArea`, `Tooltip`, `Table`, and `Progress` are appropriate remediation primitives.

## Priority Findings

### P1 - Below-threshold/skipped posts can still show Telegram or X as pending

Evidence:

- `deriveMonitoringState` initializes `telegram_state` from raw delivery status at `supabase/functions/admin-actions/monitoringReads.ts:486`.
- The below-threshold branch sets `code: "below_threshold"` but does not clear downstream Telegram/X state at `supabase/functions/admin-actions/monitoringReads.ts:608`.
- `applyJobStateToRpc` can overlay an active deliver job into `delivery_status = "pending"` at `supabase/functions/admin-actions/monitoringReads.ts:1043`.
- The frontend trace builder prefers raw Telegram status before the skip fallback at `src/lib/processTraceMap.ts:482`.
- The frontend trace builder prefers raw X status before the skip fallback at `src/lib/processTraceMap.ts:527`.

Impact:

A post that failed threshold or was manually skipped can look like it is waiting for Telegram or X. That creates false operational work and makes the HUD untrustworthy.

Remediation:

- Make terminal skip decisions dominant before downstream delivery state is rendered.
- For `below_threshold`, duplicate-blocked, and manual skip states, force Telegram, X gate, and X post nodes to `skipped` unless there is stronger terminal evidence: actual delivered, posted, or failed.
- Add a test for a below-threshold post with stale `delivery_status: "pending"` and `x_status: "pending"` that asserts Telegram, X gate, and X post render as skipped.

Acceptance criteria:

- A below-threshold post never shows Telegram pending.
- A skipped post never shows X pending unless an actual X operation is running for a valid deliver decision.
- The HUD detail and chip row agree on skipped downstream states.

### P2 - The HUD is present but not yet primary enough

Evidence:

- Six triage tiles render before the HUD at `src/pages/Dashboard.tsx:569`.
- The HUD starts later at `src/pages/Dashboard.tsx:587`.
- Those triage tiles are defined at `src/pages/Dashboard.tsx:335`.
- The HUD already has prioritization for live, failed, and blocked traces at `src/components/monitoring/MonitoringProcessHud.tsx:119`.

Impact:

The first scan still starts as a count board instead of a process cockpit. The user has to read summary tiles before seeing the real post lifecycle.

Remediation:

- Keep the title/header and primary alert.
- Move the HUD immediately after the primary alert.
- Collapse the six triage cards into compact action chips in or near the HUD header, or keep only the two to three counts that route to Monitoring and are not obvious from HUD state.

Acceptance criteria:

- Above the fold, Dashboard reads as: header/status, primary alert, Post process HUD, compact guardrails.
- Triage counts are available but do not dominate the first viewport.

### P2 - X budget and X usage repeat across too many surfaces

Evidence:

- `X budget` appears in `Limits & Trace Guard` at `src/pages/Dashboard.tsx:621`.
- `X Cost Guard` renders separately at `src/pages/Dashboard.tsx:811`.
- `X Usage Details` renders in the X tab at `src/pages/Dashboard.tsx:943`.
- `DashboardHealth` repeats `X Budget` in Controls at `src/components/dashboard/DashboardHealth.tsx:129`.

Impact:

Operators see the same concept in multiple places and cannot tell which panel is authoritative.

Remediation:

- Keep one compact X budget indicator in the main guardrail strip.
- Move detailed posts/attempts/media/hydration counters to a single `X usage` tab or Settings, not both.
- Do not show X budget again in `DashboardHealth` unless Controls becomes the only place for operational controls.

Acceptance criteria:

- One primary X budget readout in the first viewport.
- One detailed X usage breakdown in a secondary location.

### P2 - OpenAI/AI observability repeats across the HUD rail and tabbed diagnostics

Evidence:

- `Limits & Trace Guard` shows OpenAI 24h and AI calls at `src/pages/Dashboard.tsx:609`.
- `OpenAI Usage` renders separately in the Pipeline tab at `src/pages/Dashboard.tsx:907`.
- The HUD detail footer already shows tokens and AI calls at `src/components/monitoring/MonitoringProcessHud.tsx:491`.

Impact:

The same cost/AI-call theme appears in three different places with different granularity.

Remediation:

- Let HUD detail own per-post tokens and AI calls.
- Let the main guardrail own one compact aggregate token/cost summary.
- Move detailed OpenAI usage to a collapsible or a secondary diagnostics tab.

Acceptance criteria:

- Per-post cost is only in HUD detail.
- Aggregate cost is one compact dashboard guardrail.
- Detailed token breakdown is secondary.

### P2 - Process recency has two competing data contracts

Evidence:

- Dashboard summary includes `latestRun` and `recentRuns` in `src/api/dashboardData.ts:130`.
- Those runs are normalized at `src/api/dashboardData.ts:626`.
- They are loaded from `loadProcessObservabilitySummary` at `supabase/functions/admin-actions/dashboardSummaries.ts:371`.
- The HUD fetches its own bounded process payload through `src/api/dashboardProcessHud.ts:55`.
- Dashboard still renders summary `latestProcessRun` inside `Limits & Trace Guard` at `src/pages/Dashboard.tsx:650`.

Impact:

The latest workflow card can disagree with the HUD selected/latest post because the two surfaces come from different admin actions and different normalization paths.

Remediation:

- Make `get_dashboard_process_hud` authoritative for recent/latest post process state.
- Keep dashboard summary process observability only for aggregate guardrails: active runs, failed AI calls, tokens, and Foglamp cap.
- Remove the separate latest workflow mini-card from `Limits & Trace Guard` or derive it from the same HUD entry selected in the panel.

Acceptance criteria:

- The Dashboard has one source for "latest post process."
- Aggregate observability cannot contradict the HUD's selected process.

### P2 - HUD chips flatten pending, blocked, skipped, and completed into the same visual class

Evidence:

- Chip rendering applies `used` to every non-unknown node and `err` only for failures at `src/components/monitoring/MonitoringProcessHud.tsx:473`.
- CSS makes all `.xot-hud-chip.used` green at `src/index.css:388`.

Impact:

The chip row is not semantically useful. A pending, blocked, skipped, and completed stage can all look equally "used" or successful.

Remediation:

- Add status-specific chip classes or use a shared `StatusBadge`:
  - completed: success/green
  - running: active/blue
  - pending: neutral/waiting gray
  - blocked: warning/orange
  - skipped: muted
  - failed: destructive/red
- Add compact status text or a tooltip/title using `node.statusLabel`.

Acceptance criteria:

- A chip's color and label explain the stage state without opening detail.
- Skipped and pending never look like completed.

### P2 - Pending shares live/running semantics

Evidence:

- `isLive` treats pending as live at `src/components/monitoring/MonitoringProcessHud.tsx:88`.
- Trace sorting prioritizes pending with live traces at `src/components/monitoring/MonitoringProcessHud.tsx:119`.
- `buildSummary` counts both running and pending as `running` at `src/lib/processTraceMap.ts:643`.
- `toneForStatus` gives running and pending the same info tone at `src/lib/processTraceMap.ts:141`.
- `toneColor` renders pending/running/info with `#6366f1` at `src/components/monitoring/MonitoringProcessHud.tsx:162`.
- The footer uses purple for `done` at `src/index.css:587`, which creates a purple/indigo overlap in the HUD's visual language.

Impact:

Pending looks and ranks too much like active execution. This is why the panel can feel like "pending is purple" while purple also appears as done.

Remediation:

- Split `pending` and `running` throughout the trace summary.
- Reserve animation, live-follow priority, and blue active tones for actual `running`.
- Use neutral gray or muted amber for `pending`, depending on whether it is harmless waiting or manual attention.
- Avoid purple for pending or done-adjacent status indicators.

Acceptance criteria:

- Only running traces animate and receive live priority.
- Pending is visible as waiting, not done and not running.
- Done/completed has one unambiguous visual language.

### P2 - The left HUD list lacks last-post recency

Evidence:

- `HudTrace` has no `lastPostAt` or recency field at `src/components/monitoring/MonitoringProcessHud.tsx:53`.
- `TraceList` only shows model/subtitle, step count, token count, and duration at `src/components/monitoring/MonitoringProcessHud.tsx:309`.
- `toMonitoringEntry` returns X posted fields but no normalized `last_post_at` or Telegram posted timestamp for the HUD payload around `supabase/functions/admin-actions/monitoringReads.ts:1115`.
- Dashboard heartbeat already has last post data at `src/api/dashboardData.ts:159`, but the HUD does not use it per entry.

Impact:

Operators cannot answer "when was the last post?" from the HUD list. Duration can be mistaken for freshness.

Remediation:

- Add a normalized field to the dashboard HUD payload:
  - `last_post_at`
  - optionally `last_telegram_posted_at`
  - optionally `last_x_posted_at`
- Render relative recency in the left row, for example `posted 12m ago`, `X posted 4m ago`, or `not posted`.
- Keep duration as process duration, not freshness.

Acceptance criteria:

- Every left-list row shows both process state and freshness when available.
- A completed post shows when it posted, not just how long it took.

### P2 - Status colors are fragmented across Dashboard, Monitoring badges, HUD JS, and CSS

Evidence:

- Dashboard has local `severityClasses` and `statusDot` logic at `src/pages/Dashboard.tsx:63`.
- Dashboard status items use ad hoc token classes at `src/pages/Dashboard.tsx:428`.
- HUD color logic uses raw hex palettes at `src/components/monitoring/MonitoringProcessHud.tsx:151`.
- Global CSS has independent `.status-*` utilities at `src/index.css:180`.
- HUD CSS also defines its own OKLCH and raw color rules at `src/index.css:213`.

Impact:

The same operational state can look different depending on which component renders it. This directly supports the "tags are inconsistent" concern.

Remediation:

- Extend `src/components/ui/badge.tsx` with semantic variants:
  - `success`
  - `warning`
  - `danger`
  - `info`
  - `neutral`
  - `muted`
- Create a single status-to-tone helper for Dashboard, Monitoring badges, and HUD.
- Keep author/hash colors only for identity markers, not status-bearing marks.

Acceptance criteria:

- One status palette exists.
- Dashboard tiles, HUD chips, Monitoring badges, and detail rows use the same state mapping.

### P2 - HUD controls lack strong focus and accessible selection semantics

Evidence:

- Timeline bars are buttons at `src/components/monitoring/MonitoringProcessHud.tsx:253`.
- List rows are buttons at `src/components/monitoring/MonitoringProcessHud.tsx:298`.
- Trace rows are buttons at `src/components/monitoring/MonitoringProcessHud.tsx:398`.
- Reset/follow buttons are custom buttons at `src/components/monitoring/MonitoringProcessHud.tsx:565`.
- CSS defines hover/selected/open states but no visible `:focus-visible` treatment around `src/index.css:314` and `src/index.css:410`.
- Timeline accessible labels only say `Select ${trace.title}` at `src/components/monitoring/MonitoringProcessHud.tsx:260`.
- List rows do not expose selected state with `aria-current` or `aria-pressed` around `src/components/monitoring/MonitoringProcessHud.tsx:296`.

Impact:

Keyboard and assistive-tech users cannot reliably scan or operate the HUD. The UX risk is real even if visual mouse usage works.

Remediation:

- Add `focus-visible` styles to all custom HUD buttons.
- Add accessible labels with title, status, errors, tokens, and duration.
- Mark selected trace rows with `aria-current="true"` or `aria-pressed`.
- Prefer shadcn `Button` for header actions and Radix `Collapsible` or `Accordion` for trace detail rows.

Acceptance criteria:

- Keyboard focus is visible throughout the HUD.
- Screen readers can identify selected row, status, errors, and duration.

### P3 - Manual enrichment is labeled manual but typed/rendered as AI

Evidence:

- The canonical enrichment node says `Manual enrichment` but has `kind: "ai"` at `src/lib/processTraceMap.ts:112`.
- `ToolGlyph` renders every `kind === "ai"` node with Sparkles at `src/components/monitoring/MonitoringProcessHud.tsx:222`.

Impact:

The HUD can imply that manual enrichment is an automatic AI stage. That conflicts with the operational truth that enrichment approval is manual.

Remediation:

- Add a distinct node kind such as `manual`.
- Render manual enrichment with a review/manual icon and waiting semantics.
- Separate AI draft generation evidence from human approval state in the detail rows.

Acceptance criteria:

- Manual enrichment waiting state is visibly manual.
- AI generation and human approval are distinguishable.

### P3 - Pipeline Funnel and queue diagnostics still sit too high in the main flow

Evidence:

- Funnel data is built from aggregate `pipelineCounts` at `src/pages/Dashboard.tsx:389`.
- `Pipeline Funnel` renders in the main page flow at `src/pages/Dashboard.tsx:786`.
- Queue Breakdown renders again in the default Pipeline tab at `src/pages/Dashboard.tsx:868`.

Impact:

These diagnostics are useful, but they lengthen the main dashboard and duplicate the process story already available in the HUD.

Remediation:

- Move `Pipeline Funnel` into the Pipeline tab.
- Convert top-level funnel insight into a single compact "largest drop-off" or "current choke point" line if needed.
- Keep queue details in the Pipeline tab or in Monitoring, not the first cockpit flow.

Acceptance criteria:

- Main Dashboard flow is cockpit-first.
- Detailed diagnostics are still available but secondary.

### P3 - Header/status metadata is duplicated

Evidence:

- Header shows Online and Updated at `src/pages/Dashboard.tsx:535`.
- `statusItems` also includes Online and Updated at `src/pages/Dashboard.tsx:428`.
- `statusItems` render again at `src/pages/Dashboard.tsx:543`.

Impact:

Low functional risk, but it spends first-viewport attention on repeated chrome.

Remediation:

- Keep refresh, online, and updated in the header.
- Reserve the status strip for exceptional states only, or remove the strip when there are no exceptions.

Acceptance criteria:

- No repeated Online/Updated display in the first viewport.

### P3 - Obsolete dashboard code/data shape remains

Evidence:

- `DashboardMetrics` defines a ten-card legacy metrics grid at `src/components/dashboard/DashboardMetrics.tsx:9`.
- Search found no source import of `DashboardMetrics`.
- `recent_posts` remains in the frontend Dashboard API shape at `src/api/dashboardData.ts:283`.
- `recent_posts` is still present in degraded backend fallback at `supabase/functions/admin-actions/dashboardSummaries.ts:64`.
- Dashboard tests assert visible `Recent Activity` is absent at `src/test/dashboard.test.tsx:412`.

Impact:

This is not visible bloat, but it preserves the old dashboard mental model and increases future merge risk.

Remediation:

- Delete unused `DashboardMetrics` if no external import exists.
- Remove client-side `recent_posts` from `RpcResult` and tests if backend compatibility no longer requires it.
- Leave historical DB function output alone unless removing it is low risk and migration-safe.

Acceptance criteria:

- No unused Dashboard metric-card component remains.
- No frontend type/test path implies Recent Activity still belongs on Dashboard.

## Recommended Product Shape

### First Viewport

1. Header:
   - Dashboard title
   - Refresh
   - Online/offline
   - Updated time

2. Primary alert:
   - One operational issue
   - One action route

3. Post process HUD:
   - Main first-viewport surface
   - Left list: handle/source, stage, status, last-post recency, duration, tokens
   - Right detail: waterfall, step status, error/skip detail, model/token/cost/evidence
   - Compact action chips routed to Monitoring

4. Compact guardrail strip:
   - X budget
   - OpenAI/Foglamp local cap
   - Ingest heartbeat
   - Storage risk

### Secondary Diagnostics

Use `Tabs`, `Accordion`, or `Collapsible` sections for:

- Queue Breakdown
- Pipeline Funnel
- Detailed X usage
- Detailed OpenAI usage
- Resource Risk
- Controls

### Monitoring Role

Monitoring remains:

- Search and filters
- Post table/mobile cards
- Detail drawer
- Manual enrichment
- Manual score
- Dedupe interventions
- Translation, Telegram, and X interventions

Dashboard should not become the intervention workbench. It should be the process cockpit.

## Shadcn/Radix Remediation Map

Existing local components that fit this work:

- `Badge`: replace custom status spans and HUD chips with semantic variants.
- `Tooltip` or `HoverCard`: explain compact HUD chips without adding text bloat.
- `Collapsible` or `Accordion`: replace custom detail-row disclosure state in `TraceWaterfall`.
- `ScrollArea`: standardize list/tree scrolling behavior.
- `Tabs`: keep secondary diagnostics organized.
- `Table`: use for queue and detailed usage rows where comparison matters.
- `Progress`: keep for budget/funnel values, but use one consistent semantic tone system.
- `Separator`: reduce border noise in dense panels.
- `Button`: replace custom header/reset buttons where standard focus and disabled states matter.

Do not solve this by adding more cards. The cleanup should remove custom spans, merge cards, and make status semantics consistent.

## Implementation Backlog

### Phase 1 - Fix HUD truth semantics

- Make terminal skip decisions dominate downstream pending statuses.
- Split pending from running in summary, sort, labels, and animation.
- Add status-specific HUD chips.
- Add normalized last-post recency to the dashboard HUD payload.
- Add manual node kind or manual rendering for enrichment approval.

Tests:

- Below-threshold plus stale Telegram/X pending renders downstream skipped.
- Pending does not animate.
- Manual enrichment is waiting/manual, not running/AI.
- Left list renders `posted X ago` when available.

### Phase 2 - Debloat Dashboard

- Promote HUD directly after primary alert.
- Collapse triage cards into compact action chips.
- Merge X budget surfaces into one primary plus one detail surface.
- Merge OpenAI/AI observability surfaces into one primary plus one detail surface.
- Move Pipeline Funnel to the Pipeline tab.
- Remove duplicated Online/Updated strip.
- Delete unused `DashboardMetrics`.
- Remove obsolete client `recent_posts` shape if safe.

Tests:

- Dashboard renders HUD before secondary diagnostic panels.
- X budget appears once in the main cockpit.
- OpenAI aggregate appears once in the main cockpit.
- Recent Activity and DashboardMetrics remain absent from visible Dashboard.

### Phase 3 - Improve component quality

- Add semantic `Badge` variants or a shared `StatusBadge`.
- Convert trace disclosure rows to Radix `Collapsible` or `Accordion`.
- Use `ScrollArea` only if it keeps native-like behavior and avoids ugly custom scroll treatment.
- Add focus-visible styles and accessible row labels.
- Add status tone mapping tests.

Tests:

- Selected trace row exposes selected state.
- Timeline/list rows expose status and duration to assistive tech.
- Status mapping unit tests cover completed, running, pending, blocked, skipped, failed, unknown.

## Success Criteria For Next Implementation Pass

- Dashboard first viewport feels like a compact process cockpit, not a report page.
- A skipped/below-threshold post never shows Telegram or X pending.
- Pending is visually neutral/waiting and never purple/done-adjacent.
- Only running work animates.
- Completed posts stop animating and become readable history.
- Left HUD rows answer: what post, what state, how recent, how long, how expensive.
- Manual enrichment is clearly manual.
- Dashboard has one authoritative source for latest process state.
- Duplicated X/OpenAI/process/funnel/status surfaces are merged or moved secondary.
- Shadcn/Radix primitives replace custom disclosure/status/focus behavior where they reduce code and improve readability.

## Open Verification Gaps

- This audit did not perform a live authenticated browser walkthrough in the current turn.
- Current tests pass, but they do not cover the below-threshold stale-pending case, status color consistency, selected-row accessibility semantics, or last-post recency rendering.
- The report did not change code. It is ready to feed a planning or implementation pass.
