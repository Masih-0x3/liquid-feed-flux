import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import ScoringStudio from "@/components/settings/ScoringStudio";
import { DEFAULT_SCORING_POLICY } from "@/hooks/useSettingsData";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

function renderStudio() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScoringStudio initial={DEFAULT_SCORING_POLICY} />
    </QueryClientProvider>,
  );
}

describe("ScoringStudio", () => {
  it("renders the profile-driven scoring controls", () => {
    renderStudio();

    expect(screen.getByText("Scoring Studio")).toBeTruthy();
    expect(screen.getAllByText("Iran-first").length).toBeGreaterThan(0);
    expect(screen.getByText("Direct focus")).toBeTruthy();
    expect(screen.getByText("Global exception")).toBeTruthy();
    expect(screen.getByText("Neutral axis weights")).toBeTruthy();
    expect(screen.getByText("Active tuning state")).toBeTruthy();
    expect(screen.getByText("Regional escalation auto")).toBeTruthy();
    expect(screen.getByText(/Oil \/ energy shock >=14/)).toBeTruthy();
    expect(screen.getByText(/Global mega-event review pilot/)).toBeTruthy();
  });

  it("previews scoring policy results", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          audience_class: "global_exception",
          final_score: 16,
          threshold: 15,
          audience_confidence: 0.82,
          audience_reason: "Bitcoin milestone configured as a global exception.",
        },
      },
      error: null,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /preview with gpt-5\.4 mini/i }));

    await waitFor(() => expect(screen.getByText("global_exception")).toBeTruthy());
    expect(screen.getByText(/Score 16/)).toBeTruthy();
    expect(screen.getAllByText(/Bitcoin milestone/).length).toBeGreaterThan(0);
  });

  it("run eval surfaces transport failures when summary.failed_count > 0", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: {
        ok: true,
        summary: {
          accuracy: 0,
          correct: 0,
          profile_id: "iran-first",
          failed_count: 3,
        },
        results: [{}, {}, {}],
      },
      error: null,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /run 10-case eval/i }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /Evaluation accuracy: 0% on 0\/3 examples \(3 transport failures excluded from counts\)/,
        ),
      ).toBeTruthy(),
    );
  });

  it("run eval omits the transport-failure note when failed_count is 0", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: {
        ok: true,
        summary: {
          accuracy: 50,
          correct: 1,
          profile_id: "iran-first",
          failed_count: 0,
        },
        results: [{}, {}],
      },
      error: null,
    });

    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /run 10-case eval/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Evaluation accuracy: 50% on 1\/2 examples/),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/transport failure/)).toBeNull();
  });
});
