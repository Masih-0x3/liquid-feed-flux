import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const migrationPath = process.env.XOT_BRIDGE_MIGRATION_PATH
  ?? join(root, "supabase/migrations/20260825220124_xot_v2_runtime_controls_activation_bridge.sql");
const sql = await readFile(migrationPath, "utf8");
const legacyMigration = await readFile(
  new URL("../supabase/migrations/20260825091418_v1_delivery_continuity_cutover.sql", import.meta.url),
  "utf8",
);
const telegramLegacyMigration = await readFile(
  new URL("../supabase/migrations/20260730070000_telegram_delivery_claims.sql", import.meta.url),
  "utf8",
);

const required = [
  "BEGIN;",
  "COMMIT;",
  "singleton_id boolean",
  "singleton_key boolean",
  "runtime_controls_singleton_id_bridge_uq",
  "runtime_controls_singleton_key_bridge_uq",
  "runtime_controls_dual_singleton_check",
  "runtime_activation_epochs",
  "runtime_activation_epochs_t1_immutable_check",
  "runtime_activation_epochs_after_t1_check",
  "runtime_activation_epochs_immutable",
  "runtime_activation_epochs_partial_schema",
  "attidentity = 'a'",
  "runtime_activation_epochs_pkey",
  "runtime_activation_epochs_activation_key_key",
  "pg_get_expr(conbin, conrelid)",
  "xot_runtime_epoch_constraint_reference",
  "runtime_activation_epochs_epoch_id_bridge_uq",
  "runtime_controls_bridge_singleton_id_index_definition_mismatch",
  "runtime_controls_bridge_singleton_key_index_definition_mismatch",
  "index_row.indkey[0] = v_singleton_id_attnum",
  "index_row.indkey[0] = v_singleton_key_attnum",
  "index_row.indpred IS NULL",
  "pg_get_indexdef(index_class.oid)",
  "regexp_replace(format(",
  "activate_runtime_v2",
  "lock_runtime_v2_activation",
  "lock_runtime_v2_delivery_mutation",
  "a_runtime_v2_activation_lock_jobs",
  "a_runtime_v2_activation_lock_deliveries",
  "a_runtime_v2_activation_lock_x_deliveries",
  "BEFORE INSERT OR UPDATE OR DELETE ON public.jobs",
  "BEFORE INSERT OR UPDATE OR DELETE ON public.deliveries",
  "BEFORE INSERT OR UPDATE OR DELETE ON public.x_deliveries",
  "EXECUTE FUNCTION public.lock_runtime_v2_delivery_mutation();",
  "runtime_activation_epochs_immutable_trigger_definition_mismatch",
  "a_runtime_v2_activation_lock_jobs_trigger_definition_mismatch",
  "a_runtime_v2_activation_lock_deliveries_trigger_definition_mismatch",
  "a_runtime_v2_activation_lock_x_deliveries_trigger_definition_mismatch",
  "trigger_row.tgenabled = 'O'",
  "trigger_row.tgtype = 31",
  "trigger_row.tgtype = 27",
  "trigger_row.tgfoid = 'public.lock_runtime_v2_delivery_mutation()'::regprocedure",
  "trigger_row.tgfoid = 'public.prevent_runtime_activation_epoch_mutation()'::regprocedure",
  "pg_get_triggerdef(trigger_row.oid)",
  "FUNCTION (public\\.)?",
  "pg_advisory_xact_lock",
  "runtime_v2_allows_lineage",
  "update_runtime_controls_v2",
  "claim_telegram_delivery_v2",
  "claim_x_post_delivery_v2",
  "REVOKE ALL ON FUNCTION public.activate_runtime_v2",
  "GRANT EXECUTE ON FUNCTION public.activate_runtime_v2",
  "REVOKE ALL ON TABLE public.runtime_activation_epochs FROM service_role",
  "GRANT SELECT ON TABLE public.runtime_activation_epochs TO service_role",
  "REVOKE ALL ON FUNCTION public.claim_telegram_delivery_v2",
  "REVOKE ALL ON FUNCTION public.claim_x_post_delivery_v2",
  "ON CONFLICT (activation_key) DO NOTHING",
  "p_lineage_time >",
  "p_epoch_generation = (SELECT max(a.epoch_id)",
  "CREATE OR REPLACE FUNCTION public.get_delivery_cutover()",
  "max(p.created_at) > public.get_delivery_cutover()",
  "latest.latest_count <> 1",
  "pause V1 claimers",
  "zero active/leased claims",
];

