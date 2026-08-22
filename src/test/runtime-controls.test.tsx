import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeControlsPanel from '@/components/settings/RuntimeControlsPanel';
import { useAuth } from '@/contexts/AuthContext';
import { getRuntimeControls, updateRuntimeControls, type RuntimeControls } from '@/api/runtimeControls';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/api/runtimeControls', () => ({
  getRuntimeControls: vi.fn(),
  updateRuntimeControls: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetRuntimeControls = vi.mocked(getRuntimeControls);
const mockedUpdateRuntimeControls = vi.mocked(updateRuntimeControls);

const controls: RuntimeControls = {
  environment: 'preview',
  dedupe_enabled: false,
  translation_enabled: true,
  posting_mode: 'blocked',
  updated_at: '2026-08-12T15:00:00.000Z',
  updated_by: null,
  queue_counts: {
    dedupe_queued: 3,
    translation_deferred: 2,
  },
};

describe('RuntimeControlsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({ role: 'admin' } as ReturnType<typeof useAuth>);
    mockedGetRuntimeControls.mockResolvedValue(controls);
    mockedUpdateRuntimeControls.mockResolvedValue(controls);
  });

  it('shows control state and queue counts to read-only users with disabled switches', async () => {
    mockedUseAuth.mockReturnValue({ role: 'read_only' } as ReturnType<typeof useAuth>);

    render(<RuntimeControlsPanel />);

    expect(await screen.findByText('3 queued')).toBeInTheDocument();
    expect(screen.getByText('2 deferred')).toBeInTheDocument();
    expect(screen.getByText('Posting locked in Preview')).toBeInTheDocument();
    expect(screen.getByText(/read-only access can view state/i)).toBeInTheDocument();
    screen.getAllByRole('switch').forEach((control) => expect(control).toBeDisabled());
    expect(screen.queryByText(/enable posting/i)).not.toBeInTheDocument();
  });

  it('confirms an admin toggle and sends only boolean control fields', async () => {
    const updated = { ...controls, dedupe_enabled: true };
    mockedUpdateRuntimeControls.mockResolvedValue(updated);

    render(<RuntimeControlsPanel />);

    const dedupeSwitch = await screen.findByRole('switch', { name: /openai dedupe paused/i });
    fireEvent.click(dedupeSwitch);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm change/i }));

    await waitFor(() => expect(mockedUpdateRuntimeControls).toHaveBeenCalledWith({
      dedupe_enabled: true,
      translation_enabled: true,
    }));
    expect(await screen.findByText('OpenAI dedupe enabled.')).toBeInTheDocument();
  });
});

