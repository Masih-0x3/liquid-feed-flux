# Target-bound staging replay boundary

This is a reviewable, local-only replay path. It is not staging acceptance and
it does not authorize a database, Supabase, Vercel, renderer, provider, or
production action.

## Required boundary

For the historical E7 candidate, use its runner only with its fixed internal network and exact
checked-in runtime. The runner strips Supabase credentials and target URLs,
uses `--network` only for its task-owned internal network, publishes no ports,
and requires the pinned Supabase CLI `2.111.0` before generated-type capture.
It records owned containers and networks before inspection and removes only
those recorded resources during cleanup.

The focused remote-media boundary is the second, no-egress check:

```bash
npm run check:remote-media-no-egress
npm run test:remote-media-no-egress
```

The test must keep Deno's `--deny-net` flag. It proves the helper rejects
forbidden remote targets and tears down its bounded timeout; it does not prove
staging or production behavior.

For that historical migration/type replay, use only the disposable command after Docker
and the exact local CLI are independently verified:

```bash
E7_EMIT_TYPES_BASE64=1 npm run test:e7-disposable-boundary
```

## Current 137-migration candidate — September 7, 2026

The owner approved updating the release baseline/tooling and downloading the
exact pinned PostgreSQL image. Historical E7/E10 receipts and runtime pins remain
unchanged. Do not change their 123/129 inventory constants to impersonate an old
acceptance result. Use the separately pinned current candidate:

```bash
node --test scripts/check-migration-baseline.test.mjs scripts/e10SqlBoundary.test.mjs
node scripts/run-current-release-sql-boundary.mjs
```

The current runner requires all 137 migration bodies to match the committed
inventory digest. It uses the same exact PostgreSQL image digest as E10, a
task-owned `network=none` container, one CPU/1 GiB, no host mounts and no published
ports. It verifies no non-loopback route and a denied connection to a reserved
documentation address. The cached, pinned postgres-meta helper shares only that
database's no-egress namespace, with one CPU/512 MiB and exact-ID ownership and
cleanup checks. Its receipt accurately records direct postgres-meta invocation;
it does not claim a hosted or linked CLI type capture.

The tests preserve E10's RLS, grants, singleton and rejected-mutation checks.
The August 25 bridge's safe seeded singleton is checked explicitly; legacy
empty-table insert assertions run inside a rollback. The existing guarded
Preview feedback regression runs unchanged on synthetic local fixtures.

Protected SQL, catalog, generated types and resource snapshots are written only
to a new 0700 directory under the existing ignored `supabase/.temp/`, with 0600
files. The runner emits acceptance only after database/helper removal and
unchanged unrelated-resource checks. Docker mount array order is normalized;
no mount field, identity, resource or change is ignored.

`npm run check:migration-release` now uses the append-only current baseline when
present, while still validating historical/successor integrity. Supply its
protected inputs explicitly with `--remote-json`, `--replay-schema`,
`--production-schema`, `--production-types`, `--replay-types` and `--types-receipt`.
The current contract accepts the truthful pinned CLI capture provenance and
hash-verifies raw history only inside the private ignored boundary. It preserves
all seven release gates, owner-review requirements, the six-hour freshness
window, exact type parity, reproduced schema/privilege facts, and the clean
reviewed-source/evidence-commit chain. Historical credentials are never copied
into the public baseline; their handling remains an explicit owner-review item.

See the [current baseline](../plans/2026-09-07-xot-current-release-baseline.json)
and [local replay receipt](../plans/2026-09-07-xot-current-release-sql-replay.json).
These local results are not a backup restore, hosted CI, Production migration,
deployment approval, or complete release acceptance.

Do not set linked-project, service-role, database-password, production URL, or
provider credentials. Do not run `supabase db push`, `supabase migration
repair`, or any replay against a linked or hosted target. A successful local
replay remains T0/T1 evidence only and cannot close staging, hosted, live, or
release gates.
