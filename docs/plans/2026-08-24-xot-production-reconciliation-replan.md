# XOT production reconciliation and full-closure replan

**Status:** implementation-ready plan; production release gate remains CLOSED

**Planning owner:** Planner, GPT-5.6 Sol, Max reasoning

**Execution owner:** GPT-5.6 Luna, High reasoning

**Repository:** /Users/stevmq/Finalized XOT

**Candidate branch:** codex/xot-full-closure-candidate

**Runtime-source anchor:** 040fd0e99f9019997debab4bdc9466d07c98c2d0

**Runtime-source tree:** aca35558dcc5025ab4e2543b6cc233dd27bf8a9a

**Orca run:** run_cdf312ef8410

**Plan date:** 2026-08-24

## 1. Operator verdict

The implementation is back on track. The candidate is clean, pushed, exact-CI green, and accepted through the isolated Preview, renderer, authenticated Preview, and joined P7 evidence lanes. Do not repeat P3 through P7 unless the runtime source changes or a current target check disproves their receipt.

Production is not ready to mutate. The current production database has material historical migration divergence, the production renderer is offline or stale, restore readiness is unproved, authenticated production acceptance is absent, and eight named gates remain open. The next work is a bounded production reconciliation and release, not another broad source remediation.

This plan makes three decisions:

1. Production migration history is the historical baseline. Apply only the exact approved forward delta. Do not rename, repair, stamp, replay, or delete historical migration entries.
2. Use semantic catalog, role, type, runtime, and provider evidence. Do not create another manual file-hash matching exercise. Existing automated integrity checks may run as regression support, but a human does not need to compare migration hashes to approve this release.
3. Run safe evidence lanes concurrently. Run every production mutation in a separate, approved, serial T4 envelope. GPT-5.6 Luna High owns all protected execution and final acceptance.

One persistent implementation goal can complete all safe work, assemble one decision packet, and continue automatically after its fields are approved. It cannot honestly promise a production mutation while human owner, approver, rollback, time-window, or spending fields are blank. Blank fields are blockers, not implied consent.

## 2. Exact source-of-truth contract

### 2.1 Evidence anchors

| Surface | Accepted source of truth | Evidence time or identity |
| --- | --- | --- |
| Local Git | Current checkout and its tracked remote | Read 2026-08-24T20:28:43Z; branch and upstream both at 040fd0e99f9019997debab4bdc9466d07c98c2d0; clean before this plan |
| Candidate runtime source | Git commit plus the named files at that commit | Commit 040fd0e99f9019997debab4bdc9466d07c98c2d0; tree aca35558dcc5025ab4e2543b6cc233dd27bf8a9a |
| Main | Current tracked main before release | 53b35436dbb42697a004b6002312a86212a48abb |
| Pull requests | GitHub read evidence | PR #70 is the draft candidate; PR #69 is excluded and must remain untouched |
| Hosted CI | GitHub run bound to the exact candidate | Run 32718978729 is green for 040fd0e; a later plan-only or release commit needs its own green run |
| Preview | Accepted P3-P7 Orca/provider/browser receipts | Isolated, ephemeral, data-less Supabase branch; exact 16 forward migrations; ten functions; exact-candidate renderer; protected frontend; authenticated admin/read_only acceptance; production unchanged |
| Production snapshot | Accepted read-only T3 capture | Captured 2026-08-24T20:17:00Z; productionChanged=false |
| Production database | Direct Supabase catalog and provider reads | 106 applied migration rows, 39 public tables, 39/39 RLS-enabled tables, 46 policies, PITR off |
| Repository database target | Current checkout | 124 local migration files and generated types with 43 public tables |
| Production frontend | Direct Vercel/provider evidence | READY deployment is from current main, not the candidate; signed-out reachability exists; authenticated acceptance does not |
| Production renderer | Direct host/network evidence | Host is offline or stale; source, digest, health, capacity, and rollback are unknown |
| Task state | Orca, not prose in old plans | run_cdf312ef8410; T3-01 update request fb79283e-f2cc-4243-8de5-557fb09e0635 accepted; T3-02 request 33020d74-b73e-49f5-b689-5ccefa5815fd blocked |
| Planning synthesis | This file | 2026-08-24 after the Git and T3 reads above |

Do not copy production references, private deployment URLs, credentials, secret values, raw policy bodies, or private row data into Git, Orca prompts, external-worker prompts, terminal titles, or chat. Use approved symbolic names such as PROD_REF, PREVIEW_REF, RENDERER_HOST, CURRENT_FRONTEND_DEPLOYMENT, and PREVIOUS_RENDERER_DIGEST.

### 2.2 Evidence precedence and freshness

Use this order when facts conflict:

1. A current direct read from the named target, with timestamp and target preflight.
2. A current provider run, deployment, immutable image, or browser receipt bound to the release commit.
3. A current hosted CI result on the exact commit.
4. Current local checks on that commit.
5. Accepted repo receipts and append-only ledgers.
6. Historical plans and worker reports, which are context only.

Refresh every production target, deployment, function-version, renderer, queue, schedule, backup, and authority fact within 30 minutes of its dependent mutation. Refresh migration and queue facts again immediately before the first database change. If the target, source commit, owner packet, or prior rollback target drifts, stop and issue a successor proposal.

Plan-only and receipt-only commits may move the PR head after 040fd0e. They do not invalidate accepted runtime evidence when a path-scoped Git diff proves that no runtime, migration, function, renderer, package, lock, workflow, or deployment configuration changed. Any change to those surfaces creates a new runtime candidate and returns execution to exact-CI and affected Preview acceptance.

### 2.3 Controlling repository evidence

- docs/plans/2026-08-22-xot-full-closure-quality-orchestrated-goal-plan.md
- docs/plans/2026-08-22-xot-full-closure-quality-orchestrated-goal-plan-implementation-ledger.jsonl
- docs/plans/2026-08-22-xot-full-closure-authorization-packet.json
- docs/plans/2026-08-21-xot-air-latest-state-and-estimate.json
- docs/plans/2026-08-24-xot-e10-preview-migration-boundary-successor-v2.json
- docs/plans/2026-08-24-xot-p4-renderer-local-build-receipt.json
- docs/plans/2026-07-31-xot-production-first-reconciliation.json
- docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl
- docs/operations/release-runbook.md
- docs/operations/backup-restore.md
- docs/operations/vercel-cutover.md
- docs/operations/supply-chain-gate.md
- services/video-renderer/README.md
- .github/workflows/ci.yml

