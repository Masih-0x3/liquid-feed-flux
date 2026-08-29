#!/usr/bin/env node

/**
 * Preview-only post-migration cron guard.
 *
 * Some historical migrations create pg_cron jobs with the production Edge
 * Functions host in the command body. Replaying those migrations into the
 * isolated Preview database can therefore create cross-environment calls.
 * This module emits a target-bound SQL guard for execution after a Preview
 * migration replay. It does not rewrite historical migrations.
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
export const PREVIEW_CRON_GUARD_MARKER = "XOT_PREVIEW_CRON_ISOLATION_GUARD_V1";
export const SUPABASE_CLI = Object.freeze(["npx", "--yes", "supabase@2.111.0"]);

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const CRON_SCHEDULE_RE = /cron\.schedule\s*\(/gi;
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

/**
 * Build a deterministic SQL guard for the already-validated Preview target.
 * The session settings bind the SQL to the same identity tuple that was
 * validated by preview-identity.mjs; no secret or database value is embedded.
 */
export function buildPreviewCronIsolationSql(projectRef) {
  const ref = requirePreviewProjectRef(projectRef);
  const previewUrl = `https://${ref}.supabase.co`;
  return `-- ${PREVIEW_CRON_GUARD_MARKER}
BEGIN;
SELECT set_config('app.settings.xot_environment', 'preview', false);
SELECT set_config('app.settings.supabase_url', '${previewUrl}/', false);
DO $xot_preview_cron_isolation_guard$
DECLARE
  target_environment text := lower(trim(current_setting('app.settings.xot_environment', true)));
  configured_url text := lower(regexp_replace(trim(current_setting('app.settings.supabase_url', true)), '/+$', ''));
  expected_preview_url constant text := '${previewUrl}';
BEGIN
  IF target_environment <> 'preview' THEN
    RAISE EXCEPTION 'Preview cron isolation requires an explicit Preview target';
  END IF;
  IF configured_url <> expected_preview_url THEN
    RAISE EXCEPTION 'Preview cron isolation target does not match the validated project';
  END IF;
  IF configured_url = 'https://${PRODUCTION_EDGE_HOST}' THEN
    RAISE EXCEPTION 'Preview cron isolation refused the production project';
  END IF;

  UPDATE cron.job
  SET active = false
  WHERE active IS DISTINCT FROM false
    AND command ILIKE '%${PRODUCTION_EDGE_URL_PREFIX}%';
END
$xot_preview_cron_isolation_guard$;
COMMIT;`;
}

/** Extract the named cron schedules whose command body targets production. */
export function findProductionTargetedCronSchedules(root = REPO_ROOT) {
  const migrationsDir = join(root, "supabase", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const findings = [];

  for (const filename of files) {
    const source = readFileSync(join(migrationsDir, filename), "utf8");
    const starts = [...source.matchAll(CRON_SCHEDULE_RE)].map((match) => match.index);
    for (const [index, start] of starts.entries()) {
      const end = starts[index + 1] ?? source.length;
      const segment = source.slice(start, end);
      const name = segment.match(/cron\.schedule\s*\(\s*['"]([^'"]+)['"]/i)?.[1];
      if (name && PRODUCTION_URL_RE.test(segment)) findings.push({ filename, name });
    }
  }
  return findings;
}

export function assertPreviewCronIsolationSql(sql, projectRef = "abcdefghijklmnopqrst") {
  const ref = requirePreviewProjectRef(projectRef);
  const required = [
    PREVIEW_CRON_GUARD_MARKER,
    "set_config('app.settings.xot_environment', 'preview', false)",
    `set_config('app.settings.supabase_url', 'https://${ref}.supabase.co/', false)`,
    "target_environment <> 'preview'",
    "configured_url <> expected_preview_url",
    "UPDATE cron.job",
    "SET active = false",
    "active IS DISTINCT FROM false",
    PRODUCTION_EDGE_URL_PREFIX,
  ];
  for (const needle of required) {
    if (!sql.includes(needle)) throw new Error(`Preview cron guard is missing ${needle}`);
  }
  if (/DROP\s+JOB|cron\.unschedule/i.test(sql)) {
    throw new Error("Preview cron guard must preserve schedule definitions");
  }
  if (/postgres(?:ql)?:\/\/|Bearer\s+\S+|sb_secret_|sbp_[A-Za-z0-9_-]{8,}/i.test(sql)) {
    throw new Error("Preview cron guard must not contain credentials");
  }
  return true;
}

export function assertPreviewCronIsolationContract(root = REPO_ROOT) {
  const findings = findProductionTargetedCronSchedules(root);
  if (findings.length === 0) throw new Error("No historical production-targeted cron hazard was found");
  assertPreviewCronIsolationSql(buildPreviewCronIsolationSql("abcdefghijklmnopqrst"));
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

export function runPreviewCronIsolation({ env = process.env, execFileSyncImpl = execFileSync } = {}) {
  const identity = assertPreviewIdentity(env);
  const preview = readPreviewIdentity(env);
  if (!dbConnectionMatchesProject(env.XOT_RELEASE_STATE_DB_URL, preview.supabaseProjectRef)) {
    throw new Error("XOT_RELEASE_STATE_DB_URL must match the validated Preview project");
  }
  const sql = buildPreviewCronIsolationSql(preview.supabaseProjectRef);
  const args = [...SUPABASE_CLI, "db", "query", "--db-url", env.XOT_RELEASE_STATE_DB_URL, sql];
  execFileSyncImpl(args[0], args.slice(1), {
    env: { ...env, SUPABASE_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
    stdio: "inherit",
  });
  return { identity, projectRef: preview.supabaseProjectRef, marker: PREVIEW_CRON_GUARD_MARKER };
}

function main() {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--check") {
    const findings = assertPreviewCronIsolationContract();
    console.log(`PREVIEW_CRON_ISOLATION_SOURCE_CONTRACT_PASS hazards=${findings.length}`);
    return;
  }
  if (mode === "--execute") {
    runPreviewCronIsolation();
    console.log(`PREVIEW_CRON_ISOLATION_EXECUTED marker=${PREVIEW_CRON_GUARD_MARKER}`);
    return;
  }
  throw new Error("usage: node scripts/preview-cron-isolation.mjs --check|--execute");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
