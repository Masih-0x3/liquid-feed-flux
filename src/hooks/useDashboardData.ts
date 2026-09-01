import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { fetchDashboardData } from '@/api/dashboardData';
import { useDashboardRealtime } from '@/contexts/DashboardRealtimeContext';

export type {
  DashboardMetrics,
  DashboardSeverity,
  IngestHeartbeat,
  OpenAIUsage,
  OpsStatus,
  PipelineCounts,
  PipelineHealth,
  ProcessObservabilitySummary,
  QueueBreakdown,
  ScoringTuningSummary,
  SystemPerformanceSummary,
  SystemPerformanceWindow,
  SystemResources,
  XLocalUsage,
} from '@/api/dashboardData';

export function useDashboardData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtime = useDashboardRealtime();

  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }, 2000);
  }, [queryClient]);

  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribeDashboardPosts(debouncedInvalidate);

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [debouncedInvalidate, realtime]);

  return query;
}
