import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { fetchDashboardData } from '@/api/dashboardData';
import { supabase } from '@/integrations/supabase/client';

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
    // Only subscribe to posts to reduce realtime I/O. Jobs/deliveries churn too fast
    // and the dashboard refetches on the posts signal anyway.
    const ch1 = supabase.channel('dash-posts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe();
    return () => {
      supabase.removeChannel(ch1);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return query;
}
