# XOT Native Process Observability Dashboard Implementation Plan

## Planner Metadata

- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: `main`
- Date: 2026-07-03
- Planning mode: `planning-orchestrator`, goal-backed, read-only codebase and documentation inspection, full worker run, no product-code implementation.
- Worker scopes:
  - UI/product workflow: existing Dashboard, Monitoring, Settings, root HUD placement, dashboard tests.
  - Backend/data contracts: Supabase Edge Functions, `pipeline_events`, job metadata, OpenAI call paths, X ledgers, admin-actions.
  - Foglamp OSS adaptation: `/tmp/foglamp-source`, SDK HUD source, broker/event model, API docs, self-hosting docs, license boundaries.
  - Operations/guardrails: free-tier protection, redaction, release validation, auth/secret handling, local/dev/prod behavior.
- References inspected:
  - `/Users/stevmq/Finalized XOT/README.md`
  - `/Users/stevmq/Finalized XOT/package.json`
  - `/Users/stevmq/Finalized XOT/package-lock.json`
  - `/Users/stevmq/Finalized XOT/deno.lock`
  - `/Users/stevmq/Finalized XOT/supabase/config.toml`
  - `/Users/stevmq/Finalized XOT/docs/plans/2026-07-01-foglamp-tracing-implementation-plan.md`
  - `/Users/stevmq/Finalized XOT/docs/operations/release-runbook.md`
  - `/Users/stevmq/Finalized XOT/docs/operations/runbooks.md`
  - `/Users/stevmq/Finalized XOT/docs/operations/function-auth-matrix.md`
  - `/Users/stevmq/Finalized XOT/src/App.tsx`
  - `/Users/stevmq/Finalized XOT/src/pages/Dashboard.tsx`
  - `/Users/stevmq/Finalized XOT/src/pages/Monitoring.tsx`
  - `/Users/stevmq/Finalized XOT/src/pages/Settings.tsx`
  - `/Users/stevmq/Finalized XOT/src/api/dashboardData.ts`
  - `/Users/stevmq/Finalized XOT/src/api/monitoringData.ts`
  - `/Users/stevmq/Finalized XOT/src/components/layout/navigation.ts`
  - `/Users/stevmq/Finalized XOT/src/components/monitoring/MonitoringDetailDrawer.tsx`
  - `/Users/stevmq/Finalized XOT/src/components/monitoring/MonitoringDeliveryTimeline.tsx`
  - `/Users/stevmq/Finalized XOT/src/components/settings/TranslationPlayground.tsx`
  - `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/index.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/dashboardSummaries.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/monitoringReads.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/translationRescoreActions.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/openai.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/foglampOpenAI.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/enrich.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/dedupe.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/scoringPolicy.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/translationReadability.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/worker/index.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/worker/jobLifecycle.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/worker/scoringWorkflow.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/worker/translateWorkflow.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/digest-compiler/index.ts`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/package.json`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiFetch.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiSubtitles.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiTranscription.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiVision.js`
- External research sources:
  - `https://docs.foglamp.dev/ai-instrument.md`
  - `https://docs.foglamp.dev/sdk/hud`
  - `https://docs.foglamp.dev/concepts/data-model.md`
  - `https://docs.foglamp.dev/api-reference/introduction.md`
  - `https://docs.foglamp.dev/dashboard/account.md`
  - `https://docs.foglamp.dev/self-hosting/overview.md`
  - `https://www.foglamp.dev/pricing`
  - `https://github.com/foglamp-labs/foglamp`
  - `/tmp/foglamp-source` at `9f028d7` on `origin/master`
- Assumptions:
  - The user wants a plan for a customized XOT-native dashboard, not immediate implementation.
  - The already-dirty Foglamp integration worktree is intentional and should not be reverted by the future implementer.
  - Hosted Foglamp may remain useful for external traces, but XOT's dashboard must not depend on hosted Foglamp read APIs.
  - Pricing and plan limits are drift-prone; the plan uses the 2026-07-03 observed free tier as a default only, not as a hard-coded business fact.

## Executive Goal

Build a native XOT process observability experience inside the existing dashboard so an operator can open XOT and immediately see what is running, what is stuck, what is spending tokens/spans, what is waiting for posting, and where to drill down.

The important product decision is this: do not copy Foglamp's SaaS dashboard into XOT, and do not make hosted Foglamp the source of truth for the XOT dashboard. Instead:

- Use Foglamp's open-source trace/span/workflow vocabulary and HUD event model as the technical pattern.
- Store XOT-owned run, AI-call, process-event, and budget summaries in Supabase.
- Render XOT-styled process observability in the existing Dashboard and Monitoring surfaces.
- Keep Foglamp hosted/self-hosted ingest optional as an external correlation/export path.
- Enforce XOT's own conservative monthly trace/span cap before sending anything to hosted Foglamp.

The dashboard should cover AI and non-AI process health. Foglamp only observes Vercel AI SDK model/tool spans. It will not, by itself, explain Telegram delivery, X posting, media downloads, queue stalls, cron cadence, or RSS ingest. XOT's value comes from joining AI traces to the existing pipeline state.

## Source Of Truth Contract

- Intent: make XOT's own dashboard the primary observability surface for real XOT processes, using Foglamp's open-source model where it improves trace structure and local live development.
- Current behavior: Dashboard already summarizes pipeline health, OpenAI usage from `jobs.result_meta`, X local usage from existing ledgers, resource risk, lane pressure, and queue state. Monitoring already provides per-post drill-down through delivery summaries and `pipeline_events`. Foglamp is only partially wired in the current dirty tree: root dependencies include `ai`, `@ai-sdk/openai`, and `foglamp`; `src/App.tsx` renders a dev-only `FoglampHUD`; `_shared/foglampOpenAI.ts` wraps AI SDK v6; only admin translation preview uses it.
- Expected outcome: Dashboard gains an XOT-native "AI Ops" or "Process Observability" surface with live/recent workflow runs, AI call costs, trace budget, failures, p95 duration, and links into Monitoring. Monitoring gains a trace-context panel for a selected post/run. Settings gains observability controls and status, not a trace browser.
- Truth owner: Supabase rows owned by XOT: `workflow_runs`, `ai_call_ledger`, `observability_events` or linked `pipeline_events`, `budget_ledger`, `x_deliveries`, `x_api_events`, `jobs`, `posts`, and admin action summaries. Foglamp trace IDs are correlation fields, not the canonical process record.
- Contract boundary: schema, Edge Function helpers, OpenAI/Foglamp wrapper, worker instrumentation, admin-actions read APIs, frontend data normalizers, Dashboard/Monitoring/Settings UI, local live stream, redaction, budget enforcement, release validation.
- Displaced path: the existing `openai_usage` dashboard summary derived from scattered `jobs.result_meta` remains as a compatibility fallback, but it should be displaced by `ai_call_ledger` after dual-write and shadow comparison. The generic floating `FoglampHUD` should not become the product dashboard surface; it remains optional/dev-only or is replaced by an XOT-styled embedded panel.
- Cutover:
  1. Keep the current preview-only Foglamp slice intact while adding XOT-owned ledgers and settings.
  2. Dual-write new ledger rows from one real AI path.
  3. Shadow compare dashboard summaries against existing `jobs.result_meta` and `x_api_events`.
  4. Switch Dashboard/Monitoring read paths to the new summaries with fallbacks.
  5. Expand instrumentation to worker, enrichment, digest, and renderer paths.
  6. Only after local budget/redaction is proven, enable hosted Foglamp export beyond admin preview.
