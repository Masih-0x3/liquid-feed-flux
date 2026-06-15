import { assertEquals } from "jsr:@std/assert";
import {
  allowRssQueryToken,
  parseRssQueryTokenAllowance,
  readRssWebhookToken,
  requireRssWebhookAuth,
} from "./internalAuth.ts";

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
  const webhookReq = new Request("https://example.test/hook?webhook_token=webhook-query-token");
  const rssReq = new Request("https://example.test/hook?rssapp_token=rss-query-token");

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

Deno.test("parseRssQueryTokenAllowance can be disabled after header migration", () => {
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
    new Request("https://example.test/functions/v1/webhooks-rssapp?token=query-token", {
      method: "POST",
    }),
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
      canonical_value: "header:x-webhook-token",
      action: "require_rss_webhook_auth",
      actor_id: null,
      request_method: "POST",
      request_path: "/functions/v1/webhooks-rssapp",
      metadata: { token_source: "query:token", verifier: "vault" },
    },
  }]);
});
