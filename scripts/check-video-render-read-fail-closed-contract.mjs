import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/admin-actions/videoRenderActions.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`VIDEO_RENDER_READ_FAIL_CLOSED_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) fail("video render action parse diagnostics");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) fail("video render action transpilation diagnostics");
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  const config = section(source, "export async function loadVideoRenderConfigAdmin", "export async function updateVideoRenderConfigAdmin", `${label} video config loader`);
  if (!config.includes("isVideoRenderConfigEnvelope(data)") || !config.includes("isVideoRenderConfigValue(data?.value)")) fail(`${label}: video config read must validate its envelope/value`);
  if (!config.includes("video_render_config_invalid_response")) fail(`${label}: video config malformed reads must fail closed`);
  const update = section(source, "export async function updateVideoRenderConfigAdmin", "export async function getVideoRenderOverview", `${label} video config update`);
  if (!update.includes("error: existingError") || !update.includes("if (existingError)")) fail(`${label}: video config update must retain previous-read errors`);
  if (!update.includes("video_render_config_read_failed")) fail(`${label}: video config update read failures must be explicit`);
  if (!update.includes("video_render_config_invalid_response")) fail(`${label}: video config update malformed reads must fail closed`);
  const overview = section(source, "export async function getVideoRenderOverview", "export function normalizeVideoRenderStatuses", `${label} video overview`);
  if (!overview.includes("validateVideoRenderRows(rendersRes.data)") || !overview.includes("validateVideoRenderRows(issuesRes.data)") || !overview.includes("validateVideoRenderRows(heartbeatRes.data)")) fail(`${label}: overview reads must validate all row arrays`);
  if (!overview.includes("video_render_overview_invalid_response")) fail(`${label}: overview malformed reads must fail closed`);
  const queue = section(source, "export async function getVideoRenderQueue", "export async function getVideoRenderDetail", `${label} video queue`);
  if (!queue.includes("validateVideoRenderRowsWithFields(") || !queue.includes("['id', 'tweet_id', 'source_media_id']")) fail(`${label}: queue render rows must validate required identity fields`);
  if (!queue.includes("video_render_queue_invalid_response")) fail(`${label}: queue malformed render rows must fail closed`);
  if (!queue.includes("video_render_queue_related_invalid_response") ||
      !queue.includes("const postRows = validateVideoRenderRowsWithFields(postsRes.data, ['tweet_id']);") ||
      !queue.includes("const mediaRows = validateVideoRenderRowsWithFields(mediaRes.data, ['id']);") ||
      !queue.includes("const feedbackRows = validateVideoRenderRowsWithFields(feedbackRes.data, ['render_id']);")) {
    fail(`${label}: queue related rows must validate identity envelopes`);
  }
  const detail = section(source, "export async function getVideoRenderDetail", "export async function retryVideoRenderAdmin", `${label} video detail`);
  if (!detail.includes("video_render_detail_invalid_response") ||
      !detail.includes("validateVideoRenderRowsWithFields(") ||
      !detail.includes("['id', 'tweet_id', 'source_media_id']")) fail(`${label}: detail malformed rows must fail closed`);
  if (!detail.includes("isNullableVideoRenderRecord(postRes.data)") ||
      !detail.includes("isNullableVideoRenderRecord(mediaRes.data)") ||
      !detail.includes("video_render_detail_related_invalid_response") ||
      !detail.includes("const feedbackRows = validateVideoRenderRowsWithFields(feedbackRes.data, ['id']);")) {
    fail(`${label}: detail related rows must fail closed while preserving nullable post/media rows`);
  }
  const retry = section(source, "export async function retryVideoRenderAdmin", "export async function setVideoRenderReviewedAdmin", `${label} video retry`);
  if (!retry.includes("if (configRow.error) return { ok: false, error: 'video_render_config_read_failed' };") ||
      !retry.includes("video_render_config_invalid_response") ||
      !retry.includes("isVideoRenderConfigEnvelope(configRow.data)")) {
    fail(`${label}: retry must fail closed before queue admission when config is unknown`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:video-render-read-fail-closed"] !== "node scripts/check-video-render-read-fail-closed-contract.mjs") fail(`${label}: package script is missing`);
  if (!ci.includes("- run: npm run check:video-render-read-fail-closed")) fail(`${label}: hosted CI contract is missing`);
}

function sources() {
  return { source: fs.readFileSync(sourcePath, "utf8"), packageJson: fs.readFileSync(packagePath, "utf8"), ci: fs.readFileSync(ciPath, "utf8") };
}

function assertRejects(mutator, label) {
  try { assertContract(mutator(sources()), label); } catch (error) {
    if (String(error).includes("VIDEO_RENDER_READ_FAIL_CLOSED_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());
if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({ ...source, source: source.source.replace("isVideoRenderConfigEnvelope(data)", "true") }), "config envelope bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("isVideoRenderConfigValue(data?.value)", "true") }), "config value bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("if (existingError) return { ok: false, error: 'video_render_config_read_failed' };", "if (false) return { ok: false, error: 'video_render_config_read_failed' };") }), "config update read bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("video_render_overview_invalid_response", "video_render_overview_shape_guard_removed") }), "overview shape bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("video_render_queue_invalid_response", "video_render_queue_shape_guard_removed") }), "queue shape bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("video_render_queue_related_invalid_response", "video_render_queue_related_shape_guard_removed") }), "queue related shape bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("video_render_detail_invalid_response", "video_render_detail_shape_guard_removed") }), "detail shape bypass");
  assertRejects((source) => ({ ...source, source: source.source.replaceAll("video_render_detail_related_invalid_response", "video_render_detail_related_shape_guard_removed") }), "detail related shape bypass");
  assertRejects((source) => ({ ...source, source: source.source.replace("if (configRow.error) return { ok: false, error: 'video_render_config_read_failed' };", "if (false) return { ok: false, error: 'video_render_config_read_failed' };") }), "retry config read bypass");
}

console.log(`VIDEO_RENDER_READ_FAIL_CLOSED_SOURCE_CONTRACT_PASS config=true overview=true queue=true detail=true retry=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