- Acceptance evidence: a real admin-visible workflow produces XOT ledger rows, dashboard summaries, Monitoring drill-down, and, when enabled and under cap, optional Foglamp trace correlation; tests/build checks pass; browser screenshots verify desktop/mobile dashboard and Monitoring drawer; no prompt/output/secrets are stored or shown by default.
- Evidence lane: local source diffs, migrations, Deno/Vitest output, dashboard payloads, Supabase rows, browser screenshots, live local dev server, optional Foglamp ingest response/trace link, production release checks after deployment.
- Kill criteria: stop or disable hosted Foglamp export if prompt/output text leaks, `FOGLAMP_API_KEY` reaches the browser, monthly span budget would be exceeded, Foglamp returns quota `429` before XOT stopped sending, admin auth boundaries change unexpectedly, or dashboard data cannot be tied back to real XOT rows.
- Forbidden moves:
  - Do not rely on hosted Foglamp dashboard reads for XOT's dashboard; the checked public API is ingest-oriented.
  - Do not hard-code the free-tier number as permanent. Store an operator-configured cap.
  - Do not treat batch/cron/pipeline ids as `sessionId`.
  - Do not attach `customer` unless XOT has real distinct end-customers/tenants.
  - Do not put dynamic tweet ids, job ids, URLs, slugs, dates, model names, accounts, or run ids in `agentName`, `workflowName`, or `traceName`.
  - Do not trace all worker traffic to hosted Foglamp before local cap, sampling, redaction, and ledger writes are proven.
  - Do not create fake smoke endpoints, demo jobs, or synthetic traces to make the dashboard look populated.
  - Do not let observability failures block translation, scoring, posting, or delivery.

## Native Planning Superiority

- Codex Native baseline: a generic plan would likely say "embed the Foglamp dashboard/HUD" and "use the free plan" without noticing that XOT already has operational truth in Supabase, that the Foglamp public API is write-oriented, that the HUD broker is Node-only/dev-only, and that posting/Telegram/media workflows are not AI spans.
- What this plan does better: it maps Foglamp's open-source concepts onto XOT's existing dashboard, Monitoring drawer, admin-actions, Edge Functions, and X/Post ledgers; it separates AI traces from non-AI process state; it defines a local budget gate before hosted ingest; and it gives an implementation orchestrator a phased, testable path.
- User-specific context used: prior memory routed the work toward XOT's real dashboard/settings/control-plane surfaces and warned against assuming Foglamp read APIs or quota behavior. Current source and docs were rechecked before using those hints.
- Superiority score target: 5
- Proof artifacts: this saved plan file, active planning goal, subagent closeouts, current repo status, local Foglamp source inspection, official Foglamp docs/pricing checks, and exact file references.

## Orchestration Decision

- Mode: full worker run
- Worker count: 4
- Decision reason: the plan spans UI/product workflow, backend data contracts, Foglamp OSS adaptation, and operational/free-tier guardrails. Each lane needed distinct evidence.
- Independent surfaces:
  - XOT Dashboard, Monitoring, Settings, and tests.
  - Supabase schema, admin-actions, worker, AI helpers, and process ledgers.
  - Foglamp SDK/HUD open-source source, event model, broker, data model, ingest API, self-hosting, and licenses.
  - Release, auth, redaction, budget, pricing, and validation behavior.
- Workers used or skipped:
  - Used UI/product workflow worker. Accepted: Dashboard should own summary; Monitoring should own per-post drill-down; Settings should own controls/status only.
  - Used backend/data worker. Accepted: XOT needs `workflow_runs`, durable AI-call ledger, budget ledger, and correlation to existing `pipeline_events`, `x_deliveries`, and `x_api_events`.
  - Used Foglamp OSS worker. Accepted: use Foglamp vocabulary/HUD event contract/reducer idea; avoid copying SaaS dashboard; public API is not a read API; HUD broker is Node-only.
  - Used operations worker. Accepted: enforce local cap below/inside free tier; set production redaction; keep API key server-side; do not expand beyond preview before guardrails.
- Thread decision: no visible Codex thread. This is one repo-local plan intended for a later implementation orchestrator.
- Token/context rationale: distinct subagents reduced duplicated scanning across UI, backend, OSS, and operations, while the parent retained synthesis authority.
- Reconsider trigger: add a follow-up planning worker only if the implementation target changes to full self-hosted Foglamp, a separate public customer-facing dashboard, or multi-tenant customer attribution.

## Background Browser Lane

- Needed: no
- Target/surface: none
- Safety boundary: no login, no Foglamp account changes, no production traces, no dashboard data mutation during planning.
- Required receipt: not applicable.
- Stop condition: not applicable.

## Research And Inspiration Findings

### Foglamp Data Model

Adopt:

- Trace = one top-level AI SDK model call.
- Span = model/tool/agent/embedding/other unit with timing, status, provider/model, usage, and optional redacted input/output.
- Workflow/run = repeatable process plus one execution, using `workflowName` and `workflowRunId` together.
- Agent = reusable named AI behavior.
- Session = real conversation/user interaction only.
- Customer = real end-customer/tenant only.

Adapt:

- XOT should add a broader `workflow_runs` concept for both AI and non-AI work. Foglamp traces become correlated AI spans inside that process, not the full process itself.
- XOT's process lanes should be operator vocabulary: RSS ingest, duplicate gate, scoring, translation, readability repair, enrichment, media, Telegram, X posting, digest, video render.

Avoid:

- Dynamic names. Use static names like `"rss-item-pipeline"`, `"translation-preview"`, `"importance-scorer"`, `"translator"`, `"readability-repair"`, `"enrichment-writer"`, `"digest-summarizer"`, `"video-renderer-ai"`.
- Mapping `/threads` tweet/content threads to `sessionId`.
- Treating source accounts, feeds, authors, channels, or X handles as `customer`.

Not relevant yet:

- Foglamp customer rollups, unless XOT becomes a multi-tenant product serving distinct customers.

### Foglamp HUD And OSS Source

Adopt:

- The live event vocabulary: `trace.start`, `step.start`, `step.firstToken`, `step.tokens`, `tool.start`, `tool.end`, `step.end`, `trace.end`.
- The reducer pattern: incremental live state that is reconciled with final trace summaries.
- The same-origin SSE proxy pattern from the HUD demo when a local long-running Node process exists.

Adapt:

- Build XOT-styled embedded process panels instead of using Foglamp's floating branded panel as the primary dashboard UI.
- Keep `<FoglampHUD redact />` only as a dev convenience or replace it with an XOT panel backed by the same event shape.
- If vendoring HUD reducer/model pieces, preserve license notices and mark modifications.

Avoid:

- Copying Foglamp's SaaS dashboard, brand assets, demo CTAs, or full overlay styling.
- Assuming Supabase Edge Functions can power the HUD broker. The official HUD docs say the broker needs a long-lived Node runtime and is ignored on edge/serverless/prod.

### Foglamp API, Pricing, And Quota

Adopt:

- Hosted ingest can still receive traces when enabled and under local cap.
- As of the 2026-07-03 pricing page check, the free plan advertised `10,000` spans/month and 3 days retention. Treat this as a default value to configure, not a stable invariant.
- The account docs say span quota exhaustion turns into ingest `429`. The API docs distinguish quota `429` from rate-limit `429`, and state SDK failed batches are routed to error handling and dropped.

