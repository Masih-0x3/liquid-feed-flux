#!/usr/bin/env bash
set -Euo pipefail

# Release-state inventory is intentionally target-explicit. The default is to
# do nothing: callers must select a target and a mode. Preview is the only
# target enabled by the E10 Phase 2 workflow; production additionally requires
# a separate JSON identity file and an exact acknowledgement string.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
TARGET=""
MODE=""
PRODUCTION_IDENTITY_FILE=""
PRODUCTION_ACK=""
FAILURES=0
SUPABASE_CLI=(npx --yes supabase@2.111.0)
DB_CONNECTION_URL=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  check-release-state.sh --target preview|production --mode render|dry-run|execute

Preview requires the complete shared preview-identity contract in the
environment. Execute mode additionally requires an XOT_RELEASE_STATE_DB_URL
connection contract that matches the resolved project ref. Render and dry-run
only print a masked command plan. Execute is the only mode that invokes
provider-shaped CLIs.

Production additionally requires:
  --identity-file PATH
  --acknowledgement I_UNDERSTAND_PRODUCTION_RELEASE_STATE

No target or mode is inferred from environment, repository link state, or a
provider default.
USAGE
}

fail() {
  printf 'Release-state target rejected: %s\n' "$1" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --target)
      (($# >= 2)) || fail "--target requires preview or production"
      TARGET="$2"
      shift 2
      ;;
    --mode)
      (($# >= 2)) || fail "--mode requires render, dry-run, or execute"
      MODE="$2"
      shift 2
      ;;
    --identity-file)
      (($# >= 2)) || fail "--identity-file requires a path"
      PRODUCTION_IDENTITY_FILE="$2"
      shift 2
      ;;
    --acknowledgement)
      (($# >= 2)) || fail "--acknowledgement requires the exact acknowledgement"
      PRODUCTION_ACK="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument"
      ;;
  esac
done

[[ "$TARGET" == "preview" || "$TARGET" == "production" ]] || fail "explicit --target is required"
[[ "$MODE" == "render" || "$MODE" == "dry-run" || "$MODE" == "execute" ]] || fail "explicit --mode is required"

mask_identifier() {
  local value="$1"
  if ((${#value} < 8)); then
    printf '[masked]'
  else
    printf '%s…%s' "${value:0:3}" "${value: -3}"
  fi
}

mask_url() {
  local value="$1"
  local host
  host="${value#*://}"
  host="${host%%/*}"
  printf '%s://%s' "${value%%://*}" "$(mask_identifier "$host")"
}

display_arg() {
  local value="$1"
  if [[ "$value" == https://* || "$value" == http://* ]]; then
    mask_url "$value"
  elif [[ "$value" == postgres://* || "$value" == postgresql://* ]]; then
    printf '[masked-db-url]'
  elif [[ "$value" =~ ^[a-z0-9]{20}$ ]]; then
    mask_identifier "$value"
  else
    printf '%s' "$value"
  fi
}

print_command() {
  printf '$'
  local arg
  for arg in "$@"; do
    printf ' %q' "$(display_arg "$arg")"
  done
  printf '\n'
}

section() {
  printf '\n== %s ==\n' "$1"
}

run() {
  print_command "$@"
  "$@"
  local status=$?
  if [[ $status -ne 0 ]]; then
    printf '!! command exited with status %s\n' "$status" >&2
    FAILURES=$((FAILURES + 1))
  fi
  return 0
}

read_preview_identity() {
  local identity_module="$SCRIPT_DIR/preview-identity.mjs"
  [[ -f "$identity_module" ]] || fail "shared Preview identity contract is missing"

  local values
  if ! values="$(node --input-type=module - "$identity_module" <<'NODE'
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
const { readPreviewIdentity, validatePreviewIdentity } = await import(pathToFileURL(modulePath).href);
const result = validatePreviewIdentity(process.env);
if (!result.ok) {
  for (const message of result.errors) console.error(message);
  process.exit(1);
}
const identity = readPreviewIdentity(process.env);
process.stdout.write([
  identity.supabaseProjectRef,
  identity.supabaseUrlHost || new URL(identity.supabaseUrl).hostname,
  identity.previewOrigin,
].join("\t"));
NODE
  )"; then
    fail "shared Preview identity contract rejected the target"
  fi

  IFS=$'\t' read -r PROJECT_REF SUPABASE_HOST PRIMARY_HOST <<< "$values"
  [[ -n "$PROJECT_REF" && -n "$SUPABASE_HOST" && -n "$PRIMARY_HOST" ]] || fail "Preview identity did not produce a complete target"
  VERCEL_HOST="$PRIMARY_HOST"
}

read_production_identity() {
  [[ -n "$PRODUCTION_IDENTITY_FILE" ]] || fail "production requires --identity-file"
  [[ "$PRODUCTION_ACK" == "I_UNDERSTAND_PRODUCTION_RELEASE_STATE" ]] || fail "production requires the exact acknowledgement"
  [[ -f "$PRODUCTION_IDENTITY_FILE" ]] || fail "production identity contract file is missing"

  local values
  if ! values="$(node --input-type=module - "$PRODUCTION_IDENTITY_FILE" "$SCRIPT_DIR/preview-identity.mjs" <<'NODE'
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const file = process.argv[2];
const identityModule = process.argv[3];
const { PRODUCTION_SUPABASE_PROJECT_REF } = await import(pathToFileURL(identityModule).href);
let contract;
try { contract = JSON.parse(readFileSync(file, "utf8")); } catch { process.exit(1); }
const validUrl = (value, hosts) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      && parsed.port === "" && (parsed.pathname === "" || parsed.pathname === "/")
      && parsed.search === "" && parsed.hash === "" && hosts.has(parsed.hostname);
  } catch { return false; }
};
const primary = typeof contract.primaryHost === "string" ? contract.primaryHost.trim() : "";
const vercel = typeof contract.vercelHost === "string" ? contract.vercelHost.trim() : "";
if (contract.environment !== "production"
  || contract.supabaseProjectRef !== PRODUCTION_SUPABASE_PROJECT_REF
  || !validUrl(primary, new Set(["xot.iraneyes.com"]))
  || !validUrl(vercel, new Set(["xot.vercel.app"]))
  || contract.acknowledgement !== "I_UNDERSTAND_PRODUCTION_RELEASE_STATE") process.exit(1);
process.stdout.write([contract.supabaseProjectRef, primary, vercel].join("\t"));
NODE
  )"; then
    fail "production identity contract rejected the target"
  fi

  if [[ "${XOT_ENVIRONMENT:-}" == "preview" || "${VERCEL_ENV:-}" == "preview"
    || -n "${XOT_PREVIEW_ORIGIN:-}" || -n "${XOT_PREVIEW_BRANCH:-}" ]]; then
    fail "production cannot be entered from Preview signals"
  fi

  IFS=$'\t' read -r PROJECT_REF PRIMARY_HOST VERCEL_HOST <<< "$values"
  SUPABASE_HOST="${PROJECT_REF}.supabase.co"
}

read_db_connection_contract() {
  [[ -n "${XOT_RELEASE_STATE_DB_URL:-}" ]] || fail "XOT_RELEASE_STATE_DB_URL connection contract is required for execute mode"

  local ok
  if ! ok="$(node - "$PROJECT_REF" <<'NODE'
const raw = process.env.XOT_RELEASE_STATE_DB_URL;
if (typeof raw !== 'string' || raw.length === 0) process.exit(1);
let parsed;
try { parsed = new URL(raw); } catch { process.exit(1); }
if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) process.exit(1);
if (parsed.username !== 'postgres' || !parsed.password) process.exit(1);
const expectedHost = `db.${process.argv[2]}.supabase.co`;
if (parsed.hostname !== expectedHost) process.exit(1);
if (parsed.pathname !== '/postgres') process.exit(1);
if (parsed.port && parsed.port !== '5432') process.exit(1);
if (parsed.hash) process.exit(1);
process.stdout.write('ok');
NODE
  )" || [[ "$ok" != "ok" ]]; then
    fail "XOT_RELEASE_STATE_DB_URL connection contract rejected the target"
  fi
  DB_CONNECTION_URL="$XOT_RELEASE_STATE_DB_URL"
}

run_secret_names() {
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  print_command env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" secrets list --project-ref "$PROJECT_REF"
  env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" secrets list --project-ref "$PROJECT_REF" >"$tmp"
  local status=$?
  if [[ $status -ne 0 ]]; then
    printf '!! supabase secrets list exited with status %s\n' "$status" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if ! node - "$tmp" <<'NODE'
const fs = require("fs");
const input = fs.readFileSync(process.argv[2], "utf8");
const start = input.indexOf("{");
if (start < 0) process.exit(1);
let data;
try { data = JSON.parse(input.slice(start)); } catch { process.exit(1); }
for (const secret of data.secrets || []) console.log(`${secret.name}\t${secret.updated_at || ""}`);
NODE
  then
    printf '!! failed to parse Supabase secret-name output\n' >&2
    FAILURES=$((FAILURES + 1))
  fi
  rm -f "$tmp"
  trap - RETURN
}

run_inventory() {
  section "Local Git"
  run git status --short --branch
  run git rev-parse HEAD
  run git rev-parse origin/main
  run git worktree list --porcelain

  section "GitHub"
  if command -v gh >/dev/null 2>&1; then
    run gh repo view --json nameWithOwner,isPrivate,defaultBranchRef,url
    run gh pr list --state open --json number,title,headRefName,baseRefName,url
    run gh issue list --state open --json number,title,url
    run gh run list --branch main --limit 5 --json databaseId,workflowName,headSha,status,conclusion,createdAt,updatedAt,url
  else
    echo "gh CLI not found; skipping GitHub inventory."
  fi

  section "Vercel"
  if command -v vercel >/dev/null 2>&1; then
    run env VERCEL_ENV="$TARGET" vercel project inspect xot
    run env VERCEL_ENV="$TARGET" vercel ls xot
  else
    echo "vercel CLI not found; skipping Vercel CLI inventory."
  fi

  section "Live Hosts"
  run curl -sSI "$PRIMARY_HOST"
  if [[ "$VERCEL_HOST" != "$PRIMARY_HOST" ]]; then run curl -sSI "$VERCEL_HOST"; fi

  section "Supabase Functions"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" functions list --project-ref "$PROJECT_REF"

  section "Supabase Migrations"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" migration list --db-url "$DB_CONNECTION_URL"

  section "Supabase Secret Names"
  run_secret_names

  section "Supabase Cron"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db query --db-url "$DB_CONNECTION_URL" "select jobname, schedule, active from cron.job order by jobname;"

  section "Supabase Queue Health"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db query --db-url "$DB_CONNECTION_URL" "select type, status, count(*)::int as count from public.jobs group by type, status order by type, status;"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db query --db-url "$DB_CONNECTION_URL" "select id, type, status, started_at, locked_at, lease_expires_at from public.jobs where status='running' and coalesce(lease_expires_at, started_at) < now() - interval '15 minutes' order by started_at nulls last limit 20;"

  section "Supabase Renderer Health"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db query --db-url "$DB_CONNECTION_URL" "select renderer_id, status, version, render_version, processed, failed, last_seen_at from public.video_renderer_heartbeats order by last_seen_at desc limit 5;"

  section "Supabase Settings"
  run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db query --db-url "$DB_CONNECTION_URL" "select key, jsonb_typeof(value) as value_type, value ? 'mode' as has_mode, value->>'mode' as mode from public.settings where key in ('video_render_config','x_posting_config','content_filter','scoring_policy') order by key;"

  if [[ "${CHECK_RELEASE_ADVISORS:-0}" == "1" ]]; then
    section "Supabase Advisors"
    run env SUPABASE_TELEMETRY_DISABLED=1 "${SUPABASE_CLI[@]}" db advisors --db-url "$DB_CONNECTION_URL"
  else
    section "Supabase Advisors"
    echo "Skipped by default. Set CHECK_RELEASE_ADVISORS=1 to include advisors."
  fi
}

if [[ "$TARGET" == "preview" ]]; then
  [[ -z "$PRODUCTION_IDENTITY_FILE" && -z "$PRODUCTION_ACK" ]] || fail "Preview cannot accept production identity flags"
  read_preview_identity
else
  read_production_identity
fi

if [[ "$MODE" == "render" || "$MODE" == "dry-run" ]]; then
  printf 'RELEASE_STATE_RENDER target=%s mode=%s project=%s supabase=%s primary=%s vercel=%s\n' \
    "$TARGET" "$MODE" "$(mask_identifier "$PROJECT_REF")" "$(mask_identifier "$SUPABASE_HOST")" \
    "$(mask_url "$PRIMARY_HOST")" "$(mask_url "$VERCEL_HOST")"
  exit 0
fi

read_db_connection_contract

run_inventory

if [[ $FAILURES -ne 0 ]]; then
  printf '\n%s release-state check(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf '\nRelease-state checks completed successfully for %s.\n' "$TARGET"
