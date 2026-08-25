# XOT v1 delivery cutover runbook

This runbook is for the v1 Telegram/X continuity cutover. Keep runtime
posting blocked and the external breaker false until the checks below pass.

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

## Before/after evidence

Capture this read-only baseline before initialization, and repeat it after
each stage. Store the output with the release receipt; do not mutate any row
to make the counts agree.

```sql
select now() as db_clock;
select environment, posting_mode, updated_at from public.runtime_controls;
select j.type, j.status, count(*) as rows, sum(j.attempts) as attempts,
       max(j.updated_at) as max_updated_at, max(j.created_at) as max_created_at
from public.jobs j
group by j.type, j.status order by j.type, j.status;
select d.status, count(*) as rows, sum(d.attempts) as attempts,
       max(d.last_attempt_at) as max_last_attempt_at,
       max(d.posted_at) as max_posted_at
from public.deliveries d group by d.status order by d.status;
select x.status, count(*) as rows, sum(x.attempts) as attempts,
       max(x.updated_at) as max_updated_at,
       count(*) filter (where x.x_tweet_id is not null) as provider_ids
from public.x_deliveries x group by x.status order by x.status;
select count(*) filter (where status in ('queued','running')) as active_renders,
       max(updated_at) as max_updated_at
from public.video_renders;
```

After initialization, repeat the following against the immutable historical
cohort only:

```sql
select j.type, j.status, count(*) as rows, sum(j.attempts) as attempts,
       max(j.updated_at) as max_updated_at, max(j.created_at) as max_created_at
from public.jobs j
where j.type = 'deliver'
  and j.created_at <= (select delivery_cutover_at from public.delivery_cutover)
group by j.type, j.status order by j.status;
select d.status, count(*) as rows, sum(d.attempts) as attempts,
       max(d.last_attempt_at) as max_last_attempt_at,
       max(d.posted_at) as max_posted_at
from public.deliveries d
where d.created_at <= (select delivery_cutover_at from public.delivery_cutover)
group by d.status order by d.status;
select x.status, count(*) as rows, sum(x.attempts) as attempts,
       max(x.updated_at) as max_updated_at,
       count(*) filter (where x.x_tweet_id is not null) as provider_ids
from public.x_deliveries x
where x.created_at <= (select delivery_cutover_at from public.delivery_cutover)
group by x.status order by x.status;
select count(*) filter (where status in ('queued','running')) as active_renders,
       max(updated_at) as max_updated_at
from public.video_renders
where created_at <= (select delivery_cutover_at from public.delivery_cutover);
```

The first block is the broad pre-initialization snapshot. The second block is
the immutable historical-cohort evidence. New post-T rows must not be mixed
into old-cohort evidence. Verify all
rows present at initialization are pre-T and unchanged. For a historical row,
compare its status, attempts, provider IDs, and error fields against the
baseline. Any change or provider attempt is an immediate kill condition.

## Rollback

Rollback means, in this order: set `ALLOW_EXTERNAL_POSTING=false`, set database
posting to `blocked`, set `x_posting_config.enabled=false`, disable the X cron,
then redeploy the prior guarded Edge versions. Never delete the cutover row,
unset T, requeue historical jobs, or restore the old X start floor. The
singleton and historical guards remain in place during rollback.

```sql
update public.runtime_controls
set posting_mode = 'blocked'
where singleton_key = true;

-- Run through the deployment control plane, not as a SQL mutation:
-- ALLOW_EXTERNAL_POSTING=false; x_posting_config.enabled=false; X cron inactive.
-- Then repeat the T-filtered historical-cohort queries above.
```

The rollback is not complete until the provider-attempt counters, provider IDs,
historical statuses, and claim rows remain unchanged after the worker/X cron
ticks. Record any ambiguous provider response as a halt, not a retry.

## Stage order

1. Deploy the migration and guarded Edge functions with runtime blocked.
2. Initialize T exactly once and verify the historical baseline.
3. Enable Telegram only, wait for one natural automatic post-T item, then verify no old-row mutation.
4. Enable X config/cron only after Telegram passes, wait for at most one natural automatic post-T item, then verify again.
5. Keep v2 preview-only. Do not use an old item or synthetic post as a canary.