Adapt:

- XOT should enforce `FOGLAMP_MONTHLY_SPAN_CAP` locally before hosted ingest. Recommended initial default: `8000` spans/month, warn at `6000`, hard-stop hosted export at `8000`, continue XOT local ledgers.
- XOT dashboard should show local estimated spans used, cap, warning threshold, stopped state, last Foglamp ingest error, and whether hosted export is enabled.

Avoid:

- Retrying quota `429` as if it were normal rate limiting.
- Depending on a hosted read/query API for Dashboard data. The checked OpenAPI exposed `/health` and `/ingest`.

### XOT Existing Product Surface

Adopt:

- Dashboard remains aggregate triage: current tabs, pipeline speed, resource risk, lane pressure, OpenAI usage, X cost guard.
- Monitoring remains drill-down and action surface: per-post table/cards, detail drawer, delivery timeline, scoring/enrichment explanation, retry actions.
- Settings remains control/status: translation playground, automation settings, rate limits, budget controls.

Adapt:

- Add an `AI Ops` or `Process Observability` dashboard tab after `pipeline` and before `x`, or add a dense observability band inside the existing pipeline tab first if adding another tab is too heavy.
- Extend the Monitoring drawer with `TraceContextPanel` rather than introducing a separate "trace details" route first.
- Reuse existing dark operational UI patterns and card density. Avoid decorative trace visualizations.

Avoid:

- A new top-level nav item in the first release unless the embedded dashboard tab becomes too dense.
- Raw JSON-first interfaces.
- UI text that claims live status when it is only historical or inferred.

## Current State

### Worktree And Dependency State

The worktree is already dirty with Foglamp-related changes:

- Modified: `deno.lock`, `package-lock.json`, `package.json`, `src/App.tsx`, `src/test/setup.ts`, `supabase/functions/admin-actions/translationRescoreActions.ts`.
- Untracked: `docs/plans/2026-07-01-foglamp-tracing-implementation-plan.md`, `supabase/functions/_shared/foglampOpenAI.ts`.
- Root dependencies currently include `ai@6.0.217`, `@ai-sdk/openai@3.0.79`, and `foglamp@0.7.0`.
- `services/video-renderer` does not currently have Foglamp or AI SDK dependency coverage.

Implementation must preserve this dirty worktree and reconcile it, not revert it.

### Dashboard

Existing Dashboard has:

- `DASHBOARD_TAB_IDS = ['activity', 'pipeline', 'x', 'controls']`.
- Triage cards for needs attention, failed/stuck, ready to deliver, translation queue, X failed, stale jobs.
- Pipeline speed, resource risk, lane pressure, scoring tuning, pipeline funnel, X cost guard.
- OpenAI usage card derived from completed job metadata.
- Local X usage summary from X ledgers/fallbacks.

The dashboard is already the right home for process observability. It needs a better data contract and trace-aware views, not a separate product.

### Monitoring

Existing Monitoring has:

- Per-post state from posts, jobs, delivery, dedupe, enrichment, X status, and `pipeline_events`.
- `MonitoringDetailDrawer` with "Why this is here", duplicate gate, Telegram/X state, "Why not on X?", scoring, enrichment, and content/media.
- `MonitoringDeliveryTimeline` that already groups delivery state first and internal pipeline work second, with OpenAI represented by a Sparkles icon.

Monitoring is the right drill-down target for a specific post/run.

### Backend And Data Sources

Existing process state is fragmented:

- `pipeline_events` has `subject_type`, `subject_id`, `step`, `status`, `started_at`, `ended_at`, `error`, `actor`, `meta`.
- `jobs.result_meta` carries scattered `translation_usage`, `scoring_usage`, `scoring_v2_usage`, and generic `usage`.
- `dashboardSummaries.ts` reads `jobs` to derive `openai_usage`.
- `x_deliveries` is the posting/claim ledger.
- `x_api_events` is the canonical local X API usage ledger.
- `x_deliveries.post_id` joins to `posts.tweet_id`, not `posts.id`.

`pipeline_events` is useful but not enough for durable observability by itself because it is narrow, best-effort, and subject to cleanup.

### AI Call Coverage

Currently instrumented:

- Admin translation preview only, via `callOpenAIWithFoglamp()` from `translationRescoreActions.ts`.
- Root React renders a dev-only `FoglampHUD`, but a local broker is not guaranteed.

Not yet covered:

- Worker scoring, translation, combined score/translate, readability repair.
- `_shared/enrich.ts` multi-step enrichment calls.
- `_shared/dedupe.ts` embeddings and adjudicator calls.
- Worker moderation direct OpenAI fetch.
- `digest-compiler/index.ts` direct chat-completions fetch.
- `services/video-renderer` transcription/subtitle/vision OpenAI calls.
- Non-AI pipeline processes: RSS ingest, duplicate gate, media download, Telegram, X posting, scheduler/cron.

## Future State

### User Workflow

When the operator opens Dashboard:

1. The top-level status still tells whether XOT is healthy.
2. A new AI/process observability area shows:
   - active workflow runs,
   - recent failures,
   - slow lanes,
   - AI token/cost/span usage,
   - hosted Foglamp export state,
   - trace budget remaining,
   - last trace/ingest error,
   - clear links to Monitoring filtered by the problem.
3. The operator can tell within 10 seconds whether the issue is AI generation, queue/worker delay, media, Telegram, X posting, or budget/cap.

When the operator opens Monitoring and selects a post:

1. Existing delivery timeline remains the primary narrative.
2. A trace-context panel shows the XOT workflow run, AI calls, durations, token usage, model/provider, status, and Foglamp correlation if present.
3. Non-AI steps appear as XOT process events, not fake AI spans.

When the operator opens Settings:

1. Observability status shows configured/not configured, hosted export enabled/disabled, local cap, current monthly estimate, redaction mode, local HUD/broker state.
2. The operator can change safe controls: enabled, sampling, monthly cap, warning threshold, record text in dev only, and kill switch.
3. The settings page does not become a trace browser.

### Data Model

Recommended first durable model:

1. `workflow_runs`
   - Purpose: one row per logical XOT process run.
   - Key fields: `id`, `run_key`, `workflow_name`, `subject_type`, `subject_id`, `tweet_id`, `story_cluster_id`, `job_id`, `source`, `source_function`, `env`, `deploy_sha`, `status`, `started_at`, `ended_at`, `root_trace_id`, `foglamp_workflow_run_id`, `metadata`, `created_at`, `updated_at`.
   - `run_key` is the externally meaningful grouping id, for example `post:<tweet_id>:job:<job_id>` or `admin-preview:<uuid>`.
   - `workflow_name` is a static string literal.

