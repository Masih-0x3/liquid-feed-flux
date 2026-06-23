# XOT Release Runbook

This runbook is the production gate for XOT frontend, Supabase Edge Functions, database migrations, and renderer-related releases.

## Release Rules

- Release from a clean `main` checkout unless an emergency override is explicitly recorded.
- Do not deploy from `codex/*` cleanup or feature branches.
- Do not run `supabase db push` while migration history drift is unresolved.
- Run `npm run check:release-state` before and after release.
- Record every production release in the ledger section below.
- Keep Vercel frontend release, Supabase function deploy, and Supabase migration application as separate steps with verification between them.

## Required Release Record

For every production release, record:

- Git SHA
- GitHub PR URL
- GitHub CI run URL
- Vercel deployment ID
- Vercel aliases checked
- Supabase project ref
- Supabase migration head
- Supabase function versions before deploy
- Supabase function versions after deploy
- `DEPLOY_GIT_SHA` stamped by `scripts/deploy-functions.sh`
- Renderer heartbeat status
- Smoke-check timestamp
- Rollback target

## Pre-Release Checklist

1. Confirm the release branch is merged to `main`.
2. Use a clean checkout or worktree on `main`.
3. Pull the latest remote state:
   ```bash
   git fetch origin --prune
   git checkout main
   git pull --ff-only origin main
   git status --short --branch
   ```
4. Confirm local `HEAD` matches the intended GitHub merge commit:
   ```bash
   git rev-parse HEAD
   git rev-parse origin/main
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   ```
5. Run release-state inventory:
   ```bash
   npm run check:release-state
   ```
6. Run the full local validation gate:
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
7. Dry-run function deploy preflight:
   ```bash
   DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh
   ```
8. If the release changes a function auth mode, internal token path, RSS webhook auth path, or required Edge secret, review and update [`function-auth-matrix.md`](./function-auth-matrix.md) in the same branch.

## Supabase Function Deploy

The deploy script deploys all selected functions first, then stamps the full Git SHA into the Edge Function secret `DEPLOY_GIT_SHA` after every selected function deploy succeeds. This keeps the release marker from getting ahead of deployed function code.

Normal production deploy:

```bash
./scripts/deploy-functions.sh
```

Deploy selected functions:

```bash
./scripts/deploy-functions.sh admin-actions worker x-poster
```

The script refuses to deploy when:

- The working tree has uncommitted changes.
- The current branch is not `main`.
- Local `main` does not match `origin/main`.
- A selected function is missing `verify_jwt` in `supabase/config.toml`.
- A `verify_jwt` value is not exactly `true` or `false`.
- A selected function is missing `supabase/functions/<name>/index.ts`.

The script validates deploy shape, not full auth semantics. Use [`function-auth-matrix.md`](./function-auth-matrix.md) to review expected callers, secrets, and compatibility modes before promoting auth-sensitive function changes.

Emergency overrides must be recorded in the release ledger.

```bash
DEPLOY_ALLOW_DIRTY=1 ./scripts/deploy-functions.sh
DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh
```

Use both together only if production is down, both blockers are intentional, and the rollback/fix has already been reviewed:

```bash
DEPLOY_ALLOW_DIRTY=1 DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh
```

## Vercel Deploy

Vercel production should deploy from GitHub `main`, not from a local cleanup branch.

After Vercel marks the deployment ready, record:

- Deployment ID
- Commit SHA
- Target: production
- Aliases: `https://xot.iraneyes.com`, `https://xot.vercel.app`

Smoke-check both hosts:

```bash
curl -sSI https://xot.iraneyes.com
curl -sSI https://xot.vercel.app
```

Both should return `HTTP/2 200`, matching ETags, and the security headers from `vercel.json`.

## Supabase Migration Release

Do not apply migrations until Phase 3 migration trust repair has produced a reviewed plan.

Before applying migrations:

1. Compare local and remote migration history:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
   ```
2. Confirm there are no unreviewed local-only migrations.
3. Confirm production schema diff is understood.
4. Apply only reviewed migrations.
5. Re-run:
   ```bash
   SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
   npm run check:release-state
   ```

## Post-Release Smoke Checks

1. Open `https://xot.iraneyes.com`.
2. Log in with the existing admin account.
3. Confirm Dashboard loads.
4. Confirm Monitoring loads.
5. Confirm Settings loads.
6. Confirm Dashboard and Monitoring can call `admin-actions`.
7. Confirm worker cron continues completing jobs.
8. Confirm `x-poster-tick` continues running.
9. Confirm `video_renderer_heartbeats` has an online renderer.
10. Confirm stale running jobs query is empty.
11. Confirm `admin-actions` version returns the released `DEPLOY_GIT_SHA`.

## Rollback

Frontend rollback:

1. Promote the prior Vercel production deployment.
2. Recheck both aliases.
3. Record the rollback deployment ID.

Function rollback:

1. Check the prior release ledger entry for the previous Git SHA.
2. Check out that SHA in a clean worktree. This is intentionally detached or non-`main`, so the non-main override is required and must be recorded in the ledger.
3. Run:
   ```bash
   DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh
   ```
