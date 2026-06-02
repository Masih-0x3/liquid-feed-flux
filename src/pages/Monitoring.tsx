import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Twitter,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select as ThemedSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useMonitoringDataSearchWithScore,
  useMonitoringOverview,
  useXApiSummary,
  type DuplicateCluster,
  type DuplicateClusterMember,
  type MonitoringEntry,
  type MonitoringFilter,
  type PipelineEvent,
  type ScoreBucket,
} from "@/hooks/useMonitoringData";
import { MediaThumbnails } from "@/components/monitoring/MediaThumbnails";
import {
  decisionScore,
  formatDecisionReason,
  formatXBadge,
} from "@/lib/pipelineMessages";
import { loadedMonitoringCounts, monitoringDecisionLabel, monitoringStage, type MonitoringTone } from "@/lib/monitoringState";
import { getScoringV2Snapshot, scoringV2DecisionLabel, type ScoringV2Snapshot } from "@/lib/scoringV2Monitoring";
import { buildDeliverySummary, buildPipelineTimelineGroups, type TimelineTone } from "@/lib/timelineDisplay";
import { useQuery, useQueryClient } from "@tanstack/react-query";

async function adminEditTranslation(tweetId: string, text: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'edit_translation', tweet_id: tweetId, text_translated: text } });
  if (error) throw error;
}

async function adminRetryStep(tweetId: string, step: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'retry_step', tweet_id: tweetId, step } });
  if (error) throw error;
}

async function adminHydratePost(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'hydrate_post', tweet_id: tweetId } });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Hydrate failed');
  return data as { ok: boolean; queued?: boolean; reason?: string };
}

async function adminReprocess(tweetId: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'reprocess', tweet_id: tweetId } });
  if (error) throw error;
}

async function adminRescorePost(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'rescore_post', tweet_id: tweetId } });
  if (error) throw error;
  return data as {
    ok: boolean;
    score?: number;
    final_score?: number;
    decision?: string;
    decision_reason?: string | null;
    reasoning?: string;
    error?: string;
  };
}

async function adminRetryXPost(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'retry_x_post', tweet_id: tweetId } });
  if (error) throw error;
  return data as { ok: boolean; error?: string; status?: string; x_tweet_id?: string; queued?: string | false; reason?: string };
}

async function adminClearDup(tweetId: string, relatedTweetId: string | null) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'clear_dup', tweet_id: tweetId, related_tweet_id: relatedTweetId } });
  if (error) throw error;
  return data as { success: boolean };
}

async function adminTranslatePost(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'translate_post', tweet_id: tweetId, mode: 'translation_only' } });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Translation failed');
  return data as { ok: boolean; translated?: string; model?: string };
}

async function adminRunDedupe(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'run_dedupe', tweet_id: tweetId, force: true, enqueue_next: true },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Duplicate check failed');
  return data as { ok: boolean; result?: { status?: string; reason?: string; dup_of_tweet_id?: string | null } };
}

type AudienceFeedback = 'too_low' | 'too_high' | 'correct_deliver' | 'correct_skip' | 'should_pass_audience' | 'should_skip' | 'wrong_relevance_class' | 'global_exception_worth_covering' | 'not_global_exception';
type AudienceClassValue = 'direct_focus' | 'adjacent' | 'global_exception' | 'off_topic';
type EnrichmentFeedback = 'sounds_like_me' | 'too_soft' | 'too_ai' | 'too_newsy' | 'not_blunt_enough' | 'too_long' | 'good_clapback' | 'strong_angle' | 'too_risky' | 'too_cheesy' | 'too_aggregator' | 'needs_more_context' | 'unsafe_for_monetization';
type XDiagnosticBlocker = { code: string; label: string; severity: 'blocker' | 'deferred' | 'note' };
type XPostingDiagnosticItem = {
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

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function adminSetManualScore(tweetId: string, score: number, reason: string, overrideDuplicate: boolean, expectedAudienceClass?: AudienceClassValue | '') {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'set_manual_score', tweet_id: tweetId, score, reason, override_duplicate: overrideDuplicate, expected_audience_class: expectedAudienceClass || undefined },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Manual score failed');
  return data as {
    ok: boolean;
    score: number;
    threshold: number;
    decision: string;
    translated?: boolean;
    advance?: { queued: string; reason?: string };
    translation_error?: string;
  };
}

async function adminRecordScoreFeedback(tweetId: string, feedback: AudienceFeedback, expectedAudienceClass?: AudienceClassValue | '') {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'record_score_feedback', tweet_id: tweetId, feedback, expected_audience_class: expectedAudienceClass || undefined },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Feedback failed');
  return data as { ok: boolean; polarity: number };
}

async function adminEnrichmentDecision(tweetId: string, action: 'approve_enrichment' | 'reject_enrichment') {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action, tweet_id: tweetId } });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Enrichment action failed');
  return data as { ok: boolean; message?: string };
}

async function adminGetXPostingDiagnostic(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'get_x_posting_diagnostics', tweet_id: tweetId },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error ?? 'X diagnostics unavailable');
  const items = data?.diagnostics?.items as XPostingDiagnosticItem[] | undefined;
  return items?.[0] ?? null;
}

async function adminRecordEnrichmentFeedback(tweetId: string, feedback: EnrichmentFeedback) {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'record_enrichment_feedback', tweet_id: tweetId, feedback },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Enrichment feedback failed');
  return data as { ok: boolean };
}

async function adminSelectEnrichmentVariant(tweetId: string, variant: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'select_enrichment_variant', tweet_id: tweetId, variant },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Variant selection failed');
  return data as { ok: boolean; selected_variant?: string; final_x_text?: string };
}

async function adminIgnoreMonitoringItem(tweetId: string, reason = 'reviewed_and_ignored') {
  const { data, error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'ignore_monitoring_item', tweet_id: tweetId, reason },
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(data.error ?? 'Ignore failed');
  return data as { ok: boolean; closed?: { x_deliveries?: number; deliveries?: number; jobs?: number } };
}

type ConfirmAction = 'force_telegram' | 'force_x' | 'rescore' | 'reprocess' | 'hydrate' | 'clear_dup' | 'ignore' | 'close_stale_x' | 'translate' | 'run_dedupe' | 'cancel_jobs' | 'approve_enrichment' | 'reject_enrichment';

interface PendingAction {
  type: ConfirmAction;
  entry?: MonitoringEntry;
}

