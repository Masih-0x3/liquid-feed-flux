# XOT Backup And Restore Runbook

Current evidence date: 2026-07-14

Project reference: `jzirqfzzvlbxwfzndaer`

## Readiness Verdict

Recovery readiness is **blocked**. Do not use a production restore as a drill and
do not claim an RPO or RTO until a disposable restore has completed successfully.

Read-only provider evidence on 2026-07-14 showed:

- Plan: Pro.
- Physical backup mechanism: WAL-G enabled.
- Point-in-time recovery: disabled.
- Daily backup records: seven, covering 2026-07-07 through 2026-07-13.
- Successful XOT restore drill receipt: none.
- Validated database RPO/RTO: unknown.
- Validated Storage-object recovery: none.

This closes only the inventory step. It does not prove that any listed backup is
restorable or that application workflows survive a restore.

## Provider Behavior That Affects XOT

Supabase currently documents seven days of automatic backups on Pro. A direct
PITR restore makes the target project inaccessible during restoration. Paid
projects with physical backups can use the provider's restore-to-new-project or
clone workflow, but that is not automatically safe for XOT: the cloned database
may start restored `pg_cron`/`pg_net` jobs before an operator can inspect it.

Database backups contain Storage metadata, not the underlying Storage objects.
Restoring an older database backup cannot recreate objects deleted after the
backup. XOT therefore must back up and validate referenced objects separately;
the `temp-media` bucket is not treated as disposable while shared-path and
missing-object remediation remains open.

References:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/clone-project>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>

## Preconditions For A Restore Drill

The database owner must approve a disposable target and a backup/recovery point.
Record all of the following before any provider-side action:

1. Source project reference and current production commit SHA.
2. Backup identifier or recovery timestamp and its retention expiry.
3. Disposable target project reference; it must not have production DNS,
   webhooks, cron, queues, provider credentials, or outbound network access.
4. Expected migration-ledger count and maximum version from the source snapshot.
5. Redacted schema, row-count, cron, and Storage metadata fingerprints.
6. Kill criteria, owner, start time, and a deletion deadline for the target.

The target must be inside a deny-all egress boundary **before its database can
start**. Two production-gateway HTTP 401 events matched the 2026-07-14 local
replay cron cadence; source IP was unavailable, so this is a strong inference,
not proof that the replay originated both requests. That failure mode must not
recur in a restore drill.

At this checkpoint, no provider-supported pre-start cron suppression or egress
firewall has been proven for managed Supabase clones. Therefore a managed clone
is blocked as the drill target unless the provider exposes such a control and a
pre-start receipt proves it. Post-start inspection is too late.

## Safe Disposable Restore Procedure

1. Provision a self-controlled disposable Postgres/Supabase target inside a
   firewall or Docker internal network that has already passed an outbound
   denial probe. Never select the production project as the drill target.
2. Capture infrastructure evidence that the database container has no secondary
   network, default egress route, production DNS path, or reachable provider
   endpoint. This control must exist before restore/start.
3. Restore into that pre-isolated target. If a managed provider clone is ever
   used, first attach a provider-supported pre-start deny-all control and retain
   its receipt; otherwise stop here.
4. Confirm the target is clearly labeled non-production and that no production
   DNS alias points to it.
5. Do not deploy current Edge Functions yet. First inspect restored database
   extensions, cron jobs, network jobs, roles, grants, policies, and migration
   history.
6. Disable restored cron/network definitions transactionally or redirect them to
   a loopback no-op receiver while the infrastructure firewall remains active.
7. Restore/copy Storage objects separately into non-production buckets. Compare
   object listings with database metadata and referenced media paths.
8. Deploy the exact source SHA under test with non-production secrets only.
9. Run the validation matrix below without sending Telegram, X, OpenAI, or other
   provider traffic.
10. Capture the receipt, stop the target, and delete it by the recorded deadline.

## Validation Matrix

Database and migration checks:

```sql
select count(*) as applied_migrations,
       max(version) as latest_version
from supabase_migrations.schema_migrations;

select to_regclass('public.posts') is not null as posts_exists,
       to_regclass('public.jobs') is not null as jobs_exists,
       to_regclass('public.media') is not null as media_exists,
       to_regclass('public.pipeline_events') is not null as pipeline_events_exists;
```

Also compare, using redacted counts or hashes rather than row contents:

- Public tables, columns, indexes, constraints, policies, functions, and grants.
- Critical row counts and current settings fingerprints.
- Migration ledger count, version set, and statement-body hashes where available.
- Disabled cron/network jobs before any application smoke test.
- Generated TypeScript structure against the approved migration replay.

Storage checks:

- Bucket inventory and object count.
- Database metadata count versus actual object listing.
- Referenced paths present, missing, shared by multiple rows, and orphaned.
- A bounded sample can be read and has expected content type/size.
- No test writes or deletes reach the production bucket.

Application checks:

- Admin login and role boundaries.
- Dashboard, Monitoring, and Settings reads.
- Queue reads and a synthetic transaction that is rolled back.
- Edge authorization negatives using non-production credentials.
- No outbound provider call, webhook, cron enqueue, or cleanup mutation.

## Restore Drill Receipt

Append a redacted receipt to the implementation ledger containing:

- Source backup/recovery timestamp and disposable target reference.
- Source and tested commit SHA.
- Start/end timestamps, measured restore duration, and measured data loss window.
- Migration/schema/grant/type comparison results.
- Storage metadata/object reconciliation counts.
- Application and authorization smoke results.
- Evidence that outbound traffic remained blocked.
- Cleanup confirmation for the disposable target.
- Reviewer and database-owner approval.

Only a successful receipt may establish the real RPO/RTO and close
`restore-readiness` in the migration manifest.

## Emergency Production Recovery

An actual incident is a separate, owner-approved operation. Freeze writes,
capture current evidence, select the recovery point, communicate downtime, and
use the provider's production restore only after incident command approves the
data-loss window. After restoration, reconcile Storage objects separately,
redeploy the known-good Edge/source SHA, validate authorization and workflows,
and record the incident receipt. Never reactivate cleanup jobs or accumulated
queues until their backlogs are reviewed.
