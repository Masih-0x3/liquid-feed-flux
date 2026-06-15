# XOT Cleanup Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for independent phase execution or `superpowers:executing-plans` for inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean the XOT codebase so it is easier to understand, safer to change, and still aligned with the currently working production system.

**Architecture:** Keep production stable by doing all cleanup inside isolated `codex/*` branches and a linked cleanup worktree. Split large files by behavior domain behind stable public entrypoints, add tests before or during each split, and promote only after local validation, GitHub review, CI, and release-state checks pass.

**Tech Stack:** Vite, React 18, TypeScript, TanStack Query, Supabase Edge Functions on Deno, Supabase Postgres/Auth/Storage, Vercel frontend hosting, Telegram Bot API, OpenAI, RSS.app, video-renderer Node service.

---

## Current Anchor

Original cleanup worktree for the phase stack:

```text
/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/xot-cleanup
```

Main checkout preserved for user work:

```text
/Users/stevmq/Finalized XOT
```

Current main documentation anchor:

```text
29cc200fbc64141dd5441fb7d972272f1434c2c2
```

Last deployed code release anchor:

```text
7f3dab452eaccecd5a275def6b29127998df958d
```

Release notes:

- PR #13 merged the integration branch and was promoted to production at `8f0b93db7e57bbc0b6108db12e929e220715970c`.
- PR #14 recorded the cleanup release ledger.
- PR #15 removed the first safe Phase 21 compatibility paths.
- PR #17 hotfixed Dashboard optional-summary fallback failures and deployed `admin-actions`.
- PR #16 added OpenAI cost guardrails, merged at `c4076d3055c8e9d509387131a8d0d8ddf18666ec`, applied migration `20260615005500`, and deployed `admin-actions` plus `worker`.
- PR #19 fixed degraded Dashboard Edge Function failures, merged at `c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`, deployed `admin-actions` version `158`, and stamped `DEPLOY_GIT_SHA=c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`.
- PR #20 removed the safe worker export-surface slice, merged at `70d5733a5604a535e1d44be1224a10033121d102`, deployed `worker` version `235`, and stamped `DEPLOY_GIT_SHA=70d5733a5604a535e1d44be1224a10033121d102`.
- PR #22 added temporary compatibility usage telemetry, merged at `ccd06079eae7e454ffd372dce94f71940c64e560`, applied migration `20260615043000`, and stamped `DEPLOY_GIT_SHA=ccd06079eae7e454ffd372dce94f71940c64e560`.
- PR #25 removed the safe worker helper export-surface slice, merged at `64a6ed61d7194dcab808651f2f10de7bcf19e72a`, deployed all 10 Edge Functions, and stamped `DEPLOY_GIT_SHA=64a6ed61d7194dcab808651f2f10de7bcf19e72a`.
- PR #27 marked Telegram helper cleanup status verified; it was documentation/status-only and did not require a Supabase deploy.
- PR #28 extracted hydration success patch shaping into `xApiWorkflow.ts`, tightened X/Twitter URL handle parsing, merged at `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`, deployed all 10 Edge Functions, and stamped `DEPLOY_GIT_SHA=f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`.
- PR #30 removed zero-telemetry Monitoring/admin compatibility aliases, merged at `9d60e9052056f5a0e2e0794579701a97e7e8cb5e`, deployed all 10 Edge Functions, and stamped `DEPLOY_GIT_SHA=9d60e9052056f5a0e2e0794579701a97e7e8cb5e`.
- PR #32 removed the final safe worker type-only export surface and was promoted to production at `412127679bd158de342eabc64a4d4dd7c74cc4e2`.
- PR #34 moved Settings and X Automation usage displays from `settings.x_api_usage` to `get_x_api_summary`, then deployed all 10 Edge Functions and stamped `DEPLOY_GIT_SHA=ad29a4d5623cef204521e116ffc5aadaf46ff7fe`.
- PR #36 removed the obsolete `recordLegacyXApiUsage` writer and stale frontend default, then deployed all 10 Edge Functions and stamped `DEPLOY_GIT_SHA=7f3dab452eaccecd5a275def6b29127998df958d`.
- PR #37 recorded the PR #36 release ledger; it was documentation-only and did not require a Supabase deploy.

Current safe-state rule:

```text
No cleanup branch deploys to production.
No direct push to main.
No broad Supabase db push while historical migration drift remains unresolved.
Production checks during cleanup are read-only unless a reviewed main hotfix/release explicitly requires a targeted deploy or targeted SQL apply.
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
                                                      └─ codex/xot-cleanup-31-runtime-dependency-hygiene
                                                          └─ codex/xot-cleanup-32-function-auth-secret-matrix
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

- [x] Confirm current worker helper boundaries.

```bash
rg -n "function (mapLimit|fetchImageBytes|sendTelegramPhotoFromStorage|sendTelegramPhotoGroupFromStorage|telegramVideoTooLargeError|fetchVideoBytes|sendTelegramVideoFromStorage|sendTelegramMedia|throwTelegramError|getMediaUrl|computeAdaptiveSpacing)|class TelegramRateLimitError" supabase/functions/worker/index.ts
```

- [x] Create `supabase/functions/worker/telegramDelivery.ts` with imports:

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

- [x] Move helper bodies verbatim first.
- [x] Export only what `worker/index.ts` needs:

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

- [x] Keep `TelegramRateLimitError` file-local and assert thrown error shape in focused tests.
- [x] Update `worker/index.ts` imports:

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

- [x] Remove now-unused imports from `worker/index.ts`.
- [x] Remove the moved helper bodies from `worker/index.ts`.

## Worker Helper Export Cleanup Follow-Up

Branch `codex/xot-worker-helper-export-cleanup` completes the safe export-surface follow-up from this phase:

- File-localized worker utility types and timing helpers that had no external production importer.
- File-localized `TelegramRateLimitError`, video-render workflow internals, media/X API implementation types, scoring implementation types, translation implementation types, and `SCORING_AXES_SCHEMA`.
- Deleted the unused `ResolvedMediaSource` alias.
- Kept exports that are still required by production imports, including `ResolvedVariant`, `VIDEO_RENDER_DEFER_MS`, `ScoringDecisionLog`, and the helper functions imported by `worker/index.ts`.

Status refresh: current `main` has the Telegram delivery helpers extracted into `supabase/functions/worker/telegramDelivery.ts`, `worker/index.ts` imports the public helper boundary from that module, and `supabase/functions/worker/telegramDelivery.test.ts` covers the helper behaviors listed below.

## Tests To Add

- [x] `getMediaUrl` returns signed storage URL when signing succeeds.
- [x] `getMediaUrl` falls back to `src_url` when signing fails.
- [x] `sendTelegramMedia` retries Markdown parse errors with stripped plain text.
- [x] `sendTelegramMedia` throws `TelegramRateLimitError` with `retryAfterSeconds` on Telegram `retry_after`.
- [x] `sendTelegramVideoFromStorage` throws `NonRetryableJobError` when declared video size exceeds Telegram bot limit.
- [x] `computeAdaptiveSpacing` preserves current zero-or-fallback behavior for no recent rate-limit failures, recent rate-limit failures, and query failure.

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

- [x] Telegram helpers are unit-tested outside `worker/index.ts`.
- [x] `handleDeliverJob` behavior is unchanged.
- [x] Rate-limit handling still reaches job failure retry logic.
- [x] Full local gate passes.

Current verification for the Telegram helper status refresh:

- `npx deno test supabase/functions/worker/telegramDelivery.test.ts`
- `npx deno check supabase/functions/worker/index.ts supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/jobLifecycle.ts supabase/functions/worker/workerUtils.ts`
- `npm run lint:functions`
- `npm run check:functions`
- `npm run test:functions`
- `npm run check:function-inventory`
- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
- `git diff --check`

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

- [x] Locate hydration entrypoints.

```bash
rg -n "hydrate|x api|twitter|tweet|rssapp|rmPickBestVariant|extractNumericTweetId|extractHandleFromUrl" supabase/functions/worker/index.ts supabase/functions/worker/workerUtils.ts
```

- [x] Write focused tests for pure parsing helpers before moving handler code.
- [x] Keep pure parsing helpers in `workerUtils.ts` where they are already shared by hydration and media resolution.
- [x] Move hydration success patch shaping into `xApiWorkflow.ts`.
- [x] Keep job dispatch in `worker/index.ts`.
- [x] Keep service-role Supabase client creation in `worker/index.ts` unless the extracted handler has a clear dependency interface.

## Test Cases

- [x] Numeric tweet id extracted from canonical X URL.
- [x] Numeric tweet id extracted from Twitter URL.
- [x] Invalid URLs return null instead of throwing.
- [x] X handle extraction handles profile URL and status URL.
- [x] RM variant selector picks highest useful quality.
- [x] Hydration success patch preserves required fields and invalidates stale translations.

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

- [x] Hydration helper logic can be reviewed without opening the whole worker.
- [x] No X posting behavior changes are included in this phase.
- [x] Full local gate passes.

Current verification for the hydration helper slice:

- `npx deno fmt supabase/functions/worker/workerUtils.ts supabase/functions/worker/workerUtils.test.ts supabase/functions/worker/index.ts supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/xApiWorkflow.test.ts`
- `npx deno check supabase/functions/worker/index.ts supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/workerUtils.ts supabase/functions/worker/workerUtils.test.ts`
- `npx deno test supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/workerUtils.test.ts`
- `npm run lint:functions`
- `npm run check:functions`
- `npm run test:functions`
- `npm run check:function-inventory`
- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`

