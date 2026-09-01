# XOT Current-Candidate Production Cutover Implementation Plan

## Outcome progression

1. **Now:** Production V1 is healthy and live. V2 is Preview-ready at `fae3614e987c37f2135fb8bdbd6f52bc598ba69c`; production is unchanged.
2. **After preparation:** The exact candidate is release-ready, production is still V1, and the live cutover can run in a 75-105 minute window.
3. **After full execution:** V2 is live in production component by component, historical backlog has received zero writes and zero provider calls, and each component has verification and rollback evidence.

## Release baseline and hard contract

- Repository: `/Users/stevmq/xot-v2-composite-release`; branch `codex/xot-v2-composite-release`.
- Candidate: HEAD `fae3614e987c37f2135fb8bdbd6f52bc598ba69c`, PR `#73`, hosted CI run `33296634331` green, exact-head Preview ready.
- Production is not cut over. V1 stays live through preparation and until each successor component passes its own live hold point.
- Immutable T1 is `2026-08-25T10:36:06.834081Z`. `activate_runtime_v2(text,text)` creates immutable T2; effective delivery cutoff is `max(T1,T2)`.
- Telegram/X rows at or before T2, and rows with missing or ambiguous lineage, are permanently historical-unsent.
- Historical delivery rows and related jobs must receive zero writes: no claim, settlement, attempt/timestamp/status change, retry, requeue, reset, reconciliation, cleanup, manual advance, or provider call.
- Do not bulk-flush post-T2 work. Canary only naturally created, clearly post-T2 work, one item at a time.
- Current candidate violates zero-write through `settle_delivery_cutover_blocked` and `20260829120000_reconcile_historical_delivery_jobs.sql`; PREP-1 must fix the final semantic catalog before release.
- Truth comes from the deployed catalog/behavior, exact artifact identities, renderer digest/heartbeat, and provider deltas, not migration-history row counts or repaired hashes.

## Decisions and release blockers

- Use one reviewed pre-activation convergence transaction. Do not run broad `supabase db push`, edit old migrations, or repair migration history/hashes.
- Preserve unrelated work: no reset, stash, clean, merge, or broad staging in any preparation slice.
- Freeze an exact ordered manifest: the existing 20 convergence sources, then `20260828140000`, `20260829120000`, and the new zero-write successor. Keep `20260828130000` separate until after T2.
- Every live row below is a hold point: run its check immediately and roll back that component before continuing if it fails.
- Required gates are: exact migration bundle/replay; GitHub PAT alert `#1` closure; isolated restore drill; focused database-advisor triage; renderer image scan, SBOM, provenance, and prior/candidate digests; named rollout owner; final CI and exact-head Preview.
- The restore target is observed RPO <=24 hours and RTO <=4 hours. If the drill fails, enable and verify PITR under separate authorization or stop; this is the only unresolved release decision.
- Advisor work is limited to changed tables/RPCs, auth/RLS, runtime controls, and the ten cutover functions. Unrelated findings do not enter this release.
- The named rollout/rollback owner must remain present for the full mutation window. Production authority is requested only after all gates pass.

## Preparation — production remains V1

1. **PREP-1: enforce historical zero-write and repair the semantic release gate.**
   - Limit edits to the worker delivery path, `scripts/check-v1-delivery-cutover.mjs`, convergence builder/tests, release-gate tests, and one new append-only migration, proposed as `20260830120000_enforce_historical_delivery_zero_write.sql` after confirming the timestamp is unused.
   - Make `settle_delivery_cutover_blocked(uuid,text)` zero-DML/fail-closed, make reconciliation skip historical jobs before lock/update, remove the worker settlement call, and reject historical/missing/equal/ambiguous lineage before every first write.
   - Seed pending/running historical rows, call claim/reconcile paths repeatedly, and prove full-row equality plus zero provider attempts.
   - PREP-1 forbids Preview/production/provider/merge/deploy/retry/requeue/reconcile/cleanup/backlog operations.
   - Exit: focused gates pass and the diff contains only the declared PREP-1 surface.
2. **Build the exact database release artifact.**
   - Update the convergence builder and tests to emit the ordered 23-source pre-activation manifest in one outer transaction; keep activation-only X retirement separate.
   - Generate read-only preflight, post-transaction, post-T2, and rollback/forward-fix assertions. Replay the bundle twice in a disposable database from the production semantic baseline.
   - Exit: the manifest identity is frozen, both replays pass, and the second replay causes no semantic drift.
3. **Prepare function deployment and rollback cards.**
   - Capture immutable prior and candidate artifacts plus exact production deploy/rollback commands for `webhooks-rssapp`, `media-processor`, `digest-compiler`, `db-cleanup`, `media-cleanup`, `x-followers-snapshot`, `admin-retry`, `admin-actions`, `x-poster`, and `worker`.
   - Rehearse every command without Production. The Preview-only `scripts/deploy-functions.sh` is not a production command.
   - Exit: every function has exact prior/candidate identity, a probe, and a rehearsed component rollback.
