# XOT Post-B4 Execution Sequence

## Planner Metadata

- Repository: /Users/stevmq/Finalized XOT
- Branch: codex/xot-remediation-convergence
- Planning anchor: 0bd578856016c06a10890339f93aa13b82ecae48
- Date: 2026-08-08 America/Denver; accepted ledger evidence extends into 2026-08-09 UTC
- Plan owner: planner role, GPT-5.6 Sol, Max reasoning
- Planning mode: original full worker run with two narrow read-only Sol Max research lanes and owner synthesis; 2026-08-13 amendment is parent-only with no workers
- Artifact authority: this file orders future work; the append-only ledger and per-slice receipts remain acceptance authority
- Implementation state: E10 Phase 1 is accepted locally and E10 Phase 2 is accepted as `ACCEPTED_PREVIEW_PREPARATION_T1`; this planning update starts no external Phase 3 action

## Executive Result

B4 closed only BR-RENDER-01 / AIR-018 at local T0+T1. It did not close AIR-019, AIR-020, AIR-032, AIR-064, BR-RENDER-04, CI, staging, deployment, or live verification. Ledger row 515 is the latest B4 acceptance record and the release gate remains CLOSED.

The earlier E1-E8 sequence remains historical dependency and acceptance context. E10 Phase 2 Preview safety preparation is accepted at its deterministic local T1 boundary. The current resume point is E10 Phase 3: isolated Supabase staging, which requires explicit external provisioning authority. E10 Phase 1 and Phase 2 must not be rerun as a persistent local full stack.

This order deliberately closes contradictory or missing evidence before adding more source work. It keeps all production, provider, browser, deployment, commit, and push actions behind separate authorization gates.

## Current E10 Topology And Resume Sequence

This 2026-08-13 section supersedes the older combined E10/E11 descriptions below when they conflict. Detailed earlier task sections remain evidence and dependency history.

- Local is a disposable editing and validation lane only: lint, type, test, build, and migration validation. A bounded short-lived fixture or process is allowed only for a validation and must be torn down. No persistent local Supabase, renderer, full-stack URL, or parity environment is required.
- The only complete pre-production plane is protected Vercel Preview plus isolated Supabase staging plus an isolated staging renderer.
- Preview posting remains hard-disabled. Dedupe and translation start paused and are admin-toggleable. The only roles are `admin` and `read_only`.
- Production changes remain blocked until protected Preview acceptance and the deferred owner AIR-050 decision.

| Order | Phase | State and dependency |
| --- | --- | --- |
| 1 | E10 Phase 1 — local controls and roles | `ACCEPTED_LOCAL_PHASE1`; local receipt only, not hosted or staging evidence. |
| 2 | E10 Phase 2 — Preview safety preparation | `ACCEPTED_PREVIEW_PREPARATION_T1`; repository/source/config/runbook preparation plus deterministic local checks/build only; no persistent local full stack or hosted/staging/live proof. |
| 3 | E10 Phase 3 — isolated Supabase staging | Requires accepted Phase 2 and explicit staging provisioning/mutation authority. |
| 4 | E10 Phase 4 — isolated staging renderer | Requires accepted Phase 3 and explicit renderer-host authority. |
| 5 | E10 Phase 5 — protected Vercel Preview and hosted CI | Requires accepted backend and renderer plus exact Git/push, hosted CI, and Vercel authority. |
| 6 | E10 Phase 6 — authenticated `admin`/`read_only` full-stack acceptance and AIR-050 | Requires the protected exact-SHA Preview plane and the required Computer Use route. |
| 7 | E10 Phase 7 — closeout and production handoff | Produces receipts and a production-change proposal; it does not authorize production. |

Authorization for this update is limited to plan/sequence reconciliation and one append-only ledger row. E10 Phase 3 isolated Supabase staging requires explicit external provisioning authority. Commit, push, cloud mutation, hosted CI, deployment, browser use, provider contact, and production action remain unauthorized. Release remains `CLOSED`.

Current amendment route: planner role, GPT-5.6 Sol, Max reasoning; parent-only; no subagents or external research.

## Environment Cleanup Status

- The coordinator cleanup receipt reports that the Finalized XOT workspace has only its coordinator terminal live.
- Notebook Studio and SkillMap terminals were retained because active coordinators own them. They must not be closed from the XOT session.
- B4-owned Claude reviews and disposable PostgreSQL containers were already exited according to ledger row 515.
- No worktree, branch, dirty file, receipt, or user-owned terminal is a cleanup target.
- This planning phase did not start a server, browser, container, database connection, provider call, or implementation terminal.

