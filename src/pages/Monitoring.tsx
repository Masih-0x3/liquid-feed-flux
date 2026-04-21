import { useState } from "react";
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
import { Search, RefreshCw, Edit, Check, X, ExternalLink, RotateCcw, Star, Send, Scissors, Sparkles, Twitter } from "lucide-react";
import { format } from "date-fns";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose, DrawerFooter } from "@/components/ui/drawer";
import { useMonitoringData, type MonitoringEntry, type PipelineEvent } from "@/hooks/useMonitoringData";
import { useQueryClient } from "@tanstack/react-query";
import { MediaThumbnails } from "@/components/monitoring/MediaThumbnails";

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
  return data as { ok: boolean; score?: number; decision?: string; reasoning?: string; error?: string };
}
async function adminRetryXPost(tweetId: string) {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body: { action: 'retry_x_post', tweet_id: tweetId } });
  if (error) throw error;
  return data as { ok: boolean; error?: string; status?: string; x_tweet_id?: string };
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
      {(entry.translation_error || entry.delivery_error) && (
        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
          {entry.translation_error && <div>Translation: {entry.translation_error}</div>}
          {entry.delivery_error && <div>Delivery: {entry.delivery_error}</div>}
        </div>
      )}
    </div>
  );
}

export default function Monitoring() {
  const { entries, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useMonitoringData();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set());
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTweetId, setDrawerTweetId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<PipelineEvent[]>([]);
  const { toast } = useToast();

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
    try {
      const res = await adminRetryXPost(tweetId);
      if (!res.ok) throw new Error(res.error || 'X retry failed');
      toast({ title: 'X post queued', description: res.x_tweet_id ? `Posted: ${res.x_tweet_id}` : `Status: ${res.status ?? 'queued'}` });
      invalidate();
    } catch (e) {
      toast({ title: 'X retry failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleRescorePost = async (tweetId: string) => {
    try {
      const res = await adminRescorePost(tweetId);
      if (!res.ok) throw new Error(res.error || 'Re-score failed');
      toast({ title: `New score: ${res.score}/20`, description: `Decision: ${res.decision}${res.reasoning ? ` — ${res.reasoning.slice(0, 120)}` : ''}` });
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

  const filteredEntries = entries
    .filter((e: MonitoringEntry) => e.text_original.toLowerCase().includes(searchTerm.toLowerCase()) || e.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) || e.account_handle.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((e: MonitoringEntry) => {
      switch (filter) {
        case 'needs-translation': return !e.is_translated;
        case 'delivery-pending': return e.delivery_status !== 'posted';
        case 'failed': return !!(e.translation_error || e.delivery_error);
        case 'recently-delivered': return e.delivery_status === 'posted';
        default: return true;
      }
    });

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
        <Button onClick={invalidate} variant="outline"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

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
                <ThemedSelect value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="bg-card text-foreground border-border"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent className="bg-popover text-popover-foreground border-border">
                    <SelectGroup><SelectLabel>Filter</SelectLabel>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="needs-translation">Needs translation</SelectItem>
                      <SelectItem value="delivery-pending">Delivery pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="recently-delivered">Recently Delivered</SelectItem>
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
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <Checkbox checked={isSelected} onCheckedChange={(c) => handleSelectTweet(entry.tweet_id, c as boolean)} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">
                          {entry.author_handle ? `@${entry.author_handle}` : `@${entry.account_handle}`}
                        </CardTitle>
                        {entry.importance_score != null && (
                          <Badge
                            className={
                              entry.importance_score >= 15
                                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                                : entry.importance_score >= 9
                                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                                : 'bg-red-500/20 text-red-400 border-red-500/30'
                            }
                          >
                            <Star className="w-3 h-3 mr-1" />{entry.importance_score}/20
                          </Badge>
                        )}
                        {entry.delivery_decision && entry.delivery_decision !== 'deliver' && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {entry.delivery_decision === 'skip' ? 'Skipped' : entry.delivery_decision}
                          </Badge>
                        )}
                        {entry.hydration_source === 'x_api' && (
                          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                            <Sparkles className="w-3 h-3 mr-1" />Hydrated
                          </Badge>
                        )}
                        {entry.is_truncated && !entry.hydrated_at && (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                            <Scissors className="w-3 h-3 mr-1" />Truncated
                          </Badge>
                        )}
                        {entry.hydrated_at && entry.hydration_source && entry.hydration_source !== 'x_api' && (
                          <Badge variant="outline" className="text-muted-foreground" title={entry.hydration_source}>
                            <Scissors className="w-3 h-3 mr-1" />Truncated (fallback)
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm')}
                          {entry.url && (<>{' • '}<a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">Source <ExternalLink className="w-3 h-3" /></a></>)}
                        </p>
                        {entry.importance_tags && entry.importance_tags.length > 0 && (
                          <div className="flex gap-1">
                            {entry.importance_tags.map(tag => (
                              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">{tag}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-2"><StatusIndicator entry={entry} /></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Badge variant={entry.is_translated ? 'default' : 'secondary'}>{entry.is_translated ? 'Translated' : 'Original'}</Badge>
                    <Badge variant={entry.is_delivered ? 'default' : 'outline'}>{entry.is_delivered ? 'Delivered' : 'Pending'}</Badge>
                    {(() => {
                      const xs = entry.x_status;
                      if (!xs) return <Badge variant="outline" className="text-muted-foreground"><Twitter className="w-3 h-3 mr-1" />X: —</Badge>;
                      const cls =
                        xs === 'posted' ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : xs === 'failed' ? 'bg-destructive/20 text-destructive border-destructive/30'
                        : xs === 'skipped' ? 'bg-muted text-muted-foreground border-border'
                        : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
                      const label = xs === 'posted' ? 'X: Posted' : xs === 'failed' ? 'X: Failed' : xs === 'skipped' ? `X: Skipped${entry.x_skip_reason ? ` (${entry.x_skip_reason})` : ''}` : 'X: Pending';
                      const inner = (
                        <Badge className={cls} title={entry.x_error || entry.x_skip_reason || ''}>
                          <Twitter className="w-3 h-3 mr-1" />{label}
                        </Badge>
                      );
                      return xs === 'posted' && entry.x_tweet_id ? (
                        <a href={`https://x.com/i/status/${entry.x_tweet_id}`} target="_blank" rel="noopener noreferrer">{inner}</a>
                      ) : inner;
                    })()}
                    {/* Force actions — always available so admins can override any decision/state */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleForceDeliver(entry.tweet_id)}
                      title={entry.is_delivered ? 'Re-deliver to Telegram (overrides previous delivery)' : 'Force delivery to Telegram'}
                    >
                      <Send className="w-3 h-3 mr-1" />{entry.is_delivered ? 'Re-deliver' : 'Force Deliver'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetryXPost(entry.tweet_id)}
                      title={entry.x_status === 'posted' ? 'Re-post to X (overrides previous post)' : 'Force post to X'}
                    >
                      <Twitter className="w-3 h-3 mr-1" />{entry.x_status === 'posted' ? 'Re-post on X' : 'Force on X'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <MediaThumbnails tweetId={entry.tweet_id} />
                <div className="mb-4">
                  <h4 className="font-medium mb-2 text-sm text-muted-foreground">English</h4>
                  <p className="text-sm bg-muted/50 p-3 rounded border">{entry.text_original || '[No content]'}</p>
                </div>
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-sm text-muted-foreground">Persian</h4>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleReprocessTweet(entry.tweet_id)}><RotateCcw className="w-3 h-3 mr-1" />Reprocess</Button>
                      <Button size="sm" variant="outline" onClick={() => handleRescorePost(entry.tweet_id)} title="Re-run scoring with current rubric"><Star className="w-3 h-3 mr-1" />Re-score</Button>
                      {!entry.is_translated && <Button size="sm" variant="outline" onClick={() => handleRetryTranslation(entry.tweet_id)}>Translate</Button>}
                      {!isEditing && <Button variant="outline" size="sm" onClick={() => { setEditingEntry(entry.tweet_id); setEditedContent(entry.text_translated || entry.text_original); }}><Edit className="w-3 h-3 mr-1" />Edit</Button>}
                      <Button size="sm" variant="outline" onClick={() => openDetails(entry.tweet_id)}>Details</Button>
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
                    <div className={`text-sm p-4 rounded border leading-relaxed break-words ${!entry.is_translated ? 'bg-warning/10 text-warning border-warning/30' : 'bg-card text-foreground border-border'}`}>
                      <div className="whitespace-pre-wrap" dir="rtl">{entry.text_translated || '[Not translated yet]'}</div>
                    </div>
                  )}
                </div>
                {entry.importance_reasoning && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                      Why this score? ({entry.importance_score ?? '—'}/20)
                    </summary>
                    <div className="mt-2 p-3 rounded border border-border bg-muted/30 text-foreground whitespace-pre-wrap leading-relaxed">
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
