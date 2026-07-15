import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Film, HardDrive, Loader2, RefreshCw, Settings, TimerReset, Wand2, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ManualVideoIntakePanel } from '@/components/video/ManualVideoIntakePanel';
import { VideoRenderDetailPanel } from '@/components/video/VideoRenderDetailPanel';
import { rendererStateFor, type RendererState } from '@/lib/videoRenderState';
import {
  useRetryVideoRender,
  useVideoRenderOverview,
  useVideoRenderQueue,
  type VideoRenderQueueRow,
  type VideoRenderStatus,
} from '@/hooks/useVideoRenderData';

function compactNumber(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '-';
}

function formatBytes(value: number | null | undefined): string {
  if (!value) return '-';
  const mb = value / 1_000_000;
  return mb < 1000 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${(mb / 1000).toFixed(2)} GB`;
}

function formatMs(value: number | null | undefined): string {
  if (!value) return '-';
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function statusClass(status?: string): string {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-500';
  if (status === 'queued' || status === 'running') return 'border-blue-500/30 bg-blue-500/15 text-blue-500';
  if (status === 'failed' || status === 'blocked') return 'border-red-500/30 bg-red-500/15 text-red-500';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

function rendererStateClasses(state: RendererState): string {
  if (state === 'online') return 'text-emerald-500';
  if (state === 'offline') return 'text-red-500';
  if (state === 'stale') return 'text-amber-500';
  return 'text-muted-foreground';
}

function rendererStateLabel(state: RendererState): string {
  if (state === 'checking') return 'Checking';
  if (state === 'stale') return 'Stale';
  if (state === 'unknown') return 'Unknown';
  return state === 'online' ? 'Online' : 'Offline';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const STATUS_OPTIONS: Array<{ value: string; label: string; statuses?: VideoRenderStatus[] }> = [
  { value: 'active', label: 'Active + issues', statuses: ['queued', 'running', 'failed', 'blocked'] },
  { value: 'queued', label: 'Queued', statuses: ['queued'] },
  { value: 'running', label: 'Running', statuses: ['running'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'failed', label: 'Failed', statuses: ['failed'] },
  { value: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { value: 'all', label: 'All', statuses: ['queued', 'running', 'completed', 'failed', 'blocked', 'expired'] },
];

export default function VideoRenders() {
  const [statusFilter, setStatusFilter] = useState('active');
  const statuses = STATUS_OPTIONS.find((item) => item.value === statusFilter)?.statuses;
  const overview = useVideoRenderOverview();
  const queue = useVideoRenderQueue(statuses);
  const retry = useRetryVideoRender();
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [retryingRenderIds, setRetryingRenderIds] = useState<Set<string>>(() => new Set());

  const rows = useMemo(() => queue.data?.rows ?? [], [queue.data?.rows]);
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedRenderId) ?? rows[0] ?? null,
    [rows, selectedRenderId],
  );
  const heartbeat = overview.data?.heartbeats?.[0] ?? null;
  const rendererState = rendererStateFor({
    isLoading: overview.isLoading,
    isError: overview.isError,
    hasOverview: Boolean(overview.data),
    heartbeat,
  });
  const overviewUnavailable = overview.isError && !overview.data;
  const overviewStale = overview.isError && Boolean(overview.data);
  const queueUnavailable = queue.isError && rows.length === 0;
  const queueStale = queue.isError && rows.length > 0;

  const retryRow = (renderId: string) => {
    setRetryingRenderIds((current) => new Set(current).add(renderId));
    retry.mutate(
      { render_id: renderId },
      {
        onSettled: () => {
          setRetryingRenderIds((current) => {
            if (!current.has(renderId)) return current;
            const next = new Set(current);
            next.delete(renderId);
            return next;
          });
        },
      },
    );
  };

  return (
    <div className="w-full space-y-4 animate-fade-in-up">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <Film className="h-7 w-7 text-primary" />
            Video Renders
          </h1>
          <p className="text-sm text-muted-foreground">Subtitle, delogo, watermark, and renderer queue control</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { overview.refetch(); queue.refetch(); }} disabled={overview.isFetching || queue.isFetching}>
            {overview.isFetching || queue.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings#video-rendering">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Mode</p>
              <Wand2 className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{overview.data?.config?.mode ?? 'Unknown'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Renderer</p>
              {rendererState === 'online' ? <Wifi className="h-4 w-4 text-emerald-500" /> : rendererState === 'checking' ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <WifiOff className={`h-4 w-4 ${rendererStateClasses(rendererState)}`} />}
            </div>
            <p className={`mt-2 text-2xl font-semibold ${rendererStateClasses(rendererState)}`}>{rendererStateLabel(rendererState)}</p>
            {heartbeat?.last_seen_at ? (
              <p className="mt-1 text-xs text-muted-foreground">{rendererState === 'stale' ? 'Last known ' : 'Seen '}{formatDistanceToNow(new Date(heartbeat.last_seen_at), { addSuffix: true })}</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{rendererState === 'unknown' ? 'No heartbeat has resolved yet' : 'Waiting for a heartbeat'}</p>
            )}
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Queued</p>
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{overview.data ? compactNumber(overview.data.counts?.queued ?? 0) : '—'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Issues</p>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{overview.data ? compactNumber((overview.data.counts?.failed ?? 0) + (overview.data.counts?.blocked ?? 0)) : '—'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Median total</p>
              <TimerReset className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{overview.data ? formatMs(overview.data.medians?.total_ms) : '—'}</p>
          </CardContent>
        </Card>
      </div>

      {(overviewUnavailable || overviewStale) && (
        <div className={`flex flex-col gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-start sm:justify-between ${overviewUnavailable ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/10'}`} role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${overviewUnavailable ? 'text-destructive' : 'text-amber-500'}`} />
            <div>
              <p className="font-medium text-glass-foreground">{overviewUnavailable ? 'Renderer overview is unavailable' : 'Renderer overview is stale'}</p>
              <p className="mt-1 text-muted-foreground">
                {overviewUnavailable
                  ? errorMessage(overview.error, 'Queue data may still be available, but current renderer health and counts could not be confirmed.')
                  : `Showing last-known renderer data from ${overview.dataUpdatedAt ? formatDistanceToNow(new Date(overview.dataUpdatedAt), { addSuffix: true }) : 'an earlier refresh'}. ${errorMessage(overview.error, '')}`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
            {overview.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Retry overview
          </Button>
        </div>
      )}

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="manual">Manual Intake</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-0">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Render Queue</CardTitle>
                    <CardDescription>Production rows from Supabase, not local golden outputs</CardDescription>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {queue.isLoading ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    Loading render rows…
                  </div>
                ) : queueUnavailable ? (
                  <div className="flex min-h-60 flex-col items-center justify-center gap-4 p-6 text-center">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <div>
                      <p className="font-medium text-glass-foreground">Render queue is unavailable</p>
                      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(queue.error, 'No queue rows could be loaded. This is not an empty queue.')}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void queue.refetch()} disabled={queue.isFetching}>
                      {queue.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Retry queue
                    </Button>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">The queue is healthy but no video renders match this filter.</div>
                ) : (
                  <div className="space-y-3 p-3">
                    {queueStale && (
                      <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-start sm:justify-between" role="alert">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <span>Showing last-known queue rows while the latest refresh failed: {errorMessage(queue.error, 'retry to confirm current status.')}</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void queue.refetch()} disabled={queue.isFetching}>
                          Retry queue
                        </Button>
                      </div>
                    )}
                  <div className="overflow-x-auto rounded-md border border-border/60">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Post</TableHead>
                          <TableHead>Lang</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row: VideoRenderQueueRow) => (
                          <TableRow key={row.id} className={selected?.id === row.id ? 'bg-primary/5' : undefined}>
                            <TableCell>
                              <div className="space-y-1">
                                <Badge className={statusClass(row.status)}>{row.status}</Badge>
                                {row.latest_feedback?.label && <Badge variant="outline" className="block w-fit text-[10px]">{row.latest_feedback.label.replaceAll('_', ' ')}</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              <button type="button" onClick={() => setSelectedRenderId(row.id)} className="block w-full text-left hover:text-primary">
                                <p className="truncate font-medium">{row.post?.author_handle ? `@${row.post.author_handle}` : row.tweet_id}</p>
                                <p className="line-clamp-2 text-xs text-muted-foreground">{row.post?.text_original || row.error || row.block_reason || row.id}</p>
                              </button>
                            </TableCell>
                            <TableCell className="text-sm">{row.source_language || '-'} → {row.target_language || '-'}</TableCell>
                            <TableCell className="text-sm">{row.activity_at ? formatDistanceToNow(new Date(row.activity_at), { addSuffix: true }) : '-'}</TableCell>
                            <TableCell className="text-sm">{formatBytes(row.output_file_size)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setSelectedRenderId(row.id)}>Review</Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => retryRow(row.id)}
                                  disabled={retryingRenderIds.has(row.id)}
                                  aria-label={`Retry render for ${row.post?.author_handle ? `@${row.post.author_handle}` : row.tweet_id}`}
                                  title="Retry this render"
                                >
                                  {retryingRenderIds.has(row.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Card className="glass-card">
                <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>{overview.data ? `${compactNumber(overview.data.counts?.completed ?? 0)} completed` : 'Completed count unavailable'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-primary" />
                    <span>{overview.data ? `${formatBytes(overview.data.output_bytes_7d)} in 7d` : 'Output total unavailable'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-500" />
                    <span>{overview.data ? (overview.data.oldest_queued_at ? `Oldest ${formatDistanceToNow(new Date(overview.data.oldest_queued_at), { addSuffix: true })}` : 'Healthy-empty queue') : 'Backlog status unavailable'}</span>
                  </div>
                </CardContent>
              </Card>
              <VideoRenderDetailPanel renderId={selected?.id ?? null} enabled={Boolean(selected)} compact />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="mt-0">
          <ManualVideoIntakePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
