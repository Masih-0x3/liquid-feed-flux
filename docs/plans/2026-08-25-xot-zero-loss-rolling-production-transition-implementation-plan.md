# XOT Zero-Loss Rolling Production Transition Implementation Plan

## Planner Metadata

- Repository: `/Users/stevmq/Finalized XOT`
- Target integration PR: PR #70; semantically reconcile PR #71 into it.
- Date: 2026-08-25
- Planning owner: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable.
- Mode: full planning synthesis using accepted source, database, release, renderer, frontend, auth, and operator/QA lanes.
- Planning boundary: this artifact is planning-only. Implementation has not started.
- Evidence rule: live semantic readback outranks receipts; provider receipts outrank hosted CI; hosted CI outranks Preview; Preview outranks local tests.

## Executive Goal

Move XOT to the PR #70 candidate one compatible component at a time without stopping normal ingestion, preparation, rendering, monitoring, or read access.
Keep Telegram and X posting blocked until the optional new-only continuity gate below passes; if authorized, publish only items admitted after its immutable activation cutoff.
Preserve every historical unsent Telegram/X item and all 77 old render rows as permanent, immutable history.
Never drain, retry, post, requeue, tag, repair, delete, archive away, or clean that historical cohort.

## Source Of Truth Contract

- Intent: a zero-loss rolling transition with one mutation envelope and one rollback boundary at a time.
- Current behavior: production runs a render-only compatibility hotfix; its recorded state has posting blocked, the X cron paused, the worker cron active, and an immutable render cutoff.
- Expected outcome: the exact PR #70 candidate runs in production, new items continue through the authorized blocked or new-only publishing mode, and historical cohorts remain untouched.
- Truth owner: production database rows and catalog for data; provider versions for Edge/Vercel; immutable digest and heartbeat for renderer; exact PR head and hosted CI for source.
- Contract boundary: PR #70 plus semantically accepted PR #71 changes, reviewed forward migrations, ten Edge Functions, one renderer, one staged frontend, Auth/RLS, and named schedules.
- Displaced path: the uncommitted render-only hotfix lineage and any legacy schema/function path replaced by an accepted wave.
- Cutover: source and Preview first; authority second; database bridge/hold/additive migrations; Edge groups; renderer; worker last; frontend last; Auth checks; schedules; soak.
- Acceptance evidence: exact live route, catalog, row, function version, digest, queue transition, rendered artifact, browser surface, and operator receipt.
- Evidence lane: append-only redacted transition ledger plus one receipt per wave.
- Kill criteria: any historical mutation, provider write, role leak, ambiguous claim, incompatible mixed version, unknown renderer, or failed rollback readiness.
- Forbidden moves: broad `db push`, history repair, backlog mutation, dual renderer consumers, posting enablement, cleanup enablement, destructive Git action, secret disclosure, or unrelated refactor.

## Native Planning Superiority

- Codex Native baseline: a phase list without durable cohort invariants, manual timing, or per-component rollback would be unsafe here.
- This plan adds: exact evidence precedence, immutable cohort semantics, serial compatibility waves, operator prompts, rollback/resume gates, and an implementation-owner handoff.
- User-specific context: preserve dirty work, keep normal operations available, keep posting blocked, and distinguish local, Preview, deployed, and live evidence.
- Superiority score target: 5/5.
- Proof artifacts: this plan, the append-only implementation ledger, per-wave receipts, browser screenshots, provider version readbacks, and final soak receipt.

## Orchestration Decision

- Mode: full planning synthesis; no new worker dispatch in this replacement-owner turn.
- Worker count this turn: 0.
- Reason: prior Sol Max lane decisions were already accepted; the missing deliverable was one synthesized artifact.
- Independent surfaces: source/Git, database, queue policy, Edge Functions, renderer, frontend, Auth, schedules, operations, and release evidence.
- Thread decision: keep one plan artifact and one Luna High implementation owner.
- Reconsider trigger: a live readback disproves the recorded hotfix state, PR #70/#71 scope changes, or a new provider surface enters the release.

## Background Browser Lane

