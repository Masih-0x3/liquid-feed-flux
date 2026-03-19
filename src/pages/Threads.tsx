import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Link2, Split, Merge, Eye, Send, Loader2, MessageSquare } from 'lucide-react';

interface Thread {
  id: string;
  account_id: string;
  tweet_ids: string[];
  confidence: number;
  created_at: string;
  accounts: {
    handle: string;
  };
}

interface Post {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  created_at: string;
}

export default function Threads() {
  const { toast } = useToast();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadPosts, setThreadPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    try {
      const { data, error } = await supabase
        .from('threads')
        .select(`
          *,
          accounts (
            handle
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setThreads(data || []);
    } catch (error) {
      console.error('Error fetching threads:', error);
      toast({
        title: "Error loading threads",
        description: "Failed to fetch threads. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchThreadPosts = async (thread: Thread) => {
    if (!thread.tweet_ids || thread.tweet_ids.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('posts')
        .select('tweet_id, text_original, text_translated, created_at')
        .in('tweet_id', thread.tweet_ids)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setThreadPosts(data || []);
    } catch (error) {
      console.error('Error fetching thread posts:', error);
      toast({
        title: "Error loading thread posts",
        description: "Failed to fetch posts for this thread.",
        variant: "destructive",
      });
    }
  };

  const handlePreview = async (thread: Thread) => {
    setSelectedThread(thread);
    setIsPreviewOpen(true);
    await fetchThreadPosts(thread);
  };

  // Split and Merge are not yet implemented (Issue 28/30)
  // Buttons have been hidden until backend support is ready

  const handlePostThread = async (threadId: string) => {
    try {
      // Create delivery job for the thread
      const { error } = await supabase
        .from('deliveries')
        .insert([{
          subject_type: 'thread',
          subject_id: threadId,
          status: 'pending'
        }]);

      if (error) throw error;
      toast({ title: "Thread queued for delivery" });
    } catch (error) {
      console.error('Error posting thread:', error);
      toast({
        title: "Error posting thread",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'status-success';
    if (confidence >= 0.6) return 'status-warning';
    return 'status-error';
  };

  const assembleThreadBody = (posts: Post[]) => {
    return posts
      .map((post, index) => `${index + 1}. ${post.text_translated || post.text_original}`)
      .join('\n\n');
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Threads</h1>
          <p className="text-muted-foreground mt-1">View grouped tweet conversations</p>
        </div>
      </div>

      {/* Threads Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
            <Link2 className="w-5 h-5 mr-2" />
            Thread Groups
          </CardTitle>
          <CardDescription>
            Automatically detected conversation threads
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
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
                {threads.map((thread) => (
                  <TableRow key={thread.id} className="border-glass-border hover:bg-glass-border/20">
                    <TableCell className="font-medium text-glass-foreground">
                      @{(thread.accounts as any)?.handle || 'unknown'}
                    </TableCell>
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
                    <TableCell className="text-muted-foreground">
                      {new Date(thread.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePreview(thread)}
                          className="glass-button h-8 w-8 p-0"
                        >
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePostThread(thread.id)}
                          className="glass-button h-8 w-8 p-0 text-success hover:bg-success/20"
                        >
                          <Send className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-glass-foreground mb-2">No threads detected</h3>
              <p>Thread grouping will appear here when conversations are identified</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="glass-panel border-glass-border max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-glass-foreground">
              Thread Preview - @{(selectedThread?.accounts as any)?.handle}
            </DialogTitle>
            <DialogDescription>
              Preview of assembled thread content ({threadPosts.length} posts)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-96">
            {threadPosts.length > 0 ? (
              <>
                {/* Individual Posts */}
                <div className="space-y-3">
                  <h4 className="font-medium text-glass-foreground">Individual Posts:</h4>
                  {threadPosts.map((post, index) => (
                    <div key={post.tweet_id} className="glass-panel p-3 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="text-xs">
                          Post {index + 1}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(post.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-glass-foreground mb-2">
                        <strong>Original:</strong> {post.text_original}
                      </p>
                      {post.text_translated && (
                        <p className="text-sm text-muted-foreground">
                          <strong>Translated:</strong> {post.text_translated}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Assembled Thread */}
                <div className="border-t border-glass-border pt-4">
                  <h4 className="font-medium text-glass-foreground mb-3">Assembled Thread:</h4>
                  <div className="glass-panel p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm text-glass-foreground">
                      {assembleThreadBody(threadPosts)}
                    </pre>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-2 pt-4">
                  <Button
                    onClick={() => selectedThread && handlePostThread(selectedThread.id)}
                    className="bg-gradient-primary hover:opacity-90 text-white flex-1"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Post Thread
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p>Loading thread posts...</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}