import { assertEquals } from "jsr:@std/assert";
import {
  extractHandleFromUrl,
  extractNumericTweetId,
  formatMessageWithTemplate,
  stripMarkdownToPlain,
} from "./tweetNormalizers.ts";

Deno.test("formatMessageWithTemplate replaces supported placeholders", () => {
  const text = formatMessageWithTemplate(
    {
      text_original: "original",
      text_translated: "translated",
      url: "https://x.com/a/status/123",
      tweeted_at: "2026-01-01T12:34:00.000Z",
      has_media: true,
    },
    { handle: "source", display_name: "Source Name" },
    {
      template:
        "{translated_text}|{original_text}|{author_handle}|{author_name}|{source_link}|{hashtags}|{media_info}",
      include_source_link: true,
      source_link_text: "View",
      custom_hashtags: "#tag",
    },
  );

  assertEquals(
    text,
    "translated|original|source|Source Name|[View](https://x.com/a/status/123)|#tag|📸 تصویر",
  );
});

Deno.test("stripMarkdownToPlain removes markdown punctuation", () => {
  assertEquals(stripMarkdownToPlain("*hi* [x](y)!"), "hi x y");
  assertEquals(stripMarkdownToPlain(""), "");
});

Deno.test("extractNumericTweetId parses raw ids and tweet URLs", () => {
  assertEquals(
    extractNumericTweetId(
      "guid",
      "https://x.com/source/status/1234567890123456789",
    ),
    "1234567890123456789",
  );
  assertEquals(
    extractNumericTweetId("abc 123456789012345678 xyz"),
    "123456789012345678",
  );
  assertEquals(extractNumericTweetId("guid", "not a url"), null);
});

Deno.test("extractHandleFromUrl accepts Twitter/X profiles and status URLs", () => {
  assertEquals(extractHandleFromUrl("https://twitter.com/source/status/123"), "source");
  assertEquals(extractHandleFromUrl("https://x.com/source/status/123"), "source");
  assertEquals(extractHandleFromUrl("https://x.com/source"), "source");
  assertEquals(extractHandleFromUrl("https://x.com/home"), null);
  assertEquals(extractHandleFromUrl("https://example.com/source/status/123"), null);
  assertEquals(extractHandleFromUrl("not a url"), null);
});
