import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { invokeAdminAction } from '@/api/adminActions';
import { supabase } from '@/integrations/supabase/client';
import { monitoringStage } from '@/lib/monitoringState';
import { matchesScoringV2Filter } from '@/lib/scoringV2Monitoring';

export interface MonitoringEntry {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  url: string;
  created_at: string;
  has_media: boolean;
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
  scoring_version: string | null;
  scoring_profile_id: string | null;
  audience_class: string | null;
  audience_confidence: number | null;
  audience_reason: string | null;
  global_exception_class: string | null;
  score_review_status: string | null;
  is_truncated: boolean;
  hydrated_at: string | null;
  hydration_source: string | null;
  x_status: string | null;
  x_tweet_id: string | null;
  x_posted_at: string | null;
  x_error: string | null;
  x_skip_reason: string | null;
  dup_of_tweet_id: string | null;
  duplicate_of: {
    tweet_id: string;
    text_original: string;
    url: string;
    created_at: string | null;
    author_handle: string | null;
    delivery_decision: string | null;
    decision_reason: string | null;
    final_score: number | null;
    importance_score: number | null;
    dedupe_status: string | null;
    dup_of_tweet_id: string | null;
    dup_similarity: number | null;
    telegram_state: string;
    x_state: string;
    coverage_state: 'delivered' | 'in_pipeline' | 'also_duplicate' | 'not_covered';
    monitoring_state?: {
      code: string;
      stage_label: string;
      tone: 'good' | 'warn' | 'bad' | 'muted' | 'info';
      decision_label: string;
      primary_blocker: string | null;
      translation_state: string;
      telegram_state: string;
      x_state: string;
      needs_attention: boolean;
      next_actions: string[];
    };
  } | null;
  story_cluster_id: string | null;
  dup_similarity: number | null;
  dedupe_status: string | null;
  dedupe_checked_at: string | null;
  dedupe_method: string | null;
  dedupe_confidence: number | null;
  dedupe_reason: string | null;
  dedupe_new_facts: string[] | null;
  score_breakdown: { ai?: number; author_bias?: number; tag_bias?: number; knn_prior?: number; final?: number; scoring_v2?: Record<string, unknown> } | null;
  feedback_locked: boolean;
  enrich_status: string | null;
  enrichment_version: string | null;
  editorial_commentary: string | null;
  humanized_commentary: string | null;
  commentary_hook: string | null;
  commentary_question: string | null;
  narrative_callback: string | null;
  composed_post_text: string | null;
  creator_angle: string | null;
  why_it_matters: string | null;
  source_context: {
    attribution_policy?: string;
    source_label?: string | null;
    source_url?: string | null;
    sources?: string[];
    voice?: {
      profile_version?: string;
      intent?: string;
      language_choice?: string;
      selected_variant?: string;
      variants?: Array<{
        kind?: string;
        label?: string;
        final_x_text?: string;
        news_section?: string;
        take_section?: string;
        creator_angle?: string;
        why_it_matters?: string;
        language_choice?: string;
        intent?: string;
        voice_rationale?: string;
        platform_risk_note?: string | null;
      }>;
      critic?: {
        variants?: Array<{
          kind?: string;
          voice_match?: number;
          too_generic?: number;
          too_ai?: number;
          too_soft?: number;
          too_newsy?: number;
          too_long?: number;
          platform_risk?: number;
          rationale?: string;
        }>;
        overall_reason?: string;
      };
    };
  } | null;
  algorithm_signal_scores: Record<string, number> | null;
  aggregator_risk_score: number | null;
  ai_voice_risk_score: number | null;
  monetization_risk_flags: string[] | null;
  enrichment_review_reason: string | null;
  final_x_text: string | null;
  post_format_hint: string | null;
  background_context: { background_summary?: string; key_facts?: string[]; related_events?: string; sources?: string[] } | null;
  enrich_tokens: number | null;
  enrich_duration_ms: number | null;
  x_cost_flags?: {
    may_call_x: boolean;
    media_upload_expected: boolean;
    hydration_expected: boolean;
    reasons: string[];
  };
  monitoring_state?: {
    code: string;
    stage_label: string;
    tone: 'good' | 'warn' | 'bad' | 'muted' | 'info';
    decision_label: string;
    primary_blocker: string | null;
    translation_state: string;
    telegram_state: string;
    x_state: string;
    needs_attention: boolean;
    next_actions: string[];
  };
  duplicate_cluster?: DuplicateCluster | null;
  hidden_in_cluster?: boolean;
}

