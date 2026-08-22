import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  policy: join(repoRoot, "services/video-renderer/src/rendererRequestPolicy.js"),
  server: join(repoRoot, "services/video-renderer/src/server.js"),
  readme: join(repoRoot, "services/video-renderer/README.md"),
};
const source = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]));

function indexOfOrFail(value, needle, message) {
  const index = value.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function sourceSlice(value, startNeedle, endNeedle) {
  const start = indexOfOrFail(value, startNeedle, `missing ${startNeedle}`);
  const end = value.indexOf(endNeedle, start + startNeedle.length);
  return value.slice(start, end >= 0 ? end : value.length);
}

function validateStructural(sources) {
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_BODY_BYTES = 64 \* 1024/, "renderer dispatch body must retain a fixed byte cap");
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_BODY_CHUNKS = 256/, "renderer dispatch body must limit fragmentation");
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_JSON_DEPTH = 4/, "renderer dispatch JSON must retain a depth cap");
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_JSON_NODES = 16/, "renderer dispatch JSON must retain a node cap");
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_STRING_LENGTH = 256/, "renderer dispatch strings must retain a cap");
  assert.match(sources.policy, /MAX_RENDERER_REQUEST_RENDER_ID_LENGTH = 128/, "renderer IDs must retain a cap");
  assert.match(sources.policy, /assertContentLength\(request\?\.headers\)/, "declared Content-Length must be checked before body listeners");
  assert.match(sources.policy, /assertContentEncoding\(request\?\.headers\)/, "compressed request input must be rejected");
  assert.match(sources.policy, /assertContentType\(request\?\.headers\)/, "non-JSON request input must be rejected");
  assert.match(sources.policy, /bytes\.byteLength > MAX_RENDERER_REQUEST_BODY_BYTES - bytesRead/, "streamed chunks must be checked before copy");
  assert.match(sources.policy, /if \(chunksRead > MAX_RENDERER_REQUEST_BODY_CHUNKS\)/, "fragmented request streams must stop at a fixed cap");
  const terminalListenerIndex = indexOfOrFail(sources.policy, 'request.once?.("end", onEnd);', "body reader must register terminal handlers");
  const dataListenerIndex = indexOfOrFail(sources.policy, 'request.on?.("data", onData);', "body reader must register data handling");
  assert.ok(terminalListenerIndex < dataListenerIndex, "terminal body handlers must be registered before flow starts");
  assert.match(sources.policy, /new TextDecoder\("utf-8", \{ fatal: true \}\)/, "renderer request text must reject invalid UTF-8");
  assert.match(sources.policy, /assertBoundedJsonSyntax\(raw\)/, "depth/node scanning must run before JSON.parse");
  assert.match(sources.policy, /payload = JSON\.parse\(raw\)/, "bounded request input must still use JSON syntax authority");
  assert.match(sources.policy, /ALLOWED_DISPATCH_KEYS = new Set\(\["render_id", "tweet_id", "source"\]\)/, "dispatch schema must be explicit and compatible with known callers");
  assert.match(sources.policy, /keys\.some\(\(key\) => !ALLOWED_DISPATCH_KEYS\.has\(key\)\)/, "unexpected dispatch keys must be rejected");
  assert.doesNotMatch(sources.policy, /body \+=/, "request bodies must not use unbounded string concatenation");
  assert.doesNotMatch(sources.server, /function readJson\(/, "server must not restore the legacy unbounded request reader");
  assert.match(sources.server, /readBoundedRendererDispatchRequest/, "server must use the shared bounded dispatch reader");
  assert.match(sources.server, /error instanceof RendererRequestInputError/, "typed input errors must bypass generic telemetry capture");
  assert.match(sources.server, /code: error\.code/, "typed input failures must use stable JSON error codes");

  const renderRoute = sourceSlice(sources.server, 'if (req.method === "POST" && url.pathname === "/v1/render")', '\n      if (req.method === "POST" && url.pathname === "/v1/preflight")');
  const renderAuthIndex = indexOfOrFail(renderRoute, "isAuthorizedRendererRequest", "render route must retain bearer authorization");
  const renderInputIndex = indexOfOrFail(renderRoute, "readBoundedRendererDispatchRequest(req)", "render route must parse bounded input");
  const renderClaimIndex = indexOfOrFail(renderRoute, "processById(renderId)", "render route must retain processing path");
  assert.ok(renderAuthIndex < renderInputIndex && renderInputIndex < renderClaimIndex, "render auth/input validation must happen before capacity/claim work");

  const preflightRoute = sourceSlice(sources.server, 'if (req.method === "POST" && url.pathname === "/v1/preflight")', '\n      return json(res, 404');
  const preflightAuthIndex = indexOfOrFail(preflightRoute, "isAuthorizedRendererRequest", "preflight route must retain bearer authorization");
  const preflightInputIndex = indexOfOrFail(preflightRoute, "readBoundedRendererDispatchRequest(req)", "preflight route must parse bounded input");
  const preflightRunIndex = indexOfOrFail(preflightRoute, "preflightById(renderId)", "preflight route must retain processing path");
  assert.ok(preflightAuthIndex < preflightInputIndex && preflightInputIndex < preflightRunIndex, "preflight auth/input validation must happen before preflight work");

  const serverCallback = sourceSlice(sources.server, "const server = http.createServer", "\n\n  async function pollOnce");
  const inputCatchIndex = indexOfOrFail(serverCallback, "error instanceof RendererRequestInputError", "server callback must classify typed input errors");
  const genericCaptureIndex = indexOfOrFail(serverCallback, "captureRendererException(error", "server callback must retain generic telemetry capture");
  assert.ok(inputCatchIndex < genericCaptureIndex, "input errors must not reach generic error telemetry");
  assert.match(sources.readme, /bodies above 64 KiB/, "README must document the dispatch ingress cap");
}

