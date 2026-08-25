import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRuntimeControls, updateRuntimeControls, type RuntimeControls, type RuntimeControlName } from '@/api/runtimeControls';

export interface RuntimeControlsState {
  controls: RuntimeControls | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Read the server-owned runtime identity and posting gate. An absent or
 * malformed response stays null so consumers can disable mutations safely.
 */
export const RUNTIME_CONTROLS_QUERY_KEY = ['runtime-controls'] as const;
const RUNTIME_CONTROLS_ERROR = 'Runtime controls are unavailable. The current state cannot be verified.';

export function useRuntimeControls(enabled = true): RuntimeControlsState {
  const query = useQuery<RuntimeControls, Error>({
    queryKey: RUNTIME_CONTROLS_QUERY_KEY,
    queryFn: getRuntimeControls,
    enabled,
    staleTime: 15_000,
    retry: false,
  });

  return {
    controls: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? RUNTIME_CONTROLS_ERROR : null,
    refresh: async () => {
      await query.refetch();
    },
  };
}

export function useUpdateRuntimeControls() {
  const queryClient = useQueryClient();
  return useMutation<RuntimeControls, Error, Pick<RuntimeControls, RuntimeControlName>>({
    mutationFn: updateRuntimeControls,
    onSuccess: (controls) => {
      queryClient.setQueryData(RUNTIME_CONTROLS_QUERY_KEY, controls);
      void queryClient.invalidateQueries({ queryKey: RUNTIME_CONTROLS_QUERY_KEY });
    },
  });
}
