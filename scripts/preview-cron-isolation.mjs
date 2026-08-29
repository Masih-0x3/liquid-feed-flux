#!/usr/bin/env node

/**
 * Preview-only pre/post-migration cron guard.
 *
 * Some historical migrations create pg_cron jobs with the production Edge
 * Functions host in the command body. Replaying those migrations into the
 * isolated Preview database can therefore create cross-environment calls.
 * This module emits target-bound SQL gates for execution immediately before
 * and after a Preview migration replay. It does not rewrite historical
 * migrations.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPreviewIdentity,
  readPreviewIdentity,
} from "./preview-identity.mjs";

export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PRODUCTION_SUPABASE_PROJECT_REF = "jzirqfzzvlbxwfzndaer";
export const PRODUCTION_EDGE_HOST = `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
export const PRODUCTION_EDGE_URL_PREFIX = `https://${PRODUCTION_EDGE_HOST}/functions/v1/`;
export const PREVIEW_CRON_PRE_REPLAY_MARKER = "XOT_PREVIEW_CRON_PRE_REPLAY_GATE_V2";
export const PREVIEW_CRON_POST_REPLAY_MARKER = "XOT_PREVIEW_CRON_POST_REPLAY_GUARD_V2";
export const PREVIEW_CRON_GUARD_MARKERS = Object.freeze([
  PREVIEW_CRON_PRE_REPLAY_MARKER,
  PREVIEW_CRON_POST_REPLAY_MARKER,
]);
export const SUPABASE_CLI = Object.freeze(["npx", "--yes", "supabase@2.111.0"]);

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const PRODUCTION_URL_RE = new RegExp(
  `https://${PRODUCTION_SUPABASE_PROJECT_REF}\\.supabase\\.co/functions/v1/`,
  "i",
);

function requirePreviewProjectRef(projectRef) {
  if (!PROJECT_REF_RE.test(projectRef) || projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error("Preview cron guard requires a non-production 20-character project ref");
  }
  return projectRef;
}

function buildIdentityPrelude(ref) {
  const previewUrl = `https://${ref}.supabase.co`;
  return `SELECT set_config('app.settings.xot_environment', 'preview', false);
SELECT set_config('app.settings.supabase_url', '${previewUrl}/', false);`;
}

function buildIdentityVerificationBlock(ref) {
  return `DO $xot_preview_cron_identity$
DECLARE
  target_environment text := lower(trim(current_setting('app.settings.xot_environment', true)));
  configured_url text := lower(regexp_replace(trim(current_setting('app.settings.supabase_url', true)), '/+$', ''));
  expected_preview_url constant text := 'https://${ref}.supabase.co';
BEGIN
  IF target_environment <> 'preview' OR configured_url <> expected_preview_url THEN
    RAISE EXCEPTION 'Preview cron isolation requires the validated Preview target';
  END IF;
END
$xot_preview_cron_identity$;`;
}

function buildScheduleDisableBlock() {
  return `DO $xot_preview_cron_disable_schedules$
DECLARE
  scheduled_job record;
BEGIN
  FOR scheduled_job IN SELECT jobid FROM cron.job WHERE active IS DISTINCT FROM false LOOP
    PERFORM cron.alter_job(scheduled_job.jobid, active => false);
  END LOOP;
END
$xot_preview_cron_disable_schedules$;`;
}

function buildQueueClearBlock() {
  return `DO $xot_preview_cron_clear_net_queue$
BEGIN
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE 'DELETE FROM net.http_request_queue';
  END IF;
END
$xot_preview_cron_clear_net_queue$;`;
}

/**
 * Build the explicit gate that must run before Preview migration replay.
 * Database-level cron launch suppression covers new connections opened by the
 * migration runner; the transaction covers existing jobs and queued requests.
 */
export function buildPreviewCronPreReplayGateSql(projectRef) {
  const ref = requirePreviewProjectRef(projectRef);
  return `-- ${PREVIEW_CRON_PRE_REPLAY_MARKER}
${buildIdentityPrelude(ref)}
${buildIdentityVerificationBlock(ref)}

-- Applies to migration-runner connections opened after this gate.
ALTER DATABASE postgres SET cron.launch_active_jobs = 'off';
BEGIN;
${buildScheduleDisableBlock()}
${buildQueueClearBlock()}
COMMIT;`;
}

/**
 * Build the idempotent post-replay guard. Preview keeps cron launches off and
 * all schedules inactive; definitions remain present for later review.
 */
export function buildPreviewCronPostReplayGuardSql(projectRef) {
  const ref = requirePreviewProjectRef(projectRef);
  return `-- ${PREVIEW_CRON_POST_REPLAY_MARKER}
${buildIdentityPrelude(ref)}
BEGIN;
${buildIdentityVerificationBlock(ref)}
${buildScheduleDisableBlock()}
${buildQueueClearBlock()}
COMMIT;`;
}

/** Backward-compatible alias for callers that mean the post-replay guard. */
export function buildPreviewCronIsolationSql(projectRef) {
  return buildPreviewCronPostReplayGuardSql(projectRef);
}

function activeActivationPattern() {
  // Reject active => true or active = true, while allowing the required active => false.
  return /\bactive\s*(?:=>|=)\s*(?:true|'true'|"true")\b/i;
}

