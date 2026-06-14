import type { MonitoringEntry, MonitoringOverview } from '@/hooks/useMonitoringData';
import { getScoringV2Snapshot } from '@/lib/scoringV2Monitoring';

export type MonitoringTone = 'good' | 'warn' | 'bad' | 'muted' | 'info';

export function monitoringStage(entry: MonitoringEntry): { label: string; tone: MonitoringTone } {
  if (entry.monitoring_state) return { label: entry.monitoring_state.stage_label, tone: entry.monitoring_state.tone };
  if (entry.translation_error || entry.delivery_error || entry.x_error) return { label: 'Failed/stuck', tone: 'bad' };
  if (entry.dedupe_status === 'failed') return { label: 'Dedupe failed', tone: 'bad' };
  if (entry.dedupe_status === 'coverage_gap') return { label: 'Duplicate coverage gap', tone: 'warn' };
  if (entry.dedupe_status === 'uncertain' && entry.dup_of_tweet_id && entry.dedupe_reason?.includes('coverage_gap:')) return { label: 'Duplicate coverage gap', tone: 'warn' };
  if (entry.dedupe_status === 'uncertain') return { label: 'Uncertain duplicate', tone: 'warn' };
  if (entry.dedupe_status === 'related_new_info') return { label: 'Related: new info', tone: 'info' };
  if (entry.dedupe_status === 'pending') return { label: 'Duplicate gate pending', tone: 'info' };
  if (entry.score_review_status === 'needs_review') return { label: 'Manual review', tone: 'warn' };
  if (entry.dup_of_tweet_id || (entry.delivery_decision && entry.delivery_decision !== 'deliver')) return { label: 'Skipped', tone: 'muted' };
  if (entry.enrich_status === 'rejected') return { label: 'Enrichment rejected', tone: 'bad' };
  if (entry.enrich_status === 'awaiting_approval') return { label: 'Manual review', tone: 'warn' };
  if (entry.is_truncated && !entry.hydrated_at && entry.delivery_decision === 'deliver') return { label: 'Hydration', tone: 'warn' };
  if (entry.final_score == null && entry.importance_score == null) return { label: 'Needs score', tone: 'warn' };
  if ((!entry.is_translated || !entry.text_translated) && entry.delivery_decision === 'deliver') return { label: 'Needs translation', tone: 'warn' };
  if (entry.x_status === 'posted' || entry.is_delivered) return { label: 'Delivered', tone: 'good' };
  return { label: 'Ready', tone: 'info' };
}

export function monitoringDecisionLabel(entry: MonitoringEntry, fallbackDecision: string): string {
  if (entry.monitoring_state?.decision_label) return entry.monitoring_state.decision_label;
  if (entry.dedupe_status === 'coverage_gap') return 'Possible duplicate, not covered';
  if (entry.dedupe_status === 'uncertain' && entry.dup_of_tweet_id && entry.dedupe_reason?.includes('coverage_gap:')) return 'Possible duplicate, not covered';
  if (entry.dedupe_status === 'uncertain') return 'Review possible duplicate';
  if (entry.dedupe_status === 'related_new_info') return 'Related: new info';
  if (entry.dedupe_status === 'pending') return 'Checking duplicate';
  if (entry.enrich_status === 'awaiting_approval') return 'Review enrichment';
  if (entry.enrich_status === 'rejected') return 'Enrichment rejected';
  if (entry.dup_of_tweet_id) return 'Blocked: duplicate';
  if (entry.delivery_decision === 'skip') return 'Skipped';
  if (entry.delivery_decision === 'deliver') return 'Deliver';
  return fallbackDecision;
}

export function loadedMonitoringCounts(entries: MonitoringEntry[]): MonitoringOverview['counts'] {
  const policyRule = (entry: MonitoringEntry): string | null => {
    const snapshot = getScoringV2Snapshot(entry);
    const rule = snapshot?.policy_rule;
    if (snapshot?.policy_rule_applied) return snapshot.policy_rule_applied;
    return rule?.kind ?? null;
  };
  return {
    needs_attention: entries.filter((entry) => entry.monitoring_state?.needs_attention ?? ['bad', 'warn'].includes(monitoringStage(entry).tone)).length,
    failed_stuck: entries.filter((entry) => entry.monitoring_state?.code === 'failed_stuck' || !!(entry.translation_error || entry.delivery_error || entry.x_error) || entry.dedupe_status === 'failed').length,
    translation_queue: entries.filter((entry) => ['queued', 'needs_translation'].includes(entry.monitoring_state?.translation_state ?? '')).length,
    needs_score: entries.filter((entry) => entry.monitoring_state?.code === 'needs_score' || (entry.final_score == null && entry.importance_score == null)).length,
    ready_to_deliver: entries.filter((entry) => entry.monitoring_state?.code === 'ready_to_deliver').length,
    manual_review: entries.filter((entry) => entry.monitoring_state?.code === 'manual_review' || entry.enrich_status === 'awaiting_approval' || entry.dedupe_status === 'uncertain' || entry.score_review_status === 'needs_review').length,
    duplicates: entries.filter((entry) => !!entry.dup_of_tweet_id).length,
    coverage_gap: entries.filter((entry) => entry.monitoring_state?.code === 'duplicate_coverage_gap' || entry.dedupe_status === 'coverage_gap').length,
    possible_duplicate: entries.filter((entry) => entry.dedupe_status === 'uncertain' || entry.dedupe_status === 'coverage_gap').length,
    duplicate_anomalies: entries.filter((entry) => entry.x_status === 'posted' && entry.duplicate_of?.x_state === 'posted').length,
    hydration: entries.filter((entry) => entry.monitoring_state?.code === 'hydration' || (entry.is_truncated && !entry.hydrated_at && entry.delivery_decision === 'deliver')).length,
    x_pending: entries.filter((entry) => entry.x_status === 'pending').length,
    x_failed: entries.filter((entry) => entry.x_status === 'failed').length,
    delivered_24h: entries.filter((entry) => entry.x_status === 'posted' || entry.is_delivered).length,
    telegram_pending: entries.filter((entry) => entry.monitoring_state?.code === 'telegram_pending').length,
    below_threshold: entries.filter((entry) => entry.monitoring_state?.code === 'below_threshold' || entry.decision_reason?.startsWith('below_threshold:')).length,
    v2_regional_auto: entries.filter((entry) => policyRule(entry) === 'regional_escalation_auto').length,
    global_pilot_review: entries.filter((entry) => policyRule(entry) === 'global_mega_event_review' || (entry.global_exception_class === 'global_mega_event' && entry.score_review_status === 'needs_review')).length,
    manual_scoring_feedback: entries.filter((entry) => entry.feedback_locked === true && (entry.score_review_status === 'approved' || entry.score_review_status === 'rejected' || entry.decision_reason?.startsWith('manual_score_') || entry.decision_reason?.startsWith('score_feedback_'))).length,
    stale_jobs: 0,
    stale_x_pending_24h: 0,
  };
}
