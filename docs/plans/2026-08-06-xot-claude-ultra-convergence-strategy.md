# XOT Claude-Ultra Convergence Strategy Addendum

## Decision

The proposed model is efficient **only after one change**: Claude Code may run long autonomous tranches, but not one undifferentiated implementation batch followed by a single late review. With 300 dirty paths, that would make regressions, ownership, and rollback hard to reconstruct. Use small receipt-backed Claude batches, an independent Claude reviewer after every batch, and Codex only at three high-risk boundaries. Routine review stays inside Claude/Orca.

Target executor route: Claude Code through Orca using DeepSeek V4 Flash 0731, Ultracode, `xhigh`, dynamic workflows. This is a requested route, not a currently verified runtime fact; every author/reviewer receipt must record the Orca dispatch/session ID and exposed provider/model/workflow/effort. Record `unknown` rather than infer a setting.

## Anchor And Authority

- Repository: `/Users/stevmq/Finalized XOT`
- Branch/HEAD: `codex/xot-remediation-convergence` at `0bd578856016c06a10890339f93aa13b82ecae48`, 51 commits ahead of origin.
- Observed dirty baseline before this addendum: 300 paths: 143 tracked, 157 untracked, none staged; this addendum is the only authorized new path in this planning turn.
- AIR state: 80 total; AIR-051 closed/disproved; 60 materially/source-addressed; 19 still require substantive work.
- AIR-009: `T0+T1` only. The 2026-08-06 receipt proves official Storage bootstrap (61 migrations) plus all 112 repo migrations replay cleanly. It does not prove the protected historical baseline, production schema/policy/grant/type equivalence, reviewed-SHA binding, CI/staging/live state, or release approval.
- Hard release-security issue: historical Supabase PAT alert #1 remains unresolved.
- Canonical sources: `docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md`; `docs/plans/2026-07-31-xot-audit-unfinished-dispositions.json`; append-only `docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl`; `docs/plans/2026-08-06-xot-disposable-migration-reconciliation.json`; `package.json`; `.github/workflows/ci.yml`; `docs/operations/database-type-trust.md`.

Source-of-truth contract: current files plus latest append-only ledger rows own local state; reviewed SHA, CI, staging, production reads, and canary receipts own higher-tier state. Tests support but never replace target-boundary proof. No broad DB push, history repair by timestamp, live SSRF, automatic retry of ambiguous provider work, secret output, destructive cleanup, or hidden behavior change inside a refactor.

## The 19 Substantive Items

| AIR | Work Claude can do locally after implementation authorization | Remaining blocker/class |
| --- | --- | --- |
| AIR-001 | Additive media-object/claim design and mixed-age/storage-failure fixtures | Migration trust plus live cleanup freeze and canary; owner/production |
| AIR-003 | Durable receipt identity, idempotent materialization, DB-failure tests | Reviewed migration and runtime evidence |
| AIR-005 | Claim token/generation and stale-owner concurrency fixtures | Reviewed migration and runtime evidence |
| AIR-008 | Bounded fetch policy and controlled no-egress corpus | Security runtime proof; never live exploitation |
| AIR-010 | None until product choice | User must choose disabled vs revision-bound ordered consumer; provider proof if enabled |
| AIR-017 | Prepare query/DDL evidence template | Representative production plans/metrics and database-owner approval |
| AIR-018 | Lease renewal/fenced completion and long-render fixture | Runtime/container proof |
| AIR-032 | Shared mutation operation/idempotency protocol and blackhole tests | Late-success reconciliation at a real runtime boundary |
| AIR-036 | Characterization tests and later pure module moves | Correctness waves must stabilize first |
| AIR-037 | Bundle/asset measurement and scoped replacement | Production-like env plus browser visual/transfer proof |
| AIR-049 | Scoped visual-layer changes | Browser paint/responsive comparison |
| AIR-050 | Prepare task-based hierarchy candidate | Operator decision/review plus SHA-tied browser evidence |
| AIR-052 | Prepare scan inventory/exception format | Hosted CI/network scanners and waiver adjudication |
| AIR-053 | Prepare route/state matrix | Authenticated staging admin/viewer accounts and browser |
| AIR-054 | Run only controlled no-egress SSRF fixtures | Isolation receipt; live/internal targets forbidden |
| AIR-055 | Harden env/build contract | Masked production-like Vite values and deploy artifact |
| AIR-064 | Bounded lane/concurrency and checked-write fixtures | Reviewed schema plus runtime metrics |
| AIR-065 | Keep cleanup contained; prepare cutover checklist | AIR-001 first, then explicit canary/schedule authorization |
| AIR-066 | Deterministic run/output/enqueue checkpoints and interruption tests | Reviewed forward migration and runtime fault proof |

