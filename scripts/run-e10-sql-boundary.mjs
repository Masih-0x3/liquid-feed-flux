import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  E10_CONTEXT,
  E10_EXPECTED_IMAGE,
  E10_EXPECTED_IMAGE_COMMAND,
  E10_EXPECTED_INVENTORY_SHA256,
  E10_EXPECTED_MIGRATION_COUNT,
  E10_EXPECTED_MIGRATION_SHA256,
  E10_LABEL_KEY,
  E10_LABEL_VALUE,
  E10_ASSERTION_PASS,
  E10_DISPOSABLE_PRELUDE,
  assertContainerOwnership,
  assertExpectedAssertionRows,
  assertExpectedMigrationInventory,
  assertImageInspect,
  buildDockerCreateArgs,
  buildDockerInvocation,
  buildSqlAssertionProbe,
  buildSqlAssertions,
  compareResourceInventories,
  canEmitSuccess,
  cleanupRecordedContainer,
  drainActiveChildren,
  makeContainerName,
  parseAssertionRows,
  parseAssertionPass,
  recoverCidfileId,
  readMigrationInventory,
  redactDiagnostic,
  runBoundedProcess,
  safeChildEnv,
  waitForReady,
} from "./e10SqlBoundary.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_DIR = join(ROOT, "supabase", "migrations");
const CONTAINER = makeContainerName(`${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`);
const PASSWORD = randomBytes(48).toString("base64url");
const TIMEOUTS = Object.freeze({ docker: 30_000, sql: 180_000, migration: 180_000, ready: 180_000 });
const activeChildren = new Set();
const resource = { id: null, name: CONTAINER };
let cleanupStarted = false;
let signalReceived = null;
let baseline = null;
let taskTempDirectory = null;
let cidfilePath = null;
let cidfileRecoveryError = null;
let signalDrainPromise = Promise.resolve();

function fail(message) {
  const error = new Error(message);
  error.code = "E10_SQL_BOUNDARY_FAIL";
  throw error;
}

async function runFile(file, args, { input, timeout = TIMEOUTS.docker } = {}) {
  const result = await runBoundedProcess({
    file,
    args,
    cwd: ROOT,
    env: safeChildEnv(process.env, { POSTGRES_PASSWORD: PASSWORD }),
    input,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    maxInput: 16 * 1024 * 1024,
    activeChildren,
    killImpl: (pid, signal) => { try { process.kill(-pid, signal); } catch {} },
  }).catch((error) => { throw new Error(redactDiagnostic(error)); });
  if (result.status !== 0 || result.signal) {
    const detail = [result.stderr, result.stdout, `status=${result.status}`, `signal=${result.signal ?? "none"}`]
      .filter(Boolean).map(redactDiagnostic).join(" ");
    throw new Error(detail || "command failed");
  }
  return result;
}

async function docker(args, options = {}) {
  return runFile("docker", buildDockerInvocation(args), options);
}

async function dockerText(args, options = {}) {
  return (await docker(args, options)).stdout;
}

async function dockerJson(args, options = {}) {
  const raw = await dockerText(args, options);
  try { return JSON.parse(raw.trim() || "null"); } catch { throw new Error("docker returned invalid JSON"); }
}

