# Phase 0 containment notice — cleanup and release hold

Status: active safety hold, documented from the read-only containment receipt dated 2026-07-14. This notice is an operator control, not proof that the current deployment has been rechecked.

Project: `jzirqfzzvlbxwfzndaer`  
Scope: `BR-00`, `SR-REL-00`, `AIR-001`, `AIR-009`, and `AIR-065`.

## Do not reactivate cleanup

The read-only receipt recorded both scheduled callers inactive:

- `invoke-db-cleanup-daily` — job `17`, schedule `0 3 * * *`, `active=false`.
- `invoke-media-cleanup-6h` — job `19`, schedule `0 */6 * * *`, `active=false`.

Keep both schedules paused. The reversible form is `cron.alter_job(job_id := <jobid>, active := true)`, but it is not authorized during this hold. Do not unschedule or delete the jobs. Do not manually invoke non-dry `db-cleanup`, `media-cleanup`, `media-processor` `cleanup_old_media`, or `public.cleanup_old_data(integer, integer)`; the privileged RPC remains a separate database-side risk.

Dry-run inventory is allowed only when it performs bounded reads and zero storage, database, RPC, or nested-function mutation. A dry-run result is not proof that a path is safe to delete.

## Source and release boundary

The source candidate contains exact-value fail-closed guards `DB_CLEANUP_MUTATIONS_ENABLED` and `MEDIA_CLEANUP_MUTATIONS_ENABLED`; only lowercase `true` enables mutations. The last containment receipt did not prove those guards deployed, so the paused schedules remain the live control. Never set either flag to `true` until reference-aware cleanup passes the migration, fault, shadow, canary, and release gates.

Migration history is governed by the active body/effect ledger at [`2026-07-14-xot-migration-equivalence-ledger.jsonl`](../plans/2026-07-14-xot-migration-equivalence-ledger.jsonl). Do not run broad `supabase db push`, timestamp-only repair, schema changes, or privilege changes while any disposition is `unknown` or owner evidence is missing.

The characterization and fault evidence is source-only: [`cleanupEntryPoints.test.ts`](../../supabase/functions/_shared/cleanupEntryPoints.test.ts), [`cleanupSafety.test.ts`](../../supabase/functions/_shared/cleanupSafety.test.ts), and [`legacyMediaCleanup.test.ts`](../../supabase/functions/_shared/legacyMediaCleanup.test.ts). These tests prove local handler boundaries and storage-failure ordering; they do not prove deployed function behavior, database grants, or live cleanup state.

Owner: release/database/security operator. Required next evidence: fresh read-only cron and in-flight verification, bounded reference inventory, protected migration owner review, deployed function/hash proof, then controlled reference-aware canary. Until those receipts exist, treat cleanup as disabled and the release as blocked.
