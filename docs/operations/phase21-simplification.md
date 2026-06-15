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
- Unused admin-action names such as `backfill_signatures`, after checking admin-actions request logs and runbooks.
- Worker helper export cleanup in `supabase/functions/worker/*`; this is mostly test export surface and should be done with focused Deno tests.
- RSS query-token compatibility and `recordLegacyXApiUsage`; both still have documented production relevance.

## Validation

- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
- `npm --prefix services/video-renderer test`
