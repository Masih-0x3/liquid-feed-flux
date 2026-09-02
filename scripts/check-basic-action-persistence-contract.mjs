import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/basicActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`BASIC_ACTION_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("basic action parse diagnostics");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("basic action transpilation diagnostics");
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
  const edit = section(source, "export async function editTranslationAdminAction(", "export async function retryStepAdminAction(", `${label} edit translation`);
  if (!edit.includes('error: "edit_translation_feedback_write_failed",')) fail(`${label}: edit feedback errors must be explicit`);
  const retry = section(source, "export async function retryStepAdminAction(", "export async function reprocessAdminAction(", `${label} retry step`);
  if (!retry.includes('error: "retry_feedback_write_failed",')) fail(`${label}: retry feedback errors must be explicit`);
  const reprocess = section(source, "export async function reprocessAdminAction(", "export async function cancelPendingJobsAdminAction(", `${label} reprocess`);
  if (!reprocess.includes('error: "reprocess_feedback_write_failed",')) fail(`${label}: reprocess feedback errors must be explicit`);
  if (source.includes("errorMessage(") || source.includes("String(error)")) fail(`${label}: basic action failures must not expose raw exception text`);
  const cancel = section(source, "export async function cancelPendingJobsAdminAction(", "export async function bulkReprocessAdminAction(", `${label} cancel jobs`);
  if (!cancel.includes('"cancel_pending_jobs_invalid_response"') || !cancel.includes('"cancel_pending_jobs_invalid_row"')) fail(`${label}: cancel result shape must fail closed`);
  const reconcile = section(source, "export async function reconcileStuckJobsAdminAction(", "\n}", `${label} reconcile jobs`);
  if (!reconcile.includes("const { error: eventError } = await table(supabase, \"pipeline_events\").insert(") || !reconcile.includes("if (eventError) throw eventError;")) fail(`${label}: reconcile event persistence must be checked`);
  if (source.includes(".catch(() => {})")) fail(`${label}: basic actions must not swallow feedback persistence errors`);
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:basic-action-persistence"] !== "node scripts/check-basic-action-persistence-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:basic-action-persistence")) fail(`${label}: hosted CI contract is missing`);
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
    if (String(error).includes("BASIC_ACTION_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, label] of [
    ['error: "edit_translation_feedback_write_failed",', "edit feedback bypass"],
    ['error: "retry_feedback_write_failed",', "retry feedback bypass"],
    ['error: "reprocess_feedback_write_failed",', "reprocess feedback bypass"],
  ]) assertRejects((source) => ({ ...source, source: source.source.replace(needle, "ignored_feedback_error") }), label);
  assertRejects((source) => ({ ...source, source: source.source.replace('"cancel_pending_jobs_invalid_response"', '"ignored_cancel_response"') }), "cancel malformed response bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace('"cancel_pending_jobs_invalid_row"', '"ignored_cancel_row"') }), "cancel malformed row bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("if (eventError) throw eventError;", "if (false) throw eventError;") }), "reconcile event persistence bypass");
}

console.log(`BASIC_ACTION_PERSISTENCE_SOURCE_CONTRACT_PASS feedback=true cancelShape=true reconcileEvent=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
