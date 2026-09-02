import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  EXPECTED_INCLUSION_COUNT,
} from "./build-xot-v2-production-convergence-sql.mjs";
import {
  REPLAY_CONTAINER_PREFIX,
  REPLAY_CONTEXT,
  REPLAY_ASSERTION_PHASES,
  REPLAY_EXPECTED_IMAGE,
  REPLAY_EXPECTED_IMAGE_COMMAND,
  REPLAY_INIT_COMPLETE_MARKER,
  REPLAY_LABEL_KEY,
  REPLAY_LABEL_VALUE,
  REPLAY_PRELUDE,
  assertBundleSql,
  assertZeroWriteInvariantSql,
  assertContainerOwnership,
  assertFingerprintsEqual,
  assertImageInspect,
  assertLocalBaselineAvailable,
  buildActivationAssertionSql,
  buildAssertionBundle,
  buildCatalogFingerprintQuery,
  buildDockerCreateArgs,
  buildDockerInvocation,
  buildPostBundleAssertions,
  buildReplayBundle,
  buildZeroWriteFixtureSql,
  cleanupRecordedContainer,
  fingerprintFromRows,
  makeContainerName,
  parseAssertionPass,
  parseAssertionRows,
  readLocalBaseline,
  recoverCidfileId,
  semanticDriftFromFingerprints,
  sha256,
  validateReplayPhaseSql,
} from "./xotV2ProductionConvergenceReplay.mjs";
import {
  E7_DISPOSABLE_PRELUDE,
} from "./e7DisposableBoundary.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATION_DIR = join(ROOT, "supabase", "migrations");
const PASSWORD = randomBytes(48).toString("base64url");
const TIMEOUTS = Object.freeze({ docker: 30_000, sql: 180_000, migration: 240_000, ready: 180_000 });
const MAX_DIAGNOSTIC_LENGTH = 4096;
const CHILD_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT",
  "SUPABASE_TELEMETRY_DISABLED", "SUPABASE_UPDATE_DISABLED", "POSTGRES_PASSWORD",
]);

const activeChildren = new Set();
const resource = { id: null, name: null };
let cleanupStarted = false;
let signalReceived = null;
let taskTempDirectory = null;
let cidfilePath = null;
let cidfileRecoveryError = null;
let signalDrainPromise = Promise.resolve();
let lastCleanupResult = { status: "not-created", removed: false, absent: true };

function fail(message) {
  const error = new Error(message);
  error.code = "XOT_CONVERGENCE_REPLAY_FAIL";
  throw error;
}

function redactDiagnostic(value) {
  let text = String(value ?? "")
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/\b(?:[A-Za-z0-9+/]{32,}={0,2})\b/g, "[redacted]");
  const errorLine = text.replace(/\r/g, "").split("\n").find((line) => line.startsWith("ERROR:"));
  if (errorLine) text = errorLine;
  if (text.length > MAX_DIAGNOSTIC_LENGTH) text = `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
  return text || "unknown";
}

function safeChildEnv(source = process.env, extra = {}) {
  const result = {};
  for (const key of CHILD_ENV_KEYS) if (source?.[key] !== undefined) result[key] = source[key];
  return { ...result, ...extra };
}

export function runBoundedProcess({
  file, args = [], input, cwd, env, timeout = 30_000,
  maxBuffer = 8 * 1024 * 1024, maxInput = 16 * 1024 * 1024,
  spawnImpl = spawn, killImpl = null, activeChildren: tracked = null, forceDelay = 1_000,
} = {}) {
  if (input !== undefined && Buffer.byteLength(String(input), "utf8") > maxInput) {
    return Promise.reject(new Error("input exceeds maxInput"));
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, args, { cwd, env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    tracked?.add(child);
    const stdout = [];
    const stderr = [];
    let settled = false;
    let terminationSignal = null;
    let forceSent = false;
    let forceTimer = null;
    let overflowError = null;
    let inputError = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let resolveClose;
    child.__convergenceReplayClosePromise = new Promise((resolveClosePromise) => { resolveClose = resolveClosePromise; });
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      forceTimer = null;
      tracked?.delete(child);
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
      const result = {
        status: terminationSignal ? null : status,
        signal: signal ?? (terminationSignal ? "SIGTERM" : null),
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      };
      if (overflowError || inputError) settle(reject, overflowError ?? inputError);
      else settle(resolve, result);
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
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

async function runPsql(sql, stage, { database = "postgres", scalar = false, timeout = TIMEOUTS.sql } = {}) {
  const args = ["exec", "-i", "--", resource.id, "psql", "-X"];
  if (scalar) args.push("-Atq");
  args.push("-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", "-U", "supabase_admin", "-d", database);
  try { return await docker(args, { input: sql, timeout }); } catch (error) { throw new Error(`${stage}: ${redactDiagnostic(error)}`); }
}

async function applyBaseline(localBaseline, database) {
  let fixtureSeeded = false;
  for (const entry of localBaseline.migrations) {
    if (entry.filename === "20260825091418_v1_delivery_continuity_cutover.sql") {
      await runPsql(buildZeroWriteFixtureSql(), "zero-write-fixture", { database, timeout: TIMEOUTS.sql });
      fixtureSeeded = true;
    }
    const body = await readFile(join(MIGRATION_DIR, entry.filename), "utf8");
    await runPsql(`\\set ON_ERROR_STOP on\n${body}`, `baseline-${entry.filename}`, { database, timeout: TIMEOUTS.migration });
  }
  if (!fixtureSeeded) throw new Error("V1 delivery cutover seed boundary is missing");
  await runPsql(String.raw`
