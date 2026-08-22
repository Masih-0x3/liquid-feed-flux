import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const E7_CONTEXT = "orbstack";
export const E7_EXPECTED_IMAGE = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
export const E7_EXPECTED_IMAGE_COMMAND = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
export const E7_EXPECTED_MIGRATION_COUNT = 123;
export const E7_EXPECTED_INVENTORY_SHA256 = "ed1bdf811e3e65828b55624064af64229733772cc8c68d759ddafb9a9c7a6e51";
export const E7_EXPECTED_GENERATED_TYPES_SHA256 = "091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe";
export const E7_EXPECTED_GENERATED_TYPES_BYTES = 102811;
export const E7_EXPECTED_GENERATED_TYPES_LINES = 3325;
export const E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS = 137084;
export const E7_TYPES_BEGIN = "E7_DISPOSABLE_TYPES_BEGIN";
export const E7_TYPES_DATA = "E7_DISPOSABLE_TYPES_DATA";
export const E7_TYPES_END = "E7_DISPOSABLE_TYPES_END";
export const E7_NETWORK_ALIAS = "xotpg";
export const E7_NETWORK_PREFIX = "xot-e7-disposable-";
export const E7_CONTAINER_PREFIX = "xot-e7-disposable-";
export const E7_EXPECTED_SUPABASE_VERSION = "2.111.0";
export const E7_EXPECTED_PG_META_IMAGE = "public.ecr.aws/supabase/postgres-meta@sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300";
export const E7_EXPECTED_PG_META_TAG = "public.ecr.aws/supabase/postgres-meta:v0.96.6";
export const E7_PG_META_COMMAND = Object.freeze(["node", "dist/server/server.js"]);
export const E7_INIT_COMPLETE_MARKER = "PostgreSQL init process complete; ready for start up.";
export const E7_DISPOSABLE_PRELUDE = `
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
export const E7_PROTECTED_RAW_TABLES = Object.freeze([
  "video_renders",
  "video_render_feedback",
  "video_renderer_heartbeats",
  "manual_video_intakes",
]);
export const E7_NEGATIVE_UPDATE_COLUMNS = Object.freeze({
  video_renders: "updated_at",
  video_render_feedback: "note",
  video_renderer_heartbeats: "updated_at",
  manual_video_intakes: "updated_at",
});

const REDACTION_LIMIT = 640;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function inventorySha256(entries) {
  return sha256(JSON.stringify(entries
    .map(({ version, name, sha256: sourceSha }) => ({ version, name, sha256: sourceSha }))
    .sort((a, b) => a.version.localeCompare(b.version))));
}

export function normalizePortBindings(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  return Object.entries(value).flatMap(([containerPort, hostBindings]) => {
    if (!Array.isArray(hostBindings)) return [];
    return hostBindings.filter((binding) => binding && typeof binding === "object")
      .map((binding) => ({ containerPort, ...binding }));
  });
}

export function parseCatalogSample(raw) {
  const fields = String(raw ?? "").trim().split("\t");
  if (fields.length !== 8 || fields.some((field) => field.length === 0)) {
    throw new Error("catalog sample incomplete");
  }
  const [postmasterStartTime, currentDatabase, serverVersion, extensionsSchema,
    plpgsqlExtension, databaseOid, postgresRoleOid, supabaseAdminRoleOid] = fields;
  return {
    postmasterStartTime,
    currentDatabase,
    serverVersion,
    extensionsSchema,
    plpgsqlExtension,
    databaseOid,
    postgresRoleOid,
    supabaseAdminRoleOid,
  };
}

export function redactDiagnostic(value) {
  let text = String(value ?? "")
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/\b(?:[A-Za-z0-9+/]{32,}={0,2})\b/g, "[redacted]");
  if (text.length > REDACTION_LIMIT) text = `${text.slice(0, REDACTION_LIMIT)}…`;
  return text || "unknown";
}

export function splitSqlFixtureSections(sql) {
  const source = String(sql ?? "");
  const sections = [];
  let start = 0;
  let state = "code";
  let dollarTag = "";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "lineComment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "blockComment") {
      if (current === "*" && next === "/") { state = "code"; index += 1; }
      continue;
    }
    if (state === "single" || state === "double") {
      if (current === "\\") index += 1;
      else if ((state === "single" && current === "'") || (state === "double" && current === '"')) state = "code";
      continue;
    }
    if (state === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "code";
      }
      continue;
    }
    if (current === "-" && next === "-") { state = "lineComment"; index += 1; continue; }
    if (current === "/" && next === "*") { state = "blockComment"; index += 1; continue; }
    if (current === "'") { state = "single"; continue; }
    if (current === '"') { state = "double"; continue; }
    if (current === "$" ) {
      const tag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) { dollarTag = tag; state = "dollar"; index += tag.length - 1; continue; }
    }
    if (current === ";") {
      const section = source.slice(start, index + 1);
      if (section.trim()) sections.push(section);
      start = index + 1;
    }
  }
  const tail = source.slice(start);
  if (tail.trim()) sections.push(tail);
  if (sections.length === 0) throw new Error("SQL fixture contained no executable sections");
  return sections;
}

export function validateGeneratedTypes(source) {
  const text = String(source ?? "");
  return text.length > 0
    && /(?:export\s+)?(?:type|interface)\s+Database\b/.test(text)
    && /\bpublic\b/.test(text)
    && text.length <= 16 * 1024 * 1024;
}

export function assertExpectedGeneratedTypesDigest(source) {
  const text = String(source ?? "");
  if (!validateGeneratedTypes(text)) throw new Error("generated Database type is empty or implausible");
  const digest = {
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.split("\n").length - 1,
  };
  if (digest.sha256 !== E7_EXPECTED_GENERATED_TYPES_SHA256
    || digest.bytes !== E7_EXPECTED_GENERATED_TYPES_BYTES
    || digest.lines !== E7_EXPECTED_GENERATED_TYPES_LINES) {
    throw new Error(`generated types digest mismatch sha256=${digest.sha256} bytes=${digest.bytes} lines=${digest.lines}`);
  }
  return digest;
}

function assertCanonicalBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("generated types base64 is not canonical RFC4648");
  }
  return value;
}

export function buildTypesCaptureEnvelope(source) {
  const digest = assertExpectedGeneratedTypesDigest(source);
  const data = Buffer.from(String(source), "utf8").toString("base64");
  if (data.length !== E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS) {
    throw new Error(`generated types base64 length mismatch chars=${data.length}`);
  }
  assertCanonicalBase64(data);
  return [
    `${E7_TYPES_BEGIN} sha256=${digest.sha256} bytes=${digest.bytes} lines=${digest.lines} base64Chars=${data.length}`,
    `${E7_TYPES_DATA} ${data}`,
    E7_TYPES_END,
  ].join("\n");
}

export function parseTypesCaptureEnvelope(output) {
  const lines = String(output ?? "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 3) throw new Error("types envelope must contain exactly BEGIN, DATA, and END lines");
  const begin = lines[0].match(new RegExp(`^${E7_TYPES_BEGIN} sha256=([0-9a-f]{64}) bytes=(\\d+) lines=(\\d+) base64Chars=(\\d+)$`));
  if (!begin) throw new Error("types envelope BEGIN metadata is invalid");
  if (lines[1].slice(0, E7_TYPES_DATA.length + 1) !== `${E7_TYPES_DATA} `) throw new Error("types envelope DATA line is invalid");
  const data = assertCanonicalBase64(lines[1].slice(E7_TYPES_DATA.length + 1));
  if (lines[2] !== E7_TYPES_END) throw new Error("types envelope END boundary is invalid");
  const metadata = { sha256: begin[1], bytes: Number(begin[2]), lines: Number(begin[3]), base64Chars: Number(begin[4]) };
  if (metadata.sha256 !== E7_EXPECTED_GENERATED_TYPES_SHA256
    || metadata.bytes !== E7_EXPECTED_GENERATED_TYPES_BYTES
    || metadata.lines !== E7_EXPECTED_GENERATED_TYPES_LINES
    || metadata.base64Chars !== E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS
    || data.length !== metadata.base64Chars) throw new Error("types envelope metadata drifted");
  const source = Buffer.from(data, "base64").toString("utf8");
  if (Buffer.from(source, "utf8").toString("base64") !== data) throw new Error("types envelope base64 roundtrip is not canonical");
  const digest = assertExpectedGeneratedTypesDigest(source);
  return { source, data, ...digest, base64Chars: data.length };
}

export function parseGeneratedTypesStdoutCapture(output) {
  const lines = String(output ?? "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 4) {
    throw new Error("generated types stdout capture must contain exactly one envelope and final PASS");
  }
  const envelope = parseTypesCaptureEnvelope(lines.slice(0, 3).join("\n"));
  const expectedPass = `E7_DISPOSABLE_BOUNDARY_PASS image=${E7_EXPECTED_IMAGE} pgMeta=${E7_EXPECTED_PG_META_IMAGE} pgMetaTag=${E7_EXPECTED_PG_META_TAG} context=${E7_CONTEXT} migrations=${E7_EXPECTED_MIGRATION_COUNT}`;
  if (lines[3] !== expectedPass) throw new Error("generated types stdout capture PASS boundary is invalid or not final");
  return { ...envelope, pass: lines[3] };
}

export function assertInternalNetwork(network) {
  if (!network || network.Internal !== true) throw new Error("network is not internal");
  if (typeof network.Id !== "string" || !/^[0-9a-f]{12,64}$/i.test(network.Id)) throw new Error("network id is invalid");
  if (typeof network.Name !== "string" || !network.Name.startsWith(E7_NETWORK_PREFIX)) throw new Error("network name is outside E7 prefix");
  return network.Id;
}

export function recordTaskResource(ledger, kind, stdout, name) {
  const id = String(stdout ?? "").trim();
  if (!id || /\s/.test(id)) throw new Error(`resource id missing for ${kind}`);
  if (!name || typeof name !== "string") throw new Error(`resource name missing for ${kind}`);
  const key = kind === "network" ? "network" : kind === "container" ? "container" : kind === "helper" ? "helper" : null;
  if (!key) throw new Error(`unsupported task resource kind ${kind}`);
  ledger[key] = Object.freeze({ id, name });
  ledger[key === "container" ? "databaseCreated" : key === "helper" ? "helperCreated" : "networkCreated"] = true;
  return ledger[key];
}

export function assertRecordedNetwork(network, record) {
  if (!record?.id || network?.Id !== record.id || network?.Name !== record.name
    || network?.Internal !== true || network?.Labels?.["xot.e7"] !== "disposable") {
    throw new Error("network ownership lost");
  }
  return network.Id;
}

export function assertRecordedContainer(inspect, record, networkName) {
  if (!record?.id || inspect?.Id !== record.id || String(inspect?.Name ?? "").replace(/^\//, "") !== record.name) {
    throw new Error("container ownership lost");
  }
  assertNoMountsOrPorts(inspect);
  const networks = Object.keys(inspect?.NetworkSettings?.Networks ?? {});
  if (networks.length !== 1 || networks[0] !== networkName) throw new Error("container network boundary lost");
  return inspect.Id;
}

export function assertNoHostPorts(inspect) {
  if (normalizePortBindings(inspect?.HostConfig?.PortBindings).length > 0
    || normalizePortBindings(inspect?.NetworkSettings?.Ports).length > 0) {
    throw new Error("published host port bindings are present");
  }
}

export function assertNoMountsOrPorts(inspect) {
  const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
  const binds = Array.isArray(inspect?.HostConfig?.Binds) ? inspect.HostConfig.Binds : [];
  const configuredMounts = Array.isArray(inspect?.HostConfig?.Mounts) ? inspect.HostConfig.Mounts : [];
  if (mounts.length > 0 || binds.length > 0 || configuredMounts.length > 0) throw new Error("container mount is present");
  if (normalizePortBindings(inspect?.HostConfig?.PortBindings).length > 0 || normalizePortBindings(inspect?.NetworkSettings?.Ports).length > 0) throw new Error("container port binding is present");
}

export function assertExactImageInspect(inspect) {
  if (!inspect?.RepoDigests?.includes(E7_EXPECTED_IMAGE)) throw new Error("exact image digest is not cached");
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(E7_EXPECTED_IMAGE_COMMAND)) throw new Error("image command mismatch");
  const declaredVolumes = inspect?.Config?.Volumes;
  if (declaredVolumes && Object.keys(declaredVolumes).length > 0) throw new Error("image declares volumes");
}

export function assertExactPgMetaImageInspect(inspect) {
  if (!inspect?.RepoDigests?.includes(E7_EXPECTED_PG_META_IMAGE)) throw new Error("exact pg-meta image digest is not cached");
  if (!inspect?.RepoTags?.includes(E7_EXPECTED_PG_META_TAG)) throw new Error("pg-meta image tag is not v0.96.6");
  if (JSON.stringify(inspect?.Config?.Cmd) !== JSON.stringify(E7_PG_META_COMMAND)) throw new Error("pg-meta image command mismatch");
  const declaredVolumes = inspect?.Config?.Volumes;
  if (declaredVolumes && Object.keys(declaredVolumes).length > 0) throw new Error("pg-meta image declares volumes");
}

export function assertExactPgMetaContainerInspect(inspect, record, networkName) {
  assertRecordedContainer(inspect, record, networkName);
  if (!record?.name?.startsWith(`${E7_CONTAINER_PREFIX}pg-meta-`)) throw new Error("pg-meta helper name is outside task prefix");
  if (inspect?.Config?.Image !== E7_EXPECTED_PG_META_IMAGE) throw new Error("pg-meta container image identity mismatch");
  if (inspect?.Config?.Labels?.["xot.e7"] !== "disposable" || inspect?.Config?.Labels?.["com.supabase.cli"] !== "gen-types") throw new Error("pg-meta helper labels mismatch");
  if (inspect?.Config?.Labels?.["com.supabase.cli.engine"] !== "postgres-meta" || inspect?.Config?.Labels?.["com.supabase.cli.version"] !== E7_EXPECTED_SUPABASE_VERSION) throw new Error("pg-meta helper provenance labels mismatch");
}

export function assertStoppedHelperOwnership(inspect, record, networkName) {
  if (!record?.id || inspect?.Id !== record.id) throw new Error("stopped helper ownership lost");
  return assertExactPgMetaContainerInspect(inspect, record, networkName);
}

export function expectedNegativeRoleProbe(role, statement) {
  if (!new Set(["anon", "authenticated"]).has(role)) throw new Error("unsupported negative role");
  return `SET ROLE ${role};\n${statement}`;
}

export function stableResourceInventory(resources) {
  return JSON.stringify(resources.map((value) => String(value)).sort());
}

export function classifyPermissionDenied(error) {
  const detail = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
  return /ERROR:\s+42501:[^\n]*permission denied/i.test(detail);
}

export function buildNegativeProbeMatrix() {
  const operations = {
    SELECT: (table) => `SELECT * FROM public.${table} LIMIT 1;`,
    INSERT: (table) => `INSERT INTO public.${table} DEFAULT VALUES;`,
    UPDATE: (table) => `UPDATE public.${table} SET ${E7_NEGATIVE_UPDATE_COLUMNS[table]} = ${E7_NEGATIVE_UPDATE_COLUMNS[table]} WHERE false;`,
    DELETE: (table) => `DELETE FROM public.${table} WHERE false;`,
  };
  const matrix = [];
  for (const role of ["anon", "authenticated"]) {
    for (const table of E7_PROTECTED_RAW_TABLES) {
      for (const [operation, statement] of Object.entries(operations)) matrix.push({ kind: "table", role, table, operation, statement: statement(table) });
    }
    matrix.push({ kind: "rpc", role, operation: "EXECUTE", statement: "SELECT public.media_objects_finalize_delete(NULL::uuid, NULL::uuid);" });
  }
  return matrix;
}

export function adoptInvocationMembers({ before, after, startedAt, endedAt, networkName }) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("invalid invocation window");
  const owned = new Map(before);
  for (const member of after) {
    if (owned.has(member.id)) continue;
    const created = Date.parse(member.created);
    const networks = Array.isArray(member.networks) ? member.networks : [];
    const labels = member.labels && typeof member.labels === "object" ? Object.entries(member.labels) : [];
    const expectedHelper = /supabase/i.test(String(member.image ?? ""))
      && labels.some(([label, value]) => label === "com.supabase.cli" && String(value) === "gen-types");
    if (!(created >= start && created <= end) || networks.length !== 1 || (networkName && networks[0] !== networkName)
      || !expectedHelper || !/^supabase(?:[-_]|$)/i.test(String(member.name ?? ""))) {
      throw new Error(`unattributed network endpoint: ${member.name ?? member.id}`);
    }
    assertNoMountsOrPorts(member);
    owned.set(member.id, { name: member.name, image: member.image, created: member.created });
  }
  return owned;
}

function isInvocationAttributedPgMetaHelper(member) {
  const name = String(member?.name ?? "").replace(/^\//, "");
  const labels = member?.labels && typeof member.labels === "object" ? member.labels : {};
  return labels["xot.e7"] === "disposable"
    || /^xot-e7-disposable-pg-meta-/i.test(name);
}

export function reconcileInvocationGlobalMembers({ before, after, startedAt, endedAt, networkName }) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("invalid invocation window");
  if (typeof networkName !== "string" || networkName.length === 0) throw new Error("E7 network name is required");
  const owned = new Map(before);
  for (const member of after) {
    const id = String(member?.id ?? "").trim();
    if (!id || owned.has(id) || !isInvocationAttributedPgMetaHelper(member)) continue;
    const name = String(member?.name ?? "").replace(/^\//, "");
    const created = Date.parse(member?.created);
    const networks = Array.isArray(member?.networks) ? member.networks : [];
    const labels = member?.labels && typeof member.labels === "object" ? member.labels : {};
    if (!(created >= start && created <= end)) throw new Error(`attributed helper is outside invocation window: ${name || id}`);
    if (networks.length !== 1 || networks[0] !== networkName) throw new Error(`attributed helper network boundary lost: ${name || id}`);
    if (!name.startsWith(`${E7_CONTAINER_PREFIX}pg-meta-`)) throw new Error(`attributed helper name mismatch: ${name || id}`);
    if (member.image !== E7_EXPECTED_PG_META_IMAGE) throw new Error(`attributed helper image mismatch: ${name || id}`);
    if (labels["xot.e7"] !== "disposable"
      || labels["com.supabase.cli"] !== "gen-types"
      || labels["com.supabase.cli.engine"] !== "postgres-meta"
      || labels["com.supabase.cli.version"] !== E7_EXPECTED_SUPABASE_VERSION) {
      throw new Error(`attributed helper labels mismatch: ${name || id}`);
    }
    assertNoMountsOrPorts(member);
    owned.set(id, { name, image: member.image, created: member.created });
  }
  return owned;
}

export async function runCleanupPhases(phases) {
  const errors = [];
  for (const [phase, operation] of phases) {
    try { await operation(); } catch (error) { errors.push({ phase, error }); }
  }
  return errors;
}

export async function cleanupRecordedContainers(ids, { validate, remove } = {}) {
  const errors = [];
  for (const id of ids) {
    try { await validate?.(id); } catch (error) { errors.push({ id, phase: "validate", error }); }
    try { await remove?.(id); } catch (error) { errors.push({ id, phase: "remove", error }); }
  }
  return errors;
}

export async function drainActiveChildren(activeChildren, { timeout = 5_000, termImpl, killImpl } = {}) {
  const children = [...activeChildren];
  for (const child of children) {
    try { termImpl?.(child); } catch {}
  }
  const waitForClose = () => Promise.all(children.map((child) => child.__e7ClosePromise ?? Promise.resolve()));
  let finished = false;
  await Promise.race([waitForClose().then(() => { finished = true; }), new Promise((resolve) => setTimeout(resolve, timeout))]);
  if (!finished) {
    for (const child of children) {
      try { killImpl?.(child); } catch {}
    }
    await Promise.race([waitForClose(), new Promise((resolve) => setTimeout(resolve, timeout))]);
  }
}

export function runBoundedProcess({
  file,
  args = [],
  input,
  cwd,
  env,
  timeout = 30_000,
  maxBuffer = 8 * 1024 * 1024,
  maxInput = 8 * 1024 * 1024,
  spawnImpl = spawn,
  killImpl = null,
  activeChildren = null,
}) {
  if (input !== undefined && Buffer.byteLength(String(input), "utf8") > maxInput) return Promise.reject(new Error("input exceeds maxInput"));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, args, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    activeChildren?.add(child);
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    let overflowError = null;
    let inputError = null;
    let forceTimer = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let resolveClose;
    child.__e7ClosePromise = new Promise((resolve) => { resolveClose = resolve; });
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      activeChildren?.delete(child);
      fn(value);
    };
    const terminate = (signal) => {
      timedOut = true;
      try { killImpl?.(-child.pid, signal); } catch {}
      try { child.kill(signal); } catch {}
      if (signal === "SIGTERM") forceTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
    };
    const timer = setTimeout(() => terminate("SIGTERM"), timeout);
    const capture = (target, chunk, streamName) => {
      const bytes = Buffer.byteLength(String(chunk));
      if (streamName === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
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
      const result = { status: timedOut ? null : status, signal: signal ?? (timedOut ? "SIGTERM" : null), stdout: stdout.join(""), stderr: stderr.join("") };
      if (overflowError || inputError) settle(reject, overflowError ?? inputError);
      else settle(resolve, result);
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}
