// Current-candidate replay reuses the unchanged E10 isolation and SQL assertions.
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { E7_EXPECTED_PG_META_IMAGE, E7_EXPECTED_PG_META_TAG, E7_PG_META_COMMAND,
  assertExactPgMetaImageInspect, validateGeneratedTypes } from "./e7DisposableBoundary.mjs";

import {
  E10_CONTEXT,
  E10_EXPECTED_IMAGE,
  E10_EXPECTED_IMAGE_COMMAND,
  E10_LABEL_KEY,
  E10_LABEL_VALUE,
  E10_ASSERTION_PASS,
  E10_DISPOSABLE_PRELUDE,
  assertContainerOwnership,
  assertImageInspect,
  buildDockerCreateArgs,
  buildDockerInvocation,
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

import {
  CURRENT_RELEASE_INVENTORY_SHA256 as E10_EXPECTED_INVENTORY_SHA256,
  CURRENT_RELEASE_MIGRATION_COUNT as E10_EXPECTED_MIGRATION_COUNT,
  CURRENT_RELEASE_MIGRATION_SHA256 as E10_EXPECTED_MIGRATION_SHA256,
  assertCurrentReleaseMigrationInventory as assertExpectedMigrationInventory,
  assertCurrentReleaseAssertionRows as assertExpectedAssertionRows,
  buildCurrentReleaseSqlAssertionProbe as buildSqlAssertionProbe,
  buildCurrentReleaseSqlAssertions as buildSqlAssertions,
  normalizeMountInventory,
  CURRENT_RELEASE_HARNESS_PATHS,
  assertCurrentTypeHelperOwnership,
} from "./currentReleaseSqlBoundary.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_DIR = join(ROOT, "supabase", "migrations");
const CONTAINER = makeContainerName(`${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`);
const PASSWORD = randomBytes(48).toString("base64url");
const TIMEOUTS = Object.freeze({ docker: 30_000, sql: 180_000, migration: 180_000, ready: 180_000 });
const activeChildren = new Set();
const resource = { id: null, name: CONTAINER };
const typeHelper = { id: null, name: `${CONTAINER}-types` };
let typeHelperCleanup = { status: "not-created" };
let generatedTypesSha256 = null;
let cleanupStarted = false;
let signalReceived = null;
let baseline = null;
let taskTempDirectory = null;
let cidfilePath = null;
let cidfileRecoveryError = null;
let signalDrainPromise = Promise.resolve();
let evidenceDirectory = null;
let replaySchemaSha256 = null;
let replayCatalogSha256 = null;
let egressProbe = null;
let feedbackRegression = null;
const startedAt = new Date().toISOString();
let harnessHashes = null;

async function readHarnessHashes() {
  return Object.fromEntries(await Promise.all(CURRENT_RELEASE_HARNESS_PATHS.map(async (path) =>
    [path, createHash("sha256").update(await readFile(join(ROOT, path))).digest("hex")])));
}

function fail(message) {
  const error = new Error(message);
  error.code = "E10_SQL_BOUNDARY_FAIL";
  throw error;
}

async function runFile(file, args, { input, timeout = TIMEOUTS.docker, extraEnv = {} } = {}) {
  const result = await runBoundedProcess({
    file,
    args,
    cwd: ROOT,
    env: safeChildEnv(process.env, { POSTGRES_PASSWORD: PASSWORD, ...extraEnv }),
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
    mounts: normalizeMountInventory(item?.Mounts ?? []),
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

async function proveNoEgress() {
  const routes = await dockerText(["exec", "--", resource.id, "cat", "/proc/net/route"]);
  if (routes.trim().split("\n").length !== 1) fail("non-loopback route exists in isolated container");
  await docker(["exec", "--", resource.id, "curl", "--version"]);
  const result = await runBoundedProcess({ file: "docker", args: buildDockerInvocation([
    "exec", "--", resource.id, "curl", "--connect-timeout", "1", "--max-time", "2",
    "--noproxy", "*", "--silent", "--output", "/dev/null", "http://192.0.2.1",
  ]), env: safeChildEnv(process.env), cwd: ROOT, timeout: 5000, activeChildren });
  if (result.status !== 7 || result.signal) fail("no-egress probe did not produce the expected connection denial");
  egressProbe = { network: "none", nonLoopbackRoutes: 0, reservedAddressConnectExit: result.status, publishedPorts: 0, mounts: 0 };
}

async function testFeedbackRepair() {
  // Only this owned no-egress database is touched. Disable its replayed cron
  // definitions before the unchanged guarded synthetic Preview regression.
  await runPsql(`SELECT cron.unschedule(jobid) FROM cron.job;
INSERT INTO public.accounts(id,handle,enabled) VALUES ('00000000-0000-0000-0000-000000000010','xot_staging_fixture',false);
INSERT INTO public.posts(tweet_id,account_id,author_handle,delivery_decision) VALUES ('xot-staging-fixture-0004','00000000-0000-0000-0000-000000000010','xot_staging_fixture','skip');
INSERT INTO public.media(id,tweet_id,kind) VALUES ('00000000-0000-0000-0000-000000000020','xot-staging-fixture-0004','video');
INSERT INTO public.video_renders(tweet_id,source_media_id,status) VALUES ('xot-staging-fixture-0004','00000000-0000-0000-0000-000000000020','blocked');`, "synthetic-feedback-fixture");
  const regression = await runPsql(await readFile(join(ROOT, "scripts/test-preview-video-render-feedback.sql"), "utf8"), "feedback-regression", { scalar: true });
  const expected = "PASS: stale guard, insert, result, metadata, count, direct RPC permissions";
  if (regression.stdout.trim() !== expected) fail("feedback regression sentinel mismatch");
  const remaining = await runPsql("SELECT count(*) FROM public.video_render_feedback;", "feedback-rollback", { scalar: true });
  if (remaining.stdout.trim() !== "0") fail("feedback regression did not roll back");
  feedbackRegression = { status: "passed", feedbackRowsAfterRollback: 0, fixture: "synthetic-local-only" };
}

async function generateCurrentTypes() {
  const inspected = await dockerJson(["image", "inspect", E7_EXPECTED_PG_META_IMAGE]);
  assertExactPgMetaImageInspect(inspected[0]);
  const cidfile = join(taskTempDirectory, "types.cid");
  try {
    await docker(["create", "--pull=never", "--cidfile", cidfile,
      "--network", `container:${resource.id}`, "--name", typeHelper.name,
      "--label", "xot.e10=disposable", "--cpus=1", "--memory=512m", "--pids-limit=128",
      "--env", "PG_META_DB_URL=postgresql://supabase_admin@127.0.0.1:5432/postgres?sslmode=disable",
      "--env", "PGPASSWORD", "--env", "PG_CONN_TIMEOUT_SECS=15", "--env", "PG_QUERY_TIMEOUT_SECS=15",
      "--env", "PG_META_GENERATE_TYPES=typescript", "--env", "PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public",
      "--env", "PG_META_GENERATE_TYPES_SWIFT_ACCESS_CONTROL=internal",
      "--env", "PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true", E7_EXPECTED_PG_META_IMAGE, ...E7_PG_META_COMMAND,
    ], { extraEnv: { PGPASSWORD: PASSWORD } });
  } finally { typeHelper.id = await recoverCidfileId(cidfile); }
  if (!typeHelper.id) fail("type helper cidfile did not record an exact ID");
  assertContainerOwnership((await dockerJson(["inspect", "--", resource.id]))[0], resource);
  assertCurrentTypeHelperOwnership((await dockerJson(["inspect", "--", typeHelper.id]))[0], typeHelper, resource.id);
  const result = await docker(["start", "-a", "--", typeHelper.id], { timeout: TIMEOUTS.sql });
  if (!validateGeneratedTypes(result.stdout)) fail("generated current Database types are implausible");
  const state = (await dockerJson(["inspect", "--", typeHelper.id]))[0];
  assertCurrentTypeHelperOwnership(state, typeHelper, resource.id);
  if (state.State?.Running || state.State?.ExitCode !== 0) fail("type helper did not exit successfully");
  generatedTypesSha256 = createHash("sha256").update(result.stdout).digest("hex");
  await writeFile(join(evidenceDirectory, "replay-types.ts"), result.stdout, { mode: 0o600, flag: "wx" });
}

async function createContainer(cidfile) {
  const image = await dockerJson(["image", "inspect", E10_EXPECTED_IMAGE]);
  const imageInspect = Array.isArray(image) ? image[0] : image;
  assertImageInspect(imageInspect);
  let createError = null;
  try {
    const args = buildDockerCreateArgs(CONTAINER, cidfile);
    args.splice(1, 0, "--cpus=1", "--memory=1g", "--pids-limit=256");
    await docker(args);
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
  typeHelperCleanup = await cleanupRecordedContainer({ id: typeHelper.id,
    inspect: async (id) => (await dockerJson(["inspect", "--", id]))[0],
    assertOwnership: (item) => assertCurrentTypeHelperOwnership(item, typeHelper, resource.id),
    remove: (id) => docker(["rm", "-f", "-v", "--", id]),
  });
  const databaseCleanup = await cleanupRecordedContainer({
    id: resource.id,
    inspect: async (id) => {
      const result = await dockerJson(["inspect", "--", id]);
      return Array.isArray(result) ? result[0] : result;
    },
    assertOwnership: (item) => assertContainerOwnership(item, resource),
    remove: (id) => docker(["rm", "-f", "-v", "--", id]),
  });
  if (typeHelperCleanup.status === "failed") return typeHelperCleanup;
  return databaseCleanup;
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
    evidenceDirectory = await mkdtemp(join(ROOT, "supabase", ".temp", "current-release-replay-"));
    await chmod(evidenceDirectory, 0o700);
    harnessHashes = await readHarnessHashes();
    baseline = await takeSnapshot();
    taskTempDirectory = await mkdtemp(join(tmpdir(), "xot-e10-sql-"));
    cidfilePath = join(taskTempDirectory, "container.cid");
    await createContainer(cidfilePath);
    await startAndWait();
    await proveNoEgress();
    await runPsql(E10_DISPOSABLE_PRELUDE, "E7_DISPOSABLE_PRELUDE");
    await applyMigrations(entries);
    const probe = await runPsql(buildSqlAssertionProbe(), "SQL assertion probe", { scalar: true });
    assertionRows = parseAssertionRows(probe.stdout);
    assertExpectedAssertionRows(assertionRows);
    const assertions = await runPsql(buildSqlAssertions(), "SQL assertion mutation bundle", { scalar: true, timeout: TIMEOUTS.migration });
    parseAssertionPass(assertions.stdout);
    const restoredProbe = await runPsql(buildSqlAssertionProbe(), "post-rollback SQL assertion probe", { scalar: true });
    assertExpectedAssertionRows(parseAssertionRows(restoredProbe.stdout));
    await testFeedbackRepair();
    const schema = await dockerText(["exec", "--", resource.id, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema=public", "--schema-only"], { timeout: TIMEOUTS.sql });
    replaySchemaSha256 = createHash("sha256").update(schema).digest("hex");
    await writeFile(join(evidenceDirectory, "replay-schema.sql"), schema, { mode: 0o600, flag: "wx" });
    const catalogResult = await runPsql(await readFile(join(ROOT, "scripts/current-release-schema-catalog.sql"), "utf8"), "schema-catalog", { scalar: true });
    const catalog = JSON.stringify(JSON.parse(catalogResult.stdout.trim()), null, 2) + "\n";
    replayCatalogSha256 = createHash("sha256").update(catalog).digest("hex");
    await writeFile(join(evidenceDirectory, "replay-schema-catalog.json"), catalog, { mode: 0o600, flag: "wx" });
    await generateCurrentTypes();
    if (JSON.stringify(harnessHashes) !== JSON.stringify(await readHarnessHashes())) fail("replay harness changed during execution");
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
        await writeFile(join(evidenceDirectory, "resource-snapshots.json"), JSON.stringify({ before: baseline, after }, null, 2), { mode: 0o600, flag: "wx" });
        const unchanged = compareResourceInventories(baseline, after);
        if (!unchanged) process.exitCode = 1;
        if (cleanupError || tempError || primaryError || signalReceived) status = "FAILED";
        if (canEmitSuccess({ status, cleanupStatus: cleanupResult.status, cleanupError, tempError, unchanged, signal: signalReceived })) {
          const receipt = {
            schema: "xot-current-release-sql-boundary-receipt-v1",
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
            startedAt,
            finishedAt: new Date().toISOString(),
            evidenceDirectory,
            replaySchemaSha256,
            replayCatalogSha256,
            egressProbe,
            feedbackRegression,
            harnessHashes,
            generatedTypesSha256,
            typeGenerator: { image: E7_EXPECTED_PG_META_IMAGE, tag: E7_EXPECTED_PG_META_TAG,
              command: E7_PG_META_COMMAND, invocation: "direct pinned postgres-meta", schema: "public",
              network: "owned database no-egress namespace", cleanup: typeHelperCleanup.status },
            assertionRows,
            release: "CLOSED",
          };
          await writeFile(join(evidenceDirectory, "receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: "wx" });
          console.log(JSON.stringify(receipt));
        } else {
          console.log(JSON.stringify({ schema: "xot-current-release-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: redactDiagnostic(cleanupError ?? tempError ?? primaryError ?? "acceptance failed"), cleanup: cleanupResult.status, skillmapUnchanged: JSON.stringify(baseline.skillmap) === JSON.stringify(after.skillmap), xotE10Unchanged: unchanged, evidenceDirectory, assertionRows, replaySchemaSha256 }));
        }
      } catch (error) {
        process.exitCode = 1;
        console.error(`E10_CLEANUP_FAIL ${redactDiagnostic(error)}`);
        console.log(JSON.stringify({ schema: "xot-current-release-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: redactDiagnostic(error), cleanup: "unverified" }));
      }
    } else {
      console.log(JSON.stringify({ schema: "xot-current-release-sql-boundary-receipt-v1", status: "FAILED", context: E10_CONTEXT, error: "baseline unavailable", cleanup: "not-started" }));
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  signalReceived = signal;
  process.exitCode = 1;
  signalDrainPromise = terminateChildren();
});

await main();
