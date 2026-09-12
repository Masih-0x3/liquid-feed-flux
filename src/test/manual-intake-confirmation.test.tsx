import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  useAuth: vi.fn(), create: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: state.useAuth }));
vi.mock('@/hooks/useManualVideoIntakeData', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useManualVideoIntakeList: () => ({ data: { ok: true, rows: [] }, refetch: vi.fn(), isFetching: false, isLoading: false }),
    useManualVideoIntakeDetail: () => ({ data: null, isFetching: false, refetch: vi.fn() }),
    useCreateManualVideoIntake: () => ({ mutateAsync: state.create, isPending: false }),
    useRefreshManualVideoIntake: mutation, useSaveManualVideoCaption: mutation,
    useSetManualVideoDuplicateOverride: mutation, useCancelManualVideoIntake: mutation, usePostManualVideoIntake: mutation,
  };
});
import { ManualVideoIntakePanel } from '@/components/video/ManualVideoIntakePanel';

describe('manual intake consequential actions', () => {
  beforeEach(() => {
    state.useAuth.mockReturnValue({ isAdmin: true, role: 'admin' });
    state.create.mockReset().mockResolvedValue({ intake: { id: 'new-intake' } });
  });
  it('validates locally and confirms the exact source before paid preparation', async () => {
    render(<ManualVideoIntakePanel />);
    const input = screen.getByLabelText('Tweet URL');
    fireEvent.change(input, { target: { value: 'https://example.com/status/1' } });
    fireEvent.submit(input.closest('form')!);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(state.create).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'https://x.com/example/status/123' } });
    fireEvent.submit(input.closest('form')!);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('paid provider resources');
    expect(dialog).toHaveTextContent('https://x.com/example/status/123');
    expect(state.create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare video' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://x.com/example/status/123' }));
  });
  it('canceling preparation never invokes processing, and read-only controls stay disabled', () => {
    const view = render(<ManualVideoIntakePanel />);
    const input = screen.getByLabelText('Tweet URL');
    fireEvent.change(input, { target: { value: 'https://x.com/example/status/123' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(state.create).not.toHaveBeenCalled();
    state.useAuth.mockReturnValue({ isAdmin: false, role: 'read_only' });
    view.rerender(<ManualVideoIntakePanel />);
    expect(screen.getByRole('button', { name: 'Prepare video' })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh recent intakes' })).toBeEnabled();
  });
});
