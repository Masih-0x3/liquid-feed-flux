# XOT Visual Process Trace Map Implementation Plan

## Planner Metadata
- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: `main`
- Head: `72fecb2dbb1dfcf659fb65d01ce639cbaf2ae23d`
- Date: 2026-07-03
- Planning mode: `planning-orchestrator`, goal-backed, read-only repo/browser/docs inspection, plan artifact only.
- Product surface: production XOT Monitoring details drawer, Dashboard process observability summary, Settings observability status.
- Live route inspected: `https://xot.iraneyes.com/monitoring?search=https%3A%2F%2Ftwitter.com%2FFirstSquawk%2Fstatus%2F2073000416170942749`
- Worker scopes: parent-only lightweight orchestration. Multi-agent workers were skipped because the missing feature is now narrow, current repo/live evidence is sufficient, and the active agent tool policy requires explicit subagent permission before spawning agents.
- References inspected:
  - `README.md`
  - `package.json`
  - `src/components/monitoring/MonitoringDetailDrawer.tsx`
  - `src/components/monitoring/MonitoringDeliveryTimeline.tsx`
  - `src/api/monitoringData.ts`
  - `src/lib/timelineDisplay.ts`
  - `src/App.tsx`
  - `docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-plan.md`
  - `docs/plans/2026-07-03-xot-observability-online-release-implementation-plan.md`
  - `docs/operations/release-runbook.md`
- Research sources:
  - Foglamp Live HUD docs: `https://docs.foglamp.dev/sdk/hud`
  - Foglamp data model docs: `https://docs.foglamp.dev/concepts/data-model`
  - Foglamp SDK configuration docs: `https://docs.foglamp.dev/sdk/configuration`
  - Foglamp OSS repository: `https://github.com/foglamp-labs/foglamp`
- Memory/context:
  - Cognee recall was attempted against `project_finalized_xot`, `tooling_local`, and `personal_profile`; it returned no grounded evidence for the visual trace-map gap. Current repo, live browser, and docs are the source of truth.
  - Codex memory registry pointed to the existing XOT/Foglamp lane and reminded the planner to verify current repo/live state before treating prior Foglamp dashboard conclusions as proof.
- Assumptions:
  - The user wants Foglamp-style visual comprehension inside XOT, not a dependency on Foglamp hosted dashboard reads.
  - Production should stay local-ledger-first and should not require hosted Foglamp export to be enabled.
  - The first implementation slice should be useful for the exact live row that exposed the miss: a successful FirstSquawk item with scoring, translation, Telegram, and X posting evidence.
  - No product-code implementation starts in this planning turn.

## Executive Goal

Add an XOT-native visual process trace map to the Monitoring details drawer and dashboard observability experience so an operator can see the path of a real item at a glance: RSS ingest, duplicate gate, scoring, translation, optional enrichment/media, Telegram delivery, X posting, and hosted Foglamp export state.

The feature should feel like the useful part of Foglamp's trace waterfall and live HUD, but it must be styled and sourced for XOT:

- XOT-owned Supabase ledgers and `pipeline_events` are the truth.
- Foglamp vocabulary informs the model: workflow, run, trace, span, agent, status, timing, tokens.
- Hosted Foglamp export remains optional correlation, not the UI dependency.
- The visual map must work in production, unlike the upstream HUD, which is dev/local broker only.

## Source Of Truth Contract

- Intent: make the invisible process path visible inside XOT Monitoring through a real visual graph/map, not only text cards.
- Current behavior: the Monitoring details drawer shows `Process Observability`, AI call totals, token totals, hosted-trace skipped counts, and a text delivery timeline. The live inspected row for `https://twitter.com/FirstSquawk/status/2073000416170942749` has real data but no actual trace diagram; visible SVGs are only lucide icons/spinners.
- Expected outcome: opening a Monitoring row details drawer shows a first-class visual process map with nodes and edges for the item lifecycle, animated current/running state when applicable, token/model badges on AI nodes, skipped/failure states, and drilldown links to existing timeline/observability cards.
- Truth owner: XOT local data from `pipeline_events`, `workflow_runs`, `ai_call_ledger`, `x_deliveries`, jobs/post state, and existing Monitoring entry fields.
- Contract boundary:
  - Frontend view model converts current Monitoring payloads into process-map nodes and edges.
  - Monitoring drawer renders the visual map and keeps existing text evidence below it.
  - Dashboard may add a compact mini-map/status band only after drawer UX is proven.
  - Backend payload changes are allowed only if the frontend view model cannot faithfully map current evidence.
