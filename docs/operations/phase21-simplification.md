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
- Removed the Monitoring filter/response aliases after temporary telemetry showed no `monitoring_filter_alias` rows across the observed production window.
- Removed the `backfill_signatures` admin-action alias after temporary telemetry showed no `admin_action_alias` rows across the observed production window. Operators should use `backfill_dedupe`.
- Removed the compatibility `loadConfigFromEnv` re-export from `services/video-renderer/src/renderer.js`; callers import config from `services/video-renderer/src/config.js`.
- Removed unused worker export surface that had no local importers:
  - the scoring re-export block from `supabase/functions/worker/index.ts`
  - the `MAX_ATTEMPTS` export from `supabase/functions/worker/jobLifecycle.ts`

## Deferred

These items still need request-log evidence, follow-up refactoring, or a product decision before removal:

- RSS query-token compatibility still has documented production relevance.
- `recordLegacyXApiUsage` writers remain temporarily while production runs on the canonical `x_api_events`/`x_deliveries` Settings UI. Branch `codex/xot-xapi-summary-ui-cache-cleanup` moves Settings off `settings.x_api_usage`; remove the writers only after that release is live and read-only checks confirm no remaining runtime/UI dependency.

### Worker Helper Export Cleanup Slice

Branch `codex/xot-worker-helper-export-cleanup` removes the remaining safe worker helper export surface that was file-local or test-only:

- Made file-local worker utility types and timing helpers private: `JobLane`, `ExtractedMediaItem`, `timestampMs`, and `nonNegativeMs`. Kept `ResolvedVariant` exported because `mediaWorkflow.ts` imports it.
- Made `TelegramRateLimitError` private and changed the focused Telegram test to assert the thrown error shape instead of importing the class.
- Made video-render workflow internals private: `VIDEO_RENDER_VERSION`, dispatch dependency types, config/decision loaders, renderer dispatch helper, and deliver-job enqueue helper. Kept `VIDEO_RENDER_DEFER_MS` exported because `worker/index.ts` imports it.
- Made media and X API implementation types private and deleted the unused `ResolvedMediaSource` alias.
- Made scoring/translation implementation types and `SCORING_AXES_SCHEMA` private. Kept `ScoringDecisionLog` exported because `worker/index.ts` imports it.

Follow-up branch `codex/xot-cleanup-21-worker-type-export-surface` removes the final safe type-only worker export surface without changing runtime behavior:

- Made `HydratedTweetPatch` private in `supabase/functions/worker/xApiWorkflow.ts`; it is only the return type of `buildHydratedTweetPatch()`.
- Made `ScoringDecisionLog` private in `supabase/functions/worker/scoringWorkflow.ts`; `worker/index.ts` now derives its local log-event type from `buildScoringBaseDecisionState()`.
- Made `ResolvedVariant` private in `supabase/functions/worker/workerUtils.ts`; `mediaWorkflow.ts` now uses a local structural `FxTwitterVariant` type when passing variants to `rmPickBestVariant()`.
- A read-only sidecar audit found no unused exported runtime helpers left in `supabase/functions/worker/*`; remaining runtime exports are production imports or public module boundaries.

Focused validation for this slice:

- `npx deno test supabase/functions/worker/workerUtils.test.ts supabase/functions/worker/telegramDelivery.test.ts supabase/functions/worker/scoringWorkflow.test.ts supabase/functions/worker/videoRenderWorkflow.test.ts supabase/functions/worker/mediaWorkflow.test.ts supabase/functions/worker/xApiWorkflow.test.ts supabase/functions/worker/translateWorkflow.test.ts`
- `npx deno check supabase/functions/worker/index.ts supabase/functions/worker/workerUtils.ts supabase/functions/worker/telegramDelivery.ts supabase/functions/worker/scoringWorkflow.ts supabase/functions/worker/videoRenderWorkflow.ts supabase/functions/worker/mediaWorkflow.ts supabase/functions/worker/xApiWorkflow.ts supabase/functions/worker/translateWorkflow.ts`

