import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ActivityItem } from '@/hooks/useDashboardData';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

interface Props {
  activities: ActivityItem[];
}

type ActivityFilter = 'all' | 'failed' | 'pending' | 'delivered' | 'ingested';

const filters: Array<{ id: ActivityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'pending', label: 'Pending' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'ingested', label: 'Ingested' },
];

function getStatusBadge(status: string) {
  switch (status) {
    case 'success': return <Badge className="status-success">Success</Badge>;
    case 'pending': return <Badge className="status-pending">Pending</Badge>;
    case 'failed': return <Badge className="status-error">Failed</Badge>;
    case 'warning': return <Badge variant="outline" className="border-amber-500/40 text-amber-500">Warning</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function activityPriority(activity: ActivityItem): number {
  if (activity.status === 'failed') return 0;
  if (activity.status === 'warning') return 1;
  if (activity.status === 'pending') return 2;
  return 3;
}

function matchesFilter(activity: ActivityItem, filter: ActivityFilter): boolean {
  const title = activity.title.toLowerCase();
  if (filter === 'all') return true;
  if (filter === 'failed') return activity.status === 'failed' || activity.status === 'warning';
  if (filter === 'pending') return activity.status === 'pending';
  if (filter === 'delivered') {
    return activity.status === 'success' && (
      activity.kind === 'delivery' ||
      activity.kind === 'x' ||
      title.includes('posted') ||
      title.includes('delivered')
    );
  }
  return activity.kind === 'post' || title.includes('ingested');
}

export function DashboardActivity({ activities }: Props) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');
  const filteredActivities = useMemo(() => {
    return activities
      .filter((activity) => matchesFilter(activity, activeFilter))
      .sort((a, b) => {
        const priority = activityPriority(a) - activityPriority(b);
        if (priority !== 0) return priority;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  }, [activities, activeFilter]);

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-xl font-display text-glass-foreground">Recent Activity</CardTitle>
            <CardDescription>Live feed of pipeline events, sorted by operational risk.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Activity filters">
            {filters.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                variant={activeFilter === filter.id ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 rounded-full px-3 text-xs',
                  activeFilter === filter.id && 'bg-primary text-primary-foreground'
                )}
                onClick={() => setActiveFilter(filter.id)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {filteredActivities.length > 0 ? filteredActivities.map(activity => (
            <div
              key={activity.id}
              className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:border-primary/40 hover:bg-muted/30 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className={`mt-2 h-2 w-2 shrink-0 rounded-full ${activity.status === 'success' ? 'bg-success' : activity.status === 'pending' || activity.status === 'warning' ? 'bg-warning' : 'bg-destructive'}`} />
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium text-glass-foreground">{activity.title}</p>
                    {activity.kind && <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{activity.kind}</p>}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{activity.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 lg:justify-end">
                <p className="text-xs text-muted-foreground">{new Date(activity.timestamp).toLocaleString()}</p>
                {getStatusBadge(activity.status)}
                {activity.route && (
                  <Link to={activity.route} className="text-muted-foreground hover:text-primary" aria-label={`Open ${activity.title}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>
          )) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No recent activity</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
