# XOT Function Auth And Secret Matrix

Last updated: 2026-06-15

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
| Supabase JWT plus admin role | `admin-actions`, `admin-retry` | Browser/user `Authorization: Bearer <jwt>` validated by Supabase Auth, then `profiles.role = admin` | These functions also create service-role clients after the user is proven admin. |
| Internal Edge auth | `worker`, `db-cleanup`, `media-processor`, `media-cleanup`, `x-poster`, `x-followers-snapshot`, `digest-compiler` | `x-internal-token` matching `WEBHOOK_SHARED_SECRET`, `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, or `x-internal-token` accepted by `verify_webhook_internal_token` | This is why these functions can use `verify_jwt=false` without becoming intentionally public. Cron callers should use `public._cron_internal_headers()`. |
| RSS webhook auth | `webhooks-rssapp` | `RSSApp-Signature` signed webhook, `x-webhook-token`, `x-rssapp-token`, or temporary query-token compatibility | Signed RSS.app webhooks are live. Query tokens are accepted only while `RSSAPP_ALLOW_QUERY_TOKEN` is not set to a false-like value; production set it to `false` on 2026-06-15. |

## Common Runtime Secrets

| Secret | Purpose | Required by |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase client URL | All Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access and internal Edge invocation | All service-role functions; also admin functions after user/admin validation |
| `SUPABASE_ANON_KEY` | Supabase Auth user validation | `admin-actions`, `admin-retry` |
| `WEBHOOK_SHARED_SECRET` | Internal cron/Edge token and fallback RSS token | Internal-auth functions, cron callers, RSS fallback |
| `RSSAPP_SIGNING_SECRET` or `RSSAPP_WEBHOOK_SECRET` | RSS.app signed-webhook HMAC secret | `webhooks-rssapp` |
| `RSSAPP_WEBHOOK_TOKEN` or `RSSAPP_TOKEN` | RSS-specific webhook token override | `webhooks-rssapp` |
| `RSSAPP_ALLOW_QUERY_TOKEN` | Temporary RSS query-token compatibility flag | `webhooks-rssapp` |
| `OPENAI_API_KEY` | Translation, scoring, enrichment, dedupe, digest generation | `worker`, selected `admin-actions`, `digest-compiler` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram delivery and retry preview paths | `worker`, selected `admin-retry` paths |
| `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | X/Twitter OAuth 1.0a calls | `worker` hydration, `x-poster`, `x-followers-snapshot`, `digest-compiler` posting, selected `admin-actions` paths |
| `VIDEO_RENDERER_URL`, `VIDEO_RENDERER_TOKEN` | Optional direct renderer HTTP dispatch | `worker`, `x-poster` |
| `DEPLOY_GIT_SHA` | Deployed function release marker | `admin-actions` version reporting; stamped by `scripts/deploy-functions.sh` |
| `ALLOWED_CORS_ORIGIN` | CORS origin override | All browser-callable function responses |

## Function Matrix

| Function | `verify_jwt` | Trigger source and caller | In-code gate | Required secret contract | Accepted compatibility modes | Planned hardening |
| --- | --- | --- | --- | --- | --- | --- |
| `webhooks-rssapp` | `false` | External RSS.app webhook; background dispatch to `worker` with service-role bearer | `requireRssWebhookAuth` | `SUPABASE_SERVICE_ROLE_KEY`; preferred `RSSAPP_SIGNING_SECRET` / `RSSAPP_WEBHOOK_SECRET`; fallback one of `WEBHOOK_SHARED_SECRET`, `RSSAPP_WEBHOOK_TOKEN`, `RSSAPP_TOKEN`, or Vault-backed `WEBHOOK_SHARED_SECRET` RPC match | Signed `RSSApp-Signature` requests preferred; header tokens accepted; query params `token`, `webhook_token`, or `rssapp_token` remain temporary code compatibility but are rejected in production while `RSSAPP_ALLOW_QUERY_TOKEN=false` | Keep signed RSS.app auth as the primary path, remove the old token from the RSS.app URL, rotate exposed RSS secrets, and delete query-token code only after the quiet-window gate reports zero hits. Keep `verify_jwt=false` only because RSS.app is not a Supabase JWT caller. |
| `worker` | `false` | `pg_cron` worker schedule; DB immediate trigger paths; webhook dispatch; internal service-role invokes | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or Vault token for cron; route-dependent `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TWITTER_*`, optional `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` | Service-role bearer from internal Edge invokes; `x-internal-token` from cron | Keep cron calls on `public._cron_internal_headers()`. Do not enable JWT until all non-user callers have an equivalent authenticated path. Track missing renderer secrets separately from worker auth. |
| `admin-retry` | `true` | Authenticated admin UI/manual retry paths | Supabase JWT validation plus `profiles.role = admin` | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for Telegram retry/preview paths | None | Keep `verify_jwt=true`; consider folding remaining retry-only behavior into `admin-actions` once action boundaries are stable. |
| `db-cleanup` | `false` | Daily cleanup cron and internal dry-run/manual calls | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or Vault token for cron | Service-role bearer; `x-internal-token` | Keep `verify_jwt=false` for cron. Confirm active cron uses `public._cron_internal_headers()` before rotating `WEBHOOK_SHARED_SECRET`. |
| `media-processor` | `false` | Internal worker handoff; `db-cleanup`; `media-cleanup`; manual internal diagnostics | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or service-role bearer for direct calls | Service-role bearer from other Edge Functions | Keep direct public access blocked by internal auth. Treat this as an internal service, not a browser-callable endpoint. |
| `media-cleanup` | `false` | Scheduled media cleanup cron; internal dry-run/manual calls | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or Vault token for cron | Service-role bearer; `x-internal-token` | Keep cron header contract documented; cleanup wrapper should continue invoking `media-processor` with service-role bearer. |
| `admin-actions` | `true` | Authenticated admin dashboard, Monitoring, Settings, and Dashboard control-plane actions | Supabase JWT validation plus `profiles.role = admin` | `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEPLOY_GIT_SHA`; action-dependent `OPENAI_API_KEY`, `TWITTER_*`, `TELEGRAM_*` | None | Keep `verify_jwt=true`; keep splitting action domains so privileged service-role work stays behind explicit admin authorization. |
| `x-poster` | `false` | `x-poster-tick` cron; internal admin/action invokes; targeted posting retries | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or Vault token for cron; `TWITTER_*` for posting; optional `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` for direct render dispatch | Service-role bearer; `x-internal-token` | Keep posting disabled through `x_posting_config` when needed. Configure renderer secrets only if direct dispatch should be active; otherwise it intentionally falls back to poller-only render flow. |
| `x-followers-snapshot` | `false` | Daily follower snapshot cron and internal manual snapshots | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or Vault token for cron; `TWITTER_*` | Service-role bearer; `x-internal-token` | Keep daily-cap and X API controls enabled. Confirm cron uses `public._cron_internal_headers()` before token rotation. |
| `digest-compiler` | `false` | Internal/manual digest compilation; candidate for scheduled digest runs | `requireInternalAuth` | `SUPABASE_SERVICE_ROLE_KEY`; `WEBHOOK_SHARED_SECRET` or service-role bearer; `OPENAI_API_KEY`; `TWITTER_*` only for non-dry-run posting | Service-role bearer; `x-internal-token` | Keep the local source as the deploy source of truth. Do not reintroduce anon-key authorization. Schedule only after digest settings and auth path are reviewed. |