- Needed: yes, during Preview, frontend, Auth, and soak validation.
- Target: Codex native browser only; Computer Use must use GPT-5.6 Sol, low reasoning, Fast.
- Safety boundary: no Retry, Post, Reprocess-to-deliver, Cleanup, role edit, secret edit, or provider test action.
- Receipt: route, viewport, role, timestamp, screenshot ID, console/network result, and zero-mutation readback.
- Stop condition: unexpected write, auth leak, wrong target, or browser route that cannot prove its deployment identity.

## Current State And Planning Assumptions

- Current branch is `codex/xot-full-closure-candidate` at `f5992871296aba39a8b0cc23b46aeebca1489fbd` with 13 dirty entries: seven renderer files, four plan/ledger files, the deploy directory, and this plan. Preserve them all.
- PR #70 is OPEN, draft, CLEAN at `f5992871296aba39a8b0cc23b46aeebca1489fbd`; CI and CodeRabbit are green. PR #71 is OPEN, non-draft, CLEAN at `02f2266ca90b749e7403f5095481c75b4a525f7b`; CI, CodeRabbit, and Vercel are green.
- These PR results are hosted source evidence, not semantic reconciliation, deployment identity, live acceptance, or production authorization.
- PR #71 is an input to PR #70, not a competing release. Reconcile behavior and contracts, not commit topology alone.
- The render-only ledger records a live hotfix from an uncommitted worktree. Seal exact deployed-source provenance and rollback artifacts before further mutation.
- The full production authorization packet and release gate remain separate from the render-only acceptance.
- Refresh target, functions, controls, queues, schedules, provider counters, renderer, frontend, and authority within 30 minutes of each dependent mutation.
- Cleanup jobs 17 and 19 remain inactive. Posting stays blocked unless the bounded continuity gate below is separately authorized and accepted.

## Current Production Publishing Continuity Decision

### Verdict And Live Anchor

It is feasible to resume Telegram and X posting for future items while the full candidate stays in Preview, but it is not safe to flip the current breakers now. Telegram has no new-only activation cutoff, and enabling PR #71's worker as-is would make existing pending delivery jobs claimable. The smallest safe option is one forward-compatible guard patch followed by Telegram and X canaries.

- Production project `jzirqfzzvlbxwfzndaer` is `ACTIVE_HEALTHY`. It has one `runtime_controls` row with `singleton_key=true` and `posting_mode=blocked`.
- Worker v283 and cron 26 are active. X-poster v158 is active, but cron 20 is inactive. `x_posting_config.enabled=false`; its old `start_posting_from` is `2026-06-23T02:27:22.308183Z`, with 30-minute age and one-post-per-run limits.
- The current historical-unsent set includes all nine pending delivery jobs, all 5,285 pending Telegram delivery rows, all 1,263 pending and 1,310 failed X delivery rows, and any linked post subject present when the new cutoff is captured. All remain unchanged even when their timestamps are after the render cutoff.
- The render cutoff `2026-08-25T03:02:16.382Z` is not a publishing activation cutoff. The 77 old queued renders remain held; the three new completed renders do not authorize delivery.

### Smallest Safe Forward Patch

- Add the final candidate's separate singleton `pipeline_cutover_disposition` table now. Guards fail closed while it has no row. At activation, insert one immutable UTC delivery cutoff `T`; never update, delete, or move `T` backward. Do not tag or rewrite historical rows.
- In one reviewed migration, make `claim_jobs`, `claim_telegram_delivery`, Telegram provider-start, X candidate/claim RPCs, retry, reconcile, and cleanup paths derive eligibility from `T`. A delivery is eligible only when its post ingestion and delivery admission are both strictly after `T`; missing or conflicting lineage is held.
- Add database update/delete protection for pre-`T` delivery jobs, Telegram deliveries, and X deliveries. This preserves the existing rows even if an admin path or schedule is called by mistake.
- Add the same cutoff check immediately before every Telegram or X provider call. The worker and x-poster must re-read `T` and the subject lineage after claiming. Manual, targeted, force-retry, fallback-query, and provider-retry paths cannot bypass it.
- Patch `admin-retry`, delivery/X actions in `admin-actions`, `reconcile_stuck_jobs`, `db-cleanup`, and `media-cleanup` so historical rows return `historical_unsent_locked` with zero writes. Keep cleanup schedules inactive.
- Likely implementation areas are one forward migration, `supabase/functions/_shared/`, `worker`, `x-poster`, `admin-retry`, `admin-actions`, and their focused contract tests. Port the exact accepted patch into PR #70 before final Preview acceptance; do not create a parallel production data model.

