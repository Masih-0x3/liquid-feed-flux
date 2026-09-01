import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDashboardProcessHud,
  type DashboardProcessHudPayload,
} from '@/api/dashboardProcessHud';
import { useDashboardRealtime } from '@/contexts/DashboardRealtimeContext';

export type { DashboardProcessHudPayload } from '@/api/dashboardProcessHud';

export const DASHBOARD_PROCESS_HUD_QUERY_KEY = ['dashboard-process-hud'] as const;

export type DashboardProcessHudOptions = {
  enabled: boolean;
};

export function useDashboardProcessHudData({ enabled }: DashboardProcessHudOptions) {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const realtime = useDashboardRealtime();

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [enabled]);

  const query = useQuery<DashboardProcessHudPayload>({
    queryKey: DASHBOARD_PROCESS_HUD_QUERY_KEY,
    queryFn: fetchDashboardProcessHud,
    enabled,
    staleTime: 10_000,
    gcTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const debouncedInvalidate = useCallback(() => {
    if (!enabledRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!enabledRef.current) return;
      queryClient.invalidateQueries({ queryKey: DASHBOARD_PROCESS_HUD_QUERY_KEY });
    }, 1000);
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (!realtime) return;
    const unsubscribe = realtime.subscribeDashboardProcessHud(debouncedInvalidate);

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [debouncedInvalidate, enabled, realtime]);

  return {
    ...query,
    entries: query.data?.entries ?? [],
  };
}
