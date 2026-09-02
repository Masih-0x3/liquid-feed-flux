# XOT Render-Only Automation Cutover Implementation Plan

## Planner metadata

- Repository: `/Users/stevmq/Finalized XOT`
- Branch: `codex/xot-full-closure-candidate`
- Date: 2026-08-25 UTC planning window
- Plan owner: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable
- Planning effort gate: Max passed because this changes a production queue, production database functions, deployed Edge Functions, and a persistent remote service across three coupled surfaces.
- Planning mode: full worker run with three distinct read-only lanes plus parent synthesis.
- Planning-only boundary: this phase changed only this Markdown plan. It did not change product source, production rows, functions, secrets, crons, the Lightning host, Git branches, PRs, or deployments.
- Goal note: no Codex goal was created because the user did not explicitly ask to create one.

## Outcome

Restore automatic video rendering on Lightning for only render rows admitted after a fixed cutover time. Keep Telegram and X posting blocked for the whole recovery phase. Leave the current 77 queued render rows exactly where they are.

The smallest production-compatible path is a narrow recovery hotfix against the live legacy contracts. Do **not** replay the full candidate migration chain and do **not** deploy the current candidate `worker`, `x-poster`, `admin-retry`, or `admin-actions` bundles to production in this recovery.

The accepted end state is:

1. New eligible video render rows are claimed automatically by `lightning-xot-1`.
2. Rows queued at or before the immutable cutover time are never claimed by automatic polling.
3. Telegram and X provider writes remain blocked by database state, Edge environment state, and last-moment provider guards.
4. Render completion cannot create or revive a public-delivery job while posting is blocked.
5. Existing or newly created delivery jobs can prepare a render, but they park before a Telegram delivery claim or provider request.
6. One spoken-English canary reaches translated Persian subtitles and a rendered MP4 without any post or release.
7. The XOT container starts from persistent Lightning storage through one XOT-owned user unit, with `restart=unless-stopped`; Hermes is untouched.

## Source-of-truth contract

### Intent

Use the existing Lightning renderer as a render-only worker. It prepares videos for later review/posting. It does not publish them during this phase.

### Truth owners

| Concern | Source of truth |
| --- | --- |
| Cutover membership | `video_renders.queued_at` compared with one immutable UTC cutoff captured from production `clock_timestamp()` |
| Automatic claim eligibility | New service-role-only RPC `claim_video_render_after(...)` |
| Manual targeted render | Existing `claim_video_render_by_id(...)`; it deliberately bypasses the automatic cutoff |
| External-posting state | Exactly one `runtime_controls` row for `production`, with `posting_mode='blocked'` |
| Second posting breaker | Edge secret `ALLOW_EXTERNAL_POSTING=false`, with `XOT_ENVIRONMENT=production` |
| X scheduler breaker | `settings.x_posting_config.enabled=false`; X cron remains paused during recovery |
| Render release | `_video_render_should_release(...)` must also require the one production control row to have posting enabled |
| Runtime | Compose project `xot-renderer` on Lightning, one container, `RENDERER_ID=lightning-xot-1` |
| Persistent source/control | `/teamspace/studios/this_studio/xot-renderer/releases/...` and `/teamspace/studios/this_studio/xot-renderer/control/deploy/lightning` |
| Evidence | This plan, the existing append-only renderer recovery ledger, a new append-only cutover ledger, redacted live readbacks, and test receipts |

### Automatic versus manual lanes

- Automatic polling must call only `claim_video_render_after` and must pass the protected cutoff.
- `claim_video_render_by_id` remains available for explicit operator canaries and manual repair. It is never used by the poll loop.
- `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` remain absent from production Edge secrets during the legacy bridge. This keeps automatic Edge dispatch in poller-only mode because targeted HTTP dispatch calls the by-ID lane and bypasses the cutoff.
- Requeueing an expired row can move its `queued_at` forward. That is an explicit opt-in to the post-cutover lane. Admin retry paths are blocked while posting is blocked, so this cannot happen through ordinary delivery retry controls during recovery.

## Fresh current anchor

Read-only evidence during the 2026-08-25 UTC planning window established:

### Repository

- Branch is `codex/xot-full-closure-candidate`, tracking its upstream.
- The worktree is intentionally dirty from renderer recovery work. Preserve it. Current owned edits include renderer polling-breaker source/tests/docs, the Lightning deployment bundle, and the prior recovery plan/ledger.
- Do not reset, clean, stash, or overwrite these edits.

### Production database and Edge