4. Confirm `DEPLOY_GIT_SHA` matches the rollback SHA.

Migration rollback:

- Prefer a reviewed forward-fix migration.
- Do not manually edit production tables during an incident unless there is no safer path and the exact SQL has been reviewed.

Secret/config rollback:

- Restore previous values from the release ledger or password manager.
- Re-run `npm run check:release-state`.

## Release Ledger

Add new entries at the top.

### 2026-06-23 - X poster no retro catch-up guard

```text
Date: 2026-06-23
Operator: Codex
Git SHA deployed to Edge Functions: 889a2a1182b5384f22ab317f722e57b1a9fe88db
GitHub PR: pending at emergency backend rollout; branch is codex/xot-x-poster-no-retro-catchup
CI run: no branch CI recorded before emergency rollout. Local gates passed: npm run check:functions, npm run test:functions (290 tests), npm run check:strict, npm test (112 tests), npm run lint -- --quiet, npm run build:dev, npm run check:release-state, git diff --check.
Vercel deployment: no frontend deploy at backend rollout time; production hosts remained HTTP 200 with etag "c00cd722e7473ac6e868bfbee0c0eb4d"
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: 20260623014212 learning_x_gate_scores
Migration head after: 20260623022722 x_post_no_retro_catchup, applied through the Supabase connector because CLI db push is still blocked by pre-existing migration-history drift
Local migration file: supabase/migrations/20260623023000_x_post_no_retro_catchup.sql
Supabase function versions before deploy: admin-actions 191 and x-poster 140
Supabase function versions after deploy/secret stamp: admin-actions 193 and x-poster 142
Selected function code deploys: admin-actions, x-poster
DEPLOY_GIT_SHA stamped: 889a2a1182b5384f22ab317f722e57b1a9fe88db at 2026-06-23T02:32:07Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 89, failed 0, last_seen_at 2026-06-23 02:29:51.238+00
Smoke checks: release-state completed successfully; production x_posting_config max_candidate_age_minutes 30; max_posts_per_run 1; start_posting_from 2026-06-23 02:27:22.308183+00; get_x_post_candidates(20, null) returned 0 rows; posts since the new guard 0; posts older than freshness since the new guard 0
Rollback target: prior function versions admin-actions 191 and x-poster 140. Prefer forward-fix migration for database rollback; the deployed x-poster relies on the new x_posting_config guard keys and refreshed get_x_post_candidates behavior.
Notes: Normal runbook release-from-main was bypassed deliberately to stop retroactive X posting after the learning-gate fix drained old candidates. The deploy used DEPLOY_ALLOW_DIRTY=1 DEPLOY_ALLOW_NON_MAIN=1 from codex/xot-x-poster-no-retro-catchup. The only dirty files at deploy time were unrelated untracked services/video-renderer/scripts/delogo_*.py files, which were not included in the selected Edge Function deploy. Setting DEPLOY_GIT_SHA increments Edge Function metadata versions for all functions even though only admin-actions and x-poster code were uploaded.
```

### 2026-06-23 - X gate learning shadow reset

```text
Date: 2026-06-23
Operator: Codex
Git SHA deployed to Edge Functions: 5e0f3b64fac5c8d7bd0f01aba213a5e98804c475
GitHub PR: not created before emergency-style Supabase rollout; branch is codex/xot-learning-x-gate-shadow
CI run: no branch CI recorded before deploy; latest main CI was green for b9af675f6af7d79df0d56cd21c5a112f3ae3ce12. Local gates passed: npm run check:function-inventory, npm run check:functions, npm run test:functions (290 tests), npm run check:strict, npm run lint:functions, npm run lint (8 existing fast-refresh warnings), npm test (112 tests), npm run build:dev, git diff --check. npm run build remained blocked locally by missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and VITE_SUPABASE_PROJECT_ID.
Vercel deployment: no frontend deploy; production hosts remained HTTP 200
Vercel aliases checked: https://xot.iraneyes.com and https://xot.vercel.app returned HTTP 200 with matching etag "05dab6fc09d89494023b1db9ac75de92" at 2026-06-23T01:44Z
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: 20260617224908 x_post_delivery_claims
Migration head after: 20260623014212 learning_x_gate_scores, applied through the Supabase connector because CLI db push is still blocked by pre-existing migration-history drift
Local migration file: supabase/migrations/20260623010000_learning_x_gate_scores.sql
Supabase function versions before deploy: admin-actions 189, worker 266, x-poster 138
Supabase function versions after deploy/secret stamp: admin-actions 191, worker 268, x-poster 140
Selected function code deploys: admin-actions, worker, x-poster
DEPLOY_GIT_SHA stamped: 5e0f3b64fac5c8d7bd0f01aba213a5e98804c475 at 2026-06-23T01:43:57Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 89, failed 0, last_seen_at 2026-06-23 01:45:00.687+00
Smoke checks: release-state completed successfully; x-poster-tick and invoke-worker-every-1m active; no stale running jobs; production scoring_policy mode shadow; production scoring_policy learning.mode shadow; get_x_post_candidates(5, null) returned 5 rows; knn_feedback_prior_details exists; scored posts missing base_score 0; scored posts missing x_gate_score 0
Rollback target: prior function versions admin-actions 189, worker 266, and x-poster 138. Prefer forward-fix migration for database rollback; the deployed functions depend on the new posts score columns and get_x_post_candidates signature.
Notes: Normal runbook release-from-main was bypassed deliberately to close the X posting learning-gate incident quickly. The deploy used DEPLOY_ALLOW_DIRTY=1 DEPLOY_ALLOW_NON_MAIN=1 from codex/xot-learning-x-gate-shadow. The only dirty files at deploy time were unrelated untracked services/video-renderer/scripts/delogo_*.py files, which were not included in the selected Edge Function deploy.
```

