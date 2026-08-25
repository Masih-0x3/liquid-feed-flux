import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import {
  fetchMonitoringEntry,
  fetchMonitoringEntries,
  sanitizeMonitoringSearch,
  type MonitoringFilter,
  type MonitoringOverview,
  type ScoreBucket,
  type XApiSummary,
} from '@/api/monitoringData';
import { invokeAdminRead } from '@/api/adminActions';
import { supabase } from '@/integrations/supabase/client';
import {
  MAX_MONITORING_REALTIME_STALENESS_MS,
  MONITORING_QUERY_ROOT,
  MONITORING_REALTIME_TABLES,
  isCurrentMonitoringRealtimeGeneration,
  monitoringEntityRefreshDueAt,
  monitoringPatchFlushDelay,
  monitoringQueryShape,
  nextMonitoringRealtimeGeneration,
  patchMonitoringInfiniteData,
  resolveMonitoringRealtimeTweetIds,
  type MonitoringInfiniteData,
  type MonitoringQueryShape,
  type MonitoringRealtimePayload,
} from '@/lib/monitoringRealtime';

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

const REALTIME_PATCH_DEBOUNCE_MS = 400;

interface ActiveMonitoringQuery {
  queryKey: readonly unknown[];
  shape: MonitoringQueryShape;
}

interface PendingEntityResync {
  generation: number;
  dueAt: number;
}

type RealtimeEntityRefreshOutcome = 'applied' | 'superseded' | 'resync_required';

function activeMonitoringQueries(queryClient: QueryClient): ActiveMonitoringQuery[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: MONITORING_QUERY_ROOT, type: 'active' })
    .flatMap((query) => {
      const shape = monitoringQueryShape(query.queryKey);
      const data = query.state.data as MonitoringInfiniteData | undefined;
      return shape && data?.pages.length ? [{ queryKey: query.queryKey, shape }] : [];
    });
}

function cachedMonitoringEntries(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: MONITORING_QUERY_ROOT, type: 'active' })
    .flatMap((query) => {
      const data = query.state.data as MonitoringInfiniteData | undefined;
      return data?.pages.flatMap((page) => page.entries) ?? [];
    });
}

// failed_stuck membership uses ordered failed-job/dedupe actionability rules.
// Until that selector has a bounded exact predicate, preserve page boundaries
// and let the per-entity deadline resync the canonical list instead.
function requiresCanonicalMonitoringResync(filter: MonitoringFilter): boolean {
  return filter === 'failed_stuck';
}

function fetchMonitoringEntryBeforeDeadline(
  params: Parameters<typeof fetchMonitoringEntry>[0],
  dueAt: number,
): ReturnType<typeof fetchMonitoringEntry> {
  const timeoutMs = dueAt - Date.now();
  if (timeoutMs <= 0) {
    return Promise.reject(new Error('Monitoring Realtime exact refresh exceeded its staleness deadline'));
  }

  return new Promise<Awaited<ReturnType<typeof fetchMonitoringEntry>>>((resolve, reject) => {
    const deadlineTimer = setTimeout(() => {
      reject(new Error('Monitoring Realtime exact refresh exceeded its staleness deadline'));
    }, timeoutMs);
    void fetchMonitoringEntry(params).then(
      (entry) => {
        clearTimeout(deadlineTimer);
        resolve(entry);
      },
      (error: unknown) => {
        clearTimeout(deadlineTimer);
        reject(error);
      },
    );
  });
}

