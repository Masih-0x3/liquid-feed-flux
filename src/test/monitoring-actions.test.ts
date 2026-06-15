import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAdminAction } from "@/api/adminActions";
import {
  adminApproveEnrichment,
  adminCancelPendingJobs,
  adminClearDup,
  adminCloseStaleXPending,
  adminEnrichPost,
  adminGetXPostingDiagnostic,
  adminHydratePost,
  adminIgnoreMonitoringItem,
  adminIgnoreMonitoringItems,
  adminRecordScoreFeedback,
  adminReprocessBatch,
  adminRejectEnrichment,
  adminRescorePost,
  adminRetryXPost,
  adminRunDedupe,
  adminSetManualScore,
  adminTranslatePost,
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
    const response = {
      ok: true,
      score: 15,
      threshold: 14,
      decision: "deliver",
      advance: { queued: "deliver", reason: "score cleared threshold" },
    };
    invokeAdminActionMock.mockResolvedValueOnce(response);

    await expect(adminSetManualScore("tweet-1", 15, "operator note", "direct_focus", true, "adjacent")).resolves.toEqual(response);

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
    const response = { ok: true, polarity: -1 };
    invokeAdminActionMock.mockResolvedValueOnce(response);

    await expect(adminRecordScoreFeedback("tweet-2", "should_skip", "direct_focus")).resolves.toEqual(response);

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

  it("passes through typed responses for single-post pipeline actions", async () => {
    const hydrate = { ok: true, queued: false, reason: "existing hydrate job" };
    const retryX = { ok: true, status: "posted", x_tweet_id: "12345" };
    const rescore = { ok: true, final_score: 17, decision: "deliver", decision_reason: "direct focus" };
    const translate = { ok: true, translated: "translated text", model: "gpt-5-mini" };
    const dedupe = { ok: true, result: { status: "unique", reason: "no close match", dup_of_tweet_id: null } };
    const clearDup = { success: true };

    invokeAdminActionMock
      .mockResolvedValueOnce(hydrate)
      .mockResolvedValueOnce(retryX)
      .mockResolvedValueOnce(rescore)
      .mockResolvedValueOnce(translate)
      .mockResolvedValueOnce(dedupe)
      .mockResolvedValueOnce(clearDup);

    await expect(adminHydratePost("tweet-6")).resolves.toEqual(hydrate);
    await expect(adminRetryXPost("tweet-7")).resolves.toEqual(retryX);
    await expect(adminRescorePost("tweet-8")).resolves.toEqual(rescore);
    await expect(adminTranslatePost("tweet-9")).resolves.toEqual(translate);
    await expect(adminRunDedupe("tweet-10")).resolves.toEqual(dedupe);
    await expect(adminClearDup("tweet-11", "tweet-12")).resolves.toEqual(clearDup);

    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      1,
      { action: "hydrate_post", tweet_id: "tweet-6" },
      { failureMessage: "Hydrate failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      2,
      { action: "retry_x_post", tweet_id: "tweet-7" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      3,
      { action: "rescore_post", tweet_id: "tweet-8" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      4,
      { action: "translate_post", tweet_id: "tweet-9", mode: "translation_only" },
      { failureMessage: "Translation failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      5,
      {
        action: "run_dedupe",
        tweet_id: "tweet-10",
        force: true,
        enqueue_next: true,
      },
      { failureMessage: "Duplicate check failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      6,
      { action: "clear_dup", tweet_id: "tweet-11", related_tweet_id: "tweet-12" },
    );
  });

  it("passes through typed responses for bulk and cleanup actions", async () => {
    const bulkReprocess = { ok: true, requested: 3, queued: 2, message: "queued" };
    const ignored = { ok: true, closed: { x_deliveries: 1, deliveries: 2, jobs: 3 } };
    const bulkIgnored = {
      ok: true,
      requested: 2,
      found: 2,
      ignored: 1,
      missing: ["tweet-15"],
      closed: { x_deliveries: 2, deliveries: 1, jobs: 4 },
      results: [
        { tweet_id: "tweet-13", ok: true, closed: { x_deliveries: 1, deliveries: 1, jobs: 1 } },
        { tweet_id: "tweet-15", ok: false, error: "missing" },
      ],
    };
    const closeStale = { closed: 5 };
    const cancelJobs = { canceled: 7 };

    invokeAdminActionMock
      .mockResolvedValueOnce(bulkReprocess)
      .mockResolvedValueOnce(ignored)
      .mockResolvedValueOnce(bulkIgnored)
      .mockResolvedValueOnce(closeStale)
      .mockResolvedValueOnce(cancelJobs);

    await expect(adminReprocessBatch(["tweet-13", "tweet-14"])).resolves.toEqual(bulkReprocess);
    await expect(adminIgnoreMonitoringItem("tweet-13")).resolves.toEqual(ignored);
    await expect(adminIgnoreMonitoringItems(["tweet-13", "tweet-15"])).resolves.toEqual(bulkIgnored);
    await expect(adminCloseStaleXPending()).resolves.toEqual(closeStale);
    await expect(adminCancelPendingJobs()).resolves.toEqual(cancelJobs);

    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      1,
      { action: "bulk_reprocess", tweet_ids: ["tweet-13", "tweet-14"] },
      { failureMessage: "Bulk reprocess failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      2,
      { action: "ignore_monitoring_item", tweet_id: "tweet-13", reason: "reviewed_and_ignored" },
      { failureMessage: "Ignore failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      3,
      { action: "bulk_ignore", tweet_ids: ["tweet-13", "tweet-15"], reason: "reviewed_and_ignored" },
      { failureMessage: "Bulk ignore failed" },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      4,
      { action: "summarize_stale_x_pending", older_than_hours: 24, close: true },
    );
    expect(invokeAdminActionMock).toHaveBeenNthCalledWith(
      5,
      { action: "cancel_pending_jobs" },
    );
  });

  it("passes through typed responses for enrichment queueing", async () => {
    const response = {
      ok: true,
      worker_dispatch: { ok: false, error: "worker unavailable" },
      translation_preflight: { ok: true },
    };
    invokeAdminActionMock.mockResolvedValueOnce(response);

    await expect(adminEnrichPost("tweet-16")).resolves.toEqual(response);
    expect(invokeAdminActionMock).toHaveBeenCalledWith(
      { action: "enrich_post", tweet_id: "tweet-16" },
      { failureMessage: "Failed to queue enrichment" },
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