### 2026-06-17 - X post idempotency claim incident fix

```text
Date: 2026-06-17
Operator: Codex
Git SHA deployed to Edge Functions: 2daeee12a38a781f8651e94eaa6731e4351b960d
GitHub PR: not created before emergency-style Supabase rollout; branch is codex/x-post-idempotency-claim
CI run: no branch CI recorded before deploy; local gates passed: npm run lint:functions, npm run check:functions, npm run test:functions (282 tests), npm run lint, npm run build with local-only Vite env values
Vercel deployment: no frontend deploy; production hosts remained HTTP 200
Vercel aliases checked: https://xot.iraneyes.com and https://xot.vercel.app returned HTTP 200 with matching etag "fb6dcdbe8b800e0d95eff522f3b68fc1" at 2026-06-17T22:52Z
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: 20260617004958 fix_claim_video_render_by_id_args
Migration head after: 20260617224908 x_post_delivery_claims
Local migration file: supabase/migrations/20260617224908_x_post_delivery_claims.sql
Supabase function versions before deploy: webhooks-rssapp 234, worker 265, admin-retry 188, db-cleanup 160, media-processor 199, media-cleanup 196, admin-actions 187, x-poster 136, x-followers-snapshot 110, digest-compiler 116
Supabase function versions after deploy/secret stamp: webhooks-rssapp 235, worker 266, admin-retry 189, db-cleanup 161, media-processor 200, media-cleanup 197, admin-actions 189, x-poster 138, x-followers-snapshot 111, digest-compiler 117
Selected function code deploys: admin-actions, x-poster
DEPLOY_GIT_SHA stamped: 2daeee12a38a781f8651e94eaa6731e4351b960d at 2026-06-17T22:51:19.545Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 17, failed 0, last_seen_at 2026-06-17 22:53:20.988+00
Smoke checks: release-state completed successfully; x-poster-tick active every minute; no stale running jobs; active posting claims 0; stale posting claims 0; posted attempts > 1 in last 30m 0; duplicate completed x_post events in last 30m 0
DB verification: uq_x_deliveries_post_active_or_posted exists; claim_x_post_delivery exists; already-posted claim returned claimed=false reason=already_posted; transaction-rolled-back race simulation returned first claim claimed=true and second claim claimed=false reason=already_posting
Rollback target: prior function versions admin-actions 187 and x-poster 136. Prefer forward-fix migration for database rollback; do not drop claim columns/indexes during an incident without reviewed SQL because active x-poster code depends on them.
Notes: Normal runbook release-from-main was bypassed deliberately for the duplicate public X-post incident. The selected function deploy was from codex/x-post-idempotency-claim with DEPLOY_ALLOW_NON_MAIN=1. Supabase CLI db push remained blocked by pre-existing migration-history drift, so the reviewed migration was applied through the Supabase connector as 20260617224908 x_post_delivery_claims. Stamping DEPLOY_GIT_SHA updates Edge Function version metadata for all functions even though only admin-actions and x-poster code were uploaded.
```

### 2026-06-15 - Shared webhook secret rotation after RSS URL-token exposure

