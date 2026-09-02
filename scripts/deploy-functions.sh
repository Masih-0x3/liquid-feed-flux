#!/usr/bin/env bash
set -euo pipefail

# This wrapper is Preview-only. It must never infer a remote target from the
# checkout or from supabase/config.toml. The identity check runs before any
# deploy-capable command (including a fake npx used by tests).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IDENTITY_MODULE="$SCRIPT_DIR/preview-identity.mjs"
SUPABASE_CLI=(npx --yes supabase@2.111.0)
CONFIG_FILE="${SUPABASE_CONFIG_FILE:-supabase/config.toml}"
DRY_RUN="${DEPLOY_FUNCTIONS_DRY_RUN:-0}"
ALLOW_DIRTY="${DEPLOY_ALLOW_DIRTY:-0}"

case "$DRY_RUN" in
  0|1) ;;
  *)
    echo "Invalid DEPLOY_FUNCTIONS_DRY_RUN value; use 0 or 1" >&2
    exit 1
    ;;
esac

if [[ ! -f "$IDENTITY_MODULE" ]]; then
  echo "Missing Preview identity module: $IDENTITY_MODULE" >&2
  exit 1
fi

# The payload is captured, never printed. It contains the effective ref and
# branch for the CLI plus the shared module's masked summary for safe output.
if ! IDENTITY_PAYLOAD="$({
  XOT_PREVIEW_IDENTITY_MODULE="$IDENTITY_MODULE" node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const identityModule = await import(pathToFileURL(process.env.XOT_PREVIEW_IDENTITY_MODULE).href);
    const { readPreviewIdentity, validatePreviewIdentity } = identityModule;
    const result = validatePreviewIdentity(process.env);
    if (!result.ok) {
      for (const message of result.errors) console.error(message);
      process.exit(2);
    }
    const identity = readPreviewIdentity(process.env);
    process.stdout.write(`${identity.supabaseProjectRef}\t${identity.previewBranch}\t${JSON.stringify(result.identity)}`);
  '
} 2>&1)"; then
  echo "$IDENTITY_PAYLOAD" >&2
  echo "Refusing to run: Preview identity was rejected before any Supabase CLI command." >&2
  exit 1
fi

IFS=$'\t' read -r PROJECT_REF PREVIEW_BRANCH IDENTITY_SUMMARY <<< "$IDENTITY_PAYLOAD"
if [[ -z "$PROJECT_REF" || -z "$PREVIEW_BRANCH" || -z "$IDENTITY_SUMMARY" ]]; then
  echo "Refusing to run: Preview identity payload was incomplete." >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current || true)"

if [[ -z "$BRANCH" ]]; then
  echo "Refusing to run from a detached HEAD; checked-out branch must match Preview identity." >&2
  exit 1
fi
if [[ "$BRANCH" != "$PREVIEW_BRANCH" ]]; then
  echo "Refusing to run: checked-out branch does not match the declared Preview branch." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing Supabase config file: $CONFIG_FILE" >&2
  exit 1
fi

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

echo "==> Supabase Preview function deploy preflight"
echo "Preview identity: $IDENTITY_SUMMARY"
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
  if [[ "$ALLOW_DIRTY" != "1" ]]; then
    echo "Refusing to deploy from a dirty working tree. Commit/stash changes or set DEPLOY_ALLOW_DIRTY=1." >&2
    exit 1
  fi
  echo "Working tree is dirty; explicit DEPLOY_ALLOW_DIRTY=1 accepted."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  for fn in "${FUNCTIONS[@]}"; do
    verify_jwt="$(function_verify_jwt "$fn")"
    args=(functions deploy "$fn" --project-ref "$PROJECT_REF")
    if [[ "$verify_jwt" == "false" ]]; then
      args+=(--no-verify-jwt)
    fi
    printf '==> Dry run: would run npx --yes supabase@2.111.0 functions deploy %q --project-ref [masked-preview-ref]' "$fn"
    if [[ "$verify_jwt" == "false" ]]; then
      printf ' --no-verify-jwt'
    fi
    printf '\n'
  done
  echo "==> Dry run: would set DEPLOY_GIT_SHA=[masked-sha] on [masked-preview-ref] after all selected deploys succeed"
  echo "==> Dry run complete. No CLI command, secret, or function was changed."
  exit 0
fi

for fn in "${FUNCTIONS[@]}"; do
  verify_jwt="$(function_verify_jwt "$fn")"
  args=(functions deploy "$fn" --project-ref "$PROJECT_REF")
  if [[ "$verify_jwt" == "false" ]]; then
    args+=(--no-verify-jwt)
  fi

  echo "==> Deploying $fn (verify_jwt=$verify_jwt)"
  "${SUPABASE_CLI[@]}" "${args[@]}"
done

echo "==> Setting DEPLOY_GIT_SHA=[current-sha] on [preview-ref]"
"${SUPABASE_CLI[@]}" secrets set DEPLOY_GIT_SHA="$SHA" --project-ref "$PROJECT_REF"

echo "==> All done. Preview deploy completed for current SHA."