### Exact Activation And Rollback Sequence

1. Keep `posting_mode=blocked`, X disabled, and X cron inactive. Deploy and verify the database guards and guarded Edge versions. Confirm the historical counts and timestamps have zero delta.
2. With posting still blocked, capture `T` once in the immutable table and set `x_posting_config.start_posting_from=T`; leave X disabled. Let cron 26 continue non-delivery work until exactly one naturally ingested post-`T` item reaches an eligible delivery job.
3. Pause cron 26 and wait for zero running delivery claims. Set `ALLOW_EXTERNAL_POSTING=true` while the database breaker remains blocked, then set `posting_mode=enabled` last. Manually invoke worker delivery with batch size one.
4. Check one future Telegram canary: exactly one claim and provider result, no historical-row delta, no duplicate, and no ambiguous result. On PASS, resume cron 26. Do not retry an ambiguous canary.
5. Keep X cron inactive. Confirm `start_posting_from=T`, `max_candidate_age_minutes=30`, and `max_posts_per_run=1`; set X enabled, invoke one run, and inspect one future X canary. Activate cron 20 only after PASS.
6. Observe for four active hours and perform a 24-hour follow-up. Normal new-only posting may continue during the follow-up; historical counts, states, attempts, locks, and maximum update timestamps must remain unchanged.

Rollback order is immediate and fail-closed: set `posting_mode=blocked`, set X disabled, pause cron 20, pause cron 26 if Telegram or cohort integrity is affected, and set `ALLOW_EXTERNAL_POSTING=false`. Preserve `T`, every historical row, and any ambiguous future canary for read-only reconciliation. Restore only the last Edge version if its replacement caused the failure; never reopen the old backlog.

### Continuation Into The Final Candidate

No production data is moved later. Preview remains isolated; the accepted candidate replaces functions, renderer, schema readers, and frontend in place against the same production database, one component at a time. Every candidate component must preserve `T`, the database protections, and last-moment guards before it can replace the continuity version. During each component change, pause only its caller, keep its predecessor available, run the immediate automated and user check, then resume new-only posting after PASS.

Dependencies are an accepted migration replay, focused guard tests, exact deployed-version rollback copies, fresh provider counters, a reachable rollback operator, one natural post-`T` canary per channel, and explicit production authority. Expected effort is 10-18 active agent-hours, 4-8 elapsed preparation hours with parallel isolated work, and 2-4 serial activation hours. New-only posting can resume the same working day if all gates and canaries pass; one business day is more likely, with stable acceptance after the 24-hour follow-up. User time is about 15-25 minutes.

## Future-State Data And Queue Contract

### Runtime controls bridge

- Forward-bridge the hotfix `runtime_controls.singleton_key` shape to the candidate's exact seven columns: `singleton_id`, `environment`, `dedupe_enabled`, `translation_enabled`, `posting_mode`, `updated_at`, and `updated_by`.
- Use an additive dual-read/dual-key compatibility wave first; old and candidate readers must both pass in Preview.
- Move every runtime reader to `singleton_id`, then use a reviewed forward contraction to remove `singleton_key` and prove the exact seven-column catalog.
- Keep exactly one production row, `singleton_id=true`, and `environment=production`. Keep `posting_mode=blocked` unless the continuity gate passes; after activation, preserve new-only eligibility and re-block it during any failed cutover gate.

### Immutable historical hold

