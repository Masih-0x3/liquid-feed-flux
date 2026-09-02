import {
  deliveryCutoverAllowsPost,
  DeliveryCutoverBlockedError,
  requireDeliveryCutover,
  settleDeliveryCutoverJob,
} from "./deliveryCutover.ts";

Deno.test("delivery cutover blocks pre-T, equality, and missing lineage", () => {
  const t = "2026-08-25T09:13:45.744Z";
  if (deliveryCutoverAllowsPost(t, "2026-08-25T09:13:45.743Z")) {
    throw new Error("pre-T post was allowed");
  }
  if (deliveryCutoverAllowsPost(t, t)) {
    throw new Error("boundary-equal post was allowed");
  }
  if (deliveryCutoverAllowsPost(t, null)) {
    throw new Error("missing lineage was allowed");
  }
});

Deno.test("delivery cutover allows only strictly post-T admission", () => {
  if (
    !deliveryCutoverAllowsPost(
      "2026-08-25T09:13:45.744Z",
      "2026-08-25T09:13:45.745Z",
    )
  ) {
    throw new Error("post-T post was blocked");
  }
});

Deno.test("last-mile RPC guard fails closed on unavailable or blocked lineage", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const blocked = {
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        error: { message: "missing_or_historical_lineage" },
      });
    },
  };
  try {
    await requireDeliveryCutover(blocked, "old-tweet");
    throw new Error("blocked lineage did not throw");
  } catch (error) {
    if (!(error instanceof DeliveryCutoverBlockedError)) throw error;
  }
  if (calls.length !== 1 || calls[0].name !== "assert_delivery_cutover_post") {
    throw new Error(`unexpected RPC calls: ${JSON.stringify(calls)}`);
  }
});

Deno.test("last-mile RPC guard allows a validated post-T lineage", async () => {
  let called = false;
  await requireDeliveryCutover({
    rpc(name: string) {
      called = name === "assert_delivery_cutover_post";
      return Promise.resolve({ data: null, error: null });
    },
  }, "new-tweet");
  if (!called) throw new Error("cutover assertion RPC was not called");
});

Deno.test("historical delivery settlement is a zero-write no-op", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const settled = await settleDeliveryCutoverJob({
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
  }, "job-1", "delivery_cutover_blocked:historical");
  if (settled) throw new Error("historical job reported a write");
  if (calls.length !== 0) throw new Error("historical job called a settlement RPC");
});
