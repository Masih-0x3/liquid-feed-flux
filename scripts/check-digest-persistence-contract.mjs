import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/digest-compiler/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`DIGEST_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("digest compiler parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("digest compiler transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  if (!source.includes(
    'const { data: skippedPersisted, error: skippedError } = await sb.rpc("persist_skipped_digest", {',
  ) || !source.includes(
    'if (skippedError || skippedPersisted !== true) {',
  ) || !source.includes(
    'throw new Error("digest_persistence_failed:skipped");',
  )) {
    fail(`${label}: skipped digest checkpoint must be result-checked`);
  }
  if (!source.includes(
    'const { data: outputPersisted, error: outputError } = await sb.rpc("persist_digest_output", {',
  ) || !source.includes(
    'if (outputError || outputPersisted !== true) {',
  ) || !source.includes(
    'throw new Error("digest_checkpoint_failed:output");',
  )) {
    fail(`${label}: canonical digest output checkpoint must be result-checked`);
  }
  if (source.includes('status: "posted"') || source.includes("postedDigestError") ||
      (source.match(/sb\.from\("digests"\)\.insert\(\{/g) ?? []).length !== 0) {
    fail(`${label}: digest compiler must not persist a direct-posted or duplicate fallback output`);
  }
  if (!source.includes('throw new Error("digest_openai_request_failed");') ||
      !source.includes('digestOpenAiFailureCode(openaiResponse.status)') ||
      !source.includes('openaiResponse = sanitizeDigestOpenAiResponse(openaiResponse);') ||
      source.includes('openaiResponse.rawText.slice') ||
      source.includes('throw openaiError;')) {
    fail(`${label}: digest OpenAI failures must be stable and body-redacted`);
  }
  if (!source.includes('const safeError = new Error(digestErrorCode(err));') ||
      !source.includes('message: safeError.message,') ||
      !source.includes('await captureEdgeException(safeError,') ||
      source.includes('message: (err as Error).message') ||
      source.includes('error: (err as Error).message')) {
    fail(`${label}: digest outer error boundary must be sanitized`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:digest-persistence"] !==
    "node scripts/check-digest-persistence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:digest-persistence")) {
    fail(`${label}: hosted CI contract is missing`);
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
    if (String(error).includes("DIGEST_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (skippedError || skippedPersisted !== true) {\n        throw new Error("digest_persistence_failed:skipped");\n      }',
      'console.warn("skipped digest persistence failed");',
    ),
  }), "skipped digest persistence fail-open mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (outputError || outputPersisted !== true) {\n      throw new Error("digest_checkpoint_failed:output");\n    }',
      'console.warn("digest output persistence failed");',
    ),
  }), "canonical digest output persistence fail-open mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'throw new Error("digest_openai_request_failed");',
      'throw openaiError;',
    ),
  }), "digest OpenAI raw throw mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'openaiResponse = sanitizeDigestOpenAiResponse(openaiResponse);',
      'openaiResponse = openaiResponse;',
    ),
  }), "digest OpenAI raw response mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'const safeError = new Error(digestErrorCode(err));',
      'const safeError = err;',
    ),
  }), "digest outer raw error mutant");
}

console.log(
  `DIGEST_PERSISTENCE_SOURCE_CONTRACT_PASS directInserts=0 checkpointedOutputs=2 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
