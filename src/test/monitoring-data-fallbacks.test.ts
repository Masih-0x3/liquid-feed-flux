import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMonitoringEntriesWithLegacyFallback, sanitizeMonitoringSearch } from "@/api/monitoringData";
import { invokeAdminAction } from "@/api/adminActions";
import { supabase } from "@/integrations/supabase/client";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
  },
}));

type QueryResult = {
  data: unknown[] | null;
  error: unknown;
};

function queryBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.range.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  return builder;
}

function legacyPost(overrides: Record<string, unknown> = {}) {
  return {
    tweet_id: "tweet-1",
    text_original: "original",
    text_translated: "",
    url: "https://x.com/source/status/tweet-1",
    created_at: "2026-06-14T12:00:00.000Z",
    translated_at: null,
    has_media: false,
    author_handle: "source",
    importance_score: 12,
    importance_tags: ["test"],
    delivery_decision: "deliver",
    accounts: { handle: "rss-feed" },
    ...overrides,
  };
}

describe("monitoring data fallbacks", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);
  const supabaseMock = vi.mocked(supabase);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
    mocks.from.mockReset();
  });

  it("sanitizes monitoring search for admin-action and legacy query inputs", () => {
    expect(sanitizeMonitoringSearch("%bad_(query), text")).toBe("bad query text");
  });

  it("uses admin-actions without touching legacy Supabase queries when available", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      success: true,
      entries: [{ tweet_id: "admin-row" }],
      next_cursor: 50,
    });

    const result = await fetchMonitoringEntriesWithLegacyFallback({
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
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("falls back to legacy queries only after the admin-action path fails", async () => {
    invokeAdminActionMock
      .mockRejectedValueOnce(new Error("edge function is behind"))
      .mockRejectedValueOnce(new Error("pipeline status unavailable"));
    mocks.from.mockReturnValueOnce(queryBuilder({ data: [legacyPost()], error: null }));

    const result = await fetchMonitoringEntriesWithLegacyFallback({
      pageParam: 0,
      filter: "all",
      search: "",
      scoreBucket: "any",
    });

    expect(result.source).toBe("legacy_queries");
    expect(result.fallbackReason).toBe("edge function is behind");
    expect(result.entries[0]).toMatchObject({
      tweet_id: "tweet-1",
      account_handle: "rss-feed",
      final_score: null,
    });
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("posts");
  });

  it("retries with the reduced legacy column set when production schema columns are missing", async () => {
    invokeAdminActionMock
      .mockRejectedValueOnce(new Error("edge function is behind"))
      .mockRejectedValueOnce(new Error("pipeline status unavailable"));
    mocks.from
      .mockReturnValueOnce(queryBuilder({ data: null, error: { message: "column posts.enrichment_version does not exist" } }))
      .mockReturnValueOnce(queryBuilder({ data: [legacyPost({ enrichment_version: undefined })], error: null }));

    const result = await fetchMonitoringEntriesWithLegacyFallback({
      pageParam: 0,
      filter: "all",
      search: "",
      scoreBucket: "any",
    });

    expect(result.source).toBe("legacy_queries");
    expect(result.entries).toHaveLength(1);
    expect(supabaseMock.from).toHaveBeenCalledTimes(2);
  });
});