- Create a separate singleton hold table containing immutable UTC `delivery_cutover_at`, immutable `render_cutover_at`, environment, policy version, and created audit fields.
- Insert its one production row under the reviewed migration envelope. Reject `UPDATE` and `DELETE` with a database trigger.
- Enable RLS; revoke all privileges from `PUBLIC`, `anon`, and `authenticated`; grant `service_role` only the minimum `SELECT`; owner-only creation occurs in the migration.
- Derive Telegram/X historical membership without touching backlog rows: unsent plus canonical post/admission time at or before `delivery_cutover_at` is historical.
- A Telegram/X item is new only when both canonical post ingestion and delivery admission are strictly after the cutoff. Missing or conflicting time is quarantined and held.
- Derive old render membership as `video_renders.queued_at <= render_cutover_at`; all 77 recorded rows remain held.
- Retry or requeue timestamps never redefine cohort membership.
- Database triggers and claim helpers must reject updates/deletes of historical unsent rows and old renders.
- Apply the hold in claim, retry, reconcile, render-by-ID, render polling, release, delivery, X candidate, and cleanup selectors.
- The UI is a view of this policy. It is not the enforcement boundary.

## Operator-Visible Labels

- Global banner: `Publishing blocked — Telegram and X sends are disabled. Historical unsent items are preserved and will not be retried.`
- Historical badge: `Historical — unsent by policy`; show immutable cutoff reason and disable all mutation actions.
- New badge: `New — post-cutover`; show canonical ingestion/admission UTC and the current non-posting step.
- Quarantine badge: `Quarantined — cohort unknown`; fail closed and expose no mutation action.
- Keep cohort separate from delivery status. Never rewrite a stored `pending` or `failed` state merely to improve display.
- Add read-only filters and counts for Historical, New, and Quarantined. API calls against blocked actions return stable `historical_unsent_locked` or `external_posting_blocked` errors with zero writes.

## Commit-Wave And Availability Rules

- Snapshot branch, status, dirty-file ownership, PR heads, and deployed provenance before work.
- Build a clean integration worktree from the exact PR #70 head; never stash, reset, clean, or overwrite the user's dirty worktree.
- Semantically inventory PR #71 by contract and test, then place accepted changes into scoped PR #70 commit waves.
- Each wave contains one concern, its tests, docs/receipt update, and no unrelated formatter churn.
- Keep the prior component serving until the replacement passes. Do not combine database, function, renderer, frontend, or schedule mutations.
- RSS ingestion, scoring, translation, media preparation, render-only work for new rows, monitoring, and read access remain available.

## Concurrency-First AI Execution Design

The faster safe option is to move concurrency left: agents prepare and challenge isolated release packages in parallel, then one Luna High owner runs the unchanged serial production path. Parallel production mutations, compressed observation windows, and AI improvisation at a live gate are forbidden.

### Recommended Operating Mode

- Finish almost all code, tests, migration rehearsal, rollback material, operator prompts, and exact deployment packages before opening the production window.
- Use parallel agents only for isolated preparation and independent review. One Luna High owner integrates each package and is the only production writer.
- Enter production with a decision-free runbook: every target, command, expected result, STOP rule, rollback, and manual `PASS` check is already written.
- Run the production changes in one controlled serial window. Keep the old component ready until the replacement passes, and stop on the first failed automated or manual check.

This is the useful AI advantage: compress preparation, testing, and review into parallel lanes so the live cutover is short and predictable. AI does not remove the serial dependency order, the immediate user checks, rollback readiness, or the observation period.

### Ownership And Acceptance Boundary

- `P`: GPT-5.6 Sol Max owns this plan only; it does not implement or operate production.
- `I`: the GPT-5.6 Luna High main agent owns the implementation goal, protected database/RLS/Auth and shared contracts, integration, all deploy or production commands, validation, rollback decisions, and final acceptance. If this route is unavailable, implementation is blocked.
- `W1` and `W2`: at most two native GPT-5.6 Luna High writers use disjoint worktrees for bounded S0-S2 preparation changes and tests. They never access production/provider credentials or mutate a provider. Each submits a DoneClaim with paths, commands, results, risks, and cleanup; `I` inspects the diff and repeats acceptance checks.
- `R`: after a fresh `quality-orchestration` catalog, cost, identity, effort, adapter, and canary check, use qualified Devin `swe-1-7` Max and/or `glm-5-2` High as isolated read-only adversarial review lanes. Use `--permission-mode dangerous`; it removes prompts, not scope. If either is not Free and qualified, settle the declared Antigravity, Command Code, then Codex fallback without silent substitution. No external worker writes source or receives secrets, private URLs, production data, provider access, integration, or acceptance authority.
- `O`: a `luna_data` worker may collect and normalize read-only version, metric, queue, schedule, and receipt evidence; it cannot plan, write, or accept. `V`: Computer Use is GPT-5.6 Sol Low, Fast, in the Codex native browser, and performs only named visual checks.
- Production has a writer mutex: only `I` mutates one component. `O`, `R`, and `V` may observe in parallel and raise STOP. Every HIGH-risk slice gets independent adversarial verification; a worker self-report is never acceptance.