Blocker split:

- Locally actionable: AIR-003, AIR-005, AIR-008, AIR-018, AIR-032, AIR-036, AIR-054, AIR-064, AIR-066; local portions of AIR-001, AIR-037, AIR-049, AIR-050.
- User decisions/owner approval: AIR-001, AIR-010, AIR-017, AIR-050, AIR-052 if waivers arise, AIR-055, AIR-065; plus protected migration ownership and PAT alert #1 disposition.
- Credentials/external services: AIR-001, AIR-010 if enabled, AIR-017, AIR-052, AIR-053, AIR-055, AIR-065; AIR-009 release evidence also needs protected/remote inputs.
- Runtime/browser/CI/staging: AIR-003, AIR-005, AIR-008, AIR-018, AIR-032, AIR-037, AIR-049, AIR-050, AIR-052, AIR-053, AIR-054, AIR-055, AIR-064, AIR-066.
- Hard stops: PAT alert #1; unresolved protected migration/body/privilege/type evidence; any unknown destructive drift; any live SSRF/provider/cleanup action without authorization.

The 60 materially addressed items are not release-complete. Their remaining gates are: forward migration/runtime for AIR-002, AIR-007, AIR-063, AIR-070, AIR-072, AIR-074; runtime/release evidence for AIR-004, AIR-011–016, AIR-019, AIR-020, AIR-023, AIR-024, AIR-026, AIR-027, AIR-035, AIR-059; higher-tier validation for AIR-006, AIR-021, AIR-022, AIR-025, AIR-028–031, AIR-033, AIR-034, AIR-038–048, AIR-056–058, AIR-060–062, AIR-068, AIR-069, AIR-071, AIR-073, AIR-075–080; and AIR-009/AIR-067 reviewed-schema, type, Deno, CI, and release evidence.

All 19 cannot be release-complete under current authorization. Even after local implementation is allowed, these seven are intrinsically user/external-gated: **AIR-001, AIR-010, AIR-017, AIR-052, AIR-053, AIR-055, AIR-065**. AIR-037/AIR-049/AIR-050 also remain incomplete until a browser/operator lane is authorized.

## Low-Codex Operating Model

Claude/Orca owns implementation, routine review, integration, and inexpensive validation.

1. The conductor defines one contract, AIR set, allowed path list, dependencies, kill criteria, and receipt path.
2. A Claude author lane edits only that allowlist. One designated migration writer and one designated shared-entrypoint writer prevent overlap.
3. A different Claude dispatch/session performs read-only review from the contract, diff, and raw outputs. It must rerun selected gates itself, cannot edit code or ledger, and returns `ACCEPT`, `REWORK`, or `BLOCKED` with findings. The author fixes; the same independent reviewer rechecks.
4. A Claude integrator verifies path ownership, generated-file isolation, ledger linkage, and cross-batch compatibility every two or three batches.
5. Normal batch ceiling: one state/data contract, no more than 30 non-generated changed paths or 1,500 hand-written changed lines. Exceeding either requires a split or an explicit integrator exception.
6. Each accepted batch writes a receipt containing baseline HEAD/dirty-manifest hash, AIR/task IDs, allowed/actual paths, author and reviewer route receipts, checks and raw-output locations, achieved/deferred evidence tiers, deployment state, unresolved risks, and rollback/kill receipt. Then append one new ledger row; never edit or delete prior rows.

Cheap gates after every batch:

```text
git diff --check
git diff --cached --quiet
npm run check:air-ledger-coverage
MUTATION_TEST=1 npm run check:air-ledger-coverage
npm run check:strict
```

Also run only the named affected contract checks/tests. Migration batches add `npm run check:migration-baseline` and `npm run test:migration-baseline`; the release gate is expected to stay blocked until protected evidence exists. Media batches use the remote-media/cleanup checks. Receipt/job batches use RSS persistence, worker lifecycle, and digest persistence checks. Runtime batches use renderer capacity/request/error/process and admin-action error checks. Full lint, Vitest, renderer tests, Deno functions, audits, build, and the complete CI-equivalent matrix run once per tranche/final candidate, not after every small batch.

### Only Three Codex Review Boundaries

1. **Migration/data invariants:** review AIR-009 plus every new forward migration, schema/claim/receipt/checkpoint invariant, generated-type binding, and replay evidence before any DB/staging apply. This may cover B1–B3 in one call.
2. **Auth/RLS/security:** review role/grant/auth boundaries, AIR-008/AIR-054 isolation evidence, AIR-007/AIR-070–075 controls, secret handling, and PAT disposition before staging. Combine with boundary 1 when one evidence pack is ready.
3. **Final pre-commit convergence:** one independent consolidated audit of the exact candidate diff, 80-AIR latest-state map, dirty-path attribution, Claude receipts/reviews, full local gates, and remaining external blockers. Its verdict approves an exact local SHA for later push/CI; it does not claim CI, staging, or release evidence.

