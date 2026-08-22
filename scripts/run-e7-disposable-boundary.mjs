import { randomBytes, createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  E7_CONTEXT,
  E7_CONTAINER_PREFIX,
  E7_EXPECTED_IMAGE,
  E7_EXPECTED_IMAGE_COMMAND,
  E7_EXPECTED_INVENTORY_SHA256,
  E7_EXPECTED_MIGRATION_COUNT,
  E7_EXPECTED_SUPABASE_VERSION,
  E7_EXPECTED_PG_META_IMAGE,
  E7_EXPECTED_PG_META_TAG,
  E7_PG_META_COMMAND,
  E7_INIT_COMPLETE_MARKER,
  E7_NETWORK_ALIAS,
  E7_NETWORK_PREFIX,
  E7_DISPOSABLE_PRELUDE,
  assertExactImageInspect,
  assertExactPgMetaImageInspect,
  assertExactPgMetaContainerInspect,
  assertStoppedHelperOwnership,
  assertInternalNetwork,
  assertNoMountsOrPorts,
  buildNegativeProbeMatrix,
  classifyPermissionDenied,
  E7_PROTECTED_RAW_TABLES,
  inventorySha256,
  normalizePortBindings,
  parseCatalogSample,
  redactDiagnostic,
  sha256,
  stableResourceInventory,
  validateGeneratedTypes,
  assertExpectedGeneratedTypesDigest,
  buildTypesCaptureEnvelope,
  runBoundedProcess,
  recordTaskResource,
  assertRecordedNetwork,
  assertRecordedContainer,
  reconcileInvocationGlobalMembers,
  runCleanupPhases,
  drainActiveChildren,
  cleanupRecordedContainers,
} from "./e7DisposableBoundary.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, "scripts/e7-disposable-catalog-fixture.sql");
const MIGRATION_DIR = join(ROOT, "supabase/migrations");
const TASK_ID = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const CONTAINER = `${E7_CONTAINER_PREFIX}${TASK_ID}`;
const PG_META_CONTAINER = `${E7_CONTAINER_PREFIX}pg-meta-${TASK_ID}`;
const NETWORK = `${E7_NETWORK_PREFIX}${TASK_ID}`;
const PASSWORD = randomBytes(48).toString("base64url");
const TIMEOUTS = Object.freeze({
  docker: 30_000,
  sql: 180_000,
  migration: 120_000,
  types: 180_000,
  lsof: 5_000,
});

let cleanupStarted = false;
const resourceLedger = { networkCreated: false, databaseCreated: false, helperCreated: false, network: null, container: null, helper: null };
const ownedNetworkMembers = new Map();
const activeChildren = new Set();
const taskTempDirectories = new Set();
const emitTypesBase64 = process.env.E7_EMIT_TYPES_BASE64;
let stdoutWriteChain = Promise.resolve();

function writeStdout(text) {
  const write = stdoutWriteChain.then(() => new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => error ? reject(error) : resolve());
  }));
  stdoutWriteChain = write.catch(() => {});
  return write;
}

function terminateActiveChildren() {
  return drainActiveChildren(activeChildren, {
    termImpl: (child) => { try { process.kill(-child.pid, "SIGTERM"); } catch {} try { child.kill("SIGTERM"); } catch {} },
    killImpl: (child) => { try { process.kill(-child.pid, "SIGKILL"); } catch {} try { child.kill("SIGKILL"); } catch {} },
    timeout: 5_000,
  });
}

const CHILD_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "SUPABASE_TELEMETRY_DISABLED", "SUPABASE_UPDATE_DISABLED", "POSTGRES_PASSWORD",
]);

function safeChildEnv(source = process.env, extra = {}, extraKeys = []) {
  const result = {};
  const allowed = new Set([...CHILD_ENV_KEYS, ...extraKeys]);
  for (const key of allowed) if (source?.[key] !== undefined) result[key] = source[key];
  return { ...result, ...extra };
}

async function taskMkdtemp(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  taskTempDirectories.add(directory);
  return directory;
}

