# XOT Lightning Renderer Recovery Implementation Plan

## Planner Metadata

- Repository/path: `/Users/stevmq/Finalized XOT`
- Branch: `codex/xot-full-closure-candidate`
- Planning anchor: `f5992871296aba39a8b0cc23b46aeebca1489fbd`
- Date: 2026-08-24
- Target host: Tailscale SSH alias `lightning-studio`, live node `lightning-studio-1`
- Product surface: XOT video renderer, its Supabase queue contract, and one dedicated Docker Compose runtime on the existing Lightning Studio
- Planning mode: full worker run; three planning agents total: one planning owner and two read-only planning helpers
- Planning route: `planner` / GPT-5.6 Sol / Max; Fast not applicable
- Matched Max triggers: production recovery; three independent surfaces with cross-surface cutover tradeoffs; conflicting current-candidate versus production-schema evidence; implementation handoff must prevent an incompatible queue consumer
- Rejected Max triggers: the user did not explicitly request Max; plan length and worker count were not used as triggers
- Credit rationale: Max is required by the production and schema-compatibility risk, not by document size
- Worker scopes:
  - Planning owner: renderer architecture, source compatibility, deployment sequence, acceptance, rollback, and synthesis
  - `lightning_host_plan`: live host, persistence, Docker/Compose, ports, resources, Hermes isolation, and Lightning lifecycle
  - `lightning_renderer_plan`: renderer source, queue/RPC compatibility, secrets boundary, health/heartbeat semantics, and canary gates
- Repo instructions: no repo-local `AGENTS.md` was found. The user-provided AGENTS instructions, root README, renderer README, package scripts, operations docs, and existing production replan govern this work.
- References inspected:
  - `README.md`
  - `package.json`
  - `services/video-renderer/README.md`
  - `services/video-renderer/Dockerfile`
  - `services/video-renderer/docker-compose.yml`
  - `services/video-renderer/package.json`
  - `services/video-renderer/src/config.js`
  - `services/video-renderer/src/server.js`
  - `services/video-renderer/src/renderer.js`
  - `services/video-renderer/src/settings.js`
  - renderer tests and root renderer contract checkers
  - `docs/plans/2026-08-24-xot-p4-renderer-local-build-receipt.json`
  - `docs/plans/2026-08-24-xot-production-reconciliation-replan.md`
  - `docs/plans/2026-08-24-xot-production-reconciliation-t3-receipt.json`
  - `docs/operations/function-auth-matrix.md`
  - `docs/operations/release-runbook.md`
  - live read-only Tailscale/SSH host evidence captured on 2026-08-24
- Current official sources:
  - Lightning AI environment persistence: <https://lightning.ai/docs/overview/ai-studio/environment-persistence>
  - Lightning AI start and stop a Studio: <https://lightning.ai/docs/overview/ai-studio/start-and-stop-studio>
  - Docker Compose services reference: <https://docs.docker.com/reference/compose-file/services/>
- Assumptions:
  - The user's current message authorizes bounded renderer source/config work, installation of one XOT-owned container on `lightning-studio-1`, one isolated Preview render, and a controlled renderer cutover. It does not authorize PR #69, `main`, merge, frontend/function/database migration release, Telegram/X posting tests, Docker daemon changes, Hermes changes, or destructive cleanup.
  - No new Lightning Studio or paid resource will be created.
  - XOT-owned secrets can be obtained through an approved account source without reading or reusing Hermes configuration. If the required renderer credentials cannot be obtained, host preparation may continue, but live staging/production execution is blocked.
  - The existing unfinished blocked goal prevents a new goal. This plan and `docs/plans/2026-08-24-xot-lightning-renderer-recovery-implementation-ledger.jsonl` are the continuity mechanism.

## Executive Goal

Restore useful XOT renderer service on `lightning-studio-1` without disturbing Hermes.

The finished recovery has one dedicated, resource-limited, loopback-only Docker Compose container. Its source and bootstrap files live on Lightning persistent storage. The exact AMD64 image is proven first against isolated Preview/staging. Production queue polling begins only after the live Supabase renderer RPC contract is matched to the correct source, the queue is paused, all other renderer consumers are stale or stopped, health and heartbeat agree, and one bounded no-post canary passes.

This plan deliberately separates two meanings of “working”:

1. **Candidate working on Lightning:** the current candidate builds for AMD64 and completes the accepted Preview/staging renderer path on the new host.
2. **Production functionality restored:** one schema-compatible renderer is the only production consumer, completes a real safe render, and then resumes the approved queue mode.

The current candidate must not be allowed to poll the current production queue until the B4 claim-fencing RPC contract is proven present. If production remains on the legacy renderer RPCs, immediate recovery uses the last explicitly proven compatible source as a temporary bridge.

## Source Of Truth Contract

- Intent: run one XOT renderer container on the existing Lightning Studio while Hermes remains an independent host service.
- Current behavior: the Render-hosted production renderer is offline or stale. The local accepted Preview renderer is healthy but its accepted image is `linux/arm64`. Lightning is `linux/amd64`, has no XOT container or image, and port `8787` is occupied.
- Expected outcome: one `xot-renderer` Compose project on Lightning, bound only to `127.0.0.1:8797`, with concurrency 1, fixed resource limits, healthy process state, a fresh unique Supabase heartbeat, a completed safe render artifact, and one active production consumer.
- Truth owner:
  - Renderer source and tests: the exact Git source selected by the compatibility gate.
  - Runtime: Docker Compose project `xot-renderer` on `lightning-studio-1`.
  - Runtime persistence: `/teamspace/studios/this_studio/xot-renderer`.
  - Queue and heartbeat truth: the approved Supabase target's `video_renders`, `video_renderer_heartbeats`, `settings`, `jobs`, `deliveries`, `pipeline_events`, and Storage object metadata.
  - Hermes truth: its existing user services and ports. They are observation-only in this task.
- Contract boundary:
  - Allowed repo surfaces: `services/video-renderer/**`, focused renderer checkers/tests, this plan, and its append-only implementation ledger.
  - Allowed host surfaces: `/teamspace/studios/this_studio/xot-renderer/**`, one `xot-renderer` Compose project, and one XOT-owned user startup unit or Lightning startup hook after lifecycle verification.
  - Allowed production mutation: renderer mode pause/readback, one exact no-post renderer canary, renderer mode enable/readback, and rows/artifacts normally produced by that canary and the resumed renderer queue.
- Displaced path:
  - The stale Render-hosted renderer is demoted from active ownership. It is not modified in this task because it is offline/unavailable.
  - The local `xot-staging-1` container remains a Preview/staging service and is not repurposed or stopped merely to create the Lightning runtime.