## Planning Route And Orchestration Receipt

### Planning Effort Gate

- Selected role: planner
- Model: GPT-5.6 Sol
- Reasoning: Max
- Matched Max triggers:
  - More than three independent surfaces: renderer runtime, admin mutations, job lanes, migrations/RLS/types, UI/build, and release.
  - Security, data-migration, production, and release risk.
  - Conflicting ledger and receipt evidence.
  - A broad handoff that must be executable without rediscovering dependencies.
- Rejected Max trigger: the user did not explicitly request a Max planner; the user's xhigh change applies to the main session.
- Credit rationale: Max is required for evidence reconciliation and dependency ordering, not for document length.

### Orchestration Decision

- Mode: full worker run.
- Worker count: two planning research workers plus the Sol Max plan owner.
- Independent surfaces:
  - Renderer/AIR/BR acceptance and local runtime gaps.
  - Ledger, migration, security, owner, and release gates.
- Thread decision: no new visible user thread; the plan is the durable handoff.
- Token/context rationale: two non-overlapping lanes were enough because the repo already contains authoritative plans, receipts, and an append-only ledger.
- Reconsider trigger: add a new planning worker only if the canonical branch changes, a new production contract appears, or a receipt cannot be reconciled from current files.

### Worker Results

- Renderer research worker: accepted. It established AIR-018-only B4 scope, recommended AIR-019 as the next behavior-bearing slice, and rejected the AIR-060 renderer mapping.
- Ledger/release research worker: accepted with owner rework. It exposed B2A, B2B, and B3A evidence gaps and the 117-migration aggregate security boundary.
- Claude Code DeepSeek evidence worker:
  - Requested route: Claude Code through Orca, DeepSeek V4 Flash 0731, xhigh.
  - Lifecycle status: the Orca dispatch capability was invalid, so the route/model/effort receipt is not independently accepted.
  - Use: raw inventory only.
  - Verdict: accepted only with substantial rework; it did not own planning decisions.
- No implementation worker was launched.

## Source Of Truth Contract

- Intent: converge the dirty XOT remediation candidate without losing user work, overstating evidence, or crossing an external authorization boundary.
- Current behavior owner: current on-disk source at the anchored branch/HEAD plus the latest valid append-only ledger row for each AIR.
- Expected outcome owner: per-slice contract, independently reviewed receipt, append-only ledger entry, and target-boundary evidence.
- Contract boundary: renderer, worker, admin mutation transport, migrations/RLS/grants/types, frontend/build, hosted CI, staging, and release operations.
- Displaced path:
  - Unfenced renderer writes are already displaced by B4.
  - Unbounded or non-reconciled admin mutation calls must be displaced by E6.
  - Conflated batch/lane capacity and unchecked writes must be displaced by E7.
  - Receipt wording may not substitute for accepted evidence.
- Cutover: finish local/disposable evidence first; review the whole migration/security candidate; create an exact candidate only with Git authorization; then hosted CI, staging, live read-only, and one operator-approved canary.
- Acceptance evidence: exact receipt hashes, deterministic tests, isolated disposable database/runtime faults, role/grant/schema/type diffs, hosted CI artifacts, SHA-tied staging/browser receipts, production read-only evidence, and canary IDs.
- Evidence lane: T0 source → T1 local/disposable → CI → T2 staging → T3 live read-only → T4 operator-approved canary.
- Kill criteria:
  - Unexpected or unattributed dirty path.
  - Broken receipt predecessor/hash chain.
  - A stale owner or duplicate operation is accepted.
  - A supposedly isolated test reaches DNS, network, provider, or production.
  - Browser roles gain raw video-table or privileged RPC access.
  - A provider-unknown outcome is retried automatically.
  - A candidate SHA changes after acceptance.
- Forbidden moves:
  - No reset, clean, checkout, stash, broad staging, history rewrite, or overwrite of user work.
  - No broad Supabase database push or timestamp-only history repair.
  - No live SSRF, provider mutation, cleanup, deployment, commit, or push without its explicit gate.
  - No claim that T0/T1 equals CI, staging, deployed, live, or release-complete.

## Verified Current State

### Repository

- Branch: codex/xot-remediation-convergence
- HEAD: 0bd578856016c06a10890339f93aa13b82ecae48
- Remote relation: 51 commits ahead of origin at inspection time.
- Dirty paths before this artifact: 336 total; 147 tracked changes and 189 untracked paths; none may be normalized or discarded.
- Target artifact state before planning: absent.

