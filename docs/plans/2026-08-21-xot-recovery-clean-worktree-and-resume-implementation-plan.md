# XOT Recovery, Clean Worktree, And Resume Implementation Plan

## Planner Metadata

- Repository: `/Users/stevmq/Finalized XOT`
- Branch: `codex/xot-remediation-convergence`
- Planning anchor HEAD: `0bd578856016c06a10890339f93aa13b82ecae48`
- Tracking branch anchor: `origin/codex/xot-remediation-convergence` at `7e4b004964167b6856ecf980337049f90e125205`
- Date: 2026-08-21, America/Denver
- Planning route: `planner`, GPT-5.6 Sol, max reasoning
- Planning mode: full read-only planning run with four distinct Sol Max workers
- Implementation status: not started by this plan
- Release state: `CLOSED`
- Current product: Liquid Feed Flux / XOT, a React/Vite admin dashboard with Supabase Postgres, Auth, Storage, Realtime, ten Edge Functions, and a separate Node video renderer
- Repository instructions: no repo-local `AGENTS.md`; the user-supplied session instructions, `README.md`, package scripts, current plans, receipts, and nearby code patterns govern
- Pre-plan worktree anchor: 493 entries with `git status --porcelain=v1 -uall`: 175 modified, 2 deleted, 316 untracked, 0 staged
- Pre-plan sorted status SHA-256: `2dabb495dce2ce6fbc4f746785e4a508cd8e24a138560b813dae0f2da501ae55`
- Important drift note: this new plan is itself one additional untracked path until it is integrated. Execution must generate a fresh live count and hash. It must not require the historical count to remain 493.

### Planning workers

| Worker | Route | Read-only scope | Result use |
| --- | --- | --- | --- |
| Git preservation | planner, GPT-5.6 Sol, max | Dirty-tree capsule, refs, stash, worktrees, unreachable commits, clean integration sequence | Synthesize the preservation checkpoint and no-loss commit path |
| Evidence reconciliation | planner, GPT-5.6 Sol, max | Ledger, receipts, 18 sampled gates, seven current failures, done versus partial status | Synthesize correction receipts and the validation matrix |
| Release readiness | planner, GPT-5.6 Sol, max | E9, E10 Phases 3-7, hosted CI, Preview, staging, production boundaries | Synthesize the external sequence and authorization gates |
| Effort estimation | planner, GPT-5.6 Sol, max | Bottom-up recovery and remaining-release estimates, parallelism, critical path | Synthesize the three-point estimate and confidence model |

### Primary evidence inspected

- `README.md`
- `package.json` and its 129 `check:*` scripts
- `.github/workflows/ci.yml`
- `.novita-offload.json`
- `scripts/deploy-functions.sh`
- `scripts/check-release-state.sh`
- `docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md`
- `docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl`, 543 rows at planning time
- `docs/plans/2026-08-08-xot-post-b4-execution-sequence.md`
- `docs/plans/2026-08-12-xot-e9-owner-external-gate-packet-v4.json`
- `docs/plans/2026-08-12-xot-e10-preview-parity-implementation-plan.md`
- E1-E8 and E10 local acceptance receipts dated 2026-08-09 through 2026-08-13
- Current Git status, diff inventory, branch ancestry, reflog, stash, worktrees, and unreachable commits
- The 2026-08-21 read-only recovery audit of receipt paths, hashes, Claude file-history backups, local gates, and current GitHub PR/CI state

### Assumptions

- One GPT-5.6 Luna High implementation owner integrates and validates each shared batch.
- No other process writes to this worktree during preservation or integration.
- The user can grant Git, Supabase, renderer-host, Vercel, browser-credential, DNS, and production authorities separately. None is assumed.
- Current local core results remain a useful anchor, but each result must be rerun against the final clean candidate.
- Engineer-hours are focused implementation, review, and validation time. Elapsed business days include serial dependencies, CI, provisioning, owner response, and observation windows.
- Elapsed-day estimates use about six productive owner hours per business day, with up to two non-writing evidence/review lanes in parallel.
- Estimates do not include a new AIR-010 implementation. AIR-010 remains disabled unless the owner opens a separate revision-bound plan.
- Current cloud prices and account entitlements are not assumed. E10 Phase 3 begins with a current cost receipt and owner approval.

## Executive Goal

Return XOT to a safe doing state without losing any August work:

1. Create and independently restore-test a complete recovery capsule before any cleanup.
2. Classify every live dirty path as integrated product work, paired tests/evidence, intentional deletion, evidence-only artifact, or rejected duplicate with a retained copy and reason.
3. Reconcile the seven current gate failures without rewriting historical receipts or ledger rows.
4. Commit the accepted work in exact, reviewable subsystem batches until the current worktree is empty.
5. Prove the final local candidate from a clean reconstruction, then update the existing remote branch and PR only with separate Git authority.
6. Regenerate the 80-AIR latest-state map and replace the current rough estimate with a path- and gate-backed estimate.
7. Resume external work through E9 and the amended E10 sequence, ending at a production-change proposal. Production remains a separate authorization.

The first safe execution checkpoint is a verified capsule plus a frozen classification manifest. The user-requested doing state is stricter: all prior accepted work is attributed and integrated, the current implementation worktree is clean, the ledger/receipt chain validates, the remaining AIR work is estimated, and one next slice is authorized. The likely range to reach that state is 44–72 engineer-hours, or 6–10 business days.

## Source Of Truth Contract

- Intent: preserve and integrate all accepted prior work, make one clean reproducible candidate, and state the remaining work with evidence-backed estimates.
- Current behavior: substantial August implementation exists only in a dirty tree; local core suites pass, seven historical/current gates do not reproduce, and the remote PR does not contain the August work.
- Expected outcome: one exact clean local SHA with all classified work committed, all required local gates green or explicitly owner-blocked, a valid append-only latest-state ledger, and a phased external handoff.
- Truth owner: Git object IDs and tree hashes own source; the recovery manifest owns dirty-path preservation; current contract tests own local invariants; the append-only ledger and successor receipts own evidence history; hosted CI, staging, Preview, and production each own only their own evidence tier.
- Contract boundary: current worktree, Git refs and recovery surfaces, source/config/tests, 80 AIR dispositions, migration/type trust, E9 decisions, E10 staging/renderer/Preview/browser work, and production handoff.
- Displaced path: mutable dirty files and session summaries as the only record of implemented work.
- Cutover: verified recovery capsule, then exact-path commit waves in the existing branch. No reset, clean, checkout-overwrite, broad stash, or history rewrite is part of cutover.
- Acceptance evidence: capsule restore equality; a 100% classified path manifest; focused mutation tests; full local CI-equivalent gates from a clean reconstruction; an empty current status; exact-SHA hosted CI; isolated staging identity; authenticated role and browser receipts; and, later, separately authorized production evidence.
- Evidence lane: preserved dirty state -> locally integrated and validated -> committed -> pushed -> hosted CI -> isolated staging -> protected Preview -> authenticated acceptance -> production proposal -> separately authorized production read-only/canary.
- Kill criteria: capsule mismatch, an unclassified path, sensitive material in a capsule or receipt, another writer changing the baseline, ledger history mutation, unclear migration provenance, a gate that cannot distinguish checker drift from behavior drift, remote divergence, production identity in Preview, an unauthorized provider call, or failed rollback.
- Forbidden moves: `git reset --hard`, `git clean`, checkout overwrite, dropping the stash, deleting branches or worktrees, pruning unreachable objects, force-pushing, broad staging, rewriting old JSON receipts or ledger rows, copying secrets into fixtures or receipts, contacting production during local work, or promoting T0/T1 evidence to hosted/staging/live.

