# Finalized XOT Foglamp Tracing Implementation Plan

## Planner Metadata
- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: `main`
- Date: 2026-07-01 local MDT from `date`
- Planning mode: parent-only planning, read-only repo inspection, docs research, no implementation
- Worker scopes: none
- References inspected:
  - `/Users/stevmq/Finalized XOT/package.json`
  - `/Users/stevmq/Finalized XOT/package-lock.json`
  - `/Users/stevmq/Finalized XOT/README.md`
  - `/Users/stevmq/Finalized XOT/deno.json`
  - `/Users/stevmq/Finalized XOT/vercel.json`
  - `/Users/stevmq/Finalized XOT/src/App.tsx`
  - `/Users/stevmq/Finalized XOT/src/main.tsx`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/openai.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/worker/index.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/enrich.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/dedupe.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/_shared/scoringPolicy.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/translationRescoreActions.ts`
  - `/Users/stevmq/Finalized XOT/supabase/functions/digest-compiler/index.ts`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/package.json`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiFetch.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiSubtitles.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiTranscription.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiVision.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/renderer.js`
  - `/Users/stevmq/Finalized XOT/services/video-renderer/src/server.js`
- Research sources:
  - https://docs.foglamp.dev/ai-instrument.md
  - https://docs.foglamp.dev/llms.txt
  - https://docs.foglamp.dev/sdk/overview.md
  - https://docs.foglamp.dev/sdk/wrap.md
  - https://docs.foglamp.dev/sdk/configuration.md
  - https://docs.foglamp.dev/sdk/runtimes.md
  - https://docs.foglamp.dev/sdk/hud.md
  - https://docs.foglamp.dev/concepts/data-model.md
  - Context7 `/vercel/ai` docs for `generateText` and `streamText`
  - Context7 `/supabase/supabase` docs for Edge Function npm package support
  - Live npm metadata: `npm view ai version dist-tags --json`, `npm view @ai-sdk/openai version dist-tags --json`, `npm view foglamp version peerDependencies dependencies dist-tags --json`
- Assumptions:
  - The user wants a plan only. No `npx foglamp login`, package install, source edit, deploy, or smoke trace has been run.
  - Foglamp should be added only through documented public APIs.
  - The current app is the source of truth; memory was used only as routing context.
  - The implementation prompt is written for Vercel AI SDK apps, but this repo currently does not use the Vercel AI SDK.

## Executive Goal

Prepare a safe implementation path for adding Foglamp observability to XOT's real AI flows without creating synthetic trace endpoints, smoke-test model calls, or misleading trace names.

The first implementation gate is not Foglamp login. The first technical truth is that XOT is not currently a Vercel AI SDK app: `npm ls ai --depth=0` is empty in both the root app and `services/video-renderer`, and the code calls OpenAI directly through helper functions. Since Foglamp's docs require an installed `ai` package and instrument `generateText`/`streamText`/`generateObject`/`streamObject` or AI SDK agents, implementation must either:

1. get explicit approval to migrate selected OpenAI helper boundaries to Vercel AI SDK before adding Foglamp tracing, or
2. stop after documenting that the requested Foglamp instrumentation cannot be completed against the current direct-fetch OpenAI implementation.

## Source Of Truth Contract

- Intent: instrument XOT's real AI runs with Foglamp using the Vercel AI SDK path that matches the installed `ai` major.
- Current behavior: root app is React/Vite; AI work happens in Supabase Edge Functions and a separate Node video renderer. AI calls use direct OpenAI HTTP fetches, not Vercel AI SDK.
- Expected outcome: after an approved implementation, real XOT AI calls emit Foglamp traces with useful static names, workflow grouping, and no fake trace generation. The React HUD is rendered only when a local long-running Node collector can back it.
- Truth owner: local repo files plus live package/docs checks at implementation time.
- Contract boundary: package/dependency setup, AI-call helper boundaries, Foglamp context mapping, HUD root placement, validation commands, and handoff instructions for real flow triggering.
- Displaced path: direct OpenAI calls may need to be displaced by AI SDK calls only after explicit migration approval. If no migration approval is given, no direct-fetch path should be displaced.
- Cutover: start with one real entry point, verify build/type/tests, then expand to additional AI-call surfaces. Do not deploy or claim runtime traces until the user runs real flows.
- Acceptance evidence: `npm ls ai` shows an installed major, Foglamp is installed, source uses the correct v4-v6 or v7 Foglamp path, validation commands pass, and the user has exact real-flow trigger instructions.
- Evidence lane: local package manager output, source diffs, Deno/Node/Vite checks, and operator-visible Foglamp dashboard/HUD after the user triggers real flows.
- Kill criteria: stop if `ai` remains absent and the user has not approved AI SDK adoption; stop if Foglamp docs/package APIs disagree with the plan; stop if AI SDK migration changes model request/response semantics without parity coverage.
- Forbidden moves:
  - Do not create smoke tests, scripts, demo routes, or synthetic first traces.
  - Do not print `FOGLAMP_API_KEY` or any `.env` secret.
  - Do not label every call with one generic name.
  - Do not put dynamic ids, URLs, slugs, dates, or model names in `agentName`, `workflowName`, or `traceName`.
  - Do not use `sessionId` for cron, batch, tweet, render, digest, or job ids.
  - Do not attach `customer` unless XOT is actually serving distinct end-customers or tenants.
  - Do not upgrade an existing AI SDK major merely for instrumentation.

## Native Planning Superiority

- Codex Native baseline: a generic plan would likely run `npx foglamp login`, install `foglamp`, and search for `generateText` without noticing that this repo has no `ai` dependency and direct OpenAI fetch helpers.
- What this plan does better: it anchors package state, AI-call topology, runtime surfaces, HUD feasibility, package-manager choice, and implementation blockers before any login or code edit.
- User-specific context used: memory indicated this repo has prior Supabase/Vercel/manual-intake operational history, but it was not treated as proof. Current files and live docs/package metadata were rechecked.
- Superiority score target: 5
- Proof artifacts: this saved plan file, package-manager checks, source-file references, Foglamp docs URLs, Context7 docs lookups, and current npm package metadata.

## Orchestration Decision

- Mode: parent-only
- Worker count: 0
- Decision reason: the main planning risk is a binary repo fact, not parallel research: XOT has no Vercel AI SDK dependency and no `generateText`/`streamText` calls. Direct inspection plus CodeGraph caller checks were enough to map the relevant boundaries.
- Independent surfaces:
  - root React/Vite frontend and HUD placement
  - Supabase Edge Function AI helpers
  - Node video renderer AI helpers
  - Foglamp/Vercel AI SDK documentation and package metadata
  - validation/deploy handoff
- Workers used or skipped: skipped. The available multi-agent tool permits subagents only when the user explicitly asks for subagents/delegation; the user asked for the planning-orchestrator skill, not a subagent run. A worker would also duplicate the same local file inspection.
- Thread decision: no visible Codex thread needed. This is a single repo-local plan, not a user-owned long-lived work lane.
- Token/context rationale: parent context can hold all relevant source and docs; a worker would add coordination overhead without a distinct evidence source.
- Reconsider trigger: use a worker if the user approves a broad AI SDK migration covering all helper semantics, or if implementation expands into a cross-service parity migration with independent Edge Function and renderer lanes.

## Background Browser Lane

- Needed: no
- Target/surface: none
- Safety boundary: no login or account approval should be attempted during planning.
- Required receipt: not applicable
- Stop condition: not applicable

## Research And Inspiration Findings

### Foglamp agent instructions

- The coding-agent page requires checking the installed `ai` version first, then using `wrap()` from `foglamp/wrap` for AI SDK v4-v6 or `fog.integration(...)` for v7.
- Every traced call needs `traceName` or `agentName`.
- Static names are mandatory. Dynamic request, tweet, render, digest, account, URL, model, and date values belong in `workflowRunId`, `sessionId`, `customer.id`, or `metadata`.
- `workflowName` and `workflowRunId` must be provided together.
- `sessionId` is only for real conversations/user threads, not cron, batch, pipeline, or job runs.
- The docs explicitly say not to write smoke tests, scripts, or demo endpoints to make the first trace.

### Foglamp SDK and runtime docs

- `foglamp()` is the v7 collector; `wrap(ai, ...)` is for v4-v6.
- `foglamp` is a no-op without `FOGLAMP_API_KEY`.
- Long-running Node/Bun processes flush automatically; serverless/edge code may need explicit `flush()` or runtime `waitUntil`.
- Vercel functions auto-detect `waitUntil`, but XOT's AI runtime is Supabase Edge Functions and a separate Node renderer, not Vercel functions.
- The HUD requires a React app and a long-running Node process that constructs a collector with `hud: true`. It is not supported for edge/serverless collectors.

### Vercel AI SDK docs and npm metadata

- Context7 docs show current AI SDK usage with `generateText` imported from `ai` and model providers such as `@ai-sdk/openai`.
- Live npm metadata on 2026-07-01 showed:
  - `ai` latest: `7.0.11`
  - `ai` dist-tags include `ai-v6: 6.0.218` and `ai-v5: 5.0.209`
  - `@ai-sdk/openai` latest: `4.0.5`
  - `@ai-sdk/openai` dist-tags include `ai-v6: 3.0.80` and `ai-v5: 2.0.110`
  - `foglamp` latest: `0.7.0`
  - `foglamp` peer dependency: `ai@^4 || ^5 || ^6 || ^7.0.0-beta.1`, plus React peers for HUD
- The implementer must repeat these checks immediately before editing because package versions are drift-prone.

### Supabase Edge Functions docs

- Supabase Edge Functions support npm packages through Deno imports, including `npm:` package specifiers and Node built-ins.
- This repo currently uses URL imports and `npm:@sentry/deno`; `deno.json` has `nodeModulesDir: "auto"`.
- An AI SDK adoption in Supabase functions should prefer current documented import behavior and avoid assuming Node-only runtime APIs.

## Current State

### Package manager and install surface

- Root `package.json` declares `packageManager: "npm@10.8.2"` and Vercel uses `npm ci`, so root package changes must use npm.
- Root has `package-lock.json`, plus stale-looking Bun lockfiles. Do not use Bun for this task unless the user explicitly changes package-manager policy.
- `services/video-renderer` is a separate npm package with its own `package-lock.json`.
- `npm ls ai --depth=0` returns empty in the root package.
- `npm ls ai --depth=0` returns empty in `services/video-renderer`.
- `npm ls foglamp --depth=0` returns empty in both packages.

### AI-call topology

Supabase Edge Functions:

- `/Users/stevmq/Finalized XOT/supabase/functions/_shared/openai.ts` defines `callOpenAI`, routing between Chat Completions and Responses API by model family.
- CodeGraph identified these direct `callOpenAI` callers:
  - `generatePersonalVoiceProfile`
  - `runArchivist`
  - `runResearcher`
  - `runAnalyst`
  - `runHumanizer`
  - `runComposer`
  - `runVoiceCritic`
  - `runCritic`
  - `adjudicateWithModel`
  - `handleTranslateJob`
- Additional grep evidence found:
  - `runScoringPolicy` uses `callOpenAI`
  - `translationReadability` repairs use `callOpenAI`
  - `digest-compiler` calls OpenAI directly through `fetch("https://api.openai.com/v1/chat/completions", ...)`
  - `worker` calls OpenAI moderation directly
  - `dedupe` calls OpenAI embeddings directly

Node video renderer:

- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiFetch.js` defines `fetchOpenAI`.
- `openaiSubtitles.js`, `openaiTranscription.js`, and `openaiVision.js` use that helper for transcript cleanup, subtitle translation, translation repair, transcription fallback, vision preflight, and watermark detection.
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/renderer.js` orchestrates these calls inside a render pipeline.

React UI:

- `/Users/stevmq/Finalized XOT/src/App.tsx` is the best HUD placement point because it wraps the full router tree.
- `/Users/stevmq/Finalized XOT/src/main.tsx` wraps `<App />` in a Sentry error boundary.
- The app has a local dev server via `npm run dev`.
- The UI does not itself run model calls. It invokes Supabase functions and the renderer through admin actions/queue operations.

### Product/runtime implications

- XOT is a private RSS/OpenAI/Telegram/X/video-rendering pipeline, not a multi-tenant SaaS surface from the inspected files.
- `accounts`, feeds, tweet authors, Telegram channels, and source handles are not Foglamp `customer` values by default. They belong in `metadata` if needed.
- `/threads` appears to mean tweet/content threads, not user conversations. Do not map those to `sessionId`.
- Admin translation preview is a real model call, but it is a one-off/admin action, not a conversation session.
- Worker, cron, digest, dedupe, enrichment, and renderer runs are workflows, not sessions.

## Future State

After an approved implementation:

- Foglamp CLI login has been completed by the user, with `FOGLAMP_API_KEY` written to local `.env` and never printed.
- `foglamp` is installed with npm in every package that imports it:
  - root package for the React HUD and any root-managed dependency surface
  - `services/video-renderer` if the renderer is instrumented
  - Supabase Edge Functions via compatible Deno/npm import strategy if instrumented there
- The installed `ai` major is known from `npm ls ai` or exact package metadata.
- The code follows one Foglamp path:
  - v4-v6: `wrap()` from `foglamp/wrap`
  - v7: `fog.integration(...)` on each `generateText`/`streamText`/`generateObject`/`streamObject` call
- XOT's real AI call boundaries are mapped to static names and workflow runs:
  - worker post processing is grouped by a job/run id, with tweet id in metadata
  - enrichment multi-agent work is grouped under one workflow run with specific agent names per step
  - renderer video processing is grouped by render id
  - digest compilation is grouped by digest run id or request id
  - one-off admin previews use `traceName`
- `sessionId` is omitted unless a future human chat/conversation feature exists.
- `customer` is omitted unless XOT is changed into a multi-tenant product.
- The React HUD component is present near the root only if a local long-running Node collector is available to stream traces. For current Supabase Edge-only AI flows, the HUD overlay alone would be inert.

## Non-Goals

- No first-trace smoke tests, scripts, or demo endpoints.
- No package-manager switch.
- No Vercel AI SDK major upgrade if a major is already installed when implementation begins.
- No broad refactor of the pipeline or renderer just to add observability.
- No production deploy during the planning step.
- No claim that traces are verified until the user triggers real flows and sees them in Foglamp or the HUD.
- No tracing of embeddings as a first-class Foglamp cost span unless Foglamp support has changed; current Foglamp data-model docs say embedding capture is reserved/not emitted today.

## Phase Plan

### Phase 0: Implementation gate and Foglamp login

Purpose: follow the user's intended login flow, but do not hide the AI SDK blocker.

Tasks:

1. Re-run source-truth checks:
   - `git status --short`
   - `npm ls ai --depth=0`
   - `cd services/video-renderer && npm ls ai --depth=0`
   - `npm view ai version dist-tags --json`
   - `npm view @ai-sdk/openai version dist-tags --json`
   - `npm view foglamp version peerDependencies dist-tags --json`
2. If `ai` is still absent, tell the user before changing AI code:
   - "This app does not currently use Vercel AI SDK, so the Foglamp docs cannot be applied directly. I can proceed only if you want me to migrate selected OpenAI helper boundaries to AI SDK first."
3. If the user confirms implementation may proceed, run:
   - `npx foglamp login`
4. When the CLI prints the URL and code, show only those to the user.
5. Wait until the login process exits successfully.
6. Verify `FOGLAMP_API_KEY` exists in `.env` without printing its value.

Acceptance criteria:

- Foglamp login succeeded, or implementation stopped with a clear auth/login blocker.
- Secret value was never printed.
- No package install or source edit happened before the login command succeeded if following the user's original sequence strictly.

### Phase 1: Dependency and SDK path decision

Purpose: install only what the selected implementation can actually use.

Tasks:

1. Install `foglamp` in the root package with npm:
   - `npm i foglamp`
2. If instrumenting the renderer, install `foglamp` in the renderer package:
   - `cd services/video-renderer && npm i foglamp`
3. If the user approved Vercel AI SDK adoption, install AI SDK packages in the package/runtime that will use them. Use live docs/package metadata:
   - likely v7 today: `npm i ai @ai-sdk/openai`
   - for renderer package if needed: `cd services/video-renderer && npm i ai @ai-sdk/openai foglamp`
   - for Supabase Edge imports, verify whether to use package-managed bare imports, `npm:` specifiers, or exact versions under `deno.json`/lock behavior before editing.
4. After install, run `npm ls ai --depth=0` and select Foglamp path:
   - v4-v6: use `wrap(ai, ...)`
   - v7: use `foglamp()` plus `fog.integration(...)`
5. Do not upgrade an already-installed `ai` major just to fit a preferred path.

Acceptance criteria:

- Package lock changes match npm, not Bun/Yarn/pnpm.
- Root and renderer lockfiles are changed only where the corresponding package imports new dependencies.
- The plan's selected Foglamp wiring path matches the actual installed `ai` major.

### Phase 2: Supabase Edge Function instrumentation design

Purpose: instrument the main production AI boundary without breaking existing OpenAI semantics.

Recommended first real entry point:

- Start with `handleTranslateJob` through `/Users/stevmq/Finalized XOT/supabase/functions/_shared/openai.ts` because it is the core RSS post scoring/translation path and already centralizes most worker text-generation calls.

Preferred safe approach:

1. Keep the public `callOpenAI(p: OpenAICallParams)` facade stable for callers.
2. Add an internal AI SDK-backed implementation only after parity is understood for:
   - Chat Completions vs Responses routing
   - forced function/tool calls
   - built-in web search tools
   - `reasoningEffort`, `verbosity`, `serviceTier`, `parallelToolCalls`
   - usage normalization and `endpoint` reporting
   - failure/error raw text behavior
3. Add a Foglamp context parameter to `OpenAICallParams` only if needed, but prefer setting ambient workflow context at the handler/job boundary to avoid plumbing through every function.
4. For v7, attach `fog.integration(context)` per AI SDK call.
5. For v4-v6, wrap the `ai` module once with `wrap(ai, ...)` and use `fog.run(context, fn)` around workflow boundaries.
6. In Supabase Edge Functions, call `await fog.flush()` before returning from handlers or before the job handler completes if runtime auto-detection is not proven for Supabase Edge.

Static name mapping for Supabase calls:

| Surface | Static name field | Static value | Workflow mapping | Metadata |
| --- | --- | --- | --- | --- |
| worker scoring policy | `agentName` | `"scoring-policy"` | `workflowName: "rss-post-pipeline"`, `workflowRunId: job.id` when available | `tweetId`, `authorHandle`, `model`, `endpoint`, `scoringVersion` |
| worker legacy scoring | `agentName` | `"legacy-scoring"` | same as worker job | `tweetId`, `authorHandle`, `model`, `endpoint` |
| worker translation | `agentName` | `"post-translation"` | same as worker job | `tweetId`, `source: "worker"`, `model`, `endpoint` |
| translation readability repair | `agentName` | `"translation-readability-repair"` | same as worker job | `tweetId`, `model`, `acceptedRepair` |
| duplicate adjudication | `agentName` | `"duplicate-adjudicator"` | `workflowName: "duplicate-gate"`, `workflowRunId: gate run/job id` if available | `tweetId`, candidate count |
| enrichment archivist | `agentName` | `"enrichment-archivist"` | `workflowName: "post-enrichment-pipeline"`, `workflowRunId: enrichment job id or request id` | `tweetId` |
| enrichment researcher | `agentName` | `"enrichment-researcher"` | same enrichment run | `tweetId` |
| enrichment analyst | `agentName` | `"enrichment-analyst"` | same enrichment run | `tweetId` |
| enrichment humanizer | `agentName` | `"enrichment-humanizer"` | same enrichment run | `tweetId` |
| enrichment composer | `agentName` | `"enrichment-composer"` | same enrichment run | `tweetId` |
| enrichment voice critic | `agentName` | `"enrichment-voice-critic"` | same enrichment run | `tweetId` |
| enrichment critic | `agentName` | `"enrichment-critic"` | same enrichment run | `tweetId` |
| voice profile generation | `traceName` or `agentName` | `"voice-profile-generation"` | no workflow unless part of a saved settings operation | `adminAction: "generate_voice_profile"` |
| admin translation preview | `traceName` | `"translation-preview"` | no workflow required | `adminAction: "preview_translation"`, `authorHandle` |
| admin translate post | `agentName` | `"manual-post-translation"` | `workflowName: "admin-translation"`, `workflowRunId: admin action/request id` | `tweetId`, `adminAction: "translate_post"` |
| digest compiler | `agentName` | `"digest-compiler"` | `workflowName: "digest-compilation"`, `workflowRunId: digest id or request id` | `periodStart`, `periodEnd`, `postCount` |

Rules:

- Use `job.id`, render id, digest id, or generated request/run id for `workflowRunId`. Do not use static names for ids.
- Put `tweetId`, account handles, source URLs, model ids, and endpoint names in `metadata`.
- Do not use `sessionId` for any of these surfaces.
- Do not use `customer` for source accounts.

Acceptance criteria:

- At least one real Supabase text-generation entry point is instrumented through AI SDK and Foglamp.
- Existing caller signatures and return semantics remain stable or have focused migration coverage.
- `deno check` and relevant Deno tests pass.

### Phase 3: Video renderer instrumentation design

Purpose: instrument the long-running Node service where HUD support is most feasible.

Recommended renderer boundaries:

- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiFetch.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiSubtitles.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiTranscription.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiVision.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/renderer.js`