async function cleanupTaskTempDirectories() {
  for (const directory of [...taskTempDirectories]) {
    await rm(directory, { recursive: true, force: true });
    taskTempDirectories.delete(directory);
  }
}

async function runFile(file, args, options = {}) {
  try {
    const result = await runBoundedProcess({
      file,
      args,
      cwd: options.cwd ?? ROOT,
      env: safeChildEnv(options.env ?? process.env, {}, options.allowEnvKeys ?? []),
      input: options.input,
      timeout: options.timeout ?? TIMEOUTS.docker,
      maxBuffer: options.maxBuffer,
      maxInput: options.maxInput,
      activeChildren,
      killImpl: (pid, signal) => process.kill(pid, signal),
    });
    if (result.status !== 0 || result.signal) {
      const wrapped = new Error([result.stderr, result.stdout, `status=${result.status}`, `signal=${result.signal ?? "none"}`].filter(Boolean).map(redactDiagnostic).join(" ") || "command failed");
      wrapped.status = result.status;
      wrapped.stdout = result.stdout;
      wrapped.stderr = result.stderr;
      throw wrapped;
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.status !== undefined) throw error;
    throw new Error(redactDiagnostic(error));
  }
}

async function docker(args, options = {}) {
  return runFile("docker", ["--context", E7_CONTEXT, ...args], options);
}

async function dockerJson(args, options = {}) {
  const result = await docker(args, options);
  try {
    return JSON.parse(result.stdout.trim() || "null");
  } catch {
    throw new Error("docker returned invalid JSON");
  }
}

async function dockerText(args, input = undefined, timeout = TIMEOUTS.docker) {
  const result = await docker(args, { input, timeout });
  return result.stdout;
}

async function resourceLines(kind) {
  const args = kind === "containers"
    ? ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"]
    : kind === "volumes"
      ? ["volume", "ls", "--format", "{{.Name}}"]
      : ["network", "ls", "--format", "{{.Name}}"];
  return (await dockerText(args)).trim().split("\n").filter(Boolean).sort();
}

async function skillmapInvariant() {
  const names = (await resourceLines("containers"))
    .map((line) => line.split("\t", 1)[0])
    .filter((name) => /^supabase_.*_skillmap$/.test(name));
  const values = [];
  for (const name of names) {
    const inspection = await dockerJson(["inspect", name]);
    const item = Array.isArray(inspection) ? inspection[0] : inspection;
    values.push([
      item?.Id, item?.Name, item?.Image, item?.State?.Status, item?.State?.Running,
      item?.State?.Paused, item?.State?.RestartCount, item?.State?.Health?.Status, item?.State?.StartedAt,
      Object.keys(item?.NetworkSettings?.Networks ?? {}).sort().join(","),
      (item?.Mounts ?? []).map((mount) => `${mount.Type}:${mount.Source}:${mount.Destination}`).sort().join(","),
    ].join("|"));
  }
  return values.sort();
}

async function port8080() {
  try {
    const result = await runFile("lsof", ["-nP", "-iTCP:8080", "-sTCP:LISTEN"], { timeout: TIMEOUTS.lsof, maxBuffer: 64 * 1024 });
    if (!result.stdout && !result.stderr) return "unbound";
    return "bound";
  } catch (error) {
    if (error.status === 1 && !error.stdout && !error.stderr) return "unbound";
    throw new Error(`port 8080 probe failed: ${redactDiagnostic(error)}`);
  }
}

async function inventory() {
  return {
    containers: (await resourceLines("containers")).filter((line) => line.startsWith("xot-") || line.startsWith("xot_")),
    volumes: (await resourceLines("volumes")).filter((line) => /xot/i.test(line)),
    networks: (await resourceLines("networks")).filter((line) => /xot/i.test(line)),
    port8080: await port8080(),
    skillmap: await skillmapInvariant(),
  };
}

async function assertNoExactResource() {
  const lines = await resourceLines("containers");
  if (lines.some((line) => line.startsWith(`${CONTAINER}\t`))) throw new Error("exact E7 container already exists");
  const networks = await resourceLines("networks");
  if (networks.includes(NETWORK)) throw new Error("exact E7 network already exists");
}

