import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(import.meta.dirname, '..');
const paths = {
  realtime: path.join(repoRoot, 'src/lib/monitoringRealtime.ts'),
  hook: path.join(repoRoot, 'src/hooks/useMonitoringData.ts'),
  api: path.join(repoRoot, 'src/api/monitoringData.ts'),
  backend: path.join(repoRoot, 'supabase/functions/admin-actions/monitoringReads.ts'),
  backendTest: path.join(repoRoot, 'supabase/functions/admin-actions/monitoringReads.test.ts'),
  readHelpers: path.join(repoRoot, 'supabase/functions/admin-actions/readHelpers.ts'),
};

const source = Object.fromEntries(
  Object.entries(paths).map(([name, filePath]) => [name, fs.readFileSync(filePath, 'utf8')]),
);

function fail(message) {
  throw new Error('MONITORING_REALTIME_SOURCE_CONTRACT_FAIL ' + message);
}

function assertIncludes(input, expected, label) {
  if (!input.includes(expected)) fail(label + ' is missing: ' + expected);
}

function assertNotIncludes(input, unexpected, label) {
  if (input.includes(unexpected)) fail(label + ' must not include: ' + unexpected);
}

function sliceBetween(input, start, end, label) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    fail(label + ' could not be scoped');
  }
  return input.slice(startIndex, endIndex);
}

function parseAndTranspile(filePath, input, scriptKind = ts.ScriptKind.TS) {
  const sourceFile = ts.createSourceFile(filePath, input, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(path.basename(filePath) + ' has TypeScript parse diagnostics');
  }
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  if ((output.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(path.basename(filePath) + ' has TypeScript transpilation diagnostics');
  }
}

function loadRealtimeModule(input) {
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
    fileName: paths.realtime,
  });
  const diagnostics = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) fail('monitoringRealtime module could not transpile');
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, {
    module,
    exports: module.exports,
    Set,
    Object,
    Array,
    Date,
    Math,
    Number,
  }, { filename: paths.realtime });
  return module.exports;
}

function assertEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) fail(label + ' expected ' + right + ' but received ' + left);
}

function entry(tweetId, createdAt, workflowRunKey = null) {
  return {
    tweet_id: tweetId,
    created_at: createdAt,
    process_observability: workflowRunKey
      ? { latest_run: { run_key: workflowRunKey }, recent_runs: [] }
      : null,
  };
}

function page(entries, nextCursor = null) {
  return { entries, nextCursor, source: 'admin_actions' };
}