Tasks:

1. Add a renderer-local Foglamp collector module, for example `services/video-renderer/src/foglamp.js`, only after `foglamp` is installed in that package.
2. If adopting AI SDK v7, replace eligible Responses API text/vision generation calls with AI SDK calls that preserve request semantics.
3. Use one shared workflow context for a render:
   - `workflowName: "video-render-pipeline"`
   - `workflowRunId: row.id`
   - metadata: `tweetId`, `sourceMediaId`, `renderVersion`, `transcriptionProvider`, `translationModel`, `visionModel`
4. Static agent names:
   - `"renderer-transcription"` for OpenAI transcription fallback, if AI SDK supports the selected audio/transcription API and Foglamp captures it. If not, leave direct fetch uninstrumented and document the gap.
   - `"renderer-transcript-cleanup"`
   - `"renderer-subtitle-translation"`
   - `"renderer-subtitle-translation-repair"`
   - `"renderer-watermark-vision"`
   - `"renderer-watermark-detection"`
5. Add long-running process shutdown drains:
   - `process.on("SIGTERM", () => fog.shutdown())`
   - `process.on("SIGINT", () => fog.shutdown())`
6. Enable HUD broker in local/dev renderer only:
   - `foglamp({ hud: process.env.NODE_ENV !== "production" })`
   - Keep production safe because Foglamp docs say HUD is ignored in production/serverless, but explicit gating is clearer.

