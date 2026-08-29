import { assertEquals } from "jsr:@std/assert";
import {
  ADMIN_RETRY_INBOUND_INGEST_ACTION,
  adminRetryActionError,
  classifyAdminRetryAction,
  isAdminRetryAction,
  isRetryableFailedTelegramDelivery,
} from "./adminRetryPolicy.ts";

Deno.test("admin-retry accepts only explicit actions", () => {
  assertEquals(isAdminRetryAction("retry_delivery"), true);
  assertEquals(isAdminRetryAction("resend_delivery"), true);
  assertEquals(isAdminRetryAction("retry_failed_deliveries"), true);
  assertEquals(isAdminRetryAction("test_template"), true);
  assertEquals(isAdminRetryAction("test_webhook"), true);
  assertEquals(isAdminRetryAction(undefined), false);
  assertEquals(isAdminRetryAction(""), false);
  assertEquals(isAdminRetryAction("retry"), false);
  assertEquals(isAdminRetryAction("__proto__"), false);
});

Deno.test("admin-retry gives stable missing and unknown action errors", () => {
  assertEquals(adminRetryActionError(undefined), {
    status: 400,
    body: { success: false, error: "action is required", code: "admin_retry_action_missing" },
  });
  assertEquals(adminRetryActionError("unknown"), {
    status: 400,
    body: { success: false, error: "unknown admin-retry action", code: "admin_retry_action_unknown" },
  });
});

Deno.test("test_webhook is classified as inbound RSS ingest, not provider posting", () => {
  assertEquals(ADMIN_RETRY_INBOUND_INGEST_ACTION, "test_webhook");
  assertEquals(classifyAdminRetryAction("test_webhook"), "inbound_rss_ingest");
  assertEquals(classifyAdminRetryAction("test_template"), "telegram_provider_write");
  assertEquals(classifyAdminRetryAction("retry_x" as never), "external_delivery_retry");
});

Deno.test("admin retry excludes ambiguous and provider-started failed deliveries", () => {
  const fixture = [
    { id: "safe", claim_state: "failed", provider_started_at: null },
    { id: "legacy", claim_state: null, provider_started_at: null },
    { id: "ambiguous", claim_state: "ambiguous", provider_started_at: null },
    { id: "provider-started", claim_state: "failed", provider_started_at: "2026-08-29T00:00:00Z" },
  ];

  assertEquals(
    fixture.filter(isRetryableFailedTelegramDelivery).map((delivery) => delivery.id),
    ["safe", "legacy"],
  );
});
