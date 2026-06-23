import { invokeAdminAction } from "@/api/adminActions";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import { shortText } from "@/lib/monitoringViewModel";

export type AudienceFeedback = 'too_low' | 'too_high' | 'correct_deliver' | 'correct_skip' | 'should_pass_audience' | 'should_skip' | 'wrong_relevance_class' | 'global_exception_worth_covering' | 'not_global_exception';
export type AudienceClassValue = 'direct_focus' | 'adjacent' | 'global_exception' | 'off_topic';
export type ScoringFeedbackReasonTag = 'regional_escalation' | 'oil_shipping' | 'leader_statement' | 'global_mega_event' | 'direct_focus' | 'adjacent_context' | 'should_skip' | 'wrong_class' | 'duplicate' | 'stale' | 'source_trust' | 'broad_global' | 'other';
export type EnrichmentFeedback = 'sounds_like_me' | 'too_soft' | 'too_ai' | 'too_newsy' | 'not_blunt_enough' | 'too_long' | 'good_clapback' | 'strong_angle' | 'too_risky' | 'too_cheesy' | 'too_aggregator' | 'needs_more_context' | 'unsafe_for_monetization';
export type XDiagnosticBlocker = { code: string; label: string; severity: 'blocker' | 'deferred' | 'note' };
export type XPostingDiagnosticItem = {
  tweet_id: string;
  eligible: boolean;
  blockers: XDiagnosticBlocker[];
  notes: XDiagnosticBlocker[];
  score?: number | null;
  threshold?: number;
  decision?: string | null;
  latest_x?: { status?: string; skip_reason?: string | null; last_error?: string | null; x_tweet_id?: string | null } | null;
  candidate?: {
    sql_gate_passed?: boolean;
    reason?: string | null;
    age_ms?: number | null;
    dispatch_source?: string | null;
  };
  active_jobs?: Array<{ type?: string; status?: string; error?: string | null }>;
  hydration?: { is_truncated?: boolean; hydrated_at?: string | null; active_hydrate_job?: boolean };
  media?: {
    has_media?: boolean;
    rows?: number;
    downloaded?: number;
    active_media_job?: boolean;
    selected_tier?: string;
    selected_reason?: string | null;
    row_details?: Array<{
      id?: string | null;
      kind?: string | null;
      mime_type?: string | null;
      file_size?: number | null;
      downloaded?: boolean;
      video_intent?: boolean;
      sendable?: boolean;
      role?: string;
    }>;
  };
  enrichment?: { status?: string | null; pipeline_mode?: string; required_for_x?: boolean; approved_for_text?: boolean; text_source?: string };
};

export type ConfirmAction = 'force_telegram' | 'force_x' | 'rescore' | 'reprocess' | 'hydrate' | 'clear_dup' | 'ignore' | 'close_stale_x' | 'translate' | 'run_dedupe' | 'cancel_jobs' | 'approve_enrichment' | 'reject_enrichment';
export type BulkAction = 'bulk_reprocess' | 'bulk_ignore';

export interface PendingAction {
  type: ConfirmAction;
  entry?: MonitoringEntry;
}

export interface PendingBulkAction {
  type: BulkAction;
  tweetIds: string[];
}

export function defaultReasonTag(feedback: AudienceFeedback, expectedAudienceClass?: AudienceClassValue | ''): ScoringFeedbackReasonTag {
  if (feedback === 'global_exception_worth_covering') return expectedAudienceClass === 'global_exception' ? 'global_mega_event' : 'broad_global';
  if (feedback === 'not_global_exception' || feedback === 'should_skip') return 'should_skip';
  if (feedback === 'wrong_relevance_class') return 'wrong_class';
  if (expectedAudienceClass === 'direct_focus') return 'direct_focus';
  if (expectedAudienceClass === 'adjacent') return 'adjacent_context';
  return 'other';
}

export async function adminEditTranslation(tweetId: string, text: string) {
  await invokeAdminAction({ action: 'edit_translation', tweet_id: tweetId, text_translated: text });
}

export async function adminRetryStep(tweetId: string, step: string) {
  await invokeAdminAction({ action: 'retry_step', tweet_id: tweetId, step });
}

export async function adminHydratePost(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; queued?: boolean; reason?: string; error?: string }>(
    { action: 'hydrate_post', tweet_id: tweetId },
    { failureMessage: 'Hydrate failed' },
  );
}

export async function adminReprocess(tweetId: string) {
  await invokeAdminAction({ action: 'reprocess', tweet_id: tweetId });
}

export async function adminReprocessBatch(tweetIds: string[]) {
  return invokeAdminAction<{ ok?: boolean; success?: boolean; requested?: number; queued?: number; message?: string; error?: string }>(
    {
      action: 'bulk_reprocess',
      tweet_ids: tweetIds,
    },
    { failureMessage: 'Bulk reprocess failed' },
  );
}

