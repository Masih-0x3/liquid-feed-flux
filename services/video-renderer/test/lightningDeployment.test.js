import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const deployRoot = new URL("../deploy/lightning/", import.meta.url);

test("Lightning deployment declares isolated stack selectors while preserving production defaults", async () => {
  const [compose, bootstrap, serviceEnv, readme] = await Promise.all([
    readFile(new URL("docker-compose.lightning.yml", deployRoot), "utf8"),
    readFile(new URL("bootstrap.sh", deployRoot), "utf8"),
    readFile(new URL("service.env.example", deployRoot), "utf8"),
    readFile(new URL("README.md", deployRoot), "utf8"),
  ]);

  assert.match(compose, /name: \$\{XOT_RENDERER_COMPOSE_PROJECT:-xot-renderer\}/);
  assert.match(compose, /127\.0\.0\.1:\$\{XOT_RENDERER_HOST_PORT:-8797\}:8787/);
  assert.match(compose, /name: \$\{XOT_RENDERER_NETWORK_NAME:-xot-renderer-net\}/);
  assert.match(compose, /name: \$\{XOT_RENDERER_VOLUME_NAME:-xot-renderer-tmp\}/);

  assert.match(bootstrap, /PROJECT_NAME="\$\{XOT_RENDERER_COMPOSE_PROJECT:-xot-renderer\}"/);
  assert.match(bootstrap, /HOST_PORT="\$\{XOT_RENDERER_HOST_PORT:-8797\}"/);
  assert.match(bootstrap, /curl -fsS http:\/\/127\.0\.0\.1:\$\{HOST_PORT\}\/health/);
  assert.match(bootstrap, /a non-production project must use its own host port, network, and volume/);

  for (const value of [
    "XOT_RENDERER_COMPOSE_PROJECT=xot-renderer",
    "XOT_RENDERER_HOST_PORT=8797",
    "XOT_RENDERER_NETWORK_NAME=xot-renderer-net",
    "XOT_RENDERER_VOLUME_NAME=xot-renderer-tmp",
  ]) {
    assert.match(serviceEnv, new RegExp(`^${value}$`, "m"));
  }

  for (const value of [
    "XOT_RENDERER_COMPOSE_PROJECT=xot-renderer-preview",
    "XOT_RENDERER_HOST_PORT=8798",
    "XOT_RENDERER_NETWORK_NAME=xot-renderer-preview-net",
    "XOT_RENDERER_VOLUME_NAME=xot-renderer-preview-tmp",
    "RENDERER_ID=xot-staging-1",
    "RENDER_POLLING_ENABLED=0",
  ]) {
    assert.match(readme, new RegExp(value));
  }
});

test("Lightning bootstrap rejects a Preview project that keeps Production resource selectors", () => {
  const bootstrapPath = new URL("bootstrap.sh", deployRoot);
  const result = spawnSync("bash", [fileURLToPath(bootstrapPath), "--no-build"], {
    encoding: "utf8",
    env: {
      ...process.env,
      XOT_RENDERER_COMPOSE_PROJECT: "xot-renderer-preview",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /a non-production project must use its own host port, network, and volume/);
});