### Accepted And Disputed Evidence

| Slice | Latest authority | Honest state | Important remaining work |
| --- | --- | --- | --- |
| B0 | ledger row 500 | T0 dirty-baseline inventory | Current tree has grown from the earlier baseline; E1 must re-anchor it |
| B1 / AIR-009, AIR-067 | ledger row 503 | local T0+T1 disposable evidence | Protected bodies, restore, owner, schema/grant/type, PAT, hosted CI, and release evidence |
| B2A / AIR-008, AIR-054 | ledger row 504 | local T0 only | Controlled no-egress runtime/T1 evidence |
| B2B / AIR-001 | ledger row 506 versus receipt review | ledger says local acceptance; receipt still contains REWORK/offline-only evidence | E3 must reconcile and independently accept or append a correction |
| B3A / AIR-003, AIR-005 | ledger rows 507-508 | source-only/partial | Disposable stale-owner and checked-write acceptance still needs a clean receipt |
| B3B1 / AIR-003 | ledger row 510 | local T0+T1 | Higher tiers deferred |
| B3B2 / AIR-066 | ledger row 513 | local T0+T1 | AIR-010 remains disabled and user-gated; higher tiers deferred |
| B4 / AIR-018 | ledger row 515 | local T0+T1 | Aggregate RLS, production replay/types, hosted CI, long-render metrics, staging, deploy, and live proof |
| AIR-019 | plan BR-RENDER-02; ledger rows 368/496 | partial source, runtime acceptance deferred | Combined HTTP/poller capacity and shutdown proof |
| AIR-020 | plan BR-RENDER-03; ledger rows 368/387/496 | partial source, runtime acceptance deferred | Hung child/log/temp/container proof and representative baseline |
| AIR-032 | plan FE-API-01 / BR-DASH-02; ledger row 496 | substantive local work remains | Mutation operation identity, idempotency, deadline, unknown outcome, and late-success reconciliation |
| AIR-064 | plan BR-JOB-02 / BR-MOD-01; ledger row 496 | substantive local work remains | Lane/batch separation, bounded concurrency metrics, and checked-write faults |

CodeGraph confirms:

- services/video-renderer/src/rendererCapacity.js has a shared non-queuing capacity gate, saturation rejection, and bounded drain, but no accepted runtime receipt proves the combined HTTP/poller boundary.
- services/video-renderer/src/processRunner.js has source-level deadline/output/TERM/KILL containment, while host descendant/container behavior remains unproved.
- src/api/adminActions.ts applies a deadline only to invokeAdminRead; invokeAdminAction mutations have no shared operation identity or reconciliation protocol.
- supabase/functions/_shared/durableClaimFence.ts and worker/jobLifecycle.ts contain checked-fence primitives, but AIR-064 still lacks an accepted lane/capacity/fault receipt.

## Rejected Or Corrected Claude Claims

- Reject the claim that every B0-B4 batch reached T0+T1. B2A and B2B are recorded at T0, and B3A remains source-only/partial.
- Reject the proposed duplicate B4b renderer-fence replay as a new feature task. AIR-018 already has T1 acceptance at row 515; only its deferred higher-tier evidence remains.
- Reject the claim that B4 closed AIR-032 or AIR-064. The B4 receipt and rows 514-515 name AIR-018 only.
- Reject the AIR-060 renderer mapping. The authoritative matrix defines AIR-060 as the auth session/role/timer state machine; BR-RENDER-04 defensibly maps to AIR-006.
- Reject AIR-064 as renderer-specific. Its authoritative owners are BR-JOB-02 and BR-MOD-01.
- Reject the Claude report's AIR-010/AIR-023 task-ID substitution and its nonexistent strategy filename.
- Reject its Orca task/dispatch receipt as lifecycle proof because the capability was invalid.

## Ordered Task Sequence

Each local behavior batch must stay within the established ceiling: one state/data contract, no more than 30 non-generated changed paths or 1,500 hand-written changed lines. Split before editing if it would exceed either limit.

### Execution Preflight — Current-Candidate Evidence Integrity Re-anchor

- Class: mandatory read-only preflight before every numbered task; not a separate implementation task.
- AIR/BR mapping: program governance; supports all AIR items and SR-REL-00.
- Scope/discovery targets:
  - git status, branch, HEAD, staged index, and dirty-path attribution.
  - docs/plans/2026-08-06-xot-dirty-baseline-inventory.json.
  - ledger rows 496-515 and all B1-B4 receipt predecessor/hash links.
  - Current 117-migration candidate, protected manifest, archive, checked-in types, and the six post-lockdown migrations detected by the video-render RLS gate.