export type ScoreBucket = 'any' | 'unscored' | 'lt5' | '5_9' | '10_13' | '14_plus' | '17_plus';

export interface DuplicateClusterMember {
  tweet_id: string;
  text_original: string;
  url: string;
  created_at: string | null;
  author_handle: string | null;
  final_score: number | null;
  importance_score: number | null;
  dedupe_status: string | null;
  dup_of_tweet_id: string | null;
  dup_similarity: number | null;
  dedupe_confidence?: number | null;
  dedupe_reason?: string | null;
  telegram_state: string;
  x_state: string;
  coverage_state?: 'delivered' | 'in_pipeline' | 'also_duplicate' | 'not_covered';
  is_canonical?: boolean;
}

export interface DuplicateCluster {
  cluster_id: string;
  canonical_tweet_id: string;
  members: DuplicateClusterMember[];
  counts: {
    total: number;
    delivered: number;
    x_posted: number;
    blocked: number;
    uncertain: number;
    coverage_gap: number;
  };
  has_x_anomaly: boolean;
  coverage_state: 'covered' | 'in_pipeline' | 'coverage_gap' | 'unknown';
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

export type MonitoringFilter =
  | 'all'
  | 'needs_attention'
  | 'failed_stuck'
  | 'needs_score'
  | 'translation_queue'
  | 'below_threshold'
  | 'manual_review'
  | 'v2_would_post'
  | 'v2_would_skip'
  | 'v1_post_v2_skip'
  | 'v1_skip_v2_post'
  | 'v2_off_topic'
  | 'v2_needs_review'
  | 'v2_regional_auto'
  | 'global_pilot_review'
  | 'manual_scoring_feedback'
  | 'duplicates'
  | 'coverage_gap'
  | 'possible_duplicate'
  | 'duplicate_anomalies'
  | 'ready_to_deliver'
  | 'telegram_pending'
  | 'x_pending'
  | 'x_failed'
  | 'delivered_24h'
  | 'hydration';

export interface MonitoringOverview {
  window_hours: number;
  counts: {
    needs_attention: number;
    failed_stuck: number;
    translation_queue: number;
    needs_score: number;
    ready_to_deliver: number;
    manual_review: number;
    duplicates: number;
    coverage_gap?: number;
    possible_duplicate?: number;
    duplicate_anomalies?: number;
    hydration: number;
    x_pending: number;
    x_failed: number;
    delivered_24h: number;
    telegram_pending: number;
    below_threshold: number;
    v2_regional_auto: number;
    global_pilot_review: number;
    manual_scoring_feedback: number;
    stale_jobs: number;
    stale_x_pending_24h: number;
    needs_action?: number;
    failed?: number;
    waiting_translation?: number;
    delivery_pending?: number;
    awaiting_review?: number;
    duplicate_skipped?: number;
    hydration_backlog?: number;
    posted_24h?: number;
    ready_to_publish?: number;
  };
}

export interface XApiSummary {
  window_hours: number;
  attempts: number;
  counted_attempts: number;
  failed_attempts: number;
  success_rate: number;
  by_unit: Record<string, number>;
  by_source: Record<string, number>;
  posts_local: number;
  media_posts_local: number;
  configured_budget: {
    posts_per_hour: number | null;
    posts_per_day: number | null;
    monthly_post_budget: number | null;
    hydrations_per_day: number | null;
  };
  latest_events: Array<Record<string, unknown>>;
  official_usage?: Record<string, unknown>;
}

const PAGE_SIZE = 50;
const BASE_POST_COLUMNS = 'tweet_id, text_original, text_translated, url, created_at, translated_at, has_media, lang_original, author_handle, importance_score, importance_tags, importance_reasoning, delivery_decision, score_axes, final_score, decision_reason, dup_of_tweet_id, story_cluster_id, dup_similarity, score_breakdown, feedback_locked, enrich_status, editorial_commentary, humanized_commentary, commentary_hook, commentary_question, narrative_callback, composed_post_text, post_format_hint, background_context, enrich_tokens, enrich_duration_ms, accounts!inner(handle, display_name)';
const ENRICHMENT_V2_POST_COLUMNS = 'enrichment_version, creator_angle, why_it_matters, source_context, algorithm_signal_scores, aggregator_risk_score, ai_voice_risk_score, monetization_risk_flags, enrichment_review_reason, final_x_text';
const DEDUPE_POST_COLUMNS = 'dedupe_status, dedupe_checked_at, dedupe_method, dedupe_confidence, dedupe_reason, dedupe_new_facts';
const SCORING_V2_POST_COLUMNS = 'scoring_version, scoring_profile_id, audience_class, audience_confidence, audience_reason, global_exception_class, score_review_status';
const POST_COLUMNS = `${BASE_POST_COLUMNS}, ${ENRICHMENT_V2_POST_COLUMNS}, ${DEDUPE_POST_COLUMNS}, ${SCORING_V2_POST_COLUMNS}`;
const POST_COLUMNS_NO_ENRICHMENT_V2 = `${BASE_POST_COLUMNS}, ${DEDUPE_POST_COLUMNS}, ${SCORING_V2_POST_COLUMNS}`;

type LegacyFilter = 'all' | 'failed' | 'awaiting-review';
type LegacyPostRow = {
  tweet_id: string;
  text_original: string | null;
  text_translated: string | null;
  url: string | null;
  created_at: string;
  translated_at: string | null;
  has_media: boolean | null;
  author_handle: string | null;
  importance_score: number | null;
  importance_tags: string[] | null;
  delivery_decision: string | null;
  accounts: { handle: string } | { handle: string }[] | null;
  [key: string]: unknown;
};

function toLegacyFilter(filter: MonitoringFilter): LegacyFilter {
  if (filter === 'failed_stuck') return 'failed';
  if (filter === 'manual_review') return 'awaiting-review';
  return 'all';
}

async function getLegacyFilteredTweetIds(filter: LegacyFilter, limit: number, offset: number): Promise<string[] | null> {
  switch (filter) {
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
    case 'awaiting-review': {
      const { data } = await supabase
        .from('posts')
        .select('tweet_id')
        .eq('enrich_status', 'awaiting_approval')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      return data?.map((d) => d.tweet_id) ?? [];
    }
    default:
      return null;
  }
}

function sanitizeSearch(search: string): string {
  return search.trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
}

function entryScore(entry: Pick<MonitoringEntry, 'final_score' | 'importance_score'>): number | null {
  return entry.final_score ?? entry.importance_score ?? null;
}

function matchesScoreBucket(entry: Pick<MonitoringEntry, 'final_score' | 'importance_score'>, bucket: ScoreBucket): boolean {
  const score = entryScore(entry);
  switch (bucket) {
    case 'any':
      return true;
    case 'unscored':
      return score == null;
    case 'lt5':
      return score != null && score < 5;
    case '5_9':
      return score != null && score >= 5 && score < 10;
    case '10_13':
      return score != null && score >= 10 && score < 14;
    case '14_plus':
      return score != null && score >= 14;
    case '17_plus':
      return score != null && score >= 17;
  }
}

function isMissingDedupeColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? '');
  return /posts\.(dedupe_|scoring_|audience_|global_exception_class|score_review_status|enrichment_|creator_angle|why_it_matters|source_context|algorithm_signal_scores|aggregator_risk_score|ai_voice_risk_score|monetization_risk_flags|final_x_text)|dedupe_(status|checked_at|method|confidence|reason|new_facts)|scoring_(version|profile_id)|audience_(class|confidence|reason)|score_review_status|global_exception_class|enrichment_version|creator_angle|why_it_matters|source_context|algorithm_signal_scores|aggregator_risk_score|ai_voice_risk_score|monetization_risk_flags|enrichment_review_reason|final_x_text/i.test(message)
    && /does not exist|column|schema cache/i.test(message);
}