- Displaced path: the current text-only `ProcessObservabilityPanel` remains as detailed evidence, but it no longer carries the whole "what happened?" job alone.
- Cutover:
  1. Add visual map behind existing Monitoring details data with no schema change.
  2. Verify against real posted, skipped, duplicate, pending, and failed rows.
  3. Only then decide whether `observability_events` or richer sequence fields are needed.
  4. Keep upstream `<FoglampHUD />` dev-only and out of `/monitoring`.
- Acceptance evidence:
  - Browser inspection on the real `/monitoring?search=...2073000416170942749` production-equivalent flow shows a visible process map, not only icons/text.
  - The map shows at least: duplicate gate, scoring/OpenAI, translation/OpenAI, Telegram, X posting, hosted export/local-only state.
  - The map renders useful partial states for below-threshold and duplicate rows.
  - Tests cover the view-model mapping and drawer rendering.
- Evidence lane:
  - Local source diff.
  - Focused Vitest/Testing Library tests.
  - `npm run check:strict`, `npm run lint`, `npm run build`.
  - Browser checks on local dev at `/monitoring?search=...`.
  - Production smoke after deploy with an authenticated browser.
- Kill criteria:
  - The graph implies a step happened when data only says "unknown".
  - The map requires hosted Foglamp export or Foglamp API reads.
  - Prompt/output text, API keys, or private metadata appear in the graph.
  - Animation obscures data, creates layout shift, or ignores reduced-motion preference.
  - The drawer becomes less readable on mobile or Persian/RTL content overlaps.
- Forbidden moves:
  - Do not turn on hosted Foglamp just to make the UI look populated.
  - Do not add fake traces, demo endpoints, synthetic rows, or forced posts.
  - Do not copy Foglamp SaaS branding or make the upstream floating HUD the production interface.
  - Do not hard-code dynamic tweet IDs, URLs, dates, job IDs, or run IDs into display names.
  - Do not replace the existing timeline/detail evidence; the graph summarizes and links into it.

## Native Planning Superiority

- Codex Native baseline: likely says "embed Foglamp HUD" or "add a flowchart" without catching that Foglamp HUD is dev-only, XOT's production truth is local Supabase data, and the current drawer already has timeline/ledger evidence that can drive a graph.
- What this planner does better:
  - Rechecked the live production route that exposed the miss.
  - Rechecked current Foglamp docs and OSS claims instead of relying on stale memory.
  - Used Codegraph and current files to map exact components and data contracts.
  - Separates drawer visual-map MVP from later backend/schema/dashboard expansion.
  - Defines target-perspective proof: a real row visibly shows the map.
- User-specific context used:
  - The user wants XOT-owned observability, not reliance on Foglamp hosting.
  - The user specifically expected diagrams/animations similar to Foglamp.
  - Previous release successfully shipped data, but the visual mental model was missed.
- Superiority score target: 5
- Proof artifacts:
  - This saved plan.
  - Live browser extraction from the current Monitoring row.
  - Current repo files and Codegraph context.
  - Official Foglamp HUD/data-model/config docs checked on 2026-07-03.

## Orchestration Decision

- Mode: parent-only lightweight orchestration.
- Worker count: 0.
- Decision reason: the task is a focused follow-up feature with three known surfaces: Monitoring drawer UI, existing Monitoring data/view-model contract, and validation. Current repo/live evidence is enough for an implementation-ready plan. Spawning duplicate workers would mostly re-read the same files. The available subagent tool also requires explicit subagent permission, and the user requested the planning skill rather than separate agents.
- Independent surfaces:
  - Monitoring details drawer and visual UX.
  - Data/view-model mapping from `PipelineEvent`, `MonitoringProcessRun`, and `MonitoringProcessAiCall`.
  - Validation, production smoke, and release criteria.
- Workers used or skipped:
  - Skipped UI worker: parent used `frontend-design` skill and current browser evidence directly.
  - Skipped architecture worker: parent used Codegraph and direct files.
  - Skipped docs worker: parent verified official Foglamp docs directly.
