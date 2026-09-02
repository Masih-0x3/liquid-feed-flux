import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/_shared/staleMediaRepair.ts");

function fail(message) {
  throw new Error(`STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("stale media repair parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("stale media repair transpilation diagnostics");
  }
}

function assertContract(source, label = "current source") {
  parseSource(source);
  if (!source.includes("type StaleMediaRepairQueryResult = {")) {
    fail(`${label}: stale-media query results need an explicit boundary`);
  }
  if (!source.includes("type StaleMediaRepairQueryBuilder = PromiseLike<StaleMediaRepairQueryResult> & {")) {
    fail(`${label}: stale-media query builders need an explicit operation boundary`);
  }
  if (!source.includes("type StaleMediaRepairSupabaseClient = {")) {
    fail(`${label}: stale-media Supabase client needs an explicit boundary`);
  }
  if ((source.match(/supabase: StaleMediaRepairSupabaseClient/g) ?? []).length !== 1) {
    fail(`${label}: repair helper must use the bounded Supabase client`);
  }
  if (source.includes("supabase: any")) {
    fail(`${label}: repair helper must not retain an any Supabase client`);
  }
  if (!source.includes("export function staleMediaRepairIdempotencyKey(")) {
    fail(`${label}: deterministic key helper is missing`);
  }
  if (!source.includes("return `download_media:stale_storage:${tweetId}:${mediaId ?? storagePath}`;")) {
    fail(`${label}: key is not derived from stable repair identity`);
  }
  if (!source.includes("idempotency_key: staleMediaRepairIdempotencyKey(")) {
    fail(`${label}: repair insert does not use deterministic key helper`);
  }
  if (source.includes("idempotency_key:\n        `download_media:stale_storage:${params.tweetId}:${params.mediaId ?? params.storagePath}:${Date.now()}`")) {
    fail(`${label}: repair key still contains wall-clock entropy`);
  }
  const enqueuePosition = source.indexOf('await supabase.from("jobs").insert({');
  const clearPosition = source.indexOf("  if (params.mediaId) {");
  if (enqueuePosition < 0 || clearPosition < 0 || enqueuePosition > clearPosition) {
    fail(`${label}: media pointer can clear before repair enqueue succeeds`);
  }
  if (!source.includes("if (pendingRepairError) {")) {
    fail(`${label}: pending-repair lookup does not fail closed on database error`);
  }
  if (source.includes("catch (_e) {\n    hasPendingRepair = false;\n  }")) {
    fail(`${label}: pending-repair lookup swallows database errors`);
  }
  for (const code of [
    "stale_media_pending_check_failed",
    "stale_media_download_enqueue_failed",
    "stale_media_clear_failed",
  ]) {
    if (!source.includes(`throw new Error(\"${code}\");`)) {
      fail(`${label}: missing stable ${code}`);
    }
  }
  if (source.includes("pendingRepairError.message") ||
      source.includes("error.message ?? \"unknown error\"")) {
    fail(`${label}: stale-media repair must not expose database exception text`);
  }
  if (!source.includes("const { error: pipelineEventError } = await supabase.from(\"pipeline_events\").insert({") ||
      !source.includes("if (pipelineEventError) {") ||
      (source.match(/stale_media_pipeline_event_insert_failed/g) ?? []).length < 2) {
    fail(`${label}: stale-media pipeline-event failures need checked stable diagnostics`);
  }
  if (source.includes("catch (_e) {\n  }")) {
    fail(`${label}: stale-media pipeline-event failures must not be silently swallowed`);
  }
  return { deterministicKeyHelper: 1, dateEntropy: false, enqueueBeforeClear: true, pendingCheckFailClosed: true };
}

const source = fs.readFileSync(sourcePath, "utf8");
const result = assertContract(source);

if (process.env.MUTATION_TEST === "1") {
  const mutant = source.replace(
    "idempotency_key: staleMediaRepairIdempotencyKey(",
    "idempotency_key: `${staleMediaRepairIdempotencyKey(",
  ).replace(
    "        params.storagePath,\n      ),",
    "        params.storagePath,\n      )}:${Date.now()}`",
  );
  let rejected = false;
  try {
    assertContract(mutant, "wall-clock-idempotency mutant");
  } catch (error) {
    rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("wall-clock-idempotency mutant was not rejected");

  const orderMutant = source.replace(
    "  const hasPendingRepair = Array.isArray(pendingRepairs) && pendingRepairs.length > 0;",
    "  if (params.mediaId) {\n    // premature clear\n  }\n\n  let hasPendingRepair = false;",
  );
  rejected = false;
  try {
    assertContract(orderMutant, "premature-clear mutant");
  } catch (error) {
    rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("premature-clear mutant was not rejected");

  const pendingLookupMutant = source.replace(
    "  if (pendingRepairError) {",
    "  if (false) {",
  );
  rejected = false;
  try {
    assertContract(pendingLookupMutant, "pending-check-swallow mutant");
  } catch (error) {
    rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("pending-check-swallow mutant was not rejected");

  for (const [stable, raw] of [
    ["stale_media_pending_check_failed", "stale media repair pending check failed: permission denied"],
    ["stale_media_download_enqueue_failed", "stale media download enqueue failed: duplicate key"],
    ["stale_media_clear_failed", "stale media clear failed: permission denied"],
  ]) {
    const rawMutant = source.replace(
      `throw new Error(\"${stable}\");`,
      `throw new Error(\"${raw}\");`,
    );
    rejected = false;
    try {
      assertContract(rawMutant, `${stable} raw error mutant`);
    } catch (error) {
      rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(`${stable} raw error mutant was not rejected`);
  }
  for (const [needle, replacement, label] of [
    [
      "const { error: pipelineEventError } = await supabase.from(\"pipeline_events\").insert({",
      "await supabase.from(\"pipeline_events\").insert({",
      "stale-media pipeline-event result ignored",
    ],
    ["if (pipelineEventError) {", "if (false) {", "stale-media pipeline-event guard removed"],
    ["error: \"stale_media_pipeline_event_insert_failed\",", "error: _e,", "stale-media pipeline-event raw error"],
  ]) {
    const mutation = source.replace(needle, replacement);
    rejected = false;
    try {
      assertContract(mutation, label);
    } catch (error) {
      rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
    }
    if (!rejected) fail(`${label} was not rejected`);
  }

  const anyClientMutant = source.replace(
    "supabase: StaleMediaRepairSupabaseClient",
    "supabase: any",
  );
  rejected = false;
  try {
    assertContract(anyClientMutant, "any stale-media client mutant");
  } catch (error) {
    rejected = String(error).includes("STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_FAIL");
  }
  if (!rejected) fail("any stale-media client mutant was not rejected");
}

console.log(
  `STALE_MEDIA_REPAIR_IDEMPOTENCY_SOURCE_CONTRACT_PASS deterministicKeyHelper=${result.deterministicKeyHelper} dateEntropy=${result.dateEntropy} enqueueBeforeClear=${result.enqueueBeforeClear} pendingCheckFailClosed=${result.pendingCheckFailClosed} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
