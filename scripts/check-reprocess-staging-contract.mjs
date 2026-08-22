import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  worker: join(repoRoot, 'supabase/functions/worker/index.ts'),
  admin: join(repoRoot, 'supabase/functions/admin-actions/basicActions.ts'),
  adminTest: join(repoRoot, 'supabase/functions/admin-actions/basicActions.test.ts'),
  monitoringActions: join(repoRoot, 'src/lib/monitoringActions.ts'),
  monitoringPage: join(repoRoot, 'src/pages/Monitoring.tsx'),
  monitoringActionsTest: join(repoRoot, 'src/test/monitoring-actions.test.ts'),
  monitoringViewModelTest: join(repoRoot, 'src/test/monitoring-view-model.test.ts'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

function sliceFrom(source, needle, nextNeedle) {
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `missing ${needle}`);
  const end = source.indexOf(nextNeedle, start + needle.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function validate(source) {
  for (const [name, path] of Object.entries(paths)) {
    transpile(path, source[name]);
  }

  const reprocessWorker = sliceFrom(
    source.worker,
    'async function handleReprocessJob',
    '\nasync function dispatchXPosterForTarget',
  );
  assert.match(reprocessWorker, /filterReviewedRemoteMediaItems\(extractedMediaItems\)/, 'reprocess must retain reviewed-media inspection');
  assert.match(reprocessWorker, /"reprocess_media_staging_required"/, 'reprocess must emit a staging-required receipt');
  assert.equal(
    (source.worker.match(/"reprocess_media_staging_required"/g) ?? []).length,
    2,
    'reprocess staging code must be used once for the event and once for the bounded catch allowlist',
  );
  assert.match(reprocessWorker, /extracted_media_count: extractedMediaItems\.length/, 'reprocess must report aggregate extracted media count');
  assert.match(reprocessWorker, /reviewed_media_count: mediaItems\.length/, 'reprocess must report aggregate reviewed media count');
  assert.doesNotMatch(reprocessWorker, /\.from\("media"\)\.delete\(/, 'reprocess may not delete live media without a staged replacement');
  assert.doesNotMatch(reprocessWorker, /\.from\("media"\)\.insert\(/, 'reprocess may not insert a replacement set outside staging');
  assert.doesNotMatch(reprocessWorker, /has_media:/, 'reprocess may not rewrite media truth outside staging');
  assert.doesNotMatch(reprocessWorker, /type: "download_media"/, 'reprocess may not queue media download before replacement commits');

  assert.match(source.admin, /const MAX_BULK_REPROCESS_TWEET_IDS = 100;/, 'bulk reprocess must retain a finite request cap');
  assert.match(source.admin, /function normalizeReprocessTweetId\(value: unknown\): string \| null/, 'reprocess IDs must be normalized at the action boundary');
  assert.match(source.admin, /REPROCESS_MEDIA_PRESERVED_MESSAGE/, 'the API result must disclose media preservation');
  const reprocessAction = sliceFrom(
    source.admin,
    'export async function reprocessAdminAction',
    '\nexport async function cancelPendingJobsAdminAction',
  );
  assert.match(reprocessAction, /const tweetId = normalizeReprocessTweetId\(tweet_id\);/, 'single reprocess must validate its target ID');
  assert.match(reprocessAction, /payload: \{ tweet_id: tweetId \}/, 'single reprocess must queue the normalized ID');
  const bulkAction = sliceFrom(
    source.admin,
    'export async function bulkReprocessAdminAction',
    '\nexport async function postThreadAdminAction',
  );
  const batchGuard = bulkAction.indexOf('if (tweet_ids.length > MAX_BULK_REPROCESS_TWEET_IDS)');
  const normalize = bulkAction.indexOf('tweet_ids.map(normalizeReprocessTweetId)');
  assert.ok(batchGuard >= 0 && normalize >= 0 && batchGuard < normalize, 'bulk request count must be rejected before per-item work');
  assert.match(bulkAction, /if \(tweetIds\.length === 0\)/, 'all-invalid bulk target sets must fail closed');
  assert.match(source.adminTest, /tweet_ids may contain at most 100 items/, 'Deno fixtures must cover the bulk boundary');

  assert.match(source.monitoringActions, /action: 'reprocess', tweet_id: tweetId/, 'the operator client must keep using the canonical reprocess action');
  assert.match(source.monitoringActions, /failureMessage: 'Reprocess failed'/, 'the operator client must present an explicit reprocess failure state');
  assert.match(source.monitoringActions, /Existing media is preserved and is not refreshed until the staged media path is available/, 'single reprocess confirmation must disclose preserved media');
  assert.match(source.monitoringActions, /Queues pipeline re-evaluation for the selected posts\. Existing media is preserved/, 'bulk reprocess confirmation must disclose preserved media');
  assert.match(source.monitoringPage, /const result = await adminReprocess\(entry\.tweet_id\);[\s\S]{0,240}description: result\.message/, 'single reprocess toast must use the server truth message');
  assert.match(source.monitoringPage, /description: data\?\.message \?\?/, 'bulk reprocess toast must use the server truth message');
  assert.match(source.monitoringActionsTest, /failureMessage: "Reprocess failed"/, 'frontend action fixture must cover the reprocess error contract');
  assert.match(source.monitoringViewModelTest, /Existing media is preserved/, 'frontend copy fixture must protect the staged-media disclosure');
}

for (const [name, path] of Object.entries(paths)) {
  transpile(path, sources[name]);
}
validate(sources);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const expectRejected = (label, mutate) => {
    assert.throws(
      () => validate(mutate(sources)),
      (error) => error instanceof assert.AssertionError,
      `${label} mutation must fail the source contract`,
    );
  };
  expectRejected('staged reprocess receipt', (source) => ({
    ...source,
    worker: source.worker.replace('"reprocess_media_staging_required"', '"media_reprocessed"'),
  }));
  expectRejected('live media deletion', (source) => ({
    ...source,
    worker: source.worker.replace(
      '// Retain the live attachment set until its staged replacement can commit atomically.\n    await insertPipelineEvent(',
      '// Retain the live attachment set until its staged replacement can commit atomically.\n    await supabase.from("media").delete().eq("tweet_id", tweetId);\n    await insertPipelineEvent(',
    ),
  }));
  expectRejected('bulk reprocess bound', (source) => ({
    ...source,
    admin: source.admin.replace(
      'if (tweet_ids.length > MAX_BULK_REPROCESS_TWEET_IDS)',
      'if (false)',
    ),
  }));
  expectRejected('operator disclosure', (source) => ({
    ...source,
    monitoringActions: source.monitoringActions.replaceAll(
      'Existing media is preserved and is not refreshed until the staged media path is available',
      'Media is refreshed immediately',
    ),
  }));
  selfTest = 'pass';
}

console.log(`REPROCESS_STAGING_SOURCE_CONTRACT_PASS media=preserved batch=100 selfTest=${selfTest}`);