async function waitForReady() {
  const deadline = Date.now() + TIMEOUTS.sql;
  let initComplete = false;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const logs = await dockerText(["logs", CONTAINER]);
      initComplete ||= logs.includes(E7_INIT_COMPLETE_MARKER);
      if (!initComplete) throw new Error("postgres init marker not present");
      await docker(["exec", CONTAINER, "pg_isready", "-U", "supabase_admin", "-d", "postgres"]);
      const sample = await runPsqlScalar("SELECT concat_ws(E'\\t', pg_postmaster_start_time()::text, current_database(), version(), (SELECT nspname FROM pg_namespace WHERE nspname = 'extensions'), (SELECT extname FROM pg_extension WHERE extname = 'plpgsql'), (SELECT oid::text FROM pg_database WHERE datname = 'postgres'), (SELECT oid::text FROM pg_roles WHERE rolname = 'postgres'), (SELECT oid::text FROM pg_roles WHERE rolname = 'supabase_admin'));", "readiness-catalog");
      parseCatalogSample(sample);
      return;
    } catch (error) {
      lastError = redactDiagnostic(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`readiness timeout initComplete=${initComplete} detail=${lastError}`);
}

async function runPsql(sql, stage) {
  try {
    return await dockerText([
      "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse",
      "-U", "supabase_admin", "-d", "postgres",
    ], sql, TIMEOUTS.sql);
  } catch (error) {
    throw new Error(`fixture stage=${stage} failed: ${redactDiagnostic(error)}`);
  }
}

async function runPsqlScalar(sql, stage) {
  return (await dockerText([
    "exec", "-i", CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres",
  ], sql, TIMEOUTS.sql)).trim();
}

async function migrationEntries() {
  const names = (await (await import("node:fs/promises")).readdir(MIGRATION_DIR))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const body = await readFile(join(MIGRATION_DIR, name), "utf8");
    return { version: name.slice(0, 14), name: name.slice(15, -4), path: join(MIGRATION_DIR, name), sha256: sha256(body), body };
  }));
}

async function applyMigrations() {
  const migrations = await migrationEntries();
  if (migrations.length !== E7_EXPECTED_MIGRATION_COUNT) throw new Error(`migration count=${migrations.length}`);
  if (inventorySha256(migrations) !== E7_EXPECTED_INVENTORY_SHA256) throw new Error("ordered migration inventory SHA drifted");
  for (const [index, migration] of migrations.entries()) {
    await runPsql(`\\set ON_ERROR_STOP on\n${migration.body}`, `migration-${index + 1}-${migration.version}`);
  }
  return migrations;
}

async function runRoleNegativeProbes() {
  for (const probe of buildNegativeProbeMatrix()) {
    const result = await runFile("docker", ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "supabase_admin", "-d", "postgres"], {
      input: `SET ROLE ${probe.role};\n${probe.statement}\n`, timeout: TIMEOUTS.sql,
    }).then(() => null, (error) => error);
    if (!result || !classifyPermissionDenied(result)) throw new Error(`negative probe did not produce SQLSTATE 42501 role=${probe.role} kind=${probe.kind} table=${probe.table ?? "rpc"}`);
  }
}

async function resolveSupabase() {
  const candidates = [process.env.SUPABASE_BIN, "/opt/homebrew/bin/supabase", "/usr/local/bin/supabase"].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate, fsConstants.X_OK); } catch { continue; }
    const versionDir = await taskMkdtemp("xot-e7-version-");
    try {
      const version = await runFile(candidate, ["--version"], { cwd: versionDir, timeout: 15_000, env: supabaseChildEnv() });
      if (version.stdout.trim() !== E7_EXPECTED_SUPABASE_VERSION) throw new Error("local Supabase CLI version is not exactly 2.111.0");
      return candidate;
    } catch (error) { throw error; }
  }
  throw new Error("pre-existing Supabase CLI 2.111.0 was not found");
}

