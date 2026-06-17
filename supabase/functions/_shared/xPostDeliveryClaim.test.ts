import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  claimXPostDelivery,
  completeXPostDelivery,
  failXPostDelivery,
  normalizeXPostDeliveryClaim,
  xPostClaimRejection,
} from "./xPostDeliveryClaim.ts";

type RpcCall = {
  name: string;
  args?: Record<string, unknown>;
};

function fakeRpcClient(responses: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  return {
    calls,
    client: {
      rpc(name: string, args?: Record<string, unknown>) {
        calls.push({ name, args });
        const response = responses[name];
        if (response instanceof Error) {
          return Promise.resolve({ error: { message: response.message } });
        }
        return Promise.resolve({ data: response });
      },
    },
  };
}

Deno.test("normalizes claimed and rejected x post delivery claim payloads", () => {
  assertEquals(
    normalizeXPostDeliveryClaim({
      claimed: true,
      delivery_id: "d1",
      claim_token: "c1",
      reason: "claimed",
      existing_status: null,
      existing_x_tweet_id: null,
      claim_expires_at: "2026-06-17T00:00:00.000Z",
    }),
    {
      claimed: true,
      deliveryId: "d1",
      claimToken: "c1",
      reason: "claimed",
      existingStatus: null,
      existingXTweetId: null,
      claimExpiresAt: "2026-06-17T00:00:00.000Z",
    },
  );

  const rejected = normalizeXPostDeliveryClaim({
    claimed: false,
    reason: "already_posted",
    existing_status: "posted",
    existing_x_tweet_id: "2067335729194156302",
  });
  assertEquals(xPostClaimRejection(rejected), {
    status: "skipped",
    reason: "already_posted",
    x_tweet_id: "2067335729194156302",
  });
});

Deno.test("claim x post delivery calls the database claim before side effects", async () => {
  const { calls, client } = fakeRpcClient({
    claim_x_post_delivery: {
      claimed: true,
      delivery_id: "delivery-1",
      claim_token: "claim-1",
      reason: "claimed",
    },
  });

  const claim = await claimXPostDelivery(client, {
    postId: "2067334459247231150",
    source: "event",
    forceRetry: false,
    ttlSeconds: 900,
  });

  assertEquals(claim.claimed, true);
  assertEquals(claim.deliveryId, "delivery-1");
  assertEquals(calls, [{
    name: "claim_x_post_delivery",
    args: {
      p_post_id: "2067334459247231150",
      p_source: "event",
      p_force_retry: false,
      p_claim_ttl_seconds: 900,
    },
  }]);
});

Deno.test("complete and fail x post delivery require the claim token", async () => {
  const { calls, client } = fakeRpcClient({
    complete_x_post_delivery: true,
    fail_x_post_delivery: true,
  });

  assertEquals(
    await completeXPostDelivery(client, {
      deliveryId: "delivery-1",
      claimToken: "claim-1",
      xTweetId: "x1",
      mediaCount: 1,
      mediaBytes: 42,
      mediaKind: "video",
      postedAt: "2026-06-17T00:00:00.000Z",
      latencyMs: 1200,
      apiResponse: { data: { id: "x1" } },
      lastError: null,
    }),
    true,
  );

  assertEquals(
    await failXPostDelivery(client, {
      deliveryId: "delivery-1",
      claimToken: "claim-1",
      error: "tweet 500",
      apiResponse: { error: "rate_limited" },
      skipReason: "x_api_retriable",
      nextRetryAt: "2026-06-17T00:15:00.000Z",
    }),
    true,
  );

  assertEquals(calls[0].name, "complete_x_post_delivery");
  assertEquals(calls[0].args?.p_delivery_id, "delivery-1");
  assertEquals(calls[0].args?.p_claim_token, "claim-1");
  assertEquals(calls[1].name, "fail_x_post_delivery");
  assertEquals(calls[1].args?.p_delivery_id, "delivery-1");
  assertEquals(calls[1].args?.p_claim_token, "claim-1");
});

Deno.test("claim helper surfaces database errors", async () => {
  const { client } = fakeRpcClient({
    claim_x_post_delivery: new Error("permission denied"),
  });

  await assertRejects(
    () => claimXPostDelivery(client, { postId: "t1", source: "cron" }),
    Error,
    "claim_x_post_delivery: permission denied",
  );
});
