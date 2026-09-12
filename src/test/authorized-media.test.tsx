import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invokeAdminRead: vi.fn() }));
vi.mock('@/api/adminActions', () => mocks);
import { AuthorizedMedia } from '@/components/media/AuthorizedMedia';
import { getMediaCatalog, validateMediaGrant } from '@/api/mediaAccess';

const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const target = { tweetId: '123', mediaId: '11111111-1111-4111-8111-111111111111' };
function grant(overrides = {}) {
  return {
    id: target.mediaId, tweet_id: target.tweetId, source: 'source', kind: 'video', mime_type: 'video/mp4',
    file_size: 256, width: 1280, height: 720, duration_ms: 1000, purpose: 'preview', provenance: 'private_archive',
    signed_url: `${origin}/storage/v1/object/sign/temp-media/2026/9/source.mp4?token=synthetic`,
    expires_at: new Date(Date.now() + 120_000).toISOString(), filename: 'xot-source.mp4', ...overrides,
  };
}

describe('authorized browser media boundary', () => {
  beforeEach(() => { vi.stubEnv('VITE_SUPABASE_URL', origin); mocks.invokeAdminRead.mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('does not load a media URL before explicit authorization and uses video semantics', async () => {
    mocks.invokeAdminRead.mockResolvedValue({ ok: true, asset: grant() });
    const view = render(<AuthorizedMedia {...target} title="Source video" />);
    expect(view.container.querySelector('video, img, a')).toBeNull();
    expect(mocks.invokeAdminRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview source video' }));
    await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
    expect(view.container.querySelector('img')).toBeNull();
    expect(mocks.invokeAdminRead).toHaveBeenCalledWith({ action: 'get_media_access', tweet_id: '123', media_id: target.mediaId, purpose: 'preview' }, { throwOnFailure: false });
  });

  it('keeps access denied, expired and missing-output states actionable with no media sink', async () => {
    const view = render(<AuthorizedMedia {...target} title="Source video" />);
    for (const [code, message] of [['media_access_denied', 'An administrator account is required'], ['media_expired', 'has expired'], ['media_not_ready', 'still processing']]) {
      mocks.invokeAdminRead.mockResolvedValueOnce({ ok: false, code });
      fireEvent.click(screen.getByRole('button', { name: 'Preview source video' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
      expect(view.container.querySelector('video, img, a')).toBeNull();
    }
  });

  it('expires a loaded grant and clears it immediately when role or target changes', async () => {
    vi.useFakeTimers();
    mocks.invokeAdminRead.mockImplementation(async () => ({ ok: true, asset: grant({ expires_at: new Date(Date.now() + 1000).toISOString() }) }));
    const view = render(<AuthorizedMedia {...target} title="Source video" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview source video' })); });
    expect(view.container.querySelector('video')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(view.container.querySelector('video')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('has expired');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview source video' })); });
    expect(view.container.querySelector('video')).not.toBeNull();
    view.rerender(<AuthorizedMedia {...target} title="Source video" readOnly />);
    expect(view.container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview source video' })).toBeDisabled();
    view.rerender(<AuthorizedMedia {...target} title="Source video" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview source video' })); });
    view.rerender(<AuthorizedMedia {...target} tweetId="456" title="Another video" />);
    expect(view.container.querySelector('video')).toBeNull();
  });

  it('shows a download link only after a matching download grant, and renders images as images', async () => {
    const filename = 'xot-source.png';
    mocks.invokeAdminRead.mockResolvedValue({ ok: true, asset: grant({ kind: 'image', mime_type: 'image/png', purpose: 'download', filename, signed_url: `${origin}/storage/v1/object/sign/temp-media/photo.png?token=synthetic&download=${filename}` }) });
    const view = render(<AuthorizedMedia {...target} title="Source image" />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare download for source image' }));
    const link = await screen.findByRole('link', { name: 'Download source image' });
    expect(link).toHaveAttribute('download', filename);
    expect(view.container.querySelector('video')).toBeNull();
    mocks.invokeAdminRead.mockResolvedValue({ ok: true, asset: grant({ kind: 'image', mime_type: 'image/png', filename, signed_url: `${origin}/storage/v1/object/sign/temp-media/photo.png?token=synthetic` }) });
    fireEvent.click(screen.getByRole('button', { name: 'Preview source image' }));
    expect(await screen.findByRole('img', { name: 'Source image' })).toBeInTheDocument();
  });

  it.each([
    { signed_url: 'https://video.twimg.com/provider.mp4' },
    { signed_url: `${origin}/storage/v1/object/public/temp-media/source.mp4?token=synthetic` },
    { tweet_id: '456' }, { id: 'different-media' }, { kind: 'image' }, { mime_type: 'image/svg+xml' },
    { expires_at: '2000-01-01T00:00:00Z' }, { expires_at: '2100-01-01T00:00:00Z' }, { provenance: 'provider' },
    { file_size: -1 }, { filename: null },
    { signed_url: `${origin}/storage/v1/object/sign/temp-media/source%2emp4?token=synthetic` },
  ])('rejects a substituted or expired grant: %o', (patch) => {
    expect(validateMediaGrant(grant(patch), target, 'preview', origin)).toBeNull();
  });
  it('fails closed for malformed or cross-post archive catalogs', async () => {
    for (const reply of [{ ok: true, tweet_id: '456', assets: [] }, { ok: true, tweet_id: '123', assets: [null] }]) {
      mocks.invokeAdminRead.mockResolvedValueOnce(reply);
      expect(await getMediaCatalog('123')).toEqual({ ok: false, code: 'media_access_unavailable', assets: [] });
    }
  });
});
