import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  ACTIVATION_ONLY_X_RETIREMENT,
  buildProductionConvergenceSql,
  EXPECTED_INCLUSION_COUNT,
  EXPECTED_MIGRATION_ORDER,
  extractSourceOrder,
  validateProductionConvergenceSql,
} from "./build-xot-v2-production-convergence-sql.mjs";

export const REPLAY_CONTEXT = "orbstack";
// The exact Supabase PostgreSQL image digest used by the current historical
// zero-write harness. The replay runs it with --pull=never, --network none,
// no host ports, and no mounts.
export const REPLAY_EXPECTED_IMAGE =
  "public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
export const REPLAY_EXPECTED_IMAGE_COMMAND = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
export const REPLAY_CONTAINER_PREFIX = "xot-convergence-replay-";
export const REPLAY_LABEL_KEY = "xot.convergence-replay";
export const REPLAY_LABEL_VALUE = "disposable";
export const REPLAY_INIT_COMPLETE_MARKER = "PostgreSQL init process complete; ready for start up.";
export const REPLAY_PRELUDE = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'service_role') $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL,
  name text NOT NULL, owner_id uuid, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`.trim();

export const REPLAY_ASSERTION_PASS = "XOT_CONVERGENCE_REPLAY_PASS";
export const REPLAY_ASSERTION_PHASES = Object.freeze([
  "preflight",
  "post-bundle-first",
  "post-bundle-second",
  "post-t2",
  "rollback-forward-fix",
]);

// Strongest local approximation of the current V1 production semantics: the
// production frontier before the 23-source convergence set, plus the three V1
// hotfix migrations that production now relies on. This is not a production
// restore and uses no protected live data.
export const LOCAL_V1_BASELINE_E10_PREFIX_COUNT = 108;
export const LOCAL_V1_BASELINE_TAIL = Object.freeze([
  "20260825024826_render_only_automation_cutover.sql",
  "20260825091418_v1_delivery_continuity_cutover.sql",
  "20260825104845_v1_delivery_cutover_settle_reason_prefix.sql",
]);
export const LOCAL_V1_BASELINE_EXCLUDED_SUCCESSORS = Object.freeze([
  "20260722162000_video_render_feedback_revision.sql",
  "20260723173100_lock_down_video_render_raw_tables.sql",
  "20260724183000_add_current_user_is_admin_rpc.sql",
  "20260730070000_telegram_delivery_claims.sql",
  "20260806123000_media_object_cleanup_claims.sql",
  "20260806143000_b3_job_x_claim_fencing.sql",
  "20260806153000_b3b1_rss_webhook_receipts.sql",
  "20260808110000_b3b2_digest_checkpoints.sql",
  "20260808123000_b4_video_render_claim_fencing.sql",
  "20260808133000_b2b_media_object_deletion_token_uuid.sql",
  "20260808143000_b3a_reconcile_expired_job_claims_fix.sql",
  "20260808153000_b3a_fail_x_post_delivery_null_fix.sql",
  "20260808163000_b3a_claim_x_ambiguous_retry_fix.sql",
  "20260808173000_b3a_claim_x_ambiguous_history_fix.sql",
  "20260811090000_revoke_public_default_privileges.sql",
  "20260812100000_e10_preview_runtime_controls_and_roles.sql",
  "20260825220124_xot_v2_runtime_controls_activation_bridge.sql",
  "20260827064509_repair_effective_claim_fence_and_delivery_cutover.sql",
  "20260828120000_repair_effective_x_claim_cutover.sql",
  "20260828130000_retire_legacy_x_delivery_overloads.sql",
  "20260828140000_runtime_control_claim_release_race_guards.sql",
  "20260829120000_reconcile_historical_delivery_jobs.sql",
  "20260830120000_enforce_historical_delivery_zero_write.sql",
]);

export const ZERO_WRITE_FIXTURE = Object.freeze({
  accountId: "00000000-0000-0000-0000-000000009001",
  accountHandle: "replay-fixture",
  pendingTweetId: "replay-pending",
  runningTweetId: "replay-running",
  pendingJobId: "00000000-0000-0000-0000-000000009011",
  runningJobId: "00000000-0000-0000-0000-000000009012",
  runningJobLockedBy: "replay-fixture",
});

export function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateSqlLines(sql, label) {
  const text = String(sql ?? "");
  const lines = text.split("\n");
  const state = { blockCommentDepth: 0, dollarTag: null, doubleQuoted: false, singleQuoted: false };
  for (const line of lines) {
    if (maskNonTopLevelSql(line, state).trim() === "COMMIT;") {
      throw new Error(`${label}: nested COMMIT is forbidden in a statement bundle`);
    }
    if (/^(?:\\|\s*$)/.test(line)) continue;
    if (/^--/.test(line.trim())) continue;
    if (maskNonTopLevelSql(line, state).trim() === "BEGIN;") continue;
  }
  return text;
}

function maskNonTopLevelSql(line, state) {
  let masked = "";
  let index = 0;
  while (index < line.length) {
    if (state.dollarTag !== null) {
      if (line.startsWith(state.dollarTag, index)) {
        masked += " ".repeat(state.dollarTag.length);
        index += state.dollarTag.length;
        state.dollarTag = null;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (state.blockCommentDepth > 0) {
      if (line.startsWith("/*", index)) {
        state.blockCommentDepth += 1;
        masked += "  ";
        index += 2;
      } else if (line.startsWith("*/", index)) {
        state.blockCommentDepth -= 1;
        masked += "  ";
        index += 2;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (state.singleQuoted) {
      if (line[index] === "'" && line[index + 1] === "'") {
        masked += "  ";
        index += 2;
      } else if (line[index] === "'") {
        state.singleQuoted = false;
        masked += " ";
        index += 1;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (state.doubleQuoted) {
      if (line[index] === '"' && line[index + 1] === '"') {
        masked += "  ";
        index += 2;
      } else if (line[index] === '"') {
        state.doubleQuoted = false;
        masked += " ";
        index += 1;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }
    if (line.startsWith("--", index)) {
      masked += " ".repeat(line.length - index);
      break;
    }
    if (line.startsWith("/*", index)) {
      state.blockCommentDepth = 1;
      masked += "  ";
      index += 2;
      continue;
    }
    if (line[index] === "'") {
      state.singleQuoted = true;
      masked += " ";
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      state.doubleQuoted = true;
      masked += " ";
      index += 1;
      continue;
    }
    if (line[index] === "$") {
      const tag = line.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        state.dollarTag = tag;
        masked += " ".repeat(tag.length);
        index += tag.length;
        continue;
      }
    }
    masked += line[index];
    index += 1;
  }
  return masked;
}

export function makeContainerName(suffix = randomBytes(8).toString("hex")) {
  const value = String(suffix);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new Error("container suffix is invalid");
  return `${REPLAY_CONTAINER_PREFIX}${value}`;
}

export function buildDockerCreateArgs(name, cidfilePath) {
  if (typeof name !== "string" || !name.startsWith(REPLAY_CONTAINER_PREFIX)) {
    throw new Error("container name is outside the replay prefix");
  }
  if (typeof cidfilePath !== "string" || !cidfilePath || /[\r\n]/.test(cidfilePath)) {
    throw new Error("cidfile path is invalid");
  }
  return [
    "create", "--pull=never", "--cidfile", cidfilePath, "--network", "none",
    "--label", `${REPLAY_LABEL_KEY}=${REPLAY_LABEL_VALUE}`,
    "--name", name, "--env", "POSTGRES_PASSWORD", REPLAY_EXPECTED_IMAGE,
    ...REPLAY_EXPECTED_IMAGE_COMMAND,
  ];
}

export function buildDockerInvocation(args) {
  return ["--context", REPLAY_CONTEXT, ...args];
}

export function validateContainerId(value) {
  const raw = String(value ?? "");
  if (!/^[0-9a-f]{12,64}\n?$/i.test(raw)) throw new Error("cidfile does not contain one container ID");
  return raw.trim();
}

export async function recoverCidfileId(path, { readFileImpl = readFile } = {}) {
  try {
    return validateContainerId(await readFileImpl(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function normalizePortBindings(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  return Object.entries(value).flatMap(([port, bindings]) => Array.isArray(bindings)
    ? bindings.filter(Boolean).map((binding) => ({ port, ...binding })) : []);
}

export function assertImageInspect(inspect) {
  if (!inspect?.RepoDigests?.includes(REPLAY_EXPECTED_IMAGE)) {
    throw new Error("exact cached image digest is missing");
  }
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(REPLAY_EXPECTED_IMAGE_COMMAND)) {
    throw new Error("image command mismatch");
  }
  if (inspect?.Config?.Volumes && Object.keys(inspect.Config.Volumes).length > 0) {
    throw new Error("image declares volumes");
  }
  return inspect;
}

export function assertContainerOwnership(inspect, record) {
  if (!record?.id || inspect?.Id !== record.id) throw new Error("container ownership lost: id");
  if (String(inspect?.Name ?? "").replace(/^\//, "") !== record.name) {
    throw new Error("container ownership lost: name");
  }
  if (inspect?.Config?.Image !== REPLAY_EXPECTED_IMAGE) throw new Error("container image mismatch");
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(REPLAY_EXPECTED_IMAGE_COMMAND)) {
    throw new Error("container command mismatch");
  }
  if (inspect?.Config?.Labels?.[REPLAY_LABEL_KEY] !== REPLAY_LABEL_VALUE) {
    throw new Error("container label mismatch");
  }
  if (inspect?.HostConfig?.NetworkMode !== "none") throw new Error("container network mode is not none");
  const networkNames = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (networkNames.length !== 1 || networkNames[0] !== "none") {
    throw new Error("container network attachment is not none");
  }
  if ((inspect?.Mounts ?? []).length > 0
    || (inspect?.HostConfig?.Binds ?? []).length > 0
    || (inspect?.HostConfig?.Mounts ?? []).length > 0) {
    throw new Error("container mount is present");
  }
  if (normalizePortBindings(inspect?.HostConfig?.PortBindings).length > 0
    || normalizePortBindings(inspect?.NetworkSettings?.Ports).length > 0) {
    throw new Error("container port binding is present");
  }
  return inspect.Id;
}

export function isNotFoundDiagnostic(error) {
  return /no such (?:object|container)|not found|does not exist/i.test(String(error?.message ?? error ?? ""));
}

export function cleanupDecision({ id, ownershipProven = false } = {}) {
  if (!id) return Object.freeze({ remove: false, reason: "no-recorded-id" });
  if (!ownershipProven) return Object.freeze({ remove: false, reason: "ownership-unproven" });
  return Object.freeze({ remove: true, reason: "owned-exact-id" });
}

export function semanticDriftFromFingerprints(first, second) {
  if (first === null || second === null) return null;
  return first !== second;
}

export async function cleanupRecordedContainer({ id, inspect, remove, assertOwnership = () => {} } = {}) {
  if (!id) return Object.freeze({ status: "not-created", removed: false, absent: true });
  if (typeof inspect !== "function" || typeof remove !== "function") {
    throw new TypeError("inspect and remove are required");
  }
  let item;
  try {
    item = await inspect(id);
    assertOwnership(item, { id });
  } catch (error) {
    return Object.freeze({ status: "failed", phase: "ownership", removed: false, absent: false, error });
  }
  try {
    await remove(id);
  } catch (error) {
    return Object.freeze({ status: "failed", phase: "remove", removed: false, absent: false, error });
  }
  try {
    const remaining = await inspect(id);
    if (remaining) {
      return Object.freeze({ status: "failed", phase: "absence", removed: false, absent: false, error: new Error("exact container remains after cleanup") });
    }
  } catch (error) {
    if (!isNotFoundDiagnostic(error)) {
      return Object.freeze({ status: "failed", phase: "absence", removed: false, absent: false, error });
    }
  }
  return Object.freeze({ status: "removed", removed: true, absent: true });
}

export function parseAssertionRows(raw) {
  const rows = {};
  for (const line of String(raw ?? "").replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    if (line.trim() === REPLAY_ASSERTION_PASS) continue;
    const match = line.match(/^([a-z][a-z0-9_]*)=(.*)$/);
    if (!match) throw new Error("assertion output row is malformed");
    const [, key, value] = match;
    if (/(?:password|secret|token|authorization|key)/i.test(key)) {
      throw new Error("assertion output contains sensitive key");
    }
    if (Object.hasOwn(rows, key)) throw new Error(`duplicate assertion row: ${key}`);
    rows[key] = value;
  }
  return rows;
}

export function parseAssertionPass(raw) {
  const lines = String(raw ?? "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const matches = lines.filter((line) => line === REPLAY_ASSERTION_PASS).length;
  if (matches !== 1) throw new Error(`SQL assertion sentinel count=${matches}`);
  if (lines.at(-1) !== REPLAY_ASSERTION_PASS) throw new Error("SQL assertion sentinel is not final");
  return REPLAY_ASSERTION_PASS;
}

export function assertBundleSql(bundleSql) {
  const sql = String(bundleSql ?? "");
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("COMMIT;\n")) {
    throw new Error("bundle must be one outer BEGIN/COMMIT transaction");
  }
  const result = validateProductionConvergenceSql(sql);
  if (result.inclusionCount !== EXPECTED_INCLUSION_COUNT) {
    throw new Error(`bundle inclusion count=${result.inclusionCount}`);
  }
  if (JSON.stringify(result.sourceOrder) !== JSON.stringify(EXPECTED_MIGRATION_ORDER)) {
    throw new Error("bundle source order drifted");
  }
  if (result.sourceOrder.some((name) => name === ACTIVATION_ONLY_X_RETIREMENT)
    || sql.includes(ACTIVATION_ONLY_X_RETIREMENT)) {
    throw new Error("activation-only X retirement must stay outside the bundle");
  }
  if (JSON.stringify(extractSourceOrder(sql)) !== JSON.stringify(EXPECTED_MIGRATION_ORDER)) {
    throw new Error("extracted source order does not match the manifest");
  }
  return result;
}

export async function buildReplayBundle({
  root = process.cwd(),
  readFileImpl = (path, encoding) => readFileSync(path, encoding),
} = {}) {
  const bundle = buildProductionConvergenceSql({
    root,
    readFileImpl,
  });
  assertBundleSql(bundle);
  return bundle;
}

export async function readLocalBaseline(
  root,
  { readdirImpl = readdir, readFileImpl = readFile } = {},
) {
  const migrationsDir = join(root, "supabase/migrations");
  const all = (await readdirImpl(migrationsDir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  if (all.length < LOCAL_V1_BASELINE_E10_PREFIX_COUNT) {
    throw new Error(`E10 migration prefix incomplete: ${all.length}`);
  }
  const prefix = all.slice(0, LOCAL_V1_BASELINE_E10_PREFIX_COUNT);
  for (const filename of LOCAL_V1_BASELINE_TAIL) {
    if (!all.includes(filename)) throw new Error(`V1 baseline migration is missing: ${filename}`);
  }
  const entries = [];
  for (const filename of [...prefix, ...LOCAL_V1_BASELINE_TAIL]) {
    const body = await readFileImpl(join(migrationsDir, filename), "utf8");
    entries.push({ filename, sha256: sha256(body) });
  }
  return Object.freeze({
    label: "local-v1-frontier-derived",
    e10PrefixCount: prefix.length,
    lastMigration: entries.at(-1)?.filename,
    migrations: Object.freeze(entries),
  });
}

export function assertLocalBaselineAvailable(entries) {
  const found = new Set((entries ?? []).map((entry) => entry?.filename));
  for (const filename of LOCAL_V1_BASELINE_EXCLUDED_SUCCESSORS) {
    if (found.has(filename)) {
      throw new Error(`local V1 baseline must not include convergence successor: ${filename}`);
    }
  }
  const expectedCount = LOCAL_V1_BASELINE_E10_PREFIX_COUNT + LOCAL_V1_BASELINE_TAIL.length;
  if (found.size !== expectedCount) {
    throw new Error(`local V1 baseline must contain exactly ${expectedCount} migrations`);
  }
  return Object.freeze({ label: "local-v1-frontier-derived", count: found.size });
}

export function buildZeroWriteFixtureSql(fixture = ZERO_WRITE_FIXTURE) {
  return String.raw`
