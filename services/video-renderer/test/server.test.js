import assert from "node:assert/strict";
import test from "node:test";
import { createRendererServer } from "../src/server.js";
import { loadRenderSettings, loadRenderSettingsOrDefault, RENDER_SETTINGS_ERROR_MARKER } from "../src/settings.js";

function request(server, { path, method = "GET", token, body } = {}) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      try {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          method,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json();
        resolve({ status: response.status, payload });
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

function createTestServer(options = {}) {
  return createRendererServer({
    config: {},
    supabase: {},
    ...options,
  }).server;
}

function mockSupabase() {
  const rpcs = [];
  return {
    rpcs,
    rpc: async (name, params) => {
      rpcs.push({ name, params });
      return { data: [], error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { value: { mode: "enabled" } }, error: null }) }),
      }),
      upsert: async () => ({ error: null }),
    }),
  };
}

function settingsSequenceSupabase(settingsResponses) {
  const rpcs = [];
  const heartbeats = [];
  const responses = [...settingsResponses];
  return {
    rpcs,
    heartbeats,
    rpc: async (name, params) => {
      rpcs.push({ name, params });
      return { data: [], error: null };
    },
    from: (table) => {
      if (table === "settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => responses.shift() ?? { data: { value: { mode: "enabled" } }, error: null },
            }),
          }),
        };
      }
      if (table === "video_renderer_heartbeats") {
        return {
          upsert: async (payload) => {
            heartbeats.push(payload);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

test("render dispatch fails closed when no renderer token is configured", async () => {
  const server = createTestServer({ token: "" });

  const response = await request(server, {
    path: "/v1/render",
    method: "POST",
    body: { render_id: "render-1" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.payload, { error: "Unauthorized" });
});

test("preflight dispatch fails closed when no renderer token is configured", async () => {
  const server = createTestServer({ token: "   " });

  const response = await request(server, {
    path: "/v1/preflight",
    method: "POST",
    body: { render_id: "render-1" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.payload, { error: "Unauthorized" });
});

test("configured bearer token reaches route validation", async () => {
  const server = createTestServer({ token: "secret-token" });

  const response = await request(server, {
    path: "/v1/render",
    method: "POST",
    token: "secret-token",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.payload, {
    error: "render_id is required",
    code: "renderer_request_render_id_required",
  });
});

test("disabled or invalid-cutoff polling makes zero claim calls", async () => {
  for (const runtime of [
    { renderPollingEnabled: false, renderQueueCutoffAt: null },
    { renderPollingEnabled: true, renderQueueCutoffAt: "invalid" },
  ]) {
    const supabase = mockSupabase();
    const renderer = createRendererServer({
      config: { rendererId: "renderer-test", renderVersion: "v1" },
      runtime,
      supabase,
    });
    await renderer.pollOnce();
    assert.equal(supabase.rpcs.length, 0);
  }
});

test("health reports the derived polling state for direct runtime options", async () => {
  const supabase = mockSupabase();
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });
  const response = await request(renderer.server, { path: "/health" });

  assert.equal(response.status, 200);
  assert.equal(response.payload.render_polling_enabled, true);
  assert.equal(response.payload.render_polling_effective, true);
  assert.equal(response.payload.render_polling_block_reason, null);
});

test("enabled polling claims only through the cutoff wrapper", async () => {
  const supabase = mockSupabase();
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });
  await renderer.pollOnce();
  assert.deepEqual(supabase.rpcs, [{
    name: "claim_video_render_after",
    params: {
      p_queued_after: "2026-08-25T02:00:00.000Z",
      worker_id: "renderer-test",
    },
  }]);
});

test("render-settings read failure pauses polling before any claim", async () => {
  const supabase = settingsSequenceSupabase([
    { data: null, error: new Error("private settings diagnostic") },
  ]);
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });

  const result = await renderer.pollOnce();

  assert.equal(result, null);
  assert.deepEqual(supabase.rpcs, [], "a failed settings read must not claim a render");
  assert.equal(supabase.heartbeats.at(-1).status, "paused");
  assert.equal(supabase.heartbeats.at(-1).metadata.mode, "disabled");
  assert.equal(supabase.heartbeats.at(-1).last_error, "renderer_error");
  assert.equal(renderer.state.lastError, "renderer_error");
  assert.doesNotMatch(JSON.stringify(supabase.heartbeats), /private settings diagnostic/);
});

test("malformed successful render-settings reads stay paused and fail closed", async () => {
  for (const data of [
    null,
    undefined,
    "not-an-object",
    123,
    [],
    {},
    { value: null },
    { value: undefined },
    { value: [] },
    { value: "enabled" },
    { value: 123 },
    { value: {} },
    { value: { mode: "" } },
    { value: { mode: null } },
    { value: { mode: "unknown" } },
    { value: { mode: 123 } },
    { value: { mode: [] } },
    { value: { mode: {} } },
  ]) {
    const supabase = settingsSequenceSupabase([{ data, error: null }]);
    const renderer = createRendererServer({
      config: { rendererId: "renderer-test", renderVersion: "v1" },
      runtime: {
        renderPollingEnabled: true,
        renderQueueCutoffAt: "2026-08-25T02:00:00Z",
      },
      supabase,
    });

    await renderer.pollOnce();

    assert.deepEqual(supabase.rpcs, [], `malformed settings response must not claim: ${JSON.stringify(data)}`);
    assert.equal(supabase.heartbeats.at(-1).status, "paused");
    assert.equal(supabase.heartbeats.at(-1).metadata.mode, "disabled");
    assert.equal(supabase.heartbeats.at(-1).last_error, "renderer_error");
  }
});

test("loadRenderSettings rejects malformed envelopes and accepts valid envelopes", async () => {
  const malformedInputs = [
    null,
    undefined,
    [],
    {},
    { value: null },
    { value: undefined },
    { value: "enabled" },
    { value: [] },
    { value: {} },
    { value: { mode: "unknown" } },
    { value: { mode: "" } },
    { value: { mode: 123 } },
  ];

  for (const data of malformedInputs) {
    const supabaseReject = settingsSequenceSupabase([{ data, error: null }]);
    await assert.rejects(
      async () => loadRenderSettings(supabaseReject),
      (err) => err instanceof Error && err.message === RENDER_SETTINGS_ERROR_MARKER,
      `expected malformed data ${JSON.stringify(data)} to reject with ${RENDER_SETTINGS_ERROR_MARKER}`,
    );

    const supabaseFallback = settingsSequenceSupabase([{ data, error: null }]);
    const metrics = {};
    const fallbackSettings = await loadRenderSettingsOrDefault(supabaseFallback, metrics);
    assert.equal(metrics.video_render_config_error, RENDER_SETTINGS_ERROR_MARKER);
    assert.equal(fallbackSettings.mode, "disabled");
  }

  for (const mode of ["disabled", "shadow", "enabled", "ENABLED", "Shadow", "DISABLED"]) {
    const supabase = settingsSequenceSupabase([{ data: { value: { mode } }, error: null }]);
    const loaded = await loadRenderSettings(supabase);
    assert.equal(loaded.mode, mode.toLowerCase());

    const supabaseDefault = settingsSequenceSupabase([{ data: { value: { mode } }, error: null }]);
    const metrics = {};
    const loadedOrDefault = await loadRenderSettingsOrDefault(supabaseDefault, metrics);
    assert.equal(metrics.video_render_config_error, undefined);
    assert.equal(loadedOrDefault.mode, mode.toLowerCase());
  }
});

test("valid mode still admits settings with malformed optional nested fields", async () => {
  const supabase = settingsSequenceSupabase([{
    data: {
      value: {
        mode: "enabled",
        subtitle_style: [],
        delogo: null,
        watermark: "not-an-object",
      },
    },
    error: null,
  }]);
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });

  await renderer.pollOnce();

  assert.equal(supabase.rpcs.length, 1, "optional nested fields are normalized without blocking a valid mode");
  assert.equal(renderer.state.lastError, null);
});

