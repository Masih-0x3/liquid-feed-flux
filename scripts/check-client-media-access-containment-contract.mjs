import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  downloader: join(repoRoot, 'src/pages/Downloader.tsx'),
  mediaThumbnails: join(repoRoot, 'src/components/monitoring/MediaThumbnails.tsx'),
  monitoringDrawer: join(repoRoot, 'src/components/monitoring/MonitoringDetailDrawer.tsx'),
  videoRenderDetailPanel: join(repoRoot, 'src/components/video/VideoRenderDetailPanel.tsx'),
  videoRenderData: join(repoRoot, 'src/hooks/useVideoRenderData.ts'),
  videoRenders: join(repoRoot, 'src/pages/VideoRenders.tsx'),
  videoRendersTest: join(repoRoot, 'src/test/video-renders-page.test.tsx'),
  videoRenderActions: join(repoRoot, 'supabase/functions/admin-actions/videoRenderActions.ts'),
  videoRenderActionsTest: join(repoRoot, 'supabase/functions/admin-actions/videoRenderActions.test.ts'),
  videoRendererHealth: join(repoRoot, 'supabase/functions/_shared/videoRendererHealth.ts'),
  xPostingActions: join(repoRoot, 'supabase/functions/admin-actions/xPostingActions.ts'),
  xPostingActionsTest: join(repoRoot, 'supabase/functions/admin-actions/xPostingActions.test.ts'),
  packageJson: join(repoRoot, 'package.json'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
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
      jsx: typescript.JsxEmit.ReactJSX,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, path + ' must transpile without TypeScript diagnostics');
}

function parse(path, source) {
  return typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    path.endsWith('.tsx') ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS,
  );
}

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, 'missing ' + startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end >= 0, 'missing ' + endNeedle);
  return source.slice(start, end);
}

function propertyName(node) {
  if (!node || typescript.isComputedPropertyName(node)) return null;
  if (
    typescript.isIdentifier(node)
    || typescript.isStringLiteral(node)
    || typescript.isNumericLiteral(node)
  ) {
    return node.text;
  }
  return null;
}

