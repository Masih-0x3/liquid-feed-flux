# XOT Cleanup Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for independent phase execution or `superpowers:executing-plans` for inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean the XOT codebase so it is easier to understand, safer to change, and still aligned with the currently working production system.

**Architecture:** Keep production stable by doing all cleanup inside isolated `codex/*` branches and a linked cleanup worktree. Split large files by behavior domain behind stable public entrypoints, add tests before or during each split, and promote only after local validation, GitHub review, CI, and release-state checks pass.

**Tech Stack:** Vite, React 18, TypeScript, TanStack Query, Supabase Edge Functions on Deno, Supabase Postgres/Auth/Storage, Vercel frontend hosting, Telegram Bot API, OpenAI, RSS.app, video-renderer Node service.

---

## Current Anchor

Repo root for this plan:

```text
/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup
```

Main checkout preserved:

```text
/Users/stevmq/Finalized XOT
```

Current implementation branch after Phase 10:

```text
codex/xot-cleanup-20-frontend-admin-contracts
```

Current safe-state rule:

```text
No cleanup branch deploys to production.
No direct push to main.
No Supabase migration push while migration drift remains unresolved.
Production checks during cleanup are read-only.
```

## Non-Negotiable Guardrails

- [ ] Keep `/Users/stevmq/Finalized XOT` available as the untouched main working checkout.
- [ ] Do cleanup inside `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup`.
- [ ] Use `codex/` branches for every cleanup slice.
- [ ] Keep each cleanup slice reviewable on its own branch and commit.
- [ ] Do not deploy from `codex/*`.
- [ ] Do not run `supabase db push` until the migration trust phase explicitly clears it.
- [ ] Do not change behavior intentionally inside mechanical split commits.
- [ ] Put behavior changes in their own commits after characterization tests exist.
- [ ] Run focused tests immediately after each split.
- [ ] Run the full gate before declaring any branch ready.
- [ ] Run read-only release-state checks before and after any production promotion.
- [ ] Treat authenticated browser checks, live checks, pushed, deployed, and local validation as separate states in every handoff.

## Branch Model

Use this branch stack:

```text
origin/main
  └─ codex/xot-cleanup-00-baseline
      └─ codex/xot-cleanup-03-spaghetti-map
          └─ codex/xot-cleanup-04-admin-actions-split
              └─ codex/xot-cleanup-09-worker-audit-split
                  └─ codex/xot-cleanup-10-worker-lifecycle-split
                      └─ codex/xot-cleanup-11-worker-video-gate-split
                          └─ codex/xot-cleanup-12-worker-telegram-split
                              └─ codex/xot-cleanup-13-worker-xapi-split
                                  └─ codex/xot-cleanup-14-worker-media-split
                                      └─ codex/xot-cleanup-20-frontend-admin-contracts
                                          └─ codex/xot-cleanup-21-monitoring-split
                                              └─ codex/xot-cleanup-22-settings-dashboard-xaccount
                                                  └─ codex/xot-cleanup-30-renderer-runtime-security
                                                      └─ codex/xot-cleanup-40-integration
```

If a phase becomes risky, create a sibling branch from the last green parent instead of continuing on the broken branch:

```bash
git switch <last-green-branch>
git switch -c codex/xot-cleanup-XX-risk-isolated
```

## Universal Branch Start Checklist

- [ ] Confirm current branch and cleanliness.

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected:

```text
No unrelated dirty files.
Current branch is a codex/xot-cleanup-* branch.
```

- [ ] Confirm the branch is based on the intended parent.

```bash
git merge-base --is-ancestor <parent-branch> HEAD
```

Expected:

```text
Exit code 0.
```

- [ ] Refresh baseline if the phase touches live-sensitive code.

```bash
npm run check:release-state
```

Expected:

```text
Read-only production inventory completes.
Any blocker is recorded before code changes.
```

## Universal Validation Gate

