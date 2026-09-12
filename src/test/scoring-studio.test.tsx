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
    expect(screen.getByText(/Saved delivery gate: Legacy content filter/)).toBeTruthy();
    expect(screen.getByText(/No score on the 1–20 scale can pass/)).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Off topic threshold" })).toBeNull();
    expect(screen.getByText("Profile tuning reference")).toBeTruthy();
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
    expect(vi.mocked(supabase.functions.invoke)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run scoring preview" }));

    await waitFor(() => expect(screen.getByText("global_exception")).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText(/Score 16/)).toBeTruthy();
    expect(screen.getAllByText(/Bitcoin milestone/).length).toBeGreaterThan(0);
  });
});

for (const { accuracy, correct, evaluated, failed, expected } of [
  { accuracy: 100, correct: 1, evaluated: 1, failed: 2, expected: "Evaluation accuracy: 100% on 1/1 evaluated examples; 2 scoring failures excluded" },
  { accuracy: null, correct: 0, evaluated: 0, failed: 3, expected: "Evaluation accuracy: n/a on 0/0 evaluated examples; 3 scoring failures excluded" },
]) {
  it(`shows the evaluated denominator for ${failed} failed scoring calls`, async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: { ok: true, summary: { accuracy, correct, evaluated_count: evaluated, failed_count: failed }, results: [{}, {}, {}] },
      error: null,
    });
    renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /run 10-case eval/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
}