### Safe Parallel Preparation Workstreams

| Package | Owner and isolation | Acceptance boundary |
| --- | --- | --- |
| P0 control tower | `I`; ledger, dirty map, exact heads, ownership map | K0 evidence current; no user file changed; goal and stop rules fixed |
| P1 source/Edge | `W1`; clean worktree; PR #71 semantic inventory and guarded Edge candidates | `I` accepts each scoped diff and exact-head test receipt; no deploy |
| P2 renderer/B4 | `W2`; renderer-only worktree and fixtures | `I` proves one-consumer design, digest, canary, prior-image fallback; no live renderer |
| P3 DB/queue/Auth | `I`; protected lane; external agents read-only | Forward bridge, immutable hold, RLS/grants, rollback SQL, and old/new-reader tests pass |
| P4 frontend/UX | next free Luna writer; frontend-only worktree; `R` may review visuals | `I` accepts build/routes/labels; `V` later verifies both viewports on exact Preview |
| P5 operations/QA | `O` read-only, in parallel with P1-P4 | Baselines, queries, step cards, manual prompts, receipts, and rollback commands are complete |

Run no more than two writers at once on the 16-GB Mac; read-only lanes may continue. Check Novita eligibility before an eligible Linux test, but upload nothing without an enabled repo-root policy and exact allowlist. Integrate one package at a time; rerun shared contracts after each integration.

### Ready-To-Cutover Package And Decision-Free Runbook

- Required package: exact integration SHA; PR #71 accepted/rejected semantic manifest; immutable builds and CI receipts; migration manifest with before/after queries and forward fixes; prior/candidate function versions, renderer digests, and Vercel deploy IDs; production baselines; signed authority packet; and prewritten manual prompts.
- Each step card prebinds the exact target and source, allowed mutation, expiry, precheck, execute command/API, automated PASS/FAIL, `CHECK NOW` text, observation timer, rollback command, receipt path, and resume gate. A blank or ambiguous field means `NOT READY`.
- K0 anchor accepts current heads, dirty ownership, and provenance. K1 accepts isolated packages. K2 accepts serial integration and exact-head CI. K3 accepts Preview, rollback rehearsal, authority, and live baseline. K4 repeats after every component only after automated PASS plus immediate user `PASS`. K5 is the 4-hour initial steady state; K6 is the 24-hour follow-up.
- At K3 and every K4, the operator issues the exact short checklist and accepts only `PASS` or `STOP`; no unresolved choice is delegated to the live window. The old component stays available until its successor passes. The renderer switch is atomic and never has two consumers.
- Production remains strictly `S0 -> S1 -> D1/D2 -> E1 -> E2 -> E3 -> E4 -> R1 -> E5 -> D3 -> F1 -> A1 -> C1 -> Q1`; concurrency is observation only after K3.

## Component Cutover Table

