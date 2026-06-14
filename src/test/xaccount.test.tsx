import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import XAccountDisabled from "@/pages/XAccountDisabled";
import { navigationItems } from "@/components/layout/navigation";

describe("XAccountDisabled", () => {
  it("renders disabled state without follower controls", () => {
    render(
      <MemoryRouter initialEntries={["/x-account"]}>
        <XAccountDisabled />
      </MemoryRouter>,
    );

    expect(screen.getByText("My X is paused")).toBeTruthy();
    expect(screen.getByText(/Follower and following snapshots are disabled/)).toBeTruthy();
    expect(screen.getByText("Owned reads disabled")).toBeTruthy();
    expect(screen.getByRole("link", { name: /X automation settings/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Monitoring/i })).toBeTruthy();
    expect(screen.queryByText(/Run snapshot/i)).toBeNull();
    expect(screen.queryByText(/Follower Growth/i)).toBeNull();
  });

  it("removes My X from primary navigation", () => {
    expect(navigationItems.some((item) => item.url === "/x-account" || item.title === "My X")).toBe(false);
  });
});
