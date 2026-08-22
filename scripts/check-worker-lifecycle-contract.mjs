import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const paths = {
  lifecycle: join(repoRoot, 'supabase/functions/worker/jobLifecycle.ts'),
  lifecycleTest: join(repoRoot, 'supabase/functions/worker/jobLifecycle.test.ts'),
  worker: join(repoRoot, 'supabase/functions/worker/index.ts'),
  workerUtils: join(repoRoot, 'supabase/functions/worker/workerUtils.ts'),
  workerUtilsTest: join(repoRoot, 'supabase/functions/worker/workerUtils.test.ts'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]));
}

function fail(message) {
  throw new Error(`WORKER_LIFECYCLE_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertNotIncludes(source, unexpected, label) {
  if (source.includes(unexpected)) fail(`${label} must not include: ${unexpected}`);
}

function assertTranspiles(path, source) {
  const parsed = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
  if (parsed.parseDiagnostics.length > 0) fail(`${path} has TypeScript parse diagnostics`);
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail(`${path} has TypeScript transpilation diagnostics`);
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function functionBody(source, functionName, label) {
  const sourceFile = typescript.createSourceFile(
    label,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  let body = null;
  function visit(node) {
    if (body) return;
    if (typescript.isFunctionDeclaration(node) && node.name?.text === functionName) {
      body = node.body?.getText(sourceFile) ?? null;
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!body) fail(`${label} function ${functionName} is missing`);
  return body;
}

function assertActualCall(source, functionName, calleeName, label, path) {
  const sourceFile = typescript.createSourceFile(path, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
  let found = false;
  function visit(node) {
    if (found) return;
    if (typescript.isFunctionDeclaration(node) && node.name?.text === functionName) {
      function scan(bodyNode) {
        if (found) return;
        if (typescript.isCallExpression(bodyNode) && bodyNode.expression.getText(sourceFile) === calleeName) {
          found = true;
          return;
        }
        typescript.forEachChild(bodyNode, scan);
      }
      if (node.body) scan(node.body);
      return;
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!found) fail(`${label} must call ${calleeName} in ${functionName}`);
}

function assertContract(source) {
  assertTranspiles(paths.lifecycle, source.lifecycle);
  assertTranspiles(paths.lifecycleTest, source.lifecycleTest);
  assertTranspiles(paths.worker, source.worker);
  assertTranspiles(paths.workerUtils, source.workerUtils);
  assertTranspiles(paths.workerUtilsTest, source.workerUtilsTest);

  assertIncludes(source.lifecycle, 'export class JobStateWriteError extends Error {', 'typed lifecycle persistence error');
  assertIncludes(source.lifecycle, 'type LifecycleClient = {', 'minimal lifecycle client contract');
  assertIncludes(source.lifecycle, 'type LifecycleTerminal = PromiseLike<LifecycleResult>;', 'terminal lifecycle result stage');
  assertIncludes(source.lifecycle, 'type LifecycleFilter = LifecycleTerminal & {', 'filter lifecycle builder stage');
  assertNotIncludes(source.lifecycle, 'type LifecycleQuery = PromiseLike<LifecycleResult> &', 'from-builder PromiseLike typing regression');
  assertNotIncludes(source.lifecycle, 'deno-lint-ignore no-explicit-any', 'lifecycle any suppression escape');
  assertIncludes(source.lifecycle, 'export async function updateJobOrThrow(', 'checked lifecycle write helper');
  assertIncludes(source.lifecycle, '.select("id");', 'lifecycle write affected-row query');
  assertIncludes(source.lifecycle, 'if (!owner) {', 'missing claimed-owner fence rejection');
  assertIncludes(source.lifecycle, 'updateQuery = updateQuery.eq("locked_by", owner);', 'claimed-owner fence');
  assertIncludes(source.lifecycle, 'updateQuery = updateQuery.eq("claim_token", claimToken);', 'claim token equality fence');
  assertIncludes(source.lifecycle, 'updateQuery = updateQuery.eq("claim_generation", claimGeneration);', 'claim generation equality fence');
  assertIncludes(source.lifecycle, 'updateQuery = updateQuery.eq("claim_state", expectedClaimState);', 'expected claim-state equality fence');
  assertIncludes(source.lifecycle, 'assertClaimEnvelope(', 'fail-closed claim envelope validation');
  assertActualCall(source.lifecycle, 'updateJobOrThrow', 'assertClaimEnvelope', 'authoritative lifecycle writer', paths.lifecycle);
  assertIncludes(source.lifecycle, 'delete values[CLAIM_TOKEN_PATCH_KEY];', 'claim token reserved patch-key strip');
  assertIncludes(source.lifecycle, 'delete values[CLAIM_GENERATION_PATCH_KEY];', 'claim generation reserved patch-key strip');
  assertIncludes(source.lifecycle, 'export function claimEnvelopedPatch(', 'claim envelope helper');
  assertIncludes(source.lifecycle, 'function safeLifecycleErrorCode(', 'bounded lifecycle error sanitizer');
  assertIncludes(source.lifecycle, 'throw new JobStateWriteError(operation, "database_error");', 'database result error propagation');
  assertIncludes(source.lifecycle, 'if (!Array.isArray(updatedRows) || updatedRows.length !== 1)', 'zero-row lifecycle write rejection');
  assertIncludes(source.lifecycle, 'const { error: deadLetterError } = await supabase.from("dead_letter_jobs")', 'dead-letter result check');
  assertIncludes(source.lifecycle, 'throw new Error("dead_letter_write_failed");', 'dead-letter fail-closed path');
  assertIncludes(source.lifecycle, 'const errorMsg = safeLifecycleErrorCode(', 'persisted job error sanitizer');
  assertIncludes(source.lifecycle, 'const reconciliationRequired = rawErrorMsg.startsWith(', 'completion uncertainty classification');
  assertIncludes(source.lifecycle, 'reconciliation_required: reconciliationRequired,', 'persistent reconciliation marker');
  assertNotIncludes(source.lifecycle, 'last_error: rawErrorMsg', 'raw job error persistence');
  const resultMetaHelper = section(
    source.lifecycle,
    'export async function mergeJobResultMeta(',
    'export async function recordPipelineEvent(',
    'checked result metadata helper',
  );
  assertIncludes(resultMetaHelper, 'const owner = typeof job.locked_by === "string" ? job.locked_by.trim() : "";', 'result metadata owner extraction');
  assertIncludes(resultMetaHelper, 'if (!jobId || !owner) return;', 'result metadata missing-owner fail-closed guard');
  assertIncludes(resultMetaHelper, 'if (error) {', 'result metadata read error guard');
  assertIncludes(resultMetaHelper, 'throw new JobStateWriteError("result_meta_read", "database_error");', 'result metadata read failure');
  assertIncludes(resultMetaHelper, 'await updateJobOrThrow(', 'result metadata checked write helper');
  assertIncludes(resultMetaHelper, '"result_meta",', 'result metadata checked write operation');
  assertIncludes(resultMetaHelper, 'owner,', 'result metadata checked write owner fence');
  if (resultMetaHelper.includes('catch (_e)') || resultMetaHelper.includes('// best-effort')) {
    fail('result metadata helper must not swallow lifecycle read/write failures');
  }
  assertIncludes(source.worker, 'await mergeJobResultMeta(supabase, job, resultMeta);', 'translation result metadata uses fenced helper');
  assertIncludes(source.lifecycle, '}), "failure_terminal", job.locked_by);', 'terminal failure checked write');
  assertIncludes(source.lifecycle, '}), "failure_retry", job.locked_by);', 'retry failure checked write');
  assertNotIncludes(source.lifecycle, 'isRecordValue(job.claim_token)', 'string claim token record decoy');
  const pipelineEventHelper = section(
    source.lifecycle,
    'export async function recordPipelineEvent(',
    'export async function insertPipelineEvent(',
    'pipeline-event recording boundary',
  );
  assertIncludes(pipelineEventHelper, 'error: "worker_pipeline_event_insert_failed",', 'pipeline-event recording stable catch diagnostic');
  const pipelineEventInsertStart = source.lifecycle.indexOf('export async function insertPipelineEvent(');
  if (pipelineEventInsertStart < 0) fail('pipeline-event insert helper section marker is missing');
  const pipelineEventInsert = source.lifecycle.slice(pipelineEventInsertStart);
  assertIncludes(pipelineEventInsert, 'const { error: pipelineEventError } = await supabase.from("pipeline_events").insert({', 'pipeline-event insert result check');
  assertIncludes(pipelineEventInsert, 'if (pipelineEventError) {', 'pipeline-event insert error guard');
  assertIncludes(pipelineEventInsert, 'const safeError = error == null', 'pipeline-event error sanitizer');
  assertIncludes(pipelineEventInsert, 'safeMeta.error = safeLifecycleErrorCode(safeMeta.error, "pipeline_failed");', 'pipeline-event metadata error sanitizer');
  assertIncludes(pipelineEventInsert, 'error: safeError,', 'pipeline-event bounded error persistence');
  assertNotIncludes(pipelineEventInsert, 'error: error ?? null,', 'pipeline-event raw error persistence');
  assertIncludes(pipelineEventInsert, 'error: "worker_pipeline_event_insert_failed",', 'pipeline-event insert stable diagnostic');
  if (pipelineEventInsert.includes('catch (_e) {\n    // best-effort') || pipelineEventHelper.includes('catch (_e) {\n    // best-effort')) {
    fail('pipeline-event failures must not be silently swallowed');
  }

  const workerLoop = section(
    source.worker,
    '    // Shape queue per chat and adapt spacing based on recent 429s',
    '    let processedCount = 0;',
    'core worker loop',
  );
  assertIncludes(source.worker, 'JobStateWriteError,', 'worker lifecycle error import');
  assertIncludes(workerLoop, '}), "deliver_spacing_defer", job.locked_by);', 'delivery spacing checked state transition');
  assertIncludes(workerLoop, '}), "complete", job.locked_by);', 'completion checked state transition');
  assertIncludes(workerLoop, '}), "defer", job.locked_by);', 'defer checked state transition');
  assertIncludes(workerLoop, 'runJobsWithLaneCapacity(', 'bounded per-lane scheduler');
  assertIncludes(workerLoop, 'laneMetrics', 'lane execution telemetry');
  assertIncludes(source.worker, 'claimEnvelopedPatch(job, {', 'worker lifecycle writes use claim envelope');
  assertNotIncludes(source.worker, 'Promise.allSettled(jobPromises)', 'unbounded worker fan-out');
  assertIncludes(source.worker, 'worker_id: "worker-" + crypto.randomUUID(),', 'worker claim owner entropy');
  assertIncludes(source.worker, 'function workerBoundaryError(', 'worker outer error sanitizer');
  const workerBoundary = section(
    source.worker,
    'function workerBoundaryError(',
    'function thrownWorkerOpenAIResponse(',
    'worker outer error sanitizer',
  );
  assertIncludes(workerBoundary, 'Math.min(86_400', 'worker retry-after bound');
  assertIncludes(workerBoundary, 'new NonRetryableJobError(safeMessage)', 'worker non-retryable class preservation');
  assertIncludes(workerBoundary, 'Object.assign(safeError, { retryAfterSeconds: retryAfter });', 'worker retry-after preservation');
  assertIncludes(workerLoop, 'workerBoundaryError(error, "worker_job_failed")', 'worker job error sanitizer');
  assertIncludes(workerLoop, 'error instanceof JobStateWriteError && error.operation === "complete"', 'post-success persistence ambiguity branch');
  assertIncludes(workerLoop, 'action: "job_completion_persistence_unknown",', 'reconciliation diagnostic');
  assertIncludes(workerLoop, 'action: "job_completion_reconciliation_persistence_failed",', 'reconciliation persistence diagnostic');
  assertIncludes(workerLoop, 'new NonRetryableJobError(', 'completion persistence must not retry provider work');
  assertIncludes(workerLoop, 'reconciliation_required: true,', 'reconciliation receipt');
  assertIncludes(workerLoop, 'reconciliation_persistence_failed: true,', 'no same-attempt retry after reconciliation persistence failure');
  assertNotIncludes(workerLoop, 'completion_persistence_unknown:${error.message}', 'completion persistence raw error forwarding');
  const workerServe = section(
    source.worker,
    'serve(async (req) => {',
    '// deno-lint-ignore no-explicit-any\nasync function enqueuePostDeliveryAfterRenderGate(',
    'worker request boundary',
  );
  assertIncludes(workerServe, 'workerBoundaryError(error, "worker_outer_failed")', 'worker outer job error sanitizer');
  assertIncludes(workerServe, 'workerBoundaryError(error, "worker_fatal")', 'worker fatal error sanitizer');
  assertNotIncludes(workerServe, 'jobError(error).message', 'worker fatal raw error forwarding');

  const mediaHandler = section(
    source.worker,
    'async function handleDownloadMediaJob(',
    'async function handleReprocessJob(',
    'media download worker handler',
  );
  assertIncludes(mediaHandler, 'throw new Error("media_processor_invoke_failed");', 'media processor invoke error code');
  assertIncludes(mediaHandler, 'throw new Error("media_processor_invalid_response");', 'media processor response shape guard');
  assertIncludes(mediaHandler, 'processor_success: mediaProcessorResult.success === true,', 'media processor bounded telemetry');
  assertIncludes(mediaHandler, 'downloaded,', 'media processor bounded count telemetry');
  assertNotIncludes(mediaHandler, 'result: data ?? null,', 'media processor raw response telemetry');
  assertNotIncludes(mediaHandler, 'error.message', 'media processor raw error forwarding');

  const xDispatch = section(
    source.worker,
    'async function dispatchXPosterForTarget(',
    '// deno-lint-ignore no-explicit-any\nasync function getChatIdForJob(',
    'x-poster dispatch telemetry',
  );
  assertIncludes(xDispatch, '"x_poster_invoke_failed",', 'x-poster dispatch stable failure code');
  assertNotIncludes(xDispatch, 'error.message', 'x-poster raw invoke error forwarding');
  assertNotIncludes(xDispatch, 'String(error)', 'x-poster raw thrown error forwarding');

  assertIncludes(source.worker, 'function workerProviderFailureCode(', 'worker provider failure-code helper');
  assertIncludes(source.worker, 'Number.isInteger(status)', 'worker provider status integer guard');
  assertIncludes(source.worker, 'numericStatus >= 100 && numericStatus <= 599', 'worker provider status bounds');
  assertIncludes(source.worker, '"worker_openai_request_failed"', 'worker OpenAI request failure code');
  const observedOpenAI = section(
    source.worker,
    'async function callObservedWorkerOpenAI(',
    'async function handleTranslateJob(',
    'observed worker OpenAI boundary',
  );
  assertIncludes(observedOpenAI, 'throw new Error("worker_openai_request_failed");', 'worker OpenAI throw boundary');
  assertNotIncludes(observedOpenAI, 'throw error;', 'worker OpenAI raw throw forwarding');

  const translateHandler = section(
    source.worker,
    'async function handleTranslateJob(',
    'async function handleModerateJob(',
    'translation provider failure boundary',
  );
  assertIncludes(translateHandler, 'workerProviderFailureCode("worker_translation", trResult.status)', 'translation HTTP failure code');
  assertIncludes(translateHandler, 'workerProviderFailureCode("worker_scoring", scoreResult.status)', 'scoring HTTP failure code');
  assertIncludes(translateHandler, 'workerProviderFailureCode("worker_combined", result.status)', 'combined HTTP failure code');
  assertIncludes(translateHandler, 'throw new Error("worker_scoring_policy_failed");', 'scoring-policy failure code');
  assertIncludes(translateHandler, 'workerBoundaryError(error, "translate_failed")', 'translation catch error sanitizer');
  assertIncludes(translateHandler, 'worker: feedback_bias_failed (non-fatal)', 'feedback-bias stable warning');
  assertIncludes(translateHandler, 'worker: score_tool_parse_failed', 'score parser stable warning');
  assertIncludes(translateHandler, 'worker: translation_tool_parse_failed; using content fallback', 'translation parser stable warning');
  assertIncludes(translateHandler, 'error: "enrich_job_enqueue_failed",', 'enrichment enqueue stable warning');
  assertNotIncludes(translateHandler, 'rawText', 'translation raw provider body forwarding');
  assertNotIncludes(translateHandler, 'OpenAI translation error', 'translation raw provider error forwarding');
  assertNotIncludes(translateHandler, '(biasErr as Error).message', 'feedback-bias raw error forwarding');
  assertNotIncludes(translateHandler, '(parseErr as Error).message', 'parser raw error forwarding');
  assertNotIncludes(translateHandler, 'Failed to enqueue enrich job:', 'enrichment enqueue raw error forwarding');

  const moderationHandler = section(
    source.worker,
    'async function handleModerateJob(',
    'async function handleDeliverJob(',
    'moderation provider failure boundary',
  );
  assertIncludes(moderationHandler, 'let moderationErrorCode = "worker_moderation_request_failed";', 'moderation default failure code');
  assertIncludes(moderationHandler, 'workerProviderFailureCode(\n          "worker_moderation",', 'moderation HTTP failure code');
  assertIncludes(moderationHandler, 'error: new Error(moderationErrorCode),', 'moderation failure telemetry code');
  assertIncludes(moderationHandler, 'throw new Error(moderationErrorCode);', 'moderation stable throw');
  assertNotIncludes(moderationHandler, 'statusText', 'moderation provider status text forwarding');
  assertNotIncludes(moderationHandler, 'error: moderationError', 'moderation raw error telemetry');
  assertNotIncludes(moderationHandler, 'throw moderationError', 'moderation raw error throw');
  assertIncludes(moderationHandler, 'workerBoundaryError(error, "moderate_failed")', 'moderation catch error sanitizer');

  const deliverHandler = section(
    source.worker,
    'async function handleDeliverJob(',
    '\n// ─── handleEnrichJob',
    'delivery error boundary',
  );
  assertIncludes(deliverHandler, 'workerBoundaryError(error, "deliver_failed")', 'delivery catch error sanitizer');

  const hydrationHandler = section(
    source.worker,
    'async function handleHydrateTweetJob(',
    'async function markHydrationFallback(',
    'hydration provider failure boundary',
  );
  for (const marker of [
    'throw new Error("hydrate_post_read_failed");',
    'throw new Error("hydrate_oauth_signing_failed");',
    'throw new Error("hydrate_x_api_network_failed");',
    'throw new Error("hydrate_x_api_invalid_json");',
    'throw new Error("hydrate_post_update_failed");',
    'workerProviderFailureCode("hydrate_x_api_auth", res.status)',
    'workerProviderFailureCode("hydrate_x_api", res.status)',
  ]) {
    assertIncludes(hydrationHandler, marker, `hydration stable failure code: ${marker}`);
  }
  assertIncludes(hydrationHandler, 'hydrate_x_api_rate_limited: retry after', 'hydration rate-limit retry code');
  assertNotIncludes(hydrationHandler, 'postErr?.message', 'hydration database error forwarding');
  assertNotIncludes(hydrationHandler, '(e as Error).message', 'hydration exception forwarding');
  assertNotIncludes(hydrationHandler, 'txt.slice', 'hydration provider body forwarding');
  assertNotIncludes(hydrationHandler, 'updErr.message', 'hydration write error forwarding');
  assertNotIncludes(hydrationHandler, 'await res.text()', 'hydration raw response body read');

  const hydrationQueueHelpers = section(
    source.worker,
    'async function queueTranslateAfterHydrate(',
    'async function isDuplicateGateEnabled(',
    'hydration queue helper error boundary',
  );
  for (const marker of [
    'throw new Error("hydrate_translate_enqueue_failed");',
    'throw new Error("dedupe_translate_enqueue_failed");',
    'throw new Error("dedupe_pending_update_failed");',
  ]) {
    assertIncludes(hydrationQueueHelpers, marker, `hydration queue stable failure code: ${marker}`);
  }
  assertNotIncludes(hydrationQueueHelpers, 'enqueueError.message', 'hydration queue database error forwarding');
  const hydrationDedupeQueue = section(
    source.worker,
    'async function queueDedupeOrTranslateAfterHydrate(',
    'async function handleHydrateTweetJob(',
    'hydration dedupe queue error boundary',
  );
  assertIncludes(hydrationDedupeQueue, 'throw new Error("hydrate_dedupe_enqueue_failed");', 'hydration dedupe enqueue stable failure code');
  assertNotIncludes(hydrationDedupeQueue, 'enqueueError.message', 'hydration dedupe queue database error forwarding');

  const resolveMediaEnqueue = section(
    source.worker,
    'async function maybeEnqueueResolveMedia(',
    'async function handleResolveMediaJob(',
    'resolve-media enqueue error boundary',
  );
  assertIncludes(resolveMediaEnqueue, 'throw new Error("resolve_media_enqueue_failed");', 'resolve-media enqueue stable failure code');
  assertNotIncludes(resolveMediaEnqueue, 'jobErr.message', 'resolve-media enqueue database error forwarding');
  assertNotIncludes(resolveMediaEnqueue, '(e as Error).message', 'resolve-media enqueue exception forwarding');

  const resolveMediaHandlerStart = source.worker.indexOf('async function handleResolveMediaJob(');
  if (resolveMediaHandlerStart < 0) fail('resolve-media persistence error boundary section marker is missing');
  const resolveMediaHandler = source.worker.slice(resolveMediaHandlerStart);
  for (const marker of [
    'throw new Error("resolve_media_post_read_failed");',
    'throw new Error("resolve_media_upsert_failed");',
    'throw new Error("resolve_media_prune_failed");',
    'throw new Error("resolve_media_flag_update_failed");',
    'throw new Error("resolve_media_download_enqueue_failed");',
  ]) {
    assertIncludes(resolveMediaHandler, marker, `resolve-media stable failure code: ${marker}`);
  }
  assertNotIncludes(resolveMediaHandler, 'postErr?.message', 'resolve-media post database error forwarding');
  assertNotIncludes(resolveMediaHandler, 'insErr.message', 'resolve-media upsert database error forwarding');
  assertNotIncludes(resolveMediaHandler, 'prnErr.message', 'resolve-media prune database error forwarding');
  assertNotIncludes(resolveMediaHandler, 'mediaFlagErr.message', 'resolve-media flag database error forwarding');
  assertNotIncludes(resolveMediaHandler, 'dlErr.message', 'resolve-media download enqueue database error forwarding');
  assertNotIncludes(resolveMediaHandler, 'upsert_failed:', 'resolve-media raw upsert event error forwarding');

  const calibrationHelper = section(
    source.worker,
    'async function loadScoringCalibrationExamples(',
    'async function loadConfig(',
    'scoring calibration error boundary',
  );
  assertIncludes(calibrationHelper, 'catch (_error)', 'scoring calibration bounded catch');
  assertIncludes(calibrationHelper, 'console.warn("worker: failed to load scoring calibration examples");', 'scoring calibration stable log');
  assertNotIncludes(calibrationHelper, 'error.message', 'scoring calibration database error forwarding');
  assertNotIncludes(calibrationHelper, 'String(error)', 'scoring calibration exception forwarding');

  const enrichHandler = section(
    source.worker,
    'async function handleEnrichJob(',
    'async function handleDownloadMediaJob(',
    'enrichment error boundary',
  );
  assertIncludes(enrichHandler, '"enrich_result_persistence_unknown:posts"', 'enrichment posts persistence stable code');
  assertIncludes(enrichHandler, '"enrich_result_persistence_unknown:post_enrichments"', 'enrichment child persistence stable code');
  assertIncludes(enrichHandler, 'if (e instanceof JobDeferred) throw e;', 'enrichment JobDeferred preservation');
  assertIncludes(enrichHandler, 'const err = workerBoundaryError(e, "enrich_failed");', 'enrichment catch error sanitizer');
  assertNotIncludes(enrichHandler, 'enrichPostWriteError.message', 'enrichment posts raw error forwarding');
  assertNotIncludes(enrichHandler, 'enrichmentInsertError.message', 'enrichment child raw error forwarding');
  assertNotIncludes(enrichHandler, 'const err = e instanceof Error ? e : new Error(String(e));', 'enrichment raw exception normalization');

  const dedupeHandler = section(
    source.worker,
    'async function handleDedupeJob(',
    'serve(async (req) => {',
    'dedupe error boundary',
  );
  assertIncludes(dedupeHandler, 'if (error instanceof JobDeferred) throw error;', 'dedupe JobDeferred preservation');
  assertIncludes(dedupeHandler, 'const e = workerBoundaryError(error, "dedupe_failed");', 'dedupe catch error sanitizer');
  assertIncludes(dedupeHandler, '}, e);\n    throw e;', 'dedupe workflow failure uses sanitized error');
  assertNotIncludes(dedupeHandler, '}, error);', 'dedupe raw workflow error forwarding');

  assertIncludes(source.lifecycleTest, 'updateJobOrThrow surfaces a lifecycle database result error', 'checked-write regression fixture');
  assertIncludes(source.lifecycleTest, 'mergeJobResultMeta surfaces a result metadata write error', 'result metadata checked-write regression fixture');
  assertIncludes(source.lifecycleTest, 'handleJobFailure persists reconciliation-required metadata after completion state uncertainty', 'reconciliation persistence fixture');
  assertIncludes(source.lifecycleTest, 'handleJobFailure leaves the job state untouched when terminal dead-letter persistence fails', 'dead-letter failure regression fixture');
  assertIncludes(source.workerUtilsTest, 'lane execution caps are independent from the fetch batch', 'lane capacity fixture');
  assertIncludes(source.workerUtilsTest, 'new Promise<void>((resolve)', 'deferred lane fixture');

  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.['check:worker-lifecycle'],
    'node scripts/check-worker-lifecycle-contract.mjs',
    'package script must retain worker lifecycle contract',
  );
  assertIncludes(source.ci, '- run: npm run check:worker-lifecycle', 'hosted CI worker lifecycle contract');
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()));
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === '1') {
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'const errorMsg = safeLifecycleErrorCode(\n    rawErrorMsg,',
      'const errorMsg = rawErrorMsg;',
    ),
  }), 'raw lifecycle error persistence bypass');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'type LifecycleClient = {',
      'type LifecycleClient = any;',
    ),
  }), 'lifecycle any boundary escape');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'throw new JobStateWriteError(operation, "database_error");',
      'throw new JobStateWriteError(operation, error.message);',
    ),
  }), 'raw lifecycle database error forwarding');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'throw new Error("dead_letter_write_failed");',
      'throw new Error(`dead_letter_write_failed:${deadLetterError.message}`);',
    ),
  }), 'raw dead-letter database error forwarding');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'error: safeError,',
      'error: error ?? null,',
    ),
  }), 'raw pipeline-event error forwarding');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'safeMeta.error = safeLifecycleErrorCode(safeMeta.error, "pipeline_failed");',
      'safeMeta.error = safeMeta.error;',
    ),
  }), 'raw pipeline-event metadata error forwarding');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'throw new JobStateWriteError(operation, "database_error");',
      'return;',
    ),
  }), 'lifecycle write result propagation');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('if (!Array.isArray(updatedRows) || updatedRows.length !== 1)', 'if (false)'),
  }), 'zero-row lifecycle write rejection');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('updateQuery = updateQuery.eq("locked_by", owner);', 'updateQuery = updateQuery;'),
  }), 'claimed-owner fence removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('updateQuery = updateQuery.eq("claim_token", claimToken);', 'updateQuery = updateQuery;'),
  }), 'claim token fence removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('updateQuery = updateQuery.eq("claim_generation", claimGeneration);', 'updateQuery = updateQuery;'),
  }), 'claim generation fence removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'updateQuery = updateQuery.eq("claim_token", claimToken);',
      '// claim token fence omitted',
    ),
  }), 'claim token equality removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'updateQuery = updateQuery.eq("claim_generation", claimGeneration);',
      '// claim generation fence omitted',
    ),
  }), 'claim generation equality removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'updateQuery = updateQuery.eq("claim_state", expectedClaimState);',
      '// claim state fence omitted',
    ),
  }), 'claim state equality removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'type LifecycleTerminal = PromiseLike<LifecycleResult>;',
      'type LifecycleTerminal = LifecycleResult;',
    ),
  }), 'terminal lifecycle result stage removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'type LifecycleQuery = {',
      'type LifecycleQuery = PromiseLike<LifecycleResult> & {',
    ),
  }), 'from-builder PromiseLike typing regression');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'assertClaimEnvelope(\n      {',
      '// decoy comment instead of actual claim validation\n      // assertClaimEnvelope({',
    ),
  }), 'comment-only claim validation decoy');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'runJobsWithLaneCapacity(\n      toRunJobs,',
      '// unrelated placement decoy',
    ),
  }), 'unrelated placement scheduler decoy');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('if (!jobId || !owner) return;', 'if (!jobId) return;'),
  }), 'result metadata missing-owner guard removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'await updateJobOrThrow(\n    supabase,\n    jobId,',
      'await supabase.from("jobs").update({',
    ),
  }), 'result metadata checked-write helper removal');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'if (error) {\n    throw new JobStateWriteError("result_meta_read", "database_error");',
      'if (false) {',
    ),
  }), 'result metadata read error propagation removal');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('await mergeJobResultMeta(supabase, job, resultMeta);', 'console.warn("result metadata skipped");'),
  }), 'translation result metadata helper bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('worker_id: "worker-" + crypto.randomUUID(),', 'worker_id: "worker-default",'),
  }), 'short/reused worker owner mutant');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('const err = workerBoundaryError(error, "worker_job_failed");', 'const err = jobError(error);'),
  }), 'worker job raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('const err = workerBoundaryError(error, "worker_outer_failed");', 'const err = jobError(error);'),
  }), 'worker outer raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('error: safeError.message,', 'error: jobError(error).message,'),
  }), 'worker fatal raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('const { error: deadLetterError } = await supabase.from("dead_letter_jobs")', 'await supabase.from("dead_letter_jobs")'),
  }), 'dead-letter result check');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace(
      'const { error: pipelineEventError } = await supabase.from("pipeline_events").insert({',
      'await supabase.from("pipeline_events").insert({',
    ),
  }), 'pipeline-event result check');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('if (pipelineEventError) {', 'if (false) {'),
  }), 'pipeline-event failure guard');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('error: "worker_pipeline_event_insert_failed",', 'error: _e,'),
  }), 'pipeline-event raw diagnostic');
  assertRejects((source) => ({
    ...source,
    lifecycle: source.lifecycle.replace('reconciliation_required: reconciliationRequired,', 'reconciliation_required: false,'),
  }), 'persistent reconciliation marker');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('}), "complete", job.locked_by);', '}), "completed_without_check", job.locked_by);'),
  }), 'completion checked transition');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('error instanceof JobStateWriteError && error.operation === "complete"', 'false'),
  }), 'post-success persistence ambiguity branch');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace('reconciliation_persistence_failed: true,', 'reconciliation_persistence_failed: false,'),
  }), 'no same-attempt retry after reconciliation persistence failure');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("media_processor_invoke_failed");',
      'throw new Error(`Media processor error: ${error.message}`);',
    ),
  }), 'media processor raw invoke error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'processor_success: mediaProcessorResult.success === true,',
      'result: data ?? null,',
    ),
  }), 'media processor raw response telemetry');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '"x_poster_invoke_failed",',
      'error.message ?? "x-poster invoke failed",',
    ),
  }), 'x-poster raw invoke error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("worker_openai_request_failed");',
      'throw error;',
    ),
  }), 'worker OpenAI raw throw forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'numericStatus >= 100 && numericStatus <= 599',
      'numericStatus >= 100 && numericStatus <= 99',
    ),
  }), 'worker provider status bounds removal');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replaceAll(
      'throw new Error(workerProviderFailureCode("worker_translation", trResult.status));',
      'throw new Error(`OpenAI translation error: ${trResult.status}`);',
    ),
  }), 'translation raw provider error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error(moderationErrorCode);',
      'throw new Error(`OpenAI Moderation API error: ${response.statusText || response.status}`);',
    ),
  }), 'moderation provider status-text forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'error: new Error(moderationErrorCode),',
      'error: moderationError,',
    ),
  }), 'moderation raw error telemetry forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("hydrate_post_read_failed");',
      'throw new Error(`hydrate_tweet post read failed: ${postErr?.message}`);',
    ),
  }), 'hydration database error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '"network_error",\n      null,',
      '`network: ${(e as Error).message}`,\n      null,',
    ),
  }), 'hydration network error telemetry forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error(workerProviderFailureCode("hydrate_x_api", res.status));',
      'throw new Error(`hydrate_x_api_failed: ${await res.text()}`);',
    ),
  }), 'hydration provider body forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("hydrate_x_api_invalid_json");',
      'throw new Error(`hydrate_x_api_invalid_json: ${(e as Error).message}`);',
    ),
  }), 'hydration parser error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("hydrate_post_update_failed");',
      'throw new Error(`hydrate_post_update_failed: ${updErr.message}`);',
    ),
  }), 'hydration write error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("hydrate_translate_enqueue_failed");',
      'throw new Error(`hydrate_translate_enqueue_failed: ${enqueueError.message}`);',
    ),
  }), 'hydration translate enqueue error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("dedupe_pending_update_failed");',
      'throw new Error(`dedupe_pending_update_failed: ${error.message}`);',
    ),
  }), 'dedupe pending update error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("hydrate_dedupe_enqueue_failed");',
      'throw new Error(`hydrate_dedupe_enqueue_failed: ${enqueueError.message}`);',
    ),
  }), 'hydration dedupe enqueue error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_enqueue_failed");',
      'throw new Error(`resolve_media_enqueue_failed: ${jobErr.message}`);',
    ),
  }), 'resolve-media enqueue error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_post_read_failed");',
      'throw new Error(`resolve_media post read failed: ${postErr?.message}`);',
    ),
  }), 'resolve-media post read error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_upsert_failed");',
      'throw new Error(`resolve_media_upsert_failed: ${insErr.message}`);',
    ),
  }), 'resolve-media upsert error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_prune_failed");',
      'throw new Error(`resolve_media_prune_failed: ${prnErr.message}`);',
    ),
  }), 'resolve-media prune error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_flag_update_failed");',
      'throw new Error(`resolve_media_flag_update_failed: ${mediaFlagErr.message}`);',
    ),
  }), 'resolve-media flag error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'throw new Error("resolve_media_download_enqueue_failed");',
      'throw new Error(`resolve_media_download_enqueue_failed: ${dlErr.message}`);',
    ),
  }), 'resolve-media download enqueue error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'console.warn("worker: failed to load scoring calibration examples");',
      'console.warn("worker: failed to load scoring calibration examples", error.message);',
    ),
  }), 'scoring calibration error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const e = workerBoundaryError(error, "translate_failed");',
      'const e = jobError(error);',
    ),
  }), 'translation catch raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'console.warn("worker: feedback_bias_failed (non-fatal)");',
      'console.warn("feedback bias (non-fatal):", (biasErr as Error).message);',
    ),
  }), 'feedback-bias raw warning mutant');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'console.warn("worker: score_tool_parse_failed");',
      'console.warn("Failed to parse score tool call:", (parseErr as Error).message);',
    ),
  }), 'score parser raw warning mutant');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'console.warn("worker: translation_tool_parse_failed; using content fallback");',
      'console.warn("Failed to parse tool call, falling back to content:", (parseErr as Error).message);',
    ),
  }), 'translation parser raw warning mutant');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'error: "enrich_job_enqueue_failed",',
      'error: enrichJobError.message,',
    ),
  }), 'enrichment enqueue raw warning mutant');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const e = workerBoundaryError(error, "moderate_failed");',
      'const e = jobError(error);',
    ),
  }), 'moderation catch raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const e = workerBoundaryError(error, "deliver_failed");',
      'const e = jobError(error);',
    ),
  }), 'delivery catch raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '"enrich_result_persistence_unknown:posts"',
      '`enrich_result_persistence_unknown:posts:${enrichPostWriteError.message}`',
    ),
  }), 'enrichment posts raw persistence error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      '"enrich_result_persistence_unknown:post_enrichments"',
      '`enrich_result_persistence_unknown:post_enrichments:${enrichmentInsertError.message}`',
    ),
  }), 'enrichment child raw persistence error forwarding');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const err = workerBoundaryError(e, "enrich_failed");',
      'const err = e instanceof Error ? e : new Error(String(e));',
    ),
  }), 'enrichment catch raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (e instanceof JobDeferred) throw e;',
      'if (false) { throw e; }',
    ),
  }), 'enrichment JobDeferred bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'const e = workerBoundaryError(error, "dedupe_failed");',
      'const e = jobError(error);',
    ),
  }), 'dedupe catch raw error sanitizer bypass');
  assertRejects((source) => ({
    ...source,
    worker: source.worker.replace(
      'if (error instanceof JobDeferred) throw error;',
      'if (false) { throw error; }',
    ),
  }), 'dedupe JobDeferred bypass');
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:worker-lifecycle\n', ''),
  }), 'hosted CI worker lifecycle contract');
}

console.log(`WORKER_LIFECYCLE_SOURCE_CONTRACT_PASS transitions=5 reconciliation=fail-closed selfTest=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);