| Wave | Precheck | Automated target evidence | Manual `CHECK NOW` | Observe | Rollback trigger and action | Resume gate |
| --- | --- | --- | --- | --- | --- | --- |
| S0 Source/PR | Preserve dirty map; exact PR #70/#71 heads; no deploy authority implied | Semantic diff ledger; scoped commit waves; local gates; exact-head hosted CI | Review accepted/rejected PR #71 behavior list and confirm no unrelated files | CI completion | Scope drift or lost dirty work: stop; restore only task worktree from commits | Exact PR head, clean integration worktree, green required CI |
| S1 Preview/authority | Isolated Preview identity; posting false; named owner, approver, rollback operator, window, expiry | Full migration replay; ten-function versions; zero provider credentials/writes; rollback rehearsal | Open protected Preview; verify banner, routes, one historical fixture, one new fixture | 30 min | Wrong target, provider access, or incomplete authority: delete no evidence; stop | Signed packet and accepted Preview/rollback receipt |
| D1 DB bridge | Fresh backup/restore evidence; zero running/expired leases; prior catalog captured | Additive runtime bridge, hold table, RLS/grants/triggers, exact semantic readback; old/new compatibility | Verify target, one blocked control row, cutoffs, and unchanged historical counts | 30 min | Catalog, role, or compatibility mismatch: stop; retain DDL and forward-fix | Old and candidate readers pass; no row/provider delta |
| D2 Additive candidate DB | Reviewed forward set only; migration effects classified | Apply one migration at a time; catalog/RLS/grant/type/queue parity after each | Review a short before/after schema and backlog summary | 15 min each | Any unknown effect or history ambiguity: stop; no broad push/repair | Exact effect receipts and database-owner acceptance |
| E1 `admin-retry` | Posting controls blocked; prior version archived | Direct and UI retry/resend/test paths return locked before mutation/provider call | Confirm Retry/Post controls are disabled for historical and all posting while blocked | 20 min | Job/delivery/provider delta: pause mutation schedules; restore prior function or forward-fix | Stable lock codes, zero deltas, version receipt |
| E2 `admin-actions` | E1 accepted; admin/read-only JWT path known | Deliver/X/manual-post/retry actions locked; reads and non-posting admin work pass | Dashboard, Monitoring, Settings load; no posting action is available | 20 min | Admin read regression or mutation escape: roll back only this version | Auth/read tests and zero-write receipt |
| E3 X write group | E2 accepted; X cron inactive; X config false | Deploy `x-poster` and guarded `digest-compiler`; every upload/status/tweet path blocked at entry and last moment | X surface shows paused and historical count unchanged | 30 min | X request/post ID/config drift: keep cron off and restore affected version | Zero X provider writes and exact versions |
| E4 Auxiliary group | Internal auth aligned; cleanup jobs off | Deploy `webhooks-rssapp`, `media-processor`, `db-cleanup`, `media-cleanup`, `x-followers-snapshot` serially; signed ingress/idempotency, internal auth, dry-run cleanup exclusion | Confirm one new ingest appears, media is readable, cleanup says paused/protected | 20 min each | Ingest loss, auth error, protected cleanup selection, or provider write: roll back last function | Two clean ingests; cleanup protected count zero; reads stable |
| R1 B4/renderer | E groups accepted; immutable current/prior image; one consumer; old 77 baseline | Apply B4-compatible contracts; deploy candidate renderer paused; three heartbeats; drain/rollback rehearsal | Inspect one new English-to-Persian MP4, subtitles, audio, size, and `Not published` | 30 min | Old render moves, dual consumer, health/OOM/digest/subtitle failure: disable mode/polling and stop only XOT unit | One new canary, one attempt, old 77 unchanged, prior paused fallback proven |
| E5 `worker` last | Renderer accepted; all provider barriers live; prior worker archived | Deploy worker; new item may ingest/translate/render/park; historical claims/retries and provider calls stay zero | Watch one new item reach render-ready and park; verify old backlog unchanged | 3 worker intervals | Historical mutation, queue churn, provider write, expired lease: pause worker and renderer; restore prior worker if compatible | New-only transaction joins, zero old/provider delta, stable errors/latency |
| D3 DB contraction | Every runtime reader uses `singleton_id`; rollback path reviewed | Remove `singleton_key`; exact seven-column catalog; full old-path absence scan and candidate tests | Confirm control summary still says production/blocked | 30 min | Reader error or cardinality drift: forward restore compatibility column under reviewed migration | Exact shape, one row, all readers green |
| F1 Frontend last | Immutable staged Vercel deploy; prior deployment retained; backend stable | Build identity, routes, headers, SPA refresh, logs, no page-load X calls | Desktop 1440x900 and mobile 390x844: routes, labels, disabled actions, no overflow/errors | 60 min | Route/Auth/CORS/label/action regression: promote prior frontend only | Browser receipt for both viewports and deployment identity |
| A1 Auth roles | Exact admin/read_only accounts; candidate RLS/grants live | REST/RPC/Realtime/Storage matrix; read_only mutation 403 with zero before/after change | Sign in as admin and read_only; verify role banner and protected routes | 30 min | Read-only write or admin lockout: revert last policy/function via forward fix; keep prior frontend ready | Full role matrix and human PASS |
| C1 Schedules | Zero running/expired leases; baseline queue/provider counts | Enable worker, reconcile, then learned-bias one at a time if approved; X and cleanup stay off; verify exact job/run | After each job, verify only New moves and Historical stays fixed | 2-3 intervals each | Old-row delta, new DLQ, latency/error breach, provider write: deactivate last job; pause all claimers on cohort breach | Two clean intervals and operator PASS per job |
| Q1 Soak | All receipts accepted; rollback operator reachable | Continuous invariants, queue/error/latency, renderer, role, schedule, and provider-delta monitoring | Review concise dashboard at start, 1h, 4h, and 24h | 4h active + 24h read-only | Any stop metric: roll back latest wave, freeze advancement, append incident receipt | Root cause, repeated component gate, and new soak acceptance |