2. `ai_call_ledger`
   - Purpose: one durable row per OpenAI/model call, regardless of whether Foglamp hosted export is enabled.
   - Key fields: `id`, `workflow_run_id`, `job_id`, `tweet_id`, `story_cluster_id`, `operation_name`, `agent_name`, `trace_name`, `provider`, `model`, `endpoint`, `status`, `http_status`, `error_code`, `error_message`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens`, `request_count`, `duration_ms`, `attempt`, `source_function`, `foglamp_trace_id`, `foglamp_span_id`, `metadata`, `started_at`, `ended_at`.
   - Store redacted, bounded metadata only. Do not store prompts/outputs by default.

3. `observability_events`
   - Purpose: normalized process events across AI and non-AI lanes.
   - Key fields: `id`, `workflow_run_id`, `parent_event_id`, `subject_type`, `subject_id`, `tweet_id`, `job_id`, `lane`, `step`, `operation_name`, `span_kind`, `status`, `started_at`, `ended_at`, `duration_ms`, `source_function`, `provider`, `model`, `trace_id`, `span_id`, `attempt`, `sequence`, `error`, `metadata`.
   - This table can be introduced after phase 1 if migration risk is high. Phase 1 can add `workflow_run_id` links in `pipeline_events.meta` and read from the existing table while the new event table is prepared.

4. `budget_ledger`
   - Purpose: local usage/cost/span accounting for OpenAI, Foglamp hosted export, X API, and later renderer operations.
   - Key fields: `id`, `provider`, `unit`, `quantity`, `estimated_cost_usd`, `workflow_run_id`, `source_table`, `source_id`, `period_key`, `metadata`, `created_at`.
   - Feed OpenAI rows from `ai_call_ledger`, Foglamp span estimates from local trace plan, and keep X API truth in `x_api_events` with summarized import/correlation rather than replacing it.

5. `observability_settings`
   - Purpose: admin-controlled settings. This can be a dedicated table or existing `settings` rows.
   - Keys: `enabled`, `hosted_export_enabled`, `monthly_span_limit`, `monthly_span_cap`, `warn_span_count`, `sampling_rate`, `record_inputs`, `record_outputs`, `dev_hud_enabled`, `metadata_redaction_mode`, `retention_days`, `kill_switch_reason`.

### Workflow And Name Mapping

Use these static names as the starting contract:

| Surface | `workflowName` | `agentName` or `traceName` | Dynamic data location |
| --- | --- | --- | --- |
| Admin translation preview | `"translation-preview"` | `"translator"`, `"readability-repair"` | `workflowRunId = admin-preview:<uuid>`, metadata `step`, `endpoint`, `model` |
| Worker RSS item pipeline | `"rss-item-pipeline"` | `"importance-scorer"`, `"translator"`, `"readability-repair"` | `workflowRunId`, `tweet_id`, `job_id`, `post_id` in run key/metadata |
| Enrichment chain | `"enrichment-pipeline"` | `"archivist"`, `"researcher"`, `"analyst"`, `"humanizer"`, `"composer"`, `"voice-critic"`, `"critic"` | `tweet_id`, `story_cluster_id`, cache key in metadata |
| Dedupe adjudication | `"dedupe-pipeline"` | `"duplicate-adjudicator"` | candidate ids and story cluster in metadata |
| Digest compiler | `"digest-compiler"` | `"digest-summarizer"` | digest id/date in `workflowRunId` and metadata |
| Video renderer | `"video-renderer-ai"` | `"subtitle-translator"`, `"transcription-cleaner"`, `"vision-checker"` | render id/media id in `workflowRunId` and metadata |
| X posting | XOT process event only | no AI `agentName` | `x_deliveries`, `x_api_events`, metadata |
| Telegram delivery | XOT process event only | no AI `agentName` | delivery rows/events |

## Non-Goals

- Do not build a replacement for Foglamp SaaS in the first release.
- Do not self-host Foglamp as the default path. Self-hosting remains a future option.
- Do not expose raw prompt/response payloads in XOT's dashboard by default.
- Do not instrument every worker path before budget/redaction/local ledgers are in place.
- Do not add public or non-admin observability routes.
- Do not treat Foglamp HUD as production monitoring.
- Do not make X posting, Telegram, media, or cron look like AI agents.
- Do not run real force-posting smoke tests just to populate observability.

## Phase Plan

### Phase 0: Stabilize The Existing Foglamp Slice

Goal: make the current dirty Foglamp preview work explicit, safe, and testable before building on it.

Tasks:

- Confirm the current dependency state:
  - `npm ls ai @ai-sdk/openai foglamp --depth=0`
  - `npm --prefix services/video-renderer ls ai @ai-sdk/openai foglamp --depth=0`
- Add or update documentation for server-side-only Foglamp env vars without printing secrets:
  - `FOGLAMP_API_KEY`
  - `FOGLAMP_INGEST_URL`
  - `FOGLAMP_ENABLED`
  - `FOGLAMP_MONTHLY_SPAN_LIMIT`
  - `FOGLAMP_MONTHLY_SPAN_CAP`
  - `FOGLAMP_RECORD_INPUTS=false`
  - `FOGLAMP_RECORD_OUTPUTS=false`
- Change `foglampOpenAI.ts` defaults so production text capture is off and `hud` is not treated as useful on Edge.
- Add tests for:
  - no API key is no-op,
  - static names are passed,
  - response shape remains compatible with existing preview flow,
  - metadata is bounded and string-safe,
  - built-in tool unsupported path remains explicit.
- Keep the current `FoglampHUD` root render dev-only, but render it with `redact` if it remains present.

Acceptance:

- Current admin Translation Playground behavior is unchanged.
- No prompt/output text is sent or stored by default in production configuration.
- Foglamp export can be disabled without breaking model calls.

### Phase 1: XOT-Owned Observability Foundation

Goal: create the local truth layer that the dashboard will read.

Tasks:

- Add migration for `workflow_runs`, `ai_call_ledger`, and `budget_ledger`.
- Decide whether `observability_events` is added now or introduced in phase 2. If deferred, store `workflow_run_id` and event correlation in `pipeline_events.meta`.
- Add RLS/service-role policies:
  - service role writes,
  - authenticated admins read/manage through admin-actions,
  - no public/browser direct writes.
- Regenerate Supabase types.
- Add shared helpers:
  - `getOrCreateWorkflowRun`
  - `recordObservabilityEvent`
  - `recordAiCall`
  - `recordBudgetUsage`
  - `withObservedOpenAI`
  - `shouldExportFoglampTrace`
- Add local budget evaluator:
  - monthly period key,
  - estimated hosted span count,
  - warn threshold,
  - cap threshold,
  - kill switch,
  - sampled/blocked reasons.
- Dual-write admin translation preview calls into `ai_call_ledger` and `workflow_runs`, even when hosted Foglamp is disabled.

Acceptance:

- One real admin preview run produces a `workflow_runs` row and one or more `ai_call_ledger` rows.
- Hosted Foglamp export is blocked locally when cap says stop.
- Ledger writes failing are captured as warnings/errors but do not block the AI call response.

### Phase 2: Admin API And Dashboard Summary Contract

Goal: make observability data available through existing admin-actions/dashboard data flow.

Tasks:

- Extend `admin-actions` with read actions:
  - `get_process_observability_summary`
  - `get_process_observability_runs`
  - `get_process_observability_run_detail`
  - `get_ai_usage_summary`
  - `get_observability_budget_summary`
- Or, if keeping one dashboard request, extend `get_dashboard_summary` with a `process_observability` object.
- Add TypeScript normalizers in `src/api/dashboardData.ts`.
- Add run-detail normalizers in `src/api/monitoringData.ts` if Monitoring drawer needs embedded details.
- Keep fallbacks to current `openai_usage` until `ai_call_ledger` has enough coverage.
- Include provenance in every summary:
  - `source: "ai_call_ledger" | "jobs_result_meta_fallback" | "x_api_events" | "pipeline_events"`
  - `generatedAt`
  - `coverage`
  - `partialReason`

Acceptance:

- Dashboard can render an empty, partial, or complete observability summary without crashing.
- The API does not expose `FOGLAMP_API_KEY`.
- Admin auth remains unchanged.
- Existing dashboard tests still pass after contract extension.

### Phase 3: Dashboard And Monitoring UI

Goal: turn local process data into operator-visible value.

Tasks:

- Add a dashboard tab id such as `ai-ops` or a first-pass observability band in the `pipeline` tab.
- Build `ProcessObservabilityPanel` with:
  - active runs,
  - failed runs,
  - slow lanes,
  - AI token/cost usage,
  - hosted trace budget used,
  - last Foglamp ingest error,
  - last successful trace,
  - trace coverage percentage.
- Build lane cards:
  - RSS ingest,
  - duplicate gate,
  - scoring,
  - translation,
  - readability repair,
  - enrichment,
  - media,
  - Telegram,
  - X posting,
  - video render.
- Add a recent workflow runs table/list with deterministic sort:
  - status,
  - workflow,
  - subject/tweet,
  - started,
  - duration,
  - AI calls,
  - tokens,
  - trace export state,
  - link to Monitoring/details.
- Add `TraceContextPanel` to `MonitoringDetailDrawer`:
  - workflow run id,
  - AI calls grouped by operation,
  - model/provider,
  - duration,
  - tokens,
  - status/error,
  - trace missing/export skipped reason,
  - optional Foglamp trace/workflow link if a verified URL pattern exists.
- Extend `MonitoringDeliveryTimeline` only where useful:
  - keep delivery states first,
  - annotate OpenAI steps with run/call evidence,
  - keep non-AI process steps as process steps.
- Add Settings observability status/control card:
  - server key present/missing without value,
  - hosted export enabled/disabled,
  - monthly cap and usage,
  - warning/blocked status,
  - redaction mode,
  - local live broker state,
  - last trace seen.

Acceptance:

- Dashboard answers "what is going on right now?" without opening external tools.
- Monitoring answers "what happened to this post?" end to end.
- Settings answers "is observability safe and under budget?"
- Empty/partial states are explicit: "trace not captured", "hosted export disabled", "HUD broker offline", "usage from fallback metadata".
- Desktop and mobile screenshots show no overflow in tabs, panels, run rows, drawer content, or RTL Persian text blocks.

### Phase 4: Broader Instrumentation

Goal: expand from preview-only tracing to real production-relevant AI paths after the dashboard foundation is safe.

Tasks:

- Refactor `_shared/openai.ts` or wrap it with `withObservedOpenAI` so common Chat/Responses paths write the local AI ledger.
- Propagate `workflow_run_id` through worker job payloads and `result_meta`.
- Instrument:
  - worker scoring,
  - worker translation,
  - readability repair,
  - enrichment agent chain,
  - dedupe adjudicator,
  - moderation direct fetch,
  - digest compiler direct fetch.
- Treat embeddings/audio/vision carefully:
  - local ledger can capture provider, endpoint, duration, usage where available,
  - do not claim Foglamp captures embeddings/audio/vision unless verified in current SDK/docs.
- Add renderer package instrumentation only after its package/dependency boundary is explicit.
- Add sampling policy:
  - admin/manual runs: 100 percent local ledger, hosted export while under cap,
  - production worker normal traffic: sampled hosted export,
  - failures/slow calls: local ledger always, hosted export only if cap allows,
  - near cap: hosted export disabled, local ledger continues.

Acceptance:

- Every OpenAI call either has an `ai_call_ledger` row or a documented exception.
- Every worker step has a workflow run correlation.
- Dashboard usage from `ai_call_ledger` matches or explains differences from old `jobs.result_meta` summary.
- Hosted export volume remains below cap.

### Phase 5: Local Live Panel And HUD Customization

Goal: provide a useful local development stream without depending on production Foglamp or Edge runtime HUD support.

Tasks:

- Decide live source:
  - Option A: keep Foglamp SDK HUD for Node-only local processes like video renderer and proxy `/hud/events` to `127.0.0.1:<hudPort>/events`.
  - Option B: build XOT-owned dev SSE broker that emits Foglamp-shaped events from local observed calls and recent ledger writes.
  - Option C: start with historical auto-refresh only and defer live SSE.
- Build `XotLiveTracePanel` using Foglamp's event vocabulary/reducer pattern, styled as XOT operational UI.
- If vendoring HUD reducer/model source:
  - preserve license notice,
  - isolate adapted files under a clear path,
  - avoid Foglamp brand assets.
- Add local dev status:
  - broker health,
  - last event time,
  - connected/disconnected,
  - redacted mode.
- Keep `<FoglampHUD />` as optional dev overlay only if it still provides value; otherwise replace with embedded panel.

Acceptance:

- Local dashboard shows live events only when a broker is actually running.
- Without a broker, the UI degrades to historical summaries and says so.
- No production code path depends on the local live broker.

### Phase 6: Hardening, Release, And Operations

Goal: make the feature production-safe and maintainable.

Tasks:

- Add retention policy for detailed events and ledgers.
- Add admin audit logging for observability setting changes.
- Add alert thresholds:
  - high AI error rate,
  - high p95 latency,
  - trace budget warning,
  - trace export stopped,
  - OpenAI quota/rate failures,
  - X posting failures.
- Add runbook:
  - how to disable hosted export,
  - how to rotate Foglamp key,
  - how to confirm dashboard data provenance,
  - how to verify no prompt text is stored,
  - how to run local dev dashboard.
- Shadow compare old and new summaries for at least one release cycle before deleting old fallback logic.

Acceptance:

- The feature can be rolled back with a setting/kill switch.
- Operators can distinguish "XOT process problem" from "Foglamp export problem".
- Release checklist has exact commands and browser checks.

## Task Backlog

### Schema And Types

- Add migration for `workflow_runs`.
- Add migration for `ai_call_ledger`.
- Add migration for `budget_ledger`.
- Add migration or future migration for `observability_events`.
- Add indexes:
  - `workflow_runs(run_key)`
  - `workflow_runs(workflow_name, started_at desc)`
  - `workflow_runs(tweet_id, started_at desc)`
  - `ai_call_ledger(workflow_run_id, started_at)`
  - `ai_call_ledger(tweet_id, started_at desc)`
  - `ai_call_ledger(model, started_at desc)`
  - `budget_ledger(provider, unit, period_key)`
  - `observability_events(workflow_run_id, sequence)`
- Add RLS/service-role policies.
- Regenerate `src/integrations/supabase/types.ts`.

### Edge Functions And Helpers

- Create `supabase/functions/_shared/observability.ts`.
- Create `supabase/functions/_shared/observabilityBudget.ts`.
- Refactor `supabase/functions/_shared/foglampOpenAI.ts` into a dual-write wrapper or adapt it to call shared observability helpers.
- Add metadata whitelist utilities.
- Add redaction utilities.
- Add span estimation utilities.
- Add safe `onError` handling for Foglamp export failures.
- Update `translationRescoreActions.ts` first.
- Update `_shared/openai.ts` second.
- Update worker/enrichment/dedupe/digest/renderer paths in later slices.

### Admin Actions

- Extend `dashboardSummaries.ts` with process observability summaries.
- Extend `monitoringReads.ts` with workflow run and AI-call lookup by `tweet_id`/subject.
- Add contract tests in `admin-actions-contract.test.ts`.
- Add Deno tests for summary calculations, partial data, and auth boundaries.

### Frontend API

- Add `ProcessObservabilitySummary` types in `src/api/dashboardData.ts`.
- Add normalizers with defensive defaults.
- Add trace/run detail types in `src/api/monitoringData.ts`.
- Update tests for partial/empty data.

### Dashboard UI

- Add `ProcessObservabilityPanel`.
- Add lane summary cards.
- Add recent workflow runs table/list.
- Add budget/cap card.
- Add trace export health card.
- Add route/filter links into Monitoring.
- Update dashboard tests.

### Monitoring UI

- Add `TraceContextPanel`.
- Add trace badges to row/card summary only when backed by data.
- Extend timeline display model if needed, not by raw database shape.
- Add drawer tests for loaded, missing, skipped, failed, and partial trace states.

### Settings UI

- Add observability status/control card near existing AI/translation/rate-limit controls.
- Show server-side key presence only, never the value.
- Show hosted export enabled, monthly cap, usage, warning, stopped state.
- Add save/test status for settings without producing fake traces.

### Documentation

- Update README env section.
- Add `docs/operations/observability-runbook.md`.
- Update release runbook with validation commands and browser checks.
- Add license attribution if any Foglamp source is vendored.

## Acceptance Criteria

### Product Acceptance

- Dashboard gives an operator a fast answer to:
  - What is running?
  - What is stuck?
  - Is it AI, queue, media, Telegram, or X?
  - Are we near hosted trace budget?
  - Where do I click next?
- Monitoring explains a single post/run end to end without requiring Foglamp dashboard access.
- Settings explains whether observability is configured, safe, redacted, and under budget.
- Hosted Foglamp is optional. Turning it off does not remove XOT's local observability.

### Data Acceptance

- Each instrumented AI call writes a local ledger row.
- Each multi-step process has a workflow run id.
- X posting state remains sourced from `x_deliveries`; X API usage remains sourced from `x_api_events`.
- Dashboard summaries include provenance and partial-state reasons.
- No dynamic values appear in static Foglamp names.
- No raw prompt/output text is stored or displayed by default.

### Budget Acceptance

- XOT enforces a local hosted-Foglamp span cap before sending traces.
- Default cap is configurable and initially conservative.
- Hosted export stops before the configured cap.
- Local XOT ledgers continue when hosted export is stopped.
- Dashboard shows trace budget, cap, warning, stopped state, and last error.

### Security/Privacy Acceptance

- `FOGLAMP_API_KEY` is never exposed as `VITE_*`, browser state, logs, screenshots, or admin API payload.
- Production defaults set input/output capture off.
- Metadata is whitelisted, bounded, and string-safe.
- Admin-only access remains behind current admin-actions auth.
- Any vendored Foglamp source carries correct license attribution.

### UI Acceptance

- Dashboard desktop and mobile layouts are scannable and do not overflow.
- Monitoring drawer remains readable with Persian/RTL content.
- Empty states are explicit and operational, not decorative.
- The local live panel says when it is offline instead of implying live data.

## Validation Plan

### Pre-Implementation Checks

Run before editing:

```bash
git status --short --branch
npm ls ai @ai-sdk/openai foglamp --depth=0
npm --prefix services/video-renderer ls ai @ai-sdk/openai foglamp --depth=0
npm run check:release-state
```

### Focused Backend Checks

```bash
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run test:functions
```

Add focused Deno tests for:

- `withObservedOpenAI` success write.
- `withObservedOpenAI` failure write.
- hosted export disabled no-op.
- span budget warning and stop.
- metadata whitelist/redaction.
- admin preview response compatibility.
- dashboard summary from new ledgers.
- fallback summary from old metadata.

### Frontend Checks

```bash
npm run lint
npm run check:strict
npm test
npm run build
```

Add focused Vitest/RTL tests for:

- dashboard data normalizer handles missing `process_observability`.
- dashboard panel loaded/empty/partial/error states.
- trace budget card warning/stopped states.
- Monitoring drawer trace panel loaded/missing/skipped states.
- Settings observability control card.

### Browser Checks

Start local dashboard with the known env pattern:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Inspect:

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/monitoring`
- `http://127.0.0.1:5173/settings`

