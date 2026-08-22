import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`RESOLVE_MEDIA_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
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

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ worker, packageJson, ci }, label = "current source") {
  parseWorker(worker);
  const enqueueHelperStart = worker.indexOf("async function maybeEnqueueResolveMedia");
  const handlerStart = worker.indexOf("async function handleResolveMediaJob");
  if (enqueueHelperStart < 0 || handlerStart < 0 || enqueueHelperStart >= handlerStart) {
    fail(`${label}: resolve_media enqueue helper markers are missing`);
  }
  const enqueueHelper = worker.slice(enqueueHelperStart, handlerStart);
  for (const marker of ["resolve_media_signal_read_failed", "resolve_media_signal_invalid_response", "resolve_media_enqueue_failed"]) {
    if (!enqueueHelper.includes(marker)) fail(`${label}: missing fail-closed enqueue helper guard ${marker}`);
  }
  if (!enqueueHelper.includes("if (!Array.isArray(mediaRows))")) {
    fail(`${label}: resolve-media signal reads must reject malformed successful responses`);
  }
  if (!worker.includes("const MAX_RESOLVE_MEDIA_SIGNAL_ROWS = 50;")) {
    fail(`${label}: resolve-media signal row budget must remain explicit`);
  }
  if (!enqueueHelper.includes(".order(\"ordering\", { ascending: true })") ||
      !enqueueHelper.includes(".limit(MAX_RESOLVE_MEDIA_SIGNAL_ROWS)")) {
    fail(`${label}: resolve-media signal reads must be deterministic and bounded`);
  }
  if (!enqueueHelper.includes('if (jobErr) {\n      throw new Error("resolve_media_enqueue_failed");\n    }')) {
    fail(`${label}: enqueue helper must surface a stable failure code`);
  }
  const handler = worker.slice(handlerStart);
  for (const marker of [
    "media_prune_failed",
    "media_flag_update_failed",
    "download_enqueue_failed",
  ]) {
    if (!handler.includes(marker)) fail(`${label}: missing fail-closed persistence error ${marker}`);
  }
  if (handler.includes("console.warn(\"resolve_media: prune leftover rows failed\"")) {
    fail(`${label}: prune failure still permits completed resolve_media`);
  }
  if (handler.includes("console.warn(\n      \"resolve_media: failed to enqueue download_media\"")) {
    fail(`${label}: download enqueue failure still permits completed resolve_media`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:resolve-media-persistence"] !== "node scripts/check-resolve-media-persistence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:resolve-media-persistence")) {
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
    if (String(error).includes("RESOLVE_MEDIA_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("resolve_media_prune_failed");', "console.warn(\"prune failed\");"),
  }), "prune failure continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("resolve_media_flag_update_failed");', "console.warn(\"flag failed\");"),
  }), "media flag failure continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("resolve_media_download_enqueue_failed");', "console.warn(\"download enqueue failed\");"),
  }), "download enqueue failure continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("resolve_media_signal_read_failed");', "console.warn(\"signal read failed\");"),
  }), "media signal read failure continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (!Array.isArray(mediaRows)) {',
      'if (false) {',
    ),
  }), "media signal malformed response continuation");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '.limit(MAX_RESOLVE_MEDIA_SIGNAL_ROWS);',
      ';',
    ),
  }), "media signal unbounded read");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("resolve_media_enqueue_failed");', "console.warn(\"resolve enqueue failed\");"),
  }), "resolve enqueue failure continuation");
}

console.log(`RESOLVE_MEDIA_PERSISTENCE_SOURCE_CONTRACT_PASS persistenceGuards=3 completedOnlyAfterDownloadEnqueue=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