for (const needle of required) {
  if (!sql.includes(needle)) throw new Error(`missing bridge contract: ${needle}`);
}
if (sql.includes("pg_get_constraintdef")) {
  throw new Error("epoch constraint validation still uses text-fragment heuristics");
}
if (/CREATE UNIQUE INDEX IF NOT EXISTS runtime_controls_singleton_(id|key)_bridge_uq/.test(sql)) {
  throw new Error("runtime_controls index validation occurs after IF NOT EXISTS");
}

const forbidden = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /DROP\s+FUNCTION/i,
  /TRUNCATE/i,
  /DELETE\s+FROM\s+public\.runtime_activation_epochs/i,
  /UPDATE\s+public\.runtime_activation_epochs/i,
];
for (const pattern of forbidden) {
  if (pattern.test(sql)) throw new Error(`forbidden destructive bridge SQL: ${pattern}`);
}

// T2 must be written only by the explicit activation routine.  The migration
// defines the table but must not seed an activation row during install.
const tableStart = sql.indexOf("CREATE TABLE IF NOT EXISTS public.runtime_activation_epochs");
const functionStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.activate_runtime_v2");
if (tableStart < 0 || functionStart < 0 || functionStart <= tableStart) {
  throw new Error("activation table/function ordering is invalid");
}
const preActivationSql = sql.slice(0, functionStart);
if (/INSERT\s+INTO\s+public\.runtime_activation_epochs/i.test(preActivationSql)) {
  throw new Error("migration seeds T2 before the explicit activation function");
}

const activationBodyEnd = sql.indexOf("\n$$;", functionStart);
if (activationBodyEnd < 0) throw new Error("activation function body is incomplete");
const activationBody = sql.slice(functionStart, activationBodyEnd);
const activationLockAt = activationBody.indexOf("lock_runtime_v2_activation");
const activationInsertAt = activationBody.indexOf("INSERT INTO public.runtime_activation_epochs");
if (activationLockAt < 0 || activationInsertAt < 0 || activationLockAt > activationInsertAt) {
  throw new Error("activation writes T2 before taking the shared fence");
}