- Cutover:
  1. Prove the current candidate on Lightning against isolated Preview/staging with polling off.
  2. Classify the live production renderer RPCs.
  3. Select the fenced candidate only when B4 semantics are present; otherwise select the legacy-compatible bridge.
  4. Set/read back production renderer mode `disabled` before starting a production-connected container.
  5. Prove paused heartbeat, no claims, resource stability, and exclusive renderer identity.
  6. Enable the bridge only long enough to observe one selected no-post poller claim, immediately return the global mode to disabled, and let that single in-flight render reach terminal state.
  7. Enable polling only after the canary passes and exclusivity is rechecked.
- Acceptance evidence:
  - exact source commit and Docker image identity;
  - `linux/amd64` image and runtime inventory;
  - Compose configuration and actual container limits;
  - localhost-only port evidence;
  - container health plus fresh database heartbeat with `last_error IS NULL`;
  - one Preview/staging completion from the Lightning image;
  - one safe production completion with output Storage evidence and no delivery/posting delta for that canary;
  - exclusive production renderer heartbeat and subsequent queue activity or an explicit empty-queue result;
  - Hermes active before and after, without restart-count or resource regression.
- Evidence lane: append-only `docs/plans/2026-08-24-xot-lightning-renderer-recovery-implementation-ledger.jsonl`, with redacted host and database receipts. Raw logs, secrets, private URLs, and content stay outside Git.
- Kill criteria:
  - renderer RPC signatures are partial, ambiguous, or incompatible with the selected source;
  - any unexpected renderer heartbeat becomes fresh before or during cutover;
  - polling occurs while the global mode or host breaker is meant to be disabled;
  - Hermes becomes inactive, restarts, loses its ports, or shows material resource distress;
  - the container binds beyond loopback, exceeds its limits, restarts, or becomes unhealthy;
  - a claim, lease, provider result, output upload, completion RPC, or delivery outcome is ambiguous;
  - the canary would cause Telegram/X posting or an unbounded backlog drain;
  - a secret appears in output, a tracked file, an external-worker prompt, or a receipt.
- Forbidden moves:
  - no Hermes file, environment, process, service, port, or Cloudflare configuration change;
  - no Docker daemon restart, Docker configuration change, broad prune, or deletion of unrelated images/volumes/containers;
  - no Tailscale restart or network reconfiguration;
  - no `0.0.0.0` renderer bind, Docker socket mount, or shared Hermes mount;
  - no production database migration, RLS/Auth change, function deploy, Vercel action, merge, `main`, PR #69, or external posting test;
  - no secret values in Git, chat, Orca, command output, or model delegation;
  - no candidate production polling on an unproven legacy schema;
  - no two active production renderer consumers.

## Native Planning Superiority

- Codex Native baseline: a generic plan would likely “copy the Docker image, start Compose, and test `/health`.” That would miss the CPU architecture difference, Lightning persistence behavior, the occupied host port, `/health`'s weak database signal, the stale old consumer, and the current candidate's incompatible B4 RPC requirements.
- What this orchestrated plan does better:
  - anchors the exact repo, branch, host, ports, architecture, persistent path, and active Hermes boundary;
  - separates candidate validation from immediate legacy-compatible production recovery;
  - uses live function signatures, not migration names or broad hash matching, to select the source;
  - defines disabled-first boot, a one-claim no-post poller canary, exclusive-consumer cutover, and rollback;
  - accounts for Lightning image persistence and auto-sleep instead of treating one successful `docker compose up` as durable service;
  - assigns external models only bounded non-secret candidate work while Luna owns protected execution and acceptance.
- User-specific context used: prefer one container over a separate Linux user; preserve Hermes; avoid over-engineered ceremony and broad hash matching; maximize safe Devin/Antigravity use; keep Codex as integrator/acceptor; use the native browser only when UI interaction is required.
- Superiority score target: 5/5.
- Proof artifacts: this plan, the implementation ledger, two independent planning-helper receipts, live host evidence, renderer source/RPC inspection, exact image/runtime receipts, Preview result, production canary result, and final cutover/rollback receipt.

## Orchestration Decision

- Mode: full worker run.
- Worker count: three planning agents total: one planning owner and two read-only helpers.
- Decision reason: host lifecycle/isolation, renderer source/runtime, and Supabase compatibility/cutover are independent evidence surfaces. A wrong conclusion on any one can break Hermes or leave a claimed render without a valid terminal RPC.
- Independent surfaces:
  1. Lightning host, persistence, resources, ports, Compose, and Hermes boundary.
  2. Renderer code, image architecture, health/auth/polling behavior, and deployment assets.
  3. Supabase RPC compatibility, queue pause, canary, exclusive cutover, and rollback.
- Workers used or skipped: the two helpers covered host and renderer/queue evidence. No duplicate planning worker was added. No external provider was used for planning because planning ownership is GPT-5.6 Sol Max.
- Thread decision: no visible thread. This is one bounded recovery program with one Luna integrator.
- Token/context rationale: two focused helper receipts reduced duplicate source and host inspection while the planning owner retained all synthesis and decisions.
- Reconsider trigger: add a new Sol Max planning pass only if live production exposes a third renderer RPC state, Lightning persistence differs from current official guidance, the target host changes, or the task expands into migrations/functions/frontend.

## Background Browser Lane

- Needed: conditional.
- Target/surface: Lightning Studio settings for auto-sleep/start behavior after the CLI runtime is healthy.
- Route: native Computer Use agent, GPT-5.6 Sol, Low reasoning, Fast.
- Safety boundary: inspect current setting first. Do not open Chrome, Safari, Firefox, or Comet. Do not change a billing-affecting always-on or auto-sleep setting unless the user's current authorization clearly covers the cost or the user confirms it.
- Required receipt: observed setting, screenshot or operator-visible state, action taken or not taken, billing implication, and no other Studio setting changed.
- Stop condition: setting is known and either already compatible, changed with authority, or recorded as the exact persistence blocker.

## Research And Evidence Findings

### Live Lightning host

Read-only checks on 2026-08-24 established:

| Fact | Current evidence | Planning decision |
| --- | --- | --- |
| Host | `lightning-studio-1`, reachable through Tailscale SSH alias `lightning-studio` | Use the existing node; do not create another paid Studio |
| Architecture | `x86_64`; Docker reports `linux/amd64` | Build native AMD64 images; do not reuse the accepted ARM64 image |
| Capacity | 4 CPUs; 15 GiB RAM with about 12 GiB available; 351 GiB disk free | One concurrency-1 CPU renderer is viable for a bounded canary; enforce limits and measure under render |
| Docker | Docker 28.0.1; Compose 2.27.0; cgroup v2; no current containers or XOT volumes | Use one named Compose project; no daemon changes |
| Ports | `8797` free; `8787` occupied; Hermes also uses `8644` and `9121` | Bind `127.0.0.1:8797:8787`; do not inspect or move the process on 8787 |
| Hermes | three existing user services active/enabled; Hermes runs outside Docker | Observe before/after only; do not restart, stop, read private state, or reuse its configuration |
| Persistent storage | Lightning documents `/teamspace/studios/this_studio` as the persistent surface | Use `/teamspace/studios/this_studio/xot-renderer`, not `/opt/xot-renderer` |
| Lifecycle | Studio stop/auto-sleep can remove running state; Docker images are not the durable source | Persist source/bootstrap and add exactly one restart path after validation |

