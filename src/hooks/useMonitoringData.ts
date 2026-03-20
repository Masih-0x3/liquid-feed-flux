import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MonitoringEntry {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  url: string;
  created_at: string;
  account_handle: string;
  delivery_status: string;
  telegram_message_ids: string[];
  is_translated: boolean;
  is_delivered: boolean;
  translation_job_status: string;
  delivery_job_status: string;
  translation_error: string;
  delivery_error: string;
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

async function fetchMonitoring(): Promise<MonitoringEntry[]> {
  const { data: postsData, error: postsError } = await supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, url, created_at, translated_at, has_media, lang_original, accounts!inner(handle, display_name)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (postsError) throw postsError;
  if (!postsData || postsData.length === 0) return [];

  const tweetIds = postsData.map(p => p.tweet_id);
  let statusByTweet: Record<string, Record<string, unknown>> = {};
  try {
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_post_pipeline_status', { tweet_ids: tweetIds });
    if (!rpcError && rpcData) {
      (rpcData as Record<string, unknown>[]).forEach((row) => {
        statusByTweet[row.tweet_id as string] = row;
      });
    }
  } catch { /* RPC may not exist */ }

  return postsData.map(post => {
    const rpc = statusByTweet[post.tweet_id] as Record<string, unknown> | undefined;
    const isTranslated = !!(rpc?.translated_at || post.translated_at || (post.text_translated && post.text_translated !== post.text_original));
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
}

export function useMonitoringData() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: ['monitoring'],
    queryFn: fetchMonitoring,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const debouncedInvalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['monitoring'] });
    }, 500);
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

  return query;
}
