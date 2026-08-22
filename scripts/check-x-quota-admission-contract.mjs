import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  quota: join(repoRoot, 'supabase/functions/_shared/xQuotaAdmission.ts'),
  quotaTest: join(repoRoot, 'supabase/functions/_shared/xQuotaAdmission.test.ts'),
  poster: join(repoRoot, 'supabase/functions/x-poster/index.ts'),
  settings: join(repoRoot, 'supabase/functions/admin-actions/settings.ts'),
  settingsTest: join(repoRoot, 'supabase/functions/admin-actions/settings.test.ts'),
  rateLimitsUi: join(repoRoot, 'src/components/settings/XRateLimits.tsx'),
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
  return result.outputText;
}

function indexOfOrFail(source, needle, message) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = indexOfOrFail(source, startNeedle, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function validateStructural(source) {
  for (const [name, path] of Object.entries(paths)) transpile(path, source[name]);

  const quota = source.quota;
  const quotaTest = source.quotaTest;
  const poster = source.poster;
  const settings = source.settings;
  const settingsTest = source.settingsTest;
  const rateLimitsUi = source.rateLimitsUi;
  assert.match(quota, /export const X_QUOTA_UNAVAILABLE = "quota_unavailable" as const/, 'quota availability must use one stable code');
  assert.match(quota, /export const X_POSTING_QUOTA_MAX = \{/, 'quota range caps must live beside the shared admission policy');
  assert.match(quota, /export function getXQuotaBlockReason/, 'quota admission must remain a pure shared helper');
  assert.match(quota, /if \(!input\.available \|\| !Number\.isSafeInteger\(input\.nowMs\) \|\| input\.nowMs < 0\)/, 'unavailable/invalid clocks must fail closed');
  assert.match(quota, /!isBoundedPositiveInteger\(limits\.posts_per_hour, X_POSTING_QUOTA_MAX\.posts_per_hour\)/, 'hourly quota settings must be typed and range-bounded');
  assert.match(quota, /!isBoundedPositiveInteger\(limits\.monthly_post_budget, X_POSTING_QUOTA_MAX\.monthly_post_budget\)/, 'monthly quota settings must be typed and range-bounded');
  assert.match(quota, /!isNonNegativeInteger\(snapshot\.posts30d\)/, 'monthly snapshots must be typed');
  assert.match(quota, /!isOptionalNonNegativeInteger\(config\.daily_budget\)/, 'optional daily budgets must be typed');
  assert.match(quota, /snapshot\.posts30d >= limits\.monthly_post_budget/, 'monthly quota boundary must remain explicit');
  assert.match(quota, /input\.nowMs - snapshot\.lastPostTimeMs < config\.min_spacing_minutes \* 60 \* 1000/, 'minimum spacing must use the injected current time');
  assert.match(quotaTest, /Deno\.test\("X quota admission accepts only typed available quota snapshots"/, 'future Deno coverage must retain unavailable/typed controls');
  assert.match(quotaTest, /"rate_limit_month"/, 'future Deno coverage must retain a monthly boundary control');
  assert.match(settings, /const nonNegativeQuotaConfig = \["daily_budget", "min_spacing_minutes"\];/, 'admin settings validation must protect optional X posting quota values');
  assert.match(settings, /typeof value !== "number" \|\| !Number\.isSafeInteger\(value\) \|\| value < 0/, 'optional X posting quota values must be non-negative whole numbers');
  assert.match(settings, /\["hydrations_per_day", 1, 10000\]/, 'hydration quotas must use the same validated settings boundary');
  assert.match(settings, /typeof value !== "number" \|\| !Number\.isSafeInteger\(value\) \|\| value < min/, 'persisted X rate limits must be whole numbers');
  assert.match(settings, /!Number\.isSafeInteger\(v\.max_posts_per_run\)/, 'per-run posting caps must be whole numbers');
  assert.match(settingsTest, /x_rate_limits\.posts_per_hour must be a whole number 1-1000/, 'future Deno coverage must retain fractional posting limit rejection');
  assert.match(settingsTest, /x_rate_limits\.hydrations_per_day must be a whole number 1-10000/, 'future Deno coverage must retain fractional hydration limit rejection');
  assert.match(settingsTest, /max_posts_per_run: 1\.5/, 'future Deno coverage must retain fractional per-run-cap rejection');
  assert.match(rateLimitsUi, /function wholeLimit\(value: string, min: number, max: number\)/, 'rate-limit UI must normalize numeric controls to whole bounds');
  assert.equal(countOccurrences(rateLimitsUi, 'step={1}'), 5, 'every editable X quota control must declare whole-number steps');

  assert.match(poster, /getXQuotaBlockReason,\s*X_POSTING_QUOTA_MAX,\s*X_QUOTA_UNAVAILABLE/s, 'x-poster must import the shared quota policy and range caps');
  assert.match(poster, /function isOptionalNonNegativeSafeInteger\(v: unknown\): boolean \{\s*return v === undefined \|\| \(typeof v === 'number' && Number\.isSafeInteger\(v\) && v >= 0\);/s, 'optional persisted quota values must type-check before numeric comparison');
  assert.match(poster, /function quotaUnavailableResponse\(\): Response \{\s*return xPosterJson\(\{ ok: false, skipped: true, reason: X_QUOTA_UNAVAILABLE \}, 503\);/s, 'quota failures must return a stable 503 without raw error text');
  const main = sliceBetween(poster, 'Deno.serve(async (req) => {', '\n});');
  const settingsReadIndex = indexOfOrFail(main, 'let settingsRows: unknown = null;', 'settings result must be retained without a throwing escape path');
  const settingsBlockIndex = indexOfOrFail(main, 'if (settingsError !== null || !Array.isArray(settingsRows))', 'settings shape/error must fail closed');
  const settingsRowShapeIndex = indexOfOrFail(main, 'if (settingsRows.some((row) => !isRecord(row) || typeof row.key !== \'string\'))', 'settings rows must be structurally validated');
  const settingsPolicyIndex = indexOfOrFail(main, "!hasSetting('x_posting_config') ||", 'missing X posting settings must fail closed rather than default');
  assert.match(main, /!hasSetting\('x_rate_limits'\) \|\|/, 'missing X rate-limit settings must fail closed rather than default');
  const quotaQueryIndex = indexOfOrFail(main, 'let quotaResults: Array<Record<string, unknown>> = [];', 'quota reads must retain a throwing rejection path');
  const quotaErrorIndex = indexOfOrFail(main, 'quotaResults.length !== 5 ||', 'every quota query result must be structurally checked');
  const quotaHistoryIndex = indexOfOrFail(main, '!isNonNegativeSafeInteger(monthlyPosts)', 'null or malformed quota counts must fail closed');
  const quotaTimestampIndex = indexOfOrFail(main, "if (latestPost !== undefined && typeof lastPostAt !== 'string')", 'a malformed latest-post timestamp must fail closed');
  const manualCallIndex = indexOfOrFail(main, 'const manualResponse = await handleManualVideoIntakePost({', 'manual post path must remain present');
  const candidateSelectionIndex = indexOfOrFail(main, '// Select candidates', 'scheduled post path must remain present');
  const quotaBlockIndex = indexOfOrFail(main, 'const quotaBlock = (): string | null => {', 'manual and scheduled paths must share one quota closure');
  const quotaPreflightIndex = indexOfOrFail(main, 'if (quotaBlock() === X_QUOTA_UNAVAILABLE)', 'malformed quota snapshots must return stable 503 before X paths');
  const settingsLoad = sliceBetween(main, '// Load settings', 'if (settingsError !== null || !Array.isArray(settingsRows))');
  const quotaLoad = sliceBetween(main, 'let quotaResults: Array<Record<string, unknown>> = [];', 'if (\n    quotaResults.length !== 5');
  assert.match(settingsLoad, /try \{[\s\S]*\} catch \(_error\) \{[\s\S]*return quotaUnavailableResponse\(\);/, 'rejected settings reads must return stable quota_unavailable');
  assert.match(quotaLoad, /try \{[\s\S]*await Promise\.all\([\s\S]*\} catch \(_error\) \{[\s\S]*return quotaUnavailableResponse\(\);/, 'rejected quota reads must return stable quota_unavailable');
  assert.ok(settingsReadIndex < settingsBlockIndex && settingsBlockIndex < settingsRowShapeIndex && settingsRowShapeIndex < settingsPolicyIndex && settingsPolicyIndex < quotaQueryIndex, 'settings failures must stop before quota reads');
  assert.ok(quotaQueryIndex < quotaErrorIndex && quotaErrorIndex < quotaHistoryIndex && quotaHistoryIndex < quotaTimestampIndex && quotaTimestampIndex < quotaBlockIndex, 'all quota query/count/timestamp errors must stop before counts are admitted');
  assert.ok(quotaPreflightIndex < manualCallIndex && quotaPreflightIndex < candidateSelectionIndex, 'quota unavailability must stop manual and scheduled paths');
  assert.ok(countOccurrences(main, 'return quotaUnavailableResponse();') >= 8, 'settings, quota-query, shape, count, timestamp, and preflight failures must all use the stable unavailable response');
  assert.match(main, /let monthlyPostsCount = monthlyPosts;/, 'monthly count must be tracked separately from the raw query result');
  assert.doesNotMatch(main, /(?:monthlyPosts|posts24hDb|posts1hDb|mediaUp24hDb) \?\? 0/, 'null quota counts must never normalize to zero');
  assert.match(main, /posts30d: monthlyPostsCount/, 'shared quota closure must receive the mutable monthly count');
  assert.match(main, /monthlyPostsCount \+= 1;/, 'a successful post must consume monthly capacity for later candidates in the same invocation');
  assert.match(main, /requiredPostingQuotaFields\.some\(\(\[field, max\]\) => !isBoundedPositiveSafeInteger\(rawRateLimits\[field\], max\)\)/, 'raw persisted quota settings must honor the same upper bounds');
  assert.doesNotMatch(main, /if \(posts1hCount >= limits\.posts_per_hour\)/, 'direct untyped quota comparisons must not return');
  assert.doesNotMatch(main, /settingsError\.message|result\.error\.message/, 'quota unavailability telemetry must not log database error text');

  const manual = sliceBetween(poster, 'async function handleManualVideoIntakePost', '// ─── Main');
  const manualQuotaIndex = indexOfOrFail(manual, 'const quotaReason = params.quotaBlock();', 'manual posting must consult the shared quota closure');
  const manualUploadIndex = indexOfOrFail(manual, 'mediaId = await uploadVideoChunked(', 'manual X media upload must remain present');
  assert.ok(manualQuotaIndex < manualUploadIndex, 'manual quota admission must happen before an X media upload');

  const scheduledQuotaIndex = indexOfOrFail(main, 'const blocked = quotaBlock();', 'scheduled posting must consult the shared quota closure');
  const scheduledUploadIndex = main.indexOf('await uploadVideoChunked(', scheduledQuotaIndex);
  const scheduledPostIndex = main.indexOf('const posted = await postTweet(', scheduledQuotaIndex);
  assert.ok(scheduledQuotaIndex >= 0 && scheduledQuotaIndex < scheduledUploadIndex, 'scheduled quota admission must precede X media upload');
  assert.ok(scheduledQuotaIndex >= 0 && scheduledQuotaIndex < scheduledPostIndex, 'scheduled quota admission must precede X post creation');
}

validateStructural(sources);

const quota = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(paths.quota, sources.quota)).toString('base64')}`,
);

const valid = {
  available: true,
  nowMs: 1_000_000,
  limits: {
    posts_per_hour: 2,
    posts_per_day: 3,
    monthly_post_budget: 4,
    media_uploads_per_day: 5,
  },
  config: { daily_budget: 0, min_spacing_minutes: 0 },
  snapshot: {
    posts1h: 1,
    posts24h: 2,
    posts30d: 3,
    mediaUploads24h: 4,
    lastPostTimeMs: 0,
  },
};
assert.equal(quota.getXQuotaBlockReason(valid), null, 'valid quota state below every limit must pass');
assert.equal(quota.getXQuotaBlockReason({ ...valid, available: false }), 'quota_unavailable', 'unavailable reads must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, limits: { ...valid.limits, posts_per_hour: '2' } }), 'quota_unavailable', 'malformed quota settings must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, limits: { ...valid.limits, posts_per_hour: 1_001 } }), 'quota_unavailable', 'out-of-range hourly quota settings must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, limits: { ...valid.limits, monthly_post_budget: 1_000_001 } }), 'quota_unavailable', 'out-of-range monthly quota settings must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, config: { daily_budget: null, min_spacing_minutes: 0 } }), 'quota_unavailable', 'null optional quota settings must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts1h: -1 } }), 'quota_unavailable', 'malformed count snapshots must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, lastPostTimeMs: Number.NaN } }), 'quota_unavailable', 'invalid last-post clocks must block');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts1h: 2 } }), 'rate_limit_hour');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts24h: 3 } }), 'rate_limit_day');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts30d: 4 } }), 'rate_limit_month');
assert.equal(quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, mediaUploads24h: 5 } }), 'rate_limit_media');
assert.equal(quota.getXQuotaBlockReason({ ...valid, config: { daily_budget: 2, min_spacing_minutes: 0 } }), 'daily_budget_reached');
assert.equal(quota.getXQuotaBlockReason({ ...valid, config: { daily_budget: 0, min_spacing_minutes: 1 }, snapshot: { ...valid.snapshot, lastPostTimeMs: 999_999 } }), 'min_spacing');
assert.equal(
  quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts30d: 3 } }),
  null,
  'a final available monthly slot must initially pass',
);
assert.equal(
  quota.getXQuotaBlockReason({ ...valid, snapshot: { ...valid.snapshot, posts30d: 4 } }),
  'rate_limit_month',
  'the same invocation must block the next candidate after the monthly counter advances',
);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      `${label} mutation must fail the source contract`,
    );
  };
  assertRejected('quota availability guard', (source) => ({
    ...source,
    quota: source.quota.replace('if (!input.available || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0)', 'if (false)'),
  }));
  assertRejected('quota query error guard', (source) => ({
    ...source,
    poster: source.poster.replace('quotaResults.length !== 5 ||', 'false ||'),
  }));
  assertRejected('settings missing-row guard', (source) => ({
    ...source,
    poster: source.poster.replace("!hasSetting('x_rate_limits') ||", 'false ||'),
  }));
  assertRejected('null-count guard', (source) => ({
    ...source,
    poster: source.poster.replace('!isNonNegativeSafeInteger(monthlyPosts)', 'false'),
  }));
  assertRejected('latest-post timestamp guard', (source) => ({
    ...source,
    poster: source.poster.replace("if (latestPost !== undefined && typeof lastPostAt !== 'string')", 'if (false)'),
  }));
  assertRejected('optional quota type guard', (source) => ({
    ...source,
    poster: source.poster.replace("return v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);", "return v === undefined || (Number.isSafeInteger(v) && v >= 0);"),
  }));
  assertRejected('quota upper-bound guard', (source) => ({
    ...source,
    quota: source.quota.replace('X_POSTING_QUOTA_MAX.posts_per_hour', 'Number.MAX_SAFE_INTEGER'),
  }));
  assertRejected('same-run monthly accounting', (source) => ({
    ...source,
    poster: source.poster.replace('monthlyPostsCount += 1;', 'monthlyPostsCount += 0;'),
  }));
  assertRejected('manual quota before upload', (source) => ({
    ...source,
    poster: source.poster.replace('const quotaReason = params.quotaBlock();', 'const quotaReason = null;'),
  }));
  assertRejected('admin whole-number validation', (source) => ({
    ...source,
    settings: source.settings.replace('typeof value !== "number" || !Number.isSafeInteger(value) || value < 0', 'typeof value !== "number" || value < 0'),
  }));
  assertRejected('whole-number UI controls', (source) => ({
    ...source,
    rateLimitsUi: source.rateLimitsUi.replace('step={1}', ''),
  }));
  selfTest = 'pass';
}

console.log(`X_QUOTA_ADMISSION_SOURCE_CONTRACT_PASS quota=fail-closed status=503 monthly=same-run selfTest=${selfTest}`);
