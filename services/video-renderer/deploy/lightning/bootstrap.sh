#!/usr/bin/env bash
# XOT Lightning renderer bootstrap — rebuild and start the selected container.
#
# Persistent root: /teamspace/studios/this_studio/xot-renderer
# Expected layout on Lightning:
#   /teamspace/studios/this_studio/xot-renderer/
#     control/deploy/lightning/                 stable Compose/bootstrap bundle
#     releases/production-legacy/               selected legacy source tree
#     releases/current-candidate/               future fenced source tree
#     runtime/renderer.env                       0600 secrets (never committed)
#     runtime/service.env                        0600 non-secret control values
#
# This script:
#   - rebuilds the linux/amd64 image from the selected persistent source if missing
#   - starts the container through the Lightning Compose file
#   - never pulls an unqualified tag, prunes, restarts Docker, or touches
#     unrelated projects, Hermes, or the Docker daemon
#
# Usage:
#   ./bootstrap.sh [--image-tag TAG] [--build-source DIR] [--runtime-env PATH]
#     [--control-dir DIR] [--service-profile candidate|persistent]
#     [--service-env PATH] [--no-build] [--start]
#
# Template only. Luna owns integration and acceptance.
set -euo pipefail

PERSIST_ROOT="${XOT_RENDERER_PERSIST_ROOT:-/teamspace/studios/this_studio/xot-renderer}"
SOURCE_DIR="${XOT_RENDERER_BUILD_SOURCE:-${PERSIST_ROOT}/source}"
CONTROL_DIR="${XOT_RENDERER_CONTROL_DIR:-${PERSIST_ROOT}/control/deploy/lightning}"
ENV_FILE="${XOT_RENDERER_ENV_FILE:-${PERSIST_ROOT}/runtime/renderer.env}"
SERVICE_ENV_FILE="${XOT_RENDERER_SERVICE_ENV_FILE:-${PERSIST_ROOT}/runtime/service.env}"
COMPOSE_FILE="${CONTROL_DIR}/docker-compose.lightning.yml"
PROJECT_NAME="${XOT_RENDERER_COMPOSE_PROJECT:-xot-renderer}"
HOST_PORT="${XOT_RENDERER_HOST_PORT:-8797}"
NETWORK_NAME="${XOT_RENDERER_NETWORK_NAME:-xot-renderer-net}"
VOLUME_NAME="${XOT_RENDERER_VOLUME_NAME:-xot-renderer-tmp}"

# Defaults; overridable via arguments.
IMAGE_TAG="${XOT_RENDERER_IMAGE_TAG:-}"
SERVICE_PROFILE="${XOT_RENDERER_SERVICE_PROFILE:-candidate}"
CONFIGURED_RESTART_POLICY="${XOT_RENDERER_RESTART_POLICY:-}"
DO_BUILD=1
DO_START=0

usage() {
  cat <<EOF
Usage: $0 [--image-tag TAG] [--build-source DIR] [--runtime-env PATH]
  [--control-dir DIR] [--service-profile candidate|persistent]
  [--service-env PATH] [--no-build] [--start]
  --image-tag   explicit image tag (default: derived from selected source)
  --build-source DIR  selected source tree containing Dockerfile
  --runtime-env PATH  secret renderer env file (mode 0600)
  --control-dir DIR   stable directory containing this Compose bundle
  --service-profile PROFILE  candidate (restart no) or persistent (unless-stopped)
  --service-env PATH  non-secret service control env file (for documentation)
  --no-build  skip image rebuild even if tag is missing
  --start  start the container after build (default: build only)
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag|--image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --build-source) SOURCE_DIR="$2"; shift 2 ;;
    --runtime-env) ENV_FILE="$2"; shift 2 ;;
    --control-dir) CONTROL_DIR="$2"; COMPOSE_FILE="${CONTROL_DIR}/docker-compose.lightning.yml"; shift 2 ;;
    --service-profile) SERVICE_PROFILE="$2"; shift 2 ;;
    --service-env) SERVICE_ENV_FILE="$2"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --start) DO_START=1; shift ;;
    *) usage ;;
  esac
done

# Resolve a commit-qualified tag from the persistent source tree if not given.
if [[ -z "${IMAGE_TAG}" ]]; then
  GIT_SHA="$(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
  IMAGE_TAG="xot-video-renderer:lightning-${GIT_SHA}"
fi

case "${SERVICE_PROFILE}" in
  candidate) RESTART_POLICY="no" ;;
  persistent) RESTART_POLICY="unless-stopped" ;;
  *)
    echo "[bootstrap] ERROR: unsupported service profile: ${SERVICE_PROFILE}" >&2
    exit 1
    ;;
esac