async function fetchPostsPage(
  columns: string,
  from: number,
  to: number,
  tweetIds: string[] | null,
  term: string,
) {
  let query = supabase
    .from('posts')
    .select(columns)
    .order('created_at', { ascending: false });

  if (tweetIds) {
    query = query.in('tweet_id', tweetIds);
  } else {
    query = query.range(from, to);
  }

  if (term) {
    const q = `%${term}%`;
    query = query.or(`tweet_id.ilike.${q},author_handle.ilike.${q},url.ilike.${q},text_original.ilike.${q},text_translated.ilike.${q}`);
  }

  return query;
}

async function fetchLegacyMonitoringPage(
  { pageParam = 0 }: { pageParam: number },
  filter: MonitoringFilter,
  search: string,
  scoreBucket: ScoreBucket,
): Promise<{ entries: MonitoringEntry[]; nextCursor: number | null }> {
  const from = pageParam;
  const to = from + PAGE_SIZE - 1;
  const legacyFilter = toLegacyFilter(filter);
  let tweetIds: string[] | null = null;

  if (legacyFilter === 'failed' || legacyFilter === 'awaiting-review') {
    tweetIds = await getLegacyFilteredTweetIds(legacyFilter, PAGE_SIZE, from);
    if (!tweetIds || tweetIds.length === 0) return { entries: [], nextCursor: null };
  }

  const term = sanitizeSearch(search);
  let postsData: LegacyPostRow[] | null = null;
  let postsError;

  const primaryResult = await fetchPostsPage(POST_COLUMNS, from, to, tweetIds, term);
  postsData = (primaryResult.data ?? null) as unknown as LegacyPostRow[] | null;
  postsError = primaryResult.error;

  if (postsError && isMissingDedupeColumnError(postsError)) {
    const enrichmentFallback = await fetchPostsPage(POST_COLUMNS_NO_ENRICHMENT_V2, from, to, tweetIds, term);
    postsData = (enrichmentFallback.data ?? null) as unknown as LegacyPostRow[] | null;
    postsError = enrichmentFallback.error;
  }

  if (postsError && isMissingDedupeColumnError(postsError)) {
    const fallbackResult = await fetchPostsPage(BASE_POST_COLUMNS, from, to, tweetIds, term);
    postsData = (fallbackResult.data ?? null) as unknown as LegacyPostRow[] | null;
    postsError = fallbackResult.error;
  }

  if (postsError) throw postsError;
  if (!postsData || postsData.length === 0) return { entries: [], nextCursor: null };

  const allTweetIds = postsData.map(p => p.tweet_id);
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  try {
    const rpcData = await invokeAdminAction<{ success?: boolean; statuses?: Record<string, unknown>[] }>({
      action: 'get_post_pipeline_status',
      tweet_ids: allTweetIds,
    });
    const rows = rpcData?.statuses as Record<string, unknown>[] | undefined;
    if (rows) {
      rows.forEach((row) => {
        statusByTweet[row.tweet_id as string] = row;
      });
    }
  } catch { /* deployed admin-actions may be temporarily behind local UI */ }

  const entries: MonitoringEntry[] = postsData.map(post => {
    const rpc = statusByTweet[post.tweet_id] as Record<string, unknown> | undefined;
    const translatedAt = rpc?.translated_at || post.translated_at;
    const isTranslated = !!(translatedAt || (post.text_translated && post.text_translated !== post.text_original));
    const deliveryStatus = (rpc?.delivery_status as string) || '';
    const isTruncated = (rpc?.is_truncated as boolean) ?? false;
    const hydratedAt = (rpc?.hydrated_at as string) ?? null;
    const hydrationSource = (rpc?.hydration_source as string) ?? null;
    const xStatus = (rpc?.x_status as string) ?? null;

    return {
      tweet_id: post.tweet_id,
      text_original: post.text_original || '',
      text_translated: post.text_translated || '',
      url: post.url || '',
      created_at: post.created_at,
      has_media: Boolean(post.has_media),
      account_handle: Array.isArray(post.accounts) ? post.accounts[0]?.handle ?? '' : post.accounts?.handle ?? '',
      author_handle: post.author_handle || null,
      delivery_status: deliveryStatus,
      telegram_message_ids: [],
      is_translated: isTranslated,
      is_delivered: deliveryStatus === 'posted',
      translation_job_status: (rpc?.translate_status as string) || (isTranslated ? 'completed' : ''),
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
      scoring_version: ((post as { scoring_version?: string | null }).scoring_version ?? null),
      scoring_profile_id: ((post as { scoring_profile_id?: string | null }).scoring_profile_id ?? null),
      audience_class: ((post as { audience_class?: string | null }).audience_class ?? null),
      audience_confidence: ((post as { audience_confidence?: number | null }).audience_confidence ?? null),
      audience_reason: ((post as { audience_reason?: string | null }).audience_reason ?? null),
      global_exception_class: ((post as { global_exception_class?: string | null }).global_exception_class ?? null),
      score_review_status: ((post as { score_review_status?: string | null }).score_review_status ?? null),
      is_truncated: isTruncated,
      hydrated_at: hydratedAt,
      hydration_source: hydrationSource,
      x_status: xStatus,
      x_tweet_id: (rpc?.x_tweet_id as string) ?? null,
      x_posted_at: (rpc?.x_posted_at as string) ?? null,
      x_error: (rpc?.x_error as string) ?? null,
      x_skip_reason: (rpc?.x_skip_reason as string) ?? null,
      dup_of_tweet_id: ((post as { dup_of_tweet_id?: string | null }).dup_of_tweet_id ?? null),
      duplicate_of: null,
      story_cluster_id: ((post as { story_cluster_id?: string | null }).story_cluster_id ?? null),
      dup_similarity: ((post as { dup_similarity?: number | null }).dup_similarity ?? null),
      dedupe_status: ((post as { dedupe_status?: string | null }).dedupe_status ?? null),
      dedupe_checked_at: ((post as { dedupe_checked_at?: string | null }).dedupe_checked_at ?? null),
      dedupe_method: ((post as { dedupe_method?: string | null }).dedupe_method ?? null),
      dedupe_confidence: ((post as { dedupe_confidence?: number | null }).dedupe_confidence ?? null),
      dedupe_reason: ((post as { dedupe_reason?: string | null }).dedupe_reason ?? null),
      dedupe_new_facts: ((post as { dedupe_new_facts?: string[] | null }).dedupe_new_facts ?? null),
      score_breakdown: ((post as { score_breakdown?: MonitoringEntry['score_breakdown'] }).score_breakdown ?? null),
      feedback_locked: ((post as { feedback_locked?: boolean }).feedback_locked ?? false),
      enrich_status: ((post as { enrich_status?: string | null }).enrich_status ?? null),
      enrichment_version: ((post as { enrichment_version?: string | null }).enrichment_version ?? null),
      editorial_commentary: ((post as { editorial_commentary?: string | null }).editorial_commentary ?? null),
      humanized_commentary: ((post as { humanized_commentary?: string | null }).humanized_commentary ?? null),
      commentary_hook: ((post as { commentary_hook?: string | null }).commentary_hook ?? null),
      commentary_question: ((post as { commentary_question?: string | null }).commentary_question ?? null),
      narrative_callback: ((post as { narrative_callback?: string | null }).narrative_callback ?? null),
      composed_post_text: ((post as { composed_post_text?: string | null }).composed_post_text ?? null),
      creator_angle: ((post as { creator_angle?: string | null }).creator_angle ?? null),
      why_it_matters: ((post as { why_it_matters?: string | null }).why_it_matters ?? null),
      source_context: ((post as { source_context?: MonitoringEntry['source_context'] }).source_context ?? null),
      algorithm_signal_scores: ((post as { algorithm_signal_scores?: Record<string, number> | null }).algorithm_signal_scores ?? null),
      aggregator_risk_score: ((post as { aggregator_risk_score?: number | null }).aggregator_risk_score ?? null),
      ai_voice_risk_score: ((post as { ai_voice_risk_score?: number | null }).ai_voice_risk_score ?? null),
      monetization_risk_flags: ((post as { monetization_risk_flags?: string[] | null }).monetization_risk_flags ?? null),
      enrichment_review_reason: ((post as { enrichment_review_reason?: string | null }).enrichment_review_reason ?? null),
      final_x_text: ((post as { final_x_text?: string | null }).final_x_text ?? null),
      post_format_hint: ((post as { post_format_hint?: string | null }).post_format_hint ?? null),
      background_context: ((post as { background_context?: MonitoringEntry['background_context'] }).background_context ?? null),
      enrich_tokens: ((post as { enrich_tokens?: number | null }).enrich_tokens ?? null),
      enrich_duration_ms: ((post as { enrich_duration_ms?: number | null }).enrich_duration_ms ?? null),
      x_cost_flags: {
        may_call_x: post.delivery_decision === 'deliver' && isTranslated && xStatus !== 'posted',
        media_upload_expected: post.delivery_decision === 'deliver' && isTranslated && xStatus !== 'posted' && Boolean(post.has_media),
        hydration_expected: post.delivery_decision === 'deliver' && isTruncated && !hydratedAt,
        reasons: [
          ...((post.delivery_decision === 'deliver' && isTruncated && !hydratedAt) ? ['hydrate read may be needed'] : []),
          ...((post.delivery_decision === 'deliver' && isTranslated && xStatus !== 'posted' && post.has_media) ? ['media upload expected'] : []),
          ...((post.delivery_decision === 'deliver' && isTranslated && xStatus !== 'posted') ? ['tweet write expected'] : []),
        ],
      },
    };
  });

  return {
    entries: entries.filter((entry) => matchesLegacyMonitoringFilter(entry, filter) && matchesScoreBucket(entry, scoreBucket)),
    nextCursor: postsData.length === PAGE_SIZE ? from + PAGE_SIZE : null,
  };
}

