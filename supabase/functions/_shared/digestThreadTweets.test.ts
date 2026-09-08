import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import twitterText from "npm:twitter-text@3.1.0";
import { buildThreadTweets } from "./digestThreadTweets.ts";

Deno.test("digest packing keeps short bullets and omits empty summaries", async () => {
  assertEquals(await buildThreadTweets("First\nSecond", "News"), ["News\n\nFirst\nSecond"]);
  assertEquals(await buildThreadTweets(" \n ", "News"), []);
});

for (const text of ["a".repeat(900), "界".repeat(300), "a".repeat(279) + "😀", "👨‍👩‍👧‍👦".repeat(150), "cafe\u0301".repeat(100)]) {
  Deno.test(`digest splits weighted content without loss (${text.slice(0, 12)})`, async () => {
    const tweets = await buildThreadTweets(text, "");
    assert(tweets.every((tweet) => twitterText.parseTweet(tweet).valid));
    assertEquals(tweets.join(""), text.normalize("NFC"));
    assert(tweets.every((tweet) => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(tweet)));
    if (text.startsWith("👨")) assert(tweets.every((tweet) => tweet.replaceAll("👨‍👩‍👧‍👦", "") === ""));
  });
}

Deno.test("digest retains long URLs as a single weighted entity", async () => {
  const url = "https://example.com/" + "path/".repeat(100);
  const tweets = await buildThreadTweets("a".repeat(270) + " " + url, "");
  assertEquals(tweets, ["a".repeat(270), url]);
  assertEquals(twitterText.parseTweet(tweets[1]).weightedLength, 23);
});

Deno.test("digest splits long headers instead of dropping text", async () => {
  const header = "界".repeat(290);
  const tweets = await buildThreadTweets("Summary", header);
  assert(tweets.every((tweet) => twitterText.parseTweet(tweet).valid));
  assertEquals(tweets.join("").replaceAll("\n", ""), header + "Summary");
});

Deno.test("digest rejects invalid text rather than persisting unpostable tweets", async () => {
  await assertRejects(() => buildThreadTweets("bad\uFFFFtext", ""), Error, "digest_tweet_invalid_text");
});
