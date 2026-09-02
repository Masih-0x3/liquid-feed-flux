import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/x-poster/index.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`X_POSTER_AMBIGUITY_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("x-poster parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("x-poster transpilation diagnostics");
  }
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  // Provider-start boundary: the durable marker MUST be written before the first
  // irreversible X call, and a marker failure MUST NOT proceed to the provider.
  if (!source.includes("provider_start_marker_failed")) {
    fail(`${label}: provider-start marker failure outcome is missing`);
  }
  if (!source.includes("provider_start_marker_rejected")) {
    fail(`${label}: provider-start marker rejection outcome is missing`);
  }
  if (!source.includes("markXPostDeliveryProviderStarted")) {
    fail(`${label}: x-poster never calls the provider-start boundary`);
  }
  if (!source.includes("providerStarted = await markXPostDeliveryProviderStarted(")) {
    fail(`${label}: x-poster provider-start marker result must be awaited`);
  }
  if (source.includes("providerStarted === false") || source.includes("if (!providerStarted)")) {
    // accepted — one of these guards is present
  } else {
    fail(`${label}: a rejected provider-start marker must block provider invocation`);
  }
  // The delivery claim is the admission fence for expensive preparation. It
  // must be acquired before the first media object read, and preparation
  // failures must have a guarded pre-provider release path.
  const claimCall = source.indexOf("deliveryClaim = await claimXPostDelivery(");
  const mediaReadCall = source.indexOf("preparedMediaUploads.push(await downloadMediaForUpload(");
  if (claimCall < 0 || mediaReadCall < 0 || claimCall > mediaReadCall) {
    fail(`${label}: delivery claim must precede media preparation`);
  }
  const manualClaimCall = source.indexOf("deliveryClaim = await claimXPostDelivery(params.sb,");
  const manualMediaReadCall = source.indexOf("preparedVideo = await downloadMediaForUpload(params.sb,");
  if (manualClaimCall < 0 || manualMediaReadCall < 0 || manualClaimCall > manualMediaReadCall) {
    fail(`${label}: manual delivery claim must precede media preparation`);
  }
  if (!source.includes("releaseXPostDeliveryForRetry") ||
      !source.includes("pre-provider claim release failed")) {
    fail(`${label}: preparation failures must release the pre-provider claim`);
  }
  const manualEnd = source.indexOf("// ─── Main ────────────────────────────────────────────");
  if (manualEnd < 0) fail(`${label}: manual x-poster section marker is missing`);
  const manual = source.slice(0, manualEnd);
  const intakeUpdateStart = source.indexOf("async function updateManualIntake(");
  const intakeUpdateEnd = source.indexOf("async function completeManualFailure(", intakeUpdateStart);
  if (intakeUpdateStart < 0 || intakeUpdateEnd < 0) fail(`${label}: manual intake update helper is missing`);
  const intakeUpdate = source.slice(intakeUpdateStart, intakeUpdateEnd);
  if (!intakeUpdate.includes("const { error: updateError } = await sb.from('manual_video_intakes').update({")) {
    fail(`${label}: manual intake writes must inspect the database result`);
  }
  if (!intakeUpdate.includes("if (updateError) {") || !intakeUpdate.includes("new Error('manual_intake_persistence_failed')")) {
    fail(`${label}: manual intake persistence failures must propagate as an explicit error`);
  }
  if (!intakeUpdate.includes("    throw e;")) {
    fail(`${label}: transport-level manual intake failures must propagate`);
  }
  const manualFailureStart = source.indexOf("function safeManualFailureCode(");
  const manualFailureEnd = source.indexOf("// deno-lint-ignore no-explicit-any\nasync function assertObservedFinalDuplicateState(", manualFailureStart);
  if (manualFailureStart < 0 || manualFailureEnd < 0) fail(`${label}: manual failure boundary is missing`);
  const manualFailure = source.slice(manualFailureStart, manualFailureEnd);
  if (!manualFailure.includes("const match = value.match(/^([a-z][a-z0-9_]{1,80})/);")) {
    fail(`${label}: manual failure codes must use a stable allowlisted prefix`);
  }
  if (!manualFailure.includes("const reasonCode = safeManualFailureCode(input.reason);")) {
    fail(`${label}: manual failure boundary must derive a stable reason code`);
  }
  if (!manualFailure.includes("last_error: reasonCode,") ||
      !manualFailure.includes("reasonCode,\n    {")) {
    fail(`${label}: manual failure persistence and pipeline error must use the stable code`);
  }
  if (!manualFailure.includes("...safeManualFailureMeta(input.meta),")) {
    fail(`${label}: manual failure metadata must use the bounded allowlist`);
  }
  if (manualFailure.includes("input.reason.slice") ||
      manualFailure.includes("reason: input.reason,") ||
      manualFailure.includes("...(input.meta ?? {})")) {
      fail(`${label}: raw manual failure reason or metadata crosses the boundary`);
  }
  const renderConfigStart = source.indexOf("async function loadVideoRenderConfig(");
  const renderConfigEnd = source.indexOf("// Retention cleanup runs after X has accepted", renderConfigStart);
  if (renderConfigStart < 0 || renderConfigEnd < 0) fail(`${label}: x-poster render-config loader is missing`);
  const renderConfig = source.slice(renderConfigStart, renderConfigEnd);
  if (!renderConfig.includes("throw new Error('video_render_config_read_failed');")) {
    fail(`${label}: x-poster render-config read failures must use a stable code`);
  }
  if (renderConfig.includes("error.message")) {
    fail(`${label}: x-poster render-config read failures must not expose database text`);
  }
  const mediaDownloadStart = source.indexOf("async function downloadMediaForUpload(");
  const mediaDownloadEnd = source.indexOf("async function repairOriginalStaleMediaForX(", mediaDownloadStart);
  if (mediaDownloadStart < 0 || mediaDownloadEnd < 0) fail(`${label}: x-poster media download helper is missing`);
  const mediaDownload = source.slice(mediaDownloadStart, mediaDownloadEnd);
  if (!mediaDownload.includes("throw new Error('media_download_failed');")) {
    fail(`${label}: x-poster media download failures must use a stable code`);
  }
  if (mediaDownload.includes("download ${storagePath}") || mediaDownload.includes("error?.message")) {
    fail(`${label}: x-poster media download failures must not expose storage/database text`);
  }
  if (!manual.includes("function safeXPosterErrorCode(error: unknown, fallback = 'x_poster_failed'): string")) {
    fail(`${label}: x-poster stable error-code formatter is missing`);
  }
  const manualHandlerStart = source.indexOf("async function handleManualVideoIntakePost(");
  const manualHandlerEnd = source.indexOf("// ─── Main ────────────────────────────────────────────", manualHandlerStart);
  if (manualHandlerStart < 0 || manualHandlerEnd < 0) fail(`${label}: manual x-poster handler markers are missing`);
  const manualHandler = source.slice(manualHandlerStart, manualHandlerEnd);
  for (const forbidden of [
    "intakeError.message",
    "latestXError.message",
    "postError?.message",
    "mediaRowsError.message",
    "renderError?.message",
    "(e as Error).message",
    "(failErr as Error).message",
    "(e as { raw?: unknown }).raw",
  ]) {
    if (manualHandler.includes(forbidden)) fail(`${label}: manual handler still exposes raw ${forbidden}`);
  }
  const mainStart = source.indexOf("serve(async (req) => {");
  const mainEnd = source.indexOf("\n\nasync function insertXPipelineEvent(", mainStart);
  if (mainStart < 0 || mainEnd < 0) fail(`${label}: x-poster main handler markers are missing`);
  const main = source.slice(mainStart, mainEnd);
  const terminalProviderFailures = source.match(
    /skipReason: 'x_api_not_sent',\s+nextRetryAt: null,/g,
  ) ?? [];
  if (terminalProviderFailures.length !== 2) {
    fail(`${label}: both tweet POST failure paths must persist a terminal failure without a scheduled retry`);
  }
  if (source.includes("'x_api_retriable'") || source.includes("Date.now() + 15 * 60 * 1000")) {
    fail(`${label}: tweet POST failures must not retain automatic retry metadata`);
  }
  if (!main.includes("const fatalCode = safeXPosterErrorCode(error, 'x_poster_fatal');") ||
      !main.includes("captureEdgeException(new Error(fatalCode),")) {
    fail(`${label}: x-poster fatal telemetry must use a stable code`);
  }
  for (const forbidden of [
    "existingRowsError.message",
    "rpcRes.error.message",
    "postsErr.message",
    "manualRowsError.message",
    "latestXError.message",
    "mediaRowsError.message",
    "pendingJobsError.message",
    "healDownloadError.message",
    "healResolveError.message",
    "(e as Error).message",
    "(failErr as Error).message",
    "storage_path: e.storagePath",
  ]) {
    if (main.includes(forbidden)) fail(`${label}: batch x-poster handler still exposes raw ${forbidden}`);
  }
  const rendererDispatchStart = source.indexOf("async function dispatchVideoRendererForTarget(");
  const rendererDispatchEnd = source.indexOf("async function gateXVideoRender(", rendererDispatchStart);
  if (rendererDispatchStart < 0 || rendererDispatchEnd < 0) fail(`${label}: x-poster renderer dispatch boundary is missing`);
  const rendererDispatch = source.slice(rendererDispatchStart, rendererDispatchEnd);
  if (!rendererDispatch.includes("const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599")) {
    fail(`${label}: x-poster renderer HTTP failures must retain only a bounded status`);
  }
  if (!rendererDispatch.includes("`renderer_http_${status}`")) {
    fail(`${label}: x-poster renderer HTTP failures must use a stable status code`);
  }
  if (!rendererDispatch.includes("'renderer_dispatch_failed'")) {
    fail(`${label}: x-poster renderer transport failures must use a stable code`);
  }
  if (/resp\.text\s*\(|error\.message|String\(error\)/.test(rendererDispatch)) {
    fail(`${label}: x-poster renderer dispatch must not persist raw response/error text`);
  }
  if (!manual.includes("status: deliveryWriteConfirmed ? 'posted' : 'ambiguous',\n    posted_x_tweet_id: xId")) {
    fail(`${label}: manual intake provider-success persistence ambiguity is still labeled posted`);
  }
  if (!manual.includes("ok: deliveryWriteConfirmed,\n    status: deliveryWriteConfirmed ? 'posted' : 'ambiguous',\n    tweet_id: tweetId")) {
    fail(`${label}: manual ambiguity response does not reflect receipt confirmation`);
  }
  if (!manual.includes("blocks_auto_delivery: !deliveryWriteConfirmed,")) {
    fail(`${label}: manual ambiguity does not block automatic redelivery`);
  }
  const uploadStart = source.indexOf("const VIDEO_CHUNK_BYTES =");
  const uploadEnd = source.indexOf("// ─── Post tweet", uploadStart);
  if (uploadStart < 0 || uploadEnd < 0) fail(`${label}: media upload section is missing`);
  const upload = source.slice(uploadStart, uploadEnd);
  if (!upload.includes("function safeXProviderHttpError(operation: string, status: unknown): string")) {
    fail(`${label}: provider HTTP error formatter is missing`);
  }
  if (!upload.includes("safeXProviderHttpError('video_init', initResp.status)")) {
    fail(`${label}: video INIT errors must use status-only telemetry`);
  }
  if (!upload.includes("safeXProviderHttpError('video_append', appendResp.status)")) {
    fail(`${label}: video APPEND errors must use status-only telemetry`);
  }
  if (!upload.includes("safeXProviderHttpError('video_finalize', finResp.status)")) {
    fail(`${label}: video FINALIZE errors must use status-only telemetry`);
  }
  if (!upload.includes("safeXProviderHttpError('video_status', statusResp.status)")) {
    fail(`${label}: video STATUS errors must use status-only telemetry`);
  }
  if (!upload.includes("'x_provider_video_processing_failed'")) {
    fail(`${label}: video processing errors must use a stable code`);
  }
  if (/\.slice\(0, 300\)|processing\.error\?\.message/.test(upload)) {
    fail(`${label}: provider response/error text must not enter upload exceptions`);
  }
  const postStart = source.indexOf("async function postTweet(");
  const postEnd = source.indexOf("function cleanString(", postStart);
  if (postStart < 0 || postEnd < 0) fail(`${label}: tweet POST helper is missing`);
  const postTweet = source.slice(postStart, postEnd);
  if (!postTweet.includes("safeXProviderHttpError('post_tweet', resp.status)")) {
    fail(`${label}: tweet POST HTTP failures must use status-only telemetry`);
  }
  if (!postTweet.includes("'x_provider_post_tweet_missing_id'")) {
    fail(`${label}: missing tweet id must use a stable code`);
  }
  if (postTweet.includes("raw?: unknown") || /text2\.slice\(0, 400\)/.test(postTweet)) {
    fail(`${label}: tweet POST helper must not attach or interpolate raw provider response text`);
  }
  const batchStart = source.lastIndexOf("if (deliveryWriteError)");
  const batchEnd = source.indexOf("return new Response", batchStart);
  if (batchStart < 0 || batchEnd < 0) fail(`${label}: batch delivery completion section is missing`);
  const batch = source.slice(batchStart, batchEnd);
  if (!batch.includes("status: deliveryWriteConfirmed ? 'posted' : 'ambiguous'")) {
    fail(`${label}: batch provider-success persistence ambiguity is still labeled posted`);
  }
  if (!batch.includes("delivery_write_confirmed: deliveryWriteConfirmed")) {
    fail(`${label}: batch ambiguity receipt flag is missing`);
  }
  const pipelineEventStart = source.indexOf("async function insertXPipelineEvent(");
  if (pipelineEventStart < 0) fail(`${label}: x-poster pipeline event helper is missing`);
  const pipelineEvent = source.slice(pipelineEventStart);
  if (!pipelineEvent.includes("const { error: pipelineEventError } = await sb.from('pipeline_events').insert({")) {
    fail(`${label}: x-poster pipeline-event inserts must inspect returned errors`);
  }
  if (!pipelineEvent.includes("if (pipelineEventError) {") ||
      !pipelineEvent.includes("error: 'x_pipeline_event_insert_failed',")) {
    fail(`${label}: x-poster pipeline-event failures must use a stable diagnostic`);
  }
  if (pipelineEvent.includes("catch (_e) { /* best-effort */ }")) {
    fail(`${label}: x-poster pipeline-event failures must not be silently swallowed`);
  }
  if (pipelineEvent.includes("error: _e") || pipelineEvent.includes("error: error")) {
    fail(`${label}: x-poster pipeline-event diagnostics must not forward raw exceptions`);
  }
  const videoPipelineEventStart = source.indexOf("async function insertVideoRenderPipelineEvent(");
  const videoPipelineEventEnd = source.indexOf("async function dispatchVideoRendererForTarget(", videoPipelineEventStart);
  if (videoPipelineEventStart < 0 || videoPipelineEventEnd < 0) {
    fail(`${label}: video-render pipeline event helper is missing`);
  }
  const videoPipelineEvent = source.slice(videoPipelineEventStart, videoPipelineEventEnd);
  if (!videoPipelineEvent.includes("const { error: pipelineEventError } = await sb.from('pipeline_events').insert({") ||
      !videoPipelineEvent.includes("if (pipelineEventError) {") ||
      !videoPipelineEvent.includes("error: 'video_pipeline_event_insert_failed',") ||
      videoPipelineEvent.includes("catch (_e) { /* best-effort */ }") ||
      videoPipelineEvent.includes("error: _e") || videoPipelineEvent.includes("error: error")) {
    fail(`${label}: video-render pipeline-event failures must be checked and redacted`);
  }
  if (!batch.includes("await markVideoRenderPostedBestEffort(sb, tweetId, retentionHours);")) {
    fail(`${label}: batch post-render state update must use the checked helper without changing ambiguity status`);
  }
  if (!source.includes("await markVideoRenderPostedBestEffort(params.sb, tweetId, retentionHours);")) {
    fail(`${label}: manual post-render state update must use the checked helper`);
  }
  const markPostedStart = source.indexOf("async function markVideoRenderPostedBestEffort(");
  const markPostedEnd = source.indexOf("async function dispatchVideoRendererForTarget(", markPostedStart);
  if (markPostedStart < 0 || markPostedEnd < 0) {
    fail(`${label}: shared post-render state helper is missing`);
  }
  const markPosted = source.slice(markPostedStart, markPostedEnd);
  if (!markPosted.includes("const { error: markPostedError } = await sb.rpc('mark_video_render_posted',") ||
      !markPosted.includes("if (markPostedError) {") ||
      !markPosted.includes("error: 'video_render_posted_update_failed',") ||
      markPosted.includes("catch (_e) { /* best-effort */ }") ||
      markPosted.includes("error: _e") || markPosted.includes("error: error")) {
    fail(`${label}: post-render state failures must be checked and redacted`);
  }
  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:x-poster-ambiguity"] !== "node scripts/check-x-poster-ambiguity-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:x-poster-ambiguity")) {
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
    if (String(error).includes("X_POSTER_AMBIGUITY_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("status: deliveryWriteConfirmed ? 'posted' : 'ambiguous'", "status: 'posted'"),
  }), "ambiguity status flattening");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("ok: deliveryWriteConfirmed,", "ok: true,"),
  }), "manual ok flattening");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("blocks_auto_delivery: !deliveryWriteConfirmed,", "blocks_auto_delivery: false,"),
  }), "manual redelivery guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "skipReason: 'x_api_not_sent',",
      "skipReason: 'x_api_retriable',",
    ),
  }), "tweet POST retry scheduling restoration");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (updateError) {", "if (false) {"),
  }), "manual intake persistence error guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("throw e;\n  }\n}\n\n// deno-lint-ignore no-explicit-any\nasync function completeManualFailure", "console.warn(\"manual intake persistence ignored\");\n  }\n}\n\n// deno-lint-ignore no-explicit-any\nasync function completeManualFailure"),
  }), "manual intake persistence propagation removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("last_error: reasonCode,", "last_error: input.reason,"),
  }), "raw manual failure persistence reason mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("...safeManualFailureMeta(input.meta),", "...(input.meta ?? {}),"),
  }), "raw manual failure metadata mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599", "const status = resp.status"),
  }), "x-poster renderer status bound removal mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('`renderer_http_${status}`', "String(error)"),
  }), "x-poster renderer HTTP raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("'renderer_dispatch_failed'", "error instanceof Error ? error.message : String(error)"),
  }), "x-poster renderer transport raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("throw new Error('video_render_config_read_failed');", "throw new Error(`video_render_config_read_failed: ${error.message}`);"),
  }), "x-poster render-config raw database error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("throw new Error('media_download_failed');", "throw new Error(`download ${storagePath}: ${error?.message || 'no blob'}`);"),
  }), "x-poster media download raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("error: 'manual_intake_lookup_failed'", "error: intakeError.message"),
  }), "x-poster manual lookup raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("apiResponse: null,", "apiResponse: (e as { raw?: unknown }).raw ?? null,"),
  }), "x-poster provider raw response forwarding mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("throw new Error('x_poster_existing_delivery_read_failed');", "throw new Error(`x_poster_existing_delivery_read_failed:${existingRowsError.message}`);"),
  }), "x-poster batch database error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const fatalCode = safeXPosterErrorCode(error, 'x_poster_fatal');", "const fatalCode = error instanceof Error ? error.message : String(error);"),
  }), "x-poster fatal raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("media_id: e.mediaId,", "storage_path: e.storagePath,\n            media_id: e.mediaId,"),
  }), "x-poster stale storage path response mutant");
  assertRejects((source) => ({
    ...source,
    source: (() => {
      const start = source.source.lastIndexOf("if (deliveryWriteError)");
      const end = source.source.indexOf("return new Response", start);
      if (start < 0 || end < 0) return source.source;
      const batch = source.source.slice(start, end).replaceAll(
        "delivery_write_confirmed: deliveryWriteConfirmed",
        "delivery_write_confirmed: true",
      );
      return `${source.source.slice(0, start)}${batch}${source.source.slice(end)}`;
    })(),
  }), "batch receipt confirmation flattening");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (!initResp.ok) throw new Error(safeXProviderHttpError('video_init', initResp.status));", "if (!initResp.ok) throw new Error(`video INIT ${initResp.status}: ${initText.slice(0, 300)}`);"),
  }), "raw provider INIT error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("throw new Error('x_provider_video_processing_failed');", "throw new Error(`video processing failed: ${processing.error?.message || 'unknown'}`);"),
  }), "raw provider processing error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const err = new Error(safeXProviderHttpError('post_tweet', resp.status));", "const err = new Error(`tweet ${resp.status}: ${text2.slice(0, 400)}`);"),
  }), "raw tweet POST error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("const err = new Error('x_provider_post_tweet_missing_id');", "const err = new Error(`tweet 200 but missing data.id: ${text2.slice(0, 400)}`);"),
  }), "raw tweet response-shape error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "const { error: pipelineEventError } = await sb.from('pipeline_events').insert({",
      "await sb.from('pipeline_events').insert({",
    ),
  }), "x-poster pipeline-event result ignored mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "error: 'x_pipeline_event_insert_failed',",
      "error: _e,",
    ),
  }), "x-poster pipeline-event raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "if (pipelineEventError) {",
      "if (false) {",
    ),
  }), "x-poster pipeline-event failure guard removal mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "const { error: pipelineEventError } = await sb.from('pipeline_events').insert({",
      "await sb.from('pipeline_events').insert({",
    ),
  }), "video-render pipeline-event result ignored mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "error: 'video_pipeline_event_insert_failed',",
      "error: _e,",
    ),
  }), "video-render pipeline-event raw error mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "const { error: markPostedError } = await sb.rpc('mark_video_render_posted',",
      "await sb.rpc('mark_video_render_posted',",
    ),
  }), "video-render post state result ignored mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "if (markPostedError) {",
      "if (false) {",
    ),
  }), "video-render post state guard removal mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(/provider_start_marker_failed/g, "generic_provider_error"),
  }), "provider marker failure ambiguous (fail-away from non-success label)");
  assertRejects((source) => ({
    ...source,
    source: source.source.replaceAll("markXPostDeliveryProviderStarted", "postTweet"),
  }), "provider-start boundary skipped entirely");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (!providerStarted) {", "if (false) {"),
  }), "provider marker rejection guard removal");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace(
      "deliveryClaim = await claimXPostDelivery(",
      "preparedMediaUploads.push(await downloadMediaForUpload(\n        deliveryClaim = await claimXPostDelivery(",
    ),
  }), "claim-after-media-preparation");
}

console.log(`X_POSTER_AMBIGUITY_SOURCE_CONTRACT_PASS manualAndBatchAmbiguous=true autoRetryBlocked=true selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