function matchesLegacyMonitoringFilter(entry: MonitoringEntry, filter: MonitoringFilter): boolean {
  if (filter === 'all') return true;
  const stage = monitoringStage(entry);
  switch (filter) {
    case 'needs_attention':
      return stage.tone === 'bad' || stage.tone === 'warn';
    case 'failed_stuck':
      return stage.label === 'Failed/stuck';
    case 'needs_score':
      return stage.label === 'Needs score';
    case 'translation_queue':
      return stage.label === 'Needs translation' || entry.translation_job_status === 'pending' || entry.translation_job_status === 'running';
    case 'below_threshold':
      return entry.decision_reason?.startsWith('below_threshold:') || entry.delivery_decision === 'skip';
    case 'manual_review':
      return entry.enrich_status === 'awaiting_approval';
    case 'v2_would_post':
    case 'v2_would_skip':
    case 'v1_post_v2_skip':
    case 'v1_skip_v2_post':
    case 'v2_off_topic':
    case 'v2_needs_review':
    case 'v2_regional_auto':
    case 'global_pilot_review':
      return matchesScoringV2Filter(entry, filter);
    case 'manual_scoring_feedback':
      return entry.feedback_locked === true && (
        entry.score_review_status === 'approved'
        || entry.score_review_status === 'rejected'
        || entry.decision_reason?.startsWith('manual_score_') === true
        || entry.decision_reason?.startsWith('score_feedback_') === true
      );
    case 'duplicates':
      return !!entry.dup_of_tweet_id;
    case 'coverage_gap':
      return entry.monitoring_state?.code === 'duplicate_coverage_gap' || entry.dedupe_status === 'coverage_gap';
    case 'possible_duplicate':
      return entry.dedupe_status === 'uncertain' || entry.dedupe_status === 'coverage_gap';
    case 'duplicate_anomalies':
      return entry.x_status === 'posted' && entry.duplicate_of?.x_state === 'posted';
    case 'ready_to_deliver':
      return stage.label === 'Ready' && entry.delivery_decision === 'deliver' && entry.is_translated && !entry.is_delivered;
    case 'telegram_pending':
      return entry.delivery_status === 'pending' || entry.delivery_status === 'running';
    case 'x_pending':
      return entry.x_status === 'pending';
    case 'x_failed':
      return entry.x_status === 'failed';
    case 'delivered_24h':
      return entry.x_status === 'posted' || entry.is_delivered;
    case 'hydration':
      return stage.label === 'Hydration';
  }
}