## Native Planning Superiority

- Codex Native baseline: a generic response would say “back up, commit, run tests, and deploy.” It would not prove that 493 dirty entries, old Git surfaces, historical receipts, and migration evidence survive the transition.
- What this plan does better: it defines a restorable capsule, one disposition per dirty path, append-only correction semantics, exact commit waves, a safety-classified gate manifest, separate state labels, a corrected external sequence, and pass/fail handoffs.
- User-specific context used: preserve dirty work and active resources; use exact receipts; keep local, committed, pushed, CI, staging, deployed, and live separate; use the native browser only through the required Computer Use route; keep production closed until explicit authority.
- Superiority score target: 5/5.
- Proof artifacts: recovery capsule manifest and verification receipt, 493-plus-live path classification, successor gate receipts, final candidate gate manifest, 80-AIR latest-state map, exact-SHA CI/staging/browser receipts, and the production-change proposal.

## Orchestration Decision

- Mode: full worker run.
- Worker count: four.
- Decision reason: the plan spans Git recovery, evidence semantics, migration/release safety, external environments, and estimation; these surfaces have different evidence and failure modes.
- Independent surfaces: preservation, local acceptance, hosted/staging release, and effort/critical path.
- Workers skipped: no UI design worker and no browser worker because no UI implementation or live interaction is authorized in planning.
- Thread decision: no additional user-visible thread. This repo-local plan is the durable handoff.
- Token/context rationale: four narrow lanes reduce duplicate inspection while the Sol Max parent owns all decisions and synthesis.
- Reconsider trigger: add a focused planning cycle only if the canonical branch changes, capsule verification exposes new work, a new migration or production contract appears, or the user changes the Preview topology.

## Background Browser Lane

- Needed now: no.
- Needed later: yes, only in E10 Phase 6.
- Target: protected exact-SHA Vercel Preview with isolated Supabase staging and staging renderer.
- Route: configured `computer_use` agent, GPT-5.6 Sol, low reasoning, Fast.
- Safety boundary: staging-only `admin` and `read_only` accounts; no production cookies, projects, URLs, or provider-write credentials; external posting hard-blocked.
- Required receipt: URL, immutable SHA, role, viewport, route, action, visible result, console/network result, staging record/artifact IDs, and production/provider zero-contact evidence.
- Stop condition: production identity appears, a `read_only` mutation succeeds, provider write traffic appears, the SHA differs, or browser credentials cannot be safely isolated.

## Research And Inspiration Findings

External inspiration was not relevant. This plan uses current local source, Git, receipts, and the existing XOT topology. Current Vercel, Supabase, GitHub, and host behavior must be rechecked from official sources and direct runtime evidence immediately before each authorized external phase.

## Current State

### Repository and work survival

| Fact | Current evidence | Meaning |
| --- | --- | --- |
| Local branch | `codex/xot-remediation-convergence` at `0bd5788` | Correct implementation anchor |
| Upstream | `7e4b004`; local HEAD is 51 commits ahead | Local committed work is not yet on the remote branch |
| Dirty paths | 493 before this plan: 175 modified, 2 deleted, 316 untracked, 0 staged | August work is present but not durably integrated |
| August 6 baseline | All 304 baseline entries remain with the same Git state; 189 entries were added later | The original recovery baseline was not silently replaced |
| Tracked diff | 177 files, 17,665 insertions, 5,103 deletions | Large integration batch; broad staging is unsafe |
| Receipt path survival | 36 receipts referenced 1,795 paths; only two intentionally absent | No current evidence of receipt-bound work loss |
| Receipt hashes | 1,362 bindings still point to files; 1,253 exact, 109 later-modified across 51 paths | Later work caused drift; it did not erase the bound files |
| Claude backups | 164 of 164 file-history backups exist | Secondary recovery evidence remains available |
| Recovery surfaces | one stash, many branch/worktree refs, three unreachable commits remain | Preserve and classify; do not prune or drop |
| Ledger preservation | committed HEAD ledger is a byte prefix of the 543-row working ledger | Current evidence is append-only; preserve this prefix property |

### Dirty-tree distribution

| Area | Modified | Deleted | Untracked | Total | Default classification lane |
| --- | ---: | ---: | ---: | ---: | --- |
| `scripts/` | 6 | 0 | 164 | 170 | Pair checker, builder, and mutation test with the source invariant it validates |
| `supabase/` | 75 | 1 | 53 | 129 | Database, functions, migrations, and runtime contracts |
| `src/` | 59 | 1 | 24 | 84 | Frontend, API clients, role/UI behavior, and tests |
| `docs/` | 8 | 0 | 54 | 62 | Operations, plans, receipts, and append-only evidence |
| `services/` | 13 | 0 | 10 | 23 | Renderer capacity, process, claim, and failure boundaries |
| repository root | 11 | 0 | 3 | 14 | Runtime, dependency, build, deploy, and policy configuration |
| `.diffui/` | 0 | 0 | 4 | 4 | Evidence-only unless a current plan explicitly references an image |
| `public/` | 1 | 0 | 2 | 3 | Shipped assets and security headers |
| `.commandcode/` | 0 | 0 | 2 | 2 | Tool output; archive unless a current source-of-truth document uses it |
| `.github/` and `.husky/` | 2 | 0 | 0 | 2 | CI and local commit gates |
| **Total** | **175** | **2** | **316** | **493** | Every live path must receive one final disposition |

The two deletions are currently supported as intentional but still require final gate proof:

- `src/components/ui/sonner.tsx`: source removal is intentional. The package lock still carries `sonner` and `next-themes`, so the deletion is not accepted until dependency metadata is reconciled and the toast gate passes.
- `supabase/migrations/20250903140000_rpc_pipeline_status_and_retry.sql`: the old active alias was archived and replaced by `supabase/migrations/20250904033146_rpc_pipeline_status_and_retry.sql`. Accept the deletion only after the migration inventory proves no version or body was lost.

### Git recovery surfaces

