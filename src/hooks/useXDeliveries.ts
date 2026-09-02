import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface XDeliveryRow {
  id: string;
  post_id: string;
  x_tweet_id: string | null;
  status: string;
  skip_reason: string | null;
  attempts: number;
  last_error: string | null;
  media_count: number;
  posted_at: string | null;
  latency_ms: number | null;
  created_at: string;
}

export function useXDeliveries() {
  return useQuery({
    queryKey: ['x_deliveries'],
    queryFn: async (): Promise<XDeliveryRow[]> => {
      // x_deliveries types may not yet be regenerated — cast through unknown
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (s: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: XDeliveryRow[] | null; error: Error | null }> } } };
      })
        .from('x_deliveries')
        .select('id, post_id, x_tweet_id, status, skip_reason, attempts, last_error, media_count, posted_at, latency_ms, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as XDeliveryRow[];
    },
    staleTime: 30_000,
  });
}

export function useXMonthlyPostsCount(enabled = true) {
  return useQuery({
    queryKey: ['x_deliveries', 'monthly_count'],
    enabled,
    queryFn: async (): Promise<number> => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string, opts: { count: 'exact'; head: boolean }) => {
            eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ count: number | null; error: Error | null }> };
          };
        };
      })
        .from('x_deliveries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'posted')
        .gte('created_at', since);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });
}
