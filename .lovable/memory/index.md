# Memory: index.md
Updated: today

# Project Memory

## Core
- Strict English-to-Persian pipeline. Translated output must remove all original source identifiers.
- Security: Admin only. Views need `security_invoker = on`. Route DB mutations via `admin-actions` Edge Function (no direct browser DB writes).
- Auth: Browser requests to Edge Functions need admin JWT; internal service calls require `x-internal-token`.
- Database: pg_cron tasks must use hardcoded Supabase URLs and Keys in headers because `current_setting` fails in SQL cron context.
- UI: Use React Query. Server-side RPCs required for complex dashboard metrics and health checks.
- Telegram: Messages must strictly use Markdown parse mode.
- Truncated RSS tweets are hydrated via X API v2; post-hydrate re-translate MUST use key `translate:hydrate:<id>` AND hydrate handler MUST null `translated_at` + `text_translated` to gate publishers.

## Memories
- [Translation & Scoring](mem://ai/translation-settings) — gpt-4o-mini single-call translation and AI scoring
- [Job Processing](mem://architecture/job-processing) — Priority queue, batching, idempotency keys, and retry logic
- [Pipeline Sequencing](mem://architecture/pipeline-sequencing) — Translate -> deliver sequencing driven by webhooks
- [Author Filtering](mem://architecture/author-attribution-filtering) — Regex extraction of Twitter handles for per-author rules
- [Frontend Architecture](mem://architecture/frontend-patterns) — React Query standards, view layer extraction
- [Data Mutation](mem://architecture/data-mutation-pattern) — admin-actions Edge Function and Zod validation rules
- [Access Strategy](mem://auth/access-strategy) — Registration disabled, manual admin account provisioning
- [RBAC Model](mem://auth/rbac-model) — RLS policies, user_roles table, and security_invoker views
- [AI Content Curation](mem://features/ai-content-curation) — 1-20 scoring, Iran-gate editorial policy, threshold settings
- [Media Management](mem://features/media-management) — SHA-256 deduplication and 7-day retention of media assets
- [Monitoring Dashboard](mem://features/monitoring-dashboard) — Cursor pagination, live status tracking, and 1-20 badges
- [Message Templates](mem://features/message-templates) — Telegram template system with live previews
- [System Health](mem://features/system-health-monitoring) — Server-side RPC metrics and JSON logging for observability
- [Twitter Digest](mem://features/twitter-digest) — 30-minute Persian editorial digest via OAuth 1.0a
- [X Posting Pipeline](mem://features/x-posting-pipeline) — Score-gated, media-required individual post mirroring to X with quotas and dedupe
- [Twitter Hydration](mem://features/twitter-hydration) — Truncated RSS tweets fetched via X API note_tweet before translation
- [Cron Config](mem://infrastructure/cron-configuration) — pg_cron hardcoded header constraints for Supabase
- [Video Limitations](mem://limitations/video-ingestion) — Video thumbnail fallback due to RSS.app constraints
- [DB Retention](mem://maintenance/database-retention) — Automated 7-day data cleanup via batched pg_cron tasks
- [Edge Auth](mem://security/edge-function-authorization) — JWT and internal token validation for edge functions
- [Credentials](mem://security/credential-policy) — Supabase secrets (OpenAI/Telegram) vs Settings UI (Twitter)
- [Content Direction](mem://style/content-direction) — Persian translation styling and source anonymization
- [Telegram Formatting](mem://style/telegram-formatting) — Markdown parse mode requirement for Telegram
