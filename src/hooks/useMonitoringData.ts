import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import {
  fetchMonitoringEntries,
  sanitizeMonitoringSearch,
  type MonitoringFilter,
  type MonitoringOverview,
  type ScoreBucket,
  type XApiSummary,
} from '@/api/monitoringData';
import { invokeAdminAction } from '@/api/adminActions';
import { supabase } from '@/integrations/supabase/client';

export type {
  DuplicateCluster,
  DuplicateClusterMember,
  MonitoringDataSource,
  MonitoringEntry,
  MonitoringFilter,
  MonitoringOverview,
  MonitoringPage,
  MonitoringProcessAiCall,
  MonitoringProcessObservability,
  MonitoringProcessRun,
  PipelineEvent,
  ScoreBucket,
  XApiSummary,
} from '@/api/monitoringData';

export function useMonitoringData(filter: MonitoringFilter = 'all') {
  return useMonitoringDataSearch(filter, '');
}

export function useMonitoringDataSearch(filter: MonitoringFilter = 'all', search = '') {
  return useMonitoringDataSearchWithScore(filter, search, 'any');
}

export function useMonitoringDataSearchWithScore(filter: MonitoringFilter = 'all', search = '', scoreBucket: ScoreBucket = 'any') {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['monitoring', filter, sanitizeMonitoringSearch(search), scoreBucket],
    queryFn: (ctx) => fetchMonitoringEntries({
      pageParam: ctx.pageParam,
      filter,
      search,
      scoreBucket,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
      queryClient.invalidateQueries({ queryKey: ['x-api-summary'] });
    }, 1000);
  }, [queryClient]);

  useEffect(() => {
    const ch1 = supabase.channel('mon-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe();
    const ch2 = supabase.channel('mon-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedInvalidate).subscribe();
    const ch3 = supabase.channel('mon-del').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, debouncedInvalidate).subscribe();
    const ch4 = supabase.channel('mon-x-del').on('postgres_changes', { event: '*', schema: 'public', table: 'x_deliveries' }, debouncedInvalidate).subscribe();
    const ch5 = supabase.channel('mon-workflow-runs').on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_runs' }, debouncedInvalidate).subscribe();
    const ch6 = supabase.channel('mon-ai-call-ledger').on('postgres_changes', { event: '*', schema: 'public', table: 'ai_call_ledger' }, debouncedInvalidate).subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
      supabase.removeChannel(ch4);
      supabase.removeChannel(ch5);
      supabase.removeChannel(ch6);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return {
    ...query,
    entries: query.data?.pages.flatMap(p => p.entries) ?? [],
    dataSource: query.data?.pages[0]?.source ?? null,
  };
}

export function useMonitoringOverview(windowHours = 24) {
  return useQuery({
    queryKey: ['monitoring-overview', windowHours],
    queryFn: async (): Promise<MonitoringOverview> => {
      const data = await invokeAdminAction<{ success?: boolean; error?: string; overview?: MonitoringOverview }>({
        action: 'get_monitoring_overview',
        window_hours: windowHours,
      });
      if (data?.success && data.overview) return data.overview as MonitoringOverview;
      throw new Error(data?.error ?? 'Monitoring overview unavailable');
    },
    staleTime: 20_000,
    retry: 1,
  });
}

export function useXApiSummary(windowHours = 24, syncOfficialUsage = false) {
  return useQuery({
    queryKey: ['x-api-summary', windowHours, syncOfficialUsage],
    queryFn: async (): Promise<XApiSummary> => {
      const data = await invokeAdminAction<{ success?: boolean; error?: string; summary?: XApiSummary }>({
        action: 'get_x_api_summary',
        window_hours: windowHours,
        sync_official_usage: syncOfficialUsage,
      });
      if (data?.success && data.summary) return data.summary as XApiSummary;
      throw new Error(data?.error ?? 'X API summary unavailable');
    },
    staleTime: 30_000,
    retry: 1,
  });
}