Required screenshots/checks:

- Dashboard desktop with Process Observability visible.
- Dashboard mobile around 390px width.
- Monitoring desktop with drawer open on a post with trace data.
- Monitoring drawer missing-trace state.
- Settings observability status/control card.
- No text overflow in tabs, cards, run rows, drawer footer, badges, or RTL/Persian blocks.

### Real Flow Checks

Do not create synthetic traces. Use real existing flows:

- Admin Translation Playground preview with a non-sensitive sample.
- Worker run only after budget/redaction gates are enabled.
- Renderer run only after renderer package boundary is instrumented.

Acceptance evidence for the first real flow:

- `workflow_runs` row exists.
- `ai_call_ledger` row exists.
- Dashboard summary updates.
- Monitoring/run detail can find the run if tied to a post.
- Hosted Foglamp export is either skipped with a clear reason or accepted under cap.
- No raw prompt/output appears in local rows or external trace view unless explicitly enabled in a dev-only test.

### Release Checks

Follow the existing release runbook:

- release from clean `main` after review,
- deploy selected Supabase functions only,
- run `check:release-state` pre/post,
- verify `https://xot.iraneyes.com` and `https://xot.vercel.app`,
- log in as admin,
- load Dashboard/Monitoring/Settings,
- confirm admin-actions version,
- do not force X posting as a smoke test.