- `settings.video_render_config.mode=disabled`.
- `settings.x_posting_config.enabled=true`.
- `runtime_controls` does not exist.
- `video_renders`: 77 queued, 0 running.
- The queued cohort spans `2026-08-10T17:45:34Z` through `2026-08-24T18:42:28Z`.
- The live renderer RPCs are the legacy signatures. B4 claim fencing is not present.
- `claim_video_renders(integer,text)` claims the oldest queued or expired-running row and has no cutoff or lane filter.
- `_video_render_should_release(text)` has the current render/manual-intake/translation/hydration checks but no external-posting hold.
- `complete_video_render(...)` and the failure path can call `_video_render_queue_delivery(...)`.
- The live worker accepts `deliver` jobs and the live X cron runs every minute.
- The deployed `worker`, `x-poster`, `admin-retry`, and `admin-actions` do not contain the candidate posting guard.
- X has 1,263 stale pending `x_deliveries`.
- A later read-only delivery-job aggregate found no pending due `deliver` job, 179 failed rows, and 5,198 completed rows. Recheck this immediately before cutover; zero pending/running delivery jobs is a stop gate.
- The three targeted recovery renders completed without posting. That is historical result evidence, not a durable posting hold.

### Candidate source

- `_shared/runtimeControls.ts` already validates exactly one well-formed control row and fails closed.
- `_shared/externalPostingGuard.ts` already requires production identity, a matching database row, `ALLOW_EXTERNAL_POSTING=true`, and `posting_mode=enabled`.
- Candidate worker/X/admin code contains the desired last-moment guards and focused tests.
- The current candidate functions also depend on protected Telegram, B3, B4, X, role, and E10 migrations that production does not have. A direct candidate function deploy is incompatible.
- E10 creates the desired table shape but also changes roles and `user_roles`; applying it alone or replaying the full pending chain is too broad for renderer recovery.

### Lightning

- Container `xot-renderer-xot-video-renderer-1` is healthy on `127.0.0.1:8797`.
- It uses the legacy recovery image, runs as `node`, and has the intended CPU, memory, PID, and shared-memory limits.
- Current container state is `restart=no`; `RENDER_POLLING_ENABLED=0` is present but the current legacy image ignores it.
- Health reports no active render, `processed=2`, `failed=0`.
- The container's Compose labels still point to the transient source bundle, not the stable control directory.
- `xot-renderer.service` is absent/inactive/disabled. User linger is enabled.
- The persistent control/runtime/legacy release paths exist, but the accepted render-only bridge source must be copied to a dedicated persistent release before promotion.
- Hermes has three active services. Their restart-count baseline is `0/0/1`. They are observation-only.
- Lightning auto-sleep remains unknown. The user unit starts XOT when the Studio is running or wakes; it cannot keep a stopped Studio online.

## Current flow and the two unsafe couplings

```text
Incoming post
  -> translate/dedupe pipeline
  -> deliver job
  -> worker prepareVideoRenderGate
       -> enqueue_video_render
       -> renderer claim_video_renders        UNSAFE: oldest queue, includes 77-row backlog
       -> complete_video_render
            -> _video_render_queue_delivery   UNSAFE: mode=enabled can revive public delivery
  -> worker Telegram provider request

X cron every minute
  -> invoke_x_poster_if_enabled
  -> x-poster candidate/claim/provider request
```

Turning on renderer polling today would drain the old queue. Turning on `video_render_config.mode` today can also turn a completed render into public-delivery work. Both couplings must be closed before the canary.

## Recommended minimal architecture

```text
One immutable DB cutoff T

Automatic renderer poll
  -> claim_video_render_after(T, lightning-xot-1)
       -> selects exactly one row with queued_at > T
       -> delegates atomically to claim_video_render_by_id
  -> render/transcribe/translate/upload
  -> complete_video_render
       -> _video_render_should_release
            -> false while runtime_controls.posting_mode=blocked

Automatic deliver job
  -> worker runs normal prep through prepareVideoRenderGate
       -> can enqueue a NEW render row
  -> early posting check immediately after render gate
       -> blocked: park before Telegram delivery claim/provider
  -> last-moment posting check before every Telegram attempt/retry

X
  -> x setting false + X cron paused
  -> x-poster entry guard
  -> last-moment guard before every upload/status/tweet provider request
```

### Cutoff semantics

Use a timestamp cutoff, not a backlog mutation, boolean flag, or row-by-row lane rewrite.

- Capture `T` from production `SELECT clock_timestamp()` after the migration and posting hold are live.
- Store the exact timezone-qualified value in the protected Lightning env as `RENDER_QUEUE_CUTOFF_AT`.
- The database row's `queued_at` is authoritative; the renderer cannot derive or move the cutoff.
- The automatic predicate is strict: `queued_at > T`.
- Missing, blank, invalid, or timezone-free cutoff makes effective polling disabled and causes zero claim RPCs. Never default to epoch.
- Never move the cutoff backward. Advancing it abandons some new rows and needs explicit operator authority.
- The 77 rows are not updated, tagged, requeued, or copied.

