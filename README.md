# Liquid Feed Flux

RSS-to-Telegram content pipeline with an admin dashboard. Ingests tweets via RSS.app webhooks, translates them (OpenAI, EN→FA), and delivers formatted messages to Telegram channels — with full observability.

## Architecture

```
RSS.app Webhook
  ↓
webhooks-rssapp (Edge Function)
  ↓ creates jobs
worker (Edge Function, cron-triggered)
  ├─ translate  → OpenAI API → posts.text_translated
  ├─ deliver    → Telegram Bot API → deliveries.posted_at
  └─ download_media → fetch + Supabase Storage
  ↓ audit trail
pipeline_events table
  ↓
React Admin Dashboard (Vite + shadcn/ui)
  ├─ Dashboard   — 24h metrics, health, recent posts
  ├─ Monitoring  — Per-post pipeline stepper, filters, detail drawer
  ├─ Threads     — Grouped tweet threads
  └─ Settings    — Translation prompts, message templates, accounts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| State | TanStack Query, Supabase Realtime |
| Backend | Supabase (Postgres, Edge Functions, Storage, Auth) |
| External APIs | OpenAI (translation), Telegram Bot API (delivery), RSS.app (ingestion) |

## Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `webhooks-rssapp` | HTTP (RSS.app webhook) | Ingests posts, creates translate/media jobs |
| `worker` | Cron (every minute) | Processes job queue: translate, deliver, download_media |
| `admin-retry` | HTTP (admin UI) | Resend delivery, retry failed, test template/webhook |
| `admin-actions` | HTTP (admin UI) | Additional admin operations |
| `media-processor` | HTTP (internal) | Download media, cleanup old files, get media info |
| `media-cleanup` | Cron | Scheduled media file cleanup |
| `db-cleanup` | Cron | Purge old jobs, pipeline events, cron/HTTP logs |

## Database

Key tables: `posts`, `media`, `jobs`, `deliveries`, `pipeline_events`, `dead_letter_jobs`, `accounts`, `feeds`, `settings`, `threads`, `moderation_events`, `user_roles`.

Telegram analytics: `telegram_channel_stats`, `telegram_daily_stats`, `telegram_member_events`, `telegram_message_analytics`.

RPCs: `claim_jobs`, `get_post_pipeline_status`, `retry_step`, `get_system_health`, `get_dashboard_summary`, `reconcile_stuck_jobs`, `cleanup_old_data`, `calculate_growth_rate`.

## Local Development

```bash
git clone <repo-url>
cd <project>
npm install
npm run dev
```

### Prerequisites
- Node.js 20+
- npm 10.8+ (pinned via `packageManager` in package.json)
- Supabase project (connected via `.env`)

### Environment Variables

Populated automatically by Lovable/Supabase integration:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### Edge Function Secrets (Supabase Dashboard → Settings → Edge Functions)

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Translation via OpenAI API |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API authentication |
| `TELEGRAM_CHAT_ID` | Target Telegram channel |
| `WEBHOOK_SHARED_SECRET` | Internal function-to-function auth |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Watch mode tests |

## CI/CD

GitHub Actions runs lint, test, and build on push/PR to `main`. Pre-commit hooks (husky + lint-staged) run ESLint and TypeScript checks on staged files.

## Deployment

Push to `main` triggers auto-deploy via Lovable. Edge functions deploy automatically. Alternatively, publish from the Lovable dashboard.

## Documentation

- `docs/todo_monitoring.md` — Pipeline architecture and monitoring details
- `docs/operations/runbooks.md` — Queue management, prompt/template management, secret rotation, incident response
- `docs/operations/backup-restore.md` — Backup and restore procedures
