import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  dedupe: path.join(repoRoot, "supabase/functions/_shared/dedupe.ts"),
  guard: path.join(repoRoot, "supabase/functions/_shared/deliveryDedupeGuard.ts"),
  worker: path.join(repoRoot, "supabase/functions/worker/index.ts"),
  xPoster: path.join(repoRoot, "supabase/functions/x-poster/index.ts"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`FINAL_DEDUPE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, filePath, label) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail(`${label} parse diagnostics`);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label} transpilation diagnostics`);
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function count(source, marker) {
  return source.split(marker).length - 1;
}

function assertContract({ dedupe, guard, worker, xPoster, packageJson, ci }, label = "current source") {
  parse(dedupe, paths.dedupe, `${label} dedupe`);
  parse(guard, paths.guard, `${label} delivery guard`);
  parse(worker, paths.worker, `${label} worker`);
  parse(xPoster, paths.xPoster, `${label} x-poster`);

  if (!dedupe.includes('outcome: "disabled" | "allowed" | "blocked" | "unknown";')) {
    fail(`${label}: final assertion must expose an explicit unknown outcome`);
  }
  const assertion = section(
    dedupe,
    "export async function assertFinalDuplicateState(",
    "\nasync function preventUncoveredDuplicateSkip",
    `${label} final assertion`,
  );
  if (!assertion.includes('outcome: "unknown",\n        reason: safeDedupeErrorCode(e, "final_assertion_embedding_failed"),') ||
      !assertion.includes('reason: "final_assertion_openai_key_missing",')) {
    fail(`${label}: embedding/provider failures must be marked unknown`);
  }
  if (!assertion.includes('outcome: result.status === "duplicate"') ||
      !assertion.includes('? "blocked"') ||
      !assertion.includes('? "unknown"')) {
    fail(`${label}: final result failures must not become allowed outcomes`);
  }
  if (!assertion.includes('if (coverage.state === "unknown") {') ||
      !assertion.includes('reason: `dedupe_coverage_unknown:${coverage.reason}`,')) {
    fail(`${label}: unknown canonical coverage must remain an unknown assertion`);
  }

  const preventCoverage = section(
    dedupe,
    "async function preventUncoveredDuplicateSkip(",
    "async function loadDuplicateCoverage(",
    `${label} duplicate coverage transition`,
  );
  if (!preventCoverage.includes('if (coverage.state === "unknown") {') ||
      !preventCoverage.includes('status: "failed"') ||
      !preventCoverage.includes('failure_phase: "coverage_check"') ||
      !preventCoverage.includes('retryable: true')) {
    fail(`${label}: unknown canonical coverage must fail the duplicate gate closed`);
  }

  const coverageLoader = section(
    dedupe,
    "async function loadDuplicateCoverage(",
    "function isActiveStatusValue",
    `${label} duplicate coverage loader`,
  );
  for (const marker of [
    "error: telegramError",
    "error: xError",
    "error: jobError",
    "if (postError || telegramError || xError || jobError)",
    'if (!Array.isArray(telegramRows) || !Array.isArray(xRows) || !Array.isArray(jobRows)) {',
    'reason: "canonical_coverage_lookup_failed",',
    'reason: "canonical_coverage_invalid_response",',
    "const telegramStatuses = readCoverageStatuses(telegramRows);",
    "const xStatuses = readCoverageStatuses(xRows);",
    "const jobStatuses = readCoverageStatuses(jobRows);",
    "if (!telegramStatuses || !xStatuses || !jobStatuses) {",
    'reason: "canonical_coverage_invalid_row",',
    'if (!row || typeof row !== "object" || Array.isArray(row)) return null;',
    'if (typeof status !== "string" || status.trim().length === 0) return null;',
  ]) {
    if (!coverageLoader.includes(marker)) {
      fail(`${label}: coverage loader must fail closed on ${marker}`);
    }
  }

  if (!guard.includes('if (finalAssertion.outcome === "unknown") {') ||
      !guard.includes('return failDecision(source, "dedupe_assertion_unknown");') ||
      !guard.includes('return failDecision(source, "dedupe_state_lookup_failed");') ||
      !guard.includes("supabase: unknown;") ||
      !guard.includes("function checkedDedupeLookupClient(client: unknown): DedupeLookupClient | null") ||
      !guard.includes("const lookupClient = checkedDedupeLookupClient(params.supabase);") ||
      guard.includes("error.message") ||
      guard.includes("(e as Error).message")) {
    fail(`${label}: delivery dedupe guard must fail closed on unknown assertions`);
  }

  const workerHandler = section(
    worker,
    "async function handleDeliverJob(",
    "\n// ─── handleEnrichJob",
    `${label} delivery handler`,
  );
  const finalGuard = section(
    workerHandler,
    "if (finalGuard.action === \"fail\") {",
    "    const renderGate = await prepareVideoRenderGate(",
    `${label} delivery final guard`,
  );
  if (!finalGuard.includes('throw new JobDeferred(\n        "telegram_dedupe_assertion_failed",')) {
    fail(`${label}: delivery dedupe assertion failures must defer explicitly`);
  }
  if (finalGuard.includes("return false;")) {
    fail(`${label}: delivery dedupe assertion failures must not return false`);
  }

  const observed = section(
    dedupe,
    "export function observedDedupeOpenAI(",
    "export const DEFAULT_DUPLICATE_GATE",
    `${label} dedupe provider observation`,
  );
  if (!observed.includes('dedupe_openai_request_failed') ||
      !observed.includes("throw new Error(\"dedupe_openai_request_failed\")") ||
      !observed.includes('dedupeHttpFailureCode("dedupe_ai", response.status)') ||
      !observed.includes('raw: { error: { code } }') ||
      observed.includes("throw error;")) {
    fail(`${label}: dedupe OpenAI failures must use a stable redacted error`);
  }

  const normalizer = section(
    dedupe,
    "function safeDedupeErrorCode(",
    "function thrownDedupeOpenAIResponse(",
    `${label} dedupe error normalizer`,
  );
  if (!normalizer.includes('message === "dedupe_openai_request_failed"') ||
      !normalizer.includes('message === prefix || message.startsWith(`${prefix}:`)') ||
      !normalizer.includes('message === "embedding_quota_exhausted"')) {
    fail(`${label}: exact dedupe stable codes must survive normalization`);
  }

  const embedding = section(
    dedupe,
    "async function fetchStoryEmbeddingResult(",
    "function embeddingErrorStatus",
    `${label} dedupe embedding provider`,
  );
  if (!embedding.includes('dedupeHttpFailureCode("embedding", resp.status)') ||
      !embedding.includes('embedding_quota_exhausted') ||
      !embedding.includes('embedding_invalid_json') ||
      !embedding.includes('embedding_missing_embedding') ||
      embedding.includes("rawText.slice")) {
    fail(`${label}: embedding failures must be stable and body-redacted`);
  }
  const observedEmbedding = section(
    dedupe,
    "export async function fetchObservedStoryEmbedding(",
    "export async function runDuplicateGate(",
    `${label} observed dedupe embedding`,
  );
  if (!observedEmbedding.includes('error: safeDedupeErrorCode(error, "embedding_failed")') ||
      observedEmbedding.includes("error,\n        spanEstimate")) {
    fail(`${label}: embedding telemetry must use a stable error code`);
  }

  const adjudicator = section(
    dedupe,
    "async function adjudicateWithModel(",
    "function readOpenAiApiKey",
    `${label} dedupe adjudicator provider`,
  );
  if (!adjudicator.includes('dedupeHttpFailureCode("dedupe_ai", result.status)') ||
      !adjudicator.includes('dedupe_ai_invalid_tool_json') ||
      adjudicator.includes("rawText.slice") ||
      adjudicator.includes("(e as Error).message")) {
    fail(`${label}: adjudicator failures must be stable and body-redacted`);
  }

  const persistence = section(
    dedupe,
    "async function findExactUrlDuplicate(",
    "function clamp(",
    `${label} dedupe persistence helpers`,
  );
  for (const stableCode of [
    "exact_url_lookup_failed",
    "find_story_candidates_v3_failed",
    "story_signature_upsert_failed",
    "dedupe_post_update_failed",
    "dedupe_event_insert_failed",
  ]) {
    if (!persistence.includes(stableCode)) {
      fail(`${label}: missing stable dedupe persistence code ${stableCode}`);
    }
  }
  if (persistence.includes("error.message") || persistence.includes("err.message")) {
    fail(`${label}: dedupe persistence helpers must not expose provider/database messages`);
  }
  const signature = section(
    dedupe,
    "async function upsertStorySignature(",
    "async function upsertBareStorySignature(",
    `${label} story signature persistence`,
  );
  if (!signature.includes('const { error: coverageCountError } = await supabase.rpc(') ||
      !signature.includes("if (coverageCountError) {") ||
      count(signature, 'error: "dedupe_coverage_count_update_failed"') !== 2 ||
      signature.includes(".then(() => null, () => null)")) {
    fail(`${label}: duplicate coverage-count RPC failures must be checked and redacted`);
  }
  const dedupeEvent = section(
    dedupe,
    "async function insertDedupeEvent(",
    "function clamp(",
    `${label} dedupe event persistence`,
  );
  if (!dedupeEvent.includes("try {") ||
      !dedupeEvent.includes("if (error) {") ||
      dedupeEvent.split('error: "dedupe_event_insert_failed"').length - 1 !== 2 ||
      dedupeEvent.includes(".then(() => null, () => null)")) {
    fail(`${label}: dedupe event failures must be checked and redacted in both strict and best-effort modes`);
  }

  const duplicateGate = section(
    dedupe,
    "export async function runDuplicateGate(",
    "export async function assertFinalDuplicateState(",
    `${label} duplicate gate boundary`,
  );
  if (!duplicateGate.includes("const message = safeDedupeErrorCode(e);") ||
      duplicateGate.includes("const message = (e as Error).message;")) {
    fail(`${label}: duplicate-gate result/event errors must use a stable code`);
  }

  const observedAssertion = section(
    xPoster,
    "async function assertObservedFinalDuplicateState(",
    "\n// deno-lint-ignore no-explicit-any",
    `${label} observed x-poster assertion`,
  );
  if (!observedAssertion.includes("if (result.outcome === 'unknown')") ||
      !observedAssertion.includes("dedupe_assertion_unknown:")) {
    fail(`${label}: x-poster must refuse unknown final assertions before provider admission`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:final-dedupe-fail-closed"] !==
      "node scripts/check-final-dedupe-fail-closed-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:final-dedupe-fail-closed")) {
    fail(`${label}: hosted CI command is missing`);
  }
}

