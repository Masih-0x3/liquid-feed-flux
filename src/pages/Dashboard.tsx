import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { 
  MessageSquare, 
  CheckCircle, 
  Send, 
  XCircle, 
  Activity,
  TrendingUp,
  Clock,
  AlertTriangle,
  RefreshCw,
  Play,
  Eye,
  Zap,
  Loader2,
  Wifi,
  WifiOff
} from 'lucide-react';

interface MetricCard {
  title: string;
  value: number;
  icon: React.ElementType;
  description: string;
  trend?: 'up' | 'down' | 'stable';
  color?: 'primary' | 'success' | 'warning' | 'destructive';
}

interface ActivityItem {
  id: string;
  type: 'post' | 'delivery' | 'error' | 'moderation';
  title: string;
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
}

interface PipelineHealth {
  successRate: number;
  avgLatency: number;
  activeFeeds: number;
  queueSize: number;
  isOnline: boolean;
}

export default function Dashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<MetricCard[]>([
    { title: 'Posts Ingested (24h)', value: 0, icon: MessageSquare, description: 'New posts from RSS feeds', color: 'primary' },
    { title: 'Posts Translated (24h)', value: 0, icon: CheckCircle, description: 'Successfully processed by OpenAI', color: 'success' },
    { title: 'Posts Delivered (24h)', value: 0, icon: Send, description: 'Posted to Telegram channels', color: 'primary' },
    { title: 'Failed Jobs (24h)', value: 0, icon: XCircle, description: 'Errors requiring attention', color: 'destructive' },
  ]);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealth>({
    successRate: 0,
    avgLatency: 0,
    activeFeeds: 0,
    queueSize: 0,
    isOnline: true
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    fetchDashboardData();
    
    // Set up real-time subscriptions
    const postsChannel = supabase
      .channel('dashboard-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => {
        fetchDashboardData();
      })
      .subscribe();

    const deliveriesChannel = supabase
      .channel('dashboard-deliveries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => {
        fetchDashboardData();
      })
      .subscribe();

    const jobsChannel = supabase
      .channel('dashboard-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        fetchDashboardData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(postsChannel);
      supabase.removeChannel(deliveriesChannel);
      supabase.removeChannel(jobsChannel);
    };
  }, []);

  const fetchDashboardData = async () => {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      // Fetch 24h metrics
      const [postsResult, deliveriesResult, jobsResult, recentActivityResult, accountsResult] = await Promise.all([
        supabase
          .from('posts')
          .select('*')
          .gte('created_at', twentyFourHoursAgo.toISOString()),
        supabase
          .from('deliveries')
          .select('*')
          .gte('created_at', twentyFourHoursAgo.toISOString()),
        supabase
          .from('jobs')
          .select('*')
          .gte('created_at', twentyFourHoursAgo.toISOString()),
        supabase
          .from('posts')
          .select('*, accounts(handle)')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('accounts')
          .select('*')
          .eq('enabled', true)
      ]);

      if (postsResult.error) throw postsResult.error;
      if (deliveriesResult.error) throw deliveriesResult.error;
      if (jobsResult.error) throw jobsResult.error;
      if (recentActivityResult.error) throw recentActivityResult.error;
      if (accountsResult.error) throw accountsResult.error;

      const posts = postsResult.data || [];
      const deliveries = deliveriesResult.data || [];
      const jobs = jobsResult.data || [];
      const recentPosts = recentActivityResult.data || [];
      const accounts = accountsResult.data || [];

      // Calculate metrics
      const translatedPosts = posts.filter(p => p.text_translated);
      const successfulDeliveries = deliveries.filter(d => d.status === 'posted');
      const failedJobs = jobs.filter(j => j.status === 'failed');
      const pendingJobs = jobs.filter(j => j.status === 'pending');

      setMetrics([
        { title: 'Posts Ingested (24h)', value: posts.length, icon: MessageSquare, description: 'New posts from RSS feeds', color: 'primary' },
        { title: 'Posts Translated (24h)', value: translatedPosts.length, icon: CheckCircle, description: 'Successfully processed by OpenAI', color: 'success' },
        { title: 'Posts Delivered (24h)', value: successfulDeliveries.length, icon: Send, description: 'Posted to Telegram channels', color: 'primary' },
        { title: 'Failed Jobs (24h)', value: failedJobs.length, icon: XCircle, description: 'Errors requiring attention', color: 'destructive' },
      ]);

      // Calculate pipeline health
      const totalJobs = jobs.length;
      const successfulJobs = jobs.filter(j => j.status === 'completed').length;
      const successRate = totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 100;

      // Calculate average end-to-end latency based on posted deliveries vs. post creation
      // We approximate latency as: time from post ingestion -> successful delivery
      const postCreatedAtById = new Map<string, string>();
      posts.forEach((p: any) => {
        if (p?.tweet_id && p?.created_at) {
          postCreatedAtById.set(p.tweet_id, p.created_at);
        }
      });

      const postedDeliveries = deliveries.filter(
        (d: any) => d?.status === 'posted' && d?.subject_type === 'post'
      );

      const latenciesSeconds: number[] = postedDeliveries
        .map((d: any) => {
          const postCreatedAt = postCreatedAtById.get(d.subject_id);
          if (!postCreatedAt) return null;
          const start = new Date(postCreatedAt).getTime();
          const end = new Date(d.created_at).getTime();
          const diffMs = end - start;
          if (!isFinite(diffMs) || diffMs < 0) return null;
          return diffMs / 1000; // seconds
        })
        .filter((s: number | null): s is number => s !== null);

      const avgLatencySec =
        latenciesSeconds.length > 0
          ? latenciesSeconds.reduce((a, b) => a + b, 0) / latenciesSeconds.length
          : 0;

      setPipelineHealth({
        successRate: Math.round(successRate * 10) / 10,
        avgLatency: Math.round(avgLatencySec * 10) / 10,
        activeFeeds: accounts.length,
        queueSize: pendingJobs.length,
        isOnline: true,
      });

      // Create activity feed
      const activities: ActivityItem[] = recentPosts.map(post => ({
        id: post.tweet_id,
        type: 'post',
        title: `New post from @${(post.accounts as any)?.handle || 'unknown'}`,
        description: post.text_original?.substring(0, 100) + '...' || 'No content',
        timestamp: post.created_at,
        status: post.text_translated ? 'success' : 'pending'
      }));

      setActivityFeed(activities);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setPipelineHealth(prev => ({ ...prev, isOnline: false }));
      toast({
        title: "Error loading dashboard",
        description: "Failed to fetch dashboard data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    setActionLoading(action);
    
    try {
      switch (action) {
        case 'view-failed':
          navigate('/monitoring?filter=failed');
          break;
          
        case 'retry-deliveries':
          const { data, error } = await supabase.functions.invoke('admin-retry', {
            body: { action: 'retry_failed_deliveries' }
          });
          
          if (error) throw error;
          
          toast({
            title: "Success",
            description: "Retry jobs created for failed deliveries",
          });
          
          fetchDashboardData();
          break;
          
        case 'test-pipeline':
          const testResult = await supabase.functions.invoke('admin-retry', {
            body: { action: 'test_webhook' }
          });
          
          if (testResult.error) throw testResult.error;
          
          toast({
            title: "Success",
            description: "Test pipeline completed successfully",
          });
          
          fetchDashboardData();
          break;
          
        default:
          throw new Error('Unknown action');
      }
    } catch (error) {
      console.error('Quick action error:', error);
      toast({
        title: "Error",
        description: `Failed to execute ${action}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge className="status-success">Success</Badge>;
      case 'pending':
        return <Badge className="status-pending">Pending</Badge>;
      case 'failed':
        return <Badge className="status-error">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div className="flex items-center space-x-2">
          <Activity className="w-6 h-6 text-primary animate-spin" />
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Loading Dashboard...</h1>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-4 bg-muted rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-muted rounded w-full"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Monitor your RSS → OpenAI → Telegram pipeline</p>
        </div>
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchDashboardData}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
          <div className="flex items-center space-x-2 glass-panel px-3 py-2 rounded-lg">
            {pipelineHealth.isOnline ? (
              <>
                <Wifi className="w-4 h-4 text-success animate-pulse" />
                <span className="text-sm text-glass-foreground">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-destructive" />
                <span className="text-sm text-destructive">Offline</span>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric, index) => (
          <Card key={metric.title} className="glass-card hover:glow-primary transition-all duration-300" style={{ animationDelay: `${index * 100}ms` }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-glass-foreground">
                {metric.title}
              </CardTitle>
              <metric.icon className={`w-4 h-4 ${
                metric.color === 'success' ? 'text-success' :
                metric.color === 'warning' ? 'text-warning' :
                metric.color === 'destructive' ? 'text-destructive' :
                'text-primary'
              }`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-glass-foreground">{metric.value.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Activity Feed and Quick Stats */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity Feed */}
        <div className="lg:col-span-2">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-xl font-display text-glass-foreground">Recent Activity</CardTitle>
              <CardDescription>Live feed of pipeline events</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activityFeed.length > 0 ? (
                  activityFeed.map((activity) => (
                    <div key={activity.id} className="flex items-start space-x-3 p-3 glass-panel rounded-lg hover:bg-glass-border/20 transition-colors">
                      <div className={`w-2 h-2 rounded-full mt-2 ${
                        activity.status === 'success' ? 'bg-success' :
                        activity.status === 'pending' ? 'bg-warning' :
                        'bg-destructive'
                      }`} />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-glass-foreground">{activity.title}</p>
                          {getStatusBadge(activity.status)}
                        </div>
                        <p className="text-xs text-muted-foreground">{activity.description}</p>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(activity.timestamp)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No recent activity</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Health & Quick Actions */}
        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-display text-glass-foreground flex items-center">
                {pipelineHealth.isOnline ? (
                  <Activity className="w-4 h-4 mr-2 text-success animate-pulse" />
                ) : (
                  <AlertTriangle className="w-4 h-4 mr-2 text-destructive" />
                )}
                Pipeline Health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Success Rate</span>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${
                    pipelineHealth.successRate >= 95 ? 'text-success' :
                    pipelineHealth.successRate >= 80 ? 'text-warning' : 'text-destructive'
                  }`}>
                    {pipelineHealth.successRate}%
                  </span>
                  <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        pipelineHealth.successRate >= 95 ? 'bg-success' :
                        pipelineHealth.successRate >= 80 ? 'bg-warning' : 'bg-destructive'
                      }`}
                      style={{ width: `${pipelineHealth.successRate}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Latency</span>
                <span className={`text-sm font-medium ${
                  pipelineHealth.avgLatency <= 2 ? 'text-success' :
                  pipelineHealth.avgLatency <= 5 ? 'text-warning' : 'text-destructive'
                }`}>
                  {pipelineHealth.avgLatency}s
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Feeds</span>
                <span className="text-sm font-medium text-glass-foreground">{pipelineHealth.activeFeeds}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Queue Size</span>
                <span className={`text-sm font-medium ${
                  pipelineHealth.queueSize === 0 ? 'text-success' :
                  pipelineHealth.queueSize <= 5 ? 'text-warning' : 'text-destructive'
                }`}>
                  {pipelineHealth.queueSize}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-display text-glass-foreground flex items-center">
                <Zap className="w-4 h-4 mr-2 text-primary" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleQuickAction('view-failed')}
                disabled={actionLoading === 'view-failed'}
              >
                {actionLoading === 'view-failed' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4 mr-2" />
                )}
                View Failed Jobs
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleQuickAction('retry-deliveries')}
                disabled={actionLoading === 'retry-deliveries'}
              >
                {actionLoading === 'retry-deliveries' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Retry Failed Deliveries
              </Button>
              
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleQuickAction('test-pipeline')}
                disabled={actionLoading === 'test-pipeline'}
              >
                {actionLoading === 'test-pipeline' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Test Pipeline
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
