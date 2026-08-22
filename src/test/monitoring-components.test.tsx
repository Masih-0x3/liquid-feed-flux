import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MonitoringDuplicateClusterPanel,
  MonitoringDuplicateClusterSummary,
  MonitoringDuplicateMatch,
} from "@/components/monitoring/MonitoringDuplicateEvidence";
import { MonitoringDuplicateGateCard } from "@/components/monitoring/MonitoringDuplicateGateCard";
import { MonitoringDetailDrawer } from "@/components/monitoring/MonitoringDetailDrawer";
import { MonitoringProcessHud } from "@/components/monitoring/MonitoringProcessHud";
import {
  MonitoringAudienceBadge,
  MonitoringCostFlags,
  MonitoringDedupeBadge,
  MonitoringScore,
  MonitoringXBadge,
} from "@/components/monitoring/MonitoringStatusBadges";
import { MonitoringMobileCard, MonitoringTableEntryRows } from "@/components/monitoring/MonitoringRow";
import { MonitoringProcessTraceMap } from "@/components/monitoring/MonitoringProcessTraceMap";
import { buildProcessTraceMap } from "@/lib/processTraceMap";
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
    base_score: null,
    learned_score: null,
    learned_delta: null,
    x_gate_score: null,
    learning_confidence: null,
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

    render(<MonitoringDuplicateGateCard entry={duplicate} onRunDedupe={onRunDedupe} readOnly={false} />);

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
          readOnly={false}
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
        readOnly={false}
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

  it("shows an explicit desktop table Details action", () => {
    const onOpenDetails = vi.fn();
    const renderRowActions = vi.fn(() => <button type="button" aria-label="Row actions">More</button>);

    render(
      <table>
        <tbody>
          <MonitoringTableEntryRows
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
            onSelectChange={vi.fn()}
            onOpenDetails={onOpenDetails}
            onOpenManualScore={vi.fn()}
            onToggleCluster={vi.fn()}
            onInspectDuplicateMatch={vi.fn()}
            onRunDedupe={vi.fn()}
            onClearDuplicate={vi.fn()}
            readOnly={false}
          />
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(onOpenDetails).toHaveBeenCalledWith("tweet-1");
    expect(renderRowActions).toHaveBeenCalledWith(expect.objectContaining({ tweet_id: "tweet-1" }));
  });
});

