# XOT Comprehensive Audit Remediation Implementation Plan

## Planner Metadata

- Date: 2026-07-14
- Repository: /Users/stevmq/Finalized XOT
- Canonical branch observed: main
- Canonical commit observed: ec05e331107ad76d10f129cb2e3fa24e9ea320b2
- Remote parity at planning time: main equals origin/main
- Product surfaces: React/Vite admin frontend, Supabase Postgres and Edge Functions, RSS.app ingress, Telegram and X delivery, and the separate Node video renderer
- Live frontend anchors: https://xot.iraneyes.com and https://xot.vercel.app
- Supabase project ref: jzirqfzzvlbxwfzndaer
- Planning mode: planning-orchestrator, goal-backed, read-only application inspection, three specialist planning lanes, parent synthesis
- Implementation authorization: not granted; this document changes no product behavior
- Plan output: /Users/stevmq/Finalized XOT/docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md

### Audit source and scope

This plan is the remediation companion to the whole-application audit completed on 2026-07-10 and rechecked against the same main commit on 2026-07-14. The audit covered backend/runtime correctness, frontend and UI/UX, performance and unnecessary weight, maintainability, security, release trust, blocked validation, and controls that were already working.

The canonical issue register for implementation is the AIR-001 through AIR-080 matrix in this document. It deliberately includes:

- Confirmed defects and vulnerabilities that require changes.
- Lower-severity code, performance, accessibility, and design debt.
- Candidates that require evidence before any remediation.
- Checks that were blocked during the audit and must be completed later.
- Existing security and product controls that must be preserved through regression contracts rather than rewritten.

Historical repo documents are supporting evidence, not alternate completion ledgers:

- docs/audit/2026-05-15-xot-comprehensive-audit.md
- docs/audit/2026-05-15-xot-remediation-status.md
- docs/audit/2026-06-14-xot-spaghetti-map.md
- docs/audit/2026-07-03-xot-dashboard-hud-bloat-ux-logic-audit.md
- docs/audit/2026-07-03-xot-performance-loadability-waste-call-audit.md
- docs/operations/database-type-trust.md
- docs/operations/function-auth-matrix.md
- docs/operations/release-runbook.md

### Worktree preservation contract

The following changes predated this plan and belong to the user:

- Modified: docs/operations/vercel-cutover.md
- Modified: docs/operations/xot-system-inventory.md
- Untracked: docs/audit/2026-07-03-xot-dashboard-hud-bloat-ux-logic-audit.md
- Untracked: docs/audit/2026-07-03-xot-performance-loadability-waste-call-audit.md
- Untracked: docs/plans/2026-07-03-xot-dashboard-hud-truth-debloat-implementation-plan.md

The implementer must preserve them, inspect overlap before editing nearby docs, and never reset, restore, overwrite, or silently absorb them.

## Executive Goal

Remove every confirmed correctness, security, performance, weight, maintainability, and UI/UX defect identified by the July 2026 audit while preserving the app's working safety controls and existing production workflows.

The end state is not merely a green test suite. Completion means:

- No fresh or shared media object can be deleted by an old logical row.
- Every accepted webhook has durable, recoverable state.
- External side effects use atomic claims, token-fenced ownership, and explicit ambiguity handling.
- Job and renderer completion can only be committed by the current owner.
- Admin data access is least-privilege at the database boundary.
- Remote media acquisition is bounded and SSRF-resistant.
- UI previews, actions, status, thresholds, drafts, and selected records use one authoritative snapshot.
- Core admin screens load bounded summaries, degrade independently, and do no hidden expensive work.
- Authenticated desktop and mobile workflows are browser-verified for correctness, responsive layout, keyboard use, and accessibility.
- Full TypeScript, migration, generated-type, dependency, build, runtime, and deployment contracts are trustworthy.
- Large orchestration files are decomposed only after behavior is characterized and safety cutovers have landed.
- Every AIR issue is accepted, explicitly disproved, or retained as a regression control with evidence.

## Source Of Truth Contract

- Intent: remediate the audited application without changing product meaning, losing data, duplicating posts, or turning candidates into speculative rewrites.
- Current behavior owner: current source at the anchored commit plus live read-only evidence captured on 2026-07-14.
- Expected behavior owner:
  - Postgres transactions and token-gated RPCs own workflow claims and state transitions.
  - A physical media-object registry owns bucket/path lifecycle; logical media rows own references only.
  - Durable inbox rows own webhook acknowledgement and replay.
  - Durable delivery/reservation rows own Telegram and X side-effect state.
  - scoring_policy owns active scoring truth; compatibility fields are derived or read-only during cutover.
  - Admin-action response snapshots own frontend operator decisions; the UI may not join unrelated stale requests into apparent truth.
  - Deployed Git SHA, function hashes, migration history, generated types, and build logs own release provenance.
- Contract boundary: Supabase migrations and RLS; Edge Function auth and handlers; worker, media, Telegram, X, and renderer lifecycles; admin APIs; React queries and controls; build/runtime/toolchain; release and browser evidence.
- Displaced paths:
  - Path-blind per-row storage deletion.
  - Inline webhook materialization before a durable receipt.
  - Read-before-send idempotency and ID-only lifecycle updates.
  - Fail-open quota reads.
  - UI-inferred status from multiple unsynchronized requests.
  - Broad authenticated table reads where admin actions should mediate access.
  - Full-table hydration and hidden realtime subscriptions for first-screen summaries.
  - Writable defaults after settings read failure.
- Cutover:
  1. Contain active destructive cleanup and capture a live baseline.
  2. Reconcile migration history and generated-type trust before any SQL deployment.
  3. Add new tables, columns, RPCs, and feature flags without removing old paths.
  4. Backfill, dual-write, shadow-read, and compare invariants.
  5. Canary one bounded lane at a time.
  6. Switch authoritative reads and writes only after evidence passes.
  7. Retire compatibility paths in later forward-only migrations.
- Acceptance evidence: database invariants and policy matrices, provider request counts, claim-token fault injection, storage failure tests, real staging rows, build/deploy logs, authenticated browser screenshots and traces, performance measurements, and post-deploy canary observations.
- Evidence lane: local source and test output first; disposable/local migration replay; staging deployment and authenticated browser; then production read-only or operator-approved canary evidence. Tests support but never replace target-state proof.
- Kill criteria:
  - Any fresh or referenced media path is selected for deletion.
  - Any duplicate Telegram or X provider call occurs.
  - An accepted webhook lacks a durable receipt.
  - A stale owner commits job, delivery, or renderer completion.
  - An unauthorised role reads or mutates admin-only data.
  - A migration cannot be mapped to known local content.
  - Core dashboard p95, queue age, error rate, or provider spend regresses beyond the approved budget.
  - UI action payload differs from the object and text shown at confirmation.
- Forbidden moves:
  - No broad supabase db push while migration ledgers diverge.
  - No destructive migration-history repair by timestamp alone.
  - No force-post or automatic retry of an ambiguous external request.
  - No live SSRF, credential, or destructive security exploitation.
  - No service-role secret in browser code.
  - No deletion of unknown media or delivery history.
  - No silent settings fallback that can be saved as truth.
  - No behavior change hidden inside a large file move.
  - No claim of live verification from local tests, public login checks, or headers alone.

## Native Planning Superiority

- Codex-native baseline risk: a generic cleanup plan would refactor large files, add retries, loosen CSP for the downloader, or repair migration timestamps before proving data ownership. Those changes could preserve the audited races or make them more dangerous.
- This plan's advantage: safety ownership is designed first; candidates and controls are separated; every task has evidence, dependency, rollout, rollback, and stop gates; the issue register makes omissions visible.
- User-specific operating contract: live source truth outranks memory, dirty work is preserved, production incidents start read-only, frontend work requires actual browser proof, and state is reported as local, live, pushed, deployed, blocked, or unverified.
- Superiority score target: 5
- Proof artifacts: this saved plan, the active planning goal, three independent specialist lanes, the July 14 release-state receipt, current source checks, official platform documentation, and the AIR traceability matrix.

## Orchestration Decision

- Mode: full planning worker run.
- Worker count: three specialist lanes plus parent synthesis.
- Backend/data/runtime lane: media ownership, webhook durability, worker and side-effect claims, X quotas, reprocess, thread delivery, renderer safety, backend performance, and decomposition.
- Frontend/UI/UX/performance/accessibility lane: snapshot correctness, settings truth, dashboard and Monitoring load, media UI, auth/layout, bundle weight, visual density, responsive behavior, and accessibility.
- Security/migrations/release/QA lane: RLS, SSRF, auth boundaries, migration/type trust, dependency and build coverage, runtime alignment, release gates, and preserved controls.
- Parent responsibility: recheck drift-prone facts, reject speculative findings, resolve overlapping tasks, impose phase order, and prove that every AIR row maps to a task and acceptance artifact.
- Thread decision: no separate user-owned Codex task; this repo-local artifact is the handoff.
- Reconsider trigger: add a focused follow-up worker only if a traceability audit finds an orphan, the canonical repo/branch changes, or implementation exposes a materially different production contract.

## Background Browser Lane

- Needed during planning: no.
- Reason: authenticated browser credentials were not available to the read-only audit, and planning does not justify account mutation.
- Required during implementation: yes, after staging is deployed and an admin test account is available.
- Required surfaces: /auth, /, /monitoring, /threads, /settings, /downloader, /video-renders, /my-x, and a not-found route.
- Safety boundary: use fixtures and dry-run actions until an explicit operator-approved canary; never trigger Telegram or X from a visual smoke.
- Receipt: route, viewport, account role, deployed SHA, screenshot path, console/network errors, keyboard checks, accessibility results, and any mutation ID.

## Research And Platform Findings

Official current platform guidance was checked because migration, RLS, and runtime behavior are version-sensitive.

- Supabase migration list compares migration timestamps, not SQL equivalence. Repairing history requires a reviewed timestamp-to-body map and explicit applied/reverted decisions; timestamp parity alone is not proof.
- Supabase recommends role-specific RLS with TO authenticated, cached auth calls using select wrappers where appropriate, private security-definer helpers, and explicit execute revocation. Studio's role selector can support policy validation but does not replace automated role-matrix tests.
- Vercel currently supports Node 20, 22, and 24; package engines can override the project setting. The task is to verify the effective build runtime from a real deployment log, then align package.json, CI, renderer, and Vercel deliberately rather than assuming a mismatch.
- The secure downloader resolution is not to broadly relax connect-src. Media should use the bounded server acquisition and short-lived authorised URL contract established by BR-MEDIA-02 and BR-MEDIA-04.

## Current State Snapshot

### Repository and release

- main and origin/main both resolved to ec05e331107ad76d10f129cb2e3fa24e9ea320b2.
- No open GitHub pull requests or issues were reported by the July 14 release-state check.
- The most recent main CI run was green on 2026-07-03, but that does not validate this future remediation.
- Vercel CLI provenance was unavailable locally. The live host served successfully, but its exact source SHA remains a release-evidence gap.
- Root and renderer package engines specify Node 20.x; CI uses Node 20; the effective Vercel patch/runtime still needs proof.

### Live headers and runtime

- Both live hosts returned HTTP 200.
- CSP, HSTS, frame denial, nosniff, and strict referrer policy were present.
- The renderer heartbeat was current at 2026-07-14 08:18:52 UTC, status online, version 0.1.0, render version persian-subtitles-masihh-v1, processed 54, failed 0.
- No running job with a lease/start older than 15 minutes was found.
- Queue snapshot contained one pending download_media and three pending translate jobs, with historical failures still visible.
- video_render_config was enabled; scoring_policy was in shadow mode.

### Immediate live risk

- invoke-media-cleanup-6h remained active at 0 */6 * * *.
- invoke-db-cleanup-daily remained active and invokes media cleanup again.
- Current code still permits storage_path reuse and path-blind cleanup. The production schedule therefore remains an active data-integrity risk until BR-00 and BR-MEDIA-03.

### Database trust

- The prior audit found 105 local and 105 remote migration timestamps but only 25 exact matches.
- The July 14 migration list still showed many local-only and remote-only entries.
- Broad schema push is prohibited until SR-MIG-01 establishes body-level equivalence and an approved forward-only baseline.

### Application shape

- Major backend hotspots include worker/index.ts, x-poster/index.ts, admin-actions/monitoringReads.ts, admin-actions/dashboardSummaries.ts, shared enrich and dedupe modules, renderer preflight/renderer/ffmpeg modules.
- Major frontend hotspots include Dashboard.tsx, Monitoring.tsx, Settings.tsx, the process HUD, monitoring drawer/timeline, and manual video intake.
- Existing route-level lazy loading and several good security and responsive controls must remain intact.

## Future State

An operator can trust that:

1. Ingress acknowledges only durable receipts and resumes after interruption.
2. Media is acquired through a bounded, validated pipeline and represented by one physical object with explicit logical references.
3. Cleanup claims only wholly unreferenced objects and cannot clear DB state after a storage failure.
4. Jobs, renderer work, Telegram delivery, and X posting have current-owner tokens and explicit ambiguous states.
5. Manual and scheduled X paths use one quota and claim contract.
6. The exact render and caption shown in confirmation are the values published.
7. Dashboard core loads quickly and independently; diagnostics and realtime work begin only when visible.
8. Settings never convert a read failure into a writable default and never overwrite a dirty draft from background invalidation.
9. Admin-only rows are protected by database policy, not merely hidden by UI role guards.
10. Builds, migrations, generated types, runtime versions, dependency scans, and deployed SHAs form one auditable release chain.
11. Large modules have narrow ownership boundaries backed by characterization tests.

## Non-Goals

- Do not redesign the product or change the editorial/scoring model beyond consolidating its source of truth.
- Do not add new posting destinations.
- Do not migrate away from Supabase, Vite, React, Telegram, X, or the current renderer.
- Do not turn shadow scoring on or off as part of cleanup without a separate product decision.
- Do not perform destructive production repair or intrusive security exploitation.
- Do not remove Sentry; load it proportionately and preserve error observability.
- Do not chase arbitrary line-count targets before correctness contracts land.
- Do not modify the user's pre-existing dirty documents.

## Program Gates

| Gate | Must be true before proceeding | Evidence | Stop or rollback |
| --- | --- | --- | --- |
| G0 Anchor | Repo, branch, SHA, dirty state, live endpoints, function hashes, crons, queue, renderer, and deploy provenance captured | Release-state receipt and saved SQL/CLI output | Stop if target differs from this plan |
| G1 Containment | Both media cleanup entry points paused and dry-run inventory captured | cron rows, function/config diff, path/reference report | Keep cleanup disabled on ambiguity |
| G2 Migration trust | Every divergent timestamp is classified by SQL body/effect and an approved baseline exists | migration equivalence ledger, disposable replay, schema diff | No SQL deploy if any unknown destructive drift remains |
| G3 Additive contracts | New schemas/RPCs are additive, least-privilege, typed, and inactive | migration tests, policy matrix, generated-type parity | Forward-fix only; disable feature flags |
| G4 Shadow parity | Dual-write/read results match old behavior and invariants | reconciliation queries and sampled row evidence | Continue old read path; retain additive data |
| G5 Canary | One bounded lane passes provider, data, latency, and UI evidence | canary IDs, request counts, screenshots, metrics | Kill flag and stop worker/cron; never auto-retry ambiguity |
| G6 Broad release | Full local/CI/staging/browser/security gates pass | signed build/deploy receipt and acceptance report | Roll back code/config, preserve schema |
| G7 Retirement | Compatibility paths have no reads/writes for an observation window | telemetry and code search | Delay removal; do not delete evidence |

## Phase Plan

| Phase | Goal | Principal tasks | Dependency | Exit evidence |
| --- | --- | --- | --- | --- |
| 0 | Re-anchor and contain active risk | BR-00, SR-REL-00 | none | cleanup paused, inventory and release provenance captured |
| 1 | Restore database, type, auth, and release trust | SR-MIG-01, SR-RLS-01, SR-AUTH-01, SR-TYPE-01, SR-RUNTIME-01 | G1 | approved baseline, role matrix, generated types, aligned runtime contract |
| 2 | Establish safe media and durable ingress | BR-MEDIA-01, BR-MEDIA-02, BR-MEDIA-03, BR-MEDIA-04, BR-WH-01, BR-WH-02, SR-INPUT-01 | G2/G3 | object registry parity, SSRF suite, truthful webhook receipts |
| 3 | Fence jobs and external side effects | BR-JOB-01, BR-JOB-02, BR-TG-01, BR-TG-02, BR-REPROCESS-01, BR-REPROCESS-02, BR-THREAD-01, BR-X-01, BR-X-02 | Phase 2 contracts | concurrency/fault evidence and zero duplicate calls |
| 4 | Harden renderer and manual publish | BR-RENDER-01, BR-RENDER-02, BR-RENDER-03, BR-RENDER-04, FE-MANUAL-01, FE-VIDEO-01 | G3, BR-JOB-01 | lease renewal, subprocess bounds, exact preview/publish CAS |
| 5 | Correct frontend truth and operator safety | FE-RACE-01, FE-API-01, FE-SCORE-01, FE-SETTINGS-01, FE-SETTINGS-02, FE-MEDIA-01, FE-AUTH-01, FE-SAFETY-01 | stable API contracts | authenticated browser evidence for every affected workflow |
| 6 | Bound data access, realtime work, and bundle cost | BR-DASH-01, BR-DASH-02, FE-DASH-01, FE-DASH-02, FE-MON-01, FE-BUNDLE-01, SR-DBPERF-01 | Phase 1 schema trust | performance budgets and independent degraded states |
| 7 | Accessibility, visual density, strictness, and modularity | FE-A11Y-01, FE-VISUAL-01, FE-QUALITY-01, BR-MOD-01, BR-MOD-02, SR-SUPPLY-01, SR-BUILD-01 | correctness stable | axe/keyboard/responsive proof, full strict check, characterization tests |
| 8 | Staged release, control regression, and closure | QA-01 through QA-05, SR-REL-01 | all selected phases | local/staging/live status separated; AIR matrix has no open orphan |

