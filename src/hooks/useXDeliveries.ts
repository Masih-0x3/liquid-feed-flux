import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
