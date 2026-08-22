import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const typescript = require("typescript");

const HOTSPOT_FILES = [
  "supabase/functions/worker/index.ts",
  "supabase/functions/x-poster/index.ts",
  "supabase/functions/admin-actions/index.ts",
  "supabase/functions/admin-actions/monitoringReads.ts",
  "services/video-renderer/src/renderer.js",
  "services/video-renderer/src/preflight.js",
  "supabase/functions/admin-actions/dashboardSummaries.ts",
  "supabase/functions/_shared/enrich.ts",
  "supabase/functions/_shared/dedupe.ts",
  "src/pages/Dashboard.tsx",
  "src/pages/Monitoring.tsx",
];

const REVIEWED_HOTSPOT_MANIFEST = [
  "supabase/functions/worker/index.ts",
  "supabase/functions/x-poster/index.ts",
  "supabase/functions/admin-actions/index.ts",
  "supabase/functions/admin-actions/monitoringReads.ts",
  "services/video-renderer/src/renderer.js",
  "services/video-renderer/src/preflight.js",
  "supabase/functions/admin-actions/dashboardSummaries.ts",
  "supabase/functions/_shared/enrich.ts",
  "supabase/functions/_shared/dedupe.ts",
  "src/pages/Dashboard.tsx",
  "src/pages/Monitoring.tsx",
];

const REVIEW_THRESHOLDS = {
  bytes: 100_000,
  lines: 2_500,
  functions: 60,
};

function characterize(path, source) {
  const scriptKind = path.endsWith(".tsx")
    ? typescript.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? typescript.ScriptKind.JSX
      : path.endsWith(".js")
        ? typescript.ScriptKind.JS
        : typescript.ScriptKind.TS;
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let topLevelStatements = 0;
  let functionDeclarations = 0;
  let exportedDeclarations = 0;
  let imports = 0;
  for (const statement of sourceFile.statements) {
    topLevelStatements += 1;
    if (typescript.isImportDeclaration(statement)) imports += 1;
    if (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) {
      functionDeclarations += 1;
    }
    if (statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword)) {
      exportedDeclarations += 1;
    }
  }
  return {
    path,
    bytes: Buffer.byteLength(source),
    lines: source.split(/\n/).length,
    topLevelStatements,
    functionDeclarations,
    exportedDeclarations,
    imports,
    parseDiagnostics: sourceFile.parseDiagnostics.length,
  };
}

function collect(root = process.cwd()) {
  return HOTSPOT_FILES.map((relativePath) => {
    const path = `${root}/${relativePath}`;
    const source = readFileSync(path, "utf8");
    const result = characterize(relativePath, source);
    assert.equal(result.parseDiagnostics, 0, `${relativePath} must parse without diagnostics`);
    return result;
  });
}

function assertHotspotManifest(files) {
  assert.deepEqual(
    [...files].sort(),
    [...REVIEWED_HOTSPOT_MANIFEST].sort(),
    "hotspot inventory must match the reviewed manifest",
  );
}

assertHotspotManifest(HOTSPOT_FILES);
const inventory = collect();
const reviewSignals = inventory
  .filter((entry) =>
    entry.bytes >= REVIEW_THRESHOLDS.bytes
    || entry.lines >= REVIEW_THRESHOLDS.lines
    || entry.functionDeclarations >= REVIEW_THRESHOLDS.functions,
  )
  .map((entry) => entry.path);

if (process.env.MUTATION_TEST === "1") {
  assert.throws(
    () => assertHotspotManifest(HOTSPOT_FILES.slice(1)),
    /hotspot inventory must match the reviewed manifest/,
    "hotspot omission mutation must fail the manifest gate",
  );
  assert.throws(
    () => {
      const result = characterize(HOTSPOT_FILES[0], "function (");
      assert.equal(result.parseDiagnostics, 0, "malformed source mutation was accepted");
    },
    "malformed source must fail characterization",
  );
}

console.log(`MODULE_CHARACTERIZATION_SOURCE_CONTRACT_PASS files=${inventory.length} reviewSignals=${reviewSignals.length} mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
for (const path of reviewSignals) console.log(`MODULE_CHARACTERIZATION_REVIEW_SIGNAL ${path}`);
