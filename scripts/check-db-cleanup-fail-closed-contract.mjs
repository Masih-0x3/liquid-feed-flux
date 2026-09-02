import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/db-cleanup/handler.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`DB_CLEANUP_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("db-cleanup handler parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("db-cleanup handler transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  if (!source.includes(
    'const dryRunReadError = pipelineEvents.error ?? jobs.error;',
  ) || !source.includes(
    'throw new Error("db_cleanup_dry_run_read_failed");',
  )) {
    fail(`${label}: dry-run count read errors must fail closed`);
  }
  if (!source.includes(
    'if (!Number.isFinite(pipelineEvents.count) || !Number.isFinite(jobs.count))',
  ) || !source.includes('throw new Error("db_cleanup_dry_run_count_invalid");')) {
    fail(`${label}: dry-run count shape must fail closed`);
  }
  if (!source.includes(
    'throw new Error("db_cleanup_media_failed");',
  ) || !source.includes('throw new Error("media_cleanup_invalid_response");')) {
    fail(`${label}: delegated media cleanup failure must not be reported as success`);
  }
  if (!source.includes('const dbCleanupErrorCode = (error: unknown): string => {') ||
      !source.includes('const safeError = new Error(dbCleanupErrorCode(error));') ||
      source.includes('dryRunReadError.message') ||
      source.includes('mediaError.message') ||
      source.includes('error: error.message,') ||
      source.includes('(error as Error).message')) {
    fail(`${label}: cleanup error boundaries must use stable redacted codes`);
  }
  if (!source.includes(
    'if (!data || typeof data !== "object" || Array.isArray(data))',
  ) || !source.includes('throw new Error("cleanup_old_data_invalid_response");')) {
    fail(`${label}: primary cleanup RPC response shape must fail closed`);
  }
  if (!source.includes('type SupabaseClient = unknown;') ||
      !source.includes('function checkedCleanupClient(client: unknown): CleanupSupabaseClient {') ||
      !source.includes('throw new Error("db_cleanup_client_invalid");')) {
    fail(`${label}: cleanup client boundary must be unknown-backed and fail closed`);
  }
  const delegatedMediaCatch = source.slice(
    source.indexOf('} catch (error) {', source.indexOf('let mediaResult = null;')),
    source.indexOf('\n      return new Response(', source.indexOf('let mediaResult = null;')),
  );
  if (!delegatedMediaCatch.includes('throw new Error(dbCleanupErrorCode(error));')) {
    fail(`${label}: delegated media cleanup catch must rethrow a stable error instead of returning success`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:db-cleanup-fail-closed"] !==
    "node scripts/check-db-cleanup-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:db-cleanup-fail-closed")) {
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
    if (String(error).includes("DB_CLEANUP_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'const dryRunReadError = pipelineEvents.error ?? jobs.error;',
      'const dryRunReadError = null;',
    ),
  }), "dry-run read error ignored mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!Number.isFinite(pipelineEvents.count) || !Number.isFinite(jobs.count))',
      'if (false)',
    ),
  }), "dry-run count shape ignored mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'throw new Error("db_cleanup_media_failed");',
      'console.warn("media cleanup failed");',
    ),
  }), "delegated media error success mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'throw new Error("media_cleanup_invalid_response");',
      'mediaResult = null;',
    ),
  }), "delegated media malformed response mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      '        throw new Error(dbCleanupErrorCode(error));\n      }\n\n      return new Response(',
      '        console.warn("media invoke failure swallowed");\n      }\n\n      return new Response(',
    ),
  }), "delegated media catch swallow mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'if (!data || typeof data !== "object" || Array.isArray(data))',
      'if (false)',
    ),
  }), "primary cleanup RPC malformed response mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'error: "db_cleanup_rpc_failed",',
      'error: error.message,',
    ),
  }), "primary cleanup raw RPC error mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'const safeError = new Error(dbCleanupErrorCode(error));',
      'const safeError = error;',
    ),
  }), "cleanup outer raw error mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      'type SupabaseClient = unknown;',
      'type SupabaseClient = any;',
    ),
  }), "cleanup any client boundary mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replaceAll(
      'throw new Error("db_cleanup_client_invalid");',
      'return client as CleanupSupabaseClient;',
    ),
  }), "cleanup client guard removal mutant");
}

console.log(
  `DB_CLEANUP_FAIL_CLOSED_SOURCE_CONTRACT_PASS dryRunReads=checked delegatedMedia=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