### Temporary Compatibility Telemetry

PR #22 added `public.compatibility_usage_events` and best-effort Edge Function writes for compatibility paths that logs could not prove at the time:

- `monitoring_filter_alias` when `get_monitoring_entries` receives a legacy filter alias.
- `admin_action_alias` when the `backfill_signatures` alias forwards to `backfill_dedupe`.
- `rss_query_token` when RSS webhook auth succeeds through a query token instead of `x-webhook-token`.

The table is service-role-only and intentionally stores no request body, auth token, or query string. Migration `20260615043000` was applied and repaired into the remote migration ledger, then shared-auth Edge Functions were deployed from `ccd06079eae7e454ffd372dce94f71940c64e560`.

Follow-up telemetry at `2026-06-15T10:56:03Z` showed only `rss_query_token` activity: `41` hits for `/webhooks-rssapp` with `legacy_value=query:token`. No `monitoring_filter_alias` or `admin_action_alias` rows were present, so the Monitoring aliases and `backfill_signatures` alias were removed on branch `codex/xot-remove-unused-compat-aliases`. RSS query-token compatibility stays deferred until RSS.app is migrated to header auth and telemetry shows zero hits across a normal operator window.

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

Current frontend code uses canonical Monitoring filters. The backend previously accepted old filter aliases for aged-out frontend bundles and bookmarked URLs.

The following aliases were removed after authenticated production checks and zero-use telemetry:

- `needs_action` / `needs-action` -> `needs_attention`
- `failed` -> `failed_stuck`
- `awaiting_review` -> `manual_review`
- `hydration_backlog` -> `hydration`
- `posted_24h` / `recently_delivered` -> `delivered_24h`
- `ready_to_publish` -> `ready_to_deliver`
- `needs_translation` / `delivery_pending` -> `translation_queue`

Response aliases removed from `get_monitoring_overview` were `needs_action`, `failed`, `waiting_translation`, `delivery_pending`, `awaiting_review`, `duplicate_skipped`, `hydration_backlog`, `posted_24h`, and `ready_to_publish`.

## Follow-Up Release Notes

