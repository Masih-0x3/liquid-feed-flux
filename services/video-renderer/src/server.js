import http from "node:http";
import { isAuthorizedRendererRequest, loadConfigFromEnv, loadServerRuntimeFromEnv, normalizeRendererToken } from "./config.js";
import { RendererCapacityGate } from "./rendererCapacity.js";
import { RendererRequestInputError, readBoundedRendererDispatchRequest } from "./rendererRequestPolicy.js";
import { abortAllManagedProcesses } from "./processRunner.js";
import { claimNextRender, claimRenderById, createSupabase, processRenderRow, runPreflightForRenderId } from "./renderer.js";
import { captureRendererException, flushSentryRenderer, initSentryRenderer } from "./sentry.js";
import { loadRenderSettingsOrDefault } from "./settings.js";

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function publicHealthSnapshot(state) {
  return {
    ok: true,
    running: state.running,
    processed: state.processed,
    failed: state.failed,
    lastError: state.lastError ? "renderer_error" : null,
    shutting_down: state.shutting_down,
  };
}

function capacityRejectionResponse(res, lease) {
  const shuttingDown = lease.reason === "shutting_down";
  return json(res, shuttingDown ? 503 : 429, {
    error: shuttingDown ? "Renderer is shutting down" : "Renderer is at capacity",
    code: shuttingDown ? "renderer_shutting_down" : "renderer_capacity_exceeded",
    retry_after_seconds: lease.retryAfterSeconds,
  }, { "Retry-After": String(lease.retryAfterSeconds) });
}