Acceptance criteria:

- Renderer package tests pass.
- Renderer process starts locally.
- No API key is required for HUD streaming, but `FOGLAMP_API_KEY` sends traces to Foglamp when present.
- Renderer traces are grouped by render id, not by dynamic names.

### Phase 4: React HUD overlay

Purpose: make local real AI runs visible while the developer works.

Tasks:

1. Import `FoglampHUD` in `/Users/stevmq/Finalized XOT/src/App.tsx`.
2. Render `<FoglampHUD />` once near the root, likely alongside the providers in `App`, outside the router routes but inside the returned tree.
3. If the renderer uses a non-default HUD port, render `<FoglampHUD port={...} />` with the same port.
4. Do not expect the HUD to stream Supabase Edge Function traces unless a supported local Node collector broker exists. For current architecture, the HUD is primarily useful for local renderer instrumentation.
5. Local Vite dev does not apply `vercel.json` headers, so the production CSP likely does not affect the local HUD. If a hosted/proxied HUD is ever needed, revisit `connect-src`; do not relax production CSP during this task.

Acceptance criteria:

- Root app still renders.
- `npm run build` succeeds.
- HUD overlay is inert when no broker is running.
- HUD streams only when a local HUD-enabled Node collector is running and a real AI flow is triggered.

### Phase 5: Expansion after first real flow

