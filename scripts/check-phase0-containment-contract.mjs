import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const noticePath = path.join(repoRoot, "docs/operations/phase0-containment-notice.md");
const runbookPath = path.join(repoRoot, "docs/operations/release-runbook.md");
const ledgerPath = path.join(repoRoot, "docs/plans/2026-07-14-xot-migration-equivalence-ledger.jsonl");
const entryPointTestPath = path.join(repoRoot, "supabase/functions/_shared/cleanupEntryPoints.test.ts");
const mediaCleanupHandlerPath = path.join(repoRoot, "supabase/functions/media-cleanup/handler.ts");
const dbCleanupHandlerPath = path.join(repoRoot, "supabase/functions/db-cleanup/handler.ts");
const safetyTestPath = path.join(repoRoot, "supabase/functions/_shared/cleanupSafety.test.ts");
const cleanupTestPath = path.join(repoRoot, "supabase/functions/_shared/legacyMediaCleanup.test.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`PHASE0_CONTAINMENT_SOURCE_CONTRACT_FAIL ${message}`);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label}: missing ${marker}`);
}

function assertContract({ notice, runbook, ledger, entryPoints, mediaCleanupHandler, dbCleanupHandler, safety, cleanup, packageJson, ci }, label = "current source") {
  assertContains(notice, [
    "Status: active safety hold",
    "invoke-db-cleanup-daily",
    "job `17`",
    "0 3 * * *",
    "active=false",
    "invoke-media-cleanup-6h",
    "job `19`",
    "0 */6 * * *",
    "cron.alter_job(job_id := <jobid>, active := true)",
    "Do not manually invoke non-dry",
    "DB_CLEANUP_MUTATIONS_ENABLED",
    "MEDIA_CLEANUP_MUTATIONS_ENABLED",
    "public.cleanup_old_data(integer, integer)",
    "Dry-run inventory is allowed",
    "Never set either flag to `true`",
    "body/effect ledger",
    "Owner: release/database/security operator",
  ], `${label} operator notice`);
  if (notice.split("active=false").length - 1 !== 2) fail(`${label} operator notice: both schedules must remain explicitly inactive`);
  assertContains(runbook, ["phase0-containment-notice.md", "Production cleanup is intentionally paused"], `${label} release runbook`);

  const records = ledger.trim().split("\n").map((line) => JSON.parse(line));
  const schema = records.find((record) => record.record_type === "schema" && record.task_id === "SR-MIG-01");
  if (!schema || schema.status !== "skeleton_active") fail(`${label}: migration ledger skeleton is missing or changed`);
  assertContains(JSON.stringify(schema), ["allowed_dispositions", "exact_equivalent", "unknown", "Never infer SQL equivalence from timestamp"], `${label} migration ledger rules`);

  assertContains(entryPoints, [
    "cleanup entrypoints reject before constructing a service client",
    "blocks malformed or absent mutation flags",
    "dry-run performs selection reads without storage or database mutation",
  ], `${label} characterization/fault entrypoint tests`);
  assertContains(mediaCleanupHandler, [
    'if (!data || typeof data !== "object" || Array.isArray(data))',
    'throw new Error("media_cleanup_invalid_response");',
    'type SupabaseClient = unknown;',
    'function checkedMediaCleanupClient(client: unknown): MediaCleanupClient {',
    'throw new Error("media_cleanup_client_invalid");',
  ], `${label} media-cleanup delegated response guard`);
  assertContains(dbCleanupHandler, [
    'const dbCleanupErrorCode = (error: unknown): string => {',
    'error: "db_cleanup_rpc_failed",',
    'const safeError = new Error(dbCleanupErrorCode(error));',
    'type SupabaseClient = unknown;',
    'function checkedCleanupClient(client: unknown): CleanupSupabaseClient {',
    'throw new Error("db_cleanup_client_invalid");',
  ], `${label} db-cleanup error redaction`);
  if (mediaCleanupHandler.includes('error: error.message') ||
      mediaCleanupHandler.includes('(error as Error).message')) {
    fail(`${label}: media-cleanup raw error text must not cross logs or Sentry`);
  }
  assertContains(safety, [
    "cleanup mutation flags fail closed unless exactly enabled",
    "cleanup execution mode keeps dry-run available while mutations are blocked",
  ], `${label} cleanup safety tests`);
  assertContains(cleanup, [
    "legacy cleanup is path-blind when an old row shares a fresh row's object",
    "legacy cleanup preserves database ownership when storage removal fails",
  ], `${label} cleanup fault tests`);

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:phase0-containment"] !== "node scripts/check-phase0-containment-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:phase0-containment")) fail(`${label}: hosted CI command is missing`);
}

