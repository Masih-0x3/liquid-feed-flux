import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDashboardProcessHud,
  type DashboardProcessHudPayload,
} from '@/api/dashboardProcessHud';
import { supabase } from '@/integrations/supabase/client';

export type { DashboardProcessHudPayload } from '@/api/dashboardProcessHud';

export const DASHBOARD_PROCESS_HUD_QUERY_KEY = ['dashboard-process-hud'] as const;

export function useDashboardProcessHudData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery<DashboardProcessHudPayload>({
    queryKey: DASHBOARD_PROCESS_HUD_QUERY_KEY,
    queryFn: fetchDashboardProcessHud,
    staleTime: 10_000,
    gcTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: DASHBOARD_PROCESS_HUD_QUERY_KEY });
    }, 1000);
  }, [queryClient]);

  useEffect(() => {
    const channels = [
      supabase.channel('dash-hud-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe(),
      supabase.channel('dash-hud-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedInvalidate).subscribe(),
      supabase.channel('dash-hud-deliveries').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, debouncedInvalidate).subscribe(),
      supabase.channel('dash-hud-x-deliveries').on('postgres_changes', { event: '*', schema: 'public', table: 'x_deliveries' }, debouncedInvalidate).subscribe(),
      supabase.channel('dash-hud-workflow-runs').on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_runs' }, debouncedInvalidate).subscribe(),
      supabase.channel('dash-hud-ai-call-ledger').on('postgres_changes', { event: '*', schema: 'public', table: 'ai_call_ledger' }, debouncedInvalidate).subscribe(),
    ];

    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return {
    ...query,
    entries: query.data?.entries ?? [],
  };
}