INSERT INTO public.accounts (id, handle, created_at)
VALUES ('${fixture.accountId}', '${fixture.accountHandle}', '2020-01-01T00:00:00Z');

INSERT INTO public.posts (tweet_id, account_id, text_original, created_at)
VALUES
  ('${fixture.pendingTweetId}', '${fixture.accountId}', 'pending fixture', '2020-01-01T00:00:00Z'),
  ('${fixture.runningTweetId}', '${fixture.accountId}', 'running fixture', '2020-01-01T00:00:01Z');

INSERT INTO public.jobs (
  id, type, payload, status, next_run_at, created_at,
  locked_at, locked_by, lease_expires_at
)
VALUES
  ('${fixture.pendingJobId}', 'deliver', '{"tweet_id":"${fixture.pendingTweetId}"}', 'pending', now() - interval '1 hour', '2020-01-01T00:00:02Z', NULL, NULL, NULL),
  ('${fixture.runningJobId}', 'deliver', '{"tweet_id":"${fixture.runningTweetId}"}', 'running', now() - interval '1 hour', '2020-01-01T00:00:03Z', now() - interval '2 hours', '${fixture.runningJobLockedBy}', now() - interval '1 hour');
`.trim();
}

export function buildPreflightAssertions() {
  return String.raw`
