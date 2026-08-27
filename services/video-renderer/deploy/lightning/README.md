# XOT Lightning Renderer Deployment — Candidate Bundle

This directory contains the bounded candidate Docker deployment bundle for the
XOT video renderer on the existing Lightning Studio host
(`lightning-studio-1`, `linux/amd64`).

**This is a candidate only. Luna owns integration and acceptance.** No file
here is a deployment authority. The operator (Luna) provisions secrets, builds
the image, runs staged verification, and switches the restart policy only after
acceptance.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.lightning.yml` | Compose file with all required resource limits, loopback bind, healthcheck, log rotation, dedicated network/volume. |
| `bootstrap.sh` | Persistent rebuild + start script. Rebuilds the AMD64 image from the selected source if missing; never prunes, restarts Docker, or touches unrelated projects. |
| `xot-renderer.service` | Generic systemd user unit template. It loads non-secret `runtime/service.env` and starts the selected build after acceptance. |
| `renderer.env.example` | Runtime env template with **no secret values**. Copy to persistent storage, set mode 0600, fill secrets from XOT-owned sources. |
| `service.env.example` | Non-secret source/image/control selection template. Copy to persistent storage and set mode 0600. |

## Hard constraints enforced by the Compose file

- **Platform:** `linux/amd64` (build + runtime).
- **Port bind:** `127.0.0.1:8797:8787` — loopback only, never `0.0.0.0`.
- **CPU:** 2 cores (`cpus: 2.0`, `cpu_count: 2`).
- **Memory:** 6 GiB (`mem_limit: 6g`, `memswap_limit: 6g`).
- **Shared memory:** 1 GiB (`shm_size: 1g`).
- **PIDs:** 512 (`pids_limit: 512`).
- **Init:** `init: true` (PID 1 zombie reaping).
- **Concurrency:** `RENDER_CONCURRENCY=1`.
- **Healthcheck:** `curl -fsS http://127.0.0.1:8787/health`, 30s interval, 5s timeout, 3 retries, 20s start period.
- **Stop grace:** 35s.
- **Logs:** `json-file`, `max-size: 10m`, `max-file: 3`.
- **Network:** dedicated `xot-renderer-net` (bridge).
- **Volume:** dedicated `xot-renderer-tmp` (local).
- **Restart:** `"no"` — until acceptance, the container does not auto-restart.
- **Polling breaker:** `RENDER_POLLING_ENABLED` defaults to `0` (disabled). Only explicit accepted values enable polling.

### Explicitly forbidden

- No Docker socket mount (`/var/run/docker.sock`).
- No host network mode (`network_mode: host`).
- No Hermes path, mount, or configuration reference.
- No secret values in any file in this directory.
- No `0.0.0.0` bind.

## Persistent layout on Lightning

```
/teamspace/studios/this_studio/xot-renderer/
  control/deploy/lightning/                    stable selected bundle
    docker-compose.lightning.yml
    bootstrap.sh
    xot-renderer.service
  releases/production-legacy/                  schema-compatible source
    Dockerfile
    src/
    package.json
    ...
  releases/current-candidate/                  future B4-fenced source
  runtime/renderer.env                       0600 secrets (never committed)
  runtime/service.env                        0600 non-secret control values
```

Lightning documents `/teamspace/studios/this_studio` as the persistent surface.
Docker images are runtime cache, not the durable source. The stable control
bundle and selected release source allow rebuilding the exact image after a
Studio stop, auto-sleep, or image-cache loss.

## Persistent service selection

The user unit is generic. It always loads the non-secret
`runtime/service.env`, which selects the image, source, runtime env, control
directory, and restart profile/policy:

- `XOT_RENDERER_IMAGE_TAG`: immutable image tag;
- `XOT_RENDERER_BUILD_SOURCE`: source tree containing the selected Dockerfile;
- `XOT_RENDERER_ENV_FILE`: secret renderer runtime env path;
- `XOT_RENDERER_CONTROL_DIR`: stable directory containing the Compose bundle.

The `XOT_RENDERER_SERVICE_PROFILE` is `candidate` by default and the matching
`XOT_RENDERER_RESTART_POLICY` is `no`. After full acceptance and the
persistence drill, change the two non-secret values to `persistent` and
`unless-stopped`; bootstrap validates that the pair matches before start. No
secret is stored in `service.env`.