Purpose: broaden coverage only after the first real instrumentation slice is stable.

Order:

1. Worker scoring/translation/readability path.
2. Admin translation preview and manual translate/rescore actions.
3. Enrichment multi-agent pipeline.
4. Duplicate gate/adjudication.
5. Digest compiler.
6. Video renderer subtitle/vision paths.
7. Leave embeddings, moderation, and audio transcription as documented gaps unless Foglamp and AI SDK support are verified.

Acceptance criteria:

- Each expanded surface has a static `agentName` or `traceName`.
- Multi-step flows share one `workflowName` and `workflowRunId`.
- No batch/cron id is mapped to `sessionId`.
- Metadata remains bounded and does not include secrets or large prompt payloads beyond Foglamp's capture settings.

## Task Backlog

### Blocker tasks

- Confirm whether the user approves Vercel AI SDK adoption in a repo that currently does not use it.
- Recheck live Foglamp and AI SDK docs/packages immediately before implementation.
- Decide if initial implementation is Supabase Edge, Node renderer, or both.

### Dependency tasks

- Run `npx foglamp login` and wait for success before continuing, per user prompt.
- Install `foglamp` with npm in the root package.
- Install `foglamp` in `services/video-renderer` only if renderer imports it.
- If approved, install `ai` and `@ai-sdk/openai` in the actual packages that will import them.
- Update `.env.example` only with placeholder `FOGLAMP_API_KEY=` if the user wants local setup docs refreshed. Do not commit real keys.

