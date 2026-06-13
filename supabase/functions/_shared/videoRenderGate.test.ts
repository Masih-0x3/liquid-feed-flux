import { assertEquals } from "jsr:@std/assert";
import {
  applyRenderedVideoPreference,
  decideVideoRenderGate,
  type VideoRenderRow,
} from "./videoRenderGate.ts";
import type { XMediaRow } from "./mediaSelection.ts";

const sourceVideo: XMediaRow = {
  id: "media-1",
  kind: "video",
  src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
  storage_path: "2026/6/source.mp4",
  downloaded_at: "2026-06-09T00:00:00Z",
  mime_type: "video/mp4",
  file_size: 10_000_000,
  duration_ms: 60_000,
};

function render(overrides: Partial<VideoRenderRow>): VideoRenderRow {
  return {
    id: "render-1",
    tweet_id: "tweet-1",
    source_media_id: "media-1",
    status: "queued",
    failure_policy: "post_original",
    output_storage_path: null,
    output_mime_type: null,
    output_file_size: null,
    duration_ms: null,
    width: null,
    height: null,
    render_version: "persian-subtitles-masihh-v1",
    error: null,
    ...overrides,
  };
}

Deno.test("video render gate does nothing for posts without video", () => {
  const decision = decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [{
      id: "image-1",
      kind: "image",
      storage_path: "2026/6/image.jpg",
      downloaded_at: "2026-06-09T00:00:00Z",
      mime_type: "image/jpeg",
      file_size: 1000,
    }],
    renderRows: [],
  });

  assertEquals(decision, { action: "none", reason: "no_video" });
});

Deno.test("video render gate enqueues when a downloaded source video has no render row", () => {
  const decision = decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [],
  });

  assertEquals(decision.action, "enqueue_render");
  if (decision.action !== "enqueue_render") throw new Error("expected enqueue_render");
  assertEquals(decision.media.id, "media-1");
  assertEquals(decision.reason, "no_render");
});

Deno.test("video render gate waits for queued or running renders", () => {
  for (const status of ["queued", "running"] as const) {
    const decision = decideVideoRenderGate({
      tweetId: "tweet-1",
      mediaRows: [sourceVideo],
      renderRows: [render({ status })],
    });

    assertEquals(decision.action, "wait_render");
    if (decision.action !== "wait_render") throw new Error("expected wait_render");
    assertEquals(decision.reason, "render_pending");
  }
});

Deno.test("video render gate prefers completed processed video", () => {
  const decision = decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [render({
      status: "completed",
      output_storage_path: "processed/2026/06/tweet-1/render-1.mp4",
      output_mime_type: "video/mp4",
      output_file_size: 12_000_000,
      duration_ms: 60_000,
    })],
  });

  assertEquals(decision.action, "use_render");
  const preferred = applyRenderedVideoPreference([sourceVideo], decision);
  assertEquals(preferred[0].storage_path, "processed/2026/06/tweet-1/render-1.mp4");
  assertEquals(preferred[0].file_size, 12_000_000);
  assertEquals(preferred[0].mime_type, "video/mp4");
});

Deno.test("video render gate uses original when renderer completed with no processing needed", () => {
  const decision = decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [render({
      status: "completed",
      output_storage_path: null,
      preflight: {
        processingMode: "original_unmodified",
        processingReasons: [],
        watermarkApplied: false,
      },
    })],
  });

  assertEquals(decision.action, "use_original");
  if (decision.action !== "use_original") throw new Error("expected use_original");
  assertEquals(decision.reason, "render_not_needed");
});

Deno.test("failed renders follow the configured failure policy", () => {
  assertEquals(decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [render({ status: "failed", failure_policy: "post_original", error: "boom" })],
  }).action, "use_original");

  assertEquals(decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [render({ status: "failed", failure_policy: "block", error: "boom" })],
  }).action, "block");
});

Deno.test("blocked renders block posting and never fall back to original", () => {
  const decision = decideVideoRenderGate({
    tweetId: "tweet-1",
    mediaRows: [sourceVideo],
    renderRows: [render({
      status: "blocked",
      failure_policy: "post_original",
      block_reason: "watermark_detected",
      error: null,
    })],
  });

  assertEquals(decision.action, "block");
  if (decision.action !== "block") throw new Error("expected block");
  assertEquals(decision.reason, "watermark_detected");
});
