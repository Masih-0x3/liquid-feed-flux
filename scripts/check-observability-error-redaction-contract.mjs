import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "supabase/functions/_shared/observability.ts");
const sentryPath = join(repoRoot, "supabase/functions/_shared/sentry.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`OBSERVABILITY_ERROR_REDACTION_SOURCE_CONTRACT_FAIL ${message}`);
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
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  if (diagnostics.length > 0) fail("observability source has TypeScript diagnostics");
}

function assertSentrySource(source, label = "current Sentry source") {
  assertIncludes(source, 'console.error("sentry_capture_failed");', `${label} stable capture failure`);
  for (const rawPattern of [
    "captureError instanceof Error ? captureError.message",
    "String(captureError)",
  ]) {
    if (source.includes(rawPattern)) fail(`${label} forwards raw capture failure text via ${rawPattern}`);
  }
}

function assertSource(source, label = "current source") {
  assertTranspiles(source);
  assertIncludes(source, "function safeObservabilityErrorCode(", `${label} stable-code helper`);
  assertIncludes(source, "function openAIObservabilityErrorCode(", `${label} OpenAI-code helper`);
  assertIncludes(source, "function providerObservabilityErrorCode(", `${label} provider-code helper`);
  assertIncludes(source, 'error: "observability_write_failed",', `${label} write-failure redaction`);
  assertIncludes(source, 'error: "observability_write_threw",', `${label} write-throw redaction`);
  assertIncludes(
    source,
    'safeObservabilityErrorCode(error, "workflow_failed")',
    `${label} workflow error redaction`,
  );
  assertIncludes(
    source,
    "openAIObservabilityErrorCode(call.response)",
    `${label} OpenAI ledger redaction`,
  );
  assertIncludes(
    source,
    "providerObservabilityErrorCode(call)",
    `${label} provider ledger redaction`,
  );

  for (const rawPattern of [
    "error: errorMessage(result.error)",
    "error: errorMessage(error)",
    "errorMessage(error).slice(0, 1000)",
    "errorMessage(call.response.raw?.error ?? call.response.rawText)",
    "error_message: call.error ? errorMessage(call.error).slice(0, 1000)",
  ]) {
    if (source.includes(rawPattern)) fail(`${label} contains raw telemetry sink ${rawPattern}`);
  }
}

const source = readFileSync(sourcePath, "utf8");
const sentrySource = readFileSync(sentryPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const workflowSource = readFileSync(workflowPath, "utf8");

assertSource(source);
assertSentrySource(sentrySource);
if (packageJson.scripts?.["check:observability-error-redaction"] !==
    "node scripts/check-observability-error-redaction-contract.mjs") {
  fail("package script is not registered");
}
assertIncludes(
  workflowSource,
  "npm run check:observability-error-redaction",
  "hosted CI contract",
);

function assertRejects(mutator, label) {
  try {
    assertSource(mutator(source), label);
  } catch (error) {
    if (String(error).includes("OBSERVABILITY_ERROR_REDACTION_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

function assertSentryRejects(mutator, label) {
  try {
    assertSentrySource(mutator(sentrySource), label);
  } catch (error) {
    if (String(error).includes("OBSERVABILITY_ERROR_REDACTION_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      'error: "observability_write_failed",',
      "error: errorMessage(result.error),",
    ),
    "raw observability write error mutant",
  );
  assertRejects(
    (value) => value.replace(
      'safeObservabilityErrorCode(error, "workflow_failed")',
      "errorMessage(error).slice(0, 1000)",
    ),
    "raw workflow error mutant",
  );
  assertRejects(
    (value) => value.replace(
      "openAIObservabilityErrorCode(call.response)",
      "errorMessage(call.response.raw?.error ?? call.response.rawText)",
    ),
    "raw OpenAI response mutant",
  );
  assertRejects(
    (value) => value.replace(
      "providerObservabilityErrorCode(call)",
      "errorMessage(call.error).slice(0, 1000)",
    ),
    "raw provider error mutant",
  );
  assertSentryRejects(
    (value) => value.replace(
      'console.error("sentry_capture_failed");',
      'console.error("sentry capture failed:", captureError instanceof Error ? captureError.message : String(captureError));',
    ),
    "raw Sentry capture failure mutant",
  );
}

console.log(
  `OBSERVABILITY_ERROR_REDACTION_SOURCE_CONTRACT_PASS ` +
    `sinks=4 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