## Security Hardening Design Decisions

The audit is an ordinary evidence collection anchored to the named commit, not a sealed Codex Security scan. Observed claims in the AIR matrix come from inspected source and the July read-only receipts; live exploitability beyond those receipts remains unproven. The structures below are proposed designs and must not be described as remediated until implemented and revalidated.

### Opportunity 1 — Centralize remote media and object-lifecycle authority

- Option 1, local guards: deduplicate cleanup paths and add URL/size checks in existing handlers. This is the smallest change, but ownership remains dispersed and a future caller can bypass it.
- Option 2, canonical object boundary: BR-MEDIA-01 through 04 create one physical-object registry, one bounded acquisition policy and one token-claimed cleanup finalizer. This is the recommended option because it addresses both the data-loss and SSRF classes at their privileged sinks.
- Option 3, isolated fetch/cleanup service: move remote network and storage deletion into a separate restricted service. This offers stronger process/network isolation, but it adds deployment/queue/credential burden that the current evidence does not yet justify.
- Recommendation: use Option 2 now, keep direct tactical guards during migration, and revisit Option 3 only if controlled tests show the Edge runtime cannot reliably enforce DNS/stream/resource policy.

### Opportunity 2 — Make external side-effect states unambiguous

- Option 1, per-handler idempotency patches: add local “already sent” checks. This is fast but cannot close the crash window between provider acceptance and DB write.
- Option 2, shared token-fenced state machines: the job, Telegram, X and renderer task families use current-owner tokens, API-start markers, progress and ambiguous terminal states. This is recommended because invalid stale transitions become rejectable and unknown provider outcomes cannot be confused with retryable failure.
- Option 3, dedicated delivery gateway/broker: centralize all Telegram/X provider calls in a new service. It could improve isolation but creates another highly privileged component and operational boundary without evidence that the existing DB/RPC boundary is inadequate.
- Recommendation: use Option 2. Preserve provider-specific tactical duplicate assertions and reconciliation; do not claim exactly-once delivery, which external APIs cannot guarantee.

### Opportunity 3 — Move admin authorization to the data boundary

- Option 1, tighten table RLS while retaining direct frontend reads: fewer backend changes, but frontend query/realtime coupling keeps policy surface broad.
- Option 2, least-privilege RLS plus admin-mediated resource APIs: SR-RLS-01 and the bounded admin actions become the owned authorization/read boundary. This is recommended because it removes broad table capability from ordinary authenticated sessions and supports bounded queries/signed media.
- Option 3, separate admin backend/service: strongest deployment isolation, but adds an application/service migration and new operational credentials not warranted by the current single-admin product.
- Recommendation: use Option 2 with role-matrix and query-performance evidence. Option 3 becomes preferable if XOT becomes multi-tenant or the Edge/admin action boundary cannot enforce independent privileges.

### Recommended-option tradeoffs

| Dimension | Expected direction | Confidence/basis | Mechanism and validation |
| --- | --- | --- | --- |
| Security | improves | high, source-derived | privileged network/delete/send/read controls gain one owned boundary; validate original findings and role/fault matrices |
| Performance | mixed | medium, source-derived | transactions, tokens and mediated reads add small work; streaming and SQL aggregates remove large buffers/transfers; benchmark target paths |
| Memory | improves overall | medium, source-derived | bounded streaming/logs replace full buffers; added registry/ledger rows consume DB storage; measure Edge/renderer RSS and table growth |
| Reliability | improves | high, source-derived | durable receipts, resumable stages, fenced completion and ambiguity prevent silent false success; fault every transition |
| Operability | initially regresses, then improves | medium, analogous | more states, reconciliation and alerts require runbooks; incidents become attributable; run canary/rollback drills |
| Migration | significant but reversible | high, source-derived | additive schema, backfill, dual-write/read and flags require several waves; retain old reads until parity and use forward fixes |

The attractive property of these recommendations is shared control ownership without a new service fleet. What gives us pause is migration complexity: the database history must be trustworthy first, and every compatibility path must remain observable until cutover. A local tactical fix remains mandatory during migration; the structural design is not a substitute for immediately freezing unsafe cleanup.

## Task Backlog

Each task is an independently reviewable implementation slice. “Acceptance” means target-state evidence in addition to focused tests.

### Backend, data, and runtime

#### BR-00 — Live preflight and media-cleanup freeze

- Resolves: AIR-001, AIR-065 and the live destructive-risk precondition.
- Owner surfaces: cron.job, supabase/functions/media-cleanup/index.ts, supabase/functions/db-cleanup/index.ts, supabase/functions/media-processor/index.ts, release-state scripts and runbooks.
- Resolution:
  1. Re-run release-state checks and save current function hashes, cron definitions, queue age, claims, renderer capacity, settings modes, deployed SHAs, and migration list.
  2. With explicit production-change approval, set invoke-media-cleanup-6h inactive and prevent db-cleanup from invoking cleanup. Keep dry-run inventory available.
  3. Inventory media grouped by bucket/storage_path, mixed reference ages, active jobs/renders, missing objects, and storage orphans.
  4. Add an operator-visible “cleanup disabled for safety” status so containment is not mistaken for scheduler failure.
- Dependencies: none for read-only baseline; explicit approval for pausing live cron.
- Acceptance: both cleanup entry points are proven inactive; no delete call occurs during the freeze; every shared path is classified; schedule definitions and a restore command are recorded.
- Rollout/rollback: containment first; rollback may restore the exact prior schedules only after BR-MEDIA-03 passes canary.
- Stop: any inventory query is destructive, cannot bound its result, or discovers a currently running cleanup.

#### BR-MEDIA-01 — Canonical physical media-object registry

- Resolves: AIR-001, AIR-027, AIR-064 and supports AIR-028.
- Owner surfaces: new additive migration, public.media, a new public.media_objects table, supabase/functions/media-processor/index.ts, supabase/functions/_shared/staleMediaRepair.ts, generated Supabase types.
- Resolution:
  1. Add media_objects with unique bucket/storage_path, source/content hashes, MIME, bytes, lifecycle state, deletion claim token/lease, and timestamps.
  2. Add nullable media.object_id, backfill by current physical path, record missing/orphan/ambiguous rows, and dual-write new acquisitions.
  3. Shadow-read object ownership, compare with legacy storage_path, then enforce the FK only after parity.
  4. Model logical media rows as references; never use one logical row's age as physical object ownership.
- Dependencies: SR-MIG-01 and SR-RLS-01.
- Acceptance: every non-quarantined logical row maps to one object; unique object paths have no duplicate registry rows; all exceptions are classified; generated types match the deployed schema.
- Rollout/rollback: additive schema, checkpointed backfill, dual-write, shadow-read, cutover. Rollback disables new reads but retains additive evidence; use forward-fix migrations.
- Stop: a path maps to conflicting bucket/content identities or an unclassified reference would be changed.

#### BR-MEDIA-02 — Bounded, SSRF-resistant media acquisition

- Resolves: AIR-008, AIR-068 and AIR-069; supports AIR-026 and AIR-027.
- Owner surfaces: supabase/functions/media-processor/index.ts, webhooks-rssapp parser, a shared remoteMediaPolicy helper, provider-specific URL validation, logs and tests.
- Resolution:
  1. Replace fetch plus arrayBuffer with a streaming download.
  2. Require HTTPS and a reviewed provider/host contract; reject credentials in URLs, non-public DNS/IPs, loopback, link-local, private ranges, metadata endpoints, nonstandard ports unless explicitly needed, and DNS rebinding on every redirect.
  3. Bound redirects, headers, item count, URL length, Content-Length, streamed bytes, MIME/magic, time to first byte, total duration, and decompression.
  4. Upload to a random or content-addressed staging path, verify metadata, then attach and mark available.
  5. Redact query strings and signed parameters from errors, telemetry, and audit logs.
- Dependencies: BR-MEDIA-01 and SR-INPUT-01.
- Acceptance: a safe local SSRF corpus rejects private/metadata/rebinding/redirect cases with zero outbound connection to forbidden targets; oversized, slow, compressed-bomb, and MIME-mismatch fixtures abort within budgets; interrupted uploads never become available attachments.
- Rollout/rollback: ship policy in report-only mode against captured host samples, approve the allowlist, enable for one provider, then all ingress. Rollback disables new download attempts rather than returning to unbounded fetch.
- Stop: a required legitimate provider cannot be expressed with a bounded rule or DNS validation cannot be enforced at the actual runtime boundary.

#### BR-MEDIA-03 — Reference-aware, token-claimed cleanup saga

- Resolves: AIR-001, AIR-064 and AIR-065.
- Owner surfaces: new cleanup RPC migration, media-processor, media-cleanup, db-cleanup, staleMediaRepair, cleanup observability.
- Resolution:
  1. Replace row-oriented get_old_media selection with claim_media_objects_for_cleanup.
  2. Select only physical objects whose complete reference set is expired/inactive and which have no active jobs, render, intake, or delivery dependency.
  3. Atomically claim disjoint objects with token and lease.
  4. Delete storage first. On success or confirmed 404, token-finalize logical/object state. On any other storage error, retain all references and record retryable failure.
  5. Quarantine orphans for a delay window; repair missing active objects by explicit jobs rather than deletion.
- Dependencies: BR-00, BR-MEDIA-01, SR-MIG-01.
- Acceptance: mixed-age shared paths are never selected; concurrent cleaners get disjoint claims; injected storage failure clears zero DB references; stale token cannot finalize; repeated cleanup is idempotent; canary dry-run equals intended deletion set.
- Rollout/rollback: deploy inactive, shadow-select for at least one full retention boundary sample, canary a bounded batch, then re-enable one schedule. Rollback stops new claims and preserves registry/claims; never restore path-blind deletion.
- Stop: any selected object has a fresh/active reference, reference queries disagree, or deletion/finalization cannot be fenced.

#### BR-MEDIA-04 — Authorised short-lived media access

- Resolves: AIR-027 and supports AIR-026.
- Owner surfaces: admin-actions media/read module, canonical action-name registry, frontend API types, storage policy and tests.
- Resolution: add an admin-only action that accepts a logical media/render identifier, verifies ownership and role server-side, resolves the canonical object, and returns a short-lived signed URL plus media kind, MIME, dimensions/duration, expiry, and provenance. Never accept arbitrary bucket/path as authorisation.
- Dependencies: SR-RLS-01 and BR-MEDIA-01.
- Acceptance: anon/viewer/cross-object requests fail; admin receives only owned object URLs; URLs expire; video metadata causes video rendering rather than img fallback; service-role signing remains server-side.
- Rollout/rollback: introduce alongside current URLs, dual-render sampled rows, then remove direct path assumptions. Rollback uses the old admin-mediated read only if it remains authorised.
- Stop: frontend requires a service key or bucket/path cannot be tied to an authorised logical entity.

#### BR-WH-01 — Durable RSS webhook inbox

- Resolves: AIR-003, AIR-066 and AIR-069.
- Owner surfaces: new rss_webhook_receipts and rss_webhook_items migration/RPC, supabase/functions/webhooks-rssapp/index.ts, worker router and a new ingest handler, generated types.
- Resolution:
  1. Validate bounded request/body/item/media shapes before persistence.
  2. Derive deterministic provider/feed/item receipt keys.
  3. Transactionally persist the receipt and item payload/hash before dispatch.
  4. Materialize posts, media placeholders, and downstream jobs in an idempotent worker handler with stage checkpoints.
  5. Retain raw payload only within the redacted/minimal retention contract.
- Dependencies: SR-MIG-01, SR-INPUT-01 and existing RSS HMAC contract.
- Acceptance: concurrent duplicate requests create one receipt and one materialization; crash after receipt commit resumes; replay produces no duplicate jobs; every accepted item has a durable trace.
- Rollout/rollback: shadow-write receipts while old path remains authoritative, reconcile, switch acknowledgment, then retire inline materialization. Rollback keeps receipts and replays through the known-good handler.
- Stop: receipt identity is not deterministic or payload retention would store credentials/private query strings.

#### BR-WH-02 — Truthful webhook acknowledgement and safe self-test

- Resolves: AIR-003 and AIR-015.
- Owner surfaces: webhooks-rssapp response assembly, admin-retry/index.ts test_webhook, admin-actions test controls, runbooks.
- Resolution:
  - Return 202 only after durable receipt persistence, 200 for an exact duplicate, 400 for invalid input, 401/403 for auth failure, 413 for bounded-size rejection, and 503 for persistence failure.
  - Remove processed counters that advance despite failed required writes.
  - Replace the mismatched fake webhook action with an authenticated validate_only parser/auth check that performs no post/job write. Keep a separately named, explicit fixture-ingest action behind admin confirmation.
- Dependencies: BR-WH-01 and SR-AUTH-01.
- Acceptance: injected DB failure is non-success; duplicate response identifies the receipt; validate_only creates no rows or provider calls; status and body agree.
- Rollout/rollback: canary with signed fixtures and compare provider retry behavior. Rollback can retain old parsing but may not return false success.
- Stop: provider retry semantics for 202/503 are unverified; document and simulate them first.

#### BR-JOB-01 — Token-fenced job ownership and lifecycle

- Resolves: AIR-005 and AIR-064.
- Owner surfaces: jobs schema/claim_jobs RPC, new renew/complete/defer/fail RPCs, supabase/functions/worker/index.ts, worker/jobLifecycle.ts.
- Resolution:
  1. Add claim_token, claim_generation, and last_lease_renewed_at.
  2. Require running status plus current token/generation for every mutation.
  3. Make each RPC return the affected row/result and treat zero rows or DB errors as ownership loss, never success.
  4. Renew before long work and set handler deadlines inside the lease.
  5. Record provider-success-but-finalization-rejected as a reconciliation incident.
- Dependencies: SR-MIG-01.
- Acceptance: a stale owner cannot complete/fail/defer; two workers yield one accepted completion; DB failure cannot emit a completed response; reconciliation view shows lost-ownership anomalies.
- Rollout/rollback: additive tokens, worker dual-contract in shadow, drain legacy claims, require tokens for new claims, then remove ID-only writes. Rollback stops claiming/drains; never restore unfenced completion.
- Stop: any handler mutates jobs directly after token cutover.

#### BR-JOB-02 — Capacity-aware lanes, deadlines, and checked writes

- Resolves: AIR-005, AIR-064 and AIR-067.
- Owner surfaces: worker runtime/router, jobLifecycle, job-type handlers, deployment settings and metrics.
- Resolution:
  - Separate fast, model, media, and delivery capacities with bounded semaphores/map-limit.
  - Claim only free capacity; token-defer unstarted work.
  - Replace broad Promise.allSettled fan-out and unchecked regroup/status updates.
  - Give each handler a deadline shorter than its lease and renew deliberately.
  - Define BATCH_SIZE as claim capacity, not accidental provider concurrency.
- Dependencies: BR-JOB-01.
- Acceptance: observed concurrency never exceeds configured lane limits; a slow job renews; one chat serialises delivery without starving other lanes; all writes are checked; queue age remains within the baseline budget.
- Rollout/rollback: enable one lane at a time via config; rollback lowers capacity or disables the lane without invalidating claims.
- Stop: queue age or provider rate errors materially regress, or a lane lacks safe defer semantics.

#### BR-TG-01 — Atomic Telegram claim, progress, and ambiguity

- Resolves: AIR-002 and supports AIR-010.
- Owner surfaces: deliveries schema/RPCs, worker deliver handler, a shared telegramDelivery module, pipeline events and reconciliation UI.
- Resolution:
  1. Add deterministic delivery_key, claim token/generation, and preparing/posting/posted/failed/skipped/ambiguous states.
  2. Claim after cheap eligibility/media checks but before the first Telegram call.
  3. Mark API started immediately before the call. Pre-call expired claims may reclaim; any post-start unknown outcome becomes ambiguous and cannot auto-retry.
  4. Record successful message/media-group parts so partial delivery can be reconciled.
- Dependencies: BR-JOB-01 and SR-MIG-01.
- Acceptance: concurrent workers generate one provider request; crash before call reclaims; crash after call becomes ambiguous; partial group progress remains visible; no ambiguous delivery auto-retries.
- Rollout/rollback: dual-record legacy status and new claim state, canary one chat, then expand. Rollback disables sends and reconciles claims; never blindly replay.
- Stop: provider response/request IDs cannot support reconciliation or any send path bypasses the claim.

#### BR-TG-02 — Correct Telegram fallback response propagation

