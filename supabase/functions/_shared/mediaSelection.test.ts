import { assertEquals } from "jsr:@std/assert";
import {
  filterSendableIngestMedia,
  hasVideoIntent,
  isOverAttemptedVideoDuration,
  isLikelyVideoThumbnailUrl,
  MAX_ATTEMPTED_VIDEO_DURATION_MS,
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

Deno.test("native X video under upload size limit is sendable through the configured duration cap", () => {
  const row = {
    kind: "video",
    src_url: "https://video.twimg.com/amplify_video/abc/vid/avc1/1280x720/video.mp4",
    storage_path: "2026/5/video.mp4",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "video/mp4",
    file_size: 450 * 1024 * 1024,
    duration_ms: 349_500,
  };

  assertEquals(selectMediaTier([row], { allowVideo: true }), {
    tier: "video",
    items: [row],
  });
  assertEquals(MAX_ATTEMPTED_VIDEO_DURATION_MS, 350_000);
  assertEquals(isOverAttemptedVideoDuration(202_000), false);
  assertEquals(isOverAttemptedVideoDuration(350_000), false);
  assertEquals(isOverAttemptedVideoDuration(351_000), true);
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

Deno.test("a downloaded image row without mime_type/file_size is demoted to text, not image", () => {
  // The legacy "reused row" shape produced by the buggy reuse-by-hash branch
  // in media-processor/index.ts: storage_path and downloaded_at are set, but
  // file_size and mime_type were left null. selectMediaTier must NOT treat
  // such a row as sendable image tier; it falls through to text with the
  // no_supported_media reason. This is the contract the reuse branch must
  // satisfy by copying the donor's file_size/mime_type onto the reused row.
  const reusedImage = {
    kind: "image",
    src_url: "https://pbs.twimg.com/media/abc.jpg",
    storage_path: "2026/5/abc.jpg",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: null,
    file_size: null,
  };
  const tier = selectMediaTier([reusedImage]);
  assertEquals(tier.tier, "text");
  assertEquals(tier.items, []);
  assertEquals(tier.reason, "no_supported_media");
});

Deno.test("a downloaded video row without mime_type/file_size blocks as video_media_mismatch, not video_pending_resolution", () => {
  // A "reused video" row from the buggy reuse path is downloaded
  // (storage_path + downloaded_at set) but lacks the mime_type/file_size
  // required by isValidVideoDownload. This MUST surface as
  // video_media_mismatch (non-healing) rather than video_pending_resolution
  // (which would self-heal by enqueuing download_media) — otherwise the
  // reuse bug could masquerade as a recoverable pending state. The fix in
  // media-processor/index.ts prevents this shape from being produced; this
  // test pins the selector contract so any regression reproducing the
  // shape is observable.
  const reusedVideo = {
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
    storage_path: "2026/5/video.mp4",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: null,
    file_size: null,
    duration_ms: 30_000,
  };
  assertEquals(selectMediaTier([reusedVideo], { allowVideo: true }), {
    tier: "blocked",
    items: [reusedVideo],
    reason: "video_media_mismatch",
  });
});

Deno.test("a reused row with copied file_size/mime_type is sendable just like a fresh download", () => {
  // After the fix, the reuse branch copies the donor's file_size/mime_type
  // onto the reused row, producing a shape indistinguishable (for
  // selection purposes) from a freshly downloaded row. This test pins the
  // happy-path outcome the reuse branch must achieve.
  const reusedImage = {
    kind: "image",
    src_url: "https://pbs.twimg.com/media/abc.jpg",
    storage_path: "2026/5/donor.jpg",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "image/jpeg",
    file_size: 12345,
  };
  assertEquals(selectMediaTier([reusedImage]), {
    tier: "image",
    items: [reusedImage],
  });

  const reusedVideo = {
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
    storage_path: "2026/5/donor.mp4",
    downloaded_at: "2026-05-17T00:00:00Z",
    mime_type: "video/mp4",
    file_size: 2_000_000,
    duration_ms: 30_000,
  };
  assertEquals(selectMediaTier([reusedVideo], { allowVideo: true }), {
    tier: "video",
    items: [reusedVideo],
  });
});
