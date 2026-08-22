import { describe, expect, it } from "vitest";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import {
  clusterMonitoringEntries,
  formatAge,
  formatBytes,
  formatScoringV2Score,
  shortText,
} from "@/lib/monitoringViewModel";
import {
  actionContextText,
  actionDescription,
  actionTitle,
  bulkActionDescription,
  bulkActionTitle,
} from "@/lib/monitoringActions";

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

describe("monitoring view model helpers", () => {
  it("uses translated text first and collapses whitespace for display", () => {
    expect(shortText(entry({
      text_original: "original   text",
      text_translated: " translated\n\n text ",
    }))).toBe("translated text");
  });

  it("builds duplicate clusters with the delivered or posted canonical item visible", () => {
    const rows = [
      entry({
        tweet_id: "low-score",
        story_cluster_id: "story-1",
        final_score: 5,
        text_original: "first version",
      }),
      entry({
        tweet_id: "active-delivery",
        story_cluster_id: "story-1",
        final_score: 10,
        delivery_decision: "deliver",
        delivery_status: "pending",
        text_original: "second version",
      }),
      entry({
        tweet_id: "posted-x",
        story_cluster_id: "story-1",
        final_score: 8,
        x_status: "posted",
        text_original: "posted version",
      }),
    ];

    const clustered = clusterMonitoringEntries(rows);

    expect(clustered.map((row) => row.tweet_id)).toEqual(["posted-x"]);
    expect(clustered[0].duplicate_cluster).toMatchObject({
      canonical_tweet_id: "posted-x",
      counts: {
        total: 3,
        delivered: 1,
        x_posted: 1,
        blocked: 0,
        uncertain: 0,
        coverage_gap: 1,
      },
      coverage_state: "covered",
    });
    expect(clustered[0].duplicate_cluster?.members.map((member) => member.tweet_id)).toEqual([
      "posted-x",
      "low-score",
      "active-delivery",
    ]);
  });

  it("does not regroup entries when the backend already marked cluster visibility", () => {
    const visible = entry({ tweet_id: "visible", hidden_in_cluster: false });
    const hidden = entry({ tweet_id: "hidden", hidden_in_cluster: true });

    expect(clusterMonitoringEntries([visible, hidden]).map((row) => row.tweet_id)).toEqual(["visible"]);
  });

  it("formats scoring v2 snapshots with thresholds", () => {
    expect(formatScoringV2Score({ final_score: 12.5, threshold: 14 })).toBe("12.5 / ≥14");
    expect(formatScoringV2Score(null)).toBe("—");
  });

  it("formats compact media ages and file sizes", () => {
    expect(formatAge(null)).toBe("unknown");
    expect(formatAge(59)).toBe("0m");
    expect(formatAge(3_900)).toBe("1h 5m");
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_097_152)).toBe("2.0 MB");
  });
});

describe("monitoring action copy helpers", () => {
  it("returns stable titles and descriptions for row actions", () => {
    const pendingAction = {
      type: "force_x" as const,
      entry: entry({
        tweet_id: "tweet-2",
        author_handle: "source",
        text_translated: "translated post",
        x_cost_flags: {
          may_call_x: true,
          media_upload_expected: false,
          hydration_expected: true,
          reasons: ["hydration read", "tweet write expected"],
        },
      }),
    };

    expect(actionTitle(pendingAction)).toBe("Post plain to X?");
    expect(actionDescription(pendingAction)).toContain("hydration read, tweet write expected");
    expect(actionContextText(pendingAction, null)).toBe("@source · translated post");
  });

  it("returns stable titles and descriptions for bulk actions", () => {
    expect(bulkActionTitle("bulk_reprocess", 3)).toBe("Reprocess 3 post(s)?");
    expect(bulkActionTitle("bulk_ignore", 2)).toBe("Ignore 2 post(s)?");
    expect(actionDescription({ type: "reprocess", entry: entry({}) })).toContain("Existing media is preserved");
    expect(bulkActionDescription("bulk_reprocess", 3)).toContain("Existing media is preserved");
    expect(bulkActionDescription("bulk_ignore", 2)).toContain("without calling Telegram or X");
    expect(actionContextText(null, { type: "bulk_ignore", tweetIds: ["1", "2"] })).toBe("2 post IDs selected");
  });
});