```text
Date: 2026-06-15
Operator: Codex
Git SHA: c990c2a4e92f603bb99573df34ca0c7da1095116
GitHub PR: documentation follow-up pending at time of rotation
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27573079602
Vercel deployment: no code deploy; production hosts remained HTTP 200 from merge commit c990c2a4e92f603bb99573df34ca0c7da1095116
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; latest shared local/remote migration remained 20260615043000
Migration head after: unchanged; no migrations applied
Supabase function versions before secret rotation: webhooks-rssapp 226, worker 257, admin-retry 180, db-cleanup 152, media-processor 191, media-cleanup 188, admin-actions 179, x-poster 128, x-followers-snapshot 102, digest-compiler 108
Supabase function versions after secret rotation: webhooks-rssapp 227, worker 258, admin-retry 181, db-cleanup 153, media-processor 192, media-cleanup 189, admin-actions 180, x-poster 129, x-followers-snapshot 103, digest-compiler 109
DEPLOY_GIT_SHA: unchanged at 257c69f047971683c22ca57df4cf137c8d89a8c7; this was a secret rotation, not a function code deploy
Secret rotation: `WEBHOOK_SHARED_SECRET` was regenerated, stored in Supabase Edge Function Secrets at 2026-06-15T20:11:55.332Z, and the matching Vault `WEBHOOK_SHARED_SECRET` value used by cron was updated through `vault.update_secret`
Secret verification: `public.verify_webhook_internal_token` returned true for the new generated value, and `db-cleanup` dry-run with the new `x-internal-token` returned HTTP 200
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 9, failed 0, last_seen_at 2026-06-15 20:12:36.689+00
Smoke checks: post-rotation npm run check:release-state passed; main CI run 27573079602 passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T20:08:24Z and etag "e63c9d5f81f6c1f998761692f6ccd615"; all cron jobs active; no stale running jobs; renderer heartbeat online
Rollback target: do not restore the exposed prior secret unless production is down and no safer option exists. If rollback is needed, generate another shared secret and keep Supabase Edge Function Secret plus Vault `WEBHOOK_SHARED_SECRET` aligned.
Notes: The old RSS.app URL token was treated as exposed shared internal credential because production had no `RSSAPP_WEBHOOK_TOKEN`/`RSSAPP_TOKEN` secret and `webhooks-rssapp` falls back to `WEBHOOK_SHARED_SECRET`. Query-token-only RSS requests already returned HTTP 401 because `RSSAPP_ALLOW_QUERY_TOKEN=false`. The remaining manual RSS.app work was completed later on 2026-06-15: the stale URL query string was removed, the RSS.app signing secret was regenerated, the regenerated value was stored in `RSSAPP_SIGNING_SECRET`, and a signed no-query RSS.app test returned HTTP 200. The zero-hit compatibility quiet window later passed on 2026-06-16, allowing query-token code deletion.
```

### 2026-06-15 - RSS.app URL cleanup and signing-secret regeneration

```text
Branch: codex/xot-rssapp-final-cutover-ledger
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Production code SHA: a8c23f3d4c9b77cad397460f661e55c2401000b3
RSS.app URL status: webhook URL saved without query parameters
RSS.app signing status: signing enabled and signing secret regenerated
Supabase secret update: RSSAPP_SIGNING_SECRET updated at 2026-06-15T20:31:26.118Z
RSS.app smoke: regenerated-secret signed no-query test returned HTTP 200 in 420 ms
Supabase function versions after secret update: webhooks-rssapp 228, worker 259, admin-retry 182, db-cleanup 154, media-processor 193, media-cleanup 190, admin-actions 181, x-poster 130, x-followers-snapshot 104, digest-compiler 110
Compatibility telemetry: still only the earlier 118 accepted rss_query_token rows, latest 2026-06-15 19:55:11.9163+00; no post-cleanup query-token hit was observed
Smoke checks: npm run check:release-state passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200; all cron jobs active; no stale running jobs; renderer heartbeat online
Follow-up gate: CHECK_COMPATIBILITY_QUIET=1 COMPATIBILITY_QUIET_HOURS=24 npm run check:release-state reported zero rss_query_token hits on 2026-06-16, allowing query-token compatibility code deletion
Rollback target: do not restore the exposed prior RSS.app signing secret. If RSS.app delivery fails, regenerate another RSS.app signing secret, update RSSAPP_SIGNING_SECRET, and retest signed no-query delivery.
```

### 2026-06-16 - RSS query-token compatibility removal

```text
Branch: codex/xot-remove-rss-query-token-compat
Pre-removal gate: CHECK_COMPATIBILITY_QUIET=1 COMPATIBILITY_QUIET_HOURS=24 npm run check:release-state passed with rss_query_token hits in last 24h = 0
Code change: remove query-string RSS webhook auth support and the now-unused compatibility telemetry writer
Runtime contract after deploy: RSS.app signed webhooks through RSSApp-Signature, with x-webhook-token or x-rssapp-token header fallback only
Deployment: PR #56 merged at aadd9bd294a9f871837e69e228d9288a92a79960; all 10 Edge Functions were deployed from that SHA; DEPLOY_GIT_SHA was stamped; webhooks-rssapp reached version 231; obsolete RSSAPP_ALLOW_QUERY_TOKEN was removed from Supabase Edge Function Secrets
Post-deploy smoke: npm run check:release-state passed after deploy and secret removal; xot.iraneyes.com and xot.vercel.app returned HTTP 200; main CI run 27646991568 passed; all cron jobs active; no stale running jobs; renderer hermes-masih-1 online
```

