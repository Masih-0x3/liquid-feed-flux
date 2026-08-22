import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  E7_DISPOSABLE_PRELUDE,
  E7_INIT_COMPLETE_MARKER,
  redactDiagnostic as e7RedactDiagnostic,
} from "./e7DisposableBoundary.mjs";

export const E10_CONTEXT = "orbstack";
export const E10_EXPECTED_IMAGE = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
export const E10_EXPECTED_IMAGE_COMMAND = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
export const E10_EXPECTED_MIGRATION_COUNT = 124;
export const E10_EXPECTED_INVENTORY_SHA256 = "d6c31480f6d7c9e926be12bf0e555af9d34d74b07f2b4efa42f5e01f120a5b57";
export const E10_EXPECTED_MIGRATION_VERSION = "20260812100000";
export const E10_EXPECTED_MIGRATION_NAME = "e10_preview_runtime_controls_and_roles";
export const E10_EXPECTED_MIGRATION_SHA256 = "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7";
export const E10_CONTAINER_PREFIX = "xot-e10-sql-";
export const E10_LABEL_KEY = "xot.e10";
export const E10_LABEL_VALUE = "disposable";
export const E10_INIT_COMPLETE_MARKER = E7_INIT_COMPLETE_MARKER;
export const E10_DISPOSABLE_PRELUDE = E7_DISPOSABLE_PRELUDE;
export const E10_ASSERTION_PASS = "E10_SQL_ASSERTION_PASS";

const MAX_DIAGNOSTIC_LENGTH = 640;
const CHILD_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT",
  "SUPABASE_TELEMETRY_DISABLED", "SUPABASE_UPDATE_DISABLED", "POSTGRES_PASSWORD",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash the immutable, order-independent migration tuple used by the E10 receipt. */
export function inventorySha256(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

/** Convert migration filenames to the exact receipt tuple (stem excludes version and .sql). */
export function buildMigrationInventory(files) {
  const entries = files.map((entry) => {
    const file = typeof entry === "string" ? entry : entry?.file ?? entry?.path ?? entry?.name;
    const match = basename(String(file ?? "")).match(/^(\d{14})_(.+)\.sql$/);
    if (!match) throw new Error(`migration filename is invalid: ${file ?? "unknown"}`);
    const sourceSha = typeof entry === "string" ? undefined : entry?.sha256;
    if (!/^[0-9a-f]{64}$/i.test(String(sourceSha ?? ""))) {
      throw new Error(`migration SHA is invalid: ${file}`);
    }
    return { version: match[1], name: match[2], sha256: String(sourceSha).toLowerCase() };
  }).sort((a, b) => a.version.localeCompare(b.version));
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.version)) throw new Error(`duplicate migration version: ${entry.version}`);
    seen.add(entry.version);
  }
  return entries;
}

export async function readMigrationInventory(directory) {
  const names = (await readdir(directory)).filter((name) => /^\d{14}_.+\.sql$/.test(name));
  const files = await Promise.all(names.map(async (file) => ({
    file,
    sha256: sha256(await readFile(join(directory, file))),
  })));
  return buildMigrationInventory(files);
}

export function assertExpectedMigrationInventory(entries) {
  if (entries.length !== E10_EXPECTED_MIGRATION_COUNT) throw new Error(`migration count=${entries.length}`);
  const digest = inventorySha256(entries);
  if (digest !== E10_EXPECTED_INVENTORY_SHA256) throw new Error(`ordered migration inventory SHA drifted: ${digest}`);
  const latest = entries.find((entry) => entry.version === E10_EXPECTED_MIGRATION_VERSION);
  if (!latest || latest.name !== E10_EXPECTED_MIGRATION_NAME || latest.sha256 !== E10_EXPECTED_MIGRATION_SHA256) {
    throw new Error("E10 migration SHA or identity drifted");
  }
  return Object.freeze({ count: entries.length, sha256: digest, migration: latest });
}

