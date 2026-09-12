import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => { vi.unstubAllEnvs(); });
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
    expect(mocks.invokeAdminAction).toHaveBeenCalledWith({ action: "get_media_catalog", tweet_id: "https://x.com/example/status/123" }, { throwOnFailure: false });
  });

  it.each(["https://twitter.com/Archive_News/status/2092144212879765707", "2092144212879765707"])("uses the resolved archive identity for preview and download: %s", async (storedId) => {
    const origin = "https://abcdefghijklmnopqrst.supabase.co";
    vi.stubEnv("VITE_SUPABASE_URL", origin);
    const renderId = "33333333-3333-4333-8333-333333333333";
    const filename = "xot-2092144212879765707-output-33333333.mp4";
    const asset = { id: renderId, source: "output", kind: "video", mime_type: "video/mp4", file_size: 6652812, available: true };
    mocks.invokeAdminAction.mockResolvedValueOnce({ ok: true, tweet_id: storedId, assets: [asset] });
    const view = render(<MemoryRouter><Downloader /></MemoryRouter>);
    const input = screen.getByLabelText("X or Twitter post URL");
    const reference = "https://x.com/archive_news/status/2092144212879765707?s=20";
    fireEvent.change(input, { target: { value: reference } });
    fireEvent.submit(input.closest("form")!);
    const preview = await screen.findByRole("button", { name: "Preview output video 1" });
    expect(mocks.invokeAdminAction).toHaveBeenCalledWith({ action: "get_media_catalog", tweet_id: reference }, { throwOnFailure: false });
    const grant = { ...asset, tweet_id: storedId, filename, expires_at: new Date(Date.now() + 120_000).toISOString(), provenance: "private_archive" };
    mocks.invokeAdminAction.mockResolvedValueOnce({ ok: true, asset: { ...grant, purpose: "preview", signed_url: `${origin}/storage/v1/object/sign/temp-media/output.mp4?token=synthetic` } });
    fireEvent.click(preview);
    await waitFor(() => expect(view.container.querySelector("video")).not.toBeNull());
    expect(mocks.invokeAdminAction).toHaveBeenLastCalledWith({ action: "get_media_access", tweet_id: storedId, render_id: renderId, purpose: "preview" }, { throwOnFailure: false });
    mocks.invokeAdminAction.mockResolvedValueOnce({ ok: true, asset: { ...grant, purpose: "download", signed_url: `${origin}/storage/v1/object/sign/temp-media/output.mp4?token=synthetic&download=${filename}` } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare download for output video 1" }));
    expect(await screen.findByRole("link", { name: "Download output video 1" })).toHaveAttribute("download", filename);
    expect(mocks.invokeAdminAction).toHaveBeenLastCalledWith({ action: "get_media_access", tweet_id: storedId, render_id: renderId, purpose: "download" }, { throwOnFailure: false });
  });

  it("reports ambiguous archive records without exposing preview controls", async () => {
    mocks.invokeAdminAction.mockResolvedValueOnce({ ok: false, code: "media_post_ambiguous" });
    render(<MemoryRouter><Downloader /></MemoryRouter>);
    const input = screen.getByLabelText("X or Twitter post URL");
    fireEvent.change(input, { target: { value: "https://x.com/example/status/123" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("matches multiple archive records");
    expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
  });
});