---

# Phase 8: Worker Split, Part F - Media Resolution And Media Processor Boundary

Status: completed in cleanup branch history. Follow-up branch `codex/xot-media-processor-payload-helper` closed the remaining media-processor invoke payload extraction gap.

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

- [x] Locate media-related worker code.

```bash
rg -n "download_media|resolve_media|media-processor|getMediaUrl|storage_path|rendered_media|media_url|src_url" supabase/functions/worker supabase/functions/media-processor supabase/functions/_shared
```

- [x] Write tests for media source selection:
  - rendered media preferred when delivery requires rendered video.
  - original media used when render config does not require rendered video.
  - invalid storage metadata does not throw.
  - missing media produces a non-retryable or retryable result matching existing behavior.
- [x] Extract media source selection into `mediaWorkflow.ts`.
- [x] Extract media-processor invoke payload construction into `mediaWorkflow.ts`.
- [x] Keep actual job dispatch and job state writes in `worker/index.ts` during this phase.

Implementation note: the original media split extracted resolve/download job payload construction into `mediaWorkflow.ts`. Follow-up branch `codex/xot-media-processor-payload-helper` extracted the remaining `media-processor` invoke options into `buildMediaProcessorDownloadInvokeOptions`, while keeping the actual `supabase.functions.invoke("media-processor", ...)` call and job lifecycle handling in `worker/index.ts`.

## Validation

```bash
npx --yes deno fmt supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
npx --yes deno test supabase/functions/worker/mediaWorkflow.test.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
```

Follow-up validation for the media-processor invoke payload helper:

- [x] `npx deno fmt supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts` passed.
- [x] `npx deno check supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts` passed.
- [x] `npx deno test supabase/functions/worker/mediaWorkflow.test.ts` passed with 5 tests.
- [x] `npm run lint:functions` passed; Deno lint checked 101 files.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed with 277 Deno tests.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings and 0 errors.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed with 19 files and 80 tests; the expected `useAuth` error-path stack printed.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only; current main CI was green, live hosts returned HTTP 200, Supabase functions and cron were active, no stale running jobs were found, renderer `hermes-masih-1` was online, and compatibility telemetry still showed active `rss_query_token` usage.

## Commit

```bash
git add supabase/functions/worker/index.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/mediaWorkflow.test.ts
git commit -m "refactor: extract worker media workflow"
```

## Exit Criteria

- [x] Media selection logic is isolated.
- [x] Download handoff payloads are tested.
- [x] Delivery and video-render gates still pass full worker tests.

---

# Phase 9: Worker Split, Part G - Translate, Scoring, And Enrichment Boundaries

Status: completed in branch history. Follow-up branch `codex/xot-worker-missing-source-translation-test` closed the pre-existing missing-source test gap.

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
- [x] Missing source text follows the existing failure path. Follow-up branch `codex/xot-worker-missing-source-translation-test` added focused coverage for the `No original text to translate` guard used by `handleTranslateJob`.

## Validation

```bash
npx --yes deno fmt supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/scoringWorkflow.test.ts
npx --yes deno check supabase/functions/worker/index.ts supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/scoringWorkflow.test.ts
npx --yes deno test supabase/functions/worker/translateWorkflow.test.ts supabase/functions/worker/scoringWorkflow.test.ts supabase/functions/worker/mediaWorkflow.test.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/jobLifecycle.test.ts supabase/functions/worker/workerUtils.test.ts
npm run lint:functions
npm run check:functions
npm run test:functions
```

Follow-up validation for the missing-source coverage:

- [x] `npx deno fmt supabase/functions/worker/index.ts supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts` passed.
- [x] `npx deno check supabase/functions/worker/index.ts supabase/functions/worker/translateWorkflow.ts supabase/functions/worker/translateWorkflow.test.ts` passed.
- [x] `npx deno test supabase/functions/worker/translateWorkflow.test.ts` passed with 15 tests.
- [x] `npm run lint:functions` passed.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed with 276 Deno tests.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings and 0 errors.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed with 19 files and 80 tests; the expected `useAuth` error-path stack printed.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only; main CI was green, live hosts returned HTTP 200, Supabase functions and cron were active, no stale running jobs were found, and renderer `hermes-masih-1` was online.

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

Status: completed in branch `codex/xot-cleanup-21-monitoring-split`.

Completed slice:

- Extracted view-model helpers and duplicate-cluster logic to `src/lib/monitoringViewModel.ts`.
- Extracted duplicate evidence coverage-label helpers to `src/lib/monitoringDuplicateEvidence.ts`.
- Extracted Monitoring admin action wrappers and confirmation copy to `src/lib/monitoringActions.ts`.
- Extracted the confirmation dialog to `src/components/monitoring/MonitoringActionDialog.tsx`.
- Extracted the queue filter/bulk-action toolbar to `src/components/monitoring/MonitoringFilters.tsx`.
- Extracted the summary metric cards to `src/components/monitoring/MonitoringQueueCards.tsx`.
- Extracted the delivery timeline panel to `src/components/monitoring/MonitoringDeliveryTimeline.tsx`.
- Extracted status badges, duplicate evidence, and duplicate cluster panels to monitoring components.
- Extracted the mobile card and desktop table row renderers to `src/components/monitoring/MonitoringRow.tsx`.
- Extracted the Duplicate Gate drawer subpanel to `src/components/monitoring/MonitoringDuplicateGateCard.tsx`.
- Extracted the full detail drawer to `src/components/monitoring/MonitoringDetailDrawer.tsx`.
- Added focused coverage in `src/test/monitoring-view-model.test.ts`, `src/test/monitoring-actions.test.ts`, and `src/test/monitoring-components.test.tsx`.

Deferred out of this phase:

- Optional `src/hooks/useMonitoringData.ts` cleanup is deferred to Phase 12 so fallback behavior stays isolated.

Branch:

```text
codex/xot-cleanup-21-monitoring-split
```

## Objective

Turn `src/pages/Monitoring.tsx` into a page composition file instead of a combined API client, state machine, action router, and renderer.

## Files

- Create: `src/lib/monitoringViewModel.ts`
- Create: `src/lib/monitoringDuplicateEvidence.ts`
- Create: `src/lib/monitoringActions.ts`
- Create: `src/components/monitoring/MonitoringFilters.tsx`
- Create: `src/components/monitoring/MonitoringQueueCards.tsx`
- Create: `src/components/monitoring/MonitoringStatusBadges.tsx`
- Create: `src/components/monitoring/MonitoringDuplicateEvidence.tsx`
- Create: `src/components/monitoring/MonitoringRow.tsx`
- Create: `src/components/monitoring/MonitoringDuplicateGateCard.tsx`
- Create: `src/components/monitoring/MonitoringDetailDrawer.tsx`
- Create: `src/components/monitoring/MonitoringActionDialog.tsx`
- Create: `src/components/monitoring/MonitoringDeliveryTimeline.tsx`
- Create: `src/test/monitoring-view-model.test.ts`
- Create: `src/test/monitoring-actions.test.ts`
- Create: `src/test/monitoring-components.test.tsx`
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
- [x] Extract status and duplicate evidence components.
- [x] Extract row component.
- [x] Extract Duplicate Gate drawer subpanel.
- [x] Extract detail drawer component.
- [x] Extract confirmation dialog component.
- [x] Extract delivery timeline panel component.
- [x] Keep page-level React Query state and URL/search params in `Monitoring.tsx`.
- [x] After each component extraction, run the focused frontend tests.

## Test Cases

