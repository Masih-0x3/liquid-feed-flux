import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ThemedSelect, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Edit, Check, X, ExternalLink, RotateCcw, Star, Send, Scissors, Sparkles, Twitter, Ban, AlertCircle, Info, Clock, MoreHorizontal, Loader2, FlaskConical } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose, DrawerFooter } from "@/components/ui/drawer";
import { useMonitoringData, type MonitoringEntry, type MonitoringFilter, type PipelineEvent } from "@/hooks/useMonitoringData";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaThumbnails } from "@/components/monitoring/MediaThumbnails";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  decisionScore,
  formatDecisionReason,
  formatPipelineError,
  formatXBadge,
} from "@/lib/pipelineMessages";

// Admin action helpers
async function adminEditTranslation(tweetId: string, text: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'edit_translation', tweet_id: tweetId, text_translated: text } });
  if (error) throw error;
}
async function adminRetryStep(tweetId: string, step: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'retry_step', tweet_id: tweetId, step } });
  if (error) throw error;
}
async function adminReprocess(tweetId: string) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'reprocess', tweet_id: tweetId } });
  if (error) throw error;
}
async function adminBulkReprocess(tweetIds: string[]) {
  const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'bulk_reprocess', tweet_ids: tweetIds } });
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
  return data as { ok: boolean; error?: string; status?: string; x_tweet_id?: string };
}
async function adminClearDup(tweetId: string, relatedTweetId: string | null) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'clear_dup', tweet_id: tweetId, related_tweet_id: relatedTweetId } });
  if (error) throw error;
  return data as { success: boolean };
}

