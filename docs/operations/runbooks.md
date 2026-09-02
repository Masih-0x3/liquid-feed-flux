# Operations: Queue Management

## Job Types
- `translate` — OpenAI translation (EN→FA)
- `deliver` — Telegram delivery
- `download_media` — Media file download to storage
- `reprocess` — Full re-run (translate + deliver)
- `moderate` — Content moderation via OpenAI

## Retry Semantics
- Max 5 attempts per job with exponential backoff
- Telegram 429s honor `retry_after` header
- After max attempts, job moves to `dead_letter_jobs` table
- Manual retries via Monitoring page or admin-actions API

## Reprocessing
- Single post: Monitoring → Reprocess button
- Bulk: Select multiple → Reprocess Selected
- Creates idempotent job (won't duplicate if already pending)

---

# Operations: Prompt & Template Management

## Translation Prompt
Settings → Translation tab → System Prompt + User Prompt Template

Placeholders: `{content}`, `{author_handle}`, `{author_name}`, `{tweet_url}`, etc.

## Message Template
Settings → Messages tab → Template with `{translated_text}`, `{hashtags}`, etc.

Changes take effect on next translation/delivery (existing posts unaffected).

---

# Operations: Secret Rotation

1. Go to Supabase Dashboard → Edge Function Secrets
2. Update the relevant secret (OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, etc.)
3. Edge functions automatically pick up new values on next invocation
4. No code changes or redeployment needed

### Internal cron and Edge auth

`WEBHOOK_SHARED_SECRET` and matching Vault/cron tokens secure internal invokes. Validation is local and fail-closed before a service-role client is created; the Edge secret and Vault/cron value must remain aligned. The historical `verify_webhook_internal_token` RPC is not an authentication fallback.

Function-by-function auth mode, caller, required secret, and hardening details are tracked in [`function-auth-matrix.md`](./function-auth-matrix.md). Update that matrix before changing any `verify_jwt` flag, internal token behavior, RSS webhook token behavior, or function caller path.

1. **Vault / cron token** must match the Edge secret `WEBHOOK_SHARED_SECRET`. If you rotate the secret in Supabase Dashboard, update the Vault value used by `pg_net` / `net.http_post` jobs as well.
2. After changing that secret, **redeploy** the Edge functions that enforce internal auth so they pick up the new env (or wait for the next deploy pipeline).
3. **Post-deploy check:** Supabase → Edge Functions → `worker` → Logs. For the **latest deployment version**, cron `POST` requests should return **200**. Persistent **401** on the latest version means the secret or RPC path is still misaligned.

### RSS.app webhook auth

`webhooks-rssapp` accepts RSS.app signed webhooks through the `RSSApp-Signature` header. The header format is `t=<unix seconds>,v1=<hex hmac>`, and `v1` signs `${t}.${raw_body}` with HMAC-SHA256 using `RSSAPP_SIGNING_SECRET`.

Current production contract:

1. Keep the RSS.app webhook URL free of auth query strings.
2. Keep webhook signing enabled in RSS.app and keep the current signing secret stored as `RSSAPP_SIGNING_SECRET`.
3. Send an RSS.app webhook test after any signing-secret rotation and confirm `webhooks-rssapp` returns `200`.
4. If signing is unavailable during an incident, use custom request headers as the fallback: set `x-rssapp-token: <new secret>` or `x-webhook-token: <new secret>`, then store the same value in `RSSAPP_WEBHOOK_TOKEN`.

Query-string tokens are no longer accepted. If a URL containing `?token=`, `?webhook_token=`, or `?rssapp_token=` appears in logs or screenshots, treat the value as exposed and rotate any matching RSS.app/header fallback secret. The webhook remains idempotent by `tweet_id`, so RSS.app retries should not redeliver existing posts.

---

# Operations: Cleanup Jobs

## Database Cleanup (daily cron)
- Removes completed/failed jobs older than 7 days
- Cleans pipeline_events, cron logs, HTTP response cache
- Supports `dry_run: true` to preview what would be deleted

## Media Cleanup
- Removes downloaded media files older than 7 days from storage
- Resets media records to allow re-download if needed

---

# Operations: Alert Thresholds

Recommended thresholds for external monitoring/alerting systems. These are not enforced in-app — configure in your monitoring tool (e.g., Grafana, Datadog, UptimeRobot).

| Metric | Warning | Critical | Source |
|--------|---------|----------|--------|
| Queue depth (pending jobs) | > 50 | > 200 | `get_system_health()` → `queue_pending` |
| Failed jobs (24h) | > 5 | > 20 | `get_system_health()` → `failed_24h` |
| Success rate (24h) | < 95% | < 80% | `get_system_health()` → `success_rate_24h` |
| Oldest pending job age | > 10 min | > 30 min | `get_system_health()` → `oldest_pending_age_seconds` |
| Dead letter queue size | > 0 | > 10 | `get_system_health()` → `dead_letter_count` |
| Avg delivery latency | > 60s | > 300s | `get_dashboard_summary()` → `health.avg_latency` |
| Edge function error rate | > 1% | > 5% | Supabase Edge Function logs |
| Storage bucket size | > 1 GB | > 5 GB | Supabase Storage dashboard |

### Querying Health Metrics

```sql
-- From psql or Supabase SQL editor:
SELECT * FROM get_system_health();
SELECT * FROM get_dashboard_summary();
```

Or via the admin dashboard's Dashboard page, which calls these RPCs automatically.

---

# Operations: Incident Response

## Queue Stuck
1. Check Dashboard → Queue Size indicator
2. Go to Monitoring → filter by "Failed"
3. Check edge function logs for errors
4. If worker is not running: verify cron job in Supabase Dashboard
5. Run `reconcile_stuck_jobs()` to release expired leases

## Translation Failures
1. Check Monitoring → posts with translation errors
2. Verify OPENAI_API_KEY is valid in Edge Function Secrets
3. Check for rate limits in function logs
4. Retry individual posts from Monitoring detail drawer

## Delivery Failures
1. Check Monitoring → posts with delivery errors
2. Verify TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
3. Check for Telegram rate limits (429s auto-retried)
4. Use "Retry Failed Deliveries" quick action on Dashboard

## High DLQ Count
1. Check dead_letter_jobs table for patterns (common error, specific job type)
2. Fix root cause (API key, rate limit, template error)
3. Consider re-enqueuing via `retry_step()` RPC after fix
