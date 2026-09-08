# Remaining PR remediation and disposition — 2026-09-08

Base: `b419afb41db8381075af7b274f60c6104d12848f`.

The owner requested fixes for remaining applicable Detail bugs after checking current V2 behavior, plus explanatory comments and closure of duplicate/older PRs without deleting their branches or history. Existing approval covers publishing, merging eligible fixes, and resulting frontend deployment/hosted automation. Backend deployment and production migration execution remain separate.

## Execution plan

1. Compare all 13 remaining PRs against current main and V2 entry points. Record and close duplicates/older aggregates with recoverable head references.
2. Repair seven applicable defects in scoped changes: scoring evaluation failures (#89), transcript context guards (#102), digest tweet limits (#92), follower snapshot retry admission (#88), webhook media replacement (#99), X delivery retry selection (#110), and per-media upload quotas (#93).
3. Verify success, failure, and boundary cases with focused tests, including isolated SQL validation where database behavior changes. Run required repository checks and browser checks for changed UI.
4. Publish the validated successor, complete hosted checks, merge, and comment/close superseded original patches with the successor link. Verify final main and automatic frontend deployment; distinguish backend source from deployed behavior.

Acceptance: no duplicate V2 behavior, no weakening of claim/cutover/ownership gates, no dropped or corrupted digest content, failed scoring calls excluded from accuracy, retry eligibility distinguished from active work, and complete traceability for every original PR. Stop dependent release work if a required migration environment or production authority is missing; continue all independent implementation and validation.

## Disposition completed

| PR | Disposition |
| --- | --- |
| #82 | Duplicate of merged #113; commented and closed. |
| #106 | V2 already weights noise proportionally. Legacy compatibility semantics preserved; commented and closed. |
| #66 | Cleanup containment superseded by current object-claim cleanup; unique historical UI/evidence remains on its branch. Commented and closed. |
| #67 | Principal migration checkpoint artifacts already on main; successor gates preserved. Commented and closed. |
| #68 | Runtime contract superseded by current guarded install/audit sequence and CLI pin. Commented and closed. |
| #77 | Older 80-file mixed release/UI draft intentionally closed, not declared merged. Unique UI, feedback migration, CircleCI, and release evidence remain on preserved head `3d3926fcf67795a621f889b315aed567d3fd66b8`. |

## Applicable defects

The current V2 scorer already checks `ok` in the worker, but its evaluation action still counts failure defaults as predictions (#89). The remaining media, snapshot, transcript, digest, and X retry paths are also present in current code; they are not replaced merely by enabling V2 scoring.

## Implemented successor

- **#89:** Failed or thrown scoring calls produce explicit failure rows with no prediction and are excluded from accuracy/confusion counts. The UI uses the evaluated denominator and displays `n/a` when all calls fail; older backend responses retain a row-count fallback.
- **#102:** The primary, fallback, and weak-transcript paths share the sparse-context mismatch predicate. Missing context does not invalidate otherwise acceptable transcription.
- **#92:** Digest splitting uses pinned `twitter-text@3.1.0` weighted counting, NFC text, atomic URLs, and Unicode graphemes. It preserves long input across tweets and rejects invalid/unsplittable text rather than truncating it. The dependency implements [X character-counting rules](https://docs.x.com/fundamentals/counting-characters); it is loaded inside the authorized execution path.
- **#88:** Service-only snapshot RPCs serialize admission and fence claims with renewable leases. Active work blocks even forced requests. Expired orphan and failed runs can retry; completed and finalized partial snapshots retain freshness/daily caps. Exceptions finalize the owned claim with a stable failure code.
- **#99:** One receipt-fenced transaction replaces obsolete media slots and enqueues downloads. Unchanged sources preserve downloads; changed sources receive new IDs so stale download completions cannot match. An unresolved video placeholder preserves already-resolved media. Existing foreign-key cascades invalidate render associations when their source media is replaced; object bytes remain subject to the existing storage cleanup process. No storage deletion is added.
- **#110:** Only due pre-provider-released pending deliveries reenter the candidate query. Ordinary/future pending and terminal rows are excluded before `LIMIT`. Cutover, freshness, score, manual intake, and authoritative claim gates remain intact.
- **#93:** A service-only reservation RPC admits a complete media batch under a serialized daily item quota. Reservations conservatively retain failed/ambiguous provider attempts; an owned pre-provider release refunds them atomically. Diagnostics use the same usage RPC. Legacy recorded media counts are included without double counting reservations; previously unrecorded historic provider attempts cannot be reconstructed.

The four migrations are append-only successors dated `20260908103000` through `20260908110000`. Historical migration receipts are unchanged. Current inventory and byte-bound review entries reflect the new source; those entries do not establish production migration acceptance.

## Local validation

The 147 non-install CI commands were run against this candidate. Four first-pass failures identified outdated source-contract expectations or inventory hashes and the scoring exception-expression guard. The RPC contracts now check the new ownership/result boundaries; scoring exceptions use explicit failure handling. All eight affected rechecks passed after correction; the final rollup is 147/147 commands passing. Dependency audits, root/Edge lint, Edge type checks, strict TypeScript, build, migration-baseline tests, and the UI/renderer suites passed.

Passing suites include **568 Edge tests**, **245 UI tests**, and **228 renderer tests**.

Additional regression coverage:

- Isolated PostgreSQL replay applied all **140 migrations** and checked snapshot orphan/retry/finalization, simultaneous snapshot admission, RSS source identity and unchanged-download preservation, authoritative empty media, rollback on job insertion failure, due-only X retry selection before `LIMIT`, complete-batch quota rejection/exact cap/idempotency/refund, failed provider accounting, concurrent quota admission, and RPC role privileges.
- The replay uses an already-cached pinned Supabase PostgreSQL image, a local Unix Docker endpoint, networking disabled, one CPU/768 MiB, no published ports or host mounts, and removes only its labeled disposable container and volumes. All completed runs confirmed cleanup. No production database was contacted.
- Reproduce the SQL checks with `node scripts/run-remaining-pr-sql-replay.mjs`; set `XOT_REPLAY_DOCKER_CONTEXT` to an existing local context if needed. The runner never pulls an image or modifies Docker configuration. This is local SQL evidence, separate from hosted CI or production migration acceptance.
- Desktop (1440×1000) and mobile (390×844) headless browser checks used synthetic, intercepted API responses. Keyboard activation, mixed/all-failed summaries, visible request errors, wrapping, and focus were checked with no page exceptions. No scoring provider request was made. The task-created browser and local server were stopped.

## Release boundary

The approved successor PR may merge and trigger the existing frontend deployment. Backend RPC behavior remains unverified live until the four migrations and corresponding Edge functions are deployed under separate production authorization. The changed UI remains compatible with the prior evaluation response. Original PR branches and comments are retained; superseded patches are closed with a link after the successor merges.


## Hosted review follow-up

PR #117's first revision passed required hosted CI. Review then identified two gaps repaired before merge: formatting rejections now call the fenced `fail_digest_run` RPC with a stable reason, and the latest-delivery gate loads/checks `next_retry_at` for fallback and forced candidate paths. Invalid retry timestamps fail closed. Additional tests cover future/exactly-due/past retry times and digest failure finalization; the latter retains the existing `ambiguous` no-provider-replay state after provider start while clearing the active lease.

The suggestion to exempt retries from `max_candidate_age_minutes` was not adopted: freshness is an existing posting-policy gate, not a duplicate-prevention artifact. A released claim permits another attempt only while the post remains otherwise eligible. Relaxing that policy would broaden auto-posting behavior beyond this remediation.