Adopt: persistent source, one Compose project, loopback bind, cgroup limits, healthcheck, graceful stop, log rotation, and a rebuildable startup path.

Adapt: Docker images are runtime cache, not the only rollback asset. Keep the exact recovery and rollback source trees on persistent storage so the selected image can be rebuilt.

Avoid: `/opt`, root-wide Docker changes, broad cleanup, shared Hermes mounts, host networking, and multiple supervisors.

### Renderer source and runtime

- The accepted local Preview image is `linux/arm64`, about 460 MB, and was built from renderer source unchanged since `cf6e76bfec637d5e35635e1079357c70914ee6f3`. Current branch commits after `040fd0e99f9019997debab4bdc9466d07c98c2d0` are documentation/ledger changes for the renderer path.
- Current Compose already uses host port 8797, internal port 8787, concurrency 1, a healthcheck, and a dedicated temp volume. It lacks the Lightning-specific persistence/bootstrap and full host resource limits.
- Required startup secrets are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `DEEPGRAM_API_KEY` for the default provider. `VIDEO_RENDERER_TOKEN` is required for authenticated HTTP dispatch but not for poller-only operation.
- There is no approved renderer-specific production env file ready for transfer. The implementation must provision secrets from XOT-owned sources through a non-logging path. Hermes configuration is never a source.
- Current `/health` can return HTTP 200 even if heartbeat persistence fails. Container health is therefore process evidence only. A fresh `video_renderer_heartbeats` row with the expected stable `RENDERER_ID` and `last_error IS NULL` is required database evidence.
- Current candidate starts the polling timer automatically. The implementation should add an explicit fail-closed `RENDER_POLLING_ENABLED` runtime breaker for the current/future candidate, default it to disabled, keep heartbeat active, expose the state in health/heartbeat metadata, and test that disabled mode cannot claim.
- The legacy production bridge does not have that source breaker. Its disabled-first control is the production `settings.video_render_config.mode = disabled` row, read back before container start. Its canary uses a 30-second poll interval: enable mode for one selected safe claim, immediately disable/read back mode when that claim appears, and allow only that in-flight render to finish.

### Production schema compatibility

The current candidate and current production cannot be assumed compatible:

- Current candidate `services/video-renderer/src/renderer.js` completes, blocks, and fails with `claim_token` and `claim_generation`.
- Those arguments are introduced by `supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql`.
- The current production reconciliation says the 16-file forward set, including B4, has not yet been semantically classified/applied for release. An unknown or partial B4 state is not permission to claim a row.
- A candidate renderer on a legacy production schema could claim a row and then fail to call the terminal RPC. This would leave a running lease until repair/reclaim and does not restore functionality.

Use this live compatibility matrix before any production-connected start:

| Live production RPC state | Allowed renderer source | Action |
| --- | --- | --- |
| Exact fenced claim/terminal signatures, including token and generation, are present and coherent | final current candidate | Use the candidate path after its Lightning Preview proof |
| Exact legacy claim/terminal signatures are present and fenced signatures are absent | `3a9241b9c7563b8eb95146d54022eb535348dd41` | Use as temporary production recovery bridge |
| Partial, both, missing, or ambiguous signatures | none | Stop. Do not claim. Return to database reconciliation |

Prebuild the legacy rollback source `34d612923fc8783789ff87c2377aba260584deb2`. It is a rollback asset for the legacy bridge, not evidence that the old Render host can be recovered.

The bridge is explicitly temporary. It restores production renderer service before the full B4 release. Before B4 is later applied, pause the queue and stop/disable the bridge. After B4, deploy the current fenced candidate and update the persistent startup selection. Never let the bridge auto-restart against the fenced schema.

## Current State

### Confirmed

- Repo is on `codex/xot-full-closure-candidate`, tracking its remote, and was clean at planning start.
- Current accepted Preview renderer is healthy locally on `127.0.0.1:8797` but is ARM64.
- Production renderer heartbeat/host evidence is stale or offline.
- Lightning is online and has enough initial headroom for one bounded CPU render.
- Hermes is active outside Docker and ports 8787, 8644, and 9121 must remain untouched.
- Lightning port 8797 is free.
- `/teamspace/studios/this_studio` is the persistent deployment surface.
- The current candidate depends on fenced B4 terminal RPCs; current production compatibility is not yet proven.
- The latest accepted production snapshot had zero running jobs and zero expired leases, `runtime_controls` absent, posting enabled, and a stale renderer. Pending `video_renders` counts and the current `video_render_config.mode` were not captured and must be read live before start.
- The existing planning goal is blocked/unfinished, so no new goal can be created.

### Unknown until execution

- Exact current production renderer RPC signatures and migration effects.
- Current `video_render_config.mode`, queue counts, expired leases, safe no-post fixture, and fresh heartbeat set at cutover time.
- Availability of the production renderer service-role credential through an approved XOT source.
- Current Lightning auto-sleep setting and whether changing it increases cost.
- Real render duration, memory, CPU, swap, temp usage, and provider behavior on the 2-CPU/6-GiB limit.
- Whether a safe production queued row exists whose post cannot be released to Telegram/X.

## Future State

```text
Lightning persistent storage
/teamspace/studios/this_studio/xot-renderer
  releases/
    candidate-<sha>/      current fenced source
    recovery-3a9241b9/    legacy production bridge source
    rollback-34d61292/    legacy rollback source
  deploy/
    docker-compose.lightning.yml
    bootstrap.sh
    xot-renderer.service
  runtime/
    renderer.env          0600, secret, never logged or committed
    control.env           selected image/source, no secret values in receipts

one Compose project: xot-renderer
  one container
  linux/amd64
  127.0.0.1:8797 -> 8787
  cpus: 2
  memory: 6 GiB
  shm: 1 GiB
  pids: 512
  concurrency: 1
  dedicated network and temp volume
  no Docker socket or Hermes mounts

Supabase
  video_render_config.mode controls the legacy bridge
  RENDER_POLLING_ENABLED controls the fenced candidate
  one stable RENDERER_ID
  one fresh heartbeat
  one compatible queue consumer
```

The production state reported at closeout must be one of:

- `RESTORED_CURRENT_CANDIDATE`: fenced production RPCs proved, current candidate completed the production canary, and it is the exclusive consumer.
- `RESTORED_LEGACY_BRIDGE`: production remains legacy, the bridge completed the safe canary, and it is the exclusive consumer. B4/current-candidate cutover remains a named later dependency.
- `DEPLOYED_PAUSED`: host and image are healthy with a fresh paused heartbeat, but a safe canary or credential/cutover gate blocked queue enablement.
- `BLOCKED_BEFORE_PRODUCTION`: candidate is proven in Preview, but production schema/credentials/settings are ambiguous.

Do not collapse these into “done.”

## Non-Goals

- No separate Linux user.
- No second Lightning Studio.
- No Render-host recovery attempt or dependency on that host returning.
- No production migration, B4 apply, schema repair, RLS/Auth change, function deploy, Vercel deployment, merge, or frontend work.
- No registry program or broad supply-chain project. Host-local images plus persistent exact source are sufficient for this recovery bridge; the broader `PROD-04` immutable-registry gate remains open.
- No Telegram/X test post, delivery backlog drain, or scheduler change outside the renderer mode.
- No Hermes inspection beyond bounded service/port/resource state.
- No new monitoring platform.
- No broad repository refactor or unrelated test cleanup.

## Phase Plan

### Phase 0 — re-anchor, ledger, and live compatibility gate

1. Recheck branch, HEAD, worktree, local Preview container, host identity, ports, Hermes service state, Docker version, and resources.
2. Create the append-only implementation ledger. Record the plan path, base commit, dirty boundary, target alias, allowed/forbidden surfaces, and current runtime inventory.
3. Read production renderer facts without mutation:
   - exact claim/complete/fail/block function signatures;
   - renderer mode JSON while preserving all other fields;
   - queue counts by status and expired running leases;
   - fresh/stale heartbeat rows by `renderer_id`;
   - oldest eligible rows joined only to delivery-control fields, not raw content.
4. Select `fenced candidate`, `legacy bridge`, or `blocked` from the compatibility matrix. Record the decision before a production credential is installed on the host.
5. Recheck that no new paid resource is required.

Pass: the source/DB compatibility state is exact, target is exact, and no production row was claimed.

Stop: partial function state, wrong target, fresh unknown renderer, unreviewed setting shape, or missing exact source commit.

### Phase 1 — focused candidate implementation and quality routing

Implement only the reusable current-candidate safety/deployment gap:

1. Add `RENDER_POLLING_ENABLED` to the current renderer runtime contract.
   - Default: disabled.
   - Disabled: do not start a poll timer and make `pollOnce()` return before settings reads or claim RPCs.
   - Heartbeat timer and `/health` remain active.
   - Health and heartbeat metadata state whether polling is enabled.
   - Only explicit accepted values enable polling; malformed values fail closed.
2. Add focused tests for:
   - default disabled;
   - malformed disabled/fail-closed behavior;
   - disabled runtime schedules heartbeat only;
   - disabled `pollOnce` makes zero claim calls even when database mode is enabled;
   - explicit enabled mode preserves the current capacity/claim behavior;
   - health/heartbeat report the effective polling state.
3. Add a Lightning-specific Compose/deploy bundle, or evolve the existing Compose file without breaking local Preview:
   - `platform: linux/amd64`;
   - Compose project `xot-renderer`;
   - image selected by a non-secret control value;
   - loopback port 8797 only;
   - `cpus: 2`, `mem_limit: 6g`, `shm_size: 1g`, `pids_limit: 512`, `init: true`;
   - concurrency 1;
   - healthcheck and 35-second stop grace;
   - `json-file` logs, 10 MiB x 3 files;
   - dedicated network and temp volume;
   - no Docker socket, host network, or Hermes path.
   - restart policy defaults to `no` during staging, paused production boot, and canary; switch to `unless-stopped` only after final acceptance.
4. Add a short persistent bootstrap and one user-unit template. The canonical files live under the repo/deploy bundle and are copied to Lightning persistent storage. The bootstrap may rebuild a missing selected image from its persistent source, but it must not pull an unqualified tag, prune, restart Docker, or touch unrelated projects.
5. Document the legacy bridge exception: database mode is its pause control because the old source does not have `RENDER_POLLING_ENABLED`.

Quality-orchestration assignments, after live catalog/cost/canary checks:

- Devin `swe-1-7` Max, Free: bounded candidate implementation for polling-breaker tests or Lightning deploy assets, with exact disjoint file ownership and no host, secret, Supabase, or production access.
- Devin `glm-5-2` High, Free: read-only source/compatibility/test challenge, or a disjoint documentation/test slice. It must not duplicate the writer.
- Antigravity `gemini-3.7-flash-high` High: redacted independent Compose/bootstrap review if the exact model and effort are attested. No secret or private host data.
- Command Code DeepSeek Flash High: fallback only after the declared predecessor is settled.
- Luna High: all integration, shared contracts, host execution, secret handling, production reads/writes, validation, and acceptance.

Pass: focused tests and existing renderer gates pass; the actual diff is accepted by Luna; no external delegate touched a protected surface.

### Phase 2 — build and prove the current candidate on Lightning Preview

1. Copy bounded exact source into the persistent candidate release directory. Do not copy `.env`, `.git`, `node_modules`, unrelated repo files, or local artifacts.
2. Build natively on Lightning with `--platform linux/amd64` and an exact commit-qualified tag/OCI revision label.
3. Run image inventory checks without secrets:
   - OS/architecture;
   - non-root runtime user;
   - Node, ffmpeg, ffprobe, Python/OpenCV, Tesseract, font inventory;
   - configured healthcheck and port.
4. Provision a Preview/staging renderer env through an approved non-logging route, mode 0600, with a unique staging renderer ID and polling disabled.
5. Start the candidate through the Lightning Compose file. Prove:
   - only `127.0.0.1:8797` is bound;
   - actual cgroup limits match Compose;
   - container is healthy with zero restarts;
   - database heartbeat is fresh, unique, and error-free;
   - two poll intervals produce zero claims while polling is disabled;
   - missing/invalid HTTP token returns 401.
6. Run exactly one approved Preview/staging render by authenticated targeted dispatch. Posting remains blocked in Preview. Verify the joined render row, lease/fence generation, output Storage object, dimensions/file size, heartbeat counters, workflow/pipeline evidence, and no production writes.
7. Measure duration, peak CPU/memory, swap delta, temp/disk use, restart count, and Hermes state. Stop and rework only if the 2-CPU/6-GiB envelope is inadequate.
8. Stop and remove the staging candidate container after evidence capture. Preserve its image/source as a build artifact. Do not stop the existing local `xot-staging-1` unless it is the explicit conflicting owner of the selected fixture.