export async function adminRescorePost(tweetId: string) {
  return invokeAdminAction<{
    ok: boolean;
    score?: number;
    final_score?: number;
    base_score?: number;
    learned_score?: number;
    learned_delta?: number;
    x_gate_score?: number;
    decision?: string;
    decision_reason?: string | null;
    reasoning?: string;
    error?: string;
  }>({ action: 'rescore_post', tweet_id: tweetId });
}

export async function adminRetryXPost(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; error?: string; status?: string; x_tweet_id?: string; queued?: string | false; reason?: string }>({ action: 'retry_x_post', tweet_id: tweetId });
}

export async function adminClearDup(tweetId: string, relatedTweetId: string | null) {
  return invokeAdminAction<{ success: boolean }>({ action: 'clear_dup', tweet_id: tweetId, related_tweet_id: relatedTweetId });
}

export async function adminTranslatePost(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; translated?: string; model?: string; error?: string }>(
    { action: 'translate_post', tweet_id: tweetId, mode: 'translation_only' },
    { failureMessage: 'Translation failed' },
  );
}

export async function adminRunDedupe(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; error?: string; result?: { status?: string; reason?: string; dup_of_tweet_id?: string | null } }>(
    {
      action: 'run_dedupe',
      tweet_id: tweetId,
      force: true,
      enqueue_next: true,
    },
    { failureMessage: 'Duplicate check failed' },
  );
}

export async function adminSetManualScore(tweetId: string, score: number, reason: string, reasonTag: ScoringFeedbackReasonTag, overrideDuplicate: boolean, expectedAudienceClass?: AudienceClassValue | '') {
  return invokeAdminAction<{
    ok: boolean;
    score: number;
    threshold: number;
    decision: string;
    translated?: boolean;
    advance?: { queued: string; reason?: string };
    translation_error?: string;
    error?: string;
  }>(
    { action: 'set_manual_score', tweet_id: tweetId, score, reason, reason_tag: reasonTag, override_duplicate: overrideDuplicate, expected_audience_class: expectedAudienceClass || undefined },
    { failureMessage: 'Manual score failed' },
  );
}

export async function adminRecordScoreFeedback(tweetId: string, feedback: AudienceFeedback, expectedAudienceClass?: AudienceClassValue | '') {
  const reasonTag = defaultReasonTag(feedback, expectedAudienceClass);
  return invokeAdminAction<{ ok: boolean; polarity: number; error?: string }>(
    { action: 'record_score_feedback', tweet_id: tweetId, feedback, expected_audience_class: expectedAudienceClass || undefined, reason_tag: reasonTag },
    { failureMessage: 'Feedback failed' },
  );
}

export async function adminApproveEnrichment(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; message?: string; error?: string }>(
    { action: 'approve_enrichment', tweet_id: tweetId },
    { failureMessage: 'Enrichment action failed' },
  );
}

export async function adminRejectEnrichment(tweetId: string) {
  return invokeAdminAction<{ ok: boolean; message?: string; error?: string }>(
    { action: 'reject_enrichment', tweet_id: tweetId },
    { failureMessage: 'Enrichment action failed' },
  );
}

export async function adminGetXPostingDiagnostic(tweetId: string) {
  const data = await invokeAdminAction<{ success?: boolean; error?: string; diagnostics?: { items?: XPostingDiagnosticItem[] } }>(
    { action: 'get_x_posting_diagnostics', tweet_id: tweetId },
    { failureMessage: 'X diagnostics unavailable' },
  );
  const items = data?.diagnostics?.items as XPostingDiagnosticItem[] | undefined;
  return items?.[0] ?? null;
}

export async function adminRecordEnrichmentFeedback(tweetId: string, feedback: EnrichmentFeedback) {
  return invokeAdminAction<{ ok: boolean; error?: string }>(
    { action: 'record_enrichment_feedback', tweet_id: tweetId, feedback },
    { failureMessage: 'Enrichment feedback failed' },
  );
}

export async function adminSelectEnrichmentVariant(tweetId: string, variant: string) {
  return invokeAdminAction<{ ok: boolean; selected_variant?: string; final_x_text?: string; error?: string }>(
    { action: 'select_enrichment_variant', tweet_id: tweetId, variant },
    { failureMessage: 'Variant selection failed' },
  );
}

export async function adminIgnoreMonitoringItem(tweetId: string, reason = 'reviewed_and_ignored') {
  return invokeAdminAction<{ ok: boolean; error?: string; closed?: { x_deliveries?: number; deliveries?: number; jobs?: number } }>(
    { action: 'ignore_monitoring_item', tweet_id: tweetId, reason },
    { failureMessage: 'Ignore failed' },
  );
}

