import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import XPostingConfig from '@/components/settings/XPostingConfig';
import { useRuntimeControls } from '@/hooks/useRuntimeControls';

const postingMocks = vi.hoisted(() => ({
  saveMutate: vi.fn(),
  invokeAdminAction: vi.fn(),
}));

vi.mock('@/hooks/useRuntimeControls', () => ({
  useRuntimeControls: vi.fn(),
}));

vi.mock('@/hooks/useSettingsData', () => ({
  useSaveSettings: () => ({ mutate: postingMocks.saveMutate, isPending: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/api/adminActions', () => ({
  invokeAdminAction: postingMocks.invokeAdminAction,
}));

const mockedUseRuntimeControls = vi.mocked(useRuntimeControls);

describe('XPostingConfig runtime gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseRuntimeControls.mockReturnValue({
      controls: {
        environment: 'preview',
        dedupe_enabled: false,
        translation_enabled: false,
        posting_mode: 'blocked',
        updated_at: '2026-08-25T00:00:00.000Z',
        updated_by: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it('disables enable, save, and dry-run controls in Preview', () => {
    render(<XPostingConfig isAdmin />);

    expect(screen.getByTestId('x-posting-runtime-status')).toHaveTextContent(
      'Posting controls are disabled in Preview.',
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dry-run on latest eligible/i })).toBeDisabled();
  });

  it('disables all posting controls when production posting is blocked', () => {
    mockedUseRuntimeControls.mockReturnValue({
      controls: {
        environment: 'production',
        dedupe_enabled: false,
        translation_enabled: false,
        posting_mode: 'blocked',
        updated_at: '2026-08-25T00:00:00.000Z',
        updated_by: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<XPostingConfig isAdmin />);

    expect(screen.getByTestId('x-posting-runtime-status')).toHaveTextContent(
      'Posting is blocked in Production.',
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dry-run on latest eligible/i })).toBeDisabled();
  });

  it('fails closed when runtime controls are unavailable', () => {
    mockedUseRuntimeControls.mockReturnValue({
      controls: null,
      loading: false,
      error: 'unavailable',
      refresh: vi.fn(),
    });

    render(<XPostingConfig isAdmin />);

    expect(screen.getByTestId('x-posting-runtime-status')).toHaveTextContent('unavailable');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dry-run on latest eligible/i })).toBeDisabled();
  });

  it('fails closed while runtime controls are loading', () => {
    mockedUseRuntimeControls.mockReturnValue({
      controls: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<XPostingConfig isAdmin />);

    expect(screen.getByTestId('x-posting-runtime-status')).toHaveTextContent(
      'Checking runtime posting controls…',
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dry-run on latest eligible/i })).toBeDisabled();
  });

  it('does not allow a non-admin to invoke posting handlers in production', () => {
    mockedUseRuntimeControls.mockReturnValue({
      controls: {
        environment: 'production',
        dedupe_enabled: false,
        translation_enabled: false,
        posting_mode: 'enabled',
        updated_at: '2026-08-25T00:00:00.000Z',
        updated_by: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<XPostingConfig />);

    const save = screen.getByRole('button', { name: /save configuration/i });
    const dryRun = screen.getByRole('button', { name: /dry-run on latest eligible/i });
    expect(save).toBeDisabled();
    expect(dryRun).toBeDisabled();
    fireEvent.click(save);
    fireEvent.click(dryRun);
    expect(postingMocks.saveMutate).not.toHaveBeenCalled();
    expect(postingMocks.invokeAdminAction).not.toHaveBeenCalled();
  });
});
