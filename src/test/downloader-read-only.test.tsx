import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeAdminAction: vi.fn(),
  useAuth: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: mocks.invokeAdminAction,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import Downloader from "@/pages/Downloader";

describe("Downloader read-only boundary", () => {
  beforeEach(() => {
    mocks.invokeAdminAction.mockReset();
    mocks.useAuth.mockReset();
    mocks.useAuth.mockReturnValue({ role: "read_only" });
  });

  it("does not submit resolve_x_media for read-only users", () => {
    render(<Downloader />);

    const input = screen.getByPlaceholderText("https://x.com/username/status/1234567890");
    const form = input.closest("form");
    expect(form).not.toBeNull();
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    expect(input).toBeDisabled();

    fireEvent.submit(form as HTMLFormElement);

    expect(mocks.invokeAdminAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Media metadata lookup is unavailable for read-only access.",
    );
  });
});
