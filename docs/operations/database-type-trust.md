# XOT Database And Supabase Type Trust

Current evidence date: 2026-07-14

Candidate branch: `codex/xot-sr-mig-01`

This document separates the current blocked Phase 1 evidence from the historical
2026-06-14 snapshot. No migration was pushed, no remote migration history was
repaired, and checked-in generated types were not overwritten.

## Current Verdict

Do not run `supabase db push`, `supabase migration repair`, or any broad linked
schema command from this repository. SR-MIG-01 and the Phase 1 release gate are
blocked.

The repository now has an immutable manifest of the original observation and a
separate candidate source inventory:

- Original observation: 105 local entries plus 105 remote entries, or 210
  historical side entries across 185 unique versions.
- Current candidate source: 107 active migration files. The old executable
  `20250903140000` alias is archived, and source matching the remote body modulo
  one terminal LF for remote versions
  `20250904033120`, `20250904033146`, and `20250905010114` is restored.
- Evidence strength: 118 side entries are raw-hash-proven; 92 remain pending
  database-owner review. Non-lexical normalized hashes are diagnostic only and
  are never treated as semantic proof.

The candidate replay reached `20260703013000` twice and produced the expected 12
prerequisite columns, five indexes, current 20-column pipeline RPC, and a rolled
back retry probe. That proves the candidate can construct the public schema. It
does **not** provide an accepted replay receipt: outbound isolation was not
proven, and two production-gateway `worker` requests returned HTTP 401 at
`2026-07-14T10:09:01.913Z` and `2026-07-14T10:10:01.044Z`. Their timing matches
the disposable replay cron cadence, but source IP was not available, so the
attribution is an inference. The local Supabase stack is stopped and must not be
restarted until egress is blocked or all network jobs are routed to a local
no-op target.

## Current Diff And Type Evidence

- Public structure excluding comments and privileges has an expected-empty
  canonical diff between replay and production.
- Privileges do not match: 105 grant records are broader in production. This
  includes authenticated/anon access on operational tables and public analytics
  RPCs, so SR-RLS-01 role-matrix review is mandatory.
- Default privileges also diverge independently: replay has 9 clauses,
  production has 10, only 3 are common, 6 are replay-only, and 7 are
  production-only. The production-only defaults grant broad access on future
  public tables and sequences to `anon`, `authenticated`, and `service_role`,
  plus future functions to `service_role`. Their blast radius includes every
  later object created by `postgres`; each clause requires explicit SR-RLS-01
  disposition before another object-creating migration may ship.
- Four same-version pairs are explicitly classified as security privilege
  divergences, not serialization differences: `20260515080625`,
  `20260515084409`, `20260515104839`, and `20260516021358`.
- Remote version `20260516050042` contains no source statements. Its local grant
  effects match the live snapshot, but body equivalence is unprovable.
- Replay-generated and production-generated TypeScript structures match except
  for the production PostgREST `14.5` metadata header. The checked-in
  `src/integrations/supabase/types.ts` is still stale (1,672 lines versus 2,817
  production-generated lines) and must not be replaced until the baseline is
  approved.

Evidence artifacts:

- `docs/plans/2026-07-14-xot-migration-equivalence-manifest.json`
- `docs/plans/2026-07-14-xot-schema-privilege-diff.json`
- `scripts/build-migration-equivalence-manifest.mjs`
- `scripts/build-schema-privilege-diff.mjs`
- `scripts/check-migration-baseline.mjs`

The manifest records the original observation anchor separately from the
candidate branch base, along with tool versions and hashes for the protected
local inventory, candidate inventory, and uncommitted remote export. Its 118
raw-hash pairs carry an automated deterministic reviewer receipt; the other 92
entries name the database owner as the pending reviewer. Rebuild it only from an
immutable copy of the observed source, the current candidate, and a protected
remote export:

```bash
node scripts/build-migration-equivalence-manifest.mjs \
  /path/to/immutable-observed-migrations \
  /path/to/candidate-migrations \
  /secure/path/xot-remote-migrations.json \
  docs/plans/2026-07-14-xot-migration-equivalence-manifest.json
```

The generated file must reproduce byte-for-byte before review. The protected
remote export is evidence input and must never be added to Git.

The schema/privilege receipt is independently reproducible from the two
protected `pg_dump` artifacts. Its canonical structure hash removes only blank
lines, whole-line comments, and privilege statements; it preserves every other
byte, including quoted and dollar-quoted content. The receipt separately records
direct grants and default privileges rather than collapsing them into schema
parity.