- Thread decision: no visible Codex thread. This is one repo-local plan intended for the next implementation orchestrator run.
- Token/context rationale: keep the plan tight around the missing slice instead of reopening the whole observability program.
- Reconsider trigger: if implementation expands into self-hosted Foglamp, a real-time Node broker, new schema/event ingestion, or multi-screen dashboard redesign, add separate workers for backend schema, frontend design, and release/platform.

## Background Browser Lane

- Needed: no separate background lane.
- Target/surface: the authenticated in-app browser is already on the relevant production Monitoring route.
- Safety boundary: read-only browser inspection only; no scoring, translation, posting, settings saves, or hosted Foglamp changes.
- Required receipt: current route shows real posted row data and details drawer currently lacks a real diagram.
- Stop condition: if auth expires, use local dev with existing data mocks/tests or ask for browser login before claiming production UI proof.

## Research And Inspiration Findings

### Foglamp Live HUD

Adopt:
- Live state should make the execution path glanceable: steps, tool/model calls, tokens, cost, failure/recovery.
- Redaction should be a first-class visible state.
- Collapsed/expanded behavior can be useful for dense tools.

Adapt:
- XOT needs an embedded process map in Monitoring, not a floating overlay.
- XOT production cannot rely on Foglamp's HUD broker because the official HUD requires a long-lived Node runtime and is ignored in production, edge, and serverless contexts.
- The graph should cover non-AI steps Foglamp does not see: RSS ingest, dedupe, Telegram, X posting, media, queue state.

Avoid:
- Do not use the upstream HUD as production proof.
- Do not place an overlay over the Monitoring table.
- Do not require a local broker to view historical production runs.

### Foglamp Data Model

Adopt:
- Workflow/run grouping: use repeatable process names plus execution IDs.
- Trace/span language for AI calls: model call spans, token usage, timings, status, provider/model.
- Agent labels for scoring, translation, enrichment, dedupe where available.

Adapt:
- XOT's visual map is broader than Foglamp traces. One XOT workflow run can include multiple AI calls plus non-AI delivery/queue events.
- Show hosted trace status as correlation/export state, not as the primary map source.

Avoid:
- Do not treat embeddings or unsupported direct OpenAI calls as full Foglamp SDK traces if they are local-ledger-only.
- Do not use dynamic values as names.

### Foglamp OSS Repository

Adopt:
- Open-source/self-hostable status means future vendoring of small ideas is possible if license notices are preserved.

Adapt:
- First implementation should not vendor source. The graph can be built with local React/Tailwind/SVG primitives.
- If a later implementation copies reducer/model code from Foglamp, add attribution and license notes.

Avoid:
- Do not clone Foglamp dashboard branding, SaaS navigation, or demo-specific UI.

## Current State

### Live Product

The production route for the inspected row renders a posted item:

- Source: `https://twitter.com/FirstSquawk/status/2073000416170942749`
- Stage: X posted.
- Score: `18 / >=14`.
- Details drawer currently shows:
  - `Process Observability completed`
  - `Local ledger`
  - workflow `dedupe-pipeline`
  - `4` AI calls
  - `12,923` tokens
  - `0` failures
  - `Hosted trace 0 / 4 skipped`
  - text delivery timeline for Telegram, X, OpenAI scoring/translation, duplicate gate, worker queue.

The drawer does not show an actual trace graph or animated process diagram. The only visible SVG elements are icons/spinners.

### Repo Components

- `src/components/monitoring/MonitoringDetailDrawer.tsx`
  - Owns the drawer layout.
  - Contains `ProcessObservabilityPanel`.
  - Computes `deliverySummary`, `timelineGroups`, scoring snapshots, and selected feedback.
  - Current drawer grid is `lg:grid-cols-[1fr_380px]`; the visual map must fit this layout without pushing action controls off-screen.
- `src/components/monitoring/MonitoringDeliveryTimeline.tsx`
  - Already groups pipeline events and shows a vertical narrative timeline.
  - This should remain the detailed evidence panel.
- `src/api/monitoringData.ts`
  - `MonitoringEntry` already includes `process_observability`.
  - `PipelineEvent` includes `step`, `status`, timestamps, errors, and `meta`.
  - `MonitoringProcessRun` and `MonitoringProcessAiCall` include workflow names, statuses, durations, tokens, models, endpoints, and Foglamp export state.
