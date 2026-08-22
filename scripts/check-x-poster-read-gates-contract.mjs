import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/x-poster/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_POSTER_READ_GATES_SOURCE_CONTRACT_FAIL ${message}`);
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
  for (const marker of [
    "x_poster_existing_delivery_read_failed",
    "x_poster_manual_intake_read_failed",
    "x_poster_latest_delivery_read_failed",
    "delivery_lookup_failed",
    "media_lookup_failed",
  ]) {
    if (!source.includes(marker)) fail(`${label}: missing fail-closed read gate ${marker}`);
  }
  if (source.includes("console.warn('[x-poster] active manual intake filter failed'")) {
    fail(`${label}: active manual-intake read failure still permits auto delivery`);
  }
  const requiredShapeGuards = [
    "if (!Array.isArray(existingRows))",
    "if (!Array.isArray(rpcRes.data))",
    "if (!Array.isArray(fallbackRes.data) && !fallbackRes.error)",
    "if (!Array.isArray(forceRes.data) && !forceRes.error)",
    "if (!Array.isArray(manualRows))",
    "if (!Array.isArray(mediaRows))",
    "if (!Array.isArray(pendingJobs))",
    "if (!Array.isArray(renderRows))",
  ];
  for (const marker of requiredShapeGuards) {
    if (!source.includes(marker)) fail(`${label}: missing fail-closed result-shape guard ${marker}`);
  }
  if (source.includes("const rawMediaRows = ((mediaRows as XMediaRow[] | null) ?? [])") ||
    source.includes("let mediaRowsForSelection = ((mediaRows as XMediaRow[] | null) ?? [])")) {
    fail(`${label}: media reads still normalize unknown data to an empty selection`);
  }
  if (!source.includes("const { data, error } = await sb.from('settings').select('value').eq('key', 'video_render_config').maybeSingle();") ||
      !source.includes("if (error) {\n    throw new Error('video_render_config_read_failed');") ||
      !source.includes("if (data !== null && (typeof data !== 'object' || Array.isArray(data)))") ||
      !source.includes("async function loadVideoRenderRetentionHours(sb: any)") ||
      !source.includes("const cfg = await loadVideoRenderConfig(sb);")) {
    fail(`${label}: render configuration must fail closed before provider admission and isolate post-provider retention reads`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-poster-read-gates"] !== "node scripts/check-x-poster-read-gates-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-poster-read-gates")) {
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
    if (String(error).includes("X_POSTER_READ_GATES_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  for (const [needle, replacement, label] of [
    ["throw new Error('x_poster_existing_delivery_read_failed');", "console.warn(\"existing read failed\");", "existing-delivery read continuation"],
    ["throw new Error('x_poster_manual_intake_read_failed');", "console.warn(\"manual read failed\");", "manual-intake read continuation"],
    ["throw new Error('x_poster_latest_delivery_read_failed');", "console.warn(\"latest read failed\");", "latest-delivery read continuation"],
    ["reason: 'delivery_lookup_failed',", "reason: 'delivery_lookup_ignored',", "manual delivery read continuation"],
    ["reason: 'media_lookup_failed',", "reason: 'media_lookup_ignored',", "manual media read continuation"],
  ]) {
    assertRejects((source) => ({ source: source.source.replace(needle, replacement), packageJson: source.packageJson, ci: source.ci }), label);
  }
  for (const [needle, label] of [
    ["if (!Array.isArray(existingRows))", "existing-delivery malformed result"],
    ["if (!Array.isArray(rpcRes.data))", "candidate RPC malformed result"],
    ["if (!Array.isArray(fallbackRes.data) && !fallbackRes.error)", "candidate fallback malformed result"],
    ["if (!Array.isArray(forceRes.data) && !forceRes.error)", "forced candidate malformed result"],
    ["if (!Array.isArray(manualRows))", "manual-intake malformed result"],
    ["if (!Array.isArray(mediaRows))", "media malformed result"],
    ["if (!Array.isArray(pendingJobs))", "pending-media malformed result"],
    ["if (!Array.isArray(renderRows))", "render decision malformed result"],
  ]) {
    assertRejects((source) => ({
      source: source.source.replaceAll(needle, "if (false)"),
      packageJson: source.packageJson,
      ci: source.ci,
    }), `${label} guard removal`);
  }
  assertRejects((source) => ({
    source: source.source.replace(
      "if (error) {\n    throw new Error('video_render_config_read_failed');",
      "if (false) {\n    throw new Error('video_render_config_read_failed');",
    ),
    packageJson: source.packageJson,
    ci: source.ci,
  }), "render-config read error continuation");
  assertRejects((source) => ({
    source: source.source.replace(
      "if (!Array.isArray(renderRows)) throw new Error('x_poster_video_render_result_invalid');",
      "if (false) throw new Error('x_poster_video_render_result_invalid');",
    ),
    packageJson: source.packageJson,
    ci: source.ci,
  }), "render decision malformed result continuation");
}

console.log(`X_POSTER_READ_GATES_SOURCE_CONTRACT_PASS candidateAndManualReadsFailClosed=true providerWorkBlockedOnReadErrors=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
