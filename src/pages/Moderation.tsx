import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, AlertTriangle, CheckCircle, XCircle, Loader2, Eye } from 'lucide-react';

interface ModerationEvent {
  id: string;
  subject_type: 'post' | 'thread';
  subject_id: string;
  verdict: 'allow' | 'block' | null;
  categories: any;
  reviewer_id: string | null;
  created_at: string;
}

interface PendingItem {
  id: string;
  type: 'post' | 'thread';
  content: string;
  account: string;
  moderationCategories: {
    hate: number;
    harassment: number;
    violence: number;
    selfHarm: number;
    sexual: number;
    spam: number;
  };
  created_at: string;
}

export default function Moderation() {
  const { toast } = useToast();
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [moderationHistory, setModerationHistory] = useState<ModerationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  useEffect(() => {
    fetchModerationData();
  }, []);

  const fetchModerationData = async () => {
    try {
      // Fetch moderation history
      const { data: history, error: historyError } = await supabase
        .from('moderation_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (historyError) throw historyError;
      setModerationHistory((history || []) as ModerationEvent[]);

      // For demo purposes, create some mock pending items
      // In real implementation, this would fetch posts/threads that need moderation
      const mockPendingItems: PendingItem[] = [
        {
          id: 'post_1',
          type: 'post',
          content: 'This is a sample post that might need moderation review...',
          account: '@example_user',
          moderationCategories: {
            hate: 0.1,
            harassment: 0.2,
            violence: 0.05,
            selfHarm: 0.01,
            sexual: 0.03,
            spam: 0.8
          },
          created_at: new Date().toISOString()
        },
        {
          id: 'thread_1',
          type: 'thread',
          content: 'This is a thread that has been flagged for potential issues...',
          account: '@another_user',
          moderationCategories: {
            hate: 0.7,
            harassment: 0.6,
            violence: 0.1,
            selfHarm: 0.05,
            sexual: 0.02,
            spam: 0.1
          },
          created_at: new Date(Date.now() - 3600000).toISOString()
        }
      ];

      setPendingItems(mockPendingItems);
    } catch (error) {
      console.error('Error fetching moderation data:', error);
      toast({
        title: "Error loading moderation data",
        description: "Failed to fetch moderation information.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (itemId: string, itemType: 'post' | 'thread') => {
    try {
      const { error } = await supabase
        .from('moderation_events')
        .insert([{
          subject_type: itemType,
          subject_id: itemId,
          verdict: 'allow',
          categories: {}
        }]);

      if (error) throw error;

      toast({ title: "Content approved" });
      setPendingItems(prev => prev.filter(item => item.id !== itemId));
      fetchModerationData();
    } catch (error) {
      console.error('Error approving content:', error);
      toast({
        title: "Error approving content",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (itemId: string, itemType: 'post' | 'thread') => {
    try {
      const { error } = await supabase
        .from('moderation_events')
        .insert([{
          subject_type: itemType,
          subject_id: itemId,
          verdict: 'block',
          categories: {}
        }]);

      if (error) throw error;

      toast({ title: "Content blocked" });
      setPendingItems(prev => prev.filter(item => item.id !== itemId));
      fetchModerationData();
    } catch (error) {
      console.error('Error blocking content:', error);
      toast({
        title: "Error blocking content",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const getCategoryBadge = (category: string, score: number) => {
    const colors = {
      hate: score > 0.5 ? 'status-error' : score > 0.3 ? 'status-warning' : 'status-pending',
      harassment: score > 0.5 ? 'status-error' : score > 0.3 ? 'status-warning' : 'status-pending',
      violence: score > 0.5 ? 'status-error' : score > 0.3 ? 'status-warning' : 'status-pending',
      selfHarm: score > 0.5 ? 'status-error' : score > 0.3 ? 'status-warning' : 'status-pending',
      sexual: score > 0.5 ? 'status-error' : score > 0.3 ? 'status-warning' : 'status-pending',
      spam: score > 0.7 ? 'status-error' : score > 0.5 ? 'status-warning' : 'status-pending',
    };

    return (
      <Badge key={category} className={colors[category as keyof typeof colors]} variant="outline">
        {category}: {Math.round(score * 100)}%
      </Badge>
    );
  };

  const getHighestRiskCategory = (categories: PendingItem['moderationCategories']) => {
    const entries = Object.entries(categories);
    const highest = entries.reduce((max, [key, value]) => value > max.value ? { key, value } : max, { key: '', value: 0 });
    return highest;
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Moderation</h1>
          <p className="text-muted-foreground mt-1">Review flagged content and moderation decisions</p>
        </div>
        <div className="flex items-center space-x-2 glass-panel px-3 py-2 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <span className="text-sm text-glass-foreground">{pendingItems.length} pending review</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-4">
        <Button
          variant={activeTab === 'pending' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('pending')}
          className={activeTab === 'pending' ? 'bg-gradient-primary text-white' : 'glass-button'}
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          Pending Review ({pendingItems.length})
        </Button>
        <Button
          variant={activeTab === 'history' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('history')}
          className={activeTab === 'history' ? 'bg-gradient-primary text-white' : 'glass-button'}
        >
          <ShieldCheck className="w-4 h-4 mr-2" />
          Moderation History
        </Button>
      </div>

      {/* Content based on active tab */}
      {activeTab === 'pending' ? (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-warning" />
              Content Awaiting Review
            </CardTitle>
            <CardDescription>
              Items flagged by OpenAI moderation that require manual review
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : pendingItems.length > 0 ? (
              <div className="space-y-4">
                {pendingItems.map((item) => {
                  const highestRisk = getHighestRiskCategory(item.moderationCategories);
                  return (
                    <div key={item.id} className="glass-panel p-4 rounded-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Badge variant="outline" className="capitalize">
                            {item.type}
                          </Badge>
                          <span className="text-sm font-medium text-glass-foreground">
                            {item.account}
                          </span>
                          <Badge className="status-warning">
                            Risk: {highestRisk.key} ({Math.round(highestRisk.value * 100)}%)
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm text-glass-foreground bg-glass-border/20 p-3 rounded">
                          {item.content}
                        </p>
                        
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(item.moderationCategories)
                            .filter(([_, score]) => score > 0.1)
                            .map(([category, score]) => getCategoryBadge(category, score))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(item.id, item.type)}
                            className="bg-success hover:bg-success/80 text-white"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleReject(item.id, item.type)}
                            className="bg-destructive hover:bg-destructive/80"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Block
                          </Button>
                        </div>
                        <Button size="sm" variant="ghost" className="glass-button">
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-glass-foreground mb-2">No pending items</h3>
                <p>All content has been reviewed and processed</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2" />
              Moderation History
            </CardTitle>
            <CardDescription>
              Recent moderation decisions and actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : moderationHistory.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-glass-border hover:bg-glass-border/20">
                    <TableHead className="text-glass-foreground">Type</TableHead>
                    <TableHead className="text-glass-foreground">Subject ID</TableHead>
                    <TableHead className="text-glass-foreground">Decision</TableHead>
                    <TableHead className="text-glass-foreground">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moderationHistory.map((event) => (
                    <TableRow key={event.id} className="border-glass-border hover:bg-glass-border/20">
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {event.subject_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {event.subject_id.substring(0, 12)}...
                      </TableCell>
                      <TableCell>
                        <Badge className={event.verdict === 'allow' ? 'status-success' : 'status-error'}>
                          {event.verdict === 'allow' ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Approved
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 mr-1" />
                              Blocked
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(event.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-glass-foreground mb-2">No moderation history</h3>
                <p>Moderation decisions will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}