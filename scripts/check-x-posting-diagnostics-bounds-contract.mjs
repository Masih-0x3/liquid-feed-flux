import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/xPostingActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_POSTING_DIAGNOSTICS_BOUNDS_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label}: TypeScript parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: TypeScript transpilation diagnostics`);
  }
  const start = source.indexOf("export async function getXPostingDiagnostics(");
  const end = source.indexOf("\nexport ", start + 10);
  if (start < 0) fail(`${label}: diagnostics function marker is missing`);
  const handler = source.slice(start, end < 0 ? source.length : end);
  for (const marker of [
    "const MAX_ACTIVE_JOBS_PER_DIAGNOSTIC = 50;",
    "const MAX_MEDIA_ROWS_PER_DIAGNOSTIC = 50;",
    ".limit(MAX_ACTIVE_JOBS_PER_DIAGNOSTIC),",
    ".limit(MAX_MEDIA_ROWS_PER_DIAGNOSTIC),",
  ]) {
    if (!handler.includes(marker)) fail(`${label}: missing bounded diagnostics marker ${marker}`);
  }
  const pkg = JSON.parse(packageJson);
  if (pkg.scripts?.["check:x-posting-diagnostics-bounds"] !==
      "node scripts/check-x-posting-diagnostics-bounds-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-posting-diagnostics-bounds")) {
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
    if (String(error).includes("X_POSTING_DIAGNOSTICS_BOUNDS_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(".limit(MAX_ACTIVE_JOBS_PER_DIAGNOSTIC),", ","),
  }), "unbounded active-job diagnostics read");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(".limit(MAX_MEDIA_ROWS_PER_DIAGNOSTIC),", ","),
  }), "unbounded media diagnostics read");
  assertRejects((source) => ({
    ...source,
    packageJson: source.packageJson.replace(
      '    "check:x-posting-diagnostics-bounds": "node scripts/check-x-posting-diagnostics-bounds-contract.mjs",\n',
      "",
    ),
  }), "package gate removal");
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace("      - run: npm run check:x-posting-diagnostics-bounds\n", ""),
  }), "hosted CI gate removal");
}

console.log(
  `X_POSTING_DIAGNOSTICS_BOUNDS_SOURCE_CONTRACT_PASS activeJobs=50 mediaRows=50 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