- Resolves: AIR-014.
- Owner surfaces: shared telegramDelivery helper, worker main-text fallback, error classifier and tests.
- Resolution: every parse-mode fallback must report and classify the second/final response, including status, retry_after, and safe provider error details; discard the first response only as context.
- Dependencies: BR-TG-01 can land before or with this task.
- Acceptance: fixtures cover first-fail/second-success, second 429, second 500, network failure, and partial media-group failure; operator state and retry schedule match the final response.
- Rollout/rollback: narrow helper change behind tests; rollback only if it preserves final-response truth.
- Stop: retry code still consumes the first response after fallback.

#### BR-REPROCESS-01 — Repeatable reprocess request model

- Resolves: AIR-004.
- Owner surfaces: new reprocess_runs migration/RPC, admin action, worker router/types and UI result contract.
- Resolution: create a run ID, requester, mode, source snapshot/hash, lifecycle, and error for each request; deduplicate only concurrently active runs; use reprocess:run_id idempotency keys; return queued/run_id/reason truthfully.
- Dependencies: SR-MIG-01 and BR-JOB-01.
- Acceptance: terminal runs can repeat; simultaneous active requests dedupe; a failed enqueue is not reported queued; each downstream stage traces to run_id.
- Rollout/rollback: additive table and new action behind a flag; old action becomes read-only/disabled after parity. Rollback disables new requests but retains runs.
- Stop: a new run could clear delivery history or reuse a permanent tweet-only key.

#### BR-REPROCESS-02 — Non-destructive staged reprocessing

- Resolves: AIR-004 and AIR-064.
- Owner surfaces: worker handleReprocessJob extraction, media registry, job keys and admin review state.
- Resolution:
  - Never delete prior media first.
  - Resolve/download into staged objects, compare hashes/object IDs, atomically attach replacements, and only then mark old logical references superseded.
  - Include run_id in downstream keys.
  - Preserve Telegram/X history and finish review-ready; redelivery requires a separate explicit action.
  - Add repair inventory for has_media mismatch, missing objects, orphan attachments, and missing downstream stages.
- Dependencies: BR-MEDIA-01, BR-MEDIA-02, BR-REPROCESS-01 and BR-JOB-01.
- Acceptance: injected resolve/upload/DB failure preserves old media; rerun resumes missing stages; delivery history is byte-for-byte unchanged; operator can distinguish superseded and active attachments.
- Rollout/rollback: canary one non-delivered fixture, then one historical safe item. Rollback stops runs and retains staged objects for reconciliation.
- Stop: any code path deletes an active reference before replacement commit.

#### BR-THREAD-01 — Real ordered thread-delivery consumer

- Resolves: AIR-010 and AIR-066.
- Owner surfaces: admin post_thread action, thread schema/RPC, worker router/handler, shared preview/delivery formatter, Telegram claim model.
- Resolution:
  1. Validate chat/posts and exact tweet_ids order.
  2. Compute an immutable revision hash from ordered content and template.
  3. Transactionally enqueue thread delivery.
  4. Use one formatter for preview and provider payload; split only at post boundaries under Telegram limits.
  5. Skip the same revision; require confirmation for a changed revision.
- Dependencies: BR-TG-01 and BR-JOB-01.
- Acceptance: provider-visible messages match preview and order; missing posts fail before a call; two workers cannot duplicate; edited revisions require explicit confirmation.
- Rollout/rollback: ship preview/hash first, then canary one test chat. Rollback disables delivery action without deleting queued/revision rows.
- Stop: the handler cannot prove exact revision/ordering at confirmation.

#### BR-X-01 — Atomic fail-closed X quota reservation

- Resolves: AIR-011 and AIR-059.
- Owner surfaces: x-poster/index.ts, X settings and ledger schema, new quota/reservation RPC, manual intake action and UI contract.
- Resolution:
  - Replace error-ignored counts with one serialised RPC that validates typed settings and reserves post and media capacity.
  - Count posted plus active reservations in explicitly named units: attempts, posts, uploads, and requests.
  - On DB/policy/settings error, return quota_unavailable and make zero provider calls.
  - Apply the same contract to cron and manual posting.
- Dependencies: SR-MIG-01, SR-TYPE-01 and FE-SAFETY-01.
- Acceptance: two candidates competing for the last slot yield one reservation; forced query failure causes zero calls; manual and scheduled rows share identical quota state; UI labels match ledger units.
- Rollout/rollback: shadow calculate old/new quota, then reserve for manual canary, then cron. Rollback disables posting rather than failing open.
- Stop: quota units or provider endpoints cannot be reconciled.

#### BR-X-02 — Early X claim, stale reclaim, and ambiguous outcome

- Resolves: AIR-012 and AIR-013.
- Owner surfaces: x-poster/index.ts, shared xPostDeliveryClaim, claim migration, manualVideoIntakeActions, reconciliation UI.
- Resolution:
  1. Use preparing/posting/posted/failed/ambiguous with claim token/generation and API-start timestamp.
  2. Claim before duplicate/model/render/storage preparation.
  3. Token-defer while render/media is pending.
  4. Reclaim only pre-API stale preparation. Post-start timeout/network-unknown becomes ambiguous and requires account reconciliation.
  5. Reject stale completion and release leaked reservations safely.
- Dependencies: BR-X-01 and BR-JOB-01.
- Acceptance: concurrent triggers perform expensive preparation once; expired pre-call claim reclaims; stale owner cannot post/finalise; post-start unknown outcome never auto-retries; reconciliation links row to X account evidence.
- Rollout/rollback: canary manual dry-run, then one operator-approved post, then scheduled lane. Rollback disables candidates and reconciles active claims.
- Stop: any posting path bypasses claim/reservation or ambiguous state is treated as failed/retryable.

#### BR-RENDER-01 — Fenced renderer ownership and immutable output

- Resolves: AIR-018 and supports AIR-005.
- Owner surfaces: video render claim/complete RPCs, services/video-renderer/src/renderer.js, worker videoRenderWorkflow and object paths.
- Resolution: add claim token/generation/renewal and require it for renew, complete, block, and fail; include generation in the output path; upload with no overwrite; quarantine/delete output from an owner that lost its claim; dispatch delivery only from accepted completion.
- Dependencies: SR-MIG-01, BR-JOB-01 and BR-MEDIA-01.
- Acceptance: a render longer than the original lease renews; stale owner cannot complete or overwrite; accepted output is tied to the current token; orphan-output reconciliation is observable.
- Rollout/rollback: additive token fields, renderer dual-support, drain old claims, enable token requirement. Rollback stops renderer and drains; never restore ID-only completion.
- Stop: any completion RPC or storage upload can ignore ownership.

#### BR-RENDER-02 — One concurrency gate and graceful shutdown

- Resolves: AIR-019.
- Owner surfaces: services/video-renderer/src/config.js, server.js, renderer.js, poller/runtime state, deployment configuration.
- Resolution: parse and validate RENDER_CONCURRENCY; use one semaphore for HTTP render/preflight and poller work; refuse excess HTTP work with 429/503 and Retry-After before claiming; on SIGTERM stop claims and drain or abort within bounded grace.
- Dependencies: BR-RENDER-01.
- Acceptance: combined poller and HTTP concurrency never exceeds the configured value; a rejected request holds no claim; shutdown leaves no abandoned current claim.
- Rollout/rollback: default one, load-test, then tune. Rollback sets one or stops HTTP path.
- Stop: poller and HTTP cannot share the same capacity accounting.

#### BR-RENDER-03 — Bounded subprocesses, logs, resources, and temp space

- Resolves: AIR-020 and supports AIR-008.
- Owner surfaces: services/video-renderer/src/ffmpeg.js, preflight.js, renderer.js, preview.js, a new processRunner.js, Dockerfile/docker-compose.yml.
- Resolution:
  - Route every spawn through one runner with stage deadline, abort signal, bounded stdout/stderr tail, SIGTERM grace, SIGKILL/process-group cleanup, exit metadata, and temp-file reconciliation.
  - Measure healthy CPU, memory, pids, and temp use; then add cpus, mem_limit, pids_limit, temp-volume budget, and stop_grace_period.
  - Bound concurrent frame/inspection Promise.all work separately.
- Dependencies: BR-RENDER-02 and a renderer host baseline.
- Acceptance: hung ffmpeg and descendants die within budget; output memory is bounded; temp files are reclaimed; container limits hold; healthy render p95 stays within an approved tolerance.
- Rollout/rollback: runner first with generous measured limits, fault fixtures, then container caps. Rollback relaxes measured caps but retains process deadlines/log bounds.
- Stop: limits kill healthy representative renders or orphan child processes remain.

#### BR-RENDER-04 — Explicit preview/publish compare-and-set

- Resolves: AIR-006 and AIR-060.
- Owner surfaces: admin-actions/manualVideoIntakeActions.ts, selected render and caption version fields/RPC, frontend manual intake API.
- Resolution: preview an explicit render ID and return selection_version/caption_version; require intake ID, render ID, and both versions on publish; transactionally reject mismatch with 409 and a fresh snapshot; X posting receives only the validated selection.
- Dependencies: BR-X-01, BR-X-02, BR-RENDER-01 and FE-MANUAL-01.
- Acceptance: the bytes/render ID and exact caption displayed in confirmation equal the provider request; changing selection or caption in another session makes the old dialog stale and non-posting.
- Rollout/rollback: enforce in admin preview first, then publish behind the manual-post flag. Rollback disables publish rather than accepting versionless requests.
- Stop: any fallback selects “latest completed” after the user has reviewed a specific render.

#### BR-DASH-01 — Database-side bounded dashboard aggregates

- Resolves: AIR-030, AIR-069 and supports AIR-017.
- Owner surfaces: new get_dashboard_core_v2/get_queue_breakdown_v2 RPCs, admin-actions/dashboardSummaries.ts, indexes and frontend normalizers.
- Resolution: calculate counts, ages, percentiles, resource/queue summaries, and bounded recent exceptions in SQL/RPC; eliminate 5k/10k hydration and the duplicated queue scan; return explicit generated_at and source metadata.
- Dependencies: SR-MIG-01 and SR-DBPERF-01.
- Acceptance: results stay exact above 10k rows; fixed query count and bounded transfer size; EXPLAIN ANALYZE uses intended indexes; core p95 under 2 seconds at production-like volume.
- Rollout/rollback: shadow old/new responses and diff fields, then switch core action. Rollback selects old response behind flag while keeping new RPCs.
- Stop: aggregates omit a state that changes operator decisions or plans show sequential/full scans at target volume.

#### BR-DASH-02 — Independent lazy diagnostics and deadline envelopes

- Resolves: AIR-032 and supports AIR-021, AIR-022, AIR-030.
- Owner surfaces: dashboardSummaries.ts, monitoringReads.ts, admin-actions routing, frontend API envelopes.
- Resolution:
  - Return core independently.
  - Load X, OpenAI, scoring, process, and observability diagnostics only when requested/visible.
  - Standardize each section as available, error, generated_at, source, and data.
  - Apply server/query deadlines and make mutation request IDs idempotent before client retry.
- Dependencies: BR-DASH-01.
- Acceptance: one failed diagnostic never blanks or delays core; a deadline returns a truthful degraded envelope; diagnostic p95 under 5 seconds; client abort does not imply server mutation cancellation.
- Rollout/rollback: add v2 action and frontend opt-in, then default after parity. Rollback restores old core but keeps safe deadlines.
- Stop: partial failure is serialized as healthy/empty or a client retry can duplicate mutation.

#### BR-ADM-01 — Request-local CORS and response state

- Resolves: AIR-016.
- Owner surfaces: supabase/functions/admin-actions/index.ts and shared response/auth helpers.
- Resolution: remove mutable module-global corsHeaders; calculate an immutable allowed-origin response per request; pass it through all success/error/auth responses and include Vary: Origin when dynamic.
- Dependencies: SR-AUTH-01.
- Acceptance: interleaved different-origin requests receive only their own ACAO; disallowed origins get none; preflight and error responses match; function auth order is unchanged.
- Rollout/rollback: narrow behavior-preserving change with concurrency tests. Rollback only to another request-local implementation.
- Stop: an origin value survives across requests.

#### BR-DIGEST-01 — Digest compilation checkpointing

- Resolves: AIR-066 and supports AIR-051.
- Owner surfaces: supabase/functions/digest-compiler/index.ts, digest rows/settings, any downstream delivery enqueue.
- Resolution: separate compilation run identity from output; checkpoint provider call, persisted output, and downstream enqueue; use deterministic run/content keys; a crash resumes without duplicating output or delivery; keep configuration credentials outside settings per SR-SECRET-01.
- Dependencies: BR-JOB-01 and SR-SECRET-01.
- Acceptance: fault injection between every stage yields one canonical digest and at most one downstream job; partial run is visible and resumable.
- Rollout/rollback: shadow run records, then make them authoritative. Rollback disables new compilation and preserves checkpoints.
- Stop: output identity cannot be made deterministic or configuration source is still unverified.

#### BR-MOD-01 — Worker, X, and admin-action decomposition

- Resolves: AIR-036.
- Owner surfaces: worker/index.ts, x-poster/index.ts, admin-actions/index.ts and monitoringReads.ts.
- Resolution:
  1. Add characterization tests and golden state/provider traces after phases 2–6.
  2. Make entrypoints thin.
  3. Extract workerRuntime/jobClaims and media/deliver/reprocess handlers.
  4. Extract X candidate selection, quota/claim, provider client, and manual intake.
  5. Extract admin action dispatch/contracts and bounded monitoring queries.
  6. Perform pure moves separately from behavior changes and keep one authoritative action-name contract.
- Dependencies: correctness cutovers complete; FE-QUALITY-01.
- Acceptance: golden traces and APIs remain unchanged; modules have explicit inputs/outputs and focused tests; circular imports and duplicate contracts do not increase; entrypoints contain orchestration only.
- Rollout/rollback: one module move per commit/checkpoint. Rollback reverts only the move.
- Stop: a proposed extraction changes state semantics or lacks characterization evidence.

#### BR-MOD-02 — Renderer, dashboard, enrichment, and dedupe decomposition

- Resolves: AIR-036 and AIR-064.
- Owner surfaces: renderer.js/preflight.js/ffmpeg.js; dashboardSummaries.ts; shared enrich.ts and dedupe.ts; Dashboard.tsx/Monitoring.tsx in coordination with FE work.
- Resolution: split renderer process/vision/OCR/delogo/placement, dashboard core/queue/usage/diagnostics, enrichment config/prompt/provider/persistence, and dedupe candidate/canonical/final assertion. Establish complexity/file-size warnings as review signals, not arbitrary blockers.
- Dependencies: BR-RENDER-01, BR-RENDER-03, BR-DASH-01, BR-DASH-02 and characterization tests.
- Acceptance: behavior traces match; each module has one reason to change; no duplicated policy/source of truth; module tests cover boundary failures.
- Rollout/rollback: pure moves in small slices. Revert the individual slice on any semantic diff.
- Stop: extraction proceeds concurrently with an unresolved correctness incident.

### Frontend, UI/UX, performance, and accessibility

#### FE-MANUAL-01 — One authoritative manual preview and publish snapshot

- Resolves: AIR-006 and AIR-060.
- Owner surfaces: src/components/video/ManualVideoIntakePanel.tsx, useManualVideoIntakeData.ts, VideoRenderDetailPanel.tsx, manual intake API types and confirmation dialog.
- Resolution:
  - Store one selected render ID in the form/controller; render the preview only from that ID.
  - Bind caption draft, duplicate override, safety flags, selected render, selection_version, and caption_version into one publish snapshot.
  - Freeze and display the exact snapshot in confirmation; disable double submission; surface 409 stale-snapshot response with a diff and require re-confirmation.
  - Never fall back to “latest completed” after a deliberate selection.
- Dependencies: BR-RENDER-04, BR-X-01 and BR-X-02.
- Acceptance: automated state tests plus an authenticated two-session browser test prove that changing selection/caption invalidates an old dialog; network payload IDs/text equal visible confirmation; one click yields one request.
- Responsive/accessibility: selected state and warning remain visible at 320, 390, 768, and 1440 widths; confirmation is focus-trapped, labelled, keyboard-operable, and returns focus.
- Rollout/rollback: enable for preview first, then publishing behind the existing manual-post gate. Rollback disables publish, not compare-and-set.
- Stop: UI cannot obtain or retain versioned backend snapshot fields.

#### FE-RACE-01 — Selection-keyed Threads and Monitoring reads

- Resolves: AIR-021 and AIR-022.
- Owner surfaces: src/pages/Threads.tsx, src/pages/Monitoring.tsx, MonitoringDetailDrawer.tsx, monitoring/thread API hooks.
- Resolution:
  1. Put selected entity ID and relevant revision in every query key.
  2. Abort superseded requests and reject late responses whose key no longer matches.
  3. Clear or explicitly mark old detail while the new entity loads; never combine a new heading with old content.
  4. Move fetch lifecycle into focused hooks and derive selected data from the matching cached record.
