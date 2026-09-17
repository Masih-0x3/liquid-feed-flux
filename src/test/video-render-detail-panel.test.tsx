import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('keeps the feedback Select controlled while feedback state hydrates', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(<VideoRenderDetailPanel renderId="render-1" status="failed" />);
    const detail = videoHooks.useVideoRenderDetail.mock.results[0]?.value;

    videoHooks.useVideoRenderDetail.mockReturnValue({
      ...detail,
      data: {
        ...detail.data,
        feedback: [{ id: 'feedback-1', label: 'pass', note: null, created_at: '2026-08-12T00:00:00.000Z' }],
      },
    });
    rerender(<VideoRenderDetailPanel renderId="render-1" status="failed" />);

    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('Select is changing from uncontrolled to controlled'));
    warning.mockRestore();
  });

  it.each([
    ['translated subtitle', 'Translated cue', 'Legacy cue', 'Translated cue'],
    ['legacy fallback', '   ', 'Legacy cue', 'Legacy cue'],
  ])('displays populated %s with Persian direction while media remains contained', (_name, translated, legacy, expected) => {
    const detail = videoHooks.useVideoRenderDetail.getMockImplementation()?.();
    videoHooks.useVideoRenderDetail.mockReturnValue({
      ...detail,
      data: { ...detail.data, render: {
        ...detail.data.render,
        target_language: 'fa',
        translated_srt: translated,
        persian_srt: legacy,
      } },
    });
    const { container } = render(<VideoRenderDetailPanel renderId="render-1" status="failed" />);
    expect(screen.getByText('Final subtitle')).toBeInTheDocument();
    expect(container.querySelector('pre')).toHaveTextContent(expected);
    expect(container.querySelector('pre')).toHaveAttribute('lang', 'fa');
    expect(container.querySelector('pre')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'Preview rendered output' })).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
    expect(container.querySelector('video, audio, source, iframe')).toBeNull();
  });
  it('requires confirmation before a retry can invoke processing', () => {
    render(<VideoRenderDetailPanel renderId="render-1" status="failed" />);
    const retry = videoHooks.useRetryVideoRender.mock.results[0].value.mutate;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation).toHaveTextContent('paid transcription, translation and rendering resources');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Retry render' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith({ render_id: 'render-1' });
  });

});
