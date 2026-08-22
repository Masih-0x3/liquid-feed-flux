import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/manualAdvanceActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) { throw new Error(`MANUAL_ADVANCE_SOURCE_CONTRACT_FAIL ${message}`); }
function parse(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("manual advance parse diagnostics");
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((out.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) fail("manual advance transpilation diagnostics");
}
function action(source) {
  const start = source.indexOf("export async function queueManualAdvance(");
  const nextExport = source.indexOf("\nexport ", start + 10);
  if (start < 0) fail("manual advance action markers are missing");
  return source.slice(start, nextExport < 0 ? source.length : nextExport);
}
function assertContract({ source, packageJson, ci }, label = "current source") {
  parse(source);
  const code = action(source);
  for (const marker of [
    "const { data: post, error: postError }",
    "if (postError) throw postError;",
    "const { data: enrichCfgRow, error: enrichCfgError }",
    "if (enrichCfgError) throw enrichCfgError;",
    "manual_advance_enrichment_config_invalid_response",
    "const { error: enrichJobError }",
    "if (enrichJobError) throw enrichJobError;",
    "const { error: deliverJobError }",
    "if (deliverJobError) throw deliverJobError;",
    "const { data: pendingDeliveries, error: pendingDeliveriesError }",
    "if (pendingDeliveriesError) throw pendingDeliveriesError;",
    "if (!Array.isArray(pendingDeliveries))",
    "const { error: deliveryInsertError }",
    "if (deliveryInsertError) throw deliveryInsertError;",
  ]) if (!code.includes(marker)) fail(`${label}: missing ${marker}`);
  const pkg = JSON.parse(packageJson);
  if (pkg.scripts?.["check:manual-advance"] !== "node scripts/check-manual-advance-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:manual-advance")) fail(`${label}: hosted CI command is missing`);
}
function sources() { return { source: fs.readFileSync(sourcePath, "utf8"), packageJson: fs.readFileSync(packagePath, "utf8"), ci: fs.readFileSync(ciPath, "utf8") }; }
function assertRejects(mutator, label) {
  try { assertContract(mutator(sources()), label); } catch (error) {
    if (String(error).includes("MANUAL_ADVANCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}
assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, label] of [
    ["if (enrichCfgError) throw enrichCfgError;", "enrichment config error bypass"],
    ["if (enrichJobError) throw enrichJobError;", "enrichment enqueue error bypass"],
    ["if (deliverJobError) throw deliverJobError;", "delivery enqueue error bypass"],
    ["if (pendingDeliveriesError) throw pendingDeliveriesError;", "pending delivery read error bypass"],
    ["if (deliveryInsertError) throw deliveryInsertError;", "delivery receipt insert error bypass"],
  ]) assertRejects((source) => ({ ...source, source: source.source.replace(needle, "if (false) throw new Error('ignored');") }), label);
  assertRejects((source) => ({ ...source, source: source.source.replace("if (!Array.isArray(pendingDeliveries))", "if (false)") }), "pending delivery malformed response bypass");
}
console.log(`MANUAL_ADVANCE_SOURCE_CONTRACT_PASS readsAndWrites=failClosed deliveryAdmission=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