- Dependencies: stable admin response IDs; BR-DASH-02 deadline envelope.
- Acceptance: deterministic deferred-promise tests and browser network throttling select A→B→C with out-of-order responses; only C renders/actions; closed drawers cannot update; console contains no state-after-unmount warning.
- Rollout/rollback: one route at a time with query logging. Rollback restores prior hook only if it still guards identity.
- Stop: any action can be enabled for data whose returned entity ID differs from current selection.

#### FE-API-01 — Deadlines and unknown-outcome semantics for admin actions

- Resolves: AIR-032 and supports AIR-058.
- Owner surfaces: src/api/adminActions.ts, src/api/adminRetry.ts and consumers in Dashboard, Monitoring, Settings, Threads, Downloader, and Video Renders.
- Resolution:
  - Define typed request profiles with AbortController deadlines, operation/request IDs, and normalized error codes.
  - Use short read deadlines and action-specific mutation deadlines; do not blindly retry mutations.
  - A mutation timeout becomes outcome_unknown, disables repeat submission, and reconciles by operation/idempotency key.
  - Make the UI distinguish client abort, server failure, authorization failure, provider failure, and unknown completion.
- Dependencies: backend idempotency and operation-status support for every external/destructive action; BR-DASH-02 envelopes.
- Acceptance: blackhole and slow-response staging fixtures end every spinner within contract; timed-out reads retry safely; timed-out mutations create at most one operation and reconcile to final state; no generic success is shown before proof.
- Browser evidence: HAR and screen capture for success, deadline, offline, late success, and reconciliation on desktop/mobile.
- Rollout/rollback: instrument/report deadline telemetry first, enforce by action family. Rollback may relax a measured deadline but retains request IDs and unknown-outcome safety.
- Stop: an action has no idempotency/reconciliation path or aborting the client can lead to duplicate mutation.

#### FE-SCORE-01 — One scoring and threshold control plane

- Resolves: AIR-023 and AIR-024.
- Owner surfaces: Settings.tsx, ScoringStudio.tsx, EditorialProfilesCard.tsx, MonitoringDetailDrawer.tsx, ContentFilterSettings.tsx, admin activeThreshold.ts and settings read contract.
- Resolution:
  - Make scoring_policy plus the backend active-threshold resolver the canonical source.
  - Return effective threshold, mode, source, version, and compatibility fallback from one admin read.
  - Monitoring displays that effective value and source.
  - Scoring Studio is the only writable scoring policy. Legacy editorial profiles become read-only migration/reference or are removed after equivalence.
  - Define a forward migration for legacy content_filter/default_threshold values and a rollback snapshot.
- Dependencies: SR-MIG-01 and SR-TYPE-01.
- Acceptance: a settings change produces one versioned row and identical worker/preview/Monitoring interpretation; shadow/disabled modes display truthfully; no second UI can write conflicting values.
- Browser evidence: edit, save, refresh, open Monitoring, and capture the same source/version/threshold; stale session receives conflict rather than overwrite.
- Rollout/rollback: compatibility read and shadow comparison, then one writer. Rollback restores the prior settings snapshot, not two live writers.
- Stop: worker and admin resolver cannot agree on precedence for every mode.

#### FE-SETTINGS-01 — Fail-closed settings loading and typed error states

- Resolves: AIR-025 and AIR-067.
- Owner surfaces: src/pages/Settings.tsx, useSettingsData.ts, EnrichmentSettings.tsx, VideoRenderingSettings.tsx, LearnedSignalsCard.tsx and other settings cards.
- Resolution:
  - Model loading, loaded, empty-authoritative, error, and stale states explicitly.
  - Never construct a writable default when the read fails.
  - Disable save/test controls until an authoritative baseline exists.
  - Show section-specific errors, last-known data as visibly stale/read-only when safe, retry, and request/correlation ID.
  - Validate typed settings at the API boundary and reject unknown/malformed fields.
- Dependencies: SR-TYPE-01 and BR-DASH-02 response envelope pattern.
- Acceptance: injected 401/403/500/timeout/malformed payload never enables a save of defaults; an intentional empty setting is distinguishable from failure; retry restores the correct baseline.
- Browser evidence: offline/slow/failed network states at desktop/mobile show actionable text without permanent spinner or layout collapse.
- Rollout/rollback: migrate one card family at a time; rollback keeps saves disabled on error.
- Stop: any settings component can call a mutation without loaded version/provenance.

#### FE-SETTINGS-02 — Dirty-draft concurrency and handle-scope correctness

- Resolves: AIR-057 and AIR-033.
- Owner surfaces: settings forms/hooks, query invalidation, ContentFilterSettings.tsx, TranslationPlayground.tsx and backend request schema.
- Resolution:
  - Track baseline version, local draft, and dirty fields separately.
  - Background invalidation updates pristine fields only; dirty forms show “new version available” with compare/reload/keep choices.
  - Save uses optimistic concurrency and returns conflict on stale version.
  - Parse and validate the complete handle list; show normalized chips/count and pass all handles, not the first one, to preview/evaluation. Define whether multi-handle means any, all, or per-handle results.
- Dependencies: FE-SETTINGS-01 and typed settings versions.
- Acceptance: invalidation cannot overwrite typed text; two sessions produce a conflict with a recoverable diff; multi-handle fixtures reach the backend and render deterministic per-handle/effective results.
- Browser evidence: type unsaved content, trigger realtime invalidation, confirm draft persists; keyboard-edit long RTL/LTR handle lists without overflow.
- Rollout/rollback: optimistic concurrency is additive; rollback may disable realtime refresh while a form is dirty.
- Stop: backend lacks version compare or multi-handle semantics remain undefined.

#### FE-MEDIA-01 — Secure downloader and correct media semantics

- Resolves: AIR-026 and AIR-027.
- Owner surfaces: src/pages/Downloader.tsx, MediaThumbnails.tsx, VideoRenderDetailPanel.tsx, admin media API and CSP contract.
- Resolution:
  - Replace direct browser fetch of remote X/Twimg URLs with the bounded server acquisition and authorised signed URL from BR-MEDIA-02 and BR-MEDIA-04.
  - Use media_kind/MIME to render img, video, audio, or a file fallback correctly.
  - Refresh expired signed URLs deliberately; display expiry/download state; revoke object URLs.
  - Keep connect-src narrow; do not solve the bug with broad wildcard CSP.
- Dependencies: BR-MEDIA-02, BR-MEDIA-04 and SR-INPUT-01.
- Acceptance: downloader succeeds under deployed CSP; remote untrusted URL is never browser-fetched; video uses video controls/poster; expired URL refreshes; unauthorised object fails; object URLs have no leak across repeated selections.
- Browser evidence: desktop/mobile download and preview with image/video/missing/expired fixtures; inspect network destination and CSP console.
- Rollout/rollback: new admin-mediated path behind route flag; rollback disables download, not CSP.
- Stop: the only proposed solution broadens connect-src or exposes storage credentials.

#### FE-VIDEO-01 — Truthful video operations state

- Resolves: AIR-056, AIR-062 and AIR-063.
- Owner surfaces: src/pages/VideoRenders.tsx, useVideoRenderData.ts, VideoRenderDetailPanel.tsx, manual intake components and renderer heartbeat API.
- Resolution:
  - Poll active render/heartbeat rows at bounded intervals with visibility pause and backoff; stop on terminal state.
  - Distinguish healthy, stale, unavailable, blocked, queued, active, completed, failed, and unknown using server timestamps.
  - Scope retry pending state to render ID/action, not the whole table.
  - Reset feedback form/status when render selection changes and bind saves to current render/version.
- Dependencies: BR-RENDER-01, BR-RENDER-02 and BR-DASH-02.
- Acceptance: killing heartbeat transitions UI to stale within the contract; active render advances without full-page refresh; retry on row A does not disable B; feedback entered for A never appears/saves on B.
- Browser evidence: throttled/polling/stale/offline fixtures across desktop/mobile with no flicker or hidden action.
- Rollout/rollback: enable polling for active rows only, observe query volume, then heartbeat. Rollback increases interval or disables background polling while preserving stale truth.
- Stop: query volume exceeds budget or client clocks determine server health.

#### FE-SAFETY-01 — Destructive confirmations, idempotent actions, and X units

- Resolves: AIR-058 and AIR-059; preserves AIR-080 manual X confirmation.
- Owner surfaces: MonitoringActionDialog.tsx, DashboardHealth.tsx, Settings X controls, XAutomationSettings.tsx, XRateLimits.tsx, My X actions and admin mutation API.
- Resolution:
  - Classify mutations as safe, reversible, external side effect, or destructive.
  - Destructive/external actions require a labelled AlertDialog showing entity, effect, scope, and irreversibility; high-risk actions require typed or explicit phrase confirmation.
  - Generate a request ID and render the authoritative result; disable duplicate submit.
  - Rename X counters by real units and display reservation/posted/attempt/request distinctions from BR-X-01.
- Dependencies: BR-X-01, BR-X-02 and idempotent admin mutations.
- Acceptance: every audited destructive/external action has confirmation and request ID; double click/retry produces one mutation; X values match ledger SQL; cancel returns focus and performs no request.
- Browser evidence: keyboard/screen-reader dialog checks, mobile long-text wrapping, and network request count.
- Rollout/rollback: action family by family. Rollback disables action rather than removing confirmation/idempotency.
- Stop: an action cannot describe or constrain its backend effect.

#### FE-AUTH-01 — Explicit auth/role state and stable application shell

- Resolves: AIR-060 and AIR-061.
- Owner surfaces: src/contexts/AuthContext.tsx, AuthPage.tsx, AppLayout.tsx, VersionBanner.tsx, router guards and Supabase auth client.
- Resolution:
  - Use an explicit state machine: booting, unauthenticated, authenticated-role-loading, authorised, denied, degraded.
  - Treat unknown role as non-authorised; never render protected queries/actions before admin role proof.
  - Give getSession, role load, and sign-out bounded deadlines with one owner for timers/cancellation.
  - Keep one QueryClient/router/shell mount; VersionBanner uses the shared client and a bounded low-priority query rather than nested providers/remount timers.
  - Surface degraded auth separately from invalid credentials.
- Dependencies: SR-RLS-01 and SR-AUTH-01.
- Acceptance: viewer/unknown/error cannot issue admin reads; delayed role never flashes protected content; nested timeout count is one per operation; shell and queries do not remount when banner refreshes.
- Browser evidence: unauthenticated, viewer, admin, expired session, offline Supabase and slow role scenarios on desktop/mobile; record network calls and focus.
- Rollout/rollback: state machine behind guard tests, canary admin account, then all sessions. Rollback fails closed to login/degraded page.
- Stop: role cannot be proven server-side or any protected request fires before authorised.

#### FE-DASH-01 — Core-first dashboard, deadlines, and bounded rendering

- Resolves: AIR-030 and AIR-032.
- Owner surfaces: src/pages/Dashboard.tsx, src/api/dashboardData.ts, dashboard hooks/components and BR-DASH-01/BR-DASH-02 APIs.
- Resolution:
  - Render a small core workflow summary first from one bounded call.
  - Lazy-load diagnostics per visible tab/section.
  - Give each section its own skeleton, deadline, stale/provenance marker, error, and retry.
  - Virtualize or paginate bounded recent-item lists; avoid rendering raw thousands.
- Dependencies: BR-DASH-01 and BR-DASH-02.
- Acceptance: core route p75/p95 targets pass on throttled desktop/mobile; failure of X/OpenAI/observability section does not delay core; payload/query/render counts stay within budgets.
- Browser evidence: network waterfall, React profiler, slow/failed section fixtures, 320/390/768/1440 screenshots.
- Rollout/rollback: add v2 query under feature flag and compare; rollback core to old action while keeping independent errors.
- Stop: UI requires all diagnostics to decide basic system health.

#### FE-DASH-02 — On-demand HUD, unified status semantics, and first-viewport hierarchy

- Resolves: AIR-031, AIR-049 and AIR-050; also absorbs the July dashboard/HUD status debt.
- Owner surfaces: useDashboardProcessHudData.ts, MonitoringProcessHud.tsx, Dashboard.tsx, dashboard CSS/status helpers.
- Resolution:
  - Do not mount six realtime channels or heavy HUD queries while the panel is hidden.
  - Use one bounded summary/subscription or visibility-scoped invalidation and fetch detail only on open.
  - Establish one status vocabulary and token map for pending, active, blocked, skipped, complete, failed, stale, and unknown; pending must not look live/running.
  - Make the first viewport one workflow cockpit: current ingest/queue/delivery health, last meaningful activity, and primary exceptions. Move duplicate quotas, AI diagnostics, funnel, and deep queue detail to secondary tabs/drawers.
  - Show recency and provenance; manual enrichment must not be labelled AI.
- Dependencies: BR-DASH-01, BR-DASH-02 and FE-MON-01.
- Acceptance: hidden HUD produces zero subscriptions/detail calls; status fixtures render consistently across Dashboard/Monitoring/HUD; no key information repeats in the first viewport; operator task tests locate “what is stuck?” and “what posted last?” without opening multiple duplicate cards.
- Browser evidence: subscription/network counts closed/open, visual snapshots and keyboard navigation at all target widths.
- Rollout/rollback: status adapter first, new hierarchy behind flag, then retire duplicates. Rollback retains adapter and restores prior layout without hidden subscriptions.
- Stop: a status cannot be mapped without losing meaningful backend state.

#### FE-MON-01 — Targeted Monitoring invalidation and bounded detail

- Resolves: AIR-021, AIR-022 and AIR-034.
- Owner surfaces: useMonitoringData.ts, Monitoring.tsx, monitoringData.ts, MonitoringDetailDrawer/Timeline/Row/status components.
- Resolution:
  - Replace table-wide six-channel invalidation with a bounded event feed, one coalesced subscription, or entity-key invalidation.
  - Patch or invalidate the affected row/detail only and debounce burst refresh with a maximum staleness bound.
  - Fetch timeline/detail only while open and page long histories.
  - Reuse the status/source/provenance model from FE-DASH-02.
- Dependencies: BR-DASH-02 and FE-RACE-01.
- Acceptance: one row event does not refetch the entire page; burst test coalesces; closed detail does no timeline work; current selected row updates within the staleness SLO; long histories remain bounded.
- Browser evidence: Supabase/network trace and React render counts during event bursts; responsive table/drawer no overflow.
- Rollout/rollback: introduce query-key patching by event type; fall back to debounced page refresh only for unknown event shapes.
- Stop: targeted event lacks primary/entity key or staleness exceeds the operator contract.

#### FE-BUNDLE-01 — Measured route and asset weight reduction

- Resolves: AIR-028, AIR-037, AIR-038, AIR-039 and AIR-040.
- Owner surfaces: src/App.tsx, main.tsx, instrument.ts, UI component imports, toast stack, public/xot-logo.png and build configuration.
- Resolution:
  1. Establish per-route JS/CSS/image baselines and budgets.
  2. Key one-time chunk reload by build SHA and clear it after a successful import so a past failure does not suppress future recovery.
  3. Replace the 179 KB login logo with responsive modern assets while preserving brand quality and a suitable fallback.
  4. Keep a lightweight local error boundary; initialize Sentry/browser tracing/replay asynchronously according to environment, sampling, privacy, and route need.
  5. Route-scope heavy Radix/recharts/admin UI; remove demonstrably unused primitives.
  6. Select one toast system and migrate callers; remove the other only after parity.
- Dependencies: FE-QUALITY-01 and current production telemetry/privacy contract.
- Acceptance: bundle analyzer and browser transfer evidence show approved reductions; auth route excludes admin-only chunks; error capture still reaches staging Sentry; chunk-404 fixture reloads once per build and recovers on a later build; no toast call is lost.
- Rollout/rollback: one measured change at a time. Rollback individual optimization if error capture, UX, or performance regresses.
- Stop: optimization removes required error evidence, breaks deep links, or increases first interaction latency.

#### FE-A11Y-01 — Accessible names, labels, focus, language, direction, and contrast

- Resolves: AIR-043, AIR-044, AIR-045, AIR-046 and AIR-047.
- Owner surfaces: shared Select/Slider/Switch/form primitives, settings components, PromptEditor, Persian content/caption views, NotFound.tsx and theme tokens.
- Resolution:
  - Give every control a programmatic name via Label/htmlFor/id or aria-labelledby; sliders expose value text; switches expose state and description.
  - Repair orphan visual labels.
  - Give PromptEditor and all interactive custom controls visible focus using shared focus tokens.
  - Keep the English admin shell language accurate while marking Persian content with lang=fa and dir=rtl or dir=auto as appropriate; mixed IDs/URLs remain readable.
  - Bring NotFound and muted/status text to WCAG AA contrast; do not use color alone for status.
- Dependencies: FE-VISUAL-01 for token changes.
- Acceptance: zero serious/critical axe issues on required routes; Accessibility Tree names match visible labels; complete keyboard path has no trap; focus is visible; contrast measurements pass; Persian fixture reads/orders correctly.
- Browser evidence: authenticated desktop/mobile screenshots, keyboard recording/checklist, screen-reader spot check and axe report.
- Rollout/rollback: shared primitives first, then call sites. Rollback a token only with an AA-compliant alternative.
- Stop: a control cannot be named without changing its actual semantic contract; fix the primitive before page work.

#### FE-VISUAL-01 — Restore primary tokens and reduce decorative density