Pass: the current candidate completes the real isolated renderer path on AMD64 and leaves no Lightning staging container or staging secret active.

### Phase 3 — prepare compatible production and rollback images

Run this in parallel with non-conflicting Phase 2 validation after Phase 0 selects the expected production path.

1. Persist exact source archives for:
   - recovery bridge: `3a9241b9c7563b8eb95146d54022eb535348dd41`;
   - rollback: `34d612923fc8783789ff87c2377aba260584deb2`.
2. Build both as `linux/amd64` images with commit-qualified tags and revision labels.
3. Run their own renderer test suites and no-secret runtime inventories.
4. Run a no-upload preview render inside the selected production image. Prefer a bounded approved video fixture. The output stays in a task-owned temporary directory and must prove ffmpeg/OpenCV/fonts plus the expected transcription/translation path without touching the queue.
5. Keep exact source for both on persistent Lightning storage. Keep both images; do not prune them.

Pass: selected recovery and rollback images are rebuildable from persistent source and the recovery image completes a no-upload host render.

If Phase 0 proves fenced production RPCs, the current candidate replaces the bridge in this phase and the legacy images remain optional rollback evidence only. Do not deploy a legacy image against fenced production.

### Phase 4 — disabled-first production boot

1. Refresh production function signatures, mode, queue/lease counts, heartbeats, and safe-fixture candidates immediately before mutation.
2. Set only `video_render_config.mode` to `disabled` while preserving the rest of the JSON. Read it back. If it is already disabled, do not rewrite it.
3. Wait for or reconcile any active renderer lease. Do not start a second consumer while a valid running lease is held by another renderer.
4. Confirm all renderer heartbeats except the planned new ID are stale. Record the stale old Render identity; do not delete its row.
5. Provision `/teamspace/studios/this_studio/xot-renderer/runtime/renderer.env` from XOT-owned sources, mode 0600. Use the stable production ID `lightning-xot-1`. Set `POLL_INTERVAL_MS=30000` for the legacy bridge canary so the operator can return mode to disabled after the first observed claim. Do not configure direct Edge dispatch URL/token in Supabase during this recovery; keep Edge Functions in poller-only mode.
6. Start exactly one container with the schema-compatible image and global mode disabled.
7. Prove for at least three 30-second heartbeat intervals:
   - Compose health is healthy;
   - `/health` body shows no renderer error and, for current candidate, polling disabled;
   - the database heartbeat is fresh, paused, unique, and `last_error IS NULL`;
   - no render claim/attempt/lease delta;
   - restart count stays zero;
   - actual CPU/memory/PID limits match;
   - port remains loopback only;
   - Hermes services and ports remain unchanged.
8. Run negative auth checks only. Do not send a render ID until the canary row is selected.

Pass: production-connected renderer is healthy and paused with zero claims.

### Phase 5 — one no-post production poller canary and exclusive cutover

1. Select the exact oldest eligible queued render that the poller would claim. Its joined post must not satisfy `_video_render_should_release` and it must have no pending/posted delivery. Use IDs/status/control fields only; do not export content. If an earlier eligible render is deliverable, the canary is not bounded and must stop.
2. Record before-state for the render, media object, post delivery controls, matching jobs/deliveries, pipeline events, output object path, queue counts, and heartbeat counters.
3. Confirm the bridge poll interval is 30 seconds, global renderer mode is disabled, the container is paused, and no other renderer heartbeat is fresh.
4. Set/read back renderer mode `enabled`. Watch the heartbeat/row until the selected render is claimed by `lightning-xot-1`. Immediately set/read back mode `disabled`. Because the bridge processes one row at a time, the in-flight render may finish while the next poll sees disabled mode.
5. Require exactly one claim. Do not retry an unknown result. Observe until terminal or until the existing render deadline/lease contract proves a blocker.
6. Require:
   - exactly one claim generation/attempt increment appropriate to the selected source contract;
   - terminal `completed` or an explicitly accepted content block, not an ambiguous running lease;
   - output Storage object for completed render, valid MIME, nonzero size within configured maximum, and matching row metadata;
   - heartbeat processed/failed counters and last error match the outcome;
   - no `deliver` job, delivery row transition, Telegram post, X post, or external-posting pipeline delta for the no-post fixture;
   - no stale output generation accepted and no duplicate claim;
   - host/Hermes/resource checks remain within limits.
7. If the canary passes, refresh heartbeats and confirm no unexpected renderer consumer has appeared.
8. Enable queue polling:
   - current candidate: set `RENDER_POLLING_ENABLED=1` in the protected runtime control and recreate only the XOT container, while preserving global mode as the approved production value;
   - legacy bridge: set/read back `video_render_config.mode=enabled`. No container restart is needed.
9. Observe at least one poll interval and one heartbeat. If the queue is non-empty, require one normal claim or completed artifact. If the queue is empty, record zero eligible rows; do not manufacture backlog.
10. After cutover acceptance, change only the XOT service restart policy from `no` to `unless-stopped` and keep the selected container as the sole persistent product resource.

If no safe no-post fixture exists, stop at `DEPLOYED_PAUSED`. Do not choose a deliverable post merely to create proof. Ask the user for explicit permission before a canary that can release to Telegram or X.

### Phase 6 — persistence, rollback drill, and closeout

1. Exercise a controlled XOT-only restart while global polling is disabled:
   - stop the XOT container with its configured grace;
   - prove no active claim remains;
   - start it through the persistent bootstrap;
   - prove image rebuild works if the image is deliberately treated as absent only in a task-owned test tag. Do not delete the accepted runtime image merely to test this.
2. Prove the rollback control path without processing a second render:
   - mode disabled;
   - selected recovery container stopped;
   - rollback image/source selectable and starts paused/healthy;
   - switch back to the accepted recovery image while still paused;
   - enable only the accepted image after the drill.
3. Install/enable exactly one startup mechanism after validation:
   - preferred: XOT user service that calls the persistent bootstrap;
   - fallback: Lightning documented startup command if user services do not survive Studio lifecycle.
   - never enable both.
4. Use native Computer Use to inspect Lightning auto-sleep if CLI evidence cannot determine it. Do not change a billing-affecting setting without authority.
5. Cleanup:
   - remove staging env and staging container;
   - remove task-owned canary temp files after redacted evidence is retained;
   - keep production env, accepted container, exact sources, selected/recovery/rollback images, and one startup path;
   - keep unrelated Docker, local Preview, Tailscale, and Hermes resources untouched.
6. Append final ledger status and update the renderer recovery task/receipt without marking the broader production replan complete.

Pass: the accepted production renderer remains healthy, persistent, exclusive, and observable; rollback source is ready; all temporary QA resources are settled.

