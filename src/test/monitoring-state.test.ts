import { describe, expect, it } from "vitest";
import { loadedMonitoringCounts, monitoringDecisionLabel, monitoringStage } from "@/lib/monitoringState";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry>): MonitoringEntry {
  return {
    tweet_id: "1",
    text_original: "original",
    text_translated: "",
    url: "",
    created_at: new Date().toISOString(),
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
    editorial_commentary: null,
    humanized_commentary: null,
    commentary_hook: null,
    commentary_question: null,
    narrative_callback: null,
    composed_post_text: null,
    post_format_hint: null,
    background_context: null,
    enrich_tokens: null,
    enrich_duration_ms: null,
    ...overrides,
  };
}

describe("monitoring state helpers", () => {
  it("does not label a skipped below-threshold row as translation work", () => {
    const row = entry({
      importance_score: 8,
      final_score: 8,
      delivery_decision: "skip",
      decision_reason: "below_threshold:8<14",
    });

    expect(monitoringStage(row).label).toBe("Skipped");
    expect(monitoringDecisionLabel(row, "fallback")).toBe("Skipped");
    expect(loadedMonitoringCounts([row]).translation_queue).toBe(0);
    expect(loadedMonitoringCounts([row]).below_threshold).toBe(1);
  });

  it("labels unscored missing-translation rows as scoring work first", () => {
    const row = entry({});

    expect(monitoringStage(row).label).toBe("Needs score");
    const counts = loadedMonitoringCounts([row]);
    expect(counts.needs_score).toBe(1);
    expect(counts.translation_queue).toBe(0);
  });

  it("counts server-derived ready rows without treating delivered rows as ready", () => {
    const ready = entry({
      text_translated: "ترجمه",
      is_translated: true,
      delivery_decision: "deliver",
      final_score: 16,
      monitoring_state: {
        code: "ready_to_deliver",
        stage_label: "Ready",
        tone: "info",
        decision_label: "Ready to deliver",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "none",
        x_state: "none",
        needs_attention: false,
        next_actions: ["force_telegram"],
      },
    });
    const delivered = entry({
      text_translated: "ترجمه",
      is_translated: true,
      is_delivered: true,
      delivery_decision: "deliver",
      final_score: 16,
      monitoring_state: {
        code: "delivered",
        stage_label: "Delivered",
        tone: "good",
        decision_label: "Delivered",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "delivered",
        x_state: "none",
        needs_attention: false,
        next_actions: ["details"],
      },
    });

    const counts = loadedMonitoringCounts([ready, delivered]);
    expect(counts.ready_to_deliver).toBe(1);
    expect(counts.delivered_24h).toBe(1);
  });

  it("uses plain duplicate-gate labels for related and uncertain states", () => {
    const related = entry({ dedupe_status: "related_new_info" });
    const uncertain = entry({ dedupe_status: "uncertain" });

    expect(monitoringStage(related).label).toBe("Related: new info");
    expect(monitoringDecisionLabel(related, "fallback")).toBe("Related: new info");
    expect(monitoringStage(uncertain).label).toBe("Uncertain duplicate");
    expect(loadedMonitoringCounts([uncertain]).manual_review).toBe(1);
  });
});
