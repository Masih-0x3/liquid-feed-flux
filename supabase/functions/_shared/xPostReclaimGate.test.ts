import { assertEquals } from "jsr:@std/assert";
import { shouldDeferActiveXDelivery } from "./xPostReclaimGate.ts";

Deno.test("shouldDeferActiveXDelivery defers an active posting row regardless of release reason", () => {
  assertEquals(shouldDeferActiveXDelivery("posting", null), true);
  assertEquals(shouldDeferActiveXDelivery("posting", undefined), true);
  assertEquals(shouldDeferActiveXDelivery("posting", "pre_provider_retry"), true);
  assertEquals(shouldDeferActiveXDelivery("posting", "failed"), true);
  assertEquals(shouldDeferActiveXDelivery("posting", ""), true);
});

Deno.test("shouldDeferActiveXDelivery does not defer a pre-provider-released pending row (reclaim path)", () => {
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry"), false);
});

Deno.test("shouldDeferActiveXDelivery still defers a pending row that is not a pre-provider release", () => {
  assertEquals(shouldDeferActiveXDelivery("pending", null), true);
  assertEquals(shouldDeferActiveXDelivery("pending", undefined), true);
  assertEquals(shouldDeferActiveXDelivery("pending", ""), true);
  assertEquals(shouldDeferActiveXDelivery("pending", "failed"), true);
  assertEquals(shouldDeferActiveXDelivery("pending", "stale_posting"), true);
  assertEquals(shouldDeferActiveXDelivery("pending", "claim_release_failed"), true);
});

Deno.test("shouldDeferActiveXDelivery never defers a terminal or absent status", () => {
  assertEquals(shouldDeferActiveXDelivery("posted", null), false);
  assertEquals(shouldDeferActiveXDelivery("failed", null), false);
  assertEquals(shouldDeferActiveXDelivery("skipped", null), false);
  assertEquals(shouldDeferActiveXDelivery("running", null), false);
  assertEquals(shouldDeferActiveXDelivery(undefined, null), false);
  assertEquals(shouldDeferActiveXDelivery(null, null), false);
  assertEquals(shouldDeferActiveXDelivery("", null), false);
});

Deno.test("shouldDeferActiveXDelivery lets the admin force-retry path recover a released pending row", () => {
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry"), false);
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry"), false);
});

Deno.test("released pending deliveries respect due time in fallback and forced candidate paths", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry", "2026-09-08T12:05:00Z", now), true);
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry", "2026-09-08T12:00:00Z", now), false);
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry", "2026-09-08T11:59:00Z", now), false);
  assertEquals(shouldDeferActiveXDelivery("pending", "pre_provider_retry", "malformed", now), true);
});
