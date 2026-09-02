import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminActionClientError } from "@/api/adminActionErrors";
import { invokeAdminAction, invokeAdminRead } from "@/api/adminActions";
import { invokeAdminRetry, isAdminRetryCutoverBlocked } from "@/api/adminRetry";

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

describe("admin action API", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("normalizes Edge Function transport errors without exposing response details", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
          status: 401,
        }),
      },
    });

    const error = await invokeAdminAction({ action: "version" }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AdminActionClientError);
    expect(error).toMatchObject({
      code: "authorization_failed",
      status: 401,
      message: "You are not authorized to perform this action.",
    });
    expect((error as Error).message).not.toContain("Unauthorized: invalid token");
  });

  it("does not throw successful admin-action payload error text", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { success: false, error: "dashboard unavailable" },
      error: null,
    });

    const error = await invokeAdminAction({ action: "get_dashboard_summary" }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "admin_action_failed",
      message: "The action could not be completed.",
    });
    expect((error as Error).message).not.toContain("dashboard unavailable");
  });

  it("normalizes a rejected admin-action invocation without exposing its message", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("database credentials rejected"));

    const error = await invokeAdminAction({ action: "version" }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "admin_action_unavailable",
      message: "The service is temporarily unavailable.",
    });
    expect((error as Error).message).not.toContain("database credentials rejected");
  });

  it("uses the same normalized failure boundary for admin retries", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "provider credentials rejected",
        context: new Response("provider credentials rejected", { status: 503 }),
      },
    });

    const error = await invokeAdminRetry({ action: "test_webhook" }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "admin_action_unavailable",
      status: 503,
      message: "The service is temporarily unavailable.",
    });
    expect((error as Error).message).not.toContain("provider credentials rejected");
  });

  it("preserves the admin-retry cutover block for truthful webhook validation", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ code: "delivery_cutover_blocked" }), { status: 409 }),
      },
    });

    const error = await invokeAdminRetry({ action: "test_webhook" }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ status: 409 });
    expect(isAdminRetryCutoverBlocked(error)).toBe(true);
    expect(isAdminRetryCutoverBlocked({ status: 503 })).toBe(false);
  });

  it("keeps the bounded fifteen-second default for admin reads", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValueOnce(new Promise(() => undefined));
    const pending = expect(invokeAdminRead({ action: "version" })).rejects.toMatchObject({
      code: "admin_action_deadline_exceeded",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    vi.useRealTimers();
  });
});