The old full-closure plan anchor, its “implementation not started” statement, and its claim that no T2/T3 evidence exists are superseded. Its safety and acceptance contracts remain applicable where this plan does not replace them. The T2 successor refers to ledger row 545 while the canonical comprehensive ledger currently ends at 544. Correct this with an append-only successor during execution; do not edit old rows.

## 3. Accepted state and blocking unknowns

| Accepted now | Still unknown or blocked |
| --- | --- |
| Candidate branch, commit, tree, upstream, PR #70, and exact hosted CI are aligned and clean. | Named production owners, approvers, rollback operators, expiry, windows, and spending limits are blank. |
| P3 exact 16-migration Preview replay passed on an isolated ephemeral branch. | Whether each of the 16 effects is fully absent, already present, or partial in the current production catalog. |
| Preview generated types and 43-table schema matched the candidate boundary. | Formal production table/column/index/constraint/routine/type, RLS-expression, grant, default-ACL, owner, Realtime, and Storage parity. |
| Preview has zero active cron, posting blocked, and accepted admin/read_only identities. | Production runtime_controls is absent; the desired production dedupe, translation, posting, schedule, and backlog disposition is not approved. |
| Exact-candidate Preview functions, renderer, frontend, authenticated browser acceptance, and rollback were accepted. | Production functions and frontend still run main; authenticated production acceptance is absent. |
| Production read snapshot has zero running jobs and zero expired leases. | Existing dead letters and backlogs need a baseline-aware disposition before any delivery schedule is enabled. |
| Production has 39 tables, all 39 RLS-enabled, and 46 policies. | The candidate result should have 43 tables, but counts alone cannot accept policy or grant behavior. |
| Production has 106 applied remote migrations; repo has 124 files; reconciliation is 29 matched, 77 remote-only, 95 local-only. | Current production compatibility with both the old and candidate app/function/renderer versions across the migration window. |
| Eight recent physical backups exist. | PITR is off; no successful restore drill, measured RPO/RTO, or Storage-object recovery proof exists. |
| Legacy posting controls and four non-cleanup schedules are enabled; cleanup jobs 17 and 19 are inactive. | Owner choice to retain blocking or resume external posting, plus an approved policy for existing pending deliveries. |
| The production Vercel deployment is READY and has no observed recent runtime errors in the accepted snapshot. | Current main auto-deploy control, candidate production artifact provenance, predecessor verification, and alias rollback readiness. |
| The production renderer endpoint is identifiable. | Host reachability, live process, immutable current/prior digest, architecture, capacity, disk/temp headroom, health, heartbeat, and rollback. |
| WAL-G physical backups are enabled. | Whether a provider clone can be contained before restored cron/network jobs start; a managed restore is blocked until that is proven. |
| PAT-1 remains in the gate register. | Whether the historical PAT is revoked, rotated, contained, or requires action. |

The only unresolved release gates in this replan are SR-REL-00, SR-MIG-01, SR-RLS-01, PAT-1, AIR-010, AIR-017, AIR-052, and AIR-055. Do not reopen the other AIR rows unless new current evidence disproves their P7 disposition.

## 4. Forward-only database reconciliation

### 4.1 Non-negotiable boundary

Production is authoritative for historical migrations. Never run broad supabase db push, migration repair, migration squash, history delete, timestamp remap, project reset, reverse migration, or a replay of the other historical local-only files. Do not make the 77 remote-only and 79 eventual historical local-only entries cosmetically match.

Candidate 040fd0e contributes this exact ordered forward set:

1. 20260722162000_video_render_feedback_revision.sql
2. 20260723173100_lock_down_video_render_raw_tables.sql
3. 20260724183000_add_current_user_is_admin_rpc.sql
4. 20260730070000_telegram_delivery_claims.sql
5. 20260806123000_media_object_cleanup_claims.sql
6. 20260806143000_b3_job_x_claim_fencing.sql
7. 20260806153000_b3b1_rss_webhook_receipts.sql
8. 20260808110000_b3b2_digest_checkpoints.sql
9. 20260808123000_b4_video_render_claim_fencing.sql
10. 20260808133000_b2b_media_object_deletion_token_uuid.sql
11. 20260808143000_b3a_reconcile_expired_job_claims_fix.sql
12. 20260808153000_b3a_fail_x_post_delivery_null_fix.sql
13. 20260808163000_b3a_claim_x_ambiguous_retry_fix.sql
14. 20260808173000_b3a_claim_x_ambiguous_history_fix.sql
15. 20260811090000_revoke_public_default_privileges.sql
16. 20260812100000_e10_preview_runtime_controls_and_roles.sql

### 4.2 Effect classification

For each file, record one current production classification:

- ABSENT: migration row and all intended catalog effects are absent.
- PRESENT: the exact migration row is present and every intended effect matches the accepted Preview result.
- PARTIAL_OR_CONFLICTING: an effect exists without the row, differs from Preview, violates a prerequisite, or is otherwise ambiguous.

If all 16 are ABSENT, the proposed apply set is all 16 in order. If one is PRESENT, omit only that one after its full effect is proven. If one is PARTIAL_OR_CONFLICTING, stop. Create one new idempotent forward convergence migration on a successor candidate, rerun affected CI/Preview gates, and issue a successor plan. Do not rerun the old file and do not alter history.

If production remains at 106 rows and all 16 are applied, the expected remote row count is 122. The provider may record its own execution version while retaining the original file stem as the migration name. Record that mapping and leave it alone. Persistent historical divergence is acceptable. The acceptance unit is the explicit forward set and its semantic result, not equal migration counts.

### 4.3 Semantic acceptance contract

Pass SR-MIG-01 and SR-RLS-01 only when all of the following are true:

- The exact apply set is classified and approved.
- A current production-baseline replay or the retained P3 branch proves the same resulting catalog. Reuse P3 if the new snapshot matches its prerequisites; replay only if current evidence differs.
- All resulting public tables have RLS enabled.
- Policy names, commands, roles, using/check expressions, and permissive/restrictive modes match the accepted result.
- Table, sequence, routine, schema, owner, and default privileges are explicitly accepted. The provider-managed default-ACL exception in migration 20260811090000 needs a named disposition.
- Every SECURITY DEFINER routine has the accepted search_path and exact EXECUTE allowlist.
- Generated production public types structurally match checked-in types for table names, Row/Insert/Update fields, nullability, enums, relationships, and function signatures. Formatting and generator metadata may differ.
- Existing production and candidate applications both pass the migration-window compatibility probes. If not, split the transition with a new forward migration.
- The restore gate and named database/security/release approvals pass.

The July manifest and hash-heavy checker remain historical regression evidence. Do not reconstruct 77 remote-only bodies or ask an owner to match 95 local files by hash. Run the automated checker because it protects known source invariants, but record the production decision from the semantic catalog, role matrix, provider target, exact Git commit, ordered migration names, and provider migration receipts.