export function createRendererServer(options = {}) {
  const config = options.config || loadConfigFromEnv();
  const runtime = options.runtime || loadServerRuntimeFromEnv(options.env);
  initSentryRenderer({ config, runtime, env: options.env || process.env });
  const supabase = options.supabase || createSupabase(config);
  const token = normalizeRendererToken(options.token ?? runtime.token);
  // Testability seam: allow a renderer host test to supply its own interval
  // scheduler so it can drive poll/heartbeat cycles with a deterministic fake
  // clock instead of wall-clock sleeps. Production callers (and the default
  // startRendererServer entry point) omit this and use the Node globals.
  const setInterval = options.setIntervalFn || globalThis.setInterval;
  const clearInterval = options.clearIntervalFn || globalThis.clearInterval;
  const state = { running: 0, processed: 0, failed: 0, lastError: null, shutting_down: false };
  const capacityGate = new RendererCapacityGate(runtime.renderConcurrency);
  let pollTimer = null;
  let heartbeatTimer = null;
  let shutdownPromise = null;

  const syncCapacityState = () => {
    state.running = capacityGate.inFlight;
  };

  const tryAcquireRendererCapacity = () => {
    const lease = capacityGate.tryAcquire();
    syncCapacityState();
    if (!lease.ok) return lease;
    return {
      ...lease,
      release: () => {
        const released = lease.release();
        syncCapacityState();
        return released;
      },
    };
  };

  const writeHeartbeat = async (status = "online", metadata = {}) => {
    const payload = {
      renderer_id: config.rendererId,
      status,
      version: runtime.version,
      render_version: config.renderVersion,
      running: state.running,
      processed: state.processed,
      failed: state.failed,
      last_error: state.lastError,
      metadata: {
        pid: process.pid,
        node: process.version,
        ...metadata,
      },
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("video_renderer_heartbeats")
      .upsert(payload, { onConflict: "renderer_id" });
    if (error) {
      state.lastError = `heartbeat: ${error.message}`;
      throw error;
    }
    return payload;
  };

  const writeModeHeartbeat = async (metadata = {}) => {
    const settings = await loadRenderSettingsOrDefault(supabase).catch(() => ({ mode: "enabled" }));
    const status = settings.mode === "disabled" ? "paused" : "online";
    return writeHeartbeat(status, { mode: settings.mode, ...metadata });
  };

  const processById = async (renderId) => {
    const lease = tryAcquireRendererCapacity();
    if (!lease.ok) {
      return {
        ok: false,
        capacity_rejected: true,
        reason: lease.reason,
        retry_after_seconds: lease.retryAfterSeconds,
      };
    }
    try {
      // Capacity must be held before claiming so a saturated HTTP request does
      // not leave a database claim that this renderer cannot actually run.
      const row = await claimRenderById(supabase, config, renderId);
      if (!row) return { ok: true, claimed: false, render_id: renderId };
      await writeHeartbeat("online", { action: "render", render_id: renderId }).catch(() => null);
      const result = await processRenderRow({ supabase, row, config });
      state.processed += 1;
      state.lastError = null;
      return { ...result, claimed: true };
    } catch (error) {
      state.failed += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      captureRendererException(error, {
        action: "render_by_id_error",
        extra: { render_id: renderId },
      });
      await flushSentryRenderer();
      throw error;
    } finally {
      lease.release();
      await writeHeartbeat(
        state.shutting_down ? "paused" : state.lastError ? "error" : "online",
        { action: "render_complete", shutting_down: state.shutting_down },
      ).catch(() => null);
    }
  };

  const preflightById = async (renderId) => {
    const lease = tryAcquireRendererCapacity();
    if (!lease.ok) {
      return {
        ok: false,
        capacity_rejected: true,
        reason: lease.reason,
        retry_after_seconds: lease.retryAfterSeconds,
      };
    }
    try {
      await writeHeartbeat("online", { action: "preflight" }).catch(() => null);
      return await runPreflightForRenderId({ supabase, renderId, config });
    } finally {
      lease.release();
      await writeHeartbeat(
        state.shutting_down ? "paused" : state.lastError ? "error" : "online",
        { action: "preflight_complete", shutting_down: state.shutting_down },
      ).catch(() => null);
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        await writeModeHeartbeat({ action: "health" }).catch(() => null);
        return json(res, 200, publicHealthSnapshot(state));
      }
      if (req.method === "POST" && url.pathname === "/v1/render") {
        if (!isAuthorizedRendererRequest(req.headers, token)) return json(res, 401, { error: "Unauthorized" });
        const { renderId } = await readBoundedRendererDispatchRequest(req);
        const result = await processById(renderId);
        if (result?.capacity_rejected) {
          return capacityRejectionResponse(res, {
            reason: result.reason,
            retryAfterSeconds: result.retry_after_seconds,
          });
        }
        return json(res, 202, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/preflight") {
        if (!isAuthorizedRendererRequest(req.headers, token)) return json(res, 401, { error: "Unauthorized" });
        const { renderId } = await readBoundedRendererDispatchRequest(req);
        const result = await preflightById(renderId);
        if (result?.capacity_rejected) {
          return capacityRejectionResponse(res, {
            reason: result.reason,
            retryAfterSeconds: result.retry_after_seconds,
          });
        }
        return json(res, 200, result);
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof RendererRequestInputError) {
        return json(res, error.status, {
          error: error.message,
          code: error.code,
        }, error.closeConnection ? { Connection: "close" } : {});
      }
      captureRendererException(error, {
        action: "http_error",
        tags: { method: req.method, path: req.url || "/" },
      });
      await flushSentryRenderer();
      return json(res, 500, { error: "Renderer request failed", code: "renderer_internal_error" });
    }
  });

  async function pollOnce() {
    if (!capacityGate.accepting) return null;
    const settings = await loadRenderSettingsOrDefault(supabase).catch(() => ({ mode: "enabled" }));
    if (settings.mode === "disabled") {
      await writeHeartbeat("paused", { mode: settings.mode }).catch(() => null);
      return null;
    }
    const lease = tryAcquireRendererCapacity();
    if (!lease.ok) return null;
    let row = null;
    try {
      // Acquire the shared slot before claimNextRender so polling cannot claim
      // a row while HTTP work has consumed the renderer's capacity.
      row = await claimNextRender(supabase, config);
      if (!row) {
        await writeHeartbeat("online", { mode: settings.mode }).catch(() => null);
        return null;
      }
      await writeHeartbeat("online", { action: "poll", mode: settings.mode, render_id: row.id }).catch(() => null);
      const result = await processRenderRow({ supabase, row, config });
      state.processed += 1;
      state.lastError = null;
      return result;
    } catch (error) {
      state.failed += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      captureRendererException(error, {
        action: "poll_render_error",
        extra: { render_id: row?.id ?? null, tweet_id: row?.tweet_id ?? null },
      });
      return null;
    } finally {
      lease.release();
      await writeHeartbeat(
        state.shutting_down ? "paused" : state.lastError ? "error" : "online",
        { action: "poll_complete", mode: settings.mode, shutting_down: state.shutting_down },
      ).catch(() => null);
    }
  }

  const stopRuntimeTimers = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
  };

  const startRuntimeTimers = () => {
    if (state.shutting_down) return;
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        pollOnce().catch((error) => {
          console.error(JSON.stringify({ service: "xot-video-renderer", action: "poll_error", error: error.message }));
          captureRendererException(error, { action: "poll_error" });
        });
      }, runtime.pollIntervalMs);
    }
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        writeModeHeartbeat({ action: "interval" }).catch((error) => {
          console.error(JSON.stringify({ service: "xot-video-renderer", action: "heartbeat_error", error: error.message }));
          captureRendererException(error, { action: "heartbeat_error" });
        });
      }, runtime.heartbeatIntervalMs);
    }
  };

  // Testability seam: the listener-close step can be supplied by a host test
  // so shutdown's 503 rejection can be asserted on a deterministically-open
  // listener before the real close is performed. Production callers (and the
  // default startRendererServer entry point) omit this and use the default,
  // which truly closes the live server; behaviour is otherwise identical.
  const closeListener = options.closeListener || (() => {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  });

  const shutdown = ({ signal = "manual", graceMs = runtime.shutdownGraceMs } = {}) => {
    if (shutdownPromise) return shutdownPromise;
    state.shutting_down = true;
    capacityGate.stopAccepting();
    syncCapacityState();
    stopRuntimeTimers();
    const cancelledProcessGroups = abortAllManagedProcesses("shutdown");
    shutdownPromise = (async () => {
      // Start closing before any external telemetry. A stuck database write
      // must not keep the listener accepting or consume shutdown grace.
      void closeListener();
      void writeHeartbeat("paused", {
        action: "shutdown_requested",
        signal,
        in_flight: capacityGate.inFlight,
        process_groups_signalled: cancelledProcessGroups,
      }).catch(() => null);
      // server.close() stops accepting immediately but its callback waits for
      // existing HTTP requests. Do not await that callback: a slow request
      // that has not acquired a renderer slot must not consume drain grace.
      const drained = await capacityGate.waitForDrain(graceMs);
      void writeHeartbeat("paused", {
        action: "shutdown_complete",
        signal,
        drained,
        in_flight: capacityGate.inFlight,
        process_groups_signalled: cancelledProcessGroups,
      }).catch(() => null);
      return { drained, in_flight: capacityGate.inFlight };
    })();
    return shutdownPromise;
  };

  return {
    server,
    state,
    capacityGate,
    pollOnce,
    writeHeartbeat,
    writeModeHeartbeat,
    startRuntimeTimers,
    stopRuntimeTimers,
    shutdown,
  };
}

