import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminOperationIdForBody,
  invokeAdminOperation,
  reconcileAdminOperation,
} from "@/api/adminOperationClient";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

describe("admin operation protocol client", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("returns unknown with the canonical identity when a mutation deadline expires", async () => {
    mocks.invoke.mockReturnValueOnce(new Promise(() => undefined));

    const result = await invokeAdminOperation(
      { action: "reprocess", tweet_id: "tweet-1" },
      { timeoutMs: 5 },
    );

    expect(result).toEqual({
      operation_id: "reprocess:tweet-1",
      operation_status: "unknown",
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("reconciles a late server success without retrying the timed-out mutation", async () => {
    let resolveServer!: (value: { data: unknown; error: null }) => void;
    const deferredServer = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveServer = resolve;
    });
    mocks.invoke.mockReturnValueOnce(deferredServer);

    const unknown = await invokeAdminOperation(
      { action: "reprocess", tweet_id: "late-race" },
      { timeoutMs: 5 },
    );
    expect(unknown).toEqual({
      operation_id: "reprocess:late-race",
      operation_status: "unknown",
    });

    resolveServer({
      data: { operation_id: "reprocess:late-race", operation_status: "committed" },
      error: null,
    });
    mocks.invoke.mockResolvedValueOnce({
      data: { operation_id: "reprocess:late-race", operation_status: "committed" },
      error: null,
    });
    const reconciled = await reconcileAdminOperation("reprocess:late-race");

    expect(reconciled.operation_status).toBe("committed");
    expect(mocks.invoke.mock.calls.filter(([name, options]) =>
      name === "admin-actions" && options?.body?.action === "reprocess")).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not reinterpret authorization or payload errors as unknown", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response("unauthorized", { status: 401 }) },
    });

    await expect(invokeAdminOperation({ action: "reprocess", tweet_id: "tweet-2" }))
      .rejects.toMatchObject({ code: "authorization_failed" });
  });

  it("preserves the server's four discriminated operation truths", async () => {
    for (const operation_status of ["committed", "failed", "still_running", "unknown"] as const) {
      mocks.invoke.mockResolvedValueOnce({
        data: { operation_id: "reprocess:truth", operation_status, success: true },
        error: null,
      });
      await expect(invokeAdminOperation({ action: "reprocess", tweet_id: "truth" }))
        .resolves.toMatchObject({ operation_id: "reprocess:truth", operation_status });
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
    expect(mocks.invoke.mock.calls[0][0]).toBe("admin-actions");
    expect(mocks.invoke.mock.calls[0][1]).toMatchObject({
      body: {
        action: "reprocess",
        tweet_id: "truth",
        operation_id: "reprocess:truth",
      },
    });
  });

  it("reconciles through the admin-only status action without retrying the mutation", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { operation_id: "hydrate:manual_monitoring:late", operation_status: "still_running" },
      error: null,
    });
    mocks.invoke.mockResolvedValueOnce({
      data: { operation_id: "hydrate:manual_monitoring:late", operation_status: "committed" },
      error: null,
    });

    const first = await invokeAdminOperation({ action: "hydrate_post", tweet_id: "late" });
    const final = await reconcileAdminOperation("hydrate:manual_monitoring:late");

    expect(first.operation_status).toBe("still_running");
    expect(final.operation_status).toBe("committed");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[1][1]).toMatchObject({
      body: {
        action: "get_admin_operation_status",
        operation_id: "hydrate:manual_monitoring:late",
      },
    });
  });

  it("fails closed for unsupported action identities and mismatched server identities", async () => {
    expect(() => adminOperationIdForBody({ action: "run_dedupe", tweet_id: "t1" }))
      .toThrowError(/request could not be accepted/i);
    mocks.invoke.mockResolvedValueOnce({
      data: { operation_id: "reprocess:other", operation_status: "still_running" },
      error: null,
    });
    await expect(invokeAdminOperation({ action: "reprocess", tweet_id: "t1" }))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects ambiguous or malformed tweet ids before creating an operation identity", () => {
    for (const tweetId of ["abc:def", " tweet-1", "tweet-1 ", "tweet/1", ""]) {
      expect(() => adminOperationIdForBody({ action: "reprocess", tweet_id: tweetId }))
        .toThrowError(/request could not be accepted/i);
    }
  });
});
