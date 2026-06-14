import http from "node:http";
import { claimNextRender, claimRenderById, createSupabase, loadConfigFromEnv, processRenderRow, runPreflightForRenderId } from "./renderer.js";
import { loadRenderSettingsOrDefault } from "./settings.js";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 64 * 1024) reject(new Error("request too large"));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function authorized(req, token) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

export function createRendererServer(options = {}) {
  const config = options.config || loadConfigFromEnv();
  const supabase = options.supabase || createSupabase(config);
  const token = options.token ?? process.env.VIDEO_RENDERER_TOKEN ?? "";
  const state = { running: 0, processed: 0, failed: 0, lastError: null };

  const writeHeartbeat = async (status = "online", metadata = {}) => {
    const payload = {
      renderer_id: config.rendererId,
      status,
      version: process.env.npm_package_version || "0.1.0",
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
    const row = await claimRenderById(supabase, config, renderId);
    if (!row) return { ok: true, claimed: false, render_id: renderId };
    state.running += 1;
    await writeHeartbeat("online", { action: "render", render_id: renderId }).catch(() => null);
    try {
      const result = await processRenderRow({ supabase, row, config });
      state.processed += 1;
      state.lastError = null;
      return { ...result, claimed: true };
    } catch (error) {
      state.failed += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      state.running -= 1;
      await writeHeartbeat(state.lastError ? "error" : "online", { action: "render_complete" }).catch(() => null);
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        await writeModeHeartbeat({ action: "health" }).catch(() => null);
        return json(res, 200, { ok: true, ...state });
      }
      if (req.method === "POST" && url.pathname === "/v1/render") {
        if (!authorized(req, token)) return json(res, 401, { error: "Unauthorized" });
        const body = await readJson(req);
        const renderId = typeof body.render_id === "string" ? body.render_id : "";
        if (!renderId) return json(res, 400, { error: "render_id is required" });
        const result = await processById(renderId);
        return json(res, 202, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/preflight") {
        if (!authorized(req, token)) return json(res, 401, { error: "Unauthorized" });
        const body = await readJson(req);
        const renderId = typeof body.render_id === "string" ? body.render_id : "";
        if (!renderId) return json(res, 400, { error: "render_id is required" });
        const result = await runPreflightForRenderId({ supabase, renderId, config });
        return json(res, 200, result);
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  async function pollOnce() {
    if (state.running > 0) return null;
    const settings = await loadRenderSettingsOrDefault(supabase).catch(() => ({ mode: "enabled" }));
    if (settings.mode === "disabled") {
      await writeHeartbeat("paused", { mode: settings.mode }).catch(() => null);
      return null;
    }
    const row = await claimNextRender(supabase, config);
    if (!row) {
      await writeHeartbeat("online", { mode: settings.mode }).catch(() => null);
      return null;
    }
    state.running += 1;
    await writeHeartbeat("online", { action: "poll", mode: settings.mode, render_id: row.id }).catch(() => null);
    try {
      const result = await processRenderRow({ supabase, row, config });
      state.processed += 1;
      state.lastError = null;
      return result;
    } catch (error) {
      state.failed += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      return null;
    } finally {
      state.running -= 1;
      await writeHeartbeat(state.lastError ? "error" : "online", { action: "poll_complete", mode: settings.mode }).catch(() => null);
    }
  }

  return { server, state, pollOnce, writeHeartbeat, writeModeHeartbeat };
}

export function startRendererServer() {
  const port = Number(process.env.PORT || 8787);
  const intervalMs = Math.max(1000, Number(process.env.POLL_INTERVAL_MS || 5000));
  const heartbeatMs = Math.max(5000, Number(process.env.HEARTBEAT_INTERVAL_MS || 30000));
  const { server, pollOnce, writeHeartbeat, writeModeHeartbeat } = createRendererServer();
  server.listen(port, () => {
    console.log(JSON.stringify({ service: "xot-video-renderer", action: "listening", port }));
    writeHeartbeat("online", { action: "listening", port }).catch((error) => {
      console.error(JSON.stringify({ service: "xot-video-renderer", action: "heartbeat_error", error: error.message }));
    });
  });
  setInterval(() => {
    pollOnce().catch((error) => {
      console.error(JSON.stringify({ service: "xot-video-renderer", action: "poll_error", error: error.message }));
    });
  }, intervalMs);
  setInterval(() => {
    writeModeHeartbeat({ action: "interval" }).catch((error) => {
      console.error(JSON.stringify({ service: "xot-video-renderer", action: "heartbeat_error", error: error.message }));
    });
  }, heartbeatMs);
  return server;
}