- Dependencies: none.
- Author route: GPT-5.6 Luna High coordinator; no product edits.
- Claude route: Orca-supervised Claude Code DeepSeek V4 Flash 0731 xhigh may independently normalize the inventory only if the exact route receipt is valid.
- Reviewer route: separate read-only reviewer; coordinator independently verifies all hashes and statuses.
- Validation/evidence: T0; exact path counts, staged index empty, JSONL parse, predecessor hashes, receipt hashes, and one accepted/disputed/deferred matrix.
- Stop conditions: unexpected path, overlapping writer, edited historical row, broken hash, secret-bearing output, or unverified route.
- Deferred: all source changes and higher tiers.

### E1 — BR-RENDER-02 / AIR-019 Local Runtime Acceptance

- Class: first behavior-bearing implementation slice; local T0+T1.
- AIR/BR mapping: AIR-019; BR-RENDER-02; regression-protect AIR-076 and AIR-079.
- Scope/files:
  - services/video-renderer/src/rendererCapacity.js
  - services/video-renderer/src/server.js
  - services/video-renderer/src/renderer.js
  - services/video-renderer/src/config.js
  - services/video-renderer/test/server.test.js and focused capacity/shutdown fixtures
  - scripts/check-renderer-capacity-contract.mjs and receipt/ledger tooling
- Dependencies: execution preflight and unchanged B4 hashes.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh worker drafts adversarial cases and performs an independent read-only review; it does not own acceptance.
- Reviewer route: independent Luna High acceptance of code, tests, and receipt.
- Validation/evidence:
  - Prove HTTP render, HTTP preflight, and poller share one gate.
  - Saturation returns Retry-After before any claim RPC.
  - SIGTERM/SIGINT stop new claims, clear timers/listener, and drain or abort within grace.
  - No false terminal state or unreclaimable current claim.
  - Focused normal/mutation contracts, renderer suite, strict boundary typecheck, diff check, and staged index empty.
- Target tier: T0+T1 only.
- Stop conditions: saturation reaches a claim, paths use separate gates, shutdown cannot prove fenced/reclaimable ownership, or proof requires production/provider contact.
- Deferred: production-like load, host metrics, staging, deploy, live.

### E2 — BR-RENDER-03 / AIR-020 Local Subprocess Containment Acceptance

- Class: local T0+T1.
- AIR/BR mapping: AIR-020; BR-RENDER-03; supports AIR-008 and preserves AIR-076.
- Scope/files:
  - services/video-renderer/src/processRunner.js
  - ffmpeg.js, preflight.js, preview.js, renderer.js
  - focused fake-child and temporary-file fixtures
  - Dockerfile/docker-compose.yml only if local evidence exposes a missing source contract
  - scripts/check-renderer-process-runner-contract.mjs and receipt/ledger tooling
- Dependencies: E1.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh adversarial review of process trees, deadlines, bounded streams, and cleanup.
- Reviewer route: independent Luna High acceptance.
- Validation/evidence: hung process, descendant, output overflow, abort, TERM→KILL escalation, forced-settle timeout, temp cleanup, and no raw stderr leakage; normal/mutation contracts and full renderer suite.
- Target tier: T0+T1. Host CPU/memory/PID/temp limits and healthy-render p95 remain T2.
- Stop conditions: descendant survives the test boundary, output can grow unbounded, cleanup deletes unrelated temp paths, or limits are guessed without measurement.
- Deferred: real host/container caps and representative performance baseline.

### E3 — AIR-032 Shared Admin Mutation Operation Protocol

- Class: local T0+T1; original strategy B4 remainder.
- AIR/BR mapping: AIR-032; FE-API-01 and BR-DASH-02; supports AIR-058.
- Scope/discovery targets:
  - src/api/adminActions.ts, adminRetry.ts, and adminActionErrors.ts
  - supabase/functions/admin-actions dispatcher/action-name registry and admin-retry
  - one durable operation/request identity contract and bounded representative mutation set
  - focused client/server blackhole, duplicate, timeout, late-success, and reconcile tests
- Dependencies: E1-E2 and execution preflight; any schema addition joins the current-candidate chain and must precede E7.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh maps mutation call sites and independently reviews ambiguity semantics; raw call-site inventory is evidence, not acceptance.
- Reviewer route: independent Luna High reviewer.
- Validation/evidence:
  - Reads retain bounded deadlines.
  - Mutations receive stable operation identity and idempotency.
  - Client timeout is unknown outcome, not cancellation or safe retry.
  - Reconciliation returns committed, failed, still-running, or unknown truth.
  - Duplicate delivery is prevented across blackhole and late-success faults.