/**
 * Signal-handler wiring extracted from startRendererServer so the SIGTERM and
 * SIGINT runtime contract can be exercised hermetically. Production callers and
 * the default startRendererServer entry point omit overrides and register on
 * the real Node process with byte-for-byte identical semantics: SIGTERM/SIGINT
 * stop new claims (via the shutdown path), clear the poll/heartbeat timers and
 * listener, drain or abort within grace, record a shutdown result log, and set
 * exitCode before flushing Sentry. Every operational default is preserved;
 * only inputs a hermetic test needs (a fake process/EventEmitter target,
 * shutdown, flush, logger) are dependency-injected.
 *
 * Returns the signal handler so a host test can observe/drive the same callback
 * the registered once-listener invokes.
 */
export function installRendererSignalHandlers({
  processLike = process,
  shutdown,
  flush = flushSentryRenderer,
  logger = console,
} = {}) {
  const handleSignal = (signal) => {
    const resolveShutdown = shutdown || (() => Promise.reject(new Error("no shutdown provided")));
    resolveShutdown({ signal }).then(async ({ drained, in_flight: inFlight }) => {
      if (!drained) processLike.exitCode = 1;
      await flush().catch(() => null);
      logger.log(JSON.stringify({
        service: "xot-video-renderer",
        action: "shutdown",
        signal,
        drained,
        in_flight: inFlight,
      }));
    }).catch((error) => {
      processLike.exitCode = 1;
      logger.error(JSON.stringify({
        service: "xot-video-renderer",
        action: "shutdown_error",
        signal,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  };
  if (processLike === process) {
    // Production default path: register on the real Node process exactly as the
    // inlined entry point did. The literal process.once registrations are part
    // of the source contract; a substituted fake processEmitter takes the other
    // branch so Section death tests never touch the real process.
    process.once("SIGTERM", () => handleSignal("SIGTERM"));
    process.once("SIGINT", () => handleSignal("SIGINT"));
  } else {
    processLike.once("SIGTERM", () => handleSignal("SIGTERM"));
    processLike.once("SIGINT", () => handleSignal("SIGINT"));
  }
  return handleSignal;
}

export function startRendererServer() {
  const runtime = loadServerRuntimeFromEnv();
  const { server, startRuntimeTimers, shutdown, writeHeartbeat } = createRendererServer({ runtime });
  server.listen(runtime.port, () => {
    console.log(JSON.stringify({ service: "xot-video-renderer", action: "listening", port: runtime.port }));
    writeHeartbeat("online", { action: "listening", port: runtime.port }).catch((error) => {
      console.error(JSON.stringify({ service: "xot-video-renderer", action: "heartbeat_error", error: error.message }));
    });
    startRuntimeTimers();
  });
  installRendererSignalHandlers({ shutdown });
  return server;
}
