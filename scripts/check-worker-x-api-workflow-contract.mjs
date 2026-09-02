import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/worker/xApiWorkflow.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`WORKER_X_API_WORKFLOW_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label}: parse diagnostics`);
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: transpilation diagnostics`);
  }
  for (const marker of [
    "type HydrationSettingsClient = {",
    "type HydrationCountClient = {",
    "export async function getTwitterCreds(\n  _supabase: unknown,",
    "export async function recordXApiCall(\n  supabase: unknown,",
    "export async function loadHydrationSettings(\n  supabase: HydrationSettingsClient,",
    "export async function countDailyHydrationsUsed(\n  supabase: HydrationCountClient,",
  ]) if (!source.includes(marker)) fail(`${label}: missing ${marker}`);
  if (source.includes("deno-lint-ignore no-explicit-any")) fail(`${label}: X API workflow suppression escape remains`);
  for (const marker of [
    'recordXApiEvent(\n    supabase,',
    '.eq("key", "twitter_hydration")',
    '.eq("key", "x_rate_limits")',
    '.eq("hydration_source", "x_api")',
  ]) if (!source.includes(marker)) fail(`${label}: missing ${marker}`);
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:worker-x-api-workflow"] !== "node scripts/check-worker-x-api-workflow-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:worker-x-api-workflow")) fail(`${label}: CI command is missing`);
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  assert.throws(() => assertContract(mutator(sources()), label), /WORKER_X_API_WORKFLOW_SOURCE_CONTRACT_FAIL/);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({ ...input, source: input.source.replace("type HydrationSettingsClient = {", "type HydrationSettingsClient = any;") }), "settings client any boundary mutant");
  assertRejects((input) => ({ ...input, source: input.source.replace("export async function countDailyHydrationsUsed(\n  supabase: HydrationCountClient,", "export async function countDailyHydrationsUsed(\n  supabase: any,") }), "count any boundary mutant");
  assertRejects((input) => ({ ...input, source: input.source.replace("recordXApiEvent(\n    supabase,", "recordXApiEvent(\n    null,") }), "X API ledger bypass mutant");
  assertRejects((input) => ({ ...input, ci: input.ci.replace("      - run: npm run check:worker-x-api-workflow\n", "") }), "CI command removal mutant");
}

console.log(`WORKER_X_API_WORKFLOW_SOURCE_CONTRACT_PASS typedBoundaries=4 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
