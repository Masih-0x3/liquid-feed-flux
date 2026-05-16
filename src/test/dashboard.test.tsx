import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DashboardHealth } from "@/components/dashboard/DashboardHealth";

vi.mock("@/hooks/useDashboardData", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDashboardData")>("@/hooks/useDashboardData");
  return {
    ...actual,
    useDashboardData: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

const mockedUseDashboardData = vi.mocked(useDashboardData);

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderHealthControls() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardHealth health={dashboardData.health} queue={dashboardData.queueBreakdown} xUsage={dashboardData.xLocalUsage} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const dashboardData = {
  metrics: {
    postsIngested: 20,
    postsTranslated: 12,
    postsDelivered: 8,
    failedJobs: 1,
    postsTruncated24h: 3,
    postsHydrated24h: 2,
    xApiCalls24h: 2,
    xPosts24h: 5,
    xFailed24h: 1,
    xSkippedNoMedia24h: 0,
    xMediaUploads24h: 4,
  },
  health: {
    successRate: 91,
    avgLatency: 2.3,
    activeFeeds: 8,
    queueSize: 4,
    queueRunning: 1,
    staleRunning30m: 0,
    lastReconcileAt: null,
    isOnline: true,
    xSuccessRate: 83,
    xMonthlyPosts: 120,
    xMonthlyBudget: 3000,
    xBudgetUsedPct: 4,
  },
  activities: [{
    id: "a1",
    title: "Ingested @rss-feed",
    description: "Fresh post",
    timestamp: new Date().toISOString(),
    status: "pending" as const,
    kind: "post" as const,
    route: "/monitoring?search=1",
  }],
  heartbeat: {
    state: "ok" as const,
    lastPostAt: new Date().toISOString(),
    ageSeconds: 300,
    warnMinutes: 120,
    criticalMinutes: 360,
  },
  opsStatus: {
    severity: "warning" as const,
    primaryIssue: "1 failed job in 24h",
    recommendedRoute: "/monitoring?filter=failed_stuck",
    lastIngestAgeSeconds: 300,
    staleJobCount: 0,
  },
  pipelineCounts: {
    ingested: 20,
    duplicateGateChecked: null,
    duplicateGateAvailable: false,
    duplicates: null,
    scored: 15,
    translated: 12,
    telegramDelivered: 8,
    xPosted: 5,
    needsAttention: 2,
    failedStuck: 1,
    readyToDeliver: 3,
    translationQueue: 4,
    xFailed: 1,
    staleJobs: 0,
  },
  queueBreakdown: {
    pending: 4,
    running: 1,
    failed24h: 1,
    staleRunning: 0,
    oldestPendingAgeSeconds: 600,
    byType: [{ type: "translate", pending: 3, running: 1, failed: 0 }],
  },
  xLocalUsage: {
    available: false,
    source: "x_deliveries_fallback" as const,
    attempts24h: 2,
    countedAttempts24h: 2,
    failedAttempts24h: 1,
    posts24h: 5,
    failedPosts24h: 1,
    mediaUploads24h: 4,
    hydrations24h: 2,
    monthlyPosts: 120,
    monthlyBudget: 3000,
    budgetUsedPct: 4,
    officialUsageSynced: false,
  },
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an actionable error state", () => {
    mockedUseDashboardData.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("summary failed"),
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.getByText("Dashboard failed to load")).toBeTruthy();
    expect(screen.getByText(/summary failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("renders triage, funnel, and local X usage without official sync copy", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.getByText("Pipeline Funnel")).toBeTruthy();
    expect(screen.getByText("X Cost Guard")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Failed posts 24h")).toBeTruthy();
    expect(screen.getByText("Failed attempts")).toBeTruthy();

    expect(screen.getByText(/Official X usage is not synced from Dashboard/)).toBeTruthy();
  });

  it("keeps live pipeline testing behind a confirmation", () => {
    renderHealthControls();
    fireEvent.click(screen.getByRole("button", { name: /live test pipeline/i }));

    expect(screen.getByText("Send a production test webhook?")).toBeTruthy();
  });
});
