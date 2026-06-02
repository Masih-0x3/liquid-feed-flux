import { describe, expect, it } from "vitest";
import {
  getScoringV2Snapshot,
  latestScoringV2Event,
  matchesScoringV2Filter,
} from "@/lib/scoringV2Monitoring";
import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry>): MonitoringEntry {
  return {
    tweet_id: "tweet-1",
    text_original: "original",
    text_translated: "",
    url: "",
    created_at: "2026-06-01T10:00:00.000Z",
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
    step: "score",
    status: "completed",
    started_at: null,
    ended_at: "2026-06-01T10:00:00.000Z",
    error: null,
    meta: {},
    ...overrides,
  };
}

describe("scoring v2 monitoring helpers", () => {
  it("extracts the latest v2 score event metadata for drawer comparison", () => {
    const latest = latestScoringV2Event([
      event({
        ended_at: "2026-06-01T09:00:00.000Z",
        meta: { version: "audience-fit-v2", mode: "shadow", decision: "skip", final_score: 3, threshold: 99 },
      }),
      event({
        ended_at: "2026-06-01T10:00:00.000Z",
        meta: {
          version: "audience-fit-v2",
          mode: "active",
          profile_id: "iran-first",
          audience_class: "adjacent",
          audience_confidence: 0.88,
          final_score: 12.6,
          threshold: 12.5,
          cap: 16,
          decision: "deliver",
          review_status: "none",
          adjudicated: false,
        },
      }),
    ]);

    expect(latest).toMatchObject({
      mode: "active",
      profile_id: "iran-first",
      audience_class: "adjacent",
      decision: "deliver",
      final_score: 12.6,
      threshold: 12.5,
      cap: 16,
    });
  });

  it("filters V1/V2 disagreements from persisted score_breakdown snapshots", () => {
    const row = entry({
      delivery_decision: "deliver",
      score_breakdown: {
        scoring_v2: {
          mode: "shadow",
          decision: "skip",
          audience_class: "off_topic",
          final_score: 2.7,
          threshold: 99,
          review_status: "needs_review",
        },
      },
    });

    expect(matchesScoringV2Filter(row, "v1_post_v2_skip")).toBe(true);
    expect(matchesScoringV2Filter(row, "v2_would_skip")).toBe(true);
    expect(matchesScoringV2Filter(row, "v2_off_topic")).toBe(true);
    expect(matchesScoringV2Filter(row, "v2_needs_review")).toBe(true);
    expect(matchesScoringV2Filter(row, "v1_skip_v2_post")).toBe(false);
  });

  it("falls back to post-level scoring fields when no score_breakdown snapshot exists", () => {
    const snapshot = getScoringV2Snapshot(entry({
      scoring_version: "audience-fit-v2",
      scoring_profile_id: "iran-first",
      audience_class: "direct_focus",
      audience_confidence: 0.93,
      audience_reason: "Direct Iran item",
      global_exception_class: null,
      score_review_status: "none",
      delivery_decision: "deliver",
      final_score: 14.2,
    }));

    expect(snapshot).toMatchObject({
      profile_id: "iran-first",
      audience_class: "direct_focus",
      audience_confidence: 0.93,
      review_status: "none",
      decision: "deliver",
      final_score: 14.2,
    });
  });
});