Run this before marking any cleanup phase ready:

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run check:function-inventory
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=test_publishable_key_for_local_build \
VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer \
npm run build
npm run check:release-state
git diff --check
```

Known acceptable warning baseline:

```text
npm run lint may report existing Fast Refresh warnings in UI/Auth files.
Those warnings are not introduced by cleanup branches unless the touched file changes them.
```

For renderer-specific phases, add:

```bash
npm --prefix services/video-renderer test
npm --prefix services/video-renderer audit --audit-level=low
```

## Parallel Agent Plan

Use parallel agents for independent review and evidence collection, not for uncontrolled edits.

### Agent A: Worker Audit And Refactor Reviewer

- [ ] Review `supabase/functions/worker/index.ts`.
- [ ] Identify job domains, hidden shared state, retry paths, and external API coupling.
- [ ] Review split branches for behavior drift.
- [ ] Verify Deno focused tests cover moved helpers.
- [ ] Report risks with exact files and line references.

### Agent B: Frontend Audit And Refactor Reviewer

- [ ] Review `src/pages/Monitoring.tsx`.
- [ ] Review `src/hooks/useMonitoringData.ts`.
- [ ] Review `src/hooks/useDashboardData.ts`.
- [ ] Review `src/hooks/useSettingsData.ts`.
- [ ] Review `src/pages/Settings.tsx`.
- [ ] Review `src/pages/XAccount.tsx`.
- [ ] Identify UI/API contract drift and direct Supabase writes.

### Agent C: Ops, Release, And Production-State Reviewer

- [ ] Review `docs/operations/release-runbook.md`.
- [ ] Review `scripts/check-release-state.sh`.
- [ ] Review `scripts/deploy-functions.sh`.
- [ ] Review `supabase/config.toml`.
- [ ] Confirm cleanup does not weaken deploy safety.
- [ ] Confirm production checks are read-only until promotion.

### Agent D: Database And Contract Reviewer

- [ ] Review migration history and Supabase type drift.
- [ ] Review generated type usage in `src/integrations/supabase/types.ts`.
- [ ] Identify fallback query branches masking schema drift.
- [ ] Propose migration trust repair without applying production migrations.

### Agent E: Security Reviewer

- [ ] Review `verify_jwt=false` functions in `supabase/config.toml`.
- [ ] Review service-role client creation in Edge Functions.
- [ ] Review renderer auth behavior.
- [ ] Review query-token compatibility for RSS.app webhooks.
- [ ] Report auth/secret risks separately from code organization risks.

### Agent F: Test And CI Reviewer

- [ ] Review `package.json` scripts.
- [ ] Review `.github/workflows/ci.yml`.
- [ ] Review Vitest and Deno test coverage.
- [ ] Identify missing characterization tests before major splits.
- [ ] Confirm every branch has a focused and full validation path.

## File Ownership Map

### Backend Functions

- `supabase/functions/admin-actions/index.ts`: top-level admin HTTP entrypoint and dispatcher.
- `supabase/functions/admin-actions/actions/*.ts`: domain handlers split out of the dispatcher.
- `supabase/functions/worker/index.ts`: queue claim and top-level job dispatch.
- `supabase/functions/worker/workerUtils.ts`: shared pure worker helpers.
- `supabase/functions/worker/jobLifecycle.ts`: retry, dead-letter, metadata merge, and pipeline event helpers.
- `supabase/functions/worker/videoRenderWorkflow.ts`: video render gate, delivery enqueue, and render-posted metadata helpers.
- `supabase/functions/worker/telegramDelivery.ts`: Telegram API send helpers, media upload helpers, rate-limit handling, and adaptive spacing.
- `supabase/functions/worker/xApiWorkflow.ts`: X/Twitter hydration, RSSApp URL handling, and variant parsing helpers.
- `supabase/functions/worker/mediaWorkflow.ts`: media resolution, download handoff, and source selection.
- `supabase/functions/x-poster/index.ts`: X posting and X media handling.
- `supabase/functions/media-processor/index.ts`: media download and cleanup edge service.
- `supabase/functions/_shared/*.ts`: reusable shared function logic.

### Frontend

- `src/pages/Monitoring.tsx`: final goal is page composition only.
- `src/api/adminActions.ts`: typed client wrapper for `admin-actions`.
- `src/api/adminRetry.ts`: typed client wrapper for `admin-retry`.
- `supabase/functions/_shared/adminActionNames.ts`: canonical admin action-name list shared by function and frontend code.
- `src/lib/monitoringViewModel.ts`: grouping, display normalization, duplicate cluster view models.
- `src/components/monitoring/*.tsx`: Monitoring toolbar, queue cards, row, drawer, and confirmation dialog.
- `src/hooks/useMonitoringData.ts`: Monitoring data fetching only.
- `src/hooks/useDashboardData.ts`: Dashboard data fetching and normalization only.
- `src/hooks/useSettingsData.ts`: settings reads/writes through one path.
- `src/pages/Settings.tsx`: page composition only after extraction.
- `src/pages/XAccount.tsx`: page composition only after extraction.

### Renderer And Ops

- `services/video-renderer/src/preflight.js`: preflight orchestration.
- `services/video-renderer/src/openai.js`: OpenAI transcription, translation, cleanup, and vision calls.
- `services/video-renderer/src/config.js`: renderer configuration target.
- `services/video-renderer/test/*.test.js`: renderer coverage.
- `scripts/check-release-state.sh`: read-only production state.
- `scripts/deploy-functions.sh`: guarded function deploy.
- `docs/operations/release-runbook.md`: production release gate.
- `docs/operations/cleanup-baseline.md`: validation baseline.
- `docs/audit/2026-06-14-xot-spaghetti-map.md`: cleanup target evidence.

---

# Phase 0: Safety Baseline And Inventory

Status: completed in the cleanup worktree.

## Objective

Establish exactly what exists locally, in GitHub, and in production before cleanup begins.

## Steps

- [x] Create or reuse isolated worktree:

```text
/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup
```

- [x] Keep the main checkout untouched:

```text
/Users/stevmq/Finalized XOT
```

- [x] Capture package scripts, dependency baseline, and runtime mismatch.
- [x] Run install and validation baseline.
- [x] Record baseline in `docs/operations/cleanup-baseline.md`.
- [x] Run read-only release-state inventory.
- [x] Record production release guardrails in `docs/operations/release-runbook.md`.

## Validation

Previously completed baseline commands:

```bash
npm ci
npm --prefix services/video-renderer ci
npm run lint
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run check:strict
npm test
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key \
VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer \
npm run build
npm --prefix services/video-renderer test
npm run check:release-state
```

## Exit Criteria

- [x] Baseline is documented.
- [x] Existing warnings and audit failures are separated from cleanup-introduced issues.
- [x] Production state is inspected read-only.

---

# Phase 1: Spaghetti Map And Prioritization

Status: completed as audit documentation.

## Objective

Identify the confusing, high-risk, large-file knots before refactoring.

## Steps

- [x] Map largest files by line count.
- [x] Map biggest behavior knots:
  - `supabase/functions/admin-actions/index.ts`
  - `supabase/functions/worker/index.ts`
  - `src/pages/Monitoring.tsx`
  - `src/hooks/useMonitoringData.ts`
  - `src/hooks/useDashboardData.ts`
  - `src/hooks/useSettingsData.ts`
  - `src/pages/Settings.tsx`
  - `src/pages/XAccount.tsx`
  - `services/video-renderer/src/preflight.js`
  - `services/video-renderer/src/openai.js`
- [x] Record findings in `docs/audit/2026-06-14-xot-spaghetti-map.md`.
- [x] Classify each finding by production risk and cleanup value.

## Exit Criteria

- [x] Cleanup targets are evidence-backed.
- [x] Refactor order favors high-risk knots with available tests.
- [x] Release and migration risks are not mixed into cosmetic cleanup.

---

# Phase 2: Admin Actions Split

Status: completed in cleanup branch history.

## Objective

Reduce `supabase/functions/admin-actions/index.ts` from one large control-plane knot into domain action modules while preserving all action names and response shapes.

## Already Completed Commits

```text
2ce1440 refactor: extract basic admin actions
2228ab8 refactor: extract admin settings actions
6bd7ee6 refactor: extract dedupe admin actions
52e9732 refactor: extract x posting admin actions
edae7f8 refactor: extract x api admin actions
```

Additional completed admin action split commits exist in this branch stack for video render, dashboard, monitoring, scoring, enrichment, maintenance, translation rescore, duplicate clearing, side effects, and manual advance handling.

## Required Review Steps

- [ ] Confirm `supabase/functions/admin-actions/index.ts` remains the only HTTP entrypoint.
- [ ] Confirm auth and CORS behavior did not move into action modules.
- [ ] Confirm each extracted module exports action handlers only.
- [ ] Confirm every original action string is still handled.
- [ ] Confirm response shapes remain backward compatible for current frontend callers.
- [ ] Add an action registry test if not already present.

## Action Registry Test Shape

Create or extend a Deno test that asserts all exported action names are unique and dispatchable:

```ts
Deno.test("admin action registry has unique names", () => {
  const names = Object.keys(adminActionHandlers);
  const unique = new Set(names);
  assertEquals(unique.size, names.length);
  assert(names.includes("get_dashboard_summary"));
  assert(names.includes("get_video_render_queue"));
  assert(names.includes("retry_x_post"));
});
```

## Validation

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm run check:strict
npm test
npm run build
```

## Exit Criteria

- [ ] Dispatcher is primarily routing and authentication.
- [ ] Action modules are organized by domain.
- [ ] Frontend action names still work.
- [ ] No production deployment has occurred from the cleanup branch.

---

# Phase 3: Worker Split, Part A - Shared Utility Helpers

Status: completed.

## Objective

Move pure worker helpers out of `supabase/functions/worker/index.ts` without behavior changes.

## Completed Files

- `supabase/functions/worker/workerUtils.ts`
- `supabase/functions/worker/workerUtils.test.ts`
- `supabase/functions/worker/index.ts`

## Completed Scope

- [x] Extract job lane helpers.
- [x] Extract media text parsing helpers.
- [x] Extract timing metadata helpers.
- [x] Extract Telegram parse-error helpers.
- [x] Extract RM/X URL and variant helpers.

## Validation

```bash
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/workerUtils.ts supabase/functions/worker/workerUtils.test.ts
npx --yes deno test supabase/functions/worker/workerUtils.test.ts
npx --yes deno lint supabase/functions/worker/index.ts supabase/functions/worker/workerUtils.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run check:function-inventory
npm run build
npm run check:release-state
```

## Exit Criteria

- [x] Utility helpers are testable outside the worker entrypoint.
- [x] Worker behavior remains unchanged.

---

# Phase 4: Worker Split, Part B - Job Lifecycle

Status: completed.

## Objective

Move retry/dead-letter/pipeline-event lifecycle code out of `worker/index.ts`.

## Completed Files

- `supabase/functions/worker/jobLifecycle.ts`
- `supabase/functions/worker/jobLifecycle.test.ts`
- `supabase/functions/worker/index.ts`

## Completed Scope

- [x] Extract `NonRetryableJobError`.
- [x] Extract `MAX_ATTEMPTS`.
- [x] Extract `handleJobFailure`.
- [x] Extract metadata merge behavior.
- [x] Extract pipeline event insert helpers.

## Required Behavior Guarantees

- [x] Non-retryable failures move to dead-letter behavior.
- [x] Rate-limit failures reschedule with retry-after seconds.
- [x] Retryable failures increment attempts and preserve metadata.
- [x] Pipeline event insert failures stay best-effort and do not kill the worker.

## Validation

```bash
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/jobLifecycle.ts supabase/functions/worker/jobLifecycle.test.ts
npx --yes deno test supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npx --yes deno lint supabase/functions/worker/index.ts supabase/functions/worker/jobLifecycle.ts supabase/functions/worker/jobLifecycle.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run check:function-inventory
npm run build
npm run check:release-state
```

## Exit Criteria

- [x] Failure policy is isolated and covered by tests.
- [x] Job handlers no longer own retry mechanics directly.

---

# Phase 5: Worker Split, Part C - Video Render Workflow

Status: completed.

## Objective

Extract video-render gate, renderer dispatch, and render-posted bookkeeping from `worker/index.ts`.

## Completed Files

- `supabase/functions/worker/videoRenderWorkflow.ts`
- `supabase/functions/worker/videoRenderWorkflow.test.ts`
- `supabase/functions/worker/index.ts`

## Completed Scope

- [x] Extract `VIDEO_RENDER_VERSION`.
- [x] Extract `VIDEO_RENDER_DEFER_MS`.
- [x] Extract config loading.
- [x] Extract render decision loading.
- [x] Extract renderer dispatch for target.
- [x] Extract render-gate preparation.
- [x] Extract delivery job enqueue after render gate.
- [x] Extract render-posted marking.

## Required Behavior Guarantees

- [x] Disabled video config bypasses the gate.
- [x] Shadow mode can wait for media without blocking final delivery.
- [x] Active mode blocks when render is required and not ready.
- [x] Ready rendered media can dispatch X posting.
- [x] Pending render defers delivery safely.
- [x] Posted metadata is retained.

## Validation

```bash
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/videoRenderWorkflow.ts supabase/functions/worker/videoRenderWorkflow.test.ts
npx --yes deno test supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npx --yes deno lint supabase/functions/worker/index.ts supabase/functions/worker/videoRenderWorkflow.ts supabase/functions/worker/videoRenderWorkflow.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run check:function-inventory
npm run build
npm run check:release-state
```

## Exit Criteria

- [x] Video render policy can be reviewed separately from Telegram delivery.
- [x] Worker index is smaller and still owns top-level job dispatch.

---

# Phase 6: Worker Split, Part D - Telegram Delivery Helpers

Status: completed in cleanup branch history.

Completed commit:

```text
eb19c66 refactor: extract worker telegram delivery helpers
```

Branch:

```text
codex/xot-cleanup-12-worker-telegram-split
```

## Objective

Extract Telegram send/media helpers from `worker/index.ts` while keeping `handleDeliverJob` in place for now.

## Files

- Create: `supabase/functions/worker/telegramDelivery.ts`
- Create: `supabase/functions/worker/telegramDelivery.test.ts`
- Modify: `supabase/functions/worker/index.ts`

## Functions To Move

- `mapLimit`
- `fetchImageBytes`
- `sendTelegramPhotoFromStorage`
- `sendTelegramPhotoGroupFromStorage`
- `telegramVideoTooLargeError`
- `fetchVideoBytes`
- `sendTelegramVideoFromStorage`
- `sendTelegramMedia`
- `throwTelegramError`
- `getMediaUrl`
- `TelegramRateLimitError`
- `computeAdaptiveSpacing`

## Implementation Steps

- [ ] Confirm current worker helper boundaries.

```bash
rg -n "function (mapLimit|fetchImageBytes|sendTelegramPhotoFromStorage|sendTelegramPhotoGroupFromStorage|telegramVideoTooLargeError|fetchVideoBytes|sendTelegramVideoFromStorage|sendTelegramMedia|throwTelegramError|getMediaUrl|computeAdaptiveSpacing)|class TelegramRateLimitError" supabase/functions/worker/index.ts
```

- [ ] Create `supabase/functions/worker/telegramDelivery.ts` with imports:

```ts
import {
  isTelegramBotVideoTooLarge,
  telegramVideoTooLargeReason,
} from "../_shared/telegramVideoLimits.ts";
import { NonRetryableJobError } from "./jobLifecycle.ts";
import {
  extractTelegramRetryAfter,
  finiteMediaNumber,
  isTelegramParseError,
  stripMarkdownToPlain,
  videoUploadFilename,
} from "./workerUtils.ts";
```

- [ ] Move helper bodies verbatim first.
- [ ] Export only what `worker/index.ts` needs:

```ts
export {
  computeAdaptiveSpacing,
  getMediaUrl,
  sendTelegramMedia,
  sendTelegramPhotoFromStorage,
  sendTelegramPhotoGroupFromStorage,
  sendTelegramVideoFromStorage,
  throwTelegramError,
};
```

- [ ] Export `TelegramRateLimitError` for focused tests.
- [ ] Update `worker/index.ts` imports:

```ts
import {
  computeAdaptiveSpacing,
  getMediaUrl,
  sendTelegramMedia,
  sendTelegramPhotoFromStorage,
  sendTelegramPhotoGroupFromStorage,
  sendTelegramVideoFromStorage,
  throwTelegramError,
} from "./telegramDelivery.ts";
```

- [ ] Remove now-unused imports from `worker/index.ts`.
- [ ] Remove the moved helper bodies from `worker/index.ts`.

## Tests To Add

- [ ] `getMediaUrl` returns signed storage URL when signing succeeds.
- [ ] `getMediaUrl` falls back to `src_url` when signing fails.
- [ ] `sendTelegramMedia` retries Markdown parse errors with stripped plain text.
- [ ] `sendTelegramMedia` throws `TelegramRateLimitError` with `retryAfterSeconds` on Telegram `retry_after`.
- [ ] `sendTelegramVideoFromStorage` throws `NonRetryableJobError` when declared video size exceeds Telegram bot limit.
- [ ] `computeAdaptiveSpacing` returns expected spacing for zero, low, medium, and high recent rate-limit counts.

## Focused Validation

```bash
npx --yes deno fmt supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/telegramDelivery.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/jobLifecycle.ts supabase/functions/worker/workerUtils.ts
npx --yes deno test supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npx --yes deno lint supabase/functions/worker/index.ts supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.ts supabase/functions/worker/workerUtils.test.ts
git diff --check
```

## Full Validation

Run the Universal Validation Gate.

## Commit

```bash
git add supabase/functions/worker/index.ts supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/telegramDelivery.test.ts
git commit -m "refactor: extract worker telegram delivery helpers"
```

## Exit Criteria

- [ ] Telegram helpers are unit-tested outside `worker/index.ts`.
- [ ] `handleDeliverJob` behavior is unchanged.
- [ ] Rate-limit handling still reaches job failure retry logic.
- [ ] Full local gate passes.

---

# Phase 7: Worker Split, Part E - X API And Hydration

Status: completed in cleanup branch history.

Completed commit:

```text
454ec7c refactor: extract worker x api workflow helpers
```

Branch:

```text
codex/xot-cleanup-13-worker-xapi-split
```

## Objective

Extract X/Twitter hydration and URL/media variant parsing from `worker/index.ts`.

## Files

- Create: `supabase/functions/worker/xApiWorkflow.ts`
- Create: `supabase/functions/worker/xApiWorkflow.test.ts`
- Modify: `supabase/functions/worker/index.ts`

## Candidate Responsibilities

- Hydration job handler helpers.
- RSSApp URL normalization.
- X handle extraction from URLs.
- Numeric tweet id extraction.
- RM image URL upgrade rules.
- Best variant selection.
- Metadata merge for X API results.

## Steps

- [ ] Locate hydration entrypoints.

```bash
rg -n "hydrate|x api|twitter|tweet|rssapp|rmPickBestVariant|extractNumericTweetId|extractHandleFromUrl" supabase/functions/worker/index.ts supabase/functions/worker/workerUtils.ts
```

- [ ] Write focused tests for pure parsing helpers before moving handler code.
- [ ] Move pure parsing helpers into `xApiWorkflow.ts` if they are not already in `workerUtils.ts`.
- [ ] Move hydration metadata shaping into `xApiWorkflow.ts`.
- [ ] Keep job dispatch in `worker/index.ts`.
- [ ] Keep service-role Supabase client creation in `worker/index.ts` unless the extracted handler has a clear dependency interface.

## Test Cases

- [ ] Numeric tweet id extracted from canonical X URL.
- [ ] Numeric tweet id extracted from Twitter URL.
- [ ] Invalid URLs return null instead of throwing.
- [ ] X handle extraction handles profile URL and status URL.
- [ ] RM variant selector picks highest useful quality.
- [ ] Hydration metadata merge preserves existing metadata keys.

## Validation

```bash
npx --yes deno fmt supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/xApiWorkflow.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/xApiWorkflow.test.ts
npx --yes deno test supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
```

## Commit

```bash
git add supabase/functions/worker/index.ts supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/xApiWorkflow.test.ts
git commit -m "refactor: extract worker x api workflow"
```

## Exit Criteria

- [ ] Hydration helper logic can be reviewed without opening the whole worker.
- [ ] No X posting behavior changes are included in this phase.
- [ ] Full local gate passes.

---

# Phase 8: Worker Split, Part F - Media Resolution And Media Processor Boundary

Status: completed in cleanup branch history.

Completed commit:

```text
47cf77a refactor: extract worker media workflow helpers
```

Branch:

```text
codex/xot-cleanup-14-worker-media-split
```

## Objective

Extract worker-side media resolution and media-processor handoff logic while preserving the existing media download behavior.

## Files

- Create: `supabase/functions/worker/mediaWorkflow.ts`
- Create: `supabase/functions/worker/mediaWorkflow.test.ts`
- Modify: `supabase/functions/worker/index.ts`
- Inspect: `supabase/functions/media-processor/index.ts`
- Inspect: `supabase/functions/_shared/media*.ts`

## Steps

- [ ] Locate media-related worker code.

```bash
rg -n "download_media|resolve_media|media-processor|getMediaUrl|storage_path|rendered_media|media_url|src_url" supabase/functions/worker supabase/functions/media-processor supabase/functions/_shared
```

- [ ] Write tests for media source selection:
  - rendered media preferred when delivery requires rendered video.
  - original media used when render config does not require rendered video.
  - invalid storage metadata does not throw.
  - missing media produces a non-retryable or retryable result matching existing behavior.
- [ ] Extract media source selection into `mediaWorkflow.ts`.
- [ ] Extract media-processor invoke payload construction into `mediaWorkflow.ts`.
- [ ] Keep actual job dispatch and job state writes in `worker/index.ts` during this phase.

## Validation

```bash
npx --yes deno fmt supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
npx --yes deno test supabase/functions/worker/mediaWorkflow.test.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
```

## Commit

```bash
git add supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
git commit -m "refactor: extract worker media workflow"
```

## Exit Criteria

- [ ] Media selection logic is isolated.
- [ ] Download handoff payloads are tested.
- [ ] Delivery and video-render gates still pass full worker tests.

---

# Phase 9: Worker Split, Part G - Translate, Scoring, And Enrichment Boundaries

Status: implementation completed in branch `codex/xot-cleanup-15-worker-translate-scoring-split`; one pre-existing missing-source early-return path remains noted as an explicit test gap.

Completed commits:

- `037d320 refactor: extract worker translate scoring prompts`
- `2a7034f refactor: extract worker scoring tool parsing`
- `a68c7c2 refactor: extract worker scoring call options`
- `5d9d0c4 refactor: extract worker translation call options`
- `a953681 refactor: extract worker scoring base decision`
- `7229783 refactor: extract worker post-translation routing`
- `9354e5d refactor: extract worker translation metadata patches`

Branch:

```text
codex/xot-cleanup-15-worker-translate-scoring-split
```

## Objective

Reduce `handleTranslateJob` complexity by extracting scoring prompt construction, scoring policy application, translation payload construction, and next-job routing decisions.

## Files

- Create: `supabase/functions/worker/translateWorkflow.ts`
- Create: `supabase/functions/worker/translateWorkflow.test.ts`
- Create: `supabase/functions/worker/scoringWorkflow.ts`
- Create: `supabase/functions/worker/scoringWorkflow.test.ts`
- Modify: `supabase/functions/worker/index.ts`
- Inspect: `supabase/functions/_shared/enrich.ts`
- Inspect: `supabase/functions/_shared/dedupe.ts`

## Steps

- [x] Locate translate job boundaries.

```bash
rg -n "handleTranslateJob|scoring|score|translation|translate|dedupe|enrich|policy_rule_applied" supabase/functions/worker/index.ts supabase/functions/_shared
```

- [x] Add characterization tests for scoring decision outputs.
- [x] Add characterization tests for translation metadata preservation.
- [x] Extract scoring prompt/tool schema construction into `scoringWorkflow.ts`.
- [x] Extract scoring policy application into `scoringWorkflow.ts`.
- [x] Extract translation request shaping into `translateWorkflow.ts`.
- [x] Extract post-translation next-job routing into `translateWorkflow.ts`.
- [x] Keep external OpenAI calls in the existing path until request/response shapes are tested.

## Test Cases

- [x] Low score produces the same skip/drop decision as before.
- [x] Duplicate scoring metadata is preserved.
- [x] Regional escalation metadata is preserved.
- [x] Successful translation creates the same delivery enqueue decision.
- [ ] Missing source text follows the existing failure path. Current code still preserves the existing early return in `handleTranslateJob`, but there is not yet a focused test for that branch.

## Validation

```bash
npx --yes deno fmt supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/scoringWorkflow.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/scoringWorkflow.test.ts
npx --yes deno test supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.test.ts supabase/functions/worker/mediaWorkflow.test.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
```

## Commit

```bash
git add supabase/functions/worker/index.ts supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/scoringWorkflow.test.ts
git commit -m "refactor: extract worker translate and scoring workflows"
```

## Exit Criteria

- [x] Translation/scoring decisions are isolated and tested.
- [x] OpenAI request behavior is unchanged.
- [x] Worker job dispatch remains stable.

---

# Phase 10: Frontend Admin Action Contracts

Status: completed in branch `codex/xot-cleanup-20-frontend-admin-contracts`.

Branch:

```text
codex/xot-cleanup-20-frontend-admin-contracts
```

## Objective

Stop scattering `supabase.functions.invoke("admin-actions")` calls across pages and hooks.

## Files

- Existing canonical contract: `supabase/functions/_shared/adminActionNames.ts`
- Modify: `src/api/adminActions.ts`
- Create: `src/api/adminRetry.ts`
- Existing test: `src/test/admin-actions-contract.test.ts`
- Modify: `src/components/dashboard/DashboardHealth.tsx`
- Modify: `src/components/layout/VersionBanner.tsx`
- Modify: `src/components/settings/EditorialProfilesCard.tsx`
- Modify: `src/components/settings/EnrichmentSettings.tsx`
- Modify: `src/components/settings/LearnedSignalsCard.tsx`
- Modify: `src/components/settings/ScoringStudio.tsx`
- Modify: `src/components/settings/StoryMemoryCard.tsx`
- Modify: `src/components/settings/XAutomationSettings.tsx`
- Modify: `src/components/settings/XPostingConfig.tsx`
- Modify: `src/pages/Downloader.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/Threads.tsx`
- Modify: `src/pages/XAccount.tsx`

## Steps

- [x] Locate all admin function invocations.

```bash
rg -n "functions\\.invoke\\(['\\\"]admin-actions|functions\\.invoke\\(['\\\"]admin-retry" src
```

- [x] Reuse `supabase/functions/_shared/adminActionNames.ts` as the canonical action-name list instead of creating a duplicate frontend-only list.
- [x] Extend `src/api/adminActions.ts` with an optional `throwOnFailure: false` mode for actions that intentionally render `ok: false` inline.
- [x] Create `src/api/adminRetry.ts` with one `admin-retry` wrapper.
- [x] Convert direct `admin-actions` and `admin-retry` frontend invocations in:
  - `src/components/dashboard/DashboardHealth.tsx`
  - `src/components/layout/VersionBanner.tsx`
  - `src/components/settings/EditorialProfilesCard.tsx`
  - `src/components/settings/EnrichmentSettings.tsx`
  - `src/components/settings/LearnedSignalsCard.tsx`
  - `src/components/settings/ScoringStudio.tsx`
  - `src/components/settings/StoryMemoryCard.tsx`
  - `src/components/settings/XAutomationSettings.tsx`
  - `src/components/settings/XPostingConfig.tsx`
  - `src/pages/Downloader.tsx`
  - `src/pages/Settings.tsx`
  - `src/pages/Threads.tsx`
  - `src/pages/XAccount.tsx`
- [x] Leave backend dispatcher unchanged in this phase.
- [x] Confirm only wrappers still call raw admin functions from `src`.

## Test

Keep `src/test/admin-actions-contract.test.ts` covering the shared canonical action list:

```ts
import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_NAMES } from "../../supabase/functions/_shared/adminActionNames";

describe("admin action contracts", () => {
  it("does not contain duplicate frontend action names", () => {
    expect(new Set(ADMIN_ACTION_NAMES).size).toBe(ADMIN_ACTION_NAMES.length);
  });

  it("includes the core operational actions", () => {
    expect(ADMIN_ACTION_NAMES).toContain("get_dashboard_summary");
    expect(ADMIN_ACTION_NAMES).toContain("get_monitoring_entries");
    expect(ADMIN_ACTION_NAMES).toContain("get_video_render_queue");
    expect(ADMIN_ACTION_NAMES).toContain("retry_x_post");
  });
});
```

## Validation

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test -- src/test/admin-actions-contract.test.ts
npm test
npm run check:function-inventory
npm run build
npm run check:release-state
git diff --check
```

## Commit

```bash
git add src/api/adminActions.ts src/api/adminRetry.ts src/components/dashboard/DashboardHealth.tsx src/components/layout/VersionBanner.tsx src/components/settings/EditorialProfilesCard.tsx src/components/settings/EnrichmentSettings.tsx src/components/settings/LearnedSignalsCard.tsx src/components/settings/ScoringStudio.tsx src/components/settings/StoryMemoryCard.tsx src/components/settings/XAutomationSettings.tsx src/components/settings/XPostingConfig.tsx src/pages/Downloader.tsx src/pages/Settings.tsx src/pages/Threads.tsx src/pages/XAccount.tsx docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "refactor: centralize frontend admin action clients"
```

## Exit Criteria

- [x] New admin actions have one obvious frontend entrypoint.
- [x] Existing UI behavior is unchanged.
- [x] Contract tests prevent duplicate frontend action names.
- [x] Raw `admin-actions` and `admin-retry` frontend invocation sites are limited to `src/api/adminActions.ts` and `src/api/adminRetry.ts`.

---

# Phase 11: Monitoring Page Split

Status: partially completed in branch `codex/xot-cleanup-21-monitoring-split`.

Completed slice:

- Extracted view-model helpers and duplicate-cluster logic to `src/lib/monitoringViewModel.ts`.
- Extracted Monitoring admin action wrappers and confirmation copy to `src/lib/monitoringActions.ts`.
- Extracted the confirmation dialog to `src/components/monitoring/MonitoringActionDialog.tsx`.
- Extracted the queue filter/bulk-action toolbar to `src/components/monitoring/MonitoringFilters.tsx`.
- Extracted the summary metric cards to `src/components/monitoring/MonitoringQueueCards.tsx`.
- Extracted the delivery timeline panel to `src/components/monitoring/MonitoringDeliveryTimeline.tsx`.
- Added focused coverage in `src/test/monitoring-view-model.test.ts` and `src/test/monitoring-actions.test.ts`.

Remaining in this phase:

- Row/card renderer extraction.
- Detail drawer extraction.
- Optional `src/hooks/useMonitoringData.ts` cleanup is deferred to Phase 12 so fallback behavior stays isolated.

Branch:

```text
codex/xot-cleanup-21-monitoring-split
```

## Objective

Turn `src/pages/Monitoring.tsx` into a page composition file instead of a combined API client, state machine, action router, and renderer.

## Files

- Create: `src/lib/monitoringViewModel.ts`
- Create: `src/lib/monitoringActions.ts`
- Create: `src/components/monitoring/MonitoringFilters.tsx`
- Create: `src/components/monitoring/MonitoringQueueCards.tsx`
- Create: `src/components/monitoring/MonitoringRow.tsx`
- Create: `src/components/monitoring/MonitoringDetailDrawer.tsx`
- Create: `src/components/monitoring/MonitoringActionDialog.tsx`
- Create: `src/components/monitoring/MonitoringDeliveryTimeline.tsx`
- Create: `src/test/monitoring-view-model.test.ts`
- Create: `src/test/monitoring-actions.test.ts`
- Modify: `src/pages/Monitoring.tsx`
- Modify: `src/hooks/useMonitoringData.ts`

## Steps

- [x] Locate page-local pure helpers.

```bash
rg -n "function |const .* = \\(|useMemo|useCallback|confirm|drawer|cluster|group|filter|action" src/pages/Monitoring.tsx
```

- [x] Move pure grouping/normalization helpers to `src/lib/monitoringViewModel.ts`.
- [x] Add tests for duplicate cluster grouping and action labels.
- [x] Move action title/description mapping to `src/lib/monitoringActions.ts`.
- [x] Move Monitoring admin action wrappers to `src/lib/monitoringActions.ts`.
- [x] Extract filters toolbar component.
- [x] Extract queue cards component.
- [ ] Extract row component.
- [ ] Extract detail drawer component.
- [x] Extract confirmation dialog component.
- [x] Extract delivery timeline panel component.
- [ ] Keep page-level React Query state and URL/search params in `Monitoring.tsx`.
- [ ] After each component extraction, run the focused frontend tests.

## Test Cases

- [ ] Filtering by status returns the same row ids as before.
- [x] Duplicate cluster display model preserves original cluster order.
- [x] Action dialog title for retry/rescore/dedupe matches current text.
- [ ] Empty state remains visible when no entries match filters.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/monitoring-view-model.test.ts src/test/monitoring-actions.test.ts src/test/monitoring-state.test.ts src/test/timeline-display.test.ts
npm test
npm run build
```

## Commit

```bash
git add src/pages/Monitoring.tsx src/lib/monitoringViewModel.ts src/lib/monitoringActions.ts src/components/monitoring/MonitoringActionDialog.tsx src/components/monitoring/MonitoringFilters.tsx src/components/monitoring/MonitoringQueueCards.tsx src/test/monitoring-view-model.test.ts src/test/monitoring-actions.test.ts docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "refactor: extract monitoring view model and controls"
```

## Exit Criteria

- [ ] `Monitoring.tsx` reads as composition and orchestration.
- [x] Action calls are imported from centralized API wrappers.
- [x] View-model logic has unit coverage.
- [x] Build output still succeeds.

---

# Phase 12: Monitoring Data Fallback Repair

Branch:

```text
codex/xot-cleanup-22-monitoring-data-contracts
```

## Objective

Make schema fallback behavior explicit and testable so local UI compatibility does not hide production schema drift.

## Files

- Modify: `src/hooks/useMonitoringData.ts`
- Create: `src/api/monitoringData.ts`
- Create: `src/test/monitoring-data-fallbacks.test.ts`
- Inspect: `src/integrations/supabase/types.ts`

## Steps

- [ ] Locate fallback query branches.

```bash
rg -n "fallback|legacy|unknown|Record<string, unknown>|missing|schema|column" src/hooks/useMonitoringData.ts src/hooks/useDashboardData.ts
```

- [ ] Move admin-actions-first fetching to `src/api/monitoringData.ts`.
- [ ] Move legacy query fallback to a named function:

```ts
export async function fetchMonitoringEntriesWithLegacyFallback() {
  return fetchMonitoringEntriesViaAdminActions().catch((error) => {
    return fetchMonitoringEntriesViaLegacyQueries(error);
  });
}
```

- [ ] Add tests that verify fallback is called only after the admin-actions path fails.
- [ ] Add a log or returned metadata flag that says which data source was used.
- [ ] Keep the fallback alive until production schema/type drift is fixed.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/monitoring-data-fallbacks.test.ts src/test/monitoring-state.test.ts
npm test
npm run build
```

## Commit

```bash
git add src/hooks/useMonitoringData.ts src/api/monitoringData.ts src/test/monitoring-data-fallbacks.test.ts
git commit -m "refactor: isolate monitoring data fallbacks"
```

## Exit Criteria

- [ ] Fallback compatibility is intentional and visible.
- [ ] UI no longer hides schema drift inside page logic.
- [ ] A later schema cleanup can remove fallback paths cleanly.

---

# Phase 13: Settings, Dashboard, And XAccount Split

Branch:

```text
codex/xot-cleanup-23-settings-dashboard-xaccount
```

## Objective

Apply the same cleanup discipline to Settings, Dashboard, and XAccount without bloating the UI or changing operator workflows.

## Files

- Modify: `src/pages/Settings.tsx`
- Modify: `src/hooks/useSettingsData.ts`
- Modify: `src/components/settings/EnrichmentSettings.tsx`
- Modify: `src/components/settings/XAutomationSettings.tsx`
- Modify: `src/hooks/useDashboardData.ts`
- Modify: `src/components/dashboard/DashboardHealth.tsx`
- Modify: `src/pages/XAccount.tsx`
- Create: `src/api/settingsData.ts`
- Create: `src/api/dashboardData.ts`
- Create: `src/api/xAccountData.ts`
- Create: `src/test/settings-data.test.ts`
- Create: `src/test/dashboard-data.test.ts`
- Create: `src/test/x-account-data.test.ts`

## Steps

- [ ] Locate direct settings table writes.

```bash
rg -n "from\\(['\\\"]settings|\\.update\\(|\\.insert\\(|\\.upsert\\(|admin-actions|admin-retry" src/pages/Settings.tsx src/hooks/useSettingsData.ts src/components/settings src/hooks/useDashboardData.ts src/components/dashboard src/pages/XAccount.tsx
```

- [ ] Move settings reads/writes to `src/api/settingsData.ts`.
- [ ] Route `EnrichmentSettings` through the same settings save path as other settings components.
- [ ] Move dashboard summary fetch and normalization to `src/api/dashboardData.ts`.
- [ ] Move X account status/follower snapshot actions to `src/api/xAccountData.ts`.
- [ ] Add tests for normalization behavior and action names.
- [ ] Keep UI layout unchanged unless a layout bug is found during browser checks.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/settings-data.test.ts src/test/dashboard-data.test.ts src/test/x-account-data.test.ts
npm test
npm run build
```

## Commit

```bash
git add src/pages/Settings.tsx src/hooks/useSettingsData.ts src/components/settings/EnrichmentSettings.tsx src/components/settings/XAutomationSettings.tsx src/hooks/useDashboardData.ts src/components/dashboard/DashboardHealth.tsx src/pages/XAccount.tsx src/api/settingsData.ts src/api/dashboardData.ts src/api/xAccountData.ts src/test/settings-data.test.ts src/test/dashboard-data.test.ts src/test/x-account-data.test.ts
git commit -m "refactor: centralize settings dashboard and x account data access"
```

## Exit Criteria

- [ ] Settings writes have one primary frontend path.
- [ ] Dashboard data fallback and normalization are not buried in UI components.
- [ ] XAccount page is easier to review.
- [ ] No operator workflow is removed.

---

# Phase 14: Database And Type Trust

Branch:

```text
codex/xot-cleanup-24-database-type-trust
```

## Objective

Understand migration drift and Supabase type drift before making schema changes.

## Files

- Inspect: `supabase/migrations/*`
- Inspect: `src/integrations/supabase/types.ts`
- Create: `docs/operations/database-type-trust.md`
- Potentially modify: `src/integrations/supabase/types.ts` only after generated types are refreshed safely.

## Steps

- [ ] List linked migration state read-only.

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
```

- [ ] Capture local migration files.

```bash
find supabase/migrations -maxdepth 1 -type f | sort
```

- [ ] Generate a schema diff read-only if linked access allows it.

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db diff --linked --schema public
```

- [ ] Record local-only, remote-only, and divergent migration facts in `docs/operations/database-type-trust.md`.
- [ ] Do not apply the diff.
- [ ] Regenerate Supabase types only after confirming the target schema is production.
- [ ] Run strict typecheck after regenerated types.
- [ ] Update fallback removal plan if regenerated types make compatibility branches unnecessary.

## Validation

```bash
npm run check:strict
npm test
npm run build
npm run check:release-state
```

## Commit

```bash
git add docs/operations/database-type-trust.md src/integrations/supabase/types.ts
git commit -m "chore: document database and supabase type trust"
```

If types are not regenerated, commit only the documentation:

```bash
git add docs/operations/database-type-trust.md
git commit -m "docs: document database migration trust state"
```

## Exit Criteria

- [ ] Migration state is understood.
- [ ] No blind migration push has occurred.
- [ ] Type drift has a specific remediation path.

---

# Phase 15: Renderer Runtime And Security Cleanup

Branch:

```text
codex/xot-cleanup-30-renderer-runtime-security
```

## Objective

Clean renderer configuration and security behavior without disrupting current video delivery.

## Files

- Modify: `services/video-renderer/src/preflight.js`
- Modify: `services/video-renderer/src/openai.js`
- Create: `services/video-renderer/src/config.js`
- Create: `services/video-renderer/test/config.test.js`
- Create: `services/video-renderer/test/auth.test.js`
- Inspect: renderer service entrypoint file.

## Steps

- [ ] Locate renderer auth and config reads.

```bash
rg -n "VIDEO_RENDERER_TOKEN|process\\.env|auth|authorization|preflight|OpenAI|watermark|ocr" services/video-renderer/src services/video-renderer/test
```

- [ ] Add config loader tests:
  - required token is present in production mode.
  - missing token fails closed when server auth is required.
  - local development mode remains explicit.
- [ ] Move environment parsing to `services/video-renderer/src/config.js`.
- [ ] Add auth middleware/helper tests.
- [ ] Split preflight orchestration only after config/auth behavior is covered.
- [ ] Keep one-pass ffmpeg render behavior intact.

## Validation

```bash
npm --prefix services/video-renderer test
npm --prefix services/video-renderer audit --audit-level=low
npm run check:release-state
```

## Commit

```bash
git add services/video-renderer/src/preflight.js services/video-renderer/src/openai.js services/video-renderer/src/config.js services/video-renderer/test/config.test.js services/video-renderer/test/auth.test.js
git commit -m "refactor: centralize video renderer config and auth checks"
```

## Exit Criteria

- [ ] Renderer auth is explicit and tested.
- [ ] Config reads are not scattered across large files.
- [ ] Video-render heartbeat remains online in read-only release-state checks.

---

# Phase 16: Runtime And Dependency Hygiene

Branch:

```text
codex/xot-cleanup-31-runtime-dependency-hygiene
```

## Objective

Separate dependency/runtime cleanup from spaghetti-code refactors so upgrades do not contaminate behavioral review.

## Files

- Modify: `package.json`
- Modify: `package-lock.json`
- Inspect: `.github/workflows/ci.yml`
- Inspect: Vercel project runtime settings through available tooling if authenticated.
- Inspect: `services/video-renderer/package.json`

## Steps

- [ ] Re-run root audit.

```bash
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
```

- [ ] Identify production dependency advisories separately from dev-only advisories.
- [ ] Align declared Node runtime with actual deployment policy after confirming Vercel runtime.
- [ ] Upgrade only packages required to clear meaningful production advisories.
- [ ] Run UI and build tests after every dependency bump.
- [ ] Do not mix dependency upgrades with worker/frontend refactors.

## Validation

```bash
npm ci
npm run lint
npm run check:strict
npm test
npm run build
npm audit --omit=dev --audit-level=low
npm --prefix services/video-renderer test
```

## Commit

```bash
git add package.json package-lock.json .github/workflows/ci.yml services/video-renderer/package.json services/video-renderer/package-lock.json
git commit -m "chore: align runtime and dependency hygiene"
```

## Exit Criteria

- [ ] Node runtime policy is explicit.
- [ ] Production audit findings have a fix or a documented reason.
- [ ] Dependency changes are reviewable separately.

---

# Phase 17: Function Auth And Secret Matrix

Branch:

```text
codex/xot-cleanup-32-function-auth-secret-matrix
```

## Objective

Document and tighten function auth without breaking legitimate cron, webhook, or internal calls.

## Files

- Modify: `docs/operations/runbooks.md`
- Modify: `docs/operations/release-runbook.md`
- Create: `docs/operations/function-auth-matrix.md`
- Inspect: `supabase/config.toml`
- Inspect: `supabase/functions/*/index.ts`
- Inspect: `scripts/deploy-functions.sh`

## Steps

- [ ] Inventory function JWT settings.

```bash
rg -n "verify_jwt|\\[functions\\." supabase/config.toml
```

- [ ] Inventory service-role client usage.

```bash
rg -n "SERVICE_ROLE|service_role|createClient<any, any>|Deno\\.env\\.get" supabase/functions
```

- [ ] Inventory query token compatibility.

```bash
rg -n "query|token|RSSAPP_ALLOW_QUERY_TOKEN|WEBHOOK_SHARED_SECRET|RSSAPP_WEBHOOK_TOKEN" supabase/functions docs
```

- [ ] Write `docs/operations/function-auth-matrix.md` with:
  - function name.
  - trigger source.
  - `verify_jwt` value.
  - required secret.
  - caller.
  - accepted compatibility modes.
  - planned hardening step.
- [ ] Add deploy preflight checks only if a missing check can be tested locally.

## Validation

```bash
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run test:functions
```

## Commit

```bash
git add docs/operations/function-auth-matrix.md docs/operations/runbooks.md docs/operations/release-runbook.md supabase/config.toml scripts/deploy-functions.sh
git commit -m "docs: add function auth and secret matrix"
```

If no code/config changes are needed:

```bash
git add docs/operations/function-auth-matrix.md docs/operations/runbooks.md docs/operations/release-runbook.md
git commit -m "docs: add function auth and secret matrix"
```

## Exit Criteria

- [ ] Every `verify_jwt=false` function has a documented reason.
- [ ] Query-token compatibility has an explicit removal path.
- [ ] Deploy guardrails remain strict.

---

# Phase 18: Integration Branch And Full Local Verification

Branch:

```text
codex/xot-cleanup-40-integration
```

## Objective

Combine the reviewed cleanup slices into one final integration branch for complete local validation and browser smoke checks.

## Steps

- [ ] Create integration branch from the last reviewed cleanup branch.

```bash
git switch <last-reviewed-cleanup-branch>
git switch -c codex/xot-cleanup-40-integration
```

- [ ] Rebase or merge only branches that passed their phase gate.
- [ ] Resolve conflicts by preserving current production behavior.
- [ ] Run Universal Validation Gate.
- [ ] Start local dev server.

```bash
npm run dev
```

- [ ] Open local app in browser:

```text
http://localhost:5173
```

- [ ] Browser-smoke unauthenticated behavior:
  - app loads.
  - login/redirect behavior is coherent.
  - no blank screen.
  - no console crash from import errors.
- [ ] Browser-smoke authenticated behavior if session/credentials are available:
  - Dashboard loads.
  - Monitoring loads.
  - Settings loads.
  - XAccount loads.
  - Dashboard and Monitoring can call `admin-actions`.
  - No obvious text overlap on desktop and mobile widths.
- [ ] Record browser coverage and any auth blockage in the branch handoff.

## Validation

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run check:function-inventory
npm run build
npm --prefix services/video-renderer test
npm run check:release-state
git status --short --branch
```

