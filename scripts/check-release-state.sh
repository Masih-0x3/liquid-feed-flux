#!/usr/bin/env bash
set -uo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-jzirqfzzvlbxwfzndaer}"
PRIMARY_HOST="${XOT_PRIMARY_HOST:-https://xot.iraneyes.com}"
VERCEL_HOST="${XOT_VERCEL_HOST:-https://xot.vercel.app}"
FAILURES=0

section() {
  printf '\n== %s ==\n' "$1"
}

run() {
  printf '$'
  printf ' %q' "$@"
  printf '\n'
  "$@"
  local status=$?
  if [[ $status -ne 0 ]]; then
    printf '!! command exited with status %s\n' "$status" >&2
    FAILURES=$((FAILURES + 1))
  fi
  return 0
}

run_secret_names() {
  local tmp
  tmp="$(mktemp)"
  printf '$ SUPABASE_TELEMETRY_DISABLED=1 npx supabase secrets list --project-ref %q | node <secret-name-parser>\n' "$PROJECT_REF"

  SUPABASE_TELEMETRY_DISABLED=1 npx supabase secrets list --project-ref "$PROJECT_REF" >"$tmp"
  local status=$?
  if [[ $status -ne 0 ]]; then
    rm -f "$tmp"
    printf '!! supabase secrets list exited with status %s\n' "$status" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if ! node - "$tmp" <<'NODE'
const fs = require("fs");

const inputPath = process.argv[2];
const input = fs.readFileSync(inputPath, "utf8");
const start = input.indexOf("{");

if (start < 0) {
  console.error("No JSON object found in Supabase secrets output.");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(input.slice(start));
} catch (error) {
  console.error(`Failed to parse Supabase secrets JSON: ${error.message}`);
  process.exit(1);
}

for (const secret of data.secrets || []) {
  console.log(`${secret.name}\t${secret.updated_at || ""}`);
}
NODE
  then
    rm -f "$tmp"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  rm -f "$tmp"
  return 0
}

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
  run vercel project inspect xot
  run vercel ls xot --prod
else
  echo "vercel CLI not found; skipping Vercel CLI inventory."
  echo "Use the Vercel connector or install/authenticate the Vercel CLI for live deployment details."
fi

section "Live Hosts"
run curl -sSI "$PRIMARY_HOST"
run curl -sSI "$VERCEL_HOST"

section "Supabase Functions"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase functions list --project-ref "$PROJECT_REF"

section "Supabase Migrations"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration list --linked

section "Supabase Secret Names"
run_secret_names

section "Supabase Cron"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked "select jobname, schedule, active from cron.job order by jobname;"

section "Supabase Queue Health"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked "select type, status, count(*)::int as count from public.jobs group by type, status order by type, status;"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked "select id, type, status, started_at, locked_at, lease_expires_at from public.jobs where status='running' and coalesce(lease_expires_at, started_at) < now() - interval '15 minutes' order by started_at nulls last limit 20;"

section "Supabase Renderer Health"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked "select renderer_id, status, version, render_version, processed, failed, last_seen_at from public.video_renderer_heartbeats order by last_seen_at desc limit 5;"

section "Supabase Settings"
run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db query --linked "select key, jsonb_typeof(value) as value_type, value ? 'mode' as has_mode, value->>'mode' as mode from public.settings where key in ('video_render_config','x_posting_config','content_filter','scoring_policy') order by key;"

if [[ "${CHECK_RELEASE_ADVISORS:-0}" == "1" ]]; then
  section "Supabase Advisors"
  run env SUPABASE_TELEMETRY_DISABLED=1 npx supabase db advisors --linked
else
  section "Supabase Advisors"
  echo "Skipped by default. Run CHECK_RELEASE_ADVISORS=1 npm run check:release-state to include advisors."
fi

if [[ $FAILURES -ne 0 ]]; then
  printf '\n%s release-state check(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf '\nRelease-state checks completed successfully.\n'