### Claim RPC

Add a service-role-only function with a stable signature such as:

```sql
public.claim_video_render_after(
  p_queued_after timestamptz,
  worker_id text DEFAULT 'renderer'
) RETURNS SETOF public.video_renders
```

Required behavior:

1. `NULL` cutoff returns zero rows.
2. Select exactly one eligible row with `q.queued_at > p_queued_after`.
3. Preserve the current eligibility checks: queued or expired-running lease, source media has a storage path, and media MIME is video.
4. Order by `queued_at`, then `created_at`.
5. Use `FOR UPDATE OF q SKIP LOCKED`.
6. In the same transaction, delegate the selected ID to `claim_video_render_by_id(...)`.
7. Do not duplicate lease/token/generation logic. The wrapper therefore works with today's legacy by-ID function and inherits B4 fencing later.
8. Revoke `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`; use a fixed search path and schema-qualified objects.

### Hard no-post control

Create only the E10-compatible `runtime_controls` table and invariant trigger in the narrow migration. Do not include E10 role or `user_roles` changes. The migration creates zero rows.

After exact production identity readback, provision one row:

```text
singleton_id=true
environment=production
dedupe_enabled=true
translation_enabled=true
posting_mode=blocked
updated_by=NULL
```

The hold has four layers, each with a distinct job:

1. `_video_render_should_release` requires exactly one matching production row with `posting_mode=enabled`. This prevents render completion/failure from creating or reviving delivery work.
2. Worker checks the posting guard immediately after `prepareVideoRenderGate` and before any Telegram delivery claim. A blocked job is deferred for a long bounded interval with a stable `external_posting_blocked` reason. This lets a fresh delivery job enqueue and wait for a render without provider churn.
3. Worker rechecks immediately before every Telegram provider request and parse-error retry. This closes state changes between early admission and network I/O.
4. X-poster checks at entry and immediately before every upload, append, finalize, status, and tweet-creation request. Direct admin Telegram/X test, retry, and manual-post paths use the same guard.

Do **not** remove all `deliver` jobs from the worker claim filter. The normal live enqueue path reaches `enqueue_video_render` through `prepareVideoRenderGate` inside a delivery job. Removing the type would make posting safe but would also stop automatic render admission. Instead, allow the render-preparation portion and park immediately after it.

### Delivery retry behavior during recovery

- `admin-retry` must guard `resend_delivery`, `retry_failed_deliveries`, direct Telegram template tests, and legacy `retry_delivery` before it creates/resets a job or calls Telegram.
- `admin-actions` must guard `retry_step` when `step=deliver`, X retry/post actions, manual video posting, and direct X test posting.
- Other preparation-only work can continue, but the worker's early hold prevents a Telegram claim.
- A held delivery job stays pending with a far-future bounded `next_run_at` and an observable stable reason. It is not marked posted or completed. Releasing held jobs is a later explicit posting-phase decision, not part of this plan.

### Why the compatibility hotfix is required

Use one isolated, task-owned recovery worktree whose Edge base matches the deployed legacy function lineage. Overlay the known production-compatible legacy renderer source, then add only this plan's small guards and cutoff support. Retain that local recovery revision and the persistent Lightning release; do not push it unless separately authorized.

This is deliberate. The live Edge and renderer contracts predate the candidate's B3/B4/E10 dependencies. A mixed recovery bundle is smaller and safer than changing production's migration lineage merely to deploy current candidate code.

## Rejected alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| Enable current polling | Reject | Immediately admits the 77-row backlog |
| Mark/update the 77 rows | Reject | Mutates the backlog and creates cleanup/reversal work |
| Remove `deliver` from worker while blocked | Reject | Also removes the current automatic render-enqueue path |
| Provider guards only | Reject | Prevents final network writes but still permits render completion to revive jobs and creates retry churn |
| Settings/cron pause only | Temporary maintenance state only | Safe but does not restore automation |
| Deploy current candidate functions | Reject | Live RPC/table/role dependencies are absent |
| Replay Telegram+B3+B4+X+E10 migration chain | Defer/block | It is the later full production release, not the minimum renderer recovery; it changes unrelated queue fencing, roles, and schemas |
| Separate paid Supabase project | Reject | Use an authorized ephemeral development branch or local disposable database for validation |

## Precise implementation surfaces

### Candidate worktree: preserve and extend existing dirty renderer work