export async function adminIgnoreMonitoringItems(tweetIds: string[], reason = 'reviewed_and_ignored') {
  return invokeAdminAction<{
    ok?: boolean;
    requested?: number;
    found?: number;
    ignored?: number;
    missing?: string[];
    closed?: {
      x_deliveries?: number;
      deliveries?: number;
      jobs?: number;
    };
    results?: Array<{
      tweet_id: string;
      ok: boolean;
      error?: string;
      closed?: { x_deliveries: number; deliveries: number; jobs: number };
    }>;
  }>(
    { action: 'bulk_ignore', tweet_ids: tweetIds, reason },
    { failureMessage: 'Bulk ignore failed' },
  );
}

export async function adminEnrichPost(tweetId: string) {
  return invokeAdminAction<{
    ok: boolean;
    error?: string;
    worker_dispatch?: { ok?: boolean; processed?: number; message?: string; error?: string };
    translation_preflight?: { ok?: boolean };
  }>(
    { action: 'enrich_post', tweet_id: tweetId },
    { failureMessage: 'Failed to queue enrichment' },
  );
}

export async function adminCloseStaleXPending() {
  return invokeAdminAction<{ closed?: number }>({ action: 'summarize_stale_x_pending', older_than_hours: 24, close: true });
}

export async function adminCancelPendingJobs() {
  return invokeAdminAction<{ canceled?: number }>({ action: 'cancel_pending_jobs' });
}

export function actionTitle(action: PendingAction | null) {
  if (!action) return '';
  switch (action.type) {
    case 'force_telegram': return 'Force Telegram delivery?';
    case 'force_x': return 'Post plain to X?';
    case 'rescore': return 'Re-score this post?';
    case 'reprocess': return 'Reprocess this post?';
    case 'hydrate': return 'Hydrate this tweet?';
    case 'clear_dup': return 'Clear duplicate status?';
    case 'ignore': return 'Ignore and remove from queues?';
    case 'close_stale_x': return 'Close stale X pending rows?';
    case 'translate': return 'Get translation only?';
    case 'run_dedupe': return 'Run duplicate check?';
    case 'cancel_jobs': return 'Cancel all pending jobs?';
    case 'approve_enrichment': return 'Approve enrichment for X?';
    case 'reject_enrichment': return 'Reject enriched X draft?';
  }
}

export function bulkActionTitle(action: BulkAction, count: number) {
  if (action === 'bulk_reprocess') return `Reprocess ${count} post(s)?`;
  return `Ignore ${count} post(s)?`;
}

export function actionDescription(action: PendingAction | null) {
  if (!action) return '';
  const entry = action.entry;
  switch (action.type) {
    case 'force_telegram':
      return 'Queues Telegram delivery and records the override as feedback.';
    case 'force_x': {
      const reasons = entry?.x_cost_flags?.reasons ?? ['tweet write expected'];
      return `Runs X preflight, queues hydration first if needed, then posts the plain translation unless an approved enrichment exists. Expected X work: ${reasons.join(', ')}.`;
    }
    case 'rescore':
      return 'Runs the current scoring prompt again and may update the deliver/skip decision.';
    case 'reprocess':
      return 'Queues a full pipeline rerun for this post.';
    case 'hydrate':
      return 'Queues one X read for full tweet text unless an equivalent hydrate job is already pending.';
    case 'clear_dup':
      return 'Marks this pair as not duplicate and reopens the post for delivery evaluation.';
    case 'ignore':
      return 'Marks this post as reviewed/ignored, closes failed or pending X rows, closes failed/pending Telegram rows, and cancels failed/pending jobs without calling Telegram or X.';
    case 'close_stale_x':
      return 'Marks pending X delivery rows older than 24 hours as skipped. This does not retry, post, or call X.';
    case 'translate':
      return 'Runs Persian translation only. This does not change the score, decision, Telegram state, or X eligibility.';
    case 'run_dedupe':
      return 'Runs the duplicate gate now. Unique or meaningfully updated posts can continue to translation; duplicates remain blocked.';
    case 'cancel_jobs':
      return 'Marks pending and running jobs as failed. This does not call Telegram or X.';
    case 'approve_enrichment':
      return 'Marks this draft as approved for X text. It does not call Telegram or X by itself; normal X gates and budgets still apply.';
    case 'reject_enrichment':
      return 'Blocks this enriched draft from delivery. This does not call Telegram or X.';
  }
}

export function bulkActionDescription(action: BulkAction, count: number) {
  if (action === 'bulk_reprocess') {
    return 'Queues full pipeline reruns for the selected posts in one action.';
  }
  return 'Marks each selected post as reviewed/ignored, closes failed or pending X rows, closes failed/pending Telegram rows, and cancels pending/running/failed jobs without calling Telegram or X.';
}

export function actionContextText(pendingAction: PendingAction | null, pendingBulkAction: PendingBulkAction | null): string | null {
  if (pendingAction?.entry) {
    const entry = pendingAction.entry;
    return `${entry.author_handle ? `@${entry.author_handle}` : entry.tweet_id} · ${shortText(entry).slice(0, 180)}`;
  }
  if (pendingBulkAction) return `${pendingBulkAction.tweetIds.length} post IDs selected`;
  return null;
}