- Stash: one 2026-06-14 backup stash with 24 changed paths and 2,249 insertions remains. Do not apply or drop it during recovery. Compare its patch against current source and record `incorporated`, `superseded`, or `still unique` per path.
- Unreachable commits: `711f678` (Sentry observability), `f0ba6c4` (native process observability), and `9a7dc54` (function auth and secret matrix). Their important files appear in current source, but create archive refs before any garbage collection and compare their trees to the candidate.
- Worktrees: old persistent worktrees and prunable `/private/tmp/xot-supply-*` metadata remain. They do not prevent a clean current status. Do not prune them in this program.
- Local branches: most historical cleanup branches are ancestors of current HEAD. Sixteen branch tips are not ancestors and need a one-time unique-commit report. Retain them; merging them is outside recovery unless their work is explicitly selected.
- PR #69: current read-only GitHub evidence shows an open draft PR `chore: checkpoint XOT remediation convergence`, branch to `main`, last updated 2026-07-30. The remote tip is `7e4b004`; the latest two observed CI runs failed, and the latest named failing step was `npm run check:functions`. The local passing function check is not a hosted-CI replacement. Freeze this PR during recovery.

### Current local validation

These are planning anchors, not final-candidate proof:

- Frontend: 202/202 tests passed.
- Renderer: 202/202 tests passed.
- Supabase functions: 444/444 tests passed.
- Strict TypeScript: passed.
- Deno function check: passed.
- `git diff --check`: passed.
- Eleven of eighteen sampled historical/current gates pass.
- Seven gates fail because source, checkers, package metadata, or receipts no longer agree.

### State vocabulary

| State | Minimum evidence | What it does not prove |
| --- | --- | --- |
| Preserved | Recovery capsule reconstructs the exact dirty state | Correctness or integration |
| Locally validated | Named checks pass on named local files/tree | Commit, remote, hosted, staging, or live state |
| Committed | Exact Git SHA contains the accepted paths | Push, CI, deployment, or runtime acceptance |
| Pushed | Remote branch resolves to the exact local SHA | Hosted CI or deployment |
| Hosted CI | Named remote run passes for the exact SHA | Staging or live behavior |
| Staging provisioned | Isolated resources exist with identity receipts | Candidate code is deployed or accepted |
| Staging deployed | All named components run the exact SHA in staging | Authenticated workflow or production behavior |
| Preview accepted | Protected Preview passes role, failure, side-effect, and rollback matrices | Production authorization |
| Production proposal | Exact change, risks, rollback, and owner gates are documented | Production mutation |
| Live verified | Production evidence is captured from the exact live target | Any untested side effect or future stability |

## Evidence-Backed Done And Remaining Inventory

This table is the current best program view. It must be replaced by the generated 80-AIR latest-state map after ledger repair.

| Program slice | Current best evidence | Current status | Remaining before claim can advance |
| --- | --- | --- | --- |
| B0/B1 containment, migration/type trust | Local plans, migration manifests, disposable/local receipts | Substantial local work accepted; protected/production trust still deferred | Reconcile current candidate hashes, protected evidence, owner/PAT gates, hosted/staging tiers |
| B2A-B4 correctness slices | Local receipts and passing runtime suites | Implemented locally; two historical checkers currently disagree with later source | Reconcile B3A and RSS contracts, then bind current source in successor receipts |
| E1 renderer capacity/shutdown | `REVIEW_READY_LOCAL_T0_T1` | Implemented and locally tested | Current-candidate review, hosted/staging runtime evidence |
| E2 subprocess containment | `REVIEW_READY_LOCAL_T0_T1` | Implemented and locally tested | Current-candidate review, staging host/process evidence |
| E3 admin mutation protocol | `REVIEW_READY_LOCAL_T0_T1` | Implemented and locally tested | Current-candidate review and authenticated staging behavior |
| E4 lane capacity/checked writes | `REVIEW_READY_LOCAL_T0_T1` | Implemented and locally tested | Current-candidate review and staging workload/fault evidence |
| E5 no-egress | `ACCEPTED_LOCAL_ISOLATED_T1` | Locally accepted | Staging identity/no-egress confirmation; live exploitation remains forbidden |
| E6/E7 disposable migration, RLS, grants, types | `ACCEPTED_LOCAL_DISPOSABLE_T1` | Locally accepted | Current hash chain, isolated staging apply, generated types, role/grant proof |
| E8a modularity slices | Several partial T0/T1 receipts | Partially implemented and accepted | Remaining AIR-036 hotspots and broader runtime/owner evidence |
| E8b bundle/assets | Local baseline, comparison, and brand-asset receipts | Partial; current tooltip inventory gate fails | Fresh clean build comparison and later visual/browser evidence |
| E8c dashboard hierarchy | Partial local source/test receipt | Partial | Protected Preview visual, responsive, accessibility, and AIR-050 owner decision |
| E8d supply/build | Partial local inventory/source contract | Partial | Current hosted scans, exceptions/waivers, exact artifact provenance |
| E9 owner/external gates | v4 owner design decisions | Partial | Append-only exact-SHA successor; owners/authorities; AIR-017/052/055/065, PAT, protected migration/restore evidence |
| E10 Phase 1 | `ACCEPTED_LOCAL_PHASE1` | Behavior locally accepted; receipt has one later package hash drift | Successor supersession receipt; no historical rewrite |
| E10 Phase 2 | `ACCEPTED_PREVIEW_PREPARATION_T1` | Local source/config/runbook preparation accepted | Rebind to clean candidate and successor E9 authority |
| E10 Phases 3-7 | Not started | Not provisioned or deployed | Exact sequence below |
| Production T3/T4 and cleanup-last | Not started and unauthorized | Closed | Preview acceptance, owner gates, exact production authorization, read-only re-anchor, bounded canary, rollback, cleanup last |

The earlier rough count of AIR evidence tiers is not a completion score. `check:air-ledger-coverage` currently fails on row 543, so the new latest-state map is the only allowed basis for the final remaining-work estimate.

## Phase Plan

## R0 — Freeze, Re-Anchor, And Authorize Local Recovery

### Scope

1. Confirm repo, branch, HEAD, upstream, current open PR, active writers, active terminals, ports, staged index, and exact `-uall` status.
2. Ask the user to hold XOT writes during the capsule and commit waves.
3. Record separate authority values for local file edits, local commits, push/PR, Supabase, renderer host, Vercel/GitHub, browser credentials, DNS, production read-only, and production mutation.
4. Check `.novita-offload.json` before any eligible Linux-compatible command. The current allowlist does not include recovery-capsule creation or the full candidate matrix, so those operations remain local unless an owner-approved policy change adds exact files and commands.

### Acceptance

- One live re-anchor receipt records counts and hashes without sensitive values.
- No staged paths exist.
- No other writer changes the status hash during capsule creation.
- No external or production action occurs.

### Stop conditions

- Branch, HEAD, or status changes unexpectedly.
- A path appears to contain a secret, private archive, credential, or unrelated user data.
- Local disk does not have enough space for two verified copies of the changed/untracked payload.

## R1 — Create And Verify The No-Loss Recovery Capsule

### Exact checkpoint method

Implement two scoped local scripts with tests:

- `scripts/create-xot-recovery-capsule.mjs`
- `scripts/verify-xot-recovery-capsule.mjs`

The creator must use a user-specific sibling directory outside the repository with mode `0700`. It creates two layers:

1. A sealed local APFS clone/copy of the repository, including `.git` and local ignored files. This is a local disaster-recovery copy only. It must never be uploaded, attached to a harness, or logged because it can contain local `.env` values.
2. A sanitized Git recovery bundle and manifest containing Git-tracked changes and Git-reported untracked files only. It must exclude ignored files, `.env*`, credentials, keys, `node_modules`, build caches, and unrelated directories.

Capture the source status twice and require byte equality before copying. Compare source/copy status, refs, binary tracked patch, and untracked hashes after the copy.

All Git mutations used only for preservation occur in the sealed copy, not the live source. Before the bundle is created in the copy:

1. Create a non-checked-out archive branch at current HEAD, for example `archive/xot-pre-recovery-20260821-<time>`.
2. Create stable archive refs for each of the three unreachable commits after verifying each is a commit object.
3. Record the existing stash ref, all branch tips, reflog anchors, worktree metadata, and the 16 non-ancestor branch tips. Do not apply, drop, prune, or delete them.
4. In the copy only, create one archival checkpoint commit containing every execution-start dirty entry. The known baseline is 493 entries plus this plan as the only authorized planning delta, but do not hardcode a staged count: require the two live manifests and the archival staged set to match exactly. Ignored files remain only in the sealed copy and never enter that commit.

The capsule must contain:

- `refs.bundle` from all reachable and newly archived refs, including the archival checkpoint commit.
- A binary full-index patch for tracked working-tree changes.
- A binary full-index staged patch, which must be empty at this checkpoint.
- Exact copies of every Git-reported untracked path.
- A JSON path manifest with status, file type, mode, byte size, SHA-256 or symlink target, HEAD blob ID when applicable, and deletion tombstones.
- Current branch/HEAD/upstream, sorted status bytes and hash, diff statistics, branch ancestry, stash, worktree, reflog, and unreachable-object reports.
- Receipt-survival and Claude-backup summaries from the read-only recovery audit.
- A denylist scan result that records paths only, never secret values.

The verifier must reconstruct the state in a new temporary directory from `refs.bundle`, apply the tracked patch, restore untracked paths, and compare every manifest field. It must then compare the reconstructed `git status --porcelain=v1 -uall` bytes and hash with the source snapshot.

### Acceptance

- Source and reconstruction have the same live path count, status bytes, modes, sizes, and hashes.
- All deletions reconstruct as deletions.
- The staged patch is empty.
- All Git refs in the capsule resolve.
- All three formerly unreachable commits resolve through archive refs.
- Capsule receipt includes output directory, manifest SHA-256, bundle SHA-256, payload count/bytes, restore-test result, and cleanup state, with no sensitive contents.
- The source worktree and source Git refs are byte-unchanged after creation and verification, except for the explicitly owned recovery script/receipt artifacts created before the freeze.
- The sealed copy and sanitized bundle are both mode-protected and remain local.

### Stop and rollback

- Stop before classification if any equality check fails.
- Do not repair the source from an unverified capsule.
- Keep the failed capsule and redacted failure receipt for diagnosis; create a new capsule rather than overwriting it.

## R2 — Classify Every Dirty Path

Create `docs/plans/2026-08-21-xot-recovery-path-classification.json` from the fresh post-plan status. It must have one row per live dirty path and these fields:

- path, Git status, type, bytes, mode, SHA-256/HEAD blob, and top-level area
- earliest receipt/ledger reference and latest receipt/ledger reference
- current source invariant or evidence purpose
- disposition: `integrate`, `intentional_delete`, `evidence_archive`, `rejected_duplicate_retained`, or `blocked_unknown`
- commit wave and owning validation gates
- predecessor/successor path when moved, archived, or deleted
- reviewer and rationale

Classification rules:

1. Receipt-bound source and tests default to `integrate`, but later hash drift must be reviewed.
2. A checker, builder, or receipt generator ships in the same wave as the invariant it validates.
3. Historical receipts and ledger rows remain unchanged. New correction artifacts are `integrate`.
4. `.diffui` images and `.commandcode` output are evidence-only unless a current plan or test references them. Move evidence-only files into the verified capsule archive; do not delete them.
5. An apparent duplicate must be compared by content and behavior. Rejected duplicates remain in the capsule with a reason.
6. Intentional deletions require a replacement or removal proof and a passing focused gate.
7. Any `blocked_unknown` row prevents staging, commit-wave closeout, and worktree cleanup.
8. Review `.novita-offload.json` as workstation-specific policy because it currently pins local `node_modules` paths. Do not commit it unchanged only to make the tree clean.
9. Give explicit owner review to `services/video-renderer/.env.example`, the historical baseline's user-or-unknown paths, and `scripts/check-renderer-process-runner-contract.mjs.bak-no` if it remains present. Default the `.bak-no` file to archive-only after equivalence proof.

### Acceptance

- Manifest row count equals the fresh live dirty count.
- Every path has exactly one disposition and one commit/archive wave.
- The sum by area and Git status equals the live status.
- All 51 paths with later receipt hash drift receive manual invariant review.
- Both deletions and all six tool-output paths receive explicit review.
- No path is removed from the worktree until its capsule copy and disposition are verified.

## R3 — Reconcile The Seven Current Gate Failures

Use one proof-first task per failure. Do not assume that passing unit suites make a checker stale, and do not assume that a stale hash means behavior regressed.

| Gate | Current failure | Proof task | Fix rule and acceptance |
| --- | --- | --- | --- |
| Toast/dependencies | `package-lock` root still declares `sonner`; `next-themes` also remains | Rebuild lock metadata from current `package.json` with reviewed package-manager behavior; compare full dependency diff | Remove only orphaned packages and nodes; source has one toast stack; clean install and toast mutation test pass |
| B3A job fence | Checker expects old literal claim-token patches | Trace terminal/defer writes through `claimEnvelopedPatch` and `updateJobOrThrow`; mutate token, generation, and state fences | If all real paths are fenced, update checker and mutation fixtures to the abstraction; otherwise fix source first. Focused lifecycle tests and checker both pass |
| B3B1 RSS receipt | Runtime accepts `true` or `{success:true}` while the bound SQL RPC returns boolean | Confirm current migration/generated type and absence of an approved successor RPC | Boolean SQL signature owns unless a successor changes it. Reject object-shaped pseudo-success, add an adversarial test, and pass receipt/persistence tests |
| E8B bundle comparison | Exact tooltip role inventory is empty | Build from a clean candidate, inspect source use and rendered/bundle inventory, and compare the baseline builder assumptions | Correct the inventory/builder if tooltip behavior exists; correct UI only if behavior is missing. Record fresh sizes and defer final visual proof to Preview |
| E10 Phase 1 receipt | `package.json` hash differs from immutable Phase 1 receipt | Prove the hash changed in accepted Phase 2 or later work and that 18/19 Phase 1 bindings remain current | Keep old receipt immutable; add a successor supersession receipt with predecessor hash, current hash, reason, and rerun validation |
| AIR ledger coverage | Latest AIR-010/AIR-050 row lacks required source-discovery proof | Validate rows 1-543 byte-for-byte; build a schema-complete correction row | Append row 544 or later; do not edit row 543. Latest 80-AIR view must become schema-valid and release remain closed |
| Migration baseline | Current E10 SQL receipt hashes differ for `runtimeControls.ts`, `e10PreviewParityFoundation.test.ts`, and `package.json` | Reconstruct predecessor/current evidence, replay the approved migration chain, compare types and invariants | Add a successor current-candidate receipt and checker support for the chain. Never change historical evidence or claim production equivalence |

