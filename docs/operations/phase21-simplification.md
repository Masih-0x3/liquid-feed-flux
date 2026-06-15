# Phase 21 Simplification Record

Date: 2026-06-14
Branch: `codex/xot-cleanup-42-phase21-simplification`
Base release: `8f0b93db7e57bbc0b6108db12e929e220715970c`

This branch removes compatibility code only after the PR #13 release was live, authenticated browser smoke passed, and a later `npm run check:release-state` confirmed worker cron, `x-poster-tick`, queue health, and renderer heartbeat were healthy.

## Removed

- Removed the unrouted My X follower-management implementation:
  - `src/pages/XAccount.tsx`
  - `src/api/xAccountData.ts`
  - `src/hooks/useFollowerData.ts`
  - `src/components/x/FollowerGrowthChart.tsx`
  - `src/test/x-account-data.test.ts`
- Kept the active `/x-account` route on `src/pages/XAccountDisabled.tsx`.
- Removed the Dashboard direct `get_dashboard_summary` RPC fallback from `src/api/dashboardData.ts`.
- Removed the Monitoring direct Supabase legacy query fallback from `src/api/monitoringData.ts`.
- Removed the compatibility `loadConfigFromEnv` re-export from `services/video-renderer/src/renderer.js`; callers import config from `services/video-renderer/src/config.js`.

## Deferred

These items still need request-log evidence or a product decision before removal:

- Old Monitoring response/filter aliases in `src/api/monitoringData.ts` and `supabase/functions/admin-actions/monitoringReads.ts`.
- Unused admin-action names such as `backfill_signatures`, after checking admin-actions request logs and runbooks. Local code already uses canonical `backfill_dedupe`; `backfill_signatures` only forwards to it, but successful admin action names are not currently recorded in an app table, and this Supabase CLI does not expose function request logs.
- Worker helper export cleanup in `supabase/functions/worker/*`; this is mostly test export surface and should be done with focused Deno tests.
- RSS query-token compatibility and `recordLegacyXApiUsage`; both still have documented production relevance.

### Monitoring Alias Removal Gate

Current frontend code uses canonical Monitoring filters, but the backend still accepts old filter aliases for aged-out frontend bundles and bookmarked URLs.

Do not remove these aliases until authenticated production browser evidence and request/log evidence show zero legacy use across a normal operator window:

- `needs_action` / `needs-action` -> `needs_attention`
- `failed` -> `failed_stuck`
- `awaiting_review` -> `manual_review`
- `hydration_backlog` -> `hydration`
- `posted_24h` / `recently_delivered` -> `delivered_24h`
- `ready_to_publish` -> `ready_to_deliver`
- `needs_translation` / `delivery_pending` -> `translation_queue`

Response aliases still intentionally emitted for compatibility are `needs_action`, `failed`, `waiting_translation`, `delivery_pending`, `awaiting_review`, `duplicate_skipped`, `hydration_backlog`, `posted_24h`, and `ready_to_publish`. Existing successful requests do not log raw filters, so if Supabase logs cannot prove zero legacy use, add temporary legacy-filter-hit telemetry before removing the aliases.

## Follow-Up Release Notes

- PR #17 hardened Dashboard optional summary fallbacks after an `admin-actions` non-2xx incident.
- PR #16 added OpenAI quota/cost guardrails, applied migration `20260615005500`, deployed `admin-actions` version `156`, deployed `worker` version `232`, and stamped `DEPLOY_GIT_SHA=c4076d3055c8e9d509387131a8d0d8ddf18666ec`.
- The worker fallback cron now includes `reprocess`; the manually queued reprocess batch drained to `50` completed jobs in the 24-hour queue check.
- Live `translation_prompt.max_completion_tokens` and `translation_prompt.scoring.max_completion_tokens` were normalized from `50000` to `8000`. `reasoning_effort=high` remains a deliberate product-quality/cost tradeoff to tune separately.

## Validation

- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
- `npm --prefix services/video-renderer test`