- Resolves: AIR-029, AIR-047, AIR-048, AIR-049 and AIR-050.
- Owner surfaces: src/index.css, tailwind.config.ts, AuthPage.tsx, shared Card/surface/button styles, Dashboard/Settings/Monitoring layouts.
- Resolution:
  - Define one supported primary action token/variant or replace bg-gradient-primary call sites with an existing semantic button variant; verify the live login regression.
  - Standardize compact operational spacing, surface borders, elevation and blur. Remove stacked glass blur/shadow/card-on-card decoration that adds no hierarchy.
  - Reduce glass top padding and reclaim first-screen vertical space.
  - Use density and progressive disclosure to make Dashboard/Settings scannable; preserve clear grouping and destructive emphasis.
- Dependencies: frontend-design guidance and FE-DASH-02.
- Acceptance: login primary button is visibly styled in the production build; no text overlap/overflow at target widths and 200% zoom; first viewport contains agreed primary workflow facts; screenshot review shows consistent spacing/elevation.
- Rollout/rollback: tokens and shared primitives first, then route slices with snapshots. Rollback specific route styles without reintroducing undefined classes.
- Stop: visual change obscures state, reduces contrast, or makes controls smaller than accessible targets.

#### FE-QUALITY-01 — Frontend strictness, contracts, and page decomposition

- Resolves: AIR-035, AIR-036 and AIR-067.
- Owner surfaces: tsconfig.strict.json/app, package scripts and lint-staged, API schemas/normalizers, Dashboard.tsx, Monitoring.tsx, Settings.tsx and tests.
- Resolution:
  1. Expand strict TypeScript in bounded directories until all src is included; remove unsafe any/suppressions through typed boundary parsers.
  2. Make pre-commit and CI run the actual project config; replace the no-op bare tsc invocation.
  3. Add runtime schemas for admin responses before asserting frontend types.
  4. After correctness tasks, extract page controllers/hooks/sections with characterization tests; keep route files compositional.
- Dependencies: SR-TYPE-01; correctness before pure moves.
- Acceptance: full src strict check passes; a deliberate type error in each major directory fails CI/pre-commit fixture; malformed API fixtures fail closed; page extractions preserve DOM/action/network golden traces.
- Rollout/rollback: strict include expands slice by slice; pure moves isolated. Rollback only the current slice and keep earlier strict coverage.
- Stop: suppressions increase, generated types are stale, or a refactor changes workflow behavior.

### Security, migrations, release trust, and supply chain

#### SR-REL-00 — Re-anchor deployed provenance and incident state

- Resolves the release-evidence precondition for all AIR items and AIR-054/AIR-055.
- Owner surfaces: scripts/check-release-state.sh, GitHub Actions, Vercel project/build logs, Supabase function list, migration list, cron/queue/settings/renderer queries and operations docs.
- Resolution: capture the exact repo SHA, deploy SHA, Vercel deployment ID/effective Node version, Edge Function versions/hashes, database schema fingerprint, migration state, secret names/ages only, active schedules, queue claims, provider ledgers, and renderer heartbeat before each release wave.
- Dependencies: read-only credentials/connectors for Vercel and Supabase.
- Acceptance: one signed release receipt links Git SHA → CI run → frontend deploy → each changed function version/hash → migration set; discrepancies are explicit, not inferred.
- Rollout/rollback: read-only. Any later rollback uses the recorded prior frontend/function versions and config, while schema uses forward-fix.
- Stop: deployed provenance cannot be tied to a reviewed SHA or any query would expose secret values.

#### SR-MIG-01 — Body-level migration reconciliation and forward-only baseline

- Resolves: AIR-009.
- Owner surfaces: supabase/migrations, remote supabase_migrations history, docs/operations/database-type-trust.md, release runbook and migration CI.
- Resolution:
  1. Confirm backup/PITR coverage and restore procedure, then export local/remote timestamp lists, canonical SQL hashes/bodies where available, remote-ledger status, and a schema-only production dump.
  2. Build a reviewed ledger for every timestamp containing local ID/path, SQL hash/body, remote status, live-schema equivalence, reviewer and disposition: exact-equivalent, renamed-equivalent, local-only unapplied, remote-only source-restoration required, superseded/forward-fixed, or unknown.
  3. Restore missing remote-applied source to the repo or document a semantically equivalent forward migration. Never infer equivalence from timestamp/name.
  4. Replay from an empty disposable project and diff its schema/policies/functions against the production schema snapshot.
  5. Use migration repair only for entries whose applied/reverted truth and SQL effect have been independently proven and approved. Record before/after history.
  6. Establish a new forward-only baseline and CI guard that rejects unexplained divergence.
- Dependencies: SR-REL-00; database backup/snapshot and owner review.
- Acceptance: PITR/restore readiness is confirmed; all 210 observed local/remote entries have a disposition; zero unknown/duplicate/ambiguous effect; clean replay succeeds; schema/policy/RPC diff is expected-empty or explicitly reviewed; generated types tie to that exact schema; migration parity is explained, not cosmetic.
- Rollout/rollback: perform analysis and disposable replay first; history repair is a separate approved operation with backup. Rollback restores the migration history table snapshot only if no schema change occurred; schema differences use forward-fix.
- Stop: any remote-only body/effect is unknown, replay loses objects/policies, or the proposed action includes broad db push.

#### SR-RLS-01 — Least-privilege admin data policies

- Resolves: AIR-007 and supports AIR-034.
- Owner surfaces: policies for video_renders, video_render_feedback, video_renderer_heartbeats, manual_video_intakes, their RPCs/views/storage paths, function grants and frontend admin reads.
- Resolution:
  - Inventory every role/action and classify anon, authenticated viewer, admin, service role, renderer/internal.
  - Replace broad authenticated SELECT/UPDATE policies with explicit admin or internal ownership predicates using a reviewed private security-definer helper where needed.
  - Scope policies with TO roles, wrap stable auth expressions for performance when appropriate, pin search_path, and revoke execute from PUBLIC/anon/broad authenticated.
  - Route frontend admin reads through authenticated admin actions or safe views; define explicit Realtime and storage policies.
  - Keep service-role/renderer boundaries separate; never use a browser service key.
- Dependencies: SR-MIG-01, FE-MEDIA-01, FE-AUTH-01 and a current role inventory.
- Acceptance: automated anon/viewer/admin/service/renderer and cross-user matrix for REST select/insert/update/delete, RPC, Realtime and Storage; viewer/cross-user cannot read named resources; admin workflows still function; role-specific EXPLAIN shows policy predicates do not cause pathological per-row init work.
- Rollout/rollback: add admin-mediated reads, validate, then tighten policies table by table. Rollback restores only a reviewed least-privilege compatibility policy; it never disables RLS or restores broad authenticated.
- Stop: UI still depends on direct broad table read, role helper search_path/grants are unsafe, or Realtime behavior is untested.

#### SR-AUTH-01 — Unified Edge Function auth, CORS, and self-test contracts

- Resolves: AIR-015 and AIR-016; regression-protects AIR-070 through AIR-074.
- Owner surfaces: supabase/config.toml, scripts/check-function-inventory.mjs, docs/operations/function-auth-matrix.md, shared internalAuth.ts, admin-actions/admin-retry/RSS/media/worker/x/cleanup functions and CORS helper.
- Resolution:
  1. Reconcile supabase/config.toml/function inventory with runtime code. For every function record verify_jwt, caller, credential/header, custom validation, role, service-client creation point, CORS, and negative fixture.
  2. For verify_jwt=false functions, require fail-closed shared auth before service-role work.
  3. For admin functions, validate JWT and admin role before constructing/using service client.
  4. Keep RSS HMAC/header auth and reject query tokens; make test_webhook use the exact validate-only contract from BR-WH-02.
  5. Use request-local allowlisted CORS from BR-ADM-01.
  6. Add CI/source checks that a new function cannot ship without inventory and negative-auth coverage.
- Dependencies: BR-WH-02 and BR-ADM-01.
- Acceptance: empty, malformed, forged, wrong-scheme, anon-key, expired JWT, viewer JWT, wrong HMAC, and disallowed-origin fixtures fail as intended; authorised internal/admin fixtures pass; service client is never reached on failure; ten currently unauthenticated functions continue returning 401.
- Rollout/rollback: update shared helpers and one function family at a time; keep exact previous secrets/header names during overlap, then retire. Rollback fails closed.
- Stop: a caller cannot migrate from query token or any function needs to weaken validation to remain callable.

#### SR-INPUT-01 — Bounded request schemas and safe telemetry

- Resolves: AIR-008, AIR-068 and AIR-069.
- Owner surfaces: webhooks-rssapp, media-processor, admin-actions payload parser, x-poster/manual intake URL parsing, shared logging/Sentry filters.
- Resolution:
  - Define runtime schemas and explicit limits for body bytes, JSON depth, item/media array counts, strings, URL length/scheme/host, IDs, captions, pagination and bounded concurrency.
  - Reject over-limit input before database/provider/storage work with stable 4xx codes.
  - Strip or hash credentials/query parameters; log host/path class, request ID, byte/count metadata and safe error code only.
  - Apply Sentry beforeSend/scrubbing to the same contract.
- Dependencies: BR-MEDIA-02 for network policy and SR-TYPE-01 for schemas.
- Acceptance: boundary/fuzz corpus, including IPv4/IPv6 private/link-local/metadata, DNS-change, every-redirect revalidation, oversized chunked streams, separate connect/read/total timeouts and MIME/magic mismatch, cannot cause forbidden access or unbounded memory/query/provider calls; logs and Sentry fixture contain no tokens, signatures, signed URL query, auth header, or raw oversized payload; legitimate maximum fixtures pass.
- Rollout/rollback: report observed sizes first, set limits above legitimate maxima, then enforce. Rollback adjusts a measured limit, never removes validation/redaction.
- Stop: production legitimate input distribution has not been measured or telemetry still records secrets.

#### SR-SECRET-01 — Resolve the digest_config credential candidate safely

- Resolves candidate: AIR-051. It must not be reported as confirmed until evidence proves it.
- Owner surfaces: public.settings key digest_config, digest-compiler/index.ts, Supabase secret manager/env contract, settings API/UI and logs.
- Resolution:
  1. Privately inspect JSON key names/types and credential-pattern booleans, grants, callers, logs, history, build artifacts and client bundles without emitting values into tool/chat/report output.
  2. If no sensitive field exists, close the candidate with evidence and add a schema test that forbids credential-like keys.
  3. If sensitive fields exist, map dependents; pause digest compilation if exposure risk warrants; create least-privilege secrets in the approved environment store; rotate atomically with dependent services; change compiler to read env; remove fields through an audited migration/action; scrub history/logs where feasible; verify old credentials fail and no UI/API returns them.
  4. Keep non-secret digest behavior/config in typed settings.
- Dependencies: secret-owner approval for rotation; SR-AUTH-01 and SR-REL-00.
- Acceptance: settings schema rejects token/key/secret/password fields; compiler runs with env secret; API/UI/DB key-only inspection has no credential fields; rotation and revocation receipts exist if needed.
- Rollout/rollback: dual-read env first with settings fallback only during a short controlled window, then rotate/remove fallback. Rollback pauses compiler; never restore raw credentials.
- Stop: evidence command would print a secret, owner cannot rotate a confirmed credential, or source of deployed compiler differs.

#### SR-TYPE-01 — Schema/type trust and strict frontend/Edge boundaries

- Resolves: AIR-009, AIR-035 and AIR-067.
- Owner surfaces: src/integrations/supabase/types.ts, generation/check scripts, tsconfig.strict.json/app, package lint-staged/Husky, deno.json tasks, Edge Function suppressions and API schemas.
- Resolution:
  - After SR-MIG-01, generate types from the authoritative linked schema and fail CI on unexplained diff.
  - Add a schema fingerprint/migration head to generated artifacts and release receipt.
  - Expand strict TypeScript to all src; add renderer checkJs/JSDoc or an equivalent explicit typecheck for its JS boundaries; make pre-commit invoke the actual strict project rather than bare tsc.
  - Inventory the 105 current Deno lint/type suppressions; remove auth/input/database-boundary suppressions first, prohibit baseline growth, replace boundary anys with unknown plus parsers and typed Supabase rows, and require reason/expiry for irreducible suppressions.
  - Pin and centralize Supabase imports so generated query types match runtime clients.
- Dependencies: SR-MIG-01 and SR-RUNTIME-01.
- Acceptance: generated types match linked schema; clean disposable replay generates identical types; full src strict and renderer boundary typecheck pass; all Edge Functions check/lint; lint-staged is proven against staged files; a deliberate invalid column/action/payload fails CI; suppression count falls to an approved documented residual and cannot grow.
- Rollout/rollback: expand strictness by directory/function family and keep each passing. Rollback only current include slice; never retain stale generated types.
- Stop: local and remote schema differ or type changes are being “fixed” with new casts/suppressions.

#### SR-DBPERF-01 — Evidence-led database advisor remediation

- Resolves: AIR-017.
- Owner surfaces: Supabase advisor output, migrations for FK indexes/duplicate indexes/RLS policies, dashboard/monitoring query plans and operations metrics.
- Resolution:
  1. Capture advisor JSON and actual pg_stat/user query evidence.
  2. For unindexed FKs, prove join/delete/update workload and add concurrent/appropriate indexes through reviewed migrations.
  3. For duplicate indexes, compare definitions, constraints and usage; remove one at a time only after observation.
  4. Rewrite RLS init-plan warnings using cached auth expressions/private helpers without changing authorisation.
  5. EXPLAIN ANALYZE representative dashboard, Monitoring, claim, cleanup and retention queries before/after for relevant roles; record migration lock duration, write amplification and storage change.
- Dependencies: SR-MIG-01 and BR-DASH-01.
- Acceptance: targeted security and performance advisor findings close; role-specific query p95/plan buffers improve or stay neutral; lock time and write amplification/storage remain within approved bounds; role matrix remains identical. An advisor-green result alone is insufficient.
- Rollout/rollback: one index/policy family per migration with before/after metrics. Dropped indexes are recreated by forward migration if regression.
- Stop: advisor suggestion lacks real workload proof or a policy rewrite changes access.

#### SR-RUNTIME-01 — Align Node, Vercel, renderer, Supabase clients, and locks

- Resolves: AIR-041 and AIR-042.
- Owner surfaces: package.json/package-lock.json, services/video-renderer package/lock/Dockerfile, CI setup-node, Vercel project/build settings, deno.lock and Edge Function imports.
- Resolution:
  1. In Phase 1, read the effective Vercel build runtime from a real deployment log and verify the exact Node patch required by Vite 8 and dependencies; freeze and record the current supported matrix without mixing an upgrade into correctness work.
  2. Select one supported maintained Node line and exact minimum/patch policy; align root/renderer engines, local version file, CI, Vercel, and Docker base digest. Use a transition CI matrix before cutover if changing major.
  3. Centralize Edge Supabase createClient imports through one pinned npm/import-map version; reconcile legacy esm.sh 2.39.7/2.49.1, root lock 2.105.4 and renderer lock 2.108.1 deliberately.
  4. Align the Supabase CLI version used locally/CI as well as client runtimes. Regenerate locks once, review API/behavior changes, and deploy one function family at a time.
  5. If a Node/client/CLI major or meaningful minor upgrade is required, execute that cutover as an isolated Phase 7 release after correctness/frontend waves and before cleanup re-enable, with an explicitly supported rollback runtime.
- Dependencies: current official Vercel/Supabase/Vite docs and SR-TYPE-01.
- Acceptance: local, CI, Vercel and renderer report the same approved Node contract; builds/tests pass there; no unreviewed duplicate Supabase runtime versions remain; auth/query behavior tests pass; deploy receipt records versions.
- Rollout/rollback: compatibility matrix, non-production build, renderer canary, frontend deploy, Edge families. Rollback to the prior pinned digest/version with locks, not floating ranges.
- Stop: effective Vercel runtime remains unknown, target version is unsupported, or client upgrade changes auth/query semantics.

#### SR-SUPPLY-01 — Full dependency, container, and remote-import coverage

- Resolves: AIR-052 and AIR-053; preserves AIR-078.
- Owner surfaces: root and renderer lockfiles, deno.lock/import map, Dockerfile/base image/APT packages, CI security workflow and exception ledger.
- Resolution:
  - Keep npm audit --omit=dev as the production gate for root and renderer.
  - Add full dev/build audit with severity/exploitability triage and time-bounded waivers.
  - Scan Deno/npm/esm remote imports from the lock, forbid unpinned new URLs, and verify checksums.
  - Scan pinned Docker base plus installed OS packages and generate an SBOM and license inventory for frontend build, Edge imports, and renderer image.
  - Pin CI actions by reviewed SHA where policy requires; enable dependency update PRs with tests rather than unattended deploy.
- Dependencies: SR-RUNTIME-01.
- Acceptance: zero unresolved/unwaived critical/high production findings; every dev/build advisory and license issue has exploitability/impact, owner and expiry; renderer image and Deno import inventories are complete; production-zero-advisory control remains green.
- Rollout/rollback: reporting first, then enforce thresholds; dependency updates isolated and reversible with locks/image digest.
- Stop: scanner coverage omits a runtime surface or remediation requires an unreviewed major upgrade.