- Target tier: T0+T1.
- Stop conditions: one protocol cannot cover the selected actions safely, retry can duplicate a side effect, operation rows expose payloads/secrets, or the batch exceeds its path/line ceiling.
- Deferred: full call-site rollout may require multiple sub-receipts; real runtime late-success proof waits for T2.

### E4 — AIR-064 Job Lane Capacity And Checked-Write Closure

- Class: local T0+T1; original strategy B4 remainder.
- AIR/BR mapping: AIR-064; BR-JOB-02 and BR-MOD-01.
- Scope/files:
  - supabase/functions/worker/index.ts
  - workerUtils.ts, jobLifecycle.ts, durableClaimFence.ts
  - focused lane/batch/claim/write fault fixtures and metrics contract
- Dependencies: E3; E6 later rechecks the underlying B3A evidence where needed.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh reviews lane accounting and zero-row failure paths.
- Reviewer route: independent Luna High reviewer.
- Validation/evidence:
  - Batch fetch size is separate from execution capacity.
  - Fast/model/delivery lanes have explicit bounded concurrency.
  - Every authoritative claimed write is checked and fenced.
  - Zero-row/error writes are non-success.
  - Queue wait, claim delay, run time, saturation, and retry metrics are bounded and interpretable.
- Target tier: T0+T1.
- Stop conditions: batch size is used as hidden concurrency, a lifecycle write ignores its result/fence, or metrics require unbounded row hydration.
- Deferred: production workload tuning and live queue metrics.

### E5 — B2A No-Egress Runtime Closure

- Class: local isolated T1.
- AIR/BR mapping: AIR-008, AIR-054; BR-MEDIA-02, SR-INPUT-01, QA-02.
- Scope/files: B2A receipt and existing remote-media request policy/fetch capsule, Deno/runtime fixtures, isolation receipt, and append-only acceptance repair if warranted.
- Dependencies: execution preflight; isolation environment with network disabled.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh generates hostile corpus variants from static inputs only.
- Reviewer route: independent Luna High reviewer verifies zero egress and teardown.
- Validation/evidence: redirects, private/link-local/metadata targets, DNS rebinding representation, slow/oversized/compressed streams, MIME mismatch, invalid port/certificate, and forbidden request count zero.
- Target tier: T1.
- Stop conditions: any DNS/network/provider/production contact, test bypasses the real fetch policy boundary, or teardown is incomplete.
- Deferred: staging runtime proof; live exploitation remains forbidden.

### E6 — B2B/B3A Disposable Acceptance Repair

- Class: local/disposable T1.
- AIR/BR mapping: AIR-001, AIR-003, AIR-005; BR-MEDIA-01/03, BR-JOB-01/02.
- Scope/files:
  - docs/plans/2026-08-06-xot-b2b-media-object-claims.json
  - docs/plans/2026-08-06-xot-b3a-job-x-claim-fencing.json
  - current owning migrations, fixtures, and receipt/ledger appenders only when evidence requires correction
- Dependencies: execution preflight and E5.
- Author route: GPT-5.6 Luna High.
- Claude route: exact-receipted DeepSeek xhigh independently reviews the prior REWORK and source-only gaps.
- Reviewer route: independent Luna High reviewer must return ACCEPT, REWORK, or BLOCKED.
- Validation/evidence:
  - Mixed-age/shared-reference media claims and forced storage failure.
  - Stale job/X owner rejection, generation rotation, checked zero-row writes, and provider-start ambiguity.
  - Disposable PostgreSQL replay, no network, exact cleanup receipt.
- Target tier: T1 where the actual boundary is exercised.
- Stop conditions: prior REWORK remains unaddressed, a stale owner succeeds, storage failure clears DB state, provider marker failure allows a call, or evidence conflicts with immutable ledger rows.
- Deferred: production schema, canary, and provider evidence.

### E7 — Aggregate Migration, RLS, Grant, And Type Boundary

- Class: HIGH local/disposable review; Codex migration/security boundary.
- AIR/BR mapping: AIR-007, AIR-009, AIR-067; SR-MIG-01, SR-RLS-01, SR-TYPE-01; supports all schema-bearing B1-B4 work.
- Scope/files:
  - all current candidate migrations after E1-E6 stabilize
  - six current post-lockdown migrations beginning at 20260730070000 through 20260808123000, plus any new migration from E6/E7
  - scripts/check-video-render-rls-contract.mjs
  - migration equivalence manifest/ledger, schema-privilege diff, checked-in types, B1-B4 receipts