4. **Prepare the renderer candidate.**
   - Build and scan it, emit SBOM and source-to-image provenance, record prior/candidate digests, and rehearse candidate-to-prior rollback with polling disabled.
   - Exit: scan policy passes and both immutable digests can start healthy with polling disabled.
5. **Close operational gates.**
   - Complete the isolated restore drill (or stop/PITR decision), close PAT alert `#1`, triage focused advisor findings, name the rollout owner, and bind rollback artifacts.
   - Exit: each named gate is green or the release is stopped; unrelated advisor findings are separately deferred.
6. **Validate the complete candidate.**
   - Run focused and full local checks, then exact-head hosted CI. Deploy only the accepted head to Preview; verify all ten function versions, posting blocked, and authenticated `admin`/`read_only` canaries.
   - Exit: local, CI, and Preview evidence all bind the same final SHA and artifact set.
7. **Freeze the live-window binder.**
   - Within 30 minutes of cutover, capture read-only production IDs, controls/schedules, T1, historical full-row hashes/aggregates, running claims/jobs, aliases, function artifacts, renderer digest, and rollback commands. Any drift stops the window.
   - Exit: step 0 can rerun every query and resolve every target without inference.

## Ordered production cutover

Do not reorder steps. After T2, never delete/edit the activation epoch or use a down migration; rollback means block the affected control and restore only a proven T2-compatible artifact or reviewed forward fix.

### Live-window rules

- Run one row at a time. Do not start the next mutation until the current PASS check completes.
- Record the before state and exact rollback target before each action; missing evidence stops the window.
- Keep the historical full-row equality query available throughout; query failure is a stop condition.
- Treat an unknown provider outcome as consumed: block the channel and never retry that canary.

| Step | Component/action | Immediate PASS check | Immediate rollback target |
|---|---|---|---|
| 0 | Read-only preflight; bind exact target, head, owner, counts, artifacts, and commands. | Every gate is green; no active delivery claims/running jobs; baseline query succeeds. | No mutation; stop. |
| 1 | Pause worker/X delivery schedules and set posting `blocked`; leave V1 deployed. | Two polls: no new provider receipt and no historical delta. | Restore captured V1 control/schedules only if no later mutation ran. |
| 2 | Execute the pre-activation convergence SQL as one transaction; T2 absent. | Catalog/role/control assertions pass; T1 and historical rows unchanged; V1 reads healthy. | Roll back before commit; after commit stay blocked and use the reviewed forward fix. |
| 3 | Deploy `webhooks-rssapp` inertly. | Exact version; invalid signature rejected; queue/provider delta 0. | Captured prior `webhooks-rssapp`. |
| 4 | Deploy `media-processor` inertly. | Exact version; invalid internal auth rejected; delivery/provider delta 0. | Captured prior `media-processor`. |
| 5 | Deploy `digest-compiler`, schedule held. | Exact version; unauthorized probe rejected; checkpoint/delivery delta 0. | Captured prior `digest-compiler`. |
| 6 | Deploy `db-cleanup`, schedules held. | Exact version; unauthorized probe rejected; row-count delta 0. | Captured prior `db-cleanup`. |
| 7 | Deploy `media-cleanup`, schedules held. | Exact version; unauthorized probe rejected; media-object delta 0. | Captured prior `media-cleanup`. |
| 8 | Deploy `x-followers-snapshot`, schedule held. | Exact version; unauthorized probe rejected; X/provider request 0. | Captured prior `x-followers-snapshot`. |
| 9 | Deploy `admin-retry`, mutations unused. | Exact version; signed-out rejected; `read_only` cannot mutate. | Captured prior `admin-retry`. |
| 10 | Deploy `admin-actions`, mutations unused. | Exact version; signed-out rejected; `read_only` cannot mutate. | Captured prior `admin-actions`. |
| 11 | Deploy `x-poster`, posting blocked and X held. | Exact version; guarded probe stops before provider; active claims/provider delta 0. | Captured prior `x-poster`; keep X blocked. |
| 12 | Deploy `worker` last, schedule held. | Exact version; safe zero-work probe; historical rows/attempts/provider delta 0. | Captured prior `worker`; keep worker paused. |
| 13 | At 0 running renders, disable polling and replace renderer with the scanned candidate digest. | Health, heartbeat, digest, cutoff, and polling-block reason match; one container. | Prior renderer digest, polling disabled. |
| 14 | Call `activate_runtime_v2(unique_key,operator)` once; record T2. | One epoch; cutoff `max(T1,T2)`; pre-T2/missing-lineage claims return none; historical rows unchanged. | T2 is immutable; keep posting blocked and use only T2-compatible artifacts. |
| 15 | Apply `20260828130000_retire_legacy_x_delivery_overloads.sql` alone. | Unsafe V1 X overloads absent; generation-fenced overloads remain; X blocked. | Reviewed forward restore; never alter history. |
| 16 | Enable candidate non-delivery processing only. | One natural post-T2 item advances; no delivery or historical delta. | Disable processing; restore T2-compatible worker if required. |
| 17 | Enable translation only. | One natural post-T2 item translates; no delivery or historical delta. | Disable translation; restore T2-compatible worker if required. |
| 18 | Enable renderer polling only. | One natural post-T2 render advances; old queued/historical rows unchanged. | Disable polling; restore prior digest polling-disabled. |
| 19 | Enable posting for one natural post-T2 Telegram canary; schedules held. | Exactly one provider ID and terminal receipt; historical full-row hashes unchanged. | Block posting and pause worker; never retry an unknown outcome. |
| 20 | Run one natural post-T2 X canary; X schedule held. | One generation-fenced claim, provider-start marker/ID/terminal receipt, then 0 active claims. | Block posting/X; never retry unknown outcome; T2-compatible `x-poster` only. |
| 21 | Resume worker, X, ingest, digest, and safe maintenance schedules one at a time. | Two polls per schedule: expected new work, no duplicate provider ID, zero historical delta. | Pause the failed schedule; block delivery if relevant; restore its prior component. |
| 22 | Promote the immutable candidate Vercel build to both production aliases last. | Both aliases resolve to it; signed-in `admin`/`read_only` desktop/mobile checks pass. | Re-promote the immutable prior deployment captured in step 0. |
| 23 | Observe actively for two hours; no broad cleanup/retry. | Errors, queues, provider uniqueness, auth, renderer, and historical invariants stay in bounds. | Apply the smallest component rollback; keep T2 and the historical fence. |

