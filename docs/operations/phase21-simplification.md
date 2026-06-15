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
- PR #19 later preserved that boundary by making `admin-actions` return a degraded critical Dashboard when the base `public.get_dashboard_summary()` RPC fails, instead of restoring a frontend direct-RPC fallback.
- Removed the Monitoring direct Supabase legacy query fallback from `src/api/monitoringData.ts`.
- Removed the compatibility `loadConfigFromEnv` re-export from `services/video-renderer/src/renderer.js`; callers import config from `services/video-renderer/src/config.js`.
- Removed unused worker export surface that had no local importers:
  - the scoring re-export block from `supabase/functions/worker/index.ts`
  - the `MAX_ATTEMPTS` export from `supabase/functions/worker/jobLifecycle.ts`

## Deferred

These items still need request-log evidence or a product decision before removal:

- Old Monitoring response/filter aliases in `src/api/monitoringData.ts` and `supabase/functions/admin-actions/monitoringReads.ts`.
- Unused admin-action names such as `backfill_signatures`, after checking admin-actions request logs and runbooks. Local code already uses canonical `backfill_dedupe`; `backfill_signatures` only forwards to it, but successful admin action names are not currently recorded in an app table, and this Supabase CLI does not expose function request logs.
- Remaining worker helper export cleanup in `supabase/functions/worker/*`; this is mostly test export surface and should be done with focused Deno tests or behavior-level replacement coverage.
- RSS query-token compatibility and `recordLegacyXApiUsage`; both still have documented production relevance.

### Temporary Compatibility Telemetry

PR #22 added `public.compatibility_usage_events` and best-effort Edge Function writes for the deferred compatibility paths that logs cannot prove:

- `monitoring_filter_alias` when `get_monitoring_entries` receives a legacy filter alias.
- `admin_action_alias` when the `backfill_signatures` alias forwards to `backfill_dedupe`.
- `rss_query_token` when RSS webhook auth succeeds through a query token instead of `x-webhook-token`.

The table is service-role-only and intentionally stores no request body, auth token, or query string. Migration `20260615043000` was applied and repaired into the remote migration ledger, then shared-auth Edge Functions were deployed from `ccd06079eae7e454ffd372dce94f71940c64e560`. Removal of these compatibility paths stays deferred until the telemetry table shows zero usage across a normal operator window and RSS.app is migrated to header auth.

Use this query during the observation window:

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

Response aliases still intentionally emitted for compatibility are `needs_action`, `failed`, `waiting_translation`, `delivery_pending`, `awaiting_review`, `duplicate_skipped`, `hydration_backlog`, `posted_24h`, and `ready_to_publish`. Existing successful requests do not log raw filters, so the temporary `monitoring_filter_alias` telemetry must show zero usage before removing backend filter aliases.

## Follow-Up Release Notes

- PR #17 hardened Dashboard optional summary fallbacks after an `admin-actions` non-2xx incident.
- PR #16 added OpenAI quota/cost guardrails, applied migration `20260615005500`, deployed `admin-actions` version `156`, deployed `worker` version `232`, and stamped `DEPLOY_GIT_SHA=c4076d3055c8e9d509387131a8d0d8ddf18666ec`.
- PR #19 hardened Dashboard base-summary degradation, deployed `admin-actions` version `158`, and stamped `DEPLOY_GIT_SHA=c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`.
- Production frontend was refreshed at `2026-06-15T03:45:48Z`; main CI run `27522692966` passed; unauthenticated `admin-actions` sanity returned the expected `401`.
- Authenticated Dashboard browser verification still requires an active admin browser session/JWT after PR #19.
- PR #20 removed the safe worker export-surface slice, deployed `worker` version `235`, and stamped `DEPLOY_GIT_SHA=70d5733a5604a535e1d44be1224a10033121d102`.
- Production frontend was refreshed at `2026-06-15T04:05:59Z`; main CI run `27523244015` passed; post-deploy `npm run check:release-state` passed with no stale running jobs and renderer heartbeat online.
- PR #22 added temporary compatibility usage telemetry, applied migration `20260615043000`, deployed `admin-actions` `161`, `db-cleanup` `134`, `digest-compiler` `90`, `media-cleanup` `170`, `media-processor` `173`, `webhooks-rssapp` `207`, `worker` `237`, `x-followers-snapshot` `84`, and `x-poster` `110`, and stamped `DEPLOY_GIT_SHA=ccd06079eae7e454ffd372dce94f71940c64e560`.
- Production frontend was refreshed at `2026-06-15T04:54:52Z`; main CI run `27524704871` passed; post-deploy `npm run check:release-state` passed; initial `public.compatibility_usage_events` read returned zero rows.
- The worker fallback cron now includes `reprocess`; the manually queued reprocess batch drained to `50` completed jobs in the 24-hour queue check.
- Live `translation_prompt.max_completion_tokens` and `translation_prompt.scoring.max_completion_tokens` were normalized from `50000` to `8000`. `reasoning_effort=high` remains a deliberate product-quality/cost tradeoff to tune separately.

## Validation

- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
- `npm --prefix services/video-renderer test`