- [ ] Filtering by status returns the same row ids as before.
- [x] Duplicate cluster display model preserves original cluster order.
- [x] Action dialog title for retry/rescore/dedupe matches current text.
- [ ] Empty state remains visible when no entries match filters.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/monitoring-components.test.tsx src/test/monitoring-view-model.test.ts src/test/monitoring-actions.test.ts src/test/monitoring-state.test.ts src/test/timeline-display.test.ts
npm test
VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build
```

## Commit

```bash
git add src/pages/Monitoring.tsx src/components/monitoring/MonitoringDetailDrawer.tsx src/test/monitoring-components.test.tsx docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "refactor: extract monitoring detail drawer"
```

## Exit Criteria

- [x] `Monitoring.tsx` reads as composition and orchestration.
- [x] Action calls are imported from centralized API wrappers.
- [x] View-model logic has unit coverage.
- [x] Build output still succeeds.

---

# Phase 12: Monitoring Data Fallback Repair

Status: completed, then partially superseded by Phase 21.

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

- [x] Locate fallback query branches.

```bash
rg -n "fallback|legacy|unknown|Record<string, unknown>|missing|schema|column" src/hooks/useMonitoringData.ts src/hooks/useDashboardData.ts
```

- [x] Move admin-actions-first fetching to `src/api/monitoringData.ts`.
- [x] Move legacy query fallback to a named function:

```ts
export async function fetchMonitoringEntriesWithLegacyFallback() {
  return fetchMonitoringEntriesViaAdminActions().catch((error) => {
    return fetchMonitoringEntriesViaLegacyQueries(error);
  });
}
```

- [x] Add tests that verify fallback is called only after the admin-actions path fails.
- [x] Add a log or returned metadata flag that says which data source was used.
- [x] Keep the fallback alive until production schema/type drift is fixed.

## Implementation Notes

- [x] `src/hooks/useMonitoringData.ts` now stays focused on React Query subscriptions and returns `dataSource` / `fallbackReason` metadata from query pages.
- [x] `src/api/monitoringData.ts` owns monitoring entry contracts, admin-action fetching, legacy Supabase fallback queries, and schema-column retry behavior.
- [x] `src/integrations/supabase/types.ts` was inspected; generated `posts` types include the newer monitoring columns, so the legacy fallback remains for deployed schema/function drift compatibility rather than local type gaps.
- [x] Phase 21 later removed the direct Supabase legacy query fallback after the cleaned release was live and authenticated Monitoring smoke passed.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/monitoring-data-fallbacks.test.ts src/test/monitoring-state.test.ts
npm test
npm run build
```

Completed validation:

- [x] `npm run lint` passed with the existing 8 Fast Refresh warnings only.
- [x] `npm run check:strict` passed.
- [x] `npm test -- src/test/monitoring-data-fallbacks.test.ts src/test/monitoring-state.test.ts` passed: 2 files, 10 tests.
- [x] `npm test` passed: 16 files, 72 tests.
- [x] `npm run lint:functions` passed: Deno lint checked 95 files.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed: 257 Deno tests.
- [x] `npm run check:function-inventory` passed: 10 functions.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only with live hosts 200, main CI green, active Supabase functions/cron, online renderer heartbeat, Vercel CLI unavailable, and known Supabase migration drift still present.

## Commit

```bash
git add src/hooks/useMonitoringData.ts src/api/monitoringData.ts src/test/monitoring-data-fallbacks.test.ts src/lib/monitoringState.ts src/lib/scoringV2Monitoring.ts docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "refactor: isolate monitoring data fallbacks"
```

## Exit Criteria

- [x] Fallback compatibility is intentional and visible.
- [x] UI no longer hides schema drift inside page logic.
- [x] A later schema cleanup can remove fallback paths cleanly.

---

# Phase 13: Settings, Dashboard, And XAccount Split

Status: completed, then partially superseded by Phase 21.

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

- [x] Locate direct settings table writes.

```bash
rg -n "from\\(['\\\"]settings|\\.update\\(|\\.insert\\(|\\.upsert\\(|admin-actions|admin-retry" src/pages/Settings.tsx src/hooks/useSettingsData.ts src/components/settings src/hooks/useDashboardData.ts src/components/dashboard src/pages/XAccount.tsx
```

- [x] Move settings reads/writes to `src/api/settingsData.ts`.
- [x] Route `EnrichmentSettings` through the same settings save path as other settings components.
- [x] Move dashboard summary fetch and normalization to `src/api/dashboardData.ts`.
- [x] Move X account status/follower snapshot actions to `src/api/xAccountData.ts`.
- [x] Add tests for normalization behavior and action names.
- [x] Keep UI layout unchanged unless a layout bug is found during browser checks.

## Implementation Notes

- [x] `src/hooks/useSettingsData.ts` now owns only React Query mutation/query glue and re-exports contracts from `src/api/settingsData.ts`.
- [x] `src/components/settings/EnrichmentSettings.tsx` now loads special enrichment setting rows through `fetchSettingsRows` and saves `enrichment_config`, `voice_samples`, and `voice_guide` through the shared `save_settings` admin-action path.
- [x] `src/hooks/useDashboardData.ts` now owns only query/subscription glue and re-exports contracts from `src/api/dashboardData.ts`.
- [x] `src/pages/XAccount.tsx` now calls `runFollowersSnapshot` from `src/api/xAccountData.ts` instead of embedding the admin-action payload in the page.
- [x] Phase 21 later removed the paused follower-management implementation and kept `/x-account` on the intended disabled surface.

## Validation

```bash
npm run lint
npm run check:strict
npm test -- src/test/settings-data.test.ts src/test/dashboard-data.test.ts src/test/x-account-data.test.ts
npm test
npm run build
```

Completed validation:

- [x] `npm run lint` passed with the existing 8 Fast Refresh warnings only.
- [x] `npm run check:strict` passed.
- [x] `npm test -- src/test/settings-data.test.ts src/test/dashboard-data.test.ts src/test/x-account-data.test.ts` passed: 3 files, 9 tests.
- [x] `npm test` passed: 19 files, 81 tests.
- [x] `npm run lint:functions` passed: Deno lint checked 95 files.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed: 257 Deno tests.
- [x] `npm run check:function-inventory` passed: 10 functions.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only with live hosts 200, main CI green, active Supabase functions/cron, online renderer heartbeat, Vercel CLI unavailable, and known Supabase migration drift still present.

## Commit

```bash
git add src/hooks/useSettingsData.ts src/api/settingsData.ts src/components/settings/EnrichmentSettings.tsx src/hooks/useDashboardData.ts src/api/dashboardData.ts src/pages/XAccount.tsx src/api/xAccountData.ts src/test/settings-data.test.ts src/test/dashboard-data.test.ts src/test/x-account-data.test.ts docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "refactor: centralize settings dashboard and x account data access"
```

## Exit Criteria

- [x] Settings writes have one primary frontend path.
- [x] Dashboard data fallback and normalization are not buried in UI components.
- [x] XAccount page is easier to review.
- [x] No operator workflow is removed.

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

- [x] List linked migration state read-only.

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
```

- [x] Capture local migration files.

```bash
find supabase/migrations -maxdepth 1 -type f | sort
```

- [x] Generate a schema diff read-only if linked access allows it.

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db diff --linked --schema public
```

- [x] Record local-only, remote-only, and divergent migration facts in `docs/operations/database-type-trust.md`.
- [x] Do not apply the diff.
- [x] Generate linked production Supabase types to `/tmp` for drift comparison only.
- [x] Run strict typecheck without committing regenerated types.
- [x] Update fallback removal plan based on observed type drift.

## Implementation Notes

- [x] Local and remote migration counts both report 96, but only 18 versions match exactly.
- [x] There are 78 local-only and 78 remote-only migration versions, so migration count parity is not safety.
- [x] `supabase db diff --linked --schema public` was attempted read-only and blocked because Docker was not running.
- [x] Linked production types were generated to `/tmp/xot-linked-types.ts` for comparison only; checked-in types were not overwritten in this phase.
- [x] Generated production types are materially newer than `src/integrations/supabase/types.ts`, including `PostgrestVersion: "14.5"`, newer `posts` scoring fields, and newer video/X/scoring tables.

## Validation

```bash
npm run check:strict
npm test
npm run build
npm run check:release-state
```

Completed validation:

- [x] `npm run check:strict` passed.
- [x] `npm test` passed.
- [x] Env-backed `npm run build` passed.
- [x] `npm run check:release-state` passed read-only.
- [x] `git diff --check` passed.

## Commit

```bash
git add docs/operations/database-type-trust.md docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "docs: document database migration trust state"
```

## Exit Criteria

- [x] Migration state is understood.
- [x] No blind migration push has occurred.
- [x] Type drift has a specific remediation path.

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
- Modify: `services/video-renderer/src/renderer.js`
- Modify: `services/video-renderer/src/server.js`
- Create: `services/video-renderer/src/config.js`
- Create: `services/video-renderer/test/config.test.js`
- Create: `services/video-renderer/test/auth.test.js`
- Modify: `services/video-renderer/test/preflight.test.js`
- Inspect: `services/video-renderer/src/openai.js`; no change needed because it already receives explicit keys/models and does not read `process.env`.
- Inspect: renderer service entrypoint file.

