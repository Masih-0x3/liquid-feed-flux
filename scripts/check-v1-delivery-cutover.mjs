import { readdir, readFile } from "node:fs/promises";

const migrationPath = new URL(
  "../supabase/migrations/20260825091418_v1_delivery_continuity_cutover.sql",
  import.meta.url,
);
const sql = await readFile(migrationPath, "utf8");
const settleReasonMigration = await readFile(
  new URL("../supabase/migrations/20260825104845_v1_delivery_cutover_settle_reason_prefix.sql", import.meta.url),
  "utf8",
);
const effectiveRepairMigration = await readFile(
  new URL("../supabase/migrations/20260827064509_repair_effective_claim_fence_and_delivery_cutover.sql", import.meta.url),
  "utf8",
);
const zeroWriteMigrationName = "20260830120000_enforce_historical_delivery_zero_write.sql";
const zeroWriteMigration = await readFile(
  new URL(`../supabase/migrations/${zeroWriteMigrationName}`, import.meta.url),
  "utf8",
);
const b3GenerationMigration = await readFile(
  new URL("../supabase/migrations/20260806143000_b3_job_x_claim_fencing.sql", import.meta.url),
  "utf8",
);
const effectiveXClaimMigrationName = "20260828120000_repair_effective_x_claim_cutover.sql";
const effectiveXClaimMigration = await readFile(
  new URL(`../supabase/migrations/${effectiveXClaimMigrationName}`, import.meta.url),
  "utf8",
);
const effectiveXCleanupMigrationName = "20260828130000_retire_legacy_x_delivery_overloads.sql";
const effectiveXCleanupMigration = await readFile(
  new URL(`../supabase/migrations/${effectiveXCleanupMigrationName}`, import.meta.url),
  "utf8",
);
const migrationNames = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
const migrationSources = await Promise.all(
  migrationNames.map(async (name) => [name, await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")]),
);
const adminRetry = await readFile(
  new URL("../supabase/functions/admin-retry/index.ts", import.meta.url),
  "utf8",
);
const digestCompiler = await readFile(
  new URL("../supabase/functions/digest-compiler/index.ts", import.meta.url),
  "utf8",
);
const basicActions = await readFile(
  new URL("../supabase/functions/admin-actions/basicActions.ts", import.meta.url),
  "utf8",
);
const manualAdvance = await readFile(
  new URL("../supabase/functions/admin-actions/manualAdvanceActions.ts", import.meta.url),
  "utf8",
);
const monitoringMutations = await readFile(
  new URL("../supabase/functions/admin-actions/monitoringMutations.ts", import.meta.url),
  "utf8",
);
const maintenanceActions = await readFile(
  new URL("../supabase/functions/admin-actions/maintenanceActions.ts", import.meta.url),
  "utf8",
);
const dedupeActions = await readFile(
  new URL("../supabase/functions/admin-actions/dedupeActions.ts", import.meta.url),
  "utf8",
);
const xApiActions = await readFile(
  new URL("../supabase/functions/admin-actions/xApiActions.ts", import.meta.url),
  "utf8",
);
const xPostingActions = await readFile(
  new URL("../supabase/functions/admin-actions/xPostingActions.ts", import.meta.url),
  "utf8",
);
const manualVideoIntakeActions = await readFile(
  new URL("../supabase/functions/admin-actions/manualVideoIntakeActions.ts", import.meta.url),
  "utf8",
);
const xPoster = await readFile(
  new URL("../supabase/functions/x-poster/index.ts", import.meta.url),
  "utf8",
);
const worker = await readFile(
  new URL("../supabase/functions/worker/index.ts", import.meta.url),
  "utf8",
);
const telegramDelivery = await readFile(
  new URL("../supabase/functions/worker/telegramDelivery.ts", import.meta.url),
  "utf8",
);
const adminActionsIndex = await readFile(
  new URL("../supabase/functions/admin-actions/index.ts", import.meta.url),
  "utf8",
);

function functionBody(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing function marker: ${marker}`);
  const remainder = source.slice(start + marker.length);
  const next = remainder.search(/\n(?:export\s+)?(?:async\s+)?function\s+/);
  return next < 0
    ? source.slice(start)
    : source.slice(start, start + marker.length + next);
}

function assertGuardBeforeMutation(name, source, guard, mutation, marker) {
  const scoped = marker ? functionBody(source, marker) : source;
  const guardAt = scoped.indexOf(guard);
  const mutationAt = scoped.indexOf(mutation);
  if (guardAt < 0 || mutationAt < 0 || guardAt > mutationAt) {
    throw new Error(`${name} does not prove guard-before-mutation ordering`);
  }
}

function assertFunctionContains(name, source, marker, requiredMarker) {
  const scoped = functionBody(source, marker);
  if (!scoped.includes(requiredMarker)) {
    throw new Error(`${name} lacks ${requiredMarker}`);
  }
}

function assertGuardBeforeEveryFetch(name, source, marker, guard) {
  const scoped = functionBody(source, marker);
  let cursor = 0;
  let fetchAt = scoped.indexOf("fetch(", cursor);
  while (fetchAt >= 0) {
    if (scoped.lastIndexOf(guard, fetchAt) < 0) {
      throw new Error(`${name} has a provider fetch without its last-mile guard`);
    }
    cursor = fetchAt + "fetch(".length;
    fetchAt = scoped.indexOf("fetch(", cursor);
  }
}

const required = [
  ["separate singleton", "CREATE TABLE IF NOT EXISTS public.delivery_cutover"],
  ["immutable cutoff trigger", "trg_delivery_cutover_immutable"],
  ["one-time DB clock initialization", "clock_timestamp()"],
  ["strict post-T admission", "p.created_at > v_cutover"],
  ["ambiguous lineage fail-closed", "missing_or_historical_lineage"],
  ["transactional job claim guard", "delivery_cutover_allows_job"],
  ["X start floor binding", "x_start_posting_from_mismatch"],
  ["historical row protection", "historical_telegram_mutation"],
  ["historical X protection", "historical_x_mutation"],
  ["retry RPC protection", "PERFORM public.assert_delivery_cutover_post(tweet_id)"],
  ["deliver type transition protection", "IF TG_OP = 'UPDATE' AND NEW.type = 'deliver'"],
  ["deliver-only historical job delete", "IF TG_OP = 'DELETE' AND OLD.type = 'deliver'"],
  ["non-post delivery fail-closed", "non_post_delivery_unsupported"],
  ["claimed delivery settlement", "settle_delivery_cutover_blocked"],
  ["settlement reason prefix", "v_reason NOT LIKE 'delivery_cutover_blocked%'"],
];

const missing = required.filter(([, marker]) => !sql.includes(marker));
if (missing.length > 0) {
  throw new Error(`missing cutover contract markers: ${missing.map(([name]) => name).join(", ")}`);
}

if (!/p\.created_at\s*>\s*v_cutover/.test(sql)) {
  throw new Error("cutover candidate guard is not strict > T");
}

if (
  !adminRetry.includes("historical_skipped") ||
  !adminRetry.includes("retryJobs.map") ||
  !adminRetry.includes("historical_delivery") ||
  !adminRetry.includes("Synthetic Telegram template tests are disabled") ||
  !/payload:\s*\{[\s\S]*?tweet_id:\s*(?:tweet_id|delivery\.subject_id)/.test(adminRetry) ||
  adminRetry.includes("attempts: 0") ||
  !adminRetry.includes("actionClass === 'inbound_rss_ingest'")
) {
  throw new Error("admin retry path does not prove historical rows are skipped");
}
if (!digestCompiler.includes('await sb.rpc("checkpoint_digest_delivery_disabled"') ||
  !digestCompiler.includes('delivery_state: "disabled"') ||
  digestCompiler.includes("digest_compiler_preview_only") ||
  digestCompiler.includes("evaluateExternalPosting") ||
  digestCompiler.includes("externalPostingBlockedResponse") ||
  /api\.x\.com/.test(digestCompiler) ||
  digestCompiler.includes("functions.invoke(\"x-poster\"") ||
  digestCompiler.includes("fetch(")) {
  throw new Error("digest compiler does not enforce delivery-disabled checkpointing");
}
const deliveryCheckpoint = digestCompiler.lastIndexOf('await sb.rpc("checkpoint_digest_delivery_disabled"');
const deliveryDisabledResponse = digestCompiler.lastIndexOf('delivery_state: "disabled"');
if (deliveryCheckpoint < 0 || deliveryDisabledResponse < deliveryCheckpoint) {
  throw new Error("digest compiler does not checkpoint before its disabled response");
}
if (!settleReasonMigration.includes("v_reason NOT LIKE 'delivery_cutover_blocked%'") ||
  !adminActionsIndex.includes("adminActionRequiresExternalPosting(action, body?.step)")) {
  throw new Error("admin/delivery cutoff contract markers are incomplete");
}
const effectiveClaimStart = effectiveRepairMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.claim_jobs(",
);
const effectiveClaimEnd = effectiveRepairMigration.indexOf("\n$$;", effectiveClaimStart);
if (effectiveClaimStart < 0 || effectiveClaimEnd < 0) {
  throw new Error("effective claim_jobs repair function is incomplete");
}
const effectiveClaimBody = effectiveRepairMigration.slice(effectiveClaimStart, effectiveClaimEnd);
for (const marker of [
  "fresh_claim_token uuid := gen_random_uuid();",
  "claim_token = fresh_claim_token",
  "claim_generation = COALESCE(claim_generation, 0) + 1",
  "claim_state = 'preparing'",
  "claim_started_at = now()",
  "claim_expires_at = now() + lease_duration",
  "provider_started_at = NULL",
  "public.delivery_cutover_allows_job(",
  "FOR UPDATE SKIP LOCKED",
]) {
  if (!effectiveClaimBody.includes(marker)) {
    throw new Error(`effective claim_jobs repair lacks ${marker}`);
  }
}
const settlementStart = zeroWriteMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.settle_delivery_cutover_blocked(",
);
const settlementEnd = zeroWriteMigration.indexOf("\n$$;", settlementStart);
const settlementBody = settlementStart >= 0 && settlementEnd >= 0
  ? zeroWriteMigration.slice(settlementStart, settlementEnd)
  : "";
if (!settlementBody.includes("RETURN false;") ||
  /\b(?:UPDATE|INSERT|DELETE)\b/i.test(settlementBody) ||
  /\bFOR\s+UPDATE\b/i.test(settlementBody)) {
  throw new Error("final cutover settlement function is not zero-DML");
}
const reconcileStart = zeroWriteMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.reconcile_stuck_jobs()",
);
const reconcileEnd = zeroWriteMigration.indexOf("\n$function$;", reconcileStart);
const reconcileBody = reconcileStart >= 0 && reconcileEnd >= 0
  ? zeroWriteMigration.slice(reconcileStart, reconcileEnd)
  : "";
if (!reconcileBody || reconcileBody.includes("settle_delivery_cutover_blocked") ||
  reconcileBody.includes("historical_deliveries_settled") ||
  (reconcileBody.match(/public\.delivery_cutover_allows_job\(/g) ?? []).length < 2) {
  throw new Error("final reconciliation function does not skip historical delivery rows before updates");
}
if (!zeroWriteMigration.includes("CREATE TRIGGER trg_00_historical_delivery_job_zero_write") ||
  !zeroWriteMigration.includes("BEFORE UPDATE OR DELETE ON public.jobs") ||
  !zeroWriteMigration.includes("delivery_cutover_blocked:historical_deliver_job_zero_write")) {
  throw new Error("historical delivery jobs do not have a first-write trigger fence");
}
if (migrationNames.at(-1) !== zeroWriteMigrationName) {
  throw new Error("historical zero-write migration is not the final active migration");
}
const guardedTelegramStart = effectiveRepairMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.claim_telegram_delivery(",
);
const guardedTelegramEnd = effectiveRepairMigration.indexOf("\n$$;", guardedTelegramStart);
const guardedTelegramBody = guardedTelegramStart >= 0 && guardedTelegramEnd >= 0
  ? effectiveRepairMigration.slice(guardedTelegramStart, guardedTelegramEnd)
  : "";
const telegramGuardAt = guardedTelegramBody.indexOf("public.delivery_cutover_allows_post(");
const telegramDelegateAt = guardedTelegramBody.indexOf("public.claim_telegram_delivery_unchecked(");
if (telegramGuardAt < 0 || telegramDelegateAt < 0 || telegramGuardAt > telegramDelegateAt) {
  throw new Error("effective Telegram claim does not guard before its legacy delegate");
}

// The final migration must be the last source definition of the X claimer.
// This catches a later migration silently restoring the pre-generation or
// pre-cutover implementation.
const xClaimDefinitionNames = migrationSources
  .filter(([, source]) => source.includes("CREATE OR REPLACE FUNCTION public.claim_x_post_delivery("))
  .map(([name]) => name);
if (migrationNames.indexOf(effectiveXClaimMigrationName) <= migrationNames.indexOf(
  "20260827064509_repair_effective_claim_fence_and_delivery_cutover.sql",
)) {
  throw new Error("effective X claim repair is not ordered after the prior delivery repair");
}
if (xClaimDefinitionNames.at(-1) !== effectiveXClaimMigrationName) {
  throw new Error("effective X claim migration is not the final claim_x_post_delivery definition");
}
if (migrationNames.indexOf(effectiveXCleanupMigrationName) <= migrationNames.indexOf(effectiveXClaimMigrationName)) {
  throw new Error("legacy X overload cleanup is not ordered after the effective X claim repair");
}

const effectiveXClaimStart = effectiveXClaimMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(",
);
const effectiveXClaimEnd = effectiveXClaimMigration.indexOf("\n$$;", effectiveXClaimStart);
if (effectiveXClaimStart < 0 || effectiveXClaimEnd < 0) {
  throw new Error("effective X claim repair function is incomplete");
}
const effectiveXClaimBody = effectiveXClaimMigration.slice(effectiveXClaimStart, effectiveXClaimEnd);
const effectiveXClaimInsertAt = effectiveXClaimBody.indexOf("INSERT INTO public.x_deliveries");
const effectiveXCutoverAt = effectiveXClaimBody.indexOf("public.delivery_cutover_allows_post(v_post_id)");
const effectiveXHistoricalAt = effectiveXClaimBody.indexOf("FROM public.x_deliveries xd");
if (effectiveXCutoverAt < 0 || effectiveXHistoricalAt < 0 || effectiveXClaimInsertAt < 0 ||
  effectiveXCutoverAt > effectiveXClaimInsertAt || effectiveXHistoricalAt > effectiveXClaimInsertAt ||
  !effectiveXClaimBody.includes("xd.created_at <= public.get_delivery_cutover()") ||
  !effectiveXClaimBody.includes("reason', 'historical_x_delivery")) {
  throw new Error("effective X claim does not enforce cutoff and historical-row guards before insertion");
}
for (const marker of [
  "v_claim_token uuid := gen_random_uuid();",
  "claim_generation",
  "claim_state",
  "'preparing'",
  "'claim_generation', 1",
]) {
  if (!effectiveXClaimBody.includes(marker)) {
    throw new Error(`effective X claim repair lost ${marker}`);
  }
}

// The pre-stage must explicitly recreate the V1 overloads because a
// convergence run may apply B3 after the original V1 migration has already
// dropped them. Both remain available until the activation cleanup.
for (const pattern of [
  /CREATE OR REPLACE FUNCTION public\.complete_x_post_delivery\(\s*p_delivery_id uuid,\s*p_claim_token uuid,\s*p_x_tweet_id text,/s,
  /CREATE OR REPLACE FUNCTION public\.fail_x_post_delivery\(\s*p_delivery_id uuid,\s*p_claim_token uuid,\s*p_status text DEFAULT 'failed',/s,
  /REVOKE ALL ON FUNCTION public\.complete_x_post_delivery\(\s*uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text\s*\) FROM public, anon, authenticated;/s,
  /REVOKE ALL ON FUNCTION public\.fail_x_post_delivery\(\s*uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text\s*\) FROM public, anon, authenticated;/s,
  /GRANT EXECUTE ON FUNCTION public\.complete_x_post_delivery\(\s*uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text\s*\)\s*TO service_role;/s,
  /GRANT EXECUTE ON FUNCTION public\.fail_x_post_delivery\(\s*uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text\s*\)\s*TO service_role;/s,
]) {
  if (!pattern.test(effectiveXClaimMigration)) {
    throw new Error("effective X claim pre-stage does not recreate the V1 lifecycle overloads");
  }
}
if ((effectiveXClaimMigration.match(/IF NOT public\.delivery_cutover_allows_post\(v_post_id\) THEN RETURN false;/g) ?? []).length < 2) {
  throw new Error("effective X claim pre-stage lifecycle overloads lost their cutoff guards");
}
for (const marker of ["claim_state='posted', claim_expires_at=NULL", "claim_state=v_status, claim_expires_at=NULL"]) {
  if (!effectiveXClaimMigration.includes(marker)) {
    throw new Error(`effective X claim pre-stage does not settle the V1 claim envelope: ${marker}`);
  }
}

// Completion/failure must continue to use the B3 generation-fenced overloads
// after the two unsafe V1 overloads are removed by the activation cleanup.
for (const marker of [
  "CREATE OR REPLACE FUNCTION public.complete_x_post_delivery(\n  p_delivery_id uuid,\n  p_claim_token uuid,\n  p_claim_generation bigint",
  "CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(\n  p_delivery_id uuid,\n  p_claim_token uuid,\n  p_claim_generation bigint",
  "AND claim_generation = p_claim_generation",
]) {
  if (!b3GenerationMigration.includes(marker)) {
    throw new Error(`B3 generation-fenced X lifecycle marker is missing: ${marker}`);
  }
}
if ((b3GenerationMigration.match(/AND claim_generation = p_claim_generation/g) ?? []).length < 4) {
  throw new Error("B3 X lifecycle functions do not retain all generation fences");
}

const preStageDropStatements = effectiveXClaimMigration.match(/DROP FUNCTION\s+IF EXISTS\s+public\./gi) ?? [];
if (preStageDropStatements.length > 0) {
  throw new Error("effective X claim pre-stage must not drop legacy X lifecycle overloads");
}
const droppedXOverloads = [...effectiveXCleanupMigration.matchAll(
  /DROP FUNCTION IF EXISTS public\.[\s\S]*?\);/g,
)].map(([statement]) => statement.replace(/\s+/g, " ").trim());
const expectedDroppedXOverloads = [
  "DROP FUNCTION IF EXISTS public.complete_x_post_delivery( uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text );",
  "DROP FUNCTION IF EXISTS public.fail_x_post_delivery( uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text );",
];
if (droppedXOverloads.length !== expectedDroppedXOverloads.length ||
  droppedXOverloads.some((statement, index) => statement !== expectedDroppedXOverloads[index])) {
  throw new Error("legacy X overload cleanup must drop exactly the two unsafe legacy overloads");
}
for (const marker of [
  "REVOKE ALL ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)",
  "GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text, text, boolean, integer)",
  "REVOKE ALL ON FUNCTION public.complete_x_post_delivery(",
  "GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(",
  "REVOKE ALL ON FUNCTION public.fail_x_post_delivery(",
  "GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(",
  "TO service_role",
]) {
  if (!effectiveXClaimMigration.includes(marker)) {
    throw new Error(`effective X claim grant contract is missing: ${marker}`);
  }
}
for (const marker of [
  "REVOKE ALL ON FUNCTION public.complete_x_post_delivery(",
  "GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(",
  "REVOKE ALL ON FUNCTION public.fail_x_post_delivery(",
  "GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(",
  "TO service_role",
]) {
  if (!effectiveXCleanupMigration.includes(marker)) {
    throw new Error(`legacy X overload cleanup grant contract is missing: ${marker}`);
  }
}
if (!worker.includes('if (telegramClaim.reason.startsWith("delivery_cutover_blocked"))') ||
  !worker.includes('throw new DeliveryCutoverBlockedNoWrite(reason);') ||
  worker.includes('settleBlockedDeliveryJob') ||
  worker.includes('settleDeliveryCutoverJob') ||
  worker.includes('recordPipelineEvent(supabase, job, "completed", error.reason') ||
  worker.indexOf('if (telegramClaim.reason.startsWith("delivery_cutover_blocked"))') >
    worker.indexOf('if (telegramClaim.reason === "already_posted")')) {
  throw new Error("worker does not stop a blocked Telegram claim without writes");
}
assertGuardBeforeMutation(
  "worker delivery",
  worker,
  "await requireDeliveryCutover(supabase, tweetId);",
  "await insertPipelineEvent(",
  "async function handleDeliverJob",
);
const deliverBody = functionBody(worker, "async function handleDeliverJob");
if (deliverBody.indexOf("await requireDeliveryCutover(supabase, tweetId);") >
  deliverBody.indexOf("await requireExternalPosting(supabase);")) {
  throw new Error("worker delivery does not reject historical lineage before posting-mode deferral");
}
const guardedAdminPaths = [
  ["manual advance", manualAdvance, "requireDeliveryCutover"],
  ["monitoring cleanup", monitoringMutations, "requireDeliveryCutover"],
  ["stale X cleanup", maintenanceActions, "delivery_cutover_blocked"],
  ["duplicate clear", dedupeActions, "requireDeliveryCutover"],
  ["backlog cleanup", basicActions, "skipped_historical"],
  ["thread posting", basicActions, "Thread delivery requires a real post-T tweet_id lineage"],
  ["synthetic X test", xApiActions, "Synthetic X test tweets are disabled"],
  ["retry X lineage", xPostingActions, "requireDeliveryCutover"],
  ["manual intake posting", manualVideoIntakeActions, "requireDeliveryCutover"],
  ["x fallback cutoff", xPoster, "get_delivery_cutover"],
  ["worker zero-write block", worker, "DeliveryCutoverBlockedNoWrite"],
];
for (const [name, source, marker] of guardedAdminPaths) {
  if (!source.includes(marker)) {
    throw new Error(`${name} admin path lacks an explicit cutover guard`);
  }
}
assertFunctionContains(
  "admin retry step",
  basicActions,
  "export async function retryStepAdminAction",
  "DeliveryCutoverBlockedError",
);
assertFunctionContains(
  "manual advance",
  manualAdvance,
  "export async function queueManualAdvance",
  "requireDeliveryCutover",
);
assertFunctionContains(
  "monitoring cleanup",
  monitoringMutations,
  "export async function ignoreMonitoringItemInternal",
  "requireDeliveryCutover",
);
assertFunctionContains(
  "duplicate clear",
  dedupeActions,
  "export async function clearDuplicateAdminAction",
  "requireDeliveryCutover",
);
assertFunctionContains(
  "retry X lineage",
  xPostingActions,
  "export async function runXPostAdminAction",
  "requireDeliveryCutover",
);
assertFunctionContains(
  "manual intake posting",
  manualVideoIntakeActions,
  "export async function manualVideoIntakePostAdminAction",
  "requireDeliveryCutover",
);
for (const marker of [
  "export async function sendTelegramPhotoFromStorage",
  "export async function sendTelegramPhotoGroupFromStorage",
  "export async function sendTelegramVideoFromStorage",
  "export async function sendTelegramMedia",
]) {
  assertGuardBeforeEveryFetch(
    `Telegram ${marker}`,
    telegramDelivery,
    marker,
    "beforeProviderCall?.()",
  );
}
assertGuardBeforeEveryFetch(
  "worker Telegram delivery",
  worker,
  "async function handleDeliverJob",
  "await beforeTelegramProviderCall();",
);
assertGuardBeforeMutation(
  "worker Telegram provider path",
  worker,
  "const beforeTelegramProviderCall",
  "await sendTelegramMedia",
  "async function handleDeliverJob",
);
assertGuardBeforeMutation(
  "retry X provider path",
  xPostingActions,
  "await requireDeliveryCutover(supabase, tweetId ?? \"\")",
  "`${supabaseUrl}/functions/v1/x-poster`",
  "export async function runXPostAdminAction",
);
assertGuardBeforeMutation(
  "manual intake posting path",
  manualVideoIntakeActions,
  "await requireDeliveryCutover(supabase, String(intake.tweet_id ?? \"\"))",
  'status: "post_requested"',
  "export async function manualVideoIntakePostAdminAction",
);

console.log(`v1 delivery cutover SQL contract PASS (${required.length + 11} markers)`);
