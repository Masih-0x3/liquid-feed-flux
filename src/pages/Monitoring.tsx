import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ThemedSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  RefreshCw,
  Edit,
  Check,
  X,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerFooter,
} from "@/components/ui/drawer";

// ===== Types =====
interface MonitoringEntry {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  url: string;
  created_at: string;
  account_handle: string;
  delivery_status: string;
  telegram_message_ids: string[];
  is_translated: boolean;
  is_delivered: boolean;
  translation_job_status: string;
  delivery_job_status: string;
  translation_error: string;
  delivery_error: string;
}

interface PipelineEvent {
  subject_type: string;
  subject_id: string;
  step: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
  meta?: Record<string, unknown>;
}

// ===== Admin action helpers =====
async function adminEditTranslation(tweetId: string, text: string) {
  const { error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'edit_translation', tweet_id: tweetId, text_translated: text },
  });
  if (error) throw error;
}

async function adminRetryStep(tweetId: string, step: string) {
  const { error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'retry_step', tweet_id: tweetId, step },
  });
  if (error) throw error;
}

async function adminReprocess(tweetId: string) {
  const { error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'reprocess', tweet_id: tweetId },
  });
  if (error) throw error;
}

async function adminBulkReprocess(tweetIds: string[]) {
  const { error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'bulk_reprocess', tweet_ids: tweetIds },
  });
  if (error) throw error;
}

