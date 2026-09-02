# XOT New Version Finish And Fast Production Cutover Plan

## Planner Metadata

- Repository: `/Users/stevmq/Finalized XOT`
- Branch and head: `codex/xot-full-closure-candidate` at `f599287`
- Date: 2026-08-25
- Planning owner: `planner`, GPT-5.6 Sol, Max reasoning
- Planning input: completed Git, Supabase, renderer, UI, release, and production-state packet; no new research
- Worktree state: dirty with user-owned renderer persistence edits; preserve them and do not reset, clean, stash, or overwrite them
- V2 base: PR #70 at `f599287`
- V1 continuity line: PR #72 at `b8bee2`, including PR #71 and the live-V1 cutoff protections
- Current Preview: stale artifact `040fd`; it is not an acceptance candidate
- Production safety boundary T1: `2026-08-25 10:36:06.834081+00`
- Implementation state: implementation has not started

## Executive Goal

Create one clean, reviewed composite release candidate that combines PR #70 with PR #72 through semantic resolution of all 27 overlapping files and 61 conflict blocks.

Prove that exact source SHA in an isolated Preview, pre-stage additive and reversible production assets while healthy V1 stays live, and perform only the final route switch during an 8-15 minute activation window. Natural production proof can finish later; it must never be manufactured.

The governing rule is fail-closed delivery: rows created at or before T1, and rows with missing or ambiguous lineage, may continue safe processing but must never post, retry, requeue, reset, be cleaned into eligibility, or be manually advanced.

## Source Of Truth Contract

- Intent: replace active V1 routing with the finished V2 route without replay, duplicate delivery, or a long outage.
- Current behavior: production V1 is healthy; Preview is stale; the candidate is split across PR #70 and PR #72.
- Expected outcome: one exact source SHA controls guarded RPCs, Edge workers, one active renderer, and separate Preview/production frontend builds; only natural work strictly newer than activation cutoff T2 can post.
- Truth owner: immutable database cutoffs and activation ledger, plus the reviewed Git commit SHA bound to CI, Preview, and the production-scoped build.
- Contract boundary: runtime controls, RPCs, claimers, posting gates, renderer selection/startup, auth, frontend identity, and release routing.
- Displaced path: live V1 claim routes and UI become warm rollback assets after activation; no schema or historical-data path is removed.
- Cutover: block posting, pause claimers, reach zero active claims, append T2 from the production database clock, then activate pre-staged V2 routes in the stated order.
- Acceptance evidence: exact-SHA review/CI/Preview, production-scoped deploy metadata, dual-contract rehearsal, role/viewport UI receipts, no-post renderer proof, rollback drill, production control rows, and natural-new provider evidence.
- Evidence lane: Git/GitHub, Supabase schema/rows/RPCs/logs, Lightning images/health/logs, Vercel deployment metadata, and native-browser receipts.
- Kill criteria: any `<= T1` or missing-lineage provider attempt; any duplicate claim; any destructive migration; nonzero active claims at T2; wrong artifact, environment label, auth state, renderer, or selector; or unexplained mutation of the 77 parked rows.
- Forbidden moves: direct production merge of PR #70/#71/#72, destructive DDL, old-RPC replacement, T1 mutation, backlog repair, synthetic production canary, Preview-artifact promotion, rebuild during alias switch, or restart of healthy V1 during preparation.

## Native Planning Superiority

- Native baseline risk: a merge-test-deploy outline would miss cross-version data contracts and delivery lineage.
- Superior decisions: isolate dirty work, reconcile every conflict semantically, bridge both schemas and RPC generations, use two immutable cutoffs, stage rollback artifacts first, and separate activation from natural proof.
- User-specific safety: preserve the 77 queued rows, avoid browser disruption, keep V1 healthy, and distinguish local, Preview, deployed, live, and production-ready evidence.
- Score target: 5/5, proved by this durable plan, exact receipts, operator runbook, and explicit stop rules.

## Orchestration Decision

- Mode: full worker run followed by one replacement synthesis/plan-writer pass
- Worker count: four GPT-5.6 Sol Max evidence workers plus one GPT-5.6 Sol Max replacement planning owner/writer; two earlier Sol Max synthesis-owner attempts produced no artifact and were rejected.
- Decision reason: Git/integration, database/RPC, renderer, and release/UI required distinct evidence before one owner could reconcile the production tradeoffs.
- Independent surfaces: Git integration, database/RPC compatibility, Edge delivery, renderer, frontend/auth, release proof, activation, and rollback.
- Workers used or skipped: all four evidence scopes/results were accepted; no new research worker or visible thread was needed after the packet closed.
- Thread decision: one durable plan artifact now; one implementation goal later.
- Reconsider trigger: a newly discovered production contract or an unclassified conflict that changes cutoff, claim, or rollback semantics.