## Steps

- [x] Locate renderer auth and config reads.

```bash
rg -n "VIDEO_RENDERER_TOKEN|process\\.env|auth|authorization|preflight|OpenAI|watermark|ocr" services/video-renderer/src services/video-renderer/test
```

- [x] Add config loader tests:
  - renderer required secrets and Deepgram dependency are enforced.
  - delivery-safe renderer defaults are pinned.
  - server token/port/interval/runtime parsing is separate from render config.
- [x] Move environment parsing to `services/video-renderer/src/config.js`.
- [x] Add auth helper tests.
- [x] Pass OCR language and preflight workdir retention through renderer config instead of direct env reads.
- [x] Leave preflight orchestration intact because config/auth behavior was the cleanup target for this phase.
- [x] Keep one-pass ffmpeg render behavior intact.

## Implementation Notes

- [x] `services/video-renderer/src/config.js` now owns renderer env parsing, server runtime parsing, dispatch-token normalization, bearer authorization, default render version, default Tesseract language, and OpenCV script path.
- [x] `services/video-renderer/src/server.js` now reads token, version, port, poll interval, and heartbeat interval from server runtime config.
- [x] `services/video-renderer/src/renderer.js` re-exports `loadConfigFromEnv` for compatibility and passes configured OCR/workdir options into preflight.
- [x] `services/video-renderer/src/preflight.js` no longer reads `process.env.TESSERACT_LANG`; default behavior remains `eng+fas+ara+heb`.
- [x] Initial sandboxed renderer test run failed only because `server.test.js` could not bind `127.0.0.1` inside the sandbox. The same test command passed outside the sandbox with the approved `npm --prefix services/video-renderer test` prefix.

## Validation

```bash
npm --prefix services/video-renderer test
npm --prefix services/video-renderer audit --audit-level=low
npm run lint
npm run check:strict
npm test
npm run build
npm run lint:functions
npm run check:functions
npm run test:functions
npm run check:function-inventory
npm run check:release-state
```

Completed validation:

- [x] `npm --prefix services/video-renderer test` passed, 145 tests.
- [x] `npm --prefix services/video-renderer audit --audit-level=low` passed, 0 vulnerabilities.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed, 19 files / 81 tests.
- [x] Env-backed `npm run build` passed.
- [x] `npm run lint:functions` passed.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed, 257 tests.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run check:release-state` passed read-only; live hosts returned 200, main CI is green, functions and cron are active, renderer `hermes-masih-1` is online, no stale running jobs were found, Vercel CLI remains unavailable, and known migration drift remains.
- [x] `git diff --check` passed.

## Commit

```bash
git add docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md services/video-renderer/src/config.js services/video-renderer/src/preflight.js services/video-renderer/src/renderer.js services/video-renderer/src/server.js services/video-renderer/test/auth.test.js services/video-renderer/test/config.test.js services/video-renderer/test/preflight.test.js
git commit -m "refactor: centralize video renderer config and auth checks"
```

## Exit Criteria

- [x] Renderer auth is explicit and tested.
- [x] Config reads are not scattered across production server/renderer/preflight files.
- [x] Video-render heartbeat remains online in read-only release-state checks.

## Follow-Up Renderer OpenAI Subtitle Split

Branch:

```text
codex/xot-renderer-openai-subtitle-split
```

Objective: reduce `services/video-renderer/src/openai.js` by extracting subtitle cleanup, translation, translation repair, and OpenAI Responses API subtitle parsing into `services/video-renderer/src/openaiSubtitles.js` while keeping `openai.js` as the stable public import boundary for renderer and preview code.

Scope:

- [x] Move `buildTranscriptCleanupRequest`, `buildTranslationRequest`, `buildTranslationRepairRequest`, `cleanupTranscriptSegments`, and `translateSegments` into `openaiSubtitles.js`.
- [x] Move subtitle response parsing helpers and language normalization needed by transcription-language detection into `openaiSubtitles.js`.
- [x] Re-export the moved public functions from `openai.js` so current import sites remain unchanged.
- [x] Keep vision request/parsing code in `openai.js` for a later, separate slice.
- [x] Do not change renderer runtime behavior or production deployment state.

Validation:

- [x] `node --test services/video-renderer/test/openai.test.js` passed.
- [x] `npm --prefix services/video-renderer test` passed after installing renderer dependencies in the isolated worktree.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed with the expected `useAuth` error-path stack from `src/test/auth.test.tsx`.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.

## Follow-Up Renderer OpenAI Vision Split

Branch:

```text
codex/xot-renderer-openai-vision-split
```

Objective: reduce `services/video-renderer/src/openai.js` further by extracting OpenAI vision/watermark request building, Responses API parsing, specialist-vision merging, and vision API-call helpers into `services/video-renderer/src/openaiVision.js` while keeping `openai.js` as the stable public import boundary for renderer and preview code.

Scope:

- [x] Move `buildVisionPreflightRequest`, `buildRemovableWatermarkRequest`, `parseVisionWatermarkResult`, `parseRemovableWatermarkResult`, `shouldRunSpecialistVisionChecks`, `analyzeWatermarkContactSheet`, and `analyzeRemovableWatermarks` into `openaiVision.js`.
- [x] Re-export the moved public vision functions from `openai.js` so current import sites remain unchanged.
- [x] Keep transcription and subtitle facade behavior in `openai.js`.
- [x] Add mocked API-call coverage for `analyzeRemovableWatermarks` and `analyzeWatermarkContactSheet`, including nested Responses output parsing.
- [x] Fix the uncovered vision API-call path where `extractOutputText` was referenced after the subtitle split but was no longer in scope.
- [x] Do not change renderer production deployment state.

Validation:

- [x] Pre-change runtime reproduction for `analyzeRemovableWatermarks` failed with `ReferenceError: extractOutputText is not defined`.
- [x] `node --test services/video-renderer/test/openai.test.js` passed with 19 tests after the split.
- [x] `npm --prefix services/video-renderer ci` installed renderer dependencies after the isolated worktree lacked `services/video-renderer/node_modules/ws`; it printed the known local Node 22 versus renderer Node 20 engine warning.
- [x] `npm --prefix services/video-renderer test` passed with 147 tests after installing renderer dependencies.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings.
- [x] `npm run check:strict` passed.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run lint:functions` passed.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed with 274 Deno tests.
- [x] `npm --prefix services/video-renderer audit --audit-level=low` passed with 0 vulnerabilities.
- [x] `npm test` passed with 19 files and 80 tests; the expected `useAuth` error-path stack printed.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only; live hosts returned HTTP 200, current main CI was green, Supabase functions/cron were active, no stale running jobs were found, and renderer `hermes-masih-1` was online.

## Follow-Up Renderer OpenAI Transcription Split

Branch:

```text
codex/xot-renderer-openai-transcription-split
```

Objective: finish the OpenAI API-family split by extracting OpenAI transcription upload, timed segment normalization, language detection, and fallback transcription logic into `services/video-renderer/src/openaiTranscription.js` while keeping `services/video-renderer/src/openai.js` as the stable public facade.

Scope:

- [x] Move `detectLanguageFromTranscription` and `transcribeAudio` into `openaiTranscription.js`.
- [x] Move transcription-only private helpers and constants: multipart upload, upload size cap, timed segment normalization, and transcription API base URL.
- [x] Re-export the moved transcription functions from `openai.js` so renderer, preview, and transcription pipeline imports remain unchanged.
- [x] Keep subtitle and vision re-exports in `openai.js`.
- [x] Add mocked `transcribeAudio` facade coverage through `../src/openai.js`.
- [x] Do not change renderer production deployment state.

Validation:

