import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/monitoringMutations.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`MONITORING_MUTATION_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("monitoring mutation parse diagnostics");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("monitoring mutation transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  if (!source.includes("function validateRowsWithIds(")) {
    fail(`${label}: shared mutation row validator is missing`);
  }
  const closeJobs = section(
    source,
    "export async function closeJobsForIgnoredTweet(",
    "export async function ignoreMonitoringItemInternal(",
    `${label} ignored-job closer`,
  );
  for (const marker of [
    '"monitoring_ignore_jobs_invalid_response"',
    '"monitoring_ignore_jobs_invalid_row"',
    "validateRowsWithIds(",
  ]) {
    if (!closeJobs.includes(marker)) fail(`${label}: ignored-job result must validate ${marker}`);
  }

  const ignore = section(
    source,
    "export async function ignoreMonitoringItemInternal(",
    "export async function ignoreMonitoringItems(",
    `${label} ignore mutation`,
  );
  if (!ignore.includes("const { data: post, error: postError } = await table(supabase, \"posts\")")) {
    fail(`${label}: ignored-item post read must retain its error envelope`);
  }
  if (!ignore.includes('"monitoring_ignore_post_read_failed"')) {
    fail(`${label}: ignored-item post read errors must fail closed`);
  }
  for (const marker of [
    '"monitoring_ignore_x_deliveries_invalid_response"',
    '"monitoring_ignore_deliveries_invalid_response"',
    '"monitoring_ignore_post_update_failed"',
    '"monitoring_ignore_x_deliveries_update_failed"',
    '"monitoring_ignore_deliveries_update_failed"',
    '"monitoring_ignore_feedback_write_failed"',
  ]) {
    if (!ignore.includes(marker)) fail(`${label}: ignored-item mutation must protect ${marker}`);
  }
  if (source.includes("errorMessage(") || source.includes("String(error)")) {
    fail(`${label}: ignored-item mutation must not expose raw database or exception text`);
  }
  if (ignore.includes(".catch(() => {})")) {
    fail(`${label}: ignored-item feedback persistence must not be swallowed`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:monitoring-mutation-fail-closed"] !==
    "node scripts/check-monitoring-mutation-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:monitoring-mutation-fail-closed")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("MONITORING_MUTATION_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "const { data: post, error: postError } = await table(supabase, \"posts\")",
      "const { data: post } = await table(supabase, \"posts\")",
    ),
  }), "post-read error ignored mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll(
      '"monitoring_ignore_jobs_invalid_response"',
      '"ignored_jobs_response"',
    ),
  }), "ignored-job malformed response mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll(
      '"monitoring_ignore_x_deliveries_invalid_response"',
      '"ignored_x_response"',
    ),
  }), "X-delivery malformed response mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll(
      '"monitoring_ignore_deliveries_invalid_response"',
      '"ignored_delivery_response"',
    ),
  }), "Telegram-delivery malformed response mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'error: "monitoring_ignore_feedback_write_failed",',
      'error: errorMessage(error),',
    ),
  }), "feedback persistence ignored mutant");
  for (const [needle, replacement, label] of [
    ['error: "monitoring_ignore_post_update_failed",', 'error: errorMessage(postErr),', "post update raw error"],
    ['error: "monitoring_ignore_x_deliveries_update_failed",', 'error: errorMessage(xErr),', "X delivery update raw error"],
    ['error: "monitoring_ignore_deliveries_update_failed",', 'error: errorMessage(deliveryErr),', "Telegram delivery update raw error"],
  ]) {
    assertRejects((source) => ({
      ...source,
      source: source.source.replace(needle, replacement),
    }), label);
  }
}

console.log(
  `MONITORING_MUTATION_FAIL_CLOSED_SOURCE_CONTRACT_PASS reads=true rows=true feedback=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