`npm run check:migration-baseline` validates the immutable inventory and current
source hashes offline. It may pass while accurately reporting release blockers.
`npm run check:migration-release` is the fail-closed release mode and is expected
to fail until every gate is closed. A future green result also requires the
protected replay/production dumps to regenerate the committed canonical schema,
grant, classification, and default-privilege facts exactly; a matching raw hash
alone is insufficient. This includes `GRANT` and `REVOKE` statements on schemas,
tables, functions, and sequences. Typed owner/gate evidence packages and their
required check artifacts are hash-verified, secret-scanned, and checked against
their specific entries/gates. The reviewed code commit must be the direct parent
of a clean evidence-only commit containing only the manifest and privilege
receipt changes. The validator freezes the immutable manifest projection against
that parent, including project/anchors, active source inventory, historical body
facts and hashes, dispositions, and blocker definitions.

Gate JSON proves integrity and binding after capture; it does not authenticate an
external provider by itself. Final release trust therefore also requires the
named database/security/release owners to verify the referenced GitHub run,
Supabase logs and backups, restore target, and role/type evidence through a
branch-protected review. An author-created JSON assertion is not release proof.

## Blocking Gates And Required Resolution

1. **Replay egress:** rerun from a clean database with a captured no-egress or
   loopback-only receipt; verify production Edge logs receive no replay calls.
2. **Restore readiness:** enable PITR or approve an equivalent recovery contract,
   then complete a disposable-project restore drill and retain validation output.
3. **Owner review:** review all 92 pending entries with body-aware or
   statement-aware evidence. Normalized hashes alone cannot close a disposition.
4. **Missing body:** recover `20260516050042` source or approve a new forward-only
   migration that reasserts the intended restrictive grants.
5. **Privilege drift:** run the anon, viewer, authenticated-admin, service-role,
   and renderer matrix; author a forward-only privilege migration after review.
6. **Hosted CI:** GitHub Actions must execute successfully; the current account
   billing/spending failure occurs before checkout and is not a test result.
7. **Types:** only after the exact schema baseline is approved, regenerate linked
   and replay types, require byte/structural parity, then replace the checked-in
   file in a dedicated reviewed slice.

The restored historical files make clean construction possible, but they do not
make Supabase CLI history parity safe. Renamed historical versions remain
divergent from the linked ledger, so timestamp-only repair is prohibited.

## Historical 2026-06-14 Snapshot

Historical branch: `codex/xot-cleanup-24-database-type-trust`

The remainder of this file is retained as the earlier read-only snapshot.

### Historical Verdict

Do not run `supabase db push` from this repository yet.

The local and remote migration counts both report 96 versions, but the version sets do not match. There are 78 local-only migration versions and 78 remote-only migration versions. Only 18 versions match exactly.

The checked-in Supabase generated types are also stale compared with the linked production schema. A production type generation into `/tmp/xot-linked-types.ts` produced a 2377-line file versus the checked-in 1657-line file. The generated file includes production objects and `posts` columns that are missing from the checked-in type file.

## Commands Run

```bash
find supabase/migrations -maxdepth 1 -type f | sort
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked --output csv "select version from supabase_migrations.schema_migrations order by version"
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db diff --linked --schema public
SUPABASE_TELEMETRY_DISABLED=1 npx supabase gen types typescript --linked --schema public > /tmp/xot-linked-types.ts
cmp -s src/integrations/supabase/types.ts /tmp/xot-linked-types.ts
```

## Migration Inventory

Local migration files:

```text
96
```

Remote applied migration versions:

```text
96
```

Exact version matches:

```text
18
```

Local-only migration versions:

```text
78
```

Remote-only migration versions:

```text
78
```

Matching versions:

```text
20260515075613
20260515080625
20260515084409
20260515104839
20260516021358
20260516050042
20260516072003
20260516091651
20260516092627
20260517091837
20260517140817
20260518143606
20260518201408
20260522030027
20260523140122
20260602035014
20260602061229
20260614064657
```

## Drift Pattern

Most early local migration files appear to be timestamp-shifted relative to remote applied versions. Example pairs from the migration list show remote timestamps such as `20250902044607`, while local has corresponding later versions such as `20250902164607`.

There are also local-only named migrations from May and June 2026 that are not present in the remote migration history by the same version:

```text
20260513180000_verify_webhook_internal_token.sql
20260514103000_x_poster_cron_respect_enabled.sql
20260514120000_feedback_learning_storage.sql
20260514160000_enrichment_pipeline.sql
20260514180000_follower_review_status.sql
20260514190000_add_following_ids.sql
20260609201533_video_render_pipeline.sql
20260609213357_v2_scoring_tuning_policy.sql
```

Those features may still exist in production through differently timestamped remote migrations or manual deployment history, but this phase did not prove file-by-file equivalence. Treat those as unresolved until the SQL bodies are mapped.

## Local-Only Versions