## Validation, stop rules, and closeout

- PREP-1 focused gates: `npm run check:v1-delivery-cutover`, `npm run check:migration-baseline`, `npm run test:migration-baseline`, `node --test scripts/build-xot-v2-production-convergence-sql.test.mjs`, and `node scripts/run-historical-delivery-zero-write.mjs`. The broader `npm run check:migration-release` stays blocked until PREP-5/6 provide its live restore, owner, schema, type, and CI evidence.
- Code gates: `npm run lint`, `npm run lint:functions`, `npm run check:functions`, `npm run test:functions`, `npm run check:strict`, `npm test`, and `npm run build`.
- Contract gates: `npm run check:function-inventory`, `npm run check:v1-delivery-cutover`, and `node scripts/check-xot-v2-runtime-controls-bridge.mjs`.
- Database gates: `node scripts/build-xot-v2-production-convergence-sql.mjs --check`, its Node test, `npm run check:migration-baseline`, `npm run test:migration-baseline`, `npm run check:migration-release`, and `npm run test:e7-disposable-boundary`.
- Renderer gates: `npm --prefix services/video-renderer test`, image scan, SBOM, provenance, local health, and prior-digest rollback rehearsal.
- CI and Preview evidence must bind the final SHA after PREP-1; run `33296634331` is the current baseline, not acceptance for changed source.
- Production acceptance starts only when all seven preparation exits are green and step 0 rechecks them.
- Stop immediately for any historical write, early/multiple provider request, unknown provider outcome, duplicate ID, stale claim, wrong target/artifact/digest, changed T1, invalid T2, two renderer pollers, failed auth boundary, or missing rollback evidence.
- After the two-hour observation, run a read-only 24-hour follow-up. It never authorizes replay, retry, cleanup, reconciliation, or backlog drain.
- Completion means V2 is live component by component, exact identities and canaries pass, historical full-row hashes/aggregates stay unchanged, and every rollback target is recorded. It does not mean historical work was delivered or cleaned.

## Timing and implementation handoff

- Preparation: 8-16 active engineering hours over about 1-3 business days.
- Live cutover: 75-105 minutes after every gate and rehearsal passes.
- Observation: two active hours, then the read-only 24-hour follow-up.
- Execution owner: GPT-5.6 Luna, High reasoning, using `implementation-orchestrator`; planning made no source, Preview, or production change.
- First goal is **PREP-1 historical zero-write and current semantic release gate** with only the files and exclusions in Preparation task 1.
- After PREP-1, execute tasks 2-7 in order. Request separate production authority only when all gates are green; then run steps 0-23 without reordering.
- If an exact command, target, rollback artifact, or gate cannot be verified and rehearsed, mark that component blocked and stop. Do not substitute a broad command.
