import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, Eye, RefreshCw, Loader2, Settings, Wrench, Play, RotateCcw, Clock } from 'lucide-react';
import type { PipelineHealth, QueueBreakdown, XLocalUsage } from '@/hooks/useDashboardData';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface Props {
  health: PipelineHealth;
  queue: QueueBreakdown;
  xUsage: XLocalUsage;
}

export function DashboardHealth({ health, queue, xUsage }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['monitoring'] });
    queryClient.invalidateQueries({ queryKey: ['monitoring-overview'] });
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      switch (action) {
        case 'retry-deliveries': {
          const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'retry_failed_deliveries' } });
          if (error) throw error;
          toast({ title: 'Retry jobs queued', description: 'Failed delivery retry jobs were created.' });
          invalidate();
          break;
        }
        case 'reconcile-jobs': {
          const { error } = await supabase.functions.invoke('admin-actions', { body: { action: 'reconcile_stuck_jobs' } });
          if (error) throw error;
          toast({ title: 'Queue reconciled', description: 'Stuck jobs were checked without calling X.' });
          invalidate();
          break;
        }
        case 'close-stale-x': {
          const { error } = await supabase.functions.invoke('admin-actions', {
            body: { action: 'summarize_stale_x_pending', older_than_hours: 24, close: true },
          });
          if (error) throw error;
          toast({ title: 'Stale X rows closed', description: 'No retry or X API call was made.' });
          invalidate();
          break;
        }
        case 'test-pipeline': {
          const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'test_webhook' } });
          if (error) throw error;
          toast({ title: 'Live test sent', description: 'A production test webhook was invoked.' });
          invalidate();
          break;
        }
      }
    } catch {
      toast({ title: 'Action failed', description: `Failed to execute ${action}.`, variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const safeRoutes = [
    { label: 'Needs attention', icon: Eye, route: '/monitoring?filter=needs_attention' },
    { label: 'Ready to deliver', icon: Activity, route: '/monitoring?filter=ready_to_deliver' },
    { label: 'X automation', icon: Settings, route: '/settings#x-automation' },
  ];

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-display text-glass-foreground flex items-center">
            {health.isOnline ? <Activity className="w-4 h-4 mr-2 text-success animate-pulse" /> : <AlertTriangle className="w-4 h-4 mr-2 text-destructive" />}
            Health Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Success</p>
            <p className={health.successRate >= 80 ? 'font-semibold text-success' : 'font-semibold text-destructive'}>{health.successRate}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Latency</p>
            <p className="font-semibold text-glass-foreground">{health.avgLatency}s</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Queue</p>
            <p className={queue.pending > 0 ? 'font-semibold text-warning' : 'font-semibold text-success'}>{queue.pending} pending</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Running</p>
            <p className={queue.staleRunning > 0 ? 'font-semibold text-destructive' : 'font-semibold text-glass-foreground'}>{queue.running}{queue.staleRunning > 0 ? ` / ${queue.staleRunning} stale` : ''}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">X Budget</p>
            <p className={xUsage.budgetUsedPct >= 90 ? 'font-semibold text-destructive' : xUsage.budgetUsedPct >= 70 ? 'font-semibold text-warning' : 'font-semibold text-success'}>
              {xUsage.monthlyPosts}/{xUsage.monthlyBudget}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last reconcile</p>
            <p className="font-semibold text-glass-foreground">
              {health.lastReconcileAt ? new Date(health.lastReconcileAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not recorded'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-display text-glass-foreground flex items-center">
            <Wrench className="w-4 h-4 mr-2 text-primary" />
            Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {safeRoutes.map((item) => (
              <Button key={item.label} variant="outline" className="justify-start" onClick={() => navigate(item.route)}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </div>

          <div className="space-y-2 border-t border-border/50 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confirmed maintenance</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="justify-start" disabled={actionLoading === 'retry-deliveries'}>
                    {actionLoading === 'retry-deliveries' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Retry deliveries
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Queue failed delivery retries?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This creates retry jobs for failed Telegram deliveries. It does not call X.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleAction('retry-deliveries')}>Queue retries</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="justify-start" disabled={actionLoading === 'reconcile-jobs'}>
                    {actionLoading === 'reconcile-jobs' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    Reconcile jobs
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reconcile stuck jobs?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This releases expired leases and recreates missing internal jobs. It does not directly call X.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleAction('reconcile-jobs')}>Reconcile</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="justify-start" disabled={actionLoading === 'close-stale-x'}>
                    {actionLoading === 'close-stale-x' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
                    Close stale X pending
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close stale X pending rows?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This marks X pending rows older than 24 hours as skipped. It does not retry or call X.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleAction('close-stale-x')}>Close stale rows</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="justify-start border-destructive/40 text-destructive hover:text-destructive" disabled={actionLoading === 'test-pipeline'}>
                    {actionLoading === 'test-pipeline' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Live test pipeline
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send a production test webhook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This may create sample content in the live pipeline. Use only when testing production wiring.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleAction('test-pipeline')}>Send live test</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