## Background Browser Lane

- Needed: yes during implementation acceptance, not during planning.
- Route: configured Computer Use agent, GPT-5.6 Sol, low reasoning, Fast tier, using the Codex native browser or picture-in-picture.
- Scope: exact Preview first, then production; test `admin` and `read_only` on desktop and mobile.
- Safety boundary: view and normal auth only; never use send, retry, reset, requeue, cleanup, or manual-advance controls.
- Receipt: URL, commit/deploy ID, role, viewport, environment label, screenshots, console errors, failed requests, and observed mutations.
- Stop: wrong SHA/label/role, auth failure, layout overlap, unsafe enabled control, or unexpected write.

## Current State

- Production V1 and the Lightning renderer are healthy.
- The checkout is dirty at `f599287`; renderer persistence edits are user-owned.
- PR #70 is the V2 base; PR #72 contains the live-V1 cutoff and PR #71 renderer hotfix.
- Integration requires semantic resolution across 27 files and 61 conflict blocks.
- PR #70 draft review was skipped, so no prior review satisfies the final gate.
- Preview `040fd` is stale, and the candidate UI hardcodes Preview labels.
- Preview expects `runtime_controls.singleton_id`; production V1 uses `singleton_key`.
- Candidate B3/B4 replaces RPCs that live V1 still calls; raw migration promotion is unsafe.
- Exactly 77 old queued rows remain parked and untouched.

## Future State

- A clean isolated branch contains one reviewed composite commit and a conflict-disposition ledger.
- Additive dual-schema support lets `singleton_key` and `singleton_id` address one logical control record.
- Legacy RPCs remain stable while versioned V2 RPCs coexist behind guarded route selection.
- T1 remains immutable; T2 is an append-only activation cutoff and never makes older or missing-lineage work eligible.
- Exact AMD64 V2 renderer and rollback image exist beside healthy V1 without restarting it.
- One durable selector controls startup and guarantees a single production claimer.
- Exact Edge, renderer, production-scoped frontend, and rollback artifacts are prebuilt and identified.
- Preview proves source behavior with Preview-scoped environment; it is never the production artifact.
- Telegram starts with natural-new work only; X waits for natural Telegram proof; frontend promotion is last.

## Non-Goals

- No clearing, healing, replaying, or sampling the 77-row historical queue.
- No provider call for a synthetic, template, test, old, equal-cutoff, or missing-lineage record.
- No destructive schema cleanup, old column removal, or old RPC removal in this release.
- No redesign beyond release-blocking environment identity, auth, responsive, and operational defects.
- No production deployment or code implementation in this planning phase.
- No claim of live acceptance from tests, Preview, deployment metadata, or a lack of errors alone.

## Phase Plan

### Phase 0 — Protect and compose

- Inventory the dirty renderer changes without altering the current checkout.
- Create an isolated clean worktree from `f599287`; integrate `b8bee2` once and do not merge PR #71 separately.
- Classify and resolve all 61 blocks by contract, never with broad `ours` or `theirs` selection.
- Record dispositions for all 27 overlapping files and selectively carry intended renderer persistence work.

### Phase 1 — Add the compatibility bridge

- Preserve `singleton_key`; add V2 `singleton_id` compatibility with one logical singleton invariant.
- Preserve legacy RPC names and behavior; add versioned V2 RPCs or compatible wrappers instead of replacement.
- Add append-only activation epochs and strict `lineage_time > max(T1, active_cutoff)` eligibility.
- Make equality, null lineage, ambiguous lineage, old generation, and provider-ledger collision fail closed.

### Phase 2 — Guard Edge and renderer ownership

- Put every Telegram, X, manual, retry, admin, and fallback provider path behind the same gate.
- Complete B4 and the persistent selector/startup repair without restarting live V1.
- Build the exact AMD64 V2 image beside V1 with claim authority disabled.
- Build B4-compatible V1 rollback and prove one-selector/one-claimer behavior.

### Phase 3 — Make one exact release candidate