| File | Required change |
| --- | --- |
| `services/video-renderer/src/config.js` | Add strict `RENDER_QUEUE_CUTOFF_AT` parsing; effective polling is false unless both polling is explicitly enabled and the cutoff is valid/timezone-qualified |
| `services/video-renderer/src/server.js` | Report requested/effective polling and cutoff-block reason; keep heartbeat active; make zero claim calls when paused |
| `services/video-renderer/src/renderer.js` | Change `claimNextRender` to call `claim_video_render_after` with the immutable cutoff; leave `claimRenderById` unchanged |
| `services/video-renderer/test/config.test.js` | Cover missing, malformed, timezone-free, valid-Z, and valid-offset cutoffs |
| `services/video-renderer/test/server.test.js` | Cover zero claims for every fail-closed cutoff state and wrapper RPC/argument use when enabled |
| `services/video-renderer/test/capacityRuntime.test.js` | Preserve shared capacity/shutdown behavior with the new runtime fields |
| `services/video-renderer/README.md` | Replace the stale legacy-note behavior with the accepted render-only bridge contract |
| `services/video-renderer/deploy/lightning/renderer.env.example` | Add `RENDER_QUEUE_CUTOFF_AT=` and explain strict UTC/timezone behavior |
| `services/video-renderer/deploy/lightning/README.md` | Document the cutoff, stable release, persistence promotion, canary, and rollback |
| `services/video-renderer/deploy/lightning/docker-compose.lightning.yml` | Preserve env-file ownership; no host override of polling/cutoff; no broader host changes |
| `services/video-renderer/deploy/lightning/service.env.example` | Select the new immutable render-only legacy release, not the unpatched legacy image |
| `services/video-renderer/deploy/lightning/xot-renderer.service` | Keep the stable control path and XOT-only unit contract |

### Narrow forward migration

Generate the filename with:

```bash
supabase migration new render_only_automation_cutover
```

The resulting `supabase/migrations/<generated>_render_only_automation_cutover.sql` must contain, in one explicit transaction:

1. E10-compatible `runtime_controls` table, checks, invariant trigger, RLS, and exact privileges, with no inserted row.
2. `claim_video_render_after(timestamptz,text)` with the semantics above.
3. A successor `_video_render_should_release(text)` that preserves every current live predicate and additionally fails closed unless exactly one production runtime-control row has `posting_mode='enabled'`.
4. Explicit function revokes/grants and fixed search paths.
5. No B3/B4 columns, role migration, user-role primary-key work, cleanup, cron change, or data backfill.

Because production migration history has non-linear drift:

- Never run broad `supabase db push` or `--include-all`.
- Validate the exact generated file on a disposable production-shaped branch/database.
- Apply only that file with `supabase db query --linked --file <exact-file>` after identity and stop gates pass.
- Read back table/function semantics first. Only then mark that exact generated version applied with `supabase migration repair --status applied <version> --linked`.
- This records the hotfix. It does not claim migration-history convergence.

### Live-compatible Edge hotfix worktree

Backport only the no-post behavior to the exact deployed-source-compatible lineage:

| File/surface | Required change |
| --- | --- |
| `supabase/functions/_shared/runtimeControls.ts` | Backport exact one-row fail-closed validation |
| `supabase/functions/_shared/externalPostingGuard.ts` | Backport environment + database dual guard |
| `supabase/functions/worker/index.ts` | Load controls before claims; keep translation/dedupe states; add early post-render parking; pass a last-moment guard to all Telegram paths |
| `supabase/functions/worker/telegramDelivery.ts` | Invoke the guard before every photo/group/video/audio provider call and every parse retry |
| `supabase/functions/x-poster/index.ts` | Add entry guard and guarded provider fetch for every X write |
| `supabase/functions/admin-retry/index.ts` | Guard delivery retry/enqueue/reset and direct Telegram test paths before mutation/provider I/O |
| `supabase/functions/admin-actions/index.ts` and bounded X/manual helpers | Guard delivery retry, direct X test, X retry, and manual video posting paths |
| Focused tests beside these modules | Prove missing/duplicate/malformed/mismatched/blocked controls make zero provider calls and zero delivery-retry mutations |

Do not backport candidate-wide B3/B4 fencing, role/auth refactors, observability schemas, or unrelated worker changes.

### Lightning persistent runtime

Use only these XOT-owned paths:

```text
/teamspace/studios/this_studio/xot-renderer/
  control/deploy/lightning/
  releases/render-only-legacy-<revision>/
  runtime/renderer.env
  runtime/service.env
```

Required host changes:

- Copy the exact patched bridge source into the dedicated persistent release.
- Build/load a new `linux/amd64` image with a unique immutable tag.
- Update `service.env` to the stable release and control directory.
- Keep candidate profile/restart `no` until the canary passes.
- After acceptance, switch to `persistent`/`unless-stopped`, install the XOT user unit, and perform one controlled XOT-only unit restart.
- Do not modify Hermes, Docker daemon configuration, Tailscale, host ports, or unrelated containers/services.

## Phase plan with stop gates

### Phase 0 — re-anchor and create the cutover ledger

