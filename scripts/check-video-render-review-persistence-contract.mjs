import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/videoRenderActions.ts");

function fail(message) {
  throw new Error(`VIDEO_RENDER_REVIEW_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract(source, label = "current source") {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label}: parse diagnostics`);
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((out.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: transpilation diagnostics`);
  }
  const start = source.indexOf("export async function setVideoRenderReviewedAdmin(");
  if (start < 0) fail(`${label}: review action marker is missing`);
  const helper = source.slice(start);
  if (!helper.includes("const { error: pipelineEventError } = await table(supabase, 'pipeline_events').insert(eventRows);")) {
    fail(`${label}: review pipeline-event insert result must be checked`);
  }
  if (!helper.includes("if (pipelineEventError) {") ||
      (helper.match(/video_render_review_pipeline_event_insert_failed/g) ?? []).length < 2) {
    fail(`${label}: returned and thrown review-event failures need stable diagnostics`);
  }
  if (helper.includes(".then(() => null, () => null)") ||
      helper.includes("catch (_e) {}") || helper.includes("error: _e")) {
    fail(`${label}: review-event failures must not be silently swallowed or raw`);
  }
}

const source = fs.readFileSync(sourcePath, "utf8");
assertContract(source);

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(source), label);
  } catch (error) {
    if (String(error).includes("VIDEO_RENDER_REVIEW_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects((value) => value.replace("const { error: pipelineEventError } = await table(supabase, 'pipeline_events').insert(eventRows);", "await table(supabase, 'pipeline_events').insert(eventRows);"), "result ignored");
  assertRejects((value) => value.replace("if (pipelineEventError) {", "if (false) {"), "failure guard removed");
  assertRejects((value) => value.replace("error: 'video_render_review_pipeline_event_insert_failed',", "error: _e,"), "raw error");
}

console.log(`VIDEO_RENDER_REVIEW_PERSISTENCE_SOURCE_CONTRACT_PASS selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
