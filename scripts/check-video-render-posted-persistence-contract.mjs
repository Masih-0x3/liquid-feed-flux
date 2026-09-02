import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repoRoot, "supabase/functions/worker/videoRenderWorkflow.ts");
const packagePath = join(repoRoot, "package.json");
const ciPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`VIDEO_RENDER_POSTED_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: workflowPath,
    reportDiagnostics: true,
  });
  if ((result.diagnostics ?? []).some((diagnostic) =>
    diagnostic.category === typescript.DiagnosticCategory.Error
  )) fail("video render workflow has TypeScript diagnostics");
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail("markVideoRenderPosted section markers are missing");
  return source.slice(startIndex, endIndex);
}

function assertContract({ workflow, packageJson, ci }, label = "current source") {
  parse(workflow);
  const helper = workflow.slice(workflow.indexOf("export async function markVideoRenderPosted("));
  if (!helper.includes('const { error } = await supabase.rpc("mark_video_render_posted",')) {
    fail(`${label}: mark_video_render_posted result error is not retained`);
  }
  if (!helper.includes('if (error) {') ||
      !helper.includes('error: "video_render_posted_update_failed"') ||
      helper.includes("error: error.message") ||
      helper.includes("// best-effort")) {
    fail(`${label}: mark_video_render_posted failures must emit a stable checked diagnostic`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:video-render-posted-persistence"] !==
      "node scripts/check-video-render-posted-persistence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:video-render-posted-persistence")) {
    fail(`${label}: hosted CI command is missing`);
  }
}

function sources() {
  return {
    workflow: readFileSync(workflowPath, "utf8"),
    packageJson: readFileSync(packagePath, "utf8"),
    ci: readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("VIDEO_RENDER_POSTED_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace("if (error) {", "if (false) {"),
  }), "returned RPC error guard removal");
  assertRejects((source) => ({
    ...source,
    workflow: source.workflow.replace(
      'error: "video_render_posted_update_failed",',
      "error: error.message,",
    ),
  }), "raw RPC error diagnostic mutant");
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace("      - run: npm run check:video-render-posted-persistence\n", ""),
  }), "hosted CI contract removal");
}

console.log(
  `VIDEO_RENDER_POSTED_PERSISTENCE_SOURCE_CONTRACT_PASS rpc=checked stableDiagnostic=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
