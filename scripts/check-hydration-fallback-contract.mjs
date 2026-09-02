import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(repoRoot, "supabase/functions/worker/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`HYDRATION_FALLBACK_SOURCE_CONTRACT_FAIL ${message}`);
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
  const hydrate = section(worker, "async function handleHydrateTweetJob(", "async function markHydrationFallback(", `${label} hydration handler`);
  const helper = section(worker, "async function markHydrationFallback(", "// Inspect existing media rows", `${label} fallback helper`);
  if (!helper.includes("const { error } = await supabase.from(\"posts\").update({")) {
    fail(`${label}: fallback status write must inspect the database result`);
  }
  if (!helper.includes('"hydrate_fallback_status_write_failed"') || !helper.includes("if (error)")) {
    fail(`${label}: fallback status write failure must defer`);
  }
  for (const source of [
    "disabled_fallback",
    "budget_exhausted_fallback",
    "no_id_fallback",
    "no_creds_fallback",
    "x_api_404",
    "x_api_empty",
  ]) {
    if (!hydrate.includes(`markHydrationFallback(supabase, tweetId, \"${source}\")`) &&
      !hydrate.includes(`\n      \"${source}\",`)) {
      fail(`${label}: fallback source ${source} is not routed through the checked helper`);
    }
  }
  if (hydrate.match(/await supabase\.from\("posts"\)\.update\(\{[\s\S]*?hydration_source:/)) {
    fail(`${label}: hydration fallback status write remains inline/unchecked`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:hydration-fallback"] !==
    "node scripts/check-hydration-fallback-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:hydration-fallback")) {
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
    if (String(error).includes("HYDRATION_FALLBACK_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (error) {\n    throw new JobDeferred(\n      "hydrate_fallback_status_write_failed",',
      'if (false) {',
    ),
  }), "fallback status write guard removed mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'await markHydrationFallback(supabase, tweetId, "disabled_fallback");',
      'await supabase.from("posts").update({ hydration_source: "disabled_fallback" });',
    ),
  }), "disabled fallback bypass mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'await markHydrationFallback(supabase, tweetId, "x_api_empty");',
      'await supabase.from("posts").update({ hydration_source: "x_api_empty" });',
    ),
  }), "empty-response fallback bypass mutant");
}

console.log(
  `HYDRATION_FALLBACK_SOURCE_CONTRACT_PASS fallbackSources=6 persistence=checked deferOnWriteError=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
