import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const paths = {
  backend: path.join(root, "supabase/functions/admin-actions/monitoringReads.ts"),
  api: path.join(root, "src/api/monitoringData.ts"),
  page: path.join(root, "src/pages/Monitoring.tsx"),
  packageJson: path.join(root, "package.json"),
  ci: path.join(root, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`MONITORING_THRESHOLD_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(filePath, source) {
  const kind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
  if (file.parseDiagnostics.length > 0) fail(`${path.basename(filePath)} parse diagnostics`);
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${path.basename(filePath)} transpilation diagnostics`);
  }
}

function readSources() {
  return Object.fromEntries(Object.entries(paths).map(([key, filePath]) => [key, fs.readFileSync(filePath, "utf8")]));
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

function requireNoMatch(source, pattern, message) {
  if (pattern.test(source)) fail(message);
}

function assertContract(sources, label = "current source") {
  parse(paths.backend, sources.backend);
  parse(paths.api, sources.api);
  parse(paths.page, sources.page);
  requireMatch(sources.backend, /loadActiveThresholdEnvelope\(supabase\)/, `${label}: backend must use canonical active-threshold envelope resolver`);
  if (!sources.backend.includes("overview: {\n      window_hours: windowHours,\n      threshold,\n      threshold_mode: thresholdEnvelope.mode,")) fail(`${label}: overview must return the resolved threshold envelope`);
  requireMatch(sources.api, /export interface MonitoringOverview \{[\s\S]*?threshold: number;/, `${label}: MonitoringOverview must type the threshold`);
  requireMatch(sources.page, /const deliverThreshold = overview\?\.threshold \?\? 14;/, `${label}: Monitoring must consume the overview threshold`);
  requireNoMatch(sources.page, /active_profile_id|editorial_profiles/, `${label}: Monitoring must not read legacy threshold settings directly`);
  const packageData = JSON.parse(sources.packageJson);
  if (packageData.scripts?.["check:monitoring-threshold"] !== "node scripts/check-monitoring-threshold-contract.mjs") fail(`${label}: package script is missing`);
  requireMatch(sources.ci, /- run: npm run check:monitoring-threshold/, `${label}: CI command is missing`);
}

const sources = readSources();
assertContract(sources);
if (process.env.MUTATION_TEST === "1") {
  for (const [label, mutate] of [
    ["backend threshold omitted", (input) => ({ ...input, backend: input.backend.replace("overview: {\n      window_hours: windowHours,\n      threshold,\n      threshold_mode: thresholdEnvelope.mode,", "overview: {\n      window_hours: windowHours,\n      counts,") })],
    ["page threshold bypass", (input) => ({ ...input, page: input.page.replace("const deliverThreshold = overview?.threshold ?? 14;", "const deliverThreshold = 14;") })],
    ["legacy page read reintroduced", (input) => ({ ...input, page: input.page.replace("const deliverThreshold = overview?.threshold ?? 14;", "const deliverThreshold = overview?.threshold ?? 14; const active_profile_id = 'legacy';") })],
    ["CI command removed", (input) => ({ ...input, ci: input.ci.replace("      - run: npm run check:monitoring-threshold\n", "") })],
  ]) {
    assert.throws(() => assertContract(mutate(sources), label), /MONITORING_THRESHOLD_SOURCE_CONTRACT_FAIL/, `${label} mutant must fail`);
  }
}

console.log(`MONITORING_THRESHOLD_SOURCE_CONTRACT_PASS canonicalResolver=true overviewField=true legacyDirectRead=false selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