### Code tasks after AI SDK approval

- Add a Foglamp collector/helper for Supabase Edge Functions.
- Add a Foglamp collector/helper for the renderer if instrumenting renderer.
- Preserve `callOpenAI` facade or migrate callers in small, tested slices.
- Add context mapping at workflow/job boundaries before individual nested calls.
- Add flush/shutdown behavior appropriate to Edge Functions and Node renderer.
- Add `<FoglampHUD />` in `src/App.tsx` only after root package has `foglamp`.

### Documentation/handoff tasks

- Add a short operational note to README or docs if implementation proceeds:
  - how to set `FOGLAMP_API_KEY`
  - how to run local UI/renderer
  - which real flows generate traces
  - no synthetic trace script exists by design

## Acceptance Criteria

Minimum safe implementation:

- The implementer has either obtained AI SDK adoption approval or stopped with the blocker documented.
- Foglamp login completed and wrote `FOGLAMP_API_KEY` to `.env`, with the secret not printed.
- `foglamp` is installed with npm in the package(s) that import it.
- The selected instrumentation path matches actual `ai` major:
  - v4-v6: `wrap()` from `foglamp/wrap`
  - v7: `fog.integration(...)`
- At least one real AI entry point is instrumented without synthetic routes/scripts/tests.
- Names are static string literals.
- `workflowName` and `workflowRunId` are paired for pipelines.
- `sessionId` is omitted for XOT batch/cron/job/digest/render flows.
- `customer` is omitted unless a real tenant/end-customer model is identified.
- HUD overlay is added only in a way that remains inert without a local broker.
- Validation commands pass or blockers are reported precisely.
- Final implementation handoff tells the user exactly how to trigger real AI flows.