- Dependencies: E1-E6; protected source evidence and owner approval are required only for promotion beyond local/disposable.
- Author route: GPT-5.6 Luna High migration owner; one migration writer only.
- Claude route: exact-receipted DeepSeek xhigh performs byte/body/access-surface review and a separate independent review. No blind digest exemption.
- Reviewer route: Luna High coordinator plus the designated migration and auth/RLS acceptance boundaries.
- Validation/evidence:
  - Fresh empty replay of the whole candidate.
  - Expected schema/RPC/policy/grant/type diff.
  - Browser roles retain zero raw protected-table or service-only RPC access.
  - Every SECURITY DEFINER function has pinned search_path, safe ownership, and exact grants.
  - Current generated types bind to the reviewed schema.
  - Normal/mutation migration, RLS, strict, and AIR coverage gates pass.
- Target tier: T1. Protected/production equivalence remains blocked until owner evidence arrives.
- Stop conditions: unknown destructive drift, broad grant, dynamic/default privilege ambiguity, missing remote body/effect, timestamp-only repair, stale types, or broad database push.
- Deferred: migration apply, production history action, staging, live.

### E8 — Post-Correctness Source Tranches

- Class: local T0/T1, split into independent receipts; never one broad writer.
- AIR/BR mapping:
  - E8a: AIR-036; BR-MOD-01/02 and FE-QUALITY-01.
  - E8b: AIR-037 plus regression coverage for AIR-038-040; FE-BUNDLE-01.
  - E8c: local portions of AIR-049 and AIR-050; FE-VISUAL-01 and FE-DASH-02.
  - E8d: local inventory for AIR-052/AIR-078 and source contract for AIR-055; SR-SUPPLY-01 and SR-BUILD-01.
- Scope:
  - E8a adds characterization first, then one pure module move per receipt.
  - E8b captures current route/asset weights before a scoped asset or loading change.
  - E8c prepares a dense, task-first hierarchy candidate without claiming visual acceptance.
  - E8d inventories root/renderer/Deno/Docker/CI dependencies, SBOM inputs, waivers, and masked public-env shape without exposing values.
- Dependencies: E7 local acceptance; E8a also requires correctness stability from E1-E6.
- Author route: separate GPT-5.6 Luna High author per non-overlapping sub-batch.
- Claude route: separate exact-receipted DeepSeek xhigh inventory/review lanes for architecture, asset manifest, visual diff, and supply-chain evidence.
- Reviewer route: independent Luna High per sub-batch; frontend work also requires frontend-design and later visual QA.
- Validation/evidence: characterization parity; strict/types/tests; manifest/transfer-size comparison; no route/control loss; source/static supply inventory; normal/mutation contracts; batch ceiling enforced.
- Target tier: T0/T1 only.
- Stop conditions: a pure move changes behavior, asset change lacks a baseline, styling overlaps correctness work, scanner omits a runtime surface, or a sub-batch exceeds the ceiling.
- Deferred: browser paint/responsive/operator proof, hosted scans, real build/deploy artifact.

### E9 — Parallel Owner And External Gate Packet

- Class: user/owner/external; may proceed in parallel with E1-E8 without blocking safe local work.
- AIR/BR mapping: AIR-010, AIR-017, AIR-050, AIR-052, AIR-055, AIR-065; SR-REL-00 and SR-MIG-01.
- Required decisions/evidence:
  - AIR-010: keep ordered thread delivery disabled or authorize a revision-bound ordered consumer.
  - AIR-017: representative production query plans/workload metrics and database-owner approval.
  - AIR-050: operator approval of the task hierarchy.
  - AIR-052: waiver adjudication owner if scans find actionable exceptions.
  - AIR-055: masked production-shaped public Vite environment and Vercel provenance.
  - AIR-065: explicit canary and cleanup-schedule authorization.
  - Protected migration bodies/schema dump, backup/PITR/restore readiness, privilege evidence, and PAT alert #1 disposition.
- Author route: owner supplies decisions/evidence; Luna High coordinator records only redacted receipts.
- Claude route: DeepSeek xhigh may normalize redacted inventories after exact route verification; it must not access or reproduce secrets.
- Reviewer route: designated database, security, product, and release owners.
- Validation/evidence: signed/dated decision and redacted source receipts; no secret values.
- Target tier: T0 decision records or T3 read-only evidence as appropriate.
- Stop conditions: missing owner, secret-bearing output, stale snapshot, or request expands into mutation without authorization.
- Deferred: implementation of AIR-010 if enabled becomes its own plan and batch.