- `src/lib/timelineDisplay.ts`
  - Existing helpers group timeline events into operator-friendly categories.
  - New visual-map view-model should reuse or complement these helpers instead of duplicating timeline semantics.
- `src/App.tsx`
  - `FoglampHUD` is dev-only and explicitly not mounted on `/monitoring`.

### Validation State

Current package scripts support:

- `npm run check:strict`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:functions`
- `npm run check:functions`
- `npm run lint:functions`
- `npm run check:release-state`

## Future State

### Operator Workflow

When an operator opens Monitoring and clicks `Details`:

1. The top of the drawer shows a compact "Process map" before the long text timeline.
2. The map visually answers:
   - Where did this item enter?
   - Did duplicate gate allow it?
   - Did AI scoring run?
   - Did translation run or get skipped?
   - Did Telegram deliver?
   - Did X post, skip, fail, or remain pending?
   - Which AI nodes spent tokens and how much?
   - Is hosted Foglamp export on, skipped, or local-only?
3. Clicking or keyboard-focusing a node shows concise detail and links/scrolls to the existing timeline or latest AI-call list.
4. Running/current states pulse subtly. Completed states stay stable. Failed states are unmistakable. Skipped/blocked states are muted but explain why.
5. On mobile, the same information becomes a vertical stepper with stable widths and no text overlap.

### Visual Direction

- Dense operational dashboard, not marketing hero.
- Use existing XOT card/badge/tone language.
- Use SVG or CSS grid lines for edges, not a new heavy graph library.
- Use lucide icons only for semantic node identity.
- Use motion sparingly:
  - pulse running node ring,
  - animated edge only for active transition,
  - brief node-highlight when details open,
  - respect `prefers-reduced-motion`.
- No decorative gradients, blobs, or unrelated visual effects.

### Initial Node Model

Canonical nodes for phase 1:

1. `ingest`: RSS intake / webhook
2. `dedupe`: duplicate gate / coverage
3. `score`: OpenAI scoring
4. `translate`: OpenAI translation
5. `enrich`: enrichment / voice draft, optional
6. `media`: media download, optional
7. `telegram`: Telegram delivery
8. `x-dispatch`: X dispatch / candidate check
9. `x-post`: X posting
10. `foglamp-export`: hosted trace export/local-only state

Canonical edges:

- `ingest -> dedupe`
- `dedupe -> score`
- `score -> translate` when translation is needed
- `score -> telegram` when direct delivery is possible
- `translate -> telegram`
- `telegram -> x-dispatch`
- `x-dispatch -> x-post`
- AI nodes -> `foglamp-export` as side/export correlation, not required for process success

Statuses:

- `completed`
- `running`
- `pending`
- `failed`
- `skipped`
- `blocked`
- `unknown`

Tones:

- `good`
- `info`
- `warn`
- `bad`
- `muted`

## Non-Goals

- Do not enable hosted Foglamp export.
- Do not self-host Foglamp.
- Do not build a full trace browser route.
- Do not replace Dashboard, Monitoring, or Settings architecture.
- Do not add a Node HUD broker in production.
- Do not backfill historical rows.
- Do not add synthetic trace/demo data.
- Do not show prompt/output text.
- Do not add a new graph visualization dependency unless the first CSS/SVG implementation proves insufficient.

## Phase Plan

### Phase 0 - Implementation Anchor

Tasks:
- Re-read current `git status`, `README.md`, `package.json`, and local instructions.
- Re-check current Foglamp HUD/data-model docs if implementation starts on a later date.
- Re-open the live or local Monitoring row that exposed the miss.
- Run Codegraph context for `MonitoringDetailDrawer`, `MonitoringDeliveryTimeline`, and Monitoring data types.

Acceptance:
- The implementation orchestrator records the exact row/route used for visual proof.
- The current local branch/worktree state is separated from deployed state.
- No code edits happen before the target component/data contract is stated.

### Phase 1 - View-Model Contract

Primary files:
- Add `src/lib/processTraceMap.ts`
- Add `src/test/process-trace-map.test.ts`
- Possibly update `src/lib/timelineDisplay.ts` only for shared status/timing utilities.

Tasks:
- Define `ProcessTraceNode`, `ProcessTraceEdge`, `ProcessTraceMap`, and status/tone types.
- Implement `buildProcessTraceMap(entry, timeline, observability)` from existing `MonitoringEntry`, `PipelineEvent[]`, and `MonitoringProcessObservability`.
- Map current event steps into canonical nodes:
  - `ingested`, `rss`, `webhook` -> `ingest`
  - `dedupe`, `duplicate` -> `dedupe`
  - `score`, `scoring` -> `score`
  - `translate`, `translation` -> `translate`
  - `deliver`, `telegram` -> `telegram`
  - `x_post`, `x_poster`, `force_x`, `dispatch` -> `x-dispatch` or `x-post`
  - `download_media`, `media` -> `media`
  - enrichment/voice events -> `enrich`
- Merge AI call ledger rows into `score`, `translate`, `enrich`, or `dedupe` nodes by `operation_name`, `agent_name`, and `trace_name`.
- Add conservative fallback rules:
  - If a step is absent but entry state proves outcome, show a derived node with source `entry`.
  - If neither events nor entry state prove a node, show `unknown` or omit optional nodes.
  - Never mark a node completed from canonical order alone.
- Produce node detail fields:
  - status label
  - duration
  - latest timestamp
  - token count
  - model/endpoint
  - error/skipped reason
  - source provenance (`pipeline_events`, `workflow_runs`, `ai_call_ledger`, `entry_state`)
- Unit-test cases:
  - successful posted item like FirstSquawk `2073000416170942749`
  - below-threshold item that skips X
  - duplicate blocked item
  - translation pending/running item
  - failed X post
  - row with no observability data

Acceptance:
- View model returns deterministic node/edge arrays with stable IDs.
- Tests prove no node is marked completed without evidence.
- Tests prove AI token/model data appears only on AI-backed nodes.
- Tests prove missing data creates explicit partial/unknown state.

### Phase 2 - Monitoring Drawer Visual Component

Primary files:
- Add `src/components/monitoring/MonitoringProcessTraceMap.tsx`
- Update `src/components/monitoring/MonitoringDetailDrawer.tsx`
- Update `src/test/monitoring-components.test.tsx`

Tasks:
- Render `MonitoringProcessTraceMap` directly above or inside `ProcessObservabilityPanel`.
- Use a responsive layout:
  - desktop: horizontal or two-lane graph inside the existing left column;
  - mobile: vertical stepper;
  - no fixed text width that breaks Persian/RTL content.
- Render each node as an accessible button or non-button card depending on whether it has drilldown action.
- Use `aria-label` with node label, status, and key metric.
- Render edges as CSS/SVG lines with status classes.
- Add badges:
  - `AI`
  - token count
  - model short name
  - hosted/local-only export
  - skipped/failure reason
- Add interaction:
  - hover/focus highlights connected edges;
  - click/focus opens a small inline node details panel or scrolls to the matching timeline/AI-call section;
  - no popover-only critical information.
- Preserve current `ProcessObservabilityPanel` text cards and `MonitoringDeliveryTimeline`.

Acceptance:
- The details drawer includes `data-testid="process-trace-map"`.
- The map renders nodes for successful posted, skipped, and failed mocked rows.
- RTL/Persian content in the drawer still renders without overlap.
- Existing Monitoring details tests continue to pass.

### Phase 3 - Motion, Polish, And Accessibility

Primary files:
- `src/components/monitoring/MonitoringProcessTraceMap.tsx`
- `src/index.css` or component-local Tailwind classes
- `src/test/monitoring-components.test.tsx`

Tasks:
- Add subtle motion only where it clarifies state:
  - `running`: pulsing node ring and active edge.
  - `pending`: muted shimmer or dotted edge.
  - `failed`: static red state, no distracting loop.
  - `completed`: stable state.
- Respect `prefers-reduced-motion` by disabling repeated animations.
- Add keyboard focus styles and tab order.
- Ensure color is not the only status signal; statuses need text/badges/icons.
- Confirm long workflow IDs stay in tooltips or detail text, not node titles.
- Add empty/partial state copy:
  - "Process map partial: no workflow run captured yet"
  - "AI call ledger unavailable"
  - "Hosted export local-only"

Acceptance:
- Browser desktop check shows no overlap or layout shift when drawer opens.
- Browser mobile check shows vertical map with all node labels readable.
- Reduced-motion emulation or CSS inspection confirms animations are disabled/limited.
- No node uses only color to communicate status.

### Phase 4 - Optional Dashboard Mini Map

Primary files:
- `src/pages/Dashboard.tsx`
- `src/components/settings/ObservabilitySettings.tsx`
- `src/api/dashboardData.ts`
- `src/test/dashboard.test.tsx`
- `src/test/observability-settings.test.tsx`

Tasks:
- After the drawer map is accepted, add a compact latest-run mini map to Dashboard's Process Observability card.
- Show only aggregate lane status, not the full row graph:
  - active/running lanes,
  - latest completed run,
  - failed or stuck lane,
  - local-only/hosted export state.
- Keep Settings as status/control surface, not a trace browser.

Acceptance:
- Dashboard mini map helps route operators to Monitoring without crowding existing resource/cost cards.
- Settings still clearly communicates local-only vs hosted export and cap state.
- No production claim depends on hosted Foglamp reads.

### Phase 5 - Data Contract Upgrade Only If Needed

Potential files:
- `supabase/migrations/*observability_events*.sql`
- `supabase/functions/_shared/observability.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`
- `src/api/monitoringData.ts`
- Generated Supabase types if schema changes.

Trigger:
- Only start this phase if Phase 1/2 proves current `pipeline_events`, `workflow_runs`, and `ai_call_ledger` cannot map enough sequence/parent information for the visual graph.

Tasks:
- Add or activate `observability_events` with sequence, parent_event_id, lane, span_kind, and workflow_run relation.
- Dual-write from existing helpers rather than replacing `pipeline_events`.
- Extend admin-actions Monitoring payload with a normalized map source.
- Preserve admin-only read policies.

Acceptance:
- Migration is additive and RLS-proven.
- Existing Monitoring remains functional if new event rows are missing.
- Backend tests cover malformed/missing event records.

### Phase 6 - Release And Production Proof

Tasks:
- Run focused validation:
  - `npm run check:strict`
  - `npm run lint`
  - `npm test -- src/test/process-trace-map.test.ts src/test/monitoring-components.test.tsx`
  - `npm run build`
- If backend changed:
  - `npm run test:functions`
  - `npm run check:functions`
  - `npm run lint:functions`
  - migration apply proof and RLS proof.
- Browser local:
  - run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`
  - open `/monitoring?search=https%3A%2F%2Ftwitter.com%2FFirstSquawk%2Fstatus%2F2073000416170942749`
  - click `Details`
  - verify `process-trace-map` visually and through DOM text.
  - repeat at a mobile viewport.
- Production after deploy:
  - verify Vercel deployment status.
  - verify authenticated production row details show the map.
  - verify final console errors are absent or explained.
- Update `docs/operations/release-runbook.md` with release evidence.

Acceptance:
- The implementation is not called complete until target-perspective browser evidence exists from the real route.

## Task Backlog

### Model And Utilities
- Add process-map type definitions.
- Add canonical lane/node constants.
- Add status/tone normalization from pipeline event statuses.
- Add AI-call-to-node mapping.
- Add evidence/provenance metadata per node.
- Add edge builder with partial/blocked states.

### Component
- Build `MonitoringProcessTraceMap`.
- Add node, edge, legend, and details subcomponents.
- Add responsive layout variants.
- Add reduced-motion-aware classes.
- Add test IDs for map, nodes, edges, and selected-node details.

### Integration
- Wire map into `MonitoringDetailDrawer`.
- Keep existing cards/timeline below map.
- Add click/focus detail behavior.
- Add fallback for no `entry`.

### Tests
- Unit tests for `buildProcessTraceMap`.
- Component tests for map render and partial states.
- Regression tests for details drawer with Persian content and posted/skipped rows.
- Optional accessibility assertions for labels and focusable nodes.

### Docs
- Update the native observability implementation ledger or release runbook after implementation.
- Add a short operator note explaining that this is XOT-native visual observability and hosted Foglamp remains optional.

## Acceptance Criteria

### Product Acceptance
- The operator can open a row details drawer and understand the process path within five seconds.
- The current FirstSquawk posted row shows the full successful path from ingest/dedupe through X posting.
- A below-threshold row shows where it stopped and why.
- A duplicate row shows duplicate gate state and coverage.
- A failed/pending row makes the stuck lane obvious.
- The graph and existing timeline agree. If they disagree, the UI shows partial/unknown state instead of pretending.

### Data Acceptance
- Every visual node has a recorded evidence source.
- AI nodes show token/model/duration only when available from `ai_call_ledger`.
- Hosted Foglamp export is shown as `hosted trace`, `local only`, or `skipped reason`, never as the main success path.
- No prompt/output text is stored or displayed.

### UI Acceptance
- Desktop drawer has no horizontal page overflow.
- Mobile drawer uses a vertical layout and no overlapping text.
- Persian/RTL text remains readable in surrounding content.
- Motion respects `prefers-reduced-motion`.
- Keyboard users can focus nodes and read status/details.

### Operational Acceptance
- No fake traces or demo endpoints are added.
- No hosted Foglamp key is required.
- No production data mutation is needed for validation.
- Release evidence records local, CI, deploy, and live browser states separately.

## Validation Plan

### Local Static And Test Checks

Run:

```bash
npm run check:strict
npm run lint
npm test -- src/test/process-trace-map.test.ts src/test/monitoring-components.test.tsx
npm run build
```

If implementation touches shared timeline/dashboard helpers, also run:

```bash
npm test -- src/test/timeline-display.test.ts src/test/monitoring-data.test.ts src/test/dashboard.test.tsx src/test/observability-settings.test.tsx
```

If implementation touches Supabase functions or migrations, also run:

```bash
npm run test:functions
npm run check:functions
npm run lint:functions
```

### Browser Checks

Local:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Check:

- `http://127.0.0.1:5173/monitoring?search=https%3A%2F%2Ftwitter.com%2FFirstSquawk%2Fstatus%2F2073000416170942749`
- click `Details`
- confirm `Process map` or equivalent heading appears.
- confirm nodes for dedupe, score, translate, Telegram, X.
- confirm AI token/model badge appears for score/translation when available.
- confirm hosted export/local-only badge appears.
- inspect desktop and mobile widths.

Production after deploy:

- `https://xot.iraneyes.com/monitoring?search=https%3A%2F%2Ftwitter.com%2FFirstSquawk%2Fstatus%2F2073000416170942749`
- authenticated browser check.
- final console errors check.

### Anti-Cheat Checks

- Search for new fake/demo endpoints:

```bash
rg -n "demo trace|fake trace|synthetic trace|smoke trace|force.*trace" src supabase docs
```

- Search for prompt/output leakage in visual map code:

```bash
rg -n "prompt|completion|response|output|input" src/components/monitoring src/lib/processTraceMap.ts
```

Manual review expected: terms may appear in safe labels, but no raw model text should be rendered from trace payloads.

## Risks And Dependencies

- Current `pipeline_events` are grouped for narrative display, not designed as a precise DAG. Mitigation: start with canonical lifecycle order plus evidence-proven statuses; add `observability_events` only if needed.
- AI calls may not always map cleanly to score/translate/enrich nodes. Mitigation: use conservative operation/agent matching and show unmapped calls in a side list.
- Too much visual detail could make Monitoring less usable. Mitigation: map is summary-first; details stay in existing cards.
- Motion can hurt readability. Mitigation: use motion only for running/pending and honor reduced motion.
- Hosted Foglamp expectations may remain confusing. Mitigation: copy and badges must clearly say `XOT local ledger` and `Hosted export local-only/skipped`.
- Production rows vary by stage. Mitigation: test posted, below-threshold, duplicate, failed, and partial rows.

## Implementation Orchestrator Handoff

### Source-Of-Truth Contract For First Slice

- Owner: Monitoring details drawer.
- Boundary: frontend view model and component using existing Monitoring payloads.
- First slice: build and render an XOT-native process map for real Monitoring rows without schema changes.
- Evidence: target browser route shows map for the current FirstSquawk posted row.

### Recommended First Implementation Slice

Implement Phase 1 and Phase 2 together:

1. Add `src/lib/processTraceMap.ts`.
2. Add `src/test/process-trace-map.test.ts`.
3. Add `src/components/monitoring/MonitoringProcessTraceMap.tsx`.
4. Wire it into `src/components/monitoring/MonitoringDetailDrawer.tsx`.
5. Update focused component tests.
6. Run local checks and browser proof.

### Phase Order And Dependency Constraints

- View-model before component.
- Component before animation polish.
- Drawer proof before Dashboard mini-map.
- Backend/schema changes only after frontend MVP proves current data is insufficient.
- Release proof only after local browser proof.

### Likely Files To Change

- `src/lib/processTraceMap.ts`
- `src/components/monitoring/MonitoringProcessTraceMap.tsx`
- `src/components/monitoring/MonitoringDetailDrawer.tsx`
- `src/api/monitoringData.ts` if type additions are needed.
- `src/test/process-trace-map.test.ts`
- `src/test/monitoring-components.test.tsx`
- `src/index.css` if custom motion utilities are cleaner than inline Tailwind.
- Optional later:
  - `src/pages/Dashboard.tsx`
  - `src/components/settings/ObservabilitySettings.tsx`
  - `supabase/functions/admin-actions/monitoringReads.ts`
  - `supabase/functions/_shared/observability.ts`
  - `supabase/migrations/*observability_events*.sql`

### Allowed Changes

- Add frontend view-model and component files.
- Add focused tests.
- Add accessible UI states and reduced-motion CSS.
- Add small type extensions when required by actual payloads.
- Add backend/schema work only after Phase 1/2 evidence shows it is necessary.

### Disallowed Changes

- Do not enable hosted Foglamp export.
- Do not expose or request `FOGLAMP_API_KEY`.
- Do not add fake trace generation.
- Do not force an X post or model call for smoke proof.
- Do not copy Foglamp SaaS UI/branding.
- Do not replace existing Monitoring timeline.
- Do not introduce a new graph library without a failed CSS/SVG proof.

### Required Skills/Tools For Implementation Run

- `implementation-orchestrator` for execution.
- `frontend-design` for visual component quality and responsive checks.
- `codegraph` before shared helper or drawer edits.
- `checkpoint-quality-loop` after the model/component slice and before release.
- `engineering-acceptance-review` before final completion.
- In-app browser skill for local and production UI proof.
- Context/current docs check for Foglamp only if implementation touches SDK/HUD/hosted behavior.

### Required Validation Before Claiming Completion

- Unit and component tests pass.
- Strict TypeScript, lint, and build pass.
- Browser proof on local route.
- Browser proof on production route after deploy if deployment is part of the implementation run.
- Screenshot or DOM evidence shows a real process map, not only text and icons.
- Console errors checked after opening the details drawer.
- Existing text timeline and observability cards still render.

### Blocking Open Questions

None for the first slice. Use current payloads and conservative mapping.

### Non-Blocking Questions Resolvable During Execution

- Whether the map heading should be `Process map`, `Trace map`, or `Run map`.
- Whether the graph sits above `Why this is here` or directly under it.
- Whether node click scrolls to timeline cards or opens inline details first.
- Whether optional nodes like `media` and `enrich` are hidden when absent or shown as muted.

### Stop Conditions

Stop and report if:

- Existing payload cannot distinguish score vs translation calls safely.
- The map shows misleading statuses for the real FirstSquawk row.
- The drawer becomes unreadable on mobile.
- Tests require broad unrelated rewrites.
- Any change would require hosted Foglamp export to prove the feature.

### Do Not Claim Complete Until

- A real Monitoring details drawer visibly shows the process map.
- At least one successful posted row and one stopped/skipped row are checked.
- The graph has accessible labels and reduced-motion behavior.
- The current FirstSquawk route no longer looks like "only text cards" to an operator.
- The implementation closeout separates local validation, production verification, deployment status, and any blocked checks.

## Orchestration Closeout

- Workers actually used: 0.
- Worker scopes: parent handled UI/product, data contract, docs, and validation due narrow scope and sufficient evidence.
- Worker results accepted/rejected/unverified: not applicable.
- Parent verification:
  - Current branch and package scripts checked.
  - Current live Monitoring route inspected.
  - Current drawer code and Monitoring data contracts inspected.
  - Codegraph used for component/context mapping.
  - Official Foglamp HUD/data-model/config docs checked.
  - Foglamp OSS repository checked.
- Gaps that would benefit from more workers:
  - If the future implementation expands to `observability_events` schema.
  - If a self-hosted Foglamp or local live broker becomes part of scope.
  - If the dashboard mini-map becomes a broader redesign.
- Visible thread considered: no. This is a single implementation handoff artifact.

## Plan Output

- Plan file: `/Users/stevmq/Finalized XOT/docs/plans/2026-07-03-xot-visual-process-trace-map-implementation-plan.md`
- Artifact status: newly created.
- Implementation status: not started.
- Next action: invoke `implementation-orchestrator` against this plan and begin with Phase 1 plus Phase 2.
