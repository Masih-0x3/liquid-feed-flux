import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoRenderQueueRow } from '@/hooks/useVideoRenderData';

const videoHooks = vi.hoisted(() => ({
  useRetryVideoRender: vi.fn(),
  useSetVideoRenderReviewed: vi.fn(),
  useVideoRenderOverview: vi.fn(),
  useVideoRenderQueue: vi.fn(),
  reviewMutate: vi.fn(),
}));

vi.mock('@/hooks/useVideoRenderData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVideoRenderData')>();
  return {
    ...actual,
    useRetryVideoRender: videoHooks.useRetryVideoRender,
    useSetVideoRenderReviewed: videoHooks.useSetVideoRenderReviewed,
    useVideoRenderOverview: videoHooks.useVideoRenderOverview,
    useVideoRenderQueue: videoHooks.useVideoRenderQueue,
  };
});

vi.mock('@/components/video/ManualVideoIntakePanel', () => ({
  ManualVideoIntakePanel: () => <div>Manual intake</div>,
}));

vi.mock('@/components/video/VideoRenderDetailPanel', () => ({
  VideoRenderDetailPanel: () => <div>Render detail</div>,
}));

vi.mock('@/hooks/useDocumentVisibility', () => ({
  useDocumentVisibility: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, role: 'admin' }),
}));

import VideoRenders from '@/pages/VideoRenders';

const EMPTY_TIMING_METRICS: VideoRenderQueueRow['metrics'] = {
  total_ms: null,
  config_load_ms: null,
  source_lookup_ms: null,
  post_context_lookup_ms: null,
  download_ms: null,
  probe_ms: null,
  preflight_visual_ms: null,
  contact_sheet_ms: null,
  vision_frames_ms: null,
  vision_inspection_sheets_ms: null,
  local_ocr_ms: null,
  watermark_vision_ms: null,
  delogo_recovery_ms: null,
  audio_extract_ms: null,
  audio_extract_enhanced_ms: null,
  audio_extract_early_ms: null,
  transcription_ms: null,
  transcript_cleanup_ms: null,
  translation_ms: null,
  subtitle_generate_ms: null,
  encode_ms: null,
  upload_ms: null,
};

function renderRow(id: string, status: 'failed' | 'blocked', reviewedAt: string | null = null): VideoRenderQueueRow {
  return {
    id,
    tweet_id: `post-${id}`,
    source_media_id: `media-${id}`,
    status,
    failure_policy: 'post_original',
    render_version: 'v1',
    render_revision: 1,
    output_file_size: null,
    width: null,
    height: null,
    duration_ms: null,
    source_language: null,
    target_language: null,
    metrics: { ...EMPTY_TIMING_METRICS },
    error: 'render_failed',
    block_reason: null,
    attempts: 1,
    queued_at: '2026-07-10T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    failed_at: '2026-07-10T00:01:00.000Z',
    blocked_at: null,
    reviewed_at: reviewedAt,
    reviewed_by: reviewedAt ? '00000000-0000-4000-8000-000000000001' : null,
    updated_at: '2026-07-10T00:01:00.000Z',
    created_at: '2026-07-10T00:00:00.000Z',
    action_label: status,
    activity_at: '2026-07-10T00:01:00.000Z',
    post: null,
    media: null,
    latest_feedback: null,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VideoRenders />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('video renders review workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    videoHooks.useVideoRenderOverview.mockReturnValue({
      data: {
        config: { mode: 'enabled' },
        counts: { queued: 0, completed: 0, failed: 2, blocked: 0 },
        unreviewed_issues: 2,
        reviewed_issues: 0,
        medians: { total_ms: null },
        output_bytes_7d: 0,
        oldest_queued_at: null,
        heartbeats: [],
        renderer_health: {
          state: 'unavailable',
          server_observed_at: '2026-07-22T00:00:00.000Z',
          last_seen_at: null,
          age_ms: null,
          renderer_id: null,
          reported_status: null,
        },
      },
      isFetching: false,
      refetch: vi.fn(),
    });
    videoHooks.useVideoRenderQueue.mockReturnValue({
      data: {
        rows: [
          renderRow('00bf8307-38db-41f9-8594-06435247b1c1', 'failed'),
          renderRow('3b268a62-a906-4d84-9354-fb158f388667', 'failed'),
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    videoHooks.useRetryVideoRender.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isPendingFor: vi.fn(() => false),
    });
    videoHooks.useSetVideoRenderReviewed.mockReturnValue({ mutate: videoHooks.reviewMutate, isPending: false });
  });

  it('hides reviewed rows by default and bulk-marks only visible issues after confirmation', () => {
    renderPage();

    expect(videoHooks.useVideoRenderQueue).toHaveBeenCalledWith(
      ['queued', 'running', 'failed', 'blocked'],
      'unreviewed',
      { isVisible: true },
    );
    expect(videoHooks.useVideoRenderOverview).toHaveBeenCalledWith({ isVisible: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mark 2 reviewed' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));

    expect(videoHooks.reviewMutate).toHaveBeenCalledWith({
      render_ids: [
        '00bf8307-38db-41f9-8594-06435247b1c1',
        '3b268a62-a906-4d84-9354-fb158f388667',
      ],
      reviewed: true,
    });
  });

  it('can include reviewed history without changing the render status filter', () => {
    renderPage();

    fireEvent.click(screen.getByRole('switch', { name: 'Show reviewed' }));

    expect(videoHooks.useVideoRenderQueue).toHaveBeenLastCalledWith(
      ['queued', 'running', 'failed', 'blocked'],
      'all',
      { isVisible: true },
    );
  });

  it('renders compact selectable queue items without row lifecycle actions', () => {
    const nativeMatchMedia = window.matchMedia;
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...nativeMatchMedia(query),
      matches: query === '(min-width: 1024px)',
    }));
    renderPage();

    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    const rowButtons = screen.getAllByRole('button', { name: /render_failed/ });
    const firstId = '00bf8307-38db-41f9-8594-06435247b1c1';
    const secondId = '3b268a62-a906-4d84-9354-fb158f388667';
    const buttonsFor = (id: string) => screen.getAllByRole('button', { name: /render_failed/ })
      .filter((button) => button.getAttribute('data-render-id') === id);
    expect(buttonsFor(firstId).every((button) => button.getAttribute('aria-current') === 'true')).toBe(true);
    expect(screen.queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();

    fireEvent.click(buttonsFor(secondId)[0]);
    expect(buttonsFor(secondId).every((button) => button.getAttribute('aria-current') === 'true')).toBe(true);

    fireEvent.keyDown(buttonsFor(firstId)[0], { key: 'ArrowDown' });
    expect(buttonsFor(secondId).every((button) => button.getAttribute('aria-current') === 'true')).toBe(true);
    fireEvent.keyDown(buttonsFor(secondId)[0], { key: 'Home' });
    expect(buttonsFor(firstId).every((button) => button.getAttribute('aria-current') === 'true')).toBe(true);
    matchMediaSpy.mockRestore();
  });
});