## Risks And Dependencies

- Foglamp pricing and free-tier limits can change. Mitigation: make limits settings, not constants.
- Foglamp public API is currently ingest-oriented. Mitigation: do not build XOT dashboard on hosted reads.
- Supabase Edge cannot reliably run Foglamp HUD broker. Mitigation: use local Node broker/proxy only for dev, and keep historical dashboard local.
- Current `pipeline_events` can be pruned and is not a durable span store. Mitigation: add ledger tables and use `pipeline_events` as timeline/provenance input.
- Existing OpenAI usage summary likely undercounts. Mitigation: dual-write and shadow compare before cutover.
- Some OpenAI paths are direct fetches or unsupported by Foglamp SDK. Mitigation: ledger locally first; only claim Foglamp coverage where the SDK supports it.
- Metadata can leak sensitive text. Mitigation: whitelist, bound, and test redaction.
- More dashboard panels can add clutter. Mitigation: keep first release dense, operational, and route-heavy; avoid decorative charts.
- Existing dirty worktree can hide unintended changes. Mitigation: implementation begins with a status review and preserves unrelated work.

## Implementation Orchestrator Handoff

### Whole-Plan Goal And Loop Contract

When the user asks to run this plan with `implementation-orchestrator`, the default execution mode should be one parent-owned goal for the whole plan, not separate disconnected task goals. The parent goal should stay open while the implementation orchestrator moves through phase slices, checkpoint gates, validation, fixes, and final acceptance.

Recommended goal text:

