import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`ENRICH_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
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

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assertContract({ worker, packageJson, ci }, label = "current source") {
  parseWorker(worker);
  const handler = section(
    worker,
    "async function handleEnrichJob(",
    "// deno-lint-ignore no-explicit-any\nasync function enqueueDeliverAfterEnrich(",
    `${label} handleEnrichJob`,
  );

  const required = [
    [
      'const { data: configRow, error: configError } = await supabase',
      'if (configError) {',
      '"enrich_config_read_failed"',
      "enrichment config read gate",
    ],
    [
      'const { error: enrichSkipError } = await supabase.from("posts").update({ enrich_status: "skipped" })',
      'if (enrichSkipError) {',
      '"enrich_skip_status_write_failed"',
      "enrichment skip status write gate",
    ],
    [
      'const { data: voiceRows, error: voiceSettingsError } = await supabase',
      'if (voiceSettingsError) {',
      '"enrich_voice_settings_read_failed"',
      "voice settings read gate",
    ],
    [
      'const { error: enrichPendingError } = await supabase.from("posts").update({ enrich_status: "pending" })',
      'if (enrichPendingError) {',
      '"enrich_pending_status_write_failed"',
      "enrichment pending status write gate",
    ],
    [
      'const { error: enrichPostWriteError } = await supabase.from("posts").update({',
      'if (enrichPostWriteError) {',
      '"enrich_result_persistence_unknown:posts"',
      "enrichment result post write ambiguity gate",
    ],
    [
      'const { error: enrichmentInsertError } = await supabase.from("post_enrichments").insert({',
      'if (enrichmentInsertError) {',
      '"enrich_result_persistence_unknown:post_enrichments"',
      "enrichment audit insert ambiguity gate",
    ],
  ];
  for (const [binding, guard, failure, name] of required) {
    if (!handler.includes(binding) || !handler.includes(guard) || !handler.includes(failure)) {
      fail(`${label}: ${name} is missing`);
    }
  }
  if (!handler.includes("new NonRetryableJobError(") ||
    !handler.includes("enrich_result_persistence_unknown:")) {
    fail(`${label}: provider-success persistence ambiguity must be non-retryable`);
  }
  if (!handler.includes("if (!Array.isArray(voiceRows))") ||
      !handler.includes('"enrich_voice_settings_invalid_response"')) {
    fail(`${label}: malformed voice settings responses must defer`);
  }
  if (!handler.includes(
    'const { error: enrichFailureStatusError } = await supabase.from("posts").update({ enrich_status: "failed" }).eq(',
  ) || countOccurrences(handler, "if (enrichFailureStatusError) {") < 2 ||
      !handler.includes('error: "enrich_failure_status_write_failed",') ||
      !handler.includes('"enrich_failure_status_persistence_unknown"')) {
    fail(`${label}: enrichment failure-status persistence must be checked and ambiguous`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:enrich-persistence"] !==
    "node scripts/check-enrich-persistence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:enrich-persistence")) {
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
    if (String(error).includes("ENRICH_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  const mutants = [
    [
      'throw new JobDeferred(\n      "enrich_config_read_failed",',
      'if (false) { throw configError; }',
      "config read gate removed",
    ],
    [
      'throw new JobDeferred(\n        "enrich_skip_status_write_failed",',
      'if (false) { throw enrichSkipError; }',
      "skip status write gate removed",
    ],
    [
      'throw new JobDeferred(\n      "enrich_voice_settings_read_failed",',
      'if (false) { throw voiceSettingsError; }',
      "voice settings gate removed",
    ],
    [
      'if (!Array.isArray(voiceRows)) {',
      'if (false) {',
      "voice settings malformed-response gate removed",
    ],
    [
      'throw new JobDeferred(\n      "enrich_pending_status_write_failed",',
      'if (false) { throw enrichPendingError; }',
      "pending status write gate removed",
    ],
    [
      'throw new NonRetryableJobError(\n        "enrich_result_persistence_unknown:posts",',
      'throw new Error("post write failed");',
      "post result ambiguity guard removed",
    ],
    [
      'throw new NonRetryableJobError(\n        "enrich_result_persistence_unknown:post_enrichments",',
      'throw new Error("enrichment insert failed");',
      "audit insert ambiguity guard removed",
    ],
    [
      'if (enrichFailureStatusError) {',
      'if (false) {',
      "failure-status write guard removed",
    ],
    [
      'throw new NonRetryableJobError(\n        "enrich_failure_status_persistence_unknown",',
      'throw new Error("enrichment failure status write ignored");',
      "failure-status ambiguity guard removed",
    ],
  ];
  for (const [needle, replacement, label] of mutants) {
    assertRejects((source) => ({
      ...source,
      worker: source.worker.replace(needle, replacement),
    }), label);
  }
}

console.log(
  `ENRICH_PERSISTENCE_SOURCE_CONTRACT_PASS readAndWriteGates=7 providerSuccessAmbiguity=true failureStatusAmbiguity=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
