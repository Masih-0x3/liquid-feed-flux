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
  importance_reasoning: string | null;
  delivery_decision: string | null;
  score_axes: Record<string, number> | null;
  final_score: number | null;
  decision_reason: string | null;
  is_truncated: boolean;
  hydrated_at: string | null;
  hydration_source: string | null;
  x_status: string | null;
  x_tweet_id: string | null;
  x_posted_at: string | null;
  x_error: string | null;
  x_skip_reason: string | null;
  dup_of_tweet_id: string | null;
  story_cluster_id: string | null;
  dup_similarity: number | null;
  score_breakdown: { ai?: number; author_bias?: number; tag_bias?: number; knn_prior?: number; final?: number } | null;
  feedback_locked: boolean;
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

export type MonitoringFilter = 'all' | 'needs-translation' | 'delivery-pending' | 'failed' | 'recently-delivered';

const PAGE_SIZE = 30;
const POST_COLUMNS = 'tweet_id, text_original, text_translated, url, created_at, translated_at, has_media, lang_original, author_handle, importance_score, importance_tags, importance_reasoning, delivery_decision, score_axes, final_score, decision_reason, dup_of_tweet_id, story_cluster_id, dup_similarity, score_breakdown, feedback_locked, accounts!inner(handle, display_name)';

async function getFilteredTweetIds(filter: MonitoringFilter, limit: number, offset: number): Promise<string[] | null> {
  switch (filter) {
    case 'recently-delivered': {
      const { data } = await supabase
        .from('deliveries')
        .select('subject_id')
        .eq('subject_type', 'post')
        .eq('status', 'posted')
        .order('posted_at', { ascending: false })
        .range(offset, offset + limit - 1);
      return data?.map((d) => d.subject_id) ?? [];
    }
    case 'failed': {
      const { data } = await supabase
        .from('jobs')
        .select('payload')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      const ids = new Set<string>();
      data?.forEach((j) => {
        const tid = (j.payload as Record<string, string>)?.tweet_id;
        if (tid) ids.add(tid);
      });
      return [...ids];
    }
    default:
      return null;
  }
}

async function fetchMonitoringPage(
  { pageParam = 0 }: { pageParam: number },
  filter: MonitoringFilter,
): Promise<{ entries: MonitoringEntry[]; nextCursor: number | null }> {
  const from = pageParam * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let tweetIds: string[] | null = null;

  if (filter === 'recently-delivered' || filter === 'failed') {
    tweetIds = await getFilteredTweetIds(filter, PAGE_SIZE, from);
    if (!tweetIds || tweetIds.length === 0) return { entries: [], nextCursor: null };
  }

  let query = supabase
    .from('posts')
    .select(POST_COLUMNS)
    .order('created_at', { ascending: false });

  if (tweetIds) {
    query = query.in('tweet_id', tweetIds);
  } else {
    switch (filter) {
      case 'needs-translation':
        query = query.is('translated_at', null);
        break;
      case 'delivery-pending':
        query = query.eq('delivery_decision', 'deliver');
        break;
    }
    query = query.range(from, to);
  }

  const { data: postsData, error: postsError } = await query;
  if (postsError) throw postsError;
  if (!postsData || postsData.length === 0) return { entries: [], nextCursor: null };

  const allTweetIds = postsData.map(p => p.tweet_id);
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  try {
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_post_pipeline_status', { tweet_ids: allTweetIds });
    if (!rpcError && rpcData) {
      (rpcData as Record<string, unknown>[]).forEach((row) => {
        statusByTweet[row.tweet_id as string] = row;
      });
    }
  } catch { /* RPC may not exist */ }

  let entries: MonitoringEntry[] = postsData.map(post => {
    const rpc = statusByTweet[post.tweet_id] as Record<string, unknown> | undefined;
    const translatedAt = rpc?.translated_at || post.translated_at;
    const isTranslated = !!(translatedAt || (post.text_translated && post.text_translated !== post.text_original));
    const deliveryStatus = (rpc?.delivery_status as string) || 'pending';
    const isTruncated = (rpc?.is_truncated as boolean) ?? false;
    const hydratedAt = (rpc?.hydrated_at as string) ?? null;
    const hydrationSource = (rpc?.hydration_source as string) ?? null;

    return {
      tweet_id: post.tweet_id,
      text_original: post.text_original || '',
      text_translated: post.text_translated || '',
      url: post.url || '',
      created_at: post.created_at,
      account_handle: (post.accounts as { handle: string }).handle,
      author_handle: post.author_handle || null,
      delivery_status: deliveryStatus,
      telegram_message_ids: [],
      is_translated: isTranslated,
      is_delivered: deliveryStatus === 'posted',
      translation_job_status: (rpc?.translate_status as string) || (isTranslated ? 'completed' : 'pending'),
      delivery_job_status: deliveryStatus,
      translation_error: (rpc?.translate_error as string) || '',
      delivery_error: (rpc?.delivery_error as string) || '',
      importance_score: post.importance_score ?? null,
      importance_tags: post.importance_tags ?? null,
      importance_reasoning: (post as { importance_reasoning?: string | null }).importance_reasoning ?? null,
      delivery_decision: post.delivery_decision ?? null,
      score_axes: ((post as { score_axes?: Record<string, number> | null }).score_axes ?? null),
      final_score: ((post as { final_score?: number | null }).final_score ?? null),
      decision_reason: ((post as { decision_reason?: string | null }).decision_reason ?? null),
      is_truncated: isTruncated,
      hydrated_at: hydratedAt,
      hydration_source: hydrationSource,
      x_status: (rpc?.x_status as string) ?? null,
      x_tweet_id: (rpc?.x_tweet_id as string) ?? null,
      x_posted_at: (rpc?.x_posted_at as string) ?? null,
      x_error: (rpc?.x_error as string) ?? null,
      x_skip_reason: (rpc?.x_skip_reason as string) ?? null,
      dup_of_tweet_id: ((post as { dup_of_tweet_id?: string | null }).dup_of_tweet_id ?? null),
      story_cluster_id: ((post as { story_cluster_id?: string | null }).story_cluster_id ?? null),
      dup_similarity: ((post as { dup_similarity?: number | null }).dup_similarity ?? null),
      score_breakdown: ((post as { score_breakdown?: MonitoringEntry['score_breakdown'] }).score_breakdown ?? null),
      feedback_locked: ((post as { feedback_locked?: boolean }).feedback_locked ?? false),
    };
  });

  if (filter === 'delivery-pending') {
    entries = entries.filter((e) => e.delivery_status !== 'posted');
  }

  const hasMore = tweetIds
    ? tweetIds.length === PAGE_SIZE
    : postsData.length === PAGE_SIZE;

  return {
    entries,
    nextCursor: hasMore ? pageParam + 1 : null,
  };
}

export function useMonitoringData(filter: MonitoringFilter = 'all') {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['monitoring', filter],
    queryFn: (ctx) => fetchMonitoringPage(ctx, filter),
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

  const allEntries = query.data?.pages.flatMap(p => p.entries) ?? [];

  return {
    ...query,
    entries: allEntries,
  };
}