// Both V2 claim wrappers must fail before calling a legacy provider claimer.
for (const name of ["claim_telegram_delivery_v2", "claim_x_post_delivery_v2"]) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`missing wrapper: ${name}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`missing wrapper body: ${name}`);
  const body = sql.slice(start, end);
  const lockAt = body.indexOf("lock_runtime_v2_activation");
  const lineageAt = body.indexOf("runtime_v2_allows_lineage");
  const legacyAt = body.indexOf(name.startsWith("claim_telegram")
    ? "public.claim_telegram_delivery("
    : "public.claim_x_post_delivery(");
  if (lockAt < 0 || lineageAt < 0 || legacyAt < 0 || lockAt > lineageAt || lineageAt > legacyAt) {
    throw new Error(`wrapper checks lineage before taking the shared fence: ${name}`);
  }
  if (!body.includes("runtime_v2_cutover_blocked")) throw new Error(`missing fail-closed reason: ${name}`);
}

const legacyCutoverStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_delivery_cutover()");
const legacyCutoverEnd = sql.indexOf("\n$$;", legacyCutoverStart);
const legacyPostStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.delivery_cutover_allows_post(");
const legacyPostEnd = sql.indexOf("\n$$;", legacyPostStart);
if (legacyCutoverStart < 0 || legacyCutoverEnd < 0 || legacyPostStart < 0 || legacyPostEnd < 0) {
  throw new Error("legacy effective-cutoff compatibility functions are incomplete");
}
const legacyPostBody = sql.slice(legacyPostStart, legacyPostEnd);
if (!legacyPostBody.includes("public.get_delivery_cutover()") ||
  !legacyPostBody.includes("max(p.created_at) > public.get_delivery_cutover()")) {
  throw new Error("direct legacy post gate does not consume effective cutoff");
}

function assertControlIndexContract(source) {
  for (const marker of [
    "runtime_controls_bridge_singleton_id_index_definition_mismatch",
    "runtime_controls_bridge_singleton_key_index_definition_mismatch",
    "index_row.indkey[0] = v_singleton_id_attnum",
    "index_row.indkey[0] = v_singleton_key_attnum",
    "index_row.indpred IS NULL",
  ]) {
    if (!source.includes(marker)) throw new Error(`runtime_controls index contract missing: ${marker}`);
  }
}
const controlIndexSection = sql.slice(
  sql.indexOf("runtime_controls_singleton_id_bridge_uq"),
  sql.indexOf("DO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint", sql.indexOf("runtime_controls_singleton_id_bridge_uq")),
);
assertControlIndexContract(controlIndexSection);
try {
  assertControlIndexContract(controlIndexSection.replaceAll("index_row.indpred IS NULL", "index_row.indpred IS NOT NULL"));
  throw new Error("weakened runtime_controls index definition was accepted");
} catch (error) {
  if (!String(error?.message ?? "").includes("runtime_controls index contract missing")) throw error;
}
function assertSemanticEpochConstraintContract(source) {
  for (const marker of [
    "v_existing_expr IS DISTINCT FROM v_expected_t1_expr",
    "v_existing_expr IS DISTINCT FROM v_expected_after_t1_expr",
  ]) {
    if (!source.includes(marker)) throw new Error(`semantic epoch constraint check missing: ${marker}`);
  }
}
assertSemanticEpochConstraintContract(sql);
try {
  assertSemanticEpochConstraintContract(
    sql.replace("v_existing_expr IS DISTINCT FROM v_expected_t1_expr", "v_existing_expr = v_expected_t1_expr"),
  );
  throw new Error("weakened epoch constraint definition was accepted");
} catch (error) {
  if (!String(error?.message ?? "").includes("semantic epoch constraint check missing")) throw error;
}

const triggerSpecs = [
  {
    name: "a_runtime_v2_activation_lock_jobs",
    table: "jobs",
    function: "lock_runtime_v2_delivery_mutation",
    type: 31,
  },
  {
    name: "a_runtime_v2_activation_lock_deliveries",
    table: "deliveries",
    function: "lock_runtime_v2_delivery_mutation",
    type: 31,
  },
  {
    name: "a_runtime_v2_activation_lock_x_deliveries",
    table: "x_deliveries",
    function: "lock_runtime_v2_delivery_mutation",
    type: 31,
  },
  {
    name: "runtime_activation_epochs_immutable",
    table: "runtime_activation_epochs",
    function: "prevent_runtime_activation_epoch_mutation",
    type: 27,
  },
];

function triggerValidationSection(source, name) {
  const nameAt = source.indexOf(`trigger_row.tgname = '${name}'`);
  if (nameAt < 0) throw new Error(`missing trigger validation: ${name}`);
  const start = source.lastIndexOf("IF EXISTS (", nameAt);
  const end = source.indexOf("END IF;", nameAt);
  if (start < 0 || end < 0) throw new Error(`incomplete trigger validation: ${name}`);
  return source.slice(start, end);
}

function mutateTriggerValidation(source, name, marker, replacement) {
  const nameAt = source.indexOf(`trigger_row.tgname = '${name}'`);
  const start = source.lastIndexOf("IF EXISTS (", nameAt);
  const end = source.indexOf("END IF;", nameAt);
  return source.slice(0, start) +
    source.slice(start, end).replace(marker, replacement) +
    source.slice(end);
}

function assertTriggerContract(source, spec) {
  const section = triggerValidationSection(source, spec.name);
  for (const marker of [
    `trigger_row.tgrelid = 'public.${spec.table}'::regclass`,
    `trigger_row.tgname = '${spec.name}'`,
    "trigger_row.tgenabled = 'O'",
    `trigger_row.tgtype = ${spec.type}`,
    `trigger_row.tgfoid = 'public.${spec.function}()'::regprocedure`,
    "regexp_replace(pg_get_triggerdef(trigger_row.oid)",
  ]) {
    if (!section.includes(marker)) throw new Error(`trigger contract missing for ${spec.name}: ${marker}`);
  }
  if (!source.includes(`CREATE TRIGGER ${spec.name}`) ||
    !source.includes(`ON public.${spec.table}`) ||
    !source.includes(`EXECUTE FUNCTION public.${spec.function}();`)) {
    throw new Error(`trigger creation contract missing for ${spec.name}`);
  }
}

function canonicalTriggerDefMatches(definition, spec) {
  const eventOrders = spec.type === 27
    ? "(UPDATE OR DELETE|DELETE OR UPDATE)"
    : "(INSERT OR UPDATE OR DELETE|INSERT OR DELETE OR UPDATE|DELETE OR INSERT OR UPDATE|DELETE OR UPDATE OR INSERT|UPDATE OR INSERT OR DELETE|UPDATE OR DELETE OR INSERT)";
  const normalized = definition.replace(/\s+/g, " ");
  return new RegExp(
    `^CREATE TRIGGER ${spec.name} BEFORE ${eventOrders} ON public.${spec.table} FOR EACH ROW EXECUTE FUNCTION (?:public\\.)?${spec.function}\\(\\)$`,
  ).test(normalized);
}

const epochTrigger = triggerSpecs.find((spec) => spec.name === "runtime_activation_epochs_immutable");
if (!epochTrigger) throw new Error("epoch trigger fixture spec is missing");
const canonicalUnqualifiedEpochDef =
  "CREATE TRIGGER runtime_activation_epochs_immutable BEFORE UPDATE OR DELETE ON public.runtime_activation_epochs FOR EACH ROW EXECUTE FUNCTION prevent_runtime_activation_epoch_mutation()";
if (!canonicalTriggerDefMatches(canonicalUnqualifiedEpochDef, epochTrigger)) {
  throw new Error("canonical unqualified epoch triggerdef was rejected");
}
if (canonicalTriggerDefMatches(
  canonicalUnqualifiedEpochDef.replace("prevent_runtime_activation_epoch_mutation", "wrong_epoch_trigger"),
  epochTrigger,
)) {
  throw new Error("wrong canonical epoch trigger function was accepted");
}

for (const spec of triggerSpecs) {
  assertTriggerContract(sql, spec);
  const functionMarker = `trigger_row.tgfoid = 'public.${spec.function}()'::regprocedure`;
  try {
    assertTriggerContract(
      mutateTriggerValidation(sql, spec.name, functionMarker, "trigger_row.tgfoid = NULL"),
      spec,
    );
    throw new Error(`wrong trigger function was accepted: ${spec.name}`);
  } catch (error) {
    if (!String(error?.message ?? "").includes("trigger contract missing")) throw error;
  }
}

const epochMaskMarker = "trigger_row.tgtype = 27";
if (!epochTrigger || !triggerValidationSection(sql, epochTrigger.name).includes(epochMaskMarker)) {
  throw new Error("epoch trigger UPDATE+DELETE mask 27 is missing");
}
try {
  assertTriggerContract(
    mutateTriggerValidation(sql, epochTrigger.name, epochMaskMarker, "trigger_row.tgtype = 11"),
    epochTrigger,
  );
  throw new Error("incorrect epoch trigger mask 11 was accepted");
} catch (error) {
  if (!String(error?.message ?? "").includes("trigger contract missing")) throw error;
}

for (const signature of [
  "CREATE OR REPLACE FUNCTION public.get_delivery_cutover()",
  "CREATE OR REPLACE FUNCTION public.delivery_cutover_allows_post(p_tweet_id text)",
  "CREATE OR REPLACE FUNCTION public.claim_jobs(",
  "CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(",
  "TG_TABLE_NAME = 'deliveries'",
  "delivery_cutover_allows_job(NEW.created_at, v_tweet_id)",
]) {
  if (!legacyMigration.includes(signature)) throw new Error(`legacy RPC contract disappeared: ${signature}`);
}
if (!telegramLegacyMigration.includes("CREATE OR REPLACE FUNCTION public.claim_telegram_delivery(")) {
  throw new Error("legacy Telegram claim RPC contract disappeared");
}

function bodyBetween(source, startMarker, endMarker = "\n$$;") {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`missing path body: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`unterminated path body: ${startMarker}`);
  return source.slice(start, end);
}
const legacyClaimJobsBody = bodyBetween(legacyMigration, "CREATE OR REPLACE FUNCTION public.claim_jobs(");
const legacyClaimXBody = bodyBetween(legacyMigration, "CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(");
const legacyGuardBody = bodyBetween(legacyMigration, "CREATE OR REPLACE FUNCTION public.guard_delivery_cutover_rows(");
if (!legacyClaimJobsBody.includes("public.delivery_cutover_allows_job(")) {
  throw new Error("claim_jobs path lost its effective-cutoff gate");
}
if (!legacyClaimJobsBody.includes("UPDATE public.jobs")) {
  throw new Error("claim_jobs path no longer mutates the fenced jobs table");
}
if (!legacyClaimXBody.includes("public.delivery_cutover_allows_post(")) {
  throw new Error("claim_x_post_delivery path lost its effective-cutoff gate");
}
if (!legacyClaimXBody.includes("INSERT INTO public.x_deliveries")) {
  throw new Error("claim_x_post_delivery path no longer mutates the fenced x_deliveries table");
}
if (!legacyGuardBody.includes("TG_TABLE_NAME = 'deliveries'") ||
  !legacyGuardBody.includes("delivery_cutover_allows_job(NEW.created_at, v_tweet_id)")) {
  throw new Error("Telegram delivery trigger path lost its effective-cutoff gate");
}
if (!telegramLegacyMigration.includes("UPDATE public.deliveries") ||
  !telegramLegacyMigration.includes("INSERT INTO public.deliveries")) {
  throw new Error("claim_telegram_delivery path no longer mutates the fenced deliveries table");
}
if (!legacyMigration.includes("trg_jobs_delivery_cutover") ||
  !legacyMigration.includes("trg_x_deliveries_delivery_cutover") ||
  !legacyMigration.includes("trg_deliveries_delivery_cutover")) {
  throw new Error("legacy delivery mutation triggers are incomplete");
}
function requireGate(body, gate, name) {
  if (!body.includes(gate)) throw new Error(`${name} lacks effective-cutoff gate`);
}
for (const [name, body, gate] of [
  ["claim_jobs", legacyClaimJobsBody, "public.delivery_cutover_allows_job("],
  ["claim_x_post_delivery", legacyClaimXBody, "public.delivery_cutover_allows_post("],
  ["delivery trigger", legacyGuardBody, "delivery_cutover_allows_job(NEW.created_at, v_tweet_id)"],
]) {
  const mutated = body.split(gate).join("public.removed_cutoff_gate(");
  if (mutated.includes(gate)) throw new Error(`${name} mutation fixture was not applied`);
  try {
    requireGate(mutated, gate, name);
    throw new Error(`${name} mutation was accepted`);
  } catch (error) {
    if (!String(error?.message ?? "").includes("lacks effective-cutoff gate")) throw error;
  }
}

