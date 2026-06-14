import { assert, assertEquals } from "jsr:@std/assert";
import {
  extractHandleFromUrl,
  extractMediaFromText,
  extractNumericTweetId,
  extractTelegramRetryAfter,
  finiteMediaNumber,
  formatMessageWithTemplate,
  hashUrl,
  isRecordValue,
  isTelegramParseError,
  jobError,
  jobLane,
  jobTimingMeta,
  maxBatchSizeForJobTypes,
  normalizeStep,
  parseRetryAfterFromMessage,
  rmPickBestVariant,
  rmUpgradeImageUrl,
  stripMarkdownToPlain,
  timestampMs,
  videoUploadFilename,
} from "./workerUtils.ts";

Deno.test("worker lane helpers keep fast batch expansion isolated to fast jobs", () => {
  assertEquals(jobLane("dedupe"), "fast");
  assertEquals(jobLane("translate"), "model");
  assertEquals(jobLane("deliver"), "delivery");
  assertEquals(maxBatchSizeForJobTypes(["dedupe", "resolve_media"]), 40);
  assertEquals(maxBatchSizeForJobTypes(["dedupe", "translate"]), 20);
  assertEquals(maxBatchSizeForJobTypes(null), 20);
});

Deno.test("hashUrl is deterministic sha256 hex", async () => {
  const hash = await hashUrl("https://example.com/a");

  assertEquals(hash.length, 64);
  assertEquals(hash, await hashUrl("https://example.com/a"));
});

Deno.test("jobError normalizes common thrown values", () => {
  const existing = new Error("kept");

  assertEquals(jobError(existing), existing);
  assertEquals(jobError("  message  ").message, "message");
  assertEquals(jobError({ code: "x" }).message, '{"code":"x"}');
  assertEquals(jobError(null).message, "null");
  assertEquals(jobError(undefined).message, "unknown_error");
});

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
        "{translated_text}|{author_handle}|{author_name}|{source_link}|{hashtags}|{media_info}",
      include_source_link: true,
      source_link_text: "View",
      custom_hashtags: "#tag",
    },
  );

  assertEquals(
    text,
    "translated|source|Source Name|[View](https://x.com/a/status/123)|#tag|📸 تصویر",
  );
});

Deno.test("media and video filename helpers preserve worker behavior", () => {
  assertEquals(
    extractMediaFromText(
      "a https://pbs.twimg.com/media/a.jpg b https://pbs.twimg.com/ext_tw_video/x.mp4",
    ),
    [
      { type: "image", url: "https://pbs.twimg.com/media/a.jpg" },
      { type: "video", url: "https://pbs.twimg.com/ext_tw_video/x.mp4" },
    ],
  );
  assertEquals(finiteMediaNumber(12), 12);
  assertEquals(finiteMediaNumber(Number.NaN), null);
  assertEquals(
    videoUploadFilename({}, "folder/source.mov", "video/mp4"),
    "source.mov",
  );
  assertEquals(
    videoUploadFilename({ id: "v1" }, "folder/source", "video/webm"),
    "source.webm",
  );
});

Deno.test("job timing metadata computes queue, claim, and run durations", () => {
  const meta = jobTimingMeta(
    {
      id: "job1",
      type: "deliver",
      attempts: 2,
      priority: 20,
      created_at: "2026-01-01T00:00:00.000Z",
      next_run_at: "2026-01-01T00:00:05.000Z",
      locked_at: "2026-01-01T00:00:10.000Z",
    },
    "failed",
    { error: "Too Many Requests: retry after 7" },
    Date.parse("2026-01-01T00:00:30.000Z"),
  );

  assertEquals(meta.queue_wait_ms, 10_000);
  assertEquals(meta.claim_delay_ms, 5_000);
  assertEquals(meta.worker_run_ms, 20_000);
  assertEquals(meta.retry_after_seconds, 7);
  assertEquals(meta.lane, "delivery");
});

Deno.test("pipeline and telegram parsing helpers normalize edge cases", () => {
  assertEquals(isRecordValue({ a: 1 }), true);
  assertEquals(isRecordValue([]), false);
  assertEquals(timestampMs("bad"), null);
  assertEquals(normalizeStep("download_media"), "media");
  assertEquals(normalizeStep("custom"), "custom");
  assertEquals(parseRetryAfterFromMessage("retry after 42"), 42);
  assertEquals(
    extractTelegramRetryAfter({ parameters: { retry_after: 3.9 } }, "", 429),
    3,
  );
  assertEquals(isTelegramParseError("can't parse entities"), true);
  assertEquals(stripMarkdownToPlain("*hi* [x](y)!"), "hi x y");
});

Deno.test("tweet id and media resolver helpers parse known URL shapes", () => {
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
  assertEquals(
    rmUpgradeImageUrl(
      "https://pbs.twimg.com/media/a.jpg?format=jpg&name=small",
    ),
    "https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig",
  );
  assertEquals(rmUpgradeImageUrl("not a url"), "not a url");
  assertEquals(
    rmPickBestVariant([
      { url: "https://x/video-low.mp4", bitrate: 100 },
      { url: "https://x/video-high.mp4", bitrate: 800 },
    ]),
    { url: "https://x/video-high.mp4", bitrate: 800 },
  );
  assertEquals(
    extractHandleFromUrl("https://twitter.com/source/status/123"),
    "source",
  );
  assert(
    extractHandleFromUrl("https://example.com/source/status/123") === null,
  );
});