### 4.4 Safe read commands and queries

Run these local checks before any production proposal:

    git status --short --branch
    git rev-parse HEAD
    git diff --exit-code 040fd0e99f9019997debab4bdc9466d07c98c2d0 -- \
      supabase/migrations src/integrations/supabase/types.ts \
      supabase/functions services/video-renderer src package.json package-lock.json deno.lock vercel.json .github/workflows
    find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l
    npm run check:migration-baseline
    npm run test:migration-baseline
    npm run test:e7-disposable-boundary-contract
    node scripts/run-e10-sql-boundary.mjs
    npm run test:video-render-rls
    npm run check:strict

Run catalog reads through the approved production target inside a read-only transaction:

    BEGIN READ ONLY;

    select count(*) as migration_count, max(version) as latest_version
    from supabase_migrations.schema_migrations;

    select version, name
    from supabase_migrations.schema_migrations
    order by version;

    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname;

    select tablename, policyname, permissive, roles, cmd
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname;

    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
    order by table_name, grantee, privilege_type;

    select routine_name, specific_name, grantee, privilege_type
    from information_schema.role_routine_grants
    where routine_schema = 'public'
    order by routine_name, specific_name, grantee;

    select n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid),
           p.prosecdef, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, pg_get_function_identity_arguments(p.oid);

    COMMIT;

Store detailed results in protected evidence. Commit only normalized, redacted counts, names, classifications, and decisions.

### 4.5 Apply mechanism

Luna must use a target-bound Supabase migration operation that records one named migration in provider history. The preferred execution surface is the current Supabase Management API/MCP apply_migration operation with:

- name: the complete original filename stem, without an invented alias;
- query: the exact reviewed file content from the clean release commit;
- target: the separately preflighted production target.

Apply one file, capture the provider-recorded version/name mapping, read its migration row and intended catalog effects, then continue. If apply_migration is unavailable, stop. Do not fall back to broad db push, raw file execution without migration-history recording, or manual history inserts. An unknown or timed-out result is not safe to retry: read the ledger and catalog first, then obtain one owner-approved recovery decision.

## 5. Human decisions and authorization packet

Create an append-only redacted successor to the current blank packet. Do not overwrite old authorization packets. Every production-sensitive envelope must contain:

- authorizationId;
- humanOwnerName and humanOwnerRole;
- humanApproverName and humanApproverRole;
- signedAt and expiresAt;
- exact symbolic target IDs resolved in protected provider context;
- release commit and allowed source paths;
- allowed and excluded actions;
- start/end time window;
- spend cap where a resource or provider can bill;
- prior-state evidence;
- human rollback operator;
- rollback triggers and procedure;
- evidence root;
- status=APPROVED.

Any blank owner, approver, target, fixture list, limit, expiry, rollback operator, or decision keeps the dependent task BLOCKED_AUTHORITY.

| Decision | Required owner | Required approver | Exact decision fields | Blocks |
| --- | --- | --- | --- | --- |
| D-01 release proposal and PR #70 merge | Human repository/release owner: ______ | Human production release approver: ______ | merge method, window, main target, no PR #69, no direct push, no auto-merge | PROD-01 |
| D-02 production database migration | Human database owner: ______ | Human DB security and release approvers: ______ / ______ | exact apply set, target, compatibility, window, forward-fix operator | PROD-02 |
| D-03 restore drill and recovery targets | Human recovery owner: ______ | Human database/billing approver: ______ | drill mode, backup point, disposable target, RPO target, RTO target, spend cap, deletion deadline | SR-MIG-01 and PROD-02 |
| D-04 PAT-1 | Human security owner: ______ | Independent security reviewer and release approver: ______ / ______ | revoked/rotated/contained or time-bound accepted risk; no token material | PAT-1 |
| D-05 runtime controls and backlog | Human product/delivery owner: ______ | Human release approver: ______ | initial dedupe, translation, posting; KEEP_BLOCKED or ENABLE_AFTER_CANARY; pending-delivery disposition | AIR-010 and T4 |
| D-06 production function release | Human backend owner: ______ | Human release approver: ______ | ten-function set, JWT modes, prior versions, rollback worktree/operator | PROD-03 |
| D-07 renderer recover or replace | Human infrastructure/renderer owner: ______ | Human release and spend approvers: ______ / ______ | recover existing or replacement, host, architecture, registry, one replica, concurrency 1, current/prior digest | PROD-04 |
| D-08 Vercel main-deploy hold and promotion | Human Vercel owner: ______ | Human release approver: ______ | proven main auto-deploy hold, prior deployment, staged build, promotion, alias and rollback | PROD-01 and PROD-05 |
| D-09 authenticated production browser | Human QA/Auth owner: ______ | Human release approver: ______ | admin and read_only sessions, MFA/bootstrap method, routes, viewports, zero-mutation rules | T4-01 and T4-02 |
| D-10 provider canary | Human provider account owner: ______ | Human release and spend approvers: ______ / ______ | provider, fixture, maximum requests, claims, writes, spend, expected rows; default writes=0 | T4-C |
| D-11 AIR-017 | Human database performance owner: ______ | Human database/release approver: ______ | representative queries, window, plan/latency thresholds, accept or forward-fix | AIR-017 |
| D-12 AIR-052 | Human security owner: ______ | Human release approver: ______ | scanner set, zero unwaived high/critical, waiver owner/expiry | AIR-052 |
| D-13 AIR-055 | Human build owner: ______ | Human release approver: ______ | masked production-shaped inputs, source-map rule, artifact provenance, accept/rework | AIR-055 |
| D-14 cleanup | Human DB/storage operations owner: ______ | Human release approver: ______ | dry-run limits, row/object/byte canary limits, observation, canonical schedule, deletion deadline | CLN-02 and CLN-03 |
| D-15 Preview teardown | Human resource owner: ______ | Human billing/release approver: ______ | retain or delete ephemeral Supabase branch and other temporary resources; exact deadline | Final resource settlement only |

Recommended proposals, not authorization:

- Restore: RPO no more than 24 hours and RTO no more than 4 hours. The owner must accept or replace both values before the drill.
- Runtime cutover: insert one production row with dedupe=false, translation=false, posting=blocked. Enable features individually only after their accepted T4 checks.
- External posting: remain blocked unless D-05 and D-10 explicitly select ENABLE_AFTER_CANARY. Review the existing pending-delivery backlog before enabling a periodic poster.
- Cleanup: keep jobs 17 and 19 inactive until AIR-065 passes. If approved later, job 19 is the only default schedule candidate; job 17 remains inactive unless separately authorized.