- Fix runtime environment labels and only release-blocking auth/responsive defects.
- Run focused tests and the static cutoff gate, then freeze one composite SHA.
- Obtain an actual independent review of that exact final diff; the skipped PR #70 draft review does not count.
- Require exact-SHA hosted CI and deploy that same source SHA to a fresh Preview.

### Phase 4 — Rehearse and pre-stage

- In isolated Preview, rehearse migrations, dual readers/RPCs, activation, parked-state checks, and rollback with providers disabled.
- Capture `admin` and `read_only` desktop/mobile acceptance and renderer no-post evidence.
- Prebuild prior guarded Edge, renderer, and frontend rollback artifacts.
- Pre-stage only the additive bridge and inactive V2 assets in production while V1 remains live.
- If Vercel supports a held alias, create an exact-SHA production-scoped deployment and keep its production alias held.
- Otherwise merge the exact final SHA to `main`, let Vercel build with production environment values while the old alias serves, and proceed only after the new deployment is `READY`.

### Phase 5 — Activate and prove

- Run the activation runbook; stop on any kill criterion.
- Record a successful mechanical switch separately from natural provider proof.
- If no natural item arrives, report `LIVE_NATURAL_PROOF_PENDING` and leave X/frontend progression gated.
- Keep both generations and all compatibility contracts through the soak period.

## Parallel Lanes

- Lane A, Luna High owner: release branch, conflict ledger, shared contracts, integration, validation, and final acceptance.
- Lane B: additive migrations, dual-schema/dual-RPC tests, and activation-ledger tests; no deployment.
- Lane C: Edge claim gates and provider-path tests after Lane A freezes interfaces.
- Lane D: B4, AMD64 images, durable selector, startup, and rollback proof; do not touch live V1.
- Lane E: environment identity plus `admin`/`read_only` responsive acceptance fixtures.
- Lane F: exact-final read-only review, CI/Preview evidence, and rollback drill observation.
- Integration rule: explicit file ownership, no overlapping writes, and Luna High alone integrates, deploys, and accepts.

## Task Backlog

- `INT-01`: create the clean composite branch and preserve the dirty checkout.
- `INT-02`: disposition 61 conflicts across 27 files and prove PR #71 appears only through PR #72.
- `DB-01`: implement and test the one-row dual-key compatibility bridge.
- `DB-02`: retain legacy RPCs, add guarded V2 RPCs, and prove both caller generations.
- `DB-03`: add immutable T2 epochs, strict lineage rules, and provider idempotency.
- `EDGE-01`: inventory and close every provider-capable bypass.
- `EDGE-02`: add atomic pause, zero-active, generation claim, and parked-state controls.
- `REN-01`: complete B4, persistent startup/selector repair, and the exact AMD64 candidate.
- `REN-02`: build and identify B4-compatible forward and rollback images.
- `UI-01`: remove hardcoded Preview identity and verify both roles at both viewport classes.
- `REL-01`: run the full static/test gate, exact-final review, exact CI, and exact Preview deploy.
- `REL-02`: rehearse no-post rendering and full rollback in Preview.
- `REL-03`: pre-stage additive production bridge and inactive, prebuilt production/rollback artifacts.
- `OPS-01`: capture T2 and activate Telegram, then X, then frontend in the guarded order.
- `OPS-02`: capture natural proof, no-change evidence for 77 parked rows, and soak receipts.

## Acceptance Criteria

- The release candidate is clean, exact-SHA bound, and contains recorded dispositions for 27 files/61 blocks.
- Tests, static cutoff gate, actual review, hosted CI, and fresh exact Preview all reference the same source SHA.
- V1 and V2 both work against the bridged schema; legacy and guarded V2 RPCs coexist.
- T1 is unchanged, T2 is append-only, and application roles cannot weaken either boundary.
- Zero `<= T1` or missing-lineage rows post, retry, requeue, reset, clean, or manually advance.
- The 77 old queued rows have no forbidden state, attempt, provider-ID, or lineage mutation.
- Preview proves render success with provider calls disabled and no provider-ledger write.
- `admin` and `read_only` pass real auth and core workflows on desktop and mobile without overlap or unsafe controls.
- V1 remains healthy during pre-stage; V2 has no claim authority until activation.
- Exactly one renderer has production claim authority, and its selector survives startup.
- Preview and production frontend builds share the accepted source SHA but have their correct distinct environments.
- The production-scoped frontend is `READY` before alias switch; the old production alias serves until then.
- Telegram accepts only natural records newer than T2; X remains off until natural Telegram proof.
- Frontend production alias moves last and points to the exact accepted production-scoped deployment.
- If natural proof is pending, status says so; production-ready is not claimed early.