function sortJson(values) {
  return [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function listedIds(commands) {
  const outputs = await Promise.all(commands.map((args) => dockerText(args)));
  return [...new Set(outputs.flatMap((output) => output.trim().split("\n").filter(Boolean)))].sort();
}

function normalizeInspect(item) {
  return {
    id: item?.Id,
    name: String(item?.Name ?? "").replace(/^\//, ""),
    image: item?.Config?.Image ?? item?.Image,
    labels: item?.Config?.Labels ?? {},
    status: item?.State?.Status,
    running: item?.State?.Running,
    paused: item?.State?.Paused,
    restartCount: item?.State?.RestartCount,
    mounts: item?.Mounts ?? [],
    networks: Object.keys(item?.NetworkSettings?.Networks ?? {}).sort(),
    ports: item?.NetworkSettings?.Ports ?? {},
  };
}

async function inspectIds(ids) {
  const result = [];
  for (const id of ids.filter(Boolean)) {
    const inspected = await dockerJson(["inspect", "--", id]);
    const item = Array.isArray(inspected) ? inspected[0] : inspected;
    if (item) result.push(normalizeInspect(item));
  }
  return sortJson(result);
}

async function resourceSnapshot() {
  const all = await listedIds([
    ["ps", "-aq", "--filter", `label=${E10_LABEL_KEY}=${E10_LABEL_VALUE}`],
    ["ps", "-aq", "--filter", `name=^xot-e10-sql-`],
  ]);
  const volumes = await listedIds([
    ["volume", "ls", "-q", "--filter", `label=${E10_LABEL_KEY}=${E10_LABEL_VALUE}`],
    ["volume", "ls", "-q", "--filter", "name=^xot-e10-sql-"],
  ]);
  const networks = await listedIds([
    ["network", "ls", "-q", "--filter", `label=${E10_LABEL_KEY}=${E10_LABEL_VALUE}`],
    ["network", "ls", "-q", "--filter", "name=^xot-e10-sql-"],
  ]);
  const containers = await inspectIds(all);
  const volumeDetails = sortJson((await Promise.all(volumes.map(async (id) => {
    const inspected = await dockerJson(["volume", "inspect", "--", id]);
    const item = Array.isArray(inspected) ? inspected[0] : inspected;
    return { name: item?.Name, driver: item?.Driver, labels: item?.Labels ?? {}, mountpoint: item?.Mountpoint };
  }))));
  const networkDetails = sortJson((await Promise.all(networks.map(async (id) => {
    const inspected = await dockerJson(["network", "inspect", "--", id]);
    const item = Array.isArray(inspected) ? inspected[0] : inspected;
    return { id: item?.Id, name: item?.Name, driver: item?.Driver, labels: item?.Labels ?? {}, internal: item?.Internal, containers: Object.keys(item?.Containers ?? {}).sort() };
  }))));
  return { containers, volumes: volumeDetails, networks: networkDetails };
}

async function skillmapSnapshot() {
  const raw = await dockerText(["ps", "-aq", "--filter", "name=^supabase_.*_skillmap$"]);
  return inspectIds(raw.trim().split("\n").filter(Boolean));
}

async function takeSnapshot() {
  return { skillmap: await skillmapSnapshot(), xotE10: await resourceSnapshot() };
}

async function terminateChildren() {
  await drainActiveChildren(activeChildren, {
    timeout: 5_000,
    termImpl: (child) => { try { process.kill(-child.pid, "SIGTERM"); } catch {} try { child.kill?.("SIGTERM"); } catch {} },
    killImpl: (child) => { try { process.kill(-child.pid, "SIGKILL"); } catch {} try { child.kill?.("SIGKILL"); } catch {} },
  });
}

async function runPsql(sql, stage, { scalar = false, timeout = TIMEOUTS.sql } = {}) {
  const args = ["exec", "-i", "--", resource.id, "psql", "-X"];
  if (scalar) args.push("-Atq");
  args.push("-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", "-U", "supabase_admin", "-d", "postgres");
  try { return await docker(args, { input: sql, timeout }); } catch (error) { throw new Error(`${stage}: ${redactDiagnostic(error)}`); }
}

async function applyMigrations(entries) {
  for (const [index, entry] of entries.entries()) {
    const body = await readFile(join(MIGRATION_DIR, `${entry.version}_${entry.name}.sql`), "utf8");
    await runPsql(`\\set ON_ERROR_STOP on\n${body}`, `migration-${index + 1}-${entry.version}`, { timeout: TIMEOUTS.migration });
  }
}

async function createContainer(cidfile) {
  const image = await dockerJson(["image", "inspect", E10_EXPECTED_IMAGE]);
  const imageInspect = Array.isArray(image) ? image[0] : image;
  assertImageInspect(imageInspect);
  let createError = null;
  try {
    await docker(buildDockerCreateArgs(CONTAINER, cidfile));
  } catch (error) {
    createError = error;
    throw error;
  } finally {
    try {
      const recoveredId = await recoverCidfileId(cidfile);
      if (recoveredId) resource.id = recoveredId;
    } catch (error) {
      cidfileRecoveryError = error;
      if (!createError) throw error;
    }
  }
  if (!resource.id) fail("docker create cidfile did not produce one container ID");
  // Record the exact cidfile ID before the first inspect. Cleanup never resolves by name.
  const inspected = await dockerJson(["inspect", "--", resource.id]);
  const item = Array.isArray(inspected) ? inspected[0] : inspected;
  assertContainerOwnership(item, resource);
}

async function startAndWait() {
  await docker(["start", "--", resource.id]);
  await waitForReady({
    readLogs: () => dockerText(["logs", "--", resource.id]),
    pgIsReady: async () => {
      try { await docker(["exec", "--", resource.id, "pg_isready", "-U", "supabase_admin", "-d", "postgres"]); return true; }
      catch { return false; }
    },
    timeout: TIMEOUTS.ready,
  });
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await terminateChildren();
  return cleanupRecordedContainer({
    id: resource.id,
    inspect: async (id) => {
      const result = await dockerJson(["inspect", "--", id]);
      return Array.isArray(result) ? result[0] : result;
    },
    assertOwnership: (item) => assertContainerOwnership(item, resource),
    remove: (id) => docker(["rm", "-f", "-v", "--", id]),
  });
}

async function cleanupTaskTempDirectory() {
  if (!taskTempDirectory) return;
  await rm(taskTempDirectory, { recursive: true, force: true });
  taskTempDirectory = null;
}

async function main() {
  let entries;
  let assertionRows;
  let primaryError = null;
  let cleanupError = null;
  let cleanupResult = { status: "not-created", removed: false, absent: true };
  let tempError = null;
  let status = "FAILED";
  try {
    // These checks happen before any image start or container creation.
    entries = await readMigrationInventory(MIGRATION_DIR);
    const inventory = assertExpectedMigrationInventory(entries);
    if (inventory.count !== E10_EXPECTED_MIGRATION_COUNT || inventory.sha256 !== E10_EXPECTED_INVENTORY_SHA256
      || inventory.migration.sha256 !== E10_EXPECTED_MIGRATION_SHA256) fail("migration inventory preflight failed");
    baseline = await takeSnapshot();
    taskTempDirectory = await mkdtemp(join(tmpdir(), "xot-e10-sql-"));
    cidfilePath = join(taskTempDirectory, "container.cid");
    await createContainer(cidfilePath);
    await startAndWait();
    await runPsql(E10_DISPOSABLE_PRELUDE, "E7_DISPOSABLE_PRELUDE");
    await applyMigrations(entries);
    const probe = await runPsql(buildSqlAssertionProbe(), "SQL assertion probe", { scalar: true });
    assertionRows = parseAssertionRows(probe.stdout);
    assertExpectedAssertionRows(assertionRows);
    const assertions = await runPsql(buildSqlAssertions(), "SQL assertion mutation bundle", { scalar: true, timeout: TIMEOUTS.migration });
    parseAssertionPass(assertions.stdout);
    status = "ACCEPTED_LOCAL_SQL_T1";
  } catch (error) {
    primaryError = error;
    process.exitCode = 1;
    console.error(`E10_SQL_BOUNDARY_FAIL ${redactDiagnostic(error)}${cidfileRecoveryError ? ` cidfileRecovery=${redactDiagnostic(cidfileRecoveryError)}` : ""}`);
  } finally {
    await signalDrainPromise;
    try {
      cleanupResult = await cleanup() ?? cleanupResult;
      if (cleanupResult.status === "failed") {
        cleanupError = cleanupResult.error ?? new Error(`cleanup failed phase=${cleanupResult.phase ?? "unknown"}`);
        process.exitCode = 1;
        console.error(`E10_CLEANUP_FAIL ${redactDiagnostic(cleanupError)}`);
      }
    } catch (error) { cleanupError = error; process.exitCode = 1; console.error(`E10_CLEANUP_FAIL ${redactDiagnostic(error)}`); }
    try { await cleanupTaskTempDirectory(); } catch (error) { tempError = error; process.exitCode = 1; console.error(`E10_TEMP_CLEANUP_FAIL ${redactDiagnostic(error)}`); }
    if (baseline) {
      try {
        const after = await takeSnapshot();
        const unchanged = compareResourceInventories(baseline, after);
        if (!unchanged) process.exitCode = 1;
        if (cleanupError || tempError || primaryError || signalReceived) status = "FAILED";
        if (canEmitSuccess({ status, cleanupStatus: cleanupResult.status, cleanupError, tempError, unchanged, signal: signalReceived })) {
          console.log(JSON.stringify({
            schema: "xot-e10-sql-boundary-receipt-v1",
            status,
            context: E10_CONTEXT,
            image: E10_EXPECTED_IMAGE,
            imageCommand: E10_EXPECTED_IMAGE_COMMAND,
            migrationCount: E10_EXPECTED_MIGRATION_COUNT,
            inventorySha256: E10_EXPECTED_INVENTORY_SHA256,
            migrationSha256: E10_EXPECTED_MIGRATION_SHA256,
            container: "removed",
            cleanup: cleanupResult.status,
            skillmapUnchanged: JSON.stringify(baseline.skillmap) === JSON.stringify(after.skillmap),
            xotE10Unchanged: JSON.stringify(baseline.xotE10) === JSON.stringify(after.xotE10),
            signal: signalReceived,
          }));
        } else {
          console.log(JSON.stringify({ schema: "xot-e10-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: redactDiagnostic(cleanupError ?? tempError ?? primaryError ?? "acceptance failed"), cleanup: cleanupResult.status, skillmapUnchanged: JSON.stringify(baseline.skillmap) === JSON.stringify(after.skillmap), xotE10Unchanged: unchanged }));
        }
      } catch (error) {
        process.exitCode = 1;
        console.error(`E10_CLEANUP_FAIL ${redactDiagnostic(error)}`);
        console.log(JSON.stringify({ schema: "xot-e10-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: redactDiagnostic(error), cleanup: "unverified" }));
      }
    } else {
      console.log(JSON.stringify({ schema: "xot-e10-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: "baseline unavailable", cleanup: "not-started" }));
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  signalReceived = signal;
  process.exitCode = 1;
  signalDrainPromise = terminateChildren();
});

await main();