### Receipt and ledger rules

- Rows 1-543 and all historical JSON receipts are immutable inputs.
- Every successor identifies predecessor path, SHA-256, ledger row, reason for supersession, changed paths, current hashes, validation, evidence tier, deferred tiers, and release state.
- A checker may be updated to understand a successor chain. It must continue to reject mutation, missing predecessor, missing evidence, and false tier promotion.
- Actual regressions are fixed in source and tests before a successor receipt is generated.
- Checker-only corrections include self-tests proving the old unsafe mutation still fails.

### Acceptance

- All seven focused gates pass on the same candidate tree.
- Eleven previously passing sampled gates still pass.
- The 18-gate sample is 18/18 before full-candidate validation.
- No old ledger line or receipt byte changes.

## R4 — Integrate In Atomic Commit Waves

The current branch is the default integration branch because its local history is a fast-forward descendant of the tracked remote tip. Do not create a parallel implementation branch unless a fresh fetch shows divergence or PR #69 cannot safely continue.

Commit only exact paths listed in the classification manifest. Never use `git add .`, `git add -A`, a broad directory stage, or a force push. Before each commit, compare `git diff --cached --name-only` to the wave manifest byte-for-byte.

| Wave | Primary content | Required focused checks |
| --- | --- | --- |
| C0 preservation/evidence foundation | This plan, capsule scripts/tests, classification schema, archive-ref receipt | Capsule self-tests and reconstruction equality |
| C1 database/type/security foundation | Migrations, RLS/grants, generated types, runtime controls, role contracts | Migration baseline tests, E6/E7, video-render RLS, role/auth contracts, disposable replay where safe |
| C2 worker and external-side-effect correctness | Worker lifecycle, RSS, digest, Telegram/X, media, dedupe, lane capacity | B3A/B3B/B4, delivery/claim, no-egress, queue, checked-write and function tests |
| C3 admin/backend protocols | Admin operation, retry/actions, persistence, settings, monitoring and render actions | Admin operation, auth/input/CORS, persistence, unknown-outcome and focused function tests |
| C4 renderer | Capacity, process runner, preflight, claim fence, server/config and tests | Renderer suite, capacity/request/error/process/fence/type boundary |
| C5 frontend and assets | Dashboard, Monitoring, Settings, role UI, assets, accessibility and UI tests | Vitest, strict typecheck, E8B/E8C, accessibility and stable route gates |
| C6 runtime/build/release | Package lock, runtime config, CI, deploy guards, Vercel/public headers, runbooks | Supply chain, runtime, environment, lint, build, release render/dry-run only |
| C7 evidence closeout | Successor receipts, 80-AIR map, append-only ledger correction rows | Receipt schemas, AIR coverage normal/mutation, full gate manifest |

After every wave:

1. Confirm the staged index contains only the exact manifest subset.
2. Run focused gates and mutation tests.
3. Commit with a scope and evidence reference.
4. Confirm the remaining dirty count falls by exactly the committed or archived rows.
5. If a wave fails, fix forward in its owned paths. Do not reset or overwrite unrelated work.

Evidence-only files are moved by the capsule tooling to a retained archive after hash verification. They are not deleted. Branches, stash, old worktrees, and archive refs remain untouched; they do not need removal for the current worktree to become clean.

### Acceptance

- Every classification row is committed or verifiably archived.
- `git status --porcelain=v1 -uall` is empty.
- No ignored file was staged.
- Commit history is linear from `0bd5788`; no history rewrite occurred.
- A fresh summary maps every commit to its paths, gates, and ledger rows.

## R5 — Prove A Clean Reproducible Local Candidate

Create a checked-in, safety-classified candidate gate manifest. It must enumerate every command from `.github/workflows/ci.yml`, the 18 sampled milestone gates, receipt/hash gates, disposable SQL gates, build gates, and the commands deferred to hosted/staging/browser phases. Each entry records network policy, secrets policy, expected duration, timeout, artifact, and owning evidence tier.

### Focused drift matrix

- `npm run check:toast-stack`
- `npm run check:b3a-job-fence`
- `npm run check:b3b1-rss-receipt`
- `npm run test:rss-webhook-receipt`
- `node scripts/check-e8b-bundle-comparison-contract.mjs`
- `node scripts/check-e10-phase1-local-acceptance-receipt.mjs` or its successor-aware replacement
- `npm run check:air-ledger-coverage`
- `npm run check:migration-baseline`
- `npm run test:migration-baseline`

### Core local matrix

- `git diff --check`
- `npm run lint`
- `npm run lint:functions`
- `npm run check:strict`
- `npm run check:functions`
- `npm run test:functions`
- `npm test`
- `npm --prefix services/video-renderer test`
- every contract command in the current CI workflow
- `npm run check:supply-chain-contract`
- `npm run test:supply-chain-contract`
- `npm run check:vite-env` with reviewed masked Preview-shaped public values only
- `npm run build`

Do not run `check-release-state.sh --mode execute` in the local matrix. Only its no-contact render/dry-run mode is local. External execute mode belongs to an authorized target phase.

Run the same offline/local matrix in a fresh reconstruction or clean temporary clone of the final local SHA with a clean install. Use a new explicit temporary path, retain the receipt, and remove only that newly created temporary path after verification.

### Acceptance

- The current worktree and clean reconstruction both pass the same local matrix.
- The final SHA and tree are identical in both locations.
- All 129 `check:*` scripts are classified. Every CI-required local-safe check passes; external checks are explicitly deferred, not silently skipped.
- Build receipt has exact SHA, environment identity, artifact inventory, and zero production-ref matches.
- No further source/config/doc edit occurs after the final candidate SHA without invalidating and rerunning the matrix.

## R6 — Generate The Accurate Remaining-Work Inventory

Generate `docs/plans/2026-08-21-xot-air-latest-state-and-estimate.json` from the corrected ledger and receipts. It must contain exactly AIR-001 through AIR-080. Each row includes:

- current implementation state: accepted local, partial local, owner-blocked, external-blocked, not started, or disproved
- highest achieved evidence tier: T0, T1, hosted CI, T2 staging, T3 production read-only, or T4 canary
- current source/receipt paths and latest ledger row
- remaining acceptance evidence, owner, authorization, external dependency, and estimate units
- optimistic, likely, and conservative engineer-hours
- critical-path flag and parallel lane

