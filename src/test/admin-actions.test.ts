import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAdminAction } from "@/api/adminActions";

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

  it("includes Edge Function response details when the SDK returns a non-2xx error", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
          status: 401,
        }),
      },
    });

    await expect(invokeAdminAction({ action: "version" })).rejects.toThrow(
      "Edge Function 401: Unauthorized: invalid token",
    );
  });

  it("still surfaces successful admin-action payload errors", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { success: false, error: "dashboard unavailable" },
      error: null,
    });

    await expect(invokeAdminAction({ action: "get_dashboard_summary" })).rejects.toThrow(
      "dashboard unavailable",
    );
  });
});
