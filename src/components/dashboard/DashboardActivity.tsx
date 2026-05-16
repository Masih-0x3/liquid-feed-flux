import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ActivityItem } from '@/hooks/useDashboardData';

interface Props {
  activities: ActivityItem[];
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'success': return <Badge className="status-success">Success</Badge>;
    case 'pending': return <Badge className="status-pending">Pending</Badge>;
    case 'failed': return <Badge className="status-error">Failed</Badge>;
    case 'warning': return <Badge variant="outline" className="border-amber-500/40 text-amber-500">Warning</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

export function DashboardActivity({ activities }: Props) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-xl font-display text-glass-foreground">Recent Activity</CardTitle>
        <CardDescription>Live feed of pipeline events</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.length > 0 ? activities.map(activity => (
            <div key={activity.id} className="flex items-start space-x-3 p-3 glass-panel rounded-lg hover:bg-glass-border/20 transition-colors">
              <div className={`w-2 h-2 rounded-full mt-2 ${activity.status === 'success' ? 'bg-success' : activity.status === 'pending' || activity.status === 'warning' ? 'bg-warning' : 'bg-destructive'}`} />
              <div className="flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-glass-foreground">{activity.title}</p>
                    {activity.kind && <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{activity.kind}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(activity.status)}
                    {activity.route && (
                      <Link to={activity.route} className="text-muted-foreground hover:text-primary" aria-label={`Open ${activity.title}`}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{activity.description}</p>
                <p className="text-xs text-muted-foreground">{new Date(activity.timestamp).toLocaleString()}</p>
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
