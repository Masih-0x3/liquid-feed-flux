import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDashboardData } from "@/api/dashboardData";
import { invokeAdminAction } from "@/api/adminActions";
import { supabase } from "@/integrations/supabase/client";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
  },
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
  const supabaseMock = vi.mocked(supabase);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
    mocks.rpc.mockReset();
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
    expect(result.activities[0]).toMatchObject({
      id: "tweet-1",
      route: "/monitoring?search=tweet-1",
      status: "pending",
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("falls back to the read-only RPC when the admin-action path fails", async () => {
    invokeAdminActionMock.mockRejectedValueOnce(new Error("edge function behind"));
    mocks.rpc.mockResolvedValueOnce({ data: rpcSummary(), error: null });

    const result = await fetchDashboardData();

    expect(result.metrics.postsIngested).toBe(5);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_dashboard_summary");
  });

  it("includes both failure reasons when admin-action and RPC fallback fail", async () => {
    invokeAdminActionMock.mockRejectedValueOnce(new Error("edge function behind"));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "rpc unavailable" } });

    await expect(fetchDashboardData()).rejects.toThrow(
      "Dashboard summary unavailable. Admin action failed: edge function behind; RPC fallback failed: rpc unavailable",
    );
  });
});
