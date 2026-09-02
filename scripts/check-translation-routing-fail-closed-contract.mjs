import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`TRANSLATION_ROUTING_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseWorker(source) {
  const sourceFile = ts.createSourceFile(
    workerPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
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
  const handler = section(
    worker,
    "async function handleTranslateJob(",
    "async function handleModerateJob(",
    `${label} handleTranslateJob`,
  );

  if (!handler.includes(
    'const { data: latestDedupe, error: latestDedupeError } = await supabase',
  ) || !handler.includes("if (latestDedupeError) throw latestDedupeError;") ||
    !handler.includes('throw new NonRetryableJobError("translate_dedupe_state_unknown");')) {
    fail(`${label}: post-provider dedupe state errors must be non-retryable and fail closed`);
  }
  if (handler.includes("latest dedupe check failed (continuing)")) {
    fail(`${label}: dedupe state lookup must not continue after an unknown read`);
  }

  if (!handler.includes(
    'const { data: enrichCfgRow, error: enrichCfgError } = await supabase',
  ) || !handler.includes("if (enrichCfgError) {") ||
    !handler.includes('"translate_enrichment_config_read_failed"')) {
    fail(`${label}: enrichment-config read errors must defer before routing`);
  }
  if (!handler.includes(
    "if (error instanceof JobDeferred) throw error;",
  ) || !handler.includes(
    'throw new JobDeferred(\n          "translate_enrichment_config_read_failed",',
  ) || handler.split("if (error instanceof JobDeferred) throw error;").length - 1 < 2) {
    fail(`${label}: enrichment-config JobDeferred must survive the handler catch`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:translation-routing-fail-closed"] !==
    "node scripts/check-translation-routing-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:translation-routing-fail-closed")) {
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
    if (String(error).includes("TRANSLATION_ROUTING_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "if (latestDedupeError) throw latestDedupeError;",
      "if (false) throw latestDedupeError;",
    ),
  }), "dedupe read error ignored mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new NonRetryableJobError("translate_dedupe_state_unknown");',
      'console.warn("dedupe state unknown");',
    ),
  }), "dedupe ambiguity classification removed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      "if (enrichCfgError) {",
      "if (false) {",
    ),
  }), "enrichment config read gate removed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (error instanceof JobDeferred) throw error;\n        throw new JobDeferred(\n          "translate_enrichment_config_read_failed",',
      'if (false) throw error;\n        throw new JobDeferred(\n          "translate_enrichment_config_read_failed",',
    ),
  }), "enrichment config JobDeferred swallowed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n          "translate_enrichment_config_read_failed",',
      'console.warn("enrichment config read failed");',
    ),
  }), "enrichment config generic failure continuation mutant");
}

console.log(
  `TRANSLATION_ROUTING_SOURCE_CONTRACT_PASS dedupeUnknown=nonRetryable enrichmentConfig=deferred selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