- [x] `node --test services/video-renderer/test/openai.test.js` passed with 20 tests.
- [x] Subagent review confirmed the facade export contract, the transcription-only extraction scope, and the current lack of import cycles.
- [x] `npm --prefix services/video-renderer test` passed with 148 renderer tests.
- [x] `npm run lint` passed with the known 8 Fast Refresh warnings and 0 errors.
- [x] `npm run check:strict` passed.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run lint:functions` passed.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed with 274 Deno tests.
- [x] `npm --prefix services/video-renderer audit --audit-level=low` passed with 0 vulnerabilities.
- [x] `npm audit --audit-level=low` passed with 0 vulnerabilities.
- [x] `npm test` passed with 19 files and 80 tests; the expected `useAuth` error-path stack printed.
- [x] Env-backed `npm run build` passed.
- [x] `git diff --check` passed.
- [x] `npm run check:release-state` passed read-only; main and origin/main stayed at `1b58569`, live hosts returned HTTP 200, Supabase functions and cron were active, no stale running jobs were found, and renderer `hermes-masih-1` was online.

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
- Modify: `deno.lock`
- Inspect: `.github/workflows/ci.yml`
- Inspect: Vercel project runtime settings through available tooling if authenticated.
- Inspect: `services/video-renderer/package.json`

## Steps

- [x] Re-run root audit.

```bash
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
```

- [x] Identify production dependency advisories separately from dev-only advisories.
- [x] Align declared Node runtime with actual deployment policy after confirming Vercel runtime.
- [x] Upgrade only packages required to clear meaningful production advisories.
- [x] Run UI and build tests after every dependency bump.
- [x] Do not mix dependency upgrades with worker/frontend refactors.

## Implementation Notes

- Initial production audit failed on `react-router`/`react-router-dom` 6.30.3 and root `ws` 8.18.3.
- Initial full audit also reported dev/tooling advisories through the Vite/esbuild chain.
- `react-router-dom` was kept on the v6 line and patched to 6.30.4 to avoid a router migration inside a dependency hygiene phase.
- `ws` resolved to 8.21.0 in the root package lock.
- Dev tooling moved from `vite` 7.3.3 to 8.0.16 and from `vitest` 3.2.4 to 4.1.8 after confirming `@vitejs/plugin-react` 5.2.0 accepts Vite 8.
- `deno.lock` was refreshed because Supabase function checks resolve the root npm graph; it now points function validation at the same Vite/Vitest graph as `package-lock.json`.
- Root `package.json` already declares Node `20.x` and npm `10.x`; `.github/workflows/ci.yml` uses Node 20; `services/video-renderer/package.json` also declares Node `20.x`.
- `vercel.json` declares `npm ci` and `npm run build`; Vercel CLI remains unavailable in release-state checks, so runtime policy is represented by repo engines and CI until authenticated Vercel project settings can be inspected.
- Local validation ran under Node 22.22.3, so `npm ci` printed the expected `EBADENGINE` warning against the repo's Node 20 policy. That warning does not change the declared CI/runtime target.

## Validation

```bash
npm ci
npm run lint
npm run check:strict
npm test
npm run build
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
npm --prefix services/video-renderer test
npm run lint:functions
npm run check:functions
npm run test:functions
npm run check:function-inventory
npm run check:release-state
git diff --check
```

Validation result:

- [x] `npm ci` passed with 0 vulnerabilities and the expected local Node 22 versus repo Node 20 engine warning.
- [x] `npm run lint` passed with the existing Fast Refresh warnings.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed: 19 files, 81 tests.
- [x] Env-backed `npm run build` passed on Vite 8.0.16.
- [x] `npm audit --omit=dev --audit-level=low` passed with 0 vulnerabilities.
- [x] `npm audit --audit-level=low` passed with 0 vulnerabilities.
- [x] `npm --prefix services/video-renderer test` passed: 145 tests.
- [x] `npm run lint:functions` passed.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed: 257 tests.
- [x] `npm run check:function-inventory` passed.
- [x] `npm run check:release-state` passed read-only; live hosts returned HTTP 200 and the renderer heartbeat was online.
- [x] `git diff --check` passed.

## Commit

```bash
git add package.json package-lock.json deno.lock docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "chore: align runtime and dependency hygiene"
```

## Exit Criteria

- [x] Node runtime policy is explicit.
- [x] Production audit findings have a fix or a documented reason.
- [x] Dependency changes are reviewable separately.

Status: completed as dependency/runtime metadata cleanup.

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

- [x] Inventory function JWT settings.

```bash
rg -n "verify_jwt|\\[functions\\." supabase/config.toml
```

- [x] Inventory service-role client usage.

```bash
rg -n "SERVICE_ROLE|service_role|createClient<any, any>|Deno\\.env\\.get" supabase/functions
```

- [x] Inventory query token compatibility.

```bash
rg -n "query|token|RSSAPP_ALLOW_QUERY_TOKEN|WEBHOOK_SHARED_SECRET|RSSAPP_WEBHOOK_TOKEN" supabase/functions docs
```

- [x] Write `docs/operations/function-auth-matrix.md` with:
  - function name.
  - trigger source.
  - `verify_jwt` value.
  - required secret.
  - caller.
  - accepted compatibility modes.
  - planned hardening step.
- [x] Add deploy preflight checks only if a missing check can be tested locally.

## Implementation Notes

- Added `docs/operations/function-auth-matrix.md` covering all 10 configured functions.
- Documented the three auth modes:
  - Supabase JWT plus admin-role check for `admin-actions` and `admin-retry`.
  - Internal Edge auth for cron/internal functions.
  - RSS webhook auth with temporary query-token compatibility.
- Documented the query-token removal path for RSS.app.
- Linked the matrix from `docs/operations/runbooks.md` and `docs/operations/release-runbook.md`.
- No `supabase/config.toml` or deploy-script change was needed in this phase because `scripts/deploy-functions.sh` already validates `verify_jwt`, function entrypoints, clean tree, and main-branch deploy shape.
- Live Supabase secret-name refresh was attempted but blocked/interrupted by the sandbox approval path; the matrix therefore treats live secret presence as a required release-time refresh rather than a confirmed-current fact.

## Validation

```bash
npm run check:function-inventory
npm run lint:functions
npm run check:functions
npm run test:functions
DEPLOY_FUNCTIONS_DRY_RUN=1 DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh
```

Validation result:

- [x] `npm run check:function-inventory` passed: 10 configured functions.
- [x] `npm run lint:functions` passed: 95 files checked.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed: 257 tests.
- [x] `DEPLOY_FUNCTIONS_DRY_RUN=1 DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh` passed and mapped all 10 functions to the expected deploy flags without changing production.
- [x] `git diff --check` passed.

## Commit

```bash
git add docs/operations/function-auth-matrix.md docs/operations/runbooks.md docs/operations/release-runbook.md docs/superpowers/plans/2026-06-14-xot-cleanup-master-plan.md
git commit -m "docs: add function auth and secret matrix"
```

If no code/config changes are needed:

```bash
git add docs/operations/function-auth-matrix.md docs/operations/runbooks.md docs/operations/release-runbook.md
git commit -m "docs: add function auth and secret matrix"
```

## Exit Criteria

- [x] Every `verify_jwt=false` function has a documented reason.
- [x] Query-token compatibility has an explicit removal path.
- [x] Deploy guardrails remain strict.

Status: completed as an operations documentation and release-guardrail phase.

---

# Phase 18: Integration Branch And Full Local Verification

Branch:

```text
codex/xot-cleanup-40-integration
```

## Objective

Combine the reviewed cleanup slices into one final integration branch for complete local validation and browser smoke checks.

## Steps

- [x] Create integration branch from the last reviewed cleanup branch.

```bash
git switch <last-reviewed-cleanup-branch>
git switch -c codex/xot-cleanup-40-integration
```

- [x] Rebase or merge only branches that passed their phase gate.
- [x] Resolve conflicts by preserving current production behavior.
- [x] Run Universal Validation Gate.
- [x] Start local dev server.

```bash
npm run dev
```

- [x] Open local app in browser:

```text
http://127.0.0.1:8080
```

- [x] Browser-smoke unauthenticated behavior:
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
- [x] Record browser coverage and any auth blockage in the branch handoff.

## Execution Notes

- Integration branch `codex/xot-cleanup-40-integration` was created from the reviewed Phase 17 tip. No merge conflict resolution was required because the current branch already contained the passed cleanup slices.
- Local dev smoke used the env-backed command below so the runtime config guard could be tested separately from the actual auth surface:

```bash
env VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run dev -- --host 127.0.0.1
```

- First browser load without Vite env rendered the expected missing-configuration guard for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- After restarting with the local validation env and hard-reloading Chrome, `/` redirected to `/auth` and rendered the XOT Panel auth form.
- Direct unauthenticated access to `/monitoring` redirected back to `/auth`.
- Desktop and narrow-window GUI smoke showed the auth surface rendered without a blank screen or obvious text overlap.
- Authenticated browser smoke was not completed in this phase because no explicit test credentials/session were used. Dashboard, Monitoring, Settings, XAccount, and authenticated `admin-actions` browser coverage remain a manual or credentialed follow-up before production promotion.
- Playwright automation was not usable in this local session: bundled Chromium was not installed, and launching system Chrome from Playwright aborted under macOS sandbox/Crashpad permissions. GUI Chrome smoke was completed through the OS/browser surface instead.
- The local dev server was stopped after browser validation.

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

Results:

- [x] `npm run lint:functions` passed; Deno lint checked 95 files.
- [x] `npm run check:functions` passed.
- [x] `npm run test:functions` passed; 257 function tests.
- [x] `npm run lint` passed with the existing eight Fast Refresh warnings in UI/auth component modules.
- [x] `npm run check:strict` passed.
- [x] `npm test` passed; 19 test files and 81 tests. The expected `useAuth must be used within an AuthProvider` stack traces came from the test that asserts the error path.
- [x] `npm run check:function-inventory` passed; 10 configured Supabase functions.
- [x] Env-backed `npm run build` passed with Vite 8.0.16.
- [x] `npm --prefix services/video-renderer test` passed; 145 renderer tests.
- [x] `npm run check:release-state` passed read-only.
- [x] `git status --short --branch` was clean before this Phase 18 documentation update.

Read-only release-state evidence:

- GitHub default branch is `main`; latest main CI was green for `5d351a9db81809fac4e668c5d03f298f03647808`.
- Live hosts `https://xot.iraneyes.com` and `https://xot.vercel.app` returned HTTP 200 with security headers.
- Supabase listed 10 active functions with expected `verify_jwt` settings.
- Supabase secret names were refreshed; required production names such as `OPENAI_API_KEY`, Telegram, Twitter/X, `WEBHOOK_SHARED_SECRET`, and deploy metadata were present. Optional compatibility/renderer names including `RSSAPP_ALLOW_QUERY_TOKEN`, `RSSAPP_WEBHOOK_TOKEN`, `VIDEO_RENDERER_URL`, `VIDEO_RENDERER_TOKEN`, and `DEEPGRAM_API_KEY` were absent.
- Active cron jobs were present for worker, cleanup, reconcile, learned-bias rebuild, and X poster schedules.
- Queue health showed completed jobs only, with no stale running jobs.
- Video renderer heartbeat `hermes-masih-1` was online with `render_version=persian-subtitles-masihh-v1`.
- Vercel CLI was unavailable, so authenticated Vercel deployment inventory was skipped.
- Known Supabase migration drift remains; migrations must not be pushed until the local/remote history mismatch is intentionally reconciled.