export function makeContainerName(suffix = randomBytes(8).toString("hex")) {
  const value = String(suffix);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new Error("container suffix is invalid");
  return `${E10_CONTAINER_PREFIX}${value}`;
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

export function buildDockerCreateArgs(name, cidfilePath) {
  if (typeof name !== "string" || !name.startsWith(E10_CONTAINER_PREFIX)) throw new Error("container name is outside E10 prefix");
  if (typeof cidfilePath !== "string" || !cidfilePath || /[\r\n]/.test(cidfilePath)) throw new Error("cidfile path is invalid");
  return [
    "create", "--pull=never", "--cidfile", cidfilePath, "--network", "none", "--label", `${E10_LABEL_KEY}=${E10_LABEL_VALUE}`,
    "--name", name, "--env", "POSTGRES_PASSWORD", E10_EXPECTED_IMAGE, ...E10_EXPECTED_IMAGE_COMMAND,
  ];
}

export function buildDockerInvocation(args) {
  return ["--context", E10_CONTEXT, ...args];
}

export function safeChildEnv(source = process.env, extra = {}) {
  const result = {};
  for (const key of CHILD_ENV_KEYS) if (source?.[key] !== undefined) result[key] = source[key];
  return { ...result, ...extra };
}

export function redactDiagnostic(value) {
  let text = e7RedactDiagnostic(value);
  text = text
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]");
  return text.length > MAX_DIAGNOSTIC_LENGTH ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…` : text || "unknown";
}

function normalizePortBindings(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  return Object.entries(value).flatMap(([port, bindings]) => Array.isArray(bindings)
    ? bindings.filter(Boolean).map((binding) => ({ port, ...binding })) : []);
}

export function assertImageInspect(inspect) {
  if (!inspect?.RepoDigests?.includes(E10_EXPECTED_IMAGE)) throw new Error("exact cached image digest is missing");
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(E10_EXPECTED_IMAGE_COMMAND)) throw new Error("image command mismatch");
  if (inspect?.Config?.Volumes && Object.keys(inspect.Config.Volumes).length > 0) throw new Error("image declares volumes");
  return inspect;
}

export function assertContainerOwnership(inspect, record) {
  if (!record?.id || inspect?.Id !== record.id) throw new Error("container ownership lost: id");
  if (String(inspect?.Name ?? "").replace(/^\//, "") !== record.name) throw new Error("container ownership lost: name");
  if (inspect?.Config?.Image !== E10_EXPECTED_IMAGE) throw new Error("container image mismatch");
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(E10_EXPECTED_IMAGE_COMMAND)) throw new Error("container command mismatch");
  if (inspect?.Config?.Labels?.[E10_LABEL_KEY] !== E10_LABEL_VALUE) throw new Error("container label mismatch");
  if (inspect?.HostConfig?.NetworkMode !== "none") throw new Error("container network mode is not none");
  const networkNames = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (networkNames.length !== 1 || networkNames[0] !== "none") throw new Error("container network attachment is not none");
  if ((inspect?.Mounts ?? []).length > 0 || (inspect?.HostConfig?.Binds ?? []).length > 0 || (inspect?.HostConfig?.Mounts ?? []).length > 0) {
    throw new Error("container mount is present");
  }
  if (normalizePortBindings(inspect?.HostConfig?.PortBindings).length > 0 || normalizePortBindings(inspect?.NetworkSettings?.Ports).length > 0) {
    throw new Error("container port binding is present");
  }
  return inspect.Id;
}

export function parseAssertionRows(raw) {
  const rows = {};
  for (const line of String(raw ?? "").replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z][a-z0-9_]*)=(.*)$/);
    if (!match) throw new Error("assertion output row is malformed");
    const [, key, value] = match;
    if (/(?:password|secret|token|authorization|key)/i.test(key)) throw new Error("assertion output contains sensitive key");
    if (Object.hasOwn(rows, key)) throw new Error(`duplicate assertion row: ${key}`);
    rows[key] = value;
  }
  return rows;
}

export function assertExpectedAssertionRows(rows) {
  const expected = {
    runtime_controls_rows: "0",
    enum_labels: "admin,read_only",
    user_roles_pk: "user_id",
    user_roles_id_unique: "true",
    rls_user_roles: "true",
    rls_runtime_controls: "true",
    table_grants: "true",
    rpc_grants: "true",
    role_functions_search_path: "true",
    update_rpc_security_definer: "true",
    update_rpc_search_path: "true",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (rows?.[key] !== value) throw new Error(`SQL assertion failed: ${key}`);
  }
  return true;
}

export function parseAssertionPass(raw) {
  const lines = String(raw ?? "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const matches = lines.filter((line) => line === E10_ASSERTION_PASS).length;
  if (matches !== 1) throw new Error(`SQL assertion sentinel count=${matches}`);
  if (lines.at(-1) !== E10_ASSERTION_PASS) throw new Error("SQL assertion sentinel is not final");
  return E10_ASSERTION_PASS;
}

export function cleanupDecision({ id, ownershipProven = false } = {}) {
  if (!id) return Object.freeze({ remove: false, reason: "no-recorded-id" });
  if (!ownershipProven) return Object.freeze({ remove: false, reason: "ownership-unproven" });
  return Object.freeze({ remove: true, reason: "owned-exact-id" });
}

export function isNotFoundDiagnostic(error) {
  return /no such (?:object|container)|not found|does not exist/i.test(String(error?.message ?? error ?? ""));
}

/** Inspect by the recorded ID, prove ownership, remove that ID, then prove absence. */
export async function cleanupRecordedContainer({ id, inspect, remove, assertOwnership = () => {} } = {}) {
  if (!id) return Object.freeze({ status: "not-created", removed: false, absent: true });
  if (typeof inspect !== "function" || typeof remove !== "function") throw new TypeError("inspect and remove are required");
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

export function canEmitSuccess({ status, cleanupStatus, cleanupError = null, tempError = null, unchanged, signal = null } = {}) {
  return status === "ACCEPTED_LOCAL_SQL_T1" && cleanupStatus === "removed" && !cleanupError && !tempError && unchanged === true && !signal;
}

export function compareResourceInventories(before, after) {
  return JSON.stringify(before?.skillmap ?? []) === JSON.stringify(after?.skillmap ?? [])
    && JSON.stringify(before?.xotE10 ?? {}) === JSON.stringify(after?.xotE10 ?? {});
}

export function buildMutationCases() {
  return Object.freeze({
    previewInsertBlocked: `DO $$ BEGIN
      BEGIN INSERT INTO public.runtime_controls(environment, dedupe_enabled, translation_enabled, posting_mode)
        VALUES ('preview', false, false, 'enabled');
        RAISE EXCEPTION 'preview posting invariant insert was not blocked';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%preview external posting is always blocked%' THEN NULL;
        ELSE RAISE;
        END IF;
      END;
    END $$;`,
    previewUpdateBlocked: `DO $$ BEGIN
      BEGIN UPDATE public.runtime_controls SET posting_mode = 'enabled' WHERE singleton_id = true;
        RAISE EXCEPTION 'preview posting invariant update was not blocked';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%preview external posting is always blocked%' THEN NULL;
        ELSE RAISE;
        END IF;
      END;
    END $$;`,
    previewSingletonInsert: `INSERT INTO public.runtime_controls(environment, dedupe_enabled, translation_enabled, posting_mode)
      VALUES ('preview', false, false, 'blocked');`,
    duplicateSingletonRejected: `DO $$ BEGIN
      BEGIN INSERT INTO public.runtime_controls(environment, dedupe_enabled, translation_enabled, posting_mode)
        VALUES ('preview', false, false, 'blocked');
        RAISE EXCEPTION 'duplicate singleton was not rejected';
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END $$;`,
    roleUniqueness: `DO $$
      DECLARE first_user uuid := gen_random_uuid(); second_user uuid := gen_random_uuid(); third_user uuid := gen_random_uuid();
      BEGIN
        INSERT INTO auth.users(id) VALUES (first_user), (second_user), (third_user);
        INSERT INTO public.user_roles(user_id, role) VALUES (first_user, 'admin'), (second_user, 'read_only'), (third_user, 'admin');
        BEGIN INSERT INTO public.user_roles(user_id, role) VALUES (first_user, 'admin');
          RAISE EXCEPTION 'admin uniqueness was not enforced';
        EXCEPTION WHEN unique_violation THEN NULL; END;
        BEGIN INSERT INTO public.user_roles(user_id, role) VALUES (second_user, 'read_only');
          RAISE EXCEPTION 'read_only uniqueness was not enforced';
        EXCEPTION WHEN unique_violation THEN NULL; END;
        BEGIN INSERT INTO public.user_roles(user_id, role) VALUES (third_user, 'read_only');
          RAISE EXCEPTION 'admin/read_only uniqueness was not enforced';
        EXCEPTION WHEN unique_violation THEN NULL; END;
        DELETE FROM public.user_roles WHERE user_id IN (first_user, second_user, third_user);
        DELETE FROM auth.users WHERE id IN (first_user, second_user, third_user);
      END;
    $$;`,
  });
}

const ASSERTION_QUERY = `
SELECT 'runtime_controls_rows=' || count(*)::text FROM public.runtime_controls;
SELECT 'enum_labels=' || array_to_string(array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder), ',')
  FROM pg_enum AS enum_value JOIN pg_type AS type ON type.oid = enum_value.enumtypid
  JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
 WHERE namespace.nspname = 'public' AND type.typname = 'app_role';
