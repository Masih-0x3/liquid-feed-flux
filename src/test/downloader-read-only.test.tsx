import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeAdminAction: vi.fn(),
  useAuth: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/api/adminActions", () => ({
  invokeAdminAction: mocks.invokeAdminAction,
  invokeAdminRead: mocks.invokeAdminAction,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import Downloader from "@/pages/Downloader";
import { MemoryRouter } from "react-router-dom";

describe("Downloader read-only boundary", () => {
  beforeEach(() => {
    mocks.invokeAdminAction.mockReset();
    mocks.useAuth.mockReset();
    mocks.useAuth.mockReturnValue({ role: "read_only" });
  });

  it("does not submit resolve_x_media for read-only users", () => {
    render(<MemoryRouter><Downloader /></MemoryRouter>);

    const input = screen.getByPlaceholderText("https://x.com/username/status/1234567890");
    const form = input.closest("form");
    expect(form).not.toBeNull();
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    expect(input).toBeDisabled();

    fireEvent.submit(form as HTMLFormElement);

    expect(mocks.invokeAdminAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "An administrator account is required to preview or download archived media.",
    );
  });
});


describe("Downloader archive lookup", () => {
  beforeEach(() => { mocks.invokeAdminAction.mockReset(); mocks.useAuth.mockReturnValue({ role: "admin" }); });
  it("links invalid URL feedback to the input without calling a provider", () => {
    render(<MemoryRouter><Downloader /></MemoryRouter>);
    const input = screen.getByLabelText("X or Twitter post URL");
    fireEvent.change(input, { target: { value: "https://example.com/status/123" } });
    fireEvent.submit(input.closest("form")!);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "downloader-help downloader-error");
    expect(input).toHaveValue("https://example.com/status/123");
    expect(mocks.invokeAdminAction).not.toHaveBeenCalled();
  });
  it("explains archive-only access before doing a bounded archive lookup", async () => {
    mocks.invokeAdminAction.mockResolvedValue({ ok: false, code: "media_post_not_archived" });
    render(<MemoryRouter><Downloader /></MemoryRouter>);
    expect(screen.getByText(/This lookup is read-only and does not call X/)).toBeInTheDocument();
    const input = screen.getByLabelText("X or Twitter post URL");
    fireEvent.change(input, { target: { value: "https://x.com/example/status/123" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("This post is not in the archive");
    expect(mocks.invokeAdminAction).toHaveBeenCalledWith({ action: "get_media_catalog", tweet_id: "123" }, { throwOnFailure: false });
  });
});
