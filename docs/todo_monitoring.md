# Monitoring Pipeline Status Overhaul — TODOs

This document tracks the plan to improve the Monitoring page’s per‑post status indicators with richer steps, clear state, and useful micro‑interactions. It also records the already‑completed fix to Dashboard latency and the database work needed to support the new UI.

## Problem
- Indicators today only show two coarse steps (Translate, Deliver). We lack visibility into earlier/later phases (ingest, media, moderation, formatting, queueing, cleanup).
- States are binary and ambiguous (e.g., “Pending” could mean queued or running). There is no SLA awareness or “stalled” surfacing.
- Minimal context: no timestamps, durations, attempt counts, model provenance, or direct links to delivered messages.
- Actions exist but aren’t anchored to specific failing steps (e.g., a general “Reprocess”), making triage slower.
- Realtime changes can flicker; there’s no debounce or smooth micro‑interactions.

## What’s Already Done
- Dashboard: replaced the random “Avg Latency” with a real calculation using the time from `posts.created_at` to `deliveries.created_at` for successfully posted deliveries within the last 24h. File: `src/pages/Dashboard.tsx`.
- Edge functions deployed (active): `worker`, `webhooks-rssapp`, `admin-retry`.
- Worker now emits `pipeline_events` for `translate/media/deliver` (running/completed/failed) and writes provenance:
  - Sets `posts.translated_at`, `translation_model`, `translation_tokens`, `translation_duration_ms`.
  - Ensures pending `deliveries` row exists after translation; sets `deliveries.posted_at`, `last_attempt_at`, `attempts` on success.
- Webhook and Admin‑Retry enqueue jobs and emit `pipeline_events` for queued steps (`translate`, `media`, `deliver`).
- Schema aligned for Phases 2–5: added missing columns/indexes and created `pipeline_events`.
- RPCs created: `get_post_pipeline_status(tweet_ids text[])`, `retry_step(tweet_id text, step text)`.
- Monitoring page improvements:
  - Debounced realtime (300ms) to reduce flicker.
  - Stepper expanded to include `Ingest`, `Media`, `Translate`, `Deliver`.
  - Added basic filters (All, Needs translation, Delivery pending, Failed).
  - Details button loads timeline from `pipeline_events` for the selected post (basic data fetch in place).

## Proposed Solution (High Level)
- Expand the pipeline into discrete steps with consistent states and timestamps.
- Add micro‑interactions that communicate state clearly without overwhelming the UI.
- Record per‑step status in the DB (or derive reliably) so the UI stays simple and fast.
- Provide per‑step retry/inspect controls, and a detail drawer for advanced triage.
- Introduce “stalled” based on SLAs (e.g., queued/running beyond 5 minutes).

## Step Definitions (UI Contract)
For each tweet/post, compute the following steps from DB signals:
- Ingest: `posts.created_at` present.
- Media Extract: `media` rows exist; consider “done” when all related media have `downloaded_at` set.
- Language Detect: `posts.lang_original` present.
- Translate: `jobs.type='translate'` lifecycle; “done” when `posts.text_translated` present and `posts.translated_at` (new) set.
- Moderate (optional): row in `moderation_events` with latest `verdict` for subject (post/tweet_id).
- Format (optional): message template successfully rendered (server job or client check); store success in `pipeline_events` or dedicated column.
- Queue Delivery: row exists in `deliveries` with `subject_type='post'` and `status='pending'`.
- Deliver: `deliveries.status='posted'` and `deliveries.posted_at` (new) set; `telegram_message_ids` recorded.
- Thread Grouping (optional): membership in `threads` for that tweet; show size.
- Cleanup (optional): event recorded when media cleanup runs.

States: `queued`, `running`, `completed`, `failed`, `skipped`, `n/a`, plus `stalled` if queued/running > SLA.

