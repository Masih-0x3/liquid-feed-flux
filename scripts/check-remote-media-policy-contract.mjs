import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  policy: join(repoRoot, 'supabase/functions/_shared/remoteMediaPolicy.ts'),
  telemetry: join(repoRoot, 'supabase/functions/_shared/safeMediaTelemetry.ts'),
  processor: join(repoRoot, 'supabase/functions/media-processor/index.ts'),
  webhook: join(repoRoot, 'supabase/functions/webhooks-rssapp/index.ts'),
  worker: join(repoRoot, 'supabase/functions/worker/index.ts'),
  workflow: join(repoRoot, 'supabase/functions/worker/mediaWorkflow.ts'),
  workflowTest: join(repoRoot, 'supabase/functions/worker/mediaWorkflow.test.ts'),
  manualIntake: join(repoRoot, 'supabase/functions/admin-actions/manualVideoIntakeActions.ts'),
  xPosting: join(repoRoot, 'supabase/functions/admin-actions/xPostingActions.ts'),
  xPostingTest: join(repoRoot, 'supabase/functions/admin-actions/xPostingActions.test.ts'),
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

function indexOfOrFail(source, needle, message) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function functionSlice(source, functionNeedle) {
  const start = indexOfOrFail(source, functionNeedle, `missing ${functionNeedle}`);
  const end = source.indexOf('\nasync function ', start + functionNeedle.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function testSlice(source, testName) {
  const start = indexOfOrFail(source, `Deno.test("${testName}"`, `missing ${testName} regression fixture`);
  const end = source.indexOf('\nDeno.test(', start + testName.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function validateStructural(source) {
  assert.match(
    source.policy,
    /REVIEWED_REMOTE_MEDIA_HOSTS = \[\s*"pbs\.twimg\.com",\s*"video\.twimg\.com",\s*\] as const/,
    'policy must retain the exact reviewed X media hosts',
  );
  assert.match(
    source.policy,
    /REVIEWED_REMOTE_JSON_HOSTS = \[\s*"api\.fxtwitter\.com",\s*"api\.vxtwitter\.com",\s*"api\.x\.com",\s*\] as const/,
    'provider JSON must remain constrained to exact reviewed hosts',
  );
  assert.match(source.policy, /MAX_REMOTE_MEDIA_URL_LENGTH = 4_096/, 'media URL length must remain bounded');
  assert.match(source.policy, /MAX_REMOTE_MEDIA_ITEMS_PER_POST = 4/, 'per-post media count must remain bounded');
  assert.match(source.policy, /function normalizeRemoteMediaAcceptanceLimit\(value: number\)/, 'media acceptance overrides must be normalized');
  assert.match(source.policy, /Math\.min\(MAX_REMOTE_MEDIA_CANDIDATES_PER_POST, requested\)/, 'media acceptance overrides must stay within the candidate cap');
  assert.match(source.policy, /const acceptanceLimit = normalizeRemoteMediaAcceptanceLimit\(maxAccepted\)/, 'media filtering must use the normalized acceptance limit');
  assert.match(source.policy, /MAX_REMOTE_MEDIA_REDIRECTS = 3/, 'redirect chain must remain bounded');
  assert.match(source.policy, /MAX_REMOTE_MEDIA_BYTES = 50 \* 1024 \* 1024/, 'media bytes must retain a finite cap');
  assert.match(source.policy, /MAX_REVIEWED_REMOTE_JSON_BYTES = 512 \* 1024/, 'provider JSON bytes must retain a finite cap');
  assert.match(source.policy, /MAX_REVIEWED_REMOTE_JSON_ARRAY_ITEMS = 64/, 'provider JSON arrays must remain bounded');
  assert.match(source.policy, /MAX_REVIEWED_REMOTE_JSON_DEPTH = 16/, 'provider JSON depth must remain bounded');
  assert.match(source.policy, /REMOTE_MEDIA_TTFB_TIMEOUT_MS = 10_000/, 'media TTFB deadline must remain explicit');
  assert.match(source.policy, /REMOTE_MEDIA_TOTAL_TIMEOUT_MS = 30_000/, 'media total deadline must remain explicit');
  assert.match(source.policy, /REVIEWED_REMOTE_JSON_TTFB_TIMEOUT_MS = 10_000/, 'JSON TTFB deadline must remain explicit');
  assert.match(source.policy, /REVIEWED_REMOTE_JSON_TOTAL_TIMEOUT_MS = 20_000/, 'JSON total deadline must remain explicit');
  assert.match(source.policy, /url\.protocol !== "https:"/, 'non-HTTPS source URLs must fail closed');
  assert.match(source.policy, /url\.username \|\| url\.password/, 'URL credentials must fail closed');
  assert.match(source.policy, /if \(url\.port\)/, 'non-default ports must fail closed');
  assert.match(source.policy, /REVIEWED_REMOTE_MEDIA_HOST_SET\.has\(url\.hostname\.toLowerCase\(\)\)/, 'media host validation must be exact');
  assert.match(source.policy, /url\.hostname\.toLowerCase\(\) !== REVIEWED_REMOTE_JSON_HOST_BY_PROVIDER\[provider\]/, 'provider JSON host validation must be exact');
  assert.match(source.policy, /if \(url\.hash\)/, 'media fragments must fail closed');
  assert.match(source.policy, /if \(url\.hash\) return fail\("remote_json_url_fragment_blocked"\)/, 'JSON fragments must fail closed');
  assert.match(source.policy, /resolveDnsRecords\(hostname, "A", resolver, signal, timeoutCode\)/, 'DNS policy must inspect A records');
  assert.match(source.policy, /resolveDnsRecords\(hostname, "AAAA", resolver, signal, timeoutCode\)/, 'DNS policy must inspect AAAA records');
  assert.match(source.policy, /function awaitDnsWithAbort<T>\(/, 'DNS resolution must race the request abort signal');
  assert.match(source.policy, /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/, 'DNS abort race must observe request cancellation');
  assert.match(source.policy, /signal\.removeEventListener\("abort", onAbort\)/, 'DNS abort race must clean up cancellation listeners');
  assert.match(
    source.policy,
    /const records = await awaitDnsWithAbort\(\s*Promise\.resolve\(\)\.then\(\(\) => resolver\(hostname, recordType, \{ signal \}\)\),/,
    'DNS resolver calls must use the abort race rather than trusting resolver signal support',
  );
  assert.match(source.policy, /records\.some\(\(record\) => !isPublicRemoteIpAddress\(record\)\)/, 'every DNS result must be public');
  assert.match(source.policy, /remote_dns_unavailable/, 'missing runtime DNS support must fail closed');
  assert.match(source.policy, /remote_dns_non_public/, 'private DNS answers must fail closed');
  assert.match(source.policy, /redirect: "manual"/, 'media redirects must not auto-follow');
  assert.match(source.policy, /redirect: "error"/, 'provider JSON redirects must fail closed');
  assert.match(source.policy, /if \(isRedirect\(response\) \|\| response\.redirected\)/, 'media policy must defensively reject an auto-followed response');
  assert.match(source.policy, /if \(location\.length > MAX_REMOTE_MEDIA_URL_LENGTH\)/, 'redirect Location length must be bounded before URL construction');
  assert.match(source.policy, /remote_media_redirect_location_too_long/, 'oversized redirect Location needs a stable code');
  assert.match(
    source.policy,
    /validateReviewedRemoteMediaUrl\(\s*new URL\(location, currentUrl\)\.toString\(\),\s*\)/,
    'every media redirect target must pass the same URL policy',
  );
  assert.match(source.policy, /response\.body\.getReader\(\)/, 'response bodies must be read through bounded stream readers');
  assert.match(source.policy, /bytesRead > MAX_REMOTE_MEDIA_BYTES/, 'media streaming reader must abort on byte overflow');
  assert.match(source.policy, /bytesRead > MAX_REVIEWED_REMOTE_JSON_BYTES/, 'JSON streaming reader must abort on byte overflow');
  assert.match(source.policy, /assertReviewedRemoteMediaMagic\(contentType, body\)/, 'declared media MIME must match magic bytes');
  assert.match(source.policy, /assertReviewedRemoteJsonShape\(body\)/, 'provider JSON shape must be bounded after parse');
  assert.match(source.policy, /new TextDecoder\("utf-8", \{ fatal: true \}\)/, 'provider JSON must reject invalid text bytes');
  assert.doesNotMatch(source.policy, /\.arrayBuffer\(/, 'remote policy must not restore unbounded arrayBuffer reads');
  assert.match(
    source.policy,
    /export async function fetchReviewedRemoteMedia\([\s\S]{0,320}let currentUrl = validateReviewedRemoteMediaUrl\(source\.toString\(\)\);[\s\S]{0,160}const controller = new AbortController\(\);/,
    'media URL validation must happen before any timeout is scheduled',
  );
  assert.match(
    source.policy,
    /export async function fetchReviewedRemoteJson\([\s\S]{0,320}const currentUrl = validateReviewedRemoteJsonUrl\(provider, source\.toString\(\)\);[\s\S]{0,160}const controller = new AbortController\(\);/,
    'JSON URL validation must happen before any timeout is scheduled',
  );

  const mediaDnsIndex = indexOfOrFail(source.policy, 'await assertReviewedRemotePublicDns(', 'media fetch must DNS-check each hop');
  const mediaFetchIndex = indexOfOrFail(source.policy, 'response = await fetchImpl(currentUrl, {', 'media fetch must remain present');
  assert.ok(mediaDnsIndex < mediaFetchIndex, 'media DNS policy must run before Fetch');
  const jsonDnsIndex = source.policy.lastIndexOf('await assertReviewedRemotePublicDns(');
  const jsonFetchIndex = source.policy.lastIndexOf('response = await fetchImpl(currentUrl, {');
  assert.ok(jsonDnsIndex < jsonFetchIndex, 'JSON DNS policy must run before Fetch');
  assert.match(
    source.policy,
    /contentType = assertBoundedMediaHeaders\(response\);[\s\S]{0,240}await cancelResponseBody\(response\);/,
    'failed media header validation must cancel the body',
  );

  assert.match(source.processor, /\.order\('ordering', \{ ascending: true \}\)\s*\.limit\(MAX_REMOTE_MEDIA_ITEMS_PER_POST \+ 1\)/, 'media query must remain ordered and bounded');
  const validateIndex = indexOfOrFail(source.processor, 'const sourceUrl = validateReviewedRemoteMediaUrl(media.src_url);', 'processor must validate the stored URL before reuse or fetch');
  const reuseIndex = indexOfOrFail(source.processor, 'const reusableStoragePath', 'processor must retain valid hash reuse');
  assert.ok(validateIndex < reuseIndex, 'stored URL validation must precede reuse');
  assert.match(source.processor, /const \{ data: existingRows, error: existingRowsError \} = await supabase[\s\S]*if \(existingRowsError\) throw new Error\('media_reuse_lookup_failed'\);/, 'media reuse lookup errors must fail closed before remote fetch');
  assert.match(source.processor, /fetchReviewedRemoteMedia\(sourceUrl\)/, 'processor must use the reviewed media fetch boundary');
  assert.match(source.processor, /crypto\.randomUUID\(\)/, 'new uploads must use a collision-resistant storage path component');
  assert.doesNotMatch(source.processor, /fetch\(media\.src_url/, 'processor must not directly fetch stored URLs');
  assert.doesNotMatch(source.processor, /response\.arrayBuffer\(/, 'processor must not restore unbounded response buffering');
  assert.match(source.processor, /media_item_limit_exceeded/, 'over-limit candidates must be explicitly accounted for');

  const webhookGateIndex = indexOfOrFail(source.webhook, 'filterReviewedRemoteMediaItems(prefilteredMediaItems)', 'RSS media must pass reviewed-host validation');
  const webhookUpsertIndex = indexOfOrFail(source.webhook, ".from('media')\n            .upsert(mediaRows", 'RSS media persistence must remain present');
  assert.ok(webhookGateIndex < webhookUpsertIndex, 'RSS validation must happen before media persistence');
  assert.match(source.webhook, /media_url_rejected_by_policy/, 'RSS rejection telemetry must be aggregate-only');

  assert.match(source.workflow, /fetchReviewedRemoteJson\(\s*"fxtwitter"/, 'fxtwitter must use the reviewed JSON boundary');
  assert.match(source.workflow, /fetchReviewedRemoteJson\(\s*"vxtwitter"/, 'vxtwitter must use the reviewed JSON boundary');
  assert.doesNotMatch(source.workflow, /await res\.json\(\)/, 'proxy JSON must not use unbounded Response.json');
  assert.doesNotMatch(source.workflow, /await fetchImpl\(/, 'proxy JSON must not bypass the reviewed boundary');
  assert.match(source.workflow, /MAX_REMOTE_MEDIA_CANDIDATES_PER_POST/, 'proxy media extraction must cap candidate work');
  assert.match(source.workflow, /filterReviewedRemoteMediaItems\(out\)/, 'proxy responses must pass the reviewed-host gate');
  assert.match(source.workflow, /filterReviewedRemoteMediaItems\(resolved\)/, 'resolved rows must be rechecked at persistence construction');
  assert.match(source.workflowTest, /publicDnsResolver/, 'future Deno proxy fixtures must inject a deterministic DNS resolver');
  assert.match(source.workflowTest, /redirect: "error"/, 'future proxy fixtures must assert redirects are blocked');

  const resolveBranch = functionSlice(source.worker, 'async function handleResolveMediaJob');
  assert.match(resolveBranch, /if \(rows\.length === 0\)[\s\S]*no_reviewed_media_url[\s\S]*return true;/, 'unsafe proxy output must not trigger an empty upsert or destructive prune');
  const reprocess = functionSlice(source.worker, 'async function handleReprocessJob');
  assert.match(reprocess, /filterReviewedRemoteMediaItems\(extractedMediaItems\)/, 'reprocess must still inspect extracted media through the shared ingress gate');
  assert.match(
    reprocess,
    /insertPipelineEvent\([\s\S]*"reprocess_media_staging_required",\s*\{\s*extracted_media_count: extractedMediaItems\.length,/,
    'reprocess must record that media replacement remains staged at the event boundary',
  );
  assert.match(reprocess, /extracted_media_count: extractedMediaItems\.length/, 'reprocess staging receipt must retain aggregate extraction evidence');
  assert.match(reprocess, /reviewed_media_count: mediaItems\.length/, 'reprocess staging receipt must retain aggregate reviewed-media evidence');
  assert.doesNotMatch(reprocess, /\.from\("media"\)\.delete\(/, 'reprocess must not delete live media before a staged replacement contract exists');
  assert.doesNotMatch(reprocess, /\.from\("media"\)\.insert\(/, 'reprocess must not write replacement media outside a staged replacement contract');
  assert.doesNotMatch(reprocess, /has_media:/, 'reprocess must not flip media truth without a staged replacement commit');
  assert.doesNotMatch(reprocess, /type: "download_media"/, 'reprocess must not enqueue download work for an uncommitted replacement set');
  assert.match(source.manualIntake, /filterReviewedRemoteMediaItems\(\s*rows\.map\(\(row\) => \(\{ row, url: row\.src_url \}\)\)/, 'manual X intake media rows must pass the shared persistence gate');
  const manualX = functionSlice(source.manualIntake, 'async function fetchTweetFromXApi');
  const manualProxy = functionSlice(source.manualIntake, 'async function fetchTweetFromProxy');
  assert.match(manualX, /fetchReviewedRemoteJson\(\s*"x_api"/, 'manual X API lookup must use the reviewed JSON boundary');
  assert.match(manualProxy, /fetchReviewedRemoteJson\(\s*endpoint\.provider/, 'manual proxy lookup must use the reviewed JSON boundary');
  assert.doesNotMatch(manualX, /\.text\(\)|\.json\(\)/, 'manual X API lookup must not fully buffer an unbounded response');
  assert.doesNotMatch(manualProxy, /\.text\(\)|\.json\(\)/, 'manual proxy lookup must not fully buffer an unbounded response');
  assert.match(manualX, /warning: `x_api_\$\{response\.status\}`/, 'manual X API errors must use fixed status-only warnings');
  assert.match(source.manualIntake, /warning: "x_api_fetch_failed"/, 'manual X API exceptions must not persist upstream error text');
  assert.match(source.xPosting, /fetchReviewedRemoteJson\(\s*"fxtwitter"/, 'downloader fxtwitter lookup must use the reviewed JSON boundary');
  assert.match(source.xPosting, /fetchReviewedRemoteJson\(\s*"vxtwitter"/, 'downloader vxtwitter lookup must use the reviewed JSON boundary');
  assert.doesNotMatch(source.xPosting, /fetchWithTimeout/, 'downloader proxy lookup must not bypass the reviewed JSON boundary');
  assert.match(source.xPosting, /function reviewedProxyMediaUrl\(value: unknown\)/, 'proxy avatar and thumbnail URLs must use the reviewed media gate');
  assert.match(source.xPosting, /filterReviewedRemoteMediaItems\(\s*variantCandidates,/, 'video variants must be filtered before selecting the best one');
  assert.match(source.xPosting, /filterReviewedRemoteMediaItems\(media\)/, 'fxtwitter media output must be filtered before returning to the browser');
  assert.match(source.xPosting, /filterReviewedRemoteMediaItems\(candidates\)/, 'vxtwitter media output must be filtered before returning to the browser');
  assert.match(source.xPosting, /MAX_REMOTE_MEDIA_CANDIDATES_PER_POST/, 'downloader proxy parsing must bound candidate work');
  assert.match(source.xPosting, /const remainingMediaCandidates = Math\.max\(/, 'fxtwitter videos and photos must share one candidate budget');
  assert.match(source.xPosting, /error: resolveXMediaErrorCode\(err\)/, 'downloader proxy errors must retain safe stable error codes');
  const reviewedMetadataFixture = testSlice(
    source.xPostingTest,
    'resolve media returns reviewed metadata without exposing provider URLs',
  );
  assert.match(reviewedMetadataFixture, /https:\/\/unreviewed\.example\/high\.mp4/, 'downloader hostile video fixture must remain');
  assert.match(reviewedMetadataFixture, /https:\/\/video\.twimg\.com\/ext_tw_video\/high\.mp4/, 'downloader legitimate reviewed-host fixture must remain');
  assert.match(reviewedMetadataFixture, /resolveDns: publicDnsResolver/, 'downloader proxy fixture must inject deterministic public DNS');
  assert.match(reviewedMetadataFixture, /assertEquals\(body\.tweet\.media\[0\]\.qualityLabel, "720p @ 1\.5Mbps"\)/, 'downloader must select the reviewed-host variant rather than the hostile higher-bitrate variant');
  assert.match(reviewedMetadataFixture, /assertEquals\("url" in body\.tweet\.media\[0\], false\)/, 'downloader response must not expose a provider media URL');
  assert.match(reviewedMetadataFixture, /assertEquals\("thumbnail_url" in body\.tweet\.media\[0\], false\)/, 'downloader response must not expose a provider thumbnail URL');

  for (const code of [
    'remote_media_url_host_blocked',
    'remote_media_redirect_limit_exceeded',
    'remote_media_redirect_location_too_long',
    'remote_media_redirect_auto_follow_blocked',
    'remote_media_content_length_exceeded',
    'remote_media_content_encoding_blocked',
    'remote_media_magic_mismatch',
    'remote_media_body_exceeded',
    'remote_dns_unavailable',
    'remote_dns_resolution_failed',
    'remote_dns_no_records',
    'remote_dns_result_invalid',
    'remote_dns_non_public',
    'media_item_limit_exceeded',
  ]) {
    assert.match(source.telemetry, new RegExp(`"${code}"`), `safe telemetry must retain ${code}`);
  }
}

for (const [name, path] of Object.entries(paths)) {
  transpile(path, sources[name]);
}
validateStructural(sources);

const policy = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(paths.policy, sources.policy)).toString('base64')}`,
);

function expectPolicyCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

const publicDnsResolver = async (_hostname, recordType) =>
  recordType === 'A'
    ? ['93.184.216.34']
    : ['2606:2800:220:1:248:1893:25c8:1946'];

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function mp4Bytes() {
  return new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function responseMarkedRedirected(response) {
  return new Proxy(response, {
    get(target, property) {
      if (property === 'redirected') return true;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

assert.equal(
  policy.validateReviewedRemoteMediaUrl('https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig').hostname,
  'pbs.twimg.com',
);
assert.equal(
  policy.validateReviewedRemoteMediaUrl('https://video.twimg.com/ext_tw_video/a.mp4').hostname,
  'video.twimg.com',
);
for (const [url, code] of [
  ['http://pbs.twimg.com/media/a.jpg', 'remote_media_url_scheme_blocked'],
  ['https://user:pass@pbs.twimg.com/media/a.jpg', 'remote_media_url_credentials_blocked'],
  ['https://pbs.twimg.com:444/media/a.jpg', 'remote_media_url_port_blocked'],
  ['https://pbs.twimg.com.evil.example/media/a.jpg', 'remote_media_url_host_blocked'],
  ['https://127.0.0.1/media/a.jpg', 'remote_media_url_host_blocked'],
  ['https://169.254.169.254/latest/meta-data', 'remote_media_url_host_blocked'],
  ['https://[::1]/media/a.jpg', 'remote_media_url_host_blocked'],
  ['https://pbs.twimg.com/media/a.jpg#fragment', 'remote_media_url_fragment_blocked'],
]) {
  expectPolicyCode(() => policy.validateReviewedRemoteMediaUrl(url), code);
}
expectPolicyCode(
  () => policy.validateReviewedRemoteMediaUrl(`https://pbs.twimg.com/${'a'.repeat(4_097)}`),
  'remote_media_url_too_long',
);
const originalSetTimeout = globalThis.setTimeout;
let invalidSourceTimerCount = 0;
globalThis.setTimeout = (...args) => {
  invalidSourceTimerCount += 1;
  return originalSetTimeout(...args);
};
try {
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia('http://pbs.twimg.com/media/invalid-before-timer.jpg'),
    (error) => error?.code === 'remote_media_url_scheme_blocked',
  );
  await assert.rejects(
    () => policy.fetchReviewedRemoteJson('x_api', 'http://api.x.com/2/tweets/invalid-before-timer'),
    (error) => error?.code === 'remote_json_url_scheme_blocked',
  );
} finally {
  globalThis.setTimeout = originalSetTimeout;
}
assert.equal(invalidSourceTimerCount, 0, 'invalid remote URLs must not create cleanup timers');
assert.equal(policy.isPublicRemoteIpAddress('93.184.216.34'), true);
assert.equal(policy.isPublicRemoteIpAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
for (const address of [
  '127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.0.8', '192.168.0.1',
  '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '2001:db8::1',
  '2001::1', '2002:7f00:1::', '3fff::1',
]) {
  assert.equal(policy.isPublicRemoteIpAddress(address), false, `${address} must not be public`);
}

const filtered = policy.filterReviewedRemoteMediaItems([
  { url: 'https://pbs.twimg.com/media/allowed.jpg' },
  { url: 'https://169.254.169.254/latest/meta-data' },
  { url: 'https://video.twimg.com/ext_tw_video/allowed.mp4' },
]);
assert.equal(filtered.accepted.length, 2);
assert.equal(filtered.rejected, 1);
const boundedOverride = policy.filterReviewedRemoteMediaItems(
  Array.from({ length: 12 }, () => ({ url: 'https://pbs.twimg.com/media/allowed.jpg' })),
  Number.POSITIVE_INFINITY,
);
assert.equal(boundedOverride.accepted.length, policy.MAX_REMOTE_MEDIA_CANDIDATES_PER_POST);
assert.equal(boundedOverride.rejected, 4, 'media acceptance overrides must not bypass candidate inspection bounds');

const validPng = await policy.fetchReviewedRemoteMedia(
  'https://pbs.twimg.com/media/allowed.png',
  async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.headers?.['Accept-Encoding'], 'identity');
    return new Response(pngBytes(), { headers: { 'content-type': 'image/png' } });
  },
  publicDnsResolver,
);
assert.equal(validPng.contentType, 'image/png');
assert.equal(validPng.body.byteLength, pngBytes().byteLength);

let forbiddenFetchCalled = false;
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/private-dns.png',
    async () => {
      forbiddenFetchCalled = true;
      return new Response(pngBytes(), { headers: { 'content-type': 'image/png' } });
    },
    async (hostname, recordType) => recordType === 'A' && hostname === 'pbs.twimg.com'
      ? ['127.0.0.1']
      : [],
  ),
  (error) => error?.code === 'remote_dns_non_public',
);
assert.equal(forbiddenFetchCalled, false, 'private DNS must block before Fetch');
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/dns-failure.png',
    async () => new Response(pngBytes(), { headers: { 'content-type': 'image/png' } }),
    async () => { throw new Error('resolver failure'); },
  ),
  (error) => error?.code === 'remote_dns_resolution_failed',
);

// ─── B2A controlled zero-egress corpus ───────────────────────────────
// Every case uses an injected counting fetchImpl + stub resolveDns. A
// forbidden target must never reach the fetch request seam: count === 0.
// WHATWG URL normalization already collapses decimal/hex/octal/abbrev
// loopback forms to 127.0.0.1, which is absent from the allowlist, so all
// encoded loopback forms are rejected by the exact-host allowlist without
// any source change to remoteMediaPolicy.ts.

function countingFetch(marks, markName) {
  return async (_input, _init) => {
    marks[markName] = (marks[markName] ?? 0) + 1;
    throw new Error(`unexpected fetch: ${markName}`);
  };
}

async function expectZeroEgressFetchForUrl(rawUrl, expectedCode, marks, key) {
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia(
      rawUrl,
      countingFetch(marks, key),
      publicDnsResolver,
    ),
    (error) => error?.code === expectedCode,
    `forbidden URL must fail closed before fetch: ${rawUrl}`,
  );
  assert.equal(marks[key] ?? 0, 0, `forbidden target ${rawUrl} must never reach fetch`);
}

// Immediate URL-shape rejections (host allowlist / scheme / normalize), all
// before any DNS or fetch. Uses a counting fetch that throws if ever hit.
{
  const marks = {};
  const urlCases = [
    // scheme-blocked (become https: before allowlist regardless of IP form)
    ['http://127.0.0.1/media.jpg', 'remote_media_url_scheme_blocked'],
    ['http://10.0.0.1/media.jpg', 'remote_media_url_scheme_blocked'],
    ['http://172.16.0.1/media.jpg', 'remote_media_url_scheme_blocked'],
    ['http://192.168.1.1/media.jpg', 'remote_media_url_scheme_blocked'],
    ['http://169.254.169.254/latest/meta-data', 'remote_media_url_scheme_blocked'],
    ['http://255.255.255.255/x.jpg', 'remote_media_url_scheme_blocked'],
    // allowlist host-block: encoded loopback + IPv6 + spoof are normalized to
    // a non-allowlisted hostname by WHATWG, so blocked with host code.
    ['https://2130706433/a.jpg', 'remote_media_url_host_blocked'],
    ['https://0x7f000001/a.jpg', 'remote_media_url_host_blocked'],
    ['https://0x7f.0.0.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://127.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://0177.0.0.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://[::1]/a.jpg', 'remote_media_url_host_blocked'],
    ['https://pbs.twimg.com.evil.example/a.jpg', 'remote_media_url_host_blocked'],
    // direct HTTPS host-boundary (B2A rework F1/F2): private/link-local/
    // metadata/broadcast and IPv6 non-global host forms are rejected by the
    // exact-host allowlist at the host boundary before DNS/fetch, count 0.
    ['https://127.0.0.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://10.0.0.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://172.16.0.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://192.168.1.1/a.jpg', 'remote_media_url_host_blocked'],
    ['https://169.254.169.254/latest/meta-data', 'remote_media_url_host_blocked'],
    ['https://255.255.255.255/a.jpg', 'remote_media_url_host_blocked'],
    ['https://[fe80::1]/a.jpg', 'remote_media_url_host_blocked'],
  ];
  for (const [idx, [url, code]] of urlCases.entries()) {
    await expectZeroEgressFetchForUrl(url, code, marks, `url_${idx}`);
  }
}

// Allowlisted hostname resolving to a non-public record: fail closed,
// request count 0. Covers loopback/private/link-local/IPv6-link-local/global6.
{
  const dnsFailureTable = [
    // [url, A records, AAAA records]
    ['https://pbs.twimg.com/media/p-loopback.png', ['127.0.0.1'], []],
    ['https://pbs.twimg.com/media/p-private.png', ['10.0.0.1'], []],
    ['https://pbs.twimg.com/media/p-v6linklocal.png', [], ['fe80::1']],
    ['https://video.twimg.com/x/p-metadata.png', ['169.254.169.254'], []],
  ];
  for (const [i, [url, aRecords, aaaaRecords]] of dnsFailureTable.entries()) {
    const marks = {};
    const key = `dns_${i}`;
    await assert.rejects(
      () => policy.fetchReviewedRemoteMedia(
        url,
        async () => { marks[key] = (marks[key] ?? 0) + 1; throw new Error('unexpected'); },
        async (hostname, recordType) =>
          recordType === 'A' ? aRecords : aaaaRecords,
      ),
      (error) => error?.code === 'remote_dns_non_public',
      `non-public DNS must fail closed: ${url}`,
    );
    assert.equal(marks[key] ?? 0, 0, `non-public DNS must not reach fetch: ${url}`);
  }
}

// DNS empty / resolver-throw → fail closed, count 0. (The "unavailable"
// path with Deno absent cannot be exercised via the injectable resolver, so
// empty and throwing resolvers prove fail-closed at the same DNS seam.)
{
  const marks = {};
  const key = 'dns_empty';
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia(
      'https://pbs.twimg.com/media/dns-empty.png',
      async () => { marks[key] = (marks[key] ?? 0) + 1; throw new Error('unexpected'); },
      async () => [],
    ),
    (error) => error?.code === 'remote_dns_no_records',
    'empty DNS must fail closed with no_records',
  );
  assert.equal(marks[key] ?? 0, 0, 'empty DNS must not reach fetch');
  {
    const keys = {};
    const key2 = 'dns_throw';
    await assert.rejects(
      () => policy.fetchReviewedRemoteMedia(
        'https://pbs.twimg.com/media/dns-throw.png',
        async () => { keys[key2] = (keys[key2] ?? 0) + 1; throw new Error('unexpected'); },
        async () => { throw new Error('resolver threw'); },
      ),
      (error) => error?.code === 'remote_dns_resolution_failed',
      'throwing resolver must fail closed as resolution_failed',
    );
    assert.equal(keys[key2] ?? 0, 0, 'throwing resolver must not reach fetch');
  }
}

// Redirect from an allowed public first hop to a forbidden/private target:
// exactly one first-hop fetch, zero second-hop (forbidden) fetches.
{
  const calls = [];
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia(
      'https://pbs.twimg.com/media/redirect-to-private.png',
      async (_input, init) => {
        calls.push({ input: String(_input), redirect: init?.redirect });
        return new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/latest/meta-data' },
        });
      },
      publicDnsResolver,
    ),
    (error) => error?.code === 'remote_media_url_host_blocked',
    'redirect to metadata must be rejected',
  );
  assert.equal(calls.length, 1, 'only the allowed first hop may be fetched on redirect-to-private');
  assert.equal(calls[0].input, 'https://pbs.twimg.com/media/redirect-to-private.png');
  assert.equal(calls[0].redirect, 'manual');
}
// Redirect to a private numeric host (encoded) must also never be followed.
{
  const calls = [];
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia(
      'https://pbs.twimg.com/media/redirect-to-encoded-private.png',
      async (_input, init) => {
        calls.push({ input: String(_input), redirect: init?.redirect });
        return new Response(null, {
          status: 302,
          headers: { location: 'https://2130706433/secret' },
        });
      },
      publicDnsResolver,
    ),
    (error) => error?.code === 'remote_media_url_host_blocked',
    'encoded-loopback redirect target must be rejected',
  );
  assert.equal(calls.length, 1, 'encoded-private redirect may only use the single first hop');
  assert.equal(calls[0].input, 'https://pbs.twimg.com/media/redirect-to-encoded-private.png');
}
// Redirect to IPv6 link-local [fe80::1] must also be rejected at the host
// boundary: exactly one allowed first-hop fetch, zero forbidden second hops.
{
  const calls = [];
  await assert.rejects(
    () => policy.fetchReviewedRemoteMedia(
      'https://pbs.twimg.com/media/redirect-to-v6linklocal.png',
      async (_input, init) => {
        calls.push({ input: String(_input), redirect: init?.redirect });
        return new Response(null, {
          status: 302,
          headers: { location: 'https://[fe80::1]/x.jpg' },
        });
      },
      publicDnsResolver,
    ),
    (error) => error?.code === 'remote_media_url_host_blocked',
    'IPv6 link-local redirect target must be rejected',
  );
  assert.equal(calls.length, 1, 'IPv6 link-local redirect may only use the single first hop');
  assert.equal(calls[0].input, 'https://pbs.twimg.com/media/redirect-to-v6linklocal.png');
}

// Happy path still succeeds (allowlisted public DNS + public IP).
{
  const marks = {};
  const key = 'happy';
  const ok = await policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/allowed-zero-egress.png',
    async (_input, init) => {
      marks[key] = (marks[key] ?? 0) + 1;
      assert.equal(init?.redirect, 'manual');
      return new Response(pngBytes(), { headers: { 'content-type': 'image/png' } });
    },
    publicDnsResolver,
  );
  assert.equal(ok.contentType, 'image/png');
  assert.equal(ok.body.byteLength, pngBytes().byteLength);
  assert.equal(marks[key], 1, 'happy path must perform exactly one allowed fetch');
}

let hangingResolversStarted = 0;
let resolveHangingResolversStarted;
const hangingResolversStartedPromise = new Promise((resolve) => {
  resolveHangingResolversStarted = resolve;
});
const hangingDnsController = new AbortController();
const hangingDns = policy.assertReviewedRemotePublicDns(
  'pbs.twimg.com',
  async () => {
    hangingResolversStarted += 1;
    if (hangingResolversStarted === 2) resolveHangingResolversStarted();
    return new Promise(() => {});
  },
  hangingDnsController.signal,
  'remote_json_fetch_timeout',
);
await hangingResolversStartedPromise;
hangingDnsController.abort();
await assert.rejects(
  () => hangingDns,
  (error) => error?.code === 'remote_json_fetch_timeout',
  'DNS resolution must reject on abort even when the resolver ignores its signal',
);
assert.equal(hangingResolversStarted, 2, 'both A and AAAA lookups must have started before aborting the ignored-signal fixture');

const redirectCalls = [];
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/redirect.jpg',
    async (input, init) => {
      redirectCalls.push({ input: String(input), redirect: init?.redirect });
      return new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data' },
      });
    },
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_url_host_blocked',
);
assert.deepEqual(redirectCalls, [{ input: 'https://pbs.twimg.com/media/redirect.jpg', redirect: 'manual' }]);

await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/nonconforming-fetch.png',
    async () => responseMarkedRedirected(new Response(pngBytes(), {
      headers: { 'content-type': 'image/png' },
    })),
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_redirect_auto_follow_blocked',
);

let redirectStep = 0;
const dnsHops = [];
const redirectedVideo = await policy.fetchReviewedRemoteMedia(
  'https://pbs.twimg.com/media/redirect.mp4',
  async () => {
    redirectStep += 1;
    return redirectStep === 1
      ? new Response(null, { status: 302, headers: { location: 'https://video.twimg.com/ext_tw_video/allowed.mp4' } })
      : new Response(mp4Bytes(), { headers: { 'content-type': 'video/mp4' } });
  },
  async (hostname, recordType) => {
    dnsHops.push(`${hostname}:${recordType}`);
    return publicDnsResolver(hostname, recordType);
  },
);
assert.equal(redirectStep, 2);
assert.equal(redirectedVideo.contentType, 'video/mp4');
assert.deepEqual(
  [...dnsHops].sort(),
  [
    'pbs.twimg.com:A', 'pbs.twimg.com:AAAA',
    'video.twimg.com:A', 'video.twimg.com:AAAA',
  ].sort(),
  'every redirect hop must be DNS-revalidated',
);

await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/oversized.png',
    async () => new Response(pngBytes(), {
      headers: {
        'content-type': 'image/png',
        'content-length': String(policy.MAX_REMOTE_MEDIA_BYTES + 1),
      },
    }),
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_content_length_exceeded',
);
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/compressed.png',
    async () => new Response(pngBytes(), {
      headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' },
    }),
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_content_encoding_blocked',
);
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/mismatch.jpg',
    async () => new Response(pngBytes(), { headers: { 'content-type': 'image/jpeg' } }),
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_magic_mismatch',
);
await assert.rejects(
  () => policy.fetchReviewedRemoteMedia(
    'https://pbs.twimg.com/media/long-location.png',
    async () => new Response(null, {
      status: 302,
      headers: { location: `/${'a'.repeat(policy.MAX_REMOTE_MEDIA_URL_LENGTH + 1)}` },
    }),
    publicDnsResolver,
  ),
  (error) => error?.code === 'remote_media_redirect_location_too_long',
);

assert.equal(
  policy.validateReviewedRemoteJsonUrl('fxtwitter', 'https://api.fxtwitter.com/source/status/123').hostname,
  'api.fxtwitter.com',
);
expectPolicyCode(
  () => policy.validateReviewedRemoteJsonUrl('fxtwitter', 'https://api.x.com/2/tweets/123'),
  'remote_json_url_host_blocked',
);
let jsonFetchInit;
const reviewedJson = await policy.fetchReviewedRemoteJson(
  'fxtwitter',
  'https://api.fxtwitter.com/source/status/123',
  {
    fetchImpl: async (_input, init) => {
      jsonFetchInit = init;
      return jsonResponse({ tweet: { media: {} } });
    },
    resolveDns: publicDnsResolver,
  },
);
assert.deepEqual(reviewedJson.body, { tweet: { media: {} } });
assert.equal(jsonFetchInit?.redirect, 'error');
assert.equal(new Headers(jsonFetchInit?.headers).get('accept-encoding'), 'identity');
await assert.rejects(
  () => policy.fetchReviewedRemoteJson(
    'vxtwitter',
    'https://api.vxtwitter.com/source/status/123',
    {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
      resolveDns: publicDnsResolver,
    },
  ),
  (error) => error?.code === 'remote_json_redirect_blocked',
);
await assert.rejects(
  () => policy.fetchReviewedRemoteJson(
    'x_api',
    'https://api.x.com/2/tweets/123',
    {
      fetchImpl: async () => jsonResponse({}, 200, {
        'content-length': String(policy.MAX_REVIEWED_REMOTE_JSON_BYTES + 1),
      }),
      resolveDns: publicDnsResolver,
    },
  ),
  (error) => error?.code === 'remote_json_content_length_exceeded',
);
await assert.rejects(
  () => policy.fetchReviewedRemoteJson(
    'x_api',
    'https://api.x.com/2/tweets/123',
    {
      fetchImpl: async () => jsonResponse({ items: Array.from({ length: 65 }, () => ({})) }),
      resolveDns: publicDnsResolver,
    },
  ),
  (error) => error?.code === 'remote_json_shape_invalid',
);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(sources)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected('media allowlist', (source) => ({
    ...source,
    policy: source.policy.replace('"video.twimg.com",', '"evil.example",'),
  }));
  assertRejected('media acceptance cap', (source) => ({
    ...source,
    policy: source.policy.replace(
      'const acceptanceLimit = normalizeRemoteMediaAcceptanceLimit(maxAccepted);',
      'const acceptanceLimit = maxAccepted;',
    ),
  }));
  assertRejected('DNS prefetch', (source) => ({
    ...source,
    policy: source.policy.replace('await assertReviewedRemotePublicDns(', 'await skippedDnsGuard('),
  }));
  assertRejected('DNS resolver abort race', (source) => ({
    ...source,
    policy: source.policy.replace('function awaitDnsWithAbort<T>(', 'function skippedDnsWithAbort<T>('),
  }));
  assertRejected('initial URL timer hygiene', (source) => ({
    ...source,
    policy: source.policy.replace(
      'let currentUrl = validateReviewedRemoteMediaUrl(source.toString());\n  const controller = new AbortController();',
      'const controller = new AbortController();\n  let currentUrl = validateReviewedRemoteMediaUrl(source.toString());',
    ),
  }));
  assertRejected('manual redirect handling', (source) => ({
    ...source,
    policy: source.policy.replace('redirect: "manual"', 'redirect: "follow"'),
  }));
  assertRejected('JSON redirect handling', (source) => ({
    ...source,
    policy: source.policy.replace('redirect: "error"', 'redirect: "follow"'),
  }));
  assertRejected('stream byte cap', (source) => ({
    ...source,
    policy: source.policy.replace('MAX_REMOTE_MEDIA_BYTES = 50 * 1024 * 1024', 'MAX_REMOTE_MEDIA_BYTES = 500 * 1024 * 1024'),
  }));
  assertRejected('magic enforcement', (source) => ({
    ...source,
    policy: source.policy.replace('assertReviewedRemoteMediaMagic(contentType, body);', ''),
  }));
  assertRejected('processor egress guard', (source) => ({
    ...source,
    processor: source.processor.replace('fetchReviewedRemoteMedia(sourceUrl)', 'fetch(media.src_url)'),
  }));
  assertRejected('processor reuse lookup guard', (source) => ({
    ...source,
    processor: source.processor.replace("if (existingRowsError) throw new Error('media_reuse_lookup_failed');", "if (false) throw new Error('media_reuse_lookup_failed');"),
  }));
  assertRejected('RSS ingress guard', (source) => ({
    ...source,
    webhook: source.webhook.replace('filterReviewedRemoteMediaItems(prefilteredMediaItems)', 'prefilteredMediaItems'),
  }));
  assertRejected('proxy JSON boundary', (source) => ({
    ...source,
    workflow: source.workflow.replace('fetchReviewedRemoteJson(', 'fetch('),
  }));
  assertRejected('downloader proxy JSON boundary', (source) => ({
    ...source,
    xPosting: source.xPosting.replace('fetchReviewedRemoteJson(\n      "fxtwitter",', 'fetch(\n      "fxtwitter",'),
  }));
  assertRejected('downloader proxy media egress guard', (source) => ({
    ...source,
    xPosting: source.xPosting.replace('filterReviewedRemoteMediaItems(media)', '({ accepted: media })'),
  }));
  assertRejected('downloader hostile-host regression fixture', (source) => ({
    ...source,
    xPostingTest: source.xPostingTest.replace(
      'https://unreviewed.example/high.mp4',
      'https://video.twimg.com/ext_tw_video/hostile-fixture-was-removed.mp4',
    ),
  }));
  assertRejected('downloader reviewed-host selection assertion', (source) => ({
    ...source,
    xPostingTest: source.xPostingTest.replace(
      'assertEquals(body.tweet.media[0].qualityLabel, "720p @ 1.5Mbps");',
      'assertEquals(body.tweet.media[0].qualityLabel, "720p @ 9Mbps");',
    ),
  }));
  assertRejected('downloader provider-URL redaction assertion', (source) => ({
    ...source,
    xPostingTest: source.xPostingTest.replace(
      'assertEquals("url" in body.tweet.media[0], false);',
      'assertEquals("url" in body.tweet.media[0], true);',
    ),
  }));
  assertRejected('reprocess ingress guard', (source) => ({
    ...source,
    worker: source.worker.replace('filterReviewedRemoteMediaItems(extractedMediaItems)', 'extractedMediaItems'),
  }));
  assertRejected('reprocess staged media preservation guard', (source) => ({
    ...source,
    worker: source.worker.replace(
      '"reprocess_media_staging_required",\n      {\n        extracted_media_count: extractedMediaItems.length,',
      '"media_reprocessed",\n      {\n        extracted_media_count: extractedMediaItems.length,',
    ),
  }));
  selfTest = 'pass';
}

console.log(`REMOTE_MEDIA_POLICY_SOURCE_CONTRACT_PASS hosts=2 maxBytes=${policy.MAX_REMOTE_MEDIA_BYTES} jsonMaxBytes=${policy.MAX_REVIEWED_REMOTE_JSON_BYTES} selfTest=${selfTest}`);