## Commit

```bash
git add .
git commit -m "chore: integrate xot cleanup branches"
```

Only run this commit command if conflict resolutions or integration-only docs were created. Do not make an empty integration commit unless the branch policy requires it.

## Exit Criteria

- [ ] All selected cleanup branches are integrated.
- [ ] Full local validation passes.
- [ ] Browser smoke status is recorded.
- [ ] No production deployment has happened.

---

# Phase 19: GitHub Review And CI

## Objective

Move from local validation to GitHub review without affecting production.

## Steps

- [ ] Push only the integration branch.

```bash
git push -u origin codex/xot-cleanup-40-integration
```

- [ ] Open a draft PR against `main`.
- [ ] PR description must include:
  - branch stack summary.
  - changed modules.
  - local validation commands and results.
  - known pre-existing warnings.
  - release-state read-only result.
  - statement that nothing has been deployed.
  - rollback strategy.
- [ ] Wait for GitHub CI.
- [ ] Fix CI failures in new cleanup commits on the same branch.
- [ ] Request code review.
- [ ] Do not merge until CI and review pass.

## Exit Criteria

- [ ] Draft PR exists.
- [ ] CI is green.
- [ ] Review findings are resolved or explicitly accepted.
- [ ] PR is ready for merge only after local and remote validation agree.