1. Re-read Git branch/status and preserve the dirty boundary.
2. Create `docs/plans/2026-08-25-xot-render-only-automation-cutover-implementation-ledger.jsonl` as append-only.
3. Record plan path, current branch/revision, owned files/worktree, allowed production surfaces, forbidden moves, and planned rollback.
4. Recheck linked production identity without printing secrets or raw content.
5. Snapshot function versions, exact cron names/IDs/active states, settings, queue aggregates, renderer heartbeats, and delivery aggregates.

Pass only if:

- production is the intended linked target;
- render mode is disabled;
- 77 old queued rows and 0 running rows remain;
- there is no fresh unknown renderer;
- no pending/running Telegram `deliver` job exists;
- the live RPCs still match the legacy compatibility matrix.

Otherwise stop with `BLOCKED_LIVE_DRIFT`.

### Phase 1 — first implementation slice: cutoff contract only

This is the exact first implementation slice. It is bounded, testable, and makes no production change.

1. Preserve the current dirty polling-breaker edits.
2. Add `RENDER_QUEUE_CUTOFF_AT` parsing and effective-polling behavior to candidate renderer source.
3. Change the automatic claim call to `claim_video_render_after`; keep by-ID dispatch unchanged.
4. Write focused renderer unit tests first, then implement until they pass.
5. Draft the narrow migration with the cutoff wrapper only plus its privilege contract.
6. Validate the wrapper against both legacy by-ID semantics and B4 by-ID semantics in disposable tests.

Stop if the wrapper duplicates lease/fencing logic, any invalid cutoff can call a claim RPC, or by-ID behavior changes.

### Phase 2 — no-post compatibility hotfix

1. Create one isolated task-owned recovery worktree. Do not alter other worktrees.
2. Archive/download the four current deployed function sources and record deployed versions for rollback. Do not use broad hash matching.
3. Base the hotfix on the deployed-compatible lineage and overlay the known legacy renderer source.
4. Backport only runtime controls, release hold, worker early parking, Telegram/X last-moment guards, and admin retry guards.
5. Add focused tests with fetch/provider spies and mutation spies.
6. Keep external workers away from secrets, production credentials, database writes, deployment, and acceptance.

Stop if compatibility requires B3/B4/E10 roles, if any provider path lacks a last-moment guard, or if early worker blocking prevents `prepareVideoRenderGate` from enqueueing a render.

### Phase 3 — local and ephemeral validation

Run at minimum:

```bash
npm --prefix services/video-renderer test
npm run test:functions -- --filter 'runtime|posting|telegram|x-poster|admin-retry|video-render'
npm run check:telegram-delivery-fail-closed
npm run check:x-poster-ambiguity
npm run check:x-post-delivery-claim
npm run check:video-render-gate-queue
npm run check:video-render-posted-persistence
npm run check:internal-edge-auth
npm run check:functions
npm run lint:functions
```

Adapt exact Deno filters to the hotfix worktree's available tests; do not claim a skipped suite passed.

Disposable migration/function validation must prove:

- migration applies once and is idempotent on the exact intended shape;
- zero control rows exist immediately after migration;
- a blocked production row makes `_video_render_should_release` false even when render mode and all old release predicates are true;
- the release predicate becomes true only when all prior predicates and posting enablement are true;
- missing/duplicate/malformed/mismatched controls fail closed;
- cutoff `NULL`/invalid application path claims zero;
- a pre-cutoff queued row remains untouched while a post-cutoff row is claimed;
- legacy and B4 by-ID implementations both work behind the wrapper;
- grants/revokes/search paths match the contract;
- blocked worker behavior can enqueue/observe a needed render but parks before Telegram claim/provider;
- blocked X/admin/Telegram tests make zero provider calls.

Do not continue on partial replay, migration drift ambiguity, or a network-writing test.

### Phase 4 — establish the live posting hold

Protected Luna-only sequence:

1. Recheck all Phase 0 facts.
2. Set only `x_posting_config.enabled=false`; preserve the rest of its JSON; read it back.
3. Pause the exact worker and X cron jobs with `cron.alter_job(..., active := false)`. Do not delete or rewrite cron rows.
4. Wait for no active worker invocation, Telegram claim, X claim, or running render.
5. Apply the exact narrow migration file only.
6. Read back table shape, function definitions/signatures, owner, grants, and zero-row state.
7. Insert exactly one blocked production runtime-control row with dedupe/translation enabled.
8. Set Edge secrets through a non-logging env file or stdin-safe route:
   - `XOT_ENVIRONMENT=production`
   - `ALLOW_EXTERNAL_POSTING=false`
