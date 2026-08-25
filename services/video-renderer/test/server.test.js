import assert from "node:assert/strict";
import test from "node:test";
import { createRendererServer } from "../src/server.js";

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
