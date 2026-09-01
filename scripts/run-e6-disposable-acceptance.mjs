import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_CATALOG_GATE_QUERY,
  normalizePortBindings,
  redactedDiagnostic,
  waitForDisposableReadiness,
} from "./e6DisposableReadiness.mjs";

const ROOT = join(import.meta.dirname, "..");
const CONTEXT = "orbstack";
const CONTAINER = "xot-e6-disposable-acceptance-20260810";
const IMAGE = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459";
const EXPECTED_IMAGE_CMD = Object.freeze(["postgres", "-D", "/etc/postgresql"]);
const SQL_FIXTURE = join(ROOT, "scripts/e6-disposable-fixture.sql");
const DENO_FIXTURE = join(ROOT, "supabase/functions/_shared/e6DisposableAcceptance.test.ts");
const ACTIVATION_ONLY_MIGRATION = "20260828130000_retire_legacy_x_delivery_overloads.sql";
const bootstrapPassword = randomBytes(48).toString("base64url");
const TIMEOUTS = Object.freeze({
  dockerProbeMs: 15_000,
  dockerRunMs: 60_000,
  dockerSqlMs: 180_000,
  dockerCleanupMs: 30_000,
  denoMs: 300_000,
  lsofMs: 5_000,
});
const MAX_LSOF_OUTPUT_BYTES = 64 * 1024;
const MAX_FIXTURE_SECTIONS = 64;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dockerWithTimeout(timeout, ...args) {
  return execFileSync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    timeout,
  });
}

function docker(...args) {
  const timeout = args[0] === "rm" ? TIMEOUTS.dockerCleanupMs : TIMEOUTS.dockerProbeMs;
  return dockerWithTimeout(timeout, ...args);
}

function dockerWithBootstrap(...args) {
  return execFileSync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, POSTGRES_PASSWORD: bootstrapPassword },
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    timeout: TIMEOUTS.dockerRunMs,
  });
}

function dockerText(args, input = undefined, timeout = TIMEOUTS.dockerProbeMs) {
  return execFileSync("docker", ["--context", CONTEXT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
}

function resourceLines(kind, pattern = null) {
  const args = kind === "ps"
    ? ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"]
    : kind === "volume"
    ? ["volume", "ls", "--format", "{{.Name}}"]
    : ["network", "ls", "--format", "{{.Name}}"];
  const lines = dockerText(args).trim().split("\n").filter(Boolean).sort();
  return pattern ? lines.filter((line) => pattern.test(line)) : lines;
}

function skillmapInvariant() {
  const names = dockerText(["ps", "-a", "--format", "{{.Names}}"])
    .trim().split("\n").filter((name) => /^supabase_.*_skillmap$/.test(name)).sort();
  return names.map((name) => {
    const inspection = JSON.parse(dockerText(["inspect", name]))[0];
    const networks = Object.keys(inspection.NetworkSettings?.Networks ?? {}).sort().join(",");
    const mounts = (inspection.Mounts ?? [])
      .map((mount) => `${mount.Type}:${mount.Source}:${mount.Destination}`)
      .sort().join(",");
    return [inspection.Id, inspection.Name, inspection.Image, inspection.State?.StartedAt,
      inspection.State?.Status, inspection.State?.Running, inspection.State?.Paused,
      inspection.RestartCount, inspection.Health?.Status, networks, mounts].join("|");
  });
}

function port8080() {
  const result = spawnSync("lsof", ["-nP", "-iTCP:8080", "-sTCP:LISTEN"], {
    encoding: "utf8",
    maxBuffer: MAX_LSOF_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: TIMEOUTS.lsofMs,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error || result.signal) {
    const cause = result.error ? redactedDiagnostic(result.error) : `signal=${redactedDiagnostic(result.signal)}`;
    throw new Error(`E6_REPLAY_BLOCKED port 8080 probe failed (${cause})`);
  }
  if (result.status === 1 && stdout === "" && stderr === "") return "unbound";
  if (result.status === 0 && stderr === "") return "bound";
  throw new Error(
    `E6_REPLAY_BLOCKED port 8080 probe unexpected outcome status=${redactedDiagnostic(result.status)} ` +
      `stdout=${redactedDiagnostic(stdout)} stderr=${redactedDiagnostic(stderr)}`,
  );
}

function assertNoExactContainer() {
  const existing = resourceLines("ps", new RegExp(`^${CONTAINER}\\t`));
  if (existing.length > 0) throw new Error("E6_REPLAY_BLOCKED exact container already exists");
}

function runPsql(sql) {
  return dockerText([
    "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-v", "SHOW_CONTEXT=always",
    "-U", "supabase_admin", "-d", "postgres",
  ], sql, TIMEOUTS.dockerSqlMs);
}

function splitSqlFixtureSections(sql) {
  const sections = [];
  let start = 0;
  let state = "code";
  let dollarTag = "";
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
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
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "code";
      }
      continue;
    }
    if (current === "-" && next === "-") { state = "lineComment"; index += 1; continue; }
    if (current === "/" && next === "*") { state = "blockComment"; index += 1; continue; }
    if (current === "'") { state = "single"; continue; }
    if (current === '"') { state = "double"; continue; }
    if (current === "$") {
      const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) { dollarTag = tag; state = "dollar"; index += tag.length - 1; continue; }
    }
    if (current === ";") {
      sections.push(sql.slice(start, index + 1));
      if (sections.length > MAX_FIXTURE_SECTIONS) throw new Error("E6_REPLAY_BLOCKED SQL fixture section count exceeded bound");
      start = index + 1;
    }
  }
  if (start < sql.length && sql.slice(start).trim()) sections.push(sql.slice(start));
  if (sections.length === 0) throw new Error("E6_REPLAY_BLOCKED SQL fixture contained no executable sections");
  return sections;
}

