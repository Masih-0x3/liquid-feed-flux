import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/x-followers-snapshot/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_FOLLOWERS_RESPONSE_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  const parsed = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length > 0) fail(`${label}: TypeScript parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label}: TypeScript transpilation diagnostics`);
  }
  if (!source.includes("function isFollowerUser(value: unknown): value is FollowerUser")) {
    fail(`${label}: follower user shape predicate is missing`);
  }
  if (!source.includes("function safeFollowerErrorCode(error: unknown")) {
    fail(`${label}: follower error sanitizer is missing`);
  }
  if (!source.includes("function followerHttpErrorCode(operation: string, status: unknown): string")) {
    fail(`${label}: follower provider status code helper is missing`);
  }
  for (const marker of [
    "type FollowerSupabaseClient = {",
    "async function getSelfId(supabase: FollowerSupabaseClient,",
    "async function fetchUserPage(supabase: unknown,",
    "function asFollowerRecord(value: unknown): Record<string, unknown>",
  ]) {
    if (!source.includes(marker)) fail(`${label}: typed follower boundary is missing ${marker}`);
  }
  if (source.includes("deno-lint-ignore no-explicit-any")) {
    fail(`${label}: follower snapshot type suppression remains`);
  }
  if (!source.includes("const errorCode = safeFollowerErrorCode(e);")) {
    fail(`${label}: outer follower error boundary must normalize exceptions`);
  }
  if (!source.includes("throw new Error(followerHttpErrorCode('x_followers_users_me', resp.status));") ||
      !source.includes("errorText: followerHttpErrorCode(`x_followers_${endpoint}`, resp.status)")) {
    fail(`${label}: provider failures must use bounded status codes`);
  }
  if (!source.includes("captureEdgeException(safeError,")) {
    fail(`${label}: Sentry must receive the bounded follower error`);
  }
  if (!source.includes("if (!Array.isArray(parsed.data) || !parsed.data.every(isFollowerUser))")) {
    fail(`${label}: provider data must be an array of valid follower users`);
  }
  if (!source.includes("_response_invalid_data")) {
    fail(`${label}: malformed provider data must fail closed`);
  }
  if (!source.includes("if (nextToken !== undefined && nextToken !== null && typeof nextToken !== 'string')")) {
    fail(`${label}: pagination token shape must be validated`);
  }
  if (!source.includes("_response_invalid_pagination")) {
    fail(`${label}: malformed pagination must fail closed`);
  }
  const requiredPersistenceGuards = [
    "const { data: setting, error: settingError }",
    "const { error: selfIdCacheError }",
    "const { data: controlsRow, error: controlsError }",
    "const { data: latestSnap, error: latestSnapshotError }",
    "const { data: recent, error: recentSnapshotError }",
    "const { error: cacheUpsertError }",
    "const { error: partialSnapshotError }",
    "const { error: completeSnapshotError }",
    "const { data: prevSnap, error: prevSnapshotError }",
    "const { error: changesInsertError }",
  ];
  for (const marker of requiredPersistenceGuards) {
    if (!source.includes(marker)) fail(`${label}: missing follower snapshot persistence guard ${marker}`);
  }
  for (const marker of [
    "x_self_id_read_failed'",
    "x_self_id_cache_write_failed'",
    "x_api_controls_read_failed'",
    "follower_snapshot_latest_read_failed'",
    "follower_snapshot_daily_cap_read_failed'",
    "follower_snapshot_daily_cap_result_invalid",
    "followers_cache_upsert_failed'",
    "follower_snapshot_partial_update_failed'",
    "follower_snapshot_complete_update_failed'",
    "follower_snapshot_baseline_read_failed'",
    "follower_changes_insert_failed'",
  ]) {
    if (!source.includes(marker)) fail(`${label}: missing persistence failure marker ${marker}`);
  }
  const helperEnd = source.indexOf("function followerHttpErrorCode(");
  const nonHelperSource = helperEnd > 0
    ? source.slice(0, source.indexOf("function safeFollowerErrorCode(")) + source.slice(helperEnd)
    : source;
  if (nonHelperSource.includes("error.message") || nonHelperSource.includes("text.slice") ||
      nonHelperSource.includes("halted.error") ||
      nonHelperSource.includes("JSON.stringify({ error: (e as Error).message })") ||
      nonHelperSource.includes("captureEdgeException(e,")) {
    fail(`${label}: raw follower provider/database error must not cross logs, Sentry, persistence, or response`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-followers-response"] !== "node scripts/check-x-followers-response-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-followers-response")) {
    fail(`${label}: hosted CI command is missing`);
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
    if (String(error).includes("X_FOLLOWERS_RESPONSE_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("supabase: FollowerSupabaseClient,", "supabase: any,"),
  }), "self-id any boundary mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("supabase: unknown, userId", "supabase: any, userId"),
  }), "provider page any boundary mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("function asFollowerRecord(value: unknown): Record<string, unknown>", "function asFollowerRecord(value: any): Record<string, unknown>"),
  }), "record helper any boundary mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      "if (!Array.isArray(parsed.data) || !parsed.data.every(isFollowerUser))",
      "if (false)",
    ),
  }), "provider data shape guard removal");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      "if (nextToken !== undefined && nextToken !== null && typeof nextToken !== 'string')",
      "if (false)",
    ),
  }), "pagination shape guard removal");
  for (const [needle, label] of [
    ["if (settingError) throw new Error('x_self_id_read_failed');", "self-id read failure guard"],
    ["if (selfIdCacheError) throw new Error('x_self_id_cache_write_failed');", "self-id cache failure guard"],
    ["if (controlsError) throw new Error('x_api_controls_read_failed');", "controls read failure guard"],
    ["if (latestSnapshotError) throw new Error('follower_snapshot_latest_read_failed');", "latest snapshot read failure guard"],
    ["if (recentSnapshotError) throw new Error('follower_snapshot_daily_cap_read_failed');", "daily cap read failure guard"],
    ["if (!Array.isArray(recent)) throw new Error('follower_snapshot_daily_cap_result_invalid');", "daily cap result-shape guard"],
    ["if (cacheUpsertError) throw new Error('followers_cache_upsert_failed');", "cache persistence failure guard"],
    ["if (partialSnapshotError) throw new Error('follower_snapshot_partial_update_failed');", "partial snapshot persistence failure guard"],
    ["if (completeSnapshotError) throw new Error('follower_snapshot_complete_update_failed');", "complete snapshot persistence failure guard"],
    ["if (prevSnapshotError) throw new Error('follower_snapshot_baseline_read_failed');", "baseline read failure guard"],
    ["if (changesInsertError) throw new Error('follower_changes_insert_failed');", "change persistence failure guard"],
  ]) {
    assertRejects((input) => ({
      ...input,
      source: input.source.replace(needle, "console.warn(\"persistence failure ignored\");"),
    }), `${label} removal`);
  }
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("const errorCode = safeFollowerErrorCode(e);", "const errorCode = (e as Error).message;"),
  }), "outer raw error response mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("captureEdgeException(safeError,", "captureEdgeException(e,"),
  }), "outer raw Sentry error mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("throw new Error(followerHttpErrorCode('x_followers_users_me', resp.status));", "throw new Error(`users/me failed: HTTP ${resp.status}: ${text}`);"),
  }), "raw provider response mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace("error: safeFollowerErrorCode(halted.reason, 'follower_snapshot_partial'),", "error: `${halted.reason}: ${(halted.error ?? '').slice(0, 300)}`,"),
  }), "partial snapshot raw provider error mutant");
}

console.log(`X_FOLLOWERS_RESPONSE_SOURCE_CONTRACT_PASS providerPageShape=failClosed paginationShape=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
