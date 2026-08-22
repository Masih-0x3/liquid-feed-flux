import { assertEquals } from "jsr:@std/assert";
import {
  readRssWebhookAuthMode,
  readRssWebhookToken,
  requireInternalAuth,
  requireRssWebhookAuth,
  verifyRssAppWebhookSignature,
} from "./internalAuth.ts";
import {
  readBoundedRssWebhookBody,
} from "./rssWebhookPayloadPolicy.ts";

async function signRssAppPayload(
  secret: string,
  timestamp: number,
  rawBody: string | Uint8Array,
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
    typeof rawBody === "string"
      ? encoder.encode(`${timestamp}.${rawBody}`)
      : new Uint8Array([
        ...encoder.encode(`${timestamp}.`),
        ...rawBody,
      ]),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.test("requireInternalAuth is local, fail-closed, and accepts only reviewed credentials", async () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "https://xot.example" };
  const options = {
    sharedSecret: "shared-secret",
    serviceRoleKey: "service-role-secret",
  };

  const sharedSecretResult = await requireInternalAuth(
    new Request("https://example.test/functions/v1/worker", {
      headers: { "x-internal-token": "shared-secret" },
    }),
    corsHeaders,
    options,
  );
  assertEquals(sharedSecretResult, null);

  const bearerResult = await requireInternalAuth(
    new Request("https://example.test/functions/v1/worker", {
      headers: { Authorization: "Bearer service-role-secret" },
    }),
    corsHeaders,
    options,
  );
  assertEquals(bearerResult, null);

  const missingResult = await requireInternalAuth(
    new Request("https://example.test/functions/v1/worker"),
    corsHeaders,
    options,
  );
  assertEquals(missingResult?.status, 401);

  const wrongSchemeResult = await requireInternalAuth(
    new Request("https://example.test/functions/v1/worker", {
      headers: { Authorization: "Basic service-role-secret" },
    }),
    corsHeaders,
    options,
  );
  assertEquals(wrongSchemeResult?.status, 401);
});

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

Deno.test("requireRssWebhookAuth does not fall back to the shared Vault token verifier", async () => {
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      throw new Error(`RSS auth must not call ${name} with ${JSON.stringify(args)}`);
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

  assertEquals(result?.status, 401);
});

Deno.test("readRssWebhookAuthMode rejects malformed configured signatures before body buffering", () => {
  const result = readRssWebhookAuthMode(
    new Request("https://example.test/functions/v1/webhooks-rssapp", {
      method: "POST",
      headers: { "RSSApp-Signature": "not-a-valid-signature" },
    }),
    { signingSecret: "signing-secret" },
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

Deno.test("verifyRssAppWebhookSignature preserves an exact UTF-8 BOM body for HMAC", async () => {
  const rawText = JSON.stringify({ id: "evt_bom", data: { items_new: [] } });
  const rawBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(rawText)]);
  const bounded = await readBoundedRssWebhookBody(
    new Request("https://example.test/functions/v1/webhooks-rssapp", {
      method: "POST",
      body: rawBytes,
    }),
  );
  const timestamp = 1716220800;
  const signature = await signRssAppPayload("signing-secret", timestamp, bounded.bytes);

  const result = await verifyRssAppWebhookSignature({
    rawBody: bounded.text,
    rawBodyBytes: bounded.bytes,
    header: `t=${timestamp},v1=${signature}`,
    signingSecret: "signing-secret",
    nowMs: () => timestamp * 1000,
  });

  assertEquals(bounded.text, rawText);
  assertEquals(result, true);
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