## Micro‑Interactions (Per Step)
- Queued: looping dots; tooltip “Queued at {time}”.
- Running: pulsing dot + subtle shimmer; live “+Xm” since start; ARIA live polite.
- Completed: checkmark pop‑in; short green highlight; duration label (e.g., “1.8s”).
- Failed: gentle shake once + red badge; tooltip with last error; copy‑to‑clipboard button.
- Skipped/NA: muted chip with slash icon; tooltip explains why.
- Stalled: amber pulse when exceeded SLA; tooltip “Stalled > {threshold}”.
- Transition smoothing: 150–250ms debounce/crossfade to avoid flicker on rapid realtime updates.

## Schema Status (Applied) & Verification
All schema changes required for Phases 2–5 are applied in the database. Use the following read-only checklist to verify and to guide consuming code.

- Table: `posts` (present)
  - Columns: `translated_at timestamptz`, `translation_job_id uuid`, `translation_model text`, `translation_tokens int`, `translation_duration_ms int`
  - Indexes: `(tweet_id)` present; verify `(created_at)` index for recency queries
  - Verification:
    - `translated_at` is populated on successful translation
    - `translation_*` provenance comes from `jobs.result_meta`

- Table: `deliveries` (present)
  - Columns: `posted_at timestamptz`, `job_id uuid`, `last_attempt_at timestamptz`, `attempts int default 0`, `target_chat text`
  - Indexes: composite `(subject_type, subject_id, status)` present
  - Verification:
    - `posted_at` set on successful delivery
    - `last_attempt_at` updated on each attempt

- Table: `jobs` (present)
  - Columns: `started_at timestamptz`, `completed_at timestamptz`, `updated_at timestamptz`, `result_meta jsonb`
  - Indexes: `(type, status)` and GIN on `(payload)` with JSON path for `payload->>tweet_id`
  - Verification:
    - `updated_at` auto-maintained on UPDATE
    - `result_meta` contains model, tokens, durations

- Table: `media` (present)
  - Columns: `downloaded_at timestamptz` (populated), `processed_at timestamptz` if transformations exist

- Table: `moderation_events` (present)
  - Defaults/Indexes: `subject_type text not null default 'post'`; index `(subject_type, subject_id, created_at)`

- Table: `pipeline_events` (present)
  - Columns: `id uuid pk default gen_random_uuid()`, `subject_type text`, `subject_id text`, `step text`, `status text`, `started_at timestamptz`, `ended_at timestamptz`, `error text`, `meta jsonb`, `actor text`, `created_at timestamptz default now()`
  - Indexes: `(subject_type, subject_id, step, started_at desc)`, `(step, status)`
  - Purpose: canonical timeline of step transitions for the detail drawer and audit

- View (optional): `post_pipeline_status` (present or computed by RPC)
  - Materialized view summarizing the latest status per step for fast list queries
  - Refresh: scheduled or trigger-based; or compute on the fly via RPC

- RLS/Policies
  - Read: authenticated admins allowed
  - Writes: only via server/edge functions using the service role

## Current Status — Completed vs Pending

Completed
- Edge runtime:
  - `worker`: emits `pipeline_events`, writes `posts.translated_at` and delivery timestamps, and sequences `deliver` after `translate`.
  - `webhooks-rssapp`: emits queued events for `translate`/`media` and creates initial jobs.
  - `admin-retry`: retries create deliver jobs and emit queued events.
- Database schema (public):
  - `posts` translation provenance columns present and used by worker.
  - `deliveries` `posted_at/last_attempt_at/attempts/target_chat` present (`target_chat` reserved for later use).
  - `jobs` `started_at/completed_at/updated_at/result_meta` present; indexes on `(type,status)` and GIN on `payload` present.
  - `pipeline_events` table + indexes present.
  - RPCs: `get_post_pipeline_status`, `retry_step` present.
- UI:
  - Monitoring stepper shows Ingest/Media/Translate/Deliver (basic states + errors), debounced realtime, simple filters, and a Details button that fetches timeline data.

