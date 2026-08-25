import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/components/layout/AppLayout";
import { navigationItems } from "@/components/layout/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRuntimeControls } from "@/hooks/useRuntimeControls";

vi.mock("@/components/layout/VersionBanner", () => ({
  VersionBanner: () => <div data-testid="version-banner" />,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/hooks/useRuntimeControls", () => ({
  useRuntimeControls: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseToast = vi.mocked(useToast);
const mockedUseRuntimeControls = vi.mocked(useRuntimeControls);

function renderLayout(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout>
        <div>Page content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

function renderNestedLayout(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<div>Nested outlet content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout", () => {
  const signOut = vi.fn();
  const refreshSession = vi.fn();
  const toast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    signOut.mockResolvedValue({ error: null });
    refreshSession.mockResolvedValue(undefined);
    mockedUseAuth.mockReturnValue({
      user: { id: "admin" },
      session: null,
      loading: false,
      status: "authorised",
      authError: null,
      role: "admin",
      isAdmin: true,
      signIn: vi.fn(),
      signOut,
      refreshSession,
    });
    mockedUseToast.mockReturnValue({
      toast,
      dismiss: vi.fn(),
      toasts: [],
    });
    mockedUseRuntimeControls.mockReturnValue({
      controls: {
        environment: 'preview',
        dedupe_enabled: false,
        translation_enabled: false,
        posting_mode: 'blocked',
        updated_at: '2026-08-25T00:00:00.000Z',
        updated_by: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("renders top navigation without the old sidebar trigger", () => {
    renderLayout("/");

    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle sidebar/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("renders a nested route through the shared shell outlet", () => {
    renderNestedLayout("/");

    expect(screen.getByText("Nested outlet content")).toBeInTheDocument();
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

  it("keeps the protected shell unmounted while authentication is degraded", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "admin" },
      session: null,
      loading: false,
      status: "degraded",
      authError: {
        operation: "role",
        message: "We could not verify your access level. Retry before continuing.",
      },
      role: null,
      isAdmin: false,
      signIn: vi.fn(),
      signOut,
      refreshSession,
    });

    renderLayout("/");

    expect(screen.getByText("Authentication needs attention")).toBeInTheDocument();
    expect(screen.queryByText("Page content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry authentication/i }));
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
  });

  it("keeps denied users out of the shell while allowing account switching", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "viewer" },
      session: null,
      loading: false,
      status: "denied",
      authError: null,
      role: "viewer",
      isAdmin: false,
      signIn: vi.fn(),
      signOut,
      refreshSession,
    });

    renderLayout("/");

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Page content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("renders the protected shell for read-only users with a persistent banner", () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "read-only" },
      session: null,
      loading: false,
      status: "authorised",
      authError: null,
      role: "read_only",
      isAdmin: false,
      signIn: vi.fn(),
      signOut,
      refreshSession,
    });

    renderLayout("/");

    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /read-only access/i })).toHaveTextContent(
      "Viewing only. Changes are disabled.",
    );
  });

  it("uses the runtime posting state instead of a hardcoded Preview label", async () => {
    mockedUseRuntimeControls.mockReturnValue({
      controls: {
        environment: 'production',
        dedupe_enabled: true,
        translation_enabled: true,
        posting_mode: 'enabled',
        updated_at: '2026-08-25T00:00:00.000Z',
        updated_by: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    renderLayout("/");

    expect(await screen.findByRole("status", { name: /posting status/i })).toHaveTextContent(
      "Posting enabled in Production",
    );
    expect(screen.queryByText("Posting locked in Preview")).not.toBeInTheDocument();
  });
});