function sources() {
  return {
    notice: read(noticePath),
    runbook: read(runbookPath),
    ledger: read(ledgerPath),
    entryPoints: read(entryPointTestPath),
    mediaCleanupHandler: read(mediaCleanupHandlerPath),
    dbCleanupHandler: read(dbCleanupHandlerPath),
    safety: read(safetyTestPath),
    cleanup: read(cleanupTestPath),
    packageJson: read(packagePath),
    ci: read(ciPath),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("PHASE0_CONTAINMENT_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [field, needle, label] of [
    ["notice", "active=false", "active schedule notice mutant"],
    ["notice", "Do not manually invoke non-dry", "privileged cleanup prohibition mutant"],
    ["notice", "Never set either flag to `true`", "mutation flag authorization mutant"],
    ["ledger", "skeleton_active", "migration skeleton status mutant"],
    ["cleanup", "legacy cleanup preserves database ownership when storage removal fails", "storage fault characterization mutant"],
  ]) assertRejects((source) => ({ ...source, [field]: source[field].replaceAll(needle, "removed") }), label);
  assertRejects((source) => ({
    ...source,
    mediaCleanupHandler: source.mediaCleanupHandler.replace(
      'if (!data || typeof data !== "object" || Array.isArray(data))',
      'if (false)',
    ),
  }), "media-cleanup malformed delegated response mutant");
  assertRejects((source) => ({
    ...source,
    mediaCleanupHandler: source.mediaCleanupHandler.replace(
      'error: "media_cleanup_invoke_failed",',
      'error: error.message,',
    ),
  }), "media-cleanup raw error mutant");
  assertRejects((source) => ({
    ...source,
    dbCleanupHandler: source.dbCleanupHandler.replace(
      'error: "db_cleanup_rpc_failed",',
      'error: error.message,',
    ),
  }), "db-cleanup raw error mutant");
  assertRejects((source) => ({
    ...source,
    mediaCleanupHandler: source.mediaCleanupHandler.replace(
      'type SupabaseClient = unknown;',
      'type SupabaseClient = any;',
    ),
  }), "media-cleanup any client boundary mutant");
  assertRejects((source) => ({
    ...source,
    mediaCleanupHandler: source.mediaCleanupHandler.replaceAll(
      'throw new Error("media_cleanup_client_invalid");',
      'return client as MediaCleanupClient;',
    ),
  }), "media-cleanup client guard removal mutant");
  assertRejects((source) => ({
    ...source,
    dbCleanupHandler: source.dbCleanupHandler.replace(
      'type SupabaseClient = unknown;',
      'type SupabaseClient = any;',
    ),
  }), "db-cleanup any client boundary mutant");
  assertRejects((source) => ({
    ...source,
    dbCleanupHandler: source.dbCleanupHandler.replaceAll(
      'throw new Error("db_cleanup_client_invalid");',
      'return client as CleanupSupabaseClient;',
    ),
  }), "db-cleanup client guard removal mutant");
}

console.log(`PHASE0_CONTAINMENT_SOURCE_CONTRACT_PASS pauseNotice=true migrationSkeleton=true faultEvidence=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