describe("monitoring detail drawer", () => {
  it("renders drawer sections and routes primary actions through page callbacks", () => {
    const onRequestAction = vi.fn();
    const onGenerateEnrichment = vi.fn();
    const onScoreFeedback = vi.fn();
    const drawerEntry = entry({
      final_score: 16,
      delivery_decision: "deliver",
      text_translated: "ترجمه",
      scoring_version: "v2",
      audience_class: "direct_focus",
      audience_confidence: 0.91,
      enrich_status: "awaiting_approval",
      enrichment_version: "voice-v1",
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: null,
        ai_calls: 1,
        failed_ai_calls: 0,
        total_tokens: 1250,
        foglamp_exported: 0,
        foglamp_skipped: 1,
        recent_runs: [],
        latest_run: {
          run_key: "post:tweet-1:job:abc",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "worker:tweet-1:abc",
          status: "completed",
          source_function: "worker",
          started_at: "2026-05-23T14:00:00.000Z",
          ended_at: "2026-05-23T14:00:05.000Z",
          duration_seconds: 5,
          last_error: null,
          ai_call_count: 1,
          failed_ai_call_count: 0,
          total_tokens: 1250,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [
            {
              workflow_run_key: "post:tweet-1:job:abc",
              trace_name: "rss-item-pipeline",
              operation_name: "translate",
              agent_name: "translator",
              model: "gpt-4.1-mini",
              endpoint: "chat_completions",
              status: "completed",
              total_tokens: 1250,
              reasoning_tokens: 0,
              duration_ms: 5000,
              started_at: "2026-05-23T14:00:00.000Z",
              ended_at: "2026-05-23T14:00:05.000Z",
              foglamp_exported: false,
              foglamp_span_estimate: 1,
              foglamp_skip_reason: "worker_local_only",
              error_message: null,
            },
          ],
        },
      },
      monitoring_state: {
        code: "ready_to_deliver",
        stage_label: "Ready",
        tone: "good",
        decision_label: "Deliver",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "pending",
        x_state: "pending",
        needs_attention: false,
        next_actions: ["deliver"],
      },
    });

    render(
      <MonitoringDetailDrawer
        open
        onOpenChange={vi.fn()}
        tweetId="tweet-1"
        entry={drawerEntry}
        timeline={[]}
        deliverThreshold={14}
        xPostingEnabled
        xDiagnostic={{
          tweet_id: "tweet-1",
          eligible: true,
          blockers: [],
          notes: [],
          candidate: { sql_gate_passed: true, reason: "ready" },
        }}
        xDiagnosticLoading={false}
        editingEntry={null}
        editedContent=""
        enrichingTweetIds={new Set()}
        feedbackLoading={null}
        onInspectDuplicateMatch={vi.fn()}
        onRequestAction={onRequestAction}
        onStartEditTranslation={vi.fn()}
        onEditedContentChange={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onGenerateEnrichment={onGenerateEnrichment}
        onOpenManualScore={vi.fn()}
        onScoreFeedback={onScoreFeedback}
        onEnrichmentFeedback={vi.fn()}
        onSelectEnrichmentVariant={vi.fn()}
        readOnly={false}
      />,
    );

    expect(screen.getByText("Pipeline Details")).toBeInTheDocument();
    expect(screen.getByText("Process Observability")).toBeInTheDocument();
    expect(screen.getByTestId("process-trace-map")).toBeInTheDocument();
    expect(screen.getByLabelText(/Translation agent: Completed/)).toBeInTheDocument();
    expect(screen.getByText("Process trace map")).toBeInTheDocument();
    expect(screen.getAllByText("rss-item-pipeline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("translator").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,250 tokens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("worker local only").length).toBeGreaterThan(0);
    expect(screen.getByText("Why not on X?")).toBeInTheDocument();
    expect(screen.getByText("Scoring")).toBeInTheDocument();
    expect(screen.getByText("Enrichment Studio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate enrichment draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Post plain to X" }));
    fireEvent.click(screen.getByRole("button", { name: "Should skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve for X" }));

    expect(onGenerateEnrichment).toHaveBeenCalledWith("tweet-1");
    expect(onScoreFeedback).toHaveBeenCalledWith(drawerEntry, "should_skip", "direct_focus");
    expect(onRequestAction).toHaveBeenCalledWith({ type: "force_x", entry: drawerEntry });
    expect(onRequestAction).toHaveBeenCalledWith({ type: "approve_enrichment", entry: drawerEntry });
  });
});

describe("monitoring process trace map", () => {
  it("renders loading and error states without enabling follow latest", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <MonitoringProcessHud entries={[]} isLoading onOpenPost={vi.fn()} onRetry={onRetry} />,
    );

    expect(screen.getByText("loading post runs")).toBeInTheDocument();
    expect(screen.getByText("Loading post processes...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow latest" })).toBeDisabled();

    rerender(
      <MonitoringProcessHud entries={[]} error={new Error("ledger unavailable")} onOpenPost={vi.fn()} onRetry={onRetry} />,
    );

    expect(screen.getByText("process feed unavailable")).toBeInTheDocument();
    expect(screen.getByText("ledger unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders lean dashboard HUD entries when optional arrays are omitted", () => {
    const leanEntry = entry({
      final_score: 16,
      delivery_decision: "deliver",
      is_translated: true,
      text_translated: "ترجمه",
      enrich_status: "awaiting_approval",
      telegram_message_ids: undefined as unknown as string[],
      monitoring_state: {
        code: "manual_review",
        stage_label: "Manual review",
        tone: "warn",
        decision_label: "Awaiting review",
        primary_blocker: "Enrichment is awaiting approval",
        translation_state: "translated",
        telegram_state: "none",
        x_state: "none",
        needs_attention: true,
        next_actions: ["approve_enrichment"],
      },
    });

    render(<MonitoringProcessHud entries={[leanEntry]} onOpenPost={vi.fn()} />);

    expect(screen.getByTestId("monitoring-process-hud")).toBeInTheDocument();
    expect(screen.getByText(/waiting\/manual/i)).toBeInTheDocument();
  });

  it("does not animate the left run marker for completed X posts", () => {
    const posted = entry({
      final_score: 16,
      delivery_decision: "deliver",
      is_translated: true,
      is_delivered: true,
      telegram_message_ids: ["123"],
      x_status: "posted",
      x_tweet_id: "2056",
      x_posted_at: "2026-05-23T14:05:00.000Z",
      monitoring_state: {
        code: "delivered",
        stage_label: "X posted",
        tone: "good",
        decision_label: "X posted",
        primary_blocker: null,
        translation_state: "translated",
        telegram_state: "delivered",
        x_state: "posted",
        needs_attention: false,
        next_actions: ["details"],
      },
    });

    const { container } = render(<MonitoringProcessHud entries={[posted]} onOpenPost={vi.fn()} />);

    expect(screen.getByText(/latest complete/i)).toBeInTheDocument();
    expect(container.querySelector(".xot-hud-list .xot-hud-diamond.run")).toBeNull();
    expect(container.querySelector(".xot-hud-detail-header .xot-hud-diamond.run")).toBeNull();
  });

  it("keeps manual enrichment waiting states static", () => {
    const awaitingManual = entry({
      final_score: 16,
      delivery_decision: "deliver",
      is_translated: true,
      text_translated: "ترجمه",
      enrich_status: "awaiting_approval",
      monitoring_state: {
        code: "manual_review",
        stage_label: "Manual review",
        tone: "warn",
        decision_label: "Awaiting review",
        primary_blocker: "Enrichment is awaiting approval",
        translation_state: "translated",
        telegram_state: "none",
        x_state: "none",
        needs_attention: true,
        next_actions: ["approve_enrichment"],
      },
    });

    const { container } = render(<MonitoringProcessHud entries={[awaitingManual]} onOpenPost={vi.fn()} />);

    expect(screen.getAllByText("Manual enrich").length).toBeGreaterThan(0);
    expect(screen.getByText(/waiting\/manual/i)).toBeInTheDocument();
    expect(container.querySelector(".xot-hud-list .xot-hud-diamond.run")).toBeNull();
    expect(container.querySelector(".xot-hud-wf-bar.run")).toBeNull();
  });

  it("renders pending HUD stages as waiting rather than active or completed", () => {
    const waiting = entry({
      delivery_decision: "deliver",
      translation_job_status: "pending",
    });

    const { container } = render(<MonitoringProcessTraceMap traceMap={buildProcessTraceMap(waiting)} />);

    const pendingChip = container.querySelector(".xot-hud-chip.status-pending");
    expect(pendingChip).toHaveTextContent("Translate");
    expect(pendingChip).toHaveTextContent("Pending");
    expect(container.querySelector(".xot-hud-chip.used")).toBeNull();
    expect(container.querySelector(".xot-hud-wf-bar.run")).toBeNull();
  });

  it("renders a successful local-only AI trace with visible stage labels", () => {
    const source = entry({
      final_score: 16,
      delivery_decision: "deliver",
      is_translated: true,
      text_translated: "ترجمه",
      is_delivered: true,
      telegram_message_ids: ["123"],
      x_status: "posted",
      x_tweet_id: "2056",
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: null,
        ai_calls: 1,
        failed_ai_calls: 0,
        total_tokens: 1250,
        foglamp_exported: 0,
        foglamp_skipped: 1,
        recent_runs: [],
        latest_run: {
          run_key: "post:tweet-1:job:abc",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "worker:tweet-1:abc",
          status: "completed",
          source_function: "worker",
          started_at: "2026-05-23T14:00:00.000Z",
          ended_at: "2026-05-23T14:00:05.000Z",
          duration_seconds: 5,
          last_error: null,
          ai_call_count: 1,
          failed_ai_call_count: 0,
          total_tokens: 1250,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [
            {
              workflow_run_key: "post:tweet-1:job:abc",
              trace_name: "rss-item-pipeline",
              operation_name: "translate",
              agent_name: "translator",
              model: "gpt-4.1-mini",
              endpoint: "chat_completions",
              status: "completed",
              total_tokens: 1250,
              reasoning_tokens: 0,
              duration_ms: 5000,
              started_at: "2026-05-23T14:00:00.000Z",
              ended_at: "2026-05-23T14:00:05.000Z",
              foglamp_exported: false,
              foglamp_span_estimate: 1,
              foglamp_skip_reason: "worker_local_only",
              error_message: null,
            },
          ],
        },
      },
    });

    render(<MonitoringProcessTraceMap traceMap={buildProcessTraceMap(source)} />);

    expect(screen.getByTestId("process-trace-map")).toBeInTheDocument();
    expect(screen.getByText("Process trace map")).toBeInTheDocument();
    expect(screen.getByLabelText(/Translation agent: Completed/)).toBeInTheDocument();
    expect(screen.getByText("worker:tweet-1:abc")).toBeInTheDocument();
    expect(screen.getByText("1 local only")).toBeInTheDocument();
  });

  it("renders duplicate-blocked and skipped downstream stages", () => {
    render(
      <MonitoringProcessTraceMap
        traceMap={buildProcessTraceMap(entry({
          dup_of_tweet_id: "canonical-tweet",
          dedupe_status: "duplicate",
          dedupe_reason: "same story",
        }))}
      />,
    );

    expect(screen.getByTestId("process-trace-node-dedupe")).toHaveAttribute("aria-label", expect.stringContaining("Blocked"));
    expect(screen.getByTestId("process-trace-node-x-post")).toHaveAttribute("aria-label", expect.stringContaining("Skipped"));
    expect(screen.getByText("same story")).toBeInTheDocument();
  });

  it("renders partial observability notes for failed AI stages", () => {
    const source = entry({
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: "workflow_run_without_complete_ledger",
        ai_calls: 1,
        failed_ai_calls: 1,
        total_tokens: 322,
        foglamp_exported: 0,
        foglamp_skipped: 1,
        recent_runs: [],
        latest_run: {
          run_key: "post:tweet-1:job:failed",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "worker:tweet-1:failed",
          status: "failed",
          source_function: "worker",
          started_at: "2026-05-23T14:00:00.000Z",
          ended_at: "2026-05-23T14:00:02.000Z",
          duration_seconds: 2,
          last_error: "model timeout",
          ai_call_count: 1,
          failed_ai_call_count: 1,
          total_tokens: 322,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [
            {
              workflow_run_key: "post:tweet-1:job:failed",
              trace_name: "rss-item-pipeline",
              operation_name: "score_post",
              agent_name: "scorer",
              model: "gpt-4.1-mini",
              endpoint: "chat_completions",
              status: "failed",
              total_tokens: 322,
              reasoning_tokens: 0,
              duration_ms: 2000,
              started_at: "2026-05-23T14:00:00.000Z",
              ended_at: "2026-05-23T14:00:02.000Z",
              foglamp_exported: false,
              foglamp_span_estimate: 1,
              foglamp_skip_reason: "worker_local_only",
              error_message: "model timeout",
            },
          ],
        },
      },
    });

    render(<MonitoringProcessTraceMap traceMap={buildProcessTraceMap(source)} />);

    expect(screen.getByTestId("process-trace-node-score")).toHaveAttribute("aria-label", expect.stringContaining("Failed"));
    expect(screen.getByText("Trace notes")).toBeInTheDocument();
    expect(screen.getByText(/workflow run without complete ledger/)).toBeInTheDocument();
    expect(screen.getAllByText(/model timeout/).length).toBeGreaterThan(0);
  });
});
