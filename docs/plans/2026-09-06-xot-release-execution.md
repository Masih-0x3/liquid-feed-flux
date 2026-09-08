# XOT release execution checkpoint — 2026-09-06

Scope correction: [PR #77 focused release scope](2026-09-06-xot-pr77-release-scope.md)
supersedes this checkpoint's treatment of all operational gaps as one release
gate. Findings below remain valid historical observations; the frontend,
renderer rollout, and recovery/database maintenance now have separate gates.

Source candidate: `51ab283083d27099deff7f841b856fe22d2a6598` on
`codex/video-render-workspace-redesign`, PR #77. Production/main:
`7797b11c11b9805f701c9f77b5a752c5eece71d9`.

## Scope and acceptance

The owner requested execution of the five remaining tasks on 2026-09-06:
Preview acceptance, evidence/ledger refresh, AIR-010/AIR-065 resolution,
conditional merge/Production rollout, and PR/worktree triage. Merge and rollout
remain conditional on acceptance. This does not authorize new charges, private
data export, a production restore, or replay of historical delivery backlogs.

1. Preview: use the existing isolated project and renderer; prove exact source,
   Node 24 runtime, no-posting synthetic render, persistence, migration semantics,
   and authenticated admin/read_only desktop/mobile behavior.
2. Evidence: append current receipts without rewriting historical acceptance.
3. AIR-010: reconcile source, deployment, database, and renderer identity.
   AIR-065: establish backup inventory and complete an approved isolated restore,
   including separate Storage-object recovery, before any cleanup canary.
4. Release: mark PR #77 ready, merge, and roll out only after the above applicable
   gates pass; verify live identity and retain rollback resources.
5. Triage: assess all open PRs #66–#68 and #78–#85 and the redundant v1 worktree;
   do not treat non-ancestor PRs as already merged or discard unique evidence.

Stop conditions: target ambiguity, missing spending/export approval, failed
isolation, unexpected provider traffic, historical delivery mutation, failing
required checks, or missing authenticated acceptance. Independent read-only and
documentation work may continue while a dependent task is blocked.

## Verified current evidence

Collected 2026-09-06, approximately 16:28–16:45 UTC, using GitHub/Vercel APIs,
Supabase read-only SQL/source download and backup inventory, and existing SSH
access to the renderer host. No Production mutation occurred.

- PR #77 is draft with successful lint-build, Vercel, and review checks at the
  source candidate. CI run `33817672499`; accepted AIR-052 artifact `9935984070`,
  SHA-256 `24a012315c94f7015ee50b601b0c24876d6aba0fa50952afb8ad911dd370e9d9`.
  AIR-052 is accepted for that exact candidate, not for arbitrary later changes.
- Production frontend deployment `dpl_7BDVu5uqg2g88KtjRYVboLfvtNjz` is Ready at
  the main SHA. Preview deployment `dpl_EmftNtzuHswraaeNgi3zU64vLitg` is Ready at
  the candidate SHA, but redirects unauthenticated access to Vercel SSO.
- Production Supabase `jzirqfzzvlbxwfzndaer` and Preview
  `umicnrtkpuzjwivmgnei` are ACTIVE_HEALTHY. Preview posting is blocked,
  translation/dedupe are disabled, and no cron jobs exist. It has one admin and
  one read_only account. Account existence is not authenticated UI acceptance.
- The existing Preview renderer is connected and healthy, not missing. Container
  `xot-preview-renderer`, loopback port 8798, image
  `xot-preview-renderer:4e2dc6cad4e315f719c21db53ccfc9c1b3c436e0`, Node 20.20.2,
  polling disabled, restart policy `no`. It has not passed the Node 24 canary.
- Production container `xot-renderer-xot-video-renderer-1`, loopback port 8797,
  image `xot-video-renderer:prep4-fe3e78a2f20f-amd64`, Node 20.20.2, is healthy
  with polling enabled and restart policy `no`. Its immutable image ID is
  `sha256:6f2cc5371e9fa731e33624534d243b025d07ce6963a398c9b2c0abb2d721c676`.
  Health does not prove candidate identity or restart persistence.

### AIR-010 and migration semantics

The downloaded Production Edge source inventory contains 91 files, all byte-equal
to the candidate files at their corresponding paths. Its sorted path/SHA-256
manifest digest is
`05b6f72ee6e2ce644e576a54f1fc207367be8748bc8e71291c2ea6488b86f0c1`.
This is an extracted inventory comparison, not an independent hash of each
deployed bundle: shared paths may be flattened by the download. It does not prove
renderer process identity. AIR-010 remains partial.

Preview has 90 downloaded files; 85 match. Differences are
`_shared/xPostDeliveryClaim.ts`, `admin-actions/monitoringReads.ts`,
`admin-retry/index.ts`, `worker/index.ts`, and `x-poster/index.ts`. Its inventory
manifest digest is
`c80c3caddb40829a4e5a3b6dbf403013cd721bebeccb9f4b1604db86b4e90b80`.
Do not call this exact-candidate Preview acceptance.

Migration histories contain 117 Production and 140 Preview versions, with 11
Production-only and 34 Preview-only versions. Four Preview versions have bodies
identical to differently timestamped Production versions, including the latest
claim-release migration. Raw ledger hashes are not semantic schema proof.

An exhaustive comparison of public column name/type/nullability tuples found no
set differences. The initial order-sensitive column fingerprint differed; that
was not a column-definition difference. Public function signatures also have no
set differences. Only two function-definition hashes differ:

- `invoke_x_poster_if_enabled()`: Production references its posting endpoint;
  Preview contains no network call. Preserve the Preview isolation difference.
- `cleanup_old_data(integer,integer)`: Production additionally deletes old
  feedback and pair-blocklist rows; Preview has the older body. Neither was run.
  Cleanup remains disabled and outside accepted recovery readiness.

The subsequent exhaustive public-schema comparison found matching sets for 661
column default/identity/generated tuples, 44 policies, 23 noninternal triggers,
45 table RLS flags, and 210 function ACL/security-definer entries. It also found
material drift that prevents parity acceptance:

- Of 187 indexes in each target, `runtime_controls_pkey` indexes `singleton_key`
  in Production but `singleton_id` in Preview. Both columns exist in both targets.
- Constraints number 130 in Production and 131 in Preview. Besides the primary
  key and corresponding true-only check, Preview has an `updated_by` foreign key
  to `auth.users` that Production lacks. The environment check differs only in
  array order, not permitted values.
- Preview has 1,092 table grants versus Production's 1,050: all seven table
  privileges for anon on `scoring_evaluations` and `scoring_examples`, and for
  authenticated on those tables plus `queue_reconcile_runs` and `x_api_events`.
  No Production-only table grant was found. Narrowing privileges requires the
  owner's explicit approval; no grants were changed.

This is not complete database equivalence: non-public schemas, default
privileges, column/sequence grants, Storage objects, and authenticated application
behavior remain outside the comparison. Do not repair migration history or replay
the Production convergence bundle merely to equalize counts.

### AIR-065 recovery

Read-only provider inventory shows WAL-G enabled, PITR disabled, and eight
completed physical backup records spanning 2026-08-30 through 2026-09-06. Latest
backup ID `1595267488`, inserted `2026-09-06T11:26:15.449Z`. This observed inventory
is not a promised eight-day retention policy or a successful recovery receipt.

No provider-supported direct physical-backup download or managed-clone pre-start
egress/cron suppression has been established. The existing runbook therefore
blocks a managed clone as the drill target. An approved logical export into a
pre-isolated local target would test logical recovery, not restoreability of the
listed physical backup. Private database export needs explicit scope approval.
No export, restore, cleanup, PITR purchase, or schedule change was performed.

## PR and worktree triage

All 11 secondary open PRs were inventoried; all eight small PR diffs were read.

| PR | Disposition |
| --- | --- |
| #66 | Conflicting old cleanup branch; not an ancestor of main. Preserve pending semantic/evidence reconciliation; do not merge wholesale. |
| #67 | Old migration-trust checkpoint targeting the earlier UI branch; not an ancestor of main. Preserve historical trust evidence; do not merge into current release wholesale. |
| #68 | Old runtime matrix targeting the migration branch; not an ancestor of main. Current candidate has evolved runtime contracts; preserve until unique evidence is reconciled. |
| #78 | Small documentation correction for read-only legacy scoring UI; suitable follow-up after #77 acceptance and base refresh. |
| #79 | Corrects historical delivery settlement to zero-DML semantics; suitable documentation follow-up. |
| #80 | Removes unused makeDefaultProfile helper; no application call sites found. Follow-up, not a release prerequisite. |
| #81 | Removes unused DashboardMetrics component; observed CI failure was npm audit HTTP 503, not a proved code regression. Recheck on refreshed base. |
| #82 | Removes unused AppSidebar component; no application import found. Follow-up. |
| #83 | Removes wrapper hooks/type exports; no external consumers of the removed exports found under src. API types used by the remaining hooks are retained. Follow-up after base refresh and checks. |
| #84 | Removes unused useXDeliveries hook/type while retaining monthly-count hook. Follow-up. |
| #85 | Removes unused filtering helper and its tests; preserve equivalent active-path coverage before accepting deletion. |

No secondary PR was merged, closed, or rebased. PR #78's Vercel build log confirms
the Preview identity guard rejected a Production Supabase reference. That is an
environment-scoping failure correctly blocked by the guard, not proof the docs
patch broke application code. Only this representative Vercel log was sampled;
do not assume all eight failures have the same cause. Their remaining Vercel
failures and required checks must be resolved or explicitly classified before
acceptance; the #81 audit endpoint failure must not be hidden by weakening the
audit. Never relax Preview identity validation to make these branches green.

`/Users/stevmq/xot-v1-continuity-owner` is clean and its `b8bee2c` commit is an
ancestor of main. It is redundant for code history, but was left intact: active
terminal/resource ownership was not established. No worktree or branch removed.

## Remaining dependencies

- Incremental existing-host compute approval requested; exact billing unavailable.
  No new service or chargeable renderer rebuild started.
- Native browser unavailable. Approval requested for a task-specific external
  Chrome tab; existing user tabs and focus were not changed. Preview requires
  Vercel SSO plus the existing application test accounts.
- Approve a private logical-export scope and isolated local recovery target, or
  provide a supported safe route for the physical backup drill. Do not substitute
  a production restore or an unisolated managed clone.
- Preview-only primary-key/schema and privilege convergence approval requested;
  preserve the disabled X invoker and no-posting controls. No permissions changed.
- Complete outstanding Preview, schema/grant, renderer and recovery gates before
  the already-conditionally-approved merge/Production rollout.

The release remains CLOSED. Documentation refresh is completed locally; release
acceptance and operational tasks are partial, not complete.

## Local validation of this documentation update

- JSON parse passed; all 80 historical AIR rows retained; linked receipt exists.
- JSONL parse passed for all 53 entries after the initial checkpoint append.
- `git diff --check` passed.
- All 180 tests passed across `check-migration-baseline.test.mjs`,
  `check-runtime-contract.test.mjs`, and `check-supply-chain-contract.test.mjs`.
  No full app/browser/build suite was rerun for this documentation-only patch;
  earlier hosted exact-candidate evidence remains separate.
- Runtime and supply-chain source contract checks passed. These static checks do
  not replace the accepted hosted artifact or deployed runtime checks.
- Migration inventory integrity and current candidate contents passed. The
  migration checker explicitly retained its BLOCKED release verdict, including
  restore, privilege, no-egress and owner-review requirements. Its normal-mode
  metadata does not consume the new live read-only comparison as an accepted
  protected remote/replay receipt.