const FILTERS: Array<{ value: MonitoringFilter; label: string }> = [
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

const SCORE_BUCKETS: Array<{ value: ScoreBucket; label: string }> = [
  { value: 'any', label: 'Any score' },
  { value: 'unscored', label: 'Unscored' },
  { value: 'lt5', label: '<5' },
  { value: '5_9', label: '5-9.9' },
  { value: '10_13', label: '10-13.9' },
  { value: '14_plus', label: '14+' },
  { value: '17_plus', label: '17+' },
];

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function compactNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

function toneClass(tone: MonitoringTone | TimelineTone) {
  if (tone === 'good') return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30';
  if (tone === 'bad') return 'bg-destructive/15 text-destructive border-destructive/30';
  if (tone === 'warn') return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
  if (tone === 'info') return 'bg-blue-500/15 text-blue-500 border-blue-500/30';
  return 'bg-muted text-muted-foreground border-border';
}

function timelineIcon(platform: string, className = "h-4 w-4") {
  if (platform === 'Telegram') return <Send className={className} />;
  if (platform === 'X' || platform === 'X read') return <Twitter className={className} />;
  if (platform === 'OpenAI') return <Sparkles className={className} />;
  if (platform === 'Media') return <MessageSquare className={className} />;
  return <Wrench className={className} />;
}

function relativeTimestamp(rawTimestamp: string | null): string | null {
  if (!rawTimestamp) return null;
  const date = new Date(rawTimestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function shortText(entry: MonitoringEntry): string {
  const text = entry.text_translated || entry.text_original || '';
  return text.replace(/\s+/g, ' ').trim();
}

function scoreValue(entry: Pick<MonitoringEntry, 'final_score' | 'importance_score'>): number | null {
  return entry.final_score ?? entry.importance_score ?? null;
}

function memberScoreValue(member: DuplicateClusterMember): number | null {
  return member.final_score ?? member.importance_score ?? null;
}

function isDeliveredOrPosted(entry: MonitoringEntry): boolean {
  return entry.is_delivered || entry.x_status === 'posted' || entry.monitoring_state?.telegram_state === 'delivered' || entry.monitoring_state?.x_state === 'posted';
}

function hasActiveDeliveryPath(entry: MonitoringEntry): boolean {
  const code = entry.monitoring_state?.code;
  return entry.delivery_decision === 'deliver'
    || code === 'ready_to_deliver'
    || code === 'telegram_pending'
    || code === 'x_pending'
    || code === 'hydration'
    || entry.delivery_status === 'pending'
    || entry.x_status === 'pending';
}

function chooseCanonicalEntry(entries: MonitoringEntry[]): MonitoringEntry {
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

function duplicateMemberFromEntry(entry: MonitoringEntry, canonicalTweetId: string): DuplicateClusterMember {
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

function duplicateMemberFromTarget(target: NonNullable<MonitoringEntry['duplicate_of']>, canonicalTweetId: string): DuplicateClusterMember {
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

function buildDuplicateCluster(clusterId: string, canonicalTweetId: string, members: DuplicateClusterMember[]): DuplicateCluster {
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

function clusterMonitoringEntries(entries: MonitoringEntry[]): MonitoringEntry[] {
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

function audienceClassLabel(value: string | null | undefined): string {
  switch (value) {
    case 'direct_focus': return 'Direct focus';
    case 'adjacent': return 'Adjacent';
    case 'global_exception': return 'Global exception';
    case 'off_topic': return 'Off topic';
    default: return 'Audience n/a';
  }
}

function formatScoringV2Score(snapshot: ScoringV2Snapshot | null): string {
  if (!snapshot || snapshot.final_score == null) return '—';
  const threshold = snapshot.threshold != null ? ` / ≥${snapshot.threshold}` : '';
  return `${snapshot.final_score}${threshold}`;
}

function actionTitle(action: PendingAction | null) {
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

function actionDescription(action: PendingAction | null) {
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
      return 'Marks this post as reviewed/ignored, closes failed or pending X rows, closes pending Telegram rows, and cancels pending work without calling Telegram or X.';
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

export default function Monitoring() {
  const [searchParams] = useSearchParams();
  const initialFilter = (() => {
    const raw = searchParams.get('filter')?.replaceAll('-', '_');
    return FILTERS.some((item) => item.value === raw) ? raw as MonitoringFilter : 'all';
  })();
  const [filter, setFilter] = useState<MonitoringFilter>(initialFilter);
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') ?? '');
  const [scoreBucket, setScoreBucket] = useState<ScoreBucket>('any');
  const debouncedSearch = useDebouncedValue(searchTerm, 350);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTweetId, setDrawerTweetId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<PipelineEvent[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState<MonitoringEntry | null>(null);
  const [manualScore, setManualScore] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualOverrideDuplicate, setManualOverrideDuplicate] = useState(false);
  const [manualAudienceClass, setManualAudienceClass] = useState<AudienceClassValue | ''>('');
  const [manualLoading, setManualLoading] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);
  const [enrichingTweetIds, setEnrichingTweetIds] = useState<Set<string>>(() => new Set());
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set());
  const pollRefs = useRef<Map<string, { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }>>(new Map());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { entries, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage, isFetching, error } = useMonitoringDataSearchWithScore(filter, debouncedSearch, scoreBucket);
  const { data: overview } = useMonitoringOverview(24);
  const { data: xSummary } = useXApiSummary(24);

  const { data: deliverThreshold = 14 } = useQuery({
    queryKey: ['active-threshold'],
    queryFn: async () => {
      const [{ data: act }, { data: profs }] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'active_profile_id').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'editorial_profiles').maybeSingle(),
      ]);
      const activeId = (act?.value as { id?: string } | null)?.id;
      const profiles = ((profs?.value as { profiles?: Array<{ id: string; threshold: number }> } | null)?.profiles) ?? [];
      const active = profiles.find((p) => p.id === activeId);
      return active?.threshold ?? 14;
    },
    staleTime: 60_000,
  });

  const { data: xPostingEnabled = false } = useQuery({
    queryKey: ['x-posting-enabled'],
    queryFn: async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', 'x_posting_config').maybeSingle();
      return (data?.value as { enabled?: boolean } | null)?.enabled === true;
    },
    staleTime: 30_000,
  });

  const moderationEntries = useMemo(() => clusterMonitoringEntries(entries), [entries]);
  const entryByTweetId = useMemo(() => new Map(entries.map((entry) => [entry.tweet_id, entry])), [entries]);
  const selectedEntry = useMemo(
    () => moderationEntries.find((entry) => entry.tweet_id === drawerTweetId) ?? entries.find((entry) => entry.tweet_id === drawerTweetId) ?? null,
    [entries, moderationEntries, drawerTweetId],
  );
  const timelineDeliverySummary = useMemo(
    () => selectedEntry ? buildDeliverySummary(selectedEntry, timeline) : [],
    [selectedEntry, timeline],
  );
  const timelineGroups = useMemo(() => buildPipelineTimelineGroups(timeline), [timeline]);
  const selectedScoringV2 = useMemo(
    () => selectedEntry ? getScoringV2Snapshot(selectedEntry, timeline) : null,
    [selectedEntry, timeline],
  );
  const selectedVoice = selectedEntry?.source_context?.voice ?? null;
  const selectedVoiceScores = selectedVoice?.critic?.variants ?? [];
  const { data: xDiagnostic, isFetching: xDiagnosticLoading } = useQuery({
    queryKey: ['x-posting-diagnostic', drawerTweetId],
    queryFn: () => adminGetXPostingDiagnostic(drawerTweetId as string),
    enabled: drawerOpen && !!drawerTweetId,
    staleTime: 15_000,
    retry: 1,
  });
  const loadedCounts = useMemo(() => loadedMonitoringCounts(entries), [entries]);
  const counts = overview?.counts ?? loadedCounts;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['monitoring'] });
    queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
    queryClient.invalidateQueries({ queryKey: ['x-api-summary'] });
    queryClient.invalidateQueries({ queryKey: ['x-posting-diagnostic'] });
  };

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  };

  useEffect(() => {
    const refs = pollRefs.current;
    return () => {
      refs.forEach(({ interval, timeout }) => {
        clearInterval(interval);
        clearTimeout(timeout);
      });
      refs.clear();
    };
  }, []);

  const cleanupPoll = (tweetId: string) => {
    const entry = pollRefs.current.get(tweetId);
    if (entry) {
      clearInterval(entry.interval);
      clearTimeout(entry.timeout);
      pollRefs.current.delete(tweetId);
    }
    setEnrichingTweetIds((prev) => {
      if (!prev.has(tweetId)) return prev;
      const next = new Set(prev);
      next.delete(tweetId);
      return next;
    });
  };

  const openDetails = async (tweetId: string) => {
    setDrawerTweetId(tweetId);
    setDrawerOpen(true);
    try {
      const { data, error: timelineError } = await supabase
        .from('pipeline_events')
        .select('subject_type, subject_id, step, status, started_at, ended_at, error, meta')
        .eq('subject_type', 'post')
        .eq('subject_id', tweetId)
        .order('started_at', { ascending: false });
      if (timelineError) throw timelineError;
      setTimeline((data as PipelineEvent[]) || []);
    } catch {
      setTimeline([]);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      await adminEditTranslation(editingEntry, editedContent);
      toast({ title: 'Translation updated' });
      setEditingEntry(null);
      setEditedContent('');
      invalidate();
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleTestEnrich = async (tweetId: string) => {
    if (enrichingTweetIds.has(tweetId)) {
      toast({ title: 'Enrichment already running', description: 'The draft is still being generated for this post.' });
      return;
    }
    cleanupPoll(tweetId);
    setEnrichingTweetIds((prev) => new Set(prev).add(tweetId));
    setDrawerTweetId(tweetId);
    setDrawerOpen(true);
    try {
      const { data, error: enrichError } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'enrich_post', tweet_id: tweetId },
      });
      if (enrichError) throw enrichError;
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to queue enrichment');
      const workerDispatch = data.worker_dispatch as { ok?: boolean; processed?: number; message?: string; error?: string } | undefined;
      const descriptionParts = [
        data.translation_preflight?.ok ? 'Translation was generated first.' : null,
        workerDispatch?.ok === true ? `Worker started${typeof workerDispatch.processed === 'number' ? ` (${workerDispatch.processed} job${workerDispatch.processed === 1 ? '' : 's'} processed)` : ''}.` : null,
        workerDispatch?.ok === false ? `Queued, but immediate worker dispatch failed: ${workerDispatch.error || 'unknown error'}. Cron can still pick it up.` : null,
      ].filter(Boolean);
      toast({ title: 'Enrichment draft queued', description: descriptionParts.join(' ') || undefined });

      const interval = setInterval(async () => {
        const { data: post } = await supabase
          .from('posts')
          .select('enrich_status')
          .eq('tweet_id', tweetId)
          .single();
        if (post && post.enrich_status !== 'pending') {
          cleanupPoll(tweetId);
          if (post.enrich_status === 'awaiting_approval') {
            setDrawerTweetId(tweetId);
            setDrawerOpen(true);
          }
          invalidate();
          toast({
            title: post.enrich_status === 'awaiting_approval' ? 'Draft ready for review' : 'Enrichment finished',
            description: post.enrich_status === 'awaiting_approval'
              ? 'The draft is open in the detail drawer. Your current queue filter was left unchanged.'
              : `Status: ${post.enrich_status}`,
          });
        }
      }, 3000);
      const timeout = setTimeout(() => cleanupPoll(tweetId), 300_000);
      pollRefs.current.set(tweetId, { interval, timeout });
    } catch (e) {
      cleanupPoll(tweetId);
      toast({ title: 'Enrich failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const openManualScore = (entry: MonitoringEntry) => {
    const currentScore = decisionScore(entry);
    setManualEntry(entry);
    setManualScore(currentScore == null ? '' : String(currentScore));
    setManualReason('');
    setManualOverrideDuplicate(false);
    setManualAudienceClass((entry.audience_class as AudienceClassValue | null) ?? '');
  };

  const handleManualSubmit = async () => {
    if (!manualEntry) return;
    const score = Number(manualScore);
    if (!Number.isInteger(score) || score < 1 || score > 20) {
      toast({ title: 'Invalid score', description: 'Manual score must be a whole number between 1 and 20.', variant: 'destructive' });
      return;
    }
    setManualLoading(true);
    try {
      const result = await adminSetManualScore(manualEntry.tweet_id, score, manualReason, manualOverrideDuplicate, manualAudienceClass);
      const advance = result.advance?.queued && result.advance.queued !== 'none' ? `Queued ${result.advance.queued}` : result.advance?.reason;
      toast({
        title: `Manual score saved: ${score}/20`,
        description: result.translation_error ? `Translation needed but failed: ${result.translation_error}` : advance,
      });
      setManualEntry(null);
      invalidate();
    } catch (e) {
      toast({ title: 'Manual score failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setManualLoading(false);
    }
  };

  const handleFeedback = async (entry: MonitoringEntry, feedback: AudienceFeedback, expectedAudienceClass?: AudienceClassValue | '') => {
    const key = `${entry.tweet_id}:${feedback}`;
    setFeedbackLoading(key);
    try {
      await adminRecordScoreFeedback(entry.tweet_id, feedback, expectedAudienceClass);
      toast({ title: 'Feedback recorded' });
      invalidate();
    } catch (e) {
      toast({ title: 'Feedback failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setFeedbackLoading(null);
    }
  };

  const handleEnrichmentFeedback = async (entry: MonitoringEntry, feedback: EnrichmentFeedback) => {
    const key = `${entry.tweet_id}:enrich:${feedback}`;
    setFeedbackLoading(key);
    try {
      await adminRecordEnrichmentFeedback(entry.tweet_id, feedback);
      toast({ title: 'Enrichment feedback recorded' });
      invalidate();
    } catch (e) {
      toast({ title: 'Feedback failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setFeedbackLoading(null);
    }
  };

  const handleSelectEnrichmentVariant = async (entry: MonitoringEntry, variant: string) => {
    const key = `${entry.tweet_id}:variant:${variant}`;
    setFeedbackLoading(key);
    try {
      await adminSelectEnrichmentVariant(entry.tweet_id, variant);
      toast({ title: 'Variant selected', description: 'X preview updated. It still requires explicit approval before use.' });
      invalidate();
    } catch (e) {
      toast({ title: 'Variant failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setFeedbackLoading(null);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const entry = pendingAction.entry;
    setActionLoading(true);
    try {
      switch (pendingAction.type) {
        case 'force_telegram':
          if (!entry) throw new Error('Missing post');
          await adminRetryStep(entry.tweet_id, 'deliver');
          toast({ title: 'Telegram delivery queued' });
          break;
        case 'force_x': {
          if (!entry) throw new Error('Missing post');
          if (!xPostingEnabled) throw new Error('X posting is disabled in Settings');
          const res = await adminRetryXPost(entry.tweet_id);
          if (!res.ok) throw new Error(res.error || 'X post failed');
          toast({
            title: res.status === 'posted' ? 'Posted to X' : res.status === 'waiting_hydration' ? 'Hydration queued before X' : `X: ${res.status ?? 'queued'}`,
            description: res.x_tweet_id ? `https://x.com/i/status/${res.x_tweet_id}` : undefined,
          });
          break;
        }
        case 'rescore': {
          if (!entry) throw new Error('Missing post');
          const res = await adminRescorePost(entry.tweet_id);
          if (!res.ok) throw new Error(res.error || 'Re-score failed');
          toast({ title: `New score: ${res.final_score ?? res.score ?? '—'}/20`, description: `Decision: ${res.decision ?? '—'}` });
          break;
        }
        case 'reprocess':
          if (!entry) throw new Error('Missing post');
          await adminReprocess(entry.tweet_id);
          toast({ title: 'Reprocess queued' });
          break;
        case 'hydrate': {
          if (!entry) throw new Error('Missing post');
          const res = await adminHydratePost(entry.tweet_id);
          toast({ title: res.queued === false ? 'Hydration already queued' : 'Hydration queued', description: res.reason });
          break;
        }
        case 'translate': {
          if (!entry) throw new Error('Missing post');
          const res = await adminTranslatePost(entry.tweet_id);
          toast({ title: 'Translation saved', description: res.model });
          break;
        }
        case 'run_dedupe': {
          if (!entry) throw new Error('Missing post');
          const res = await adminRunDedupe(entry.tweet_id);
          toast({ title: `Duplicate check: ${res.result?.status ?? 'complete'}`, description: res.result?.reason });
          break;
        }
        case 'clear_dup':
          if (!entry) throw new Error('Missing post');
          await adminClearDup(entry.tweet_id, entry.dup_of_tweet_id);
          toast({ title: 'Duplicate cleared' });
          break;
        case 'ignore': {
          if (!entry) throw new Error('Missing post');
          const res = await adminIgnoreMonitoringItem(entry.tweet_id);
          const closed = res.closed;
          toast({
            title: 'Post ignored',
            description: closed ? `Closed ${closed.x_deliveries ?? 0} X row(s), ${closed.deliveries ?? 0} delivery row(s), ${closed.jobs ?? 0} job(s).` : undefined,
          });
          if (drawerTweetId === entry.tweet_id) {
            setDrawerOpen(false);
            setDrawerTweetId(null);
          }
          break;
        }
        case 'close_stale_x': {
          const { data, error: closeError } = await supabase.functions.invoke('admin-actions', {
            body: { action: 'summarize_stale_x_pending', older_than_hours: 24, close: true },
          });
          if (closeError) throw closeError;
          toast({ title: 'Stale X pending closed', description: `${data?.closed ?? 0} row(s) marked skipped` });
          break;
        }
        case 'cancel_jobs': {
          const { data, error: cancelError } = await supabase.functions.invoke('admin-actions', { body: { action: 'cancel_pending_jobs' } });
          if (cancelError) throw cancelError;
          toast({ title: 'Pending jobs canceled', description: `${data?.canceled ?? 0} job(s) marked failed.` });
          break;
        }
        case 'approve_enrichment':
          if (!entry) throw new Error('Missing post');
          await adminEnrichmentDecision(entry.tweet_id, 'approve_enrichment');
          toast({ title: 'Enrichment approved for X', description: 'No Telegram or X post was triggered by approval.' });
          break;
        case 'reject_enrichment':
          if (!entry) throw new Error('Missing post');
          await adminEnrichmentDecision(entry.tweet_id, 'reject_enrichment');
          toast({ title: 'Enrichment rejected' });
          break;
      }
      invalidate();
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
      setPendingAction(null);
    }
  };

  const renderXBadge = (entry: MonitoringEntry) => {
    if (!entry.x_status) return <Badge variant="outline" className="text-muted-foreground">X: —</Badge>;
    const { label, title } = formatXBadge(entry);
    const cls =
      entry.x_status === 'posted' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      : entry.x_status === 'failed' ? 'bg-destructive/15 text-destructive border-destructive/30'
      : entry.x_status === 'skipped' ? 'bg-muted text-muted-foreground border-border'
      : 'bg-amber-500/15 text-amber-500 border-amber-500/30';
    const badge = <Badge className={cls} title={title}>{label}</Badge>;
    return entry.x_status === 'posted' && entry.x_tweet_id ? (
      <a href={`https://x.com/i/status/${entry.x_tweet_id}`} target="_blank" rel="noopener noreferrer">{badge}</a>
    ) : badge;
  };

  const renderTelegramBadge = (entry: MonitoringEntry) => (
    <Badge variant={entry.is_delivered ? 'default' : entry.monitoring_state?.code === 'telegram_pending' ? 'secondary' : 'outline'}>
      {entry.is_delivered ? 'Delivered' : entry.monitoring_state?.telegram_state === 'none' ? 'No row' : entry.monitoring_state?.telegram_state || entry.delivery_status || 'No row'}
    </Badge>
  );

  const renderDedupeBadge = (entry: MonitoringEntry) => {
    if (!entry.dedupe_status) return null;
    const label =
      entry.dedupe_status === 'pending' ? 'Duplicate gate pending'
      : entry.dedupe_status === 'duplicate' ? 'Duplicate'
      : entry.dedupe_status === 'coverage_gap' ? 'Coverage gap'
      : entry.dedupe_status === 'related_new_info' ? 'Related: new info'
      : entry.dedupe_status === 'uncertain' ? 'Uncertain duplicate'
      : entry.dedupe_status === 'failed' ? 'Dedupe failed'
      : 'Unique';
    const cls =
      entry.dedupe_status === 'duplicate' ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
      : entry.dedupe_status === 'coverage_gap' ? toneClass('warn')
      : entry.dedupe_status === 'related_new_info' || entry.dedupe_status === 'unique' ? toneClass('good')
      : entry.dedupe_status === 'failed' ? toneClass('bad')
      : entry.dedupe_status === 'uncertain' ? toneClass('warn')
      : toneClass('info');
    const title = [
      entry.dedupe_method,
      entry.dedupe_confidence != null ? `confidence ${entry.dedupe_confidence.toFixed(2)}` : null,
      entry.dedupe_reason,
    ].filter(Boolean).join(' · ');
    return <Badge className={`${cls} text-[10px]`} title={title}>{label}</Badge>;
  };

  const duplicateCoverageLabel = (coverage?: NonNullable<MonitoringEntry['duplicate_of']>['coverage_state']) => {
    switch (coverage) {
      case 'delivered': return 'covered: delivered';
      case 'in_pipeline': return 'covered: in pipeline';
      case 'also_duplicate': return 'canonical is also duplicate';
      case 'not_covered': return 'not covered';
      default: return 'coverage unknown';
    }
  };

  const duplicateCoverageClass = (coverage?: NonNullable<MonitoringEntry['duplicate_of']>['coverage_state']) => {
    switch (coverage) {
      case 'delivered': return toneClass('good');
      case 'in_pipeline': return toneClass('info');
      case 'also_duplicate':
      case 'not_covered': return toneClass('warn');
      default: return toneClass('muted');
    }
  };

  const duplicateCoverageDetail = (target?: MonitoringEntry['duplicate_of']) => {
    if (!target) return 'The matched post was not returned by the backend. Use the tweet ID to inspect it directly.';
    switch (target.coverage_state) {
      case 'delivered':
        return 'Canonical item is covered. At least one delivery path already posted it.';
      case 'in_pipeline':
        return 'Canonical item is still active in the pipeline, so this duplicate is blocked while the original moves.';
      case 'also_duplicate':
        return 'Canonical item is also marked duplicate. This needs review so the story is not lost.';
      case 'not_covered':
        return 'Canonical item is not delivered or active. This is a coverage gap that needs review.';
      default:
        return 'Coverage is unknown. Inspect the matched item before trusting the duplicate decision.';
    }
  };

  const duplicateStatusSummary = (target?: MonitoringEntry['duplicate_of']) => {
    if (!target) return 'match not loaded';
    const decision = target.monitoring_state?.decision_label ?? target.delivery_decision ?? 'No decision';
    return `${decision} · Telegram ${target.telegram_state} · X ${target.x_state}`;
  };

  const inspectDuplicateMatch = (tweetId: string) => {
    setFilter('all');
    setSearchTerm(tweetId);
    void openDetails(tweetId);
  };

  const renderDuplicateHint = (entry: MonitoringEntry) => {
    if (!entry.dup_of_tweet_id) return null;
    const target = entry.duplicate_of;
    const label = target?.author_handle ? `@${target.author_handle}` : target?.tweet_id ? target.tweet_id.slice(-10) : entry.dup_of_tweet_id.slice(-10);
    const bothPostedX = entry.x_status === 'posted' && target?.x_state === 'posted';
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-purple-500/20 bg-purple-500/5 px-2 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-purple-300">Duplicate of {label}</span>
        <Badge className={`${duplicateCoverageClass(target?.coverage_state)} text-[10px]`}>
          {duplicateCoverageLabel(target?.coverage_state)}
        </Badge>
        {bothPostedX && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both X posted</Badge>}
        <span className="min-w-0 truncate">{duplicateStatusSummary(target)}</span>
      </div>
    );
  };

  const renderDuplicateMatch = (entry: MonitoringEntry, compact = false) => {
    if (!entry.dup_of_tweet_id) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    const target = entry.duplicate_of;
    const score = target ? target.final_score ?? target.importance_score : null;
    const matchedLabel = target?.author_handle ? `@${target.author_handle}` : entry.dup_of_tweet_id.slice(-10);
    const matchedId = target?.tweet_id ?? entry.dup_of_tweet_id;
    const matchedAge = target?.created_at ? formatDistanceToNow(new Date(target.created_at), { addSuffix: true }) : null;
    const bothPostedX = entry.x_status === 'posted' && target?.x_state === 'posted';
    return (
      <div className={`space-y-2 ${compact ? 'rounded-md border bg-muted/20 p-2 text-xs' : 'rounded-md border border-purple-500/20 bg-purple-500/5 p-2 text-xs'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">Duplicates {matchedLabel}</span>
              <Badge className={`${duplicateCoverageClass(target?.coverage_state)} text-[10px]`}>
                {duplicateCoverageLabel(target?.coverage_state)}
              </Badge>
              {bothPostedX && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both X posted</Badge>}
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={matchedId}>
              {matchedId.slice(-10)}{matchedAge ? ` · ${matchedAge}` : ''}
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => inspectDuplicateMatch(matchedId)}>
            Inspect
          </Button>
        </div>
        {target ? (
          <>
            <p className="line-clamp-3 text-muted-foreground">{target.text_original || '[No content]'}</p>
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
              <span>Score {score ?? '—'}</span>
              <span>Telegram {target.telegram_state}</span>
              <span>X {target.x_state}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{duplicateCoverageDetail(target)}</p>
            {bothPostedX && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
                Anomaly: this duplicate and its matched story were both posted to X. New backend guards prevent this for future automatic posts.
              </p>
            )}
            {target.url && (
              <a href={target.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Open match <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </>
        ) : (
          <p className="break-all text-muted-foreground">Matched ID {entry.dup_of_tweet_id}</p>
        )}
      </div>
    );
  };

  const renderAudienceBadge = (entry: MonitoringEntry) => {
    if (!entry.audience_class) return null;
    const cls =
      entry.audience_class === 'direct_focus' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      : entry.audience_class === 'adjacent' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
      : entry.audience_class === 'global_exception' ? 'bg-violet-500/15 text-violet-400 border-violet-500/30'
      : 'bg-muted text-muted-foreground border-border';
    const title = [
      entry.scoring_profile_id ? `profile ${entry.scoring_profile_id}` : null,
      entry.audience_confidence != null ? `confidence ${entry.audience_confidence.toFixed(2)}` : null,
      entry.global_exception_class ? `exception ${entry.global_exception_class}` : null,
      entry.audience_reason,
    ].filter(Boolean).join(' · ');
    return <Badge className={`${cls} text-[10px]`} title={title}>{audienceClassLabel(entry.audience_class)}</Badge>;
  };

  const renderCostFlags = (entry: MonitoringEntry) => (
    <div className="flex flex-wrap gap-1">
      {entry.x_cost_flags?.hydration_expected && <Badge variant="outline" className="text-[10px]">read</Badge>}
      {entry.x_cost_flags?.media_upload_expected && <Badge variant="outline" className="text-[10px]">media</Badge>}
      {entry.x_cost_flags?.may_call_x && <Badge variant="outline" className="text-[10px]">write</Badge>}
      {!entry.x_cost_flags?.reasons?.length && <span className="text-muted-foreground">—</span>}
    </div>
  );

  const renderScore = (entry: MonitoringEntry) => {
    const score = decisionScore(entry);
    if (score == null) return <span className="text-muted-foreground">—</span>;
    return (
      <span className={score >= deliverThreshold ? 'font-semibold text-emerald-500' : 'font-semibold text-amber-500'}>
        {Number.isInteger(score) ? score : score.toFixed(1)}
        <span className="text-xs text-muted-foreground"> / ≥{deliverThreshold}</span>
      </span>
    );
  };

  const renderRowActions = (entry: MonitoringEntry, compact = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={compact ? 'outline' : 'ghost'}
          size={compact ? 'sm' : 'icon'}
          aria-label="Row actions"
          className={compact ? 'h-9 flex-1 justify-center' : undefined}
        >
          <MoreHorizontal className="w-4 h-4" />
          {compact && <span className="ml-2">More</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openDetails(entry.tweet_id)}>
          Details <ChevronRight className="w-3 h-3 ml-2" />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'translate', entry })}>
          <MessageSquare className="w-3 h-3 mr-2" />Get translation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openManualScore(entry)}>
          <SlidersHorizontal className="w-3 h-3 mr-2" />Manual score
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'force_telegram', entry })}>
          <Send className="w-3 h-3 mr-2" />Force Telegram
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!xPostingEnabled} onClick={() => setPendingAction({ type: 'force_x', entry })}>
          <Twitter className="w-3 h-3 mr-2" />Post plain to X
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'hydrate', entry })}>
          <Sparkles className="w-3 h-3 mr-2" />Hydrate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'run_dedupe', entry })}>
          <Ban className="w-3 h-3 mr-2" />Run duplicate check
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'rescore', entry })}>
          <Star className="w-3 h-3 mr-2" />Re-score
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'reprocess', entry })}>
          <RotateCcw className="w-3 h-3 mr-2" />Reprocess
        </DropdownMenuItem>
        {entry.dup_of_tweet_id && (
          <DropdownMenuItem onClick={() => setPendingAction({ type: 'clear_dup', entry })}>
            <Check className="w-3 h-3 mr-2" />Clear duplicate
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setPendingAction({ type: 'ignore', entry })}>
          <Ban className="w-3 h-3 mr-2" />Ignore / remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const clusterCoverageBadge = (cluster: DuplicateCluster) => {
    const cls = cluster.has_x_anomaly
      ? 'border-red-500/30 bg-red-500/15 text-red-300'
      : cluster.coverage_state === 'covered'
        ? toneClass('good')
        : cluster.coverage_state === 'in_pipeline'
          ? toneClass('info')
          : cluster.coverage_state === 'coverage_gap'
            ? toneClass('warn')
            : toneClass('muted');
    const label = cluster.has_x_anomaly
      ? 'Duplicate anomaly'
      : cluster.coverage_state === 'covered'
        ? 'Covered'
        : cluster.coverage_state === 'in_pipeline'
          ? 'In pipeline'
          : cluster.coverage_state === 'coverage_gap'
            ? 'Coverage gap'
            : 'Coverage unknown';
    return <Badge className={`${cls} text-[10px]`}>{label}</Badge>;
  };

  const renderDuplicateClusterSummary = (entry: MonitoringEntry, compact = false) => {
    const cluster = entry.duplicate_cluster;
    if (!cluster || cluster.counts.total < 2) return renderDuplicateMatch(entry, compact);
    const isExpanded = expandedClusters.has(cluster.cluster_id);
    return (
      <div className={`${compact ? 'rounded-md border bg-muted/20 p-2' : 'rounded-md border border-purple-500/20 bg-purple-500/5 p-2'} text-xs`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 min-w-0 px-1.5 text-xs"
            onClick={() => toggleCluster(cluster.cluster_id)}
          >
            {isExpanded ? <ChevronDown className="mr-1 h-3 w-3 shrink-0" /> : <ChevronRight className="mr-1 h-3 w-3 shrink-0" />}
            <span className="truncate">{cluster.counts.total} versions</span>
          </Button>
          <div className="flex flex-wrap gap-1">
            {clusterCoverageBadge(cluster)}
            {cluster.counts.x_posted > 0 && <Badge variant="outline" className="text-[10px]">X {cluster.counts.x_posted}</Badge>}
            {cluster.counts.delivered > 0 && <Badge variant="outline" className="text-[10px]">TG {cluster.counts.delivered}</Badge>}
            {cluster.counts.blocked > 0 && <Badge variant="outline" className="text-[10px]">{cluster.counts.blocked} blocked</Badge>}
          </div>
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          Canonical {cluster.canonical_tweet_id.slice(-10)} · expand to compare duplicates
        </p>
      </div>
    );
  };

  const renderDuplicateClusterPanel = (entry: MonitoringEntry) => {
    const cluster = entry.duplicate_cluster;
    if (!cluster || cluster.counts.total < 2 || !expandedClusters.has(cluster.cluster_id)) return null;
    return (
      <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Duplicate cluster</p>
            <p className="text-xs text-muted-foreground">
              {cluster.counts.total} versions · {cluster.counts.delivered} Telegram covered · {cluster.counts.x_posted} X posted
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {clusterCoverageBadge(cluster)}
            {cluster.has_x_anomaly && <Badge className="border-red-500/30 bg-red-500/15 text-red-300 text-[10px]">Both posted to X</Badge>}
          </div>
        </div>
        <div className="grid gap-2 xl:grid-cols-2">
          {cluster.members.map((member) => {
            const fullEntry = entryByTweetId.get(member.tweet_id);
            const score = memberScoreValue(member);
            return (
              <div key={member.tweet_id} className="rounded-md border bg-background/60 p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{member.tweet_id.slice(-10)}</span>
                      {member.is_canonical && <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">canonical</Badge>}
                      {member.dedupe_status && <Badge variant="outline" className="text-[10px]">{member.dedupe_status.replaceAll('_', ' ')}</Badge>}
                    </div>
                    <p className="mt-1 font-medium">{member.author_handle ? `@${member.author_handle}` : 'Unknown author'}</p>
                    {member.created_at && <p className="text-muted-foreground">{formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}</p>}
                  </div>
                  <div className="text-right">
                    <p className={score != null && score >= deliverThreshold ? 'font-semibold text-emerald-500' : 'font-semibold text-amber-500'}>{score == null ? '—' : Number.isInteger(score) ? score : score.toFixed(1)}</p>
                    <p className="text-[11px] text-muted-foreground">score</p>
                  </div>
                </div>
                <p className="line-clamp-3 leading-5 text-muted-foreground">{member.text_original || '[No content]'}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">Telegram {member.telegram_state}</Badge>
                  <Badge variant="outline" className="text-[10px]">X {member.x_state}</Badge>
                  {member.dup_similarity != null && <Badge variant="outline" className="text-[10px]">sim {member.dup_similarity.toFixed(2)}</Badge>}
                  {member.dedupe_confidence != null && <Badge variant="outline" className="text-[10px]">conf {member.dedupe_confidence.toFixed(2)}</Badge>}
                </div>
                {member.dedupe_reason && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{member.dedupe_reason}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openDetails(member.tweet_id)}>
                    Details
                  </Button>
                  {member.url && (
                    <a href={member.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-primary hover:bg-muted">
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {fullEntry && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setPendingAction({ type: 'run_dedupe', entry: fullEntry })}>
                        Run duplicate check
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openManualScore(fullEntry)}>
                        Manual score
                      </Button>
                      {fullEntry.dup_of_tweet_id && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setPendingAction({ type: 'clear_dup', entry: fullEntry })}>
                          Clear duplicate
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full p-0">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">Content Monitoring</h1>
          <p className="text-sm text-muted-foreground">Editorial triage for scoring, translation, delivery blockers, and X visibility</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="justify-center sm:w-auto">
                <Wrench className="w-4 h-4 mr-2" />Maintenance
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {counts.stale_x_pending_24h > 0 && (
                <DropdownMenuItem onClick={() => setPendingAction({ type: 'close_stale_x' })}>
                  <Clock className="w-3 h-3 mr-2" />Close stale X pending
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={() => setPendingAction({ type: 'cancel_jobs' })}>
                <Ban className="w-3 h-3 mr-2" />Cancel pending jobs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={invalidate} variant="outline" className="justify-center sm:w-auto" disabled={isFetching}>
            {isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </div>

      {!xPostingEnabled && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">X posting is off</p>
            <p className="text-muted-foreground">Manual X posting is disabled until it is enabled under <Link to="/settings#x-automation" className="text-primary underline">Settings</Link>.</p>
          </div>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ['Needs attention', counts.needs_attention, 'text-amber-500'],
          ['Failed/stuck', counts.failed_stuck, 'text-destructive'],
          ['Translation queue', counts.translation_queue, 'text-blue-500'],
          ['Needs score', counts.needs_score, 'text-amber-500'],
          ['Ready to deliver', counts.ready_to_deliver, 'text-primary'],
          ['Manual review', counts.manual_review, 'text-purple-500'],
          ['Duplicates', counts.duplicates, 'text-muted-foreground'],
          ['Coverage gaps', counts.coverage_gap ?? 0, 'text-amber-500'],
          ['Possible dupes', counts.possible_duplicate ?? 0, 'text-amber-500'],
          ['Dup anomalies', counts.duplicate_anomalies ?? 0, 'text-destructive'],
          ['Hydration', counts.hydration, 'text-blue-500'],
          ['X pending', counts.x_pending, 'text-amber-500'],
          ['X failed', counts.x_failed, 'text-destructive'],
          ['Delivered 24h', counts.delivered_24h, 'text-emerald-500'],
        ].map(([label, value, cls]) => (
          <Card key={label as string}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-semibold tabular-nums sm:text-2xl ${cls}`}>{compactNumber(value as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
            {[
              ['Telegram pending', counts.telegram_pending],
              ['Below threshold', counts.below_threshold],
              ['Stale jobs', counts.stale_jobs],
              ['Stale X pending', counts.stale_x_pending_24h],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{compactNumber(value as number)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-3 gap-3 p-3">
            <div>
              <p className="text-xs text-muted-foreground">X attempts</p>
              <p className="text-lg font-semibold tabular-nums">{compactNumber(xSummary?.counted_attempts)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Local posts</p>
              <p className="text-lg font-semibold tabular-nums">{compactNumber(xSummary?.posts_local ?? counts.delivered_24h)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Success</p>
              <p className="text-lg font-semibold tabular-nums">{xSummary ? `${xSummary.success_rate}%` : '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Queue</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search author, source, text, tweet ID" className="pl-9" />
              </div>
              <ThemedSelect value={filter} onValueChange={(value) => setFilter(value as MonitoringFilter)}>
                <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </ThemedSelect>
              <ThemedSelect value={scoreBucket} onValueChange={(value) => setScoreBucket(value as ScoreBucket)}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCORE_BUCKETS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </ThemedSelect>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">Monitoring failed to load: {(error as Error).message}</div>
          ) : moderationEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No entries found</div>
          ) : (
            <>
              <div className="divide-y divide-border lg:hidden">
                {moderationEntries.map((entry) => {
                  const stage = monitoringStage(entry);
                  const decision = formatDecisionReason(entry.decision_reason);
                  const decisionLabel = monitoringDecisionLabel(entry, entry.delivery_decision ? decision.title : 'No decision');
                  const blocker = entry.monitoring_state?.primary_blocker;
                  return (
                    <article key={entry.tweet_id} className="space-y-3 p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <button onClick={() => openDetails(entry.tweet_id)} className="block w-full text-left">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-mono text-[11px]">{entry.tweet_id.slice(-10)}</span>
                              <span>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium">
                              {entry.author_handle ? `@${entry.author_handle}` : `@${entry.account_handle}`}
                            </p>
                          </button>
                          {entry.url && (
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              Source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <Badge className={toneClass(stage.tone)}>{stage.label}</Badge>
                      </div>

                      <button onClick={() => openDetails(entry.tweet_id)} className="block w-full text-left text-sm leading-5 hover:text-primary">
                        <span className="line-clamp-3">{shortText(entry) || '[No content]'}</span>
                      </button>

                      <div className="flex flex-wrap gap-1">
                        {entry.importance_tags?.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
                        {entry.dup_of_tweet_id && <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px]">dup</Badge>}
                        {renderDedupeBadge(entry)}
                        {renderAudienceBadge(entry)}
                        {entry.feedback_locked && <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]">locked</Badge>}
                      </div>
                      {entry.duplicate_cluster ? renderDuplicateClusterSummary(entry, true) : renderDuplicateHint(entry)}
                      {renderDuplicateClusterPanel(entry)}

                      <div className="grid grid-cols-2 gap-2 text-xs min-[520px]:grid-cols-4">
                        <div className="rounded-md border bg-muted/20 p-2">
                          <p className="text-muted-foreground">Score</p>
                          <div className="mt-1">{renderScore(entry)}</div>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-2">
                          <p className="text-muted-foreground">Decision</p>
                          <p className="mt-1 truncate font-medium" title={blocker || decision.detail || decision.title}>{decisionLabel}</p>
                        </div>
                        <div className="rounded-md border bg-muted/20 p-2">
                          <p className="mb-1 text-muted-foreground">Telegram</p>
                          {renderTelegramBadge(entry)}
                        </div>
                        <div className="rounded-md border bg-muted/20 p-2">
                          <p className="mb-1 text-muted-foreground">X / cost</p>
                          <div className="space-y-1">
                            {renderXBadge(entry)}
                            {renderCostFlags(entry)}
                          </div>
                        </div>
                      </div>

                      {(blocker || entry.decision_reason) && (
                        <p className="rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          {blocker || decision.detail || decision.title}
                        </p>
                      )}

                      {entry.dup_of_tweet_id && !entry.duplicate_cluster && (
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Duplicate match</p>
                          {renderDuplicateMatch(entry, true)}
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <Button variant="outline" size="sm" className="h-9" onClick={() => openDetails(entry.tweet_id)}>
                          Details
                        </Button>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => openManualScore(entry)}>
                          Score
                        </Button>
                        {renderRowActions(entry, true)}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden lg:block">
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[8%]" />
                    <col className="w-[9%]" />
                    <col className="w-[26%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col className="w-[12%]" />
                    <col className="w-[20%]" />
                    <col className="w-[6%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3">Source / time</TableHead>
                      <TableHead className="px-3">Author</TableHead>
                      <TableHead className="px-3">Excerpt</TableHead>
                      <TableHead className="px-3">Stage</TableHead>
                      <TableHead className="px-3">Score</TableHead>
                      <TableHead className="px-3">Decision</TableHead>
                      <TableHead className="px-3">Duplicate evidence</TableHead>
                      <TableHead className="px-3">Delivery</TableHead>
                      <TableHead className="px-2 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {moderationEntries.map((entry) => {
                    const stage = monitoringStage(entry);
                    const decision = formatDecisionReason(entry.decision_reason);
                    const decisionLabel = monitoringDecisionLabel(entry, entry.delivery_decision ? decision.title : 'No decision');
                    const blocker = entry.monitoring_state?.primary_blocker;
                    return (
                      <Fragment key={entry.tweet_id}>
                        <TableRow className="align-top">
                          <TableCell className="px-3 py-4 text-xs">
                            <div className="space-y-1">
                              <div className="font-mono text-[11px] text-muted-foreground">{entry.tweet_id.slice(-10)}</div>
                              <div>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</div>
                              {entry.url && (
                                <a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  Source <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-4">
                            <div className="truncate font-medium">
                              {entry.author_handle ? `@${entry.author_handle}` : `@${entry.account_handle}`}
                            </div>
                            {entry.account_handle && entry.author_handle && entry.account_handle !== entry.author_handle && (
                              <p className="text-xs text-muted-foreground truncate">@{entry.account_handle}</p>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-4">
                            <button onClick={() => openDetails(entry.tweet_id)} className="block w-full text-left text-sm leading-5 hover:text-primary">
                              <span className="line-clamp-2">{shortText(entry) || '[No content]'}</span>
                            </button>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {entry.importance_tags?.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
                              {entry.dup_of_tweet_id && <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px]">dup</Badge>}
                              {renderDedupeBadge(entry)}
                              {renderAudienceBadge(entry)}
                              {entry.feedback_locked && <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]">locked</Badge>}
                            </div>
                            {!entry.duplicate_cluster && renderDuplicateHint(entry)}
                          </TableCell>
                          <TableCell className="px-3 py-4"><Badge className={toneClass(stage.tone)}>{stage.label}</Badge></TableCell>
                          <TableCell className="px-3 py-4">{renderScore(entry)}</TableCell>
                          <TableCell className="px-3 py-4">
                            <p className="line-clamp-2 text-sm" title={blocker || decision.detail || decision.title}>{decisionLabel}</p>
                            {(blocker || entry.decision_reason) && <p className="line-clamp-2 text-xs text-muted-foreground">{blocker || decision.title}</p>}
                          </TableCell>
                          <TableCell className="px-3 py-4">{renderDuplicateClusterSummary(entry)}</TableCell>
                          <TableCell className="px-3 py-4">
                            <div className="space-y-2">
                              <div>{renderTelegramBadge(entry)}</div>
                              <div>{renderXBadge(entry)}</div>
                              <div>{renderCostFlags(entry)}</div>
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-4 text-right">
                            {renderRowActions(entry)}
                          </TableCell>
                        </TableRow>
                        {entry.duplicate_cluster && expandedClusters.has(entry.duplicate_cluster.cluster_id) && (
                          <TableRow>
                            <TableCell colSpan={9} className="px-3 py-3">
                              {renderDuplicateClusterPanel(entry)}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            </>
          )}
          {hasNextPage && (
            <div className="flex justify-center border-t p-4">
              <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[92svh]">
          <DrawerHeader className="px-4 pb-2 pt-3 text-left">
            <DrawerTitle className="text-base sm:text-lg">Pipeline Details</DrawerTitle>
            <DrawerDescription className="break-all">{drawerTweetId}</DrawerDescription>
          </DrawerHeader>
          <div className="grid max-h-[76svh] gap-3 overflow-y-auto px-3 pb-4 sm:px-4 lg:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              {selectedEntry && (
                <>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Why this is here</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge className={toneClass(monitoringStage(selectedEntry).tone)}>{monitoringStage(selectedEntry).label}</Badge>
                        <Badge variant="outline">{selectedEntry.monitoring_state?.decision_label ?? selectedEntry.delivery_decision ?? 'No decision'}</Badge>
                        {selectedEntry.monitoring_state?.translation_state && <Badge variant="outline">Translation: {selectedEntry.monitoring_state.translation_state.replace(/_/g, ' ')}</Badge>}
                      </div>
                      <p className="text-muted-foreground">
                        {selectedEntry.monitoring_state?.primary_blocker ?? 'No current blocker. This item is waiting for the next normal pipeline step or is already complete.'}
                      </p>
                      {selectedEntry.dup_of_tweet_id && (
                        <div className="rounded-md border bg-muted/20 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase text-muted-foreground">Duplicate match</p>
                            <Badge className={duplicateCoverageClass(selectedEntry.duplicate_of?.coverage_state)}>
                              {duplicateCoverageLabel(selectedEntry.duplicate_of?.coverage_state)}
                            </Badge>
                          </div>
                          {renderDuplicateMatch(selectedEntry)}
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Telegram</p>
                          <p className="font-medium">{selectedEntry.monitoring_state?.telegram_state === 'none' ? 'No row' : selectedEntry.monitoring_state?.telegram_state ?? selectedEntry.delivery_status ?? 'No row'}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">X</p>
                          <p className="font-medium">{selectedEntry.monitoring_state?.x_state === 'none' ? 'No row' : selectedEntry.monitoring_state?.x_state ?? selectedEntry.x_status ?? 'No row'}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Next actions</p>
                          <p className="font-medium">{selectedEntry.monitoring_state?.next_actions?.join(', ') || 'Details'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Twitter className="h-4 w-4" />Why not on X?
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {xDiagnosticLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />Checking X gates...
                        </div>
                      ) : xDiagnostic ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <Badge className={xDiagnostic.eligible ? toneClass('good') : toneClass('warn')}>
                              {xDiagnostic.eligible ? 'Eligible for X' : 'Not eligible yet'}
                            </Badge>
                            {xDiagnostic.enrichment?.text_source && (
                              <Badge variant="outline">
                                Text: {xDiagnostic.enrichment.text_source === 'approved_enrichment' ? 'approved enrichment' : 'plain translation'}
                              </Badge>
                            )}
                            {xDiagnostic.enrichment?.pipeline_mode && (
                              <Badge variant="outline">Enrichment: {xDiagnostic.enrichment.pipeline_mode.replaceAll('_', ' ')}</Badge>
                            )}
                          </div>
                          {xDiagnostic.blockers.length > 0 ? (
                            <div className="space-y-2">
                              {xDiagnostic.blockers.map((blocker) => (
                                <div key={blocker.code} className="rounded-md border bg-muted/30 p-2">
                                  <p className="font-medium">{blocker.label}</p>
                                  <p className="text-xs text-muted-foreground">{blocker.code.replaceAll('_', ' ')}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
                              This post passes the local X gates. Normal cron still respects budget, spacing, media, and prior-post checks.
                            </p>
                          )}
                          {xDiagnostic.notes.length > 0 && (
                            <div className="space-y-1">
                              {xDiagnostic.notes.map((note) => (
                                <p key={note.code} className="text-xs text-muted-foreground">{note.label}</p>
                              ))}
                            </div>
                          )}
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div className="rounded-md border p-2">
                              <p className="text-xs text-muted-foreground">Hydration</p>
                              <p className="font-medium">{xDiagnostic.hydration?.is_truncated ? xDiagnostic.hydration?.hydrated_at ? 'Hydrated' : 'Needed' : 'Not needed'}</p>
                            </div>
                            <div className="rounded-md border p-2">
                              <p className="text-xs text-muted-foreground">Media</p>
                              <p className="font-medium">{xDiagnostic.media?.has_media ? `${xDiagnostic.media.downloaded ?? 0}/${xDiagnostic.media.rows ?? 0} ready` : 'No media gate'}</p>
                            </div>
                            <div className="rounded-md border p-2">
                              <p className="text-xs text-muted-foreground">Latest X</p>
                              <p className="font-medium">{xDiagnostic.latest_x?.status ?? 'No row'}</p>
                            </div>
                            <div className="rounded-md border p-2 sm:col-span-3">
                              <p className="text-xs text-muted-foreground">SQL candidate gate</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Badge variant={xDiagnostic.candidate?.sql_gate_passed ? 'default' : 'outline'}>
                                  {xDiagnostic.candidate?.sql_gate_passed ? 'candidate' : 'not candidate'}
                                </Badge>
                                {xDiagnostic.candidate?.reason && <span className="text-xs text-muted-foreground">{xDiagnostic.candidate.reason.replaceAll('_', ' ')}</span>}
                                {xDiagnostic.candidate?.dispatch_source && <span className="text-xs text-muted-foreground">source {xDiagnostic.candidate.dispatch_source}</span>}
                                {typeof xDiagnostic.candidate?.age_ms === 'number' && <span className="text-xs text-muted-foreground">age {formatAge(Math.round(xDiagnostic.candidate.age_ms / 1000))}</span>}
                              </div>
                            </div>
                          </div>
                          {(xDiagnostic.media?.row_details?.length ?? 0) > 0 && (
                            <div className="space-y-2 rounded-md border p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-medium text-muted-foreground">Media rows</p>
                                <Badge variant="outline">
                                  {xDiagnostic.media?.selected_tier ?? 'unknown'}
                                  {xDiagnostic.media?.selected_reason ? `: ${xDiagnostic.media.selected_reason.replaceAll('_', ' ')}` : ''}
                                </Badge>
                              </div>
                              <div className="grid gap-2">
                                {xDiagnostic.media?.row_details?.map((row, index) => (
                                  <div key={row.id ?? index} className="grid gap-1 rounded border bg-muted/20 p-2 text-xs sm:grid-cols-[1fr_auto]">
                                    <div className="min-w-0">
                                      <p className="font-medium">
                                        {row.kind ?? 'unknown'} · {row.mime_type ?? 'not downloaded'} · {formatBytes(row.file_size)}
                                      </p>
                                      <p className="text-muted-foreground">
                                        {row.video_intent ? 'video intent' : 'image/text media'} · {row.downloaded ? 'downloaded' : 'not downloaded'}
                                      </p>
                                    </div>
                                    <Badge className={row.sendable ? toneClass('good') : toneClass('warn')}>
                                      {(row.role ?? 'not_sendable').replaceAll('_', ' ')}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Button size="sm" variant="outline" onClick={() => handleTestEnrich(selectedEntry.tweet_id)} disabled={enrichingTweetIds.has(selectedEntry.tweet_id)}>
                              {enrichingTweetIds.has(selectedEntry.tweet_id)
                                ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                : <Sparkles className="w-3 h-3 mr-1.5" />}
                              {enrichingTweetIds.has(selectedEntry.tweet_id) ? 'Generating draft' : 'Generate enrichment draft'}
                            </Button>
                            <Button size="sm" disabled={!xPostingEnabled} onClick={() => setPendingAction({ type: 'force_x', entry: selectedEntry })}>
                              <Twitter className="w-3 h-3 mr-1.5" />Post plain to X
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="text-muted-foreground">X diagnostics are not available from the deployed admin function yet.</p>
                      )}
                    </CardContent>
                  </Card>

                  {(selectedEntry.dedupe_status || selectedEntry.dup_of_tweet_id) && (
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm">Duplicate Gate</CardTitle>
                          <Button size="sm" variant="outline" onClick={() => setPendingAction({ type: 'run_dedupe', entry: selectedEntry })}>
                            <Ban className="w-3 h-3 mr-1.5" />Run
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          {renderDedupeBadge(selectedEntry)}
                          {selectedEntry.dup_of_tweet_id && <Badge variant="outline">Duplicate of {selectedEntry.dup_of_tweet_id}</Badge>}
                          {selectedEntry.dedupe_checked_at && <Badge variant="outline">{formatDistanceToNow(new Date(selectedEntry.dedupe_checked_at), { addSuffix: true })}</Badge>}
                        </div>
                        {selectedEntry.dedupe_reason && <p className="rounded-md border bg-muted/30 p-2">{selectedEntry.dedupe_reason}</p>}
                        {selectedEntry.x_status === 'posted' && selectedEntry.duplicate_of?.x_state === 'posted' && (
                          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
                            Anomaly: both this duplicate and the matched story were posted to X. This row should be treated as historical leakage; future automatic X posts are now blocked at the poster boundary.
                          </p>
                        )}
                        {selectedEntry.dup_of_tweet_id && (
                          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-medium uppercase text-muted-foreground">Matched story</p>
                                <p className="break-all font-mono text-xs">{selectedEntry.dup_of_tweet_id}</p>
                              </div>
                              <Badge className={duplicateCoverageClass(selectedEntry.duplicate_of?.coverage_state)}>
                                {duplicateCoverageLabel(selectedEntry.duplicate_of?.coverage_state)}
                              </Badge>
                            </div>
                            {selectedEntry.duplicate_of ? (
                              <>
                                <div className="grid gap-2 sm:grid-cols-4">
                                  <div className="rounded-md border bg-background/50 p-2">
                                    <p className="text-xs text-muted-foreground">Author</p>
                                    <p className="truncate font-medium">{selectedEntry.duplicate_of.author_handle ? `@${selectedEntry.duplicate_of.author_handle}` : 'Unknown'}</p>
                                  </div>
                                  <div className="rounded-md border bg-background/50 p-2">
                                    <p className="text-xs text-muted-foreground">Score</p>
                                    <p className="font-medium">{selectedEntry.duplicate_of.final_score ?? selectedEntry.duplicate_of.importance_score ?? '—'}</p>
                                  </div>
                                  <div className="rounded-md border bg-background/50 p-2">
                                    <p className="text-xs text-muted-foreground">Telegram</p>
                                    <p className="truncate font-medium">{selectedEntry.duplicate_of.telegram_state}</p>
                                  </div>
                                  <div className="rounded-md border bg-background/50 p-2">
                                    <p className="text-xs text-muted-foreground">X</p>
                                    <p className="truncate font-medium">{selectedEntry.duplicate_of.x_state}</p>
                                  </div>
                                </div>
                                <div className="rounded-md border bg-background/50 p-3">
                                  <p className="mb-1 text-xs text-muted-foreground">Matched excerpt</p>
                                  <p className="text-sm leading-5">{selectedEntry.duplicate_of.text_original || '[No content]'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline">{selectedEntry.duplicate_of.monitoring_state?.decision_label ?? selectedEntry.duplicate_of.delivery_decision ?? 'No decision'}</Badge>
                                  {selectedEntry.duplicate_of.decision_reason && <span className="min-w-0 break-words">{selectedEntry.duplicate_of.decision_reason}</span>}
                                  {selectedEntry.duplicate_of.url && (
                                    <a href={selectedEntry.duplicate_of.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                      Open matched source <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                                {(selectedEntry.duplicate_of.coverage_state === 'not_covered' || selectedEntry.duplicate_of.coverage_state === 'also_duplicate') && (
                                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
                                    This match is not delivered yet. Future duplicate checks now treat this as a coverage gap instead of silently blocking the newer item.
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="rounded-md border bg-background/50 p-2 text-xs text-muted-foreground">
                                The matched post is not included in this page response yet. Re-run duplicate check or refresh after the backend deploy to load its delivery coverage.
                              </p>
                            )}
                          </div>
                        )}
                        {selectedEntry.dedupe_new_facts && selectedEntry.dedupe_new_facts.length > 0 && (
                          <div className="rounded-md border bg-muted/30 p-2">
                            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">New facts</p>
                            <ul className="list-disc space-y-1 pl-4">
                              {selectedEntry.dedupe_new_facts.map((fact) => <li key={fact}>{fact}</li>)}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Content</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">English</p>
                        <p className="rounded-md border bg-muted/30 p-3">{selectedEntry.text_original || '[No content]'}</p>
                      </div>
                      <div>
                        <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs font-medium uppercase text-muted-foreground">Persian</p>
                          <div className="grid grid-cols-2 gap-2 sm:flex">
                            <Button size="sm" variant="outline" className="justify-center" onClick={() => setPendingAction({ type: 'translate', entry: selectedEntry })}>Get translation</Button>
                            <Button size="sm" variant="outline" className="justify-center" onClick={() => {
                              setEditingEntry(selectedEntry.tweet_id);
                              setEditedContent(selectedEntry.text_translated || selectedEntry.text_original);
                            }}>Edit</Button>
                          </div>
                        </div>
                        {editingEntry === selectedEntry.tweet_id ? (
                          <div className="space-y-2">
                            <Textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} className="min-h-[120px]" dir="rtl" />
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                              <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                              <Button size="sm" variant="outline" onClick={() => { setEditingEntry(null); setEditedContent(''); }}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border bg-card p-3 leading-relaxed" dir="rtl">{selectedEntry.text_translated || '[Not translated yet]'}</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <MediaThumbnails tweetId={selectedEntry.tweet_id} />

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Scoring</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
	                      <div className="grid gap-2 sm:grid-cols-3">
	                        <div className="rounded-md border p-2">
	                          <p className="text-xs text-muted-foreground">Current</p>
	                          <p className="font-medium">{decisionScore(selectedEntry) ?? '—'} / ≥{deliverThreshold}</p>
	                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Decision</p>
                          <p className="font-medium">{selectedEntry.monitoring_state?.decision_label ?? selectedEntry.delivery_decision ?? 'No decision'}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Feedback</p>
	                          <p className="font-medium">{selectedEntry.feedback_locked ? 'Locked' : 'Open'}</p>
	                        </div>
	                      </div>
                      {selectedScoringV2 && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">V2 comparison</p>
                              <p className="text-sm font-medium">{selectedScoringV2.profile_id ?? selectedEntry.scoring_profile_id ?? 'iran-first'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{selectedScoringV2.mode ?? selectedEntry.score_review_status ?? 'v2'}</Badge>
                              <Badge className={selectedScoringV2.decision === 'deliver' ? toneClass('good') : selectedScoringV2.decision === 'skip' ? toneClass('muted') : toneClass('info')}>
                                {scoringV2DecisionLabel(selectedScoringV2.decision)}
                              </Badge>
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-4">
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">Legacy decision</p>
                              <p className="font-medium">{selectedEntry.delivery_decision ?? 'No decision'}</p>
                            </div>
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">V2 score</p>
                              <p className="font-medium">{formatScoringV2Score(selectedScoringV2)}</p>
                            </div>
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">V2 audience</p>
                              <p className="font-medium">{audienceClassLabel(selectedScoringV2.audience_class)}</p>
                            </div>
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">V2 review</p>
                              <p className="font-medium">{selectedScoringV2.review_status ?? 'none'}</p>
                            </div>
                          </div>
                          {selectedScoringV2.audience_reason && (
                            <p className="mt-2 rounded-md border bg-background/50 p-2 text-xs leading-5">{selectedScoringV2.audience_reason}</p>
                          )}
                        </div>
                      )}
	                      {selectedEntry.scoring_version && (
	                        <div className="grid gap-2 sm:grid-cols-4">
	                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Audience</p>
                            <p className="font-medium">{audienceClassLabel(selectedEntry.audience_class)}</p>
                          </div>
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Confidence</p>
                            <p className="font-medium">{selectedEntry.audience_confidence != null ? selectedEntry.audience_confidence.toFixed(2) : '—'}</p>
                          </div>
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Profile</p>
                            <p className="truncate font-medium" title={selectedEntry.scoring_profile_id ?? undefined}>{selectedEntry.scoring_profile_id ?? '—'}</p>
                          </div>
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Review</p>
                            <p className="font-medium">{selectedEntry.score_review_status ?? 'none'}</p>
                          </div>
                        </div>
                      )}
                      {selectedEntry.audience_reason && <p className="rounded-md border bg-muted/30 p-2">{selectedEntry.audience_reason}</p>}
                      {selectedEntry.importance_reasoning && <p className="rounded-md border bg-muted/30 p-2">{selectedEntry.importance_reasoning}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" className="w-full sm:w-auto" onClick={() => openManualScore(selectedEntry)}>
                          <SlidersHorizontal className="w-3 h-3 mr-1.5" />Manual score
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleFeedback(selectedEntry, 'should_pass_audience', (selectedEntry.audience_class as AudienceClassValue | null) ?? 'direct_focus')} disabled={feedbackLoading === `${selectedEntry.tweet_id}:should_pass_audience`}>
                          Should pass
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleFeedback(selectedEntry, 'should_skip', (selectedEntry.audience_class as AudienceClassValue | null) ?? 'off_topic')} disabled={feedbackLoading === `${selectedEntry.tweet_id}:should_skip`}>
                          Should skip
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleFeedback(selectedEntry, 'wrong_relevance_class')} disabled={feedbackLoading === `${selectedEntry.tweet_id}:wrong_relevance_class`}>
                          Wrong class
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleFeedback(selectedEntry, 'global_exception_worth_covering', 'global_exception')} disabled={feedbackLoading === `${selectedEntry.tweet_id}:global_exception_worth_covering`}>
                          Global exception
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleFeedback(selectedEntry, 'not_global_exception', 'off_topic')} disabled={feedbackLoading === `${selectedEntry.tweet_id}:not_global_exception`}>
                          Not exception
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {selectedEntry.enrich_status && selectedEntry.enrich_status !== 'skipped' && (
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">Enrichment Studio</CardTitle>
                          <Button size="sm" variant="outline" onClick={() => handleTestEnrich(selectedEntry.tweet_id)} disabled={enrichingTweetIds.has(selectedEntry.tweet_id)}>
                            {enrichingTweetIds.has(selectedEntry.tweet_id)
                              ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                              : <Sparkles className="w-3 h-3 mr-1.5" />}
                            {enrichingTweetIds.has(selectedEntry.tweet_id) ? 'Generating' : 'Generate draft'}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={selectedEntry.enrich_status === 'awaiting_approval' ? 'secondary' : selectedEntry.enrich_status === 'rejected' ? 'destructive' : 'outline'}>{selectedEntry.enrich_status}</Badge>
                          {selectedEntry.enrichment_version && <Badge variant="outline">{selectedEntry.enrichment_version}</Badge>}
                          {typeof selectedEntry.aggregator_risk_score === 'number' && <Badge className={selectedEntry.aggregator_risk_score >= 70 ? toneClass('bad') : selectedEntry.aggregator_risk_score >= 35 ? toneClass('warn') : toneClass('good')}>Aggregator {selectedEntry.aggregator_risk_score}</Badge>}
                          {typeof selectedEntry.ai_voice_risk_score === 'number' && <Badge className={selectedEntry.ai_voice_risk_score >= 70 ? toneClass('bad') : selectedEntry.ai_voice_risk_score >= 35 ? toneClass('warn') : toneClass('good')}>AI voice {selectedEntry.ai_voice_risk_score}</Badge>}
                        </div>
                        {selectedEntry.enrichment_review_reason && <p className="rounded-md border bg-muted/30 p-2">{selectedEntry.enrichment_review_reason}</p>}
                        {selectedVoice && (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div className="rounded-md border bg-muted/20 p-2">
                              <p className="text-xs text-muted-foreground">Intent</p>
                              <p className="font-medium">{selectedVoice.intent?.replaceAll('_', ' ') || '—'}</p>
                            </div>
                            <div className="rounded-md border bg-muted/20 p-2">
                              <p className="text-xs text-muted-foreground">Language</p>
                              <p className="font-medium">{selectedVoice.language_choice || '—'}</p>
                            </div>
                            <div className="rounded-md border bg-muted/20 p-2">
                              <p className="text-xs text-muted-foreground">Selected</p>
                              <p className="font-medium">{selectedVoice.selected_variant?.replaceAll('_', ' ') || '—'}</p>
                            </div>
                          </div>
                        )}
                        <div className="grid gap-2 lg:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Original</p>
                            <p className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">{selectedEntry.text_original || '[No original text]'}</p>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Translation</p>
                            <p dir="rtl" className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">{selectedEntry.text_translated || '[No translation yet]'}</p>
                          </div>
                        </div>
                        {selectedEntry.monetization_risk_flags && selectedEntry.monetization_risk_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedEntry.monetization_risk_flags.map((flag) => <Badge key={flag} variant="outline" className="text-xs">{flag}</Badge>)}
                          </div>
                        )}
                        {selectedVoice?.variants && selectedVoice.variants.length > 0 && (
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-muted-foreground">Manual voice variants</p>
                              {selectedVoice.critic?.overall_reason && <p className="max-w-[70%] truncate text-xs text-muted-foreground" title={selectedVoice.critic.overall_reason}>{selectedVoice.critic.overall_reason}</p>}
                            </div>
                            <div className="grid gap-2 xl:grid-cols-3">
                              {selectedVoice.variants.map((variant) => {
                                const score = selectedVoiceScores.find((item) => item.kind === variant.kind);
                                const selected = selectedVoice.selected_variant === variant.kind;
                                return (
                                  <div key={variant.kind || variant.label} className={`rounded-md border bg-muted/20 p-3 ${selected ? 'border-primary/60' : ''}`}>
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                      <Badge variant={selected ? 'default' : 'outline'}>{variant.label || variant.kind?.replaceAll('_', ' ')}</Badge>
                                      <Badge variant="outline">{variant.language_choice === 'english' ? 'News + P.S.' : 'خبر + پ.ن'}</Badge>
                                      {typeof score?.voice_match === 'number' && <Badge variant="outline">Voice {score.voice_match}</Badge>}
                                      {typeof score?.platform_risk === 'number' && <Badge className={score.platform_risk >= 70 ? toneClass('bad') : score.platform_risk >= 35 ? toneClass('warn') : toneClass('good')}>Risk {score.platform_risk}</Badge>}
                                    </div>
                                    <p dir="auto" className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 text-sm">{variant.final_x_text}</p>
                                    <p className="mt-2 text-xs text-muted-foreground">{variant.voice_rationale}</p>
                                    {score?.rationale && <p className="mt-1 text-xs text-muted-foreground">{score.rationale}</p>}
                                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                      {typeof score?.too_ai === 'number' && <span>AI {score.too_ai}</span>}
                                      {typeof score?.too_soft === 'number' && <span>Soft {score.too_soft}</span>}
                                      {typeof score?.too_newsy === 'number' && <span>Newsy {score.too_newsy}</span>}
                                      {typeof score?.too_long === 'number' && <span>Long {score.too_long}</span>}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant={selected ? 'secondary' : 'outline'}
                                      className="mt-2 w-full"
                                      onClick={() => handleSelectEnrichmentVariant(selectedEntry, variant.kind || 'raw_masihh')}
                                      disabled={selected || feedbackLoading === `${selectedEntry.tweet_id}:variant:${variant.kind}`}
                                    >
                                      {selected ? 'Selected' : 'Use this preview'}
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {selectedEntry.creator_angle && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Creator angle</p>
                            <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{selectedEntry.creator_angle}</p>
                          </div>
                        )}
                        {selectedEntry.why_it_matters && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Why it matters</p>
                            <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{selectedEntry.why_it_matters}</p>
                          </div>
                        )}
                        {selectedEntry.final_x_text && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Final X preview</p>
                            <p dir="auto" className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2">{selectedEntry.final_x_text}</p>
                          </div>
                        )}
                        {!selectedEntry.final_x_text && selectedEntry.composed_post_text && <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{selectedEntry.composed_post_text}</p>}
                        {selectedEntry.algorithm_signal_scores && (
                          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                            {Object.entries(selectedEntry.algorithm_signal_scores).map(([key, value]) => (
                              <div key={key} className="rounded-md border bg-muted/20 p-2">
                                <p className="text-muted-foreground">{key.replaceAll('_', ' ')}</p>
                                <p className="font-semibold">{value}/5</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {selectedEntry.source_context?.sources && selectedEntry.source_context.sources.length > 0 && (
                          <p className="text-xs text-muted-foreground">Sources checked: {selectedEntry.source_context.sources.slice(0, 3).join(' | ')}</p>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button size="sm" onClick={() => setPendingAction({ type: 'approve_enrichment', entry: selectedEntry })} disabled={selectedEntry.enrich_status === 'approved'}>
                            <Check className="w-3 h-3 mr-1.5" />Approve for X
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setPendingAction({ type: 'reject_enrichment', entry: selectedEntry })} disabled={selectedEntry.enrich_status === 'rejected'}>
                            <Ban className="w-3 h-3 mr-1.5" />Reject
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {([
                            ['sounds_like_me', 'Sounds like me'],
                            ['too_soft', 'Too soft'],
                            ['too_ai', 'Too AI'],
                            ['too_newsy', 'Too newsy'],
                            ['not_blunt_enough', 'Not blunt enough'],
                            ['too_long', 'Too long'],
                            ['good_clapback', 'Good clapback'],
                            ['strong_angle', 'Strong angle'],
                            ['too_risky', 'Too risky'],
                          ] as const).map(([value, label]) => (
                            <Button key={value} size="sm" variant="outline" onClick={() => handleEnrichmentFeedback(selectedEntry, value)} disabled={feedbackLoading === `${selectedEntry.tweet_id}:enrich:${value}`}>
                              {label}
                            </Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Delivery timeline</CardTitle>
                <p className="text-xs text-muted-foreground">
                  External delivery states first, then internal pipeline work.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedEntry && (
                  <div className="grid gap-2">
                    {timelineDeliverySummary.map((item) => {
                      const relative = relativeTimestamp(item.rawTimestamp);
                      return (
                        <div key={item.platform} className="rounded-lg border bg-muted/20 p-3">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${toneClass(item.tone)}`}>
                                {timelineIcon(item.platform, "h-4 w-4")}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{item.platform}</p>
                                <p className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
                              </div>
                            </div>
                            <Badge className={`${toneClass(item.tone)} shrink-0`}>{item.label}</Badge>
                          </div>
                          {item.timestamp ? (
                            <div className="mt-3 rounded-md border bg-background/40 px-2 py-1.5">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {item.timestampLabel}
                              </p>
                              <time dateTime={item.rawTimestamp ?? undefined} className="block text-xs font-medium">
                                {item.timestamp}
                              </time>
                              {relative && <p className="text-[11px] text-muted-foreground">{relative}</p>}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">No exact platform timestamp available.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline work</p>
                    {timelineGroups.length > 0 && (
                      <Badge variant="outline" className="text-[11px]">
                        {timeline.length} event{timeline.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  {timelineGroups.length === 0 ? (
                    <p className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
                      No pipeline events found
                    </p>
                  ) : (
                    <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[0.45rem] before:top-3 before:w-px before:bg-border">
                      {timelineGroups.map((group) => {
                        const relative = relativeTimestamp(group.rawTimestamp);
                        const hasExpandedUpdates = group.events.length > 1;
                        return (
                          <div key={group.key} className="relative pl-5">
                            <span className={`absolute left-0 top-3 h-3 w-3 rounded-full border-2 bg-background ${group.statusTone === 'good' ? 'border-emerald-500' : group.statusTone === 'bad' ? 'border-destructive' : group.statusTone === 'warn' ? 'border-amber-500' : group.statusTone === 'info' ? 'border-blue-500' : 'border-muted-foreground'}`} />
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass(group.platformTone)}`}>
                                      {timelineIcon(group.platform, "h-3 w-3")}
                                      {group.platform}
                                    </span>
                                    <p className="text-sm font-semibold">{group.title}</p>
                                  </div>
                                  {group.detail && <p className="mt-1 text-xs text-muted-foreground">{group.detail}</p>}
                                </div>
                                <Badge className={`${toneClass(group.statusTone)} shrink-0`}>{group.statusLabel}</Badge>
                              </div>

                              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                                <div className="rounded-md border bg-background/40 px-2 py-1.5">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest update</p>
                                  <time dateTime={group.rawTimestamp ?? undefined} className="block font-medium">
                                    {group.timestamp}
                                  </time>
                                  {relative && <p className="text-[11px] text-muted-foreground">{relative}</p>}
                                </div>
                                <div className="rounded-md border bg-background/40 px-2 py-1.5">
                                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Run details</p>
                                  <p className="font-medium">
                                    {group.duration ? `${group.duration} total` : 'Duration not recorded'}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {group.updateCount} update{group.updateCount === 1 ? '' : 's'}
                                  </p>
                                  {group.timingBadges.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {group.timingBadges.map((badge) => (
                                        <span key={`${badge.label}-${badge.value}`} className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                          {badge.label} {badge.value}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {hasExpandedUpdates && (
                                <div className="mt-3 space-y-1.5 rounded-md border bg-background/35 p-2">
                                  {group.events.map((event, eventIndex) => (
                                    <div key={`${event.rawStep}-${event.statusLabel}-${event.rawTimestamp ?? eventIndex}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                                      <Badge variant="outline" className={toneClass(event.statusTone)}>{event.statusLabel}</Badge>
                                      <span className="font-mono text-muted-foreground">{event.rawStep}</span>
                                      <span className="text-muted-foreground">{event.timestamp}</span>
                                      {event.duration && <span className="text-muted-foreground">({event.duration})</span>}
                                      {event.timingBadges.map((badge) => (
                                        <span key={`${badge.label}-${badge.value}`} className="rounded border border-border/70 px-1 py-0.5 text-muted-foreground">
                                          {badge.label} {badge.value}
                                        </span>
                                      ))}
                                      {event.errorTitle && <span className="text-destructive">{event.errorTitle}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {!hasExpandedUpdates && group.events[0]?.errorTitle && (
                                <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                                  <p className="font-medium">{group.events[0].errorTitle}</p>
                                  {group.events[0].errorDetail && <p className="mt-1 line-clamp-3">{group.events[0].errorDetail}</p>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <DrawerFooter className="border-t bg-background/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:px-4">
            <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Dialog open={!!manualEntry} onOpenChange={(open) => !open && setManualEntry(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>Set manual score</DialogTitle>
            <DialogDescription>
              Saves feedback, locks the score, and auto-advances passing items through translation and normal delivery gates.
            </DialogDescription>
          </DialogHeader>
          {manualEntry && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="font-medium">{manualEntry.author_handle ? `@${manualEntry.author_handle}` : manualEntry.tweet_id}</p>
                <p className="mt-1 line-clamp-3 text-muted-foreground">{shortText(manualEntry)}</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manual-score">Score</Label>
                <Input
                  id="manual-score"
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={manualScore}
                  onChange={(e) => setManualScore(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Threshold is {deliverThreshold}. This score will {Number(manualScore) >= deliverThreshold ? 'pass' : 'skip'} if saved.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manual-reason">Reason</Label>
                <Textarea
                  id="manual-reason"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="Why this score is right"
                />
              </div>
              <div className="grid gap-2">
                <Label>Audience class feedback</Label>
                <ThemedSelect value={manualAudienceClass || 'none'} onValueChange={(value) => setManualAudienceClass(value === 'none' ? '' : value as AudienceClassValue)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No class label</SelectItem>
                    <SelectItem value="direct_focus">Direct focus</SelectItem>
                    <SelectItem value="adjacent">Adjacent</SelectItem>
                    <SelectItem value="global_exception">Global exception</SelectItem>
                    <SelectItem value="off_topic">Off topic</SelectItem>
                  </SelectContent>
                </ThemedSelect>
                <p className="text-xs text-muted-foreground">Optional label for the learning set. It does not bypass Duplicate Gate, X limits, or X posting settings.</p>
              </div>
              {manualEntry.dup_of_tweet_id && (
                <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  <Checkbox
                    checked={manualOverrideDuplicate}
                    onCheckedChange={(checked) => setManualOverrideDuplicate(checked === true)}
                  />
                  <span>
                    <span className="block font-medium">Override duplicate block</span>
                    <span className="block text-xs text-muted-foreground">If checked, this clears the duplicate relation and allows a passing manual score to advance.</span>
                  </span>
                </label>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0 [&>button]:w-full sm:[&>button]:w-auto">
            <Button variant="outline" onClick={() => setManualEntry(null)} disabled={manualLoading}>Cancel</Button>
            <Button onClick={handleManualSubmit} disabled={manualLoading}>
              {manualLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save score
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-lg p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionTitle(pendingAction)}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionDescription(pendingAction)}
              {pendingAction?.entry && (
                <span className="mt-2 block rounded-md bg-muted p-3 text-xs text-foreground">
                  {pendingAction.entry.author_handle ? `@${pendingAction.entry.author_handle}` : pendingAction.entry.tweet_id}
                  {' · '}
                  {shortText(pendingAction.entry).slice(0, 180)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0 [&>button]:w-full sm:[&>button]:w-auto">
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