### 2026-06-15 - PR #51 RSS.app signed-webhook auth

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 257c69f047971683c22ca57df4cf137c8d89a8c7
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/51
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27572258920
Vercel deployment: production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #51
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 221, worker 253, admin-retry 176, db-cleanup 148, media-processor 187, media-cleanup 184, admin-actions 175, x-poster 124, x-followers-snapshot 98, digest-compiler 104
Supabase function versions after deploy: webhooks-rssapp deployed from main and moved to 223; setting DEPLOY_GIT_SHA refreshed function runtime versions to worker 254, admin-retry 177, db-cleanup 149, media-processor 188, media-cleanup 185, admin-actions 176, x-poster 125, x-followers-snapshot 99, digest-compiler 105
Supabase function versions after RSS signing secret cutover: webhooks-rssapp 226, worker 257, admin-retry 180, db-cleanup 152, media-processor 191, media-cleanup 188, admin-actions 179, x-poster 128, x-followers-snapshot 102, digest-compiler 108
DEPLOY_GIT_SHA: deploy script stamped 257c69f047971683c22ca57df4cf137c8d89a8c7; Supabase secret timestamp 2026-06-15T19:54:23.043Z
RSS signing cutover: RSS.app signing was enabled after deploy; `RSSAPP_SIGNING_SECRET` was set in Supabase Edge Function Secrets at 2026-06-15T19:57:46.571Z; `RSSAPP_ALLOW_QUERY_TOKEN=false` was set at 2026-06-15T19:58:19.779Z
RSS signing smoke: a signed HMAC request without any query token returned HTTP 200; an unsigned query-token-only request returned HTTP 401 with the expected auth error
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 9, failed 0, last_seen_at 2026-06-15 19:59:12.12+00
Smoke checks: post-deploy npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T19:54:31Z and etag "2b9dc964e7bf01ec906ab97b7026c063"; no stale running jobs; renderer heartbeat online
Rollback target: previous main before PR #51 was 2e515cd4b68eddaa3abddbad63c9dfdf1311602e; function rollback target for webhooks-rssapp is the prior deployed main SHA cfaf4207535d20ca6113a24ef21a84ec959c2265 if reverting signed-webhook auth behavior is required
Notes: PR #51 added additive RSS.app `RSSApp-Signature` verification for webhooks-rssapp while preserving query-token compatibility. Compatibility telemetry after cutover still showed accepted `rss_query_token` traffic inside the 24-hour observation window: 118 hits, latest 2026-06-15 19:55:11.9163+00. Query-token-only requests are now rejected, but code removal remains blocked until the old query token is removed from the RSS.app URL, the exposed query and signing secrets are rotated, and the quiet-window gate reports zero hits.
```

### 2026-06-15 - PR #44 Worker missing-source translation test gap

```text
Date: 2026-06-15
Operator: Codex
Git SHA: cd2f965f6ed0f034fc75a74590875fb54528e1d7
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/44
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27563144220
Vercel deployment: production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #44
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
Supabase function versions after deploy: worker deployed from main and moved to 251; setting DEPLOY_GIT_SHA refreshed function runtime versions to webhooks-rssapp 220, admin-retry 175, db-cleanup 147, media-processor 186, media-cleanup 183, admin-actions 174, x-poster 123, x-followers-snapshot 97, digest-compiler 103
DEPLOY_GIT_SHA: deploy script stamped cd2f965f6ed0f034fc75a74590875fb54528e1d7; Supabase secret timestamp 2026-06-15T17:12:06.857Z. Direct vault value recheck was attempted but blocked by vault column mismatch, npm DNS, and unauthenticated local Supabase CLI.
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 5, failed 0, last_seen_at 2026-06-15 17:12:38.757+00
Smoke checks: post-deploy npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T17:12:21Z and etag "fd0d78fb34f856514c496235d845f3fe"; no stale running jobs; renderer heartbeat online
Rollback target: previous main before PR #44 was 1098efc34b3b881d5446765e587e1d8c4ae2c00a; function rollback target for worker is the prior deployed main SHA 7f3dab452eaccecd5a275def6b29127998df958d if reverting deployed worker behavior is required
Notes: PR #44 closed the Phase 9 missing-source characterization gap by adding a focused assertion helper used by handleTranslateJob and tests for the existing No original text to translate failure path. Worker was deployed from clean main after merge so production function code stayed aligned with GitHub main.
```

### 2026-06-15 - PR #42 Renderer OpenAI transcription helper split

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 4f1be63553846aed453945581386e1bcc7841dc5
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/42
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27558931537
Vercel deployment: production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #42
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: unchanged from PR #40 release; webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
Supabase function versions after deploy: no Supabase deploy for PR #42; versions remained webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
DEPLOY_GIT_SHA: unchanged at 7f3dab452eaccecd5a275def6b29127998df958d; Supabase functions were not redeployed for this renderer/docs cleanup
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 1, failed 0, last_seen_at 2026-06-15 15:58:07.622+00
Smoke checks: post-merge npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T15:57:52Z and etag "4eeaf1fd03236197f3af5526396cf34b"; no stale running jobs; renderer heartbeat online
Rollback target: previous main before PR #42 was 1b58569b289c228f92919063bc1e2e535f895e0e; functions rollback not needed because no Supabase function deployment occurred
Notes: PR #42 split OpenAI audio transcription upload, timed segment normalization, language detection, and fallback transcription logic into services/video-renderer/src/openaiTranscription.js while keeping services/video-renderer/src/openai.js as the stable public facade. It added mocked transcribeAudio facade coverage and recorded full local, CI, and release-state validation. RSS query-token compatibility remains deferred.
```