## Target Metrics And Stop Conditions

- Before continuity activation: Telegram messages, X post IDs, provider-write calls, and new posted timestamps are exactly zero. After activation: historical or unexpected provider writes remain exactly zero; only accepted post-`T` canary and normal new-only writes may increase.
- Historical Telegram/X and old-render cohort membership, states, attempts, locks, and maximum update time: zero delta.
- Historical cleanup-selection count and historical claim count: zero.
- New canary: exactly one claim and attempt; terminal lock cleared; no duplicate; no delivery release.
- Before mutations: running jobs zero, expired leases zero, and no ambiguous provider outcome.
- During gates: no release-attributable DLQ row or expired lease; Edge error rate stays below 1%; new-item success stays at least 95%.
- Warning/stop references: queue depth over 50, oldest new pending over 10 minutes, or average delivery-stage latency over 60 seconds stops advancement for diagnosis.
- Renderer: one replica, concurrency one, healthy heartbeat every expected interval, failed-count delta zero.
- Frontend/Auth: required routes succeed, no startup/CORS/console error, and read_only mutation is 403 with zero state change.
- Stop immediately on target/authority drift, secret exposure, incompatible mixed version, rollback operator loss, dual renderer, or any historical/provider write.

## Validation And Audit Receipts

- Supporting source gates: runtime contract, migration baseline, function inventory/check/lint/tests, strict/type checks, root tests/build, renderer tests, supply-chain checks, and diff check.
- Preview must test runtime bridge both before and after contraction, hold immutability, claim/retry/reconcile/render/cleanup guards, all ten functions, renderer fallback, frontend, and roles.
- Live acceptance uses semantic provider/database/browser evidence; tests and diffs alone never close a wave.
- Each append-only receipt records authorization ID, UTC window, actor/approver/rollback operator, target, source SHA/version/digest/deploy ID, before/after controls and aggregates, automated evidence, manual result, observation, rollback, disposition, and next gate.
- Store no secret value, raw content, private URL, production dump, or provider token in Git, chat, screenshots, or worker prompts.
- Reconcile SR-REL-00, SR-MIG-01, SR-RLS-01, PAT-1, AIR-010, AIR-017, AIR-052, AIR-055, and the final 80-row AIR state without rewriting prior ledger rows.

## Manual Check Contract

- Notify the user only at the table's `CHECK NOW` points; do not require continuous watching.
- Each prompt states the exact URL/surface, role, viewport, expected control/cohort counts, three to five checks, forbidden actions, and `Reply PASS or STOP`.
- Never ask the user to test Retry, Post, X, Telegram, Reprocess-to-deliver, or Cleanup.
- A manual PASS supplements automated evidence; it never overrides a failed invariant.

## Risks And Dependencies