function assertRealtimeBehavior(realtime) {
  const cached = [entry('cached-1', '2026-07-22T00:00:00.000Z', 'run-1')];
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'posts', new: { tweet_id: 'post-1' } }, cached),
    ['post-1'],
    'posts event resolves tweet_id',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'jobs', new: { payload: { tweet_id: 'job-1' } } }, cached),
    ['job-1'],
    'job event resolves payload tweet id',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'deliveries', new: { subject_type: 'post', subject_id: 'delivery-1' } }, cached),
    ['delivery-1'],
    'post delivery resolves subject id',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'deliveries', new: { subject_type: 'feed', subject_id: 'wrong-1' } }, cached),
    [],
    'non-post delivery cannot refresh arbitrary entry',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'x_deliveries', new: { post_id: 'x-1' } }, cached),
    ['x-1'],
    'x delivery resolves post id',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'workflow_runs', new: { tweet_id: 'workflow-1' } }, cached),
    ['workflow-1'],
    'workflow event resolves tweet id',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'ai_call_ledger', new: { workflow_run_key: 'run-1' } }, cached),
    ['cached-1'],
    'AI call resolves cached workflow run only',
  );
  assertEqual(
    realtime.resolveMonitoringRealtimeTweetIds({ table: 'jobs', new: { payload: {} } }, cached),
    [],
    'malformed job event has no arbitrary target',
  );

  const original = {
    pages: [
      page([entry('old-1', '2026-07-21T00:00:00.000Z'), entry('keep-1', '2026-07-20T00:00:00.000Z')], 2),
      page([entry('later-1', '2026-07-19T00:00:00.000Z')]),
    ],
    pageParams: [0, 2],
  };
  const refreshed = realtime.patchMonitoringInfiniteData(original, 'old-1', entry('old-1', '2026-07-22T00:00:00.000Z'));
  assertEqual(refreshed.outcome, 'resync_required', 'created-at movement cannot change an offset page in place');
  assertEqual(refreshed.data.pages[0].entries.map((item) => item.tweet_id), ['old-1', 'keep-1'], 'unsafe movement leaves page boundaries untouched');
  const stableRefreshed = realtime.patchMonitoringInfiniteData(original, 'old-1', entry('old-1', '2026-07-21T00:00:00.000Z'));
  assertEqual(stableRefreshed.outcome, 'replaced', 'stable exact refresh replaces only the cached row');
  assertEqual(stableRefreshed.data.pages[0].entries.map((item) => item.tweet_id), ['old-1', 'keep-1'], 'stable refresh retains the first page boundary');
  assertEqual(stableRefreshed.data.pages[0].nextCursor, 2, 'stable refresh preserves offset cursor');
  const removed = realtime.patchMonitoringInfiniteData(original, 'old-1', null);
  assertEqual(removed.outcome, 'resync_required', 'filtered-out cached entry requires page resync');
  assertEqual(removed.data.pages[0].entries.map((item) => item.tweet_id), ['old-1', 'keep-1'], 'cached entry is not removed across offset pages');
  const inserted = realtime.patchMonitoringInfiniteData(original, 'new-1', entry('new-1', '2026-07-23T00:00:00.000Z'));
  assertEqual(inserted.outcome, 'resync_required', 'new matching entry requires page resync');
  assertEqual(inserted.data.pages[0].entries.map((item) => item.tweet_id), ['old-1', 'keep-1'], 'new entry is not inserted across offset pages');
  const irrelevant = realtime.patchMonitoringInfiniteData(original, 'absent-1', null);
  assertEqual(irrelevant.outcome, 'unchanged', 'non-member can leave an unaffected cache untouched');
  assertEqual(realtime.monitoringPatchFlushDelay(0, 0, 400), 400, 'first burst event uses the short debounce');
  assertEqual(realtime.monitoringPatchFlushDelay(14_800, 0, 400), 200, 'continuous burst is forced to its max-stale deadline');
  assertEqual(realtime.monitoringPatchFlushDelay(15_000, 0, 400), 0, 'continuous burst cannot defer past max stale');
  assertEqual(realtime.monitoringEntityRefreshDueAt(null, 0), 15_000, 'first entity event sets a max-stale deadline');
  assertEqual(realtime.monitoringEntityRefreshDueAt(15_000, 14_800), 15_000, 'later entity events cannot move the same deadline');
  assertEqual(realtime.nextMonitoringRealtimeGeneration(undefined), 1, 'first generation starts at one');
  assertEqual(realtime.nextMonitoringRealtimeGeneration(1), 2, 'later entity event advances its generation');
  assertEqual(realtime.isCurrentMonitoringRealtimeGeneration(2, 1), false, 'older exact response is rejected after a newer event');
  assertEqual(realtime.isCurrentMonitoringRealtimeGeneration(2, 2), true, 'latest exact response can patch');
  assertEqual(realtime.monitoringQueryShape(['monitoring', 'all', 'alpha', 'any']), { filter: 'all', search: 'alpha', scoreBucket: 'any' }, 'query shape parses monitoring key');
  assertEqual(realtime.monitoringQueryShape(['dashboard', 'all', 'alpha', 'any']), null, 'non-monitoring query cannot be patched');
}