// Pure contract rehearsal for both known starting rows and the fail-closed
// boundary cases.  This does not claim a Postgres migration run; the local
// Supabase stack is not running in this worktree.
function normalizeControlRows(rows) {
  if (rows.length > 1) throw new Error("ambiguous");
  if (rows.length === 0) {
    return [{ singleton_id: true, singleton_key: true, environment: "preview", posting_mode: "blocked" }];
  }
  const row = { ...rows[0] };
  row.singleton_id ??= row.singleton_key;
  row.singleton_key ??= row.singleton_id;
  if (row.singleton_id !== true || row.singleton_key !== true) throw new Error("invalid");
  return [row];
}

if (normalizeControlRows([])[0].posting_mode !== "blocked") {
  throw new Error("empty controls did not provision a blocked default");
}
if (normalizeControlRows([{ singleton_key: true }])[0].singleton_id !== true) {
  throw new Error("production singleton_key shape did not bridge to singleton_id");
}
if (normalizeControlRows([{ singleton_id: true }])[0].singleton_key !== true) {
  throw new Error("preview singleton_id shape did not bridge to singleton_key");
}
for (const invalid of [[{ singleton_id: false }], [{ singleton_id: true, singleton_key: false }]]) {
  try {
    normalizeControlRows(invalid);
    throw new Error("invalid singleton was accepted");
  } catch (error) {
    if (!/invalid|ambiguous/.test(error.message)) throw error;
  }
}
try {
  normalizeControlRows([{ singleton_id: true }, { singleton_key: true }]);
  throw new Error("ambiguous controls were accepted");
} catch (error) {
  if (error.message !== "ambiguous") throw error;
}