function supabaseChildEnv(extra = {}) {
  const env = safeChildEnv(process.env, { SUPABASE_TELEMETRY_DISABLED: "1", SUPABASE_UPDATE_DISABLED: "1", ...extra });
  for (const key of [
    "SUPABASE_ACCESS_TOKEN", "SUPABASE_AUTH_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_DB_URL",
    "SUPABASE_API_URL", "SUPABASE_PROFILE",
  ]) delete env[key];
  return env;
}

async function generateTypes(networkId) {
  const supabase = await resolveSupabase();
  const workdir = await taskMkdtemp("xot-e7-supabase-");
  try {
    const cachedImage = (await dockerJson(["image", "inspect", E7_EXPECTED_PG_META_IMAGE]))[0];
    assertExactPgMetaImageInspect(cachedImage);
    const dbUrl = `postgresql://supabase_admin@${E7_NETWORK_ALIAS}:5432/postgres?sslmode=disable`;
    const created = await docker([
      "create", "--pull=never", "--network", networkId, "--name", PG_META_CONTAINER,
      "--label", "xot.e7=disposable", "--label", "com.supabase.cli=gen-types",
      "--label", "com.supabase.cli.engine=postgres-meta", "--label", `com.supabase.cli.version=${E7_EXPECTED_SUPABASE_VERSION}`,
      "--env", `PG_META_DB_URL=${dbUrl}`, "--env", "PGPASSWORD", "--env", "PG_CONN_TIMEOUT_SECS=15",
      "--env", "PG_QUERY_TIMEOUT_SECS=15", "--env", "PG_META_GENERATE_TYPES=typescript",
      "--env", "PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public", "--env", "PG_META_GENERATE_TYPES_SWIFT_ACCESS_CONTROL=internal",
      "--env", "PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true", E7_EXPECTED_PG_META_IMAGE,
      ...E7_PG_META_COMMAND,
    ], {
      env: safeChildEnv(process.env, { PGPASSWORD: PASSWORD }),
      allowEnvKeys: ["PGPASSWORD"],
      maxBuffer: 16 * 1024 * 1024,
      timeout: TIMEOUTS.docker,
    });
    recordTaskResource(resourceLedger, "helper", created.stdout, PG_META_CONTAINER);
    ownedNetworkMembers.set(resourceLedger.helper.id, { name: PG_META_CONTAINER, image: E7_EXPECTED_PG_META_IMAGE, created: null });
    const helperInspection = (await dockerJson(["inspect", resourceLedger.helper.id]))[0];
    assertExactPgMetaContainerInspect(helperInspection, resourceLedger.helper, NETWORK);
    ownedNetworkMembers.set(resourceLedger.helper.id, { name: PG_META_CONTAINER, image: E7_EXPECTED_PG_META_IMAGE, created: helperInspection.Created });
    await assertNetworkMembersOnly();
    const result = await docker(["start", "-a", "--", resourceLedger.helper.id], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: TIMEOUTS.types,
    });
    const generated = result.stdout;
    if (!validateGeneratedTypes(generated)) throw new Error("generated Database type is empty or implausible");
    const digest = assertExpectedGeneratedTypesDigest(generated);
    return { source: generated, digest };
  } finally { await cleanupTaskTempDirectories(); }
}

async function generateTypesWithOwnership(networkId) {
  const beforeMembers = new Map(ownedNetworkMembers);
  const beforeNetwork = await networkMembers();
  const beforeGlobal = await globalContainerMetadata(await globalContainerIds());
  const startedAt = new Date().toISOString();
  try {
    return await generateTypes(networkId);
  } finally {
    const afterNetwork = await networkMembers();
    const endedAt = new Date().toISOString();
    const afterGlobal = await globalContainerMetadata(await globalContainerIds());
    reconcileInvocationGlobalMembers({
      before: beforeGlobal,
      after: [...afterGlobal.values()],
      startedAt,
      endedAt,
      networkName: NETWORK,
    });
    if (resourceLedger.helper?.id && !beforeGlobal.has(resourceLedger.helper.id) && afterGlobal.has(resourceLedger.helper.id)) {
      const stoppedHelper = (await dockerJson(["inspect", resourceLedger.helper.id]))[0];
      assertStoppedHelperOwnership(stoppedHelper, resourceLedger.helper, NETWORK);
    }
    if (beforeNetwork.some((member) => !beforeMembers.has(member.id))) throw new Error("network ownership baseline was inconsistent");
    await assertNetworkMembersOnly();
  }
}

