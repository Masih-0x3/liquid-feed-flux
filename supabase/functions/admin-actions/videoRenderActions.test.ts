import { assertEquals } from "jsr:@std/assert";
import {
  latestTimestamp,
  normalizeVideoRenderIds,
  normalizeVideoRenderReviewState,
  normalizeVideoRenderStatuses,
  sanitizeVideoRenderFeedbackLabel,
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

Deno.test("video render action label prioritizes block, output, original, then status", () => {
  assertEquals(videoRenderActionLabel({ status: "blocked", output_storage_path: "x" }), "blocked");
  assertEquals(videoRenderActionLabel({ status: "completed", output_storage_path: "renders/a.mp4" }), "rendered");
  assertEquals(videoRenderActionLabel({ status: "completed", preflight: { processingMode: "original_unmodified" } }), "original-selected");
  assertEquals(videoRenderActionLabel({ status: "queued" }), "queued");
  assertEquals(videoRenderActionLabel({}), "unknown");
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