## Validation Plan

- Run from the isolated composite worktree and retain exit codes: `npm run test:functions`, `npm test -- --run`, `npm run check:functions`, `npm run check:strict`, `npm run lint -- --max-warnings=20`, and `npm run build`.
- Run `node scripts/check-v1-delivery-cutover.mjs` as the required static cutoff gate and run `git diff --check`.
- Add focused tests for equality, null/missing lineage, dual-key singleton access, both RPC generations, generation races, provider idempotency, and forbidden manual/admin paths.
- Require a human/independent review receipt for the exact composite SHA and hosted required checks for that SHA.
- Deploy a new exact-SHA Preview; do not reuse `040fd` or treat its Preview-scoped artifact as promotable.
- In Preview, prove migration idempotence/coexistence, activation/rollback, zero-provider render, B4 startup/selector persistence, and the parked cohort.
- Use native-browser Computer Use for `admin` and `read_only` at desktop and mobile viewports; record deploy ID, screenshots, console, and network results.
- Before production, identify checksums/IDs for forward and rollback Edge bundles, AMD64 renderer images, and both production-scoped frontend deployments.
- Verify the production deployment uses the accepted source SHA, production environment, and `READY` state while its alias remains held or old alias remains active.
- After activation, query control/epoch rows, active claims, provider ledger, renderer health, and the 77-row fingerprint from the production target.

## Risks

- Semantic conflict loss: mitigate with per-block disposition, focused regression tests, and exact-final review.
- Mixed schema/RPC outage: mitigate with additive coexistence and a Preview rehearsal using both caller generations.
- Duplicate delivery at handoff: mitigate with a shared posting block, paused claimers, zero-active proof, append-only T2, and idempotency.
- Renderer restart gap: mitigate with side-by-side AMD64 images and durable selector proof without restarting V1.
- Wrong frontend environment: Preview is not promotable; require a separate exact-SHA production-scoped build before alias switch.
- Stale/wrong artifact: mitigate with immutable SHA-to-CI-to-deployment mapping and no rebuild during alias switch.
- Premature acceptance: natural proof may take longer than the switch; keep `LIVE_NATURAL_PROOF_PENDING` instead of creating a canary.
- Platform incident during the window: abort before T2 when possible; after T2 use the forward rollback path and preserve all cutoffs.

## 8-15 Minute Activation Runbook

1. Minute 0-2: confirm production DB, provider, Edge, production-scoped frontend, V1 renderer, rollback artifacts, and observer queries are healthy and exact.
2. Enable the shared posting block; pause worker, X, and renderer claimers without stopping ingestion or restarting V1.
3. Wait until every active/leased delivery claim is zero; do not reset, requeue, or transfer in-flight work.
4. Abort before T2 if zero-active cannot be proved.
5. Minute 2-4: append T2 from the production database clock with the composite SHA and V2 generation; never update T1.
6. Activate guarded V2 RPC selection and exact V2 Edge routes, with provider delivery still blocked.
7. Switch the durable selector so the prebuilt V2 AMD64 renderer is the sole claimer; keep V1 healthy as standby.
8. Minute 4-7: verify parked state: zero active legacy claims, 77 old queued rows unchanged, no missing-lineage eligibility, and no provider attempt.
9. Enable Telegram only for natural records with valid lineage strictly newer than T2.
10. Minute 7-12: check errors, claims, renderer health, queue age, and provider ledger; do not create or advance a canary.
11. If a natural Telegram item arrives, prove one logical delivery, one attempt, and one provider ID; only then enable X for natural-new work.
12. Switch the alias to the already-`READY` production-scoped frontend last; verify exact SHA, production environment, auth, and no Preview label.
13. Minute 12-15: record exact active versions and either `LIVE_NATURAL_PROOF_ACCEPTED` or `LIVE_NATURAL_PROOF_PENDING`.
14. If proof is pending, end the mechanical window with V2 parked safely, keep X/frontend progression at the last proved gate, and continue observation without outage or manufactured work.

## Rollback

