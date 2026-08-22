import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert";
import { classifyAdminRetryAction } from "./adminRetryPolicy.ts";

Deno.test("admin-retry validates action before any dispatch branch", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const policy = await Deno.readTextFile(new URL("./adminRetryPolicy.ts", import.meta.url));
  const validation = source.indexOf("if (!isAdminRetryAction(action))");
  const resend = source.indexOf("if (action === 'resend_delivery')");
  const retryFailed = source.indexOf("if (action === 'retry_failed_deliveries')");
  const legacy = source.indexOf("if (!delivery_id)");
  assert(validation >= 0);
  assert(resend > validation);
  assert(retryFailed > validation);
  assert(legacy > validation);
  assertStringIncludes(source, "const invalid = adminRetryActionError(action);");
  assertStringIncludes(policy, "admin_retry_action_missing");
  assertStringIncludes(policy, "admin_retry_action_unknown");
  assertEquals(classifyAdminRetryAction("test_webhook"), "inbound_rss_ingest");
  const webhookStart = source.indexOf("if (action === ADMIN_RETRY_INBOUND_INGEST_ACTION");
  const webhookEnd = source.indexOf("// Original retry logic", webhookStart);
  const webhookBranch = source.slice(webhookStart, webhookEnd);
  assertStringIncludes(webhookBranch, "webhooks-rssapp");
  assertFalse(webhookBranch.includes("api.telegram.org"));
  assertFalse(webhookBranch.includes("api.x.com"));
  assertStringIncludes(source, "requireRetryPostingGuard");
});