// ===== StatusIndicator Component =====
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

          if (step.completed) {
            statusColor = 'bg-success';
            textColor = 'text-success';
            icon = '\u2713';
          } else if (step.status === 'running') {
            statusColor = 'bg-primary animate-pulse';
            textColor = 'text-primary';
          } else if (step.status === 'failed' || step.error) {
            statusColor = 'bg-destructive';
            textColor = 'text-destructive';
            icon = '\u2717';
          } else if (step.status === 'pending') {
            statusColor = 'bg-warning';
            textColor = 'text-warning';
          }

          return (
            <div key={step.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${statusColor} flex items-center justify-center`}>
                <span className="text-white text-xs font-bold">{icon}</span>
              </div>
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

// ===== Main Component =====
export default function Monitoring() {
  const [entries, setEntries] = useState<MonitoringEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set());
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTweetId, setDrawerTweetId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<PipelineEvent[]>([]);
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const fetchMonitoringData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch posts with account info
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('tweet_id, text_original, text_translated, url, created_at, translated_at, has_media, lang_original, accounts!inner(handle, display_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (postsError) throw postsError;

      if (!postsData || postsData.length === 0) {
        setEntries([]);
        return;
      }

      // Use RPC for consolidated status
      const tweetIds = postsData.map(p => p.tweet_id);
      let statusByTweet: Record<string, Record<string, unknown>> = {};
      try {
        const { data: rpcData, error: rpcError } = await supabase
          .rpc('get_post_pipeline_status', { tweet_ids: tweetIds });
        if (!rpcError && rpcData) {
          (rpcData as Record<string, unknown>[]).forEach((row) => {
            statusByTweet[row.tweet_id as string] = row;
          });
        }
      } catch {
        // RPC may not exist; fall through
      }

      const combinedData: MonitoringEntry[] = postsData.map(post => {
        const rpc = statusByTweet[post.tweet_id] as Record<string, unknown> | undefined;
        const isTranslated = !!(rpc?.translated_at || post.translated_at || (post.text_translated && post.text_translated !== post.text_original));
        const deliveryStatus = (rpc?.delivery_status as string) || 'pending';
        const isDelivered = deliveryStatus === 'posted';

        return {
          tweet_id: post.tweet_id,
          text_original: post.text_original || '',
          text_translated: post.text_translated || '',
          url: post.url || '',
          created_at: post.created_at,
          account_handle: (post.accounts as { handle: string }).handle,
          delivery_status: deliveryStatus,
          telegram_message_ids: [],
          is_translated: isTranslated,
          is_delivered: isDelivered,
          translation_job_status: (rpc?.translate_status as string) || (isTranslated ? 'completed' : 'pending'),
          delivery_job_status: deliveryStatus,
          translation_error: (rpc?.translate_error as string) || '',
          delivery_error: (rpc?.delivery_error as string) || '',
        };
      });

      setEntries(combinedData);
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
      toast({ title: 'Error', description: 'Failed to fetch monitoring data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const scheduleRefresh = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => fetchMonitoringData(), 500);
  }, [fetchMonitoringData]);

  useEffect(() => {
    fetchMonitoringData();
    const postsChannel = supabase.channel('mon-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, scheduleRefresh).subscribe();
    const jobsChannel = supabase.channel('mon-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, scheduleRefresh).subscribe();
    const delChannel = supabase.channel('mon-del').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, scheduleRefresh).subscribe();

    return () => {
      supabase.removeChannel(postsChannel);
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(delChannel);
    };
  }, [fetchMonitoringData, scheduleRefresh]);

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      await adminEditTranslation(editingEntry, editedContent);
      toast({ title: 'Success', description: 'Translation updated' });
      setEditingEntry(null);
      setEditedContent('');
      fetchMonitoringData();
    } catch {
      toast({ title: 'Error', description: 'Failed to update content', variant: 'destructive' });
    }
  };

  const handleRetryTranslation = async (tweetId: string) => {
    try {
      await adminRetryStep(tweetId, 'translate');
      toast({ title: 'Success', description: 'Translation job queued' });
      fetchMonitoringData();
    } catch {
      toast({ title: 'Error', description: 'Failed to retry translation', variant: 'destructive' });
    }
  };

  const handleReprocessTweet = async (tweetId: string) => {
    try {
      await adminReprocess(tweetId);
      toast({ title: 'Processing started', description: 'Tweet queued for full reprocessing' });
    } catch {
      toast({ title: 'Error', description: 'Failed to reprocess tweet', variant: 'destructive' });
    }
  };

  const handleReprocessSelected = async () => {
    if (selectedTweets.size === 0) {
      toast({ title: 'No Selection', description: 'Please select tweets to reprocess', variant: 'destructive' });
      return;
    }
    setIsReprocessing(true);
    try {
      await adminBulkReprocess(Array.from(selectedTweets));
      toast({ title: 'Success', description: `${selectedTweets.size} tweets queued for reprocessing` });
      setSelectedTweets(new Set());
      fetchMonitoringData();
    } catch {
      toast({ title: 'Error', description: 'Failed to reprocess selected tweets', variant: 'destructive' });
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleSelectTweet = (tweetId: string, checked: boolean) => {
    const updated = new Set(selectedTweets);
    checked ? updated.add(tweetId) : updated.delete(tweetId);
    setSelectedTweets(updated);
  };

  const filteredEntries = entries
    .filter(e => e.text_original.toLowerCase().includes(searchTerm.toLowerCase()) || e.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) || e.account_handle.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(e => {
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
    setDrawerTweetId(tweetId);
    setDrawerOpen(true);
    try {
      const { data, error } = await supabase
        .from('pipeline_events' as 'pipeline_events')
        .select('subject_type, subject_id, step, status, started_at, ended_at, error, meta')
        .eq('subject_type', 'post')
        .eq('subject_id', tweetId)
        .order('started_at', { ascending: false });
      if (error) throw error;
      setTimeline((data as PipelineEvent[]) || []);
    } catch {
      setTimeline([]);
    }
  };

  const retryStep = async (tweetId: string, step: string) => {
    try {
      await adminRetryStep(tweetId, step);
      toast({ title: 'Retry queued', description: `${step} retry scheduled` });
    } catch {
      toast({ title: 'Retry failed', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Content Monitoring</h1>
          <p className="text-muted-foreground">English &rarr; Persian translation pipeline &bull; Live updates enabled</p>
        </div>
        <Button onClick={fetchMonitoringData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold">{totalPosts}</p><p className="text-sm text-muted-foreground">Total Posts</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-success">{translatedPosts}</p><p className="text-sm text-muted-foreground">Translated</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-primary">{deliveredPosts}</p><p className="text-sm text-muted-foreground">Delivered</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-center"><p className="text-2xl font-bold text-warning">{needsTranslation}</p><p className="text-sm text-muted-foreground">Needs Translation</p>
          {needsTranslation > 0 && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => entries.filter(e => !e.is_translated).forEach(e => handleRetryTranslation(e.tweet_id))}>
              Retry All
            </Button>
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
                    <SelectGroup>
                      <SelectLabel>Filter</SelectLabel>
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
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isReprocessing ? 'Processing...' : 'Reprocess Selected'}
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
        ) : (
          filteredEntries.map(entry => {
            const isEditing = editingEntry === entry.tweet_id;
            const isSelected = selectedTweets.has(entry.tweet_id);

            return (
              <Card key={entry.tweet_id} className={isSelected ? 'ring-2 ring-primary' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <Checkbox checked={isSelected} onCheckedChange={(c) => handleSelectTweet(entry.tweet_id, c as boolean)} />
                      <div className="flex-1">
                        <CardTitle className="text-lg">@{entry.account_handle}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm')}
                          {entry.url && (
                            <>
                              {' \u2022 '}
                              <a href={entry.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                Source <ExternalLink className="w-3 h-3" />
                              </a>
                            </>
                          )}
                        </p>
                        <div className="mt-2"><StatusIndicator entry={entry} /></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.is_translated ? 'default' : 'secondary'}>{entry.is_translated ? 'Translated' : 'Original'}</Badge>
                      <Badge variant={entry.is_delivered ? 'default' : 'outline'}>{entry.is_delivered ? 'Delivered' : 'Pending'}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <h4 className="font-medium mb-2 text-sm text-muted-foreground">English</h4>
                    <p className="text-sm bg-muted/50 p-3 rounded border">{entry.text_original || '[No content]'}</p>
                  </div>
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm text-muted-foreground">Persian</h4>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleReprocessTweet(entry.tweet_id)}>
                          <RotateCcw className="w-3 h-3 mr-1" />Reprocess
                        </Button>
                        {!entry.is_translated && (
                          <Button size="sm" variant="outline" onClick={() => handleRetryTranslation(entry.tweet_id)}>Translate</Button>
                        )}
                        {!isEditing && (
                          <Button variant="outline" size="sm" onClick={() => { setEditingEntry(entry.tweet_id); setEditedContent(entry.text_translated || entry.text_original); }}>
                            <Edit className="w-3 h-3 mr-1" />Edit
                          </Button>
                        )}
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
                </CardContent>
              </Card>
            );
          })
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
            ) : (
              timeline.map((evt, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className={`w-2 h-2 rounded-full mt-2 ${evt.status === 'completed' ? 'bg-success' : evt.status === 'failed' ? 'bg-destructive' : 'bg-warning'}`} />
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">{evt.step}</span>
                      <Badge variant="outline" className="text-xs">{evt.status}</Badge>
                    </div>
                    {evt.started_at && <p className="text-xs text-muted-foreground">{new Date(evt.started_at).toLocaleString()}</p>}
                    {evt.error && <p className="text-xs text-destructive mt-1">{evt.error}</p>}
                  </div>
                  {evt.status === 'failed' && (
                    <Button size="sm" variant="ghost" onClick={() => retryStep(drawerTweetId!, evt.step)}>
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <DrawerFooter>
            <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
