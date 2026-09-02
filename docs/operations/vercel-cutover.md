# Vercel Preview and Production Cutover Runbook

## E10 operating contract

This is the current environment boundary for E10. Older production cutover
steps remain below for the separately gated production release path.

- **Local lane:** disposable source editing and bounded lint, type, test, build,
  and migration validation. Local is not a persistent Supabase project,
  renderer, full-stack URL, data plane, or parity environment.
- **Preview lane:** one protected, persistent non-production system consisting
  of Vercel Preview, an isolated Supabase staging project, and an isolated
  staging renderer. This is the only complete non-production acceptance system.
- **Production lane:** separate and unchanged until Preview passes authenticated
  acceptance and the owner makes the deferred AIR-050 decision.

No staging system currently exists. Phase 2 only prepares guards, configuration,
and runbook material. Supabase staging and the renderer are provisioned in
Phases 3–4; the protected Preview deployment and hosted CI run in Phase 5; and
authenticated `admin` and `read_only` acceptance runs in Phase 6.

### Preview identity and controls

The designated Preview deployment must use explicit, non-production identity
values. Never substitute a production Supabase ref, URL, key, renderer ID, or
secret. Secrets belong only in the relevant hosted secret store and never in
this file, `.env.example`, a `VITE_` variable, a build artifact, or a browser
response.

| Surface | Required Preview value or rule |
| --- | --- |
| Application identity | `XOT_ENVIRONMENT=preview` |
| Browser Supabase URL | Isolated staging project URL, set only after Phase 3 provisioning |
| Browser Supabase project ID | Isolated staging project ref, set only after Phase 3 provisioning |
| Renderer identity | `RENDERER_ID=xot-staging-1`, with an isolated staging renderer URL |
| External posting | `ALLOW_EXTERNAL_POSTING=false`; hard-disabled before every external write |
| Runtime controls | `posting_mode=blocked`; dedupe and translation start paused and may be toggled only by `admin` |
| Roles | Exactly `admin` and `read_only`; `read_only` cannot mutate data, settings, jobs, users, or provider state |

The Preview posting block is not a dashboard toggle. Dedupe and translation
are separate admin-toggleable controls, both paused by default. Preview must
never point at the production Supabase ref `jzirqfzzvlbxwfzndaer`.

### Phase boundary

| Phase | Scope | State |
| --- | --- | --- |
| 2 | Prepare local guards, configuration, and operating instructions | Current implementation slice |
| 3 | Provision isolated Supabase staging | Not started |
| 4 | Provision isolated staging renderer | Not started |
| 5 | Deploy protected Vercel Preview and hosted CI | Not started |
| 6 | Run authenticated `admin`/`read_only` full-stack acceptance | Not started |

Phase 2 does not provision cloud resources, deploy, run hosted CI, or claim
authenticated acceptance.

The function wrapper is Preview-only and fails closed unless this complete
identity tuple is supplied and internally consistent:

```text
XOT_ENVIRONMENT=preview
SUPABASE_PROJECT_REF=<non-production-20-character-ref>
SUPABASE_URL=https://<same-ref>.supabase.co/
XOT_PREVIEW_BRANCH=<designated-non-production-branch>
VERCEL_DEPLOYMENT_TARGET=preview
XOT_PREVIEW_ORIGIN=https://<protected-preview-origin>/
```

During Phase 2, the wrapper may be exercised only as a dry run after the tuple
is set:

```bash
DEPLOY_FUNCTIONS_DRY_RUN=1 ./scripts/deploy-functions.sh
```

This prints a masked preflight and performs no CLI, secret, or function change.
Any real function deployment belongs to Phase 5 after the hosted identity and
staging provisioning gates pass.

Release-state inventory is also target- and mode-explicit. During Phase 2, use
only the non-network Preview render (the supported `dry-run` mode is equivalent):

```bash
XOT_ENVIRONMENT=preview \
SUPABASE_PROJECT_REF="${PREVIEW_SUPABASE_PROJECT_REF}" \
SUPABASE_URL="https://${PREVIEW_SUPABASE_PROJECT_REF}.supabase.co/" \
XOT_PREVIEW_BRANCH="${PREVIEW_BRANCH}" \
VERCEL_DEPLOYMENT_TARGET=preview \
XOT_PREVIEW_ORIGIN="${PREVIEW_ORIGIN}" \
./scripts/check-release-state.sh --target preview --mode render
```

Do not omit `--target` or `--mode`, and do not use an inferred provider or
production target. Production release-state mode is later and owner-controlled;
it requires its separate identity contract and acknowledgement. Release-state
rendering is not pre-build output validation; the post-build identity check runs
after Vite completes.

The production cutover path moves XOT frontend hosting from Lovable to Vercel.
It is separate from the E10 Preview system above and keeps the existing
production backend unchanged until its own release gate passes.

## Vercel Project

1. Import `Masihhedayati/liquid-feed-flux` into Vercel.
2. Use the Vite framework preset.
3. Use `npm ci` as the install command.
4. Use `npm run build` as the build command.
5. Use `dist` as the output directory.
6. Keep the committed `vercel.json`; it rewrites SPA routes to `index.html`.
7. Set Node.js to 20.x.

## Production Vercel Environment (separate release path)

Set these variables for the Production environment only:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://jzirqfzzvlbxwfzndaer.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `jzirqfzzvlbxwfzndaer` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Current Supabase anon/publishable key |

Do not commit `.env`. A production build fails when these values are missing or
left as placeholders.

## Production Supabase Updates

Current production frontend URL: `https://xot.vercel.app`.

1. Supabase Auth -> URL Configuration:
   - Set Site URL to `https://xot.vercel.app` or the final custom domain.
   - Add `https://xot.vercel.app/**` as an allowed redirect URL.
   - Configure only the approved production origin and production redirect URLs.
2. Supabase Edge Function Secrets:
   - Set `ALLOWED_CORS_ORIGIN` to `https://xot.vercel.app`.
   - If a custom domain replaces the Vercel URL, update this value again.
3. Keep existing Edge Function secrets, cron jobs, RSS.app webhook, Telegram, OpenAI, and X settings unchanged.

## Production Verification (historical cutover checklist)

Before closing Lovable:

1. Confirm Vercel loads `/`, `/auth`, `/monitoring`, `/settings`, `/x-account`, `/downloader`, `/threads`, and a not-found route.
2. Refresh directly on `/monitoring`; it must not 404.
3. Log in with the existing Supabase admin account.
4. Confirm Dashboard and Monitoring can invoke `admin-actions`.
5. Confirm the browser console has no startup config errors.
6. Confirm Dashboard and Monitoring page loads do not trigger X API calls.
7. Keep Lovable active until Vercel production passes these checks.

## Rollback

If Vercel fails after cutover, restore the previous frontend DNS or public URL
temporarily, then update Supabase Auth/CORS back to that origin while the Vercel
issue is corrected.