function assertContract(sources) {
  parseAndTranspile(paths.realtime, sources.realtime);
  parseAndTranspile(paths.hook, sources.hook, ts.ScriptKind.TSX);
  parseAndTranspile(paths.api, sources.api);
  parseAndTranspile(paths.backend, sources.backend);
  parseAndTranspile(paths.backendTest, sources.backendTest);
  parseAndTranspile(paths.readHelpers, sources.readHelpers);

  assertIncludes(sources.readHelpers, 'const checkedPosts = (', 'job-reference post response checker');
  assertIncludes(sources.readHelpers, 'throw new Error(`${label}_invalid_response`);', 'job-reference post response shape guard');
  assertIncludes(sources.readHelpers, 'throw new Error(`${label}_invalid_row`);', 'job-reference post row shape guard');
  assertIncludes(sources.readHelpers, 'if (typeof row.tweet_id !== "string" || !row.tweet_id.trim()) {', 'job-reference post identity guard');
  assertIncludes(sources.readHelpers, 'const tweetPosts = checkedPosts(byTweet, "monitoring_posts_by_tweet");', 'tweet-reference post response adoption');
  assertIncludes(sources.readHelpers, 'const urlPosts = checkedPosts(byUrl, "monitoring_posts_by_url");', 'URL-reference post response adoption');
  assertNotIncludes(sources.readHelpers, '(byTweet ?? [])', 'job-reference tweet response must not fail open');
  assertNotIncludes(sources.readHelpers, '(byUrl ?? [])', 'job-reference URL response must not fail open');

  assertIncludes(sources.realtime, "export const MONITORING_REALTIME_TABLES = [", 'one realtime table registry');
  for (const table of ['posts', 'jobs', 'deliveries', 'x_deliveries', 'workflow_runs', 'ai_call_ledger']) {
    assertIncludes(sources.realtime, `'${table}'`, 'realtime table registry');
  }
  assertIncludes(sources.realtime, "const subjectType = nonEmptyString(row.subject_type);", 'delivery subject type guard');
  assertIncludes(sources.realtime, "subjectType === 'post' ? nonEmptyString(row.subject_id) : null", 'delivery primary-key guard');
  assertIncludes(sources.realtime, 'cachedTweetIdsForWorkflowRun', 'AI-call cache-key resolution');
  assertIncludes(sources.realtime, 'export function patchMonitoringInfiniteData(', 'exact cache patch helper');
  assertIncludes(sources.realtime, "outcome: 'resync_required'", 'offset membership transition resync');
  assertIncludes(sources.realtime, 'match.entry.created_at !== nextEntry.created_at', 'stable-order in-place replacement guard');
  assertIncludes(sources.realtime, 'export function monitoringPatchFlushDelay(', 'continuous burst max-stale helper');
  assertIncludes(sources.realtime, 'export function monitoringEntityRefreshDueAt(', 'entity deadline helper');
  assertIncludes(sources.realtime, 'export function nextMonitoringRealtimeGeneration(', 'entity generation helper');
  assertNotIncludes(sources.realtime, 'sortByCreatedAt', 'offset cache must not sort/insert page entries');

  assertIncludes(sources.api, 'export async function fetchMonitoringEntry(', 'exact client refresh API');
  assertIncludes(sources.api, "if (!exactTweetId || exactTweetId.length > 128)", 'client exact id bound');
  assertIncludes(sources.api, 'tweet_id: exactTweetId,', 'client exact id request');
  assertIncludes(sources.api, 'limit: 1,', 'client exact read limit');

  assertIncludes(sources.backend, 'export function normalizeMonitoringTweetId', 'backend exact id parser');
  const pipelineStatusHelper = sliceBetween(
    sources.backend,
    'async function loadPipelineStatusMap(',
    '// deno-lint-ignore no-explicit-any\nasync function loadDuplicateTargetMap(',
    'pipeline status map helper',
  );
  assertIncludes(pipelineStatusHelper, 'if (error) throw error;', 'pipeline status RPC error propagation');
  assertIncludes(pipelineStatusHelper, 'if (!Array.isArray(data)) {', 'pipeline status response shape condition');
  assertIncludes(pipelineStatusHelper, 'monitoring_pipeline_status_invalid_response', 'pipeline status response shape guard');
  assertIncludes(pipelineStatusHelper, 'if (typeof tweetId !== "string" || !wanted.has(tweetId)) {', 'pipeline status row shape condition');
  assertIncludes(pipelineStatusHelper, 'monitoring_pipeline_status_invalid_row', 'pipeline status row shape guard');
  assertIncludes(sources.backend, 'const statusByTweet = await loadPipelineStatusMap(supabase, tweetIds);', 'monitoring status helper adoption');
  const jobStateHelper = sliceBetween(
    sources.backend,
    'async function loadJobStateMap(',
    'export function applyJobStateToRpc(',
    'job state map helper',
  );
  assertIncludes(jobStateHelper, 'const { data, error } = await query;', 'job state read result');
  assertIncludes(jobStateHelper, 'if (error) throw error;', 'job state read error propagation');
  assertIncludes(jobStateHelper, 'monitoring_job_state_invalid_response', 'job state response shape guard');
  assertIncludes(jobStateHelper, 'if (typeof row.type !== "string" || typeof row.status !== "string") {', 'job state field shape condition');
  assertIncludes(jobStateHelper, 'monitoring_job_state_invalid_row', 'job state row shape guard');
  const duplicateTargetHelper = sliceBetween(
    sources.backend,
    '// deno-lint-ignore no-explicit-any\nasync function loadDuplicateTargetMap(',
    'function entryTweetId(',
    'duplicate target map helper',
  );
  assertIncludes(duplicateTargetHelper, 'if (error) throw error;', 'duplicate target query error propagation');
  assertIncludes(duplicateTargetHelper, 'if (!Array.isArray(data)) {', 'duplicate target response shape condition');
  assertIncludes(duplicateTargetHelper, 'monitoring_duplicate_target_invalid_response', 'duplicate target response shape guard');
  assertIncludes(duplicateTargetHelper, 'const wanted = new Set(ids);', 'duplicate target requested-id set');
  assertIncludes(duplicateTargetHelper, 'if (!row || typeof row !== "object" || Array.isArray(row)) {', 'duplicate target row shape condition');
  assertIncludes(duplicateTargetHelper, 'if (typeof tweetId !== "string" || !wanted.has(tweetId)) {', 'duplicate target row id condition');
  assertIncludes(duplicateTargetHelper, 'monitoring_duplicate_target_invalid_row', 'duplicate target row shape guard');
  const overviewQueryHelper = sliceBetween(
    sources.backend,
    'function checkedMonitoringQuery(',
    'function checkedMonitoringRows(',
    'monitoring overview query helper',
  );
  assertIncludes(overviewQueryHelper, 'if (result.error) throw result.error;', 'monitoring overview query error propagation');
  const overviewRowsHelper = sliceBetween(
    sources.backend,
    'function checkedMonitoringRows(',
    'function checkedMonitoringCount(',
    'monitoring overview rows helper',
  );
  assertIncludes(overviewRowsHelper, 'throw new Error(`${section}_invalid_rows`);', 'monitoring overview row shape guard');
  const overviewCountHelper = sliceBetween(
    sources.backend,
    'function checkedMonitoringCount(',
    'const MONITORING_BASE_POST_COLUMNS',
    'monitoring overview count helper',
  );
  assertIncludes(overviewCountHelper, 'throw new Error(`${section}_invalid_count`);', 'monitoring overview count shape guard');
  assertIncludes(sources.backend, 'const posts = checkedMonitoringRows(', 'monitoring overview posts shape adoption');
  assertIncludes(sources.backend, 'const deliveries = checkedMonitoringRows(', 'monitoring overview delivery shape adoption');
  assertIncludes(sources.backend, 'const xDeliveries = checkedMonitoringRows(', 'monitoring overview X-delivery shape adoption');
  assertIncludes(sources.backend, 'const staleJobsCount = checkedMonitoringCount(', 'monitoring overview stale-job count adoption');
  assertIncludes(sources.backend, 'const staleXPendingCount = checkedMonitoringCount(', 'monitoring overview stale-X count adoption');
  const failedJobsLoader = sliceBetween(
    sources.backend,
    'async function getTweetIdsFromFailedJobs(',
    '// deno-lint-ignore no-explicit-any\nasync function getTweetIdsFromXDeliveries(',
    'failed-job filter loader',
  );
  assertIncludes(failedJobsLoader, 'if (error) throw error;', 'failed-job query error propagation');
  assertIncludes(failedJobsLoader, 'checkedMonitoringRows(data, "monitoring_failed_jobs")', 'failed-job response shape gate');
  assertIncludes(failedJobsLoader, 'if (dedupeError) throw dedupeError;', 'failed-dedupe query error propagation');
  assertIncludes(failedJobsLoader, 'checkedMonitoringRows(dedupeRows, "monitoring_failed_dedupe")', 'failed-dedupe response shape gate');
  assertIncludes(failedJobsLoader, 'monitoring_failed_dedupe_invalid_row', 'failed-dedupe row id gate');
  const xDeliveryLoader = sliceBetween(
    sources.backend,
    'async function getTweetIdsFromXDeliveries(',
    'interface LatestJobState {',
    'X-delivery filter loader',
  );
  assertIncludes(xDeliveryLoader, 'if (error) throw error;', 'X-delivery query error propagation');
  assertIncludes(xDeliveryLoader, 'checkedMonitoringRows(data, "monitoring_x_delivery_ids")', 'X-delivery response shape gate');
  assertIncludes(xDeliveryLoader, 'monitoring_x_delivery_ids_invalid_row', 'X-delivery row id gate');
  assertIncludes(sources.backend, 'if (hasExactTweetId && !exactTweetId)', 'backend invalid exact id failure');
  assertIncludes(sources.backend, 'if (wanted.size === 1) {', 'single-entry job-state bounded lookup branch');
  assertIncludes(sources.backend, 'query = query.filter("payload->>tweet_id", "eq", [...wanted][0]);', 'single-entry job-state exact payload predicate');
  assertIncludes(sources.backendTest, 'filter(column: string, operator: string, value: unknown)', 'monitoring fake supports PostgREST filter chaining');
  assertIncludes(sources.backendTest, 'getMonitoringEntries bounds exact-entry job state to its tweet id', 'exact job-state focused fixture');
  assertIncludes(sources.backendTest, 'call.column === "payload->>tweet_id"', 'exact job-state focused filter assertion');
  assertIncludes(sources.backend, 'if (!exactTweetId && filter === "failed_stuck")', 'exact read bypasses broad failed-job lookup');
  assertIncludes(sources.backend, 'if (!exactTweetId && filter === "x_pending")', 'exact read bypasses broad pending lookup');
  assertIncludes(sources.backend, 'if (!exactTweetId && filter === "x_failed")', 'exact read bypasses broad failed-X lookup');
  assertIncludes(sources.backend, 'if (!exactTweetId && filter === "delivered_24h")', 'exact read bypasses broad delivered lookup');
  assertIncludes(sources.backend, 'if (exactTweetId && filter === "x_pending")', 'exact pending delivery membership branch');
  assertIncludes(sources.backend, 'if (!pendingTweetIds.includes(exactTweetId)) return emptyExactResult();', 'exact pending non-member rejection');
  assertIncludes(sources.backend, 'if (exactTweetId && filter === "x_failed")', 'exact failed delivery membership branch');
  assertIncludes(sources.backend, 'if (!failedTweetIds.includes(exactTweetId)) return emptyExactResult();', 'exact failed non-member rejection');
  assertIncludes(sources.backend, 'if (exactTweetId && filter === "delivered_24h")', 'exact delivered window membership branch');
  assertIncludes(sources.backend, 'if (exactPostId) q = q.eq("post_id", exactPostId);', 'exact delivered post-id predicate');
  assertIncludes(sources.backend, 'if (!deliveredTweetIds.includes(exactTweetId))', 'exact delivered non-member rejection');
  assertIncludes(sources.backend, 'if (exactTweetId && filter === "failed_stuck") return emptyExactResult();', 'unbounded failed-stuck exact selector fails closed');
  assertIncludes(sources.backend, 'q = q.eq("tweet_id", exactTweetId).limit(1);', 'backend exact bounded query');
  assertIncludes(sources.backend, 'next_cursor: exactTweetId ? null', 'exact refresh has no pagination cursor');
  assertIncludes(sources.backend, 'error: "monitoring_process_hud_unavailable",', 'process HUD fallback uses stable error code');
  assertNotIncludes(sources.backend, 'error: monitoringErrorMessage(error),', 'process HUD must not expose raw exception text');

  assertIncludes(sources.hook, "const channel = supabase.channel('monitoring-realtime');", 'single coalesced channel');
  assertIncludes(sources.hook, 'MONITORING_REALTIME_TABLES.forEach((table) => {', 'single channel table bindings');
  assertNotIncludes(sources.hook, "supabase.channel('mon-", 'legacy six-channel subscriptions');
  assertIncludes(sources.hook, 'const pendingRealtimeEntriesRef = useRef(new Map<string, number>());', 'burst entity generation map');
  assertIncludes(sources.hook, 'const patchBurstStartedAtRef = useRef<number | null>(null);', 'first burst timestamp');
  assertIncludes(sources.hook, 'monitoringPatchFlushDelay(now, patchBurstStartedAtRef.current, REALTIME_PATCH_DEBOUNCE_MS)', 'continuous burst max-stale scheduling');
  assertIncludes(sources.hook, 'const pendingEntityResyncRef = useRef(new Map<string, PendingEntityResync>());', 'per-entity fallback tracking');
  assertIncludes(sources.hook, 'const realtimeGenerationRef = useRef(new Map<string, number>());', 'per-entity freshness generation');
  assertIncludes(sources.hook, 'function fetchMonitoringEntryBeforeDeadline(', 'bounded exact-request wrapper');
  assertIncludes(sources.hook, "Monitoring Realtime exact refresh exceeded its staleness deadline", 'exact request deadline rejection');
  assertIncludes(sources.hook, 'const registerKnownEntityRefresh = useCallback((tweetId: string): PendingEntityResync => {', 'known entity deadline registration');
  assertIncludes(sources.hook, 'nextMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId))', 'new event advances freshness generation');
  assertIncludes(sources.hook, 'scheduleKnownEntityDeadlineTimer();', 'known entity deadline is armed');
  assertIncludes(sources.hook, 'const pendingEntries = [...pendingRealtimeEntriesRef.current]', 'burst flush snapshots entity generations');
  assertIncludes(sources.hook, 'function requiresCanonicalMonitoringResync(filter: MonitoringFilter): boolean {', 'unbounded special filter fallback guard');
  assertIncludes(sources.hook, 'if (requiresCanonicalMonitoringResync(shape.filter)) {', 'unbounded special filter avoids unsafe exact patch');
  assertIncludes(sources.hook, 'await fetchMonitoringEntryBeforeDeadline({', 'exact rehydration deadline wrapper');
  assertIncludes(sources.hook, 'isCurrentMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId), generation)', 'stale exact response guard');
  assertIncludes(sources.hook, 'queryClient.setQueryData<MonitoringInfiniteData>', 'query-key cache write');
  assertIncludes(sources.hook, 'patchMonitoringInfiniteData(current, tweetId, entry)', 'targeted cache patch');
  assertIncludes(sources.hook, 'const results = await Promise.allSettled(refreshes);', 'coalesced refresh result handling');
  assertIncludes(sources.hook, 'const scheduleFallbackResync = useCallback(() => {', 'bounded fallback owner');
  assertIncludes(sources.hook, 'MAX_MONITORING_REALTIME_STALENESS_MS', 'maximum stale bound');
  assertIncludes(sources.hook, 'return shape && data?.pages.length ? [{ queryKey: query.queryKey, shape }] : [];', 'loaded-cache patch gate');

  const fallback = sliceBetween(sources.hook, 'const scheduleFallbackResync = useCallback(() => {', 'const scheduleKnownEntityDeadlineTimer', 'fallback refresh path');
  assertIncludes(fallback, 'queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_ROOT })', 'unknown payload fallback full refresh');
  const deadlineResync = sliceBetween(sources.hook, 'const expireKnownEntityResyncs = useCallback(() => {', 'useEffect(() => {', 'known entity deadline fallback');
  assertIncludes(deadlineResync, 'if (pending.dueAt > now) return;', 'known entity deadline expiry gate');
  assertIncludes(deadlineResync, 'nextMonitoringRealtimeGeneration(pending.generation)', 'deadline invalidates in-flight stale response');
  assertIncludes(deadlineResync, 'queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_ROOT })', 'known request deadline full refresh');
  const flush = sliceBetween(sources.hook, 'const flushRealtimePatches = useCallback(async () => {', 'const scheduleRealtimePatchFlush', 'known entity flush');
  assertNotIncludes(flush, 'invalidateQueries({ queryKey: MONITORING_QUERY_ROOT })', 'known entity cannot refetch whole page');
  assertIncludes(flush, 'if (activeQueries.length === 0) {\n      return;', 'unloaded cache preserves its bounded entity deadline');
  const eventHandler = sliceBetween(sources.hook, 'const handleRealtimeChange = useCallback((payload: MonitoringRealtimePayload) => {', 'useEffect(() => {', 'realtime entity handler');
  assertIncludes(eventHandler, 'resolveMonitoringRealtimeTweetIds(payload, cachedMonitoringEntries(queryClient))', 'event-to-entity routing');
  assertIncludes(eventHandler, 'scheduleFallbackResync();', 'unknown event fallback scheduling');
  assertIncludes(eventHandler, 'registerKnownEntityRefresh(tweetId)', 'known event starts entity deadline');
  assertIncludes(eventHandler, 'pendingRealtimeEntriesRef.current.set(tweetId, pending.generation)', 'known event queues latest generation');
  assertNotIncludes(eventHandler, 'invalidateQueries({ queryKey: MONITORING_QUERY_ROOT })', 'event handler cannot directly refetch whole page');
  assertIncludes(sources.hook, 'void supabase.removeChannel(channel);', 'single channel cleanup');
  assertIncludes(sources.hook, 'pendingRealtimeEntriesRef.current.clear();', 'pending entity cleanup');
  assertIncludes(sources.hook, 'pendingEntityResyncRef.current.clear();', 'entity deadline cleanup');

  assertRealtimeBehavior(loadRealtimeModule(sources.realtime));
  return { tables: 6, maxStaleMs: 15_000 };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator({ ...source }));
  } catch {
    return;
  }
  fail('mutation survived: ' + label);
}

