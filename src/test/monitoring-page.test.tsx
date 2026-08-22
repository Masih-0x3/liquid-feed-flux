import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";

const monitoringHooks = vi.hoisted(() => ({
  useMonitoringDataSearchWithScore: vi.fn(),
  useMonitoringOverview: vi.fn(),
  useXApiSummary: vi.fn(),
}));

vi.mock("@/hooks/useMonitoringData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useMonitoringData")>();
  return {
    ...actual,
    useMonitoringDataSearchWithScore: monitoringHooks.useMonitoringDataSearchWithScore,
    useMonitoringOverview: monitoringHooks.useMonitoringOverview,
    useXApiSummary: monitoringHooks.useXApiSummary,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, role: "admin" }),
}));

function settingsQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => settingsQuery()),
  },
}));

import Monitoring from "@/pages/Monitoring";

function renderMonitoring(path = "/monitoring") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Monitoring />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("monitoring page", () => {
  beforeEach(() => {
    monitoringHooks.useMonitoringDataSearchWithScore.mockReset();
    monitoringHooks.useMonitoringOverview.mockReset();
    monitoringHooks.useXApiSummary.mockReset();

    monitoringHooks.useMonitoringDataSearchWithScore.mockReturnValue({
      entries: [],
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isFetching: false,
      error: null,
    });
    monitoringHooks.useMonitoringOverview.mockReturnValue({ data: undefined });
    monitoringHooks.useXApiSummary.mockReturnValue({ data: undefined });
  });

  it("renders the empty state and normalizes URL filter values before fetching", () => {
    renderMonitoring("/monitoring?filter=x-failed");

    expect(screen.getByText("No entries found")).toBeInTheDocument();
    expect(monitoringHooks.useMonitoringDataSearchWithScore).toHaveBeenCalledWith("x_failed", "", "any");
  });

  it("keeps the process HUD off the monitoring workbench while preserving post actions", () => {
    const entry = {
      tweet_id: "post-1",
      text_original: "Source post text",
      text_translated: "",
      url: "https://twitter.com/example/status/1",
      created_at: new Date(Date.now() - 20_000).toISOString(),
      has_media: false,
      account_handle: "FirstSquawk",
      author_handle: "FirstSquawk",
      delivery_status: "pending",
      telegram_message_ids: [],
      is_translated: false,
      is_delivered: false,
      translation_job_status: "pending",
      delivery_job_status: "pending",
      translation_error: "",
      delivery_error: "",
      importance_score: 15,
      importance_tags: null,
      importance_reasoning: null,
      delivery_decision: "deliver",
      score_axes: null,
      final_score: 15,
      base_score: null,
      learned_score: null,
      learned_delta: null,
      x_gate_score: null,
      learning_confidence: null,
      decision_reason: null,
      scoring_version: "v2",
      scoring_profile_id: "iran-first",
      audience_class: "direct_focus",
      audience_confidence: 0.9,
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
      dedupe_status: "unique",
      dedupe_checked_at: new Date(Date.now() - 18_000).toISOString(),
      dedupe_method: "local",
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
      process_observability: {
        available: true,
        source: "workflow_runs",
        partial_reason: null,
        latest_run: {
          run_key: "run-1",
          workflow_name: "rss-item-pipeline",
          workflow_run_id: "post-1",
          status: "running",
          source_function: "worker",
          started_at: new Date(Date.now() - 15_000).toISOString(),
          ended_at: null,
          duration_seconds: null,
          last_error: null,
          ai_call_count: 1,
          failed_ai_call_count: 0,
          total_tokens: 130,
          foglamp_exported: 0,
          foglamp_skipped: 1,
          calls: [{
            workflow_run_key: "run-1",
            trace_name: "translate-post",
            operation_name: "translate-post",
            agent_name: "translation-agent",
            model: "gpt-5-mini",
            endpoint: "openai.responses",
            status: "running",
            total_tokens: 130,
            reasoning_tokens: 0,
            duration_ms: null,
            started_at: new Date(Date.now() - 10_000).toISOString(),
            ended_at: null,
            foglamp_exported: false,
            foglamp_span_estimate: 1,
            foglamp_skip_reason: "local_only",
            error_message: null,
          }],
        },
        recent_runs: [],
        ai_calls: 1,
        failed_ai_calls: 0,
        total_tokens: 130,
        foglamp_exported: 0,
        foglamp_skipped: 1,
      },
      monitoring_state: {
        code: "translation_queue",
        stage_label: "Translation queue",
        tone: "info",
        decision_label: "Queued",
        primary_blocker: "Awaiting translation",
        translation_state: "queued",
        telegram_state: "none",
        x_state: "none",
        needs_attention: false,
        next_actions: ["translate"],
      },
      duplicate_cluster: null,
      hidden_in_cluster: false,
    } as unknown as MonitoringEntry;

    monitoringHooks.useMonitoringDataSearchWithScore.mockReturnValue({
      entries: [entry],
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isFetching: false,
      error: null,
    });

    renderMonitoring();

    expect(screen.queryByTestId("monitoring-process-hud")).toBeNull();
    expect(screen.queryByText("Post process HUD")).toBeNull();
    expect(screen.getAllByText("@FirstSquawk").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /details/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /row actions/i }).length).toBeGreaterThan(0);
  });
});
