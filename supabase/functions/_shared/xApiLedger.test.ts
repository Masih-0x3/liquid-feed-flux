import { assertEquals } from "jsr:@std/assert";
import {
  classifyXBillableUnit,
  extractXRateLimitHeaders,
  summarizeEndpoint,
} from "./xApiLedger.ts";

Deno.test("extractXRateLimitHeaders parses X reset seconds", () => {
  const headers = new Headers({
    "x-rate-limit-limit": "300",
    "x-rate-limit-remaining": "299",
    "x-rate-limit-reset": "1760000000",
  });

  assertEquals(extractXRateLimitHeaders(headers), {
    rateLimitLimit: 300,
    rateLimitRemaining: 299,
    rateLimitResetAt: new Date(1760000000 * 1000).toISOString(),
  });
});

Deno.test("summarizeEndpoint removes query strings and hostnames", () => {
  assertEquals(summarizeEndpoint("https://api.x.com/2/tweets/123?tweet.fields=note_tweet"), "/2/tweets/123");
  assertEquals(summarizeEndpoint("/2/users/me?user.fields=username"), "/2/users/me");
});

Deno.test("classifyXBillableUnit distinguishes reads, writes, media, and usage lookup", () => {
  assertEquals(classifyXBillableUnit("https://api.x.com/2/tweets/123", "GET"), "post_read");
  assertEquals(classifyXBillableUnit("https://api.x.com/2/tweets", "POST"), "post_write");
  assertEquals(classifyXBillableUnit("https://upload.twitter.com/1.1/media/upload.json", "POST"), "media_upload");
  assertEquals(classifyXBillableUnit("https://api.x.com/2/usage/tweets", "GET"), "official_usage_lookup");
});
