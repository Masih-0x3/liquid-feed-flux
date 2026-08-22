import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  runMediaObjectCleanup,
  type MediaObjectCleanupClient,
} from "./legacyMediaCleanup.ts";
import {
  runJobWithProviderBoundary,
  markJobProviderStarted,
} from "../worker/jobLifecycle.ts";
import { withProviderBoundary } from "./durableClaimFence.ts";
import {
  markXPostDeliveryProviderStarted,
  completeXPostDelivery,
  failXPostDelivery,
} from "./xPostDeliveryClaim.ts";

type RpcCall = { name: string; args?: Record<string, unknown> };

Deno.test("E6 B2B application boundary keeps DB references on storage failure", async () => {
  const calls: RpcCall[] = [];
  const state = { storageRemoved: false, finalized: false, references: 2 };
  const client: MediaObjectCleanupClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "media_objects_claim_old") {
        return {
          data: [{
            object_id: "object-e6",
            bucket: "temp-media",
            storage_path: "e6/shared.jpg",
            deletion_token: "token-e6",
          }],
          error: null,
        };
      }
      if (name === "media_objects_finalize_delete") {
        state.finalized = true;
        state.references = 0;
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from(bucket) {
        assertEquals(bucket, "temp-media");
        return {
          async remove(paths) {
            assertEquals(paths, ["e6/shared.jpg"]);
            state.storageRemoved = true;
            return { error: new Error("injected_storage_failure") };
          },
        };
      },
    },
  };

  const result = await runMediaObjectCleanup(client);
  assertEquals(result, { deletedCount: 0, failedCount: 1, claimedCount: 1 });
  assertEquals(state.storageRemoved, true);
  assertEquals(state.finalized, false);
  assertEquals(state.references, 2);
  assertEquals(calls.map((call) => call.name), ["media_objects_claim_old"]);
});

Deno.test("E6 B3A job helper blocks provider calls when marker is rejected", async () => {
  let providerCalls = 0;
  const result = await runJobWithProviderBoundary(
    {
      async rpc(name) {
        assertEquals(name, "mark_job_provider_started");
        return { data: false, error: null };
      },
    },
    { id: "job-e6", claim_token: "token-e6", claim_generation: 2, claim_state: "preparing" },
    async () => {
      providerCalls += 1;
      return "provider-result";
    },
    async () => true,
  );
  assertEquals(result.status, "marker_rejected");
  assertEquals(providerCalls, 0);
});

Deno.test("E6 B3A real provider boundary reports completion uncertainty as ambiguous", async () => {
  const order: string[] = [];
  const result = await withProviderBoundary({
    markStarted: async () => {
      order.push("marker");
      return true;
    },
    provider: async () => {
      order.push("provider");
      return { accepted: true };
    },
    complete: async () => {
      order.push("complete");
      return false;
    },
  });
  assertEquals(result.status, "ambiguous");
  assertEquals(order, ["marker", "provider", "complete"]);
});

Deno.test("E6 B3A application RPC helpers carry X generation fences", async () => {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };
  const params = { deliveryId: "delivery-e6", claimToken: "token-e6", claimGeneration: 4 };
  assertEquals(await markXPostDeliveryProviderStarted(client, params), true);
  assertEquals(await completeXPostDelivery(client, {
    ...params,
    xTweetId: "tweet-e6",
    mediaCount: 0,
    mediaBytes: 0,
    mediaKind: null,
    postedAt: new Date(0).toISOString(),
    latencyMs: 1,
    apiResponse: null,
    lastError: null,
  }), true);
  assertEquals(await failXPostDelivery(client, { ...params, error: "bounded_failure" }), true);
  assertEquals(calls.map((call) => call.args?.p_claim_generation), [4, 4, 4]);
  assertNotEquals(calls.map((call) => call.name).includes("provider"), true);
});

// Keep this fixture offline even when it is run through a local command.
assertEquals(typeof Deno.test, "function");
