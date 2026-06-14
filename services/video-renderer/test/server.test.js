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
  assert.deepEqual(response.payload, { error: "render_id is required" });
});