INSERT INTO public.delivery_cutover (
  singleton_key, delivery_cutover_at, disposition, initialized_at, initialized_by
)
VALUES (
  true,
  TIMESTAMPTZ '2026-08-25 10:36:06.834081+00',
  'historical_unsent',
  TIMESTAMPTZ '2026-08-25 10:36:06.834081+00',
  'local-replay-fixture'
)
ON CONFLICT (singleton_key) DO NOTHING;
`, "seed-v1-t1", { database, timeout: TIMEOUTS.sql });
}

async function captureFingerprint(stage, database) {
  const raw = await runPsql(buildCatalogFingerprintQuery(), `fingerprint-${stage}`, { database, scalar: true, timeout: TIMEOUTS.sql });
  return fingerprintFromRows(raw.stdout);
}

async function runAssertionPhase(phase, stage, database, { prefixSql = "" } = {}) {
  const sql = buildAssertionBundle(phase);
  validateReplayPhaseSql(phase, sql);
  const marker = "XOT_CONVERGENCE_ASSERTIONS_BEGIN";
  const output = await runPsql(`${prefixSql}SELECT '${marker}';\n${sql}`, `assertions-${stage}`, { database, scalar: true, timeout: TIMEOUTS.migration });
  const markerIndex = output.stdout.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error(`${stage}: assertion boundary marker missing`);
  const assertionOutput = output.stdout.slice(markerIndex + marker.length).replace(/^\s+/, "");
  const rows = parseAssertionRows(assertionOutput);
  if (phase === "preflight") {
    assertPreflightRows(rows);
  } else {
    const pass = parseAssertionPass(assertionOutput);
    if (pass !== "XOT_CONVERGENCE_REPLAY_PASS") throw new Error(`${stage}: assertion sentinel missing`);
    assertPhaseRows(phase, rows);
  }
  return rows;
}

function assertPreflightRows(rows) {
  if (rows.bundle_preflight_t2_absent !== "true") throw new Error(`preflight: t2_absent=${rows.bundle_preflight_t2_absent}`);
  if (rows.bundle_preflight_zero_write_fixture_rows !== "2") throw new Error(`preflight: fixture rows=${rows.bundle_preflight_zero_write_fixture_rows}`);
  if (rows.bundle_preflight_delivery_receipt_rows !== "0") throw new Error(`preflight: receipt rows=${rows.bundle_preflight_delivery_receipt_rows}`);
}

function assertPhaseRows(phase, rows) {
  if (phase === "post-bundle-first" || phase === "post-bundle-second") {
    if (rows.post_bundle_t2_absent !== "true") throw new Error(`${phase}: t2 must stay absent`);
    if (rows.post_bundle_runtime_controls_rows !== "1") throw new Error(`${phase}: runtime_controls rows=${rows.post_bundle_runtime_controls_rows}`);
    if (rows.post_bundle_runtime_controls_singleton !== "true") throw new Error(`${phase}: singleton control shape missing`);
    if (rows.post_bundle_app_role_labels !== "admin,read_only") throw new Error(`${phase}: app_role labels=${rows.post_bundle_app_role_labels}`);
    if (rows.post_bundle_user_roles_pk !== "user_id") throw new Error(`${phase}: user_roles pk=${rows.post_bundle_user_roles_pk}`);
    for (const key of ["post_bundle_rls_runtime_controls", "post_bundle_rls_user_roles", "post_bundle_rls_runtime_activation_epochs", "post_bundle_table_grants", "post_bundle_rpc_grants", "post_bundle_role_functions_search_path", "post_bundle_update_rpc_security_definer", "post_bundle_update_rpc_search_path", "post_bundle_zero_write_trigger", "post_bundle_historical_jobs_unchanged", "post_bundle_historical_claim_defaults"]) {
      if (rows[key] !== "true") throw new Error(`${phase}: ${key}=${rows[key]}`);
    }
    if (rows.post_bundle_cutover_allows_job_returns !== "0") throw new Error(`${phase}: historical job remains eligible`);
    if (rows.post_bundle_receipt_tables_empty !== "0") throw new Error(`${phase}: provider receipt rows=${rows.post_bundle_receipt_tables_empty}`);
  }
  if (phase === "post-t2") {
    if (rows.post_t2_epoch_count !== "1") throw new Error(`post-t2: epoch_count=${rows.post_t2_epoch_count}`);
    if (rows.post_t2_epoch_t1_immutable !== "true") throw new Error(`post-t2: t1 immutability lost`);
    if (rows.post_t2_cutover_after_t1 !== "true") throw new Error(`post-t2: effective cutoff not after T1`);
    if (rows.post_t2_lineage_blocked !== "true") throw new Error(`post-t2: T1-equal lineage must be blocked`);
    if (rows.post_t2_historical_jobs_unchanged !== "true") throw new Error(`post-t2: historical rows changed`);
    if (rows.post_t2_receipt_tables_empty !== "0") throw new Error(`post-t2: receipt tables not empty`);
  }
  if (phase === "rollback-forward-fix") {
    if (rows.rollback_replay_epoch_count_unchanged !== "true") throw new Error(`rollback: epoch count drifted`);
    if (rows.rollback_forward_fix_settle_zero_dml !== "true") throw new Error(`rollback: settle reported a write`);
    if (rows.rollback_forward_fix_epoch_append_only !== "true") throw new Error(`rollback: epoch append-only trigger missing`);
    if (rows.rollback_forward_fix_epochs_reject_second_activation !== "true") throw new Error(`rollback: second activation key present`);
  }
}

async function createContainer(cidfile) {
  const image = await dockerJson(["image", "inspect", REPLAY_EXPECTED_IMAGE]);
  const imageInspect = Array.isArray(image) ? image[0] : image;
  assertImageInspect(imageInspect);
  let createError = null;
  try {
    await docker(buildDockerCreateArgs(resource.name, cidfile));
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
  const inspected = await dockerJson(["inspect", "--", resource.id]);
  const item = Array.isArray(inspected) ? inspected[0] : inspected;
  assertContainerOwnership(item, resource);
}

async function startAndWait() {
  await docker(["start", "--", resource.id]);
  const deadline = Date.now() + TIMEOUTS.ready;
  let markerSeen = false;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      markerSeen ||= String(await dockerText(["logs", "--", resource.id]))
        .replace(/\r/g, "").split("\n").some((line) => line.trim() === REPLAY_INIT_COMPLETE_MARKER);
    } catch (error) { lastError = redactDiagnostic(error); }
    if (markerSeen) {
      try { await docker(["exec", "--", resource.id, "pg_isready", "-U", "supabase_admin", "-d", "postgres"]); return; }
      catch { lastError = "pg_isready reported not ready"; }
    } else lastError = "init-complete marker not observed";
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`replay readiness timed out marker=${markerSeen} lastError=${redactDiagnostic(lastError)}`);
}

async function terminateChildren() {
  const children = [...activeChildren];
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    try { child.kill?.("SIGTERM"); } catch {}
  }
  const closePromise = (child) => child.__convergenceReplayClosePromise ?? Promise.resolve();
  let finished = false;
  await Promise.race([
    Promise.all(children.map(closePromise)).then(() => { finished = true; }),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!finished) {
    for (const child of children) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill?.("SIGKILL"); } catch {}
    }
    await Promise.race([
      Promise.all(children.map(closePromise)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
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

async function verifyNoLabeledResidue() {
  const containers = await dockerText(["ps", "-aq", "--filter", `label=${REPLAY_LABEL_KEY}=${REPLAY_LABEL_VALUE}`]);
  const byName = await dockerText(["ps", "-aq", "--filter", `name=^${REPLAY_CONTAINER_PREFIX}`]);
  if (containers.trim() || byName.trim()) {
    const residue = [...new Set(`${containers}\n${byName}`.trim().split("\n").filter(Boolean))].sort().join(",");
    throw new Error(`labeled replay residue remains: ${residue}`);
  }
}

async function replayFreshContainer(label, phase, localBaseline, bundle, { activate = false } = {}) {
  resource.id = null;
  resource.name = makeContainerName(`${label}-${randomBytes(5).toString("hex")}`);
  cleanupStarted = false;
  cidfileRecoveryError = null;
  cidfilePath = join(taskTempDirectory, `${label}.cid`);
  let fingerprint;
  try {
    await createContainer(cidfilePath);
    await startAndWait();
    await runPsql(E7_DISPOSABLE_PRELUDE, `${label}-E7_DISPOSABLE_PRELUDE`);
    await runPsql(REPLAY_PRELUDE, `${label}-replay-prelude`);
    await applyBaseline(localBaseline, "postgres");
    await runAssertionPhase("preflight", `${label}-preflight`, "postgres");
    await runAssertionPhase(phase, `${label}-${phase}`, "postgres", {
      prefixSql: `${assertZeroWriteInvariantSql()}\n${bundle}\n`,
    });
    fingerprint = await captureFingerprint(label, "postgres");
    if (activate) {
      await runPsql(buildActivationAssertionSql(), "activate-runtime-v2", { timeout: TIMEOUTS.sql });
      await runAssertionPhase("post-t2", "post-t2", "postgres");
      await runAssertionPhase("rollback-forward-fix", "rollback-forward-fix", "postgres");
    }
  } finally {
    lastCleanupResult = await cleanup() ?? lastCleanupResult;
    if (lastCleanupResult.status === "failed") {
      throw lastCleanupResult.error ?? new Error(`cleanup failed phase=${lastCleanupResult.phase ?? "unknown"}`);
    }
  }
  return fingerprint;
}

async function main() {
  let primaryError = null;
  let cleanupError = null;
  let cleanupResult = { status: "not-created", removed: false, absent: true };
  let tempError = null;
  let status = "FAILED";
  let fingerprintFirst = null;
  let fingerprintSecond = null;
  try {
    const localBaseline = await readLocalBaseline(ROOT);
    assertLocalBaselineAvailable(localBaseline.migrations);
    const bundle = await buildReplayBundle({ root: ROOT });
    assertBundleSql(bundle);
    const bundleSha = sha256(bundle);

    taskTempDirectory = await mkdtemp(join(tmpdir(), "xot-convergence-replay-"));
    fingerprintFirst = await replayFreshContainer(
      "first",
      "post-bundle-first",
      localBaseline,
      bundle,
    );
    fingerprintSecond = await replayFreshContainer(
      "second",
      "post-bundle-second",
      localBaseline,
      bundle,
      { activate: true },
    );

    assertFingerprintsEqual(fingerprintFirst, fingerprintSecond);

    status = "ACCEPTED_CANDIDATE_LOCAL_REPLAY";
    console.log(JSON.stringify({
      schema: "xot-v2-production-convergence-replay-receipt-v1",
      status,
      context: REPLAY_CONTEXT,
      image: REPLAY_EXPECTED_IMAGE,
      imageCommand: REPLAY_EXPECTED_IMAGE_COMMAND,
      baseline: localBaseline.label,
      baselineLabel: "local-v1-frontier-derived (not an exact production restore)",
      bundleInclusionCount: EXPECTED_INCLUSION_COUNT,
      bundleSha256: bundleSha,
      fingerprintFirstPostBundle: fingerprintFirst,
      fingerprintSecondPostBundle: fingerprintSecond,
      semanticDrift: false,
      t2: "appended-once-local",
      xRetirementInBundle: false,
      assertions: REPLAY_ASSERTION_PHASES,
      evidenceGap: "exact production semantic baseline cannot be reconstructed locally without protected live data; the honest local V1-frontier baseline is used and labeled precisely. The replay uses the same immutable image as the current historical zero-write harness (sha256:80d7b27c).",
      container: "removed",
      cleanup: "pending",
    }));
  } catch (error) {
    primaryError = error;
    process.exitCode = 1;
    console.error(`XOT_CONVERGENCE_REPLAY_FAIL ${redactDiagnostic(error)}${cidfileRecoveryError ? ` cidfileRecovery=${redactDiagnostic(cidfileRecoveryError)}` : ""}`);
  } finally {
    await signalDrainPromise;
    try {
      cleanupResult = await cleanup() ?? lastCleanupResult;
      if (cleanupResult.status === "failed") {
        cleanupError = cleanupResult.error ?? new Error(`cleanup failed phase=${cleanupResult.phase ?? "unknown"}`);
        process.exitCode = 1;
        console.error(`XOT_CONVERGENCE_REPLAY_CLEANUP_FAIL ${redactDiagnostic(cleanupError)}`);
      }
    } catch (error) {
      cleanupError = error;
      process.exitCode = 1;
      console.error(`XOT_CONVERGENCE_REPLAY_CLEANUP_FAIL ${redactDiagnostic(error)}`);
    }
    try {
      if (taskTempDirectory) await rm(taskTempDirectory, { recursive: true, force: true });
    } catch (error) {
      tempError = error;
      process.exitCode = 1;
      console.error(`XOT_CONVERGENCE_REPLAY_TEMP_CLEANUP_FAIL ${redactDiagnostic(error)}`);
    }
    let residueVerified = false;
    try {
      await verifyNoLabeledResidue();
      residueVerified = true;
    } catch (error) {
      process.exitCode = 1;
      console.error(`XOT_CONVERGENCE_REPLAY_RESIDUE_FAIL ${redactDiagnostic(error)}`);
    }
    const emitted = {
      schema: "xot-v2-production-convergence-replay-receipt-v1",
      status: primaryError || cleanupError || tempError || signalReceived || !residueVerified
        ? "FAILED"
        : status,
      context: REPLAY_CONTEXT,
      image: REPLAY_EXPECTED_IMAGE,
      baseline: "local-v1-frontier-derived",
      bundleInclusionCount: EXPECTED_INCLUSION_COUNT,
      fingerprintFirstPostBundle: fingerprintFirst,
      fingerprintSecondPostBundle: fingerprintSecond,
      semanticDrift: semanticDriftFromFingerprints(fingerprintFirst, fingerprintSecond),
      container: cleanupResult.status,
      cleanup: cleanupResult.status,
      cleanupPhase: cleanupResult.phase ?? null,
      residueVerified,
      signal: signalReceived,
      evidenceGap: "exact production semantic baseline cannot be reconstructed locally without protected live data; the honest local V1-frontier baseline is used and labeled precisely. The replay uses the same immutable image as the current historical zero-write harness (sha256:80d7b27c).",
    };
    console.log(JSON.stringify(emitted));
    if (emitted.status !== "ACCEPTED_CANDIDATE_LOCAL_REPLAY") process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  signalReceived = signal;
  process.exitCode = 1;
  signalDrainPromise = terminateChildren();
});

await main();
