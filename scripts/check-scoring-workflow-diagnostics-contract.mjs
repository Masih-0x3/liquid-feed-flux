import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "supabase/functions/worker/scoringWorkflow.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`SCORING_WORKFLOW_DIAGNOSTICS_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertSource(source, label = "current source") {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  if ((result.diagnostics ?? []).some(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  )) fail(`${label} has TypeScript diagnostics`);
  if (!source.includes('console.warn("scoring_classifier_schema_invalid");')) {
    fail(`${label} stable classifier-schema diagnostic is missing`);
  }
  for (const rawPattern of [
    '(e as Error).message',
    'Invalid classifier_tool_schema, using fallback:',
  ]) {
    if (source.includes(rawPattern)) fail(`${label} forwards parser text via ${rawPattern}`);
  }
}

const source = readFileSync(sourcePath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const workflowSource = readFileSync(workflowPath, "utf8");
assertSource(source);
if (packageJson.scripts?.["check:scoring-workflow-diagnostics"] !==
    "node scripts/check-scoring-workflow-diagnostics-contract.mjs") {
  fail("package script is not registered");
}
if (!workflowSource.includes("npm run check:scoring-workflow-diagnostics")) {
  fail("hosted CI contract is missing");
}

function assertRejects(mutator, label) {
  try {
    assertSource(mutator(source), label);
  } catch (error) {
    if (String(error).includes("SCORING_WORKFLOW_DIAGNOSTICS_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      'console.warn("scoring_classifier_schema_invalid");',
      'console.warn("Invalid classifier_tool_schema, using fallback:", (e as Error).message);',
    ),
    "raw classifier-schema parser warning mutant",
  );
}

console.log(
  `SCORING_WORKFLOW_DIAGNOSTICS_SOURCE_CONTRACT_PASS schemaWarning=bounded selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
