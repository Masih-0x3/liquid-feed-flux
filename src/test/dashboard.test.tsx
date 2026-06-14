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
    needsScore: 5,
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
    resolvedFailed24h: 0,
    staleRunning: 0,
    oldestPendingAgeSeconds: 600,
    byType: [{
      type: "translate",
      lane: "model",
      pending: 3,
      running: 1,
      failed: 0,
      queueWaitP50Seconds: 30,
      queueWaitP95Seconds: 120,
      runP50Seconds: 90,
      runP95Seconds: 180,
    }],
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
  systemPerformance: {
    success: true,
    error: null,
    generatedAt: new Date().toISOString(),
    windows: {
      sixHours: {
        windowHours: 6,
        sampledPosts: 20,
        stages: {
          ingestToDedupe: { count: 20, avgSeconds: 60, p50Seconds: 55, p90Seconds: 110, p95Seconds: 120 },
          ingestToScore: { count: 15, avgSeconds: 70, p50Seconds: 65, p90Seconds: 130, p95Seconds: 150 },
          dedupeToTranslation: { count: 12, avgSeconds: 120, p50Seconds: 100, p90Seconds: 220, p95Seconds: 240 },
          scoreToTranslation: { count: 12, avgSeconds: 90, p50Seconds: 80, p90Seconds: 180, p95Seconds: 200 },
          ingestToTranslation: { count: 12, avgSeconds: 180, p50Seconds: 170, p90Seconds: 300, p95Seconds: 320 },
          translationToTelegram: { count: 8, avgSeconds: 80, p50Seconds: 65, p90Seconds: 160, p95Seconds: 180 },
          translationToX: { count: 5, avgSeconds: 180, p50Seconds: 160, p90Seconds: 300, p95Seconds: 330 },
          telegramEndToEnd: { count: 8, avgSeconds: 240, p50Seconds: 210, p90Seconds: 420, p95Seconds: 450 },
          xEndToEnd: { count: 5, avgSeconds: 360, p50Seconds: 330, p90Seconds: 620, p95Seconds: 650 },
        },
      },
      twentyFourHours: {
        windowHours: 24,
        sampledPosts: 60,
        stages: {
          ingestToDedupe: { count: 60, avgSeconds: 65, p50Seconds: 60, p90Seconds: 120, p95Seconds: 140 },
          ingestToScore: { count: 45, avgSeconds: 80, p50Seconds: 70, p90Seconds: 150, p95Seconds: 170 },
          dedupeToTranslation: { count: 40, avgSeconds: 130, p50Seconds: 120, p90Seconds: 240, p95Seconds: 260 },
          scoreToTranslation: { count: 40, avgSeconds: 110, p50Seconds: 95, p90Seconds: 210, p95Seconds: 230 },
          ingestToTranslation: { count: 40, avgSeconds: 200, p50Seconds: 190, p90Seconds: 350, p95Seconds: 390 },
          translationToTelegram: { count: 30, avgSeconds: 100, p50Seconds: 75, p90Seconds: 220, p95Seconds: 260 },
          translationToX: { count: 20, avgSeconds: 220, p50Seconds: 180, p90Seconds: 420, p95Seconds: 460 },
          telegramEndToEnd: { count: 30, avgSeconds: 300, p50Seconds: 250, p90Seconds: 480, p95Seconds: 520 },
          xEndToEnd: { count: 20, avgSeconds: 420, p50Seconds: 390, p90Seconds: 760, p95Seconds: 800 },
        },
      },
    },
    queue: {
      pending: 4,
      running: 1,
      staleRunning: 0,
      failed24h: 1,
      resolvedFailed24h: 0,
      oldestPendingAgeSeconds: 600,
      schedulerWaitSeconds: 600,
      byType: [{
        type: "translate",
        lane: "model",
        pending: 3,
        running: 1,
        failed: 0,
        queueWaitP50Seconds: 30,
        queueWaitP95Seconds: 120,
        runP50Seconds: 90,
        runP95Seconds: 180,
      }],
      lanePressure: [{ lane: "model", pending: 3, running: 1, failed: 0, maxQueueWaitP95Seconds: 120 }],
    },
    resources: {
      available: true,
      error: null,
      dbBytes: 180_000_000,
      dbLimitBytes: 500_000_000,
      dbUsedPct: 36,
      tempMediaBytes: 620_000_000,
      tempMediaObjects: 1000,
      storageLimitBytes: 1_000_000_000,
      storageUsedPct: 62,
      edgeMonthlyLimit: 500_000,
      projectedCronInvocationsMonthly: 90_000,
      edgeCronUsedPct: 18,
      cronFailures24h: 0,
      cronJobs: [],
      workerDispatchMode: "event-driven + cron fallback",
      workerCron: { jobname: "invoke-worker-every-1m", schedule: "* * * * *", active: true },
      workerCadenceSeconds: 60,
      workerCadenceWarning: false,
      duplicateTranslateJobs24h: 2,
    },
  },
  scoringTuning: {
    regionalAuto24h: 3,
    globalPilotReview24h: 1,
    globalTunedAuto24h: 2,
    manualScoreOverrides24h: 4,
    manualFeedback24h: 6,
    projectedAddedPostsMonth: 310,
    error: null,
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
    expect(screen.getByText("System Speed + Quota")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Failed posts 24h")).toBeTruthy();
    expect(screen.getByText("Failed attempts")).toBeTruthy();
    expect(screen.getByText(/Duplicate translate jobs: 2 in 24h/)).toBeTruthy();
    expect(screen.getByText("Regional auto 24h")).toBeTruthy();
    expect(screen.getByText("Projected added/month")).toBeTruthy();
    expect(screen.getByText("310")).toBeTruthy();

    expect(screen.getByText(/Official X usage is not synced from Dashboard/)).toBeTruthy();
  });

  it("keeps live pipeline testing behind a confirmation", () => {
    renderHealthControls();
    fireEvent.click(screen.getByRole("button", { name: /live test pipeline/i }));

    expect(screen.getByText("Send a production test webhook?")).toBeTruthy();
  });
});
