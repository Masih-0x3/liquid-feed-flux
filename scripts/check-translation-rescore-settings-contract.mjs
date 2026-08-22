import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  action: path.join(repoRoot, "supabase/functions/admin-actions/translationRescoreActions.ts"),
  scoring: path.join(repoRoot, "supabase/functions/admin-actions/scoringActions.ts"),
  threshold: path.join(repoRoot, "supabase/functions/admin-actions/activeThreshold.ts"),
  xPosting: path.join(repoRoot, "supabase/functions/admin-actions/xPostingActions.ts"),
  packageJson: path.join(repoRoot, "package.json"),
  ci: path.join(repoRoot, ".github/workflows/ci.yml"),
};

function fail(message) {
  throw new Error(`TRANSLATION_RESCORE_SETTINGS_SOURCE_CONTRACT_FAIL ${message}`);
}

function parse(source, filePath, label) {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail(`${label} parse diagnostics`);
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`${label} transpilation diagnostics`);
  }
}

function parseAction(source) {
  parse(source, paths.action, "translation rescore");
}

function parseScoring(source) {
  parse(source, paths.scoring, "scoring actions");
}

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, "utf8")]));
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} is missing: ${needle}`);
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract(source, label = "current source") {
  parseAction(source.action);
  parseScoring(source.scoring);
  parse(source.threshold, paths.threshold, "active threshold");
  parse(source.xPosting, paths.xPosting, "X posting actions");
  assertIncludes(source.action, "function checkedSettingsRows(value: unknown): Array<Record<string, unknown>>", `${label}: settings shape helper`);
  assertIncludes(source.action, 'throw new Error("scoring_settings_invalid_response");', `${label}: settings shape failure`);
  assertIncludes(source.action, 'const { data: settings, error: settingsError } = await table(supabase, "settings")', `${label}: retained settings error`);
  assertIncludes(source.action, 'if (settingsError) return { ok: false, error: "scoring_settings_read_failed" };', `${label}: rescore settings error gate`);
  assertIncludes(source.action, 'if (settingsError) return { ok: false, error: "translation_settings_read_failed" };', `${label}: translation settings error gate`);
  assertIncludes(source.action, "settingsRows = checkedSettingsRows(settings);", `${label}: checked settings rows adoption`);
  assertIncludes(source.scoring, "function checkedSettingValue(", `${label}: scoring setting value helper`);
  assertIncludes(source.scoring, "if (error) throw new Error(failureCode);", `${label}: scoring setting read error gate`);
  assertIncludes(source.scoring, "if (typeof data !== \"object\" || Array.isArray(data)) {", `${label}: scoring setting row shape condition`);
  assertIncludes(source.scoring, "if (!value || typeof value !== \"object\" || Array.isArray(value)) {", `${label}: scoring setting value shape condition`);
  assertIncludes(source.scoring, '"scoring_policy_settings_read_failed"', `${label}: scoring policy failure code`);
  assertIncludes(source.scoring, '"scoring_model_settings_read_failed"', `${label}: scoring model failure code`);
  assertIncludes(source.threshold, 'if (error) throw new Error("active_threshold_settings_read_failed");', `${label}: active threshold read error gate`);
  assertIncludes(source.threshold, 'if (!Array.isArray(settings)) {', `${label}: active threshold response shape gate`);
  assertIncludes(source.threshold, 'active_threshold_settings_invalid_row', `${label}: active threshold row shape gate`);
  assertIncludes(source.threshold, 'export async function loadActiveThreshold(supabase: unknown): Promise<number>', `${label}: active threshold client must not use any`);
  assertIncludes(source.threshold, 'active_threshold_client_invalid', `${label}: active threshold client shape gate`);
  assertIncludes(source.threshold, 'active_threshold_query_invalid', `${label}: active threshold query shape gate`);
  assertIncludes(source.xPosting, "loadActiveThreshold(supabase),", `${label}: diagnostics must not default threshold after read failure`);
  assertIncludes(source.action, 'return status > 0 ? `openai_http_${status}` : "openai_request_failed";', `${label}: OpenAI provider failures must use bounded codes`);
  assertIncludes(source.action, "function safeUsageSnapshot(raw: unknown): Record<string, number> | null", `${label}: preview usage must use an allowlisted snapshot`);
  assertIncludes(source.action, 'const raw = { error: { code: "openai_request_failed" } };', `${label}: thrown OpenAI telemetry must not carry exception text`);
  const preview = section(
    source.action,
    "export async function previewTranslationAdminAction(",
    "export async function rescorePostAdminAction(",
    `${label}: translation preview action`,
  );
  for (const marker of [
    'result: { endpoint: usedEndpoint },',
    'error: "classifier_schema_invalid",',
    'reasoning = "classifier_tool_call_invalid";',
    'const errorCode = "translation_preview_request_failed";',
    'return { body: { ok: false, error: errorCode }, status: 502 };',
  ]) if (!preview.includes(marker)) fail(`${label}: missing bounded preview marker ${marker}`);
  if (preview.includes("result: { raw") || preview.includes("raw,\n") ||
      preview.includes("(e as Error).message") || preview.includes("respText.slice") ||
      preview.includes("rawText.slice")) {
    fail(`${label}: translation preview must not forward raw provider or exception text`);
  }
  for (const marker of [
    'error: "scoring_classifier_schema_invalid",',
    'error: "scoring_tool_call_invalid",',
    'error: "rescore_post_update_failed"',
    'error: "translation_post_read_failed"',
    'error: "translation_post_update_failed"',
  ]) if (!source.action.includes(marker)) fail(`${label}: missing bounded rescore/translation marker ${marker}`);
  if (source.action.includes("Invalid classifier_tool_schema JSON:") ||
      source.action.includes("Tool-call parse error:") ||
      source.action.includes("(upErr as { message?: string }).message")) {
    fail(`${label}: rescore/translation failures must not expose raw exception/database text`);
  }
  const packageData = JSON.parse(source.packageJson);
  if (packageData.scripts?.["check:translation-rescore-settings"] !== "node scripts/check-translation-rescore-settings-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  assertIncludes(source.ci, "- run: npm run check:translation-rescore-settings", `${label}: hosted CI contract`);
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    action: source.action.replaceAll(
      'if (settingsError) return { ok: false, error: "scoring_settings_read_failed" };',
      "if (false) return { ok: false, error: 'ignored' };",
    ),
  }), "rescore settings error bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'if (settingsError) return { ok: false, error: "translation_settings_read_failed" };',
      "if (false) return { ok: false, error: 'ignored' };",
    ),
  }), "translation settings error bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replaceAll(
      "settingsRows = checkedSettingsRows(settings);",
      "settingsRows = Array.isArray(settings) ? settings as Array<Record<string, unknown>> : [];",
    ),
  }), "malformed settings shape bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      "throw new Error(\"scoring_settings_invalid_response\");",
      "return [];",
    ),
  }), "settings shape failure removal");
  assertRejects((source) => ({
    ...source,
    scoring: source.scoring.replace(
      "if (error) throw new Error(failureCode);",
      "if (false) throw new Error(failureCode);",
    ),
  }), "scoring setting read error bypass");
  assertRejects((source) => ({
    ...source,
    scoring: source.scoring.replace(
      "if (typeof data !== \"object\" || Array.isArray(data)) {",
      "if (false) {",
    ),
  }), "scoring setting shape bypass");
  assertRejects((source) => ({
    ...source,
    threshold: source.threshold.replace(
      'if (error) throw new Error("active_threshold_settings_read_failed");',
      "if (false) throw error;",
    ),
  }), "active threshold read error bypass");
  assertRejects((source) => ({
    ...source,
    threshold: source.threshold.replace(
      'export async function loadActiveThreshold(supabase: unknown): Promise<number>',
      'export async function loadActiveThreshold(supabase: any): Promise<number>',
    ),
  }), "active threshold any client boundary");
  assertRejects((source) => ({
    ...source,
    threshold: source.threshold.replaceAll(
      'throw new Error("active_threshold_client_invalid");',
      "return supabase as any;",
    ),
  }), "active threshold client guard removal");
  assertRejects((source) => ({
    ...source,
    threshold: source.threshold.replace(
      "if (!Array.isArray(settings)) {",
      "if (false) {",
    ),
  }), "active threshold response shape bypass");
  assertRejects((source) => ({
    ...source,
    xPosting: source.xPosting.replace(
      "loadActiveThreshold(supabase),",
      "loadActiveThreshold(supabase).catch(() => 14),",
    ),
  }), "diagnostic threshold default bypass");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'return status > 0 ? `openai_http_${status}` : "openai_request_failed";',
      'return `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}`;',
    ),
  }), "preview raw provider error helper mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'result: { endpoint: usedEndpoint },',
      'result: { raw: result.raw, endpoint: usedEndpoint },',
    ),
  }), "preview raw failure response mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'return { body: { ok: false, error: errorCode }, status: 502 };',
      'return { body: { ok: false, error: (e as Error).message }, status: 502 };',
    ),
  }), "preview raw catch error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'const raw = { error: { code: "openai_request_failed" } };',
      'const raw = { error: { message: String(_error) } };',
    ),
  }), "thrown OpenAI raw exception telemetry mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "rescore_post_update_failed"',
      'error: (upErr as { message?: string }).message',
    ),
  }), "rescore update raw database error mutant");
  assertRejects((source) => ({
    ...source,
    action: source.action.replace(
      'error: "translation_post_update_failed"',
      'error: (upErr as { message?: string }).message',
    ),
  }), "translation update raw database error mutant");
}

console.log(`TRANSLATION_RESCORE_SETTINGS_SOURCE_CONTRACT_PASS readErrors=failClosed rowShapes=checked selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