Pending (priority ordered)
1) Monitoring UI polish and completeness
   - Finalize Detail Drawer UI: render full timeline (`pipeline_events`), attempts history, payload snippets, and Telegram deep links. Wire per‑step retry actions (`retry_step`) for `translate`, `deliver`, `media`, `moderate` inside the drawer.
   - SLA “stalled” state: compute from timestamps (`jobs.started_at/created_at`, `deliveries.created_at`) with thresholds in settings; add subtle animations for queued/running/completed/failed per spec.
   - Durations: show per‑step durations using `jobs.started_at/completed_at` and `result_meta` where available.
   - Thread grouping badge: surface membership count from `threads` when present.
   - Virtualization for long lists and lazy‑load drawer content for performance.

2) Backfills (one‑time tasks)
   - `posts.translated_at`: derive from earliest `jobs.completed_at` for last successful translate job or fallback to `posts.updated_at`.
   - `deliveries.posted_at`: set from `deliveries.created_at` where `status='posted'` and `posted_at is null`.

3) Optional server efficiency
   - Consider materialized view `post_pipeline_status` if list queries need faster summaries; otherwise continue with the RPC.

4) Access control and observability
   - Confirm RLS read policies for admin console and service‑role writes for functions are sufficient.
   - Add function error logging/metrics and alerts for high stalled counts.

## Server/Edge Logic & Triggers
- Jobs lifecycle
  - On insert to `jobs` with known `payload.tweet_id`: set `started_at` when first picked, `completed_at` on finish; upsert corresponding `pipeline_events` with `step` in {translate, deliver, format} and `status` in {queued, running, completed, failed}.
  - Persist attempt increments and `last_error` consistently.

- Translation completion
  - After saving `posts.text_translated`, also set `translated_at` and fill `translation_model`, `translation_tokens`, `translation_duration_ms` from job `result_meta`.

- Delivery updates
  - When a delivery succeeds: set `posted_at`, increment `attempts`, set `last_attempt_at`, and append to `telegram_message_ids`.

- Backfill tasks
  - Compute `translated_at` from first `jobs.completed_at` for translate jobs or fallback to `posts.updated_at`.
  - Set `posted_at` from `deliveries.created_at` where `status='posted'` but `posted_at` is null.

- RPCs (for efficient UI)
  - `get_post_pipeline_status(tweet_ids text[]) returns setof ...` — emit per‑step status, timestamps, attempts, errors, thread info in one call.
  - `retry_step(tweet_id text, step text)` — enqueue the appropriate job with correct payload.

## Client UX Tasks
- Adapter: map DB rows (or RPC result) to a normalized `StepState[]` with: `label`, `state`, `startedAt`, `endedAt`, `durationMs`, `attempts`, `error`, `links`.
- Compact row: render 6–8 chips with icon + label + color; hover tooltips show details.
- Detail drawer: timeline from `pipeline_events`, attempts history, payload snippets, Telegram deep link when available.
- SLA Logic: compute `stalled` in adapter using configurable thresholds from settings.
- Actions: per‑step retry with optimistic UI; toast results; disable while pending.
- Realtime: subscribe to `posts`, `jobs`, `deliveries` (and optionally `pipeline_events`); debounce updates 250–500ms to reduce flicker.
- Performance: virtualize list; lazy‑load drawer content; batch RPC for visible items.

## Filters & Bulk Operations
- Filters: by step and state (e.g., Translation: failed; Delivery: stalled > 10m).
- Saved Views: “Needs translation”, “Delivery pending > 10m”, “Recently failed”.
- Bulk actions: retry translation for selected; retry delivery for selected; guard with confirmation.

## Telemetry & Provenance (Phase 5)
- Display model (e.g., `gpt-4o-mini`), temperature, and token counts per translation.
- Show delivery target (chat id/name) and deep link to message when posted.
- Track `actor` in `pipeline_events` for manual interventions.

## Accessibility & RTL
- Do not rely on color alone; include icons and text labels.
- Use ARIA live regions for state changes (polite).
- Ensure Persian text sections are marked `dir="rtl"` and typography is readable.

