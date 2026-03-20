import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, CheckCircle, Send, XCircle } from 'lucide-react';
import type { DashboardMetrics as Metrics } from '@/hooks/useDashboardData';

interface Props {
  metrics: Metrics;
}

const metricConfig = [
  { key: 'postsIngested' as const, title: 'Posts Ingested (24h)', icon: MessageSquare, description: 'New posts from RSS feeds', color: 'primary' },
  { key: 'postsTranslated' as const, title: 'Posts Translated (24h)', icon: CheckCircle, description: 'Successfully processed by OpenAI', color: 'success' },
  { key: 'postsDelivered' as const, title: 'Posts Delivered (24h)', icon: Send, description: 'Posted to Telegram channels', color: 'primary' },
  { key: 'failedJobs' as const, title: 'Failed Jobs (24h)', icon: XCircle, description: 'Errors requiring attention', color: 'destructive' },
] as const;

export function DashboardMetrics({ metrics }: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {metricConfig.map((m, index) => (
        <Card key={m.key} className="glass-card hover:glow-primary transition-all duration-300" style={{ animationDelay: `${index * 100}ms` }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium text-glass-foreground">{m.title}</CardTitle>
            <m.icon className={`w-4 h-4 ${m.color === 'success' ? 'text-success' : m.color === 'destructive' ? 'text-destructive' : 'text-primary'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-glass-foreground">{metrics[m.key].toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{m.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