## Task Backlog

| ID | Task | Owner | Dependencies | Output | Estimate |
| --- | --- | --- | --- | --- | ---: |
| LR-00 | Re-anchor repo, host, Hermes, queue, RPCs, mode, heartbeats | Luna High | none | ledger anchor and compatibility verdict | 15-30 min |
| LR-01 | Add candidate polling breaker and tests | Luna owner; bounded Devin SWE candidate allowed | LR-00 | source/tests DoneClaim | 30-60 min |
| LR-02 | Add Lightning Compose/bootstrap/unit assets | Luna owner; bounded Devin SWE candidate allowed | LR-00 | deploy bundle and docs | 30-60 min |
| LR-03 | Independent source/Compose challenge | Devin GLM, then Antigravity if eligible | LR-01/02 draft | review findings | 15-30 min, parallel |
| LR-04 | Run renderer tests/contracts and accept diff | Luna High | LR-01/02 | local acceptance | 20-40 min |
| LR-05 | Transfer bounded source and build current AMD64 image | Luna High | LR-04 | candidate image receipt | 15-40 min |
| LR-06 | Start current candidate against Preview, run one render | Luna High | LR-05, staging secrets/fixture | Preview acceptance | 15-45 min |
| LR-07 | Build legacy recovery and rollback images | Luna High | LR-00 | two image receipts | 20-45 min, parallel with LR-06 |
| LR-08 | Run no-upload host preview in selected prod image | Luna High | LR-07 | host render artifact | 10-30 min |
| LR-09 | Pause/read back production mode and start compatible image | Luna High | LR-00, LR-06/07, production secrets | paused heartbeat receipt | 15-30 min |
| LR-10 | Three-heartbeat/no-claim/Hermes/resource gate | Luna High | LR-09 | disabled-first acceptance | 2-3 min observation plus checks |
| LR-11 | One exactly bounded no-post production poller claim/render | Luna High | safe first fixture, LR-10 | joined queue/storage evidence | 10-45 min |
| LR-12 | Exclusive poller enable and first observation | Luna High | LR-11 | cutover receipt | 10-30 min |
| LR-13 | Rollback/startup lifecycle proof | Luna High; Computer Use only for Lightning UI | LR-12 | persistence/rollback receipt | 20-45 min |
| LR-14 | Final ledger, task update, worktree/runtime closeout | Luna High | all | exact final status | 10-20 min |

Likely active engineering time: 3-5 hours. Optimistic: about 2 hours if credentials, safe fixtures, builds, and providers are ready. Conservative: 1 working day if image builds, provider calls, Lightning lifecycle, or queue selection needs rework. B4 migration and the final current-candidate production release are outside this estimate.

## Acceptance Criteria

### Code and image

- `RENDER_POLLING_ENABLED` is fail-closed and covered by behavioral tests.
- Disabled candidate starts heartbeat but schedules no poller and makes zero claim calls.
- Existing capacity, request-policy, process-runner, error-boundary, claim-fence, polling, and type-boundary gates pass.
- Selected image reports `linux/amd64`, runs as non-root, and contains the required runtime tools/fonts.
- Exact source revision and local Docker image ID are recorded. No broad file-hash matching is required.

### Host and Hermes

- One Compose project named `xot-renderer`; one production container.
- Host bind is exactly `127.0.0.1:8797:8787`.
- Actual container limits are CPU 2, memory 6 GiB, shared memory 1 GiB, PIDs 512, concurrency 1.
- Dedicated network and temp volume; no host network, Docker socket, or Hermes mount.
- Container has zero unexpected restarts and a bounded log policy.
- During canary, host available memory remains above 4 GiB, no material swap growth occurs, disk remains comfortably above 300 GiB free, and no OOM event appears.
- Hermes user services remain active and their existing ports stay listening before and after. No Hermes restart is caused by this task.

### Preview/staging

- Current candidate completes one real renderer fixture from Lightning AMD64.
- Fenced claim/terminal evidence, output object, and heartbeat join correctly.
- Preview posting remains blocked and production rows do not change.
- Staging container and staging secret are settled after evidence capture.

### Production disabled-first

- Live function signatures select exactly one compatible source.
- Production mode is disabled and read back before production container start.
- Three fresh heartbeats show the planned ID, paused state, and null error.
- No unexpected heartbeat is fresh.
- No claim/attempt/lease delta occurs while paused.
- `/health` and DB heartbeat agree; HTTP 200 alone is not acceptance.
- Invalid/missing HTTP auth returns 401.

### Production canary and cutover

- One exact no-post render is selected as the first eligible poller row; mode is re-disabled immediately after that single claim.
- It reaches an unambiguous accepted terminal state and, when completed, has a real output Storage object.
- The canary produces no delivery/posting delta.
- No duplicate claim, stale terminal acceptance, or unreclaimed active lease remains.
- After exclusivity recheck, polling is enabled through the correct source-specific control.
- One poll/heartbeat interval proves the renderer is active. If the queue is non-empty, one normal queue artifact is observed. If empty, the empty state is recorded without synthetic work.

### Persistence and rollback

- Source, deploy files, and protected runtime env are on Lightning persistent storage.
- Exactly one startup path is enabled.
- Accepted recovery and rollback sources are retained.
- Rollback starts paused and does not require Docker/Hermes/Tailscale restart.
- The bridge is marked incompatible after B4 and must be disabled before that migration.

## Validation Plan

### Repo/local supporting checks

Run focused checks first:

```bash
npm --prefix services/video-renderer test
npm run check:renderer-capacity
npm run check:renderer-request-policy
npm run check:renderer-error-boundary
npm run check:renderer-process-runner
npm run check:renderer-boundary-typecheck
npm run check:b4-renderer-claim-fence
npm run test:renderer-claim-fence
npm run check:video-render-polling
git diff --check
```

Run any new Lightning deploy-script syntax/unit checks. Do not run the full root suite unless a shared root contract changes or focused evidence exposes a regression.

### Live production compatibility reads

Use the approved Supabase connection/connector. Do not print connection strings or service keys.

Read:

- `pg_proc` identity arguments and definitions for claim/complete/fail/block renderer functions;
- `settings.value` for `video_render_config`;
- queue counts and expired leases;
- last heartbeat per renderer ID;
- safe fixture control fields;
- jobs/deliveries/pipeline events before and after;
- output object metadata after canary.

The exact query text belongs in the implementation ledger only when it contains no private target or content. Raw rows stay in protected evidence.

### Host supporting checks

Use read-only commands before mutation and XOT-scoped commands after:

