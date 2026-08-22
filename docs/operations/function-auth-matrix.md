# XOT Function Auth And Secret Matrix

Last updated: 2026-07-24

This matrix documents the current local function auth contract before any `verify_jwt` or secret behavior is changed. It is based on:

- `supabase/config.toml`
- `supabase/functions/*/index.ts`
- `supabase/functions/_shared/internalAuth.ts`
- `scripts/deploy-functions.sh`
- cron migration definitions that call Edge Functions through `net.http_post`
- the latest checked-in operations inventory for observed secret names

Live secret values are never recorded here. Secret-name presence can drift, so refresh it in Supabase Dashboard or with the release-state tooling before changing production secrets.

## Shared Auth Modes

| Mode | Used by | Accepted credentials | Notes |
| --- | --- | --- | --- |
| Supabase JWT plus admin role | `admin-actions`, `admin-retry` | Browser/user `Authorization: Bearer <jwt>` validated by Supabase Auth, then the zero-argument `public.current_user_is_admin()` RPC evaluates only `auth.uid()` | The caller-bound role RPC runs with the bearer JWT before either function constructs a service-role client. Public and `anon` execution of the RPC are revoked. |
| Internal Edge auth | `worker`, `db-cleanup`, `media-processor`, `media-cleanup`, `x-poster`, `x-followers-snapshot`, `digest-compiler` | `x-internal-token` matching the local Edge `WEBHOOK_SHARED_SECRET`, or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` | This is why these functions can use `verify_jwt=false` without becoming intentionally public. Auth is local and fail-closed before service-client creation; cron callers must keep the Vault and Edge secret values aligned and use `public._cron_internal_headers()`. |
| RSS webhook auth | `webhooks-rssapp` | `RSSApp-Signature` signed webhook, `x-webhook-token`, or `x-rssapp-token` | Signed RSS.app webhooks are live. Query-string tokens are no longer accepted. |

## Common Runtime Secrets

| Secret | Purpose | Required by |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase client URL | All Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access and internal Edge invocation | All service-role functions; also admin functions after user/admin validation |
| `SUPABASE_ANON_KEY` | Supabase Auth user validation | `admin-actions`, `admin-retry` |
| `WEBHOOK_SHARED_SECRET` | Internal cron/Edge token | Internal-auth functions and cron callers; never an RSS credential. The Edge secret and cron/Vault value must match because no service-role RPC fallback is permitted. |
| `RSSAPP_SIGNING_SECRET` or `RSSAPP_WEBHOOK_SECRET` | RSS.app signed-webhook HMAC secret | `webhooks-rssapp` |
| `RSSAPP_WEBHOOK_TOKEN` or `RSSAPP_TOKEN` | RSS-specific webhook token override | `webhooks-rssapp` |
| `OPENAI_API_KEY` | Translation, scoring, enrichment, dedupe, digest generation | `worker`, selected `admin-actions`, `digest-compiler` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram delivery and retry preview paths | `worker`, selected `admin-retry` paths |
| `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | X/Twitter OAuth 1.0a calls | `worker` hydration, `x-poster`, `x-followers-snapshot`, `digest-compiler` posting, selected `admin-actions` paths |
| `VIDEO_RENDERER_URL`, `VIDEO_RENDERER_TOKEN` | Optional direct renderer HTTP dispatch | `worker`, `x-poster` |
| `DEPLOY_GIT_SHA` | Deployed function release marker | `admin-actions` version reporting; stamped by `scripts/deploy-functions.sh` |
| `ALLOWED_CORS_ORIGIN` | CORS origin override | All browser-callable function responses |

## Function Matrix

`npm run check:admin-role-auth` is a review-pinned source contract for the two admin entrypoints, the caller-bound role-RPC migration, and the complete active migration inventory. Updating either entrypoint or adding, removing, renaming, or changing any active migration requires deliberate security review and a corresponding digest update; it is not a substitute for the staging role matrix. A release must also enforce an independent protected-CI or CODEOWNERS approval policy for verifier/digest updates: hashes changed in the same untrusted PR checkout are review evidence, not an integrity boundary. Finally, validate the deployed RPC definition and ACL from a trusted database connection before release.

