import type {
  DuplicateCluster,
  DuplicateClusterMember,
  MonitoringEntry,
  MonitoringFilter,
  ScoreBucket,
} from "@/hooks/useMonitoringData";
import type { MonitoringTone } from "@/lib/monitoringState";
import type { ScoringV2Snapshot } from "@/lib/scoringV2Monitoring";
import type { TimelineTone } from "@/lib/timelineDisplay";

export const FILTERS: Array<{ value: MonitoringFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'failed_stuck', label: 'Failed/stuck' },
  { value: 'needs_score', label: 'Needs score' },
  { value: 'translation_queue', label: 'Translation queue' },
  { value: 'below_threshold', label: 'Below threshold' },
  { value: 'manual_review', label: 'Manual review' },
  { value: 'v2_would_post', label: 'V2 would post' },
  { value: 'v2_would_skip', label: 'V2 would skip' },
  { value: 'v1_post_v2_skip', label: 'V1 post / V2 skip' },
  { value: 'v1_skip_v2_post', label: 'V1 skip / V2 post' },
  { value: 'v2_off_topic', label: 'V2 off-topic' },
  { value: 'v2_needs_review', label: 'V2 needs review' },
  { value: 'v2_regional_auto', label: 'V2 regional auto' },
  { value: 'global_pilot_review', label: 'Global pilot review' },
  { value: 'manual_scoring_feedback', label: 'Manual scoring feedback' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'coverage_gap', label: 'Coverage gaps' },
  { value: 'possible_duplicate', label: 'Possible duplicates' },
  { value: 'duplicate_anomalies', label: 'Duplicate anomalies' },
  { value: 'ready_to_deliver', label: 'Ready to deliver' },
  { value: 'telegram_pending', label: 'Telegram pending' },
  { value: 'x_pending', label: 'X pending' },
  { value: 'x_failed', label: 'X failed' },
  { value: 'delivered_24h', label: 'Delivered 24h' },
  { value: 'hydration', label: 'Hydration' },
];

export const SCORE_BUCKETS: Array<{ value: ScoreBucket; label: string }> = [
  { value: 'any', label: 'Any score' },
  { value: 'unscored', label: 'Unscored' },
  { value: 'lt5', label: '<5' },
  { value: '5_9', label: '5-9.9' },
  { value: '10_13', label: '10-13.9' },
  { value: '14_plus', label: '14+' },
  { value: '17_plus', label: '17+' },
];

export function compactNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function toneClass(tone: MonitoringTone | TimelineTone) {
  if (tone === 'good') return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
  if (tone === 'bad') return 'bg-destructive/15 text-destructive border-destructive/30';
  if (tone === 'warn') return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
  if (tone === 'info') return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
  return 'bg-muted text-muted-foreground border-border';
}

export function shortText(entry: MonitoringEntry): string {
  const text = entry.text_translated || entry.text_original || '';
  return text.replace(/\s+/g, ' ').trim();
}

export function scoreValue(entry: Pick<MonitoringEntry, 'final_score' | 'importance_score'>): number | null {
  return entry.final_score ?? entry.importance_score ?? null;
}

export function memberScoreValue(member: DuplicateClusterMember): number | null {
  return member.final_score ?? member.importance_score ?? null;
}

export function isDeliveredOrPosted(entry: MonitoringEntry): boolean {
  return entry.is_delivered || entry.x_status === 'posted' || entry.monitoring_state?.telegram_state === 'delivered' || entry.monitoring_state?.x_state === 'posted';
}

export function hasActiveDeliveryPath(entry: MonitoringEntry): boolean {
  const code = entry.monitoring_state?.code;
  return entry.delivery_decision === 'deliver'
    || code === 'ready_to_deliver'
    || code === 'telegram_pending'
    || code === 'x_pending'
    || code === 'hydration'
    || entry.delivery_status === 'pending'
    || entry.x_status === 'pending';
}