```text
20250902164607
20250902172822
20250902173238
20250902203545
20250902213839
20250902213857
20250902214327
20250902234705
20250902234736
20250902234908
20250903005714
20250903014813
20250903015813
20250903020258
20250903020456
20250903020940
20250903022256
20250903140000
20260226200038
20260226200321
20260226201153
20260226203309
20260319115558
20260320004655
20260320055853
20260320055907
20260320081419
20260320125020
20260320140507
20260320160659
20260320162001
20260320165323
20260320165620
20260320170033
20260321063115
20260404124348
20260413125431
20260413125542
20260413133631
20260413144422
20260413145620
20260415081447
20260415093908
20260415103405
20260418041632
20260418073136
20260418133725
20260418135312
20260418152635
20260418160410
20260425094604
20260426023757
20260428072856
20260428125603
20260428125641
20260428132610
20260428133038
20260428133709
20260428134935
20260430104113
20260430110154
20260501011410
20260507235716
20260508000554
20260508004959
20260508005913
20260512010913
20260512024751
20260513074341
20260513092325
20260513180000
20260514103000
20260514120000
20260514160000
20260514180000
20260514190000
20260609201533
20260609213357
```

## Remote-Only Versions

```text
20250902044607
20250902052820
20250902053237
20250902083544
20250902093838
20250902093856
20250902094325
20250902114704
20250902114735
20250902114907
20250903014811
20250903015811
20250903020257
20250903020454
20250903020939
20250903022255
20250903125713
20250904033120
20250904033146
20250905010114
20260226200037
20260226200319
20260226201151
20260226203308
20260319115556
20260320004647
20260320055851
20260320055906
20260320081417
20260320125018
20260320140505
20260320160657
20260320161959
20260320165318
20260320165618
20260320170031
20260321063031
20260404124347
20260413125429
20260413125541
20260413133611
20260413144420
20260413145554
20260415081445
20260415093859
20260415103403
20260418041623
20260418073134
20260418133724
20260418135310
20260418152633
20260418160408
20260425094602
20260426023755
20260428072852
20260428125559
20260428125639
20260428132607
20260428133005
20260428133707
20260428134932
20260430104111
20260430110152
20260501011408
20260507235715
20260508000552
20260508004957
20260508005911
20260512010911
20260512024749
20260513074339
20260513092323
20260513203218
20260513211212
20260513223207
20260514163302
20260514173818
20260514175208
```

## Schema Diff Attempt

`SUPABASE_TELEMETRY_DISABLED=1 npx supabase db diff --linked --schema public` did not produce a diff. It failed before schema inspection because Docker was unavailable:

```text
failed to inspect docker image: Cannot connect to the Docker daemon at unix:///Users/stevmq/.docker/run/docker.sock. Is the docker daemon running?
```

This is an environment blocker for `supabase db diff`, not evidence that schemas match.

## Generated Type Drift

Production generated types were written to `/tmp/xot-linked-types.ts` for comparison only. The repo file was not overwritten.

Facts:

```text
src/integrations/supabase/types.ts: 1657 lines
/tmp/xot-linked-types.ts: 2377 lines
types_match=false
```

Notable differences:

- Production reports `PostgrestVersion: "14.5"`; checked-in types report `14.4`.
- Production generated types include `posts` columns missing from checked-in types:
  - `audience_class`
  - `audience_confidence`
  - `audience_reason`
  - `global_exception_class`
  - `score_review_status`
  - `scoring_profile_id`
  - `scoring_version`
- Production generated types include tables/views not represented in the checked-in type file, including:
  - `queue_reconcile_runs`
  - `scoring_evaluations`
  - `scoring_examples`
  - `video_render_feedback`
  - `video_renderer_heartbeats`
  - `video_renders`
  - `x_api_events`
  - `x_non_followback_reviews`
  - `_video_render_queue_delivery`

## Cleanup Implications

Keep current schema compatibility fallbacks until both of these are true:

1. Migration history is repaired or intentionally re-baselined.
2. `src/integrations/supabase/types.ts` is regenerated from the linked production project in a dedicated type-refresh branch and passes strict typecheck.

Do not delete monitoring/dashboard fallback paths merely because generated production types contain the newer columns. The UI still has to tolerate deployed function/schema skew during staged rollouts.

## Recommended Remediation Plan

1. Create a dedicated branch from the latest green cleanup branch:

```bash
git switch -c codex/xot-cleanup-25-supabase-migration-trust-repair
```

2. Start Docker Desktop and rerun:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db diff --linked --schema public
```

3. Map remote-only and local-only migration pairs by SQL body, not timestamp alone.

4. Choose one repair path:

- If local files match production SQL with shifted timestamps, use an explicit migration-history repair plan and document each mapped pair before running any repair command.
- If local files cannot be proven equivalent, create a new production baseline from the linked schema and archive the old migration chain as historical, not executable.

5. Only after the migration history decision, regenerate production types in a type-only branch:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts
npm run check:strict
npm test
```

6. After the type refresh is merged, revisit compatibility fallbacks in `src/api/monitoringData.ts` and `src/api/dashboardData.ts`.

## Guardrails Until Repair

- Do not run `supabase db push`.
- Do not run migration repair commands without a reviewed pair-by-pair mapping.
- Do not treat local migration count parity as safety.
- Do not treat checked-in generated types as production-complete.
- Keep release checks read-only.
