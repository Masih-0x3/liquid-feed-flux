import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildThreadTweets,
  clampHeaderFormat,
  HEADER_FORMAT_MAX,
  TWEET_MAX,
  TWEET_SOFT_TRIGGER,
} from "./digestThreadTweets.ts";

function assertAllWithinLimit(tweets: string[]): void {
  for (const tweet of tweets) {
    assert(
      tweet.length <= TWEET_MAX,
      `tweet over ${TWEET_MAX} chars: ${tweet.length}\n${tweet}`,
    );
  }
}

Deno.test("buildThreadTweets returns [] for an empty summary", () => {
  assertEquals(buildThreadTweets("", "News Digest - 14:30"), []);
  assertEquals(buildThreadTweets("\n  \n\t", "News Digest - 14:30"), []);
});

Deno.test("buildThreadTweets emits the header as the first tweet prefix", () => {
  const tweets = buildThreadTweets("Short bullet.", "News Digest - 14:30");
  assertEquals(tweets.length, 1);
  assertEquals(tweets[0], "News Digest - 14:30\n\nShort bullet.");
  assertAllWithinLimit(tweets);
});

Deno.test("buildThreadTweets packs multiple short bullets into one tweet under the soft trigger", () => {
  const bullet = "Item number one."; // 16 chars
  const lines = Array.from({ length: 10 }, () => bullet).join("\n");
  const tweets = buildThreadTweets(lines, "News Digest - 14:30");
  assertEquals(tweets.length, 1);
  assert(tweets[0].startsWith("News Digest - 14:30\n\n"));
  assertEquals(tweets[0].split("Item number one.").length - 1, 10);
  assertAllWithinLimit(tweets);
});

Deno.test("buildThreadTweets starts a new tweet when the soft trigger is exceeded", () => {
  const bullet = "x".repeat(120);
  const lines = `${bullet}\n${bullet}\n${bullet}`;
  const tweets = buildThreadTweets(lines, "News Digest - 14:30");
  assertEquals(tweets.length, 2);
  assertEquals(tweets[0], `News Digest - 14:30\n\n${bullet}\n${bullet}`);
  assertEquals(tweets[1], bullet);
  assertAllWithinLimit(tweets);
});

Deno.test("buildThreadTweets never exceeds the 280-char limit for a single long bullet (the original bug)", () => {
  const longBullet = "y".repeat(300);
  const tweets = buildThreadTweets(longBullet, "News Digest - 14:30");
  assertAllWithinLimit(tweets);
  assertEquals(tweets[0], "News Digest - 14:30");
  assertEquals(tweets.length, 3);
  assertEquals(tweets[1].length, 280);
  assertEquals(tweets[2].length, 20);
  // Content is preserved (split, not truncated).
  assertEquals(tweets[1] + tweets[2], longBullet);
});

Deno.test("buildThreadTweets handles a bullet just over the soft trigger but under the hard cap", () => {
  const bullet = "z".repeat(271); // 271 chars: > 270 soft, <= 280 hard
  const tweets = buildThreadTweets(bullet, "News Digest - 14:30");
  assertAllWithinLimit(tweets);
  assertEquals(tweets.length, 2);
  assertEquals(tweets[0], "News Digest - 14:30");
  assertEquals(tweets[1].length, 271);
  assertEquals(tweets[1], bullet);
});

Deno.test("buildThreadTweets handles a bullet exactly 280 chars in a single tweet", () => {
  const bullet = "w".repeat(280);
  const tweets = buildThreadTweets(bullet, "News Digest - 14:30");
  assertAllWithinLimit(tweets);
  assertEquals(tweets[0], "News Digest - 14:30");
  assertEquals(tweets.length, 2);
  assertEquals(tweets[1], bullet);
});

