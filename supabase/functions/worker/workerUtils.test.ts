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
  laneCapacityFor,
  maxBatchSizeForJobTypes,
  normalizeStep,
  parseRetryAfterFromMessage,
  rmPickBestVariant,
  rmUpgradeImageUrl,
  runJobsWithLaneCapacity,
  stripMarkdownToPlain,
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

Deno.test("lane execution caps are independent from the fetch batch and preserve settled outcomes", async () => {
  assertEquals(laneCapacityFor("fast"), 4);
  assertEquals(laneCapacityFor("model"), 2);
  assertEquals(laneCapacityFor("delivery"), 2);
  assertEquals(maxBatchSizeForJobTypes(["dedupe"]), 40);

  let resolveRelease = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  const jobs = [
    { id: "fast-1", type: "dedupe" },
    { id: "fast-2", type: "resolve_media" },
    { id: "model-1", type: "translate" },
    { id: "delivery-1", type: "deliver" },
  ];
  let executing = 0;
  let peakExecuting = 0;
  const started: string[] = [];
  const snapshots: Record<string, Record<string, unknown>> = {};
  const settledPromise = runJobsWithLaneCapacity(jobs, async (job, metrics) => {
    executing += 1;
    peakExecuting = Math.max(peakExecuting, executing);
    started.push(job.id);
    snapshots[job.id] = { ...metrics };
    await releasePromise;
    executing -= 1;
    if (job.id === "fast-2") throw new Error("fast_failed");
    return job.id;
  });

  await Promise.resolve();
  await Promise.resolve();
  assertEquals(peakExecuting, 4);
  assertEquals(started, ["fast-1", "fast-2", "model-1", "delivery-1"]);
  assertEquals(snapshots["fast-1"].lane_capacity, 4);
  assertEquals(snapshots["fast-2"].lane_saturated, false);
  assertEquals(snapshots["model-1"].lane, "model");
  assertEquals(snapshots["delivery-1"].lane_selected, 1);
  resolveRelease();
  const settled = await settledPromise;
  assertEquals(settled.map((result) => result.status), [
    "fulfilled",
    "rejected",
    "fulfilled",
    "fulfilled",
  ]);
});

Deno.test("lane scheduler remains FIFO and independent under deferred contention", async () => {
  type TestJob = { id: string; type: string };
  const jobs: TestJob[] = [
    ...Array.from({ length: 10 }, (_, index) => ({ id: `fast-${index}`, type: "dedupe" })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `model-${index}`, type: "translate" })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `delivery-${index}`, type: "deliver" })),
  ];
  const gates = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  for (const job of jobs) {
    let resolve = () => {};
    const promise = new Promise<void>((done) => { resolve = done; });
    gates.set(job.id, { resolve, promise });
  }
  const active = { fast: 0, model: 0, delivery: 0 };
  const peak = { fast: 0, model: 0, delivery: 0 };
  const started = { fast: [] as string[], model: [] as string[], delivery: [] as string[] };
  const resultPromise = runJobsWithLaneCapacity(jobs, async (job, metrics) => {
    active[metrics.lane] += 1;
    peak[metrics.lane] = Math.max(peak[metrics.lane], active[metrics.lane]);
    started[metrics.lane].push(job.id);
    await gates.get(job.id)!.promise;
    active[metrics.lane] -= 1;
    if (job.id === "model-2") throw new Error("model_rejection");
    return job.id;
  });
  const flush = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  await flush();
  assertEquals(peak, { fast: 4, model: 2, delivery: 2 });
  assertEquals(started.fast, ["fast-0", "fast-1", "fast-2", "fast-3"]);
  assertEquals(started.model, ["model-0", "model-1"]);
  assertEquals(started.delivery, ["delivery-0", "delivery-1"]);
  assertEquals(maxBatchSizeForJobTypes(["dedupe"]), 40);
  assertEquals(jobs.length, 22);

  gates.get("model-0")!.resolve();
  gates.get("model-1")!.resolve();
  await flush();
  assertEquals(started.model.slice(0, 4), ["model-0", "model-1", "model-2", "model-3"]);
  assertEquals(started.fast.length, 4);
  assertEquals(started.delivery.length, 2);

  for (const gate of gates.values()) gate.resolve();
  const settled = await resultPromise;
  assertEquals(settled.length, 22);
  assertEquals(settled.filter((result) => result.status === "rejected").length, 1);
  assertEquals(settled[12].status, "rejected");
  assertEquals(started.fast, jobs.slice(0, 10).map((job) => job.id));
  assertEquals(started.model, jobs.slice(10, 16).map((job) => job.id));
  assertEquals(started.delivery, jobs.slice(16).map((job) => job.id));
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
  assertEquals(meta.retry_count, 1);

  const invalidTiming = jobTimingMeta(
    {
      id: "job2",
      type: "translate",
      attempts: 1,
      priority: 10,
      created_at: "bad",
      next_run_at: "also-bad",
      locked_at: "still-bad",
    },
    "completed",
    {},
    Date.parse("2026-01-01T00:00:30.000Z"),
  );

  assertEquals(invalidTiming.queue_wait_ms, null);
  assertEquals(invalidTiming.claim_delay_ms, null);
  assertEquals(invalidTiming.worker_run_ms, null);

  const boundedTiming = jobTimingMeta(
    {
      id: "job3",
      type: "fast-unknown",
      attempts: 999_999,
      created_at: "2020-01-01T00:00:00.000Z",
      locked_at: "2020-01-01T00:00:00.000Z",
    },
    "failed",
    { lane_capacity: 4, lane_selected: 40, lane_executing: 4, lane_saturated: true },
    Date.parse("2030-01-01T00:00:00.000Z"),
  );
  assertEquals(boundedTiming.attempts, 100_000);
  assertEquals(boundedTiming.retry_count, 99_999);
  assertEquals(boundedTiming.lane_capacity, 4);
  assertEquals(boundedTiming.lane_saturated, true);
  assertEquals(boundedTiming.worker_run_ms, 30 * 24 * 60 * 60 * 1000);
});

Deno.test("pipeline and telegram parsing helpers normalize edge cases", () => {
  assertEquals(isRecordValue({ a: 1 }), true);
  assertEquals(isRecordValue([]), false);
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
    extractNumericTweetId(
      "guid",
      "https://twitter.com/source/status/2234567890123456789",
    ),
    "2234567890123456789",
  );
  assertEquals(
    extractNumericTweetId("abc 123456789012345678 xyz"),
    "123456789012345678",
  );
  assertEquals(extractNumericTweetId("guid", "not a url"), null);
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
  assertEquals(extractHandleFromUrl("https://x.com/source"), "source");
  assertEquals(extractHandleFromUrl("https://x.com/home"), null);
  assert(
    extractHandleFromUrl("https://example.com/source/status/123") === null,
  );
});
