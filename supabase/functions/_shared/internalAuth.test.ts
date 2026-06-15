import { assertEquals } from "jsr:@std/assert";
import {
  allowRssQueryToken,
  parseRssQueryTokenAllowance,
  readRssWebhookToken,
  requireRssWebhookAuth,
  verifyRssAppWebhookSignature,
} from "./internalAuth.ts";

async function signRssAppPayload(
  secret: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.test("readRssWebhookToken prefers header tokens", () => {
  const req = new Request("https://example.test/hook?token=query-token", {
    headers: { "x-webhook-token": "header-token" },
  });

  assertEquals(readRssWebhookToken(req), {
    provided: "header-token",
    fromQuery: false,
    source: "header:x-webhook-token",
  });
});

Deno.test("readRssWebhookToken accepts RSS.app query token compatibility", () => {
  const req = new Request("https://example.test/hook?token=query-token");

  assertEquals(readRssWebhookToken(req), {
    provided: "query-token",
    fromQuery: true,
    source: "query:token",
  });
});

Deno.test("readRssWebhookToken accepts alternate query token names", () => {
  const webhookReq = new Request(
    "https://example.test/hook?webhook_token=webhook-query-token",
  );
  const rssReq = new Request(
    "https://example.test/hook?rssapp_token=rss-query-token",
  );

  assertEquals(readRssWebhookToken(webhookReq), {
    provided: "webhook-query-token",
    fromQuery: true,
    source: "query:webhook_token",
  });
  assertEquals(readRssWebhookToken(rssReq), {
    provided: "rss-query-token",
    fromQuery: true,
    source: "query:rssapp_token",
  });
});

Deno.test("allowRssQueryToken defaults on for current RSS.app compatibility", () => {
  assertEquals(allowRssQueryToken(), true);
  assertEquals(parseRssQueryTokenAllowance(undefined), true);
});

Deno.test("parseRssQueryTokenAllowance can be disabled after signed webhook migration", () => {
  assertEquals(parseRssQueryTokenAllowance("false"), false);
  assertEquals(parseRssQueryTokenAllowance("0"), false);
  assertEquals(parseRssQueryTokenAllowance("off"), false);
  assertEquals(parseRssQueryTokenAllowance("true"), true);
});

Deno.test("requireRssWebhookAuth records accepted query token compatibility", async () => {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc() {
      return Promise.resolve({ data: true });
    },
  };

  const result = await requireRssWebhookAuth(
    new Request(
      "https://example.test/functions/v1/webhooks-rssapp?token=query-token",
      {
        method: "POST",
      },
    ),
    supabase,
    {},
  );

  assertEquals(result, null);
  assertEquals(calls, [{
    table: "compatibility_usage_events",
    row: {
      source: "webhooks-rssapp",
      feature: "rss_query_token",
      legacy_value: "query:token",
      canonical_value: "header:RSSApp-Signature",
      action: "require_rss_webhook_auth",
      actor_id: null,
      request_method: "POST",
      request_path: "/functions/v1/webhooks-rssapp",
      metadata: { token_source: "query:token", verifier: "vault" },
    },
  }]);
});

Deno.test("verifyRssAppWebhookSignature accepts RSS.app signed webhook format", async () => {
  const rawBody = JSON.stringify({ id: "evt_test", data: { items_new: [] } });
  const timestamp = 1716220800;
  const signature = await signRssAppPayload(
    "signing-secret",
    timestamp,
    rawBody,
  );

  const result = await verifyRssAppWebhookSignature({
    rawBody,
    header: `t=${timestamp},v1=${signature}`,
    signingSecret: "signing-secret",
    nowMs: () => timestamp * 1000,
  });

  assertEquals(result, true);
});

Deno.test("verifyRssAppWebhookSignature rejects stale RSS.app signatures", async () => {
  const rawBody = JSON.stringify({ id: "evt_test", data: { items_new: [] } });
  const timestamp = 1716220800;
  const signature = await signRssAppPayload(
    "signing-secret",
    timestamp,
    rawBody,
  );

  const result = await verifyRssAppWebhookSignature({
    rawBody,
    header: `t=${timestamp},v1=${signature}`,
    signingSecret: "signing-secret",
    nowMs: () => (timestamp + 301) * 1000,
  });

  assertEquals(result, false);
});

Deno.test("requireRssWebhookAuth accepts signed webhook without query-token telemetry", async () => {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc() {
      return Promise.resolve({ data: false });
    },
  };
  const rawBody = JSON.stringify({ id: "evt_signed", data: { items_new: [] } });
  const timestamp = 1716220800;
  const signature = await signRssAppPayload(
    "signing-secret",
    timestamp,
    rawBody,
  );

  const result = await requireRssWebhookAuth(
    new Request(
      "https://example.test/functions/v1/webhooks-rssapp?token=legacy-token",
      {
        method: "POST",
        headers: { "RSSApp-Signature": `t=${timestamp},v1=${signature}` },
        body: rawBody,
      },
    ),
    supabase,
    {},
    {
      signingSecret: "signing-secret",
      nowMs: () => timestamp * 1000,
    },
  );

  assertEquals(result, null);
  assertEquals(calls, []);
});

Deno.test("requireRssWebhookAuth rejects invalid RSS.app signatures", async () => {
  const supabase = {
    from() {
      throw new Error("telemetry should not run");
    },
    rpc() {
      throw new Error(
        "invalid signed request should not fall back to token auth",
      );
    },
  };
  const rawBody = JSON.stringify({ id: "evt_signed", data: { items_new: [] } });
  const timestamp = 1716220800;

  const result = await requireRssWebhookAuth(
    new Request(
      "https://example.test/functions/v1/webhooks-rssapp?token=legacy-token",
      {
        method: "POST",
        headers: { "RSSApp-Signature": `t=${timestamp},v1=${"0".repeat(64)}` },
        body: rawBody,
      },
    ),
    supabase,
    {},
    {
      signingSecret: "signing-secret",
      nowMs: () => timestamp * 1000,
    },
  );

  assertEquals(result?.status, 401);
});
