import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DashboardMetrics {
  postsIngested: number;
  postsTranslated: number;
  postsDelivered: number;
  failedJobs: number;
}

export interface PipelineHealth {
  successRate: number;
  avgLatency: number;
  activeFeeds: number;
  queueSize: number;
  isOnline: boolean;
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
}

async function fetchDashboard() {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
  const since = twentyFourHoursAgo.toISOString();

  const [postsResult, deliveriesResult, jobsResult, recentResult, accountsResult] = await Promise.all([
    supabase.from('posts').select('tweet_id, text_translated, created_at').gte('created_at', since),
    supabase.from('deliveries').select('subject_id, status, created_at, subject_type').gte('created_at', since),
    supabase.from('jobs').select('status, created_at').gte('created_at', since),
    supabase.from('posts').select('tweet_id, text_original, created_at, text_translated, accounts(handle)').order('created_at', { ascending: false }).limit(10),
    supabase.from('accounts').select('id').eq('enabled', true),
  ]);

  if (postsResult.error) throw postsResult.error;
  if (deliveriesResult.error) throw deliveriesResult.error;
  if (jobsResult.error) throw jobsResult.error;

  const posts = postsResult.data || [];
  const deliveries = deliveriesResult.data || [];
  const jobs = jobsResult.data || [];
  const recentPosts = recentResult.data || [];
  const accounts = accountsResult.data || [];

  const translatedPosts = posts.filter(p => p.text_translated);
  const successfulDeliveries = deliveries.filter(d => d.status === 'posted');
  const failedJobs = jobs.filter(j => j.status === 'failed');
  const pendingJobs = jobs.filter(j => j.status === 'pending');

  const metrics: DashboardMetrics = {
    postsIngested: posts.length,
    postsTranslated: translatedPosts.length,
    postsDelivered: successfulDeliveries.length,
    failedJobs: failedJobs.length,
  };

  const totalJobs = jobs.length;
  const successfulJobs = jobs.filter(j => j.status === 'completed').length;
  const successRate = totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 100;

  // Compute avg latency from posts → deliveries
  const postCreatedMap = new Map<string, string>();
  posts.forEach(p => { if (p.tweet_id && p.created_at) postCreatedMap.set(p.tweet_id, p.created_at); });
  const postedDeliveries = deliveries.filter(d => d.status === 'posted' && d.subject_type === 'post');
  const latencies = postedDeliveries
    .map(d => {
      const pc = postCreatedMap.get(d.subject_id);
      if (!pc) return null;
      const diff = new Date(d.created_at).getTime() - new Date(pc).getTime();
      return diff > 0 && isFinite(diff) ? diff / 1000 : null;
    })
    .filter((s): s is number => s !== null);

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const health: PipelineHealth = {
    successRate: Math.round(successRate * 10) / 10,
    avgLatency: Math.round(avgLatency * 10) / 10,
    activeFeeds: accounts.length,
    queueSize: pendingJobs.length,
    isOnline: true,
  };

  const activities: ActivityItem[] = recentPosts.map(post => ({
    id: post.tweet_id,
    title: `New post from @${(post.accounts as { handle: string })?.handle || 'unknown'}`,
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
    refetchOnWindowFocus: false,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }, 500);
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
