import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  capacity: join(repoRoot, "services/video-renderer/src/rendererCapacity.js"),
  config: join(repoRoot, "services/video-renderer/src/config.js"),
  server: join(repoRoot, "services/video-renderer/src/server.js"),
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
  assert.match(sources.capacity, /DEFAULT_RENDER_CONCURRENCY = 1/, "renderer must retain a conservative default capacity");
  assert.match(sources.capacity, /MAX_RENDER_CONCURRENCY = 4/, "renderer concurrency must have a fixed source cap pending measured tuning");
  assert.match(sources.capacity, /DEFAULT_RENDER_SHUTDOWN_GRACE_MS = 30_000/, "renderer shutdown must have a bounded default grace period");
  assert.match(sources.capacity, /class RendererCapacityGate/, "renderer must own one shared capacity-gate abstraction");
  assert.match(sources.capacity, /if \(!this\.\#accepting\)/, "capacity gate must refuse work during shutdown");
  assert.match(sources.capacity, /if \(this\.\#inFlight >= this\.\#capacity\)/, "capacity gate must reject saturation without queueing");
  assert.match(sources.capacity, /waitForDrain/, "capacity gate must expose drain observation");
  assert.match(sources.config, /renderConcurrency: parseRenderConcurrency\(env\.RENDER_CONCURRENCY\)/, "runtime config must consume RENDER_CONCURRENCY");
  assert.match(sources.config, /shutdownGraceMs: parseRenderShutdownGraceMs\(env\.RENDER_SHUTDOWN_GRACE_MS\)/, "runtime config must consume shutdown grace");
  assert.match(sources.server, /new RendererCapacityGate\(runtime\.renderConcurrency\)/, "server must instantiate one runtime gate");
  assert.match(sources.server, /function capacityRejectionResponse/, "HTTP saturation must have a fixed response path");
  assert.match(sources.server, /shuttingDown \? 503 : 429/, "shutdown and saturation must remain distinguishable");
  assert.match(sources.server, /"Retry-After"/, "HTTP capacity rejections must guide callers without waiting in memory");

  const byId = sourceSlice(sources.server, "const processById = async", "\n\n  const preflightById");
  assert.ok(
    indexOfOrFail(byId, "const lease = tryAcquireRendererCapacity();", "HTTP render must acquire capacity")
      < indexOfOrFail(byId, "const row = await claimRenderById", "HTTP render claim must remain present"),
    "HTTP render must acquire capacity before claiming a database row",
  );
  assert.match(byId, /lease\.release\(\)/, "HTTP render must release capacity in finally");

  const preflight = sourceSlice(sources.server, "const preflightById = async", "\n\n  const server = http.createServer");
  assert.match(preflight, /const lease = tryAcquireRendererCapacity\(\)/, "HTTP preflight must use the shared gate");
  assert.match(preflight, /lease\.release\(\)/, "HTTP preflight must release capacity in finally");

  const poll = sourceSlice(sources.server, "async function pollOnce", "\n\n  const stopRuntimeTimers");
  assert.ok(
    indexOfOrFail(poll, "const lease = tryAcquireRendererCapacity();", "poll must acquire capacity")
      < indexOfOrFail(poll, "row = await claimNextRender", "poll claim must remain present"),
    "polling must acquire capacity before claiming a row",
  );
  assert.match(poll, /let row = null;\s*try \{/, "poll failure telemetry must have a row binding before the try block");
  assert.match(
    poll,
    /render_id: row\?\.id \?\? null, tweet_id: row\?\.tweet_id \?\? null/,
    "poll failure telemetry must remain safe when a claim fails before returning a row",
  );
  assert.match(poll, /lease\.release\(\)/, "poll must release capacity in finally");
  assert.doesNotMatch(sources.server, /state\.running\s*[+-]=/, "running state must derive from the shared capacity gate");
  assert.doesNotMatch(sources.server, /if \(state\.running > 0\)/, "poll must not use an independent running-counter gate");

  assert.match(sources.server, /const stopRuntimeTimers/, "server must retain timer cleanup ownership");
  assert.match(sources.server, /clearInterval\(pollTimer\)/, "shutdown must clear polling interval");
  assert.match(sources.server, /clearInterval\(heartbeatTimer\)/, "shutdown must clear heartbeat interval");
  const shutdown = sourceSlice(sources.server, "const shutdown =", "\n\n  return {");
  assert.match(shutdown, /capacityGate\.stopAccepting\(\)/, "shutdown must stop new capacity acquisition");
  const listenerCloseIndex = indexOfOrFail(shutdown, "void closeListener();", "shutdown must start listener closure");
  const drainIndex = indexOfOrFail(shutdown, "await capacityGate.waitForDrain(graceMs)", "shutdown must observe drain");
  assert.ok(listenerCloseIndex < drainIndex, "shutdown must close the listener before drain observation");
  assert.doesNotMatch(shutdown, /await writeHeartbeat\(/, "external heartbeat writes must not consume shutdown grace");
  assert.doesNotMatch(shutdown, /await closeListener\(/, "a long HTTP request must not consume drain grace through server.close callback waiting");
  assert.match(shutdown, /await capacityGate\.waitForDrain\(graceMs\)/, "shutdown must report bounded drain outcome");
  assert.match(sources.server, /process\.once\("SIGTERM"/, "SIGTERM must route through shutdown");
  assert.match(sources.server, /process\.once\("SIGINT"/, "SIGINT must route through shutdown");
}

validateStructural(source);

const capacity = await import(new URL("../services/video-renderer/src/rendererCapacity.js", import.meta.url));
assert.equal(capacity.parseRenderConcurrency(undefined), 1, "blank concurrency must preserve default one");
assert.equal(capacity.parseRenderConcurrency("4"), 4, "configured concurrency within cap must remain supported");
assert.throws(() => capacity.parseRenderConcurrency("0"), /RENDER_CONCURRENCY/, "zero concurrency must fail closed");
assert.throws(() => capacity.parseRenderConcurrency("5"), /RENDER_CONCURRENCY/, "over-cap concurrency must fail closed");
assert.throws(() => capacity.parseRenderConcurrency("1.5"), /RENDER_CONCURRENCY/, "fractional concurrency must fail closed");
assert.equal(capacity.parseRenderShutdownGraceMs(undefined), 30_000, "blank shutdown grace must preserve default");
assert.throws(() => capacity.parseRenderShutdownGraceMs("999"), /RENDER_SHUTDOWN_GRACE_MS/, "too-short shutdown grace must fail closed");

const gate = new capacity.RendererCapacityGate(1);
const firstLease = gate.tryAcquire();
assert.equal(firstLease.ok, true, "first renderer operation must acquire capacity");
assert.deepEqual(gate.snapshot(), { capacity: 1, in_flight: 1, accepting: true }, "acquired work must be observable");
const saturation = gate.tryAcquire();
assert.deepEqual(saturation, { ok: false, reason: "saturated", retryAfterSeconds: 1 }, "second work item must reject rather than queue");
const drainAfterRelease = gate.waitForDrain(1_000);
assert.equal(firstLease.release(), true, "first release must free capacity");
assert.equal(firstLease.release(), false, "release must be idempotent");
assert.equal(await drainAfterRelease, true, "release must resolve an active drain wait");
assert.equal(gate.tryAcquire().ok, true, "capacity must be reusable after release");

const stoppingGate = new capacity.RendererCapacityGate(1);
const stoppingLease = stoppingGate.tryAcquire();
assert.equal(stoppingLease.ok, true, "shutdown fixture must begin with an active lease");
stoppingGate.stopAccepting();
assert.deepEqual(stoppingGate.tryAcquire(), { ok: false, reason: "shutting_down", retryAfterSeconds: 1 }, "shutdown must reject new work");
const timedOutDrain = await stoppingGate.waitForDrain(1_000);
assert.equal(timedOutDrain, false, "drain timeout must report an uncompleted operation without pretending it was aborted");
assert.equal(stoppingLease.release(), true, "active work can still release after shutdown request");

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(source)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected("renderer config capacity", (sources) => ({
    ...sources,
    config: sources.config.replace("renderConcurrency: parseRenderConcurrency(env.RENDER_CONCURRENCY)", "renderConcurrency: 1"),
  }));
  assertRejected("HTTP pre-claim capacity", (sources) => ({
    ...sources,
    server: sources.server.replace("const lease = tryAcquireRendererCapacity();\n    if (!lease.ok)", "const lease = { ok: true };\n    if (!lease.ok)"),
  }));
  assertRejected("poll pre-claim capacity", (sources) => ({
    ...sources,
    server: sources.server.replace(
      "const lease = tryAcquireRendererCapacity();\n    if (!lease.ok) return null;\n    let row = null;\n    try {\n      // Acquire the shared slot before claimNextRender",
      "const lease = { ok: true };\n    if (!lease.ok) return null;\n    let row = null;\n    try {\n      // Acquire the shared slot before claimNextRender",
    ),
  }));
  assertRejected("poll failure telemetry row binding", (sources) => ({
    ...sources,
    server: sources.server.replace("let row = null;\n    try {", "try {"),
  }));
  assertRejected("poll failure telemetry null safety", (sources) => ({
    ...sources,
    server: sources.server.replace(
      "render_id: row?.id ?? null, tweet_id: row?.tweet_id ?? null",
      "render_id: row.id, tweet_id: row.tweet_id",
    ),
  }));
  assertRejected("shutdown stops new claims", (sources) => ({
    ...sources,
    server: sources.server.replace("capacityGate.stopAccepting();", "capacityGate.keepAccepting();"),
  }));
  assertRejected("poll timer shutdown", (sources) => ({
    ...sources,
    server: sources.server.replace("clearInterval(pollTimer);", "pollTimer = null;"),
  }));
  selfTest = "pass";
}

console.log(`RENDERER_CAPACITY_SOURCE_CONTRACT_PASS default=${capacity.DEFAULT_RENDER_CONCURRENCY} max=${capacity.MAX_RENDER_CONCURRENCY} selfTest=${selfTest}`);
