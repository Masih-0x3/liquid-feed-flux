import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  health: join(repoRoot, 'supabase/functions/_shared/videoRendererHealth.ts'),
  actions: join(repoRoot, 'supabase/functions/admin-actions/videoRenderActions.ts'),
  actionsTest: join(repoRoot, 'supabase/functions/admin-actions/videoRenderActions.test.ts'),
  polling: join(repoRoot, 'src/lib/videoRenderPolling.ts'),
  visibility: join(repoRoot, 'src/hooks/useDocumentVisibility.ts'),
  hook: join(repoRoot, 'src/hooks/useVideoRenderData.ts'),
  page: join(repoRoot, 'src/pages/VideoRenders.tsx'),
  panel: join(repoRoot, 'src/components/video/VideoRenderDetailPanel.tsx'),
  drawer: join(repoRoot, 'src/components/monitoring/MonitoringDetailDrawer.tsx'),
  settings: join(repoRoot, 'src/components/settings/VideoRenderingSettings.tsx'),
  pageTest: join(repoRoot, 'src/test/video-renders-page.test.tsx'),
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
  return result.outputText;
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

function validateStructural(source) {
  assert.match(
    source.health,
    /export type VideoRendererHealthState = "healthy" \| "stale" \| "unavailable" \| "blocked" \| "unknown";/,
    'server health helper must expose the complete operator state set',
  );
  assert.match(
    source.health,
    /VIDEO_RENDERER_HEARTBEAT_STALE_AFTER_MS = 90_000/,
    'server health helper must retain the explicit stale threshold',
  );
  assert.match(
    source.health,
    /ageMs >= VIDEO_RENDERER_HEARTBEAT_STALE_AFTER_MS/,
    'old heartbeat rows must become stale before reported status is trusted',
  );
  assert.match(
    source.health,
    /reportedStatus === "draining" \|\| reportedStatus === "paused"/,
    'paused/draining renderer states must remain explicitly blocked',
  );
  assert.match(
    source.health,
    /reportedStatus === "offline" \|\| reportedStatus === "error"/,
    'offline/error renderer states must remain explicitly unavailable',
  );

  assert.match(
    source.actions,
    /const windowStartMs = Date\.now\(\);[\s\S]*const since = new Date\(windowStartMs - 7 \* 24 \* 60 \* 60 \* 1000\)/,
    'overview must establish a bounded query window before issuing its reads',
  );
  const overviewReadsIndex = source.actions.indexOf('const [cfg, rendersRes, issuesRes, heartbeatRes] = await Promise.all(');
  const healthObservedIndex = source.actions.indexOf('const healthObservedAtMs = Date.now();');
  const firstErrorCheckIndex = source.actions.indexOf('if (rendersRes.error) throw rendersRes.error;');
  assert.ok(
    overviewReadsIndex >= 0 && healthObservedIndex > overviewReadsIndex && healthObservedIndex < firstErrorCheckIndex,
    'health timestamp must be captured after the database snapshot resolves and before the response is classified',
  );
  assert.match(
    source.actions,
    /renderer_health:\s*toVideoRenderClientHealth\(classifyVideoRendererHealth\(heartbeatRows, healthObservedAtMs\)\)/,
    'overview must return sanitized renderer health using the post-read server observation timestamp',
  );
  assert.match(
    source.actionsTest,
    /classifyVideoRendererHealth[\s\S]*"not-a-timestamp"/,
    'edge source tests must retain health classification coverage',
  );

  assert.match(
    source.polling,
    /VIDEO_RENDER_ACTIVE_POLL_INTERVAL_MS = 10_000/,
    'active rendering polling must stay bounded to the documented base interval',
  );
  assert.match(
    source.polling,
    /VIDEO_RENDER_STALE_POLL_INTERVAL_MS = 30_000/,
    'stale/unknown renderer polling must use the documented slower interval',
  );
  assert.match(
    source.polling,
    /VIDEO_RENDER_MAX_POLL_INTERVAL_MS = 60_000/,
    'failure backoff must retain a finite maximum interval',
  );
  assert.match(
    source.polling,
    /if \(!isVisible\) return false;/,
    'hidden tabs must stop automatic polling',
  );
  assert.match(
    source.polling,
    /hasActiveRender \|\| rendererHealth === 'healthy'/,
    'active rows and healthy heartbeat checks must continue to poll',
  );
  assert.match(
    source.polling,
    /rendererHealth === 'stale' \|\| rendererHealth === 'unknown'/,
    'stale and unknown states must use bounded retry polling',
  );

  assert.match(source.visibility, /document\.addEventListener\('visibilitychange', updateVisibility\)/, 'visibility hook must subscribe');
  assert.match(source.visibility, /document\.removeEventListener\('visibilitychange', updateVisibility\)/, 'visibility hook must clean up');
  assert.match(source.visibility, /document\.visibilityState !== 'hidden'/, 'visibility hook must explicitly stop hidden work');

  assert.equal(count(source.hook, /refetchInterval:\s*\(query\)\s*=>/g), 3, 'overview, queue, and detail hooks must each own a polling decision');
  assert.equal(count(source.hook, /refetchIntervalInBackground:\s*false/g), 3, 'all polling queries must stop background refetching');
  assert.equal(count(source.hook, /videoRenderPollingInterval\(/g), 3, 'all polling queries must use the shared bounded cadence');
  assert.match(source.hook, /hasActiveVideoRenderRows\(rows\)/, 'queue polling must stop after terminal rows');
  assert.match(source.hook, /isActiveVideoRenderStatus\(status\)/, 'detail polling must stop after a terminal render');
  assert.match(source.hook, /rendererHealth: overview\?\.renderer_health\?\.state \?\? 'unknown'/, 'overview must back off instead of presenting missing health as healthy');

  assert.match(source.page, /const isVisible = useDocumentVisibility\(\);/, 'VideoRenders must own visible-tab state');
  assert.match(source.page, /useVideoRenderOverview\(\{ isVisible \}\)/, 'overview must receive visible-tab state');
  assert.match(source.page, /useVideoRenderQueue\(statuses, showReviewed \? 'all' : 'unreviewed', \{ isVisible \}\)/, 'queue must receive visible-tab state');
  assert.match(source.page, /isVisible=\{isVisible\}/, 'selected detail must receive visible-tab state');
  assert.match(source.page, /status=\{selected\?\.status \?\? null\}/, 'selected detail must receive its known terminal/active status');
  assert.match(source.page, /rendererHealthLabel\(rendererState\)/, 'page must render the server-derived renderer state');
  assert.doesNotMatch(source.page, /heartbeatFresh/, 'page must not reintroduce browser freshness inference');
  assert.doesNotMatch(source.page, /Date\.now\(/, 'page must not derive heartbeat age from browser time');
  assert.doesNotMatch(source.page, /heartbeats/, 'page must not use raw heartbeat rows as the operator truth path');

  assert.match(source.panel, /isVisible = false/, 'detail panel must preserve no-poll default outside VideoRenders');
  assert.match(source.panel, /const documentVisible = useDocumentVisibility\(\);/, 'detail panel must pause its own work in a hidden document');
  assert.match(source.panel, /isVisible: isVisible && documentVisible/, 'detail panel must combine its surface and document visibility');
  assert.doesNotMatch(source.drawer, /VideoRenderDetailPanel/, 'Monitoring drawer must not mount a second video detail route');
  assert.match(source.settings, /rendererHealth\?\.state \?\? 'unknown'/, 'settings must display server-derived health rather than raw heartbeat status');
  assert.doesNotMatch(source.settings, /onlineHeartbeat|heartbeats/, 'settings must not show an unaged raw heartbeat as truth');
  assert.match(source.pageTest, /useDocumentVisibility: \(\) => true/, 'page test must make visible-tab polling input deterministic');
  assert.match(source.pageTest, /\{ isVisible: true \}/, 'page test must assert visibility propagation');
}

for (const [name, path] of Object.entries(paths)) {
  transpile(path, sources[name]);
}
validateStructural(sources);

const health = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(paths.health, sources.health)).toString('base64')}`,
);
const polling = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(paths.polling, sources.polling)).toString('base64')}`,
);
const observedAt = Date.parse('2026-07-22T20:00:00.000Z');
assert.equal(health.classifyVideoRendererHealth([], observedAt).state, 'unavailable');
assert.equal(health.classifyVideoRendererHealth([{
  renderer_id: 'renderer-a',
  status: 'online',
  last_seen_at: '2026-07-22T19:59:30.000Z',
}], observedAt).state, 'healthy');
assert.equal(health.classifyVideoRendererHealth([{
  renderer_id: 'renderer-a',
  status: 'online',
  last_seen_at: '2026-07-22T19:58:30.000Z',
}], observedAt).state, 'stale');
assert.equal(health.classifyVideoRendererHealth([{
  renderer_id: 'renderer-a',
  status: 'paused',
  last_seen_at: '2026-07-22T19:59:30.000Z',
}], observedAt).state, 'blocked');
assert.equal(health.classifyVideoRendererHealth([{
  renderer_id: 'renderer-a',
  status: 'error',
  last_seen_at: '2026-07-22T19:59:30.000Z',
}], observedAt).state, 'unavailable');
assert.equal(health.classifyVideoRendererHealth([{
  renderer_id: 'renderer-a',
  status: 'online',
  last_seen_at: 'not-a-timestamp',
}], observedAt).state, 'unknown');