- Exact deployed hotfix provenance and rollback artifacts are required before S1.
- PR #71 may contain behavior already represented differently in PR #70; semantic reconciliation must prevent duplicate or regressive changes.
- The dual-key bridge must be temporary and observable; contraction cannot occur until every live reader is proven on `singleton_id`.
- Database immutability triggers must protect history without blocking new-item processing or legitimate read paths.
- B4 and renderer rollout can create a dual-consumer race; only one renderer may poll at any time.
- Full transition remains blocked without human authority, accepted restore/recovery evidence, credentials, and reachable rollback operators.

## Estimate

| Measure | Optimistic | Likely | Conservative | Meaning |
| --- | ---: | ---: | ---: | --- |
| Aggregate active agent work | 39 hours | 85 hours | 178 hours | Total work across parallel agents; not elapsed time |
| Parallel preparation to K2 | 8-16 hours | 1-2 business days | 3-7 days | Clean integration, packages, tests, runbook, and exact-head CI |
| Serial production path before soak | 10-16 hours | 16-28 hours | 32-60 hours | One component at a time with immediate checks and observation |
| Mandatory soak | 28 hours | 28 hours | 28 hours plus incident time | Four active hours plus a 24-hour follow-up |
| End-to-end elapsed time | 2.5-3 calendar days | 4-6 business days | 2-4 weeks | Includes readiness, cutover, and soak |
| User active time | About 60-80 minutes | 80-120 minutes | 2-3 hours | Authority, Preview, and short `PASS`/`STOP` checks |

Parallelism changes elapsed time, not the evidence required for acceptance. The elapsed estimate assumes replies within 10 minutes; waiting is not user active time.
- Assumptions: Luna High is available; no more than two isolated writers run; qualifying free review routes pass fresh canaries; CI/provider queues are timely; restore, auth, and migration evidence pass; no forward fix or incident occurs. Never shorten the serial order, manual gates, fallback readiness, or soak to meet the estimate.

## Implementation Orchestrator Handoff

Copy this kickoff exactly into the GPT-5.6 Luna High implementation-owner turn:

```text
Use implementation-orchestrator with /Users/stevmq/Finalized XOT/docs/plans/2026-08-25-xot-zero-loss-rolling-production-transition-implementation-plan.md as the contract. Create a broad goal for PREP-0 through K2 only: preserve the 13-entry dirty checkout; anchor PR #70 at f5992871296aba39a8b0cc23b46aeebca1489fbd and PR #71 at 02f2266ca90b749e7403f5095481c75b4a525f7b; build a clean integration worktree; semantically reconcile PR #71; produce P0-P5; integrate one package at a time; and reach exact-head CI with the decision-free step cards complete. The phase owner, integrator, validator, and final acceptor is GPT-5.6 Luna High; if unavailable, mark BLOCKED. Use at most two disjoint native Luna High writers and read-only evidence/review lanes under the Ownership And Acceptance Boundary. Run a fresh quality-orchestration route gate before any external review. Evidence tier is HIGH; include dirty-worktree, stale-state, cancel/resume, hung-command, misleading-success, and repeated-interruption adversarial cases. Do not mutate production, providers, PR state, schedules, backlog rows, or the user's dirty worktree. Do not post, retry, requeue, tag, delete, or clean any historical Telegram/X item or old render. Stop at K2, issue the K3 readiness receipt with gaps, and request authority before Preview or any provider mutation.
```

After K3 authority, `I` uses the component table as written. It creates one bounded goal per live wave, records before/after evidence, asks for immediate `PASS` or `STOP`, preserves the prior component until PASS, and never advances after a failed metric. Transition completion requires K6 with the accepted continuity mode preserved: blocked if continuity was not authorized, or guarded new-only publishing if its canaries passed. Historical posting is never enabled.

## Planning And Worker Receipt

- Acceleration revision planning owner: `planner`, GPT-5.6 Sol, Max reasoning; inspected current state and the full plan, then owned concurrency design, tradeoffs, ownership, acceptance, checkpoints, handoff, and estimate; accepted.
- Accepted prior planning inputs: source/PR reconciliation, runtime-control bridge, immutable cohort/DB guards, renderer/B4, frontend/Auth, release/QA, and operator lane decisions; integrated with rework where required.
- New planning or research workers used in this revision: none.
- Strict planning route: passed.
- Implementation agents used: none. Implementation has not started.