```bash
uname -m
docker version
docker compose version
ss -ltn
systemctl --user is-active hermes-cloudflared.service hermes-dashboard.service hermes-gateway.service
docker compose -p xot-renderer -f <lightning-compose> config --quiet
docker image inspect <exact-image>
docker compose -p xot-renderer -f <lightning-compose> ps
curl --fail http://127.0.0.1:8797/health
docker stats --no-stream <xot-container>
```

Do not use `docker system prune`, daemon restart, broad process kills, or commands that print environments.

### Target-perspective evidence

Tests and Docker health are supporting checks. `verified` requires:

1. real Lightning AMD64 container;
2. real isolated Preview/staging render and output;
3. real production database heartbeat from the selected source;
4. real one-claim safe production poller render or explicit `DEPLOYED_PAUSED` status;
5. real queue/storage/heartbeat join after cutover;
6. real Hermes before/after state.

### Adversarial probes for the implementation owner

This is a `HIGH` production-runtime slice. Triggered classes:

- `stale_state`: re-read RPCs, mode, heartbeat, queue, and image selection immediately before start/cutover.
- `dirty_worktree`: preserve all unrelated changes; stop on overlap.
- `hung_or_long_command`: bound SSH, Docker build, provider render, and observation commands; keep session/terminal receipts.
- `misleading_success_output`: disprove `/health`-only success with database heartbeat and output rows.
- `cancel_resume`: prove mode/poller state and lease ownership after any interruption.
- `flaky_test`: rerun only a failing timing-sensitive renderer test before disposition; do not hide a skip.

`malformed_input` applies to the new polling flag and HTTP auth/input negative tests. `prompt_injection` does not apply because no untrusted external text is used for delegation or planning.

An independent verification pass must try to disprove the final source compatibility, exclusive consumer, no-post canary, and Hermes claims before Luna accepts them.

### Cleanup receipts

Record every task-owned SSH/Orca terminal, temporary source directory, staging container, staging secret file, canary output directory, and systemd test state. The production `xot-renderer` container, its production env, exact persistent sources, selected images, and one startup unit are intentional product resources, not leaked QA resources.

## Risks And Dependencies

| Risk/dependency | Effect | Mitigation or stop |
| --- | --- | --- |
| B4 not present in production | current candidate can claim but cannot terminal correctly | use live RPC signature gate; deploy legacy bridge only |
| Partial or both legacy/fenced functions | neither source is safe | stop before production start; return to DB reconciliation |
| Production renderer secrets unavailable | no fresh heartbeat or queue access | finish source/image/host work, report `BLOCKED_BEFORE_PRODUCTION` |
| Health endpoint masks heartbeat failure | false healthy result | require fresh DB heartbeat with null error |
| No safe no-post queued row | production render proof could trigger delivery | stop at `DEPLOYED_PAUSED`; ask before deliverable canary |
| Old Render host returns | two consumers | recheck heartbeats before enable; pause immediately on unexpected fresh ID |
| Lightning auto-sleeps | service stops | inspect setting; use one startup path; obtain approval before cost-changing change |
| Docker image is not durable | restart loses runtime image | persist exact source and rebuild bootstrap; retain recovery/rollback sources |
| 2 CPU / 6 GiB too small | slow or failed render | measure one staging render; adjust only from observed evidence while preserving Hermes headroom |
| Legacy bridge lacks modern capacity/shutdown fencing | weaker interruption behavior | 30-second polling, one safe first row, immediate re-pause after the first claim, concurrency one, wait for terminal before restart; bridge is temporary |
| Later B4 release while bridge startup remains enabled | incompatible auto-start | pause queue, disable/stop bridge startup before migration; switch control to fenced candidate only after B4 proof |
| Secret exposure through external workers or logs | credential compromise | Luna-only secret handling; file mode 0600; non-logging transfer; redacted receipts |
| Source edits invalidate accepted Preview renderer evidence | stale acceptance | rerun the exact affected Preview render on Lightning AMD64 |

Blocking questions that must be answered from live evidence, not by user guess:

- Which renderer RPC contract is live?
- Is production renderer mode disabled/enabled and what other JSON fields must be preserved?
- Is any renderer heartbeat fresh?
- Is there a safe no-post queued fixture?
- Can the approved XOT account sources provide all required credentials?
- Does Lightning auto-sleep threaten the intended uptime?

No product-design decision is needed from the user unless a safe no-post fixture is unavailable or a Lightning setting change creates new cost.

## Implementation Orchestrator Handoff

### Selected implementation slice

Implement the complete bounded recovery program in this plan, but treat it as two linked slices:

1. **Candidate safety and Lightning Preview proof:** add the polling breaker/deploy bundle, validate locally, build AMD64, and complete one isolated render.
2. **Schema-compatible production bridge/cutover:** classify live RPCs, deploy the matching image paused, run one no-post canary, and enable the exclusive consumer.

### First implementation slice

Start with Phase 0 plus LR-01/LR-02. Do not install a production credential or start a production-connected container before the live RPC compatibility verdict exists.

### Source-of-truth contract for execution

- Owner: GPT-5.6 Luna High main implementation agent.
- Code boundary: current candidate polling/deploy assets only; legacy commits are immutable build inputs, not branches to modernize.
- Runtime boundary: one `xot-renderer` Compose project and persistent XOT directory on `lightning-studio-1`.
- Data boundary: renderer compatibility reads, mode pause/enable, one no-post render, its normal heartbeat/workflow/output rows.
- Cutover: candidate-on-Preview, compatible-image-paused-on-production, safe canary, exclusive enable.
- Evidence: ledger plus protected raw receipts; no test-only completion claim.
- Kill: any compatibility, identity, claim, post, resource, Hermes, or secret ambiguity.

### Phase order and dependency constraints

- Phase 0 compatibility classification starts before code or host mutation and must finish before production start.
- LR-01/LR-02 and legacy image preparation can run concurrently with disjoint ownership.
- Candidate Preview proof must finish before the current candidate is considered for production.
- Production mode disable/readback precedes any production-connected start.
- Safe canary precedes global polling enable.
- Persistence/auto-start is installed only after the selected runtime passes.
- If B4 is later applied, bridge stop/disable precedes the migration; fenced candidate start follows B4 proof.

### Likely files and services to change

- `services/video-renderer/src/config.js`
- `services/video-renderer/src/server.js`
- focused renderer server/config/capacity tests
- `services/video-renderer/docker-compose.yml` or a new Lightning-specific Compose file
- new bounded files under `services/video-renderer/deploy/lightning/`
- `services/video-renderer/README.md`
- `docs/plans/2026-08-24-xot-lightning-renderer-recovery-implementation-ledger.jsonl`
- Lightning persistent XOT directory and one XOT startup unit/hook
- production `settings.video_render_config.mode`, preserving all other fields

### Allowed changes

