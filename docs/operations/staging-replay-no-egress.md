# Target-bound staging replay boundary

This is a reviewable, local-only replay path. It is not staging acceptance and
it does not authorize a database, Supabase, Vercel, renderer, provider, or
production action.

## Required boundary

Use the disposable E7 runner only with its fixed internal network and exact
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

For the migration/type replay, use only the disposable command after Docker
and the exact local CLI are independently verified:

```bash
E7_EMIT_TYPES_BASE64=1 npm run test:e7-disposable-boundary
```

Do not set linked-project, service-role, database-password, production URL, or
provider credentials. Do not run `supabase db push`, `supabase migration
repair`, or any replay against a linked or hosted target. A successful local
replay remains T0/T1 evidence only and cannot close staging, hosted, live, or
release gates.