validateStructural(source);

const policy = await import(new URL("../services/video-renderer/src/rendererRequestPolicy.js", import.meta.url));

function requestFixture(chunks, headers = {}) {
  const stream = Readable.from(chunks);
  stream.headers = headers;
  return stream;
}

async function expectCode(input, code, message = `expected ${code}`) {
  await assert.rejects(input, (error) => error?.code === code, message);
}

const validPayload = JSON.stringify({ render_id: "render-1", tweet_id: "tweet-1", source: "worker" });
const validRequest = requestFixture([Buffer.from(validPayload)], {
  "content-type": "application/json; charset=utf-8",
  "content-length": String(Buffer.byteLength(validPayload)),
});
assert.deepEqual(
  await policy.readBoundedRendererDispatchRequest(validRequest),
  { renderId: "render-1" },
  "known dispatcher shape must remain compatible",
);

await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([], {
    "content-length": String(policy.MAX_RENDERER_REQUEST_BODY_BYTES + 1),
  })),
  "renderer_request_content_length_exceeded",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([], {
    "content-length": ["1", "2"],
  })),
  "renderer_request_content_length_invalid",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([
    new Uint8Array(policy.MAX_RENDERER_REQUEST_BODY_BYTES),
    new Uint8Array([0x20]),
  ], { "content-type": "application/json" })),
  "renderer_request_body_too_large",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture(
    Array.from({ length: policy.MAX_RENDERER_REQUEST_BODY_CHUNKS + 1 }, () => Buffer.from(" ")),
    { "content-type": "application/json" },
  )),
  "renderer_request_body_chunk_limit_exceeded",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from([0xc3, 0x28])], {
    "content-type": "application/json",
  })),
  "renderer_request_body_text_invalid",
);
const prematurelyClosedRequest = new Readable({ read() {} });
prematurelyClosedRequest.headers = { "content-type": "application/json" };
prematurelyClosedRequest.complete = false;
const prematurelyClosedRead = policy.readBoundedRendererDispatchRequest(prematurelyClosedRequest);
prematurelyClosedRequest.emit("close");
await expectCode(
  () => prematurelyClosedRead,
  "renderer_request_body_read_failed",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([], { "content-encoding": "gzip" })),
  "renderer_request_content_encoding_blocked",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([], { "content-type": "text/plain" })),
  "renderer_request_content_type_blocked",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from('{"render_id":{"a":{"b":{"c":{"d":"x"}}}}}')], {
    "content-type": "application/json",
  })),
  "renderer_request_json_depth_exceeded",
);
const nodeHeavyPayload = JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_value, index) => [`field_${index}`, "x"])));
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from(nodeHeavyPayload)], {
    "content-type": "application/json",
  })),
  "renderer_request_json_node_limit_exceeded",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from(`{"render_id":"${"x".repeat(policy.MAX_RENDERER_REQUEST_STRING_LENGTH + 1)}"}`)], {
    "content-type": "application/json",
  })),
  "renderer_request_json_string_too_long",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from('{"render_id":"render-1","unexpected":"x"}')], {
    "content-type": "application/json",
  })),
  "renderer_request_json_shape_invalid",
);
await expectCode(
  () => policy.readBoundedRendererDispatchRequest(requestFixture([Buffer.from("{}")])),
  "renderer_request_render_id_required",
);

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(source)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected("stream byte cap", (sources) => ({
    ...sources,
    policy: sources.policy.replace("bytes.byteLength > MAX_RENDERER_REQUEST_BODY_BYTES - bytesRead", "false"),
  }));
  assertRejected("fragmentation cap", (sources) => ({
    ...sources,
    policy: sources.policy.replace("if (chunksRead > MAX_RENDERER_REQUEST_BODY_CHUNKS)", "if (false)"),
  }));
  assertRejected("terminal listener ordering", (sources) => ({
    ...sources,
    policy: sources.policy.replace(
      'request.once?.("end", onEnd);\n    request.once?.("error", onError);\n    request.once?.("aborted", onAborted);\n    request.once?.("close", onClose);\n    request.on?.("data", onData);',
      'request.on?.("data", onData);\n    request.once?.("end", onEnd);\n    request.once?.("error", onError);\n    request.once?.("aborted", onAborted);\n    request.once?.("close", onClose);',
    ),
  }));
  assertRejected("fatal UTF-8 decode", (sources) => ({
    ...sources,
    policy: sources.policy.replace('new TextDecoder("utf-8", { fatal: true })', 'new TextDecoder("utf-8")'),
  }));
  assertRejected("render pre-claim validation", (sources) => ({
    ...sources,
    server: sources.server.replace("const { renderId } = await readBoundedRendererDispatchRequest(req);", "const { renderId } = { renderId: \"unvalidated\" };"),
  }));
  assertRejected("typed input error mapping", (sources) => ({
    ...sources,
    server: sources.server.replace("error instanceof RendererRequestInputError", "false"),
  }));
  selfTest = "pass";
}

console.log(`RENDERER_REQUEST_POLICY_SOURCE_CONTRACT_PASS maxBytes=${policy.MAX_RENDERER_REQUEST_BODY_BYTES} maxChunks=${policy.MAX_RENDERER_REQUEST_BODY_CHUNKS} selfTest=${selfTest}`);
