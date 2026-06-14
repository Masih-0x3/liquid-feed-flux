import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/components/layout/AppLayout";
import { navigationItems } from "@/components/layout/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

vi.mock("@/components/layout/VersionBanner", () => ({
  VersionBanner: () => <div data-testid="version-banner" />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseToast = vi.mocked(useToast);

function renderLayout(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div>Page content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  const signOut = vi.fn();
  const toast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    signOut.mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue({
      user: { id: "admin" },
      session: null,
      loading: false,
      role: "admin",
      isAdmin: true,
      signIn: vi.fn(),
      signOut,
    });
    mockedUseToast.mockReturnValue({
      toast,
      dismiss: vi.fn(),
      toasts: [],
    });
  });

  it("renders top navigation without the old sidebar trigger", () => {
    renderLayout("/");

    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle sidebar/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it.each([
    ["/", "Dashboard"],
    ["/monitoring", "Monitoring"],
    ["/video-renders", "Video"],
    ["/threads", "Threads"],
    ["/downloader", "Downloader"],
    ["/settings", "Settings"],
  ])("marks %s as the active top-nav route", (path, title) => {
    renderLayout(path);

    const activeLink = screen.getAllByRole("link", { name: title }).find((link) =>
      link.getAttribute("aria-current") === "page"
    );
    expect(activeLink).toBeTruthy();

    navigationItems
      .filter((item) => item.title !== title)
      .forEach((item) => {
        const activeOther = screen.getAllByRole("link", { name: item.title }).find((link) =>
          link.getAttribute("aria-current") === "page"
        );
        expect(activeOther).toBeUndefined();
      });
  });

  it("signs out from the top bar", async () => {
    renderLayout("/");

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({
      title: "Signed out successfully",
      description: "You have been logged out of the XOT Panel.",
    });
  });
});
