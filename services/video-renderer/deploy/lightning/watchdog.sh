#!/usr/bin/env bash
# XOT Lightning renderer watchdog — restore an exited renderer container.
#
# Why this exists (0X3-672): the September incident was a graceful SIGTERM
# under restart policy "no"; the container exited and nothing started it again
# for days. Docker's unless-stopped policy alone does NOT cover that mode: a
# cleanly-exited container is recorded as "stopped", so a Studio suspend/resume
# or docker stop leaves it down even under unless-stopped. This watchdog is the
# reconciliation loop: when the desired state is "running" and the service is
# not running, it starts the already-built image via bootstrap.sh.
#
# Runs from xot-renderer-watchdog.timer (systemd user timer). It:
#   - loads non-secret control values from runtime/service.env
#   - no-ops when XOT_RENDERER_DESIRED_STATE=stopped (intentional stop is a
#     preserved pause, distinct from the in-container RENDER_POLLING_ENABLED=0
#     polling pause, which keeps the container up but never claims)
#   - never builds images, prunes, restarts Docker, or touches unrelated
#     projects, Hermes, or the Docker daemon
#
# Template only. Luna owns integration and acceptance.
set -euo pipefail

PERSIST_ROOT="${XOT_RENDERER_PERSIST_ROOT:-/teamspace/studios/this_studio/xot-renderer}"
SERVICE_ENV_FILE="${XOT_RENDERER_SERVICE_ENV_FILE:-${PERSIST_ROOT}/runtime/service.env}"

# service.env is the non-secret control file the systemd units already load as
# an EnvironmentFile. Sourcing it here makes manual watchdog runs behave the
# same as timer runs.
if [[ -f "${SERVICE_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${SERVICE_ENV_FILE}"
  set +a
fi

CONTROL_DIR="${XOT_RENDERER_CONTROL_DIR:-${PERSIST_ROOT}/control/deploy/lightning}"
COMPOSE_FILE="${CONTROL_DIR}/docker-compose.lightning.yml"
PROJECT_NAME="${XOT_RENDERER_COMPOSE_PROJECT:-xot-renderer}"
SERVICE_NAME="xot-video-renderer"
DESIRED_STATE="${XOT_RENDERER_DESIRED_STATE:-running}"

if [[ "${DESIRED_STATE}" != "running" ]]; then
  echo "[watchdog] desired state is '${DESIRED_STATE}'; intentional stop preserved, no action"
  exit 0
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[watchdog] ERROR: compose file not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

RUNNING="$(docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" \
  ps --status running --services 2>/dev/null || true)"

if printf '%s\n' "${RUNNING}" | grep -qx "${SERVICE_NAME}"; then
  echo "[watchdog] ${SERVICE_NAME} is running; no action"
  exit 0
fi

echo "[watchdog] ${SERVICE_NAME} is not running; desired state is 'running' — starting existing image"
exec "${CONTROL_DIR}/bootstrap.sh" \
  --service-env "${SERVICE_ENV_FILE}" \
  --control-dir "${CONTROL_DIR}" \
  --no-build \
  --start