function sources() {
  return Object.fromEntries(
    Object.entries(paths).map(([key, filePath]) => [
      key,
      fs.readFileSync(filePath, "utf8"),
    ]),
  );
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("FINAL_DEDUPE_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'outcome: "unknown",\n        reason: safeDedupeErrorCode(e, "final_assertion_embedding_failed"),',
      'outcome: "allowed",\n        reason: safeDedupeErrorCode(e, "final_assertion_embedding_failed"),',
    ),
  }), "embedding failure allowed mutant");
  assertRejects((source) => ({
    ...source,
    guard: source.guard.replace(
      'if (finalAssertion.outcome === "unknown") {',
      'if (false) {',
    ),
  }), "delivery guard unknown bypass mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (coverage.state === "unknown") {',
      'if (false) {',
    ),
  }), "final assertion coverage-unknown bypass mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (postError || telegramError || xError || jobError)',
      'if (postError)',
    ),
  }), "coverage subquery error ignored mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      "if (coverageCountError) {",
      "if (false) {",
    ),
  }), "coverage-count returned error guard removal");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'error: "dedupe_coverage_count_update_failed",',
      "error: coverageCountError.message,",
    ),
  }), "coverage-count raw error diagnostic mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      "if (error) {\n      if (options.throwOnError)",
      "if (false) {\n      if (options.throwOnError)",
    ),
  }), "dedupe event returned error guard removal");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'error: "dedupe_event_insert_failed",',
      "error: error.message,",
    ),
  }), "dedupe event raw error diagnostic mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (!Array.isArray(telegramRows) || !Array.isArray(xRows) || !Array.isArray(jobRows)) {',
      'if (false) {',
    ),
  }), "coverage malformed response bypass mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (!telegramStatuses || !xStatuses || !jobStatuses) {',
      'if (false) {',
    ),
  }), "coverage malformed row bypass mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (!row || typeof row !== "object" || Array.isArray(row)) return null;',
      'if (false) return null;',
    ),
  }), "coverage row shape bypass mutant");
  assertRejects((source) => ({
    ...source,
    guard: source.guard.replace(
      'return failDecision(source, "dedupe_assertion_unknown");',
      'return failDecision(source, `dedupe_assertion_unknown:${finalAssertion.reason}`);',
    ),
  }), "delivery guard raw assertion reason mutant");
  assertRejects((source) => ({
    ...source,
    guard: source.guard.replace(
      "supabase: unknown;",
      "supabase: any;",
    ),
  }), "delivery guard any client boundary mutant");
  assertRejects((source) => ({
    ...source,
    guard: source.guard.replace(
      "const lookupClient = checkedDedupeLookupClient(params.supabase);",
      "const lookupClient = params.supabase;",
    ),
  }), "delivery guard client validation bypass mutant");
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new JobDeferred(\n        "telegram_dedupe_assertion_failed",',
      'return false;\n      // removed defer',
    ),
  }), "worker dedupe defer removal mutant");
  assertRejects((source) => ({
    ...source,
    xPoster: source.xPoster.replace(
      "if (result.outcome === 'unknown') {",
      "if (false) {",
    ),
  }), "x-poster unknown assertion bypass mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'throw new Error("dedupe_openai_request_failed");',
      'throw error;',
    ),
  }), "dedupe OpenAI raw error mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'raw: { error: { code } },',
      'raw: response.raw,',
    ),
  }), "dedupe OpenAI response raw body mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'throw new Error(dedupeHttpFailureCode("embedding", resp.status));',
      'throw new Error(`embedding_http_${resp.status}:${rawText.slice(0, 200)}`);',
    ),
  }), "dedupe embedding raw body mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'error: safeDedupeErrorCode(error, "embedding_failed"),',
      'error,',
    ),
  }), "dedupe embedding telemetry raw error mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      "const message = safeDedupeErrorCode(e);",
      "const message = (e as Error).message;",
    ),
  }), "dedupe gate raw error mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'throw new Error("dedupe_post_update_failed");',
      'throw new Error(`dedupe_post_update_failed:${error.message}`);',
    ),
  }), "dedupe persistence raw error mutant");
  assertRejects((source) => ({
    ...source,
    dedupe: source.dedupe.replace(
      'if (message === prefix || message.startsWith(`${prefix}:`)) return prefix;',
      'if (message.startsWith(`${prefix}:`)) return prefix;',
    ),
  }), "dedupe exact code normalization mutant");
}

console.log(
  `FINAL_DEDUPE_FAIL_CLOSED_SOURCE_CONTRACT_PASS unknownOutcome=true workerDefer=true xPosterRefusal=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