export function useMonitoringDataSearchWithScore(filter: MonitoringFilter = 'all', search = '', scoreBucket: ScoreBucket = 'any') {
  const queryClient = useQueryClient();
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchBurstStartedAtRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackDueAtRef = useRef<number | null>(null);
  const pendingRealtimeEntriesRef = useRef(new Map<string, number>());
  const realtimeGenerationRef = useRef(new Map<string, number>());
  const pendingEntityResyncRef = useRef(new Map<string, PendingEntityResync>());
  const entityResyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runEntityResyncDeadlineRef = useRef<() => void>(() => {});

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

  const scheduleFallbackResync = useCallback(() => {
    const now = Date.now();
    if (fallbackDueAtRef.current === null) {
      fallbackDueAtRef.current = now + MAX_MONITORING_REALTIME_STALENESS_MS;
    }
    if (fallbackTimerRef.current) return;

    const delay = Math.max(0, fallbackDueAtRef.current - now);
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      fallbackDueAtRef.current = null;
      void queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_ROOT });
      void queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['x-api-summary'] });
    }, delay);
  }, [queryClient]);

  const scheduleKnownEntityDeadlineTimer = useCallback(() => {
    if (entityResyncTimerRef.current) {
      clearTimeout(entityResyncTimerRef.current);
      entityResyncTimerRef.current = null;
    }

    let nextDueAt: number | null = null;
    pendingEntityResyncRef.current.forEach(({ dueAt }) => {
      nextDueAt = nextDueAt === null ? dueAt : Math.min(nextDueAt, dueAt);
    });
    if (nextDueAt === null) return;

    entityResyncTimerRef.current = setTimeout(() => {
      entityResyncTimerRef.current = null;
      runEntityResyncDeadlineRef.current();
    }, Math.max(0, nextDueAt - Date.now()));
  }, []);

  const expireKnownEntityResyncs = useCallback(() => {
    const now = Date.now();
    let needsFullResync = false;
    pendingEntityResyncRef.current.forEach((pending, tweetId) => {
      if (pending.dueAt > now) return;
      if (isCurrentMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId), pending.generation)) {
        realtimeGenerationRef.current.set(
          tweetId,
          nextMonitoringRealtimeGeneration(pending.generation),
        );
        needsFullResync = true;
      }
      pendingEntityResyncRef.current.delete(tweetId);
    });
    if (needsFullResync) {
      void queryClient.invalidateQueries({ queryKey: MONITORING_QUERY_ROOT });
      void queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['x-api-summary'] });
    }
    scheduleKnownEntityDeadlineTimer();
  }, [queryClient, scheduleKnownEntityDeadlineTimer]);

  useEffect(() => {
    runEntityResyncDeadlineRef.current = expireKnownEntityResyncs;
    return () => {
      runEntityResyncDeadlineRef.current = () => {};
    };
  }, [expireKnownEntityResyncs]);

  const registerKnownEntityRefresh = useCallback((tweetId: string): PendingEntityResync => {
    const now = Date.now();
    const generation = nextMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId));
    const dueAt = monitoringEntityRefreshDueAt(
      pendingEntityResyncRef.current.get(tweetId)?.dueAt ?? null,
      now,
    );
    const pending = { generation, dueAt };
    realtimeGenerationRef.current.set(tweetId, generation);
    pendingEntityResyncRef.current.set(tweetId, pending);
    scheduleKnownEntityDeadlineTimer();
    return pending;
  }, [scheduleKnownEntityDeadlineTimer]);

  const settleKnownEntityRefresh = useCallback((tweetId: string, generation: number): boolean => {
    const pending = pendingEntityResyncRef.current.get(tweetId);
    if (!pending || pending.generation !== generation) return false;
    pendingEntityResyncRef.current.delete(tweetId);
    scheduleKnownEntityDeadlineTimer();
    return true;
  }, [scheduleKnownEntityDeadlineTimer]);

  const flushRealtimePatches = useCallback(async () => {
    const pendingEntries = [...pendingRealtimeEntriesRef.current].flatMap(([tweetId, generation]) => {
      const pendingResync = pendingEntityResyncRef.current.get(tweetId);
      return pendingResync?.generation === generation
        ? [{ tweetId, generation, dueAt: pendingResync.dueAt }]
        : [];
    });
    pendingRealtimeEntriesRef.current.clear();
    if (pendingEntries.length === 0) return;

    const activeQueries = activeMonitoringQueries(queryClient);
    if (activeQueries.length === 0) {
      return;
    }

    const refreshes = pendingEntries.map(async ({ tweetId, generation, dueAt }): Promise<RealtimeEntityRefreshOutcome> => {
      const queryRefreshes = await Promise.allSettled(activeQueries.map(async ({ queryKey, shape }): Promise<RealtimeEntityRefreshOutcome> => {
        if (requiresCanonicalMonitoringResync(shape.filter)) {
          return 'resync_required';
        }
        const entry = await fetchMonitoringEntryBeforeDeadline({
          tweetId,
          filter: shape.filter,
          search: shape.search,
          scoreBucket: shape.scoreBucket,
        }, dueAt);
        if (!isCurrentMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId), generation)) {
          return 'superseded' as const;
        }

        let outcome: RealtimeEntityRefreshOutcome = 'resync_required';
        queryClient.setQueryData<MonitoringInfiniteData>(queryKey, (current) => {
          const patched = patchMonitoringInfiniteData(current, tweetId, entry);
          outcome = patched.outcome === 'replaced' || patched.outcome === 'unchanged'
            ? 'applied'
            : 'resync_required';
          return patched.data;
        });
        return outcome;
      }));

      if (!isCurrentMonitoringRealtimeGeneration(realtimeGenerationRef.current.get(tweetId), generation)) {
        return 'superseded';
      }
      if (queryRefreshes.some((result) => result.status === 'rejected')) {
        return 'resync_required';
      }
      if (queryRefreshes.some((result) => result.status === 'fulfilled' && result.value !== 'applied')) {
        return 'resync_required';
      }
      return settleKnownEntityRefresh(tweetId, generation) ? 'applied' : 'superseded';
    });
    const results = await Promise.allSettled(refreshes);
    if (results.some((result) => result.status === 'fulfilled' && result.value === 'applied')) {
      void queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['x-api-summary'] });
    }
  }, [queryClient, settleKnownEntityRefresh]);

  const scheduleRealtimePatchFlush = useCallback(() => {
    const now = Date.now();
    if (patchBurstStartedAtRef.current === null) {
      patchBurstStartedAtRef.current = now;
    }
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      patchTimerRef.current = null;
      patchBurstStartedAtRef.current = null;
      void flushRealtimePatches();
    }, monitoringPatchFlushDelay(now, patchBurstStartedAtRef.current, REALTIME_PATCH_DEBOUNCE_MS));
  }, [flushRealtimePatches]);

  const handleRealtimeChange = useCallback((payload: MonitoringRealtimePayload) => {
    const tweetIds = resolveMonitoringRealtimeTweetIds(payload, cachedMonitoringEntries(queryClient));
    if (tweetIds.length === 0) {
      scheduleFallbackResync();
      return;
    }
    tweetIds.forEach((tweetId) => {
      const pending = registerKnownEntityRefresh(tweetId);
      pendingRealtimeEntriesRef.current.set(tweetId, pending.generation);
    });
    scheduleRealtimePatchFlush();
  }, [queryClient, registerKnownEntityRefresh, scheduleFallbackResync, scheduleRealtimePatchFlush]);

  useEffect(() => {
    const channel = supabase.channel('monitoring-realtime');
    MONITORING_REALTIME_TABLES.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => handleRealtimeChange(payload),
      );
    });
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (entityResyncTimerRef.current) clearTimeout(entityResyncTimerRef.current);
      patchTimerRef.current = null;
      patchBurstStartedAtRef.current = null;
      fallbackTimerRef.current = null;
      fallbackDueAtRef.current = null;
      entityResyncTimerRef.current = null;
      pendingRealtimeEntriesRef.current.clear();
      realtimeGenerationRef.current.clear();
      pendingEntityResyncRef.current.clear();
    };
  }, [handleRealtimeChange]);

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
      const data = await invokeAdminRead<{ success?: boolean; error?: string; overview?: MonitoringOverview }>({
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

export function useXApiSummary(windowHours = 24, syncOfficialUsage = false, enabled = true) {
  return useQuery({
    queryKey: ['x-api-summary', windowHours, syncOfficialUsage],
    enabled,
    queryFn: async (): Promise<XApiSummary> => {
      const data = await invokeAdminRead<{ success?: boolean; error?: string; summary?: XApiSummary }>({
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
