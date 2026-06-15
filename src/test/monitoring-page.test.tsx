import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