function StatusIndicator({ entry }: { entry: MonitoringEntry }) {
  const steps = [
    { label: 'Ingest', status: 'completed', error: '', completed: true },
    { label: 'Media', status: entry.is_translated ? 'completed' : 'pending', error: '', completed: false },
    { label: 'Translate', status: entry.translation_job_status, error: entry.translation_error, completed: entry.is_translated },
    { label: 'Deliver', status: entry.delivery_job_status, error: entry.delivery_error, completed: entry.is_delivered },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {steps.map((step, index) => {
          let statusColor = 'bg-muted-foreground/30';
          let textColor = 'text-muted-foreground';
          let icon = '\u25CF';
          if (step.completed) { statusColor = 'bg-success'; textColor = 'text-success'; icon = '\u2713'; }
          else if (step.status === 'running') { statusColor = 'bg-primary animate-pulse'; textColor = 'text-primary'; }
          else if (step.status === 'failed' || step.error) { statusColor = 'bg-destructive'; textColor = 'text-destructive'; icon = '\u2717'; }
          else if (step.status === 'pending') { statusColor = 'bg-warning'; textColor = 'text-warning'; }
          return (
            <div key={step.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${statusColor} flex items-center justify-center`}><span className="text-white text-xs font-bold">{icon}</span></div>
              <span className={`text-sm font-medium ${textColor}`}>{step.label}</span>
              {index < steps.length - 1 && <div className="w-8 h-0.5 bg-muted-foreground/20" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Single source of truth for "what's going on with this post and what to do".
// Surfaces skip reasons, threshold gap, and failure details inline so users
// don't have to hover badges or expand collapsed reasoning.
function DiagnosticStrip({ entry, threshold }: { entry: MonitoringEntry; threshold: number }) {
  const decision = decisionScore(entry);
  const isSkipped = entry.delivery_decision && entry.delivery_decision !== 'deliver';
  const hasError = !!(entry.translation_error || entry.delivery_error || entry.x_error);

  if (!isSkipped && !hasError) return null;

  const variant = hasError ? 'error' : 'skip';
  const wrapCls = variant === 'error'
    ? 'border-destructive/30 bg-destructive/5'
    : 'border-amber-500/30 bg-amber-500/5';
  const Icon = variant === 'error' ? AlertCircle : Info;
  const iconCls = variant === 'error' ? 'text-destructive' : 'text-amber-400';

  let headline = '';
  const details: { label: string; value: string }[] = [];

  if (variant === 'error') {
    headline = entry.translation_error
      ? 'Translation failed'
      : entry.delivery_error
      ? 'Telegram delivery failed'
      : 'X post failed';
    if (entry.translation_error) {
      const ft = formatPipelineError(entry.translation_error);
      details.push({ label: 'Translation', value: ft.title });
      if (ft.detail) details.push({ label: 'Technical', value: ft.detail });
    }
    if (entry.delivery_error) {
      const fd = formatPipelineError(entry.delivery_error);
      details.push({ label: 'Telegram', value: fd.title });
      if (fd.detail) details.push({ label: 'Technical', value: fd.detail });
    }
    if (entry.x_error) {
      const fx = formatPipelineError(entry.x_error);
      details.push({ label: 'X', value: fx.title });
      if (fx.detail) details.push({ label: 'Technical', value: fx.detail });
    }
  } else {
    const reason = entry.decision_reason;
    const fr = formatDecisionReason(reason);
    const isBelow = /below_threshold|threshold/i.test(reason || '');
    if (isBelow && decision != null) {
      const gap = (threshold - decision).toFixed(1).replace(/\.0$/, '');
      headline = `Skipped — score ${Number.isInteger(decision) ? decision : decision.toFixed(1)}/20 is ${gap} points below the ≥${threshold} threshold`;
      if (fr.detail) details.push({ label: 'Technical code', value: fr.detail });
    } else {
      headline = `Skipped — ${fr.title}`;
    }
    if (fr.detail && fr.detail !== reason && !details.some((d) => d.value === fr.detail)) {
      details.push({ label: 'Technical code', value: fr.detail });
    }
    if (entry.importance_reasoning) {
      details.push({ label: 'Model rationale', value: entry.importance_reasoning });
    }
  }

  return (
    <div className={`mb-4 rounded-lg border p-3 ${wrapCls}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconCls}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{headline}</p>
          {details.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {details.map((d, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground/80">{d.label}:</span>{' '}
                  <span className="break-words">{d.value}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Monitoring() {
  const [filter, setFilter] = useState<MonitoringFilter>("all");
  const { entries, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useMonitoringData(filter);
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set());
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTweetId, setDrawerTweetId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<PipelineEvent[]>([]);
  const { toast } = useToast();

  // Active editorial-profile threshold drives the deliver/skip gate.
  // We surface it in the UI so badges read in context (e.g. 13/20 vs threshold ≥14).
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
      const v = (data?.value as { enabled?: boolean } | null)?.enabled;
      return v === true;
    },
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['monitoring'] });

  const handleForceDeliver = async (tweetId: string) => {
    try {
      await adminRetryStep(tweetId, 'deliver');
      toast({ title: 'Force delivery queued', description: 'Post will be delivered shortly' });
      invalidate();
    } catch { toast({ title: 'Error', description: 'Failed to force deliver', variant: 'destructive' }); }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      await adminEditTranslation(editingEntry, editedContent);
      toast({ title: 'Success', description: 'Translation updated' });
      setEditingEntry(null); setEditedContent(''); invalidate();
    } catch { toast({ title: 'Error', description: 'Failed to update content', variant: 'destructive' }); }
  };

  const handleRetryTranslation = async (tweetId: string) => {
    try { await adminRetryStep(tweetId, 'translate'); toast({ title: 'Success', description: 'Translation job queued' }); invalidate(); }
    catch { toast({ title: 'Error', description: 'Failed to retry translation', variant: 'destructive' }); }
  };

  const handleReprocessTweet = async (tweetId: string) => {
    try { await adminReprocess(tweetId); toast({ title: 'Processing started', description: 'Tweet queued for full reprocessing' }); }
    catch { toast({ title: 'Error', description: 'Failed to reprocess tweet', variant: 'destructive' }); }
  };

  const handleRetryXPost = async (tweetId: string) => {
    if (!xPostingEnabled) {
      toast({
        title: 'X posting is off',
        description: 'Enable X posting under Settings → X Automation before posting to X.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await adminRetryXPost(tweetId);
      if (!res.ok) throw new Error(res.error || 'X retry failed');
      if (res.status === 'posted' && res.x_tweet_id) {
        toast({ title: 'Posted to X', description: `https://x.com/i/status/${res.x_tweet_id}` });
      } else if (res.status === 'failed') {
        toast({ title: 'X post failed', description: res.error ?? 'See Monitoring badge', variant: 'destructive' });
      } else {
        toast({ title: `X: ${res.status ?? 'queued'}`, description: 'Check Monitoring for status' });
      }
      invalidate();
    } catch (e) {
      toast({ title: 'X retry failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleApproveEnrichment = async (tweetId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'approve_enrichment', tweet_id: tweetId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to approve');
      toast({ title: 'Approved', description: 'Post approved and queued for delivery' });
      invalidate();
    } catch (e) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const handleRejectEnrichment = async (tweetId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'reject_enrichment', tweet_id: tweetId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to reject');
      toast({ title: 'Rejected', description: 'Post will not be posted to X' });
      invalidate();
    } catch (e) { toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }); }
  };

  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const pollRefs = useRef<Map<string, { interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> }>>(new Map());

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
    setEnrichingIds(prev => { const n = new Set(prev); n.delete(tweetId); return n; });
  };

  const handleTestEnrich = async (tweetId: string) => {
    try {
      setEnrichingIds(prev => new Set(prev).add(tweetId));
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'enrich_post', tweet_id: tweetId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Failed to queue enrichment');
      toast({ title: 'Enrichment queued', description: 'Pipeline running -- results will appear shortly.' });

      const interval = setInterval(async () => {
        const { data: post } = await supabase
          .from('posts')
          .select('enrich_status')
          .eq('tweet_id', tweetId)
          .single();
        if (post && post.enrich_status !== 'pending') {
          cleanupPoll(tweetId);
          invalidate();
          toast({ title: 'Enrichment complete', description: `Status: ${post.enrich_status}` });
        }
      }, 3000);

      const timeout = setTimeout(() => { cleanupPoll(tweetId); }, 120_000);

      pollRefs.current.set(tweetId, { interval, timeout });
    } catch (e) {
      cleanupPoll(tweetId);
      toast({ title: 'Enrich failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleClearDup = async (tweetId: string, relatedTweetId: string | null) => {
    try {
      await adminClearDup(tweetId, relatedTweetId);
      toast({ title: 'Duplicate cleared', description: 'Post will be re-evaluated for delivery' });
      invalidate();
    } catch { toast({ title: 'Error', description: 'Failed to clear duplicate', variant: 'destructive' }); }
  };

  const handleRescorePost = async (tweetId: string) => {
    try {
      const res = await adminRescorePost(tweetId);
      if (!res.ok) throw new Error(res.error || 'Re-score failed');
      const display = res.final_score ?? res.score;
      toast({
        title: `New score: ${display ?? '—'}/20`,
        description: `Decision: ${res.decision}${res.reasoning ? ` — ${res.reasoning.slice(0, 120)}` : ''}`,
      });
      invalidate();
    } catch (e) {
      toast({ title: 'Re-score failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleReprocessSelected = async () => {
    if (selectedTweets.size === 0) { toast({ title: 'No Selection', description: 'Please select tweets to reprocess', variant: 'destructive' }); return; }
    setIsReprocessing(true);
    try { await adminBulkReprocess(Array.from(selectedTweets)); toast({ title: 'Success', description: `${selectedTweets.size} tweets queued for reprocessing` }); setSelectedTweets(new Set()); invalidate(); }
    catch { toast({ title: 'Error', description: 'Failed to reprocess selected tweets', variant: 'destructive' }); }
    finally { setIsReprocessing(false); }
  };

  const handleSelectTweet = (tweetId: string, checked: boolean) => {
    const updated = new Set(selectedTweets);
    if (checked) {
      updated.add(tweetId);
    } else {
      updated.delete(tweetId);
    }
    setSelectedTweets(updated);
  };

  const filteredEntries = searchTerm
    ? entries.filter((e: MonitoringEntry) =>
        e.text_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.account_handle.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : entries;

  const totalPosts = entries.length;
  const translatedPosts = entries.filter(e => e.is_translated).length;
  const deliveredPosts = entries.filter(e => e.is_delivered).length;
  const needsTranslation = entries.filter(e => !e.is_translated).length;

  const openDetails = async (tweetId: string) => {
    setDrawerTweetId(tweetId); setDrawerOpen(true);
    try {
      const { data, error } = await supabase.from('pipeline_events').select('subject_type, subject_id, step, status, started_at, ended_at, error, meta').eq('subject_type', 'post').eq('subject_id', tweetId).order('started_at', { ascending: false });
      if (error) throw error;
      setTimeline((data as PipelineEvent[]) || []);
    } catch { setTimeline([]); }
  };

  const retryStep = async (tweetId: string, step: string) => {
    try { await adminRetryStep(tweetId, step); toast({ title: 'Retry queued', description: `${step} retry scheduled` }); }
    catch { toast({ title: 'Retry failed', variant: 'destructive' }); }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]"><RefreshCw className="w-8 h-8 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Content Monitoring</h1>
          <p className="text-muted-foreground">English → Persian translation pipeline • Live updates enabled</p>
        </div>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive hover:text-destructive">
                <Ban className="w-4 h-4 mr-2" />Cancel Pending Jobs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel all pending jobs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This marks every <strong>pending</strong> and <strong>running</strong> job as failed so the worker stops processing them automatically. Already-failed jobs are not affected. You can still manually reprocess any post afterward.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep them</AlertDialogCancel>
                <AlertDialogAction onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'cancel_pending_jobs' } });
                    if (error) throw error;
                    const d = data as { canceled?: number };
                    toast({ title: 'Pending jobs canceled', description: `${d?.canceled ?? 0} job(s) marked failed.` });
                    invalidate();
                  } catch (e) {
                    toast({ title: 'Error', description: (e as Error).message || 'Failed to cancel jobs', variant: 'destructive' });
                  }
                }}>Cancel jobs</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={invalidate} variant="outline"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </div>
      </div>

      {!xPostingEnabled && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">X posting is turned off</p>
            <p className="text-muted-foreground mt-1">
              The x-poster job will not run while this is off, and “Force on X” is disabled. Enable it under{' '}
              <Link to="/settings#x-automation" className="text-primary underline">Settings → X Automation</Link>{' '}
              when you are ready to publish again. Telegram and translation are unaffected.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold">{totalPosts}</p><p className="text-sm text-muted-foreground">Total Posts</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-success">{translatedPosts}</p><p className="text-sm text-muted-foreground">Translated</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-primary">{deliveredPosts}</p><p className="text-sm text-muted-foreground">Delivered</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-warning">{needsTranslation}</p><p className="text-sm text-muted-foreground">Needs Translation</p>
          {needsTranslation > 0 && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => entries.filter((e: MonitoringEntry) => !e.is_translated).forEach((e: MonitoringEntry) => handleRetryTranslation(e.tweet_id))}>Retry All</Button>
          )}
        </div></CardContent></Card>
      </div>

      {/* Search and Bulk Actions */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input placeholder="Search content..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
            <div className="flex items-center gap-4">
              <div className="w-48">
                <ThemedSelect value={filter} onValueChange={(v) => setFilter(v as MonitoringFilter)}>
                  <SelectTrigger className="bg-card text-foreground border-border"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent className="bg-popover text-popover-foreground border-border">
                    <SelectGroup><SelectLabel>Filter</SelectLabel>
                      <SelectItem value="all">All posts</SelectItem>
                      <SelectItem value="recently-delivered">Delivered</SelectItem>
                      <SelectItem value="delivery-pending">Pending delivery</SelectItem>
                      <SelectItem value="needs-translation">Needs translation</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="awaiting-review">Awaiting Review</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </ThemedSelect>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="select-all" checked={filteredEntries.length > 0 && selectedTweets.size === filteredEntries.length} onCheckedChange={(c) => setSelectedTweets(c ? new Set(filteredEntries.map(e => e.tweet_id)) : new Set())} />
                <label htmlFor="select-all" className="text-sm font-medium">Select All ({filteredEntries.length})</label>
              </div>
              {selectedTweets.size > 0 && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{selectedTweets.size} selected</Badge>
                  <Button onClick={handleReprocessSelected} disabled={isReprocessing} variant="outline" size="sm">
                    <RotateCcw className="w-4 h-4 mr-2" />{isReprocessing ? 'Processing...' : 'Reprocess Selected'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entries */}
      <div className="space-y-4">
        {filteredEntries.length === 0 ? (
          <Card><CardContent className="p-8 text-center"><p className="text-muted-foreground">No entries found</p></CardContent></Card>
        ) : filteredEntries.map(entry => {
          const isEditing = editingEntry === entry.tweet_id;
          const isSelected = selectedTweets.has(entry.tweet_id);
          return (
            <Card key={entry.tweet_id} className={isSelected ? 'ring-2 ring-primary' : ''}>
              <CardHeader className="pb-2 space-y-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <Checkbox checked={isSelected} onCheckedChange={(c) => handleSelectTweet(entry.tweet_id, c as boolean)} className="mt-1" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <CardTitle className="text-lg">
                          {entry.author_handle ? `@${entry.author_handle}` : `@${entry.account_handle}`}
                        </CardTitle>
                        {(() => {
                          const decision = decisionScore(entry);
                          const passes = decision != null && decision >= deliverThreshold;
                          const close = decision != null && decision >= deliverThreshold - 3;
                          const axesStr = entry.score_axes
                            ? Object.entries(entry.score_axes).map(([k, v]) => `${k}:${v}`).join(', ')
                            : null;
                          const showDelta = entry.importance_score != null
                            && entry.final_score != null
                            && Math.round(entry.importance_score) !== Math.round(entry.final_score);
                          return (
                            <>
                              {decision != null && (
                                <span className="inline-flex items-center gap-1">
                                  <Badge
                                    className={
                                      passes
                                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                        : close
                                        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                                        : 'bg-red-500/20 text-red-400 border-red-500/30'
                                    }
                                    title={
                                      `Decision score: ${decision}/20\n` +
                                      `Threshold to deliver: ≥${deliverThreshold}\n` +
                                      (axesStr ? `Axes — ${axesStr}\n` : '') +
                                      (entry.score_breakdown
                                        ? `--- Breakdown ---\n` +
                                          `AI base: ${entry.score_breakdown.ai ?? '—'}\n` +
                                          (entry.score_breakdown.author_bias ? `Author bias: ${entry.score_breakdown.author_bias > 0 ? '+' : ''}${entry.score_breakdown.author_bias}\n` : '') +
                                          (entry.score_breakdown.tag_bias ? `Tag bias: ${entry.score_breakdown.tag_bias > 0 ? '+' : ''}${entry.score_breakdown.tag_bias}\n` : '') +
                                          (entry.score_breakdown.knn_prior ? `Similar posts you labeled: ${entry.score_breakdown.knn_prior > 0 ? '+' : ''}${entry.score_breakdown.knn_prior}\n` : '') +
                                          `Final: ${entry.score_breakdown.final ?? decision}`
                                        : '')
                                    }
                                  >
                                    <Star className="w-3 h-3 mr-1" />
                                    {Number.isInteger(decision) ? decision : decision.toFixed(1)}/20
                                    <span className="ml-1 opacity-60">· need ≥{deliverThreshold}</span>
                                  </Badge>
                                  <button
                                    className="text-[10px] text-primary hover:text-primary/80 underline underline-offset-2 cursor-pointer whitespace-nowrap"
                                    onClick={(e) => { e.stopPropagation(); handleRescorePost(entry.tweet_id); }}
                                    title="Ask AI to re-evaluate this post's importance score (disputes are recorded as feedback)"
                                  >
                                    Dispute score
                                  </button>
                                </span>
                              )}
                              {showDelta && (
                                <span className="text-xs text-muted-foreground">
                                  Editorial {Number.isInteger(entry.final_score!) ? entry.final_score : entry.final_score!.toFixed(1)}
                                  {' · '}
                                  model {entry.importance_score}
                                </span>
                              )}
                              {entry.dup_of_tweet_id && (
                                <span className="inline-flex items-center gap-1">
                                  <Badge
                                    className="bg-purple-500/20 text-purple-300 border-purple-500/30"
                                    title={`dup_of ${entry.dup_of_tweet_id}${entry.dup_similarity != null ? ` · cosine ${entry.dup_similarity.toFixed(3)}` : ''}`}
                                  >
                                    dup{entry.dup_similarity != null ? ` ${entry.dup_similarity.toFixed(2)}` : ''}
                                  </Badge>
                                  <button
                                    className="text-[10px] text-purple-400 hover:text-purple-200 underline underline-offset-2 cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); handleClearDup(entry.tweet_id, entry.dup_of_tweet_id); }}
                                    title="Mark as not a duplicate — clears dup status and blocklists this pair"
                                  >
                                    Not a dup
                                  </button>
                                </span>
                              )}
                              {entry.feedback_locked && (
                                <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30" title="You force-delivered or force-posted this — dedup will not auto-skip it">
                                  Locked
                                </Badge>
                              )}
                              {entry.hydration_source === 'x_api' && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                  <Sparkles className="w-3 h-3 mr-1" />Hydrated
                                </Badge>
                              )}
                              {entry.is_truncated && !entry.hydrated_at && (
                                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30" title="Full text may be fetched from X before posting; X can defer until media and text are ready.">
                                  <Scissors className="w-3 h-3 mr-1" />Truncated
                                </Badge>
                              )}
                              {entry.hydrated_at && entry.hydration_source && entry.hydration_source !== 'x_api' && (
                                <Badge variant="outline" className="text-muted-foreground" title={entry.hydration_source}>
                                  <Scissors className="w-3 h-3 mr-1" />Truncated (fallback)
                                </Badge>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span>{format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm')}</span>
                        {entry.url && (
                          <>
                            <span aria-hidden>·</span>
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                              Source <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <Link to="/settings#filter" className="text-primary hover:underline text-xs">
                          How scoring works
                        </Link>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    <Badge variant={entry.is_translated && entry.text_translated ? 'default' : 'secondary'}>
                      {entry.is_translated && entry.text_translated ? 'Translated' : !entry.is_translated ? 'Original' : 'Translation Missing'}
                    </Badge>
                    <Badge variant={entry.is_delivered ? 'default' : 'outline'}>{entry.is_delivered ? 'Delivered' : 'Pending'}</Badge>
                    {(() => {
                      const xs = entry.x_status;
                      if (!xs) return <Badge variant="outline" className="text-muted-foreground"><Twitter className="w-3 h-3 mr-1" />X: —</Badge>;
                      const { label, title } = formatXBadge(entry);
                      const cls =
                        xs === 'posted' ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : xs === 'failed' ? 'bg-destructive/20 text-destructive border-destructive/30'
                        : xs === 'skipped' ? 'bg-muted text-muted-foreground border-border'
                        : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
                      const inner = (
                        <Badge className={cls} title={title}>
                          <Twitter className="w-3 h-3 mr-1" />{label}
                        </Badge>
                      );
                      return xs === 'posted' && entry.x_tweet_id ? (
                        <a href={`https://x.com/i/status/${entry.x_tweet_id}`} target="_blank" rel="noopener noreferrer">{inner}</a>
                      ) : inner;
                    })()}
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleForceDeliver(entry.tweet_id)}
                      title={entry.is_delivered ? 'Re-deliver to Telegram (overrides previous delivery)' : 'Force delivery to Telegram'}
                    >
                      <Send className="w-3 h-3 mr-1" />{entry.is_delivered ? 'Re-deliver' : 'Force Deliver'}
                    </Button>
                    <Button
                      size="sm"
                      variant={xPostingEnabled ? 'default' : 'outline'}
                      disabled={!xPostingEnabled}
                      onClick={() => handleRetryXPost(entry.tweet_id)}
                      className={!xPostingEnabled ? 'opacity-50 line-through' : ''}
                      title={
                        !xPostingEnabled
                          ? 'X posting is OFF — enable it in Settings → X Automation'
                          : entry.x_status === 'posted'
                            ? 'Re-post to X (overrides previous post)'
                            : 'Force post to X'
                      }
                    >
                      <Twitter className="w-3 h-3 mr-1" />
                      {!xPostingEnabled ? 'X is OFF' : entry.x_status === 'posted' ? 'Re-post on X' : 'Force on X'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline</p>
                  <StatusIndicator entry={entry} />
                </div>

                <DiagnosticStrip entry={entry} threshold={deliverThreshold} />

                {entry.importance_tags && entry.importance_tags.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {entry.importance_tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs font-normal text-muted-foreground px-2 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <MediaThumbnails tweetId={entry.tweet_id} />

                <div>
                  <h4 className="mb-2 text-sm font-medium text-muted-foreground">English</h4>
                  <p className="rounded-md border bg-muted/50 p-3 text-sm">{entry.text_original || '[No content]'}</p>
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Persian</h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline"><MoreHorizontal className="w-3 h-3 mr-1" />More</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleReprocessTweet(entry.tweet_id)}>
                            <RotateCcw className="w-3 h-3 mr-2" />Reprocess
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleRescorePost(entry.tweet_id)}>
                            <Star className="w-3 h-3 mr-2" />Re-score
                          </DropdownMenuItem>
                          {!entry.is_translated && (
                            <DropdownMenuItem onClick={() => handleRetryTranslation(entry.tweet_id)}>Queue translation</DropdownMenuItem>
                          )}
                          {!isEditing && (
                            <DropdownMenuItem onClick={() => { setEditingEntry(entry.tweet_id); setEditedContent(entry.text_translated || entry.text_original); }}>
                              <Edit className="w-3 h-3 mr-2" />Edit translation
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openDetails(entry.tweet_id)}>Pipeline details</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="space-y-3">
                      <Textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)} className="min-h-[100px]" placeholder="Enter Persian translation..." />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveEdit}><Check className="w-3 h-3 mr-1" />Save</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingEntry(null); setEditedContent(''); }}><X className="w-3 h-3 mr-1" />Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className={`rounded-md border p-4 text-sm leading-relaxed break-words ${!entry.text_translated ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-card text-foreground'}`}>
                      {entry.text_translated ? (
                        <div className="whitespace-pre-wrap" dir="rtl">{entry.text_translated}</div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span>{entry.is_translated ? '[Translation completed but text is empty — retry]' : '[Not translated yet]'}</span>
                          <Button size="sm" variant="outline" onClick={() => handleRetryTranslation(entry.tweet_id)}>
                            <RotateCcw className="w-3 h-3 mr-1" />Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Test Enrich Button */}
                {entry.text_translated && (
                  <div className="flex items-center gap-2 border-t border-border pt-2 mt-2">
                    {enrichingIds.has(entry.tweet_id) ? (
                      <Button size="sm" variant="outline" disabled className="text-xs">
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Enriching...
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => handleTestEnrich(entry.tweet_id)}
                      >
                        <FlaskConical className="w-3 h-3 mr-1.5" />
                        {entry.enrich_status && entry.enrich_status !== 'pending' && entry.enrich_status !== 'skipped' ? 'Re-Enrich' : 'Test Enrich'}
                      </Button>
                    )}
                    {entry.enrich_status && entry.enrich_status !== 'pending' && entry.enrich_status !== 'skipped' && (
                      <span className="text-[10px] text-muted-foreground">Last run: {entry.enrich_status}</span>
                    )}
                  </div>
                )}

                {/* Enrichment Section */}
                {entry.enrich_status && entry.enrich_status !== 'skipped' && entry.enrich_status !== 'pending' && (
                  <details className="text-xs border-t border-border pt-2 mt-2">
                    <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground flex items-center gap-2">
                      <Sparkles className="w-3 h-3" />
                      Enrichment
                      <Badge variant={entry.enrich_status === 'completed' || entry.enrich_status === 'approved' ? 'default' : entry.enrich_status === 'awaiting_approval' ? 'secondary' : 'destructive'} className="text-[10px] px-1.5 py-0">
                        {entry.enrich_status}
                      </Badge>
                      {entry.enrich_tokens && <span className="text-muted-foreground">({entry.enrich_tokens} tokens, {((entry.enrich_duration_ms ?? 0) / 1000).toFixed(1)}s)</span>}
                    </summary>
                    <div className="mt-2 space-y-2">
                      {entry.narrative_callback && (
                        <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-2">
                          <p className="text-[10px] font-medium text-blue-400 mb-1">Narrative Callback</p>
                          <p className="text-sm" dir="rtl">{entry.narrative_callback}</p>
                        </div>
                      )}
                      {entry.background_context?.background_summary && (
                        <div className="rounded-md border border-border bg-muted/30 p-2">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">Research</p>
                          <p className="text-sm">{entry.background_context.background_summary}</p>
                          {entry.background_context.key_facts && entry.background_context.key_facts.length > 0 && (
                            <ul className="list-disc list-inside text-xs text-muted-foreground mt-1">
                              {entry.background_context.key_facts.map((f, i) => <li key={i}>{f}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                      {entry.editorial_commentary && (
                        <div className="rounded-md border border-border bg-muted/30 p-2">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">Raw Commentary vs Humanized</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="text-sm opacity-60 line-through" dir="rtl">{entry.editorial_commentary}</div>
                            <div className="text-sm font-medium" dir="rtl">{entry.humanized_commentary || entry.editorial_commentary}</div>
                          </div>
                        </div>
                      )}
                      {entry.composed_post_text && (
                        <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2">
                          <p className="text-[10px] font-medium text-green-400 mb-1">
                            Final Post {entry.post_format_hint && <span className="opacity-60">({entry.post_format_hint})</span>}
                          </p>
                          <p className="text-sm font-medium" dir="rtl">{entry.composed_post_text}</p>
                        </div>
                      )}
                      {entry.enrich_status === 'awaiting_approval' && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => handleApproveEnrichment(entry.tweet_id)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleRejectEnrichment(entry.tweet_id)}>
                            Skip
                          </Button>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {entry.importance_reasoning && (
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                      {entry.final_score != null
                        && entry.importance_score != null
                        && Math.round(entry.importance_score) !== Math.round(entry.final_score)
                        ? `Model rationale (legacy AI score: ${entry.importance_score}/20)`
                        : `Why this score? (${decisionScore(entry) ?? entry.importance_score ?? '—'}/20)`}
                    </summary>
                    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 whitespace-pre-wrap leading-relaxed text-foreground">
                      {entry.importance_reasoning}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
        {hasNextPage && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Loading...</> : 'Load More'}
            </Button>
          </div>
        )}
      </div>

      {/* Timeline Drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Pipeline Timeline</DrawerTitle>
            <DrawerDescription>Events for {drawerTweetId}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 max-h-96 overflow-y-auto space-y-2">
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No pipeline events found</p>
            ) : timeline.map((evt, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                <div className={`w-2 h-2 rounded-full mt-2 ${evt.status === 'completed' ? 'bg-success' : evt.status === 'failed' ? 'bg-destructive' : 'bg-warning'}`} />
                <div className="flex-1">
                  <div className="flex justify-between"><span className="text-sm font-medium">{evt.step}</span><Badge variant="outline" className="text-xs">{evt.status}</Badge></div>
                  {evt.started_at && <p className="text-xs text-muted-foreground">{new Date(evt.started_at).toLocaleString()}</p>}
                  {evt.error && <p className="text-xs text-destructive mt-1">{evt.error}</p>}
                </div>
                {evt.status === 'failed' && <Button size="sm" variant="ghost" onClick={() => retryStep(drawerTweetId!, evt.step)}><RotateCcw className="w-3 h-3" /></Button>}
              </div>
            ))}
          </div>
          <DrawerFooter><DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