Do not claim complete until:

- local build/check/test evidence exists, and
- the user has real-flow trigger instructions, and
- any uninstrumented OpenAI surfaces are listed as deliberate gaps.

Do not claim verified live until:

- the user or implementer triggers a real XOT AI flow, and
- a trace is visible in Foglamp or, for local renderer, the HUD streams the run.

## Validation Plan

Pre-edit checks:

```bash
git status --short
npm ls ai --depth=0
cd services/video-renderer && npm ls ai --depth=0
npm view ai version dist-tags --json
npm view @ai-sdk/openai version dist-tags --json
npm view foglamp version peerDependencies dist-tags --json
```

Root app checks:

```bash
npm run build
npm test
npm run lint
npm run check:strict
```

Supabase function checks:

```bash
npm run check:functions
npm run lint:functions
npm run test:functions
```

Renderer checks:

```bash
cd services/video-renderer
npm test
npm start
```

Manual UI/HUD checks after implementation:

```bash
npm run dev
```

- Open `http://localhost:5173`.
- Confirm the app root renders.
- If renderer HUD is enabled and the renderer is running locally, trigger a real renderer flow from `/video-renders`; the HUD should stream only when the local broker receives traces.
- If only Supabase Edge Functions are instrumented, do not expect HUD streaming unless a supported local Node broker exists. Use Foglamp dashboard after the user runs a real flow.

Real AI flow trigger options for the final implementation handoff:

