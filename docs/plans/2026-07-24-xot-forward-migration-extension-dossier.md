# XOT Forward-Migration Extension Dossier

Status: unapproved source-only evidence  
Recorded: 2026-07-24  
Owner gate: database owner, security owner, and release owner

## Purpose and boundary

This dossier records the forward migrations now present after the immutable
2026-07-14 SR-MIG-01 candidate snapshot. It is not a replacement for
`docs/plans/2026-07-14-xot-migration-equivalence-manifest.json`, does not
alter its protected observations, and is not authority to run `supabase db
push`, `supabase migration repair`, a replay, or a deploy.

The frozen manifest's candidate ends at `20260703013000` with 107 active
migrations. The current worktree has 111 active root migrations. Its baseline
validator fails closed rather than silently accepting these four additions.

## Current forward candidates

| Version | File | Bytes | SHA-256 | Current source status |
| --- | --- | ---: | --- | --- |
| `20260715074510` | `video_render_review_state.sql` | 1,207 | `9dda9bca700629c972b8856d6deb082dfb10a6c1d484017c5103c7b067ab0187` | Unclassified local forward candidate. Adds reversible operator review metadata/indexing; needs an owner disposition before baseline extension. |
| `20260722162000` | `video_render_feedback_revision.sql` | 2,938 | `af5ee529552719d27225f3b13e406153e34ba129a6236788e87faf89993a4d4c` | AIR-063 source-only acceptance exists. Adds render revision and service-role-only atomic feedback RPC; database transaction/ACL proof remains required. |
| `20260723173100` | `lock_down_video_render_raw_tables.sql` | 4,340 | `5c2250da37f6b876080c9bf48043ab3969cc7a617dcf66a8d3e54b31a4d571a3` | SR-RLS-01 source-only acceptance exists. Removes browser role access to four raw tables; role matrix and runtime compatibility proof remain required. |
| `20260724183000` | `add_current_user_is_admin_rpc.sql` | 680 | `cedd28e0976f70bdff25ac2e3025c407fb27af4beff1d3ebc14f888be8a08602` | AIR-072 source-only acceptance exists. Adds the caller-bound `current_user_is_admin()` RPC; deployed definition/ACL and role matrix remain required. |

These hashes identify the current local bytes only. They are neither evidence
of remote application nor approval to update an immutable observation record.

## Exact current blocker

On 2026-07-24, `node scripts/check-migration-baseline.mjs` failed with:

1. active migration versions and filename/body inventory differ from the
   reviewed candidate input;
2. all four candidates above differ from immutable observed local bodies,
   because they post-date the frozen candidate;
3. the archived
   `supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql`
   hash is `72d7e0c9ef610594fb937f8a59f7a6ab77698b43c776ba1a875a56ae9d38edb5`,
   while the immutable observation records
   `aca3dee43e4f85e4bac95bf3b70aeb0b821ac9fafea9dfe298cc3c87c3864973`.

The archived alias has no current worktree diff, so it must not be overwritten
from guesswork. Recover the immutable source/body from the protected
observation before making any archival or history decision.

## Required owner workflow

1. Obtain the protected remote migration export, immutable observed local
   source, current production schema/privilege dumps, and restore/PITR receipt.
   Do not add any raw provider export to Git.
2. In a disposable, no-egress environment, reproduce the existing manifest
   byte-for-byte before proposing an extension. Resolve the archived alias from
   protected source rather than the current hash alone.
3. Create a separately reviewed *new* candidate inventory that contains these
   four forward migrations and records a body/effect disposition for each.
   Preserve the 2026-07-14 manifest unchanged as the original observation.
4. Complete the existing missing-body, 92-entry owner-review, privilege-drift,
   restore-readiness, type-trust, and safe-replay gates from
   `docs/operations/database-type-trust.md`.
5. Only after those gates are accepted, apply migrations in forward order to a
   disposable database, run the role/function/feedback matrices, and then
   consider an approved release wave. Any production schema correction remains
   forward-only.

## Forbidden shortcuts

- Do not change a historical migration timestamp or body to make the current
  baseline green.
- Do not update the protected manifest or archived alias merely to match the
  current worktree.
- Do not use a matching filename/count, normalized SQL, or locally generated
  JSON as proof of remote equivalence.
- Do not run a database push, migration repair, replay, provider call, or
  deployment while this dossier is the only new evidence.