```text
Goal: Implement the XOT native process observability dashboard plan from docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-plan.md in /Users/stevmq/Finalized XOT.

Done when:
- The parent records repo/path, branch, dirty state, current docs/package state, env/auth limits, selected phase slice, non-goals, acceptance criteria, evidence tier, triggered adversarial classes, and target evidence.
- The parent records the source-of-truth contract for the active slice: owner, boundary, displaced path, cutover, evidence lane, kill criteria, forbidden moves.
- The parent keeps one implementation ledger at docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-ledger.jsonl unless it chooses a better repo-local ledger path and records that path.
- Each phase slice is implemented, integrated, locally validated, checkpointed, and either accepted, rejected, deferred with owner, or blocked with exact evidence.
- Every write-scoped STANDARD/HIGH worker returns a DoneClaim, and the parent accepts, rejects, or marks it unverified after inspection.
- Every HIGH slice receives AdversarialVerify or an explicit blocked/unproven status before it can be called verified.
- checkpoint-quality-loop runs after each meaningful slice and before expanding scope to the next phase.
- engineering-acceptance-review runs after each implemented phase bundle that changes code, data contracts, security/privacy behavior, or user-facing UI.
- Required tests, build checks, browser checks, and real-flow evidence pass, or blocked checks are separated clearly from validated work.
- Runtime resources started for QA have cleanup receipts.
- No live/deploy/auth/Foglamp dashboard verification is claimed from local-only checks.
- The final closeout separates validated locally, verified live, pushed, deployed, blocked, and not checked.

Anti-cheat:
- No fake traces, fake endpoints, synthetic smoke jobs, or force X posting.
- No dynamic trace/workflow/agent names.
- No prompt/output/secret leakage.
- No hidden downgrade from hosted Foglamp export to local-only proof without saying so.
- No closing the main goal because one phase passed while later in-scope phases remain.
```

The implementation loop should run in this rhythm:

1. `Anchor`: use `cognee-memory-sidecar` for bounded recall, then recheck `git status`, package state, current Foglamp docs/source, README/scripts, Supabase auth/config limits, and the active browser route if UI work is included.
2. `Slice`: choose the next phase or sub-slice, classify evidence tier, list adversarial classes, and record target-perspective evidence needed.
3. `Dispatch`: use workers only for distinct scopes. Avoid overlapping write sets. Route every worker to a named skill/tool.
4. `Implement`: make scoped changes and preserve unrelated dirty work.
5. `Integrate`: parent reviews diffs and worker DoneClaims; worker output is a claim, not proof.
6. `Validate`: run focused checks first, then broader checks. Capture real records/routes/UI/traces where applicable.
7. `Checkpoint`: run `checkpoint-quality-loop` before expanding scope, with receipts for audit, planning delta if needed, implementation, engineering acceptance, verification, blocked checks, accepted risks, and cleanup.
8. `Repeat`: fix failed checks, tighten the contract, or move to the next phase only after the checkpoint is accepted.
9. `Close`: complete the main goal only after all selected phases are accepted or explicitly deferred/blocked with owner and evidence.

### Evidence Tiers And Checkpoint Gates

Use these default tiers unless the current code inspection proves a narrower risk:

| Scope | Evidence tier | Required checkpoint behavior |
| --- | --- | --- |
| Phase 0: existing Foglamp preview stabilization | HIGH | Use `checkpoint-quality-loop` after wrapper/config/test changes; require secrets/redaction proof and dirty-worktree accounting. |
| Phase 1: schema, ledgers, budget guardrails | HIGH | Use `checkpoint-quality-loop`; require migration dry-run, RLS/auth proof, redaction proof, and `AdversarialVerify`. |
| Phase 2: admin API/dashboard summary contract | STANDARD, HIGH if auth/query shape changes | Use `checkpoint-quality-loop`; require admin-action contract tests, malformed payload checks, and provenance proof. |
| Phase 3: Dashboard/Monitoring/Settings UI | STANDARD | Use `frontend-design` during implementation and checkpoint with browser screenshots on desktop/mobile before acceptance. |
| Phase 4: broader worker/enrichment/digest/renderer instrumentation | HIGH | Use `checkpoint-quality-loop` per subsystem; require direct OpenAI path inventory, ledger proof, sampling/cap proof, and no behavior regression. |
| Phase 5: local live panel/HUD customization | STANDARD, HIGH if adding a broker/server | Use browser checks, cleanup receipts for ports/processes, and stale-state/hung-command probes. |
| Phase 6: hardening, release, operations | HIGH | Use `checkpoint-quality-loop` plus `engineering-acceptance-review`; require runbook, rollback/kill switch, release-state checks, and local/live/deploy status separation. |

Default triggered adversarial classes for the main run:

- `dirty_worktree`: the current repo already has uncommitted Foglamp-related changes.
- `stale_state`: generated Supabase types, `deno.lock`, package locks, migration state, dashboard payloads, and built output can become stale.
- `malformed_input`: admin-actions payloads, metadata normalizers, dashboard API responses, and settings forms need defensive parsing.
- `prompt_injection`: tweet/source text, enrichment research, model-readable metadata, and tool output can reach prompts or trace metadata.
- `misleading_success_output`: mocked tests, no-op Foglamp SDK behavior, missing API key, and local-only dashboard success can look like real trace verification.
- `hung_or_long_command`: dev servers, Supabase functions, local HUD broker, browser sessions, migrations, and renderer work can leave resources running.
- `cancel_resume`: the plan is multi-phase and likely to cross compaction, interruptions, or machine restarts.
- `flaky_test`: UI/browser/timing checks and queue/worker tests may pass without exercising the intended state.

### Per-Phase Skill Routing

The implementation orchestrator should actively route skills as follows:

| Phase or gate | Required skill/tool route | Purpose |
| --- | --- | --- |
| Start of run and every resumed turn | `cognee-memory-sidecar` | Recall only relevant XOT/tooling context, then verify drift-prone facts from source truth. |
| Whole execution | `implementation-orchestrator` | Own the main goal, ledger, slices, workers, integration, validation, and final closeout. |
| Before each phase expansion | `checkpoint-quality-loop` | Prevent shallow "tests passed" completion; force audit/implementation/verification receipts before continuing. |
| Current Foglamp/AI SDK/Supabase docs | `context7-mcp` where it resolves correctly, otherwise official docs/source | Recheck SDK, runtime, CLI, and cloud behavior before implementation-bound claims. |
| Code flow and blast-radius mapping | `codegraph` | Trace OpenAI callers, dashboard summary flow, admin-actions contracts, and impact before shared helper edits. |
| Structured migrations/call-site edits | `ast-grep` | Find and migrate repeated OpenAI/Foglamp/admin-action shapes safely. |
| Project diagnostics | `lsp-setup` when useful | Catch TypeScript or module-boundary errors after broad edits. |
| UI/dashboard work | `frontend-design` | Keep Dashboard/Monitoring/Settings dense, operational, responsive, and consistent with XOT. |
| Browser/UI verification that should not block the operator | `background-browser-operator` when browser work is long-running or interrupting | Capture actual dashboard/monitoring/settings behavior and avoid stale local surfaces. |
| Unclear failing validation | `root-cause-investigator` | Diagnose failures before piling on fixes. |
| Phase acceptance after code/data/UI changes | `engineering-acceptance-review` | Validate goal fit, task fit, source ownership, hallucinated contracts, maintainability, evidence, and residual risk. |
| Prior interrupted/disconnected implementation evidence | `coding-agent-sessions` when needed | Recover exact prior command/output/worker evidence instead of guessing after interruption. |

If a listed skill is unavailable in a future session, the implementation orchestrator must record the reduced confidence and use the next-best direct evidence path. It must not silently downgrade the gate.

### Recommended First Implementation Slice

Within the whole-plan goal, the first checkpoint slice should be Phase 0 plus the narrow Phase 1 admin translation preview foundation:

1. Stabilize the existing `foglampOpenAI.ts` preview helper with safe defaults and tests.
2. Add `workflow_runs`, `ai_call_ledger`, and `budget_ledger`.
3. Dual-write Translation Playground preview to local XOT ledgers.
4. Add a minimal admin summary endpoint or extend dashboard summary with trace budget and last preview run.
5. Add a small Dashboard/Settings status card only after the data exists.

This slice is narrow enough to verify without force-posting or tracing all worker traffic.

### Phase Order And Dependency Constraints

- Schema and server helpers before dashboard UI.
- Local ledger before hosted Foglamp export expansion.
- Budget/redaction before worker-wide tracing.
- Dashboard summary before rich charts/tables.
- Monitoring drill-down after workflow ids are propagated to real post/job contexts.
- Local live HUD/panel after a real broker/event source exists.
- A checkpoint-quality-loop gate before each phase boundary.
- Engineering acceptance before any phase is marked accepted.
- No worker-wide instrumentation until Phase 0/1 budget, redaction, and local ledger evidence have passed.
- No final "one-shot complete" report until all selected phases have either passed, been explicitly deferred with owner, or blocked with evidence.

### Likely Files To Change

- `supabase/migrations/*observability*.sql`
- `src/integrations/supabase/types.ts`
- `supabase/functions/_shared/observability.ts`
- `supabase/functions/_shared/observabilityBudget.ts`
- `supabase/functions/_shared/foglampOpenAI.ts`
- `supabase/functions/_shared/openai.ts`
- `supabase/functions/admin-actions/translationRescoreActions.ts`
- `supabase/functions/admin-actions/dashboardSummaries.ts`
- `supabase/functions/admin-actions/monitoringReads.ts`
- `supabase/functions/admin-actions/index.ts`
- `src/api/dashboardData.ts`
- `src/api/monitoringData.ts`
- `src/pages/Dashboard.tsx`
- `src/components/monitoring/MonitoringDetailDrawer.tsx`
- `src/components/monitoring/MonitoringDeliveryTimeline.tsx`
- `src/components/settings/*`
- `src/test/*dashboard*`
- `src/test/*monitoring*`
- `docs/operations/observability-runbook.md`
- `README.md`

### Allowed Changes

- Add schema, helper modules, summaries, tests, and UI components required for observability.
- Add settings/env documentation.
- Add local budget/redaction enforcement.
- Adapt Foglamp OSS concepts and, if necessary, small SDK HUD model pieces with license attribution.

### Disallowed Changes

- Revert existing dirty worktree without explicit instruction.
- Upgrade AI SDK major just for instrumentation.
- Store or show prompt/output text by default.
- Expose Foglamp/OpenAI/Supabase secrets.
- Add fake traces, fake endpoints, or smoke scripts.
- Force X posting to validate observability.
- Replace existing Dashboard/Monitoring flows with a standalone trace app.

### Required Skills/Tools

- `implementation-orchestrator` for execution.
- `checkpoint-quality-loop` after every meaningful phase or subsystem slice, and before expanding scope.
- `engineering-acceptance-review` after implementation changes before accepting a phase.
- `cognee-memory-sidecar` at run start and after interruptions/resumes, used as routing context only.
- `context7-mcp` for current SDK/API/CLI/cloud docs when it resolves the right library; otherwise use official Foglamp/Supabase/Vercel AI SDK docs/source.
- `codegraph` before shared helper, admin-actions, worker, dashboard summary, or UI flow edits.
- `ast-grep` for repeated call-site migrations and structured code-shape checks.
- `lsp-setup` when TypeScript/module diagnostics or references are needed after broad edits.
- `frontend-design` for Dashboard/Monitoring/Settings UI changes.
- `background-browser-operator` for long-running or non-interrupting browser verification.
- `root-cause-investigator` when validation fails and the cause is not immediately proven.
- `coding-agent-sessions` when interrupted/disconnected evidence from a prior implementation turn matters.
- Current Foglamp docs/source check before editing.
- Supabase/Deno validation commands.
- Browser inspection for desktop/mobile UI.

### Blocking Questions

These should block implementation if unresolved:

- Should hosted Foglamp export be enabled in production after the local ledger is built, or only in local/dev at first?
- What exact local cap should be enforced if the official free-tier limit changes from the current observed `10,000` spans/month?
- Is storing redacted prompt/output hashes acceptable, or should XOT store no prompt/output-derived data at all?

These can be resolved during execution:

- Whether the first UI lands as a new `ai-ops` tab or an observability band in `pipeline`.
- Whether `observability_events` ships in phase 1 or phase 2.
- Whether the local live panel uses Foglamp's SDK HUD stream, an XOT SSE broker, or historical auto-refresh first.

### Stop Conditions

Stop and report before proceeding if:

- Foglamp docs/API have changed materially from this plan.
- Current `ai`/Foglamp package versions no longer match the v4-v6 wrapper path.
- Migration dry-run fails.
- Admin auth boundary changes are required.
- Prompt/output text appears in traces/rows despite redaction settings.
- Hosted export cannot be stopped under cap.
- The local dashboard cannot show provenance for observability data.

### Do Not Claim Complete Until

- A saved migration and code path produce local XOT observability rows from a real flow.
- Dashboard or Settings renders those rows with correct provenance.
- Budget cap is enforced locally.
- Redaction tests pass.
- The implementation has passed the relevant Deno/Vitest/build checks.
- Browser screenshots verify the actual dashboard/drawer/settings surfaces.
- Any hosted Foglamp evidence is described as optional/export correlation, not the XOT source of truth.
- Every selected phase has a checkpoint-quality-loop receipt.
- Every write-scoped STANDARD/HIGH worker DoneClaim has been parent-reviewed and accepted, rejected, or marked unverified.
- HIGH slices have AdversarialVerify or an explicit blocked/unproven status.
- Engineering acceptance has passed or remaining risks are explicitly accepted with owner.
- The implementation ledger has a final closeout entry.
- Cleanup receipts exist for servers, ports, browser contexts, brokers, temp files, or env overrides started during validation.

## Orchestration Closeout

- Workers actually used: 4
- Worker scopes:
  - UI/product workflow for Dashboard, Monitoring, Settings.
  - Backend/data model and admin-actions.
  - Foglamp OSS/HUD/source model.
  - Operations/free-tier/privacy/release.
- Worker results accepted:
  - Use Dashboard for aggregate observability, Monitoring for drill-down, Settings for controls/status.
  - Add local workflow/AI/budget ledgers as dashboard source of truth.
  - Use Foglamp data model and HUD event pattern, not Foglamp SaaS UI.
  - Enforce local budget/redaction before hosted export.
- Worker results rejected or constrained:
  - Do not make Foglamp HUD the production dashboard.
  - Do not use hosted Foglamp reads as a dependency.
  - Do not expand to worker-wide hosted tracing until guardrails exist.
- Parent verification:
  - Rechecked current git status and package state.
  - Rechecked local Foglamp source commit and licenses.
  - Rechecked official Foglamp HUD, data model, account/quota, API reference, and pricing pages.
  - Rechecked current XOT data/API/UI surfaces.
- Gaps that would benefit from more workers:
  - Only if implementation expands to full self-hosted Foglamp deployment, multi-tenant customer attribution, or a major dashboard redesign.
- Visible thread considered: no visible user-owned thread needed for this planning artifact.

## Plan Output

- Plan file: `/Users/stevmq/Finalized XOT/docs/plans/2026-07-03-xot-native-process-observability-dashboard-implementation-plan.md`
- Implementation has started: no. This document is the implementation-ready plan and handoff source of truth.