#### SR-BUILD-01 — Reproducible production frontend build and environment contract

- Resolves blocked check: AIR-055.
- Owner surfaces: scripts/check-vite-env.mjs, Vite config, GitHub Actions, Vercel environment configuration, Sentry source-map upload and release docs.
- Resolution:
  - Define required public Vite variables by name/format and prohibit secrets.
  - Run a production build in CI/staging with masked real-shape values; inspect manifest, asset budgets, CSP compatibility, source maps and release SHA.
  - Verify Vercel has the variables in the correct environment without printing values.
  - Ensure source maps are private/uploaded appropriately and not publicly exposed if they reveal source.
- Dependencies: SR-RUNTIME-01, FE-BUNDLE-01 and QA-04 authenticated route capability.
- Acceptance: clean npm ci plus build succeeds reproducibly; missing/malformed variables fail before build; built assets contain no secret-patterns; unexpected public source maps fail the gate; authenticated desktop/mobile preview serves every route; asset/performance budgets pass; artifact SHA links to deployment.
- Rollout/rollback: CI artifact first, preview deploy, then production. Rollback to prior deployment; no schema involvement.
- Stop: secret-like values enter VITE namespace or build provenance is unknown.

#### SR-REL-01 — Staged security and release gate

- Resolves the final deployment/verification contract for all AIR items.
- Owner surfaces: release runbook, CI, Supabase deploy scripts, Vercel, renderer deployment, monitoring/alerts and rollback receipts.
- Resolution:
  1. Require G0–G7 receipts and a completed AIR matrix.
  2. Release in explicit waves: containment; migration trust; backward-compatible DB/RLS; functions/backend; renderer; frontend; isolated runtime/supply upgrades if required; shadow/canary; cleanup re-enable last.
  3. Use per-component SHAs/hashes and feature flags/kill switches.
  4. Confirm backup/PITR, owner and per-wave observation window; observe auth, error, queue growth, claim, provider, storage, latency and security metrics.
  5. Keep code/config rollback independent; use forward-fix for schema; preserve ambiguous provider and migration evidence.
- Dependencies: all selected implementation tasks and QA gates.
- Acceptance: all P1 rows close before production; candidates are confirmed/fixed or disproved; blocked checks execute; CI/staging/browser/security/load evidence passes; one approved canary shows correct rows/provider counts; post-deploy release-state matches intended versions; rollback drill succeeds without data loss or duplicate side effect; backward-compatible DB paths survive the observation window.
- Rollout/rollback: exactly the staged order above. Cleanup remains last to re-enable.
- Stop: any kill criterion from the source-of-truth contract or task is triggered.

### Cross-cutting QA and acceptance

#### QA-01 — Deterministic unit, contract, migration, and fault-injection suite

- Resolves the automated evidence requirement across AIR-001 through AIR-069.
- Owner surfaces: Vitest, Deno tests, renderer tests, migration replay harness, provider/storage/database fakes and CI.
- Required coverage:
  - Shared-path cleanup, storage failure, concurrent cleaners and stale tokens.
  - Webhook duplicate/crash/partial persistence and bounded payloads.
  - Job, Telegram, X and renderer claim races, lease renewal, crash-before/call/after-call ambiguity and rejected completion.
  - Reprocess preservation, thread revision/order, preview/publish CAS.
  - Settings conflicts, stale UI requests, auth states, deadlines and idempotent mutations.
  - RLS/grant role matrix and runtime-schema malformed input.
  - Dashboard aggregate parity above legacy limits.
- Acceptance: deterministic repeated runs; fault points cover every state transition; tests assert provider request count and durable row state, not only return values; clean migration replay included.
- Rollout/rollback: introduce focused suites with each task, then full CI; dispose local databases, fixtures, fake-provider state and temporary resources after receipts. Revert only a flaky test implementation after preserving the uncovered requirement as an explicit blocked gate.
- Stop: mocks bypass the transaction/policy/provider boundary being claimed.

#### QA-02 — Security validation without production exploitation

- Resolves: AIR-007, AIR-008, AIR-051 through AIR-054 and regression controls AIR-070 through AIR-079.
- Owner surfaces: local/disposable Supabase, staging Edge Functions, renderer test container, dependency scanners, header checks and redacted evidence.
- Required coverage:
  - anon/viewer/admin/service/renderer access matrix.
  - Function auth negative matrix and service-client reachability.
  - Safe SSRF corpus using controlled endpoints only; no production probing.
  - Request size/depth/count/fuzz tests and telemetry redaction.
  - Secrets key-name scan, tracked-file scan, dependency/import/image/SBOM scans.
  - Renderer bearer, loopback bind, non-root user, process/resource limits.
  - Live header read-only check.
- Acceptance: findings report separates confirmed, disproved, residual, waived and blocked; no secret values appear; no intrusive live action occurs.
- Rollout/rollback: controlled local fixtures first, then staging negatives, then read-only live controls. Tear down endpoints/accounts/containers and revoke temporary credentials; abort and delete evidence that accidentally contains secret values.
- Stop: test could reach private production resources, mutate live data, print credentials, or make provider side effects.

#### QA-03 — Performance, load, query, realtime, and bundle budgets

- Resolves: AIR-017, AIR-030 through AIR-040, AIR-048 through AIR-050.
- Owner surfaces: production-like seeded database, k6 or equivalent safe API load, EXPLAIN ANALYZE, browser HAR/coverage/profiler, renderer load fixtures and bundle analyzer.
- Initial budgets, to be confirmed against a saved baseline before enforcement:
  - Dashboard core response at most 100 KB and p95 at most 2 seconds.
  - Deferred diagnostic p95 at most 5 seconds and no impact on core availability.
  - Fixed bounded query count and no client transfer of 5k/10k raw rows.
  - Hidden HUD zero subscriptions/detail calls; one managed active-route channel target.
  - No unwaived route chunk over 200 KB gzip; auth initial transferred JS at least 25 percent below the captured pre-change baseline; full logo at most 40 KB.
  - Renderer combined concurrency never exceeds config; logs/temp/processes remain inside measured caps.
- Acceptance: baseline and after reports use the same hardware/data/network; budgets are stored in CI where deterministic and monitored in staging/live where not.
- Rollout/rollback: observe/report before enforcing; enable deterministic budgets one at a time. Roll back an invalid threshold to report-only with an owner/date, not by deleting the performance requirement; clean load data/processes after capture.
- Stop: optimization changes result truth, raises provider calls, or uses an unrealistically tiny dataset.

#### QA-04 — Authenticated browser, responsive, keyboard, and accessibility matrix

- Resolves blocked check: AIR-053 and all UI acceptance gaps.
- Required routes: /auth, /, /monitoring, /threads, /settings, /downloader, /video-renders, /my-x and not-found.
- Roles/states: signed out, viewer/denied, admin, expired/degraded auth; empty, loading, stale, error, partial, success; image/video; pending/active/skipped/blocked/complete/failed/unknown.
- Viewports: 1440×900, 1024×768, 768×1024, 390×844 and 320×568; include 200 percent zoom and reduced motion.
- Checks: screenshot, HAR/network/console, focus order/visibility, keyboard-only actions, dialog focus return, screen-reader spot check, axe serious/critical zero, contrast, overflow/overlap, RTL/Persian language, stale-response inversion, hidden subscription count and mutation request count.
- Acceptance: each route/state has a receipt tied to deployed SHA; mutating/external actions use stubs/dry-run until an explicit canary.
- Rollout/rollback: run against staging by role and route slices, then repeat the release candidate matrix. Remove fixture rows/accounts or return them to a documented baseline; revoke temporary sessions and close browser contexts. A failed route blocks release rather than weakening the check.
- Stop: no authenticated staging account, live-only destructive path, serious accessibility issue, or route cannot be tied to current deployment.

#### QA-05 — Control-regression, canary, rollback, and final AIR closure

- Resolves and preserves AIR-070 through AIR-080 and closes every task.
- Required control proofs:
  - verify_jwt=false functions still fail closed and unauthenticated negatives return 401.
  - Admin JWT/role is checked before service client.
  - RSS HMAC/header contract rejects query tokens.
  - temp-media remains service-only and privileged RPC grants remain revoked.
  - No tracked secrets, unsafe HTML injection, or unbounded shell construction.
  - Renderer remains bearer-protected, loopback-bound and non-root.
  - CSP/HSTS/frame/nosniff/referrer headers remain.
  - Root production dependency audit remains zero advisories.
  - Queue, X, renderer and Telegram sampled invariants remain healthy.
  - Route lazy loading, responsive Monitoring, overflow handling, reduced motion, noopener, manual X confirmation and Dashboard degraded states remain.
- Canary: one bounded receipt/media/job/render flow with provider stubs; then only if approved, one real low-risk workflow. Record durable IDs, exact provider request counts, object paths, claims, timestamps and UI screenshot.
- Rollback drill: disable flags/crons, stop new claims, restore prior frontend/functions/renderer, verify no stale claim or duplicate retry, and use forward schema fix if required.
- Acceptance: every AIR row has status accepted, disproved, preserved, explicitly deferred with owner/date, or blocked with exact evidence. “Tests pass” alone cannot close a row.
- Stop: any invariant/control regresses or a rollback would destroy evidence/data.

## Acceptance Criteria

### Data integrity and ingress

- Cleanup is re-enabled only after reference-aware selection and token finalization pass shadow and canary evidence.
- Fresh, active, mixed-age, or unknown-reference objects are never deletion candidates.
- Storage failure cannot clear logical references.
- Every accepted webhook item has a durable receipt and idempotent materialization.
- Reprocess failure preserves prior media and delivery history.

### Side effects and ownership

- Current token/generation is required for job, Telegram, X and renderer finalization.
- Concurrent triggers produce one provider request.
- Unknown post-call outcome is ambiguous and never automatically retried.
- X quota fails closed and reserves capacity atomically in consistent units.
- Thread preview/order/revision equals provider payload.
- Manual confirmation render/caption exactly equals the validated publish payload.

### Security

- Named operational tables are not readable by a non-admin authenticated user.
- All custom-auth functions reject empty/malformed/wrong credentials before privileged work.
- Remote fetch policy blocks private/metadata/rebinding/oversized/slow/mismatched content.
- No credentials live in digest settings, client bundles, logs, error telemetry, repository or public source maps.
- Existing header, storage, renderer, RPC-grant and production dependency controls remain green.

### Frontend and UI/UX

- Stale response cannot render under a newly selected entity.
- Monitoring threshold and Settings display the backend's effective revisioned scoring truth.
- Failed settings reads are non-writable; background refetch cannot erase a dirty draft.
- No admin spinner is unbounded; mutation timeout has unknown-outcome reconciliation.
- Dashboard core is usable independently of diagnostics and hidden HUD work is zero.
- Media works under production CSP with correct semantic element and authorised URL.
- Video operations become stale/active/terminal truthfully and per-row actions remain scoped.
- High-impact actions are idempotent and confirmed.
- Required routes pass responsive, overflow, keyboard, focus, language/direction, contrast and axe gates.

### Performance and maintainability

- Dashboard and Monitoring use bounded aggregates/pagination and targeted invalidation.
- Initial route, asset, Sentry/Replay, Radix and toast weight meet measured budgets without losing observability.
- Full frontend strict TypeScript and Edge Function checks pass against current generated schema types.
- Runtime and Supabase client versions are pinned/aligned and recorded in release evidence.
- Large-module moves preserve characterized behavior and create narrower testable ownership.

### Release truth

- Migration reconciliation has no unknown entry/effect and disposable replay matches the intended schema.
- Production build succeeds with verified non-secret public env and is tied to deploy SHA.
- Local, CI, staging, pushed, deployed, live-verified, blocked and not-checked states are reported separately.
- Every selected task passes its checkpoint; every AIR row has evidence and no orphan remains.

## Validation Plan

### Evidence tiers

| Tier | Meaning | Examples |
| --- | --- | --- |
| T0 | Static/local inspection only | code search, type/lint result, migration ledger draft |
| T1 | Deterministic local/disposable execution | unit/contract/fault tests, local DB replay, controlled SSRF fixtures |
| T2 | Production-like staging | deployed functions/renderer/frontend, seeded rows, authenticated browser, provider stubs |
| T3 | Live read-only | headers, deployed versions, policies/advisors, queue/claim/heartbeat/invariant queries |
| T4 | Operator-approved live canary | one bounded real workflow with exact IDs/request counts and rollback watch |

No task may claim a higher tier from lower-tier evidence. Tasks involving data deletion or external side effects require T2 before any T4 request.

### Pre-implementation anchor

- git status --short --branch
- git rev-parse HEAD
- git rev-parse origin/main
- npm run check:release-state
- CHECK_RELEASE_ADVISORS=1 npm run check:release-state
- Save Vercel deployment/build runtime and SHA through an authenticated read-only connector or CLI.
- Save Supabase function names, versions, hashes, verify_jwt values, cron rows, queue ages, renderer heartbeat, settings modes, storage summary, policy/grant inventory and migration list.
- Confirm no unrelated worker/branch is modifying the same files.

### Migration and database trust

- Produce and review the timestamp/body/effect equivalence ledger before any repair.
- Replay all repo migrations in a disposable local/project database.
- Diff disposable schema, policies, grants, functions, indexes and generated types against the approved production snapshot.
- Run Supabase database lint/advisors and targeted EXPLAIN (ANALYZE, BUFFERS) on dashboard, Monitoring, claim, cleanup and retention queries.
- Run automated role matrix for anon, viewer, admin, service and renderer/internal.
- Backfill in bounded batches with progress, invariant and resume checkpoints.
- Never place secret values, user payloads, or unredacted signed URLs in saved evidence.

### Required local/CI commands

Run from /Users/stevmq/Finalized XOT unless noted:

- npm ci
- npm run lint
- npm run check:function-inventory
- npm run lint:functions
- npm run check:functions
- npm run test:functions
- npm run check:strict
- npm test
- npm --prefix services/video-renderer ci
- npm --prefix services/video-renderer test
- npm audit --omit=dev
- npm --prefix services/video-renderer audit --omit=dev
- npm audit with the approved dev/build advisory policy
- npm run check:vite-env with masked staging public values
- npm run build with the same non-secret staging public values
- npm run check:release-state

After SR-TYPE-01, npm run check:strict must cover all src rather than the current partial include. The pre-commit fixture must prove the same strict project is invoked.

### Focused fault and security validation

- Run concurrent cleanup claims with mixed-age shared references and forced storage failures.
- Interrupt webhook, job, Telegram, X, reprocess and renderer flows at every transition and resume/reconcile.
- Run controlled remote-media fixtures for redirect, private/link-local/metadata targets, DNS changes, slow stream, oversized stream, compression, MIME mismatch and invalid certificate/port.
- Exercise max-minus-one, max, and max-plus-one body/item/media/string/page inputs.
- Inspect structured logs and captured Sentry events for credential/query/payload leakage.
- Run container as non-root, verify loopback exposure, bearer negatives, process tree kill, memory/pids/temp limits and health/shutdown.
- Scan root/renderer npm locks, Deno/esm/npm imports, Docker base/APT inventory, CI actions and generated SBOM.

### Browser validation

- Deploy the exact candidate SHA to staging with production CSP and authenticated admin/viewer accounts.
- Record every route/state/viewport in QA-04.
- Use network interception for out-of-order selection, deadline, late mutation completion, signed URL expiry and partial dashboard failures.
- Inspect computed primary button styles, initial asset/chunk coverage, hidden subscriptions, request counts, React rendering, console/CSP errors and Web Vitals.
- Perform keyboard, focus, screen-reader spot, axe, contrast, 200 percent zoom, RTL/Persian and reduced-motion checks.
- Provider-affecting buttons use stub/dry-run endpoints until an explicit operator canary.

### Staging and live validation

1. Deploy additive schema inactive and verify role/grant/type contracts.
2. Deploy function and renderer code with new paths disabled; verify hashes/versions.
3. Run backfill and shadow comparison; retain old reads.
4. Enable one bounded canary lane and observe for the task-specific window.
5. Deploy frontend and complete authenticated browser evidence.
6. If approved, run one real canary with exact provider request count and durable IDs.
7. Run release-state, advisor, invariant and header checks again.
8. Re-enable media cleanup last, first as dry-run, then one bounded claimed batch, then schedule.

### Completion audit

For every task and AIR row, the implementation owner must record:

- Requirement and authoritative proof.
- Current code/migration/config/deployed version.
- T0–T4 evidence achieved.
- Tests and why they exercise the actual boundary.
- Rollout state: local only, pushed, deployed staging, verified staging, deployed live, verified live.
- Rollback/kill-switch receipt.
- Remaining risk, owner and deadline.

Uncertain, indirect, stale, public-only, mocked-through-the-wrong-boundary, or missing evidence means not complete.

## Rollout And Rollback Matrix

