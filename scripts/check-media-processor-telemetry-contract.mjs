import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "supabase/functions/_shared/safeMediaTelemetry.ts");
const processorPath = join(repoRoot, "supabase/functions/media-processor/index.ts");
const handlerPath = join(repoRoot, "supabase/functions/media-processor/handler.ts");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const helperSource = readFileSync(helperPath, "utf8");
const processorSource = readFileSync(processorPath, "utf8");
const handlerSource = readFileSync(handlerPath, "utf8");

for (const [path, source] of [
  [helperPath, helperSource],
  [processorPath, processorSource],
  [handlerPath, handlerSource],
]) {
  const transpile = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (transpile.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

const helperTranspile = typescript.transpileModule(helperSource, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: helperPath,
  reportDiagnostics: true,
});
const helper = await import(
  `data:text/javascript;base64,${Buffer.from(helperTranspile.outputText).toString("base64")}`,
);

const signedUrl = "https://cdn.example.test/private/media/file.mp4?token=secret-token&X-Amz-Signature=signature-value#private-fragment";
const signedTelemetry = helper.safeMediaUrlTelemetry(signedUrl, "A".repeat(64));
assert.deepEqual(signedTelemetry, {
  source_url_scheme: "https",
  source_url_host: "cdn.example.test",
  source_url_path_class: "nested",
  source_url_has_query: true,
  source_url_has_fragment: true,
  source_url_has_credentials: false,
  source_url_hash: "a".repeat(64),
});
const signedSerialized = JSON.stringify(signedTelemetry);
for (const secret of [
  "secret-token",
  "X-Amz-Signature",
  "signature-value",
  "/private/media/file.mp4",
  "private-fragment",
]) {
  assert.equal(signedSerialized.includes(secret), false, `safe telemetry must not expose ${secret}`);
}

const credentialTelemetry = helper.safeMediaUrlTelemetry(
  "https://operator:super-secret@media.example.test/one?signature=another-secret",
  "not-a-hash",
);
assert.equal(credentialTelemetry.source_url_has_credentials, true);
assert.equal(credentialTelemetry.source_url_host, "media.example.test");
assert.equal(credentialTelemetry.source_url_hash, null);
const credentialSerialized = JSON.stringify(credentialTelemetry);
for (const secret of ["operator", "super-secret", "signature=another-secret"]) {
  assert.equal(credentialSerialized.includes(secret), false, `credential telemetry must not expose ${secret}`);
}

const adversarialMeta = {
  media_download_ms: 37,
  reused: true,
  storage_path: "2026/07/post_1.mp4",
  file_size: 1024,
  mime_type: "Video/MP4",
  event: "stale_media_download_ignored",
  expected_src_url_hash: "C".repeat(64),
  download_url: signedUrl,
  src_url: signedUrl,
  source_url: signedUrl,
  url: signedUrl,
  nested: { url: signedUrl },
  cause: `failed ${signedUrl}`,
};
const eventMeta = helper.safeMediaDownloadEventMeta(
  adversarialMeta,
  "media_123",
  signedUrl,
  "D".repeat(64),
);
assert.deepEqual(eventMeta, {
  media_id: "media_123",
  source_url_scheme: "https",
  source_url_host: "cdn.example.test",
  source_url_path_class: "nested",
  source_url_has_query: true,
  source_url_has_fragment: true,
  source_url_has_credentials: false,
  source_url_hash: "d".repeat(64),
  media_download_ms: 37,
  reused: true,
  storage_path: "2026/07/post_1.mp4",
  file_size: 1024,
  mime_type: "video/mp4",
  event: "stale_media_download_ignored",
  expected_src_url_hash: "c".repeat(64),
});
const eventSerialized = JSON.stringify(eventMeta);
for (const secret of [
  "secret-token",
  "X-Amz-Signature",
  "signature-value",
  "/private/media/file.mp4",
  "private-fragment",
  "download_url",
  "cause",
]) {
  assert.equal(eventSerialized.includes(secret), false, `event metadata must reject ${secret}`);
}
assert.equal(
  eventSerialized.includes('"nested":'),
  false,
  "event metadata must reject nested aliases rather than confuse its allowed path-class value",
);
const invalidMeta = helper.safeMediaDownloadEventMeta({
  storage_path: signedUrl,
  mime_type: "video/mp4?token=secret",
  file_size: -1,
}, "media_123", "not a URL?token=secret", null);
assert.equal("storage_path" in invalidMeta, false);
assert.equal("mime_type" in invalidMeta, false);
assert.equal("file_size" in invalidMeta, false);
assert.equal(helper.safeMediaDownloadErrorCode(new Error("HTTP error! status: 429")), "http_429");
assert.equal(helper.safeMediaDownloadErrorCode(new Error("Upload failed: https://media.example.test/a?token=secret")), "media_download_failed");
assert.equal(helper.safeMediaDownloadErrorCode(new Error("media_upload_failed")), "media_upload_failed");

const sourceFile = typescript.createSourceFile(
  processorPath,
  processorSource,
  typescript.ScriptTarget.ES2022,
  true,
  typescript.ScriptKind.TS,
);

function findNodes(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function propertyName(node) {
  if (!node) return null;
  if (typescript.isIdentifier(node) || typescript.isStringLiteral(node)) return node.text;
  return null;
}

function objectProperty(object, name) {
  return object.properties.find((property) =>
    typescript.isPropertyAssignment(property) && propertyName(property.name) === name,
  ) ?? null;
}

function stringValue(node) {
  return typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function isIdentifier(node, name) {
  return typescript.isIdentifier(node) && node.text === name;
}

function isPropertyAccess(node, objectName, property) {
  return typescript.isPropertyAccessExpression(node) &&
    isIdentifier(node.expression, objectName) &&
    node.name.text === property;
}

function isCallNamed(node, name) {
  return typescript.isCallExpression(node) && isIdentifier(node.expression, name);
}

function isSafeUrlTelemetryCall(node) {
  return isCallNamed(node, "safeMediaUrlTelemetry") &&
    node.arguments.length === 2 &&
    isPropertyAccess(node.arguments[0], "media", "src_url") &&
    isPropertyAccess(node.arguments[1], "media", "src_url_hash");
}

function isPipelineEventsInsert(node) {
  if (!typescript.isCallExpression(node) ||
      !typescript.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "insert") return false;
  const fromCall = node.expression.expression;
  return typescript.isCallExpression(fromCall) &&
    typescript.isPropertyAccessExpression(fromCall.expression) &&
    fromCall.expression.name.text === "from" &&
    stringValue(fromCall.arguments[0]) === "pipeline_events";
}

const downloadFailLogs = findNodes(sourceFile, (node) => {
  if (!typescript.isCallExpression(node) ||
      !typescript.isPropertyAccessExpression(node.expression) ||
      !isIdentifier(node.expression.expression, "console") ||
      node.expression.name.text !== "error" ||
      node.arguments.length !== 1) return false;
  const stringify = node.arguments[0];
  if (!typescript.isCallExpression(stringify) ||
      !typescript.isPropertyAccessExpression(stringify.expression) ||
      !isIdentifier(stringify.expression.expression, "JSON") ||
      stringify.expression.name.text !== "stringify" ||
      stringify.arguments.length !== 1 ||
      !typescript.isObjectLiteralExpression(stringify.arguments[0])) return false;
  const action = objectProperty(stringify.arguments[0], "action");
  return Boolean(action && stringValue(action.initializer) === "download_fail");
});
assert.equal(downloadFailLogs.length, 1, "there must be one structured download_fail console sink");
const downloadFailObject = downloadFailLogs[0].arguments[0].arguments[0];
assert.ok(typescript.isObjectLiteralExpression(downloadFailObject));
const allowedLogProperties = new Map([
  ["function", (node) => stringValue(node) === "media-processor"],
  ["action", (node) => stringValue(node) === "download_fail"],
  ["media_id", (node) => isPropertyAccess(node, "media", "id")],
  ["error_code", (node) => isIdentifier(node, "errorCode")],
]);
const seenLogProperties = new Set();
let safeUrlSpreadCount = 0;
for (const property of downloadFailObject.properties) {
  if (typescript.isSpreadAssignment(property)) {
    assert.equal(
      isSafeUrlTelemetryCall(property.expression),
      true,
      "download_fail may spread only the direct safeMediaUrlTelemetry result",
    );
    safeUrlSpreadCount += 1;
    continue;
  }
  assert.equal(
    typescript.isPropertyAssignment(property),
    true,
    "download_fail must use explicit, allowlisted property assignments",
  );
  const name = propertyName(property.name);
  assert.ok(name && allowedLogProperties.has(name), `unexpected download_fail property: ${name}`);
  assert.equal(
    allowedLogProperties.get(name)(property.initializer),
    true,
    `download_fail property ${name} must use its safe direct value`,
  );
  seenLogProperties.add(name);
}
assert.deepEqual(
  [...seenLogProperties].sort(),
  [...allowedLogProperties.keys()].sort(),
  "download_fail must contain every required safe property exactly once",
);
assert.equal(safeUrlSpreadCount, 1, "download_fail must include exactly one safe URL summary");

const pipelineInserts = findNodes(sourceFile, isPipelineEventsInsert);
assert.equal(pipelineInserts.length, 1, "there must be one media pipeline_events insert sink");
const pipelinePayload = pipelineInserts[0].arguments[0];
assert.ok(typescript.isObjectLiteralExpression(pipelinePayload));
const pipelineMeta = objectProperty(pipelinePayload, "meta");
assert.ok(pipelineMeta, "pipeline_events payload must define metadata");
assert.equal(
  isCallNamed(pipelineMeta.initializer, "safeMediaDownloadEventMeta") &&
    pipelineMeta.initializer.arguments.length === 4 &&
    isIdentifier(pipelineMeta.initializer.arguments[0], "meta") &&
    isPropertyAccess(pipelineMeta.initializer.arguments[1], "media", "id") &&
    isPropertyAccess(pipelineMeta.initializer.arguments[2], "media", "src_url") &&
    isPropertyAccess(pipelineMeta.initializer.arguments[3], "media", "src_url_hash"),
  true,
  "pipeline metadata must be constructed only by the strict safeMediaDownloadEventMeta allowlist",
);

const failedEventCalls = findNodes(sourceFile, (node) =>
  isCallNamed(node, "insertMediaDownloadEvent") &&
  stringValue(node.arguments[2]) === "failed",
);
assert.equal(failedEventCalls.length, 3, "the three failed media events must remain explicit");
assert.ok(
  failedEventCalls.some((node) => stringValue(node.arguments[3]) === "media_item_limit_exceeded"),
  "over-limit media must remain an explicit failed event",
);
const caughtFailureCall = failedEventCalls.find((node) => isIdentifier(node.arguments[3], "errorCode"));
assert.ok(caughtFailureCall, "caught download errors must reach pipeline_events only as errorCode");
assert.equal(
  caughtFailureCall.arguments.some((argument) => isIdentifier(argument, "error")),
  false,
  "caught Error objects must not be passed into pipeline event metadata",
);

function hasThrowCode(code) {
  return findNodes(sourceFile, (node) => {
    if (!typescript.isThrowStatement(node) ||
        !node.expression ||
        !typescript.isNewExpression(node.expression) ||
        !isIdentifier(node.expression.expression, "Error")) return false;
    return stringValue(node.expression.arguments?.[0]) === code;
  }).length > 0;
}

for (const code of ["media_query_failed", "media_upload_failed", "media_row_update_failed"]) {
  assert.equal(hasThrowCode(code), true, `${code} must replace provider error text before the shared handler sink`);
}
assert.equal(hasThrowCode("media_info_read_failed"), true,
  "media-info read failures must use a stable code before the response boundary");
assert.doesNotMatch(processorSource, /Failed to fetch media info: \$\{error\.message\}/,
  "media-info read failures must not expose database exception text");
assert.match(processorSource, /if \(!Array\.isArray\(mediaItems\)\) throw new Error\('media_query_invalid_response'\)/,
  "media selection must reject malformed successful responses");
assert.match(processorSource, /if \(!Array\.isArray\(existingRows\)\) throw new Error\('media_reuse_lookup_invalid_response'\)/,
  "media reuse lookup must reject malformed successful responses");

function assertHandlerContract(source, label = "media-processor handler") {
  assert.match(source, /type SupabaseClient = unknown;/,
    `${label} must expose an unknown-backed client boundary`);
  assert.doesNotMatch(source, /deno-lint-ignore no-explicit-any/,
    `${label} must not retain an any suppression`);
  assert.match(source, /function mediaProcessorErrorCode\(error: unknown\): string \{/,
    `${label} must normalize errors through a bounded helper`);
  assert.match(source, /const safeError = new Error\(mediaProcessorErrorCode\(error\)\);/,
    `${label} must construct a stable sanitized error`);
  assert.match(source, /error: safeError\.message,/,
    `${label} logs must use the sanitized error code`);
  assert.doesNotMatch(source, /\(error as Error\)\.message/,
    `${label} must not log raw exception text`);
  assert.doesNotMatch(source, /captureException\(error,/,
    `${label} must not send raw exceptions to the telemetry sink`);
}

assertHandlerContract(handlerSource);
if (process.env.MUTATION_TEST === "1") {
  assert.throws(() => assertHandlerContract(
    handlerSource.replace("type SupabaseClient = unknown;", "type SupabaseClient = any;"),
    "any client boundary mutation",
  ));
  assert.throws(() => assertHandlerContract(
    handlerSource.replace("error: safeError.message,", "error: (error as Error).message,"),
    "raw handler log mutation",
  ));
  assert.throws(() => assertHandlerContract(
    handlerSource.replace("await captureException(safeError,", "await captureException(error,"),
    "raw handler capture mutation",
  ));
  assert.throws(() => assertHandlerContract(
    handlerSource.replace("const safeError = new Error(mediaProcessorErrorCode(error));", "const safeError = error;"),
    "unsanitized handler error mutation",
  ));
}

console.log(`MEDIA_PROCESSOR_TELEMETRY_SOURCE_CONTRACT_PASS structural=1 handlerBoundary=1 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
