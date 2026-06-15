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