## 6. Restore, rollback, and recovery envelope

### 6.1 Restore decision

The retained ephemeral Supabase Preview branch is data-less and does not prove backup restoration. Choose one of these before production migration:

1. Managed physical restore-to-new-project. Use only when the provider exposes a proven way to prevent restored cron and network jobs from reaching production before inspection. Record the temporary cost. The restore is database-only; separately account for Storage objects, functions, Auth configuration, API keys, Realtime settings, and other project configuration.
2. Pre-isolated logical recovery drill. Restore an authorized export into a self-controlled target with outbound calls disabled before startup. This proves database recovery and application compatibility, but not the provider physical backup itself. The database and release owners must explicitly accept that limitation as the release-equivalent recovery contract.

If neither option is approved, SR-MIG-01 stays blocked. Do not use production as the drill target.

Restore PASS requires measured start/end timestamps, backup/recovery point, data-loss window, RPO/RTO result, migration and semantic catalog comparison, bounded critical-row counts, Storage metadata/object reconciliation, disabled cron/network jobs, no production/provider writes, application/Auth smoke, target teardown state, and database-owner acceptance.

Supabase documents that Preview branches are ephemeral and data-less and that merging can trigger production deployment. Do not merge the Preview branch into production. Supabase also documents that restore-to-new-project omits non-database project resources. Recheck current official guidance before execution:

- https://supabase.com/docs/guides/deployment/branching
- https://supabase.com/docs/guides/platform/clone-project

### 6.2 Release rollback

Before the first mutation, record current function versions, current frontend deployment, renderer state and prior digest, active schedule definitions, queue/lease state, runtime settings, and the rollback operators.

Rollback order is the reverse of release order:

1. Set or retain posting=blocked and pause claim-producing schedules.
2. Roll the Vercel alias back to the recorded prior READY deployment.
3. Stop/drain the candidate renderer and restart the recorded prior digest if it is healthy and compatible.
4. Redeploy prior function sources from a clean worktree at the recorded predecessor commit; do not stamp a new deployment SHA until all selected functions succeed.
5. Keep database changes in place and use a new reviewed forward fix if needed. Do not run down migrations or repair history.

If data corruption requires a backup restore, that is a new incident-authorized operation, not routine release rollback. Stop other mutations, preserve evidence, and obtain incident authority.

Vercel documents promotion and rollback as separate deployment actions. Recheck current official guidance before use:

- https://vercel.com/docs/deployments/promoting-a-deployment
- https://vercel.com/docs/deployments/rollback-production-deployment

## 7. Task DAG and concurrency

    R0 plan accepted and clean execution anchor
      |
      +--> R1 append-only T2/T3 receipt correction
      +--> A1 complete human authority packet
      +--> D1 semantic DB/RLS/grant/type classification
      +--> B1 restore decision and drill
      +--> S1 PAT-1 disposition
      +--> P1 AIR-017 workload evidence
      +--> Q1 AIR-052 supply/image evidence
      +--> V1 AIR-055 production-shaped build evidence
      +--> H1 renderer incident triage and release-host decision
      +--> C1 Vercel main auto-deploy hold proof
                    |
                    v
             G1 signed T3-02 gate packet
                    |
                    v
             PROD-01 merge PR #70
                    |
                    v
             merge-SHA CI and provenance
                    |
                    v
       PROD-02 drain -> migrations -> runtime row -> parity
                    |
                    v
       PROD-03 functions -> PROD-04 renderer -> PROD-05 frontend
                    |
                    v
       T4-A auth/roles -> T4-B zero-provider canary
                    |
                    +--> T4-C optional provider canary
                    |
                    v
       T4-D schedules/controls -> T4-E soak and rollback window
                    |
                    v
       CLN-01 dry run -> CLN-02 canary -> CLN-03 one schedule
                    |
                    v
       FINAL-01 AIR/task/resource/worktree reconciliation

### 7.1 Safe concurrency lanes

| Wave | May run concurrently | Must remain serial |
| --- | --- | --- |
| 0 | Local plan acceptance, task re-anchor, task-owned terminal inventory | Any write to the same receipt/ledger/packet |
| 1 | D1 catalog reads, B1 restore feasibility, S1 PAT metadata, P1 workload reads, Q1 scans, V1 build reads, H1 renderer read-only triage, C1 Vercel settings read | Secrets, role edits, provider settings, merge, deploy, production mutation |
| 2 | Approved isolated restore drill, candidate renderer build/scan, hosted SBOM/build artifacts, redacted external challenge reviews | Database replay/apply, Auth/RLS changes, shared source or ledger writes |
| 3 | Luna integrates receipts and owners review in parallel | Final T3-02 decision and release proposal are one serial acceptance step |
| 4 | Read-only observers may watch logs, catalogs, queues, metrics, and provider counts | Merge, migration, function, renderer, frontend, runtime control, schedule, provider, rollback, and cleanup mutations are one at a time |
| 5 | Computer Use acceptance may run while Luna collects read-only target evidence | No backend mutation during a browser test; no provider canary during cleanup |
| 6 | Post-release read-only monitoring across all surfaces | Cleanup mutation and schedule enablement remain serial and last |

At most six task-owned terminals may be live during read-only Wave 1. Use one terminal per Orca task. Close or release each task-owned terminal as soon as its dispatch is settled. Never close, rename, interrupt, or reuse an unrelated idle terminal. Never stash, reset, clean, or overwrite user work. External write candidates use isolated worktrees with one writer per file.

## 8. Implementation tasks

### Phase R — re-anchor and durable receipts

| ID | Dependencies | Owner and owned surface | PASS evidence | Stop/forbidden | Estimate |
| --- | --- | --- | --- | --- | ---: |
| R0 | None | Luna; this plan, current Git/Orca reads | Plan path accepted; only this planning artifact differs; branch/upstream rechecked | No implementation in the planning phase | 0.5h |
| R1 | R0 | Luna; append-only comprehensive ledger successor and one redacted T2/T3 successor receipt | Corrects row-545 reference without rewriting rows; materializes accepted T3-01 request and productionChanged=false; exact current timestamp | No self-hash chain, raw logs, private targets, or old-row rewrite | 1-2h |
| R2 | R0 | Luna; append-only production authorization packet successor | All D-01 through D-15 fields either APPROVED or explicitly BLOCKED; owner signatures are human | AI cannot fill human authority | 1-3h plus human response |
| R3 | R1 | Luna; candidate branch and PR #70 only | Plan/receipt commit pushed if authorized; exact-head CI green; PR #69/main unchanged | No force push, merge, deploy, or source changes hidden in receipt commit | 1-2h |

