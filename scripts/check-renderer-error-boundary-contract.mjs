import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "services/video-renderer/src/server.js");
const server = readFileSync(serverPath, "utf8");

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function validateStructural(source) {
  assert.match(source, /function publicHealthSnapshot\(state\)/, "health must use a public projection");
  const health = sliceBetween(source, "function publicHealthSnapshot(state)", "function capacityRejectionResponse");
  assert.match(health, /lastError: state\.lastError \? "renderer_error" : null/, "health must expose only a stable error marker");
  assert.doesNotMatch(health, /\.\.\.state|lastError:\s*state\.lastError\s*[,}]/, "health must not spread or return raw internal state");
  const route = sliceBetween(source, 'if (req.method === "GET" && url.pathname === "/health")', 'if (req.method === "POST" && url.pathname === "/v1/render")');
  assert.match(route, /publicHealthSnapshot\(state\)/, "health route must use the public projection");
  assert.match(source, /await flushSentryRenderer\(\);\n\s*return json\(res, 500, \{ error: "Renderer request failed", code: "renderer_internal_error" \}\);/, "generic HTTP failures must use a stable safe envelope");
  assert.doesNotMatch(source, /return json\(res, 500, \{ error: error instanceof Error \? error\.message : String\(error\) \}\);/, "generic HTTP failures must not echo raw exception text");
}

validateStructural(server);

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(server)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected("health raw state spread", (source) => source.replace("return json(res, 200, publicHealthSnapshot(state));", "return json(res, 200, { ok: true, ...state });"));
  assertRejected("health raw error", (source) => source.replace('lastError: state.lastError ? "renderer_error" : null', "lastError: state.lastError"));
  assertRejected("generic raw error", (source) => source.replace('return json(res, 500, { error: "Renderer request failed", code: "renderer_internal_error" });', "return json(res, 500, { error: error.message });"));
  selfTest = "pass";
}

console.log(`RENDERER_ERROR_BOUNDARY_SOURCE_CONTRACT_PASS selfTest=${selfTest}`);