9. Confirm `VIDEO_RENDERER_URL` and `VIDEO_RENDERER_TOKEN` remain absent.
10. Deploy only the live-compatible hotfix versions of `worker`, `x-poster`, `admin-retry`, and `admin-actions` while crons remain paused.
11. Read back new function versions and archive the deploy receipt.
12. Run negative live calls:
   - x-poster returns stable locked state before candidate/delivery mutation;
   - Telegram test returns locked before provider I/O;
   - delivery retry returns locked before job/delivery mutation;
   - worker with no jobs performs no claim/provider write;
   - release predicate is false.

Pass only if every blocked path returns the expected stable code and all before/after Telegram/X/delivery aggregates are unchanged.

### Phase 5 — install the patched renderer paused and capture the cutoff

1. Copy the patched bridge source and stable control bundle to their persistent Lightning paths.
2. Build/load the immutable AMD64 image.
3. Keep `RENDER_POLLING_ENABLED=0`, DB render mode disabled, restart policy `no`.
4. Recreate only the XOT container through the stable control bootstrap.
5. Verify Compose label now points to `/control/deploy/lightning`, loopback bind, user, limits, health, heartbeat, and zero claims.
6. Capture `T` using production `clock_timestamp()`.
7. Snapshot the old cohort using `queued_at <= T`:
   - count;
   - oldest/newest queued time;
   - sum of attempts;
   - running/locked count;
   - maximum updated time.
   Do not store raw content, IDs, or row hashes in the ledger.
8. Write the exact timezone-qualified `T` to `RENDER_QUEUE_CUTOFF_AT` in the mode-0600 Lightning env.
9. Set `RENDER_POLLING_ENABLED=1` and recreate only XOT while DB mode remains disabled.
10. Observe two poll intervals: zero claim calls/rows and a fresh healthy heartbeat.

Stop on any old-row mutation, unstable cutoff, non-loopback bind, wrong Compose path, unexpected renderer, or Hermes change.

### Phase 6 — backlog-isolation proof and one no-post canary

1. Reconfirm all posting controls blocked and X cron paused.
2. Set only `video_render_config.mode=enabled`; preserve/read back all other fields.
3. With no post-cutoff row, observe two poll intervals. The old 77-row cohort must remain unchanged.
4. Select by metadata a known spoken-English, previously successful video source. Do not record its raw content or identifier in the ledger.
5. Enqueue exactly one new render with a unique canary render version after `T`. Do not use targeted HTTP dispatch.
6. Assert its `queued_at > T`.
7. Observe automatic `queued -> running -> completed` under `locked_by=lightning-xot-1`.
8. If any other post-cutoff row appears, pause mode and classify it before continuing; never mistake it for the canary.

The canary passes only with all evidence below:

- exactly one automatic attempt for the canary;
- terminal lease/lock cleared;
- `source_language='en'` and `target_language='fa'`;
- nonempty original transcript, translated/Persian subtitles, and ASS subtitles;
- output MP4 path exists in Storage and object bytes equal the row's output size;
- width, height, and duration are positive;
- heartbeat processed count increases by one, failed count does not increase, and `last_error` stays null;
- no `video_renders.posted_at` change;
- no Telegram posted delivery or message ID for the canary;
- no X delivery/post for the canary;
- no `deliver:<canary>` job is created or revived by render completion;
- the 77-row pre-cutoff cohort retains the same count, status, attempts aggregate, locks, queued window, and max updated time;
- the three earlier recovery renders remain completed/not posted;
- Hermes service states and restart counters remain at baseline.

The earlier short clip classified as Nynorsk is not a valid canary. If the known English canary is not classified as English or lacks translated subtitles, the canary fails and rendering returns to paused.

### Phase 7 — resume safe automation and make XOT restart-persistent

1. Set render mode disabled again before changing supervisors.
2. Keep runtime posting blocked, `ALLOW_EXTERNAL_POSTING=false`, X setting false, and X cron paused.
3. Resume only the worker cron. Observe two intervals:
   - translation and dedupe continue;
   - a fresh delivery job may prepare/enqueue a render;
   - no Telegram claim/provider or posted state occurs;
   - failed historical delivery rows are not automatically requeued.
4. Change XOT `service.env` to `persistent` and `unless-stopped`.
5. Install the XOT unit into the user unit directory, reload user systemd, and `enable --now` only that unit.
6. Perform one controlled `systemctl --user restart xot-renderer.service`.
7. Verify one healthy XOT container, stable control Compose label, restart policy, effective cutoff, fresh heartbeat, and unchanged Hermes.
8. Set render mode enabled and observe at least two renderer polling/heartbeat intervals. No pre-cutoff row may move.
9. Leave X cron paused and X setting false for the recovery phase.

Closeout state: `RENDER_ONLY_AUTOMATION_ACCEPTED` only if the worker, renderer, hard no-post hold, backlog boundary, canary, and persistence checks all pass. Otherwise report the exact narrower state, such as `DEPLOYED_PAUSED` or `BLOCKED_BEFORE_LIVE`.

