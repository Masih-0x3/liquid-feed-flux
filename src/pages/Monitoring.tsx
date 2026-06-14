import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Ban,
  Check,
  ChevronRight,
  Clock,
  Film,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
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
  type MonitoringEntry,
  type MonitoringFilter,
  type PipelineEvent,
  type ScoreBucket,
} from "@/hooks/useMonitoringData";
import { MediaThumbnails } from "@/components/monitoring/MediaThumbnails";
import { MonitoringDeliveryTimeline } from "@/components/monitoring/MonitoringDeliveryTimeline";
import { MonitoringDuplicateGateCard } from "@/components/monitoring/MonitoringDuplicateGateCard";
import { MonitoringDuplicateMatch } from "@/components/monitoring/MonitoringDuplicateEvidence";
import { MonitoringActionDialog } from "@/components/monitoring/MonitoringActionDialog";
import { MonitoringFilters } from "@/components/monitoring/MonitoringFilters";
import { MonitoringQueueCards } from "@/components/monitoring/MonitoringQueueCards";
import { MonitoringMobileCard, MonitoringTableEntryRows } from "@/components/monitoring/MonitoringRow";
import { VideoRenderDetailPanel } from "@/components/video/VideoRenderDetailPanel";
import {
  decisionScore,
} from "@/lib/pipelineMessages";
import { loadedMonitoringCounts, monitoringStage } from "@/lib/monitoringState";
import {
  adminApproveEnrichment,
  adminCancelPendingJobs,
  adminClearDup,
  adminCloseStaleXPending,
  adminEditTranslation,
  adminEnrichPost,
  adminGetXPostingDiagnostic,
  adminHydratePost,
  adminIgnoreMonitoringItem,
  adminIgnoreMonitoringItems,
  adminRecordEnrichmentFeedback,
  adminRecordScoreFeedback,
  adminRejectEnrichment,
  adminReprocess,
  adminReprocessBatch,
  adminRescorePost,
  adminRetryStep,
  adminRetryXPost,
  adminRunDedupe,
  adminSelectEnrichmentVariant,
  adminSetManualScore,
  adminTranslatePost,
  type AudienceClassValue,
  type AudienceFeedback,
  type EnrichmentFeedback,
  type PendingAction,
  type PendingBulkAction,
  type ScoringFeedbackReasonTag,
} from "@/lib/monitoringActions";
import {
  FILTERS,
  audienceClassLabel,
  clusterMonitoringEntries,
  formatAge,
  formatBytes,
  formatScoringV2Score,
  shortText,
  toneClass,
} from "@/lib/monitoringViewModel";
import { duplicateCoverageClass, duplicateCoverageLabel } from "@/lib/monitoringDuplicateEvidence";
import { getScoringV2Snapshot, scoringV2DecisionLabel } from "@/lib/scoringV2Monitoring";
import { buildDeliverySummary, buildPipelineTimelineGroups } from "@/lib/timelineDisplay";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SCORING_REASON_TAGS: Array<{ value: ScoringFeedbackReasonTag; label: string }> = [
  { value: 'regional_escalation', label: 'Regional escalation' },
  { value: 'oil_shipping', label: 'Oil / shipping' },
  { value: 'leader_statement', label: 'Leader statement' },
  { value: 'global_mega_event', label: 'Global mega-event' },
  { value: 'direct_focus', label: 'Direct focus' },
  { value: 'adjacent_context', label: 'Adjacent context' },
  { value: 'should_skip', label: 'Should skip' },
  { value: 'wrong_class', label: 'Wrong class' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'stale', label: 'Stale' },
  { value: 'source_trust', label: 'Source trust' },
  { value: 'broad_global', label: 'Broad global' },
  { value: 'other', label: 'Other' },
];

function scoringReasonTagLabel(value: string | null | undefined): string {
  return SCORING_REASON_TAGS.find((tag) => tag.value === value)?.label ?? (value ? value.replaceAll('_', ' ') : 'None');
}