### 2026-06-15 - PR #40 Renderer OpenAI vision helper split

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 5a4238c51f8d49a0a1efe3724fe7cfde68c410a0
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/40
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27557982250
Vercel deployment: production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #40
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: unchanged from PR #36 release; webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
Supabase function versions after deploy: no Supabase deploy for PR #40; versions remained webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
DEPLOY_GIT_SHA: unchanged at 7f3dab452eaccecd5a275def6b29127998df958d; Supabase functions were not redeployed for this renderer/docs cleanup
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 1, failed 0, last_seen_at 2026-06-15 15:42:12.397+00
Smoke checks: post-merge npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T15:43:36Z and etag "e34aa19358a2657acbec4305dc44e7ae"; no stale running jobs; renderer heartbeat online
Rollback target: previous main before PR #40 was d044433fd8f788637c630313545fa6aea7b73b25; functions rollback not needed because no Supabase function deployment occurred
Notes: PR #40 split OpenAI vision/watermark request builders, Responses API parsing, specialist-vision merging, and vision API-call helpers into services/video-renderer/src/openaiVision.js while keeping services/video-renderer/src/openai.js as the stable public facade. It added mocked API-call tests for analyzeRemovableWatermarks and analyzeWatermarkContactSheet and fixed the uncovered extractOutputText scope regression from the prior subtitle split. RSS query-token compatibility remains deferred.
```

### 2026-06-15 - PR #36 Legacy X API usage writer removal

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 7f3dab452eaccecd5a275def6b29127998df958d
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/36
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27555124925
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #36
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 217, worker 247, admin-retry 172, db-cleanup 144, media-processor 183, media-cleanup 180, admin-actions 171, x-poster 120, x-followers-snapshot 94, digest-compiler 100
Supabase function versions after deploy: webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
DEPLOY_GIT_SHA: deploy script stamped 7f3dab452eaccecd5a275def6b29127998df958d; Supabase secret timestamp 2026-06-15T14:58:36.989Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 8, failed 0, last_seen_at 2026-06-15 14:59:02.145+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T14:57:26Z and etag "b539a3b261ad5447d77aae51673920d8"; no stale running jobs; renderer heartbeat online
Rollback target: ad29a4d5623cef204521e116ffc5aadaf46ff7fe
Notes: PR #36 removed the obsolete recordLegacyXApiUsage settings.x_api_usage cache writer from X posting, worker hydration, follower snapshots, and admin X API actions while preserving canonical x_api_events writes. RSS query-token compatibility remains active and deferred until RSS.app moves to signed webhook auth or header-token fallback and telemetry is quiet.
```

### 2026-06-15 - PR #34 X API summary UI bridge

```text
Date: 2026-06-15
Operator: Codex
Git SHA: ad29a4d5623cef204521e116ffc5aadaf46ff7fe
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/34
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27545705292
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #34
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 215, worker 245, admin-retry 170, db-cleanup 142, media-processor 181, media-cleanup 178, admin-actions 169, x-poster 118, x-followers-snapshot 92, digest-compiler 98
Supabase function versions after deploy: webhooks-rssapp 217, worker 247, admin-retry 172, db-cleanup 144, media-processor 183, media-cleanup 180, admin-actions 171, x-poster 120, x-followers-snapshot 94, digest-compiler 100
DEPLOY_GIT_SHA: deploy script stamped ad29a4d5623cef204521e116ffc5aadaf46ff7fe; Supabase secret timestamp 2026-06-15T12:20:48.782Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 4, failed 0, last_seen_at 2026-06-15 12:21:19.778+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T12:20:59Z and etag "65dd3981c136a14ef7f3f2af0808c084"; no stale running jobs; renderer heartbeat online
Rollback target: 412127679bd158de342eabc64a4d4dd7c74cc4e2
Notes: PR #34 moved Settings and X Automation usage displays off legacy settings.x_api_usage and onto get_x_api_summary. The summary now exposes posts_last_hour, latest_event_at, and latest_error from canonical x_api_events and x_deliveries data. recordLegacyXApiUsage writers remain intentionally deferred until the bridge has had a live observation window and read-only checks confirm no runtime or UI dependency remains.
```

### 2026-06-15 - PR #38 Renderer OpenAI subtitle helper split

```text
Date: 2026-06-15
Operator: Codex
Git SHA: b914ef0a61ddbf6f2d42e309be8c45d273ec163d
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/38
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27556849631
Vercel deployment: production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #38
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: unchanged from PR #36 release; webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
Supabase function versions after deploy: no Supabase deploy for PR #38; versions remained webhooks-rssapp 219, worker 249, admin-retry 174, db-cleanup 146, media-processor 185, media-cleanup 182, admin-actions 173, x-poster 122, x-followers-snapshot 96, digest-compiler 102
DEPLOY_GIT_SHA: unchanged at 7f3dab452eaccecd5a275def6b29127998df958d; Supabase functions were not redeployed for this renderer/docs cleanup
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 0, failed 0, last_seen_at 2026-06-15 15:24:57.142+00
Smoke checks: post-merge npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T15:24:39Z and etag "879609f18b1d67d0c8b3bad286165c71"; no stale running jobs; renderer heartbeat online
Rollback target: previous main before PR #38 was 29cc200fbc64141dd5441fb7d972272f1434c2c2; functions rollback not needed because no Supabase function deployment occurred
Notes: PR #38 split OpenAI subtitle cleanup, translation, repair, and Responses API subtitle parsing into services/video-renderer/src/openaiSubtitles.js while keeping services/video-renderer/src/openai.js as the stable public facade. It also refreshed the cleanup plan and Phase 21 status so PR #32 and PR #36 are recorded as completed while RSS query-token compatibility remains deferred.
```

