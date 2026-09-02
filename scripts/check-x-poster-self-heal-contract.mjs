import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/x-poster/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_POSTER_SELF_HEAL_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("x-poster parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("x-poster transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  const start = source.indexOf("// Fetch media rows");
  const end = source.indexOf("const renderGate =", start);
  if (start < 0 || end < 0) fail(`${label}: media self-heal section markers are missing`);
  const section = source.slice(start, end);
  for (const marker of [
    "x_poster_media_read_failed",
    "x_poster_pending_media_read_failed",
    "x_poster_download_heal_enqueue_failed",
    "x_poster_resolve_heal_enqueue_failed",
  ]) {
    if (!section.includes(marker)) fail(`${label}: missing self-heal enqueue guard ${marker}`);
  }
  const invalidVideoStart = source.indexOf("if (!renderGate.ready)");
  const invalidVideoEnd = source.indexOf("if (hasMediaFlag && sel.tier === 'text')", invalidVideoStart);
  const invalidVideo = source.slice(invalidVideoStart, invalidVideoEnd);
  for (const marker of ["x_poster_pending_video_read_failed", "x_poster_invalid_video_enqueue_failed"]) {
    if (!invalidVideo.includes(marker)) fail(`${label}: invalid-video self-heal guard is missing ${marker}`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-poster-self-heal"] !== "node scripts/check-x-poster-self-heal-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-poster-self-heal")) {
    fail(`${label}: hosted CI command is missing`);
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
    if (String(error).includes("X_POSTER_SELF_HEAL_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (healDownloadError) {\n          throw new Error('x_poster_download_heal_enqueue_failed');\n        }", "console.warn(\"download heal failed\");"),
  }), "download self-heal error check removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (healResolveError) {\n        throw new Error('x_poster_resolve_heal_enqueue_failed');\n      }", "console.warn(\"resolve heal failed\");"),
  }), "resolve self-heal error check removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (invalidVideoResolveError) {\n        throw new Error('x_poster_invalid_video_enqueue_failed');\n      }", "console.warn(\"invalid video heal failed\");"),
  }), "invalid-video self-heal error check removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (mediaRowsError) {\n    throw new Error('x_poster_media_read_failed');\n  }", "console.warn(\"media read failed\");"),
  }), "media-row read error check removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (pendingJobsError) {\n        throw new Error('x_poster_pending_media_read_failed');\n      }", "console.warn(\"pending media read failed\");"),
  }), "pending-media read error check removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (mediaJobsError) {\n        throw new Error('x_poster_pending_video_read_failed');\n      }", "console.warn(\"pending video read failed\");"),
  }), "pending-video read error check removal");
}

console.log(`X_POSTER_SELF_HEAL_SOURCE_CONTRACT_PASS enqueueGuards=3 falseRecoveryReceiptPrevented=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
