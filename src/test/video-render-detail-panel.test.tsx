import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const videoHooks = vi.hoisted(() => ({
  useRetryVideoRender: vi.fn(),
  useSaveVideoRenderFeedback: vi.fn(),
  useSetVideoRenderReviewed: vi.fn(),
  useVideoRenderDetail: vi.fn(),
}));

vi.mock('@/hooks/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
vi.mock('@/hooks/useVideoRenderData', () => videoHooks);

import { VideoRenderDetailPanel } from '@/components/video/VideoRenderDetailPanel';

describe('video render detail review states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    videoHooks.useRetryVideoRender.mockReturnValue({ mutate: vi.fn(), isPendingFor: vi.fn(() => false) });
    videoHooks.useSaveVideoRenderFeedback.mockReturnValue({ mutate: vi.fn(), isPendingFor: vi.fn(() => false) });
    videoHooks.useSetVideoRenderReviewed.mockReturnValue({ mutate: vi.fn(), isPending: false });
    videoHooks.useVideoRenderDetail.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        ok: true,
        render: {
          id: 'render-1',
          status: 'failed',
          reviewed_at: null,
          action_label: 'failed',
          attempts: 1,
          updated_at: '2026-08-12T00:00:00.000Z',
          render_version: 'v1',
          render_revision: 1,
          metrics: {},
          output_file_size: null,
          source_language: null,
          target_language: null,
          translated_srt: '   ',
          persian_srt: '\n  ',
          error: 'render_failed',
          block_reason: null,
        },
        feedback: [],
      },
    });
  });

  it('requires an explicit label for a failed render and omits empty subtitle and duplicate status UI', () => {
    render(<VideoRenderDetailPanel renderId="render-1" status="failed" />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Choose a label')).toBeInTheDocument();
    expect(screen.queryByText('Final subtitle')).not.toBeInTheDocument();
    expect(screen.getAllByText('failed')).toHaveLength(1);
  });
});
