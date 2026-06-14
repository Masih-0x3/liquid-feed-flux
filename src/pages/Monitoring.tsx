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
import { MonitoringActionDialog } from "@/components/monitoring/MonitoringActionDialog";
import { MonitoringDetailDrawer } from "@/components/monitoring/MonitoringDetailDrawer";
import { MonitoringFilters } from "@/components/monitoring/MonitoringFilters";
import { MonitoringQueueCards } from "@/components/monitoring/MonitoringQueueCards";
import { MonitoringMobileCard, MonitoringTableEntryRows } from "@/components/monitoring/MonitoringRow";
import {
  decisionScore,
} from "@/lib/pipelineMessages";
import { loadedMonitoringCounts } from "@/lib/monitoringState";
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
  clusterMonitoringEntries,
  shortText,
  toneClass,
} from "@/lib/monitoringViewModel";
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

      <MonitoringDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tweetId={drawerTweetId}
        entry={selectedEntry}
        timeline={timeline}
        deliverThreshold={deliverThreshold}
        xPostingEnabled={xPostingEnabled}
        xDiagnostic={xDiagnostic}
        xDiagnosticLoading={xDiagnosticLoading}
        editingEntry={editingEntry}
        editedContent={editedContent}
        enrichingTweetIds={enrichingTweetIds}
        feedbackLoading={feedbackLoading}
        onInspectDuplicateMatch={inspectDuplicateMatch}
        onRequestAction={setPendingAction}
        onStartEditTranslation={(entry) => {
          setEditingEntry(entry.tweet_id);
          setEditedContent(entry.text_translated || entry.text_original);
        }}
        onEditedContentChange={setEditedContent}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => {
          setEditingEntry(null);
          setEditedContent('');
        }}
        onGenerateEnrichment={handleTestEnrich}
        onOpenManualScore={openManualScore}
        onScoreFeedback={handleFeedback}
        onEnrichmentFeedback={handleEnrichmentFeedback}
        onSelectEnrichmentVariant={handleSelectEnrichmentVariant}
      />

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
