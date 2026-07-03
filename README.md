# Liquid Feed Flux

> RSS-to-Telegram content pipeline with an admin dashboard.  
> Ingests tweets via RSS.app webhooks, scores & filters them with OpenAI, translates (EN → FA), and delivers formatted messages to Telegram channels — with full observability.

## Architecture

```
RSS.app Webhook
  ↓
webhooks-rssapp (Edge Function)
  ↓ creates jobs
worker (Edge Function, cron-triggered)
  ├─ score       → OpenAI API → content scoring & filtering (1-20 scale)
  ├─ translate   → OpenAI API → posts.text_translated
  ├─ deliver     → Telegram Bot API → deliveries.posted_at
  └─ download_media → fetch + Supabase Storage
  ↓ audit trail
pipeline_events table
  ↓
React Admin Dashboard (Vite + shadcn/ui)
  ├─ Dashboard   — Ops cockpit with live/recent post process HUD, triage, and guardrails
  ├─ Monitoring  — Per-post workbench: filters, bulk actions, detail drawer, manual intervention
  ├─ Threads     — Grouped tweet threads
  └─ Settings    — Content filter, translation prompts, message templates, accounts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind CSS 3, shadcn/ui |
| State | TanStack Query v5, Supabase Realtime |
| Backend | Supabase (Postgres, Edge Functions, Storage, Auth) |
| External APIs | OpenAI (scoring + translation), Telegram Bot API (delivery), RSS.app (ingestion) |

## Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `webhooks-rssapp` | HTTP (RSS.app webhook) | Ingests posts, creates translate/media jobs |
| `worker` | Cron (every minute) | Processes job queue: score, translate, deliver, download_media |
| `admin-retry` | HTTP (admin UI) | Resend delivery, retry failed, test template/webhook |
| `admin-actions` | HTTP (admin UI) | Additional admin operations |
| `media-processor` | HTTP (internal) | Download media, cleanup old files, get media info |
| `media-cleanup` | Cron | Scheduled media file cleanup |
| `db-cleanup` | Cron | Purge old jobs, pipeline events, cron/HTTP logs |

## Database

Key tables: `posts`, `media`, `jobs`, `deliveries`, `pipeline_events`, `dead_letter_jobs`, `accounts`, `feeds`, `settings`, `threads`, `moderation_events`, `user_roles`.

Telegram analytics: `telegram_channel_stats`, `telegram_daily_stats`, `telegram_member_events`, `telegram_message_analytics`.

RPCs: `claim_jobs`, `get_post_pipeline_status`, `retry_step`, `get_system_health`, `get_dashboard_summary`, `reconcile_stuck_jobs`, `cleanup_old_data`, `calculate_growth_rate`.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10.8+
- Supabase project (connected via `.env`)

### Setup

```bash
git clone <repo-url>
cd liquid-feed-flux
cp .env.example .env   # fill in your Supabase credentials
npm install
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and populate:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref |
| `VITE_SENTRY_DSN` | Optional Sentry DSN for the `xot-web` browser project |
| `VITE_SENTRY_ENVIRONMENT` | Sentry environment label, usually `production` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Browser tracing sample rate, default `0.1` |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | Session replay baseline sample rate, default `0` |
| `VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE` | Session replay sample rate after errors, default `1` |
| `VITE_FOGLAMP_HUD` | Optional local-only Foglamp floating HUD opt-in; leave unset unless debugging the upstream HUD broker |
| `SENTRY_AUTH_TOKEN` | Build-only token for uploading Vite source maps; keep out of git |

Production builds validate these values before bundling. Missing or placeholder
values fail the build instead of producing a blank browser screen.