-- Read-only preflight. No mutation is performed in this section.
SELECT 'bundle_preflight_t2_absent=' || (to_regclass('public.runtime_activation_epochs') IS NULL);
SELECT 'bundle_preflight_runtime_controls_absent=' || (to_regclass('public.runtime_controls') IS NULL);
SELECT 'bundle_preflight_zero_write_fixture_rows=' || (
  (SELECT count(*) FROM public.jobs WHERE id IN (
    '00000000-0000-0000-0000-000000009011',
    '00000000-0000-0000-0000-000000009012'))
);
SELECT 'bundle_preflight_delivery_receipt_rows=' || (
  (SELECT count(*) FROM public.deliveries WHERE subject_id IN ('replay-pending', 'replay-running'))
  + (SELECT count(*) FROM public.x_deliveries WHERE post_id IN ('replay-pending', 'replay-running'))
);
`.trim();
}

export function buildPostBundleAssertions() {
  return String.raw`
-- Post-transaction assertions after each bundle replay.
SELECT 'post_bundle_t2_absent=' || (NOT EXISTS (SELECT 1 FROM public.runtime_activation_epochs));
SELECT 'post_bundle_runtime_controls_rows=' || (SELECT count(*) FROM public.runtime_controls);
SELECT 'post_bundle_runtime_controls_singleton=' || (
  SELECT count(*) = 1 FROM public.runtime_controls
  WHERE singleton_id IS TRUE AND singleton_key IS TRUE
    AND environment = 'preview' AND posting_mode = 'blocked'
);
SELECT 'post_bundle_app_role_labels=' || (SELECT array_to_string(array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder), ',')
  FROM pg_enum AS enum_value JOIN pg_type AS type ON type.oid = enum_value.enumtypid
  JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = 'public' AND type.typname = 'app_role');