R1 and R2 may run concurrently. If R1 or R3 changes runtime paths, stop and treat the new commit as a new candidate.

### Phase E — parallel evidence closure

| ID | Dependencies | Owner and owned surface | PASS evidence | Stop/forbidden | Estimate |
| --- | --- | --- | --- | --- | ---: |
| E-DB | R0 | Luna DB owner; protected production reads and redacted semantic receipt | Classifies all 16; catalog/RLS/grant/default ACL/type/compatibility result; no extra apply set | No external worker gets private DB output; no mutation | 4-8h |
| E-REST | R2 D-03 | Luna recovery owner; disposable restore target | Restore PASS contract in section 6; target settled | No production restore; no clone without approved containment/cost | 8-24h plus provider wait |
| E-PAT | R2 D-04 | Luna plus human security owner; GitHub alert metadata and Supabase account status | Redacted revoked/rotated/contained or accepted-risk disposition; independent review | Never inspect, print, or commit token value | 1-3h |
| E-A17 | R0 | Luna DB performance owner; read-only production plans/metrics | Representative query set, workload window, before/after or accept-no-change decision | No index or policy change without a new forward migration | 3-8h |
| E-A52 | R0 | Luna security/release owner; hosted artifacts and renderer image | Root/renderer audits, npm SBOMs, Deno/import/action evidence, immutable image/base scan, license review, zero unwaived high/critical or approved expiring waivers | No broad security program or dependency churn; any fix loops to CI/affected Preview | 3-8h |
| E-A55 | R0 | Luna build/release owner; Vercel protected build/artifacts | Masked production-shaped inputs, source commit, Node/npm, build/deployment ID, artifact identity, source-map privacy result, owner ACCEPT | Synthetic CI alone fails; never expose values | 2-5h |
| E-REN | R2 D-07 | Luna infrastructure owner; production renderer host/registry | Host identity, architecture, current/prior digest, health, 30-second heartbeat, capacity, disk/temp, one replica/concurrency 1, rollback | Do not deploy candidate during incident triage; no env dump; ambiguous claim/provider result stops | 4-12h plus host recovery |
| E-VCL | R2 D-08 | Luna Vercel owner; read-only project/deployment settings first | Current deployment/predecessor, main Git auto-deploy hold mechanism, staged production route, promotion/rollback evidence | If merge can change production alias automatically, PROD-01 stays blocked | 1-3h |

E-DB, E-PAT, E-A17, E-A52, E-A55, E-REN, and E-VCL are independent read-only lanes after R0. E-REST may start when D-03 is approved. Reuse accepted P3-P7 evidence. Rerun only the affected slice if a current result differs.

AIR-052 minimum commands include:

    npm audit --omit=dev --audit-level=high
    npm --prefix services/video-renderer audit --omit=dev --audit-level=high
    npm run check:supply-chain-contract
    npm sbom --omit=dev --sbom-format cyclonedx > "$ARTIFACT_DIR/root.cdx.json"
    npm --prefix services/video-renderer sbom --omit=dev --sbom-format cyclonedx > "$ARTIFACT_DIR/renderer.cdx.json"

Use the approved hosted or registry scanner for the exact renderer image. If no scanner is named and available, AIR-052 remains blocked; do not install a new security platform merely to change the result.

### Phase G — T3-02 gate and production proposal

G1 is PASS only when:

- R1 is durable and R2 has nonblank valid fields for the requested mutation scope.
- E-DB, E-REST, E-PAT, E-A17, E-A52, E-A55, E-REN, and E-VCL pass.
- SR-REL-00 has a signed pre-release receipt joining Git, CI, database, functions, frontend, renderer, schedule, queue, backup, rollback, and owner evidence.
- The release proposal contains exact migration, function, renderer, frontend, runtime-control, schedule, canary, soak, and rollback envelopes.
- The proposal still says releaseGate=CLOSED until PROD-01 begins under valid authority.

Luna updates T3-02 with ACCEPTED or keeps it BLOCKED with one exact blocker list. Worker completion is not acceptance.

### Phase PROD — merge and serial production release

#### PROD-01: merge exact reviewed candidate

Preconditions: G1 PASS, D-01 and D-08 approved, main auto-deploy held, PR #70 required checks green, merge method recorded, PR #69 untouched.

After merge:

- use a separate clean main release worktree;
- fetch and fast-forward that worktree only;
- capture merge commit and exact CI;
- prove runtime paths have no unreviewed difference from 040fd0e plus accepted successor fixes;
- regenerate AIR-052/AIR-055 provenance for the merge commit where exact-SHA evidence is required.

Do not use a tree-hash equality ceremony. A normal merge or receipt commit can change the tree. Use Git path diffs, exact commit ancestry, hosted run IDs, and provider artifacts. Any unexpected runtime-path diff stops the release.

#### PROD-02: drain, forward migrations, and runtime row

1. Refresh all targets, authority, backups, queues, schedules, provider counts, and prior versions.
2. Under its own mutation envelope, record and pause the four active non-cleanup schedules: worker, reconcile, learned-bias rebuild, and X poster. Keep cleanup jobs 17 and 19 inactive.
3. Verify running jobs=0, expired leases=0, and no ambiguous in-flight provider outcome. Existing backlogs and dead letters are a baseline, not an automatic failure.
4. Apply the approved subset of the exact 16 files one at a time through apply_migration. Verify history and intended effects after each.
5. Insert exactly one production runtime_controls row with the approved D-05 values. The recommended initial values are dedupe=false, translation=false, posting=blocked.
6. Re-run the full semantic migration, RLS, grant, default-ACL, routine, type, Auth role, queue, and compatibility checks.

Do not continue to functions if a migration result is partial, unknown, or semantically different. Use a new forward fix.

#### PROD-03: ten Edge Functions

Deploy from the clean main release worktree in this order, with the verify_jwt mode already declared in supabase/config.toml:

1. admin-actions — JWT on
2. admin-retry — JWT on
3. webhooks-rssapp — JWT off
4. media-processor — JWT off
5. media-cleanup — JWT off
6. db-cleanup — JWT off
7. digest-compiler — JWT off
8. x-followers-snapshot — JWT off
9. worker — JWT off
10. x-poster — JWT off

Use the pinned Supabase CLI and explicit PROD_REF for every command. The existing scripts/deploy-functions.sh is Preview-only and must not be used for production. After all ten deploys and their auth/health negatives pass, stamp DEPLOY_GIT_SHA with the release commit. If one deploy fails, do not stamp; inspect the mixed-version state and either finish the approved set or redeploy the prior function sources under the rollback envelope.

