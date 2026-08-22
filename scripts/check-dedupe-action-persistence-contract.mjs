import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const actionPath = path.join(repoRoot, "supabase/functions/admin-actions/dedupeActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`DEDUPE_ACTION_PERSISTENCE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(
    actionPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("dedupe action parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: actionPath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("dedupe action transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ action, packageJson, ci }, label = "current source") {
  parseSource(action);
  if (action.includes("errorMessage(") || action.includes(".message") || action.includes("String(error)")) {
    fail(`${label}: dedupe actions must not expose raw database or exception text`);
  }
  const config = section(
    action,
    "export async function loadDuplicateGateConfig",
    "export async function markDedupePending",
    `${label} duplicate config loader`,
  );
  if (!config.includes("const { data, error } = await table(supabase, \"settings\")")) {
    fail(`${label}: duplicate settings read must retain its error envelope`);
  }
  if (!config.includes('throw new Error("duplicate_gate_config_read_failed");')) {
    fail(`${label}: duplicate settings read errors must fail closed`);
  }
  if (!config.includes('throw new Error("duplicate_gate_config_invalid_response");')) {
    fail(`${label}: duplicate settings response shape must fail closed`);
  }

  const pending = section(
    action,
    "export async function markDedupePending",
    "export async function runDedupeAdminAction",
    `${label} pending writer`,
  );
  if (!pending.includes("const { error } = await table(supabase, \"posts\")")) {
    fail(`${label}: pending write must retain its error envelope`);
  }
  if (!pending.includes('throw new Error("dedupe_pending_write_failed");')) {
    fail(`${label}: pending write errors must fail closed`);
  }
  if (pending.includes(".then(() => null, () => null)")) {
    fail(`${label}: pending write must not swallow persistence errors`);
  }

  const run = section(
    action,
    "export async function runDedupeAdminAction",
    "export async function backfillDedupeAdminAction",
    `${label} single-post action`,
  );
  if (!run.includes("try {\n    config = await loadDuplicateGateConfig(supabase);")) {
    fail(`${label}: single-post action must surface config-read failure`);
  }
  if (!run.includes("await markDedupePending(supabase, tweetId, \"running:admin\");")) {
    fail(`${label}: single-post action must retain the pending write gate`);
  }
  if (!run.includes("const { error: enqueueError } = await table(supabase, \"jobs\").upsert")) {
    fail(`${label}: single-post translation enqueue must retain its error envelope`);
  }
  if (!run.includes('error: "dedupe_post_read_failed"') ||
      !run.includes('error: "duplicate_gate_config_read_failed"') ||
      !run.includes('error: "dedupe_pending_write_failed"') ||
      !run.includes('error: "dedupe_translate_enqueue_failed"')) {
    fail(`${label}: single-post translation enqueue errors must fail closed`);
  }

  const backfill = section(
    action,
    "export async function backfillDedupeAdminAction",
    "export async function auditDuplicateCandidatesAdminAction",
    `${label} backfill action`,
  );
  if (!backfill.includes('return { ok: false, error: "dedupe_backfill_invalid_response" };')) {
    fail(`${label}: backfill malformed response must not become an empty success`);
  }
  if (!backfill.includes('return { ok: false, error: "dedupe_backfill_invalid_row" };')) {
    fail(`${label}: backfill rows must validate before enqueue`);
  }
  if (!backfill.includes('error: "dedupe_backfill_read_failed"') ||
      !backfill.includes('error: "dedupe_backfill_enqueue_failed"') ||
      !backfill.includes('error: "dedupe_pending_write_failed"')) {
    fail(`${label}: backfill enqueue errors must not be reported as queued`);
  }
  if (!backfill.includes("await markDedupePending(supabase, tweetId, \"queued:backfill\");")) {
    fail(`${label}: backfill pending write must remain part of the accepted enqueue path`);
  }

  const audit = section(
    action,
    "export async function auditDuplicateCandidatesAdminAction",
    "export async function clearDuplicateAdminAction",
    `${label} candidate audit`,
  );
  if (!audit.includes('return { ok: false, error: "duplicate_candidates_invalid_response" };')) {
    fail(`${label}: candidate-audit malformed response must fail closed`);
  }
  if (!audit.includes('return { ok: false, error: "duplicate_candidates_invalid_row" };')) {
    fail(`${label}: candidate-audit rows must validate before summarizing`);
  }
  if (!audit.includes('return { ok: false, error: "duplicate_candidates_read_failed" };')) {
    fail(`${label}: candidate-audit read errors must use a stable code`);
  }

  const clear = section(
    action,
    "export async function clearDuplicateAdminAction",
    "\n}",
    `${label} clear action`,
  );
  if (!clear.includes("const { error: blocklistError } = await table(supabase, \"story_pair_blocklist\").upsert")) {
    fail(`${label}: pair blocklist write must retain its error envelope`);
  }
  if (!clear.includes('throw new Error("duplicate_clear_post_update_failed")')) {
    fail(`${label}: clear post update errors must use a stable code`);
  }
  if (!clear.includes('error: "duplicate_pair_blocklist_write_failed"')) {
    fail(`${label}: pair blocklist write errors must be reported as partial failure`);
  }
  if (!clear.includes('error: "duplicate_feedback_write_failed"')) {
    fail(`${label}: feedback write errors must be reported as partial failure`);
  }
  if (clear.includes(".catch(() => {})")) {
    fail(`${label}: clear action must not swallow feedback persistence errors`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:dedupe-action-persistence"] !==
    "node scripts/check-dedupe-action-persistence-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:dedupe-action-persistence")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    action: fs.readFileSync(actionPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("DEDUPE_ACTION_PERSISTENCE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'throw new Error("duplicate_gate_config_read_failed");',
      "return normalizeDuplicateGateConfig(DEFAULT_DUPLICATE_GATE);",
    ),
  }), "config-read fail-open mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'throw new Error("dedupe_pending_write_failed");',
      "return;",
    ),
  }), "pending-write fail-open mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'return { ok: false, error: "dedupe_backfill_invalid_response" };',
      "const posts = [];",
    ),
  }), "backfill malformed-response fail-open mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replaceAll(
      'return { ok: false, error: "dedupe_backfill_invalid_row" };',
      "posts.push(post);",
    ),
  }), "backfill malformed-row fail-open mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "dedupe_backfill_enqueue_failed",',
      'error: errorMessage(jobError),',
    ),
  }), "backfill enqueue raw-error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "dedupe_translate_enqueue_failed",',
      'error: errorMessage(enqueueError),',
    ),
  }), "single-post enqueue raw-error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "dedupe_backfill_enqueue_failed",',
      "ignored_enqueue_error",
    ),
  }), "backfill enqueue error ignored mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'return { ok: false, error: "duplicate_candidates_invalid_response" };',
      "const rows = [];",
    ),
  }), "candidate-audit malformed-response fail-open mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "duplicate_pair_blocklist_write_failed",',
      'error: errorMessage(blocklistError),',
    ),
  }), "pair-blocklist raw-error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "duplicate_pair_blocklist_write_failed",',
      "ignored_blocklist_error",
    ),
  }), "pair-blocklist error ignored mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'throw new Error("duplicate_clear_post_update_failed")',
      'throw clearError',
    ),
  }), "clear post update raw-error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "duplicate_feedback_write_failed",',
      'error: errorMessage(error),',
    ),
  }), "feedback raw-error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "duplicate_feedback_write_failed",',
      "ignored_feedback_error",
    ),
  }), "feedback error ignored mutant");
}

console.log(
  `DEDUPE_ACTION_PERSISTENCE_SOURCE_CONTRACT_PASS failClosed=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
