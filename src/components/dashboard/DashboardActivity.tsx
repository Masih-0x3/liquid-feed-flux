import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
import type { ActivityItem } from '@/hooks/useDashboardData';

interface Props {
  activities: ActivityItem[];
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'success': return <Badge className="status-success">Success</Badge>;
    case 'pending': return <Badge className="status-pending">Pending</Badge>;
    case 'failed': return <Badge className="status-error">Failed</Badge>;
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
              <div className={`w-2 h-2 rounded-full mt-2 ${activity.status === 'success' ? 'bg-success' : activity.status === 'pending' ? 'bg-warning' : 'bg-destructive'}`} />
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-glass-foreground">{activity.title}</p>
                  {getStatusBadge(activity.status)}
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