#### PROD-04: renderer

First do bounded incident triage against current main. If the existing process is healthy but heartbeat is stale, diagnose target/connectivity before rebuilding. If a verified prior digest exists, one controlled same-digest restart may be approved. If recovery will exceed the release window, keep the renderer paused and prepare the release image; do not rebuild old main only to replace it immediately.

For the release, build the clean merge commit for the approved host architecture, publish it to the named registry, record its immutable digest and scan, retain the prior digest, and deploy with one replica and concurrency 1. Start paused or with polling disabled. Require local health, three fresh 30-second heartbeat intervals, zero claims/provider writes, stable resources, and a successful drain/rollback check before enabling one bounded renderer fixture.

#### PROD-05: frontend

Create the approved production-shaped staged Vercel deployment without changing production aliases. Record source commit, deployment ID, Node/npm, masked variable names, artifact identity, source-map disposition, and current rollback target. After database, functions, and renderer pass, promote the staged deployment. Verify aliases, security headers, SPA routes, deployment identity, and error logs. Restore the recorded main auto-deploy setting only after the release owner accepts the result.

If the Vercel project cannot prove a staged, frontend-last path, stop before PROD-01. Do not merge and hope the deployment order is safe.

### Phase T4 — separate production acceptance envelopes

T4 work is not one broad approval. Use these separate envelopes:

| Envelope | Mutation allowance | Exact PASS |
| --- | --- | --- |
| T4-A authenticated roles and reads | Browser reads; one designed negative mutation attempt | Computer Use on desktop 1440x900 and mobile 390x844; signed-out redirect; live admin/read_only sessions; protected routes load; read_only mutation rejected server-side with 403 and before/after zero change; no unexpected console/network/CORS/Auth errors |
| T4-B zero-provider internal canary | One synthetic queue/claim transaction or bounded renderer fixture; external writes=0 | Expected row/claim/lease/heartbeat/artifact joins; duplicate/fencing path holds; provider ledgers and posting writes remain unchanged |
| T4-C external provider canary | Only the provider, fixture, request, write, and spend maxima in D-10 | Every observed request and durable outcome is within the envelope; no ambiguous outcome; default is skipped with writes=0 |
| T4-D controls and schedules | One control or schedule change at a time | Enable approved dedupe, then translation, then worker/reconcile/bias schedules; X poster and posting mode last; each interval has expected jobs, no expired lease, no unexpected provider write |
| T4-E soak and rollback window | Read-only monitoring; rollback only on trigger | Minimum 4-hour active soak plus 24-hour read-only follow-up unless D-09 names a stricter accepted window; all stop metrics remain within their approved thresholds |

Computer Use must perform every browser click, sign-in, viewport change, network inspection, and screenshot using GPT-5.6 Sol, Low reasoning, Fast. Credentials remain inside the native browser session. Luna interprets the receipt, checks backend evidence, and makes the acceptance decision.

If D-05 chooses KEEP_BLOCKED, keep posting=blocked and X poster inactive, and close AIR-010 only with an explicit product-owner keep-disabled disposition. If D-05 chooses ENABLE_AFTER_CANARY, first classify existing pending deliveries as retain, bounded drain, or separately skip. Never expose the backlog to an unbounded scheduler start.

### Phase CLN — cleanup and resource settlement

Cleanup is after accepted T4 and has its own authority:

1. CLN-01: run a reference-aware, zero-write dry run. Record exact candidate rows/objects, shared/active/fresh exclusions, and projected bytes.
2. CLN-02: run one claimed invocation within D-14 row/object/byte limits, then disable mutation again. Require matching DB/object counts, no reference violation, and failCount=0.
3. Observe for the approved interval and obtain AIR-065 ACCEPT.
4. CLN-03: enable exactly one approved canonical cleanup schedule. Job 17 remains inactive unless separately authorized. Verify the first scheduled run before closure.
5. Settle task-owned terminals, workers, temporary worktrees, artifacts, and canary directories. Do not delete the ephemeral Supabase branch, Preview deployments, registry images, or rollback artifacts unless D-15 explicitly authorizes each target.

## 9. Exact gate matrix

| Gate | PASS condition | Closing task and durable receipt |
| --- | --- | --- |
| SR-REL-00 | Signed pre-release join before PROD-01 and signed post-T4 successor joining exact release state and rollback | G1 then FINAL-01; production-release-join receipt |
| SR-MIG-01 | Exact 16-effect classification, accepted restore drill, semantic replay/parity, approved forward apply, post-apply result | E-DB, E-REST, PROD-02; migration-semantic-reconciliation receipt |
| SR-RLS-01 | Anon, read_only, admin, service, and renderer matrix across REST CRUD, RPC, Realtime, Storage; policy/grant/default ACL owner decision; post-change matrix | E-DB, T4-A; rls-role-and-grant-matrix receipt |
| PAT-1 | Redacted current revocation/rotation/containment or time-bound accepted-risk decision; independent review | E-PAT; pat-1-disposition receipt |
| AIR-010 | Product owner chooses keep-disabled or bounded enable; exact revision/provider order and exactly-once result; no unapproved writes | D-05, T4-B/T4-C/T4-D; air-010-delivery-disposition receipt |
| AIR-017 | Representative current workload, advisor/statistics result, before/after plans and metrics, owner ACCEPT or reviewed forward fix | E-A17; air-017-production-performance receipt |
| AIR-052 | Exact release root/renderer/Deno/action SBOM, license, dependency, container/base-image and immutable-image results; zero unwaived high/critical or named expiring waivers | E-A52 plus merge-SHA refresh; air-052-supply-chain receipt |
| AIR-055 | Masked production-shaped Vercel build, source/deployment provenance, artifact and source-map review, owner ACCEPT; final production deployment appended | E-A55, PROD-05; air-055-build-provenance receipt |
| Renderer release | Current host/replacement accepted; immutable new/prior digest; health/heartbeat/capacity/drain/rollback/canary pass | E-REN, PROD-04; renderer-production receipt |
| Authenticated production | Admin and read_only route/role/viewports, negative mutation, backend joins, no unexpected errors | T4-A/T4-B; authenticated-production receipt |
| Soak | No new expired leases, no stuck jobs, no unapproved provider write, no RLS negative failure, renderer healthy, error/latency/queue thresholds accepted for full window | T4-E; production-soak receipt |
| Cleanup | Dry run, one bounded canary, observation, AIR-065 ACCEPT, exactly one schedule | CLN-01/02/03; cleanup-production receipt |

