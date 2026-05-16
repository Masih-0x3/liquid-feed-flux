#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-jzirqfzzvlbxwfzndaer}"
CONFIG_FILE="${SUPABASE_CONFIG_FILE:-supabase/config.toml}"
SHA=$(git rev-parse --short HEAD)

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

echo "==> Setting DEPLOY_GIT_SHA=$SHA on $PROJECT_REF"
npx supabase secrets set DEPLOY_GIT_SHA="$SHA" --project-ref "$PROJECT_REF"

for fn in "${FUNCTIONS[@]}"; do
  verify_jwt="$(function_verify_jwt "$fn")"
  if [[ -z "$verify_jwt" ]]; then
    echo "Missing verify_jwt for function '$fn' in $CONFIG_FILE" >&2
    exit 1
  fi

  args=(functions deploy "$fn" --project-ref "$PROJECT_REF")
  if [[ "$verify_jwt" == "false" ]]; then
    args+=(--no-verify-jwt)
  elif [[ "$verify_jwt" != "true" ]]; then
    echo "Invalid verify_jwt=$verify_jwt for function '$fn'" >&2
    exit 1
  fi

  echo "==> Deploying $fn (verify_jwt=$verify_jwt)"
  npx supabase "${args[@]}"
done

echo "==> All done. SHA=$SHA"