### Acceptance

- Exactly 80 unique AIR rows; no orphan, duplicate, or missing latest disposition.
- `check:air-ledger-coverage` and its mutation suite pass.
- Sum of row estimates reconciles to the program estimate within 5%.
- Locally implemented work is not counted again as feature implementation; only reconciliation and higher-tier acceptance remain.
- The plan estimate is revised if the bottom-up sum falls outside the current range.

## P2.5 — Exact Candidate, Push, And Non-Deploy Hosted CI

This is a required sequencing correction to the current E10 plan. The existing deploy wrapper rejects a dirty tree and stamps `DEPLOY_GIT_SHA` from Git HEAD. E10 Phase 3/4 cannot safely deploy candidate code before a clean committed SHA exists, while the older sequence first grants Git/push/CI authority in Phase 5.

### Dependencies

- R0-R6 accepted.
- Append-only successor E9 packet grants exact local commit, push/PR, and non-deploy hosted-CI authority.

### Tasks

1. Recheck remote branch and freeze PR #69 at its observed tip while the recovered candidate is reviewed.
2. Stop if any remote tip or open-PR state differs from the recorded intake without reconciliation.
3. Prefer a new clean recovery branch and successor PR because #69 predates the 493-path August state and its old failures belong to `7e4b004`. Link the successor to #69 and retain #69 and its remote branch until the new PR and preservation bundle are verified.
4. Reuse #69 only if the owner explicitly chooses continuity, its remote tip is still an ancestor, and a normal fast-forward push is possible. Never force push.
5. Run the current non-deploy hosted CI and security/supply scans on the exact pushed SHA.
6. Diagnose failures from exact job logs. Do not infer that the old `check:functions` failure still applies.

### Acceptance

- Local, remote branch, PR head, and hosted run all identify one exact SHA.
- Non-deploy hosted CI is green.
- Hosted CI includes `npm run test:functions`; the current workflow must not rely on `check:functions` alone.
- Required dependency, SBOM/license, renderer-image/APT, Deno/import, and GitHub Action pin evidence is attached or explicitly owner-blocked under the supply-chain gate.
- No staging, Vercel, renderer, DNS, or production mutation occurred.

## E9 — Append-Only Owner And External Gate Successor

E9 v4 records useful product decisions but is not an external execution authorization. It says `ownersAssigned=false`, authorizes only local Phase 1, and binds older plan hashes. Create a successor after the clean exact SHA exists.

The successor must preserve:

- AIR-010: keep disabled.
- AIR-050: decide after full protected Preview review.
- Roles: exactly `admin | read_only`, one role per user.
- Preview: external posting hard-blocked; dedupe and translation off by default and admin-toggleable.

It must separately name owner, scope, target, expiry, rollback, and evidence for:

1. Git commit/push/PR and non-deploy hosted CI.
2. Supabase staging organization, region, project creation, migrations, Auth, Storage, Realtime, Vault/secrets, functions, and cron.
3. Renderer host, staging credentials, provider fixtures, start/stop, and rollback.
4. Vercel Preview variables, protection, alias, and deploy workflow.
5. Staging `admin` and `read_only` browser credentials and Computer Use.
6. Optional Preview DNS.
7. Production read-only access.
8. Production mutation/canary and cleanup schedule.

The packet also carries AIR-017, AIR-052, AIR-055, AIR-065, protected migration/restore/grant/type evidence, and PAT alert disposition. Missing evidence remains open; it does not block safe local recovery but blocks its dependent external phase.

## E10 Phase 3 — Isolated Supabase Staging Foundation

### Dependencies

- P2.5 exact SHA and green hosted non-deploy CI.
- Explicit Supabase provisioning/mutation authority and current cost receipt.
- Migration, RLS, grant, and type local gates green.

### Scope

1. Provision one isolated `XOT Staging` project in the approved organization and region.
2. Prove its ref and URL are not production.
3. Apply the complete exact-candidate migration chain to an empty database.
4. Regenerate and compare types.
5. Configure staging-only Auth redirects, one owner-controlled `admin`, one `read_only`, Storage, Realtime, Vault items, and internal tokens.
6. Set required function secrets in the staging secret store without printing values.
7. Create runtime controls with Preview defaults and load sanitized deterministic fixtures.
8. Define cron entries disabled.

Ten-function code deployment moves to Phase 5 so it occurs only through the protected exact-SHA deployment wave.

### Acceptance

- Project identity and denylist receipts pass.
- All migrations apply to empty staging and types match.
- Role/RLS/grant matrix passes at the database boundary.
- Runtime controls are fail-closed and posting is blocked.
- Production configuration, data, secrets, and schedules are unchanged.

## E10 Phase 4 — Isolated Renderer Host Readiness

### Dependencies

- Accepted staging foundation and explicit renderer-host authority.

### Scope

1. Provision `xot-staging-renderer` with staging-only identity, workdir, secret store, and observability tags.
2. Configure the production endpoint denylist and renderer ID `xot-staging-1`.
3. Deploy the exact P2.5 candidate SHA and immutable image digest with polling disabled.
4. Run health and one bounded staging render against staging Storage, then stop or keep polling disabled until Phase 5 promotion.
5. Record exact deploy, stop, prior-image rollback, log, and artifact commands.

### Acceptance

- Host receipt proves no production URL, project ref, token, workdir, or queue.
- Secrets-present checks reveal no values.
- Heartbeat, bounded render artifact, resource limits, process containment, and staging-only storage identity pass.
- Polling remains disabled and no unauthorized provider request occurs.
- Rollback commands are target-explicit and dry-run verified.

## E10 Phase 5 — Protected Exact-SHA Deployment And Hosted CI

### Dependencies

- P2.5 green exact-SHA candidate.
- Accepted Phase 3 and Phase 4 foundations.
- Explicit Supabase function, renderer, GitHub environment, and Vercel authorities.

### Ordered deployment wave

1. Re-run candidate and identity gates.
2. Verify staging migration/type/RLS state.
3. Deploy all ten Edge Functions from the exact SHA and stamp `DEPLOY_GIT_SHA`.
4. Deploy/start the staging renderer at the same SHA with polling initially disabled; run health and one bounded staging render.
5. Deploy protected Vercel Preview from the same SHA with branch-specific staging variables.
6. Compare SHA across CI, functions, renderer, and frontend.
7. Enable only the safe staging schedules required for acceptance.
8. Add the stable protected alias. DNS remains a separate authority.

### Acceptance

- Backend or renderer failure prevents Preview promotion.
- Protected stable and immutable URLs resolve to the same SHA.
- Network/config inventories contain staging endpoints only.
- Production variables and deployment remain unchanged.

## E10 Phase 6 — Authenticated Full-Stack Acceptance And AIR-050

Use the required Computer Use route in the Codex native browser.

Acceptance includes:

