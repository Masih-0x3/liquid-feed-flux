import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import XAutomationSettings from '@/components/settings/XAutomationSettings';
import { useAuth } from '@/contexts/AuthContext';
import { invokeAdminAction } from '@/api/adminActions';
import { useRuntimeControls } from '@/hooks/useRuntimeControls';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/api/adminActions', () => ({ invokeAdminAction: vi.fn() }));
vi.mock('@/hooks/useRuntimeControls', () => ({ useRuntimeControls: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useSettingsData', () => ({ useSaveSettings: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/useXDeliveries', () => ({ useXMonthlyPostsCount: () => ({ data: 0 }) }));
vi.mock('@/hooks/useMonitoringData', () => ({ useXApiSummary: () => ({ data: null, refetch: vi.fn(), isFetching: false }) }));
vi.mock('@/components/settings/XPostingConfig', () => ({ default: () => <div data-testid="x-posting-config" /> }));
vi.mock('@/components/settings/XRateLimits', () => ({ default: () => <div data-testid="x-rate-limits" /> }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedInvokeAdminAction = vi.mocked(invokeAdminAction);
const mockedUseRuntimeControls = vi.mocked(useRuntimeControls);

const runtime = (overrides: Partial<NonNullable<ReturnType<typeof useRuntimeControls>['controls']>> = {}) => ({
  controls: {
    environment: 'preview' as const,
    dedupe_enabled: false,
    translation_enabled: false,
    posting_mode: 'blocked' as const,
    updated_at: '2026-08-25T00:00:00.000Z',
    updated_by: null,
    ...overrides,
  },
  loading: false,
  error: null,
  refresh: vi.fn(),
});

describe('XAutomationSettings runtime gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({ isAdmin: false } as ReturnType<typeof useAuth>);
    mockedUseRuntimeControls.mockReturnValue(runtime());
  });

  it.each([
    ['read-only', { isAdmin: false }, runtime()],
    ['Preview', { isAdmin: true }, runtime()],
    ['blocked production', { isAdmin: true }, runtime({ environment: 'production', posting_mode: 'blocked' })],
    ['unknown runtime', { isAdmin: true }, { controls: null, loading: false, error: 'unavailable', refresh: vi.fn() }],
    ['loading runtime', { isAdmin: true }, { controls: null, loading: true, error: null, refresh: vi.fn() }],
  ])('does not run mount or nested X actions for %s', (_label, auth, runtimeState) => {
    mockedUseAuth.mockReturnValue(auth as ReturnType<typeof useAuth>);
    mockedUseRuntimeControls.mockReturnValue(runtimeState as ReturnType<typeof useRuntimeControls>);

    render(<XAutomationSettings />);

    expect(mockedInvokeAdminAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /verify connection/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /refresh usage/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /refresh status/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send test tweet/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /estimate/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /queue backfill/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test hydrate/i })).toBeDisabled();
  });

  it('allows the admin mount status read and test tweet only in enabled production', async () => {
    mockedUseAuth.mockReturnValue({ isAdmin: true } as ReturnType<typeof useAuth>);
    mockedUseRuntimeControls.mockReturnValue(runtime({ environment: 'production', posting_mode: 'enabled' }));
    mockedInvokeAdminAction.mockResolvedValue({ status: {} });

    render(<XAutomationSettings />);

    await waitFor(() => expect(mockedInvokeAdminAction).toHaveBeenCalledWith({ action: 'get_x_status' }));
    const sendButton = screen.getByRole('button', { name: /send test tweet/i });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);
    fireEvent.click(await screen.findByRole('button', { name: /post tweet/i }));
    await waitFor(() => expect(mockedInvokeAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'send_test_tweet' }),
        { throwOnFailure: false },
      ));
  });
});
