# XOT Database And Supabase Type Trust

Date: 2026-06-14

Branch: `codex/xot-cleanup-24-database-type-trust`

This document records the current database migration and generated type trust state. It is intentionally read-only: no migration was pushed, no migration history was repaired, and checked-in generated types were not overwritten in this phase.

## Verdict

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
