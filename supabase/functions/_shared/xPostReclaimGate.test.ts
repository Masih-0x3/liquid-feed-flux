import { assertEquals } from "jsr:@std/assert";
import { shouldDeferActiveXDelivery } from "./xPostReclaimGate.ts";

Deno.test("shouldDeferActiveXDelivery defers an active posting row regardless of release reason", () => {
  assertEquals(shouldDeferActiveXDelivery({ status: "posting", claim_release_reason: null }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "posting", claim_release_reason: undefined }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "posting", claim_release_reason: "pre_provider_retry" }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "posting", claim_release_reason: "failed" }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "posting", claim_release_reason: "" }), true);
});

Deno.test("shouldDeferActiveXDelivery does not defer a pre-provider-released pending row (reclaim path)", () => {
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry" }), false);
});

Deno.test("shouldDeferActiveXDelivery still defers a pending row that is not a pre-provider release", () => {
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: null }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: undefined }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "" }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "failed" }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "stale_posting" }), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "claim_release_failed" }), true);
});

Deno.test("shouldDeferActiveXDelivery never defers a terminal or absent status", () => {
  assertEquals(shouldDeferActiveXDelivery({ status: "posted", claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "failed", claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "skipped", claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "running", claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: undefined, claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: null, claim_release_reason: null }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "", claim_release_reason: null }), false);
});

Deno.test("shouldDeferActiveXDelivery lets the admin force-retry path recover a released pending row", () => {
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry" }), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry" }), false);
});

Deno.test("released pending deliveries respect due time in fallback and forced candidate paths", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry", next_retry_at: "2026-09-08T12:05:00Z" }, now), true);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry", next_retry_at: "2026-09-08T12:00:00Z" }, now), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry", next_retry_at: "2026-09-08T11:59:00Z" }, now), false);
  assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry", next_retry_at: "malformed" }, now), true);
});

Deno.test("released pending rows with remaining claim or provider evidence stay blocked", () => {
  for (const evidence of [{ claim_token: "active-token" }, { provider_started_at: "2026-09-08T12:00:00Z" }, { x_tweet_id: "published-id" }]) {
    assertEquals(shouldDeferActiveXDelivery({ status: "pending", claim_release_reason: "pre_provider_retry", ...evidence }), true);
  }
});
