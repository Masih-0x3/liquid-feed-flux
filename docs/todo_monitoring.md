# Monitoring Pipeline — Status & Architecture

This document describes the monitoring pipeline as shipped. It covers the data flow, step definitions, UI capabilities, and operational notes.

## Pipeline Overview

Posts flow through the system in discrete steps, each tracked via `pipeline_events` and derived from table state:

```
RSS Feed → Ingest → Media Download → Translate (OpenAI) → Deliver (Telegram)
```

## Step Definitions

| Step | Source Signal | "Done" When |
|------|-------------|-------------|
| **Ingest** | `posts.created_at` exists | Row inserted |
| **Media** | `media` rows for tweet_id | All rows have `downloaded_at` set |
| **Translate** | `jobs.type='translate'` | `posts.text_translated` and `translated_at` populated |
| **Deliver** | `deliveries` row | `status='posted'` and `posted_at` set |

States per step: `queued`, `running`, `completed`, `failed`.

## Database Tables Involved

- **`posts`** — Core content; includes translation provenance (`translated_at`, `translation_model`, `translation_tokens`, `translation_duration_ms`).
- **`media`** — Per-tweet media items; `src_url_hash` enables deduplication; `storage_path` tracks downloads in `temp-media` bucket.
- **`jobs`** — Job queue with `claim_jobs()` RPC for lock-free concurrency; tracks `started_at`, `completed_at`, `result_meta`.
- **`deliveries`** — Telegram delivery tracking with `posted_at`, `attempts`, `telegram_message_ids`.
- **`pipeline_events`** — Canonical audit log of step transitions (step × status × timestamps × error + meta).
- **`dead_letter_jobs`** — Failed jobs after max retries.

## RPCs

- **`get_post_pipeline_status(tweet_ids)`** — Returns per-step status, timestamps, errors, media counts in one call.
- **`retry_step(tweet_id, step)`** — Enqueues retry job and records pipeline event.
- **`get_system_health()`** — Queue depth, success rate, DLQ count.
- **`get_dashboard_summary()`** — 24h metrics, recent posts, latency.
- **`reconcile_stuck_jobs()`** — Releases expired leases, creates missing delivery jobs.

## Monitoring UI

- **Stepper row**: Compact 4-step indicator (Ingest → Media → Translate → Deliver) with color-coded states.
- **Filters**: All, Needs Translation, Delivery Pending, Failed.
- **Details drawer**: Timeline from `pipeline_events`, error messages, retry actions per step.
- **Realtime**: Debounced (300ms) subscriptions on `posts`, `jobs`, `deliveries`.
- **Pagination**: Cursor-based via `useInfiniteQuery`.

## Telegram Analytics

Additional tables track channel-level metrics:

- **`telegram_channel_stats`** — Periodic snapshots of member count, admin count, verification status.
- **`telegram_daily_stats`** — Daily aggregates: messages sent/failed, member joins/leaves, avg delivery time.
- **`telegram_member_events`** — Individual join/leave events with user metadata.
- **`telegram_message_analytics`** — Per-message delivery tracking with response time, error codes.

Views: `telegram_channel_current`, `telegram_member_growth`, `telegram_message_performance`.

## Edge Functions

| Function | Purpose |
|----------|---------|
| `webhooks-rssapp` | Receives RSS.app webhook, ingests posts, creates translate/media jobs |
| `worker` | Claims and processes jobs (translate, deliver, download_media, moderate) |
| `admin-retry` | Admin-authenticated actions: resend, retry failed, test template/webhook |
| `admin-actions` | Additional admin operations |
| `media-processor` | Downloads media, deduplicates by `src_url_hash`, cleanup |
| `media-cleanup` | Scheduled wrapper for media-processor cleanup |
| `db-cleanup` | Purges old pipeline_events, completed/failed jobs, cron logs |

## Operational Notes

- **Cleanup**: `db-cleanup` and `media-cleanup` run on cron schedules. Both support `dry_run: true`.
- **Deduplication**: Media uses SHA-256 hash of `src_url` to avoid redundant downloads.
- **Retry semantics**: Max 5 attempts with exponential backoff; exhausted jobs go to DLQ.
- **Reconciliation**: `reconcile_stuck_jobs()` releases expired leases and creates missing delivery jobs for translated posts.