- Before T2: remove the posting block only after restoring the prior selectors; no data change is needed.
- After T2: block posting, pause V2 claimers, wait for zero active, and append a rollback activation epoch; retain T1 and T2 unchanged.
- Switch to the prebuilt prior guarded Edge bundle and B4-compatible V1 renderer in 3-5 minutes.
- Restore only natural-new eligibility under the retained/forward cutoff; never inherit or replay the T2 interval.
- Move the Vercel alias to the prebuilt prior production-scoped frontend in under 1 minute; do not rebuild.
- Do not down-migrate. Correct database defects with an additive forward fix while both RPC generations remain available.
- Verify the 77 rows and all missing-lineage rows remain untouched, one generation owns claims, auth works, and renderer health matches baseline.
- Keep failed V2 artifacts for diagnosis; do not clean the worktree or production records.

## Estimates

- Best case: 8-12 active hours and 6-8 elapsed hours.
- Likely case: 16-24 active hours and one focused day with safe parallel lanes.
- Conservative case: 30-40 active hours and two focused days.
- Production pre-stage: 20-45 minutes with V1 live and no planned outage.
- Mechanical activation: 8-15 minutes.
- Natural Telegram/X/video proof may arrive later and is elapsed observation time, not an extension of the switching outage.

## Implementation Orchestrator Handoff

- Required owner: GPT-5.6 Luna High is implementation owner, integrator, validator, production operator, and final acceptor.
- Start: create an implementation goal from this plan and an isolated worktree from `f599287`; do not modify or clean the current dirty checkout.
- First slice: integrate `b8bee2` once, create the 61-block disposition ledger, freeze shared cutoff/runtime-control contracts, and implement the additive dual-schema/dual-RPC bridge with tests; do not touch production.
- Order: shared contracts -> DB/RPC bridge -> Edge gates -> B4/selector and UI in parallel -> exact integration/review/CI -> exact Preview -> rollback drill -> inactive production pre-stage -> activation -> natural proof.
- Likely areas: `supabase/migrations/`, Supabase delivery/admin functions and shared helpers, `services/video-renderer/`, frontend environment/auth surfaces, tests, cutoff scripts, and release evidence docs; confirm exact paths before assigning ownership.
- Allowed: isolated scoped edits, additive migrations, versioned RPCs, shared gates, B4 persistence, release-blocking UI fixes, Preview rehearsal, and the authorized pre-stage/cutover.
- Disallowed: destructive DDL, T1 changes, historical mutation, production canaries, overlapping worker writes, external-worker secrets/deploy/acceptance authority, or direct branch promotion without composite proof.
- Skills/tools: `implementation-orchestrator`, `quality-orchestration`, Supabase evidence tools, GitHub exact-SHA CI/review, Vercel environment/deployment/alias evidence, Lightning health/image evidence, and native-browser Computer Use.
- Blocking questions: any bridge that cannot preserve legacy behavior, lack of atomic pause/zero-active/T2 ordering, inability to build a B4-compatible rollback, or unavailable exact Preview auth.
- Stop conditions: any forbidden historical path, destructive migration, V1 health regression, wrong SHA, selector ambiguity, nonzero claims at T2, or failed rollback drill.
- Do not claim complete until exact-SHA local checks, review, CI, Preview, both-role browser acceptance, no-post render, rollback rehearsal, safe activation, unchanged parked rows, and natural target-perspective provider proof are all recorded.
- The implementation orchestrator must continue implementation/validation cycles until these criteria pass or a concrete blocker is proved; `verified` requires evidence from the real route, row, claim, provider ledger, rendered artifact, or authenticated UI.

## Planning Closeout

- All four evidence scopes/results were accepted: Git/integration, database/RPC, renderer, and release/UI.
- The first two Sol Max synthesis-owner attempts produced no plan artifact and were rejected.
- This replacement Sol Max owner wrote and validated the artifact; implementation has not started, and Computer Use was not used during planning.

## Agent Usage

- Planning owner/writer: `planner`, GPT-5.6 Sol, Max, Fast not applicable; synthesis, tradeoffs, artifact, and validation accepted.
- Evidence worker 1: GPT-5.6 Sol, Max, Fast not applicable; Git/integration scope accepted.
- Evidence worker 2: GPT-5.6 Sol, Max, Fast not applicable; database/RPC scope accepted.
- Evidence worker 3: GPT-5.6 Sol, Max, Fast not applicable; renderer scope accepted.
- Evidence worker 4: GPT-5.6 Sol, Max, Fast not applicable; release/UI scope accepted.
- Earlier synthesis-owner attempts 1-2: GPT-5.6 Sol, Max, Fast not applicable; no artifact, rejected.
- Strict planning route: passed. Computer Use: none. Implementation agents: none; implementation has not started.