## Live acceptance evidence

The implementation ledger must contain redacted, append-only receipts for:

- exact linked target identity check result without exposing credentials;
- pre/post function version inventory;
- cron names/IDs and active-state transitions;
- exact generated migration version and semantic readback;
- runtime-control row cardinality and non-secret values;
- relevant secret **names/states only**, never values;
- x/video settings before and after with unrelated fields preserved;
- pre-cutoff backlog aggregates before/after;
- post-cutoff canary transition and artifact metadata;
- provider-block negative tests and Telegram/X/delivery aggregates;
- Lightning image tag, platform, Compose path label, limits, restart policy, health, heartbeat, and unit state;
- Hermes before/after state and restart counters;
- final accepted/blocked state and exact next action.

Do not use row or file hash matching as an acceptance substitute. Use semantic readbacks, counts, state transitions, versions, and object-size evidence.

## Kill conditions

Immediately set render mode disabled, stop automatic polling, and pause worker/X crons if any condition occurs:

- any row with `queued_at <= T` is claimed, locked, requeued, attempted, or updated;
- more than the one controlled canary is claimed during the canary gate;
- runtime controls are missing, duplicated, malformed, or not the production blocked row;
- `ALLOW_EXTERNAL_POSTING` is true or environment identity is not production;
- `x_posting_config.enabled` becomes true or X cron resumes;
- a Telegram/X provider request, delivery claim, message ID, X post ID, or posted timestamp appears;
- render completion creates/revives a delivery job while blocked;
- any deployed function is still the old unguarded version after the cutover gate;
- RPC signatures/semantics differ from the compatibility matrix;
- another renderer heartbeat becomes fresh;
- the XOT container is unhealthy, OOM-killed, bound beyond loopback, or runs from the transient control path;
- Hermes changes state/restart count or shows material distress;
- a secret appears in logs, chat, Git, a provider prompt, or a receipt.

## Rollback

Rollback is operational and forward-safe. Do not reverse/drop the narrow DDL during an incident.

1. Set/read back `video_render_config.mode=disabled`.
2. Set `RENDER_POLLING_ENABLED=0`; stop the XOT unit/container if runtime behavior is suspect.
3. Keep the runtime-control row `posting_mode=blocked`.
4. Keep `ALLOW_EXTERNAL_POSTING=false`.
5. Keep `x_posting_config.enabled=false`.
6. Pause both worker and X crons with `cron.alter_job`.
7. Allow only a known safe in-flight canary to finish; otherwise let its lease expire for explicit repair.
8. Leave `runtime_controls`, the cutoff RPC, and release predicate in place. Do not drop them or move `T` backward.
9. Prefer a forward fix to the guarded Edge hotfix. Do not automatically restore the old unguarded bundle. If an old bundle must be restored for diagnosis, keep the worker/X crons paused and renderer disabled for the entire interval.
10. Select only a renderer image compatible with live terminal RPCs and start it paused from persistent source. If no compatible image exists, remain `DEPLOYED_PAUSED`.
11. Do not restart Docker, Tailscale, or Hermes; do not prune images/volumes.

Rollback acceptance is: 0 running renders, old cohort unchanged, no provider/post delta, posting controls blocked, worker/X crons paused, and Hermes unchanged.

## Blockers and dependencies

- Full candidate production release is explicitly blocked/deferred. It requires a separate reviewed Telegram/B3/B4/X/E10 migration rollout, compatible current functions, migration-history reconciliation, and its own canaries.
- The compatibility hotfix must be validated against exact live signatures. A partial or ambiguous signature state blocks deployment.
- A safe spoken-English source must exist. If not, live canary is blocked; do not substitute a silent/no-audio or known misclassified short clip.
- Lightning auto-sleep may prevent continuous processing while the Studio is stopped. The service is restart-persistent when the Studio runs or wakes. Changing an always-on/auto-sleep account setting may affect cost and needs a separate user decision.
- Edge secret values and renderer provider keys stay in approved secret stores. Missing credentials block live rendering but do not justify reading Hermes configuration.
- Ephemeral Supabase branching must be available or a local disposable production-shaped database must pass. If neither validation lane is available, production migration/function deployment is blocked.

## Effort estimate

Assuming credentials, the linked project, and an ephemeral/local validation lane remain available:

| Slice | Likely wall time |
| --- | ---: |
| Renderer cutoff code/tests and narrow migration | 2-3 hours |
| Live-compatible Edge backport and focused tests | 3-5 hours |
| Ephemeral/local migration and function validation | 1-2 hours |
| Protected production hold/function deployment | 1-2 hours |
| Canary, artifact checks, and backlog observation | 1-3 hours |
| Lightning persistence promotion and restart drill | 1 hour |
| Total | 9-16 hours |