if [[ ! "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "[bootstrap] ERROR: invalid Compose project name: ${PROJECT_NAME}" >&2
  exit 1
fi

if [[ ! "${HOST_PORT}" =~ ^[0-9]+$ ]]; then
  echo "[bootstrap] ERROR: host port must be between 1024 and 65535: ${HOST_PORT}" >&2
  exit 1
fi
HOST_PORT_NUMBER=$((10#${HOST_PORT}))
if (( HOST_PORT_NUMBER < 1024 || HOST_PORT_NUMBER > 65535 )); then
  echo "[bootstrap] ERROR: host port must be between 1024 and 65535: ${HOST_PORT}" >&2
  exit 1
fi
HOST_PORT="${HOST_PORT_NUMBER}"

for resource_name in "${NETWORK_NAME}" "${VOLUME_NAME}"; do
  if [[ ! "${resource_name}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    echo "[bootstrap] ERROR: invalid Docker resource name: ${resource_name}" >&2
    exit 1
  fi
done

if [[ "${PROJECT_NAME}" != "xot-renderer" ]] && {
  [[ "${HOST_PORT_NUMBER}" -eq 8797 ]] ||
  [[ "${NETWORK_NAME}" == "xot-renderer-net" ]] ||
  [[ "${VOLUME_NAME}" == "xot-renderer-tmp" ]];
}; then
  echo "[bootstrap] ERROR: a non-production project must use its own host port, network, and volume" >&2
  exit 1
fi

if [[ -n "${CONFIGURED_RESTART_POLICY}" && "${CONFIGURED_RESTART_POLICY}" != "${RESTART_POLICY}" ]]; then
  echo "[bootstrap] ERROR: service profile ${SERVICE_PROFILE} requires restart policy ${RESTART_POLICY}" >&2
  exit 1
fi

export XOT_RENDERER_IMAGE_TAG="${IMAGE_TAG}"
export XOT_RENDERER_BUILD_SOURCE="${SOURCE_DIR}"
export XOT_RENDERER_ENV_FILE="${ENV_FILE}"
export XOT_RENDERER_RESTART_POLICY="${RESTART_POLICY}"
export XOT_RENDERER_COMPOSE_PROJECT="${PROJECT_NAME}"
export XOT_RENDERER_HOST_PORT="${HOST_PORT}"
export XOT_RENDERER_NETWORK_NAME="${NETWORK_NAME}"
export XOT_RENDERER_VOLUME_NAME="${VOLUME_NAME}"

echo "[bootstrap] project:      ${PROJECT_NAME}"
echo "[bootstrap] compose file: ${COMPOSE_FILE}"
echo "[bootstrap] image tag:    ${IMAGE_TAG}"
echo "[bootstrap] build source: ${SOURCE_DIR}"
echo "[bootstrap] env file:     ${ENV_FILE}"
echo "[bootstrap] profile:       ${SERVICE_PROFILE} (${RESTART_POLICY})"
echo "[bootstrap] loopback port: 127.0.0.1:${HOST_PORT}"
echo "[bootstrap] network:       ${NETWORK_NAME}"
echo "[bootstrap] temp volume:   ${VOLUME_NAME}"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[bootstrap] ERROR: compose file not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[bootstrap] ERROR: runtime env not found at ${ENV_FILE}" >&2
  echo "[bootstrap]        Provision it mode 0600 from XOT-owned sources only." >&2
  exit 1
fi

if [[ ! -f "${SERVICE_ENV_FILE}" ]]; then
  echo "[bootstrap] ERROR: non-secret service env not found at ${SERVICE_ENV_FILE}" >&2
  echo "[bootstrap]        Provision it mode 0600 from service.env.example." >&2
  exit 1
fi

if [[ ! -d "${SOURCE_DIR}" || ! -f "${SOURCE_DIR}/Dockerfile" ]]; then
  echo "[bootstrap] ERROR: selected build source must contain Dockerfile: ${SOURCE_DIR}" >&2
  exit 1
fi

# Validate Compose syntax before any action.
echo "[bootstrap] validating compose syntax..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" config --quiet

# Check whether the image already exists locally.
IMAGE_EXISTS="$(docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1 && echo yes || echo no)"
echo "[bootstrap] image exists:  ${IMAGE_EXISTS}"

if [[ "${DO_BUILD}" -eq 1 ]]; then
  if [[ "${IMAGE_EXISTS}" == "no" ]]; then
    echo "[bootstrap] building linux/amd64 image ${IMAGE_TAG} from ${SOURCE_DIR}..."
    docker buildx build \
      --platform linux/amd64 \
      --tag "${IMAGE_TAG}" \
      --label "xot.renderer.source-commit=${GIT_SHA:-unknown}" \
      --label "xot.renderer.build-host=lightning-studio-1" \
      --load \
      "${SOURCE_DIR}"
  else
    echo "[bootstrap] image already present; skipping build."
  fi
fi

# A successful --load makes a previously absent image available to Compose.
# Re-read the local image store before allowing --start to continue.
IMAGE_EXISTS="$(docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1 && echo yes || echo no)"
if [[ "${IMAGE_EXISTS}" == "no" ]]; then
  echo "[bootstrap] ERROR: image ${IMAGE_TAG} is absent and --no-build was requested" >&2
  exit 1
fi

if [[ "${DO_START}" -eq 1 ]]; then
  echo "[bootstrap] starting container (restart policy: ${RESTART_POLICY})..."
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d --no-build
  echo "[bootstrap] container started. Verify with:"
  echo "  docker compose -p ${PROJECT_NAME} -f ${COMPOSE_FILE} ps"
  echo "  curl -fsS http://127.0.0.1:${HOST_PORT}/health"
else
  echo "[bootstrap] build complete. Start with: $0 --image-tag ${IMAGE_TAG} --start"
fi
