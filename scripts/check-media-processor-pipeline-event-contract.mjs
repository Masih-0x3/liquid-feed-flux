import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const processorPath = path.join(repoRoot, "supabase/functions/media-processor/index.ts");

function fail(message) {
  throw new Error(`MEDIA_PROCESSOR_PIPELINE_EVENT_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract(source, label = "current source") {
  const sourceFile = ts.createSourceFile(
    processorPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail(`${label}: TypeScript parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: processorPath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: TypeScript transpilation diagnostics`);
  }
  const start = source.indexOf("async function insertMediaDownloadEvent(");
  const end = source.indexOf("async function markStaleMediaDownloadIgnored(", start);
  if (start < 0 || end < 0) fail(`${label}: media pipeline-event helper markers are missing`);
  const helper = source.slice(start, end);
  if (!helper.includes("const { error: pipelineEventError } = await supabase.from('pipeline_events').insert({")) {
    fail(`${label}: media pipeline-event insert must inspect returned errors`);
  }
  if (!helper.includes("if (pipelineEventError) {") ||
      !helper.includes("error: 'media_pipeline_event_insert_failed',")) {
    fail(`${label}: media pipeline-event failures must use a stable diagnostic`);
  }
  if ((helper.match(/media_pipeline_event_insert_failed/g) ?? []).length < 2) {
    fail(`${label}: returned and thrown media pipeline-event failures need stable diagnostics`);
  }
  if (helper.includes("catch (_e) { /* best-effort */ }") ||
      helper.includes("error: _e") || helper.includes("error: error")) {
    fail(`${label}: media pipeline-event failures must not be silently swallowed or raw`);
  }
  if (!/type MediaProcessorQueryResult = \{/.test(source)) {
    fail(`${label}: media processor query results need an explicit boundary`);
  }
  if (!/type MediaProcessorQueryBuilder = PromiseLike<MediaProcessorQueryResult> & \{/.test(source)) {
    fail(`${label}: media processor query builders need an explicit operation boundary`);
  }
  if (!/type MediaProcessorStorageBucket = \{/.test(source) ||
      !/type MediaProcessorSupabaseClient = \{/.test(source)) {
    fail(`${label}: media processor storage/client boundaries are missing`);
  }
  if ((source.match(/supabase: MediaProcessorSupabaseClient/g) ?? []).length !== 5) {
    fail(`${label}: all five media processor helpers must use the bounded client`);
  }
  if (/supabase: any/.test(source)) {
    fail(`${label}: media processor helpers must not retain any Supabase clients`);
  }
  if (/deno-lint-ignore no-explicit-any\s*\n\s*supabase: MediaProcessorSupabaseClient/.test(source)) {
    fail(`${label}: media processor client boundaries must not retain explicit-any suppressions`);
  }
}

const sourcePath = processorPath;
const source = fs.readFileSync(sourcePath, "utf8");
assertContract(source);

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(source), label);
  } catch (error) {
    if (String(error).includes("MEDIA_PROCESSOR_PIPELINE_EVENT_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

if (process.env.MUTATION_TEST === "1") {
  assertRejects(
    (value) => value.replace(
      "const { error: pipelineEventError } = await supabase.from('pipeline_events').insert({",
      "await supabase.from('pipeline_events').insert({",
    ),
    "result ignored",
  );
  assertRejects(
    (value) => value.replace("if (pipelineEventError) {", "if (false) {"),
    "failure guard removed",
  );
  assertRejects(
    (value) => value.replace("error: 'media_pipeline_event_insert_failed',", "error: _e,"),
    "raw diagnostic",
  );
  assertRejects(
    (value) => value.replace(
      "console.warn(JSON.stringify({\n      function: 'media-processor',\n      action: 'pipeline_event_insert_failed',\n      error: 'media_pipeline_event_insert_failed',\n    }));",
      "/* swallowed */",
    ),
    "catch diagnostic removed",
  );
  assertRejects(
    (value) => value.replace(
      "supabase: MediaProcessorSupabaseClient",
      "supabase: any",
    ),
    "any media client boundary",
  );
}

console.log(`MEDIA_PROCESSOR_PIPELINE_EVENT_SOURCE_CONTRACT_PASS selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
