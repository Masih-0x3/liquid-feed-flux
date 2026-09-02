import { assertEquals } from "jsr:@std/assert";
import { classifyXPosterResponse } from "./xPosterOutcome.ts";

Deno.test("classifies a matching posted result instead of trusting HTTP success", () => {
  assertEquals(
    classifyXPosterResponse({ ok: true, processed: 1, results: [{ tweet_id: "t1", status: "posted", x_tweet_id: "x1" }] }, "t1"),
    { status: "posted", reason: "posted", xTweetId: "x1" },
  );
});

Deno.test("classifies an empty targeted response as not_candidate", () => {
  assertEquals(
    classifyXPosterResponse({ ok: true, processed: 0, results: [] }, "t1"),
    { status: "not_candidate", reason: "x_poster_no_candidate", xTweetId: null },
  );
});

Deno.test("rejects a single result for a different target instead of recording a post", () => {
  assertEquals(
    classifyXPosterResponse({ ok: true, processed: 1, results: [{ tweet_id: "other", status: "posted", x_tweet_id: "x1" }] }, "t1"),
    { status: "failed", reason: "x_poster_target_mismatch", xTweetId: null },
  );
});

Deno.test("preserves skip and defer reasons", () => {
  assertEquals(
    classifyXPosterResponse({ ok: true, results: [{ tweet_id: "t1", status: "skipped", reason: "already_posted" }] }, "t1"),
    { status: "skipped", reason: "already_posted", xTweetId: null },
  );
  assertEquals(
    classifyXPosterResponse({ ok: true, results: [{ tweet_id: "t1", status: "deferred", reason: "waiting_hydration" }] }, "t1"),
    { status: "deferred", reason: "waiting_hydration", xTweetId: null },
  );
});

Deno.test("classifies a 200 locked body as skipped and malformed body as failed", () => {
  assertEquals(
    classifyXPosterResponse({ ok: false, status: "locked", reason: "external_posting_blocked" }, "t1"),
    { status: "skipped", reason: "external_posting_blocked", xTweetId: null },
  );
  assertEquals(
    classifyXPosterResponse("ok", "t1"),
    { status: "failed", reason: "x_poster_invalid_response", xTweetId: null },
  );
});
