import { assertEquals } from "jsr:@std/assert";
import {
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
    source: "header:x-webhook-token",
  });
});

Deno.test("readRssWebhookToken ignores query-only tokens", () => {
  const req = new Request("https://example.test/hook?token=query-token");

  assertEquals(readRssWebhookToken(req), {
    provided: "",
    source: null,
  });
});

Deno.test("readRssWebhookToken ignores alternate query token names", () => {
  const webhookReq = new Request(
    "https://example.test/hook?webhook_token=webhook-query-token",
  );
  const rssReq = new Request(
    "https://example.test/hook?rssapp_token=rss-query-token",
  );

  assertEquals(readRssWebhookToken(webhookReq), {
    provided: "",
    source: null,
  });
  assertEquals(readRssWebhookToken(rssReq), {
    provided: "",
    source: null,
  });
});

Deno.test("requireRssWebhookAuth rejects query-only tokens", async () => {
  const supabase = {
    from() {
      throw new Error("query-only requests should not write telemetry");
    },
    rpc() {
      throw new Error("query-only requests should not check vault auth");
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

  assertEquals(result?.status, 401);
});

Deno.test("requireRssWebhookAuth accepts header token through vault fallback", async () => {
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, "verify_webhook_internal_token");
      assertEquals(args, { p_token: "header-token" });
      return Promise.resolve({ data: true, error: null });
    },
  };

  const result = await requireRssWebhookAuth(
    new Request("https://example.test/functions/v1/webhooks-rssapp", {
      method: "POST",
      headers: { "x-rssapp-token": "header-token" },
    }),
    supabase,
    {},
  );

  assertEquals(result, null);
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
      "https://example.test/functions/v1/webhooks-rssapp",
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
      "https://example.test/functions/v1/webhooks-rssapp",
      {
        method: "POST",
        headers: {
          "RSSApp-Signature": `t=${timestamp},v1=${"0".repeat(64)}`,
          "x-webhook-token": "header-token",
        },
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