export function assertPreviewCronIsolationSql(sql, projectRef = "abcdefghijklmnopqrst") {
  const ref = requirePreviewProjectRef(projectRef);

  const hasPre = sql.includes(PREVIEW_CRON_PRE_REPLAY_MARKER);
  const hasPost = sql.includes(PREVIEW_CRON_POST_REPLAY_MARKER);
  if (hasPre && hasPost) {
    throw new Error("Preview cron guard must have a single phase marker");
  }
  if (!hasPre && !hasPost) {
    throw new Error("Preview cron guard is missing its phase marker");
  }
  const phase = hasPre ? "pre-replay" : "post-replay";

  const required = [
    "set_config('app.settings.xot_environment', 'preview', false)",
    `set_config('app.settings.supabase_url', 'https://${ref}.supabase.co/', false)`,
    "target_environment <> 'preview'",
    "configured_url <> expected_preview_url",
    "active IS DISTINCT FROM false",
    "cron.alter_job(scheduled_job.jobid, active => false)",
    "to_regclass('net.http_request_queue') IS NOT NULL",
    "DELETE FROM net.http_request_queue",
  ];
  if (phase === "pre-replay") {
    required.push("cron.launch_active_jobs = 'off'");
  }
  for (const needle of required) {
    if (!sql.includes(needle)) throw new Error(`Preview cron guard is missing ${needle}`);
  }

  if (activeActivationPattern().test(sql)) {
    throw new Error("Preview cron guard must not activate schedules");
  }

  if (sql.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error("Preview cron guard must not target the production project ref");
  }

  if (/cron\.unschedule|DROP\s+JOB|DROP\s+TABLE|DROP\s+SCHEMA/i.test(sql)) {
    throw new Error("Preview cron guard must preserve schedule definitions");
  }

  if (/postgres(?:ql)?:\/\/|Bearer\s+\S+|sb_secret_|sbp_[A-Za-z0-9_-]{8,}/i.test(sql)) {
    throw new Error("Preview cron guard must not contain credentials");
  }
  return true;
}

/**
 * Extract all named schedules from migrations that contain a production Edge
 * URL anywhere in the migration. This intentionally catches indirect calls,
 * such as x-poster-tick invoking a function whose body posts to production.
 */
export function findProductionTargetedCronSchedules(root = REPO_ROOT) {
  const migrationsDir = join(root, "supabase", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const findings = [];

  for (const filename of files) {
    const source = readFileSync(join(migrationsDir, filename), "utf8");
    if (!PRODUCTION_URL_RE.test(source)) continue;
    const starts = [...source.matchAll(/cron\.schedule\s*\(/gi)].map((match) => match.index);
    for (const [index, start] of starts.entries()) {
      const segment = source.slice(start, starts[index + 1] ?? source.length);
      const name = segment.match(/cron\.schedule\s*\(\s*['"]([^'"]+)['"]/i)?.[1];
      if (name) findings.push({ filename, name, indirect: !PRODUCTION_URL_RE.test(segment) });
    }
  }
  return findings;
}

export function assertPreviewCronIsolationContract(root = REPO_ROOT) {
  const findings = findProductionTargetedCronSchedules(root);
  if (findings.length === 0) throw new Error("No historical production-targeted cron hazard was found");
  if (!findings.some(({ name }) => name === "x-poster-tick")) {
    throw new Error("Indirect x-poster-tick cron target was not characterized");
  }
  assertPreviewCronIsolationSql(buildPreviewCronPostReplayGuardSql("abcdefghijklmnopqrst"));
  assertPreviewCronIsolationSql(buildPreviewCronPreReplayGateSql("abcdefghijklmnopqrst"));
  return findings;
}

function dbConnectionMatchesProject(raw, projectRef) {
  if (typeof raw !== "string" || raw.length === 0) return false;
  let parsed;
  try { parsed = new URL(raw); } catch { return false; }
  return ["postgres:", "postgresql:"].includes(parsed.protocol)
    && parsed.username === "postgres"
    && parsed.password !== ""
    && parsed.hostname === `db.${projectRef}.supabase.co`
    && parsed.pathname === "/postgres"
    && (!parsed.port || parsed.port === "5432")
    && parsed.hash === "";
}

export function runPreviewCronIsolation({ phase = "post-replay", env = process.env, execFileSyncImpl = execFileSync } = {}) {
  const identity = assertPreviewIdentity(env);
  const preview = readPreviewIdentity(env);
  if (!dbConnectionMatchesProject(env.XOT_RELEASE_STATE_DB_URL, preview.supabaseProjectRef)) {
    throw new Error("XOT_RELEASE_STATE_DB_URL must match the validated Preview project");
  }
  const sql = phase === "pre-replay"
    ? buildPreviewCronPreReplayGateSql(preview.supabaseProjectRef)
    : buildPreviewCronPostReplayGuardSql(preview.supabaseProjectRef);
  const args = [...SUPABASE_CLI, "db", "query", "--db-url", env.XOT_RELEASE_STATE_DB_URL, sql];
  execFileSyncImpl(args[0], args.slice(1), {
    env: { ...env, SUPABASE_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
    stdio: "inherit",
  });
  return {
    identity,
    projectRef: preview.supabaseProjectRef,
    marker: phase === "pre-replay" ? PREVIEW_CRON_PRE_REPLAY_MARKER : PREVIEW_CRON_POST_REPLAY_MARKER,
  };
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--check") {
    const findings = assertPreviewCronIsolationContract();
    console.log(`PREVIEW_CRON_ISOLATION_SOURCE_CONTRACT_PASS hazards=${findings.length}`);
    return;
  }
  if (mode === "--pre-replay") {
    const result = runPreviewCronIsolation({ phase: "pre-replay" });
    console.log(`PREVIEW_CRON_ISOLATION_EXECUTED phase=pre-replay marker=${result.marker}`);
    return;
  }
  if (mode === "--post-replay" || mode === "--execute") {
    const result = runPreviewCronIsolation({ phase: "post-replay" });
    console.log(`PREVIEW_CRON_ISOLATION_EXECUTED phase=post-replay marker=${result.marker}`);
    return;
  }
  throw new Error("usage: node scripts/preview-cron-isolation.mjs --check|--pre-replay|--post-replay|--execute");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
