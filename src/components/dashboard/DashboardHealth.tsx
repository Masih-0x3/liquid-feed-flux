import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, Zap, Eye, RefreshCw, Play, Loader2 } from 'lucide-react';
import type { PipelineHealth } from '@/hooks/useDashboardData';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  health: PipelineHealth;
}

export function DashboardHealth({ health }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleQuickAction = async (action: string) => {
    setActionLoading(action);
    try {
      switch (action) {
        case 'view-failed':
          navigate('/monitoring?filter=failed');
          break;
        case 'retry-deliveries': {
          const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'retry_failed_deliveries' } });
          if (error) throw error;
          toast({ title: 'Success', description: 'Retry jobs created for failed deliveries' });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          break;
        }
        case 'test-pipeline': {
          const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'test_webhook' } });
          if (error) throw error;
          toast({ title: 'Success', description: 'Test pipeline completed' });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          break;
        }
      }
    } catch {
      toast({ title: 'Error', description: `Failed to execute ${action}`, variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg font-display text-glass-foreground flex items-center">
            {health.isOnline ? <Activity className="w-4 h-4 mr-2 text-success animate-pulse" /> : <AlertTriangle className="w-4 h-4 mr-2 text-destructive" />}
            Pipeline Health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Success Rate</span>
            <div className="flex items-center space-x-2">
              <span className={`text-sm font-medium ${health.successRate >= 95 ? 'text-success' : health.successRate >= 80 ? 'text-warning' : 'text-destructive'}`}>
                {health.successRate}%
              </span>
              <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-500 ${health.successRate >= 95 ? 'bg-success' : health.successRate >= 80 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${health.successRate}%` }} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Avg Latency</span>
            <span className={`text-sm font-medium ${health.avgLatency <= 2 ? 'text-success' : health.avgLatency <= 5 ? 'text-warning' : 'text-destructive'}`}>{health.avgLatency}s</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Active Feeds</span>
            <span className="text-sm font-medium text-glass-foreground">{health.activeFeeds}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Queue Size</span>
            <span className={`text-sm font-medium ${health.queueSize === 0 ? 'text-success' : health.queueSize <= 5 ? 'text-warning' : 'text-destructive'}`}>{health.queueSize}</span>
          </div>
          <div className="border-t border-border/50 pt-3 mt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">X Posting</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Success Rate (24h)</span>
              <span className={`text-sm font-medium ${health.xSuccessRate >= 95 ? 'text-success' : health.xSuccessRate >= 80 ? 'text-warning' : 'text-destructive'}`}>{health.xSuccessRate}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Monthly Budget</span>
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-medium ${health.xBudgetUsedPct >= 90 ? 'text-destructive' : health.xBudgetUsedPct >= 70 ? 'text-warning' : 'text-success'}`}>
                  {health.xMonthlyPosts}/{health.xMonthlyBudget}
                </span>
                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${health.xBudgetUsedPct >= 90 ? 'bg-destructive' : health.xBudgetUsedPct >= 70 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, health.xBudgetUsedPct)}%` }} />
                </div>
              </div>
            </div>
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
          <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickAction('view-failed')} disabled={actionLoading === 'view-failed'}>
            {actionLoading === 'view-failed' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
            View Failed Jobs
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickAction('retry-deliveries')} disabled={actionLoading === 'retry-deliveries'}>
            {actionLoading === 'retry-deliveries' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Retry Failed Deliveries
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickAction('test-pipeline')} disabled={actionLoading === 'test-pipeline'}>
            {actionLoading === 'test-pipeline' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Test Pipeline
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