export function chooseCanonicalEntry(entries: MonitoringEntry[]): MonitoringEntry {
  return [...entries].sort((a, b) => {
    const deliveredDelta = Number(isDeliveredOrPosted(b)) - Number(isDeliveredOrPosted(a));
    if (deliveredDelta !== 0) return deliveredDelta;
    const activeDelta = Number(hasActiveDeliveryPath(b)) - Number(hasActiveDeliveryPath(a));
    if (activeDelta !== 0) return activeDelta;
    const scoreDelta = (scoreValue(b) ?? -1) - (scoreValue(a) ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

export function duplicateMemberFromEntry(entry: MonitoringEntry, canonicalTweetId: string): DuplicateClusterMember {
  return {
    tweet_id: entry.tweet_id,
    text_original: entry.text_original,
    url: entry.url,
    created_at: entry.created_at,
    author_handle: entry.author_handle,
    final_score: entry.final_score,
    importance_score: entry.importance_score,
    dedupe_status: entry.dedupe_status,
    dup_of_tweet_id: entry.dup_of_tweet_id,
    dup_similarity: entry.dup_similarity,
    dedupe_confidence: entry.dedupe_confidence,
    dedupe_reason: entry.dedupe_reason,
    telegram_state: entry.monitoring_state?.telegram_state ?? entry.delivery_status ?? 'none',
    x_state: entry.x_status ?? entry.monitoring_state?.x_state ?? 'none',
    coverage_state: isDeliveredOrPosted(entry) ? 'delivered' : hasActiveDeliveryPath(entry) ? 'in_pipeline' : entry.dup_of_tweet_id ? 'also_duplicate' : 'not_covered',
    is_canonical: entry.tweet_id === canonicalTweetId,
  };
}

export function duplicateMemberFromTarget(target: NonNullable<MonitoringEntry['duplicate_of']>, canonicalTweetId: string): DuplicateClusterMember {
  return {
    tweet_id: target.tweet_id,
    text_original: target.text_original,
    url: target.url,
    created_at: target.created_at,
    author_handle: target.author_handle,
    final_score: target.final_score,
    importance_score: target.importance_score,
    dedupe_status: target.dedupe_status,
    dup_of_tweet_id: target.dup_of_tweet_id,
    dup_similarity: target.dup_similarity,
    telegram_state: target.telegram_state,
    x_state: target.x_state,
    coverage_state: target.coverage_state,
    is_canonical: target.tweet_id === canonicalTweetId,
  };
}

export function buildDuplicateCluster(clusterId: string, canonicalTweetId: string, members: DuplicateClusterMember[]): DuplicateCluster {
  const uniqueMembers = [...new Map(members.map((member) => [member.tweet_id, member])).values()];
  const counts = {
    total: uniqueMembers.length,
    delivered: uniqueMembers.filter((member) => member.coverage_state === 'delivered' || member.telegram_state === 'delivered' || member.telegram_state === 'posted').length,
    x_posted: uniqueMembers.filter((member) => member.x_state === 'posted').length,
    blocked: uniqueMembers.filter((member) => member.dedupe_status === 'duplicate' || Boolean(member.dup_of_tweet_id)).length,
    uncertain: uniqueMembers.filter((member) => member.dedupe_status === 'uncertain').length,
    coverage_gap: uniqueMembers.filter((member) => member.coverage_state === 'not_covered' || member.dedupe_status === 'coverage_gap').length,
  };
  return {
    cluster_id: clusterId,
    canonical_tweet_id: canonicalTweetId,
    members: uniqueMembers.sort((a, b) => Number(Boolean(b.is_canonical)) - Number(Boolean(a.is_canonical)) || new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()),
    counts,
    has_x_anomaly: counts.x_posted > 1,
    coverage_state: counts.delivered > 0 || counts.x_posted > 0
      ? 'covered'
      : uniqueMembers.some((member) => member.coverage_state === 'in_pipeline')
        ? 'in_pipeline'
        : counts.coverage_gap > 0
          ? 'coverage_gap'
          : 'unknown',
  };
}

export function clusterMonitoringEntries(entries: MonitoringEntry[]): MonitoringEntry[] {
  if (entries.some((entry) => entry.duplicate_cluster || entry.hidden_in_cluster)) {
    return entries.filter((entry) => !entry.hidden_in_cluster);
  }

  const referencedIds = new Set(entries.map((entry) => entry.dup_of_tweet_id).filter((id): id is string => Boolean(id)));
  const storyCounts = entries.reduce((map, entry) => {
    if (entry.story_cluster_id) map.set(entry.story_cluster_id, (map.get(entry.story_cluster_id) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const groups = new Map<string, MonitoringEntry[]>();

  for (const entry of entries) {
    const key = entry.story_cluster_id && (storyCounts.get(entry.story_cluster_id) ?? 0) > 1
      ? `story:${entry.story_cluster_id}`
      : entry.dup_of_tweet_id
        ? `root:${entry.dup_of_tweet_id}`
        : referencedIds.has(entry.tweet_id)
          ? `root:${entry.tweet_id}`
          : '';
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const clusterByTweet = new Map<string, DuplicateCluster>();
  const hidden = new Set<string>();
  for (const [clusterId, group] of groups) {
    const canonical = chooseCanonicalEntry(group);
    const members = group.flatMap((entry) => {
      const list = [duplicateMemberFromEntry(entry, canonical.tweet_id)];
      if (entry.duplicate_of) list.push(duplicateMemberFromTarget(entry.duplicate_of, canonical.tweet_id));
      return list;
    });
    const cluster = buildDuplicateCluster(clusterId, canonical.tweet_id, members);
    if (cluster.counts.total < 2) continue;
    for (const entry of group) {
      clusterByTweet.set(entry.tweet_id, cluster);
      if (entry.tweet_id !== canonical.tweet_id) hidden.add(entry.tweet_id);
    }
  }

  return entries
    .map((entry) => ({
      ...entry,
      duplicate_cluster: entry.duplicate_cluster ?? clusterByTweet.get(entry.tweet_id) ?? null,
      hidden_in_cluster: entry.hidden_in_cluster ?? hidden.has(entry.tweet_id),
    }))
    .filter((entry) => !entry.hidden_in_cluster);
}

export function audienceClassLabel(value: string | null | undefined): string {
  switch (value) {
    case 'direct_focus': return 'Direct focus';
    case 'adjacent': return 'Adjacent';
    case 'global_exception': return 'Global exception';
    case 'off_topic': return 'Off topic';
    default: return 'Audience n/a';
  }
}

export function formatScoringV2Score(snapshot: ScoringV2Snapshot | null): string {
  if (!snapshot || snapshot.final_score == null) return '—';
  const threshold = snapshot.threshold != null ? ` / ≥${snapshot.threshold}` : '';
  return `${snapshot.final_score}${threshold}`;
}