function runSqlFixture(sql) {
  const sections = splitSqlFixtureSections(sql);
  for (const [index, section] of sections.entries()) {
    try {
      runPsql(section);
    } catch (error) {
      throw new Error(`E6_REPLAY_FAIL fixture-section=${index + 1} detail=${extractSqlEvidence(error)}`);
    }
  }
}

function runPsqlScalar(sql) {
  return dockerText([
    "exec", "-i", CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres",
  ], sql, TIMEOUTS.dockerSqlMs);
}

function runPsqlScalarStage(stage, sql) {
  try {
    return runPsqlScalar(sql);
  } catch (error) {
    throw new Error(`E6_REPLAY_FAIL stage=${stage} detail=${extractSqlEvidence(error)}`);
  }
}

function requireStableCatalogReady() {
  return waitForDisposableReadiness({
    readLogs: () => dockerText(["logs", CONTAINER]),
    assertReady: () => docker("exec", CONTAINER, "pg_isready", "-U", "supabase_admin", "-d", "postgres"),
    readSample: () => runPsqlScalar(BASE_CATALOG_GATE_QUERY),
    sleep: () => docker("exec", CONTAINER, "sh", "-c", "sleep 1"),
  });
}

function prelude() {
  return `
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
`;
}

function extractSqlEvidence(error) {
  const rawDetail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).map(String).join("\n");
  const lines = rawDetail.split("\n");
  const evidence = lines.filter((line) => /\b(?:ERROR|CONTEXT|STATEMENT|DETAIL|HINT):/i.test(line));
  const detail = (evidence.length > 0 ? evidence : lines.filter((line) => line.trim() && !line.includes("Command failed"))).join(" ") || "sql_error";
  return redactedDiagnostic(detail);
}