SELECT 'user_roles_pk=' || COALESCE((SELECT string_agg(attribute.attname, ',' ORDER BY key.position)
  FROM pg_constraint AS constraint_row JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position) ON true
  JOIN pg_attribute AS attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key.attnum
 WHERE constraint_row.conrelid = 'public.user_roles'::regclass AND constraint_row.contype = 'p'), '');
SELECT 'user_roles_id_unique=' || EXISTS (SELECT 1 FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.user_roles'::regclass AND constraint_row.contype = 'u'
    AND constraint_row.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.user_roles'::regclass AND attname = 'id')]::smallint[]);
SELECT 'rls_user_roles=' || relrowsecurity FROM pg_class WHERE oid = 'public.user_roles'::regclass;
SELECT 'rls_runtime_controls=' || relrowsecurity FROM pg_class WHERE oid = 'public.runtime_controls'::regclass;
SELECT 'table_grants=' || (
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
SELECT 'rpc_grants=' || (
  has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.current_user_is_admin()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.update_runtime_controls(boolean,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.current_user_role()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.current_user_is_admin()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_runtime_controls(boolean,boolean)', 'EXECUTE'));
SELECT 'role_functions_search_path=' || (
  (SELECT count(*) = 2 FROM pg_proc WHERE oid IN ('public.current_user_role()'::regprocedure, 'public.current_user_is_admin()'::regprocedure)
    AND 'search_path=""' = ANY(COALESCE(proconfig, ARRAY[]::text[]))));
SELECT 'update_rpc_security_definer=' || prosecdef FROM pg_proc WHERE oid = 'public.update_runtime_controls(boolean,boolean)'::regprocedure;
SELECT 'update_rpc_search_path=' || ('search_path=""' = ANY(COALESCE(proconfig, ARRAY[]::text[]))) FROM pg_proc WHERE oid = 'public.update_runtime_controls(boolean,boolean)'::regprocedure;
`.trim();

export function buildSqlAssertionProbe() {
  return ASSERTION_QUERY;
}

export function buildSqlAssertions() {
  const mutations = buildMutationCases();
  return [
    "-- E10 SQL assertion bundle. It uses no provider or network access.",
    "-- SECURITY DEFINER and search_path checks are explicit below.",
    ASSERTION_QUERY,
    `DO $$
      DECLARE table_name text; function_name text; has_public_privilege boolean;
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.user_roles'::regclass, 'public.runtime_controls'::regclass) AND NOT relrowsecurity) THEN
          RAISE EXCEPTION 'RLS is not enabled';
        END IF;
        FOR table_name IN SELECT unnest(ARRAY['public.user_roles', 'public.runtime_controls']) LOOP
          IF has_table_privilege('anon', table_name, 'SELECT') OR has_table_privilege('anon', table_name, 'INSERT')
            OR has_table_privilege('anon', table_name, 'UPDATE') OR has_table_privilege('anon', table_name, 'DELETE') THEN
            RAISE EXCEPTION 'anon table grant is too broad: %', table_name;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_class AS relation
            CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS privilege
           WHERE relation.oid = table_name::regclass AND privilege.grantee = 0) THEN
            RAISE EXCEPTION 'public table grant is present: %', table_name;
          END IF;
        END LOOP;
        FOR function_name IN SELECT unnest(ARRAY['public.current_user_role()', 'public.current_user_is_admin()', 'public.update_runtime_controls(boolean,boolean)']) LOOP
          IF has_function_privilege('anon', function_name, 'EXECUTE') THEN RAISE EXCEPTION 'anon RPC grant is present: %', function_name; END IF;
          IF EXISTS (SELECT 1 FROM pg_proc AS routine
            CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) AS privilege
           WHERE routine.oid = function_name::regprocedure AND privilege.grantee = 0) THEN
            RAISE EXCEPTION 'public RPC grant is present: %', function_name;
          END IF;
        END LOOP;
      END;
    $$;`,
    mutations.previewInsertBlocked,
    mutations.previewSingletonInsert,
    mutations.duplicateSingletonRejected,
    mutations.previewUpdateBlocked,
    mutations.roleUniqueness,
    "DELETE FROM public.runtime_controls;",
    `SELECT '${E10_ASSERTION_PASS}';`,
  ].join("\n\n");
}

export async function waitForReady({ readLogs, pgIsReady, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), timeout = 180_000 } = {}) {
  if (typeof readLogs !== "function" || typeof pgIsReady !== "function") throw new TypeError("readLogs and pgIsReady are required");
  const deadline = now() + timeout;
  let markerSeen = false;
  let lastError = "not ready";
  while (now() < deadline) {
    try { markerSeen ||= String(await readLogs()).replace(/\r/g, "").split("\n").some((line) => line.trim() === E10_INIT_COMPLETE_MARKER); } catch (error) { lastError = redactDiagnostic(error); }
    if (markerSeen) {
      try { if (await pgIsReady()) return true; lastError = "pg_isready reported not ready"; } catch (error) { lastError = redactDiagnostic(error); }
    } else lastError = "init-complete marker not observed";
    await sleep(Math.min(1_000, Math.max(1, deadline - now())));
  }
  throw new Error(`E10 readiness timed out marker=${markerSeen} lastError=${redactDiagnostic(lastError)}`);
}

export async function drainActiveChildren(activeChildren, { timeout = 5_000, termImpl, killImpl } = {}) {
  const children = [...activeChildren];
  const term = termImpl ?? ((child) => {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    try { child.kill?.("SIGTERM"); } catch {}
  });
  const kill = killImpl ?? ((child) => {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    try { child.kill?.("SIGKILL"); } catch {}
  });
  for (const child of children) { try { term(child); } catch {} }
  const closePromise = (child) => child.__e10ClosePromise ?? child.__e7ClosePromise ?? Promise.resolve();
  let finished = false;
  await Promise.race([
    Promise.all(children.map(closePromise)).then(() => { finished = true; }),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);
  if (!finished) {
    for (const child of children) { try { kill(child); } catch {} }
    await Promise.race([
      Promise.all(children.map(closePromise)),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
  }
}

export function runBoundedProcess({
  file, args = [], input, cwd, env, timeout = 30_000,
  maxBuffer = 8 * 1024 * 1024, maxInput = 8 * 1024 * 1024,
  spawnImpl = spawn, killImpl = null, activeChildren = null, forceDelay = 1_000,
} = {}) {
  if (input !== undefined && Buffer.byteLength(String(input), "utf8") > maxInput) return Promise.reject(new Error("input exceeds maxInput"));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, args, { cwd, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { reject(error); return; }
    activeChildren?.add(child);
    const stdout = [];
    const stderr = [];
    let settled = false;
    let terminated = false;
    let overflowError = null;
    let inputError = null;
    let forceTimer = null;
    let terminationSignal = null;
    let forceSent = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let resolveClose;
    child.__e10ClosePromise = new Promise((resolveClosePromise) => { resolveClose = resolveClosePromise; });
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      forceTimer = null;
      activeChildren?.delete(child);
      fn(value);
    };
    const sendTermination = (signal) => {
      try { killImpl?.(child.pid, signal); } catch {}
      try { child.kill?.(signal); } catch {}
    };
    const forceTerminate = () => {
      if (settled || forceSent || !terminationSignal) return;
      forceSent = true;
      forceTimer = null;
      sendTermination("SIGKILL");
    };
    const terminate = (signal) => {
      if (settled) return;
      if (signal === "SIGKILL") { forceTerminate(); return; }
      if (terminationSignal) return;
      terminationSignal = signal;
      terminated = true;
      sendTermination(signal);
      if (signal === "SIGTERM" && !forceTimer) forceTimer = setTimeout(forceTerminate, forceDelay);
    };
    const timer = setTimeout(() => terminate("SIGTERM"), timeout);
    const capture = (target, chunk, streamName) => {
      const bytes = Buffer.byteLength(String(chunk));
      if (streamName === "stdout") stdoutBytes += bytes; else stderrBytes += bytes;
      if ((streamName === "stdout" ? stdoutBytes : stderrBytes) > maxBuffer && !overflowError) {
        overflowError = new Error(`${streamName} exceeds maxBuffer`);
        terminate("SIGTERM");
      } else if (!overflowError) target.push(String(chunk));
    };
    child.stdout?.on("data", (chunk) => capture(stdout, chunk, "stdout"));
    child.stderr?.on("data", (chunk) => capture(stderr, chunk, "stderr"));
    child.stdin?.once?.("error", (error) => { inputError = error; terminate("SIGTERM"); });
    child.once("error", (error) => settle(reject, error));
    child.once("close", (status, signal) => {
      resolveClose?.();
      const result = { status: terminated ? null : status, signal: signal ?? (terminated ? "SIGTERM" : null), stdout: stdout.join(""), stderr: stderr.join("") };
      if (overflowError || inputError) settle(reject, overflowError ?? inputError);
      else settle(resolve, result);
    });
    if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
  });
}
