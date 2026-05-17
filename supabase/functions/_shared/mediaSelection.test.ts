import { assertEquals } from "jsr:@std/assert";
import {
  filterSendableIngestMedia,
  hasVideoIntent,
  isLikelyVideoThumbnailUrl,
  selectMediaTier,
} from "./mediaSelection.ts";

Deno.test("video thumbnail RSS media is not sendable during ingest", () => {
  const media = [
    { type: "image", url: "https://pbs.twimg.com/tweet_video_thumb/abc.jpg" },
  ];

  assertEquals(isLikelyVideoThumbnailUrl(media[0].url), true);
  assertEquals(filterSendableIngestMedia(media, true), []);
});

Deno.test("ordinary image RSS media remains sendable without video signal", () => {
  const media = [
    { type: "image", url: "https://pbs.twimg.com/media/photo.jpg" },
  ];

  assertEquals(filterSendableIngestMedia(media, false), media);
  assertEquals(selectMediaTier([{
    kind: "image",
    src_url: media[0].url,
    storage_path: "2026/5/photo.jpg",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "image/jpeg",
    file_size: 1000,
  }]).tier, "image");
});

Deno.test("video intent with image bytes blocks instead of falling back to image", () => {
  const row = {
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
    storage_path: "2026/5/thumb.jpg",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "image/jpeg",
    file_size: 9911,
    duration_ms: 67_291,
  };

  assertEquals(hasVideoIntent(row), true);
  assertEquals(selectMediaTier([row], { allowVideo: true }), {
    tier: "blocked",
    items: [row],
    reason: "video_media_mismatch",
  });
});

Deno.test("valid downloaded video obeys allow_video config", () => {
  const row = {
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
    storage_path: "2026/5/video.mp4",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "video/mp4",
    file_size: 2_000_000,
    duration_ms: 30_000,
  };

  assertEquals(selectMediaTier([row], { allowVideo: false }), {
    tier: "blocked",
    items: [row],
    reason: "video_disabled_by_config",
  });
  assertEquals(selectMediaTier([row], { allowVideo: true }), {
    tier: "video",
    items: [row],
  });
});

Deno.test("native X video under documented upload size limit is sendable", () => {
  const row = {
    kind: "video",
    src_url: "https://video.twimg.com/amplify_video/abc/vid/avc1/1280x720/video.mp4",
    storage_path: "2026/5/video.mp4",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "video/mp4",
    file_size: 450 * 1024 * 1024,
    duration_ms: 139_500,
  };

  assertEquals(selectMediaTier([row], { allowVideo: true }), {
    tier: "video",
    items: [row],
  });
});

Deno.test("video-intent rows prevent thumbnail fallback when mixed with images", () => {
  const rows = [
    {
      kind: "video",
      src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
      storage_path: null,
      downloaded_at: null,
      mime_type: null,
      file_size: null,
    },
    {
      kind: "image",
      src_url: "https://pbs.twimg.com/tweet_video_thumb/abc.jpg",
      storage_path: "2026/5/thumb.jpg",
      downloaded_at: "2026-05-17T00:00:00Z",
      mime_type: "image/jpeg",
      file_size: 9911,
    },
  ];

  assertEquals(selectMediaTier(rows, { allowVideo: true }).tier, "blocked");
  assertEquals(selectMediaTier(rows, { allowVideo: true }).reason, "video_media_mismatch");
});