For the current production schema-compatible bridge, copy the stable bundle and
the proven legacy source into these paths, then set `service.env` as follows:

```dotenv
XOT_RENDERER_SERVICE_PROFILE=candidate
XOT_RENDERER_RESTART_POLICY=no
XOT_RENDERER_IMAGE_TAG=xot-video-renderer:production-legacy-<commit>
XOT_RENDERER_BUILD_SOURCE=/teamspace/studios/this_studio/xot-renderer/releases/production-legacy
XOT_RENDERER_ENV_FILE=/teamspace/studios/this_studio/xot-renderer/runtime/renderer.env
XOT_RENDERER_CONTROL_DIR=/teamspace/studios/this_studio/xot-renderer/control/deploy/lightning
```

The later B4-fenced candidate switch changes only the image tag and build
source to the accepted current-candidate release. It does not change the
control directory or secret file path.

## Render-only bridge cutoff

The current bridge uses two independent fail-closed controls:

- `RENDER_POLLING_ENABLED` in `runtime/renderer.env` (current candidate image).
  Only `1` or `true` (trimmed, case-insensitive) enables it.
- `RENDER_QUEUE_CUTOFF_AT` in the same file. It must be an ISO 8601 timestamp
  with a trailing `Z` or an explicit UTC offset such as `+00:00`.

Missing, blank, malformed, date-only, local-time, and timezone-free values
produce a `missing_or_invalid_render_queue_cutoff_at` block reason, keep
effective polling disabled, and cause zero automatic `claim_video_render_after`
RPCs. The `/health` endpoint and heartbeat metadata expose requested polling,
effective polling, and the block reason. The cutoff value itself is never
exposed. Manual `POST /v1/render` and `POST /v1/preflight` by-ID dispatch is
unaffected and bypasses the cutoff.

The operator captures the immutable cutoff from production `clock_timestamp()`
after the migration and posting hold are live. It is not derived inside the
renderer and is not moved backward without explicit operator authority.

## Staged start

### 1. Provision secrets

```bash
# On lightning-studio-1, from XOT-owned sources only. Never from Hermes.
mkdir -p /teamspace/studios/this_studio/xot-renderer/runtime
cp /teamspace/studios/this_studio/xot-renderer/source/deploy/lightning/renderer.env.example \
   /teamspace/studios/this_studio/xot-renderer/runtime/renderer.env
chmod 600 /teamspace/studios/this_studio/xot-renderer/runtime/renderer.env
# Edit with a non-logging editor; fill SUPABASE_URL, keys, token. Do not print.
cp /teamspace/studios/this_studio/xot-renderer/source/deploy/lightning/service.env.example \
   /teamspace/studios/this_studio/xot-renderer/runtime/service.env
chmod 600 /teamspace/studios/this_studio/xot-renderer/runtime/service.env
# Set the explicit release tag/source/control paths without adding secrets.
```

### 2. Install the stable control bundle and build the AMD64 image

```bash
mkdir -p /teamspace/studios/this_studio/xot-renderer/control/deploy/lightning
cp -a /teamspace/studios/this_studio/xot-renderer/source/deploy/lightning/. \
  /teamspace/studios/this_studio/xot-renderer/control/deploy/lightning/
cd /teamspace/studios/this_studio/xot-renderer/control/deploy/lightning
set -a
. /teamspace/studios/this_studio/xot-renderer/runtime/service.env
set +a
./bootstrap.sh --service-env /teamspace/studios/this_studio/xot-renderer/runtime/service.env
```

This validates Compose syntax, then builds `linux/amd64` from the selected
release source with the explicit tag if the image is missing. It loads the
image into the local Docker image store. It does not start the container.

### 3. Start the container (disabled-first)

```bash
./bootstrap.sh --service-env /teamspace/studios/this_studio/xot-renderer/runtime/service.env --start
```

The candidate container starts with `RENDER_POLLING_ENABLED=0` and
`restart: "no"`. The legacy bridge also requires the production database mode
to be read back as disabled before any production-connected start.
Heartbeat and `/health` are active; polling is off.

### 4. Verify disabled-first state

