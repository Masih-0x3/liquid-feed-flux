import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ObservabilitySettings from '@/components/settings/ObservabilitySettings';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { ProcessObservabilitySummary } from '@/hooks/useDashboardData';

vi.mock('@/hooks/useDashboardData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDashboardData')>();
  return {
    ...actual,
    useDashboardData: vi.fn(),
  };
});

const processSummary: ProcessObservabilitySummary = {
  available: true,
  error: null,
  windowHours: 24,
  activeRuns: 2,
  completedRuns24h: 10,
  failedRuns24h: 1,
  aiCalls24h: 12,
  failedAiCalls24h: 1,
  totalTokens24h: 4500,
  reasoningTokens24h: 800,
  aiCallP95Seconds: 4.2,
  latestRun: {
    runKey: 'post:tweet-1:job:abc',
    workflowName: 'rss-item-pipeline',
    workflowRunId: 'worker:tweet-1:abc',
    status: 'completed',
    source: 'worker',
    sourceFunction: 'worker',
    subjectType: 'post',
    subjectId: 'tweet-1',
    startedAt: '2026-07-03T00:00:00.000Z',
    endedAt: '2026-07-03T00:00:04.000Z',
    durationSeconds: 4,
    lastError: null,
    usedFilter: true,
  },
  recentRuns: [],
  foglamp: {
    hostedExportEnabled: false,
    hasApiKey: true,
    monthlySpanLimit: 10_000,
    monthlySpanCap: 8_000,
    monthlySpanWarn: 6_000,
    estimatedSpansUsed: 120,
    estimatedSpansSkipped: 30,
    capUsedPct: 1.5,
    warning: false,
    stopped: false,
  },
  openAiTokensMonthToDate: 22_000,
};

describe('ObservabilitySettings', () => {
  const mockedUseDashboardData = vi.mocked(useDashboardData);

  beforeEach(() => {
    mockedUseDashboardData.mockReset();
  });

  it('shows local ledger, hosted export, cap, and latest run status', () => {
    mockedUseDashboardData.mockReturnValue({
      data: { processObservability: processSummary },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useDashboardData>);

    render(
      <MemoryRouter>
        <ObservabilitySettings />
      </MemoryRouter>,
    );

    expect(screen.getByText('Process Observability')).toBeInTheDocument();
    expect(screen.getByText('Local ledger active')).toBeInTheDocument();
    expect(screen.getByText('Under local cap')).toBeInTheDocument();
    expect(screen.getByText('Local only')).toBeInTheDocument();
    expect(screen.getByText('120 / 8,000 spans')).toBeInTheDocument();
    expect(screen.getByText('rss-item-pipeline')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Monitoring/i })).toHaveAttribute('href', '/monitoring?search=tweet-1');
    expect(screen.getByText('Prompt/output text')).toBeInTheDocument();
    expect(screen.getByText('Floating HUD')).toBeInTheDocument();
  });

  it('surfaces dashboard summary errors', () => {
    mockedUseDashboardData.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('summary unavailable'),
    } as ReturnType<typeof useDashboardData>);

    render(
      <MemoryRouter>
        <ObservabilitySettings />
      </MemoryRouter>,
    );

    expect(screen.getByText('Process observability status is unavailable from admin-actions.')).toBeInTheDocument();
    expect(screen.getByText('summary unavailable')).toBeInTheDocument();
  });
});
