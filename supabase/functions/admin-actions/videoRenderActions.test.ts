import { assertEquals } from "jsr:@std/assert";
import {
  classifyVideoRendererHealth,
  latestTimestamp,
  normalizeVideoRenderIds,
  normalizeVideoRenderReviewState,
  normalizeVideoRenderStatuses,
  sanitizeVideoRenderFeedbackLabel,
  toVideoRenderClientMedia,
  toVideoRenderClientHeartbeat,
  toVideoRenderClientHealth,
  toVideoRenderClientQueueRow,
  toVideoRenderDetailClientRender,
  videoRenderActionLabel,
} from "./videoRenderActions.ts";

Deno.test("video render feedback labels are normalized to the supported set", () => {
  assertEquals(sanitizeVideoRenderFeedbackLabel(" Subtitle Timing "), "subtitle_timing");
  assertEquals(sanitizeVideoRenderFeedbackLabel("wrong decision"), "wrong_decision");
  assertEquals(sanitizeVideoRenderFeedbackLabel("not-supported"), "other");
  assertEquals(sanitizeVideoRenderFeedbackLabel(null), "other");
});

Deno.test("latestTimestamp returns the latest valid timestamp or epoch", () => {
  assertEquals(
    latestTimestamp("2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "bad"),
    "2026-01-03T00:00:00.000Z",
  );
  assertEquals(latestTimestamp(null, "", "bad"), "1970-01-01T00:00:00.000Z");
});

Deno.test("renderer health is classified from one server-observed heartbeat timestamp", () => {
  const observedAt = Date.parse("2026-07-22T20:00:00.000Z");
  const healthy = classifyVideoRendererHealth([{
    renderer_id: "renderer-a",
    status: "online",
    last_seen_at: "2026-07-22T19:59:30.000Z",
  }], observedAt);
  assertEquals(healthy.state, "healthy");
  assertEquals(healthy.age_ms, 30_000);
  assertEquals(healthy.server_observed_at, "2026-07-22T20:00:00.000Z");

  assertEquals(classifyVideoRendererHealth([{
    renderer_id: "renderer-a",
    status: "online",
    last_seen_at: "2026-07-22T19:58:30.000Z",
  }], observedAt).state, "stale");
  assertEquals(classifyVideoRendererHealth([{
    renderer_id: "renderer-a",
    status: "paused",
    last_seen_at: "2026-07-22T19:59:50.000Z",
  }], observedAt).state, "blocked");
  assertEquals(classifyVideoRendererHealth([{
    renderer_id: "renderer-a",
    status: "error",
    last_seen_at: "2026-07-22T19:59:50.000Z",
  }], observedAt).state, "unavailable");
  assertEquals(classifyVideoRendererHealth([], observedAt).state, "unavailable");
  assertEquals(classifyVideoRendererHealth([{
    renderer_id: "renderer-a",
    status: "online",
    last_seen_at: "not-a-timestamp",
  }], observedAt).state, "unknown");
});

Deno.test("video render action label prioritizes block, output, original, then status", () => {
  assertEquals(videoRenderActionLabel({ status: "blocked", output_storage_path: "x" }), "blocked");
  assertEquals(videoRenderActionLabel({ status: "completed", output_storage_path: "renders/a.mp4" }), "rendered");
  assertEquals(videoRenderActionLabel({ status: "completed", preflight: { processingMode: "original_unmodified" } }), "original-selected");
  assertEquals(videoRenderActionLabel({ status: "queued" }), "queued");
  assertEquals(videoRenderActionLabel({}), "unknown");
});

Deno.test("video render client payloads expose metadata only during media containment", () => {
  const rawRender = {
    id: "render-1",
    tweet_id: "tweet-1",
    source_media_id: "media-1",
    status: "completed",
    render_version: "v1",
    render_revision: 1,
    output_storage_path: "renders/private-output.mp4",
    output_file_size: 1200,
    metrics: {
      total_ms: 120,
      download_ms: 20,
      expired_storage_path: "renders/private-output.mp4",
    },
    preflight: {
      source_storage_path: "source/private-input.mp4",
    },
    error: "download source/private-input.mp4: unavailable",
    block_reason: "source/private-input.mp4 is blocked",
    updated_at: "2026-07-23T00:00:00.000Z",
  };
  const rawMedia = {
    id: "media-1",
    kind: "video",
    storage_path: "source/private-input.mp4",
    src_url: "https://provider.invalid/private-input.mp4",
    mime_type: "video/mp4",
    file_size: 1000,
  };
  const media = toVideoRenderClientMedia(rawMedia);
  const queue = toVideoRenderClientQueueRow(rawRender, null, rawMedia, null);
  const detail = toVideoRenderDetailClientRender(rawRender);

  assertEquals(media?.mime_type, "video/mp4");
  assertEquals("storage_path" in (media ?? {}), false);
  assertEquals("src_url" in (media ?? {}), false);
  assertEquals("output_storage_path" in queue, false);
  assertEquals("storage_path" in (queue.media ?? {}), false);
  assertEquals("src_url" in (queue.media ?? {}), false);
  assertEquals("output_storage_path" in detail, false);
  assertEquals("source_signed_url" in detail, false);
  assertEquals("output_signed_url" in detail, false);
  assertEquals(queue.metrics.total_ms, 120);
  assertEquals(queue.metrics.download_ms, 20);
  assertEquals("expired_storage_path" in queue.metrics, false);
  assertEquals("preflight" in queue, false);
  assertEquals("preflight" in detail, false);
  assertEquals(queue.error, "render_failed");
  assertEquals(queue.block_reason, "render_blocked");
  assertEquals(detail.error?.includes("private-input"), false);
  assertEquals(detail.block_reason?.includes("private-input"), false);
});

Deno.test("video renderer overview heartbeat client payloads expose operational metadata only", () => {
  const heartbeat = toVideoRenderClientHeartbeat({
    renderer_id: "renderer-a",
    status: "online",
    version: "v1",
    render_version: "render-v1",
    running: 1,
    processed: 2,
    failed: 0,
    last_seen_at: "2026-07-23T00:00:00.000Z",
    last_error: "download source/private-input.mp4: unavailable",
    metadata: { source_storage_path: "source/private-input.mp4" },
  });
  const health = toVideoRenderClientHealth({
    state: "unavailable",
    server_observed_at: "2026-07-23T00:00:10.000Z",
    last_seen_at: "2026-07-23T00:00:00.000Z",
    age_ms: 10_000,
    renderer_id: "renderer-a",
    reported_status: "error",
    last_error: "download source/private-input.mp4: unavailable",
  });

  assertEquals(heartbeat?.renderer_id, "renderer-a");
  assertEquals(heartbeat?.status, "online");
  assertEquals("last_error" in (heartbeat ?? {}), false);
  assertEquals("metadata" in (heartbeat ?? {}), false);
  assertEquals(health.reported_status, "error");
  assertEquals("last_error" in health, false);
});

Deno.test("video render status filter keeps only supported statuses and defaults empty input", () => {
  assertEquals(normalizeVideoRenderStatuses(undefined), ["queued", "running", "failed", "blocked", "completed"]);
  assertEquals(normalizeVideoRenderStatuses(["queued", "bad", "expired", "completed"]), ["queued", "expired", "completed"]);
  assertEquals(
    normalizeVideoRenderStatuses(["queued", "running", "completed", "failed", "blocked", "expired", "extra"]),
    ["queued", "running", "completed", "failed", "blocked", "expired"],
  );
});

Deno.test("video render review state defaults closed and only accepts explicit all", () => {
  assertEquals(normalizeVideoRenderReviewState(undefined), "unreviewed");
  assertEquals(normalizeVideoRenderReviewState("reviewed"), "unreviewed");
  assertEquals(normalizeVideoRenderReviewState("all"), "all");
});

Deno.test("video render review ids accept one or many unique UUIDs", () => {
  const first = "00bf8307-38db-41f9-8594-06435247b1c1";
  const second = "3b268a62-a906-4d84-9354-fb158f388667";
  assertEquals(normalizeVideoRenderIds({ render_id: ` ${first} ` }), [first]);
  assertEquals(normalizeVideoRenderIds({ render_ids: [first, second, first, "bad", null] }), [first, second]);
  assertEquals(normalizeVideoRenderIds({}), []);
});
