import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MonitoringDuplicateClusterPanel,
  MonitoringDuplicateClusterSummary,
  MonitoringDuplicateMatch,
} from "@/components/monitoring/MonitoringDuplicateEvidence";
import { MonitoringDuplicateGateCard } from "@/components/monitoring/MonitoringDuplicateGateCard";
import {
  MonitoringAudienceBadge,
  MonitoringCostFlags,
  MonitoringDedupeBadge,
  MonitoringScore,
  MonitoringXBadge,
} from "@/components/monitoring/MonitoringStatusBadges";
import { MonitoringMobileCard } from "@/components/monitoring/MonitoringRow";
import type { DuplicateCluster, MonitoringEntry } from "@/hooks/useMonitoringData";

function entry(overrides: Partial<MonitoringEntry> = {}): MonitoringEntry {
  return {
    tweet_id: "tweet-1",
    text_original: "original text",
    text_translated: "",
    url: "https://example.com/source",
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

function duplicateTarget(overrides: Partial<NonNullable<MonitoringEntry["duplicate_of"]>> = {}): NonNullable<MonitoringEntry["duplicate_of"]> {
  return {
    tweet_id: "canonical-tweet",
    text_original: "canonical story text",
    url: "https://example.com/canonical",
    created_at: "2026-05-23T13:00:00.000Z",
    author_handle: "canonical",
    delivery_decision: "deliver",
    decision_reason: null,
    final_score: 15,
    importance_score: 12,
    dedupe_status: null,
    dup_of_tweet_id: null,
    dup_similarity: null,
    telegram_state: "delivered",
    x_state: "posted",
    coverage_state: "delivered",
    ...overrides,
  };
}

describe("monitoring status badges", () => {
  it("keeps status, score, cost, and audience labels stable", () => {
    render(
      <div>
        <MonitoringDedupeBadge
          entry={entry({
            dedupe_status: "coverage_gap",
            dedupe_method: "semantic",
            dedupe_confidence: 0.91,
            dedupe_reason: "same story",
          })}
        />
        <MonitoringAudienceBadge entry={entry({ audience_class: "direct_focus" })} />
        <MonitoringScore entry={entry({ final_score: 15 })} deliverThreshold={14} />
        <MonitoringCostFlags
          entry={entry({
            x_cost_flags: {
              may_call_x: true,
              media_upload_expected: true,
              hydration_expected: true,
              reasons: ["hydration read", "tweet write"],
            },
          })}
        />
      </div>,
    );

    expect(screen.getByText("Coverage gap")).toBeInTheDocument();
    expect(screen.getByText("Direct focus")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("/ ≥14")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("media")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
  });

  it("links posted X statuses to the tweet", () => {
    render(<MonitoringXBadge entry={entry({ x_status: "posted", x_tweet_id: "12345" })} />);

    const link = screen.getByRole("link", { name: "X: Posted" });
    expect(link).toHaveAttribute("href", "https://x.com/i/status/12345");
  });
});

describe("monitoring duplicate evidence", () => {
  it("preserves duplicate anomaly copy and inspect callback", () => {
    const onInspectDuplicateMatch = vi.fn();
    render(
      <MonitoringDuplicateMatch
        entry={entry({
          x_status: "posted",
          dup_of_tweet_id: "canonical-tweet",
          duplicate_of: duplicateTarget({ coverage_state: "not_covered" }),
        })}
        onInspectDuplicateMatch={onInspectDuplicateMatch}
      />,
    );

    expect(screen.getByText("Both X posted")).toBeInTheDocument();
    expect(screen.getByText("not covered")).toBeInTheDocument();
    expect(screen.getByText("canonical story text")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(onInspectDuplicateMatch).toHaveBeenCalledWith("canonical-tweet");
  });

  it("renders duplicate gate coverage details and routes the run action", () => {
    const onRunDedupe = vi.fn();
    const duplicate = entry({
      dedupe_status: "coverage_gap",
      dedupe_reason: "canonical is uncovered",
      dup_of_tweet_id: "canonical-tweet",
      duplicate_of: duplicateTarget({ coverage_state: "not_covered", x_state: "none" }),
    });

    render(<MonitoringDuplicateGateCard entry={duplicate} onRunDedupe={onRunDedupe} />);

    expect(screen.getByText("Duplicate Gate")).toBeInTheDocument();
    expect(screen.getByText("canonical is uncovered")).toBeInTheDocument();
    expect(screen.getByText("not covered")).toBeInTheDocument();
    expect(screen.getByText(/Future duplicate checks now treat this as a coverage gap/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onRunDedupe).toHaveBeenCalledWith(duplicate);
  });

  it("keeps duplicate cluster expansion and member actions explicit", () => {
    const duplicateEntry = entry({
      tweet_id: "duplicate-member",
      dup_of_tweet_id: "canonical-tweet",
      text_original: "duplicate member text",
    });
    const cluster: DuplicateCluster = {
      cluster_id: "cluster-1",
      canonical_tweet_id: "canonical-tweet",
      members: [
        {
          tweet_id: "canonical-tweet",
          text_original: "canonical member text",
          url: "https://example.com/canonical",
          created_at: "2026-05-23T13:00:00.000Z",
          author_handle: "canonical",
          final_score: 15,
          importance_score: null,
          dedupe_status: null,
          dup_of_tweet_id: null,
          dup_similarity: null,
          telegram_state: "delivered",
          x_state: "posted",
          coverage_state: "delivered",
          is_canonical: true,
        },
        {
          tweet_id: "duplicate-member",
          text_original: "duplicate member text",
          url: "https://example.com/duplicate",
          created_at: "2026-05-23T14:00:00.000Z",
          author_handle: "duplicate",
          final_score: 10,
          importance_score: null,
          dedupe_status: "duplicate",
          dup_of_tweet_id: "canonical-tweet",
          dup_similarity: 0.88,
          dedupe_confidence: 0.94,
          dedupe_reason: "same claim",
          telegram_state: "none",
          x_state: "posted",
          coverage_state: "not_covered",
          is_canonical: false,
        },
      ],
      counts: {
        total: 2,
        delivered: 1,
        x_posted: 2,
        blocked: 1,
        uncertain: 0,
        coverage_gap: 1,
      },
      has_x_anomaly: true,
      coverage_state: "covered",
    };
    const clusteredEntry = entry({
      tweet_id: "canonical-tweet",
      duplicate_cluster: cluster,
    });
    const onToggleCluster = vi.fn();
    const onOpenDetails = vi.fn();
    const onOpenManualScore = vi.fn();
    const onRunDedupe = vi.fn();
    const onClearDuplicate = vi.fn();

    render(
      <div>
        <MonitoringDuplicateClusterSummary
          entry={clusteredEntry}
          expandedClusters={new Set()}
          onToggleCluster={onToggleCluster}
          onInspectDuplicateMatch={vi.fn()}
        />
        <MonitoringDuplicateClusterPanel
          entry={clusteredEntry}
          entryByTweetId={new Map([["duplicate-member", duplicateEntry]])}
          expandedClusters={new Set(["cluster-1"])}
          deliverThreshold={14}
          onOpenDetails={onOpenDetails}
          onOpenManualScore={onOpenManualScore}
          onRunDedupe={onRunDedupe}
          onClearDuplicate={onClearDuplicate}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /2 versions/i }));
    expect(onToggleCluster).toHaveBeenCalledWith("cluster-1");
    expect(screen.getByText("Both posted to X")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run duplicate check" }));
    fireEvent.click(screen.getByRole("button", { name: "Manual score" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear duplicate" }));

    expect(onRunDedupe).toHaveBeenCalledWith(duplicateEntry);
    expect(onOpenManualScore).toHaveBeenCalledWith(duplicateEntry);
    expect(onClearDuplicate).toHaveBeenCalledWith(duplicateEntry);
  });
});

describe("monitoring row renderers", () => {
  it("routes card selection, detail, manual score, and row actions through page callbacks", () => {
    const onSelectChange = vi.fn();
    const onOpenDetails = vi.fn();
    const onOpenManualScore = vi.fn();
    const onRunDedupe = vi.fn();
    const onClearDuplicate = vi.fn();
    const renderRowActions = vi.fn(() => <button type="button">More actions</button>);

    render(
      <MonitoringMobileCard
        entry={entry({
          final_score: 16,
          delivery_decision: "deliver",
          importance_tags: ["regional"],
          audience_class: "direct_focus",
        })}
        isSelected={false}
        deliverThreshold={14}
        entryByTweetId={new Map()}
        expandedClusters={new Set()}
        renderRowActions={renderRowActions}
        onSelectChange={onSelectChange}
        onOpenDetails={onOpenDetails}
        onOpenManualScore={onOpenManualScore}
        onToggleCluster={vi.fn()}
        onInspectDuplicateMatch={vi.fn()}
        onRunDedupe={onRunDedupe}
        onClearDuplicate={onClearDuplicate}
      />,
    );

    fireEvent.click(screen.getByLabelText("Select tweet-1"));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Score" }));

    expect(screen.getByText("regional")).toBeInTheDocument();
    expect(screen.getByText("Direct focus")).toBeInTheDocument();
    expect(screen.getByText("More actions")).toBeInTheDocument();
    expect(onSelectChange).toHaveBeenCalledWith("tweet-1", true);
    expect(onOpenDetails).toHaveBeenCalledWith("tweet-1");
    expect(onOpenManualScore).toHaveBeenCalledWith(expect.objectContaining({ tweet_id: "tweet-1" }));
    expect(renderRowActions).toHaveBeenCalledWith(expect.objectContaining({ tweet_id: "tweet-1" }), true);
    expect(onRunDedupe).not.toHaveBeenCalled();
    expect(onClearDuplicate).not.toHaveBeenCalled();
  });
});
