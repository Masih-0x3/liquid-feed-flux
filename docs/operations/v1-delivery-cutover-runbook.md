# XOT v1 delivery cutover runbook

This runbook is for the v1 Telegram/X continuity cutover. Keep runtime
posting blocked and the external breaker false until the checks below pass.
The cutover is new-only: every delivery job, delivery row, X candidate,
render, and post lineage at or before T is historical and permanently unsent.
Historical processing, translation, scoring, media work, and rendering may
continue when their own guards allow it.

## Immutable cutoff

Initialize once, using the production database clock:

```sql
select public.initialize_delivery_cutover('operator-id-or-release-id');
select * from public.delivery_cutover;
select value->>'start_posting_from' as x_start_posting_from
from public.settings where key = 'x_posting_config';
```

The returned `delivery_cutover_at` is T. It must equal
`x_posting_config.start_posting_from`. Do not update or delete the singleton.
Before initialization, a missing cutoff fails closed. Equality with T is also
historical; only a real post lineage with `posts.created_at > T` is eligible.

## Before/after evidence

Capture this read-only baseline before initialization, and repeat it after
each stage. Store the output with the release receipt; do not mutate any row
to make the counts agree.

```sql
select now() as db_clock;
select environment, posting_mode, updated_at from public.runtime_controls;
select j.id, j.type, j.status, j.created_at, j.updated_at, j.attempts,
       j.last_error, j.locked_at, j.locked_by, j.lease_expires_at,
       j.started_at, j.completed_at,
       nullif(btrim(j.payload->>'tweet_id'), '') as tweet_id
from public.jobs j where j.type = 'deliver'
order by j.created_at, j.id;
select d.id, d.subject_type, d.subject_id, d.status, d.attempts,
       d.telegram_message_ids, d.last_error, d.created_at,
       d.last_attempt_at, d.posted_at
from public.deliveries d order by d.created_at, d.id;
select x.id, x.post_id, x.status, x.x_tweet_id, x.attempts, x.last_error,
       x.skip_reason, x.created_at, x.updated_at, x.claim_token,
       x.claim_source, x.claim_started_at, x.claim_expires_at,
       x.claim_released_at, x.claim_release_reason
from public.x_deliveries x order by x.created_at, x.id;
select r.id, r.tweet_id, r.status, r.attempts, r.error, r.block_reason,
       r.output_storage_path, r.locked_at, r.locked_by,
       r.lease_expires_at, r.created_at, r.updated_at,
       r.started_at, r.completed_at, r.failed_at, r.blocked_at
from public.video_renders r order by r.created_at, r.id;
```

After initialization, repeat the following against the immutable historical
cohort only:

```sql
with c as (select public.get_delivery_cutover() as t)
select j.id, j.status, j.created_at, j.updated_at, j.attempts,
       j.last_error, j.locked_at, j.locked_by, j.lease_expires_at,
       j.started_at, j.completed_at,
       nullif(btrim(j.payload->>'tweet_id'), '') as tweet_id
from public.jobs j cross join c
where j.type = 'deliver'
  and (j.created_at <= c.t or nullif(btrim(j.payload->>'tweet_id'), '') is null)
order by j.created_at, j.id;
select d.id, d.subject_type, d.subject_id, d.status, d.attempts,
       d.telegram_message_ids, d.last_error, d.created_at,
       d.last_attempt_at, d.posted_at
from public.deliveries d
where d.created_at <= (select public.get_delivery_cutover())
   or d.subject_type is distinct from 'post'
   or nullif(btrim(d.subject_id), '') is null
order by d.created_at, d.id;
select x.id, x.post_id, x.status, x.x_tweet_id, x.attempts, x.last_error,
       x.skip_reason, x.created_at, x.updated_at, x.claim_token,
       x.claim_source, x.claim_started_at, x.claim_expires_at,
       x.claim_released_at, x.claim_release_reason
from public.x_deliveries x
where x.created_at <= (select public.get_delivery_cutover())
   or nullif(btrim(x.post_id), '') is null
order by x.created_at, x.id;
select r.id, r.tweet_id, r.status, r.attempts, r.error, r.block_reason,
       r.output_storage_path, r.locked_at, r.locked_by,
       r.lease_expires_at, r.created_at, r.updated_at,
       r.started_at, r.completed_at, r.failed_at, r.blocked_at
from public.video_renders r
where r.created_at <= (select public.get_delivery_cutover())
   or nullif(btrim(r.tweet_id), '') is null
order by r.created_at, r.id;

-- Compact comparisons for the release receipt. The row snapshots above are
-- authoritative when a count or max timestamp changes.
select j.status, count(*) as rows, sum(coalesce(j.attempts, 0)) as attempts,
       count(*) filter (where j.locked_at is not null) as locked
from public.jobs j
where j.type = 'deliver'
  and (j.created_at <= (select public.get_delivery_cutover())
       or nullif(btrim(j.payload->>'tweet_id'), '') is null)
group by j.status order by j.status;
select d.status, count(*) as rows, sum(coalesce(d.attempts, 0)) as attempts,
       count(*) filter (where d.telegram_message_ids is not null) as provider_ids,
       max(d.last_attempt_at) as max_last_attempt_at,
       max(d.posted_at) as max_posted_at
from public.deliveries d
where d.created_at <= (select public.get_delivery_cutover())
   or d.subject_type is distinct from 'post'
   or nullif(btrim(d.subject_id), '') is null
group by d.status order by d.status;
select x.status, count(*) as rows, sum(coalesce(x.attempts, 0)) as attempts,
       count(*) filter (where x.x_tweet_id is not null) as provider_ids,
       max(x.updated_at) as max_updated_at,
       max(x.posted_at) as max_posted_at
from public.x_deliveries x
where x.created_at <= (select public.get_delivery_cutover())
   or nullif(btrim(x.post_id), '') is null
group by x.status order by x.status;
```