## Realtime & Performance Considerations
- Use indexed queries and batched RPC to prevent N+1.
- Debounce state recompute and UI render.
- Avoid resubscribing on every small navigation.

## QA & Rollout
- Seed fixtures covering: queued/running/completed/failed/stalled for translate and deliver; missing media; missing moderation.
- Migration plan: add columns/tables; backfill; deploy triggers/RPC; verify policies; then switch UI to adapter behind a feature flag.
- Observability: log function/trigger errors; collect metrics on step durations; alert on stalled counts.
- Feature flag: toggle to fall back to current 2‑step indicator if needed.

## Phased Implementation Plan
- Phase 1: Clear Stepper + Tooltips
  - Build adapter with step mapping using current tables only.
  - Add compact stepper with tooltips and timestamps (no new columns required).
  - Acceptance: Steps render correctly for at least 90% of posts; tooltips show time and status.

- Phase 2: Micro‑interactions + SLA “Stalled”
  - Add animations for Queued/Running/Completed/Failed.
  - Introduce SLA thresholds and stalled state; add settings to configure.
  - Acceptance: Running pulses smoothly; stalled appears after threshold; no layout shift.

- Phase 3: Detail Drawer + Job History
  - Add `pipeline_events`; create RPC to fetch timeline; drawer view with attempts, errors, payload snippets.
  - Acceptance: Drawer opens in <200ms for recent posts; timeline is complete and in order.

- Phase 4: Filters + Bulk Actions
  - Add step/state filters and saved views; bulk retry actions with confirmation and progress toasts.
  - Acceptance: Filters return results in <500ms for 10k posts; bulk actions enqueue jobs reliably.

- Phase 5: Telemetry + Model Provenance
  - Persist translation metadata and show in UI; include delivery target and deep links.
  - Acceptance: Provenance visible for new translations; no PII leakage.

- Phase 6: Polish + A11y + Performance
  - RTL refinements; keyboard nav; virtualization; error copy; subtle transitions.
  - Acceptance: A11y audit passes; 60fps scrolling; long lists remain responsive.

## Risks & Mitigations
- Data drift: legacy rows missing new fields. Mitigate with backfills and robust adapter defaults.
- Realtime noise: frequent changes causing flicker. Mitigate with debouncing and transition smoothing.
- Index bloat: too many indices. Add only those proven by query plans; revisit periodically.
- Permissions: RLS blocking needed writes. Test with service role functions and clear policies.

## Migration Sketch (SQL Outline)
```sql
-- posts
alter table public.posts add column if not exists translated_at timestamptz;
alter table public.posts add column if not exists translation_job_id uuid;
alter table public.posts add column if not exists translation_model text;
alter table public.posts add column if not exists translation_tokens int;
alter table public.posts add column if not exists translation_duration_ms int;

-- deliveries
alter table public.deliveries add column if not exists posted_at timestamptz;
alter table public.deliveries add column if not exists job_id uuid;
alter table public.deliveries add column if not exists last_attempt_at timestamptz;
alter table public.deliveries add column if not exists attempts int default 0;
alter table public.deliveries add column if not exists target_chat text;
create index if not exists deliveries_subject_idx on public.deliveries(subject_type, subject_id, status);

-- jobs
alter table public.jobs add column if not exists started_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists updated_at timestamptz;
alter table public.jobs add column if not exists result_meta jsonb;
create index if not exists jobs_type_status_idx on public.jobs(type, status);
create index if not exists jobs_payload_tweet_idx on public.jobs using gin ((payload));

-- pipeline_events
create table if not exists public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text not null,
  step text not null,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  error text,
  meta jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists pipeline_events_subject_idx on public.pipeline_events(subject_type, subject_id, step, started_at desc);
create index if not exists pipeline_events_step_status_idx on public.pipeline_events(step, status);
```

---

This plan keeps the UI simple by deriving state centrally and storing durable signals in the DB. We can implement Phase 1 with minimal schema changes, then layer in telemetry and the detail timeline as the backend emits richer events.

