import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MonitoringEntry {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  url: string;
  created_at: string;
  account_handle: string;
  author_handle: string | null;
  delivery_status: string;
  telegram_message_ids: string[];
  is_translated: boolean;
  is_delivered: boolean;
  translation_job_status: string;
  delivery_job_status: string;
  translation_error: string;
  delivery_error: string;
  importance_score: number | null;
  importance_tags: string[] | null;
  delivery_decision: string | null;
}

export interface PipelineEvent {
  subject_type: string;
  subject_id: string;
  step: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
  meta?: Record<string, unknown>;
}

const PAGE_SIZE = 30;

async function fetchMonitoringPage({ pageParam = 0 }: { pageParam: number }): Promise<{ entries: MonitoringEntry[]; nextCursor: number | null }> {
  const from = pageParam * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: postsData, error: postsError } = await supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, url, created_at, translated_at, has_media, lang_original, accounts!inner(handle, display_name)')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (postsError) throw postsError;
  if (!postsData || postsData.length === 0) return { entries: [], nextCursor: null };

  const tweetIds = postsData.map(p => p.tweet_id);
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  try {
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_post_pipeline_status', { tweet_ids: tweetIds });
    if (!rpcError && rpcData) {
      (rpcData as Record<string, unknown>[]).forEach((row) => {
        statusByTweet[row.tweet_id as string] = row;
      });
    }
  } catch { /* RPC may not exist */ }

  const entries: MonitoringEntry[] = postsData.map(post => {
    const rpc = statusByTweet[post.tweet_id] as Record<string, unknown> | undefined;
    const translatedAt = rpc?.translated_at || post.translated_at;
    const isTranslated = !!(translatedAt || (post.text_translated && post.text_translated !== post.text_original));
    const deliveryStatus = (rpc?.delivery_status as string) || 'pending';

    return {
      tweet_id: post.tweet_id,
      text_original: post.text_original || '',
      text_translated: post.text_translated || '',
      url: post.url || '',
      created_at: post.created_at,
      account_handle: (post.accounts as { handle: string }).handle,
      delivery_status: deliveryStatus,
      telegram_message_ids: [],
      is_translated: isTranslated,
      is_delivered: deliveryStatus === 'posted',
      translation_job_status: (rpc?.translate_status as string) || (isTranslated ? 'completed' : 'pending'),
      delivery_job_status: deliveryStatus,
      translation_error: (rpc?.translate_error as string) || '',
      delivery_error: (rpc?.delivery_error as string) || '',
    };
  });

  return {
    entries,
    nextCursor: postsData.length === PAGE_SIZE ? pageParam + 1 : null,
  };
}

export function useMonitoringData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['monitoring'],
    queryFn: fetchMonitoringPage,
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
    }, 1000);
  }, [queryClient]);

  useEffect(() => {
    const ch1 = supabase.channel('mon-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, debouncedInvalidate).subscribe();
    const ch2 = supabase.channel('mon-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedInvalidate).subscribe();
    const ch3 = supabase.channel('mon-del').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, debouncedInvalidate).subscribe();
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  // Flatten pages into a single array for consumers
  const allEntries = query.data?.pages.flatMap(p => p.entries) ?? [];

  return {
    ...query,
    entries: allEntries,
  };
}