function allowsLineage(epochs, lineageTime, generation) {
  if (lineageTime == null || generation == null || epochs.length === 0) return false;
  const maxT2 = Math.max(...epochs.map((epoch) => epoch.t2));
  const active = epochs.filter((epoch) => epoch.t2 === maxT2);
  if (active.length !== 1 || active[0].id !== generation) return false;
  return lineageTime > Math.max(active[0].t1, active[0].t2);
}
function directLegacyAllowsPost(postCreatedAt, immutableT1, activeT2 = null) {
  const effective = activeT2 == null ? immutableT1 : Math.max(immutableT1, activeT2);
  return postCreatedAt > effective;
}
const t1 = Date.parse("2026-08-25T10:36:06.834081Z");
const t2 = Date.parse("2026-08-25T11:00:00.000Z");
const activeEpoch = [{ id: 7, t1, t2 }];
if (allowsLineage(activeEpoch, null, 7)) throw new Error("null lineage was accepted");
if (allowsLineage(activeEpoch, t2, 7)) throw new Error("equal T2 lineage was accepted");
if (allowsLineage(activeEpoch, t2 + 1, 6)) throw new Error("old generation was accepted");
if (allowsLineage(activeEpoch, t2 + 1, 7) !== true) throw new Error("new lineage was rejected");
if (allowsLineage([], t2 + 1, 7)) throw new Error("missing T2 was accepted");
if (allowsLineage([{ id: 7, t1, t2 }, { id: 8, t1, t2 }], t2 + 1, 7)) {
  throw new Error("ambiguous active T2 was accepted");
}
if (directLegacyAllowsPost(t2, t1, t2)) throw new Error("legacy direct claim admitted equal T2");
if (directLegacyAllowsPost(t2 - 1, t1, t2)) throw new Error("legacy direct claim admitted old T2 lineage");
if (!directLegacyAllowsPost(t2 + 1, t1, t2)) throw new Error("legacy direct claim rejected new lineage");
if (!directLegacyAllowsPost(t1 + 1, t1)) throw new Error("pre-T2 legacy behavior changed");

