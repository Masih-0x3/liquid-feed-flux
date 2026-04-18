import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, CheckCircle, Send, XCircle, Scissors, Sparkles, Twitter, ImageOff } from 'lucide-react';
import type { DashboardMetrics as Metrics } from '@/hooks/useDashboardData';

interface Props {
  metrics: Metrics;
}

const metricConfig = [
  { key: 'postsIngested' as const, title: 'Posts Ingested (24h)', icon: MessageSquare, description: 'New posts from RSS feeds', color: 'primary' },
  { key: 'postsTranslated' as const, title: 'Posts Translated (24h)', icon: CheckCircle, description: 'Successfully processed by OpenAI', color: 'success' },
  { key: 'postsDelivered' as const, title: 'Posts Delivered (24h)', icon: Send, description: 'Posted to Telegram channels', color: 'primary' },
  { key: 'failedJobs' as const, title: 'Failed Jobs (24h)', icon: XCircle, description: 'Errors requiring attention', color: 'destructive' },
  { key: 'postsHydrated24h' as const, title: 'Hydrated Tweets (24h)', icon: Sparkles, description: 'Full text fetched from X API', color: 'success' },
  { key: 'xApiCalls24h' as const, title: 'X API Calls (24h)', icon: Scissors, description: 'Hydration requests to X API v2', color: 'primary' },
  { key: 'xPosts24h' as const, title: 'X Posts (24h)', icon: Twitter, description: 'Successfully posted to X', color: 'success' },
  { key: 'xFailed24h' as const, title: 'X Failures (24h)', icon: XCircle, description: 'Failed X posting attempts', color: 'destructive' },
  { key: 'xMediaUploads24h' as const, title: 'X Media Uploads (24h)', icon: Sparkles, description: 'Images/videos uploaded to X', color: 'primary' },
  { key: 'xSkippedNoMedia24h' as const, title: 'X Skipped — No Media (24h)', icon: ImageOff, description: 'Posts skipped because media was missing', color: 'primary' },
] as const;

export function DashboardMetrics({ metrics }: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {metricConfig.map((m, index) => (
        <Card key={m.key} className="glass-card hover:glow-primary transition-all duration-300" style={{ animationDelay: `${index * 100}ms` }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm font-medium text-glass-foreground">{m.title}</CardTitle>
            <m.icon className={`w-4 h-4 ${m.color === 'success' ? 'text-success' : m.color === 'destructive' ? 'text-destructive' : 'text-primary'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-glass-foreground">{(metrics[m.key] ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{m.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
