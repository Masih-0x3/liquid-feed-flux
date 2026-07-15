import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { invokeAdminAction } from '@/api/adminActions';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Link2, Eye, Send, Loader2, MessageSquare, RefreshCw } from 'lucide-react';

interface Thread {
  id: string;
  account_id: string;
  tweet_ids: string[];
  confidence: number;
  created_at: string;
  accounts: { handle: string };
}

interface Post {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  created_at: string;
}

type ThreadPreviewState = 'idle' | 'loading' | 'ready' | 'error';

function threadHandle(thread: Thread | null | undefined) {
  return thread?.accounts?.handle || 'unknown';
}

export default function Threads() {
  const { toast } = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadPosts, setThreadPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<ThreadPreviewState>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestId = useRef(0);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setThreadsError(null);
    try {
      const { data, error } = await supabase
        .from('threads')
        .select('id, account_id, tweet_ids, confidence, created_at, accounts(handle)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setThreads((data as Thread[]) || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The thread list could not be loaded.';
      setThreadsError(message);
      toast({ title: 'Error loading threads', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchThreads(); }, [fetchThreads]);

  const fetchThreadPosts = useCallback(async (thread: Thread) => {
    const requestId = ++previewRequestId.current;
    setThreadPosts([]);
    setPreviewError(null);
    setPreviewState('loading');

    if (!thread.tweet_ids?.length) {
      setPreviewState('ready');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('posts')
        .select('tweet_id, text_original, text_translated, created_at')
        .in('tweet_id', thread.tweet_ids)
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (requestId !== previewRequestId.current) return;
      setThreadPosts(data || []);
      setPreviewState('ready');
    } catch (error) {
      if (requestId !== previewRequestId.current) return;
      const message = error instanceof Error ? error.message : 'The posts for this thread could not be loaded.';
      setPreviewError(message);
      setPreviewState('error');
      toast({ title: 'Error loading thread posts', description: message, variant: 'destructive' });
    }
  }, [toast]);

  const handlePreview = useCallback((thread: Thread) => {
    setSelectedThread(thread);
    setIsPreviewOpen(true);
    void fetchThreadPosts(thread);
  }, [fetchThreadPosts]);

  const handlePreviewOpenChange = useCallback((open: boolean) => {
    setIsPreviewOpen(open);
    if (open) return;
    previewRequestId.current += 1;
    setPreviewState('idle');
    setPreviewError(null);
    setThreadPosts([]);
  }, []);

  const handlePostThread = async (threadId: string) => {
    try {
      await invokeAdminAction({ action: 'post_thread', thread_id: threadId });
      toast({ title: 'Thread queued for delivery' });
    } catch (error) {
      toast({
        title: 'Error posting thread',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'status-success';
    if (confidence >= 0.6) return 'status-warning';
    return 'status-error';
  };

  const assembleThreadBody = (posts: Post[]) =>
    posts.map((p, i) => `${i + 1}. ${p.text_translated || p.text_original}`).join('\n\n');

  const canPostPreview = previewState === 'ready' && threadPosts.length > 0;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Threads</h1>
          <p className="text-muted-foreground mt-1">View grouped tweet conversations</p>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
            <Link2 className="w-5 h-5 mr-2" />
            Thread Groups
          </CardTitle>
          <CardDescription>Automatically detected conversation threads</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8" aria-label="Loading thread groups">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : threadsError ? (
            <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <h2 className="font-medium text-glass-foreground">Thread groups are unavailable</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{threadsError}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void fetchThreads()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : threads.length > 0 ? (
            <div className="space-y-2">
              <p id="thread-table-scroll-help" className="text-xs text-muted-foreground md:hidden">
                Swipe the table horizontally to review all columns. Each action remains available in the final column.
              </p>
              <div className="overflow-x-auto rounded-md border border-glass-border" tabIndex={0} aria-describedby="thread-table-scroll-help">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow className="border-glass-border hover:bg-glass-border/20">
                      <TableHead className="text-glass-foreground">Account</TableHead>
                      <TableHead className="text-glass-foreground">Tweet Count</TableHead>
                      <TableHead className="text-glass-foreground">Confidence</TableHead>
                      <TableHead className="text-glass-foreground">Created</TableHead>
                      <TableHead className="text-glass-foreground text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {threads.map((thread) => (
                      <TableRow key={thread.id} className="border-glass-border hover:bg-glass-border/20">
                        <TableCell className="font-medium text-glass-foreground">@{threadHandle(thread)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center space-x-2">
                            <MessageSquare className="w-4 h-4" />
                            <span>{thread.tweet_ids?.length || 0} posts</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getConfidenceColor(thread.confidence)}>
                            {Math.round((thread.confidence || 0) * 100)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{new Date(thread.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handlePreview(thread)}
                                  className="glass-button h-11 w-11 p-0"
                                  aria-label={`Preview thread from @${threadHandle(thread)}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Preview thread</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handlePreview(thread)}
                                  className="glass-button h-11 w-11 p-0 text-success hover:bg-success/20"
                                  aria-label={`Review thread from @${threadHandle(thread)} before queueing it for posting`}
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Review before queueing</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h2 className="text-lg font-medium text-glass-foreground mb-2">No threads detected</h2>
              <p>Thread grouping will appear here when conversations are identified</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent className="glass-panel border-glass-border max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-glass-foreground">
              Thread Preview - @{threadHandle(selectedThread)}
            </DialogTitle>
            <DialogDescription>
              {previewState === 'loading'
                ? 'Loading posts for the selected thread…'
                : previewState === 'error'
                  ? 'The selected thread could not be loaded.'
                  : `Preview of assembled thread content (${threadPosts.length} posts)`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-96">
            {previewState === 'loading' && (
              <div className="text-center py-8 text-muted-foreground" role="status">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p>Loading selected thread posts…</p>
              </div>
            )}

            {previewState === 'error' && (
              <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div>
                    <h2 className="font-medium text-glass-foreground">Unable to load this thread</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{previewError}</p>
                  </div>
                </div>
                {selectedThread && (
                  <Button variant="outline" size="sm" onClick={() => void fetchThreadPosts(selectedThread)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                )}
              </div>
            )}

            {previewState === 'ready' && threadPosts.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                This thread has no posts available to preview yet.
              </div>
            )}

            {previewState === 'ready' && threadPosts.length > 0 && (
              <>
                <div className="space-y-3">
                  <h2 className="font-medium text-glass-foreground">Individual Posts</h2>
                  {threadPosts.map((post, index) => (
                    <div key={post.tweet_id} className="glass-panel p-3 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="text-xs">Post {index + 1}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(post.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-glass-foreground mb-2"><strong>Original:</strong> {post.text_original}</p>
                      {post.text_translated && <p className="text-sm text-muted-foreground"><strong>Translated:</strong> {post.text_translated}</p>}
                    </div>
                  ))}
                </div>
                <div className="border-t border-glass-border pt-4">
                  <h2 className="font-medium text-glass-foreground mb-3">Assembled Thread</h2>
                  <div className="glass-panel p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm text-glass-foreground">{assembleThreadBody(threadPosts)}</pre>
                  </div>
                </div>
              </>
            )}
          </div>
          <Button
            onClick={() => selectedThread && void handlePostThread(selectedThread.id)}
            disabled={!canPostPreview || !selectedThread}
            className="bg-gradient-primary hover:opacity-90 text-white w-full"
          >
            <Send className="w-4 h-4 mr-2" />
            Post Thread
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