External code/test workers can reduce hands-on coding time, but protected database, Edge deployment, canary observation, and final acceptance remain serial Luna-owned gates.

## Non-goals and forbidden moves

- No PR #69 or #70 mutation.
- No `main`, merge, rebase, or web/Vercel deployment.
- No full candidate migration-chain replay.
- No B3/B4/role/RLS/Auth release in this recovery.
- No separate paid Supabase project.
- No Telegram or X test post.
- No release of held delivery jobs.
- No processing, requeueing, tagging, deleting, or repairing the 77-row backlog.
- No language-classifier redesign; Nynorsk/short-clip quality is later work.
- No Render-host change.
- No Hermes file, env, container, process, service, port, or Cloudflare change.
- No Docker daemon/Tailscale restart or broad cleanup.
- No unrelated terminal, worktree, branch, or user-work change.
- No secrets in Git, chat, receipts, external-worker prompts, or shell output.

## Implementation-orchestrator handoff

### Phase owner and route

- Implementation owner/integrator/validator/final acceptor: GPT-5.6 Luna, High reasoning.
- Strict phase route passes only if Luna High owns protected database/Edge/Lightning actions, integration, validation, rollback, and final acceptance.
- No implementation goal is pre-created by this plan because the user did not explicitly request one.

### Quality-orchestration assignments

After fresh provider catalog and canary checks, delegate only bounded S0-S2 work with explicit non-overlapping ownership:

1. Devin CLI `swe-1-7`, Max, Free if still eligible: renderer cutoff implementation and focused Node tests. Harness flag: `--permission-mode dangerous`.
2. Devin CLI `glm-5-2`, High, Free if still eligible: Edge guard compatibility tests, migration contract tests, and independent review. Harness flag: `--permission-mode dangerous`.
3. Qualified Antigravity, highest supported effort, only for an additional bounded alternate review/patch if task-fit and policy gates pass. Harness flag: `--dangerously-skip-permissions`.
4. If a route is unavailable/non-Free/fails its fresh canary, settle it and use the declared Antigravity -> Command Code (`--yolo`) -> Codex fallback matrix. Zro routes remain disabled.

High autonomy removes prompts only. It does not expand file ownership, secrets access, live database/host access, destructive authority, deployment authority, or acceptance authority. External workers receive no credentials, private content, production dumps, or live mutation tasks.

### Exact first dispatch

Start with two concurrent, disjoint local slices:

- Slice A owns only `services/video-renderer/src/{config,server,renderer}.js`, the three focused renderer test files, and renderer deployment docs/templates. Acceptance: all renderer tests pass and invalid cutoff states make zero claim RPCs.
- Slice B owns only a task-owned compatibility hotfix worktree's shared posting guard, Edge tests, and a draft of the narrow migration. Acceptance: all blocked-path fetch/mutation spies stay at zero and the migration passes disposable legacy/B4 contract checks.

Luna then integrates, re-runs every focused test, reviews the full diff, and performs Phases 4-7 serially. Do not let an external worker deploy functions, apply SQL, set secrets, SSH to Lightning, touch Hermes, or declare acceptance.

## Planning orchestration receipts

### Main planning owner

- Role/model/effort: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable.
- Scope: effort gate, repo/live evidence synthesis, architecture choice, phase decomposition, stop gates, acceptance, rollback, and saved plan.
- Result: accepted. Strict planning route passed.

### Worker: `backlog_claim_contract`

- Role/model/effort: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable.
- Scope: 77-row isolation, cutoff/lane alternatives, legacy/B4-compatible claim wrapper, tests, canary, rollback.
- Result: accepted. Its timestamp-cutoff and atomic by-ID delegation design is the queue contract in this plan.
- Subagents: none.

### Worker: `lightning_ops_plan`

- Role/model/effort: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable.
- Scope: Lightning runtime, stable control/source paths, persistence, Hermes boundary, canary evidence, restart drill, and host rollback.
- Result: accepted and integrated.
- Subagents: none.

### Worker: `release_hold_trace`

- Role/model/effort: `planner`, GPT-5.6 Sol, Max reasoning; Fast not applicable.
- Scope: Telegram/X release paths, runtime controls, Edge versions/dependencies, retry paths, crons, live negative tests, and rollback.
- Result: evidence and last-moment guard design accepted. Its proposed full migration replay was rejected as too broad for recovery. Its suggestion to remove all `deliver` jobs was reworked because that would also remove the live automatic render-enqueue path; this plan uses post-render early parking instead.
- Subagents: none.

### Overall agent usage

- Planning agents used: four total: one Sol Max owner and three Sol Max read-only workers.
- No implementation, data-worker, Computer Use, or external-provider agent was used in the planning phase.
- Strict planning route: passed.