| Wave | Changes | Enablement | Rollback |
| --- | --- | --- | --- |
| 0 Containment | Pause cleanup and record state | immediate with approval | restore exact schedules only after safe-cleaner canary |
| 1 Trust | Migration ledger, types, role/auth tests, runtime evidence | no behavior | restore history snapshot only for history-only error; schema forward-fix |
| 2 Additive foundations | media/inbox/claims/settings versions/aggregate RPCs | inactive or dual-write | disable flags; retain additive rows |
| 3 Backend canaries | bounded media, webhook, worker, Telegram, X, renderer | one lane/account/item | stop claims/functions/renderer; reconcile ambiguity |
| 4 Frontend truth | v2 APIs, auth/settings/races/media/video | route/action flags | old read route only if still safe; disable mutation otherwise |
| 5 Performance/design | aggregates, realtime, bundles, a11y/visual | route slices | revert one slice, preserve correctness APIs |
| 6 Modularity | pure module moves | one module per checkpoint | revert move without reverting safety behavior |
| 7 Production | functions/renderer/frontend then automation | gradual with observation | previous code/config; forward DB fix; cleanup remains off |

## Risks And Dependencies

| Risk/dependency | Impact | Mitigation/decision |
| --- | --- | --- |
| Active cleanup runs before containment | Irrecoverable referenced-media loss | BR-00 is the first operational action; query running invocations before pause |
| Migration bodies cannot be recovered | SQL deployment remains unsafe | Stop at SR-MIG-01; restore source/dump and obtain owner review |
| Tight RLS breaks current direct reads/realtime | Admin UI outage | Add admin-mediated endpoints first; role/browser matrix before policy switch |
| Provider APIs do not expose outcome lookup | Timeout can cause duplicate post | Use ambiguous state and manual account reconciliation; never blind retry |
| Existing shared paths contain conflicting content | Backfill ambiguity | Quarantine/classify; no automatic merge/delete |
| Provider media hosts are more dynamic than allowlist | Legitimate download failures | Report-only host inventory and reviewed provider resolver; fail closed |
| Real Vercel runtime/deploy SHA unavailable | Release provenance unproven | Treat production release as blocked until authenticated read-only evidence |
| No staging admin/viewer accounts | UI/security evidence blocked | Provision least-privilege fixtures before frontend acceptance |
| Production-like volume unavailable | Performance budgets weak | Sanitized snapshot or generated data matching distributions; label limitations |
| Renderer host capacity unknown | Caps may kill healthy renders | Measure representative workloads before enforcing limits |
| Sentry lazy loading loses early errors | Reduced observability | Lightweight local boundary and buffered async init; staging error receipt |
| Scoring compatibility has unexplained decisions | Wrong content delivery | Keep shadow/legacy authoritative and stop active cutover |
| Dirty user documentation overlaps runbooks | Accidental overwrite | Inspect and merge manually; never restore/reset |
| Large refactor overlaps correctness changes | Unreviewable rollback | Decomposition is Phase 7, pure moves, one checkpoint at a time |
| Dev advisory has no safe upgrade | CI blockage or rushed major upgrade | Exploitability-based time-bounded waiver with owner; production gate unchanged |
| Live canary would post publicly | External impact | Require explicit operator approval and show exact target/payload first |

## Complete Audit Issue Traceability Matrix

This is the no-orphan ledger. An implementation ledger should add status and evidence links without renumbering these IDs.

| AIR | Class | Audited issue | Owning task(s) | Phase | Required closure evidence |
| --- | --- | --- | --- | --- | --- |
| AIR-001 | P1 confirmed | Shared storage_path can be deleted from an old row while a fresh row still references it | BR-00, BR-MEDIA-01, BR-MEDIA-03 | 0,2 | cleanup freeze receipt; mixed-age claim test; canary deletion invariant |
| AIR-002 | P1 confirmed | Telegram external side effect is not atomically claimed/finalized | BR-TG-01, BR-JOB-01 | 3 | concurrent/crash request-count and durable-state evidence |
| AIR-003 | P1 confirmed | RSS webhook can acknowledge partial/failed persistence with HTTP 200 | BR-WH-01, BR-WH-02 | 2 | injected DB failure status; receipt/materialization invariant |
| AIR-004 | P1 confirmed | Reprocess is destructive and effectively one-shot | BR-REPROCESS-01, BR-REPROCESS-02 | 3 | repeat-run and forced-failure media-preservation evidence |
| AIR-005 | P1 confirmed | Worker lifecycle writes are unchecked/unfenced | BR-JOB-01, BR-JOB-02 | 3 | stale-token rejection and checked-write fault tests |
| AIR-006 | P1 confirmed | Manual video preview can differ from selected published render | BR-RENDER-04, FE-MANUAL-01 | 4 | two-render browser/payload/DB equality proof |
| AIR-007 | P1 security confirmed | Operational video/intake tables allow broad authenticated reads | SR-RLS-01, FE-AUTH-01 | 1 | anon/viewer/admin/service role matrix and authenticated browser |
| AIR-008 | P1 security confirmed | Remote media fetch is SSRF-capable and fully buffers input | BR-MEDIA-02, SR-INPUT-01, QA-02 | 2 | controlled SSRF/size/stream/MIME test report |
| AIR-009 | P1 release confirmed | Migration ledger diverges and generated type trust is weak | SR-MIG-01, SR-TYPE-01 | 1 | 210-entry disposition, clean replay/diff/type parity |
| AIR-010 | P2 confirmed | Thread post action has no real ordered consumer contract | BR-THREAD-01, BR-TG-01 | 3 | preview/revision/provider order and exactly-once proof |
| AIR-011 | P2 confirmed | X quota reads fail open and are non-atomic | BR-X-01 | 3 | last-slot concurrency and DB-failure zero-call proof |
| AIR-012 | P2 confirmed | Expired X claims cannot be safely reclaimed/reconciled | BR-X-02 | 3 | pre-call reclaim and post-call ambiguity evidence |
| AIR-013 | P2 confirmed | X claim occurs after expensive duplicate/media/render work | BR-X-02 | 3 | concurrent triggers perform preparation once |
| AIR-014 | P2 confirmed | Telegram fallback reports/classifies the wrong response | BR-TG-02 | 3 | second-response 429/500/network fixtures |
| AIR-015 | P2 confirmed | test_webhook auth/behavior differs from real webhook | BR-WH-02, SR-AUTH-01 | 2 | validate-only no-write/auth parity receipt |
| AIR-016 | P2 confirmed | admin-actions mutates module-global CORS headers | BR-ADM-01, SR-AUTH-01 | 3 | interleaved-origin concurrency test |
| AIR-017 | P2 confirmed | Live DB advisors show FK/index/RLS performance debt | SR-DBPERF-01, BR-DASH-01 | 6 | advisor diff plus before/after query plans/metrics |
| AIR-018 | P2 confirmed | Renderer leases lack renewal/fenced completion | BR-RENDER-01 | 4 | long-render renewal and stale-owner rejection |
| AIR-019 | P2 confirmed | Configured renderer concurrency is not globally enforced | BR-RENDER-02 | 4 | combined HTTP/poller capacity test and shutdown receipt |
| AIR-020 | P2 confirmed | Renderer subprocesses have no bounded timeout/output/process cleanup | BR-RENDER-03 | 4 | hung-process kill/log/temp/container limit proof |
| AIR-021 | P2 confirmed | Threads can render a stale response under a new selection | FE-RACE-01 | 5 | A→B out-of-order browser/HAR test |
| AIR-022 | P2 confirmed | Monitoring can show stale timeline/detail for a new selection | FE-RACE-01, FE-MON-01 | 5,6 | identity-keyed inversion test |
| AIR-023 | P2 confirmed | Monitoring threshold source drifts from backend scoring truth | FE-SCORE-01 | 5 | settings/worker/Monitoring revision equality |
| AIR-024 | P2 confirmed | Settings exposes conflicting scoring control planes | FE-SCORE-01 | 5 | one writer; legacy parity/cutover evidence |
| AIR-025 | P2 confirmed | Settings read failure becomes writable defaults/permanent spinner | FE-SETTINGS-01 | 5 | 401/500/timeout/malformed fail-closed browser tests |
| AIR-026 | P2 confirmed | Downloader direct fetch conflicts with deployed CSP | FE-MEDIA-01, BR-MEDIA-02, BR-MEDIA-04 | 5 | production-CSP network and successful download proof |
| AIR-027 | P2 confirmed | Signed media URL policy is inconsistent and video can render as img | BR-MEDIA-04, FE-MEDIA-01 | 2,5 | role/expiry/MIME semantic-render browser proof |
| AIR-028 | P2/P3 confirmed | Chunk reload flag can become stale across deployments | FE-BUNDLE-01 | 7 | two-build chunk-404 recovery fixture |
| AIR-029 | P2 live confirmed | bg-gradient-primary is undefined, breaking primary styling | FE-VISUAL-01 | 7 | production computed-style screenshot |
| AIR-030 | P2 confirmed | Dashboard performs large fan-out/5k–10k hydration and duplicate scans | BR-DASH-01, FE-DASH-01, QA-03 | 6 | bounded payload/query count and p95 evidence |
| AIR-031 | P2 confirmed | Hidden HUD starts six realtime subscriptions/work before useful paint | FE-DASH-02, FE-MON-01 | 6 | zero hidden subscriptions; bounded active channel |
| AIR-032 | P2 confirmed | Admin action calls have no explicit deadlines/outcome semantics | FE-API-01, BR-DASH-02 | 5 | blackhole/late-mutation reconciliation tests |
| AIR-033 | P2 confirmed | ContentFilter author control loads all handles/client-counts | FE-SETTINGS-02, FE-MON-01 | 5,6 | bounded aggregate/search query and multi-handle proof |
| AIR-034 | P2 confirmed | Realtime invalidation is broad and query-amplifying | FE-MON-01, SR-RLS-01 | 6 | event-burst targeted invalidation/query trace |
| AIR-035 | P2 confirmed | Strict TypeScript is partial and staged bare tsc can be ineffective | FE-QUALITY-01, SR-TYPE-01 | 7 | all-src strict plus deliberate-error CI fixture |
| AIR-036 | P3 confirmed | Large worker/admin/X/renderer/dashboard/enrich/dedupe/page hotspots | BR-MOD-01, BR-MOD-02, FE-QUALITY-01 | 7 | characterization parity and narrow-module ownership |
| AIR-037 | P3 confirmed | Login/logo assets are unnecessarily heavy | FE-BUNDLE-01 | 7 | transfer-size budget and visual parity |
| AIR-038 | P3 confirmed | Sentry/Replay adds avoidable initial bundle weight | FE-BUNDLE-01 | 7 | manifest/coverage plus staging error receipt |
| AIR-039 | P3 confirmed | Radix chunk is eagerly/coarsely loaded | FE-BUNDLE-01 | 7 | /auth coverage excludes route-only Radix |
| AIR-040 | P3 confirmed | Two toast systems are mounted/maintained | FE-BUNDLE-01 | 7 | one toast stack and call-site parity |
| AIR-041 | P3/current verification | Node/Vercel/CI/renderer effective runtime contract may differ | SR-RUNTIME-01 | 1,7 | real Vercel log, frozen matrix and isolated aligned-version receipt |
| AIR-042 | P3 confirmed | Supabase clients/imports span legacy and different resolved versions | SR-RUNTIME-01, SR-TYPE-01 | 1 | one reviewed pinned contract and behavior tests |
| AIR-043 | P3 accessibility confirmed | Select/Slider/Switch controls lack accessible names | FE-A11Y-01 | 7 | Accessibility Tree and axe/keyboard report |
| AIR-044 | P3 accessibility confirmed | Visual form labels are not always associated via htmlFor/id | FE-A11Y-01 | 7 | label-control association audit |
| AIR-045 | P3 accessibility confirmed | PromptEditor/custom controls lack visible focus | FE-A11Y-01 | 7 | keyboard focus screenshots/checklist |
| AIR-046 | P3 accessibility confirmed | Persian text lacks consistent lang/direction semantics | FE-A11Y-01 | 7 | screen-reader/RTL mixed-content proof |
| AIR-047 | P3 visual/accessibility confirmed | NotFound/muted text contrast is insufficient/inconsistent | FE-A11Y-01, FE-VISUAL-01 | 7 | measured WCAG contrast and screenshots |
| AIR-048 | P3 visual confirmed | glass-card utility imposes excess/double padding | FE-VISUAL-01 | 7 | responsive/zoom no-overflow snapshots |
| AIR-049 | P3 visual/performance confirmed | Repeated blur/shadow/glass layers add paint and visual weight | FE-VISUAL-01, FE-DASH-02, QA-03 | 6,7 | layer/paint comparison and hierarchy review |
| AIR-050 | P3 UX confirmed | Dashboard repeats information and weakens first-viewport hierarchy | FE-DASH-02, FE-VISUAL-01 | 6,7 | task-based operator review and viewport snapshots |
| AIR-051 | Security candidate | digest_config may contain raw credentials | SR-SECRET-01 | 1 | redacted key/type evidence; close/disprove or rotation receipt |
| AIR-052 | Coverage candidate | Docker/APT/Deno/remote-import supply chain lacks full scan proof | SR-SUPPLY-01, QA-02 | 7 | SBOM and complete scan/waiver ledger |
| AIR-053 | Blocked validation | Authenticated route behavior/accessibility was not browser-verified | QA-04 | 8 | role/state/route/viewport receipt tied to SHA |
| AIR-054 | Intentional safety gap | Live SSRF exploitation was not and must not be run | BR-MEDIA-02, QA-02 | 2,8 | controlled isolated corpus; boundary documented |
| AIR-055 | Blocked validation | Local production build lacked required Vite environment | SR-BUILD-01 | 7,8 | masked production-like build and deploy artifact |
| AIR-056 | P2 supplemental confirmed | Video operations can appear healthy/stable without polling freshness | FE-VIDEO-01 | 4,5 | fresh→stale and active→terminal browser recordings |
| AIR-057 | P2 supplemental confirmed | Settings invalidation can overwrite dirty drafts | FE-SETTINGS-02 | 5 | dirty draft/refetch/concurrent conflict proof |
| AIR-058 | P2 supplemental confirmed | Some destructive/external actions lack confirmation/idempotent UX | FE-SAFETY-01, FE-API-01 | 5 | cancel zero-call and confirm one-operation proof |
| AIR-059 | P2 supplemental confirmed | X attempts/usage are compared with post-budget units | BR-X-01, FE-SAFETY-01 | 3,5 | UI label-to-ledger SQL reconciliation |
| AIR-060 | P2 supplemental mixed | Auth getSession/role/timer failures need one state machine; preserve role-null fail-closed behavior | FE-AUTH-01, SR-RLS-01 | 1,5 | no protected flash/read across auth fault matrix |
| AIR-061 | P2 supplemental confirmed | VersionBanner and route layout create redundant timers/remount work | FE-AUTH-01 | 5 | mount/request count across navigation |
| AIR-062 | P2 supplemental confirmed | Video retry pending state is global across rows | FE-VIDEO-01 | 5 | concurrent row-action scope proof |
| AIR-063 | P2 supplemental confirmed | Video feedback draft is not reset/scoped to selected render | FE-VIDEO-01 | 5 | A→B feedback isolation proof |
| AIR-064 | P2 supplemental confirmed | Batch size, fan-out and lane capacity are conflated; writes can be unchecked | BR-JOB-02, BR-MOD-01 | 3,7 | concurrency/queue/checked-write metrics |
| AIR-065 | P2 supplemental confirmed | Media cleanup is invoked by both direct and nested schedules | BR-00, BR-MEDIA-03 | 0,2 | one canonical schedule after safe canary |
| AIR-066 | P2 supplemental/candidate | Digest/thread multi-stage work can partially duplicate after interruption | BR-THREAD-01, BR-DIGEST-01 | 3 | transition fault injection and one-output/job proof |
| AIR-067 | P2/P3 supplemental confirmed | Deno/frontend strictness has many any/suppression/boundary gaps | SR-TYPE-01, FE-QUALITY-01 | 1,7 | suppression ledger/reduction and strict checks |
| AIR-068 | P2 security confirmed | Logs can expose signed/media URL query parameters | SR-INPUT-01, BR-MEDIA-02 | 2 | log/Sentry secret-pattern negative scan |
| AIR-069 | P2 security/perf confirmed | Webhook item/media arrays and related queries are insufficiently bounded | SR-INPUT-01, BR-WH-01, BR-DASH-01 | 2,6 | max-boundary and zero-unbounded-work tests |
| AIR-070 | Preserve control | verify_jwt=false functions use fail-closed custom auth | SR-AUTH-01, QA-05 | 1,8 | executable auth inventory/negative matrix |
| AIR-071 | Preserve control | Ten sampled functions reject unauthenticated requests with 401 | SR-AUTH-01, QA-05 | 1,8 | live/staging negative request receipt |
| AIR-072 | Preserve control | Admin JWT and role are checked before service client work | SR-AUTH-01, FE-AUTH-01, QA-05 | 1,8 | reachability spy and role matrix |
| AIR-073 | Preserve control | RSS HMAC/header auth rejects query-token fallback | SR-AUTH-01, BR-WH-02, QA-05 | 1,2,8 | signed positive and query-token negative |
| AIR-074 | Preserve control | temp-media is service-only and privileged RPC grants are revoked | SR-RLS-01, QA-05 | 1,8 | grants/storage role matrix |
| AIR-075 | Preserve control | No tracked secrets, obvious XSS, or unsafe shell construction found | SR-INPUT-01, SR-SUPPLY-01, QA-05 | 7,8 | secret/sink/process scan and regression tests |
| AIR-076 | Preserve control | Renderer uses bearer auth, loopback binding and non-root container | BR-RENDER-02, BR-RENDER-03, QA-05 | 4,8 | container/network/auth runtime receipt |
| AIR-077 | Preserve control | CSP/HSTS/frame/nosniff/referrer headers are live | FE-MEDIA-01, SR-REL-01, QA-05 | 5,8 | post-deploy header/CSP route checks |
| AIR-078 | Preserve control | Root production npm audit has zero advisories | SR-SUPPLY-01, QA-05 | 7,8 | root and renderer production audit receipts |
| AIR-079 | Preserve control | Sampled queue/X/render/Telegram invariants were healthy | BR-JOB-01, BR-TG-01, BR-X-02, BR-RENDER-01, QA-05 | 3,4,8 | pre/post invariant comparison |
| AIR-080 | Preserve control | Lazy routes, responsive Monitoring, overflow, reduced motion, noopener, manual X confirmation, Dashboard degraded states work | FE-MANUAL-01, FE-DASH-01, FE-DASH-02, FE-MON-01, FE-A11Y-01, FE-BUNDLE-01, QA-05 | 5-8 | route/browser regression matrix |