### Edge Function Secrets (Supabase Dashboard → Settings → Edge Functions)

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Scoring & translation via OpenAI API |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API authentication |
| `TELEGRAM_CHAT_ID` | Target Telegram channel |
| `WEBHOOK_SHARED_SECRET` | Internal function-to-function auth (must match Vault/cron token; see [runbooks](docs/operations/runbooks.md#internal-cron-and-edge-auth)) |
| `RSSAPP_SIGNING_SECRET` | Preferred RSS.app signed-webhook secret; verifies `RSSApp-Signature` HMAC requests |
| `RSSAPP_WEBHOOK_TOKEN` | Optional dedicated RSS.app webhook token; accepted only in `x-webhook-token` or `x-rssapp-token` header fallback |
| `SENTRY_DSN` | Optional Sentry DSN for Edge Functions (`xot-edge`) or the video renderer (`xot-renderer`) |
| `SENTRY_ENVIRONMENT` | Sentry environment label, usually `production` |
| `SENTRY_TRACES_SAMPLE_RATE` | Runtime tracing sample rate, default `0.1` |
| `SENTRY_RELEASE` | Optional release name; falls back to deploy SHA/version when available |
| `FOGLAMP_API_KEY` | Optional hosted Foglamp ingest key for AI SDK traces; XOT local ledgers still work without it |
| `FOGLAMP_ENABLED` | Optional hosted Foglamp export switch; set `0` to keep all observability local |
| `FOGLAMP_INGEST_URL` | Optional alternate Foglamp ingest endpoint |
| `FOGLAMP_MONTHLY_SPAN_LIMIT` | Observed hosted plan span limit; defaults to `10000` and should be operator-confirmed if the plan changes |
| `FOGLAMP_MONTHLY_SPAN_CAP` | XOT hard stop before hosted Foglamp export; defaults to `8000` estimated spans/month |
| `FOGLAMP_MONTHLY_SPAN_WARN` | Dashboard warning threshold for hosted Foglamp export; defaults to `6000` estimated spans/month |
| `FOGLAMP_RECORD_INPUTS` / `FOGLAMP_RECORD_OUTPUTS` | Keep `false` in production; XOT ledgers do not store prompt/output text by default |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run check:vite-env` | Validate required frontend environment variables |
| `npm run lint` | ESLint check |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Watch mode tests |
| `npm run preview` | Preview production build |

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs lint → test → env validation → build on push/PR to `main`.
Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID`
as GitHub repository secrets before relying on CI builds.
Pre-commit hooks (husky + lint-staged) run ESLint and TypeScript checks on staged files.

## Deployment

The frontend is hosted on Vercel. Vercel should be connected to this GitHub repo
with the Vite framework preset, `npm run build` as the build command, and `dist`
as the output directory. The committed `vercel.json` includes SPA rewrites so
direct route refreshes like `/monitoring` and `/x-account` resolve to `index.html`.

Supabase remains the backend for Auth, Postgres, Storage, Edge Functions, and cron.
Deploy Edge Functions separately with:

```bash
./scripts/deploy-functions.sh
```

After changing the production Vercel URL or custom domain, update Supabase Auth
URL configuration and the Edge Function `ALLOWED_CORS_ORIGIN` secret.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/todo_monitoring.md`](docs/todo_monitoring.md) | Pipeline architecture and monitoring |
| [`docs/audit/2026-06-14-xot-spaghetti-map.md`](docs/audit/2026-06-14-xot-spaghetti-map.md) | Cleanup target map for frontend, functions, database, renderer, runtime, and contracts |
| [`docs/operations/release-runbook.md`](docs/operations/release-runbook.md) | Production release gate, function deploy guardrails, smoke checks, and rollback ledger |
| [`docs/operations/runbooks.md`](docs/operations/runbooks.md) | Queue management, prompt/template management, secret rotation, incident response |
| [`docs/operations/vercel-cutover.md`](docs/operations/vercel-cutover.md) | Vercel frontend hosting setup and Lovable exit checklist |
| [`docs/operations/backup-restore.md`](docs/operations/backup-restore.md) | Backup and restore procedures |
| [`docs/roadmap/todo_analytics.md`](docs/roadmap/todo_analytics.md) | Telegram analytics implementation guide |

## License

Private — All rights reserved.
