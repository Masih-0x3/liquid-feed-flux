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