### Traceability audit rules

- AIR rows may share tasks, but no row may be closed merely because a shared task passed a narrower fixture.
- Candidate AIR-051 is closed only as confirmed-remediated or disproved-with-evidence.
- Blocked AIR-053 and AIR-055 are release blockers, not accepted risk by default.
- AIR-054 is satisfied by safe controlled validation and an explicit no-live-exploit receipt.
- Preserve rows AIR-070 through AIR-080 must have positive regression evidence after the relevant remediation, not only before it.

## Implementation Orchestrator Handoff

Implementation must not begin until the user explicitly approves it. When approved, use one parent-owned goal for the whole program and checkpoint phase slices; do not create disconnected goals that allow a partial phase to masquerade as completion.

### Recommended implementation goal

Goal: Implement the comprehensive XOT audit remediation plan at docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md in /Users/stevmq/Finalized XOT.

Done when:

- The parent re-anchors repo/path, main/HEAD, origin parity, dirty state, live/deploy/function/schema versions, credentials/connector limits and current incidents.
- One implementation ledger exists at docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl.
- Every ledger record includes phase/task/AIR IDs, source-of-truth contract, files, worker, risk tier, target evidence, tests, deployment state, rollback/kill receipt and status.
- G0 through G7 pass for every selected slice.
- Every AIR row is accepted, disproved, preserved, or explicitly deferred/blocked with owner/evidence/date.
- Every write-scoped worker return is treated as a claim and parent-reviewed against source/diff/tests/target evidence.
- Every HIGH slice has adversarial/fault verification and engineering acceptance.
- Authenticated browser evidence exists for every affected route/state/viewport.
- The final report separates validated locally, CI green, pushed, staging deployed/verified, live deployed/verified, blocked and not checked.
- No runtime resource, server, port, browser context, test row, feature flag, claim, cron override or temporary credential is left without a cleanup/ownership receipt.

Anti-cheat:

- No fake success endpoint, fake provider receipt, synthetic row presented as real, or force-post.
- No timestamp-only migration repair.
- No test that bypasses the transaction/policy/network boundary it claims to validate.
- No retry of ambiguous provider work.
- No loosening RLS, CSP, auth or input bounds to make a smoke pass.
- No closing the goal because one phase is green while an in-scope AIR row remains unresolved.

### Execution loop

1. Anchor: use focused Hindsight routing context, then recheck current source/live state.
2. Select: choose the smallest coherent task slice whose dependencies pass; list AIR IDs and evidence tier.
3. Contract: restate owner, boundary, displaced path, cutover, kill criteria and forbidden moves.
4. Dispatch: use distinct workers only for non-overlapping scopes and assign required skill/tool routes.
5. Implement: patch scoped files and preserve unrelated dirty work.
6. Integrate: parent reviews diff, contracts, generated artifacts and migration effects.
7. Validate: focused tests first, then full gates, target-state evidence and adversarial faults.
8. Checkpoint: run checkpoint-quality-loop and engineering-acceptance-review; update ledger.
9. Release: follow the wave/flag/canary order; observe; exercise rollback where required.
10. Repeat: move to the next dependency-ready slice only after acceptance.
11. Close: run the AIR completion audit and update the parent goal only when no required item remains.

### Required checkpoint boundaries

| Checkpoint | Risk | Required proof |
| --- | --- | --- |
| BR-00 containment | HIGH operational | current cron/running cleanup evidence, pause receipt, dry-run inventory |
| SR-MIG-01 | HIGH data/release | body ledger, backup, disposable replay, schema diff, owner approval |
| SR-RLS-01 and SR-AUTH-01 | HIGH security | role/auth/grant matrix and authenticated staging |
| Media/webhook cutover | HIGH data/security | fault/SSRF/receipt/backfill/shadow/canary |
| Job/Telegram/X claims | HIGH external side effect | concurrency and crash ambiguity with exact provider counts |
| Renderer ownership/resources | HIGH availability/data | long/hung/concurrent/shutdown/container evidence |
| Frontend truth/safety | STANDARD/HIGH for publish | browser network/snapshot/idempotency evidence |
| Dashboard/performance | STANDARD | parity, query plans, payload/p95/subscription/bundle budgets |
| A11y/visual/modularity | STANDARD | browser/axe/keyboard/snapshots and characterization parity |
| Production release | HIGH | complete release receipt, live invariants, canary and rollback |

### Recommended first implementation slice

The first slice should contain no schema mutation and no provider side effect:

1. Re-run SR-REL-00 and BR-00 read-only inventory.
2. Obtain explicit approval and pause both cleanup entry points.
3. Save the migration equivalence ledger skeleton and restore any missing migration source without changing remote history.
4. Add deterministic characterization/fault tests for current media reuse/cleanup behavior.
5. Add an operator/runbook notice that cleanup is intentionally disabled.
6. Checkpoint and stop for review.

The second slice is SR-MIG-01 only. The third slice is additive BR-MEDIA-01 plus SR-RLS-01 policies/types, inactive. Do not combine the safe-cleaner cutover with large worker/refactor work.

### Dependency order and parallelism

- BR-00 precedes every implementation that assumes cleanup safety.
- SR-MIG-01 precedes all database changes.
- SR-RLS-01 admin endpoints precede policy tightening.
- BR-MEDIA-01 precedes safe acquisition/cleanup and media UI.
- BR-JOB-01 precedes Telegram/X/reprocess/renderer ownership.
- BR-X-01, BR-X-02 and BR-RENDER-04 precede FE-MANUAL-01 publish enablement.
- BR-DASH-01 and BR-DASH-02 precede Dashboard/Monitoring performance cutover.
- FE-API-01 requires mutation idempotency/reconciliation support.
- FE/BR modularity and visual/bundle cleanup follow correctness stabilization.
- QA-05 and SR-REL-01 are last; media cleanup is the last schedule re-enabled.

Safe parallel lanes after migration trust:

- Media registry/acquisition work and frontend auth/settings work may proceed if files/migrations do not overlap.
- Renderer subprocess work may proceed independently from dashboard aggregate work.
- Accessibility primitive inventory may proceed read-only while correctness work runs; call-site edits wait for stable components.
- Never run overlapping migration, admin-actions dispatcher, worker entrypoint or shared API-contract edits in separate workers.

### Skill and tool routing

| Work | Required route |
| --- | --- |
| Whole execution | implementation-orchestrator |
| Every meaningful slice/phase boundary | checkpoint-quality-loop |
| Code/data/security acceptance | engineering-acceptance-review |
| UI/UX/a11y/visual work | frontend-design |
| Security scan/threat validation | codex-security security-scan, finding validation and attack-path analysis as applicable |
| Current React/Vite/Supabase/Vercel/Deno APIs | Context7 official documentation, then official source/docs |
| Symbol/call/impact analysis | CodeGraph before broad reads; ast-grep for structured repeated changes |
| Type/module diagnostics | LSP where useful |
| Authenticated responsive UI | browser operator with SHA-tied screenshots/HAR |
| Unclear failures | root-cause investigation before adding fixes |
| Interrupted prior evidence | coding-agent-sessions or exact ledger/session evidence, never memory alone |

If a required skill/tool is unavailable, record the reduced confidence and next-best direct evidence. Do not silently skip the gate.

### Likely files and surfaces

Database and operations:

- supabase/migrations/*
- src/integrations/supabase/types.ts
- docs/operations/database-type-trust.md
- docs/operations/function-auth-matrix.md
- docs/operations/release-runbook.md
- scripts/check-release-state.sh
- scripts/check-function-inventory.mjs

Edge/backend:

- supabase/functions/media-processor/index.ts
- supabase/functions/media-cleanup/index.ts
- supabase/functions/db-cleanup/index.ts
- supabase/functions/webhooks-rssapp/index.ts
- supabase/functions/worker/index.ts
- supabase/functions/worker/jobLifecycle.ts
- supabase/functions/worker/telegramDelivery.ts
- supabase/functions/x-poster/index.ts
- supabase/functions/_shared/xPostDeliveryClaim.ts
- supabase/functions/digest-compiler/index.ts
- supabase/functions/admin-actions/index.ts
- supabase/functions/admin-actions/dashboardSummaries.ts
- supabase/functions/admin-actions/monitoringReads.ts
- supabase/functions/admin-actions/manualVideoIntakeActions.ts
- supabase/functions/admin-retry/index.ts

Renderer:

- services/video-renderer/src/renderer.js
- services/video-renderer/src/server.js
- services/video-renderer/src/config.js
- services/video-renderer/src/ffmpeg.js
- services/video-renderer/src/preflight.js
- services/video-renderer/src/preview.js
- services/video-renderer/Dockerfile
- services/video-renderer/docker-compose.yml

Frontend:

- src/App.tsx
- src/main.tsx
- src/instrument.ts
- src/contexts/AuthContext.tsx
- src/components/layout/AppLayout.tsx
- src/components/layout/VersionBanner.tsx
- src/pages/Dashboard.tsx
- src/pages/Monitoring.tsx
- src/pages/Threads.tsx
- src/pages/Settings.tsx
- src/pages/Downloader.tsx
- src/pages/VideoRenders.tsx
- src/components/video/ManualVideoIntakePanel.tsx
- src/components/video/VideoRenderDetailPanel.tsx
- src/components/monitoring/*
- src/components/settings/*
- src/hooks/useDashboardProcessHudData.ts
- src/hooks/useMonitoringData.ts
- src/hooks/useVideoRenderData.ts
- src/api/adminActions.ts
- src/api/adminRetry.ts
- src/index.css
- tailwind.config.ts
- vite.config.ts
- vercel.json

Toolchain:

- package.json and package-lock.json
- tsconfig.app.json and tsconfig.strict.json
- deno.json and deno.lock
- .github/workflows/ci.yml
- services/video-renderer/package.json and package-lock.json

### Allowed changes

- Additive migrations, policies, RPCs, types, ledgers, bounded helpers, tests, feature flags, monitoring, docs and scoped UI required by named tasks.
- Forward-only data repair/backfill with dry-run, checkpoints and rollback/kill controls.
- Narrow module extraction after behavior characterization.
- Dependency/runtime updates that are isolated, documented and proven.

### Disallowed changes

- Reset/revert/overwrite unrelated dirty work.
- Broad database push or guessed history repair.
- Unbounded cleanup/backfill/download.
- Public/provider mutation without explicit canary approval.
- Browser service role or relaxed broad RLS/CSP/CORS.
- Automatic retry of unknown side-effect outcomes.
- Large redesign, framework migration or marketing surface.
- Styling/refactor mixed into a safety cutover.

### Explicit blockers and assumptions

- Live cleanup pause and any production canary require explicit user approval at execution time.
- Vercel CLI/connector provenance was unavailable during this planning run; a real deploy/build record is required.
- Authenticated route verification requires staging admin and viewer accounts.
- Migration implementation is blocked until all divergent entries have body/effect dispositions.
- digest_config remains a candidate until redacted key/type evidence is collected.
- A real X or Telegram canary is optional only with explicit approval; provider-stub evidence is mandatory regardless.
- Initial numeric performance budgets are planning targets and must be confirmed against a saved, comparable baseline.
- Existing user-owned dirty docs may overlap runbook updates and require careful manual merge.

### Stop conditions

- Repo/branch/production project no longer matches the anchor.
- Migration, policy or generated-type truth cannot be proven.
- Any data-loss, duplicate-side-effect, unauthorised-read or stale-owner symptom appears.
- Provider outcome is unknown and code attempts an automatic retry.
- Authenticated browser or production build evidence cannot be tied to candidate SHA.
- Tests pass only through mocks that skip the relevant boundary.
- A task requires expanding product scope or weakening an existing control.

### Do not claim complete until

- Every phase selected by this plan has a checkpoint and engineering acceptance receipt.
- All HIGH changes have adversarial fault evidence.
- Every AIR row has current target-state evidence and no orphan.
- Candidate and blocked rows are genuinely resolved, disproved or explicitly blocked; none are silently reclassified.
- Controls AIR-070 through AIR-080 pass after remediation.
- Cleanup has either passed safe canary and been deliberately re-enabled, or remains intentionally disabled with owner/status; it cannot be forgotten.
- The exact production versions, migrations, crons, queues, renderer and headers are re-read after deployment.
- Final status distinguishes local, CI, staging, pushed, deployed, live and blocked.

## Orchestration Closeout

- Workers actually used:
  - Backend/data/runtime planning worker.
  - Frontend/UI/UX/performance/accessibility planning worker using frontend-design.
  - Security/migrations/release/QA planning lane, followed by a concise independent security review after the first closeout was interrupted.
- Backend results accepted:
  - Physical-object registry and token-claimed cleanup rather than path-level patches.
  - Durable webhook inbox and truthful acknowledgment.
  - Token-fenced job/Telegram/X/renderer ownership with explicit ambiguity.
  - Non-destructive reprocess, real thread consumer, bounded dashboard aggregates and post-correctness decomposition.
- Frontend results accepted:
  - Versioned manual preview/publish compare-and-set.
  - Selection-keyed race prevention and mutation outcome_unknown semantics.
  - One revisioned scoring truth, fail-closed settings and dirty-draft conflict handling.
  - Core-first Dashboard, on-demand HUD/realtime, bounded media, truthful video state.
  - Measured bundle/assets plus complete responsive/accessibility/visual-density validation.
- Security results accepted and incorporated:
  - Migration SQL-hash/body/live-schema equivalence plus PITR before DB work.
  - Cross-user REST/RPC/Realtime/Storage role matrices and never disabling RLS for rollback.
  - IPv4/IPv6, DNS-change and every-redirect SSRF validation with bounded deadlines/concurrency.
  - Conditional private digest credential investigation and atomic rotation only if confirmed.
  - Full frontend/Edge/renderer type boundaries, supply/SBOM/license coverage and authenticated production-build gates.
  - Isolated runtime/dependency release, cleanup re-enabled last, P1/candidate/blocked/control closure gates.
  - The independent security reviewer rechecked the incorporated amendments and returned “implementation-ready” with no remaining material planning gap; live credentials, authenticated staging, PITR confirmation and production evidence remain execution prerequisites.
- Worker results rejected or constrained:
  - No local-only guard as the final media ownership design.
  - No broad connect-src relaxation for Downloader.
  - No timestamp-only migration repair or broad database push.
  - No claim of exactly-once external delivery; ambiguous outcomes remain a first-class state.
  - No new delivery/fetch service until evidence shows the current owned boundaries are insufficient.
  - No runtime/dependency upgrade mixed with integrity/RLS/queue cutovers.
  - No live SSRF exploit or unapproved real provider smoke.
- Parent verification:
  - Rechecked main/origin SHA and preserved the pre-existing dirty worktree.
  - Re-ran npm run check:release-state successfully on 2026-07-14.
  - Verified live headers, function/cron inventory, queue state, renderer heartbeat, settings modes and continuing migration divergence.
  - Rechecked current source/CodeGraph around media cleanup, webhook, worker lifecycle, X claims, manual video, Dashboard/HUD, Monitoring, settings, auth, bundle and renderer boundaries.
  - Checked current official Supabase migration/RLS and Vercel runtime behavior.
  - Applied the security-hardening review to structural choices, tradeoffs, evidence confidence and release sequencing.
- Known planning limitations intentionally retained as implementation blockers:
  - Exact Vercel deployment/build provenance was unavailable.
  - Authenticated route/browser evidence was unavailable.
  - digest_config remains a candidate.
  - No intrusive SSRF or real X/Telegram validation was run.
  - Initial numerical performance budgets require a comparable baseline.
- Additional worker need: none for planning completion. Add focused execution workers only when a task slice is approved.
- Visible user-owned thread: none needed; this file is the durable handoff.

## Plan Output

- Plan file: /Users/stevmq/Finalized XOT/docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md
- Task contracts: 60
- Audit register: AIR-001 through AIR-080, with no missing or duplicate ID and no undefined task reference
- Ordered phases: 0 through 8
- Implementation started: no
- Production mutation performed by planning: no
- Ready for implementation-orchestrator: yes, after explicit user approval and re-anchoring G0
