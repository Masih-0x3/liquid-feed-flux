import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "supabase/functions/_shared/foglampOpenAI.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`FOGLAMP_OPENAI_ERROR_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} is missing`);
}

function assertTranspiles(source) {
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
  )) fail("Foglamp OpenAI source has TypeScript diagnostics");
}

function assertSource(source, label = "current source") {
  assertTranspiles(source);
  assertIncludes(source, 'const raw = { error: { message: code } };', `${label} bounded error response`);
  assertIncludes(source, '"foglamp_builtin_tools_unsupported"', `${label} unsupported-tools code`);
  assertIncludes(source, 'return errorResponse("foglamp_openai_request_failed", endpoint);', `${label} provider failure code`);
  if (source.includes("errorResponse((error as Error).message") ||
      source.includes("raw: { error: { message: (error as Error).message")) {
    fail(`${label} forwards raw provider error text`);
  }
}

const source = readFileSync(sourcePath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const workflowSource = readFileSync(workflowPath, "utf8");
assertSource(source);
if (packageJson.scripts?.["check:foglamp-openai-error"] !==
    "node scripts/check-foglamp-openai-error-contract.mjs") {
  fail("package script is not registered");
}
if (!workflowSource.includes("npm run check:foglamp-openai-error")) {
  fail("hosted CI contract is missing");
}

function assertRejects(mutator, label) {
  try {
    assertSource(mutator(source), label);
  } catch (error) {
    if (String(error).includes("FOGLAMP_OPENAI_ERROR_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      'return errorResponse("foglamp_openai_request_failed", endpoint);',
      "return errorResponse((error as Error).message, endpoint);",
    ),
    "raw provider catch mutant",
  );
  assertRejects(
    (value) => value.replace(
      '"foglamp_builtin_tools_unsupported"',
      '"Foglamp AI SDK adapter does not support built-in OpenAI tools"',
    ),
    "free-form unsupported-tools mutant",
  );
}

console.log(
  `FOGLAMP_OPENAI_ERROR_SOURCE_CONTRACT_PASS providerError=bounded selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