- Settings preview: run `npm run dev`, open `/settings`, use Translation Playground, and click "Run translation preview". This calls the real `preview_translation` admin action and burns real model tokens.
- Monitoring rescore/translate: run `npm run dev`, open `/monitoring`, choose a real post, and use the existing rescore or translate action if available.
- Worker pipeline: trigger the existing RSS/webhook/worker path against the real Supabase project or local Supabase functions. Do not create a synthetic trace endpoint.
- Video renderer: start `cd services/video-renderer && npm start`, open `/video-renders`, queue or retry a real render. This is the best HUD candidate because the renderer is a long-running Node process.

## Risks And Dependencies

- Main blocker: the repo currently has no Vercel AI SDK. Foglamp docs are explicitly for Vercel AI SDK apps.
- AI SDK adoption risk: the existing direct OpenAI helper has careful behavior for Responses vs Chat Completions, newer model options, function tools, built-in web search, usage normalization, and raw error text. Migrating it can change production behavior if not tested.
- Runtime risk: Supabase Edge Functions are Deno/serverless-like, not Vercel Functions. Flush behavior must be explicitly validated.
- HUD risk: the React frontend is static/Vite and does not host the AI runtime. The HUD needs a long-running Node collector broker, likely the renderer, not the Vercel-hosted frontend.
- Package risk: root and renderer are separate npm packages. Installing in one does not make imports valid in the other.
- Scope risk: video renderer AI calls include audio transcription and vision. Foglamp's documented capture set centers on Vercel AI SDK text/object/agent calls; embeddings are not emitted today, and non-text APIs may need verified AI SDK support.
- Secret risk: `FOGLAMP_API_KEY` must be verified by presence only and never printed.
- Production risk: do not deploy until Supabase function checks, renderer tests, root build, and release-state checks pass.

## Implementation Orchestrator Handoff

Source-of-truth contract for first slice:

- Intent: add Foglamp to one real XOT AI flow without fake trace generation.
- Current behavior: no `ai` package, no Foglamp package, direct OpenAI fetches.
- Expected outcome: either a documented stop due missing AI SDK approval, or one AI SDK-backed real model-call path instrumented with Foglamp.
- Truth owner: package files, `npm ls ai`, source call sites, Foglamp docs, Context7 docs, and validation commands.
- Contract boundary: first slice should not migrate every OpenAI call. It should prove one real flow safely.
- Displaced path: none unless user approves AI SDK migration.
- Cutover: preserve existing helper facade where possible; keep direct fetch fallback only if intentionally gated and documented.
- Acceptance evidence: package checks, source diff, validation commands, and real-flow trigger instructions.
- Evidence lane: local command output and, after user trigger, Foglamp dashboard/HUD.
- Kill criteria: no AI SDK approval; unsupported package/runtime; failing parity tests; inability to preserve existing OpenAI request semantics.
- Forbidden moves: no smoke trace artifacts, no secret printing, no dynamic names, no fake session/customer mapping.

Recommended first implementation slice:

1. Report the blocker and ask for explicit approval to adopt Vercel AI SDK if `npm ls ai` remains empty.
2. If approved, follow the user's login sequence exactly: `npx foglamp login`, show URL/code, wait for success.
3. Install `foglamp`.
4. Install AI SDK packages only after approval and live version check.
5. Instrument the lowest-risk real flow:
   - Option A: admin `preview_translation` as one real user-triggered call with `traceName: "translation-preview"`.
   - Option B: renderer subtitle translation under `workflowName: "video-render-pipeline"` if the renderer's Node runtime and HUD are the priority.
   - Option C: worker `handleTranslateJob` under `workflowName: "rss-post-pipeline"` if production pipeline observability is the priority.
6. Add HUD only if the selected first slice has a local long-running Node collector. Otherwise render the overlay only if the user explicitly accepts that it will be inert for Edge Function-only flows.

Phase order and dependency constraints:

- Do not install/migrate AI SDK before acknowledging the absence of `ai`.
- Do not edit code before Foglamp login if strictly following the user's original prompt.
- Do not wire HUD before a server-side collector exists.
- Do not expand from one real flow to all flows until parity and validation pass.

Files likely to change after approval:

- `/Users/stevmq/Finalized XOT/package.json`
- `/Users/stevmq/Finalized XOT/package-lock.json`
- `/Users/stevmq/Finalized XOT/.env.example` if documenting `FOGLAMP_API_KEY`
- `/Users/stevmq/Finalized XOT/src/App.tsx`
- `/Users/stevmq/Finalized XOT/supabase/functions/_shared/openai.ts`
- `/Users/stevmq/Finalized XOT/supabase/functions/_shared/foglamp.ts` or equivalent new helper
- `/Users/stevmq/Finalized XOT/supabase/functions/worker/index.ts`
- `/Users/stevmq/Finalized XOT/supabase/functions/admin-actions/translationRescoreActions.ts`
- `/Users/stevmq/Finalized XOT/supabase/functions/_shared/enrich.ts`
- `/Users/stevmq/Finalized XOT/supabase/functions/_shared/dedupe.ts`
- `/Users/stevmq/Finalized XOT/supabase/functions/digest-compiler/index.ts`
- `/Users/stevmq/Finalized XOT/services/video-renderer/package.json`
- `/Users/stevmq/Finalized XOT/services/video-renderer/package-lock.json`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/foglamp.js` or equivalent new helper
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiFetch.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiSubtitles.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/openaiVision.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/renderer.js`
- `/Users/stevmq/Finalized XOT/services/video-renderer/src/server.js`