assert.equal(polling.isActiveVideoRenderStatus('queued'), true);
assert.equal(polling.isActiveVideoRenderStatus('completed'), false);
assert.equal(polling.hasActiveVideoRenderRows([{ status: 'completed' }, { status: 'running' }]), true);
assert.equal(polling.hasActiveVideoRenderRows([{ status: 'completed' }]), false);
assert.equal(polling.videoRenderPollingInterval({ isVisible: false, hasActiveRender: true, rendererHealth: 'healthy' }), false);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: true, rendererHealth: 'blocked' }), 10_000);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'healthy' }), 10_000);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'stale' }), 30_000);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'unknown', failureCount: 1 }), 60_000);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'unknown', failureCount: 99 }), 60_000);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'unavailable' }), false);
assert.equal(polling.videoRenderPollingInterval({ isVisible: true, hasActiveRender: false, rendererHealth: 'blocked' }), false);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(sources)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected('server health projection', (source) => ({
    ...source,
    actions: source.actions.replace(
      'renderer_health: toVideoRenderClientHealth(classifyVideoRendererHealth(heartbeatRows, healthObservedAtMs))',
      'renderer_health: heartbeatRes.data ?? []',
    ),
  }));
  assertRejected('post-read health observation', (source) => ({
    ...source,
    actions: source.actions.replace('const healthObservedAtMs = Date.now();', 'const healthObservedAtMs = windowStartMs;'),
  }));
  assertRejected('visible-tab ownership', (source) => ({
    ...source,
    page: source.page.replace('const isVisible = useDocumentVisibility();', 'const isVisible = true;'),
  }));
  assertRejected('background pause', (source) => ({
    ...source,
    hook: source.hook.replace('refetchIntervalInBackground: false,', ''),
  }));
  assertRejected('backoff cap', (source) => ({
    ...source,
    polling: source.polling.replace('VIDEO_RENDER_MAX_POLL_INTERVAL_MS = 60_000', 'VIDEO_RENDER_MAX_POLL_INTERVAL_MS = 120_000'),
  }));
  assertRejected('drawer active detail visibility', (source) => ({
    ...source,
    panel: source.panel.replace('isVisible: isVisible && documentVisible', 'isVisible'),
  }));
  assertRejected('drawer duplicate video detail surface', (source) => ({
    ...source,
    drawer: source.drawer.replace(
      '{entry.has_media && <MediaThumbnails />}',
      '{entry.has_media && <><MediaThumbnails /><VideoRenderDetailPanel tweetId={entry.tweet_id} /></>}',
    ),
  }));
  selfTest = 'pass';
}

console.log(`VIDEO_RENDER_POLLING_SOURCE_CONTRACT_PASS states=5 maxIntervalMs=60000 selfTest=${selfTest}`);
