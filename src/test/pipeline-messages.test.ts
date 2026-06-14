import { describe, expect, it } from "vitest";
import { formatPipelineError, formatXSkipOrError } from "@/lib/pipelineMessages";

describe("pipeline message formatting", () => {
  it("separates old X duration guards from the current configured cap", () => {
    expect(formatXSkipOrError("video_too_long_for_x:202s", null)).toMatchObject({
      title: "X skipped by previous duration guard (202s)",
    });
    expect(formatXSkipOrError("video_too_long_for_config:351s", null)).toMatchObject({
      title: "X skipped: video over configured 350s cap (351s)",
    });
    expect(formatXSkipOrError("video_too_long_for_config:351s", "configured video duration cap is 350s")).toMatchObject({
      title: "X skipped: video over configured 350s cap (351s)",
    });
    expect(formatXSkipOrError(null, "X account/API limit blocks videos over 140s")).toMatchObject({
      title: "X skipped by previous duration guard",
    });
  });

  it("maps Telegram video platform-limit failures to operator copy", () => {
    expect(formatPipelineError("Telegram sendVideo failed: Bad Request: failed to get HTTP URL content")).toMatchObject({
      title: "Telegram URL fetch failed; video should use multipart upload",
    });
    expect(formatPipelineError("deliver[1]: telegram_video_too_large_for_bot_api:51MB>50MB")).toMatchObject({
      title: "Telegram video is over the 50MB Bot API upload limit",
    });
  });
});
