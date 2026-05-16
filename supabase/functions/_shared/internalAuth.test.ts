import { assertEquals } from "jsr:@std/assert";
import {
  allowRssQueryToken,
  parseRssQueryTokenAllowance,
  readRssWebhookToken,
} from "./internalAuth.ts";

Deno.test("readRssWebhookToken prefers header tokens", () => {
  const req = new Request("https://example.test/hook?token=query-token", {
    headers: { "x-webhook-token": "header-token" },
  });

  assertEquals(readRssWebhookToken(req), {
    provided: "header-token",
    fromQuery: false,
  });
});

Deno.test("readRssWebhookToken accepts RSS.app query token compatibility", () => {
  const req = new Request("https://example.test/hook?token=query-token");

  assertEquals(readRssWebhookToken(req), {
    provided: "query-token",
    fromQuery: true,
  });
});

Deno.test("readRssWebhookToken accepts alternate query token names", () => {
  const webhookReq = new Request("https://example.test/hook?webhook_token=webhook-query-token");
  const rssReq = new Request("https://example.test/hook?rssapp_token=rss-query-token");

  assertEquals(readRssWebhookToken(webhookReq), {
    provided: "webhook-query-token",
    fromQuery: true,
  });
  assertEquals(readRssWebhookToken(rssReq), {
    provided: "rss-query-token",
    fromQuery: true,
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