async function createNetwork() {
  const created = await docker(["network", "create", "--internal", "--label", "xot.e7=disposable", NETWORK], { timeout: TIMEOUTS.docker });
  recordTaskResource(resourceLedger, "network", created.stdout, NETWORK);
  const list = await dockerJson(["network", "inspect", NETWORK]);
  const network = Array.isArray(list) ? list[0] : list;
  assertRecordedNetwork(network, resourceLedger.network);
  assertInternalNetwork(network);
  return resourceLedger.network.id;
}

async function assertNetworkMembersOnly() {
  const inspected = await dockerJson(["network", "inspect", NETWORK]);
  const network = Array.isArray(inspected) ? inspected[0] : inspected;
  assertRecordedNetwork(network, resourceLedger.network);
  assertInternalNetwork(network);
  for (const containerId of Object.keys(network?.Containers ?? {})) {
    const details = (await dockerJson(["inspect", containerId]))[0];
    const name = String(details?.Name ?? containerId).replace(/^\//, "");
    if (!ownedNetworkMembers.has(containerId)) throw new Error(`unknown network endpoint attached: ${name}`);
    assertNoMountsOrPorts(details);
    const attached = Object.keys(details?.NetworkSettings?.Networks ?? {});
    if (attached.length !== 1 || attached[0] !== NETWORK) throw new Error("helper or database container has an external network");
  }
}

async function networkMembers() {
  const inspected = await dockerJson(["network", "inspect", NETWORK]);
  const network = Array.isArray(inspected) ? inspected[0] : inspected;
  const members = [];
  for (const id of Object.keys(network?.Containers ?? {})) {
    const details = (await dockerJson(["inspect", id]))[0];
    members.push({
      id,
      name: String(details?.Name ?? id).replace(/^\//, ""),
      image: details?.Config?.Image ?? details?.Image ?? "",
      created: details?.Created,
      networks: Object.keys(details?.NetworkSettings?.Networks ?? {}),
      labels: details?.Config?.Labels ?? {},
      Mounts: details?.Mounts ?? [],
      HostConfig: { Binds: details?.HostConfig?.Binds ?? [], Mounts: details?.HostConfig?.Mounts ?? [], PortBindings: details?.HostConfig?.PortBindings ?? {} },
      NetworkSettings: { Ports: details?.NetworkSettings?.Ports ?? {} },
    });
  }
  return members;
}

async function globalContainerIds() {
  return new Set((await dockerText(["ps", "-aq"])).trim().split("\n").filter(Boolean));
}

async function globalContainerMetadata(ids) {
  const members = new Map();
  for (const id of ids) {
    const details = (await dockerJson(["inspect", id]))[0];
    members.set(id, {
      id,
      name: String(details?.Name ?? id).replace(/^\//, ""),
      image: details?.Config?.Image ?? details?.Image ?? "",
      created: details?.Created,
      networks: Object.keys(details?.NetworkSettings?.Networks ?? {}),
      labels: details?.Config?.Labels ?? {},
      Mounts: details?.Mounts ?? [],
      HostConfig: { Binds: details?.HostConfig?.Binds ?? [], Mounts: details?.HostConfig?.Mounts ?? [], PortBindings: details?.HostConfig?.PortBindings ?? {} },
      NetworkSettings: { Ports: details?.NetworkSettings?.Ports ?? {} },
    });
  }
  return members;
}

async function startDatabase(networkId) {
  const cachedImage = (await dockerJson(["image", "inspect", E7_EXPECTED_IMAGE]))[0];
  assertExactImageInspect(cachedImage);
  const created = await docker(["run", "--detach", "--pull=never", "--network", networkId, "--network-alias", E7_NETWORK_ALIAS, "--restart=no", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD", E7_EXPECTED_IMAGE, ...E7_EXPECTED_IMAGE_COMMAND, "-c", "cron.database_name=postgres", "-c", "cron.launch_active_jobs=off"], { timeout: TIMEOUTS.docker, env: safeChildEnv(process.env, { POSTGRES_PASSWORD: PASSWORD }) });
  recordTaskResource(resourceLedger, "container", created.stdout, CONTAINER);
  ownedNetworkMembers.set(resourceLedger.container.id, { name: CONTAINER, image: E7_EXPECTED_IMAGE, created: null });
  const inspection = (await dockerJson(["inspect", resourceLedger.container.id]))[0];
  assertRecordedContainer(inspection, resourceLedger.container, NETWORK);
  if (inspection?.Config?.Image !== E7_EXPECTED_IMAGE) throw new Error("task database image identity mismatch");
  ownedNetworkMembers.set(resourceLedger.container.id, { name: CONTAINER, image: E7_EXPECTED_IMAGE, created: inspection.Created });
  await assertNetworkMembersOnly();
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const cleanupPhases = [
    ["children", async () => { await terminateActiveChildren(); }],
    ["temp", async () => { await cleanupTaskTempDirectories(); }],
    ["containers", async () => {
      const ids = new Set(ownedNetworkMembers.keys());
      if (resourceLedger.container?.id) ids.add(resourceLedger.container.id);
      if (resourceLedger.helper?.id) ids.add(resourceLedger.helper.id);
      const containerErrors = await cleanupRecordedContainers(ids, {
        validate: async (id) => {
          const details = (await dockerJson(["inspect", id]))[0];
          const metadata = ownedNetworkMembers.get(id);
          if (resourceLedger.container?.id === id) assertRecordedContainer(details, resourceLedger.container, NETWORK);
          else if (resourceLedger.helper?.id === id) assertExactPgMetaContainerInspect(details, resourceLedger.helper, NETWORK);
          else if (details?.Id !== id || String(details?.Name ?? "").replace(/^\//, "") !== metadata?.name) throw new Error("helper ownership lost");
          assertNoMountsOrPorts(details);
        },
        remove: async (id) => { await docker(["rm", "-f", "-v", "--", id], { timeout: 30_000 }); },
      });
      if (containerErrors.length > 0) throw new Error(containerErrors.map(({ id, phase, error }) => `${id}:${phase}:${redactDiagnostic(error)}`).join("; "));
    }],
    ["network", async () => {
      if (!resourceLedger.networkCreated) return;
      const inspected = await dockerJson(["network", "inspect", resourceLedger.network.id]);
      const network = Array.isArray(inspected) ? inspected[0] : inspected;
      assertRecordedNetwork(network, resourceLedger.network);
      const remaining = Object.keys(network?.Containers ?? {});
      if (remaining.length > 0) throw new Error(`unknown network endpoint remains count=${remaining.length}`);
      await docker(["network", "rm", "--", resourceLedger.network.id], { timeout: 30_000 });
    }],
  ];
  const errors = await runCleanupPhases(cleanupPhases);
  if (errors.length > 0) throw new Error(`cleanup phases failed: ${errors.map(({ phase, error }) => `${phase}:${redactDiagnostic(error)}`).join("; ")}`);
}

async function main() {
  let before;
  let migrations = [];
  let generatedTypes = null;
  let candidatePass = false;
  try {
    before = await inventory();
    await assertNoExactResource();
    const networkId = await createNetwork();
    await startDatabase(networkId);
    await waitForReady();
    await runPsql(E7_DISPOSABLE_PRELUDE, "prelude");
    const cronDatabaseName = await runPsqlScalar("SHOW cron.database_name;", "cron-database-name");
    const cronLaunchSetting = await runPsqlScalar("SHOW cron.launch_active_jobs;", "cron-launch-active-jobs");
    if (cronDatabaseName !== "postgres" || cronLaunchSetting !== "off") throw new Error(`cron settings drifted database=${cronDatabaseName} launch=${cronLaunchSetting}`);
    migrations = await applyMigrations();
    const fixture = await readFile(FIXTURE, "utf8");
    await runPsql(fixture, "catalog-fixture");
    await runRoleNegativeProbes();
    generatedTypes = await generateTypesWithOwnership(networkId);
    candidatePass = true;
    console.error(`E7_DISPOSABLE_BOUNDARY_CANDIDATE image=${E7_EXPECTED_IMAGE} pgMeta=${E7_EXPECTED_PG_META_IMAGE} pgMetaTag=${E7_EXPECTED_PG_META_TAG} context=${E7_CONTEXT} migrations=${migrations.length} network=${NETWORK}`);
  } catch (error) {
    console.error(`E7_DISPOSABLE_BOUNDARY_FAIL ${redactDiagnostic(error)}`);
    process.exitCode = 1;
  } finally {
    let cleanupError = null;
    try { await cleanup(); } catch (error) { cleanupError = error; process.exitCode = 1; }
    if (cleanupError) console.error(`E7_CLEANUP_FAIL ${redactDiagnostic(cleanupError)}`);
    if (!before) {
      console.error("E7_CLEANUP_FAIL baseline resource inventory unavailable");
      process.exitCode = 1;
    } else {
      try {
        const after = await inventory();
        const unchanged = stableResourceInventory(before.containers) === stableResourceInventory(after.containers)
          && stableResourceInventory(before.volumes) === stableResourceInventory(after.volumes)
          && stableResourceInventory(before.networks) === stableResourceInventory(after.networks)
          && stableResourceInventory(before.skillmap) === stableResourceInventory(after.skillmap)
          && before.port8080 === after.port8080;
        if (!unchanged) process.exitCode = 1;
        console.error(`E7_CLEANUP container=${after.containers.some((line) => line.startsWith(`${CONTAINER}\t`)) ? "present" : "absent"} xotContainers=${after.containers.length} xotVolumes=${after.volumes.length} xotNetworks=${after.networks.length} port8080=${after.port8080} skillmapUnchanged=${stableResourceInventory(before.skillmap) === stableResourceInventory(after.skillmap)} unchanged=${unchanged}`);
        if (candidatePass && !cleanupError && unchanged && !signalReceived) {
          try {
            const pass = `E7_DISPOSABLE_BOUNDARY_PASS image=${E7_EXPECTED_IMAGE} pgMeta=${E7_EXPECTED_PG_META_IMAGE} pgMetaTag=${E7_EXPECTED_PG_META_TAG} context=${E7_CONTEXT} migrations=${migrations.length}`;
            const block = emitTypesBase64 === "1"
              ? `${buildTypesCaptureEnvelope(generatedTypes?.source)}\n${pass}\n`
              : `${pass}\n`;
            await writeStdout(block);
            if (signalReceived) process.exitCode = 1;
            await signalAbortWrite;
          } catch (error) {
            console.error(`E7_TYPES_CAPTURE_FAIL ${redactDiagnostic(error)}`);
            process.exitCode = 1;
          }
        }
      } catch (error) {
        console.error(`E7_CLEANUP_FAIL ${redactDiagnostic(error)}`);
        process.exitCode = 1;
      }
    }
  }
}

let signalReceived = false;
let signalAbortWrite = Promise.resolve();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  if (signalReceived) return;
  signalReceived = true;
  process.exitCode = 1;
  signalAbortWrite = writeStdout(`E7_DISPOSABLE_BOUNDARY_ABORT signal=${signal}\n`).catch(() => {});
  void terminateActiveChildren();
});
if (emitTypesBase64 && emitTypesBase64 !== "1") {
  console.error("E7_TYPES_CAPTURE_FAIL E7_EMIT_TYPES_BASE64 must be exactly 1 when set");
  process.exitCode = 1;
} else {
  await main();
}
