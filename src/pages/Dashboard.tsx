import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics';
import { DashboardActivity } from '@/components/dashboard/DashboardActivity';
import { DashboardHealth } from '@/components/dashboard/DashboardHealth';
import { useQueryClient } from '@tanstack/react-query';

export default function Dashboard() {
  const { data, isLoading, dataUpdatedAt } = useDashboardData();
  const queryClient = useQueryClient();

  if (isLoading || !data) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <div className="flex items-center space-x-2">
          <Activity className="w-6 h-6 text-primary animate-spin" />
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Loading Dashboard...</h1>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardHeader className="pb-3"><div className="h-4 bg-muted rounded w-3/4" /></CardHeader>
              <CardContent><div className="h-8 bg-muted rounded w-1/2 mb-2" /><div className="h-3 bg-muted rounded w-full" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const { metrics, health, activities } = data;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Monitor your RSS → OpenAI → Telegram pipeline</p>
        </div>
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard'] })} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh
          </Button>
          <div className="flex items-center space-x-2 glass-panel px-3 py-2 rounded-lg">
            {health.isOnline ? (
              <><Wifi className="w-4 h-4 text-success animate-pulse" /><span className="text-sm text-glass-foreground">Online</span></>
            ) : (
              <><WifiOff className="w-4 h-4 text-destructive" /><span className="text-sm text-destructive">Offline</span></>
            )}
          </div>
          <div className="text-xs text-muted-foreground">Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}</div>
        </div>
      </div>

      <DashboardMetrics metrics={metrics} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DashboardActivity activities={activities} />
        </div>
        <DashboardHealth health={health} />
      </div>
    </div>
  );
}