function applyMigrations() {
  const migrations = readdirSync(join(ROOT, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    // The disposable replay starts pre-activation. The activation-only
    // retirement is exercised by its own source contract and must refuse to
    // run before an operator records T2 and drains old X claims.
    .filter((name) => name !== ACTIVATION_ONLY_MIGRATION)
    .sort()
    .map((name) => ({ name, body: readFileSync(join(ROOT, "supabase/migrations", name), "utf8") }));
  if (migrations.length < 110) throw new Error(`E6_REPLAY_BLOCKED migration_count=${migrations.length}`);
  const hashes = migrations.map(({ name, body }) => `${name}:${sha256(body)}`);
  try {
    runPsql(prelude());
  } catch (error) {
    throw new Error(`E6_REPLAY_FAIL stage=prelude detail=${extractSqlEvidence(error)}`);
  }
  for (const [index, migration] of migrations.entries()) {
    try {
      runPsql(`\\set ON_ERROR_STOP on\n${migration.body}`);
    } catch (error) {
      const detail = extractSqlEvidence(error);
      throw new Error(`E6_REPLAY_FAIL migration=${migration.name} index=${index + 1} sha256=${sha256(migration.body)} detail=${detail}`);
    }
  }
  return { count: migrations.length, hashes };
}

function inspectMounts() {
  const raw = dockerText(["inspect", "--format", "{{json .Mounts}}", CONTAINER]).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    throw new Error("E6_REPLAY_BLOCKED container mounts were not valid inspect JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("E6_REPLAY_BLOCKED container mounts were not an array");
  return parsed.map((mount) => ({
    Type: typeof mount?.Type === "string" ? mount.Type : "",
    Name: typeof mount?.Name === "string" ? mount.Name : "",
    Source: typeof mount?.Source === "string" ? mount.Source : "",
    Destination: typeof mount?.Destination === "string" ? mount.Destination : "",
  }));
}

function volumeMountIdentities(mounts) {
  return mounts
    .filter((mount) => mount.Type === "volume")
    .map((mount) => mount.Name || mount.Source)
    .filter(Boolean)
    .sort();
}

function parseInspectObject(raw, label) {
  try {
    const value = JSON.parse(raw.trim() || "null");
    if (value === null) return {};
    if (typeof value !== "object") throw new Error("not an object");
    return value;
  } catch {
    throw new Error(`E6_REPLAY_BLOCKED ${label} inspect field was not valid JSON`);
  }
}

function assertNoHostPortBindings() {
  const configured = parseInspectObject(
    dockerText(["inspect", "--format", "{{json .HostConfig.PortBindings}}", CONTAINER]),
    "HostConfig.PortBindings",
  );
  const active = parseInspectObject(
    dockerText(["inspect", "--format", "{{json .NetworkSettings.Ports}}", CONTAINER]),
    "NetworkSettings.Ports",
  );
  if (normalizePortBindings(configured).length > 0 || normalizePortBindings(active).length > 0) {
    throw new Error("E6_REPLAY_BLOCKED host port bindings are present");
  }
}

function cleanup() {
  try {
    docker("rm", "-f", "-v", "--", CONTAINER);
  } catch {
    // The final exact-name check below remains authoritative.
  }
}

let before = null;
try {
  before = {
    xot: resourceLines("ps", /^xot[-_]/),
    volumes: resourceLines("volume", /xot/i),
    networks: resourceLines("network", /xot/i),
    port8080: port8080(),
    skillmap: skillmapInvariant(),
  };
} catch (error) {
  console.error(`E6_REPLAY_FAIL ${redactedDiagnostic(error)}`);
  process.exitCode = 1;
}
let cleanupRequired = false;
let migrationReceipt = null;
let mounts = "[]";
let capturedVolumeMounts = [];
try {
  if (!before) throw new Error("E6_REPLAY_BLOCKED baseline resource inventory unavailable");
  assertNoExactContainer();
  const imageInspect = JSON.parse(dockerText(["image", "inspect", IMAGE]))[0];
  if (!imageInspect?.RepoDigests?.includes(IMAGE)) throw new Error("E6_REPLAY_BLOCKED exact image digest not cached");
  if (!Array.isArray(imageInspect?.Config?.Cmd) || JSON.stringify(imageInspect?.Config?.Cmd) !== JSON.stringify(EXPECTED_IMAGE_CMD)) {
    throw new Error("E6_REPLAY_BLOCKED exact cached image command mismatch");
  }
  const declaredVolumes = imageInspect?.Config?.Volumes;
  const declaredVolumeNames = declaredVolumes && typeof declaredVolumes === "object"
    ? Object.keys(declaredVolumes).sort()
    : [];
  if ((declaredVolumes !== undefined && declaredVolumes !== null && typeof declaredVolumes !== "object") || declaredVolumeNames.length > 0) {
    throw new Error(`E6_REPLAY_BLOCKED image_declared_volumes=${declaredVolumeNames.length}`);
  }
  cleanupRequired = true;
  dockerWithBootstrap("run", "--detach", "--pull=never", "--network", "none", "--restart=no", "-e", "POSTGRES_PASSWORD", "--name", CONTAINER, IMAGE,
    ...EXPECTED_IMAGE_CMD, "-c", "cron.database_name=postgres", "-c", "cron.launch_active_jobs=off");
  assertNoHostPortBindings();
  requireStableCatalogReady();
  assertNoHostPortBindings();
  const cronDatabaseName = runPsqlScalarStage("cron-database-name", "SHOW cron.database_name;").trim();
  if (cronDatabaseName !== "postgres") throw new Error(`E6_REPLAY_BLOCKED cron.database_name=${cronDatabaseName || "empty"}`);
  const cronLaunchSetting = runPsqlScalarStage("cron-launch-active-jobs", "SHOW cron.launch_active_jobs;").trim();
  if (cronLaunchSetting !== "off") throw new Error(`E6_REPLAY_BLOCKED cron.launch_active_jobs=${cronLaunchSetting || "empty"}`);
  const capturedMounts = inspectMounts();
  capturedVolumeMounts = volumeMountIdentities(capturedMounts);
  mounts = JSON.stringify(capturedMounts);
  if (capturedMounts.length > 0) throw new Error(`E6_REPLAY_BLOCKED image_declared_mounts=${mounts}`);
  migrationReceipt = applyMigrations();
  try {
    runSqlFixture(readFileSync(SQL_FIXTURE, "utf8"));
  } catch (error) {
    throw new Error(`E6_REPLAY_FAIL stage=sql-fixture detail=${extractSqlEvidence(error)}`);
  }
  execFileSync("npm", ["exec", "--offline", "--yes", "deno", "--", "test", "--cached-only", "--frozen", "--deny-net", "--no-check", DENO_FIXTURE], {
    cwd: ROOT,
    stdio: "inherit",
    timeout: TIMEOUTS.denoMs,
  });
  console.log(`E6_DISPOSABLE_ACCEPTANCE_PASS image=${IMAGE} context=${CONTEXT} migrations=${migrationReceipt.count} mount=${mounts} port8080_before=${before.port8080}`);
  for (const hash of migrationReceipt.hashes) console.log(`E6_MIGRATION ${hash}`);
} catch (error) {
  console.error(error instanceof Error ? redactedDiagnostic(error) : "E6_REPLAY_FAIL unknown");
  process.exitCode = 1;
} finally {
  if (cleanupRequired) cleanup();
  if (!before) {
    console.error("E6_CLEANUP_FAIL baseline resource inventory unavailable");
    process.exitCode = 1;
  } else {
    try {
      const after = {
        xot: resourceLines("ps", /^xot[-_]/),
        volumes: resourceLines("volume", /xot/i),
        networks: resourceLines("network", /xot/i),
        allVolumes: resourceLines("volume"),
        port8080: port8080(),
        skillmap: skillmapInvariant(),
      };
      if (after.xot.some((line) => line.startsWith(`${CONTAINER}\t`))) {
        console.error("E6_CLEANUP_FAIL exact container remains");
        process.exitCode = 1;
      }
      const lingeringCapturedVolumes = capturedVolumeMounts.filter((identity) => after.allVolumes.includes(identity));
      if (lingeringCapturedVolumes.length > 0) {
        console.error(`E6_CLEANUP_FAIL captured container volume remains count=${lingeringCapturedVolumes.length}`);
        process.exitCode = 1;
      }
      if (JSON.stringify(before.volumes) !== JSON.stringify(after.volumes) || JSON.stringify(before.networks) !== JSON.stringify(after.networks)) {
        console.error("E6_CLEANUP_FAIL xot volume/network inventory changed");
        process.exitCode = 1;
      }
      if (JSON.stringify(before.skillmap) !== JSON.stringify(after.skillmap)) {
        console.error("E6_CLEANUP_FAIL skillmap resource names/status changed");
        process.exitCode = 1;
      }
      if (before.port8080 !== after.port8080) {
        console.error("E6_CLEANUP_FAIL port 8080 changed");
        process.exitCode = 1;
      }
      console.log(`E6_CLEANUP container=absent mounts=${mounts} xotContainers=${after.xot.length} xotVolumes=${after.volumes.length} xotNetworks=${after.networks.length} port8080=${after.port8080} skillmapUnchanged=${JSON.stringify(before.skillmap) === JSON.stringify(after.skillmap)} skillmapInvariantBounded=true`);
    } catch (error) {
      console.error(`E6_CLEANUP_FAIL ${redactedDiagnostic(error)}`);
      process.exitCode = 1;
    }
  }
}