## Query-Token Removal Path

Production status as of 2026-06-15T20:12Z: steps 1-4 below are complete. A signed webhook request without a query token returned HTTP 200, and an unsigned query-token-only request returned HTTP 401. The exposed old URL-token path was treated as shared `WEBHOOK_SHARED_SECRET`; that Edge secret and the matching Vault value were rotated and verified at 2026-06-15T20:11:55Z. Removing the stale query string from RSS.app, regenerating the RSS.app signing secret, and the quiet-window gate remain open before query-token code can be deleted.

1. Enable RSS.app webhook signing on the configured webhook. RSS.app sends `RSSApp-Signature: t=<unix seconds>,v1=<hex hmac>` where `v1` signs `${t}.${raw_body}` with HMAC-SHA256.
2. Save the one-time RSS.app signing secret in Supabase Edge Function Secrets as `RSSAPP_SIGNING_SECRET`.
3. Deploy `webhooks-rssapp` and send an RSS.app webhook test; the latest deployment should return `200` with no `rss_query_token` compatibility event.
4. Set `RSSAPP_ALLOW_QUERY_TOKEN=false`.
5. Remove `?token=...`, `?webhook_token=...`, or `?rssapp_token=...` from the RSS.app webhook URL.
6. Rotate the exposed old query-token secret and regenerate the RSS.app signing secret if it has appeared in chat, screenshots, logs, or docs. The old URL-token/shared-secret path was rotated on 2026-06-15; the RSS.app signing secret still needs regeneration in RSS.app and an updated `RSSAPP_SIGNING_SECRET` value in Supabase before the next signed test.
7. Before removing query-token support from `supabase/functions/_shared/internalAuth.ts`, run the enforced release-state quiet-window gate:

```bash
CHECK_COMPATIBILITY_QUIET=1 COMPATIBILITY_QUIET_HOURS=24 npm run check:release-state
```

The gate must report zero `rss_query_token` hits. Normal `npm run check:release-state` reports compatibility telemetry without failing, so the enforced mode is the removal proof.

If signing is unavailable on the configured RSS.app account, use custom headers as the fallback: configure `x-rssapp-token` or `x-webhook-token`, set the matching `RSSAPP_WEBHOOK_TOKEN`, and follow the same quiet-window gate before deleting query-token code. If neither signing nor custom headers is available, keep query-token compatibility enabled, use a long random token, rotate it after any exported/shared logs, and treat any URL-bearing log as sensitive.

## Deploy Guardrails

`scripts/deploy-functions.sh` currently checks:

- selected functions exist in `supabase/config.toml`;
- every selected function has `verify_jwt` explicitly set to `true` or `false`;
- every selected function has `supabase/functions/<name>/index.ts`;
- the worktree is clean unless `DEPLOY_ALLOW_DIRTY=1`;
- deploy runs from `main` matching `origin/main` unless `DEPLOY_ALLOW_NON_MAIN=1`;
- `DEPLOY_GIT_SHA` is stamped only after selected function deploys succeed.

Before changing any function auth mode:

1. Update this matrix in the same branch.
2. Confirm the caller path still works locally where possible.
3. Run the function inventory and Deno gates.
4. Run a dry-run deploy preflight from the intended release branch.
5. Run read-only release-state checks after deploy.
