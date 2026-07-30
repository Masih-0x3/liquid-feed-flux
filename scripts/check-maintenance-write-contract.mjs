import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/maintenanceActions.ts");
const basicPath = path.join(repoRoot, "supabase/functions/admin-actions/basicActions.ts");
const xPostingPath = path.join(repoRoot, "supabase/functions/admin-actions/xPostingActions.ts");
const xApiSummaryPath = path.join(repoRoot, "supabase/functions/admin-actions/xApiSummary.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`MAINTENANCE_WRITE_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, filePath = sourcePath) {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${filePath} parse diagnostics`);
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("maintenance source transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ source, basic, xPosting, xApiSummary, packageJson, ci }, label = "current source") {
  parse(source);
  parse(basic, basicPath);
  parse(xPosting, xPostingPath);
  parse(xApiSummary, xApiSummaryPath);
  const follower = section(
    source,
    "export async function runFollowersSnapshotAdminAction(",
    "export async function resetLearnedBiasesAdminAction(",
    `${label} follower action`,
  );
  if (!follower.includes("const { data: controlsRow, error: controlsError } = await table(supabase, \"settings\")") ||
      !follower.includes("if (controlsError) throw controlsError;")) {
    fail(`${label}: follower admission settings errors must not become a normal disabled response`);
  }
  const resetStart = source.indexOf("export async function resetLearnedBiasesAdminAction(");
  if (resetStart < 0) fail(`${label} learned-bias reset action marker is missing`);
  const reset = source.slice(resetStart);
  if (!reset.includes("const { error } = await table(supabase, \"settings\").upsert({") ||
      !reset.includes("if (error) throw error;")) {
    fail(`${label}: learned-bias reset must check persistence before reporting success`);
  }
  const stale = section(
    source,
    "export async function summarizeStaleXPendingAdminAction(",
    "export async function rescoreRecentAdminAction(",
    `${label} stale-X summary`,
  );
  if (!stale.includes('"stale_x_pending_invalid_response"') ||
      !stale.includes('"stale_x_pending_invalid_row"') ||
      !stale.includes("if (!Array.isArray(data))")) {
    fail(`${label}: stale-X summary must fail closed on malformed rows`);
  }
  const rescore = section(
    source,
    "export async function rescoreRecentAdminAction(",
    "export async function getPostPipelineStatusAdminAction(",
    `${label} rescore action`,
  );
  if (!rescore.includes('"rescore_posts_invalid_response"') ||
      !rescore.includes('"rescore_posts_invalid_row"') ||
      !rescore.includes('error: "rescore_enqueue_failed",') ||
      rescore.includes("errorMessage(error)")) {
    fail(`${label}: rescore backfill must validate rows and enqueue results`);
  }
  const pipeline = section(
    source,
    "export async function getPostPipelineStatusAdminAction(",
    "export async function runFollowersSnapshotAdminAction(",
    `${label} pipeline status action`,
  );
  if (!pipeline.includes('"post_pipeline_status_invalid_response"') ||
      !pipeline.includes('"post_pipeline_status_invalid_row"')) {
    fail(`${label}: pipeline status must fail closed on malformed RPC results`);
  }
  if (!basic.includes("const { error: feedbackLockError } = await table(supabase, \"posts\").update({ feedback_locked: true })") ||
      !basic.includes("if (feedbackLockError) throw feedbackLockError;")) {
    fail(`${label}: forced-delivery feedback lock must check persistence before success`);
  }
  if (!xPosting.includes("const { error: feedbackLockError } = await table(supabase, \"posts\").update({ feedback_locked: true })") ||
      !xPosting.includes("if (feedbackLockError) throw feedbackLockError;")) {
    fail(`${label}: X retry feedback lock must check persistence before success`);
  }
  const xPostActionStart = xPosting.indexOf("export async function runXPostAdminAction(");
  if (xPostActionStart < 0) fail(`${label}: X posting action marker is missing`);
  const xPostAction = xPosting.slice(xPostActionStart);
  for (const marker of [
    'error: "x_poster_request_failed"',
    'code: "x_poster_http_failure"',
    'error: "x_poster_invalid_response"',
    'code: "x_poster_unconfirmed"',
    'function safeAdminActionErrorCode(error: unknown',
  ]) if (!xPostAction.includes(marker) && !xPosting.includes(marker)) fail(`${label}: missing X posting response boundary ${marker}`);
  if (!xPostAction.includes('code: "x_poster_http_failure",\n          prep,\n        },\n        status: 502,') ||
      xPostAction.includes("raw: parsed") ||
      xPostAction.includes("text.slice(0, 300)") ||
      xPostAction.includes("error: (e as Error).message")) {
    fail(`${label}: X posting action must not return raw provider/error text or a success status on failure`);
  }
  if (!xPostAction.includes("parsedObj.ok !== true") ||
      !xPostAction.includes('result.status === "ambiguous"') ||
      !xPostAction.includes('result.status === "failed"')) {
    fail(`${label}: X posting action must reject unconfirmed/failed targeted results`);
  }
  const diagnostics = section(
    xPosting,
    "export async function getXPostingDiagnostics(",
    "export async function hydratePostAdminAction(",
    `${label} X diagnostics action`,
  );
  for (const marker of [
    '"x_diagnostics_settings_read_failed"',
    '"x_diagnostics_settings_invalid_response"',
    '"x_diagnostics_settings_invalid_row"',
    '"x_diagnostics_quota_read_failed"',
    '"x_diagnostics_posts_read_failed"',
    '"x_diagnostics_posts_invalid_response"',
    '"x_diagnostics_posts_invalid_row"',
    '"x_diagnostics_candidates_read_failed"',
    '"x_diagnostics_candidates_invalid_response"',
    '"x_diagnostics_candidates_invalid_row"',
    '"x_diagnostics_post_detail_read_failed"',
    '"x_diagnostics_post_detail_invalid_response"',
  ]) if (!diagnostics.includes(marker)) fail(`${label}: X diagnostics boundary is missing ${marker}`);
  for (const guard of [
    "if (settingsRows.error) {",
    "if (!Array.isArray(settingsRows.data)) {",
    "if (settingsRows.data.some((row) =>",
    "if (candidateRes.error) {",
    "if (!Array.isArray(candidateRes.data)) {",
    "if (!Array.isArray(posts)) {",
    "if (latestX.error || activeJobs.error || mediaRows.error) {",
  ]) if (!diagnostics.includes(guard)) fail(`${label}: X diagnostics guard is missing ${guard}`);
  for (const forbidden of ["errorMessage(", "Array.isArray(posts) ? posts : []", "candidateError) => ({ data: [],"]) {
    if (diagnostics.includes(forbidden)) fail(`${label}: X diagnostics contains fail-open/raw sink ${forbidden}`);
  }
  if (!xApiSummary.includes("official_usage_http_${status}") ||
      !xApiSummary.includes('const errorCode = "official_usage_request_failed"') ||
      xApiSummary.includes("raw: parsed") ||
      xApiSummary.includes("e instanceof Error ? e.message") ||
      xApiSummary.includes("String(e)")) {
    fail(`${label}: official X usage failures must use bounded status/stable codes without raw provider text`);
  }
  const rescoreRead = rescore;
  if (!rescoreRead.includes('error: "rescore_posts_read_failed"') ||
      rescoreRead.includes("(fetchErr as { message?: string }).message")) {
    fail(`${label}: rescore read failures must use a stable code`);
  }
  if (!source.includes("function boundedHttpStatus(value: unknown): number") ||
      !source.includes("function maintenanceFailureCode(operation: string, status?: unknown): string")) {
    fail(`${label}: maintenance provider failure helpers are missing`);
  }
  if (!follower.includes('return { body: { ok: false, error: "followers_snapshot_config_missing" }, status: 503 };') ||
      !follower.includes('error: maintenanceFailureCode("followers_snapshot", resp.status),') ||
      !follower.includes('error: "followers_snapshot_request_failed"') ||
      follower.includes("text.slice(0, 300)") || follower.includes("raw: parsed") ||
      follower.includes("error: (e as Error).message")) {
    fail(`${label}: follower snapshot failures must use stable bounded codes without raw response/error text`);
  }
  if (!xPosting.includes("const { data: pending, error: pendingError } = await table(supabase, \"jobs\")") ||
      !xPosting.includes("if (pendingError) throw pendingError;") ||
      !xPosting.includes('hydrate_pending_jobs_invalid_response')) {
    fail(`${label}: hydration pending-job admission must fail closed on unknown reads`);
  }
  if (!xPosting.includes("const { data: xPostingRow, error: xPostingConfigError } = await table(supabase, \"settings\").select(") ||
      !xPosting.includes("if (\n    xPostingConfigError ||") ||
      !xPosting.includes("x_posting_config_unavailable") ||
      !xPosting.includes("xPostingRow === null")) {
    fail(`${label}: X posting configuration admission must fail closed on unknown or malformed reads`);
  }
  if (!xPosting.includes("const { data: existing, error: existingError } = await table(supabase, \"posts\")") ||
      !xPosting.includes("if (existingError) {") ||
      !xPosting.includes("x_post_preflight_read_failed")) {
    fail(`${label}: X retry post preflight must fail closed on unknown reads`);
  }
  if (!xPosting.includes("const { data: afterPrep, error: afterPrepError } = await table(supabase, \"posts\")") ||
      !xPosting.includes("if (afterPrepError ||") ||
      !xPosting.includes("x_post_preflight_read_failed")) {
    fail(`${label}: post-rescore preflight must fail closed on unknown reads`);
  }
  const rehydrateStart = xPosting.indexOf("export async function rehydrateRecentTruncatedAdminAction(");
  if (rehydrateStart < 0) fail(`${label}: truncated hydration backfill action marker is missing`);
  const rehydrate = xPosting.slice(rehydrateStart);
  for (const marker of [
    "const { data: controlsRow, error: controlsError } = await table(supabase, \"settings\").select(",
    "if (controlsError) throw new Error(\"hydrate_backfill_controls_read_failed\");",
    "hydrate_backfill_posts_invalid_response",
    "const { data: existingJob, error: existingJobError } = await table(supabase, \"jobs\")",
    "if (existingJobError) {",
    "hydrate_backfill_pending_job_read_failed",
    "if (!Array.isArray(existingJob)) {",
    "hydrate_backfill_pending_job_invalid_response",
    '"hydrate_backfill_posts_read_failed"',
    '"hydrate_backfill_post_update_failed"',
    '"hydrate_backfill_enqueue_failed"',
  ]) if (!rehydrate.includes(marker)) fail(`${label}: missing truncated hydration backfill guard ${marker}`);
  if (rehydrate.includes("errorMessage(") || rehydrate.includes("errors.push(`")) {
    fail(`${label}: truncated hydration backfill must not expose raw persistence errors`);
  }
  const controlsGuardIndex = rehydrate.indexOf("if (controlsError)");
  const postGuardIndex = rehydrate.indexOf("hydrate_backfill_posts_invalid_response");
  const existingJobGuardIndex = rehydrate.indexOf("if (existingJobError)");
  if (!(controlsGuardIndex >= 0 && postGuardIndex > controlsGuardIndex && existingJobGuardIndex > postGuardIndex)) {
    fail(`${label}: truncated hydration read guards are out of order`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:maintenance-write"] !== "node scripts/check-maintenance-write-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:maintenance-write")) {
    fail(`${label}: hosted CI command is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    basic: fs.readFileSync(basicPath, "utf8"),
    xPosting: fs.readFileSync(xPostingPath, "utf8"),
    xApiSummary: fs.readFileSync(xApiSummaryPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("MAINTENANCE_WRITE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "if (controlsError) throw controlsError;",
      "if (false) throw controlsError;",
    ),
  }), "follower controls read error bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'if (!Array.isArray(data)) {\n    return {\n      body: { ok: false, error: "stale_x_pending_invalid_response" },',
      "if (false) {\n    return {\n      body: { ok: false, error: \"stale_x_pending_invalid_response\" },",
    ),
  }), "stale-X malformed response bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll(
      '"stale_x_pending_invalid_row"',
      '"stale_x_pending_row_guard_removed"',
    ),
  }), "stale-X malformed row bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      '"rescore_posts_invalid_response"',
      '"rescore_posts_shape_guard_removed"',
    ),
  }), "rescore malformed response bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll(
      '"rescore_posts_invalid_row"',
      '"rescore_posts_row_guard_removed"',
    ),
  }), "rescore malformed row bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'error: "rescore_enqueue_failed",',
      'error: `rescore_enqueue_failed:${errorMessage(error)}`,',
    ),
  }), "rescore enqueue error bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      '"post_pipeline_status_invalid_response"',
      '"post_pipeline_status_shape_guard_removed"',
    ),
  }), "pipeline status malformed response bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      '"post_pipeline_status_invalid_row"',
      '"post_pipeline_status_row_guard_removed"',
    ),
  }), "pipeline status malformed row bypass");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "if (error) throw error;\n  return { body: { success: true, message: \"Learned biases reset\" } };",
      "return { body: { success: true, message: \"Learned biases reset\" } };",
    ),
  }), "learned-bias persistence error bypass");
  assertRejects((source) => ({
    ...source,
    basic: source.basic.replace(
      "if (feedbackLockError) throw feedbackLockError;",
      "if (false) throw feedbackLockError;",
    ),
  }), "feedback-lock persistence error bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (feedbackLockError) throw feedbackLockError;",
      "if (false) throw feedbackLockError;",
    ),
  }), "X retry feedback-lock persistence error bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (pendingError) throw pendingError;",
      "if (false) throw pendingError;",
    ),
  }), "hydration pending-job read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (\n    xPostingConfigError ||",
      "if (false ||",
    ),
  }), "X posting configuration read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace('error: "x_poster_request_failed"', 'error: `x-poster ${resp.status}: ${text.slice(0, 300)}`'),
  }), "X posting raw provider error mutant");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      'code: "x_poster_http_failure",\n          prep,\n        },\n        status: 502,',
      'code: "x_poster_http_failure",\n          prep,\n        },\n        status: 200,',
    ),
  }), "X posting failure success-status mutant");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace('if (parsedObj.ok !== true) {', 'if (false) {'),
  }), "X posting unconfirmed envelope mutant");
  assertRejects((source) => ({
    ...source,
    xApiSummary: source.xApiSummary.replace('officialUsage = resp.ok\n          ? { synced: true, data: parsed }\n          : { synced: false, reason: `official_usage_http_${status}` };', 'officialUsage = resp.ok\n          ? { synced: true, data: parsed }\n          : { synced: false, reason: `HTTP ${resp.status}`, raw: parsed };'),
  }), "official X usage raw provider error mutant");
  assertRejects((source) => ({
    ...source,
    xApiSummary: source.xApiSummary.replace('const errorCode = "official_usage_request_failed";', 'const errorCode = e instanceof Error ? e.message : String(e);'),
  }), "official X usage transport raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'error: maintenanceFailureCode("followers_snapshot", resp.status),',
      'error: text.slice(0, 300), raw: parsed,',
    ),
  }), "follower snapshot raw provider error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'return { body: { ok: false, error: "followers_snapshot_request_failed" }, status: 502 };',
      'return { body: { ok: false, error: (e as Error).message }, status: 502 };',
    ),
  }), "follower snapshot transport raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      'error: "rescore_posts_read_failed",',
      'error: (fetchErr as { message?: string }).message,',
    ),
  }), "rescore read raw error mutant");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (existingError) {",
      "if (false) {",
    ),
  }), "X retry preflight read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (afterPrepError ||",
      "if (false ||",
    ),
  }), "post-rescore preflight read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (controlsError) throw new Error(\"hydrate_backfill_controls_read_failed\");",
      "if (false) throw new Error(\"hydrate_backfill_controls_read_failed\");",
    ),
  }), "truncated hydration controls read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "hydrate_backfill_posts_invalid_response",
      "hydrate_backfill_posts_shape_guard_removed",
    ),
  }), "truncated hydration posts shape bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (existingJobError) {",
      "if (false) {",
    ),
  }), "truncated hydration pending-job read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (!Array.isArray(existingJob)) {",
      "if (false) {",
    ),
  }), "truncated hydration pending-job shape bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (settingsRows.error) {",
      "if (false) {",
    ),
  }), "X diagnostics settings read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (candidateRes.error) {",
      "if (false) {",
    ),
  }), "X diagnostics candidate read bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (settingsRows.data.some((row) =>",
      "if (false && settingsRows.data.some((row) =>",
    ),
  }), "X diagnostics settings row-shape bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "if (!Array.isArray(posts)) {",
      "if (false) {",
    ),
  }), "X diagnostics post shape bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      '"hydrate_backfill_posts_read_failed"',
      'errorMessage(fetchErr)',
    ),
  }), "truncated hydration raw read error");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      'errors.push("hydrate_backfill_post_update_failed");',
      'errors.push(`update ${tweetId}: ${errorMessage(upErr)}`);',
    ),
  }), "truncated hydration raw update error");
}

console.log(`MAINTENANCE_WRITE_SOURCE_CONTRACT_PASS followerAdmission=failClosed learnedBiasReset=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