## Commit

```bash
git add .
git commit -m "chore: integrate xot cleanup branches"
```

Only run this commit command if conflict resolutions or integration-only docs were created. Do not make an empty integration commit unless the branch policy requires it.

## Exit Criteria

- [x] All selected cleanup branches are integrated.
- [x] Full local validation passes.
- [x] Browser smoke status is recorded.
- [x] No production deployment has happened.

---

# Phase 19: GitHub Review And CI

## Objective

Move from local validation to GitHub review without affecting production.

## Steps

- [x] Push only the integration branch.

```bash
git push -u origin codex/xot-cleanup-40-integration
```

- [x] Open a draft PR against `main`.
- [x] PR description must include:
  - branch stack summary.
  - changed modules.
  - local validation commands and results.
  - known pre-existing warnings.
  - release-state read-only result.
  - statement that nothing has been deployed.
  - rollback strategy.
- [x] Wait for GitHub CI.
- [x] Fix CI failures in new cleanup commits on the same branch.
- [x] Request code review.
- [x] Do not merge until CI and review pass.

## Execution Notes

- Pushed `codex/xot-cleanup-40-integration` to `origin` and opened draft PR #13: `https://github.com/Masihhedayati/liquid-feed-flux/pull/13`.
- PR #13 targets `main` at base SHA `5d351a9db81809fac4e668c5d03f298f03647808` and head SHA `ba24f8d0cb138a66ad5aa006987042471fa6f016`.
- PR body records the branch stack summary, changed modules, local validation commands and results, known warnings, read-only release-state result, no-deployment statement, and rollback strategy.
- GitHub Actions CI run `27506336789` completed successfully.
- Vercel preview status was successful.
- CodeRabbit initially skipped the draft PR; `@coderabbitai review` was posted and CodeRabbit completed successfully with no review threads.
- No CI failures required fix commits in this phase.
- Local `gh auth status` reported an invalid token for `Masihhedayati`; `git push` and GitHub connector PR operations still succeeded. Future `gh`-only work may require `gh auth login`.

## Exit Criteria

- [x] Draft PR exists.
- [x] CI is green.
- [x] Review findings are resolved or explicitly accepted.
- [x] PR is ready for merge only after local and remote validation agree.

---

# Phase 20: Production Promotion

## Objective

Bring production up to date only after the cleanup is merged to `main` and verified.

## Preconditions

- [x] Integration PR merged to `main`.
- [x] GitHub CI green on `main`.
- [x] Clean local `main` checkout.
- [x] Release runbook reviewed.
- [x] Rollback target identified.

## Steps

- [x] Use the main checkout, not the cleanup worktree.

```bash
cd "/Users/stevmq/Finalized XOT"
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git status --short --branch
```

- [x] Confirm local main matches remote main.

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

- [x] Run pre-release state check.

```bash
npm run check:release-state
```

- [x] Run full local gate from clean main.

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

- [x] Dry-run function deploy preflight.

```bash
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh
```

- [x] Let Vercel deploy from GitHub `main`.
- [x] Check Vercel production aliases:

```bash
curl -sSI https://xot.iraneyes.com
curl -sSI https://xot.vercel.app
```

- [x] Deploy Supabase functions only from clean main if function code changed:

```bash
./scripts/deploy-functions.sh
```

- [x] Do not apply migrations unless Phase 14 produced a reviewed migration action.
- [x] Run post-release state check:

```bash
npm run check:release-state
```

- [x] Perform authenticated smoke checks:
  - Dashboard loads.
  - Monitoring loads.
  - Settings loads.
  - XAccount loads.
  - `admin-actions` version returns released `DEPLOY_GIT_SHA`.
  - worker cron continues completing jobs.
  - `x-poster-tick` continues running.
  - renderer heartbeat is online.
  - stale running jobs query is empty.

- [x] Record release in `docs/operations/release-runbook.md`.

## Execution Notes

- PR #13 (`https://github.com/Masihhedayati/liquid-feed-flux/pull/13`) was marked ready and merged to `main` as `8f0b93db7e57bbc0b6108db12e929e220715970c`.
- Clean `main` was refreshed in `/Users/stevmq/.config/superpowers/worktrees/Finalized-XOT/phase2-scoring-release` and matched `origin/main`.
- GitHub CI for `main` run `27507054048` completed successfully at `8f0b93db7e57bbc0b6108db12e929e220715970c`.
- Local validation from clean `main` passed:
  - `npm ci`
  - `npm run lint`
  - `npm run check:function-inventory`
  - `npm run lint:functions`
  - `npm run check:functions`
  - `npm run test:functions`
  - `npm run check:strict`
  - `npm test`
  - `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
  - `npm --prefix services/video-renderer test`
- `DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh` passed, then `./scripts/deploy-functions.sh` deployed all 10 configured functions and stamped `DEPLOY_GIT_SHA=8f0b93db7e57bbc0b6108db12e929e220715970c`.
- Vercel production deployment `dpl_4y8m9mYj5qFggB9nX5TehuMDQHC9` was `READY`, target `production`, ref `main`, commit `8f0b93db7e57bbc0b6108db12e929e220715970c`, with aliases `xot.iraneyes.com`, `xot.vercel.app`, `xot-masihation-8914s-projects.vercel.app`, and `xot-git-main-masihation-8914s-projects.vercel.app`.
- `curl -sSI https://xot.iraneyes.com` and `curl -sSI https://xot.vercel.app` returned `HTTP/2 200` with matching ETag `"62ee158844cdde3d9bf8593572b49ccc"` and expected security headers.
- Post-release `npm run check:release-state` passed twice after the function deploy. The later check ran after authenticated browser smoke and confirmed:
  - local branch matched `origin/main`;
  - no open PRs or issues;
  - main CI green;
  - all 10 Supabase functions active with expected `verify_jwt` values;
  - `DEPLOY_GIT_SHA` secret updated at `2026-06-14T17:57:28.900Z`;
  - known migration drift still present and no migrations applied;
  - cron jobs `invoke-worker-every-1m` and `x-poster-tick` active;
  - queue health contained completed jobs only;
  - stale running jobs query returned no rows;
  - renderer `hermes-masih-1` online with `render_version=persian-subtitles-masihh-v1`, `processed=3`, `failed=0`, `last_seen_at=2026-06-14 18:25:58.825+00`;
  - `scoring_policy` mode `active` and `video_render_config` mode `shadow`.
