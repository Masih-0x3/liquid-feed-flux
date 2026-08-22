import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const videoHooks = vi.hoisted(() => ({
  useRetryVideoRender: vi.fn(),
  useSaveVideoRenderFeedback: vi.fn(),
  useSetVideoRenderReviewed: vi.fn(),
  useVideoRenderDetail: vi.fn(),
}));

vi.mock('@/hooks/useDocumentVisibility', () => ({ useDocumentVisibility: () => true }));
vi.mock('@/hooks/useVideoRenderData', () => videoHooks);

import { MonitoringDuplicateGateCard } from '@/components/monitoring/MonitoringDuplicateGateCard';
import { MonitoringDetailDrawer } from '@/components/monitoring/MonitoringDetailDrawer';
import { MonitoringFilters } from '@/components/monitoring/MonitoringFilters';
import { VideoRenderDetailPanel } from '@/components/video/VideoRenderDetailPanel';

const entry = {
  tweet_id: 'tweet-1',
  dedupe_status: 'coverage_gap',
  dedupe_reason: 'check required',
  dup_of_tweet_id: null,
  duplicate_of: null,
} as never;

function setupVideoHooks() {
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
        translated_srt: null,
        persian_srt: null,
        error: 'failed',
        block_reason: null,
      },
      feedback: [],
    },
  });
}

describe('read-only child mutation controls', () => {
  it('disables duplicate checks and bulk mutations but keeps filters usable', () => {
    const runDedupe = vi.fn();
    const bulkReprocess = vi.fn();
    const bulkIgnore = vi.fn();
    render(
      <>
        <MonitoringDuplicateGateCard
          entry={entry}
          onRunDedupe={runDedupe}
          readOnly
          mutationDisabledTitle="Read-only access: this action is disabled."
        />
        <MonitoringFilters
          searchTerm=""
          onSearchTermChange={vi.fn()}
          filter="all"
          onFilterChange={vi.fn()}
          scoreBucket="any"
          onScoreBucketChange={vi.fn()}
          selectedCount={1}
          visibleCount={1}
          isAllVisibleSelected={false}
          onToggleSelectAllVisible={vi.fn()}
          onBulkReprocess={bulkReprocess}
          onBulkIgnore={bulkIgnore}
          onClearSelection={vi.fn()}
          readOnly
          mutationDisabledTitle="Read-only access: this action is disabled."
        />
      </>,
    );

    const run = screen.getByRole('button', { name: 'Run' });
    const reprocess = screen.getByRole('button', { name: 'Mass reprocess' });
    const ignore = screen.getByRole('button', { name: 'Mass ignore' });
    expect(run).toBeDisabled();
    expect(reprocess).toBeDisabled();
    expect(ignore).toBeDisabled();
    expect(run).toHaveAttribute('title', expect.stringContaining('Read-only'));
    fireEvent.click(run);
    fireEvent.click(reprocess);
    fireEvent.click(ignore);
    expect(runDedupe).not.toHaveBeenCalled();
    expect(bulkReprocess).not.toHaveBeenCalled();
    expect(bulkIgnore).not.toHaveBeenCalled();
  });

  it('keeps the same child mutation controls enabled for admins', () => {
    const runDedupe = vi.fn();
    render(
      <MonitoringDuplicateGateCard
        entry={entry}
        onRunDedupe={runDedupe}
        readOnly={false}
      />,
    );
    const run = screen.getByRole('button', { name: 'Run' });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(runDedupe).toHaveBeenCalledWith(entry);
  });

  it('disables render queue, feedback, retry, and review actions for read-only users', () => {
    setupVideoHooks();
    render(
      <VideoRenderDetailPanel
        renderId="render-1"
        status="failed"
        readOnly
        mutationDisabledTitle="Read-only access: render changes are disabled."
      />,
    );

    for (const name of ['Save', 'Retry', 'Mark reviewed']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', expect.stringContaining('Read-only'));
      fireEvent.click(button);
    }
    expect(videoHooks.useRetryVideoRender.mock.results[0]?.value.mutate).not.toHaveBeenCalled();
    expect(videoHooks.useSaveVideoRenderFeedback.mock.results[0]?.value.mutate).not.toHaveBeenCalled();
    expect(videoHooks.useSetVideoRenderReviewed.mock.results[0]?.value.mutate).not.toHaveBeenCalled();
  });

  it('disables drawer provider, editorial, scoring, and enrichment actions', () => {
    const callbacks = {
      request: vi.fn(),
      enrich: vi.fn(),
      score: vi.fn(),
      enrichmentFeedback: vi.fn(),
      selectVariant: vi.fn(),
      manualScore: vi.fn(),
      edit: vi.fn(),
      save: vi.fn(),
    };
    const drawerEntry = {
      tweet_id: 'tweet-1',
      text_original: 'Original text',
      text_translated: 'Translated text',
      created_at: '2026-08-12T00:00:00.000Z',
      account_handle: 'source',
      author_handle: 'author',
      has_media: false,
      enrich_status: 'awaiting_approval',
      x_status: 'pending',
      delivery_status: 'pending',
      monitoring_state: { decision_label: 'Deliver', telegram_state: 'pending', x_state: 'pending', next_actions: [] },
    } as never;
    render(
      <MonitoringDetailDrawer
        open
        onOpenChange={vi.fn()}
        tweetId="tweet-1"
        entry={drawerEntry}
        timeline={[]}
        timelineLoading={false}
        timelineError={false}
        onRetryTimeline={vi.fn()}
        deliverThreshold={14}
        xPostingEnabled
        xDiagnostic={{ tweet_id: 'tweet-1', eligible: true, blockers: [], notes: [], candidate: { sql_gate_passed: true, reason: 'ready' } }}
        xDiagnosticLoading={false}
        editingEntry={null}
        editedContent=""
        enrichingTweetIds={new Set()}
        feedbackLoading={null}
        onInspectDuplicateMatch={vi.fn()}
        onRequestAction={callbacks.request}
        onStartEditTranslation={callbacks.edit}
        onEditedContentChange={vi.fn()}
        onSaveEdit={callbacks.save}
        onCancelEdit={vi.fn()}
        onGenerateEnrichment={callbacks.enrich}
        onOpenManualScore={callbacks.manualScore}
        onScoreFeedback={callbacks.score}
        onEnrichmentFeedback={callbacks.enrichmentFeedback}
        onSelectEnrichmentVariant={callbacks.selectVariant}
        readOnly
        mutationDisabledTitle="Read-only access: this action is disabled."
      />,
    );

    for (const name of [
      'Generate enrichment draft',
      'Post plain to X',
      'Get translation',
      'Edit',
      'Manual score',
      'Should skip',
      'Generate draft',
      'Approve for X',
      'Sounds like me',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(callbacks.request).not.toHaveBeenCalled();
    expect(callbacks.enrich).not.toHaveBeenCalled();
    expect(callbacks.score).not.toHaveBeenCalled();
    expect(callbacks.enrichmentFeedback).not.toHaveBeenCalled();
    expect(callbacks.selectVariant).not.toHaveBeenCalled();
    expect(callbacks.manualScore).not.toHaveBeenCalled();
    expect(callbacks.edit).not.toHaveBeenCalled();
    expect(callbacks.save).not.toHaveBeenCalled();
  });
});
