import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFollowersSnapshot } from "@/api/xAccountData";
import { invokeAdminAction } from "@/api/adminActions";

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: vi.fn(),
}));

describe("x account data API", () => {
  const invokeAdminActionMock = vi.mocked(invokeAdminAction);

  beforeEach(() => {
    invokeAdminActionMock.mockReset();
  });

  it("runs follower snapshots through the admin-actions contract", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({
      ok: true,
      follower_count: 120,
      api_calls_used: 2,
    });

    const result = await runFollowersSnapshot({ force: true, includeFollowing: true });

    expect(result.follower_count).toBe(120);
    expect(invokeAdminActionMock).toHaveBeenCalledWith(
      { action: "run_followers_snapshot", include_following: true, force: true },
      { throwOnFailure: false },
    );
  });

  it("throws the action error when the snapshot fails", async () => {
    invokeAdminActionMock.mockResolvedValueOnce({ ok: false, error: "X API unavailable" });

    await expect(runFollowersSnapshot()).rejects.toThrow("X API unavailable");
  });
});
