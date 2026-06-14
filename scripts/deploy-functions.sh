#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-jzirqfzzvlbxwfzndaer}"
CONFIG_FILE="${SUPABASE_CONFIG_FILE:-supabase/config.toml}"
DRY_RUN="${DEPLOY_FUNCTIONS_DRY_RUN:-0}"
ALLOW_DIRTY="${DEPLOY_ALLOW_DIRTY:-0}"
ALLOW_NON_MAIN="${DEPLOY_ALLOW_NON_MAIN:-0}"
SHA="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current || true)"
ORIGIN_MAIN="$(git rev-parse --verify origin/main 2>/dev/null || true)"

configured_functions() {
  awk -F'[][]' '/^\[functions\.[^]]+\]$/ { print $2 }' "$CONFIG_FILE" | sed 's/^functions\.//'
}

function_verify_jwt() {
  local fn="$1"
  awk -v section="[functions.${fn}]" '
    $0 == section { in_section = 1; next }
    /^\[functions\./ && in_section { exit }
    in_section && $1 == "verify_jwt" {
      gsub(/[[:space:]]/, "", $0)
      split($0, parts, "=")
      print parts[2]
      exit
    }
  ' "$CONFIG_FILE"
}

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing Supabase config file: $CONFIG_FILE" >&2
  exit 1
fi

if [[ $# -gt 0 ]]; then
  FUNCTIONS=("$@")
else
  FUNCTIONS=()
  while IFS= read -r fn; do
    [[ -n "$fn" ]] && FUNCTIONS+=("$fn")
  done < <(configured_functions)
fi

if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  echo "No functions selected for deploy" >&2
  exit 1
fi

echo "==> Supabase function deploy preflight"
echo "Project ref: $PROJECT_REF"
echo "Config file: $CONFIG_FILE"
echo "Git branch: ${BRANCH:-detached}"
echo "Git SHA: $SHA"
echo "Dry run: $DRY_RUN"
echo "Functions:"

for fn in "${FUNCTIONS[@]}"; do
  if [[ ! "$fn" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid function name '$fn'" >&2
    exit 1
  fi

  verify_jwt="$(function_verify_jwt "$fn")"
  if [[ -z "$verify_jwt" ]]; then
    echo "Missing verify_jwt for function '$fn' in $CONFIG_FILE" >&2
    exit 1
  fi

  if [[ "$verify_jwt" != "true" && "$verify_jwt" != "false" ]]; then
    echo "Invalid verify_jwt=$verify_jwt for function '$fn'" >&2
    exit 1
  fi

  entrypoint="supabase/functions/$fn/index.ts"
  if [[ ! -f "$entrypoint" ]]; then
    echo "Missing function entrypoint for '$fn': $entrypoint" >&2
    exit 1
  fi

  echo "  - $fn (verify_jwt=$verify_jwt, entrypoint=$entrypoint)"
done

dirty_status="$(git status --short)"
if [[ -n "$dirty_status" ]]; then
  echo "Working tree has uncommitted changes:"
  echo "$dirty_status"
  if [[ "$ALLOW_DIRTY" != "1" ]]; then
    echo "Refusing to deploy from a dirty working tree. Commit/stash changes or set DEPLOY_ALLOW_DIRTY=1." >&2
    exit 1
  fi
fi

if [[ "${BRANCH:-}" != "main" ]]; then
  if [[ "$ALLOW_NON_MAIN" != "1" ]]; then
    echo "Refusing to deploy from branch '${BRANCH:-detached}'. Deploy from main or set DEPLOY_ALLOW_NON_MAIN=1." >&2
    exit 1
  fi
elif [[ -z "$ORIGIN_MAIN" ]]; then
  if [[ "$ALLOW_NON_MAIN" != "1" ]]; then
    echo "Refusing to deploy because origin/main is not available. Run git fetch origin --prune or set DEPLOY_ALLOW_NON_MAIN=1." >&2
    exit 1
  fi
elif [[ "$SHA" != "$ORIGIN_MAIN" ]]; then
  if [[ "$ALLOW_NON_MAIN" != "1" ]]; then
    echo "Refusing to deploy because local main ($SHA) does not match origin/main ($ORIGIN_MAIN)." >&2
    exit 1
  fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  for fn in "${FUNCTIONS[@]}"; do
    verify_jwt="$(function_verify_jwt "$fn")"
    args=(functions deploy "$fn" --project-ref "$PROJECT_REF")
    if [[ "$verify_jwt" == "false" ]]; then
      args+=(--no-verify-jwt)
    fi
    printf '==> Dry run: would run'
    printf ' %q' npx supabase "${args[@]}"
    printf '\n'
  done
  echo "==> Dry run: would set DEPLOY_GIT_SHA=$SHA on $PROJECT_REF after all selected deploys succeed"
  echo "==> Dry run complete. No secrets or functions changed."
  exit 0
fi

for fn in "${FUNCTIONS[@]}"; do
  verify_jwt="$(function_verify_jwt "$fn")"
  args=(functions deploy "$fn" --project-ref "$PROJECT_REF")
  if [[ "$verify_jwt" == "false" ]]; then
    args+=(--no-verify-jwt)
  fi

  echo "==> Deploying $fn (verify_jwt=$verify_jwt)"
  npx supabase "${args[@]}"
done

echo "==> Setting DEPLOY_GIT_SHA=$SHA on $PROJECT_REF"
npx supabase secrets set DEPLOY_GIT_SHA="$SHA" --project-ref "$PROJECT_REF"

echo "==> All done. SHA=$SHA"