- Authenticated Chrome smoke on production loaded Dashboard, Monitoring, Settings, Video Renders, and `/x-account`.
  - Dashboard showed `Pipeline is operating normally`, `Last ingest 0m ago`, and `0 stale running jobs`.
  - Monitoring loaded live queue rows and counts through the authenticated admin surface.
  - Settings loaded production settings and model controls.
  - Video Renders showed renderer `Online`, mode `shadow`, `0` queued, `0` issues, and no backlog.
  - `/x-account` loaded the intended `My X is paused` state and did not expose follower snapshot controls.
  - The version banner showed frontend `8f0b93d` and backend API `8f0b93db7e57bbc0b6108db12e929e220715970c`.
- Rollback target for frontend is Vercel deployment `dpl_JEAKMGeLPRzpe3ZMTeNEAMGysHf9` at git `5d351a9db81809fac4e668c5d03f298f03647808`.
- Function rollback target is git `5d351a9db81809fac4e668c5d03f298f03647808` via `DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh`.

## Exit Criteria

- [x] Production frontend points at the merged main SHA.
- [x] Supabase functions are deployed from the same main SHA if changed.
- [x] Post-release read-only state is healthy.
- [x] Release ledger contains rollback target and smoke-check evidence.

---

# Phase 21: Post-Cleanup Simplification

Status: partially completed and promoted. Safe removals are live on `main`; remaining candidates are deferred because their removal still needs request-log evidence, operator decision, or focused test/export-surface work.

## Objective

Remove compatibility scaffolding only after production has run safely on the cleaned code.

## Timing

Wait until at least one normal production operating cycle has passed after release.

Timing note: by `2026-06-14T18:25:58Z`, more than one one-minute production operating cycle had passed after the `2026-06-14T17:57:28.900Z` deploy stamp. The later post-release `npm run check:release-state` passed, with worker and x-poster cron active, no stale running jobs, and renderer heartbeat online.

Follow-up timing note: after PR #16, production was promoted again at `c4076d3055c8e9d509387131a8d0d8ddf18666ec`. Post-deploy `npm run check:release-state` passed, `admin-actions` was live at version `156`, `worker` was live at version `232`, migration `20260615005500` was recorded as applied, and the worker cron body included `reprocess`.

Dashboard incident follow-up timing note: after PR #19, production was promoted again at `c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`. `admin-actions` was live at version `158`, `DEPLOY_GIT_SHA` was stamped to `c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`, main CI run `27522692966` passed, and the production frontend refreshed at `2026-06-15T03:45:48Z`.

Worker export cleanup timing note: after PR #20, production was promoted again at `70d5733a5604a535e1d44be1224a10033121d102`. `worker` was live at version `235`, main CI run `27523244015` passed, live hosts refreshed at `2026-06-15T04:05:59Z`, and `npm run check:release-state` passed with no stale running jobs and renderer heartbeat online.

Compatibility telemetry timing note: after PR #22, production was promoted again at `ccd06079eae7e454ffd372dce94f71940c64e560`. Migration `20260615043000` was applied and repaired into the remote migration ledger, main CI run `27524704871` passed, live hosts refreshed at `2026-06-15T04:54:52Z`, and `npm run check:release-state` passed. Deployed Edge Function versions were `admin-actions` `161`, `db-cleanup` `134`, `digest-compiler` `90`, `media-cleanup` `170`, `media-processor` `173`, `webhooks-rssapp` `207`, `worker` `237`, `x-followers-snapshot` `84`, and `x-poster` `110`.

Worker helper export cleanup timing note: after PR #25, production was promoted again at `64a6ed61d7194dcab808651f2f10de7bcf19e72a`. Main CI run `27529812922` passed, live hosts refreshed at `2026-06-15T07:10:05Z`, all 10 Edge Functions were deployed, `DEPLOY_GIT_SHA` was stamped to `64a6ed61d7194dcab808651f2f10de7bcf19e72a`, and `npm run check:release-state` passed. Deployed Edge Function versions were `admin-actions` `163`, `admin-retry` `164`, `db-cleanup` `136`, `digest-compiler` `92`, `media-cleanup` `172`, `media-processor` `175`, `webhooks-rssapp` `209`, `worker` `239`, `x-followers-snapshot` `86`, and `x-poster` `112`. Authenticated `admin-actions` `get_dashboard_summary` returned HTTP `200`, `success=true`, and a dashboard payload after deployment.

Hydration helper cleanup timing note: PR #27 was documentation/status-only and required no production deploy. After PR #28, production was promoted again at `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`. Main CI run `27540030183` passed, live hosts refreshed at `2026-06-15T10:28:38Z`, all 10 Edge Functions were deployed, `DEPLOY_GIT_SHA` was stamped to `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`, and `npm run check:release-state` passed. Deployed Edge Function versions were `admin-actions` `165`, `admin-retry` `166`, `db-cleanup` `138`, `digest-compiler` `94`, `media-cleanup` `174`, `media-processor` `177`, `webhooks-rssapp` `211`, `worker` `241`, `x-followers-snapshot` `88`, and `x-poster` `114`. Authenticated Chrome Dashboard loaded at `https://xot.iraneyes.com/`, and a fresh `admin-actions` POST returned HTTP `200` on version `165` after Dashboard refresh.

Compatibility alias removal timing note: after PR #30, production was promoted again at `9d60e9052056f5a0e2e0794579701a97e7e8cb5e`. Main CI run `27543209019` passed, live hosts refreshed at `2026-06-15T11:24:33Z`, all 10 Edge Functions were deployed, `DEPLOY_GIT_SHA` was stamped to `9d60e9052056f5a0e2e0794579701a97e7e8cb5e`, and `npm run check:release-state` passed. Deployed Edge Function versions were `admin-actions` `167`, `admin-retry` `168`, `db-cleanup` `140`, `digest-compiler` `96`, `media-cleanup` `176`, `media-processor` `179`, `webhooks-rssapp` `213`, `worker` `243`, `x-followers-snapshot` `90`, and `x-poster` `116`. Post-deploy compatibility telemetry showed only `rss_query_token` activity at `45` hits, with no `monitoring_filter_alias` or `admin_action_alias` rows.

## Steps

- [x] Re-run release-state check.

```bash
npm run check:release-state
```

- [x] Remove frontend schema fallbacks that are no longer used.
- [x] Remove unused admin action wrappers. `backfill_signatures` was removed after temporary telemetry showed no `admin_action_alias` rows across the observed production window; operators should use `backfill_dedupe`.
- [x] Remove unused worker entrypoint re-exports and file-local lifecycle constants.
- [x] Remove remaining safe worker helper/type exports. PR #25 removed the safe file-local/test-only helper export slice. PR #32 removed the final safe type-only worker export surface; a read-only sidecar audit found no unused exported runtime helpers left in `supabase/functions/worker/*`.
- [x] Remove the obsolete `recordLegacyXApiUsage` writer after PR #34 moved live usage displays to `get_x_api_summary`; PR #36 removed the writer and stale frontend default.
- [x] Remove dead code identified by TypeScript and Deno checks.
- [x] Update docs to reflect the final module map.

## Candidate Queue

Read-only sidecar audit identified these Phase 21 candidates. Do not remove them in production without the listed verification gates:

- Monitoring legacy Supabase fallback in `src/api/monitoringData.ts`: removed in PR #15 after authenticated Monitoring smoke and release-state checks.
- Dashboard direct RPC fallback in `src/api/dashboardData.ts`: removed in PR #15 after Dashboard remained healthy through `admin-actions` and `src/test/dashboard-data.test.ts` was updated. PR #19 later kept `admin-actions` as the single Dashboard boundary by adding backend degraded handling for base `public.get_dashboard_summary()` failures and client-side Edge Function error-body extraction.
- Monitoring response/filter aliases in `src/api/monitoringData.ts` and `supabase/functions/admin-actions/monitoringReads.ts`: removed after old frontend bundles aged out and temporary `monitoring_filter_alias` telemetry showed no legacy filter values across the observed production window.
- Unused admin action cases in `supabase/functions/_shared/adminActionNames.ts` and `supabase/functions/admin-actions/index.ts`: `backfill_signatures` was removed after temporary `admin_action_alias` telemetry showed no external/manual use.
- Worker helper export surface in `supabase/functions/worker/*`: the unused `worker/index.ts` scoring re-export block and `MAX_ATTEMPTS` lifecycle export were removed in PR #20. PR #25 removed the safe file-local/test-only helper export slice. PR #32 removed the final safe type-only export surface. A read-only sidecar audit found no unused exported runtime helpers left; remaining runtime exports should stay until their production importer is moved or public behavior tests cover the split.
- Paused My X implementation in `src/pages/XAccount.tsx`, `src/api/xAccountData.ts`, `src/hooks/useFollowerData.ts`, and `src/components/x/FollowerGrowthChart.tsx`: removed in PR #15; `/x-account` remains routed to `src/pages/XAccountDisabled.tsx`.
- Renderer compatibility re-export in `services/video-renderer/src/renderer.js`: removed in PR #15 after confirming active imports use `services/video-renderer/src/config.js`.
- `recordLegacyXApiUsage` in `supabase/functions/_shared/xApiLedger.ts`: PR #34 moved Settings usage displays from `settings.x_api_usage` arrays to `get_x_api_summary`, backed by `x_api_events` and `x_deliveries`. PR #36 removed the obsolete writers after read-only code checks and a live frontend bundle check found no remaining runtime/UI dependency.
- RSS query-token compatibility in `supabase/functions/_shared/internalAuth.ts`: production Edge logs show query-token webhook calls still happen, so do not remove it until RSS.app is moved to header auth and temporary `rss_query_token` telemetry shows zero hits.

