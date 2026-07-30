import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/media-processor/cleanupOldMedia.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`MEDIA_CLEANUP_FINALIZATION_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("cleanup source parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("cleanup source transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  if (!source.includes("type SupabaseClient = CleanupSupabaseClient;") ||
      !source.includes("type CleanupSupabaseClient = {") ||
      source.includes("queryError.message") ||
      source.includes("renderQueryError.message") ||
      source.includes("deno-lint-ignore no-explicit-any")) {
    fail(`${label}: cleanup RPC boundary must avoid any and raw provider/database error text`);
  }
  if (!source.includes('throw new Error("old_media_query_failed");') ||
      !source.includes('throw new Error("expired_render_query_failed");')) {
    fail(`${label}: cleanup selection errors must use stable bounded codes`);
  }
  const rpcMarker = 'const { error: markExpiredError } = await supabase.rpc(\n        "mark_video_renders_expired",\n        { render_ids: ids },\n      );';
  if (!source.includes(rpcMarker)) {
    fail(`${label}: processed-render finalization RPC must be result-checked`);
  }
  if (!source.includes(
    'if (markExpiredError) {\n        failedCount += Math.max(paths.length, ids.length);\n        continue;\n      }',
  )) {
    fail(`${label}: processed-render finalization failure must not report deletion`);
  }
  if (!source.includes(
    'if (!Array.isArray(oldMedia)) {\n    throw new Error("old_media_result_invalid");\n  }',
  ) || !source.includes(
    'if (!Array.isArray(expiredRenders)) {\n    throw new Error("expired_render_result_invalid");\n  }',
  )) {
    fail(`${label}: cleanup selection RPC result shapes must fail closed`);
  }
  const finalizationIndex = source.indexOf("mark_video_renders_expired");
  if ((source.match(/mark_video_renders_expired/g) ?? []).length !== 1) {
    fail(`${label}: processed-render finalization must have one authoritative RPC`);
  }
  const countIndex = source.indexOf("deletedProcessedCount += paths.length;", finalizationIndex);
  if (finalizationIndex < 0 || countIndex < 0 || countIndex < finalizationIndex) {
    fail(`${label}: processed deletion count must follow DB finalization`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:media-cleanup-finalization"] !==
    "node scripts/check-media-cleanup-finalization-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:media-cleanup-finalization")) {
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
    if (String(error).includes("MEDIA_CLEANUP_FINALIZATION_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'const { error: markExpiredError } = await supabase.rpc(\n        "mark_video_renders_expired",\n        { render_ids: ids },\n      );',
      'await supabase.rpc("mark_video_renders_expired", { render_ids: ids });',
    ),
  }), "unchecked render finalization RPC mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (markExpiredError) {\n        failedCount += Math.max(paths.length, ids.length);\n        continue;\n      }',
      'if (false) { continue; }',
    ),
  }), "render finalization failure counted as success mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      '    deletedProcessedCount += paths.length;\n  }',
      '    deletedProcessedCount += paths.length;\n    await supabase.rpc("mark_video_renders_expired", { render_ids: ids });\n  }',
    ),
  }), "deletion count before finalization mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!Array.isArray(oldMedia)) {\n    throw new Error("old_media_result_invalid");\n  }',
      'if (false) { throw new Error("old_media_result_invalid"); }',
    ),
  }), "old-media selection shape mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!Array.isArray(expiredRenders)) {\n    throw new Error("expired_render_result_invalid");\n  }',
      'if (false) { throw new Error("expired_render_result_invalid"); }',
    ),
  }), "expired-render selection shape mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'throw new Error("old_media_query_failed");',
      'throw new Error(`Failed to query old media: ${queryError.message}`);',
    ),
  }), "raw old-media query error mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'type SupabaseClient = CleanupSupabaseClient;',
      'type SupabaseClient = any;',
    ),
  }), "cleanup any client boundary mutant");
}

console.log(
  `MEDIA_CLEANUP_FINALIZATION_SOURCE_CONTRACT_PASS renderFinalization=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
