import { readFile } from "node:fs/promises";

const migrationPath = new URL(
  "../supabase/migrations/20260825091418_v1_delivery_continuity_cutover.sql",
  import.meta.url,
);
const sql = await readFile(migrationPath, "utf8");
const settleReasonMigration = await readFile(
  new URL("../supabase/migrations/20260825104845_v1_delivery_cutover_settle_reason_prefix.sql", import.meta.url),
  "utf8",
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
  ["worker settlement", worker, "settleBlockedDeliveryJob"],
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