test("render-settings read failure reports paused health with a stable degraded marker", async () => {
  const supabase = settingsSequenceSupabase([
    { data: null, error: new Error("private settings diagnostic") },
  ]);
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });

  const response = await request(renderer.server, { path: "/health" });

  assert.equal(response.status, 200);
  assert.equal(response.payload.lastError, "renderer_error");
  assert.equal(supabase.heartbeats.at(-1).status, "paused");
  assert.equal(supabase.heartbeats.at(-1).last_error, "renderer_error");
  assert.doesNotMatch(JSON.stringify(response.payload), /private settings diagnostic/);
  assert.doesNotMatch(JSON.stringify(supabase.heartbeats), /private settings diagnostic/);
});

test("successful render-settings read recovers polling and clears the degraded marker", async () => {
  const supabase = settingsSequenceSupabase([
    { data: null, error: new Error("private settings diagnostic") },
    { data: { value: { mode: "enabled" } }, error: null },
  ]);
  const renderer = createRendererServer({
    config: { rendererId: "renderer-test", renderVersion: "v1" },
    runtime: {
      renderPollingEnabled: true,
      renderQueueCutoffAt: "2026-08-25T02:00:00Z",
    },
    supabase,
  });

  await renderer.pollOnce();
  const recoveryResult = await renderer.pollOnce();

  assert.equal(recoveryResult, null);
  assert.deepEqual(supabase.rpcs, [{
    name: "claim_video_render_after",
    params: {
      p_queued_after: "2026-08-25T02:00:00.000Z",
      worker_id: "renderer-test",
    },
  }]);
  assert.deepEqual(supabase.heartbeats.map((heartbeat) => heartbeat.status), ["paused", "online", "online"]);
  assert.equal(renderer.state.lastError, null);
  assert.equal(supabase.heartbeats.at(-1).last_error, null);
});