Any gate with missing evidence is FAIL or BLOCKED, never “partial pass.” Existing dead-letter and backlog totals do not fail a release by themselves. Compare post-release deltas and types against the timestamped baseline. Any new expired lease, unexpected write, role-boundary violation, ambiguous provider result, or migration uncertainty is an immediate stop.

## 10. Stop conditions and forbidden surfaces

Stop the current phase when any of these occurs:

- target, branch, commit, deployment, function set, image digest, or authority drift;
- owner/approver/rollback operator missing, expired, or unreachable;
- PR #69 or an unrelated branch/worktree would be changed;
- Vercel main auto-deploy is not held before merge;
- the Supabase Preview branch would be merged into production;
- broad db push, migration repair, history edit, project reset, reverse SQL, or an extra pending migration would run;
- a migration effect is partial, conflicting, or unknown;
- restore result misses the approved RPO/RTO or Storage reconciliation;
- a read_only user can mutate, an anon user gains unexpected access, or a service-only object has a browser grant;
- a secret or private target appears in source, logs, screenshots, artifacts, or an external-worker prompt;
- renderer health and heartbeat disagree, architecture/digest is wrong, capacity is inadequate, or a claim/provider outcome is ambiguous;
- any provider write exceeds the approved count or spend;
- queue growth, new dead letters, errors, latency, storage, or resource metrics breach the approved thresholds;
- cleanup candidates are active, fresh, shared, referenced, or outside row/object/byte limits;
- rollback begins while another mutation is running.

Forbidden throughout:

- force push, direct main push, tag, branch delete, PR #69 mutation, auto-merge, or production deploy from codex/*;
- secret values, private URLs, raw production data, or unredacted logs in Git/Orca/external prompts;
- external workers on Auth, RLS, secrets, migrations, production data, billing, deployment, cleanup, or acceptance;
- two overlapping production mutations;
- cleanup as a rollback mechanism;
- deletion of Preview/restore/rollback resources without exact D-15 authority.

## 11. Model and quality-orchestration routing

The strict phase route is:

1. Planning: GPT-5.6 Sol, Max. This plan completes that phase.
2. Implementation, integration, protected execution, validation, and final answer: GPT-5.6 Luna, High.
3. Browser interaction: Computer Use GPT-5.6 Sol, Low, Fast.

External routes are candidate-only S0-S2 contributors. Luna must discover current models/costs, load the version-matched quality-orchestration adapter, run an exact canary, attest requested and effective model/effort, inspect the real diff/output, and record ACCEPTED, REWORK, REJECTED, or BLOCKED. A launcher failure before the provider executable starts is an adapter failure. Unknown or silent is not failed. All Zro routes are DISABLED_BY_USER_POLICY.

| Route | Exact assignment | Owned files/data | Luna acceptance |
| --- | --- | --- | --- |
| Devin swe-1-7, Max, Free, dangerous permission mode | Any bounded missing scan/SBOM/test automation or forward-fix tests; use only if a code gap is found | One isolated S0-S2 candidate worktree; exact script/test files; no protected data | Focused tests, full relevant gate, diff review; candidate only |
| Devin glm-5-2, High, Free, dangerous permission mode | Independent repo/receipt/AIR-052/AIR-055 challenge and documentation/test review | Read-only public/repo evidence or one disjoint docs/test candidate slice | Luna verifies every finding against source/provider evidence |
| Antigravity gemini-3.7-flash-high, High, dangerously-skip-permissions | Redacted visual review of captured Preview/production UI evidence or bounded frontend candidate repair | No browser session, credentials, production rows, or provider target; frontend files only if separately owned | Use only if effective model/effort attestation succeeds; previous canary was not sufficient |
| Command Code deepseek-v4-flash, High, yolo | Routine external fallback after each predecessor is settled | Same bounded S0-S2 surface | Luna integrates and validates |
| Native Luna High | All shared/protected files and systems, migrations, RLS/Auth, secrets, provider config, merge, deploy, production, cleanup, integration, validation, final acceptance | Full task-authorized scope | Required owner and final acceptor |

Use both Free Devin routes concurrently when both remain Free, their fresh canaries pass, and slices are disjoint. Use Antigravity first for a task-compatible visual/front-end slice only after its effective identity is exposed. Do not manufacture source changes to increase provider usage. Read-only challenge work is sufficient when the product already passes.

The high-autonomy flags suppress interactive prompts only. They do not expand file ownership, secret access, production authority, destructive authority, or acceptance authority.

## 12. Estimate and critical path

Accepted P3-P7 and the T3 read snapshot are sunk work and are not counted again.

| Remaining lane | Optimistic | Likely | Conservative | Parallel? |
| --- | ---: | ---: | ---: | --- |
| R0-R3 receipts, authority packet, plan-only CI | 2h | 5h | 10h | Partly |
| E-DB semantic reconciliation and role/type/grant work | 4h | 8h | 16h | Yes |
| Restore decision and drill | 8h | 16h | 32h | Yes; provider wait extra |
| PAT-1, AIR-017, AIR-052, AIR-055 | 6h | 13h | 28h | Yes |
| Renderer recovery/rebuild/registry/rollback | 4h | 10h | 24h | Yes |
| T3-02 owner review and production proposal | 2h | 5h | 10h | No final decision |
| Merge, merge-SHA CI, and production release | 5h | 10h | 20h | Mutations serial |
| Authenticated canaries and active soak | 4h | 8h | 14h | Reads partly parallel |
| Cleanup, observation, and final reconciliation | 4h | 10h | 24h | Cleanup serial |
| **Total active effort** | **39h** | **85h** | **178h** | After parallel savings: about 30h / 60h / 125h critical-path effort |

Elapsed time if all humans, host access, registry, and restore capacity are ready:

- Optimistic: 3 calendar days, including the first 24-hour follow-up.
- Likely: 5-8 business days, including release and cleanup observation windows.
- Conservative: 2-4 weeks if restore containment, renderer recovery, owner review, or a forward fix blocks the path.

The critical path is:

    authority + restore + semantic DB reconciliation
      -> renderer and Vercel release readiness
      -> T3-02 signed acceptance
      -> main-deploy hold and merge
      -> merge-SHA CI
      -> drain and migrations
      -> functions
      -> renderer
      -> frontend
      -> authenticated canaries
      -> soak
      -> bounded cleanup
      -> final observation and closure

Human response time and provider waiting are elapsed time, not engineering effort. If a source or migration fix is needed, add one focused implementation/CI/affected-Preview cycle of 4-16 active hours before returning to G1.

## 13. Direct implementation-orchestrator and Orca handoff

Implementation-orchestrator must bind to run_cdf312ef8410 and update existing production tasks. Do not duplicate the accepted P3-P7 tasks or the production skeleton.

