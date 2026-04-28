import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DashboardMetrics {
  postsIngested: number;
  postsTranslated: number;
  postsDelivered: number;
  failedJobs: number;
  postsTruncated24h: number;
  postsHydrated24h: number;
  xApiCalls24h: number;
  xPosts24h: number;
  xFailed24h: number;
  xSkippedNoMedia24h: number;
  xMediaUploads24h: number;
}

export interface PipelineHealth {
  successRate: number;
  avgLatency: number;
  activeFeeds: number;
  queueSize: number;
  isOnline: boolean;
  xSuccessRate: number;
  xMonthlyPosts: number;
  xMonthlyBudget: number;
  xBudgetUsedPct: number;
}

export interface IngestHeartbeat {
  state: 'ok' | 'warning' | 'critical';
  lastPostAt: string | null;
  ageSeconds: number | null;
  warnMinutes: number;
  criticalMinutes: number;
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
}

interface RpcResult {
  metrics: {
    posts_ingested: number;
    posts_translated: number;
    posts_delivered: number;
    failed_jobs: number;
    posts_truncated_24h?: number;
    posts_hydrated_24h?: number;
    x_api_calls_24h?: number;
    x_posts_24h?: number;
    x_failed_24h?: number;
    x_skipped_no_media_24h?: number;
    x_media_uploads_24h?: number;
  };
  health: {
    success_rate: number;
    avg_latency: number;
    active_feeds: number;
    queue_size: number;
    is_online: boolean;
    x_success_rate?: number;
    x_monthly_posts?: number;
    x_monthly_budget?: number;
    x_budget_used_pct?: number;
  };
  recent_posts: Array<{
    tweet_id: string;
    text_original: string | null;
    created_at: string;
    text_translated: string | null;
    account_handle: string;
  }>;
  ingest_heartbeat?: {
    state: 'ok' | 'warning' | 'critical';
    last_post_at: string | null;
    age_seconds: number | null;
    warn_minutes: number;
    critical_minutes: number;
  };
}

async function fetchDashboard() {
  const { data, error } = await supabase.rpc('get_dashboard_summary');
  if (error) throw error;

  const rpc = data as unknown as RpcResult;

  const metrics: DashboardMetrics = {
    postsIngested: rpc.metrics.posts_ingested,
    postsTranslated: rpc.metrics.posts_translated,
    postsDelivered: rpc.metrics.posts_delivered,
    failedJobs: rpc.metrics.failed_jobs,
    postsTruncated24h: rpc.metrics.posts_truncated_24h ?? 0,
    postsHydrated24h: rpc.metrics.posts_hydrated_24h ?? 0,
    xApiCalls24h: rpc.metrics.x_api_calls_24h ?? 0,
    xPosts24h: rpc.metrics.x_posts_24h ?? 0,
    xFailed24h: rpc.metrics.x_failed_24h ?? 0,
    xSkippedNoMedia24h: rpc.metrics.x_skipped_no_media_24h ?? 0,
    xMediaUploads24h: rpc.metrics.x_media_uploads_24h ?? 0,
  };

  const health: PipelineHealth = {
    successRate: rpc.health.success_rate,
    avgLatency: rpc.health.avg_latency,
    activeFeeds: rpc.health.active_feeds,
    queueSize: rpc.health.queue_size,
    isOnline: rpc.health.is_online,
    xSuccessRate: rpc.health.x_success_rate ?? 100,
    xMonthlyPosts: rpc.health.x_monthly_posts ?? 0,
    xMonthlyBudget: rpc.health.x_monthly_budget ?? 2500,
    xBudgetUsedPct: rpc.health.x_budget_used_pct ?? 0,
  };

  const activities: ActivityItem[] = (rpc.recent_posts || []).map(post => ({
    id: post.tweet_id,
    title: `New post from @${post.account_handle || 'unknown'}`,
    description: (post.text_original?.substring(0, 100) || 'No content') + '...',
    timestamp: post.created_at,
    status: post.text_translated ? 'success' as const : 'pending' as const,
  }));

  return { metrics, health, activities };
}

export function useDashboardData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
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
    const ch1 = supabase.channel('dash-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe();
    const ch2 = supabase.channel('dash-del').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, debouncedInvalidate).subscribe();
    const ch3 = supabase.channel('dash-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedInvalidate).subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return query;
}