Deno.test("buildThreadTweets splits a bullet exactly 281 chars across two tweets", () => {
  const bullet = "v".repeat(281);
  const tweets = buildThreadTweets(bullet, "News Digest - 14:30");
  assertAllWithinLimit(tweets);
  assertEquals(tweets[0], "News Digest - 14:30");
  assertEquals(tweets.length, 3);
  assertEquals(tweets[1].length, 280);
  assertEquals(tweets[2].length, 1);
  assertEquals(tweets[1] + tweets[2], bullet);
});

Deno.test("buildThreadTweets keeps a long header-only first tweet within the cap", () => {
  const longHeader = "H".repeat(TWEET_MAX);
  const tweets = buildThreadTweets("short bullet", longHeader);
  assertAllWithinLimit(tweets);
  assertEquals(tweets[0], longHeader);
  assertEquals(tweets[1], "short bullet");
});

Deno.test("buildThreadTweets guarantees no tweet exceeds 280 and emits no empty tweets for many long inputs", () => {
  // Headers and bullets of many lengths around the 270/280 boundaries,
  // including headers longer than TWEET_MAX (defensive: even an unclamped
  // header cannot break the invariant) and bullets far longer than TWEET_MAX.
  for (let headerLen = 0; headerLen <= TWEET_MAX + 50; headerLen += 7) {
    const header = "H".repeat(headerLen);
    for (let bulletLen = 1; bulletLen <= TWEET_MAX + 100; bulletLen += 13) {
      const summary = Array.from({ length: 4 }, () => "b".repeat(bulletLen)).join("\n");
      const tweets = buildThreadTweets(summary, header);
      assertAllWithinLimit(tweets);
      for (const t of tweets) assert(t.length > 0, "no empty tweets");
    }
  }
});

Deno.test("buildThreadTweets preserves all bullet content across the thread", () => {
  const lines = ["alpha", "beta", "gamma delta"];
  const tweets = buildThreadTweets(lines.join("\n"), "H");
  const joined = tweets.join("\n");
  for (const line of lines) {
    assert(joined.includes(line), `expected "${line}" preserved in thread`);
  }
  assertAllWithinLimit(tweets);
});

Deno.test("buildThreadTweets does not emit an empty first tweet when the header is empty", () => {
  const tweets = buildThreadTweets("one bullet", "");
  assertEquals(tweets, ["one bullet"]);
  assertAllWithinLimit(tweets);
});

Deno.test("clampHeaderFormat returns undefined for non-strings (fall back to default)", () => {
  assertEquals(clampHeaderFormat(undefined), undefined);
  assertEquals(clampHeaderFormat(null), undefined);
  assertEquals(clampHeaderFormat(42), undefined);
  assertEquals(clampHeaderFormat({ length: 0 }), undefined);
});

Deno.test("clampHeaderFormat returns the string unchanged when within the cap", () => {
  assertEquals(clampHeaderFormat("News Digest - {time}"), "News Digest - {time}");
  assertEquals(clampHeaderFormat(""), "");
  assertEquals(clampHeaderFormat("H".repeat(HEADER_FORMAT_MAX)), "H".repeat(HEADER_FORMAT_MAX));
});

Deno.test("clampHeaderFormat truncates strings longer than HEADER_FORMAT_MAX", () => {
  const long = "x".repeat(HEADER_FORMAT_MAX + 25);
  const clamped = clampHeaderFormat(long);
  assert(clamped !== undefined, "expected a clamped string");
  assertEquals(clamped.length, HEADER_FORMAT_MAX);
  assertEquals(clamped, long.slice(0, HEADER_FORMAT_MAX));
});

Deno.test("constants expose the intended X invariant and soft trigger", () => {
  assertEquals(TWEET_MAX, 280);
  assertEquals(TWEET_SOFT_TRIGGER, 270);
  assertEquals(HEADER_FORMAT_MAX, 280);
  assert(TWEET_SOFT_TRIGGER < TWEET_MAX, "soft trigger must leave hard-cap headroom");
  assert(HEADER_FORMAT_MAX <= TWEET_MAX, "header_format clamp must not exceed the X limit");
});