No Codex review after ordinary batches. Reinvoke Codex only if a later change invalidates one of these exact boundaries.

## First Five Claude Batches

| Batch | Scope and dependency | Acceptance receipt |
| --- | --- | --- |
| B0 | Freeze/attribute the 300-path dirty baseline; no behavior edits | Every path classified by AIR/task/user ownership; staged index empty; unexpected delta zero |
| B1 | Reconcile AIR-009/AIR-067 candidate evidence against the protected 210-entry/107-file manifest and current 112-file tree; no history rewrite | T0+T1 replay linked; exact unresolved owner/schema/grant/type/CI/PAT gates; migration checks recorded |
| B2 | AIR-001/AIR-008/AIR-054 media ownership plus no-egress security tranche; schema work waits for B1 | Mixed-age/reference and storage-failure invariants; forbidden-target request count zero; no live contact |
| B3 | AIR-003/AIR-005/AIR-066 durable receipts, token fencing, checkpoints; depends B1 | DB failure is non-success; stale tokens rejected; crash transitions yield one receipt/output/job |
| B4 | AIR-018/AIR-032/AIR-064 runtime ownership, mutation reconciliation, and capacity; depends B2/B3 | Long-render renewal, stale-owner rejection, late-success reconciliation, bounded concurrency metrics |

AIR-010 waits for the user. AIR-017 waits for production plans/metrics. AIR-036/037/049/050 follow correctness stabilization and browser authorization. AIR-052/053/055 wait for hosted/staging access. AIR-065 is last, after AIR-001 and explicit production approval.

## Authorization And Git Containment

- Authorized now: this planning artifact only. No product/config/migration edits, tests, server, Deno, browser, network/provider/database calls, commit, push, CI, or deployment.
- Separate local implementation authorization: B0–B4 source work and local/disposable tests. Port 8080 remains off unless explicitly requested.
- Separate Git authorization: create a local checkpoint only after B0 attribution and Claude acceptance; stage explicit paths, never `git add -A`; no reset, clean, checkout, stash, amend, rebase, or overwrite. Codex boundary 3 reviews the exact checkpoint SHA; push that unchanged SHA, then run CI.
- Separate external authorization: hosted scans/CI, masked env, staging accounts/browser, production read-only evidence, migration/history actions, provider tests, cleanup canary, deployment, and rollback drill. Deployment is a later goal.

State vocabulary is exact: `source-addressed (T0)`, `validated locally/disposable (T1)`, `CI green`, `pushed`, `staging deployed`, `staging verified (T2)`, `live read-only verified (T3)`, `live canary verified (T4)`, `release-complete`, `blocked`, `deferred`, `not checked`. Never promote a lower tier, equate “implemented” with accepted, or call a screen/worker report release proof.

Stop immediately on an unexpected path, overlapping writers, unverified executor/reviewer route, non-independent reviewer, altered historical/protected evidence, new cast/suppression used to silence a boundary, failed invariant, secret in output, production/network contact, provider ambiguity, request to weaken auth/RLS/CSP, or a batch above the ceiling. Preserve the diff and receipt; classify `BLOCKED`; do not improvise around the gate.

## Recommended Later Goal Wording

> Converge the XOT remediation worktree at `/Users/stevmq/Finalized XOT` on `codex/xot-remediation-convergence` using Orca-managed Claude Code author and independent reviewer lanes on the runtime-evidenced DeepSeek V4 Flash 0731 Ultracode/xhigh/dynamic route. Preserve and attribute the existing dirty baseline; execute B0–B4 as bounded allowlisted batches; run cheap gates and append-only receipts/ledger updates after each; use Codex only for migration/data, auth/RLS/security, and final pre-commit convergence acceptance. Stop before commit/push/CI/browser/staging/provider/production/deployment unless separately authorized. Done for this run when all locally authorized AIR work is accepted at its honest tier, every external/user blocker is exact and owned, no dirty path or AIR is orphaned, and the final Codex audit names the exact candidate SHA and remaining release gates.

## Planning Closeout

- Planning mode: lightweight planning.
- Planning worker: one — planner worker, GPT-5.6 Sol, Max reasoning; result accepted subject to parent integrity review.
- Visible thread: none.
- Implementation has not started.
- Required future handoff route: a GPT-5.6 Luna High Codex conductor/acceptance owner should coordinate the user-directed external Orca/Claude executor and preserve the three-boundary limit.
- Reconsider only if a new independent surface appears or current evidence contradicts the AIR disposition.