| Existing task | Required next action |
| --- | --- |
| task_1fbbeea96fa3 — T3-01 | Preserve blocked history; append the accepted read snapshot/update request fb79283e-f2cc-4243-8de5-557fb09e0635 and R1 receipt. Do not recapture unless freshness expires before mutation. |
| task_55b6547b8c9d — T3-02 | Add this plan as the replan contract. Create child evidence tasks E-DB, E-REST, E-PAT, E-A17, E-A52, E-A55, E-REN, E-VCL. Keep blocked until G1 passes. |
| task_fc1927539b4d — PROD-01 | Ready only after G1, D-01, and D-08 pass. Merge PR #70 only; main-deploy hold required. |
| task_9095c2e6f0ca — PROD-02 | Bind the exact classified migration subset, runtime row, drain, restore, semantic checks, and forward-fix stop. |
| task_493be5834113 — PROD-03 | Bind the exact ten-function serial order, JWT modes, prior versions, and SHA stamp rule. |
| task_7fccbe55cf8c — PROD-04 | Bind the production renderer recovery/replacement decision, immutable current/prior digest, capacity, health, canary, and rollback. |
| task_dd755c37f0c5 — PROD-05 | Bind the staged production build, main-deploy hold, frontend-last promotion, prior deployment, and rollback. |
| task_142355920c01 — T4-01 | Split evidence into T4-A, T4-B, and optional T4-C envelopes; Computer Use owns UI interaction. |
| task_b93f8dad7dc3 — T4-02 | Bind T4-D schedules/controls and T4-E active plus follow-up soak. |
| task_a4030ed9dc82 — CLN-01 | Keep read-only until T4 accepted; bind exact dry-run evidence. |
| task_589faac591af — CLN-02 | Keep blocked until D-14; bind one canary limit and immediate disablement. |
| task_c343d7367954 — CLN-03 | Bind AIR-065 decision, observation, and exactly one schedule. |
| task_a62d74ceaa08 — FINAL-01 | Reconcile 80 AIR rows, all eight gates, production state, task/worker/terminal/resources, Preview retention, worktree/remote, merge/deploy/live distinctions. |

For each child task, record: owner, approver, dependencies, read/write/exclude sets, risk, target alias, source commit, expected evidence, pass/fail, stop conditions, rollback, estimate, external-route eligibility, and cleanup. Use this state path:

    pending -> ready -> dispatched -> evidence captured ->
    Luna ACCEPTED | REWORK | REJECTED | BLOCKED -> settled

Orca task updates use the current run and JSON results. A result must contain the prior/new state, exact timestamps, target/source aliases, authority ID/expiry, durable evidence path, mutation and productionChanged flags, Luna decision, residual resources, and cleanup. Do not put raw private targets, URLs, logs, or secrets in the result. Update existing tasks; create only the bounded T3-02 children listed above.

Before each external dispatch:

1. Recheck branch, HEAD, worktree, task risk, exact file ownership, privacy, model catalog, Free tier, canary, and adapter.
2. State role, model, reasoning, autonomy flag, scope, exclusions, and receipt contract in commentary and in the prompt.
3. Use a task-owned terminal and tracked dispatch.
4. Settle the predecessor before fallback.
5. Luna inspects output/diff and records disposition.
6. Close/release only the task-owned terminal and worktree.

The implementation owner should report “on track” in the main chat as soon as R0-R3 are accepted, Wave 1 lanes are dispatched, and the worktree remains clean. It must report production as blocked until G1 and human authority pass.

## 14. Planning quality score and planning-agent receipts

### Quality score: 5/5

| Dimension | Score | Evidence in this plan |
| --- | ---: | --- |
| Goal and source truth | 5 | Exact repo/branch/commit/run, timestamps, precedence, freshness, accepted/unknown split |
| Architecture and decisions | 5 | Forward-only reconciliation, restore choices, renderer/Vercel decisions, explicit owner/approver blocks |
| Task decomposition | 5 | Full DAG, dependencies, concurrency, ownership, forbidden surfaces, estimates, existing Orca mapping |
| Acceptance and recovery | 5 | Exact gate matrix, semantic DB/RLS/type/grant criteria, T4 envelopes, monitoring, rollback, cleanup, stop rules |
| Handoff and route control | 5 | Luna execution boundary, external model assignments, Computer Use route, Orca updates, receipts, terminal hygiene |

No planning decision is left implicit. Remaining blanks are named human production decisions and intentionally block their mutations.

### Planning agent usage

- Main planning owner: role planner; model GPT-5.6 Sol; reasoning Max; Fast not applicable; scope was full evidence synthesis, tradeoffs, DAG, acceptance, estimate, plan artifact, and handoff. Result ACCEPTED.
- Database reconciliation lane: role planning/research worker; requested model GPT-5.6 Sol; requested reasoning Max; independent runtime model telemetry unknown; Fast not applicable. Scope was migration/schema/RLS/grant/type/restore strategy. Result ACCEPTED WITH REWORK: current facts, effect classification, semantic gates, queries, and forward-only rule were accepted; hash-oriented language and an unconditional repeat of accepted P3 were removed.
- Authorization and gate lane: role planning/research worker; requested model GPT-5.6 Sol; requested reasoning Max; independent runtime model telemetry unknown; Fast not applicable. Scope was owner/approver contract, eight-gate mapping, T4 boundaries, and Orca receipts. Result ACCEPTED WITH REWORK: owner/gate mapping was accepted; manual receipt-hash ceremony and stale estimate were replaced.
- Release, renderer, and browser lane: role planning/research worker; requested model GPT-5.6 Sol; requested reasoning Max; independent runtime model telemetry unknown; Fast not applicable. Scope was renderer recovery, merge/Vercel ordering, authenticated acceptance, monitoring, rollback, and estimates. Result ACCEPTED WITH REWORK: renderer and release controls were accepted; obsolete claims that P3-P7 were incomplete and old full-program estimates were replaced with current evidence.
- No planning worker used a subagent. No planning worker edited files or mutated GitHub, Supabase, Vercel, renderer, browser, Orca tasks, or production.

Planning Effort Gate triggers were production/data migration risk, four or more independent system surfaces, conflicting historical/current evidence, and the need for a reliable implementation handoff. Worker count and plan length were not used as Max triggers. Full worker run was selected for three disjoint planning lanes. Visible thread mode was not used.

**Strict planning route: PASSED.** The main planner and all three workers were dispatched through the required GPT-5.6 Sol Max planning contract. Independent worker runtime identity telemetry was not exposed, so it is recorded as unknown rather than inferred. Implementation has not started under this plan.
