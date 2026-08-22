import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "supabase/functions/_shared/enrich.ts");
const testPath = join(repoRoot, "supabase/functions/_shared/enrich.test.ts");
const packagePath = join(repoRoot, "package.json");
const workflowPath = join(repoRoot, ".github/workflows/ci.yml");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function fail(message) {
  throw new Error(`ENRICHMENT_ERROR_REDACTION_SOURCE_CONTRACT_FAIL ${message}`);
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
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  if (diagnostics.length > 0) fail(`${path} has TypeScript diagnostics`);
}

function assertSource(source, label = "current source") {
  assertTranspiles(sourcePath, source);
  assertIncludes(
    source,
    "function enrichmentProviderFailureCode(",
    `${label} stable provider-code helper`,
  );
  assertIncludes(
    source,
    "function sanitizeEnrichmentOpenAIResponse(",
    `${label} failed-response sanitizer`,
  );
  assertIncludes(
    source,
    'const raw = { error: { message: "enrichment_openai_request_failed" } };',
    `${label} thrown OpenAI failure code`,
  );
  assertIncludes(
    source,
    "response = sanitizeEnrichmentOpenAIResponse(await callOpenAIImpl(params));",
    `${label} observed failed-response sanitization`,
  );

  for (const agent of ["voice_profile", "analyst", "humanizer", "composer"]) {
    assertIncludes(
      source,
      `enrichmentProviderFailureCode("${agent}", resp.status)`,
      `${label} ${agent} stable failure code`,
    );
  }
  assertIncludes(
    source,
    "resp = sanitizeEnrichmentOpenAIResponse(await callOpenAI({",
    `${label} direct voice-profile response sanitization`,
  );
  assertIncludes(
    source,
    'throw new Error("enrichment_voice_profile_request_failed");',
    `${label} direct voice-profile request catch`,
  );
  for (const agent of ["archivist", "researcher"]) {
    assertIncludes(
      source,
      `error: enrichmentProviderFailureCode('${agent}', resp.status),`,
      `${label} ${agent} stable warning code`,
    );
    assertIncludes(
      source,
      `error: 'enrichment_${agent}_request_failed',`,
      `${label} ${agent} catch warning code`,
    );
  }

  for (const rawPattern of [
    "resp.content?.slice",
    "(e as Error).message",
    "error instanceof Error ? error.message : String(error)",
  ]) {
    if (source.includes(rawPattern)) {
      fail(`${label} forwards raw provider/error text via ${rawPattern}`);
    }
  }
  if (source.includes("rawText: response.rawText") || source.includes("raw: response.raw")) {
    fail(`${label} failed-response sanitizer preserves raw provider body`);
  }
  if (source.includes('Archivist returned unknown referenced_post_id "${rawRefId}"')) {
    fail(`${label} logs raw provider reference output`);
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
  "observed enrichment OpenAI redacts failed provider bodies",
  "failed-provider redaction regression fixture",
);
if (packageJson.scripts?.["check:enrichment-error-redaction"] !==
    "node scripts/check-enrichment-error-redaction-contract.mjs") {
  fail("package script is not registered");
}
if (!workflowSource.includes("npm run check:enrichment-error-redaction")) {
  fail("hosted CI contract is missing");
}

function assertRejects(mutator, label) {
  try {
    assertSource(mutator(source), label);
  } catch (error) {
    if (String(error).includes("ENRICHMENT_ERROR_REDACTION_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      "response = sanitizeEnrichmentOpenAIResponse(await callOpenAIImpl(params));",
      "response = await callOpenAIImpl(params);",
    ),
    "failed-response sanitizer bypass mutant",
  );
  assertRejects(
    (value) => value.replace(
      'const raw = { error: { message: "enrichment_openai_request_failed" } };',
      "const raw = { error: { message: String(error) } };",
    ),
    "thrown raw error mutant",
  );
  assertRejects(
    (value) => value.replace(
      'throw new Error(enrichmentProviderFailureCode("composer", resp.status));',
      'throw new Error(`Composer agent failed: ${resp.content?.slice(0, 300)}`);',
    ),
    "composer raw provider body mutant",
  );
  assertRejects(
    (value) => value.replace(
      "resp = sanitizeEnrichmentOpenAIResponse(await callOpenAI({",
      "resp = await callOpenAI({",
    ),
    "direct voice-profile sanitizer bypass mutant",
  );
  assertRejects(
    (value) => value.replace(
      "error: enrichmentProviderFailureCode('researcher', resp.status),",
      "error: resp.content?.slice(0, 200),",
    ),
    "researcher raw warning mutant",
  );
  assertRejects(
    (value) => value.replace(
      "console.warn('enrichment_agent_invalid_reference', {",
      "console.warn(`Archivist returned unknown referenced_post_id \"${rawRefId}\"`, {",
    ),
    "archivist raw reference warning mutant",
  );
}

console.log(
  `ENRICHMENT_ERROR_REDACTION_SOURCE_CONTRACT_PASS agents=6 failedResponse=redacted selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
