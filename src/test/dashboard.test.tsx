import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { type SystemPerformanceSummary, useDashboardData } from "@/hooks/useDashboardData";
import { useDashboardProcessHudData } from "@/hooks/useDashboardProcessHudData";
import { DashboardHealth } from "@/components/dashboard/DashboardHealth";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/useDashboardData", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDashboardData")>("@/hooks/useDashboardData");
  return {
    ...actual,
    useDashboardData: vi.fn(),
  };
});

vi.mock("@/hooks/useDashboardProcessHudData", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDashboardProcessHudData")>("@/hooks/useDashboardProcessHudData");
  return {
    ...actual,
    useDashboardProcessHudData: vi.fn(),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAdmin: true, role: "admin" }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

const mockedUseDashboardData = vi.mocked(useDashboardData);
const mockedUseDashboardProcessHudData = vi.mocked(useDashboardProcessHudData);
let processHudRefetch = vi.fn();

function renderDashboard(initialEntries = ["/"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Dashboard />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function renderHealthControls(systemPerformance?: SystemPerformanceSummary) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardHealth
          health={dashboardData.health}
          queue={dashboardData.queueBreakdown}
          xUsage={dashboardData.xLocalUsage}
          systemPerformance={systemPerformance}
        />
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
  openAiUsage: {
    available: true,
    error: null,
    windowHours: 24,
    measuredJobs: 5,
    translateJobs: 4,
    totalTokens: 12_345,
    inputTokens: 9_000,
    outputTokens: 3_345,
    scoringTokens: 1_234,
    adjudicationTokens: 200,
    translationTokens: 1_911,
    reasoningTokens: 800,
    quotaFailedJobs: 1,
    retryAttempts: 2,
  },
  processObservability: {
    available: true,
    error: null,
    windowHours: 24,
    activeRuns: 1,
    completedRuns24h: 7,
    failedRuns24h: 1,
    aiCalls24h: 9,
    failedAiCalls24h: 1,
    totalTokens24h: 23_456,
    reasoningTokens24h: 1_200,
    aiCallP95Seconds: 12,
    latestRun: {
      runKey: "worker:translate:job-1",
      workflowName: "rss-item-pipeline",
      workflowRunId: "job-1",
      status: "completed",
      source: "worker",
      sourceFunction: "handleTranslateJob",
      subjectType: "post",
      subjectId: "tweet-1",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 8,
      lastError: null,
      usedFilter: true,
    },
    recentRuns: [],
    foglamp: {
      hostedExportEnabled: false,
      hasApiKey: true,
      monthlySpanLimit: 10_000,
      monthlySpanCap: 8_000,
      monthlySpanWarn: 6_000,
      estimatedSpansUsed: 120,
      estimatedSpansSkipped: 9,
      capUsedPct: 2,
      warning: false,
      stopped: false,
    },
    openAiTokensMonthToDate: 100_000,
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
      storageLimitBytes: 100_000_000_000,
      storageUsedPct: 0.6,
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
    processHudRefetch = vi.fn();
    mockedUseDashboardProcessHudData.mockReturnValue({
      data: {
        available: true,
        generatedAt: new Date().toISOString(),
        windowHours: 24,
        source: "local-ledger",
        partialReason: null,
        error: null,
        truncated: false,
        entries: [],
      },
      entries: [],
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: processHudRefetch,
    } as unknown as ReturnType<typeof useDashboardProcessHudData>);
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

  it("renders triage, funnel, and local X usage with specific operator copy", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    fireEvent.click(screen.getByText("Diagnostics & capacity"));
    const diagnostics = screen.getByText("Diagnostics & capacity").closest("details");
    expect(diagnostics).toBeTruthy();
    expect(within(diagnostics as HTMLElement).getByText("Pipeline Funnel")).toBeTruthy();
    expect(within(diagnostics as HTMLElement).getByText("X Cost Guard")).toBeTruthy();
    expect(screen.getAllByText("Pipeline Funnel")).toHaveLength(1);
    expect(screen.getAllByText("X Cost Guard")).toHaveLength(1);
    expect(screen.getByText("Pipeline Speed")).toBeTruthy();
    expect(screen.getByText("Resource Risk")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Failed posts 24h")).toBeTruthy();
    expect(screen.getByText("Failed attempts")).toBeTruthy();
    expect(screen.getByText("Duplicate translate jobs")).toBeTruthy();
    expect(screen.getByText("Regional auto 24h")).toBeTruthy();
    expect(screen.getByText("Projected added/month")).toBeTruthy();
    expect(screen.getByText("310")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review 1 failed job/i })).toBeTruthy();
    expect(screen.queryByText("Open recommended view")).toBeNull();
    expect(screen.getByText("5 not scored")).toBeTruthy();
    expect(screen.getByText("3 not translated")).toBeTruthy();
    expect(screen.getByText("4 awaiting Telegram")).toBeTruthy();
    expect(screen.getByText("3 not X posted")).toBeTruthy();

    expect(screen.getByText(/Supabase-local telemetry only/)).toBeTruthy();
    expect(screen.getByText(/Official X usage is not synced from Dashboard/)).toBeTruthy();
  });

  it("puts the first viewport facts and primary exception in a workflow cockpit", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    const cockpit = screen.getByRole("region", { name: "Workflow cockpit" });
    expect(within(cockpit).getByText("Current ingest")).toBeTruthy();
    expect(within(cockpit).getByText(/ok - 5m ago/i)).toBeTruthy();
    expect(within(cockpit).getByText("Queue")).toBeTruthy();
    expect(within(cockpit).getByText("4 pending / 1 running")).toBeTruthy();
    expect(within(cockpit).getByText("Telegram last 24h")).toBeTruthy();
    expect(within(cockpit).getByText("X last 24h")).toBeTruthy();
    expect(within(cockpit).getByText("8")).toBeTruthy();
    expect(within(cockpit).getByText("5")).toBeTruthy();
    expect(within(cockpit).getByText("Latest workflow")).toBeTruthy();
    expect(within(cockpit).getByText("rss-item-pipeline - completed")).toBeTruthy();
    expect(within(cockpit).getByRole("button", { name: /Review 1 failed job/i })).toBeTruthy();
    expect(screen.getAllByText("Online")).toHaveLength(1);
    expect(screen.getAllByText(/^Updated /)).toHaveLength(1);

    const diagnostics = screen.getByText("Diagnostics & capacity").closest("summary");
    expect(diagnostics).toBeTruthy();
    expect(diagnostics).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps dashboard status in normal page flow instead of sticking over cards", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    const status = screen.getByLabelText("Dashboard status");

    expect(status).not.toHaveClass("sticky");
    expect(status).not.toHaveClass("top-16");
    expect(status).not.toHaveClass("z-30");
  });

  it("shows local OpenAI usage from completed job metadata on the pipeline tab", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard(["/?tab=pipeline"]);

    expect(screen.getByText("OpenAI Usage")).toBeTruthy();
    expect(screen.getByText("Last 24h from completed job metadata")).toBeTruthy();
    expect(screen.getAllByText("12,345").length).toBeGreaterThan(0);
    expect(screen.getByText(/5 measured jobs - 2 retry attempts/)).toBeTruthy();
  });

  it("defers the process HUD until an operator opens it and retains the local trace guardrail", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(mockedUseDashboardProcessHudData).toHaveBeenLastCalledWith({ enabled: false });
    expect(screen.queryByText("Post process HUD")).toBeNull();
    fireEvent.click(screen.getByText("Diagnostics & capacity"));
    const processHudTrigger = screen.getByRole("button", { name: /open process hud/i });
    expect(processHudTrigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(processHudTrigger);
    expect(mockedUseDashboardProcessHudData).toHaveBeenLastCalledWith({ enabled: true });
    expect(screen.getByText("Post process HUD")).toBeTruthy();
    expect(screen.getByRole("button", { name: /hide process hud/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Limits & Trace Guard")).toBeTruthy();
    expect(screen.getByText("rss-item-pipeline")).toBeTruthy();
    expect(screen.getByText("120 / 8,000")).toBeTruthy();
    expect(screen.getByText(/Native HUD remains local/)).toBeTruthy();
    expect(screen.queryByText("Recent Activity")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Activity" })).toBeNull();
  });

  it("disables the process HUD when diagnostics closes and skips HUD refresh", async () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    fireEvent.click(screen.getByText("Diagnostics & capacity"));
    fireEvent.click(screen.getByRole("button", { name: /open process hud/i }));
    expect(screen.getByText("Post process HUD")).toBeTruthy();

    fireEvent.click(screen.getByText("Diagnostics & capacity"));

    await waitFor(() => {
      expect(screen.getByText("Diagnostics & capacity").closest("summary")).toHaveAttribute("aria-expanded", "false");
      expect(mockedUseDashboardProcessHudData).toHaveBeenLastCalledWith({ enabled: false });
      expect(screen.queryByText("Post process HUD")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/i }));
    expect(processHudRefetch).not.toHaveBeenCalled();
  });

  it("surfaces storage warning when no higher-priority issue is active", () => {
    mockedUseDashboardData.mockReturnValue({
      data: {
        ...dashboardData,
        opsStatus: {
          ...dashboardData.opsStatus,
          severity: "ok" as const,
          primaryIssue: "Pipeline is operating normally",
          recommendedRoute: "/monitoring",
        },
        pipelineCounts: {
          ...dashboardData.pipelineCounts,
          failedStuck: 0,
        },
        systemPerformance: {
          ...dashboardData.systemPerformance,
          resources: {
            ...dashboardData.systemPerformance.resources,
            storageUsedPct: 86,
            tempMediaBytes: 860_000_000,
            storageLimitBytes: 1_000_000_000,
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.getByText("Temp media storage high")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review media cleanup/i })).toBeTruthy();
  });

  it("lets critical storage risk outrank warning-level failed jobs", () => {
    mockedUseDashboardData.mockReturnValue({
      data: {
        ...dashboardData,
        systemPerformance: {
          ...dashboardData.systemPerformance,
          resources: {
            ...dashboardData.systemPerformance.resources,
            storageUsedPct: 92,
            tempMediaBytes: 920_000_000,
            storageLimitBytes: 1_000_000_000,
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.getByText("Temp media storage critical")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review media cleanup/i })).toBeTruthy();
  });

  it("does not warn when temp media is below paid storage quota pressure", () => {
    mockedUseDashboardData.mockReturnValue({
      data: {
        ...dashboardData,
        opsStatus: {
          ...dashboardData.opsStatus,
          severity: "ok" as const,
          primaryIssue: "Pipeline is operating normally",
          recommendedRoute: "/monitoring",
        },
        pipelineCounts: {
          ...dashboardData.pipelineCounts,
          failedStuck: 0,
        },
        systemPerformance: {
          ...dashboardData.systemPerformance,
          resources: {
            ...dashboardData.systemPerformance.resources,
            tempMediaBytes: 926_235_953,
            tempMediaObjects: 1475,
            storageLimitBytes: 100_000_000_000,
            storageUsedPct: 0.9,
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.queryByText(/Temp media storage/i)).toBeNull();
    expect(screen.getByText("Pipeline is operating normally")).toBeTruthy();
    expect(screen.queryByLabelText("Dashboard status")).toBeNull();
  });

  it("opens media storage controls from a storage alert", () => {
    mockedUseDashboardData.mockReturnValue({
      data: {
        ...dashboardData,
        opsStatus: {
          ...dashboardData.opsStatus,
          severity: "ok" as const,
          primaryIssue: "Pipeline is operating normally",
          recommendedRoute: "/monitoring",
        },
        pipelineCounts: {
          ...dashboardData.pipelineCounts,
          failedStuck: 0,
        },
        systemPerformance: {
          ...dashboardData.systemPerformance,
          resources: {
            ...dashboardData.systemPerformance.resources,
            storageUsedPct: 86,
            tempMediaBytes: 860_000_000,
            storageLimitBytes: 1_000_000_000,
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: /Review media cleanup/i }));

    expect(screen.getByText("Media Storage")).toBeTruthy();
    expect(screen.getByText("Allowance")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dry-run media cleanup/i })).toBeTruthy();
  });

  it("defaults secondary dashboard tabs to pipeline", () => {
    mockedUseDashboardData.mockReturnValue({
      data: dashboardData,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      isFetching: false,
    } as ReturnType<typeof useDashboardData>);

    renderDashboard();

    expect(screen.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("data-state", "active");
    expect(screen.queryByText("Recent Activity")).toBeNull();
  });

  it("keeps webhook validation behind a confirmation", () => {
    renderHealthControls();
    fireEvent.click(screen.getByRole("button", { name: /validate webhook/i }));

    expect(screen.getByText("Validate the webhook safely?")).toBeTruthy();
  });

  it("labels paused cleanup schedules as an intentional safety hold", () => {
    const systemPerformance = {
      ...dashboardData.systemPerformance,
      resources: {
        ...dashboardData.systemPerformance.resources,
        cronJobs: [
          { jobname: "invoke-db-cleanup-daily", schedule: "0 3 * * *", active: false },
          { jobname: "invoke-media-cleanup-6h", schedule: "0 */6 * * *", active: false },
        ],
      },
    } as SystemPerformanceSummary;

    renderHealthControls(systemPerformance);

    expect(screen.getByRole("alert")).toHaveTextContent("Cleanup safety hold active");
    expect(screen.getByRole("alert")).toHaveTextContent("intentionally paused");
    expect(screen.getAllByText("Safety hold")).toHaveLength(2);
    expect(screen.getByText(/does not certify shared paths as safe/i)).toBeTruthy();
  });

  it("names only the cleanup schedule that is actually paused", () => {
    const systemPerformance = {
      ...dashboardData.systemPerformance,
      resources: {
        ...dashboardData.systemPerformance.resources,
        cronJobs: [
          { jobname: "invoke-db-cleanup-daily", schedule: "0 3 * * *", active: true },
          { jobname: "invoke-media-cleanup-6h", schedule: "0 */6 * * *", active: false },
        ],
      },
    } as SystemPerformanceSummary;

    renderHealthControls(systemPerformance);

    expect(screen.getByRole("alert")).toHaveTextContent("Media cleanup is intentionally paused");
    expect(screen.getByRole("alert")).not.toHaveTextContent("database retention are intentionally paused");
    expect(screen.getByText("Active / daily")).toBeTruthy();
    expect(screen.getAllByText("Safety hold")).toHaveLength(1);
  });
});
