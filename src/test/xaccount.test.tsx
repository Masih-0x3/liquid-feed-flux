import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import XAccountDisabled from "@/pages/XAccountDisabled";
import { navigationItems } from "@/components/layout/navigation";
import { useFollowerSnapshots } from "@/hooks/useFollowerData";

vi.mock("@/hooks/useFollowerData", () => ({
  useFollowerSnapshots: vi.fn(),
}));

describe("XAccountDisabled", () => {
  it("renders disabled state without loading follower data", () => {
    render(
      <MemoryRouter initialEntries={["/x-account"]}>
        <XAccountDisabled />
      </MemoryRouter>,
    );

    expect(screen.getByText("My X is paused")).toBeTruthy();
    expect(screen.getByText(/Follower and following snapshots are disabled/)).toBeTruthy();
    expect(vi.mocked(useFollowerSnapshots)).not.toHaveBeenCalled();
  });

  it("removes My X from primary navigation", () => {
    expect(navigationItems.some((item) => item.url === "/x-account" || item.title === "My X")).toBe(false);
  });
});
