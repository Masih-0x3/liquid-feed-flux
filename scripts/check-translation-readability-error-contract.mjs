import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "supabase/functions/_shared/translationReadability.ts");
const testPath = join(repoRoot, "supabase/functions/_shared/translationReadability.test.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`TRANSLATION_READABILITY_ERROR_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} is missing`);
}

function assertTranspiles(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  if ((result.diagnostics ?? []).some(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  )) fail(`${path} has TypeScript diagnostics`);
}

function assertSource(source, label = "current source") {
  assertTranspiles(sourcePath, source);
  assertIncludes(
    source,
    "function readabilityProviderFailureCode(status: unknown): string",
    `${label} stable provider-code helper`,
  );
  assertIncludes(
    source,
    "repairError: readabilityProviderFailureCode(result.status),",
    `${label} failed-response code`,
  );
  assertIncludes(
    source,
    'repairError: "translation_readability_openai_request_failed",',
    `${label} thrown-request code`,
  );
  for (const rawPattern of [
    "result.rawText.slice",
    "(error as Error).message",
    "OpenAI ${result.status}",
  ]) {
    if (source.includes(rawPattern)) fail(`${label} forwards raw provider text via ${rawPattern}`);
  }
}

const source = readFileSync(sourcePath, "utf8");
const testSource = readFileSync(testPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const workflowSource = readFileSync(workflowPath, "utf8");

assertSource(source);
assertTranspiles(testPath, testSource);
assertIncludes(
  testSource,
  "repairTranslationReadability redacts thrown provider messages",
  "thrown-provider redaction regression fixture",
);
assertIncludes(
  testSource,
  'translation_readability_openai_http_429',
  "HTTP failure code regression fixture",
);
if (packageJson.scripts?.["check:translation-readability-error"] !==
    "node scripts/check-translation-readability-error-contract.mjs") {
  fail("package script is not registered");
}
if (!workflowSource.includes("npm run check:translation-readability-error")) {
  fail("hosted CI contract is missing");
}

function assertRejects(mutator, label) {
  try {
    assertSource(mutator(source), label);
  } catch (error) {
    if (String(error).includes("TRANSLATION_READABILITY_ERROR_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      "repairError: readabilityProviderFailureCode(result.status),",
      "repairError: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}` ,",
    ),
    "raw response-body mutant",
  );
  assertRejects(
    (value) => value.replace(
      'repairError: "translation_readability_openai_request_failed",',
      "repairError: (error as Error).message,",
    ),
    "raw thrown-error mutant",
  );
}

console.log(
  `TRANSLATION_READABILITY_ERROR_SOURCE_CONTRACT_PASS failedProviderText=redacted selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