### E10 — Exact Candidate, Hosted CI, And Build

**Current sequencing note:** Do not execute this older combined phase as one unit. Use the seven-step E10 resume sequence above and the current E10 Preview parity plan. This section remains historical dependency context.

- Class: external and Git-authorized.
- AIR/BR mapping: AIR-006, AIR-018-020, AIR-032, AIR-037, AIR-049, AIR-050, AIR-052, AIR-053, AIR-055, AIR-064; QA-01 through QA-04 and SR-REL-01.
- Scope:
  - Full local candidate gates and 80-AIR latest-state map.
  - Independent pre-commit convergence review.
  - With explicit Git authorization only: stage exact paths, create one checkpoint SHA, push that unchanged SHA, and run hosted CI/scans/build.
  - Produce SHA-bound hosted CI, dependency/container/Deno scans, and the masked production-shaped build artifact.
- Dependencies: E1-E9 accepted; owner gate packet complete enough for the selected wave.
- Author route: GPT-5.6 Luna High release coordinator; no overlapping writers.
- Claude route: exact-receipted DeepSeek xhigh performs independent candidate review and CI/log evidence normalization; it cannot approve its own authored output.
- Reviewer route: Luna High final pre-commit acceptance plus migration/security boundaries.
- Validation/evidence: full lint, strict, Vitest, Deno, renderer, migration, supply, build, 80-AIR normal/mutation, and exact SHA/artifact binding.
- Target tier: exact local candidate plus hosted CI/build evidence; no staging claim.
- Stop conditions: candidate changes after review, CI or scan failure, build lacks SHA/env provenance, or an exception lacks owner and expiry.
- Deferred: staging, production, and canary.

### E11 — Staging T2 And Authenticated Browser Acceptance

**Current sequencing note:** Staging provisioning, renderer deployment, protected Vercel Preview, and authenticated acceptance are now separate E10 Phases 3–6. This section remains historical acceptance context.

- Class: external; explicit staging and credential authorization required.
- AIR/BR mapping: AIR-006, AIR-018-020, AIR-032, AIR-037, AIR-049, AIR-050, AIR-053, AIR-055, AIR-064; QA-02 through QA-04 and SR-REL-01.
- Scope:
  - Apply only approved forward migrations and regenerate types against the exact E10 SHA.
  - Deploy backend/functions, renderer, and frontend in waves with seeded non-provider fixtures.
  - Run the role matrix, long-render renewal, stale-owner rejection, subprocess/shutdown, late-success reconciliation, lane-capacity metrics, and rollback exercise.
  - Use the Codex native browser for authenticated `admin`/`read_only` desktop/mobile, responsive, keyboard, accessibility, console, and network receipts.
  - Prove BR-RENDER-04 / AIR-006 with exact two-render preview/publish equality and stale-dialog rejection; provider-affecting actions remain stubbed.
- Dependencies: E10 unchanged SHA and the relevant E9 owner evidence.
- Author route: GPT-5.6 Luna High staging coordinator.
- Claude route: exact-receipted DeepSeek xhigh normalizes redacted logs and independently reviews the T2 evidence; no UI interaction or deployment authorization.
- Reviewer route: Luna High engineering acceptance plus database/security owners; Computer Use, if needed, must use GPT-5.6 Sol low Fast.
- Validation/evidence: SHA-bound migration/type/deploy receipts, role matrix, renderer and mutation runtime faults, authenticated route/state/viewport matrix, rollback.
- Target tier: T2 staging only.
- Stop conditions: deployed SHA differs, role leakage, a browser action reaches a real provider, migration/type drift, runtime invariant failure, or rollback cannot be exercised.
- Deferred: production and canary.

### E12 — Production Read-Only, Canary, And Cleanup-Last Closure

- Class: external HIGH; explicit production authorization required.
- AIR/BR mapping: all remaining AIR higher-tier obligations; AIR-017 and AIR-065 are explicit; QA-05 and SR-REL-01.
- Scope/order:
  1. Re-anchor live deploy/function/renderer/schema/migration/cron/queue/provider-ledger provenance at T3 read-only.
  2. Confirm PAT, protected migration, restore, owner, privilege, type, CI, and staging gates are closed.
  3. Run one bounded T4 canary per approved side-effect/data boundary with exact IDs and provider counts.
  4. Observe kill metrics and exercise rollback.
  5. Re-enable media cleanup last: dry-run, one bounded claimed batch, observation, then one canonical schedule.
  6. Append final AIR dispositions without rewriting history.