SELECT 'post_bundle_user_roles_pk=' || COALESCE((SELECT string_agg(attribute.attname, ',' ORDER BY key.position)
  FROM pg_constraint AS constraint_row JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position) ON true
  JOIN pg_attribute AS attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key.attnum
  WHERE constraint_row.conrelid = 'public.user_roles'::regclass AND constraint_row.contype = 'p'), '');
SELECT 'post_bundle_rls_runtime_controls=' || relrowsecurity FROM pg_class WHERE oid = 'public.runtime_controls'::regclass;
SELECT 'post_bundle_rls_user_roles=' || relrowsecurity FROM pg_class WHERE oid = 'public.user_roles'::regclass;
SELECT 'post_bundle_rls_runtime_activation_epochs=' || relrowsecurity FROM pg_class WHERE oid = 'public.runtime_activation_epochs'::regclass;
SELECT 'post_bundle_table_grants=' || (
  has_table_privilege('authenticated', 'public.user_roles', 'SELECT')
  AND has_table_privilege('authenticated', 'public.runtime_controls', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.user_roles', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.user_roles', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.user_roles', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.runtime_controls', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.runtime_controls', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.runtime_controls', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.user_roles', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.runtime_controls', 'SELECT'));
SELECT 'post_bundle_rpc_grants=' || (
  has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.current_user_is_admin()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.update_runtime_controls(boolean,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.current_user_role()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.current_user_is_admin()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_runtime_controls(boolean,boolean)', 'EXECUTE'));
SELECT 'post_bundle_role_functions_search_path=' || (
  (SELECT count(*) = 2 FROM pg_proc WHERE oid IN ('public.current_user_role()'::regprocedure, 'public.current_user_is_admin()'::regprocedure)
    AND 'search_path=""' = ANY(COALESCE(proconfig, ARRAY[]::text[]))));
SELECT 'post_bundle_update_rpc_security_definer=' || prosecdef FROM pg_proc WHERE oid = 'public.update_runtime_controls(boolean,boolean)'::regprocedure;
SELECT 'post_bundle_update_rpc_search_path=' || ('search_path=""' = ANY(COALESCE(proconfig, ARRAY[]::text[]))) FROM pg_proc WHERE oid = 'public.update_runtime_controls(boolean,boolean)'::regprocedure;
SELECT 'post_bundle_zero_write_trigger=' || EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'public.jobs'::regclass
    AND tgname = 'trg_00_historical_delivery_job_zero_write'
    AND NOT tgisinternal
    AND tgenabled = 'O'
);
SELECT 'post_bundle_cutover_allows_job_returns=' || (
  SELECT count(*) FROM public.jobs AS j
  WHERE j.id = '00000000-0000-0000-0000-000000009011'
    AND public.delivery_cutover_allows_job(j.created_at, NULLIF(btrim(j.payload->>'tweet_id'), ''))
);
SELECT 'post_bundle_historical_jobs_unchanged=' || (
  SELECT count(*) = 2
  FROM public.jobs AS j
  WHERE j.id IN ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009012')
    AND j.status IN ('pending', 'running')
);
SELECT 'post_bundle_historical_claim_defaults=' || (
  SELECT count(*) = 2
  FROM public.jobs AS j
  WHERE j.id IN ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009012')
    AND j.claim_token IS NULL
    AND j.claim_generation = 0
    AND j.claim_state = 'idle'
    AND j.claim_started_at IS NULL
    AND j.claim_expires_at IS NULL
    AND j.provider_started_at IS NULL
);
SELECT 'post_bundle_receipt_tables_empty=' || (
  (SELECT count(*) FROM public.deliveries WHERE subject_id IN ('replay-pending', 'replay-running'))
  + (SELECT count(*) FROM public.x_deliveries WHERE post_id IN ('replay-pending', 'replay-running'))
);
`.trim();
}

export function buildPostT2Assertions() {
  return String.raw`
-- Post-T2 read-only assertions. T2 is appended once by activate_runtime_v2 and
-- is never mutated or removed.
SELECT 'post_t2_epoch_count=' || (SELECT count(*) FROM public.runtime_activation_epochs);
SELECT 'post_t2_epoch_t1_immutable=' || (
  SELECT count(*) = 1 FROM public.runtime_activation_epochs
  WHERE t1_cutover_at = TIMESTAMPTZ '2026-08-25 10:36:06.834081+00'
);
SELECT 'post_t2_cutover_after_t1=' || (
  public.get_delivery_cutover() > TIMESTAMPTZ '2026-08-25 10:36:06.834081+00'
);
SELECT 'post_t2_lineage_blocked=' || (
  NOT public.runtime_v2_allows_lineage(TIMESTAMPTZ '2026-08-25 10:36:06.834081+00', 1)
);
SELECT 'post_t2_historical_jobs_unchanged=' || (
  SELECT count(*) = 2
  FROM public.jobs AS j
  WHERE j.id IN ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009012')
    AND j.status IN ('pending', 'running')
);
SELECT 'post_t2_receipt_tables_empty=' || (
  (SELECT count(*) FROM public.deliveries WHERE subject_id IN ('replay-pending', 'replay-running'))
  + (SELECT count(*) FROM public.x_deliveries WHERE post_id IN ('replay-pending', 'replay-running'))
);
`.trim();
}

export function buildRollbackForwardFixAssertions() {
  return String.raw`
-- Rollback/forward-fix assertions: the candidate surface must be re-appliable
-- and the immutable boundaries must reject both T1-equal lineage and a second
-- activation row.
SELECT 'rollback_replay_epoch_count_unchanged=' || (
  SELECT count(*) = 1 FROM public.runtime_activation_epochs
);
SELECT 'rollback_forward_fix_settle_zero_dml=' || (
  NOT public.settle_delivery_cutover_blocked('00000000-0000-0000-0000-000000009012', 'delivery_cutover_blocked:fixture')
);
SELECT 'rollback_forward_fix_epoch_append_only=' || (
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.runtime_activation_epochs'::regclass
      AND tgname = 'runtime_activation_epochs_immutable'
      AND NOT tgisinternal
      AND tgenabled = 'O'
  )
);
SELECT 'rollback_forward_fix_epochs_reject_second_activation=' || (
  NOT EXISTS (SELECT 1 FROM public.runtime_activation_epochs WHERE activation_key = 'replay-second-activation')
);
SELECT '${REPLAY_ASSERTION_PASS}';
`.trim();
}

export function buildZeroWriteAssertionSql() {
  return String.raw`