function activationPrecondition(v1Paused, activeClaims) {
  return v1Paused === true && activeClaims === 0;
}
if (activationPrecondition(false, 0) || activationPrecondition(true, 1) ||
  !activationPrecondition(true, 0)) {
  throw new Error("cutover pause/zero-active precondition model failed");
}

const activationKeys = new Set();
function idempotentActivation(key) {
  if (key && activationKeys.has(key)) return false;
  if (key) activationKeys.add(key);
  return true;
}
if (!idempotentActivation("operator-retry-1") || idempotentActivation("operator-retry-1")) {
  throw new Error("activation-key retry was not idempotent");
}

// Model the critical ordering: a claim holds the same transaction fence while
// it reads the active generation and completes the legacy claim.  Activation
// can append only after that claim releases the fence, so it cannot cross the
// claim's generation boundary.
const fence = { held: false };
const events = [];
function claimUnderFence(epoch) {
  if (fence.held) throw new Error("claim entered while activation lock was held");
  fence.held = true;
  events.push(`claim-read:${epoch}`);
  events.push(`legacy-claim:${epoch}`);
  fence.held = false;
}
function activateUnderFence(epoch) {
  if (fence.held) return false;
  fence.held = true;
  events.push(`activate:${epoch}`);
  fence.held = false;
  return true;
}
claimUnderFence(7);
if (!activateUnderFence(8) || events.join(",") !== "claim-read:7,legacy-claim:7,activate:8") {
  throw new Error("activation/claim fence ordering model failed");
}

console.log("XOT_V2_RUNTIME_CONTROLS_BRIDGE_STATIC_PASS");
