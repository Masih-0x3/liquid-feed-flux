import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMonitoringEntries, sanitizeMonitoringSearch } from "@/api/monitoringData";
import { invokeAdminAction } from "@/api/adminActions";
import { FILTERS } from "@/lib/monitoringViewModel";

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

describe("monitoring data API", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
  });

  it("sanitizes monitoring search for admin-action inputs", () => {
    expect(sanitizeMonitoringSearch("%bad_(query), text")).toBe("bad query text");
  });

  it("loads monitoring entries through admin-actions", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      success: true,
      entries: [{ tweet_id: "admin-row" }],
      next_cursor: 50,
    });

    const result = await fetchMonitoringEntries({
      pageParam: 0,
      filter: "all",
      search: "%admin_(search)",
      scoreBucket: "any",
    });

    expect(result.source).toBe("admin_actions");
    expect(result.nextCursor).toBe(50);
    expect(result.entries).toEqual([{ tweet_id: "admin-row" }]);
    expect(invokeAdminActionMock).toHaveBeenCalledWith({
      action: "get_monitoring_entries",
      filter: "all",
      search: "admin search",
      score_bucket: "any",
      cursor: 0,
      limit: 50,
    });
  });

  it.each(FILTERS.map((filter) => filter.value))("forwards %s filtering to admin-actions", async (filter) => {
    invokeAdminActionMock.mockResolvedValueOnce({
      success: true,
      entries: [],
      next_cursor: null,
    });

    await fetchMonitoringEntries({
      pageParam: 25,
      filter,
      search: "",
      scoreBucket: "any",
    });

    expect(invokeAdminActionMock).toHaveBeenCalledWith({
      action: "get_monitoring_entries",
      filter,
      search: undefined,
      score_bucket: "any",
      cursor: 25,
      limit: 50,
    });
  });

  it("surfaces admin-action errors", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ success: false, error: "monitoring unavailable" });

    await expect(fetchMonitoringEntries({
      pageParam: 0,
      filter: "all",
      search: "",
      scoreBucket: "any",
    })).rejects.toThrow("monitoring unavailable");
  });
});
