import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeControls, updateRuntimeControls, type RuntimeControls } from '@/api/runtimeControls';
import { RUNTIME_CONTROLS_QUERY_KEY, useRuntimeControls, useUpdateRuntimeControls } from '@/hooks/useRuntimeControls';

vi.mock('@/api/runtimeControls', () => ({
  getRuntimeControls: vi.fn(),
  updateRuntimeControls: vi.fn(),
}));

const mockedGetRuntimeControls = vi.mocked(getRuntimeControls);
const mockedUpdateRuntimeControls = vi.mocked(updateRuntimeControls);

const controls: RuntimeControls = {
  environment: 'production',
  dedupe_enabled: false,
  translation_enabled: true,
  posting_mode: 'enabled',
  updated_at: '2026-08-25T00:00:00.000Z',
  updated_by: null,
};

describe('runtime controls query sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetRuntimeControls.mockResolvedValue(controls);
    mockedUpdateRuntimeControls.mockResolvedValue({ ...controls, dedupe_enabled: true });
  });

  it('uses one stable query key and invalidates it after a runtime mutation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const read = renderHook(() => useRuntimeControls(), { wrapper });
    await waitFor(() => expect(read.result.current.controls).toEqual(controls));
    const mutation = renderHook(() => useUpdateRuntimeControls(), { wrapper });

    await act(async () => {
      await mutation.result.current.mutateAsync({ dedupe_enabled: true, translation_enabled: true });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: RUNTIME_CONTROLS_QUERY_KEY });
    expect(mockedGetRuntimeControls).toHaveBeenCalledTimes(2);
  });
});