function findFunction(file, name) {
  let found = null;
  const visit = (node) => {
    if (
      typescript.isFunctionDeclaration(node)
      && node.name
      && node.name.text === name
    ) {
      found = node;
    }
    typescript.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(found, 'missing function ' + name);
  return found;
}

function assertNoComputedOrSpread(file, functionName) {
  const fn = findFunction(file, functionName);
  const violations = [];
  const visit = (node) => {
    if (typescript.isSpreadAssignment(node) || typescript.isSpreadElement(node)) {
      violations.push('spread:' + node.getText(file));
    }
    if (typescript.isComputedPropertyName(node)) {
      violations.push('computed-property:' + node.getText(file));
    }
    if (typescript.isElementAccessExpression(node)) {
      violations.push('element-access:' + node.getText(file));
    }
    typescript.forEachChild(node, visit);
  };
  visit(fn);
  assert.deepEqual(
    violations,
    [],
    functionName + ' must use direct field access and explicit object fields',
  );
}

function assertExplicitReturnSchema(file, functionName, expectedFields) {
  const fn = findFunction(file, functionName);
  const returnObjects = [];
  const visit = (node) => {
    if (
      typescript.isReturnStatement(node)
      && node.expression
      && typescript.isObjectLiteralExpression(node.expression)
    ) {
      returnObjects.push(node.expression);
    }
    typescript.forEachChild(node, visit);
  };
  visit(fn);
  assert.equal(returnObjects.length, 1, functionName + ' must have exactly one explicit object response');
  const object = returnObjects[0];
  const fields = object.properties.map((property) => {
    assert.ok(
      typescript.isPropertyAssignment(property),
      functionName + ' response cannot use shorthand, methods, or spread properties',
    );
    const name = propertyName(property.name);
    assert.ok(name, functionName + ' response fields must use direct names');
    return name;
  });
  assert.deepEqual(
    [...new Set(fields)].sort(),
    [...expectedFields].sort(),
    functionName + ' response fields must match the explicit allowlist',
  );
  assertNoComputedOrSpread(file, functionName);
}

function assertNoBrowserMediaSink(path, source, label) {
  const file = parse(path, source);
  const violations = [];
  const unsafeJsxAttributes = new Set(['src', 'srcSet', 'poster', 'href', 'data', 'style']);
  const unsafeTags = new Set(['img', 'video', 'audio', 'source', 'iframe', 'object', 'embed']);
  const browserGlobals = new Set([
    'window',
    'document',
    'location',
    'globalThis',
    'self',
    'navigator',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'URL',
    'Request',
  ]);
  const unsafeMethods = new Set([
    'open',
    'createObjectURL',
    'revokeObjectURL',
    'createElement',
    'setAttribute',
    'insertAdjacentHTML',
    'append',
    'appendChild',
    'replaceChildren',
  ]);

  const visit = (node) => {
    if (typescript.isIdentifier(node) && browserGlobals.has(node.text)) {
      violations.push('browser-global:' + node.text);
    }
    if (
      typescript.isNewExpression(node)
      && typescript.isIdentifier(node.expression)
      && ['Image', 'Audio', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request'].includes(node.expression.text)
    ) {
      violations.push('browser-constructor:' + node.getText(file));
    }
    if (typescript.isCallExpression(node)) {
      if (typescript.isIdentifier(node.expression) && node.expression.text === 'fetch') {
        violations.push('fetch:' + node.getText(file));
      }
      if (
        typescript.isPropertyAccessExpression(node.expression)
        && unsafeMethods.has(node.expression.name.text)
      ) {
        violations.push('browser-url-api:' + node.getText(file));
      }
    }
    if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (unsafeTags.has(tag)) {
        violations.push('media-element:' + tag);
      }
      for (const attribute of node.attributes.properties) {
        if (
          typescript.isJsxAttribute(attribute)
          && unsafeJsxAttributes.has(attribute.name.text)
        ) {
          violations.push('browser-url-attribute:' + attribute.name.text);
        }
      }
    }
    if (typescript.isPropertyAssignment(node) && propertyName(node.name) === 'backgroundImage') {
      violations.push('background-image:' + node.getText(file));
    }
    typescript.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(violations, [], label + ' must not create a browser media URL sink during containment');
}

function isTweetMediaCollection(node) {
  return typescript.isPropertyAccessExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === 'tweetData'
    && node.name.text === 'media';
}

function assertDownloaderMetadataBoundary(source) {
  const file = parse(paths.downloader, source);
  const violations = [];
  const tweetMediaAccesses = [];
  const unsafeFields = new Set(['url', 'thumbnail_url', 'user_profile_image_url']);

  const visit = (node) => {
    if (typescript.isPropertyAccessExpression(node) && unsafeFields.has(node.name.text)) {
      violations.push('raw-url-property:' + node.getText(file));
    }
    if (
      typescript.isElementAccessExpression(node)
      && typescript.isStringLiteral(node.argumentExpression)
      && unsafeFields.has(node.argumentExpression.text)
    ) {
      violations.push('raw-url-element-access:' + node.getText(file));
    }
    if (
      typescript.isElementAccessExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === 'tweetData'
    ) {
      violations.push('tweet-media-element-access:' + node.getText(file));
    }
    if (
      typescript.isVariableDeclaration(node)
      && typescript.isObjectBindingPattern(node.name)
      && node.name.elements.some((element) => propertyName(element.propertyName ?? element.name) === 'media')
    ) {
      violations.push('tweet-media-destructure:' + node.getText(file));
    }
    if (typescript.isObjectBindingPattern(node)) {
      for (const element of node.elements) {
        const name = propertyName(element.propertyName ?? element.name);
        if (name && unsafeFields.has(name)) {
          violations.push('raw-url-destructure:' + node.getText(file));
        }
      }
    }
    if (
      typescript.isVariableDeclaration(node)
      && node.initializer
      && typescript.isIdentifier(node.initializer)
      && node.initializer.text === 'media'
    ) {
      violations.push('media-alias:' + node.getText(file));
    }
    if (typescript.isSpreadElement(node) && typescript.isIdentifier(node.expression) && node.expression.text === 'media') {
      violations.push('media-spread:' + node.getText(file));
    }
    if (typescript.isCallExpression(node) && node.arguments.some(
      (argument) => typescript.isIdentifier(argument) && argument.text === 'media',
    )) {
      violations.push('media-helper-argument:' + node.getText(file));
    }
    if (isTweetMediaCollection(node)) {
      tweetMediaAccesses.push(node.getText(file));
    }
    typescript.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(
    violations,
    [],
    'Downloader must use resolver media only for its bounded metadata cards',
  );
  assert.equal(
    tweetMediaAccesses.length,
    2,
    'Downloader must use tweet media only for the bounded count and checked map callback',
  );
}

function assertVideoRenderTargetTypes() {
  const configPath = join(repoRoot, 'tsconfig.app.json');
  const config = typescript.readConfigFile(configPath, typescript.sys.readFile);
  assert.equal(
    config.error,
    undefined,
    'Video render target typecheck must read tsconfig.app.json',
  );
  const parsed = typescript.parseJsonConfigFileContent(
    config.config,
    typescript.sys,
    repoRoot,
    undefined,
    configPath,
  );
  const targetFiles = new Set([
    paths.videoRenders,
    paths.videoRenderDetailPanel,
    paths.videoRenderData,
    paths.videoRendersTest,
  ]);
  const program = typescript.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = typescript.getPreEmitDiagnostics(program).filter(
    (diagnostic) => diagnostic.file && targetFiles.has(diagnostic.file.fileName),
  );
  assert.equal(
    diagnostics.length,
    0,
    'Video render target typecheck failed:\n' + typescript.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n',
    }),
  );
}

function validateStructural(source) {
  for (const name of [
    'downloader',
    'mediaThumbnails',
    'monitoringDrawer',
    'videoRenderDetailPanel',
    'videoRenderData',
    'videoRenders',
    'videoRendersTest',
    'videoRenderActions',
    'videoRenderActionsTest',
    'videoRendererHealth',
    'xPostingActions',
    'xPostingActionsTest',
  ]) {
    transpile(paths[name], source[name]);
  }

  assert.match(source.downloader, /action: "resolve_x_media"/, 'Downloader must retain the server-side reviewed metadata resolver');
  assert.doesNotMatch(source.downloader, /\bfetch\s*\(/, 'Downloader must not make a browser remote-media fetch');
  assert.doesNotMatch(source.downloader, /(?:createObjectURL|revokeObjectURL|window\.open\s*\()/, 'Downloader must not open or materialize a remote media URL');
  assert.doesNotMatch(source.downloader, /(?:\bsupabase\b|createSignedUrls|getPublicUrl|\.storage\b)/, 'Downloader must not bypass the server boundary with a direct media client');
  assert.doesNotMatch(source.downloader, /(?:<img\b|<video\b|<AvatarImage\b|Download File|Open Direct Link|data\?\.error)/, 'Downloader must not retain direct media controls or raw resolver errors');
  assert.match(source.downloader, /Preview and download are temporarily unavailable until authorised media access is implemented\. No remote media URL was opened\./, 'Downloader must explain that access is unavailable without claiming a download');
  assert.match(source.downloader, /Authorised preview unavailable/, 'Downloader cards must visibly distinguish metadata from an authorised preview');
  assert.match(source.downloader, /tweetData\.media\.map\(\(media, index\) =>/, 'Downloader must retain the checked media callback boundary');
  assertNoBrowserMediaSink(paths.downloader, source.downloader, 'Downloader');
  assertDownloaderMetadataBoundary(source.downloader);
  const downloaderMediaType = between(source.downloader, 'type ResolvedMedia = {', 'type TweetInfo = {');
  const downloaderTweetType = between(source.downloader, 'type TweetInfo = {', 'const TWEET_REGEX');
  assert.doesNotMatch(downloaderMediaType, /(?:\burl\b|thumbnail_url)/, 'Downloader response type must not admit raw media URLs');
  assert.doesNotMatch(downloaderTweetType, /user_profile_image_url/, 'Downloader response type must not admit raw profile URLs');

  assert.doesNotMatch(source.mediaThumbnails, /(?:\bsupabase\b|\.from\(\s*["']media["']\s*\)|\.storage\b|createSignedUrls|\bsrc_url\b|\bstorage_path\b)/, 'Monitoring thumbnails must not query/sign/fallback to client media access');
  assert.match(source.mediaThumbnails, /role="status"/, 'Monitoring containment must expose an accessible status');
  assert.match(source.mediaThumbnails, /Authorised media access has not been configured\. No remote media was loaded\./, 'Monitoring containment must explain why no media is shown');
  assertNoBrowserMediaSink(paths.mediaThumbnails, source.mediaThumbnails, 'Monitoring thumbnails');
  assert.match(source.monitoringDrawer, /\{entry\.has_media && <MediaThumbnails \/>\}/, 'Monitoring must show the unavailable state only when media exists');
  assert.doesNotMatch(source.monitoringDrawer, /VideoRenderDetailPanel/, 'Monitoring drawer must not mount a second media route beneath the unavailable state');

  assert.match(source.videoRenderDetailPanel, /Media preview unavailable/, 'Video render detail must visibly explain preview containment');
  assert.match(source.videoRenderDetailPanel, /Authorised media access has not been configured\. Render status and review controls remain available; no remote media was loaded\./, 'Video render detail must not claim that it loaded remote media');
  assert.doesNotMatch(source.videoRenderDetailPanel, /(?:source_signed_url|output_signed_url|<video\b|<audio\b|href=|Open processed video)/, 'Video render detail must not retain signed-media playback or open controls during containment');
  assert.doesNotMatch(source.videoRenderDetailPanel, /render\?\.metrics\s*\?\?\s*\{\}/, 'Video render detail must not widen the fixed metrics type with an empty object fallback');
  assertNoBrowserMediaSink(paths.videoRenderDetailPanel, source.videoRenderDetailPanel, 'Video render detail');
  assert.doesNotMatch(source.videoRenders, /<VideoRenderDetailPanel[\s\S]*?\bcompact(?:\s|=|\/)/, 'Video Renders must not pass the removed compact prop to the contained detail panel');

  assert.doesNotMatch(source.videoRenderData, /(?:output_storage_path|\bstorage_path\b|\bsrc_url\b|source_signed_url|output_signed_url)/, 'Video render frontend types must not admit raw paths, origins, or signed URLs');
  const frontendQueueType = between(source.videoRenderData, 'export interface VideoRenderQueueRow', 'export interface VideoRenderDetail');
  assert.match(frontendQueueType, /metrics: VideoRenderTimingMetrics;/, 'Video render frontend types must use the fixed timing metrics schema');
  assert.doesNotMatch(frontendQueueType, /\bpreflight\b|metrics:\s*Record<string, unknown>/, 'Video render frontend types must not admit arbitrary diagnostics or preflight records');
  const frontendDetailType = between(source.videoRenderData, 'export interface VideoRenderDetail', 'type VideoRenderPollingOptions');
  assert.match(frontendDetailType, /post: VideoRenderQueueRow\['post'\];/, 'Video render detail post must use the explicit queue post schema');
  assert.match(frontendDetailType, /feedback: Array<\{ id: string; label: string; note: string \| null; created_at: string \}>;/, 'Video render detail feedback must use the explicit feedback schema');
  assert.doesNotMatch(frontendDetailType, /Record<string, unknown>|metadata\?/, 'Video render detail types must not leave broad post or feedback response escape hatches');
  const frontendHeartbeatType = between(source.videoRenderData, 'export interface VideoRendererHeartbeat', 'export interface VideoRendererHealth');
  assert.doesNotMatch(frontendHeartbeatType, /\b(?:last_error|metadata)\b|Record<string, unknown>/, 'Video renderer heartbeat types must not admit raw diagnostics or arbitrary metadata');
  const frontendHealthType = between(source.videoRenderData, 'export interface VideoRendererHealth', 'export interface VideoRenderOverview');
  assert.doesNotMatch(frontendHealthType, /\blast_error\b|Record<string, unknown>/, 'Video renderer health types must not admit a raw diagnostic escape hatch');
  assert.doesNotMatch(source.videoRenderDetailPanel, /\bpreflight\b|compactJson/, 'Video render UI must not render raw preflight diagnostics during containment');
  assert.doesNotMatch(source.videoRendersTest, /\bpreflight\s*:|Historical renderer outage|last_error\s*:/, 'Video render page fixtures must match the contained diagnostics boundary');

  const videoFile = parse(paths.videoRenderActions, source.videoRenderActions);
  const safeMediaFields = ['id', 'kind', 'mime_type', 'file_size', 'duration_ms', 'width', 'height'];
  const safePostFields = ['tweet_id', 'text_original', 'url', 'author_handle', 'created_at', 'delivery_decision', 'final_score'];
  const safeFeedbackFields = ['id', 'label', 'note', 'created_at'];
  const safeHeartbeatFields = ['renderer_id', 'status', 'version', 'render_version', 'running', 'processed', 'failed', 'last_seen_at'];
  const safeHealthFields = ['state', 'server_observed_at', 'last_seen_at', 'age_ms', 'renderer_id', 'reported_status'];
  const safeTimingFields = [
    'total_ms',
    'config_load_ms',
    'source_lookup_ms',
    'post_context_lookup_ms',
    'download_ms',
    'probe_ms',
    'preflight_visual_ms',
    'contact_sheet_ms',
    'vision_frames_ms',
    'vision_inspection_sheets_ms',
    'local_ocr_ms',
    'watermark_vision_ms',
    'delogo_recovery_ms',
    'audio_extract_ms',
    'audio_extract_enhanced_ms',
    'audio_extract_early_ms',
    'transcription_ms',
    'transcript_cleanup_ms',
    'translation_ms',
    'subtitle_generate_ms',
    'encode_ms',
    'upload_ms',
  ];
  const safeRenderFields = [
    'id',
    'tweet_id',
    'source_media_id',
    'status',
    'failure_policy',
    'render_version',
    'render_revision',
    'output_file_size',
    'width',
    'height',
    'duration_ms',
    'source_language',
    'target_language',
    'metrics',
    'error',
    'block_reason',
    'attempts',
    'queued_at',
    'started_at',
    'completed_at',
    'failed_at',
    'blocked_at',
    'reviewed_at',
    'reviewed_by',
    'updated_at',
    'created_at',
    'action_label',
    'activity_at',
  ];
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientPost', safePostFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientMedia', safeMediaFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientFeedback', safeFeedbackFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientHeartbeat', safeHeartbeatFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientHealth', safeHealthFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientTimingMetrics', safeTimingFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientRenderFields', safeRenderFields);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderClientQueueRow', [...safeRenderFields, 'post', 'media', 'latest_feedback']);
  assertExplicitReturnSchema(videoFile, 'toVideoRenderDetailClientRender', [...safeRenderFields, 'original_srt', 'persian_srt', 'translated_srt', 'ass_subtitles']);
  const videoNormalizers = between(source.videoRenderActions, 'export function toVideoRenderClientPost', 'export function latestTimestamp');
  assert.doesNotMatch(videoNormalizers, /(?:output_storage_path|\bstorage_path\b|\bsrc_url\b|source_signed_url|output_signed_url|createSignedUrl)/, 'Video render client normalizers must not expose raw paths, origins, or signed URLs');
  assert.doesNotMatch(videoNormalizers, /(?:metrics:\s*clientNullableRecord\(row\.metrics\)|error:\s*clientNullableString\(row\.error\)|block_reason:\s*clientNullableString\(row\.block_reason\)|\bpreflight\s*:)/, 'Video render client normalizers must not pass through arbitrary metrics, preflight records, or raw diagnostics');
  const renderFieldsNormalizer = between(source.videoRenderActions, 'export function toVideoRenderClientRenderFields', 'export function toVideoRenderClientQueueRow');
  assert.match(renderFieldsNormalizer, /metrics:\s*toVideoRenderClientTimingMetrics\(row\.metrics\)/, 'Render fields must pass metrics through the fixed timing allowlist');
  assert.match(renderFieldsNormalizer, /error:\s*toVideoRenderClientDiagnostic\(row\.error, 'render_failed'\)/, 'Render fields must replace raw errors with a bounded diagnostic code');
  assert.match(renderFieldsNormalizer, /block_reason:\s*toVideoRenderClientDiagnostic\(row\.block_reason, 'render_blocked'\)/, 'Render fields must replace raw block reasons with a bounded diagnostic code');
  const diagnosticNormalizer = between(source.videoRenderActions, 'export function toVideoRenderClientDiagnostic', 'export function toVideoRenderClientRenderFields');
  assert.match(diagnosticNormalizer, /return clientNullableString\(value\) \? code : null;/, 'Diagnostic normalizer must preserve only the supplied safe code');
  const overviewAction = between(source.videoRenderActions, 'export async function getVideoRenderOverview', 'export function normalizeVideoRenderStatuses');
  assert.doesNotMatch(overviewAction, /\b(?:last_error|metadata)\b/, 'Video render overview must not select or return raw heartbeat diagnostics');
  assert.match(overviewAction, /toVideoRenderClientHeartbeat\(heartbeat\)/, 'Overview heartbeat rows must cross the explicit client allowlist');
  assert.match(overviewAction, /toVideoRenderClientHealth\(classifyVideoRendererHealth\(heartbeatRows, healthObservedAtMs\)\)/, 'Overview health must cross the explicit client allowlist');
  assert.doesNotMatch(source.videoRendererHealth, /\blast_error\b/, 'Shared renderer health classification must not emit raw worker errors');
  const queueAction = between(source.videoRenderActions, 'export async function getVideoRenderQueue', 'export async function getVideoRenderDetail');
  const detailAction = between(source.videoRenderActions, 'export async function getVideoRenderDetail', 'export async function retryVideoRenderAdmin');
  assert.match(queueAction, /toVideoRenderClientQueueRow\(/, 'Queue response must cross the explicit client allowlist');
  assert.doesNotMatch(queueAction, /(?:\.\.\.\s*row|\bstorage_path\b|\bsrc_url\b)/, 'Queue response must not spread or select raw media paths/origins');
  assert.match(detailAction, /render: toVideoRenderDetailClientRender\(render\)/, 'Detail render must cross the explicit client allowlist');
  assert.match(detailAction, /post: toVideoRenderClientPost\(postRes\.data\)/, 'Detail post must cross the explicit client allowlist');
  assert.match(detailAction, /media: toVideoRenderClientMedia\(mediaRes\.data\)/, 'Detail media must cross the explicit client allowlist');
  assert.match(detailAction, /\.map\(\(item\) => toVideoRenderClientFeedback\(item\)\)/, 'Detail feedback must cross the explicit client allowlist');
  assert.doesNotMatch(detailAction, /(?:\.\.\.\s*render|signedTempMediaUrl|source_signed_url|output_signed_url|\bstorage_path\b|\bsrc_url\b|createSignedUrl)/, 'Detail response must not issue or expose media URL/path fields');
  assert.match(source.videoRenderActionsTest, /video render client payloads expose metadata only during media containment/, 'Future Deno coverage must name the video response-redaction boundary');
  for (const field of ['storage_path', 'src_url', 'output_storage_path', 'source_signed_url', 'output_signed_url']) {
    assert.match(source.videoRenderActionsTest, new RegExp('"' + field + '" in'), 'Future Deno coverage must assert that ' + field + ' is absent');
  }
  assert.match(source.videoRenderActionsTest, /expired_storage_path/, 'Future Deno coverage must seed a nested storage path in raw metrics');
  assert.match(source.videoRenderActionsTest, /assertEquals\("expired_storage_path" in queue\.metrics, false\);/, 'Future Deno coverage must prove nested metrics paths are absent');
  assert.match(source.videoRenderActionsTest, /assertEquals\("preflight" in queue, false\);/, 'Future Deno coverage must prove queue preflight is absent');
  assert.match(source.videoRenderActionsTest, /assertEquals\("preflight" in detail, false\);/, 'Future Deno coverage must prove detail preflight is absent');
  assert.match(source.videoRenderActionsTest, /assertEquals\(queue\.error, "render_failed"\);/, 'Future Deno coverage must prove raw errors become a safe code');
  assert.match(source.videoRenderActionsTest, /assertEquals\(queue\.block_reason, "render_blocked"\);/, 'Future Deno coverage must prove raw block reasons become a safe code');
  assert.match(source.videoRenderActionsTest, /video renderer overview heartbeat client payloads expose operational metadata only/, 'Future Deno coverage must name the overview heartbeat redaction boundary');
  assert.match(source.videoRenderActionsTest, /assertEquals\("last_error" in \(heartbeat \?\? \{\}\), false\);/, 'Future Deno coverage must prove heartbeat errors are absent');
  assert.match(source.videoRenderActionsTest, /assertEquals\("metadata" in \(heartbeat \?\? \{\}\), false\);/, 'Future Deno coverage must prove heartbeat metadata is absent');
  assert.match(source.videoRenderActionsTest, /assertEquals\("last_error" in health, false\);/, 'Future Deno coverage must prove health errors are absent');

  const clientMetadata = between(source.xPostingActions, 'function toResolveXMediaClientMetadata', 'function finiteNumber');
  const xFile = parse(paths.xPostingActions, source.xPostingActions);
  assert.doesNotMatch(clientMetadata, /(?:\burl\b|thumbnail_url|user_profile_image_url)/, 'resolve_x_media metadata normalizer must not expose raw provider URL fields');
  assertNoComputedOrSpread(xFile, 'toResolveXMediaClientMetadata');
  const resolveAction = between(source.xPostingActions, 'export async function resolveXMediaAdminAction', 'export async function runXPostAdminAction');
  assert.match(resolveAction, /tweet: toResolveXMediaClientMetadata\(tweet\)/, 'resolve_x_media action must pass the server result through the client metadata boundary');
  assert.doesNotMatch(resolveAction, /body: \{ success: true, tweet \}/, 'resolve_x_media action must not return the raw provider result');
  assert.match(source.xPostingActionsTest, /resolve media returns reviewed metadata without exposing provider URLs/, 'Future Deno coverage must name the provider response-redaction boundary');
  assert.match(source.xPostingActionsTest, /assertEquals\("url" in body\.tweet\.media\[0\], false\);/, 'Future Deno coverage must prove media URLs are absent');
  assert.match(source.xPostingActionsTest, /assertEquals\("thumbnail_url" in body\.tweet\.media\[0\], false\);/, 'Future Deno coverage must prove thumbnails are absent');
  assert.match(source.xPostingActionsTest, /assertEquals\("user_profile_image_url" in \(result\.body as \{ tweet: Record<string, unknown> \}\)\.tweet, false\);/, 'Future Deno coverage must prove profile URLs are absent');

  assert.match(source.packageJson, /"check:client-media-access-containment": "node scripts\/check-client-media-access-containment-contract\.mjs"/, 'package scripts must retain the client media containment check');
  assert.match(source.ci, /npm run check:client-media-access-containment/, 'hosted CI must retain the client media containment check');
}

assertVideoRenderTargetTypes();
validateStructural(sources);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      label + ' mutation must fail the source contract',
    );
  };
  assertRejected('browser fetch', (source) => ({
    ...source,
    downloader: source.downloader + '\nvoid fetch("https://media.invalid/file");\n',
  }));
  assertRejected('direct browser open', (source) => ({
    ...source,
    downloader: source.downloader + '\nwindow.open("https://media.invalid/file");\n',
  }));
  assertRejected('indirect DOM media sink', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst node = document.createElement("video"); node.setAttribute("src", "https://media.invalid/file");\n',
  }));
  assertRejected('global browser fetch alias', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst item = { url: "https://media.invalid/file" }; const key = "fetch"; void globalThis[key](item.url);\n',
  }));
  assertRejected('resolver URL use', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst media = { url: "https://media.invalid/file" }; const unsafeUrl = media.url;\n',
  }));
  assertRejected('computed resolver URL use', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst media = { url: "https://media.invalid/file" }; const unsafeUrl = media["url"];\n',
  }));
  assertRejected('resolver media alias', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst media = { url: "https://media.invalid/file" }; const item = media;\n',
  }));
  assertRejected('tweet media destructure', (source) => ({
    ...source,
    downloader: source.downloader + '\nconst { media: records } = tweetData ?? { media: [] };\n',
  }));
  assertRejected('Downloader Supabase client import', (source) => ({
    ...source,
    downloader: 'import { supabase as client } from "@/integrations/supabase/client";\n' + source.downloader,
  }));
  assertRejected('unavailable copy', (source) => ({
    ...source,
    downloader: source.downloader.replace(
      'Preview and download are temporarily unavailable until authorised media access is implemented. No remote media URL was opened.',
      'Download ready.',
    ),
  }));
  assertRejected('client media access', (source) => ({
    ...source,
    mediaThumbnails: source.mediaThumbnails + '\nconst supabase = { storage: {} };\n',
  }));
  assertRejected('raw media fallback', (source) => ({
    ...source,
    mediaThumbnails: source.mediaThumbnails + '\nconst raw = "src_url";\n',
  }));
  assertRejected('monitoring panel remount', (source) => ({
    ...source,
    monitoringDrawer: source.monitoringDrawer.replace(
      '{entry.has_media && <MediaThumbnails />}',
      '{entry.has_media && <><MediaThumbnails /><VideoRenderDetailPanel tweetId={entry.tweet_id} /></>}',
    ),
  }));
  assertRejected('video render browser sink', (source) => ({
    ...source,
    videoRenderDetailPanel: source.videoRenderDetailPanel + '\nconst bypass = <video src="https://media.invalid/file" />;\n',
  }));
  assertRejected('raw media response field', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      'mime_type: clientNullableString(row.mime_type),',
      'mime_type: clientNullableString(row.mime_type),\n    storage_path: clientNullableString(row.storage_path),',
    ),
  }));
  assertRejected('computed media response field', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      'mime_type: clientNullableString(row.mime_type),',
      'mime_type: clientNullableString(row.mime_type),\n    ["src_url"]: clientNullableString(row.src_url),',
    ),
  }));
  assertRejected('raw render response spread', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      'return {\n    id: clientString(row.id),',
      'return { ...row,\n    id: clientString(row.id),',
    ),
  }));
  assertRejected('nested metrics path response field', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      'upload_ms: clientNullableNumber(metrics.upload_ms),',
      'upload_ms: clientNullableNumber(metrics.upload_ms),\n    expired_storage_path: clientNullableString(metrics.expired_storage_path),',
    ),
  }));
  assertRejected('raw metrics pass-through', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      'metrics: toVideoRenderClientTimingMetrics(row.metrics),',
      'metrics: clientNullableRecord(row.metrics),',
    ),
  }));
  assertRejected('raw render error pass-through', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      "error: toVideoRenderClientDiagnostic(row.error, 'render_failed'),",
      'error: clientNullableString(row.error),',
    ),
  }));
  assertRejected('preflight response restoration', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      "metrics: toVideoRenderClientTimingMetrics(row.metrics),\n    error:",
      "metrics: toVideoRenderClientTimingMetrics(row.metrics),\n    preflight: clientNullableRecord(row.preflight),\n    error:",
    ),
  }));
  assertRejected('raw preflight UI restoration', (source) => ({
    ...source,
    videoRenderDetailPanel: source.videoRenderDetailPanel + '\nconst rawPreflight = render?.preflight;\n',
  }));
  assertRejected('nested diagnostics fixture regression', (source) => ({
    ...source,
    videoRenderActionsTest: source.videoRenderActionsTest.replace(
      'assertEquals("expired_storage_path" in queue.metrics, false);',
      'assertEquals(queue.metrics.expired_storage_path, "visible");',
    ),
  }));
  assertRejected('broad video detail post type', (source) => ({
    ...source,
    videoRenderData: source.videoRenderData.replace(
      "post: VideoRenderQueueRow['post'];",
      'post: Record<string, unknown> | null;',
    ),
  }));
  assertRejected('broad video detail feedback type', (source) => ({
    ...source,
    videoRenderData: source.videoRenderData.replace(
      'feedback: Array<{ id: string; label: string; note: string | null; created_at: string }>;',
      'feedback: Array<{ id: string; label: string; note: string | null; metadata?: Record<string, unknown>; created_at: string }>;',
    ),
  }));
  assertRejected('raw overview heartbeat diagnostics selection', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      "renderer_id, status, version, render_version, running, processed, failed, last_seen_at",
      "renderer_id, status, version, render_version, running, processed, failed, last_error, last_seen_at, metadata",
    ),
  }));
  assertRejected('raw overview heartbeat pass-through', (source) => ({
    ...source,
    videoRenderActions: source.videoRenderActions.replace(
      "heartbeats: heartbeatRows\n      .map((heartbeat) => toVideoRenderClientHeartbeat(heartbeat))\n      .filter((heartbeat): heartbeat is VideoRenderClientHeartbeat => heartbeat !== null),",
      'heartbeats: heartbeatRows,',
    ),
  }));
  assertRejected('raw shared heartbeat error', (source) => ({
    ...source,
    videoRendererHealth: source.videoRendererHealth + '\nconst last_error = "download source/private.mp4";\n',
  }));
  assertRejected('broad overview heartbeat type', (source) => ({
    ...source,
    videoRenderData: source.videoRenderData.replace(
      'last_seen_at: string | null;\n}',
      'last_seen_at: string | null;\n  last_error: string | null;\n  metadata?: Record<string, unknown>;\n}',
    ),
  }));
  assertRejected('stale compact detail prop', (source) => ({
    ...source,
    videoRenders: source.videoRenders.replace(
      'isVisible={isVisible}\n              />',
      'isVisible={isVisible}\n                compact\n              />',
    ),
  }));
  assertRejected('wide metrics fallback', (source) => ({
    ...source,
    videoRenderDetailPanel: source.videoRenderDetailPanel.replace(
      'render?.metrics ?? null',
      'render?.metrics ?? {}',
    ),
  }));
  assertRejected('raw video render page fixture diagnostics', (source) => ({
    ...source,
    videoRendersTest: source.videoRendersTest.replace(
      "error: 'render_failed',",
      "error: 'download source/private.mp4: unavailable',\n    preflight: {},",
    ),
  }));
  assertRejected('raw resolver response', (source) => ({
    ...source,
    xPostingActions: source.xPostingActions.replace(
      '      type,\n      resolution:',
      '      type,\n      url: typeof item.url === "string" ? item.url : "",\n      resolution:',
    ),
  }));
  assertRejected('response normalizer bypass', (source) => ({
    ...source,
    xPostingActions: source.xPostingActions.replace(
      'tweet: toResolveXMediaClientMetadata(tweet)',
      'tweet',
    ),
  }));
  assertRejected('response redaction fixture', (source) => ({
    ...source,
    xPostingActionsTest: source.xPostingActionsTest.replace(
      'assertEquals("url" in body.tweet.media[0], false);',
      'assertEquals(body.tweet.media[0].url, "visible");',
    ),
  }));
  selfTest = 'pass';
}

console.log(
  'CLIENT_MEDIA_ACCESS_CONTAINMENT_SOURCE_CONTRACT_PASS downloader=metadata_only monitoring=authorised_only video_render=metadata_only targetTypecheck=pass selfTest=' + selfTest,
);