- Dependencies: current E10 Phase 7 closeout accepted at the exact unchanged SHA and explicit production authorization.
- Author route: GPT-5.6 Luna High release coordinator with named database/provider owners.
- Claude route: exact-receipted DeepSeek xhigh may monitor and normalize redacted evidence; it must not independently authorize or trigger production actions.
- Reviewer route: final Luna High engineering acceptance plus database/security/release owners.
- Validation/evidence: T3/T4 receipts, exact provider counts, post-deploy hashes, invariants, queue/claim/storage/auth/latency metrics, rollback, one cleanup schedule, and complete 80-AIR matrix.
- Stop conditions: any source-of-truth kill criterion, unknown provider outcome, invariant drift, duplicate call, stale owner success, unexpected deletion candidate, auth/RLS regression, or rollback failure.
- Deferred: none for release-complete; any unresolved item keeps the release gate CLOSED.

## Validation Command Families For Future Execution

Use focused checks per slice, then the whole-candidate matrix at E10. Commands are listed as future execution instructions; none ran during this planning phase.

- Renderer: npm --prefix services/video-renderer test; renderer capacity, request, error, process-runner, claim-fence, and boundary-typecheck contracts.
- Migrations: migration baseline normal/mutation tests, disposable replay, schema/privilege/type diff, video-render RLS contract, and AIR coverage normal/mutation.
- Core: git diff --check; staged index empty; npm run check:strict; strict-project normal/mutation.
- Whole candidate: root lint, functions lint/check/test, Vitest, renderer tests, audits, supply-chain contract, masked Vite build, release-state receipt.
- Browser: Codex native browser/computer-use only, tied to the exact staging SHA; `admin` and `read_only` roles; desktop/mobile; network, console, responsive, keyboard, accessibility, and rollback receipts.

## Implementation Handoff

- E10 Phase 2 Preview identity, deploy guard, configuration, and runbook hardening is accepted as `ACCEPTED_PREVIEW_PREPARATION_T1` at the local deterministic validation boundary. It did not create a persistent local full stack or any hosted/staging/live evidence.
- The next implementation goal is E10 Phase 3 isolated Supabase staging. It requires explicit external provisioning authority; the implementation orchestrator must preserve every unrelated path and stop before any unauthorized cloud mutation. Do not rely on a historical fixed dirty-path count.
- Allowed: scoped source/tests/receipt/append-only ledger changes named by the selected task.
- Disallowed: unrelated refactor, destructive Git cleanup, broad staging, database/provider/browser/deploy actions, or evidence promotion.
- Required tools: CodeGraph before code reads/edits; applicable TDD/checkpoint/acceptance skills; Context7 only for current library/platform behavior; Orca/Claude only with an exact route receipt.
- Route rule for implementation:
  - The governing phase table requires product code and execution ownership by GPT-5.6 Luna High.
  - Claude Code DeepSeek V4 Flash 0731 xhigh should be used extensively for bounded evidence collection, adversarial fixture proposals, diff review, and independent cross-checks when the exact Orca route is verified.
  - If the user intends Claude to own product-code edits despite the current phase table, obtain an explicit route amendment before implementation. Do not silently substitute or misreport the route.
- Do not report verified unless acceptance evidence comes from the real route, payload, row, artifact, trace, rendered UI, or operator-visible output named by the task.
- Do not claim committed, pushed, CI, staging, deployed, live, release-ready, or release-complete until the corresponding task explicitly passes.

## Orchestration Closeout

- Workers actually used: two Sol Max planning research workers; one pre-existing Claude/DeepSeek raw evidence report.
- Worker results:
  - Renderer lane accepted.
  - Ledger/release lane accepted with owner reconciliation.
  - Claude report accepted only with rework; invalid lifecycle receipt and unsupported claims rejected.
- Parent verification: live branch/HEAD/status, CodeGraph source, package scripts, canonical plan, strategy, receipts, and ledger rows 496-515 inspected.
- Gaps that would benefit from more workers: none during planning; implementation workers should be created only per bounded task.
- Visible thread considered: no; the repo-local artifact is the handoff.
- Planning route: passed for the Sol Max plan owner. Nested planning workers were explicitly assigned Sol Max; their internal telemetry reported unknown and their evidence was independently verified.
- Implementation: not started.
