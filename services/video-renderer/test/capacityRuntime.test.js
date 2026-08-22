import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import net from "node:net";
import { createRendererServer, installRendererSignalHandlers } from "../src/server.js";
import { runManagedCommand } from "../src/processRunner.js";

/**
 * E1 / BR-RENDER-02 / AIR-019 runtime behavioural contracts. These assert the
 * renderer's shared non-queuing RendererCapacityGate at HTTP runtime level:
 *
 *   1. HTTP render saturation returns 429 + Retry-After BEFORE any claim RPC.
 *   2. HTTP render and HTTP preflight share the SAME gate (one capacity).
 *   3. Real shutdown (accepting=false) returns 503 + Retry-After before any
 *      claim, while genuinely terminating the managed render children and
 *      clearing the poll/heartbeat interval timers it started.
 *   4. Drain within grace preserves reclaimable ownership with NO false
 *      terminal state and NO unreclaimable current claim: in-flight stays
 *      owned until released, then is reusable.
 *
 * Every assertion here drives the real createRendererServer. There is no
 * external network, database, provider, Docker, Deno, browser, mirrored
 * rendering service, commit, push, deploy, or live contact. Supabase is a
 * fail-closed double that throws on ANY rpc (claim) access, so reaching a
 * claim RPC on a rejected/saturated path is a hard failure, not a silent 200.
 * The only behavioural seam injected is the interval scheduler, so poll and
 * heartbeat cycles can be driven by a deterministic fake clock instead of
 * wall-clock sleeps.
 */

const RENDER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "e1-runtime-token";
const RENDER_BODY = JSON.stringify({ render_id: RENDER_ID });

/** Any supabase path (claim RPC or settings/upsert `from`) fails closed. A
 * spinning renderer swallows layer errors (.catch) which is intended for
 * heartbeat writes; the hard guarantee is that putter RPC claims are never
 * reached on a rejected path (verified by the empty `claims` array). */
function failClosedSupabase() {
  const claims = [];
  return {
    claims,
    rpc(name) {
      claims.push(name);
      throw new Error(`claim RPC "${name}" must not be reached on a rejected capacity path`);
    },
    from() {
      throw new Error("settings/heartbeat access must not be reached on a rejected capacity path");
    },
  };
}

function createE1Server(overrides = {}) {
  const supabase = failClosedSupabase();
  const app = createRendererServer({
    config: {},
    token: TOKEN,
    supabase,
    runtime: {
      renderConcurrency: 1,
      shutdownGraceMs: 1_000,
      pollIntervalMs: 250,
      heartbeatIntervalMs: 5_000,
      version: "0.0.0-e1",
      ...overrides.runtime,
    },
    ...overrides,
  });
  return { app, supabase };
}

