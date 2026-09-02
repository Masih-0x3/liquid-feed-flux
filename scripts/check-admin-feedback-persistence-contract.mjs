import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  sideEffects: path.join(repoRoot, "supabase/functions/admin-actions/sideEffects.ts"),
  scoring: path.join(repoRoot, "supabase/functions/admin-actions/scoringActions.ts"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`ADMIN_FEEDBACK_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, filePath, label) {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label} parse diagnostics`);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((out.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) fail(`${label} transpilation diagnostics`);
}

function assertContract({ sideEffects, scoring, packageJson, ci }, label = "current source") {
  parse(sideEffects, paths.sideEffects, `${label} side effects`);
  parse(scoring, paths.scoring, `${label} scoring actions`);
  for (const [needle, name] of [
    ["const { error: feedbackInsertError } = await table(supabase, \"feedback_events\").insert({", "feedback insert result"],
    ["if (feedbackInsertError) throw feedbackInsertError;", "feedback insert error"],
    ["const { data: post, error: postError } = await table(supabase, \"posts\")", "feedback post lookup result"],
    ["if (postError) throw postError;", "feedback post lookup error"],
    ["const { data: biasRow, error: biasReadError } = await table(supabase, \"settings\")", "learned-bias read result"],
    ["if (biasReadError) throw biasReadError;", "learned-bias read error"],
    ["if (biasRow !== null && (typeof biasRow !== \"object\" || Array.isArray(biasRow)))", "learned-bias shape guard"],
    ["const { error: biasWriteError } = await table(supabase, \"settings\").upsert({", "learned-bias write result"],
    ["if (biasWriteError) throw biasWriteError;", "learned-bias write error"],
    ["const { error: reviewUpdateError } = await table(supabase, \"posts\").update(reviewPatch).eq(\"tweet_id\", tweetId);", "score-review lock result"],
    ["if (reviewUpdateError) throw new Error(\"score_feedback_post_update_failed\");", "score-review lock error"],
  ]) {
    if (!sideEffects.includes(needle) && !scoring.includes(needle)) fail(`${label}: missing ${name}`);
  }
  if (!sideEffects.includes("const { error: pipelineEventError } = await table(supabase, \"pipeline_events\").insert({") ||
      !sideEffects.includes("if (pipelineEventError) {") ||
      !sideEffects.includes('error: "admin_pipeline_event_insert_failed",') ||
      sideEffects.includes("}).then(() => null, () => null);") ||
      sideEffects.includes("error: _error")) {
    fail(`${label}: admin pipeline-event failures must be checked and redacted`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:admin-feedback-persistence"] !== "node scripts/check-admin-feedback-persistence-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:admin-feedback-persistence")) fail(`${label}: hosted CI command is missing`);
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([key, filePath]) => [key === "packageJson" || key === "ci" ? key : key, fs.readFileSync(filePath, "utf8")]));
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("ADMIN_FEEDBACK_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [field, needle, label] of [
    ["sideEffects", "if (feedbackInsertError) throw feedbackInsertError;", "feedback insert bypass"],
    ["sideEffects", "if (postError) throw postError;", "feedback post lookup bypass"],
    ["sideEffects", "if (biasReadError) throw biasReadError;", "learned-bias read bypass"],
    ["sideEffects", "if (biasWriteError) throw biasWriteError;", "learned-bias write bypass"],
    ["scoring", "if (reviewUpdateError) throw new Error(\"score_feedback_post_update_failed\");", "score-review lock bypass"],
  ]) assertRejects((source) => ({ ...source, [field]: source[field].replace(needle, "if (false) throw new Error('ignored');") }), label);
  assertRejects((source) => ({ ...source, sideEffects: source.sideEffects.replace("if (biasRow !== null && (typeof biasRow !== \"object\" || Array.isArray(biasRow)))", "if (false)") }), "learned-bias shape bypass");
  assertRejects((source) => ({
    ...source,
    sideEffects: source.sideEffects.replace("if (pipelineEventError) {", "if (false) {"),
  }), "admin pipeline-event failure guard removal");
  assertRejects((source) => ({
    ...source,
    sideEffects: source.sideEffects.replace(
      'error: "admin_pipeline_event_insert_failed",',
      "error: _error,",
    ),
  }), "admin pipeline-event raw error diagnostic");
}

console.log(`ADMIN_FEEDBACK_PERSISTENCE_SOURCE_CONTRACT_PASS authoritativeWrites=checked telemetryBestEffort=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