- `admin` and `read_only` route and mutation matrices on desktop and mobile.
- Server-side rejection of every `read_only` mutation.
- Dedupe off, one bounded on fixture, then off.
- Translation off, one bounded on fixture, then off.
- Posting attempts through settings, direct API, retry, force, cron, and malformed-control paths, with zero provider writes.
- Staging-only database, Auth, Storage, Realtime, function, renderer, queue, CORS, observability, console, and network evidence.
- Renderer long-run/lease/process/failure checks and bounded artifact proof.
- Full rollback drill: alias protect/remove, controls off, cron off, renderer stop, and prior-SHA recovery.
- Owner review and AIR-050 decision.

Stop immediately on any production contact, provider write, role leak, SHA mismatch, secret exposure, unbounded backlog, or rollback failure.

## E10 Phase 7 — Closeout And Production Handoff

1. Package exact-SHA Git, CI, migration, function, renderer, Vercel, browser, role, provider-zero, and rollback receipts.
2. Append final E10 dispositions without rewriting history.
3. Record limitations and owner decisions.
4. Prepare an exact production-change proposal with risks, expected effects, monitoring, rollback, and authorization fields.
5. Keep production `CLOSED`.

E10 Phase 7 is not a production deployment.

## Production Read-Only, Canary, And Cleanup-Last Option

This is outside E10 and requires a new explicit production authorization.

Order:

1. T3 read-only re-anchor of deployed SHA, function versions, renderer, schema, migration history, roles, cron, queue, provider ledgers, restore readiness, and PAT disposition.
2. Confirm every owner, migration, CI, Preview, AIR-017, AIR-050, AIR-052, AIR-055, and AIR-065 gate.
3. Run only approved bounded T4 canaries with exact IDs and provider request counts.
4. Observe kill metrics and exercise rollback.
5. Re-enable media cleanup last: dry run, one claimed bounded batch, observation, then one canonical schedule.

Any unresolved item keeps the release closed.

## Effort Estimate

### Method

- Bottom-up work breakdown by recovery phase, gate, and external acceptance surface.
- Three-point ranges: optimistic assumes all seven failures are narrow drift and access is ready; likely assumes two semantic fixes and normal CI/staging friction; conservative assumes migration/role or hosted integration defects and slow owner/access turnaround.
- Estimates include implementation-owner review, integration, focused tests, full-gate reruns, and receipts.
- Engineer-hours exclude unattended provider/CI waits. Elapsed days include those waits and assume up to two safe read-only/test lanes can run in parallel while one Luna owner integrates.
- Current confidence is medium-low, approximately plus or minus 35%, until R2 and R3 finish. It should become plus or minus 20% after the clean candidate and plus or minus 15% after staging foundation acceptance.

### Three-point range

| Work package | Optimistic | Likely | Conservative | Confidence |
| --- | --- | --- | --- | --- |
| Accurate remaining-work inventory | 8-12 h / 1-2 d | 20-32 h / 3-5 d | 50-80 h / 8-14 d | B, about ±35% |
| Recovery and clean checkpoint, excluding inventory | 10-16 h / 2-3 d | 24-40 h / 4-7 d | 60-100 h / 10-18 d | B |
| **Combined user-requested doing state** | **18-28 h / 3-5 d** | **44-72 h / 6-10 d** | **110-180 h / 15-28 d** | **B** |
| E9 owner intake, redacted receipts, and gate tracking | 12-18 h / 3-5 d | 28-48 h / 7-15 d | 70-120 h / 20-45 d | C; elapsed overlaps recovery/E10 |
| E10 Phase 3-7 | 72-110 h / 8-13 d | 144-234 h / 20-34 d | 344-550 h / 50-90 d | C |
| Production-handoff acceptance after Phase 7 | 6-10 h / 1-2 d | 16-28 h / 3-7 d | 40-80 h / 10-20 d | C |

E10 likely breakdown:

| Phase | Optimistic | Likely | Conservative |
| --- | --- | --- | --- |
| Phase 3 isolated Supabase | 18-26 h / 2-4 d | 36-56 h / 5-8 d | 80-120 h / 12-20 d |
| Phase 4 isolated renderer | 8-14 h / 1-3 d | 18-30 h / 3-5 d | 42-68 h / 7-12 d |
| Phase 5 exact-SHA CI and Preview | 16-24 h / 2-4 d | 30-48 h / 4-7 d | 72-112 h / 10-18 d |
| Phase 6 authenticated capability matrix | 24-36 h / 3-5 d | 48-80 h / 7-12 d | 120-200 h / 18-32 d |
| Phase 7 receipts and proposal | 6-10 h / 1-2 d | 12-20 h / 2-3 d | 30-50 h / 5-8 d |

### Roll-up

| Milestone | Optimistic | Likely | Conservative |
| --- | --- | --- | --- |
| Verified preservation checkpoint | Same day | 1-2 business days | 3-5 business days |
| Clean reproducible candidate plus exact AIR estimate | 18-28 h / 3-5 d | 44-72 h / 6-10 d | 110-180 h / 15-28 d |
| Protected Preview accepted through Phase 7 | 90-138 h total / 11-18 d | 188-306 h total / 26-44 d | 454-730 h total / 65-118 d |
| Actual production execution after accepted handoff | separately estimate after T3 read-only re-anchor | likely 72-120 h / 10-20 d | order-of-magnitude until Preview and owner gates close |

The likely range is not raw test time. Current core suites and the 124-migration disposable replay are fast; review, attribution, contract reconciliation, external authority, provisioning, role/browser acceptance, failed integration cycles, and rollback evidence dominate. E9 elapsed time is not additive because it starts in parallel, but AIR-050 cannot close before Phase 6.

### Parallel lanes and critical path

Safe parallel work after the capsule:

- Path/receipt classification and branch/stash comparison.
- Independent checker diagnosis for non-overlapping gates.
- E9 owner evidence collection while local integration continues.
- Renderer host planning and Supabase cost/organization evidence, without provisioning.

One owner must serialize shared edits, staged paths, final commits, ledger appends, exact candidate review, and final acceptance.

Critical path:

`freeze -> verified capsule -> 100% classification -> seven gates -> atomic commits -> clean reconstruction -> exact AIR map -> E9 Git authority -> P2.5 push/CI -> Supabase foundation -> renderer readiness -> exact-SHA deployment -> authenticated acceptance -> AIR-050 -> Phase 7 proposal`

## Validation And Acceptance Matrix

| Milestone | Supporting checks | Target-perspective acceptance | Claim allowed |
| --- | --- | --- | --- |
| Recovery | manifest/hash/patch/bundle tests | Full restore in a new directory | Preserved |
| Local integration | focused and full local gates | Clean reconstruction of exact SHA | Locally validated and committed |
| Git/CI | remote ref and hosted jobs | PR/run head equals exact SHA | Pushed and hosted-CI green |
| Supabase foundation | migration/type/RLS tests | Isolated project rows/config/types | Staging provisioned |
| Renderer | service tests and identity guards | Staging heartbeat and bounded artifact | Renderer deployed |
| Preview | deployment checks | Protected URL, exact SHA, staging-only network | Preview deployed |
| Browser | unit/accessibility support | Authenticated role/workflow records and rendered output | Preview accepted |
| Production | all prior gates | Exact live rows, traces, provider counts, canary and rollback | Live verified only for tested scope |