- PR #17 hardened Dashboard optional summary fallbacks after an `admin-actions` non-2xx incident.
- PR #16 added OpenAI quota/cost guardrails, applied migration `20260615005500`, deployed `admin-actions` version `156`, deployed `worker` version `232`, and stamped `DEPLOY_GIT_SHA=c4076d3055c8e9d509387131a8d0d8ddf18666ec`.
- PR #19 hardened Dashboard base-summary degradation, deployed `admin-actions` version `158`, and stamped `DEPLOY_GIT_SHA=c6ba0ba46f3e45f888c23fd95cdd8cbf4b9cb1b1`.
- Production frontend was refreshed at `2026-06-15T03:45:48Z`; main CI run `27522692966` passed; unauthenticated `admin-actions` sanity returned the expected `401`.
- Authenticated Dashboard Edge Function verification later passed after PR #25 with an active admin browser session; visual browser-page JavaScript verification remains blocked locally because Chrome has "Allow JavaScript from Apple Events" disabled.
- PR #20 removed the safe worker export-surface slice, deployed `worker` version `235`, and stamped `DEPLOY_GIT_SHA=70d5733a5604a535e1d44be1224a10033121d102`.
- Production frontend was refreshed at `2026-06-15T04:05:59Z`; main CI run `27523244015` passed; post-deploy `npm run check:release-state` passed with no stale running jobs and renderer heartbeat online.
- PR #22 added temporary compatibility usage telemetry, applied migration `20260615043000`, deployed `admin-actions` `161`, `db-cleanup` `134`, `digest-compiler` `90`, `media-cleanup` `170`, `media-processor` `173`, `webhooks-rssapp` `207`, `worker` `237`, `x-followers-snapshot` `84`, and `x-poster` `110`, and stamped `DEPLOY_GIT_SHA=ccd06079eae7e454ffd372dce94f71940c64e560`.
- Production frontend was refreshed at `2026-06-15T04:54:52Z`; main CI run `27524704871` passed; post-deploy `npm run check:release-state` passed; initial `public.compatibility_usage_events` read returned zero rows.
- Follow-up telemetry at `2026-06-15T05:09:40Z` recorded `2` `rss_query_token` hits for `/webhooks-rssapp` with `legacy_value=query:token`, confirming RSS.app query-token compatibility is still actively used and must not be removed yet.
- PR #25 removed the safe worker helper export-surface slice, deployed all 10 Edge Functions from `64a6ed61d7194dcab808651f2f10de7bcf19e72a`, and stamped `DEPLOY_GIT_SHA=64a6ed61d7194dcab808651f2f10de7bcf19e72a`.
- Production frontend was refreshed at `2026-06-15T07:10:05Z`; main CI run `27529812922` passed; post-deploy `npm run check:release-state` passed; authenticated `get_dashboard_summary` returned HTTP `200`, `success=true`, and a dashboard payload.
- PR #27 marked the Telegram helper cleanup status verified; it was documentation/status-only and did not require a Supabase deploy.
- PR #28 extracted hydration success patch shaping into `xApiWorkflow.ts`, tightened X/Twitter URL handle parsing, deployed all 10 Edge Functions from `f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`, and stamped `DEPLOY_GIT_SHA=f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc`.
- Production frontend was refreshed at `2026-06-15T10:28:38Z`; main CI run `27540030183` passed; post-deploy `npm run check:release-state` passed; authenticated Chrome Dashboard loaded at `https://xot.iraneyes.com/` and a fresh `admin-actions` request returned HTTP `200`.
- Follow-up telemetry at `2026-06-15T10:49:04Z` recorded `40` `rss_query_token` hits for `/webhooks-rssapp` with `legacy_value=query:token`, confirming RSS.app query-token compatibility is still actively used and must not be removed yet.
- PR #30 removed the zero-telemetry Monitoring/admin compatibility aliases, deployed all 10 Edge Functions from `9d60e9052056f5a0e2e0794579701a97e7e8cb5e`, and stamped `DEPLOY_GIT_SHA=9d60e9052056f5a0e2e0794579701a97e7e8cb5e`.
- Production frontend was refreshed at `2026-06-15T11:24:33Z`; main CI run `27543209019` passed; post-deploy `npm run check:release-state` passed; post-deploy telemetry recorded only `45` `rss_query_token` hits and no `monitoring_filter_alias` or `admin_action_alias` rows.
- PR #32 removed the final safe worker type-only export surface, deployed all 10 Edge Functions from `412127679bd158de342eabc64a4d4dd7c74cc4e2`, and stamped `DEPLOY_GIT_SHA=412127679bd158de342eabc64a4d4dd7c74cc4e2`.
- Production frontend was refreshed at `2026-06-15T11:56:20Z`; main CI run `27544386658` passed; post-deploy `npm run check:release-state` passed with no stale running jobs and renderer heartbeat online.
- The worker fallback cron now includes `reprocess`; the manually queued reprocess batch drained to `50` completed jobs in the 24-hour queue check.
- Live `translation_prompt.max_completion_tokens` and `translation_prompt.scoring.max_completion_tokens` were normalized from `50000` to `8000`. `reasoning_effort=high` remains a deliberate product-quality/cost tradeoff to tune separately.

## Validation

- `npm run lint`
- `npm run check:strict`
- `npm test`
- `VITE_SUPABASE_URL=https://jzirqfzzvlbxwfzndaer.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-build-validation-key VITE_SUPABASE_PROJECT_ID=jzirqfzzvlbxwfzndaer npm run build`
- `npm --prefix services/video-renderer test`