async function fetchMonitoringPage(
  { pageParam = 0 }: { pageParam: number },
  filter: MonitoringFilter,
  search: string,
  scoreBucket: ScoreBucket,
): Promise<{ entries: MonitoringEntry[]; nextCursor: number | null }> {
  try {
    const data = await invokeAdminAction<{ success?: boolean; error?: string; entries?: unknown[]; next_cursor?: unknown }>({
      action: 'get_monitoring_entries',
      filter,
      search: sanitizeSearch(search) || undefined,
      score_bucket: scoreBucket,
      cursor: pageParam,
      limit: PAGE_SIZE,
    });
    if (data?.success && Array.isArray(data.entries)) {
      return {
        entries: data.entries as MonitoringEntry[],
        nextCursor: typeof data.next_cursor === 'number' ? data.next_cursor : null,
      };
    }
    if (data?.error) throw new Error(String(data.error));
  } catch {
    // Keeps local dev usable when the frontend is ahead of the deployed Edge Function.
  }

  return fetchLegacyMonitoringPage({ pageParam }, filter, search, scoreBucket);
}

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
    queryKey: ['monitoring', filter, sanitizeSearch(search), scoreBucket],
    queryFn: (ctx) => fetchMonitoringPage(ctx, filter, search, scoreBucket),
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
    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
      supabase.removeChannel(ch4);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [debouncedInvalidate]);

  return {
    ...query,
    entries: query.data?.pages.flatMap(p => p.entries) ?? [],
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