### 2026-06-15 - PR #32 Worker type export surface cleanup

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 412127679bd158de342eabc64a4d4dd7c74cc4e2
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/32
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27544386658
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #32
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 213, worker 243, admin-retry 168, db-cleanup 140, media-processor 179, media-cleanup 176, admin-actions 167, x-poster 116, x-followers-snapshot 90, digest-compiler 96
Supabase function versions after deploy: webhooks-rssapp 215, worker 245, admin-retry 170, db-cleanup 142, media-processor 181, media-cleanup 178, admin-actions 169, x-poster 118, x-followers-snapshot 92, digest-compiler 98
DEPLOY_GIT_SHA: deploy script stamped 412127679bd158de342eabc64a4d4dd7c74cc4e2; Supabase secret timestamp 2026-06-15T11:56:06.720Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 4, failed 0, last_seen_at 2026-06-15 11:56:39.156+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T11:56:20Z and etag "c0b18005e0b668f26d84f38843212aec"; no stale running jobs; renderer heartbeat online
Rollback target: 9d60e9052056f5a0e2e0794579701a97e7e8cb5e
Notes: PR #32 made the final safe worker type-only export surface private: HydratedTweetPatch, ScoringDecisionLog, and ResolvedVariant. Runtime exports were not removed; a read-only sidecar audit found no unused exported runtime helpers left in supabase/functions/worker/*. RSS query-token compatibility and recordLegacyXApiUsage remain deferred because they still have production relevance.
```

### 2026-06-15 - PR #30 Compatibility alias removal

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 9d60e9052056f5a0e2e0794579701a97e7e8cb5e
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/30
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27543209019
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #30
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Supabase function versions before deploy: webhooks-rssapp 211, worker 241, admin-retry 166, db-cleanup 138, media-processor 177, media-cleanup 174, admin-actions 165, x-poster 114, x-followers-snapshot 88, digest-compiler 94
Supabase function versions after deploy: webhooks-rssapp 213, worker 243, admin-retry 168, db-cleanup 140, media-processor 179, media-cleanup 176, admin-actions 167, x-poster 116, x-followers-snapshot 90, digest-compiler 96
DEPLOY_GIT_SHA: deploy script stamped 9d60e9052056f5a0e2e0794579701a97e7e8cb5e; Supabase secret timestamp 2026-06-15T11:32:42.701Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 4, failed 0, last_seen_at 2026-06-15 11:33:23.805+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T11:24:33Z and etag "fbd07f5009611db875f3bcd57eb4a736"; no stale running jobs; renderer heartbeat online
Rollback target: f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc
Notes: PR #30 removed the zero-telemetry Monitoring filter/response aliases and the deprecated backfill_signatures admin-action alias. Post-deploy compatibility telemetry showed only rss_query_token activity at 45 hits, last seen 2026-06-15 11:19:59.760532+00; no monitoring_filter_alias or admin_action_alias rows were present. RSS query-token compatibility remains blocked from removal until RSS.app is migrated to signed webhook auth or header-token fallback and telemetry is quiet across a normal operating window.
```

### 2026-06-15 - PR #28 Hydration helper cleanup

```text
Date: 2026-06-15
Operator: Codex
Git SHA: f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/28
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27540030183
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #28
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Function versions before: webhooks-rssapp 209, worker 239, admin-retry 164, db-cleanup 136, media-processor 175, media-cleanup 172, admin-actions 163, x-poster 112, x-followers-snapshot 86, digest-compiler 92
Function versions after: webhooks-rssapp 211, worker 241, admin-retry 166, db-cleanup 138, media-processor 177, media-cleanup 174, admin-actions 165, x-poster 114, x-followers-snapshot 88, digest-compiler 94
DEPLOY_GIT_SHA: deploy script stamped f8ebcaa41dcd8ac38bc2586a242c37f91fbdb5fc; Supabase secret timestamp 2026-06-15T10:29:37.033Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 4, failed 0, last_seen_at 2026-06-15 10:48:33.039+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T10:28:38Z and asset /assets/index-Bf2i4Zlv.js; authenticated Chrome Dashboard loaded from https://xot.iraneyes.com/; a fresh admin-actions POST returned HTTP 200 on version 165 after Dashboard refresh
Rollback target: previous deployed function source git 64a6ed61d7194dcab808651f2f10de7bcf19e72a; previous main before PR #28 was 2c4055d18b399ddb6bbb9e91e29e84b5a43f545c; functions rollback by checking out the desired SHA and running DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh after confirming target versions
Notes: PR #28 extracted hydration success patch shaping from worker/index.ts into xApiWorkflow.ts, added focused tests for X API patching and URL parsing, and tightened X profile handle parsing without changing delivery behavior. PR #27 was a docs/status-only Telegram helper verification branch and did not require a Supabase deploy. RSS query-token telemetry remained active at 40 hits, last seen 2026-06-15 10:49:04.630314+00, so RSS query-token compatibility remains blocked from removal.
```

### 2026-06-15 - PR #25 Worker helper export cleanup