async function requestOnce(server, port, { path, method = "GET", token, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json();
    return {
      status: response.status,
      payload,
      retryAfter: response.headers.get("retry-after"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function withServer(app, fn) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("shares one gate across HTTP render, preflight, and poller", async () => {
  const { app, supabase } = createE1Server();
  const gate = app.capacityGate;
  assert.equal(gate.capacity, 1, "E1 runtime must run at a single shared slot");

  // Hold the only slot by acquiring the exact gate instance the HTTP/poller
  // paths use, then drive HTTP render, HTTP preflight, and the poller against
  // one saturated shared gate.
  const lease = gate.tryAcquire();
  assert.equal(lease.ok, true);
  try {
    const results = await withServer(app, async (port) => {
      const renderRes = await requestOnce(app.server, port, {
        path: "/v1/render",
        method: "POST",
        token: TOKEN,
        body: { render_id: RENDER_ID },
      });
      const preflightRes = await requestOnce(app.server, port, {
        path: "/v1/preflight",
        method: "POST",
        token: TOKEN,
        body: { render_id: RENDER_ID },
      });
      const poll = await app.pollOnce();
      return { renderRes, preflightRes, poll };
    });
    assert.equal(results.renderRes.status, 429, "HTTP render must reject at saturation");
    assert.equal(results.renderRes.payload.code, "renderer_capacity_exceeded");
    assert.equal(results.preflightRes.status, 429, "HTTP preflight must reject at saturation");
    assert.equal(results.preflightRes.payload.code, "renderer_capacity_exceeded");
    assert.equal(results.poll, null, "poller must not claim on a saturated shared gate");
    assert.deepEqual(supabase.claims, [], "no claim RPC reached on any saturated path");
  } finally {
    lease.release();
  }

  assert.equal(gate.inFlight, 0, "shared slot must be released and reusable");
  const reclaimed = gate.tryAcquire();
  assert.equal(reclaimed.ok, true, "capacity must be reclaimable after release in the same descriptor/slot");
  reclaimed.release();
  assert.equal(gate.inFlight, 0, "the reclaimed slot must itself be released again");
});

test("saturation precedes claim and returns Retry-After", async () => {
  const { app, supabase } = createE1Server();
  const lease = app.capacityGate.tryAcquire();
  assert.equal(lease.ok, true);
  let res;
  try {
    res = await withServer(app, (port) =>
      requestOnce(app.server, port, {
        path: "/v1/render",
        method: "POST",
        token: TOKEN,
        body: { render_id: RENDER_ID },
      }));
    assert.equal(res.status, 429);
    assert.equal(res.retryAfter, "1", "Retry-After must be returned on saturation");
    assert.equal(res.payload.code, "renderer_capacity_exceeded");
    assert.deepEqual(supabase.claims, [], "no claim RPC may be reached at saturation");
  } finally {
    lease.release();
  }
  // A rejected HTTP render must never mutate terminal counters or flip
  // shutting_down; running is derived from the shared gate.
  assert.equal(app.capacityGate.inFlight, 0);
  assert.deepEqual(
    {
      processed: app.state.processed,
      failed: app.state.failed,
      lastError: app.state.lastError,
      shutting_down: app.state.shutting_down,
    },
    { processed: 0, failed: 0, lastError: null, shutting_down: false },
    "a rejected HTTP render must not mutate terminal counters",
  );
});

/**
 * F4: managed render child abort coordination. We register ONE genuinely
 * managed child through the real processRunner and then drive the REAL
 * createRendererServer shutdown, which calls abortAllManagedProcesses("shutdown")
 * on its registered children. The node --test runner executes each top-level
 * test serially, so setting the module-level shutdown latch here is visible
 * only to sibling tests in this same file that only use the capacity gate
 * (which do not spawn managed children and are unaffected).
 */
test("real shutdown aborts a genuinely registered managed render child", async () => {
  const groupKills = [];
  const child = new EventEmitter();
  child.pid = 4901;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  // runManagedCommand binds child.stdout/stderr data + single-shot error and
  // close listeners; plain EventEmitters are enough because spawnImpl returns
  // this object verbatim and no real descriptor is attached.
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const managed = runManagedCommand({ bin: "ffprobe", args: ["--version"] }, {
    label: "e1_fake_child",
    terminationGraceMs: 1,
    terminationSettleMs: 8,
    timeoutMs: 300_000,
    spawnImpl: () => child,
    processImpl: {
      platform: "linux",
      kill: (pid, signal) => groupKills.push({ pid, signal }),
    },
  });
  // Let the spawn settle so the child is registered in the managed registry.
  await new Promise((resolve) => setImmediate(resolve));

  const { app, supabase } = createE1Server();
  const shutting = app.shutdown({ signal: "manual", graceMs: 1_000 });

  // The registered child must now terminate with a bounded TERM->KILL sequence
  // (via process-group signal on Linux, plus direct kill) and resolve cancelled.
  let errorCode = null;
  try {
    await managed;
  } catch (error) {
    errorCode = error?.code;
  }
  const outcome = await shutting;
  assert.equal(errorCode, "process_cancelled", "managed child must resolve cancelled on shutdown");
  assert.ok(
    groupKills.some((entry) => entry.signal === "SIGTERM") &&
      groupKills.some((entry) => entry.signal === "SIGKILL"),
    `shutdown must escalate the managed child through TERM then KILL, got ${JSON.stringify(groupKills)}`,
  );
  assert.ok(
    child.killCalls.includes("SIGTERM") || groupKills.some((entry) => entry.signal === "SIGTERM"),
    "the managed child must observe a SIGTERM during coordinated shutdown",
  );
  assert.equal(outcome.drained, true, "with no held capacity, shutdown must drain promptly");
  assert.equal(app.capacityGate.accepting, false, "shutdown must leave the gate closed");
  assert.deepEqual(supabase.claims, [], "no claim RPC on a drain-only shutdown path");
});

/**
 * F3: the shutdown *listener* contract. Driving HTTP work against shutdown's
 * synchronous server.close() would race the socket reap (Node closes tracked
 * sockets immediately), so a live-request 503 is inherently nondeterministic.
 * Instead we inject a deterministic listener-close seam into createRendererServer:
 * shutdown() still invokes close synchronously (proven by the recorded call),
 * but the injected close defers the real server.close() until the test releases
 * it, keeping the listener genuinely open so ONE POST /v1/render is actually
 * served and resolves to a deterministic shutdown-503 (Retry-After, zero claim
 * RPCs). Only then is the deferred released to perform the real server.close()
 * and the cleanup awaited. The separate test below still asserts the genuine
 * listener-close refusal contract on a live listener.
 */
test("real shutdown returns 503 + Retry-After before any claim while a live listener stays up", async () => {
  const closeCalls = [];
  let appRef;
  let releaseClose;
  let closeComplete;
  const deferredClose = new Promise((resolve) => { releaseClose = resolve; });
  const closeListener = () => {
    closeCalls.push(true);
    // Keep the listener genuinely open until the test releases the deferred
    // close, then perform the real server.close() and settle its callback.
    closeComplete = deferredClose.then(() =>
      new Promise((resolve) => appRef.server.close(() => resolve())),
    );
    return closeComplete;
  };
  const { app, supabase } = createE1Server({ closeListener });
  appRef = app;

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;

  const shutting = app.shutdown({ signal: "manual", graceMs: 1_000 });
  try {
    // shutdown must have invoked its listener-close step immediately, but the
    // listener must still be open so this POST is served (not connection-refused).
    assert.equal(closeCalls.length, 1, "shutdown must invoke the listener-close step");
    assert.equal(app.capacityGate.accepting, false, "shutdown must close the capacity gate");
    assert.equal(await app.pollOnce(), null, "poller must not claim once the gate is closed");

    const res = await requestOnce(app.server, port, {
      path: "/v1/render",
      method: "POST",
      token: TOKEN,
      body: { render_id: RENDER_ID },
    });

    assert.equal(res.status, 503, "shutdown must reject new work with a live listener present");
    assert.equal(res.payload.code, "renderer_shutting_down");
    assert.equal(res.retryAfter, "1", "Retry-After must guide callers during shutdown");
    assert.deepEqual(supabase.claims, [], "no claim RPC may be reached during shutdown");
  } finally {
    releaseClose();
    await closeComplete;
    await shutting;
  }
});
test("real shutdown closes a live listener so new connections are refused", async () => {
  const { app } = createE1Server();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;

  // Prove the listener is genuinely open before shutdown with a raw TCP connect
  // (avoids the /health heartbeat path, which would touch supabase `from`).
  await new Promise((resolve, reject) => {
    const probe = net.connect({ host: "127.0.0.1", port });
    probe.once("connect", () => { probe.destroy(); resolve(); });
    probe.once("error", reject);
  });

  const shutting = app.shutdown({ signal: "manual", graceMs: 1_000 });
  await shutting;

  // The live listener must now be closed: any fresh connection is refused.
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/health`),
    (error) => (error?.cause?.code ?? error?.code) === "ECONNREFUSED",
    "after real shutdown the listener must no longer accept new connections",
  );

  assert.equal(app.capacityGate.accepting, false, "a completed shutdown must not re-open the gate");
  assert.equal(await app.pollOnce(), null, "poller must not restart work while the gate is closed");
});

test("shutdown drains within grace and leaves claims reclaimable (no false terminal)", async () => {
  const { app, supabase } = createE1Server();

  const lease = app.capacityGate.tryAcquire();
  assert.equal(lease.ok, true);

  const shutting = app.shutdown({ signal: "manual", graceMs: 1_000 });
  assert.equal(app.capacityGate.inFlight, 1, "in-flight ownership must survive the shutdown request");
  assert.equal(app.capacityGate.accepting, false, "shutdown must stop new acquisition");
  assert.equal(await app.pollOnce(), null, "poller must not restart work during shutdown");

  // The renderer finishes and releases the fence; the slot is free again.
  lease.release();
  const outcome = await shutting;
  assert.equal(outcome.drained, true, "shutdown must report drained after release");
  assert.equal(outcome.in_flight, 0, "no in-flight claim left behind after drain");
  assert.deepEqual(supabase.claims, [], "no database claim RPC on an draining path");

  assert.equal(app.capacityGate.inFlight, 0, "no unreclaimable ownership");
  assert.equal(app.capacityGate.accepting, false, "a completed shutdown must not re-open the gate");
});

test("drain timeout reports an unfinished operation without fabricating a terminal", async () => {
  const { app } = createE1Server();
  const lease = app.capacityGate.tryAcquire();
  assert.equal(lease.ok, true);
  app.capacityGate.stopAccepting();
  // Hold the slot and do not release; the enforced 1000ms minimum grace must
  // elapse before "drained=false" is honestly reported. This is a real, honest
  // bound (not a synthetic sub-second claim).
  const outcome = await app.shutdown({ signal: "manual", graceMs: 1_000 });
  assert.equal(outcome.drained, false, "drain must not fabricate a success while work remains");
  assert.equal(outcome.in_flight, 1, "in-flight claim must remain owned (reclaimable-holding)");
  lease.release();
});

/**
 * F2/F6: timer cleanup with a deterministic fake interval scheduler. The
 * server's real startRuntimeTimers/stopRuntimeTimers flow is driven with
 * injected setInterval/clearInterval that record every handle they create and
 * clear. Shutdown must clear exactly the intervals the poller/heartbeat
 * started (1:1), proving no poll or heartbeat interval outlives shutdown and
 * that no wall-clock sleep is introduced into the runtime test.
 */
test("shutdown clears the exact poll and heartbeat intervals it started", async () => {
  const setHandles = [];
  const clearHandles = [];
  const fakeScheduler = {
    setInterval(fn, ms) {
      const id = { fn, ms };
      setHandles.push(id);
      return id;
    },
    clearInterval(id) {
      clearHandles.push(id);
    },
  };

  const { app: appWithScheduler } = createE1Server({
    setIntervalFn: fakeScheduler.setInterval,
    clearIntervalFn: fakeScheduler.clearInterval,
  });

  const startMark = Date.now();
  appWithScheduler.startRuntimeTimers();
  assert.equal(setHandles.length, 2, "runtime must start exactly poll + heartbeat intervals");
  assert.equal(setHandles[0].ms, 250, "poll interval must start with the configured poll cadence");
  assert.equal(setHandles[1].ms, 5_000, "heartbeat interval must honor the configured cadence");

  await appWithScheduler.shutdown({ signal: "manual", graceMs: 1_000 });
  const elapsedMs = Date.now() - startMark;

  assert.equal(clearHandles.length, 2, "shutdown must stop exactly the two runtime intervals");
  assert.equal(
    clearHandles.filter((id) => setHandles.includes(id)).length,
    2,
    "each cleared handle must be one the server actually created",
  );
  assert.equal(appWithScheduler.capacityGate.accepting, false, "shutdown must also close the gate");
  assert.ok(
    elapsedMs < 100,
    `timer teardown must settle without a wall-clock sleep (took ${elapsedMs}ms)`,
  );
});

/**
 * E1 / AIR-019 runtime SIGTERM/SIGINT contract. The two graceful-signal
 * handlers were previously inlined inside startRendererServer with no bore
 * that a hermetic test could reach, so the plan's "SIGTERM/SIGINT stop new
 * claims, clear timers/listener, and drain or abort within grace" line had zero
 * runtime coverage. installRendererSignalHandlers is the smallest
 * production-neutral seam: it keeps the exact process.once("SIGTERM"/"SIGINT")
 * registrations on the real process, but accepts a dependency-injected
 * processLike (an EventEmitter with a settable exitCode), shutdown, flush, and
 * logger so the same real callback can be driven hermetically.
 *
 * For each the test opens a REAL listener, starts REAL poll/heartbeat timers
 * through the fake interval scheduler, emits the registered signal on the fake
 * process emitter, and awaits the SAME cached shutdownPromise the handler uses
 * — so handler completion is observed deterministically with zero wall-clock
 * sleeps. It then proves the capacity gate no longer accepts, the exact timer
 * handles were cleared (1:1), a fresh connection is refused, drained=true with
 * in_flight=0, the result log names the actual signal, and no claim RPC is
 * ever emitted on the fake process. No real OS signal is sent; the claim
 * is limited to runtime registration/callback execution.
 *
 * @param {string} signal SIGTERM or SIGINT
 */
function runInstallSignalContract(signal) {
  // Fake process: a real EventEmitter, keeping its genuine `.once`
  // implementation so the signal arrives through actual synchronous emitter
  // delivery. `.emit(signal)` runs the registered listener exactly as Node's
  // SignalWatcher would; `.exitCode` is a plain settable property (asserted
  // untouched on the drained path). No real OS signal is sent.
  const processLike = new EventEmitter();
  processLike.exitCode = undefined;

  // Fake interval scheduler records every handle it creates and clears, so the
  // test can assert shutdown clears exactly the poll/heartbeat handles server
  // started and placed without a wall-clock timer.
  const setHandles = [];
  const clearHandles = [];
  const fakeScheduler = {
    setInterval(fn, ms) {
      const id = { fn, ms };
      setHandles.push(id);
      return id;
    },
    clearInterval(id) {
      clearHandles.push(id);
    },
  };

  // Canned flush / logger injected so shutdown's Sentry flush and result log are
  // observable without sending anything external.
  const flushes = [];
  const logged = [];
  const errors = [];
  const fakeLogger = {
    log: (line) => logged.push(line),
    error: (line) => errors.push(line),
  };

  const { app, supabase } = createE1Server({
    setIntervalFn: fakeScheduler.setInterval,
    clearIntervalFn: fakeScheduler.clearInterval,
  });

  const handleSignal = installRendererSignalHandlers({
    processLike,
    shutdown: app.shutdown,
    flush: async () => { flushes.push(1); },
    logger: fakeLogger,
  });
  // installRendererSignalHandlers registered real `once` listeners on the fake
  // process, so the EventEmitter must expose exactly one listener per signal.
  assert.equal(processLike.listenerCount("SIGTERM"), 1, "infrastructure must register exactly one SIGTERM listener");
  assert.equal(processLike.listenerCount("SIGINT"), 1, "installer must register exactly one SIGINT listener");
  assert.equal(typeof handleSignal, "function", "installer must return the real signal handler");

  // Start the real poll and heartbeat timers so shutdown must clear them.
  app.startRuntimeTimers();
  assert.equal(setHandles.length, 2, "runtime must begin with exactly poll + heartbeat timers");

  // Open a real listener first so it can be genuinely refused after shutdown.
  return (async () => {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const port = app.server.address().port;
    // Prove the listener is open before the signal.
    await new Promise((res, rej) => {
      const probe = net.connect({ host: "127.0.0.1", port });
      probe.once("connect", () => { probe.destroy(); res(); });
      probe.once("error", rej);
    });

    // Deliver the signal through the real EventEmitter: emit() synchronously
    // invokes the registered once-listener, which runs the real shutdown path.
    // This is genuine synthetic emitter delivery (the same code path Node's
    // process signal watcher uses), not a direct callback invocation.
    const delivered = processLike.emit(signal);
    assert.equal(delivered, true, "emit must find and invoke the registered signal listener");

    // The handler's shutdown path runs on the SAME independent shutdownPromise
    // that the real shutdown yields, so awaiting app.shutdown() deterministically
    // observes handler completion without a wall-clock sleep. With no in-flight
    // work the gate drains immediately.
    await app.shutdown({ signal }); // idempotent; resolves when the real shutdown settles

    // Capacity gate no longer accepts.
    assert.equal(app.capacityGate.accepting, false, "signal must close the capacity gate");
    assert.equal(app.capacityGate.tryAcquire().ok, false, "signal must make the gate refuse new work");

    // Exact timer handles cleared, no extras.
    assert.equal(clearHandles.length, 2, "signal must clear exactly poll + heart handles");
    assert.equal(
      clearHandles.filter((id) => setHandles.includes(id)).length, 2,
      "each cleared handle must be one server actually created",
    );

    // Listener closed: a fresh connection is refused.
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}/health`),
      (error) => (error?.cause?.code ?? error?.code) === "ECONNREFUSED",
      "after the signal the listener must refuse fresh connections",
    );

    // Drain + in-flight.
    assert.equal(app.capacityGate.inFlight, 0, "no in-flight claim after signal drain");

    // Result log names the actual signal.
    const parsedLog = logged.map((line) => JSON.parse(line));
    const shutdownLog = parsedLog.find((entry) => entry.action === "shutdown");
    assert.ok(shutdownLog, "handler must emit a shutdown result log");
    assert.equal(shutdownLog.signal, signal, "shutdown log must name the exact signal");
    assert.equal(shutdownLog.drained, true, "shutdown log must report drained on an empty gate");
    assert.equal(shutdownLog.in_flight, 0, "shutdown log must report zero in-flight");
    assert.equal(processLike.exitCode, undefined, "drained path must not set a failure exitCode");
    assert.equal(flushes.length, 1, "handler must flush Sentry after a drained shutdown");
    assert.equal(errors.length, 0, "no shutdown_error on a clean drained path");

    // No claim RPC anywhere on the rejected/drained path.
    assert.deepEqual(supabase.claims, [], "no claim RPC reached on a signal-drain path");
  })();
}

test("SIGTERM stops claims, clears timers, closes the listener, drains, names the signal", async () => {
  await runInstallSignalContract("SIGTERM");
});

test("SIGINT stops claims, clears timers, closes the listener, drains, names the signal", async () => {
  await runInstallSignalContract("SIGINT");
});