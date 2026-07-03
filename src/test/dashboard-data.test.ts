import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDashboardData } from "@/api/dashboardData";
import {
  fetchDashboardProcessHud,
  normalizeDashboardProcessHud,
} from "@/api/dashboardProcessHud";
import { invokeAdminAction } from "@/api/adminActions";

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

function rpcSummary(overrides: Record<string, unknown> = {}) {
  return {
    metrics: {
      posts_ingested: 5,
      posts_translated: 4,
      posts_delivered: 3,
      failed_jobs: 1,
      x_posts_24h: 2,
      x_failed_24h: 0,
      x_api_calls_24h: 7,
    },
    health: {
      success_rate: 98,
      avg_latency: 42,
      active_feeds: 3,
      queue_size: 2,
      queue_running: 1,
      queue_stale_running_30m: 0,
      is_online: true,
      x_monthly_posts: 20,
      x_monthly_budget: 100,
      x_budget_used_pct: 20,
    },
    recent_posts: [{
      tweet_id: "tweet-1",
      text_original: "Original post text",
      created_at: "2026-06-14T12:00:00.000Z",
      text_translated: null,
      account_handle: "source",
    }],
    ...overrides,
  };
}

describe("dashboard data API", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
  });

  it("uses admin-actions and normalizes dashboard rows", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      success: true,
      dashboard: rpcSummary({
        pipeline_counts: {
          ingested: 6,
          duplicate_gate_checked: 5,
          duplicate_gate_available: true,
          x_failed: 1,
        },
        ops_status: {
          severity: "warning",
          primary_issue: "Manual review backlog",
          recommended_route: "/monitoring?filter=manual_review",
          stale_job_count: 0,
        },
      }),
    });

    const result = await fetchDashboardData();

    expect(result.metrics.postsIngested).toBe(5);
    expect(result.pipelineCounts).toMatchObject({
      ingested: 6,
      duplicateGateChecked: 5,
      duplicateGateAvailable: true,
      xFailed: 1,
    });
    expect(result.opsStatus).toMatchObject({
      severity: "warning",
      primaryIssue: "Manual review backlog",
      recommendedRoute: "/monitoring?filter=manual_review",
    });
    expect(invokeAdminActionMock).toHaveBeenCalledWith({ action: "get_dashboard_summary" });
  });

  it("surfaces admin-action failures instead of falling back to direct RPC", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ success: false, error: "edge function unavailable" });

    await expect(fetchDashboardData()).rejects.toThrow("edge function unavailable");
  });

  it("fetches and normalizes the bounded dashboard process HUD payload", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      success: true,
      process_hud: {
        available: true,
        generated_at: "2026-07-03T12:00:00.000Z",
        window_hours: 24,
        source: "local-ledger",
        partial_reason: null,
        error: null,
        truncated: true,
        entries: [{ tweet_id: "tweet-1", text_original: "post" }],
      },
    });

    const result = await fetchDashboardProcessHud();

    expect(invokeAdminActionMock).toHaveBeenCalledWith({
      action: "get_dashboard_process_hud",
      limit: 30,
      window_hours: 24,
    });
    expect(result).toMatchObject({
      available: true,
      generatedAt: "2026-07-03T12:00:00.000Z",
      windowHours: 24,
      source: "local-ledger",
      truncated: true,
    });
    expect(result.entries[0].tweet_id).toBe("tweet-1");
  });

  it("keeps malformed dashboard process HUD payloads safe", () => {
    const result = normalizeDashboardProcessHud({
      available: false,
      source: "unexpected",
      error: "",
      entries: "bad",
    });

    expect(result).toMatchObject({
      available: false,
      source: "unavailable",
      entries: [],
      error: null,
      windowHours: 24,
    });
  });
});