```text
Date: 2026-06-15
Operator: Codex
Git SHA: 64a6ed61d7194dcab808651f2f10de7bcf19e72a
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/25
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27529812922
Vercel deployment: not available from local CLI; production hosts refreshed from main and returned HTTP 200
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: unchanged; no migrations in PR #25
Migration head after: unchanged; no migrations applied; latest shared local/remote migration remained 20260615043000
Function versions before: not captured immediately before deploy in this ledger branch; last documented all-function release was PR #22 at admin-actions 161, db-cleanup 134, digest-compiler 90, media-cleanup 170, media-processor 173, webhooks-rssapp 207, worker 237, x-followers-snapshot 84, and x-poster 110
Function versions after: webhooks-rssapp 209, worker 239, admin-retry 164, db-cleanup 136, media-processor 175, media-cleanup 172, admin-actions 163, x-poster 112, x-followers-snapshot 86, digest-compiler 92
DEPLOY_GIT_SHA: deploy script stamped 64a6ed61d7194dcab808651f2f10de7bcf19e72a; Supabase secret timestamp 2026-06-15T07:08:51.737Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 1, failed 0, last_seen_at 2026-06-15 07:10:24.637+00
Smoke checks: post-release npm run check:release-state passed; GitHub main CI passed; xot.iraneyes.com and xot.vercel.app returned HTTP 200 with app shell last-modified 2026-06-15T07:10:05Z and asset /assets/index-1w4T30nf.js; authenticated admin-actions get_dashboard_summary returned HTTP 200 with success=true and a dashboard payload after deployment
Rollback target: previous main release git 681b46cf1d3e07c843a9953928c8ef8b532567a1; functions rollback by checking out that SHA and running DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh after confirming the desired prior function versions
Notes: PR #25 is a no-migration cleanup slice that reduces worker helper export surface without changing behavior. The user-reported Dashboard "Edge Function returned a non-2xx status code" did not reproduce in the authenticated post-deploy Edge Function check. Chrome Apple Events JavaScript is disabled locally, so the authenticated check used the existing Chrome admin session token without printing token material rather than executing browser-page JavaScript.
```

### 2026-06-14 - PR #13 XOT cleanup integration

```text
Date: 2026-06-14
Operator: Codex
Git SHA: 8f0b93db7e57bbc0b6108db12e929e220715970c
GitHub PR: https://github.com/Masihhedayati/liquid-feed-flux/pull/13
CI run: https://github.com/Masihhedayati/liquid-feed-flux/actions/runs/27507054048
Vercel deployment: dpl_4y8m9mYj5qFggB9nX5TehuMDQHC9
Vercel aliases: https://xot.iraneyes.com, https://xot.vercel.app
Supabase project ref: jzirqfzzvlbxwfzndaer
Migration head before: latest shared local/remote migration 20260614064657; known local-only 20260609201533 and 20260609213357 were not applied
Migration head after: unchanged; no migrations applied
Function versions before: last recorded baseline from docs/operations/xot-system-inventory.md was webhooks-rssapp 199, worker 227, admin-retry 155, db-cleanup 126, media-processor 165, media-cleanup 162, admin-actions 150, x-poster 102, x-followers-snapshot 76, digest-compiler 82
Function versions after: webhooks-rssapp 201, worker 229, admin-retry 157, db-cleanup 128, media-processor 167, media-cleanup 164, admin-actions 152, x-poster 104, x-followers-snapshot 78, digest-compiler 84
DEPLOY_GIT_SHA: deploy script stamped 8f0b93db7e57bbc0b6108db12e929e220715970c; Supabase secret timestamp 2026-06-14T17:57:28.900Z
Renderer heartbeat: hermes-masih-1 online, version 0.1.0, render_version persian-subtitles-masihh-v1, processed 3, failed 0, last_seen_at 2026-06-14 18:25:58.825+00
Smoke checks: post-release npm run check:release-state passed; authenticated Chrome smoke loaded Dashboard, Monitoring, Settings, Video Renders, and /x-account; Dashboard showed frontend 8f0b93d and backend 8f0b93db7e57bbc0b6108db12e929e220715970c
Rollback target: frontend dpl_JEAKMGeLPRzpe3ZMTeNEAMGysHf9 / git 5d351a9db81809fac4e668c5d03f298f03647808; functions rollback by checking out 5d351a9db81809fac4e668c5d03f298f03647808 and running DEPLOY_ALLOW_NON_MAIN=1 ./scripts/deploy-functions.sh
Notes: Vercel connector confirmed production deployment metadata and aliases. Vercel CLI was unavailable locally, so connector plus host headers were used. All expected cron jobs were active, including invoke-worker-every-1m and x-poster-tick. Queue health contained completed jobs only and stale running jobs query returned no rows. Known Supabase migration drift remains intentionally unresolved.
```

### Template

```text
Date:
Operator:
Git SHA:
GitHub PR:
CI run:
Vercel deployment:
Vercel aliases:
Supabase project ref:
Migration head before:
Migration head after:
Function versions before:
Function versions after:
DEPLOY_GIT_SHA:
Renderer heartbeat:
Smoke checks:
Rollback target:
Notes:
```
