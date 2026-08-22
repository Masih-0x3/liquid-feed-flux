import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  webhook: join(repoRoot, 'supabase/functions/webhooks-rssapp/index.ts'),
  payloadPolicy: join(repoRoot, 'supabase/functions/_shared/rssWebhookPayloadPolicy.ts'),
};
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
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
  for (const [name, path] of Object.entries(paths)) transpile(path, source[name]);

  const webhook = source.webhook;
  const enqueue = sliceFrom(
    webhook,
    'async function enqueueContentPipelineEntry',
    '\ntype EdgeRuntimeWithWaitUntil',
  );
  const dispatchEvents = sliceFrom(
    webhook,
    'async function insertWorkerDispatchEvents',
    'async function dispatchWorkerAfterWebhook',
  );
  const dispatch = sliceFrom(
    webhook,
    'async function dispatchWorkerAfterWebhook',
    '\nserve(async (req) => {',
  );
  const handler = sliceFrom(
    webhook,
    'serve(async (req) => {',
    '\nfunction extractAuthorFromUrl',
  );

  assert.match(webhook, /type RssWebhookQueryResult = \{/, 'RSS webhook query results must have an explicit boundary');
  assert.match(webhook, /type RssWebhookQueryBuilder = PromiseLike<RssWebhookQueryResult> & \{/, 'RSS webhook query builders must expose only used operations');
  assert.match(webhook, /type RssWebhookSupabaseClient = \{/, 'RSS webhook Supabase clients must have an explicit boundary');
  assert.match(webhook, /type RssWebhookItem = Record<string, unknown>;/, 'RSS webhook items must have an explicit record boundary');
  assert.match(webhook, /let items: RssWebhookItem\[\];/, 'RSS webhook item collections must not use any arrays');
  assert.match(webhook, /function detectVideoSignal\([\s\S]{0,120}item: RssWebhookItem,/s, 'RSS video detection must use the bounded item record');
  assert.equal(
    (webhook.match(/supabase: RssWebhookSupabaseClient/g) ?? []).length,
    5,
    'all RSS webhook persistence helpers must use the bounded Supabase client',
  );
  assert.doesNotMatch(webhook, /supabase: any/, 'RSS webhook persistence helpers must not retain any Supabase clients');
  assert.doesNotMatch(webhook, /let items: any\[\]/, 'RSS webhook item collections must not retain any arrays');
  assert.doesNotMatch(webhook, /item: any,/, 'RSS video detection must not retain an any item boundary');
  assert.doesNotMatch(webhook, /payload as any/, 'RSS payload inspection must not retain an any cast');
  assert.doesNotMatch(
    webhook,
    /deno-lint-ignore no-explicit-any\s*\n\s*supabase: RssWebhookSupabaseClient/,
    'RSS webhook client boundaries must not suppress explicit-any lint findings',
  );

  assert.match(webhook, /const MAX_RSS_WEBHOOK_ITEM_ID_LENGTH = 1_024;/, 'RSS item IDs must retain a finite length limit');
  assert.match(webhook, /class RssWebhookPersistenceError extends Error/, 'RSS persistence failures need one stable error class');
  assert.match(webhook, /function assertWebhookDatabaseSuccess\(error: unknown, code: string\): void/, 'database result errors must fail closed');
  assert.match(webhook, /function stableRssWebhookItemId\(item: Record<string, unknown>\): string \| null/, 'RSS item identity must be deterministic');
  assert.doesNotMatch(handler, /Math\.random/, 'webhook retries must not manufacture random persistence IDs');
  assert.match(handler, /const tweetId = stableRssWebhookItemId\(item\);/, 'each item must derive a stable retry identity');
  assert.match(handler, /if \(!tweetId\) throw new RssWebhookPayloadError\('rss_webhook_item_invalid'\);/, 'items lacking a stable ID must be rejected');
  assert.doesNotMatch(handler, /exact_tweet_seen_skip_pipeline/, 'an existing post must not skip job materialization on a retry');
  assert.match(handler, /action: 'exact_tweet_replayed'/, 'existing post retries must be observable without changing their idempotent write path');

  assert.match(enqueue, /Promise<string>/, 'the primary pipeline job must not silently return an absent result');
  assert.match(enqueue, /assertWebhookDatabaseSuccess\(error, `rss_webhook_\$\{type\}_job_upsert_failed`\);/, 'primary job upsert errors must fail the request');
  assert.match(enqueue, /assertWebhookDatabaseSuccess\(\s*dedupeStatusError,\s*'rss_webhook_dedupe_status_update_failed'/s, 'dedupe status writes must fail the request');
  assert.match(enqueue, /assertWebhookDatabaseSuccess\(\s*eventError,\s*`rss_webhook_\$\{type\}_pipeline_event_failed`/s, 'core queue receipts must fail the request');

  assert.match(dispatchEvents, /const \{ error: eventError \} = await supabase\.from\('pipeline_events'\)\.insert/s, 'worker-dispatch event writes must inspect their result');
  assert.match(dispatchEvents, /if \(eventError\) throw eventError;/, 'worker-dispatch event write failures must be observable');
  assert.match(dispatchEvents, /code: 'rss_webhook_worker_dispatch_event_insert_failed'/, 'worker-dispatch event diagnostics must use a stable code');
  assert.doesNotMatch(dispatchEvents, /error\.message|String\(error\)/, 'worker-dispatch event diagnostics must not expose raw errors');
  assert.equal(
    (dispatch.match(/'rss_webhook_worker_invoke_failed'/g) ?? []).length,
    2,
    'both worker invocation failure paths must persist the stable code',
  );
  assert.doesNotMatch(dispatch, /error\.message|String\(error\)/, 'worker invocation diagnostics must not expose raw errors');

  for (const code of [
    'rss_webhook_existing_post_read_failed',
    'rss_webhook_account_lookup_failed',
    'rss_webhook_account_create_failed',
    'rss_webhook_post_upsert_failed',
    'rss_webhook_media_upsert_failed',
    'rss_webhook_download_job_upsert_failed',
    'rss_webhook_media_pipeline_event_failed',
    'rss_webhook_resolve_job_upsert_failed',
    'rss_webhook_resolve_pipeline_event_failed',
  ]) {
    assert.match(handler, new RegExp(`['\"]${code}['\"]`), `webhook must keep the ${code} failure receipt`);
  }
  assert.match(handler, /catch \(itemError\) \{[\s\S]{0,900}throw persistenceError;/, 'an item persistence failure must escape the loop and prevent a success acknowledgement');
  assert.doesNotMatch(handler, /catch \(itemError\) \{[\s\S]{0,900}continue;/, 'an item persistence failure must not be converted into a partial success');
  assert.match(handler, /if \(isRssWebhookPayloadError\(error\)\) return webhookPayloadErrorResponse\(error\);/, 'malformed stable IDs must remain client errors rather than retryable persistence failures');
  assert.match(handler, /status: 500/, 'core persistence failure must return a non-success status');
  assert.match(handler, /error: 'Internal server error', code/, 'core persistence failure response must carry only a stable code');
  assert.doesNotMatch(handler, /console\.error\('Webhook error:'/, 'raw persistence errors must not be logged from the acknowledgement path');
}

for (const [name, path] of Object.entries(paths)) transpile(path, sources[name]);
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
  expectRejected('random retry identity', (source) => ({
    ...source,
    webhook: source.webhook.replace(
      'const tweetId = stableRssWebhookItemId(item);',
      'const tweetId = item.guid || `${Date.now()}-${Math.random()}`;',
    ),
  }));
  expectRejected('partial acknowledgement', (source) => ({
    ...source,
    webhook: source.webhook.replace('throw persistenceError;', 'continue;'),
  }));
  expectRejected('media persistence result', (source) => ({
    ...source,
    webhook: source.webhook.replace(
      "throw new RssWebhookPersistenceError('rss_webhook_media_upsert_failed');",
      "console.warn('media write failed');",
    ),
  }));
  expectRejected('truthful persistence status', (source) => ({
    ...source,
    webhook: source.webhook.replace('status: 500,', 'status: 200,'),
  }));
  expectRejected('worker-dispatch event result ignored', (source) => ({
    ...source,
    webhook: source.webhook.replace('if (eventError) throw eventError;', 'if (false) throw eventError;'),
  }));
  expectRejected('worker-dispatch raw event diagnostic', (source) => ({
    ...source,
    webhook: source.webhook.replace(
      "code: 'rss_webhook_worker_dispatch_event_insert_failed',",
      "error: (eventError as Error).message,",
    ),
  }));
  expectRejected('worker-dispatch raw invoke diagnostic', (source) => ({
    ...source,
    webhook: source.webhook.replace(
      "'rss_webhook_worker_invoke_failed',",
      "error?.message ?? 'worker invoke failed',",
    ),
  }));
  expectRejected('RSS webhook unbounded client boundary', (source) => ({
    ...source,
    webhook: source.webhook.replace(
      'supabase: RssWebhookSupabaseClient',
      'supabase: any',
    ),
  }));
  expectRejected('RSS webhook any item collection', (source) => ({
    ...source,
    webhook: source.webhook.replace('let items: RssWebhookItem[];', 'let items: any[];'),
  }));
  expectRejected('RSS webhook any video item', (source) => ({
    ...source,
    webhook: source.webhook.replace('item: RssWebhookItem,', 'item: any,'),
  }));
  selfTest = 'pass';
}

console.log(`RSS_WEBHOOK_PERSISTENCE_SOURCE_CONTRACT_PASS acknowledgement=fail-closed stableId=1024 selfTest=${selfTest}`);