---

# Phase 20: Production Promotion

## Objective

Bring production up to date only after the cleanup is merged to `main` and verified.

## Preconditions

- [ ] Integration PR merged to `main`.
- [ ] GitHub CI green on `main`.
- [ ] Clean local `main` checkout.
- [ ] Release runbook reviewed.
- [ ] Rollback target identified.

## Steps

- [ ] Use the main checkout, not the cleanup worktree.

```bash
cd "/Users/stevmq/Finalized XOT"
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git status --short --branch
```

- [ ] Confirm local main matches remote main.

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

- [ ] Run pre-release state check.

```bash
npm run check:release-state
```

- [ ] Run full local gate from clean main.

```bash
npm run lint
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run check:strict
npm test
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key> \
VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer \
npm run build
npm --prefix services/video-renderer test
```

- [ ] Dry-run function deploy preflight.

```bash
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh
```

- [ ] Let Vercel deploy from GitHub `main`.
- [ ] Check Vercel production aliases:

```bash
curl -sSI https://xot.iraneyes.com
curl -sSI https://xot.vercel.app
```

- [ ] Deploy Supabase functions only from clean main if function code changed:

```bash
./scripts/deploy-functions.sh
```

- [ ] Do not apply migrations unless Phase 14 produced a reviewed migration action.
- [ ] Run post-release state check:

```bash
npm run check:release-state
```

- [ ] Perform authenticated smoke checks:
  - Dashboard loads.
  - Monitoring loads.
  - Settings loads.
  - XAccount loads.
  - `admin-actions` version returns released `DEPLOY_GIT_SHA`.
  - worker cron continues completing jobs.
  - `x-poster-tick` continues running.
  - renderer heartbeat is online.
  - stale running jobs query is empty.

- [ ] Record release in `docs/operations/release-runbook.md`.

## Exit Criteria

- [ ] Production frontend points at the merged main SHA.
- [ ] Supabase functions are deployed from the same main SHA if changed.
- [ ] Post-release read-only state is healthy.
- [ ] Release ledger contains rollback target and smoke-check evidence.

---

# Phase 21: Post-Cleanup Simplification

## Objective

Remove compatibility scaffolding only after production has run safely on the cleaned code.

## Timing

Wait until at least one normal production operating cycle has passed after release.

## Steps

- [ ] Re-run release-state check.

```bash
npm run check:release-state
```

- [ ] Remove frontend schema fallbacks that are no longer used.
- [ ] Remove unused admin action wrappers.
- [ ] Remove unused worker helper exports.
- [ ] Remove dead code identified by TypeScript and Deno checks.
- [ ] Update docs to reflect the final module map.

