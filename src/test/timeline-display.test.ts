import { describe, expect, it } from "vitest";
import { buildDeliverySummary, buildPipelineTimelineGroups, describePipelineEvent } from "@/lib/timelineDisplay";
import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry>): MonitoringEntry {
  return {
    tweet_id: "tweet-1",
    text_original: "original",
    text_translated: "",
    url: "",
    created_at: "2026-05-23T14:00:00.000Z",
    has_media: false,
    account_handle: "rss-feed",
    author_handle: "source",
    delivery_status: "",
    telegram_message_ids: [],
    is_translated: false,
    is_delivered: false,
    translation_job_status: "",
    delivery_job_status: "",
    translation_error: "",
    delivery_error: "",
    importance_score: null,
    importance_tags: null,
    importance_reasoning: null,
    delivery_decision: null,
    score_axes: null,
    final_score: null,
    decision_reason: null,
    scoring_version: null,
    scoring_profile_id: null,
    audience_class: null,
    audience_confidence: null,
    audience_reason: null,
    global_exception_class: null,
    score_review_status: null,
    is_truncated: false,
    hydrated_at: null,
    hydration_source: null,
    x_status: null,
    x_tweet_id: null,
    x_posted_at: null,
    x_error: null,
    x_skip_reason: null,
    dup_of_tweet_id: null,
    duplicate_of: null,
    story_cluster_id: null,
    dup_similarity: null,
    dedupe_status: null,
    dedupe_checked_at: null,
    dedupe_method: null,
    dedupe_confidence: null,
    dedupe_reason: null,
    dedupe_new_facts: null,
    score_breakdown: null,
    feedback_locked: false,
    enrich_status: null,
    enrichment_version: null,
    editorial_commentary: null,
    humanized_commentary: null,
    commentary_hook: null,
    commentary_question: null,
    narrative_callback: null,
    composed_post_text: null,
    creator_angle: null,
    why_it_matters: null,
    source_context: null,
    algorithm_signal_scores: null,
    aggregator_risk_score: null,
    ai_voice_risk_score: null,
    monetization_risk_flags: null,
    enrichment_review_reason: null,
    final_x_text: null,
    post_format_hint: null,
    background_context: null,
    enrich_tokens: null,
    enrich_duration_ms: null,
    ...overrides,
  };
}

function event(overrides: Partial<PipelineEvent>): PipelineEvent {
  return {
    subject_type: "post",
    subject_id: "tweet-1",
    step: "dedupe",
    status: "queued",
    started_at: "2026-05-23T14:48:42.000Z",
    ended_at: null,
    error: null,
    meta: {},
    ...overrides,
  };
}

describe("timeline display helpers", () => {
  it("labels platform delivery states separately from internal work", () => {
    const summary = buildDeliverySummary(
      entry({
        is_delivered: true,
        telegram_message_ids: ["123"],
        x_status: "posted",
        x_tweet_id: "2056",
        x_posted_at: "2026-05-23T15:05:00.000Z",
      }),
      [event({ step: "deliver", status: "completed", ended_at: "2026-05-23T15:01:00.000Z" })],
    );

    expect(summary.map((item) => item.platform)).toEqual(["Telegram", "X"]);
    expect(summary[0]).toMatchObject({ label: "Delivered", tone: "good" });
    expect(summary[0].timestampLabel).toBe("Delivered at");
    expect(summary[0].timestamp).toContain("May 23");
    expect(summary[1]).toMatchObject({ label: "Posted", tone: "good" });
    expect(summary[1].detail).toContain("Tweet 2056");
  });

  it("does not use the post creation time as a fake Telegram delivery time", () => {
    const summary = buildDeliverySummary(entry({
      is_delivered: true,
      telegram_message_ids: ["123"],
      created_at: "2026-05-23T14:00:00.000Z",
    }));

    expect(summary[0].timestamp).toBeNull();
    expect(summary[0].detail).toContain("delivery time unavailable");
  });

  it("turns raw pipeline steps into readable labels, platforms, and timings", () => {
    const item = describePipelineEvent(event({
      step: "hydrate_tweet",
      status: "completed",
      started_at: "2026-05-23T14:48:42.000Z",
      ended_at: "2026-05-23T14:49:12.000Z",
    }));

    expect(item.title).toBe("Tweet hydration");
    expect(item.platform).toBe("X read");
    expect(item.statusLabel).toBe("Completed");
    expect(item.duration).toBe("30s");
    expect(item.timestamp).toContain("May 23");
  });

  it("surfaces delivery errors with a platform-specific label", () => {
    const item = describePipelineEvent(event({
      step: "deliver",
      status: "failed",
      error: "telegram_bad_request: chat not found",
    }));

    expect(item.title).toBe("Telegram delivery");
    expect(item.platform).toBe("Telegram");
    expect(item.statusTone).toBe("bad");
    expect(item.errorTitle).toBe("Telegram request failed");
  });

  it("explains Telegram signed-URL video fetch failures", () => {
    const item = describePipelineEvent(event({
      step: "deliver",
      status: "failed",
      error: "deliver[123]: Telegram sendVideo failed: Bad Request: failed to get HTTP URL content",
    }));

    expect(item.errorTitle).toBe("Telegram URL fetch failed; video should use multipart upload");
    expect(item.errorDetail).toContain("failed to get HTTP URL content");
  });

  it("groups repeated queue updates into one readable stage", () => {
    const groups = buildPipelineTimelineGroups([
      event({ step: "dedupe", status: "queued", started_at: "2026-05-23T14:48:00.000Z" }),
      event({ step: "dedupe", status: "running", started_at: "2026-05-23T14:49:00.000Z" }),
      event({ step: "dedupe", status: "completed", started_at: null, ended_at: "2026-05-23T14:50:00.000Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: "Duplicate gate",
      platform: "Internal",
      statusLabel: "Completed",
      updateCount: 3,
    });
    expect(groups[0].events.map((item) => item.statusLabel)).toEqual(["Queued", "Running", "Completed"]);
  });
});
