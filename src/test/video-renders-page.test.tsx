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

import VideoRenders from '@/pages/VideoRenders';

function renderRow(id: string, status: 'failed' | 'blocked', reviewedAt: string | null = null): VideoRenderQueueRow {
  return {
    id,
    tweet_id: `post-${id}`,
    source_media_id: `media-${id}`,
    status,
    failure_policy: 'post_original',
    render_version: 'v1',
    output_storage_path: null,
    output_file_size: null,
    width: null,
    height: null,
    duration_ms: null,
    source_language: null,
    target_language: null,
    metrics: {},
    error: 'Historical renderer outage',
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
    preflight: {},
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
    videoHooks.useRetryVideoRender.mockReturnValue({ mutate: vi.fn(), isPending: false });
    videoHooks.useSetVideoRenderReviewed.mockReturnValue({ mutate: videoHooks.reviewMutate, isPending: false });
  });

  it('hides reviewed rows by default and bulk-marks only visible issues after confirmation', () => {
    renderPage();

    expect(videoHooks.useVideoRenderQueue).toHaveBeenCalledWith(
      ['queued', 'running', 'failed', 'blocked'],
      'unreviewed',
    );
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
    );
  });
});
