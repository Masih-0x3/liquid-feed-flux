import assert from "node:assert/strict";
import test from "node:test";
import {
  RenderClaimLostError,
  assertRenderTerminalAccepted,
  claimFenceFor,
  createRenderLeaseController,
  processedPathFor,
  removeStaleGenerationOutput,
} from "../src/renderLease.js";

function createRpcSupabase(results) {
  const calls = [];
  return {
    calls,
    async rpc(name, payload) {
      calls.push({ name, payload });
      return results.shift() ?? { data: true, error: null };
    },
  };
}

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  tweet_id: "tweet/unsafe",
  claim_token: "22222222-2222-4222-8222-222222222222",
  claim_generation: 7,
};

test("extracts the exact renderer ownership fence", () => {
  assert.deepEqual(claimFenceFor(row), {
    renderId: row.id,
    claimToken: row.claim_token,
    claimGeneration: 7,
  });
  assert.throws(
    () => claimFenceFor({ ...row, claim_token: null }),
    /missing a valid claim token/,
  );
  assert.throws(
    () => claimFenceFor({ ...row, claim_generation: 0 }),
    /missing a valid claim generation/,
  );
});

test("uses immutable generation-specific output paths", () => {
  const path = processedPathFor(row, "renderer-v2", new Date("2026-08-09T02:00:00Z"));
  assert.equal(
    path,
    "processed/renderer-v2/2026/08/tweet_unsafe/11111111-1111-4111-8111-111111111111/g7.mp4",
  );
  assert.notEqual(
    path,
    processedPathFor({ ...row, claim_generation: 8 }, "renderer-v2", new Date("2026-08-09T02:00:00Z")),
  );
});

test("renews only the exact token and generation", async () => {
  const supabase = createRpcSupabase([{ data: true, error: null }]);
  const lease = createRenderLeaseController({
    supabase,
    row,
    rendererId: "renderer-a",
    leaseSeconds: 600,
    renewalIntervalMs: 60_000,
    setIntervalFn: () => ({ timer: true }),
    clearIntervalFn: () => {},
  });

  lease.start();
  assert.equal(await lease.renewNow(), true);
  lease.assertCurrent();
  await lease.stop();

  assert.deepEqual(supabase.calls, [{
    name: "renew_video_render_lease",
    payload: {
      p_render_id: row.id,
      p_worker_id: "renderer-a",
      p_claim_token: row.claim_token,
      p_claim_generation: 7,
      p_lease_seconds: 600,
    },
  }]);
});

test("marks the claim lost when renewal is rejected", async () => {
  const supabase = createRpcSupabase([{ data: false, error: null }]);
  const lease = createRenderLeaseController({
    supabase,
    row,
    rendererId: "renderer-a",
    setIntervalFn: () => ({ timer: true }),
    clearIntervalFn: () => {},
  });

  lease.start();
  assert.equal(await lease.renewNow(), false);
  assert.throws(() => lease.assertCurrent(), RenderClaimLostError);
  await lease.stop();
});

test("marks the claim lost when renewal persistence fails", async () => {
  const supabase = createRpcSupabase([{ data: null, error: new Error("db unavailable") }]);
  const lease = createRenderLeaseController({
    supabase,
    row,
    rendererId: "renderer-a",
    setIntervalFn: () => ({ timer: true }),
    clearIntervalFn: () => {},
  });

  lease.start();
  assert.equal(await lease.renewNow(), false);
  assert.throws(() => lease.assertCurrent(), /db unavailable/);
  await lease.stop();
});

test("requires an explicit accepted terminal-write result", () => {
  assert.deepEqual(
    assertRenderTerminalAccepted({ accepted: true, queued_deliver: false }, row, "complete"),
    { accepted: true, queued_deliver: false },
  );
  assert.deepEqual(
    assertRenderTerminalAccepted([{ accepted: true, blocked: true }], row, "block"),
    { accepted: true, blocked: true },
  );
  assert.throws(
    () => assertRenderTerminalAccepted({ accepted: false }, row, "complete"),
    RenderClaimLostError,
  );
  assert.throws(
    () => assertRenderTerminalAccepted(null, row, "complete"),
    /did not return an explicit accepted result/,
  );
});

test("removes only the rejected generation output", async () => {
  const calls = [];
  const supabase = {
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            calls.push({ bucket, paths });
            return { data: paths, error: null };
          },
        };
      },
    },
  };
  const metrics = {};
  const path = processedPathFor(row, "renderer-v2", new Date("2026-08-09T02:00:00Z"));

  assert.equal(await removeStaleGenerationOutput({
    supabase,
    bucket: "temp-media",
    outputStoragePath: path,
    metrics,
  }), true);
  assert.deepEqual(calls, [{ bucket: "temp-media", paths: [path] }]);
  assert.deepEqual(metrics, { stale_output_cleanup: "removed" });
});
