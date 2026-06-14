import assert from "node:assert/strict";
import test from "node:test";
import { recordRenderFailure } from "../src/renderer.js";

function thenableResult(value) {
  return {
    then(resolve) {
      resolve(value);
    },
  };
}

test("records render failure with awaitable Supabase RPC builders that do not expose catch", async () => {
  const calls = [];
  const supabase = {
    rpc(name, payload) {
      calls.push({ name, payload });
      return thenableResult({ data: { queued_deliver: false }, error: null });
    },
  };

  const data = await recordRenderFailure(supabase, {
    renderId: "render-1",
    error: new Error("primary render failure"),
    metrics: { total_ms: 123 },
  });

  assert.deepEqual(data, { queued_deliver: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "fail_video_render");
  assert.deepEqual(calls[0].payload, {
    p_render_id: "render-1",
    p_error: "primary render failure",
    p_metrics: { total_ms: 123 },
  });
});