const result = assertContract(source);

if (process.env.MUTATION_TEST === '1') {
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('MONITORING_REALTIME_TABLES.forEach((table) => {', '[\'posts\'].forEach((table) => {'),
  }), 'single-channel table coverage');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('scheduleFallbackResync();\n      return;', 'void queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_ROOT });\n      return;'),
  }), 'unknown event direct page invalidation');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('return shape && data?.pages.length ? [{ queryKey: query.queryKey, shape }] : [];', 'return shape ? [{ queryKey: query.queryKey, shape }] : [];'),
  }), 'loaded-cache patch gate');
  assertRejects((sources) => ({
    ...sources,
    api: sources.api.replace('tweet_id: exactTweetId,', 'tweet_id: undefined,'),
  }), 'client exact id request');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (hasExactTweetId && !exactTweetId)', 'if (false)'),
  }), 'backend invalid exact id failure');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'error: "monitoring_process_hud_unavailable",',
      'error: monitoringErrorMessage(error),',
    ),
  }), 'process HUD raw error forwarding');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'const { data, error } = await query;\n  if (error) throw error;',
      'const { data, error } = await query;\n  if (false) throw error;',
    ),
  }), 'job state read error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (!Array.isArray(data)) {\n    throw new Error("monitoring_job_state_invalid_response");\n  }',
      'if (false) {',
    ),
  }), 'job state malformed response guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (typeof row.type !== "string" || typeof row.status !== "string") {',
      'if (false) {',
    ),
  }), 'job state malformed row guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (error) throw error;\n  if (!Array.isArray(data)) {\n    throw new Error("monitoring_duplicate_target_invalid_response");',
      'if (false) throw error;\n  if (!Array.isArray(data)) {\n    throw new Error("monitoring_duplicate_target_invalid_response");',
    ),
  }), 'duplicate target query error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (!Array.isArray(data)) {\n    throw new Error("monitoring_duplicate_target_invalid_response");',
      'if (false) {',
    ),
  }), 'duplicate target malformed response guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (!row || typeof row !== "object" || Array.isArray(row)) {\n      throw new Error("monitoring_duplicate_target_invalid_row");\n    }\n    const tweetId = (row as Record<string, unknown>).tweet_id;',
      'if (false) {\n      throw new Error("monitoring_duplicate_target_invalid_row");\n    }\n    const tweetId = (row as Record<string, unknown>).tweet_id;',
    ),
  }), 'duplicate target malformed row guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (typeof tweetId !== "string" || !wanted.has(tweetId)) {',
      'if (false) {',
    ),
  }), 'duplicate target requested-id guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'const result = value as Record<string, unknown>;\n  if (result.error) throw result.error;',
      'const result = value as Record<string, unknown>;\n  if (false) throw result.error;',
    ),
  }), 'monitoring overview query error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'throw new Error(`${section}_invalid_rows`);',
      'return [];',
    ),
  }), 'monitoring overview malformed row guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {\n    throw new Error(`${section}_invalid_count`);\n  }',
      'if (false) { return value as number; }',
    ),
  }), 'monitoring overview malformed count guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'const posts = checkedMonitoringRows(',
      'const posts = postsQuery.data ?? [];',
    ),
  }), 'monitoring overview posts shape adoption');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'const staleJobsCount = checkedMonitoringCount(',
      'const staleJobsCount = staleJobsQuery.count ?? 0;',
    ),
  }), 'monitoring overview stale count shape adoption');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (error) throw error;\n  const jobRows = checkedMonitoringRows(data, "monitoring_failed_jobs");',
      'if (false) throw error;\n  const jobRows = checkedMonitoringRows(data, "monitoring_failed_jobs");',
    ),
  }), 'failed-job query error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'checkedMonitoringRows(data, "monitoring_failed_jobs")',
      '((data ?? []) as Array<Record<string, unknown>>)',
    ),
  }), 'failed-job malformed response gate');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (dedupeError) throw dedupeError;',
      'if (false) throw dedupeError;',
    ),
  }), 'failed-dedupe query error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'checkedMonitoringRows(dedupeRows, "monitoring_failed_dedupe")',
      '((dedupeRows ?? []) as Array<Record<string, unknown>>)',
    ),
  }), 'failed-dedupe malformed response gate');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'const { data, error } = await q;\n  if (error) throw error;\n  const rows = checkedMonitoringRows(data, "monitoring_x_delivery_ids");',
      'const { data, error } = await q;\n  if (false) throw error;\n  const rows = checkedMonitoringRows(data, "monitoring_x_delivery_ids");',
    ),
  }), 'X-delivery query error propagation');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'checkedMonitoringRows(data, "monitoring_x_delivery_ids")',
      '((data ?? []) as Array<Record<string, unknown>>)',
    ),
  }), 'X-delivery malformed response gate');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'monitoring_x_delivery_ids_invalid_row',
      'monitoring_x_delivery_row_guard_removed',
    ),
  }), 'X-delivery row id gate');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (error) throw error;', 'if (false) throw error;'),
  }), 'pipeline status RPC error propagation');
  assertRejects((sources) => ({
    ...sources,
    readHelpers: sources.readHelpers.replace(
      'const tweetPosts = checkedPosts(byTweet, "monitoring_posts_by_tweet");',
      'const tweetPosts = (byTweet ?? []) as Array<Record<string, unknown>>;',
    ),
  }), 'job-reference tweet response fail-open bypass');
  assertRejects((sources) => ({
    ...sources,
    readHelpers: sources.readHelpers.replace(
      'const urlPosts = checkedPosts(byUrl, "monitoring_posts_by_url");',
      'const urlPosts = (byUrl ?? []) as Array<Record<string, unknown>>;',
    ),
  }), 'job-reference URL response fail-open bypass');
  assertRejects((sources) => ({
    ...sources,
    readHelpers: sources.readHelpers.replace(
      'if (typeof row.tweet_id !== "string" || !row.tweet_id.trim()) {',
      'if (false) {',
    ),
  }), 'job-reference post row identity bypass');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace(
      'if (!Array.isArray(data)) {\n    throw new Error("monitoring_pipeline_status_invalid_response");\n  }',
      'if (false) {',
    ),
  }), 'pipeline status malformed response guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (typeof tweetId !== "string" || !wanted.has(tweetId)) {', 'if (false) {'),
  }), 'pipeline status malformed row guard');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('query = query.filter("payload->>tweet_id", "eq", [...wanted][0]);', 'query = query;'),
  }), 'single-entry job-state payload bound');
  assertRejects((sources) => ({
    ...sources,
    backendTest: sources.backendTest.replace('filter(column: string, operator: string, value: unknown)', 'filter_removed(column: string, operator: string, value: unknown)'),
  }), 'monitoring fake filter-chain compatibility');
  assertRejects((sources) => ({
    ...sources,
    realtime: sources.realtime.replace("subjectType === 'post'", "subjectType === 'feed'"),
  }), 'delivery entity guard');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace(
      'monitoringPatchFlushDelay(now, patchBurstStartedAtRef.current, REALTIME_PATCH_DEBOUNCE_MS)',
      'REALTIME_PATCH_DEBOUNCE_MS',
    ),
  }), 'continuous known-event maximum stale deadline');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('const pending = registerKnownEntityRefresh(tweetId);', 'const pending = { generation: 0, dueAt: 0 };'),
  }), 'known event entity deadline registration');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replaceAll(
      'isCurrentMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId), generation)',
      'true',
    ),
  }), 'per-entity stale response generation guard');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('await fetchMonitoringEntryBeforeDeadline({', 'await fetchMonitoringEntry({'),
  }), 'exact request deadline wrapper');
  assertRejects((sources) => ({
    ...sources,
    realtime: sources.realtime.replace(
      "return { data, outcome: nextEntry ? 'resync_required' : 'unchanged' };",
      "return { data, outcome: 'unchanged' };",
    ),
  }), 'offset-page insertion requires resync');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (exactTweetId && filter === "delivered_24h")', 'if (false)'),
  }), 'exact delivered_24h membership branch');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (exactTweetId && filter === "x_pending")', 'if (false)'),
  }), 'exact pending membership branch');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (exactTweetId && filter === "x_failed")', 'if (false)'),
  }), 'exact failed membership branch');
  assertRejects((sources) => ({
    ...sources,
    backend: sources.backend.replace('if (exactPostId) q = q.eq("post_id", exactPostId);', 'if (false) q = q.eq("post_id", exactPostId);'),
  }), 'exact delivered_24h post-id predicate');
  assertRejects((sources) => ({
    ...sources,
    hook: sources.hook.replace('if (requiresCanonicalMonitoringResync(shape.filter)) {', 'if (false) {'),
  }), 'unbounded failed-stuck exact fallback guard');
}

console.log(`MONITORING_REALTIME_SOURCE_CONTRACT_PASS tables=${result.tables} maxStaleMs=${result.maxStaleMs} selfTest=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);