DO $$
DECLARE
  claimed_count integer;
  delivery_attempts integer;
BEGIN
  FOR attempt IN 1..2 LOOP
    SELECT count(*) INTO claimed_count
    FROM public.claim_jobs(100, ARRAY['deliver']::text[], 'replay-fixture');
    IF claimed_count <> 0 THEN
      RAISE EXCEPTION 'historical delivery job was claimed';
    END IF;

    IF public.settle_delivery_cutover_blocked(
      '00000000-0000-0000-0000-000000009012',
      'delivery_cutover_blocked:fixture'
    ) THEN
      RAISE EXCEPTION 'historical delivery settlement reported a write';
    END IF;

    PERFORM public.reconcile_stuck_jobs();
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM zero_write_before AS b
    JOIN public.jobs AS j USING (id)
    WHERE b.row_data IS DISTINCT FROM (
      to_jsonb(j) - ARRAY[
        'claim_token', 'claim_generation', 'claim_state',
        'claim_started_at', 'claim_expires_at', 'provider_started_at'
      ]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'historical delivery job row changed';
  END IF;

  SELECT
    (SELECT count(*) FROM public.deliveries WHERE subject_id IN ('replay-pending', 'replay-running'))
    + (SELECT count(*) FROM public.x_deliveries WHERE post_id IN ('replay-pending', 'replay-running'))
  INTO delivery_attempts;
  IF delivery_attempts <> 0 THEN
    RAISE EXCEPTION 'historical delivery provider receipt was created';
  END IF;

  BEGIN
    UPDATE public.jobs SET last_error = 'must-not-write'
    WHERE id = '00000000-0000-0000-0000-000000009012';
    RAISE EXCEPTION 'historical update was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'delivery_cutover_blocked:historical_deliver_job_zero_write%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM public.jobs
    WHERE id = '00000000-0000-0000-0000-000000009011';
    RAISE EXCEPTION 'historical delete was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'delivery_cutover_blocked:historical_deliver_job_zero_write%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

SELECT '${REPLAY_ASSERTION_PASS}';
`.trim();
}

export function buildActivationAssertionSql() {
  return String.raw`
SELECT public.activate_runtime_v2('replay-activation', 'replay-operator');
`.trim();
}

export function buildCatalogFingerprintQuery() {
  return String.raw`
WITH fingerprint_rows AS (
  SELECT 'tables' AS kind, format('%s.%s', n.nspname, c.relname) AS identity,
    format('relkind=%s relrowsecurity=%s relforcerowsecurity=%s relispartition=%s',
      c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relispartition) AS detail,
    '' AS extra
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'columns', format('%s.%s.%s', n.nspname, c.relname, a.attname),
    format('type=%s notnull=%s default=%s', format_type(a.atttypid, a.atttypmod), a.attnotnull,
      COALESCE(pg_get_expr(d.adbin, d.adrelid), '')),
    ''
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraints', format('%s.%s.%s', n.nspname, c.relname, con.conname),
    format('contype=%s definition=%s', con.contype, pg_get_constraintdef(con.oid)),
    ''
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'indexes', format('%s.%s.%s', n.nspname, c.relname, i.relname),
    format('unique=%s valid=%s predicate=%s', ix.indisunique, ix.indisvalid, COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '')),
    COALESCE(pg_get_indexdef(ix.indexrelid), '')
  FROM pg_index ix
  JOIN pg_class c ON c.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class i ON i.oid = ix.indexrelid
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'policies', format('%s.%s.%s', n.nspname, c.relname, pol.polname),
    format('cmd=%s permissive=%s roles=%s using=%s check=%s', pol.polcmd, pol.polpermissive,
      COALESCE((SELECT string_agg(rolname, ',' ORDER BY rolname)
        FROM unnest(pol.polroles) AS r(oid) JOIN pg_roles pr ON pr.oid = r.oid), ''),
      COALESCE(pg_get_expr(pol.polqual, pol.polrelid), ''),
      COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')),
    ''
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'routines', format('%s.%s', n.nspname, p.proname),
    format('args=%s returns=%s language=%s volatility=%s security_definer=%s leakproof=%s',
      pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
      p.prolang::regtype::text, p.provolatile, p.prosecdef, p.proleakproof),
    COALESCE(p.proconfig::text, '')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep
      WHERE dep.objid = p.oid AND dep.deptype = 'i')
  UNION ALL
  SELECT 'routines_body', format('%s.%s', n.nspname, p.proname),
    format('args=%s body=%s', pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)),
    ''
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep
      WHERE dep.objid = p.oid AND dep.deptype = 'i')
  UNION ALL
  SELECT 'triggers', format('%s.%s.%s', n.nspname, c.relname, t.tgname),
    format('enabled=%s type=%s definition=%s', t.tgenabled, t.tgtype, pg_get_triggerdef(t.oid)),
    ''
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'enums', format('%s.%s', n.nspname, t.typname),
    format('labels=%s', (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = t.oid)),
    ''
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
  UNION ALL
  SELECT 'role_grants', format('%s.%s', privilege.grantee::regrole::text, privilege.grantor::regrole::text),
    format('type=%s privileges=%s', privilege.grantee = 0, privilege.privilege_type),
    ''
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS privilege
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'default_acl', format('%s.%s', n.nspname, d.defaclobjtype::text),
    format('acl=%s', COALESCE((SELECT string_agg(aclitem::text, ',' ORDER BY aclitem::text)
      FROM unnest(d.defaclacl) AS aclitem), '')),
    ''
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'runtime_cutover', 'runtime_activation_epochs',
    format('count=%s t1=%s', (SELECT count(*) FROM public.runtime_activation_epochs),
      (SELECT count(DISTINCT t1_cutover_at) FROM public.runtime_activation_epochs)),
    ''
  UNION ALL
  SELECT 'runtime_cutover', 'delivery_cutover',
    format('count=%s', (SELECT count(*) FROM public.delivery_cutover)),
    ''
  UNION ALL
  SELECT 'zero_write_contract', 'historical_delivery_job_zero_write',
    format('trigger_exists=%s',
      EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.jobs'::regclass
          AND tgname = 'trg_00_historical_delivery_job_zero_write'
          AND NOT tgisinternal AND tgenabled = 'O')),
    ''
)
SELECT format('%s|%s|%s|%s', kind, identity, detail, extra)
FROM fingerprint_rows
ORDER BY kind, identity;
`.trim();
}

export function fingerprintFromRows(rows) {
  const canonical = String(rows ?? "").replace(/\r/g, "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
  return sha256(canonical.join("\n"));
}

export function assertFingerprintsEqual(first, second) {
  if (typeof first !== "string" || !/^[0-9a-f]{64}$/.test(first)) {
    throw new Error("first fingerprint is invalid");
  }
  if (typeof second !== "string" || !/^[0-9a-f]{64}$/.test(second)) {
    throw new Error("second fingerprint is invalid");
  }
  if (first !== second) {
    throw new Error(`semantic catalog drift: first=${first} second=${second}`);
  }
  return first;
}

export function assertZeroWriteInvariantSql() {
  return String.raw`