```bash
# Compose project and container state
docker compose -p xot-renderer -f docker-compose.lightning.yml ps

# Loopback port only
ss -ltn | grep 8797    # must show 127.0.0.1:8797, not 0.0.0.0

# Health endpoint (process evidence only — not acceptance)
curl -fsS http://127.0.0.1:8797/health

# Actual resource limits
docker stats --no-stream xot-renderer-xot-video-renderer-1

# Image architecture
docker image inspect <image-tag> --format '{{.Architecture}}'   # must be amd64

# Hermes unchanged (observe only, do not restart)
systemctl --user is-active hermes-cloudflared.service hermes-dashboard.service hermes-gateway.service
```

Database evidence (fresh heartbeat with `last_error IS NULL`, zero claims while
paused) is required acceptance evidence — HTTP 200 alone is not acceptance.

## Verification checklist (before canary)

- [ ] Image reports `linux/amd64`, runs as non-root (`node` user).
- [ ] Host bind is exactly `127.0.0.1:8797:8787`.
- [ ] Actual container limits: CPU 2, memory 6 GiB, shm 1 GiB, PIDs 512.
- [ ] Container is healthy with zero restarts.
- [ ] Database heartbeat is fresh, unique, `last_error IS NULL`.
- [ ] Two poll intervals produce zero claims while polling is disabled.
- [ ] Missing/invalid HTTP token returns 401.
- [ ] Hermes services and ports unchanged before and after.
- [ ] No Docker socket mount, host network, or Hermes path in the runtime.

## Rollback

Rollback does not require Docker daemon restart, Tailscale restart, or Hermes
interaction.

```bash
# 1. Stop the XOT container (preserves image and source)
docker compose -p xot-renderer -f docker-compose.lightning.yml down

# 2. Set production renderer mode to disabled (read back to confirm)

# 3. Rebuild or select the rollback image from persistent source
#    (34d612923fc8783789ff87c2377aba260584deb2 or the selected recovery commit)
set -a
. /teamspace/studios/this_studio/xot-renderer/runtime/service.env
set +a
/teamspace/studios/this_studio/xot-renderer/control/deploy/lightning/bootstrap.sh \
  --image-tag xot-video-renderer:rollback-<sha> \
  --build-source /teamspace/studios/this_studio/xot-renderer-rollback/releases/rollback \
  --service-env /teamspace/studios/this_studio/xot-renderer/runtime/service.env --start

# 4. Verify the rollback container starts paused/healthy
curl -fsS http://127.0.0.1:8797/health
```

The accepted recovery and rollback source trees are retained on persistent
Lightning storage so either image can be rebuilt without external dependency.

## After acceptance — switch to `unless-stopped`

Only after the full acceptance criteria in the implementation plan are met
(Preview proof, disabled-first boot, no-post canary, exclusive cutover,
persistence/rollback drill), switch the restart policy:

1. Edit the two non-secret service controls:
   ```dotenv
   XOT_RENDERER_SERVICE_PROFILE=persistent
   XOT_RENDERER_RESTART_POLICY=unless-stopped
   ```
2. Recreate the container through the stable bootstrap:
   ```bash
   set -a
   . /teamspace/studios/this_studio/xot-renderer/runtime/service.env
   set +a
   /teamspace/studios/this_studio/xot-renderer/control/deploy/lightning/bootstrap.sh \
     --service-env /teamspace/studios/this_studio/xot-renderer/runtime/service.env --start
   ```
3. Enable the user unit (exactly one startup path, never both unit + manual):
   ```bash
   cp xot-renderer.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable xot-renderer.service
   ```
4. Verify the unit is enabled and the container restarts through bootstrap
   after a controlled stop/start cycle.

**Do not set the persistent profile or enable the user unit before acceptance.**
Before acceptance, use the candidate profile with `restart: "no"`.

## Legacy bridge note

The legacy bridge source does not have `RENDER_POLLING_ENABLED`. Its
disabled-first control is the production `settings.video_render_config.mode =
disabled` row, read back before container start. Its canary uses
`POLL_INTERVAL_MS=30000` so the operator can re-disable mode immediately after
the first observed claim. The bridge is temporary and must be disabled before
the B4 migration is applied.
