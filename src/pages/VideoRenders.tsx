import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCheck, CheckCircle2, Clock, Film, HardDrive, Loader2, RefreshCw, Settings, TimerReset, Undo2, Wand2, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ManualVideoIntakePanel } from '@/components/video/ManualVideoIntakePanel';
import { VideoRenderDetailPanel } from '@/components/video/VideoRenderDetailPanel';
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { useAuth } from '@/contexts/AuthContext';
import {
  useRetryVideoRender,
  useSetVideoRenderReviewed,
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

function formatServerAge(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function rendererHealthLabel(state?: string | null): string {
  if (state === 'healthy') return 'Healthy';
  if (state === 'stale') return 'Stale';
  if (state === 'unavailable') return 'Unavailable';
  if (state === 'blocked') return 'Blocked';
  return 'Unknown';
}

function rendererHealthClass(state?: string | null): string {
  if (state === 'healthy') return 'mt-2 text-2xl font-semibold text-emerald-500';
  if (state === 'unavailable') return 'mt-2 text-2xl font-semibold text-red-500';
  if (state === 'blocked' || state === 'stale') return 'mt-2 text-2xl font-semibold text-amber-500';
  return 'mt-2 text-2xl font-semibold text-muted-foreground';
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
  const { isAdmin, role } = useAuth();
  const readOnly = role === 'read_only' && !isAdmin;
  const mutationDisabledTitle = readOnly ? 'Read-only access: render mutations are disabled.' : undefined;
  const [statusFilter, setStatusFilter] = useState('active');
  const [showReviewed, setShowReviewed] = useState(false);
  const statuses = STATUS_OPTIONS.find((item) => item.value === statusFilter)?.statuses;
  const isVisible = useDocumentVisibility();
  const overview = useVideoRenderOverview({ isVisible });
  const queue = useVideoRenderQueue(statuses, showReviewed ? 'all' : 'unreviewed', { isVisible });
  const retry = useRetryVideoRender();
  const setReviewed = useSetVideoRenderReviewed();
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);

  const rows = useMemo(() => queue.data?.rows ?? [], [queue.data?.rows]);
  const unreviewedIssueRows = useMemo(
    () => rows.filter((row) => (row.status === 'failed' || row.status === 'blocked') && !row.reviewed_at),
    [rows],
  );
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedRenderId) ?? rows[0] ?? null,
    [rows, selectedRenderId],
  );
  const rendererHealth = overview.data?.renderer_health ?? null;
  const rendererState = rendererHealth?.state ?? 'unknown';

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

      {readOnly && (
        <div role="note" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Read-only access. Review and status data remain available. Retry and review-state changes are disabled.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Mode</p>
              <Wand2 className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{overview.data?.config?.mode ?? '-'}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Renderer</p>
              {rendererState === 'healthy'
                ? <Wifi className="h-4 w-4 text-emerald-500" />
                : rendererState === 'unavailable'
                  ? <WifiOff className="h-4 w-4 text-red-500" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            </div>
            <p className={rendererHealthClass(rendererState)}>{rendererHealthLabel(rendererState)}</p>
            {typeof rendererHealth?.age_ms === 'number' && (
              <p className="mt-1 text-xs text-muted-foreground">Heartbeat age at server check: {formatServerAge(rendererHealth.age_ms)}</p>
            )}
            {rendererHealth?.reported_status && (
              <p className="mt-1 text-xs text-muted-foreground">Reported {rendererHealth.reported_status}</p>
            )}
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Queued</p>
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{compactNumber(overview.data?.counts?.queued ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Issues</p>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{compactNumber(overview.data?.unreviewed_issues ?? ((overview.data?.counts?.failed ?? 0) + (overview.data?.counts?.blocked ?? 0)))}</p>
            <p className="mt-1 text-xs text-muted-foreground">{compactNumber(overview.data?.reviewed_issues ?? 0)} reviewed</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Median total</p>
              <TimerReset className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-semibold">{formatMs(overview.data?.medians?.total_ms)}</p>
          </CardContent>
        </Card>
      </div>

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
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <label htmlFor="show-reviewed-renders" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                      <Switch id="show-reviewed-renders" checked={showReviewed} onCheckedChange={setShowReviewed} />
                      Show reviewed
                    </label>
                    {unreviewedIssueRows.length > 0 && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" title={mutationDisabledTitle} disabled={readOnly || setReviewed.isPending}>
                            {setReviewed.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                            Mark {unreviewedIssueRows.length} reviewed
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear these issues from the actionable queue?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This marks {unreviewedIssueRows.length} visible failed or blocked render{unreviewedIssueRows.length === 1 ? '' : 's'} as reviewed. Their real status and diagnostics stay intact. Use “Show reviewed” to restore any of them later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction disabled={!isAdmin} onClick={() => { if (isAdmin) setReviewed.mutate({ render_ids: unreviewedIssueRows.map((row) => row.id), reviewed: true }); }}>
                              Mark reviewed
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {queue.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">No video renders match this filter.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
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
                                {row.reviewed_at && <Badge variant="outline" className="block w-fit border-emerald-500/30 text-[10px] text-emerald-500">Reviewed</Badge>}
                                {row.latest_feedback?.label && <Badge variant="outline" className="block w-fit text-[10px]">{row.latest_feedback.label.replace(/_/g, ' ')}</Badge>}
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
                                {(row.status === 'failed' || row.status === 'blocked') && (
                                  <Button
                                    size="sm"
                                    variant={row.reviewed_at ? 'ghost' : 'outline'}
                                    title={mutationDisabledTitle}
                                    onClick={() => { if (isAdmin) setReviewed.mutate({ render_id: row.id, reviewed: !row.reviewed_at }); }}
                                    disabled={readOnly || setReviewed.isPending}
                                  >
                                    {setReviewed.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : row.reviewed_at ? <Undo2 className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                    {row.reviewed_at ? 'Restore' : 'Mark reviewed'}
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" title={mutationDisabledTitle} onClick={() => { if (isAdmin) retry.mutate({ render_id: row.id }); }} disabled={readOnly || retry.isPendingFor({ render_id: row.id })}>
                                  {retry.isPendingFor({ render_id: row.id }) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Card className="glass-card">
                <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>{compactNumber(overview.data?.counts?.completed ?? 0)} completed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-primary" />
                    <span>{formatBytes(overview.data?.output_bytes_7d)} in 7d</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-500" />
                    <span>{overview.data?.oldest_queued_at ? `Oldest ${formatDistanceToNow(new Date(overview.data.oldest_queued_at), { addSuffix: true })}` : 'No backlog'}</span>
                  </div>
                </CardContent>
              </Card>
              <VideoRenderDetailPanel
                renderId={selected?.id ?? null}
                status={selected?.status ?? null}
                enabled={Boolean(selected)}
                isVisible={isVisible}
                readOnly={readOnly}
                mutationDisabledTitle={mutationDisabledTitle}
              />
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