## Validation

```bash
npm run lint:functions
npm run check:functions
npm run test:functions
npm run lint
npm run check:strict
npm test
npm run build
npm run check:release-state
```

## Commit

```bash
git add .
git commit -m "chore: remove obsolete cleanup compatibility paths"
```

## Exit Criteria

- [ ] Compatibility scaffolding is gone.
- [ ] Docs match the actual code.
- [ ] Local and read-only live checks pass.

---

# Quality Bar For Every Phase

A phase is not done unless all of these are true:

- [ ] It has a clear branch name.
- [ ] It has a small, reviewable commit or commits.
- [ ] It preserves current behavior unless the commit message says otherwise.
- [ ] It has focused tests for the moved logic.
- [ ] It passes the relevant focused gate.
- [ ] It passes the full gate before integration.
- [ ] It records any blocked live/auth check honestly.
- [ ] It does not deploy from the cleanup branch.
- [ ] It does not modify unrelated user work.

# What Success Looks Like

After this plan is complete:

- `admin-actions` is a stable dispatcher plus domain modules.
- `worker/index.ts` is a queue dispatcher plus orchestration, not the home of every helper.
- Telegram, video render, media, hydration, scoring, and lifecycle behavior are independently testable.
- Monitoring is composed from API, view-model, and component modules.
- Settings, Dashboard, and XAccount use centralized data/action clients.
- Schema fallbacks are explicit and removable.
- Function auth expectations are documented.
- Renderer auth/config behavior is explicit and tested.
- Local validation, GitHub CI, production deployment, and live verification are separate gates.
- Production stays up to date only through reviewed `main` promotion, not cleanup-branch deployment.
