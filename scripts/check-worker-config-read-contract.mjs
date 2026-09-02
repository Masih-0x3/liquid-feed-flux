import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`WORKER_CONFIG_READ_SOURCE_CONTRACT_FAIL ${message}`);
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
  const loader = section(worker, "async function loadConfig(", "// deno-lint-ignore no-explicit-any\nasync function handleDedupeJob(", `${label} worker config loader`);
  if (!loader.includes("const { data: settings, error: settingsError } = await supabase")) {
    fail(`${label}: settings read error is not retained`);
  }
  if (!loader.includes("if (settingsError) throw settingsError;")) {
    fail(`${label}: settings read error is not fail closed`);
  }
  if (!loader.includes('throw new Error("worker_settings_read_failed");')) {
    fail(`${label}: stable worker config failure is missing`);
  }
  if (loader.includes("using defaults")) {
    fail(`${label}: worker config read failure still falls back to defaults`);
  }
  if (!loader.includes('s.key === "story_memory"') ||
      !loader.includes('worker_story_memory_invalid_response') ||
      !loader.includes("Array.isArray(s.value)")) {
    fail(`${label}: malformed story_memory settings must fail closed before normalization`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:worker-config-read"] !==
    "node scripts/check-worker-config-read-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:worker-config-read")) {
    fail(`${label}: hosted CI contract is missing`);
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
    if (String(error).includes("WORKER_CONFIG_READ_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace("if (settingsError) throw settingsError;", "if (false) throw settingsError;"),
  }), "worker settings result error guard removed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('throw new Error("worker_settings_read_failed");', "return defaults;"),
  }), "worker settings default fallback mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("worker_story_memory_invalid_response");',
      "/* malformed story_memory silently ignored */",
    ),
  }), "malformed story_memory fallback mutant");
}

console.log(
  `WORKER_CONFIG_READ_SOURCE_CONTRACT_PASS settings=fail-closed defaults=missing-only selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
