import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAdminAction } from "@/api/adminActions";
import {
  adminApproveEnrichment,
  adminGetXPostingDiagnostic,
  adminRecordScoreFeedback,
  adminRejectEnrichment,
  adminSetManualScore,
  defaultReasonTag,
} from "@/lib/monitoringActions";

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

const invokeAdminActionMock = vi.mocked(invokeAdminAction);

describe("monitoring action wrappers", () => {
  beforeEach(() => {
    invokeAdminActionMock.mockReset();
  });

  it("maps scoring feedback to the expected default reason tags", () => {
    expect(defaultReasonTag("global_exception_worth_covering", "global_exception")).toBe("global_mega_event");
    expect(defaultReasonTag("global_exception_worth_covering", "adjacent")).toBe("broad_global");
    expect(defaultReasonTag("should_skip", "direct_focus")).toBe("should_skip");
    expect(defaultReasonTag("wrong_relevance_class", "adjacent")).toBe("wrong_class");
    expect(defaultReasonTag("correct_deliver", "direct_focus")).toBe("direct_focus");
  });

  it("sends manual score payloads through the central admin client", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ ok: true, score: 15, threshold: 14, decision: "deliver" });

    await adminSetManualScore("tweet-1", 15, "operator note", "direct_focus", true, "adjacent");

    expect(invokeAdminActionMock).toHaveBeenCalledWith(
      {
        action: "set_manual_score",
        tweet_id: "tweet-1",
        score: 15,
        reason: "operator note",
        reason_tag: "direct_focus",
        override_duplicate: true,
        expected_audience_class: "adjacent",
      },
      { failureMessage: "Manual score failed" },
    );
  });

  it("records score feedback with derived reason_tag", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ ok: true, polarity: -1 });

    await adminRecordScoreFeedback("tweet-2", "should_skip", "direct_focus");

    expect(invokeAdminActionMock).toHaveBeenCalledWith(
      {
        action: "record_score_feedback",
        tweet_id: "tweet-2",
        feedback: "should_skip",
        expected_audience_class: "direct_focus",
        reason_tag: "should_skip",
      },
      { failureMessage: "Feedback failed" },
    );
  });

  it("returns the first X posting diagnostic item", async () => {
    const item = {
      tweet_id: "tweet-3",
      eligible: false,
      blockers: [{ code: "disabled", label: "X disabled", severity: "blocker" as const }],
      notes: [],
    };
    invokeAdminActionMock.mockResolvedValueOnce({ success: true, diagnostics: { items: [item] } });

    await expect(adminGetXPostingDiagnostic("tweet-3")).resolves.toEqual(item);
    expect(invokeAdminActionMock).toHaveBeenCalledWith(
      { action: "get_x_posting_diagnostics", tweet_id: "tweet-3" },
      { failureMessage: "X diagnostics unavailable" },
    );
  });

  it("uses literal action names for enrichment approval decisions", async () => {
    invokeAdminActionMock.mockResolvedValue({ ok: true });

    await adminApproveEnrichment("tweet-4");
    await adminRejectEnrichment("tweet-5");

    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      1,
      { action: "approve_enrichment", tweet_id: "tweet-4" },
      { failureMessage: "Enrichment action failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      2,
      { action: "reject_enrichment", tweet_id: "tweet-5" },
      { failureMessage: "Enrichment action failed" },
    );
  });
});