The first block is the broad pre-initialization snapshot. The second block is
the immutable historical-cohort evidence. New post-T rows must not be mixed
into old-cohort evidence. Verify all
rows present at initialization are pre-T and unchanged. For a historical row,
compare its status, attempts, provider IDs, and error fields against the
baseline. Any change or provider attempt is an immediate kill condition.
Historical `video_renders` are different: queued or expired-running renders
may move through running, completed, failed, or blocked and may update
attempts, error/output, and lease fields as normal processing. Those transitions
are allowed and must be recorded separately from the immutable delivery cohort.

The append-only migration
`20260830120000_enforce_historical_delivery_zero_write.sql` supersedes the
older settlement behavior. `reconcile_stuck_jobs()` excludes historical
`deliver` rows before any update, and `settle_delivery_cutover_blocked` is now a
service-role-only compatibility no-op that returns `false`. The
`trg_00_historical_delivery_job_zero_write` trigger rejects an update or delete
of a historical `jobs` row when `OLD.type = 'deliver'` and
`delivery_cutover_allows_job(...)` is false, with
`delivery_cutover_blocked:historical_deliver_job_zero_write`. Do not settle,
requeue, delete, or otherwise mutate historical delivery rows; record them as
unchanged evidence with zero provider writes.

## Rollback

Rollback means, in this order: set `ALLOW_EXTERNAL_POSTING=false`, set database
posting to `blocked`, set `x_posting_config.enabled=false`, disable cron job 20,
then redeploy the prior guarded Edge versions. Never delete the cutover row,
unset T, requeue historical jobs, or restore the old X start floor. The
singleton and historical guards remain in place during rollback.

```sql
update public.runtime_controls
set posting_mode = 'blocked'
where singleton_key = true;

-- Run through the deployment control plane, not as a SQL mutation:
-- ALLOW_EXTERNAL_POSTING=false; x_posting_config.enabled=false; cron 20 inactive.
-- Then repeat the T-filtered historical-cohort queries above.
```

The rollback is not complete until the provider-attempt counters, provider IDs,
historical statuses, and claim rows remain unchanged after the worker/X cron
ticks. Record any ambiguous provider response as a halt, not a retry.

## Stage order

1. Deploy the migration and guarded Edge functions with runtime blocked.
2. Initialize T exactly once and verify the historical baseline.
3. Enable Telegram only, wait for one natural automatic post-T item, then verify no old-row mutation.
4. Enable X config/cron only after Telegram passes, wait for at most one natural automatic post-T item, then verify again. If no natural item arrives in a bounded observation window, report `LIVE_CANARY_PENDING` and leave the safe new-only controls enabled.
5. Keep v2 preview-only. Do not use an old item or synthetic post as a canary.