function scoringRuleLabel(value: string | null | undefined): string {
  switch (value) {
    case 'regional_escalation_auto':
      return 'Regional escalation auto';
    case 'global_mega_event_review':
      return 'Global mega-event review pilot';
    default:
      return value ? value.replaceAll('_', ' ') : 'No rule';
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
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
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState<MonitoringEntry | null>(null);
  const [manualScore, setManualScore] = useState('');
  const [manualReasonTag, setManualReasonTag] = useState<ScoringFeedbackReasonTag | ''>('');
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
  const [selectedTweetIds, setSelectedTweetIds] = useState<Set<string>>(() => new Set());
  const visibleTweetIds = useMemo(() => moderationEntries.map((entry) => entry.tweet_id), [moderationEntries]);
  const visibleTweetIdSet = useMemo(() => new Set(visibleTweetIds), [visibleTweetIds]);
  const selectedCount = selectedTweetIds.size;
  const selectedVisibleCount = [...selectedTweetIds].filter((id) => visibleTweetIdSet.has(id)).length;
  const isAllVisibleSelected = visibleTweetIds.length > 0 && selectedVisibleCount === visibleTweetIds.length;
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
  const selectedManualScoringFeedback = useMemo(() => {
    const event = timeline.find((item) => item.step === 'score_feedback' || item.meta?.source === 'manual_score' || item.meta?.source === 'score_feedback' || typeof item.meta?.reason_tag === 'string');
    const meta = event?.meta ?? {};
    const reasonTag = typeof meta.reason_tag === 'string' ? meta.reason_tag : null;
    const reason = typeof meta.reason === 'string' ? meta.reason : null;
    const feedback = typeof meta.feedback === 'string' ? meta.feedback : null;
    return reasonTag || reason || feedback ? { reasonTag, reason, feedback } : null;
  }, [timeline]);
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

  useEffect(() => {
    setSelectedTweetIds((prev) => {
      const next = new Set<string>();
      prev.forEach((tweetId) => {
        if (visibleTweetIdSet.has(tweetId)) {
          next.add(tweetId);
        }
      });
      return next;
    });
  }, [visibleTweetIdSet]);

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedTweetIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        visibleTweetIds.forEach((id) => next.add(id));
        return next;
      }
      visibleTweetIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const toggleSelect = (tweetId: string, checked: boolean) => {
    setSelectedTweetIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(tweetId);
      else next.delete(tweetId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedTweetIds(new Set());
  };

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
      const data = await adminEnrichPost(tweetId);
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to queue enrichment');
      const workerDispatch = data.worker_dispatch;
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
    setManualReasonTag('');
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
    if (!manualReasonTag) {
      toast({ title: 'Reason tag required', description: 'Choose why the manual score is being changed.', variant: 'destructive' });
      return;
    }
    setManualLoading(true);
    try {
      const result = await adminSetManualScore(manualEntry.tweet_id, score, manualReason, manualReasonTag, manualOverrideDuplicate, manualAudienceClass);
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
          const data = await adminCloseStaleXPending();
          toast({ title: 'Stale X pending closed', description: `${data?.closed ?? 0} row(s) marked skipped` });
          break;
        }
        case 'cancel_jobs': {
          const data = await adminCancelPendingJobs();
          toast({ title: 'Pending jobs canceled', description: `${data?.canceled ?? 0} job(s) marked failed.` });
          break;
        }
        case 'approve_enrichment':
          if (!entry) throw new Error('Missing post');
          await adminApproveEnrichment(entry.tweet_id);
          toast({ title: 'Enrichment approved for X', description: 'No Telegram or X post was triggered by approval.' });
          break;
        case 'reject_enrichment':
          if (!entry) throw new Error('Missing post');
          await adminRejectEnrichment(entry.tweet_id);
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

  const confirmBulkAction = async () => {
    if (!pendingBulkAction) return;
    const tweetIds = pendingBulkAction.tweetIds;
    setActionLoading(true);
    try {
      if (tweetIds.length === 0) {
        toast({ title: 'No posts selected', variant: 'destructive' });
        return;
      }
      if (pendingBulkAction.type === 'bulk_reprocess') {
        const data = await adminReprocessBatch(tweetIds);
        toast({
          title: 'Reprocess queued',
          description: `${data?.queued ?? data?.requested ?? tweetIds.length} post(s) queued`,
        });
      } else {
        const data = await adminIgnoreMonitoringItems(tweetIds);
        const missing = data?.missing?.length ?? 0;
        const closed = data?.closed;
        toast({
          title: 'Posts ignored',
          description: data?.ignored == null || data.ignored === tweetIds.length
            ? `Ignored ${data?.ignored ?? tweetIds.length} post(s)`
            : `Ignored ${data?.ignored ?? 0} post(s), ${missing} not found or unchanged`,
        });
        if (closed) {
          toast({
            title: 'Ignore summary',
            description: `Closed ${closed.x_deliveries ?? 0} X row(s), ${closed.deliveries ?? 0} delivery row(s), ${closed.jobs ?? 0} job(s).`,
          });
        }
      }
      if (drawerTweetId && tweetIds.includes(drawerTweetId)) {
        setDrawerOpen(false);
        setDrawerTweetId(null);
      }
      clearSelection();
      invalidate();
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
      setPendingBulkAction(null);
    }
  };

  const inspectDuplicateMatch = (tweetId: string) => {
    setFilter('all');
    setSearchTerm(tweetId);
    void openDetails(tweetId);
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
        {entry.has_media && (
          <DropdownMenuItem onClick={() => openDetails(entry.tweet_id)}>
            <Film className="w-3 h-3 mr-2" />Review video render
          </DropdownMenuItem>
        )}
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

  return (
    <div className="w-full space-y-3 p-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">X posting is off</p>
            <p className="text-muted-foreground">Manual X posting is disabled until it is enabled under <Link to="/settings#x-automation" className="text-primary underline">Settings</Link>.</p>
          </div>
        </div>
      )}

      <MonitoringQueueCards counts={counts} xSummary={xSummary} />

      <Card>
        <MonitoringFilters
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          filter={filter}
          onFilterChange={setFilter}
          scoreBucket={scoreBucket}
          onScoreBucketChange={setScoreBucket}
          selectedCount={selectedCount}
          visibleCount={visibleTweetIds.length}
          isAllVisibleSelected={isAllVisibleSelected}
          onToggleSelectAllVisible={() => toggleSelectAllVisible(!isAllVisibleSelected)}
          onBulkReprocess={() => setPendingBulkAction({ type: 'bulk_reprocess', tweetIds: [...selectedTweetIds] })}
          onBulkIgnore={() => setPendingBulkAction({ type: 'bulk_ignore', tweetIds: [...selectedTweetIds] })}
          onClearSelection={clearSelection}
        />
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
                {moderationEntries.map((entry) => (
                  <MonitoringMobileCard
                    key={entry.tweet_id}
                    entry={entry}
                    isSelected={selectedTweetIds.has(entry.tweet_id)}
                    deliverThreshold={deliverThreshold}
                    entryByTweetId={entryByTweetId}
                    expandedClusters={expandedClusters}
                    renderRowActions={renderRowActions}
                    onSelectChange={toggleSelect}
                    onOpenDetails={openDetails}
                    onOpenManualScore={openManualScore}
                    onToggleCluster={toggleCluster}
                    onInspectDuplicateMatch={inspectDuplicateMatch}
                    onRunDedupe={(targetEntry) => setPendingAction({ type: 'run_dedupe', entry: targetEntry })}
                    onClearDuplicate={(targetEntry) => setPendingAction({ type: 'clear_dup', entry: targetEntry })}
                  />
                ))}
              </div>

              <div className="hidden overflow-hidden lg:block">
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[3%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[28%]" />
                    <col className="w-[7%]" />
                    <col className="w-[7%]" />
                    <col className="w-[11%]" />
                    <col className="w-[18%]" />
                    <col className="w-[7%]" />
                    <col className="w-[3%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 text-center">
                        <Checkbox
                          checked={isAllVisibleSelected}
                          onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                          aria-label="Select all visible posts"
                        />
                      </TableHead>
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
                    {moderationEntries.map((entry) => (
                      <MonitoringTableEntryRows
                        key={entry.tweet_id}
                        entry={entry}
                        isSelected={selectedTweetIds.has(entry.tweet_id)}
                        deliverThreshold={deliverThreshold}
                        entryByTweetId={entryByTweetId}
                        expandedClusters={expandedClusters}
                        renderRowActions={renderRowActions}
                        onSelectChange={toggleSelect}
                        onOpenDetails={openDetails}
                        onOpenManualScore={openManualScore}
                        onToggleCluster={toggleCluster}
                        onInspectDuplicateMatch={inspectDuplicateMatch}
                        onRunDedupe={(targetEntry) => setPendingAction({ type: 'run_dedupe', entry: targetEntry })}
                        onClearDuplicate={(targetEntry) => setPendingAction({ type: 'clear_dup', entry: targetEntry })}
                      />
                    ))}
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
                          <MonitoringDuplicateMatch entry={selectedEntry} onInspectDuplicateMatch={inspectDuplicateMatch} />
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

                  <MonitoringDuplicateGateCard
                    entry={selectedEntry}
                    onRunDedupe={(entry) => setPendingAction({ type: 'run_dedupe', entry })}
                  />

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
                  {selectedEntry.has_media && (
                    <div className="mt-4">
                      <VideoRenderDetailPanel tweetId={selectedEntry.tweet_id} enabled={drawerOpen} compact />
                    </div>
                  )}

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
                      {(selectedScoringV2?.policy_rule_applied || selectedScoringV2?.policy_rule || selectedManualScoringFeedback) && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">V2 tuning</p>
                              <p className="text-sm font-medium">
                                {scoringRuleLabel(selectedScoringV2?.policy_rule_applied ?? selectedScoringV2?.policy_rule?.kind)}
                              </p>
                            </div>
                            {selectedManualScoringFeedback?.reasonTag && (
                              <Badge variant="outline">{scoringReasonTagLabel(selectedManualScoringFeedback.reasonTag)}</Badge>
                            )}
                          </div>
                          {selectedScoringV2?.policy_rule && (
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              <div className="rounded-md border bg-background/50 p-2">
                                <p className="text-xs text-muted-foreground">Original V2 decision</p>
                                <p className="font-medium">{scoringV2DecisionLabel(selectedScoringV2.policy_rule.original_decision)}</p>
                              </div>
                              <div className="rounded-md border bg-background/50 p-2">
                                <p className="text-xs text-muted-foreground">Final decision</p>
                                <p className="font-medium">{scoringV2DecisionLabel(selectedScoringV2.decision)}</p>
                              </div>
                              <div className="rounded-md border bg-background/50 p-2">
                                <p className="text-xs text-muted-foreground">Original threshold</p>
                                <p className="font-medium">{selectedScoringV2.policy_rule.original_threshold}</p>
                              </div>
                            </div>
                          )}
                          {selectedScoringV2?.policy_rule?.matched_terms?.length ? (
                            <p className="mt-2 rounded-md border bg-background/50 p-2 text-xs">
                              <span className="text-muted-foreground">Matched terms:</span> {selectedScoringV2.policy_rule.matched_terms.join(', ')}
                            </p>
                          ) : null}
                          {selectedScoringV2?.policy_rule?.reason && (
                            <p className="mt-2 text-xs text-muted-foreground">{selectedScoringV2.policy_rule.reason}</p>
                          )}
                          {selectedManualScoringFeedback && (
                            <div className="mt-2 rounded-md border bg-background/50 p-2 text-xs">
                              <p className="font-medium">Manual scoring feedback</p>
                              <p className="text-muted-foreground">
                                {selectedManualScoringFeedback.reasonTag ? scoringReasonTagLabel(selectedManualScoringFeedback.reasonTag) : 'No reason tag'}
                                {selectedManualScoringFeedback.feedback ? ` - ${selectedManualScoringFeedback.feedback.replaceAll('_', ' ')}` : ''}
                              </p>
                              {selectedManualScoringFeedback.reason && <p className="mt-1 text-muted-foreground">{selectedManualScoringFeedback.reason}</p>}
                            </div>
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
            <MonitoringDeliveryTimeline
              deliverySummary={timelineDeliverySummary}
              timelineGroups={timelineGroups}
              eventCount={timeline.length}
              showDeliverySummary={Boolean(selectedEntry)}
            />
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
                <Label>Reason tag</Label>
                <ThemedSelect value={manualReasonTag || 'none'} onValueChange={(value) => setManualReasonTag(value === 'none' ? '' : value as ScoringFeedbackReasonTag)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose a reason</SelectItem>
                    {SCORING_REASON_TAGS.map((tag) => (
                      <SelectItem key={tag.value} value={tag.value}>{tag.label}</SelectItem>
                    ))}
                  </SelectContent>
                </ThemedSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="manual-reason">Reason note</Label>
                <Textarea
                  id="manual-reason"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="Optional extra context"
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
            <Button onClick={handleManualSubmit} disabled={manualLoading || !manualReasonTag}>
              {manualLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save score
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MonitoringActionDialog
        pendingAction={pendingAction}
        pendingBulkAction={pendingBulkAction}
        actionLoading={actionLoading}
        onCancel={() => {
          setPendingAction(null);
          setPendingBulkAction(null);
        }}
        onConfirmAction={confirmAction}
        onConfirmBulkAction={confirmBulkAction}
      />
    </div>
  );
}
