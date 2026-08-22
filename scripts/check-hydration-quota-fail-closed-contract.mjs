import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const workflowPath = path.join(repoRoot, "supabase/functions/worker/xApiWorkflow.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`HYDRATION_QUOTA_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail(`${fileName} parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${fileName} transpilation diagnostics`);
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ worker, workflow, packageJson, ci }, label = "current source") {
  parse(worker, workerPath);
  parse(workflow, workflowPath);

  if (!workflow.includes("available: boolean;")) fail(`${label}: hydration settings availability field is missing`);
  const settings = section(workflow, "export async function loadHydrationSettings(", "// Count hydration X API calls", `${label} hydration settings`);
  for (const marker of ["error: thError", "error: rlError", "if (thError) available = false;", "if (rlError) available = false;", "available = false"]) {
    if (!settings.includes(marker)) fail(`${label}: hydration settings gate marker missing: ${marker}`);
  }
  for (const marker of ["th.value === null", "Array.isArray(th.value)", "rl.value === null", "Array.isArray(rl.value)"]) {
    if (!settings.includes(marker)) fail(`${label}: malformed hydration settings must mark availability false: ${marker}`);
  }
  if (!settings.includes("return { enabled, daily_budget, available }")) {
    fail(`${label}: hydration settings must expose availability`);
  }

  const count = section(workflow, "export async function countDailyHydrationsUsed(", "export function buildHydratedTweetPatch", `${label} hydration usage count`);
  if (!count.includes("): Promise<number | null>")) fail(`${label}: usage count must expose unavailable state`);
  if (!count.includes("error")) fail(`${label}: usage count result error must be inspected`);
  if (!count.includes("Number.isSafeInteger(count)")) fail(`${label}: usage count must reject malformed counts`);
  if (!count.includes("return null;")) fail(`${label}: usage count failure must not normalize to zero`);

  const translate = section(worker, "async function handleTranslateJob(", "async function handleModerateJob(", `${label} translation hydration admission`);
  if (!translate.includes('"translate_hydration_settings_read_failed"') || !translate.includes("if (!hydrationCfg.available)")) {
    fail(`${label}: translation must defer when hydration settings are unavailable`);
  }
  const hydrate = section(worker, "async function handleHydrateTweetJob(", "// Inspect existing media rows", `${label} hydration admission`);
  if (!hydrate.includes('"hydrate_settings_read_failed"') || !hydrate.includes('"hydrate_usage_read_failed"') ||
    !hydrate.includes("if (!hydrationCfg.available)") || !hydrate.includes("if (used24h === null)")) {
    fail(`${label}: hydration provider admission must fail closed on settings/usage uncertainty`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:hydration-quota-fail-closed"] !==
    "node scripts/check-hydration-quota-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:hydration-quota-fail-closed")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    worker: fs.readFileSync(workerPath, "utf8"),
    workflow: fs.readFileSync(workflowPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("HYDRATION_QUOTA_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("if (thError) available = false;", "if (false) available = false;"),
  }), "twitter hydration settings error guard removed mutant");
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("if (rlError) available = false;", "if (false) available = false;"),
  }), "rate-limit settings error guard removed mutant");
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("th.value === null", "false"),
  }), "twitter hydration malformed envelope guard removed mutant");
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("rl.value === null", "false"),
  }), "rate-limit malformed envelope guard removed mutant");
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("if (error || !Number.isSafeInteger(count) || count < 0) return null;", "if (false) return null;"),
  }), "usage count fail-open mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('if (!hydrationCfg.available) {\n      throw new JobDeferred(\n        "translate_hydration_settings_read_failed",', "if (false) {"),
  }), "translation settings availability guard removed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('if (used24h === null) {\n    throw new JobDeferred(\n      "hydrate_usage_read_failed",', "if (false) {"),
  }), "hydration usage availability guard removed mutant");
}

console.log(
  `HYDRATION_QUOTA_SOURCE_CONTRACT_PASS settings=fail-closed usage=nullable providerAdmission=blockedOnUnknown selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
