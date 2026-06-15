import { invokeAdminAction } from '@/api/adminActions';

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
    monitoring_state?: MonitoringStateSnapshot;
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
  monitoring_state?: MonitoringStateSnapshot;
  duplicate_cluster?: DuplicateCluster | null;
  hidden_in_cluster?: boolean;
}

export interface MonitoringStateSnapshot {
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

export type MonitoringDataSource = 'admin_actions';

export interface MonitoringPage {
  entries: MonitoringEntry[];
  nextCursor: number | null;
  source: MonitoringDataSource;
}

export interface MonitoringFetchParams {
  pageParam?: number;
  filter: MonitoringFilter;
  search: string;
  scoreBucket: ScoreBucket;
}

const PAGE_SIZE = 50;

export function sanitizeMonitoringSearch(search: string): string {
  return search.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export async function fetchMonitoringEntries({
  pageParam = 0,
  filter,
  search,
  scoreBucket,
}: MonitoringFetchParams): Promise<MonitoringPage> {
  const data = await invokeAdminAction<{ success?: boolean; error?: string; entries?: unknown[]; next_cursor?: unknown }>({
    action: 'get_monitoring_entries',
    filter,
    search: sanitizeMonitoringSearch(search) || undefined,
    score_bucket: scoreBucket,
    cursor: pageParam,
    limit: PAGE_SIZE,
  });
  if (data?.success && Array.isArray(data.entries)) {
    return {
      entries: data.entries as MonitoringEntry[],
      nextCursor: typeof data.next_cursor === 'number' ? data.next_cursor : null,
      source: 'admin_actions',
    };
  }
  throw new Error(data?.error ?? 'Monitoring entries unavailable');
}
