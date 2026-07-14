-- Add missing columns for posts
alter table public.posts add column if not exists translated_at timestamptz;
alter table public.posts add column if not exists translation_job_id uuid;
alter table public.posts add column if not exists translation_model text;
alter table public.posts add column if not exists translation_tokens int;
alter table public.posts add column if not exists translation_duration_ms int;

-- Add missing columns for deliveries
alter table public.deliveries add column if not exists posted_at timestamptz;
alter table public.deliveries add column if not exists last_attempt_at timestamptz;
alter table public.deliveries add column if not exists target_chat text;
create index if not exists deliveries_subject_idx on public.deliveries(subject_type, subject_id, status);

-- Add missing columns for jobs
alter table public.jobs add column if not exists started_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists updated_at timestamptz;
alter table public.jobs add column if not exists result_meta jsonb;
create index if not exists jobs_type_status_idx on public.jobs(type, status);
create index if not exists jobs_payload_tweet_idx on public.jobs using gin ((payload));

-- Create pipeline_events table if missing
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