## Risks And Dependencies

- Another writer can invalidate the dirty baseline. Freeze and compare the status hash before each preservation or commit wave.
- The number of untracked files makes accidental broad staging the largest local loss/review risk. Use exact manifests only.
- Historical receipts embed file hashes that later accepted work changed. Use successor receipts, not rewrites.
- The RSS completion divergence is likely semantic because its SQL RPC returns boolean. Treat it as a source contract until evidence proves an approved successor.
- Migration evidence is high risk. No staging apply starts until the successor current-candidate chain, replay, RLS, grants, and types pass.
- PR #69 and old CI are stale relative to local work. Only fresh exact-SHA hosted evidence counts.
- The old PR's root cause beyond the named `check:functions` step is unverified. Diagnose from fresh exact-run logs rather than carrying the old failure forward.
- E10 previously had a circular ordering between exact SHA and deployment. P2.5 removes it.
- External elapsed time depends on current organization permissions, cost approval, secrets, host capacity, and user availability for AIR-050.
- Current cloud pricing is unknown and drift-prone. Obtain official current cost receipts before provisioning.
- The local runtime contract warns of a Vercel Node 20 cutoff on 2026-10-01. Verify the current platform requirement from official evidence before Phase 5; if still applicable, insert a runtime-alignment slice and re-estimate.
- Existing branches, stash, and old worktrees can contain unique experiments not intended for this release. Retain them; do not merge them automatically.

## Stop, Rollback, And Recovery Rules

### Local

- Stop if the live status differs from the capsule without an explained, owned change.
- Stop if any path lacks a disposition or any exact batch stage differs from its manifest.
- Do not use reset/clean/checkout overwrite to abandon a batch.
- Fix forward in owned paths. If a batch must be abandoned, restore only its exact paths from the verified capsule with explicit approval.
- Revert a committed integration batch with `git revert` if needed; do not rewrite history.

### Git and hosted CI

- Stop on remote divergence, unknown PR head, failed required check, stale artifact SHA, or unreviewed exception.
- Do not force push. Keep the last green remote SHA available.

### Staging and Preview

- Stop on production ref/URL/credential, provider write traffic, role leakage, migration/type drift, mixed SHA, unbounded work, or unavailable rollback.
- Roll back in this order: protect/remove alias, controls off, schedules off, renderer stop, prior code SHA, forward database repair. Do not reset or delete staging as a normal rollback.

### Production

- No action without a separate exact authorization.
- Unknown provider outcome, unexpected row/file deletion, stale-owner success, auth/RLS failure, or rollback failure ends the canary immediately.

## Implementation Orchestrator Handoff

### Recommended first implementation slice

Start only R0-R1: live re-anchor, archive refs, recovery capsule creator/verifier, restore test, and redacted preservation receipt. Do not classify away or commit product work in the same slice.

### First-slice source-of-truth contract

- Intent: make the entire current dirty state recoverable before integration.
- Current behavior: source, tests, receipts, and evidence exist in one dirty worktree.
- Expected outcome: a verified external capsule reconstructs the exact live state and the source worktree is unchanged.
- Truth owner: Git status bytes, path manifest, content hashes, refs bundle, and independent reconstruction.
- Contract boundary: Git-reported tracked changes, deletions, untracked files, refs, stash, worktree metadata, and unreachable commits.
- Displaced path: no durable, single-command reconstruction of the current dirty state.
- Cutover: none in R0-R1; the source remains dirty and unchanged.
- Acceptance evidence: successful reconstruction with exact count/status/hash equality.
- Evidence lane: local preservation only.
- Kill criteria: any mismatch, sensitive file, unexpected writer, insufficient space, or object/ref failure.
- Forbidden moves: staging, commit, reset, clean, stash, checkout overwrite, prune, branch deletion, push, cloud, browser, or production action.

### Ownership and likely files

- GPT-5.6 Luna High is the implementation owner, integrator, validator, and final acceptor.
- Likely new files: capsule creator/verifier, their tests, classification schema, and preservation receipt under `docs/plans/`.
- Existing product source/config is read-only in the first slice.
- The current `.novita-offload.json` does not authorize the capsule command or full dirty payload. Keep the slice local and do not broaden the upload allowlist without owner approval.

### Required skills and routes

- Use `implementation-orchestrator` for the goal and execution loop.
- Use `quality-orchestration` for any eligible bounded S0-S2 candidates only after current provider catalogs, Free tiers, canaries, adapters, task fit, privacy, and ownership gates are rechecked.
- Do not upload the dirty tree or capsule to an external harness.
- Product code, shared contracts, integration, validation, and acceptance remain Luna High-owned.
- Browser work is absent until E10 Phase 6, then uses the required Computer Use route.

### First-slice acceptance checks

- Capsule scripts have focused normal, deletion, binary, symlink, untracked, path-with-space, staged-index, denylist, and mutation tests.
- Live creation produces a redacted receipt.
- Independent reconstruction is exact.
- Source status is unchanged except for the explicitly owned new recovery artifacts.
- No ignored or sensitive content enters the capsule.

### Questions that block implementation

- The user must authorize local recovery-script creation and local archive refs.
- Insufficient local storage or a sensitive untracked path blocks capsule creation until the target/handling is approved.

### Questions that do not block R0-R1

- Whether PR #69 is updated or superseded.
- Supabase organization/region/price.
- Renderer host.
- Vercel alias/DNS.
- AIR-050 decision.
- Production authorization.

The future implementation orchestrator must create its own goal for R0-R1, run implementation and validation cycles until the slice passes or is genuinely blocked, and then return for R2-R3. It must not report `verified` unless the reconstruction evidence comes from the real capsule, paths, hashes, refs, and restored worktree. It must not claim clean, committed, pushed, CI, staging, deployed, live, or production during R0-R1.

## Orchestration Closeout

- Workers actually used: four Sol Max planning workers.
- Worker scopes: Git preservation; evidence reconciliation; release readiness; estimation and critical path.
- Worker results: accepted with parent reconciliation; the release worker's P2.5 sequencing correction supersedes the circular older E10 order.
- Parent verification: current repo, branch, HEAD, upstream, status, package scripts, CI, plans, receipts, ledger, deploy guards, stash, worktrees, branches, and unreachable commits inspected read-only.
- Gaps that would benefit from more planning workers: none before R0-R1. New planning is needed only if current external topology or production scope changes.
- Visible thread considered: no; this artifact is the handoff.
- Strict planning route: passed. All planning and interpretation workers used GPT-5.6 Sol at max reasoning.
- Implementation: not started.