Allowed changes:

- Add Foglamp dependency and documented imports.
- Add AI SDK dependency only after explicit approval.
- Add static trace context mapping.
- Add minimal flush/shutdown handling.
- Add root HUD overlay if a local broker can back it.
- Add focused tests around request-shape parity if migrating helper behavior.

Disallowed changes:

- Broad pipeline refactors.
- Replacing all AI calls in one unvalidated pass.
- Changing model settings, scoring policy, translation prompts, or renderer behavior for observability.
- Creating first-trace demo code.
- Mapping tweet/render/digest ids to `sessionId`.

Required skills/tools for implementation:

- Local repo instructions and package scripts.
- Context7 for current Vercel AI SDK and Supabase Edge Function docs.
- Foglamp docs at `https://docs.foglamp.dev/ai-instrument.md` and linked pages.
- CodeGraph or `rg` for AI-call topology before editing.
- Browser only for final local UI/HUD inspection, not for secret verification.

Open questions that should block implementation:

- Does the user approve adding Vercel AI SDK to a repo that currently does not use it?
- Which first slice matters most: admin preview, worker pipeline, or renderer/HUD?
- Should the renderer package be included in the first implementation pass?

Open questions that can be resolved during execution:

- Exact AI SDK major and provider package versions.
- Exact Supabase Edge Function import style for new npm packages.
- Whether `fog.flush()` is required in each Edge Function return path after local/runtime validation.
- Whether HUD port needs customization.

Stop conditions:

- `npx foglamp login` does not complete.
- `FOGLAMP_API_KEY` is not written to `.env`.
- `ai` is absent and user does not approve adoption.
- AI SDK migration cannot preserve existing response semantics.
- Validation commands fail for reasons related to the instrumentation.

Do not claim complete until:

- implementation has followed the chosen path,
- validation has passed or blockers are explicit,
- real-flow trigger instructions are given,
- and no synthetic first-trace artifact exists.

The future implementation orchestrator should turn the chosen slice into its own `/goal`, run implementation and validation cycles, and continue until the slice acceptance criteria are satisfied or blocked.

Implementation should not report `verified` unless target-perspective acceptance evidence is captured from the real route, payload, record, artifact, trace, rendered UI, HUD stream, or operator-visible Foglamp output.

## Orchestration Closeout

- Workers actually used: 0
- Worker scopes: none
- Worker results accepted/rejected/unverified: not applicable
- Parent verification:
  - read planning skill and memory-sidecar skill
  - checked memory registry and Cognee recall
  - inspected repo package files, README, runtime config, AI helpers, UI root, renderer package
  - queried Context7 for Vercel AI SDK and Supabase Edge Functions dependency docs
  - fetched Foglamp docs and live npm metadata
  - used CodeGraph for `callOpenAI` caller topology
- Gaps that would benefit from more workers: after user approves AI SDK adoption, one Edge Function migration worker and one renderer migration worker could independently produce parity plans or patches.
- Visible thread considered: no, because this is a single saved plan and no long-lived user-owned branch/thread was requested.

## Plan Output Format

- Plan file: `/Users/stevmq/Finalized XOT/docs/plans/2026-07-01-foglamp-tracing-implementation-plan.md`
- Status: newly created; implementation has not started.
- Planning anchor: `/Users/stevmq/Finalized XOT`, branch `main`, React/Vite frontend, Supabase Edge Functions backend, separate Node video renderer, npm package manager.
- Mode decision: parent-only; 0 workers because local facts and docs were sufficient and subagent use was not explicitly requested.
- Research findings: Foglamp requires Vercel AI SDK; current XOT does not install/use `ai`; HUD requires a long-running Node collector and is not backed by Supabase Edge Functions alone.
- Future-state vision: Foglamp traces on real XOT AI flows with static agent/workflow names, no fake traces, no misuse of sessions/customers, and optional local HUD for renderer-backed runs.
- Current-state diagnosis: direct OpenAI fetches are the blocker; instrumenting as written would be invalid without AI SDK adoption.
- Phased roadmap: gate and login, dependencies/path decision, Supabase instrumentation, renderer instrumentation, HUD, expansion.
- Task breakdown: see Task Backlog and Implementation Orchestrator Handoff.
- Success criteria: see Acceptance Criteria.
- Validation plan: root build/test/lint/typecheck, Deno check/lint/test, renderer test/start, manual real-flow trigger.
- Risks and unknowns: AI SDK migration semantics, Supabase Edge runtime flushing, HUD broker availability, package scope split.
- Implementation handoff: exact first slice is to stop for AI SDK approval, then run login/install and instrument one real flow.