- Focused current-candidate polling breaker, tests, Compose/deploy assets, docs, and ledger.
- Exact-source AMD64 image builds on Lightning.
- One staging and one safe production renderer canary.
- Renderer mode pause/enable and normal renderer-owned evidence rows/artifacts.
- Candidate-branch commit/push and hosted CI only if the parent confirms the existing branch authorization still applies. Do not infer any main/merge authority.

### Disallowed changes

- Legacy source modernization, B4 migration apply, other schema/function/frontend changes, PR #69, `main`, merge, deploy outside renderer, Hermes, Docker daemon, Tailscale, unrelated terminals, broad cleanup, or external posting.

### Required skills/tools

- `implementation-orchestrator`
- `quality-orchestration`, including current ledger, routing contract, launch adapters, and receipts
- Supabase skill/connector for exact live renderer reads and bounded mode/canary evidence
- production-readiness discipline for the renderer-only acceptance gate
- native Computer Use only if Lightning UI settings must be inspected
- Orca CLI/orchestration for the existing `PROD-04`/renderer task and external delegates

Novita is not appropriate for host deployment, persistent services, secrets, or production checks. It may be used only for a repo-approved bounded Linux build/test command when an enabled `.novita-offload.json` explicitly permits it. The real AMD64 host build and acceptance remain on Lightning.

### Quality-orchestration execution contract

- Recheck exact model catalog, Free tier, auth, canary, effective identity/effort, and the version-matched adapter before every dispatch.
- Use both Free Devin routes concurrently only on disjoint candidate S0-S2 work.
- AGY uses `--dangerously-skip-permissions`; Devin uses `--permission-mode dangerous`; Command Code uses `--yolo`. These flags remove prompts only. They do not expand file ownership, secret access, host/production authority, or acceptance authority.
- External workers receive no private target, credentials, raw database rows, or host logs.
- Luna inspects every candidate diff/output and records ACCEPTED, REWORK, REJECTED, or BLOCKED.
- All host, secret, production, integration, validation, and final acceptance work remains Luna High.

### Required validation before claiming completion

- Focused source tests and renderer contract checkers.
- Exact AMD64 image and host runtime inventory.
- Real Lightning Preview/staging render.
- Live production RPC compatibility proof.
- Disabled-first production container plus three DB heartbeats and zero claims.
- One exactly bounded no-post production poller render with output object and no posting delta.
- Exclusive polling enable and one observation interval.
- Hermes before/after evidence.
- XOT-only rollback and persistent startup proof.
- Full cleanup receipt for temporary resources.

### Blocking versus resolvable questions

Blocking:

- ambiguous renderer RPC contract;
- missing production renderer credential;
- fresh unknown renderer consumer;
- production mode cannot be safely preserved/read back;
- no safe canary and no explicit permission for a deliverable one;
- auto-sleep change would add cost and requires user approval.

Resolvable during execution:

- exact image tag names;
- whether to update the existing Compose or add a Lightning file;
- test fixture choice within the accepted staging set;
- measured CPU/memory tuning within the host/Hermes envelope;
- user unit versus documented Lightning startup hook, provided exactly one is used.

### Stop conditions and completion language

- Do not claim `verified` from tests, image build, Docker health, or HTTP 200 alone.
- Do not claim production restored while polling is disabled.
- Do not claim the current candidate is production-compatible until fenced RPC semantics are live.
- Do not close broader `PROD-04`, release, migration, or production-readiness gates from a legacy bridge result.
- Report `RESTORED_LEGACY_BRIDGE`, `RESTORED_CURRENT_CANDIDATE`, `DEPLOYED_PAUSED`, or `BLOCKED_BEFORE_PRODUCTION` exactly.

The implementation orchestrator should use the append-only ledger as its goal loop because goal creation is blocked. It should run implement/integrate/validate cycles until the selected status is proven or an exact blocker occurs. It must not report `verified` without target-perspective evidence from the real Lightning host, Supabase heartbeat/queue, and real output artifact.

## Planning Quality Score

Target and achieved planning score: 5/5.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Source anchoring | 5 | exact repo/branch/host/architecture/ports/persistence/source commits and live evidence |
| Architecture decision | 5 | one container, no extra user, current-candidate versus legacy bridge compatibility matrix |
| Implementation detail | 5 | files, host paths, resource limits, phases, tasks, estimates, external route boundaries |
| Acceptance and rollback | 5 | Preview proof, disabled-first boot, no-post canary, exclusive cutover, lifecycle and rollback |
| Handoff quality | 5 | exact Luna ownership, worker eligibility, blockers, commands, evidence states, and completion labels |

## Orchestration Closeout

- Workers actually used:
  - planning owner, `planner` route;
  - `/root/lightning_host_plan`;
  - `/root/lightning_renderer_plan`.
- Worker scopes:
  - host persistence/resources/Hermes/Compose/lifecycle;
  - renderer source/RPC/secrets/health/canary compatibility.
- Worker results accepted/rejected/unverified:
  - host receipt ACCEPTED after direct read-only host cross-check;
  - renderer compatibility receipt ACCEPTED after direct source/commit/RPC inspection;
  - no worker implementation claim exists.
- Parent verification:
  - branch/worktree, renderer files, old/current commits, B4 RPC source, local Preview state, host architecture/capacity/ports/Docker/Hermes state, and official platform sources were inspected.
- Gaps that would benefit from more workers: none at planning time. Live production queue/settings/signature reads belong to Luna execution because they are drift-prone and protected.
- Visible thread considered: yes; rejected because one bounded recovery has one integrator and one runtime target.

## Planning Agent Usage

- Main planning owner: role `planner`; model GPT-5.6 Sol; reasoning Max; Fast not applicable; scope was substantive planning, evidence inspection, compatibility decision, decomposition, acceptance, rollback, artifact authoring, and handoff. Result ACCEPTED.
- `/root/lightning_host_plan`: role `planner`; requested/enforced model GPT-5.6 Sol; reasoning Max; Fast not applicable; scope was live Lightning host, persistence, Docker/Compose, resource limits, ports, Hermes isolation, and lifecycle. Result ACCEPTED. Effective runtime identity telemetry was not separately exposed, so it is recorded as unknown rather than inferred.
- `/root/lightning_renderer_plan`: role `planner`; requested/enforced model GPT-5.6 Sol; reasoning Max; Fast not applicable; scope was renderer source, RPC compatibility, secret requirements, health/heartbeat semantics, and production canary safety. Result ACCEPTED. Effective runtime identity telemetry was not separately exposed, so it is recorded as unknown rather than inferred.
- No planning worker used a subagent. No planning worker edited product source/configuration, changed the host, touched Supabase/Vercel/GitHub, or started implementation.

Strict planning route: PASSED. All substantive planning was owned by the GPT-5.6 Sol Max planner route. Implementation has not started under this plan.
