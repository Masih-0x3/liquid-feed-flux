import { Link } from 'react-router-dom';
import { persianContentAttributes } from '@/lib/contentLanguage';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Link2, Eye, Loader2, MessageSquare } from 'lucide-react';

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

interface ThreadPostsState {
  threadId: string | null;
  posts: Post[];
  loading: boolean;
  error: boolean;
}

export default function Threads() {
  const { toast } = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadPostsState, setThreadPostsState] = useState<ThreadPostsState>({
    threadId: null,
    posts: [],
    loading: false,
    error: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewRequestRef = useRef(0);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('threads')
        .select('id, account_id, tweet_ids, confidence, created_at, accounts(handle)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setThreads((data as Thread[]) || []);
      setRefreshedAt(new Date());
    } catch (error) {
      setLoadError(true);
      toast({ title: 'Error loading threads', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const fetchThreadPosts = async (thread: Thread) => {
    const requestId = ++previewRequestRef.current;
    setThreadPostsState({ threadId: thread.id, posts: [], loading: true, error: false });
    if (!thread.tweet_ids?.length) {
      if (previewRequestRef.current === requestId) {
        setThreadPostsState({ threadId: thread.id, posts: [], loading: false, error: false });
      }
      return;
    }
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('tweet_id, text_original, text_translated, created_at')
        .in('tweet_id', thread.tweet_ids)
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (previewRequestRef.current !== requestId) return;
      setThreadPostsState({ threadId: thread.id, posts: (data as Post[]) || [], loading: false, error: false });
    } catch {
      if (previewRequestRef.current !== requestId) return;
      setThreadPostsState({ threadId: thread.id, posts: [], loading: false, error: true });
      toast({ title: 'Error loading thread posts', variant: 'destructive' });
    }
  };

  const handlePreview = (thread: Thread) => {
    setSelectedThread(thread);
    setIsPreviewOpen(true);
    void fetchThreadPosts(thread);
  };

  const handlePreviewOpenChange = (open: boolean) => {
    setIsPreviewOpen(open);
    if (!open) {
      previewRequestRef.current += 1;
      setSelectedThread(null);
      setThreadPostsState({ threadId: null, posts: [], loading: false, error: false });
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'status-success';
    if (confidence >= 0.6) return 'status-warning';
    return 'status-error';
  };

  const assembleThreadBody = (posts: Post[]) =>
    posts.map((p, i) => `${i + 1}. ${p.text_translated || p.text_original}`).join('\n\n');

  const hasMatchingThreadPosts = Boolean(
    selectedThread && threadPostsState.threadId === selectedThread.id,
  );
  const threadPosts = hasMatchingThreadPosts ? threadPostsState.posts : [];
  const previewLoading = Boolean(selectedThread) && (!hasMatchingThreadPosts || threadPostsState.loading);
  const previewError = hasMatchingThreadPosts && threadPostsState.error;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Threads</h1>
          <p className="text-muted-foreground mt-1">View grouped tweet conversations</p>
          <p role="status" className="mt-1 text-xs text-muted-foreground">{loading ? "Refreshing conversations…" : refreshedAt ? `Last successful read: ${refreshedAt.toLocaleTimeString()}` : "No successful read yet"}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void fetchThreads()}>Refresh threads</Button>
      </div>

      {loadError && <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-4 text-sm"><p>Threads could not load. Check your connection or access and retry.{threads.length ? ' Last successful records remain below.' : ''}</p><Button variant="outline" onClick={() => void fetchThreads()}>Retry threads</Button></div>}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
            <Link2 className="w-5 h-5 mr-2" />
            Thread Groups
          </CardTitle>
          <CardDescription>Automatically detected conversation threads</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !refreshedAt ? (
            <div role="status" className="flex min-h-48 items-center justify-center gap-2 py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />Loading threads…
            </div>
          ) : threads.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-glass-border hover:bg-glass-border/20">
                  <TableHead className="text-glass-foreground">Account</TableHead>
                  <TableHead className="text-glass-foreground">Tweet Count</TableHead>
                  <TableHead className="text-glass-foreground">Confidence</TableHead>
                  <TableHead className="text-glass-foreground">Created</TableHead>
                  <TableHead className="text-glass-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {threads.map(thread => (
                  <TableRow key={thread.id} className="border-glass-border hover:bg-glass-border/20">
                    <TableCell className="font-medium text-glass-foreground">@{thread.accounts?.handle || 'unknown'}</TableCell>
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
                      <div className="flex items-center space-x-2">
                        <Button aria-label={`Preview thread from @${thread.accounts?.handle || "unknown"}`} size="sm" variant="ghost" onClick={() => handlePreview(thread)} className="glass-button h-8 w-8 p-0">
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Badge variant="outline" className="text-muted-foreground">Delivery unavailable</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !loadError ? (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-glass-foreground mb-2">No threads detected</h3>
              <p className="mx-auto max-w-md">Groups appear after incoming posts are linked into conversations. This view lists stored groups; refreshing does not fetch X or create a group.</p>
              <Button asChild variant="outline" className="mt-4"><Link to="/monitoring">Inspect incoming posts</Link></Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={handlePreviewOpenChange}>
        <DialogContent className="glass-panel border-glass-border max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-glass-foreground">
              Thread Preview - @{selectedThread?.accounts?.handle}
            </DialogTitle>
            <DialogDescription>
              {previewLoading ? 'Loading thread posts…' : `Preview of assembled thread content (${threadPosts.length} posts)`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-96">
            {previewLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p>Loading thread posts...</p>
              </div>
            ) : previewError ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-3">Thread posts could not be loaded.</p>
                {selectedThread && (
                  <Button type="button" variant="outline" onClick={() => { void fetchThreadPosts(selectedThread); }}>
                    Retry loading posts
                  </Button>
                )}
              </div>
            ) : threadPosts.length > 0 ? (
              <>
                <div className="space-y-3">
                  <h4 className="font-medium text-glass-foreground">Individual Posts:</h4>
                  {threadPosts.map((post, index) => (
                    <div key={post.tweet_id} className="glass-panel p-3 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="text-xs">Post {index + 1}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(post.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-glass-foreground mb-2"><strong>Original:</strong> {post.text_original}</p>
                      {post.text_translated && <p {...persianContentAttributes} className="text-sm text-muted-foreground"><strong>Translated:</strong> {post.text_translated}</p>}
                    </div>
                  ))}
                </div>
                <div className="border-t border-glass-border pt-4">
                  <h4 className="font-medium text-glass-foreground mb-3">Assembled Thread:</h4>
                  <div className="glass-panel p-4 rounded-lg">
                    <pre dir="auto" className="whitespace-pre-wrap text-sm text-glass-foreground">{assembleThreadBody(threadPosts)}</pre>
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
                  Thread delivery is unavailable until ordered delivery is implemented. This preview does not queue a message.
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No posts are available for this thread.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