## Temporary Compatibility Telemetry

PR #22 adds an additive, service-role-only `public.compatibility_usage_events` table plus best-effort writes from `admin-actions` and `webhooks-rssapp` compatibility paths. It records only source, feature, legacy/canonical labels, action, actor id, method, path, and bounded metadata; it does not store request bodies, auth tokens, or query strings.

Use this read-only query during the observation window:

```sql
select
  feature,
  legacy_value,
  canonical_value,
  action,
  request_path,
  count(*)::int as hits,
  max(created_at) as last_seen_at
from public.compatibility_usage_events
group by 1, 2, 3, 4, 5
order by last_seen_at desc;
```

The historical removal gates were:

- `monitoring_filter_alias`: proved old Monitoring filter aliases were unused before their removal.
- `admin_action_alias`: proved `backfill_signatures` was unused before its removal.
- `rss_query_token`: proves RSS.app no longer sends webhook auth in the URL.

Initial post-deploy read after `ccd06079eae7e454ffd372dce94f71940c64e560` returned zero rows. Follow-up telemetry at `2026-06-15T05:09:40Z` recorded `2` `rss_query_token` hits for `/webhooks-rssapp` with `legacy_value=query:token`. Later telemetry at `2026-06-15T10:49:04Z` recorded `40` `rss_query_token` hits for the same path. A refreshed query at `2026-06-15T10:56:03Z` recorded `41` `rss_query_token` hits and no `monitoring_filter_alias` or `admin_action_alias` rows. Monitoring aliases and `backfill_signatures` were therefore removed. Post-deploy telemetry after `9d60e9052056f5a0e2e0794579701a97e7e8cb5e` recorded `45` `rss_query_token` hits and still no Monitoring/admin alias rows. RSS.app query-token compatibility is still actively used and must not be removed yet.

Refreshed telemetry on `2026-06-15` after main reached `359d5503efa35457d8cf6af032feaedcf183b625` still showed active RSS query-token traffic: total `rss_query_token` hits reached `99`, the latest observed timestamp was `2026-06-15 17:39:41.885028+00`, and the enforced 24-hour quiet-window gate failed with `99` hits. Supabase secret-name inventory did not list `RSSAPP_ALLOW_QUERY_TOKEN`, so query-token compatibility remains enabled by default. Branch `codex/xot-rss-compatibility-gate` adds release-state telemetry reporting and the optional quiet-window gate below to make the final removal proof explicit.

Use this release-state gate before deleting `readRssWebhookToken` query-param compatibility or treating `RSSAPP_ALLOW_QUERY_TOKEN=false` as the permanent production setting:

```bash
CHECK_COMPATIBILITY_QUIET=1 COMPATIBILITY_QUIET_HOURS=24 npm run check:release-state
```

Expected before removal:

```text
rss_query_token hits in last 24h: 0
Compatibility quiet-window gate passed.
```

If it reports any hits, RSS.app is still sending the token in the URL and the compatibility path must stay.

Post-PR #25 dashboard check: a user-visible "Dashboard failed to load / Edge Function returned a non-2xx status code" report was investigated read-only first. Direct unauthenticated `admin-actions` checks returned expected `401`s, local execution of the dashboard summary module against live Supabase returned a dashboard payload, and post-deploy authenticated `admin-actions` `get_dashboard_summary` returned HTTP `200`, `success=true`, and a dashboard payload. No Dashboard code/config hotfix was needed for this incident.

Post-PR #28 dashboard check: the same user-visible Dashboard failure was checked again after the `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc` deploy. The canonical Dashboard route is `https://xot.iraneyes.com/`; `/dashboard` intentionally renders the app 404. Authenticated Chrome loaded the Dashboard successfully, UI refresh kept the page healthy, Supabase Edge Function logs showed a fresh `admin-actions` POST returning HTTP `200` on version `165`, and `npm run check:release-state` passed. No Dashboard code/config hotfix was needed for this incident.

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

- [x] Safe compatibility scaffolding is gone.
- [ ] All compatibility scaffolding is gone. Remaining deferred candidate: RSS query-token compatibility, which remains active until RSS.app moves to header auth and telemetry is quiet.
- [x] Docs match the actual code for completed removals.
- [x] Local and read-only live checks pass for completed removals and the later `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc` release.

Current completion-audit follow-ups that are not safe to mark done without more work:

- Phase 8 still has one narrow cleanup candidate: the actual `media-processor` invoke body remains inline in `supabase/functions/worker/index.ts`; the resolve/download job payload is tested in `mediaWorkflow.test.ts`, but the invoke payload itself needs extraction or an explicit waiver.
- Phase 11 still has two narrow frontend test gaps: status filter row-id parity is backend-owned after `get_monitoring_entries`, and the Monitoring empty state exists in UI but lacks focused test coverage.
- Phase 21 remains blocked by live RSS query-token traffic until RSS.app is moved to header auth and the quiet-window gate above reports zero hits.

---

# Post-Phase 21: OpenAI Quota And Dashboard Degraded Edge Failure Follow-Up

Status: completed and promoted through reviewed `main`.

## Objective

Close the production gaps discovered after the cleanup release: Dashboard optional summary reads and the base dashboard summary RPC could still fail the whole page, and OpenAI quota exhaustion caused repeated expensive retries.

## Completed Scope

- PR #17 hardened Dashboard optional summary sections with `withDashboardFallback` so optional PostgREST/RPC reads fail closed instead of returning an Edge Function 500.
- PR #19 hardened the Dashboard base summary path so `admin-actions` logs `base_summary` failures and returns a degraded critical dashboard instead of a 500 when `public.get_dashboard_summary()` fails.
- PR #19 also made `src/api/adminActions.ts` extract Edge Function response bodies from `FunctionsHttpError.context`, producing actionable client errors such as `Edge Function 401: ...`.
- PR #16 added OpenAI cost controls:
  - `supabase/functions/_shared/providerErrors.ts` classifies insufficient-quota errors as non-retryable.
  - Worker job failure handling dead-letters quota exhaustion instead of retrying all attempts.
  - `supabase/functions/_shared/openaiCostControls.ts` clamps live `max_completion_tokens` settings at `8000`.
  - Settings validation rejects runaway OpenAI completion-token caps.
  - Dashboard surfaces OpenAI usage from completed job metadata.
- Migration `20260615005500_include_reprocess_in_worker_cron.sql` added `reprocess` to the worker fallback cron body.
- Live `translation_prompt.max_completion_tokens` and `translation_prompt.scoring.max_completion_tokens` were normalized from `50000` to `8000`.

## Evidence

- PR #16 merged at `c4076d3055c8e9d509387131a8d0d8ddf18666ec`.
- GitHub CI for `main` run `27521288800` succeeded.
- Vercel deployment completed for PR #16 before merge.
- `admin-actions` deployed at version `156`, `worker` deployed at version `232`.
- `DEPLOY_GIT_SHA` was stamped to `c4076d3055c8e9d509387131a8d0d8ddf18666ec`.
- `npm run check:release-state` passed after deploy.
- Production cron `invoke-worker-every-1m` now includes `job_types:["reprocess","dedupe","resolve_media","download_media","hydrate_tweet","translate","deliver"]`.
- Manual reprocess recovery drained from pending to `50` completed reprocess jobs in the 24-hour queue check.
- PR #19 merged at `c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`.
- GitHub CI for `main` run `27522692966` succeeded.
- `admin-actions` deployed at version `158`.
- `DEPLOY_GIT_SHA` was stamped to `c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`.
- Production frontend returned HTTP 200 and served the refreshed app shell last modified at `2026-06-15T03:45:48Z`.
- Unauthenticated `admin-actions` sanity returned the expected `401` gateway response.

## Remaining Notes

- Authenticated Dashboard Edge Function verification passed after PR #25 using an active admin browser session; visual browser-page JavaScript verification remains blocked locally because Chrome has "Allow JavaScript from Apple Events" disabled.
- `translation_prompt.reasoning_effort` remains `high`; this is a product-quality/cost tradeoff and should be tuned deliberately rather than changed as cleanup.

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