| Function | `verify_jwt` | Trigger source and caller | In-code gate | Required secret contract | Accepted compatibility modes | Planned hardening |
| --- | --- | --- | --- | --- | --- | --- |
| `webhooks-rssapp` | `false` | External RSS.app webhook; background dispatch to `worker` with service-role bearer | `requireRssWebhookAuth` | Dedicated RSS credential only: `RSSAPP_SIGNING_SECRET` / `RSSAPP_WEBHOOK_SECRET` or `RSSAPP_WEBHOOK_TOKEN` / `RSSAPP_TOKEN`; `SUPABASE_SERVICE_ROLE_KEY` is used only for downstream internal dispatch | Signed `RSSApp-Signature` requests or dedicated header tokens; query params and `WEBHOOK_SHARED_SECRET`/Vault internal-token fallback are not RSS credentials | Keep signed RSS.app auth as the primary path. Keep `verify_jwt=false` only because RSS.app is not a Supabase JWT caller; deploy and validate the dedicated credential before retiring any legacy config. |
| `worker` | `false` | `pg_cron` worker schedule; DB immediate trigger paths; webhook dispatch; internal service-role invokes | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` matching the cron/Vault value; route-dependent `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TWITTER_*`, optional `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` | Service-role bearer from internal Edge invokes; `x-internal-token` from cron | Keep cron calls on `public._cron_internal_headers()`. Do not enable JWT until all non-user callers have an equivalent authenticated path. Track missing renderer secrets separately from worker auth. |
| `admin-retry` | `true` | Authenticated admin UI/manual retry paths; non-mutating `test_webhook` validation | Supabase JWT validation plus caller-bound `current_user_is_admin()` before service-client creation | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for Telegram retry/preview paths; a dedicated RSS token or signing secret for `test_webhook` | `test_webhook` signs the exact JSON body when signing-only is configured, otherwise uses the dedicated RSS header token | Keep `verify_jwt=true`; deploy the `current_user_is_admin` forward migration before or with this function because a missing or denied RPC fails closed. `test_webhook` must send only `validate_only` and never reuse the shared internal webhook secret. |
| `db-cleanup` | `false` | Daily cleanup cron and internal dry-run/manual calls | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` matching the cron/Vault value | Service-role bearer; `x-internal-token` | Keep `verify_jwt=false` for cron. Confirm active cron uses `public._cron_internal_headers()` and the Edge secret is present before rotating `WEBHOOK_SHARED_SECRET`. |
| `media-processor` | `false` | Internal worker handoff; `db-cleanup`; `media-cleanup`; manual internal diagnostics | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` or service-role bearer for direct calls | Service-role bearer from other Edge Functions | Keep direct public access blocked by internal auth. Treat this as an internal service, not a browser-callable endpoint. |
| `media-cleanup` | `false` | Scheduled media cleanup cron; internal dry-run/manual calls | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` matching the cron/Vault value | Service-role bearer; `x-internal-token` | Keep cron header contract documented; cleanup wrapper should continue invoking `media-processor` with service-role bearer. |
| `admin-actions` | `true` | Authenticated admin dashboard, Monitoring, Settings, and Dashboard control-plane actions | Supabase JWT validation plus caller-bound `current_user_is_admin()` before service-client creation | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEPLOY_GIT_SHA`; action-dependent `OPENAI_API_KEY`, `TWITTER_*`, `TELEGRAM_*` | None | Keep `verify_jwt=true`; deploy the `current_user_is_admin` forward migration before or with this function because a missing or denied RPC fails closed. Keep splitting action domains so privileged service-role work stays behind explicit admin authorization. |
| `x-poster` | `false` | `x-poster-tick` cron; internal admin/action invokes; targeted posting retries | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` matching the cron/Vault value; `TWITTER_*` for posting; optional `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` for direct render dispatch | Service-role bearer; `x-internal-token` | Keep posting disabled through `x_posting_config` when needed. Configure renderer secrets only if direct dispatch should be active; otherwise it intentionally falls back to poller-only render flow. |
| `x-followers-snapshot` | `false` | Daily follower snapshot cron and internal manual snapshots | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` matching the cron/Vault value; `TWITTER_*` | Service-role bearer; `x-internal-token` | Keep daily-cap and X API controls enabled. Confirm cron uses `public._cron_internal_headers()` and the Edge secret is present before token rotation. |
| `digest-compiler` | `false` | Internal/manual digest compilation; candidate for scheduled digest runs | `requireInternalAuth` before service client creation | `SUPABASE_SERVICE_ROLE_KEY`; local Edge `WEBHOOK_SHARED_SECRET` or service-role bearer; `OPENAI_API_KEY`; `TWITTER_*` only for non-dry-run posting | Service-role bearer; `x-internal-token` | Keep the local source as the deploy source of truth. Do not reintroduce anon-key authorization. Schedule only after digest settings and auth path are reviewed. |

## RSS.app Signing Cutover

Cutover status as of 2026-06-16: RSS.app signing is live, the configured webhook URL has no auth query string, the exposed URL-token/shared-secret path was rotated, the exposed RSS.app signing secret was regenerated, and the regenerated signed no-query test returned HTTP 200. The enforced 24-hour quiet-window gate later reported zero `rss_query_token` hits. PR #56 removed query-token compatibility code, deployed all 10 Edge Functions from `aadd9bd294a9f871837e69e228d9288a92a79960`, and removed the obsolete `RSSAPP_ALLOW_QUERY_TOKEN` Edge Function Secret.

Current operating contract:

1. Keep RSS.app webhook signing enabled. RSS.app sends `RSSApp-Signature: t=<unix seconds>,v1=<hex hmac>` where `v1` signs `${t}.${raw_body}` with HMAC-SHA256.
2. Store the current RSS.app signing secret in Supabase Edge Function Secrets as `RSSAPP_SIGNING_SECRET`.
3. Keep the RSS.app webhook URL free of `?token=...`, `?webhook_token=...`, and `?rssapp_token=...`.
4. After any signing-secret rotation, send an RSS.app webhook test and confirm `webhooks-rssapp` returns HTTP 200.
5. If signing is unavailable during an incident, use custom headers as the fallback: configure `x-rssapp-token` or `x-webhook-token`, then set the matching `RSSAPP_WEBHOOK_TOKEN`.

## Deploy Guardrails

`scripts/deploy-functions.sh` currently checks:

- selected functions exist in `supabase/config.toml`;
- every selected function has `verify_jwt` explicitly set to `true` or `false`;
- every selected function has `supabase/functions/<name>/index.ts`;
- the Phase 2 worktree is clean; no non-main bypass is supported (a dirty
  override is not used in Phase 2);
- the Phase 2 wrapper is Preview-only and requires the complete identity tuple
  (`XOT_ENVIRONMENT=preview`, non-production `SUPABASE_PROJECT_REF` and
  matching `SUPABASE_URL`, `XOT_PREVIEW_BRANCH`,
  `VERCEL_DEPLOYMENT_TARGET=preview`, and `XOT_PREVIEW_ORIGIN`);
- `DEPLOY_GIT_SHA` is stamped only after selected function deploys succeed.

Before changing any function auth mode:

1. Update this matrix in the same branch.
2. Confirm the caller path still works locally where possible.
3. Run the function inventory and Deno gates.
4. During Phase 2, run only `DEPLOY_FUNCTIONS_DRY_RUN=1` from the designated
   Preview branch. A real function deploy belongs to Phase 5 or later after
   hosted Preview identity and staging gates pass.
5. Run the explicit read-only Preview render:
   `./scripts/check-release-state.sh --target preview --mode render`.
   Production release-state checks are later and owner-controlled.