DROP TABLE IF EXISTS zero_write_before;
CREATE TEMP TABLE zero_write_before AS
SELECT id, to_jsonb(j) - ARRAY[
  'claim_token', 'claim_generation', 'claim_state',
  'claim_started_at', 'claim_expires_at', 'provider_started_at'
]::text[] AS row_data
FROM public.jobs AS j
WHERE id IN (
  '00000000-0000-0000-0000-000000009011',
  '00000000-0000-0000-0000-000000009012'
);
`.trim();
}

export function buildAssertionBundle(phase) {
  if (!REPLAY_ASSERTION_PHASES.includes(phase)) {
    throw new Error(`unknown assertion phase: ${phase}`);
  }
  const sections = {
    preflight: [buildPreflightAssertions()],
    "post-bundle-first": [buildPostBundleAssertions(), buildZeroWriteAssertionSql()],
    "post-bundle-second": [buildPostBundleAssertions(), buildZeroWriteAssertionSql()],
    "post-t2": [buildPostT2Assertions(), assertZeroWriteInvariantSql(), buildZeroWriteAssertionSql()],
    "rollback-forward-fix": [buildRollbackForwardFixAssertions()],
  };
  return sections[phase].join("\n\n");
}

export function validateReplayPhaseSql(phase, sql) {
  if (!REPLAY_ASSERTION_PHASES.includes(phase)) throw new Error(`unknown assertion phase: ${phase}`);
  if (String(sql ?? "").trim().length === 0) throw new Error(`${phase}: empty assertion SQL`);
  validateSqlLines(sql, `phase ${phase}`);
  return sql;
}
