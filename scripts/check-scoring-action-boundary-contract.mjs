import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  action: path.join(repoRoot, "supabase/functions/admin-actions/scoringActions.ts"),
  policy: path.join(repoRoot, "supabase/functions/_shared/scoringPolicy.ts"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`SCORING_ACTION_BOUNDARY_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, filePath, label) {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label} parse diagnostics`);
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label} transpilation diagnostics`);
  }
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]));
}

function assertIncludes(source, marker, label) {
  if (!source.includes(marker)) fail(`${label} is missing: ${marker}`);
}

function assertContract(source, label = "current source") {
  parse(source.action, paths.action, "scoring actions");
  parse(source.policy, paths.policy, "scoring policy");

  for (const marker of [
    '"scoring_example_post_read_failed"',
    '"scoring_example_insert_failed"',
    'throw new Error("scoring_calibration_read_failed");',
    '"manual_score_post_read_failed"',
    '"manual_score_post_update_failed"',
    '"manual_score_blocklist_write_failed"',
    '"manual_score_duplicate_feedback_failed"',
    '"manual_score_feedback_write_failed"',
    '"manual_score_example_write_failed"',
    '"score_feedback_post_update_failed"',
    '"score_feedback_example_write_failed"',
    '"scoring_post_read_failed"',
    '"scoring_policy_failed"',
    '"scoring_post_update_failed"',
    '"scoring_backfill_read_failed"',
    '"scoring_backfill_invalid_response"',
    '"scoring_backfill_invalid_row"',
    '"scoring_backfill_enqueue_failed"',
    '"scoring_eval_read_failed"',
    '"scoring_eval_invalid_response"',
    '"scoring_eval_invalid_row"',
    '"scoring_eval_insert_failed"',
  ]) assertIncludes(source.action, marker, `${label}: scoring action boundary`);
  assertIncludes(
    source.action,
    'if (!Array.isArray(data)) {\n    return { ok: false, error: "scoring_backfill_invalid_response" };',
    `${label}: scoring backfill response guard`,
  );
  assertIncludes(
    source.action,
    'if (!Array.isArray(data)) {\n    return { ok: false, error: "scoring_eval_invalid_response" };',
    `${label}: scoring eval response guard`,
  );

  for (const forbidden of [
    "errorMessage(",
    ".message",
    "String(error)",
    ".then(() => null",
    ".catch(() =>",
  ]) if (source.action.includes(forbidden)) fail(`${label}: scoring action contains raw/fail-open sink ${forbidden}`);

  for (const marker of [
    "function scoringUsageSnapshot(",
    "scoring_openai_http_",
    '"scoring_openai_request_failed"',
    '"invalid_score_tool_json"',
    'audience_reason: "scoring_policy_failed"',
    'error: "scoring_policy_failed"',
    'raw: { usage: scoringUsageSnapshot(scoringResponse.usage) }',
    'adjudication_reason: "scoring_adjudication_failed"',
  ]) assertIncludes(source.policy, marker, `${label}: scoring provider boundary`);
  for (const forbidden of [
    "response.rawText.slice",
    "invalid_score_tool_json:${",
    "String(rawArgs.error)",
    "scoringResponse.raw",
    "adjudicationResponse.raw",
  ]) if (source.policy.includes(forbidden)) fail(`${label}: scoring policy contains raw provider sink ${forbidden}`);

  const packageJson = JSON.parse(source.packageJson);
  if (packageJson.scripts?.["check:scoring-action-boundary"] !== "node scripts/check-scoring-action-boundary-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!source.ci.includes("- run: npm run check:scoring-action-boundary")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("SCORING_ACTION_BOUNDARY_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  for (const [needle, replacement, label] of [
    ['error: "manual_score_post_update_failed"', 'error: errorMessage(upErr)', "manual score update raw error"],
    ['error: "manual_score_feedback_write_failed"', 'error: errorMessage(error)', "manual score feedback raw error"],
    ['error: "scoring_post_update_failed"', 'error: errorMessage(updateError)', "scoring update raw error"],
    ['error: "scoring_backfill_enqueue_failed"', 'error: errorMessage(jobError)', "scoring backfill enqueue raw error"],
    ['error: "scoring_eval_insert_failed"', 'error: errorMessage(insertError)', "scoring eval insert raw error"],
  ]) {
    assertRejects((source) => ({
      ...source,
      action: source.action.replace(needle, replacement),
    }), label);
  }
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'throw new Error("scoring_calibration_read_failed");',
      'return [];',
    ),
  }), "scoring calibration read fail-open");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'if (!Array.isArray(data)) {\n    return { ok: false, error: "scoring_backfill_invalid_response" };',
      'if (false) {\n    return { ok: false, error: "scoring_backfill_invalid_response" };',
    ),
  }), "scoring backfill malformed response bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'if (!Array.isArray(data)) {\n    return { ok: false, error: "scoring_eval_invalid_response" };',
      'if (false) {\n    return { ok: false, error: "scoring_eval_invalid_response" };',
    ),
  }), "scoring eval malformed response bypass");
  assertRejects((source) => ({
    ...source,
    policy: source.policy.replace(
      'return { error: status > 0 ? `scoring_openai_http_${status}` : "scoring_openai_request_failed" };',
      'return { error: `OpenAI ${response.status}: ${response.rawText.slice(0, 500)}` };',
    ),
  }), "scoring provider raw error");
  assertRejects((source) => ({
    ...source,
    policy: source.policy.replace(
      'raw: { usage: scoringUsageSnapshot(scoringResponse.usage) },',
      'raw: { scoring: scoringResponse.raw },',
    ),
  }), "scoring provider raw success envelope");
}

console.log(`SCORING_ACTION_BOUNDARY_SOURCE_CONTRACT_PASS stableErrors=true providerRawRedacted=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
