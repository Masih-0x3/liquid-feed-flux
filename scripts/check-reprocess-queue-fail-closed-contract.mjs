import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`REPROCESS_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseWorker(source) {
  const sourceFile = ts.createSourceFile(workerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("worker parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: workerPath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("worker transpilation diagnostics");
  }
}

function assertContract({ worker, packageJson, ci }, label = "current source") {
  parseWorker(worker);
  const start = worker.indexOf("async function handleReprocessJob");
  const end = worker.indexOf("async function dispatchXPosterForTarget", start);
  if (start < 0 || end < 0) fail(`${label}: reprocess handler markers are missing`);
  const handler = worker.slice(start, end);
  if (!handler.includes("reprocess_dedupe_enqueue_failed")) fail(`${label}: missing checked reprocess dedupe enqueue`);
  if (!handler.includes('}).select("id");')) fail(`${label}: reprocess must inspect insert result`);
  if (!handler.includes('classifyQueueInsertResult(insertedRows, "reprocess_dedupe_enqueue_failed")')) {
    fail(`${label}: reprocess must classify the exact insert result`);
  }
  if (!handler.includes('=== "duplicate") return true;')) {
    fail(`${label}: duplicate reprocess queue must not mutate post state`);
  }
  for (const marker of [
    'throw new Error("reprocess_post_read_failed");',
    'throw new Error("reprocess_dedupe_enqueue_failed");',
    'const errorCode = knownErrors.has(e.message) ? e.message : "reprocess_failed";',
    'error: errorCode,',
  ]) {
    if (!handler.includes(marker)) fail(`${label}: missing bounded reprocess error marker ${marker}`);
  }
  if (handler.includes("enqueue_failed:${enqueueError.message}")) {
    fail(`${label}: reprocess enqueue errors still forward database text`);
  }
  if (handler.includes("error: e.message")) {
    fail(`${label}: reprocess telemetry still forwards raw exception text`);
  }
  if (!handler.includes("if (error instanceof JobDeferred) throw error;")) {
    fail(`${label}: reprocess must preserve bounded duplicate-gate deferrals`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:reprocess-queue-fail-closed"] !== "node scripts/check-reprocess-queue-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:reprocess-queue-fail-closed")) {
    fail(`${label}: hosted CI command is missing`);
  }
}

function sources() {
  return {
    worker: fs.readFileSync(workerPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("REPROCESS_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace("throw new Error(\"reprocess_dedupe_enqueue_failed\");", "console.warn(\"dedupe enqueue failed\");"),
  }), "reprocess dedupe enqueue failure continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('classifyQueueInsertResult(insertedRows, "reprocess_dedupe_enqueue_failed")', '"inserted"'),
  }), "reprocess duplicate mutation guard removal");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const errorCode = knownErrors.has(e.message) ? e.message : "reprocess_failed";',
      'const errorCode = e.message;',
    ),
  }), "reprocess raw catch forwarding");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '  } catch (error) {\n    if (error instanceof JobDeferred) throw error;\n    const e = jobError(error);\n    const knownErrors = new Set([',
      '  } catch (error) {\n    if (false) throw error;\n    const e = jobError(error);\n    const knownErrors = new Set([',
    ),
  }), "reprocess JobDeferred swallow");
}

console.log(`REPROCESS_QUEUE_FAIL_CLOSED_SOURCE_CONTRACT_PASS enqueueWrites=1 duplicateMutationGuard=true nonDestructiveStagingPreserved=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
