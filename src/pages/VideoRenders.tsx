import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCheck, CheckCircle2, Clock, Film, HardDrive, Loader2, RefreshCw, Settings, TimerReset, Wand2, Wifi, WifiOff } from 'lucide-react';
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
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ManualVideoIntakePanel } from '@/components/video/ManualVideoIntakePanel';
import { VideoRenderDetailPanel } from '@/components/video/VideoRenderDetailPanel';
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { useAuth } from '@/contexts/AuthContext';
import {
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

const STATUS_OPTIONS: Array<{ value: string; label: string; statuses?: VideoRenderStatus[] }> = [
  { value: 'active', label: 'Active + issues', statuses: ['queued', 'running', 'failed', 'blocked'] },
  { value: 'queued', label: 'Queued', statuses: ['queued'] },
  { value: 'running', label: 'Running', statuses: ['running'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'failed', label: 'Failed', statuses: ['failed'] },
  { value: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { value: 'all', label: 'All', statuses: ['queued', 'running', 'completed', 'failed', 'blocked', 'expired'] },
];

const LARGE_SCREEN_QUERY = '(min-width: 1024px)';

function useIsLargeScreen(): boolean {
  const [isLargeScreen, setIsLargeScreen] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(LARGE_SCREEN_QUERY).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(LARGE_SCREEN_QUERY);
    const update = () => setIsLargeScreen(media.matches);
    update();
    media.addEventListener?.('change', update);
    media.addListener?.(update);
    return () => {
      media.removeEventListener?.('change', update);
      media.removeListener?.(update);
    };
  }, []);

  return isLargeScreen;
}

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
  const setReviewed = useSetVideoRenderReviewed();
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const queueItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const isLargeScreen = useIsLargeScreen();

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

  const selectRender = (renderId: string) => {
    setSelectedRenderId(renderId);
    setMobileDetailOpen(true);
  };

  const queueList = rows.length === 0 ? (
    <div className="p-8 text-center text-sm text-muted-foreground">No video renders match this filter.</div>
  ) : (
    <ul role="list" aria-label="Video render queue" className="divide-y divide-border">
      {rows.map((row: VideoRenderQueueRow, index) => {
        const isSelected = selected?.id === row.id;
        const author = row.post?.author_handle ? `@${row.post.author_handle}` : row.tweet_id;
        const title = row.post?.text_original || row.error || row.block_reason || row.id;
        const language = row.source_language && row.target_language
          ? `${row.source_language} to ${row.target_language}`
          : null;
        const metadata = [language, formatBytes(row.output_file_size) !== '-' ? formatBytes(row.output_file_size) : null]
          .filter(Boolean)
          .join(' · ');

        return (
          <li key={row.id}>
            <button
              type="button"
              aria-current={isSelected ? 'true' : undefined}
              data-render-id={row.id}
              ref={(element) => { queueItemRefs.current[row.id] = element; }}
              onClick={() => selectRender(row.id)}
              onKeyDown={(event) => {
                const isArrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
                const isBoundary = event.key === 'Home' || event.key === 'End';
                if (!isArrow && !isBoundary) return;
                event.preventDefault();
                const nextIndex = event.key === 'ArrowUp'
                  ? Math.max(0, index - 1)
                  : event.key === 'ArrowDown'
                    ? Math.min(rows.length - 1, index + 1)
                    : event.key === 'Home'
                      ? 0
                      : rows.length - 1;
                const nextRow = rows[nextIndex];
                if (!nextRow || nextRow.id === row.id) return;
                selectRender(nextRow.id);
                queueItemRefs.current[nextRow.id]?.focus();
              }}
              className={`group flex w-full min-w-0 items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${isSelected ? 'border-l-primary bg-primary/10' : 'border-l-transparent hover:bg-muted/40'}`}
            >
              <span className="mt-0.5 shrink-0">
                <Badge className={statusClass(row.status)}>{row.status}</Badge>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium group-hover:text-primary">{author}</span>
                  {row.reviewed_at && <span className="shrink-0 text-[11px] text-emerald-500">Reviewed</span>}
                </span>
                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{title}</span>
                <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{row.activity_at ? formatDistanceToNow(new Date(row.activity_at), { addSuffix: true }) : 'Age unknown'}</span>
                  {metadata && <span>{metadata}</span>}
                  {row.latest_feedback?.label && <span>{row.latest_feedback.label.replace(/_/g, ' ')}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const queueHeader = (
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
  );

  const queueContent = queue.isLoading ? (
    <div className="flex min-h-60 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  ) : queueList;

  const queueSummary = (
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
  );

  const detailContent = (
    <VideoRenderDetailPanel
      renderId={selected?.id ?? null}
      status={selected?.status ?? null}
      enabled={Boolean(selected)}
      isVisible={isVisible}
      readOnly={readOnly}
      mutationDisabledTitle={mutationDisabledTitle}
    />
  );

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

      <div role="region" aria-label="Render overview" className="grid min-w-0 overflow-hidden rounded-lg border bg-card/40 sm:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0 border-b p-3 sm:border-r xl:border-b-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <span>Mode</span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{overview.data?.config?.mode ?? '-'}</p>
        </div>
        <div className="min-w-0 border-b p-3 xl:border-b-0 xl:border-r" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {rendererState === 'healthy'
              ? <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              : rendererState === 'unavailable'
                ? <WifiOff className="h-3.5 w-3.5 text-red-500" />
                : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
            <span>Renderer</span>
          </div>
          <p className={`mt-1 truncate text-sm font-semibold ${rendererState === 'healthy' ? 'text-emerald-500' : rendererState === 'unavailable' ? 'text-red-500' : rendererState === 'blocked' || rendererState === 'stale' ? 'text-amber-500' : 'text-muted-foreground'}`}>{rendererHealthLabel(rendererState)}</p>
          {(typeof rendererHealth?.age_ms === 'number' || rendererHealth?.reported_status) && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {typeof rendererHealth?.age_ms === 'number' ? `Heartbeat ${formatServerAge(rendererHealth.age_ms)}` : `Reported ${rendererHealth.reported_status}`}
            </p>
          )}
        </div>
        <div className="min-w-0 border-b p-3 sm:border-r xl:border-b-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-blue-500" />
            <span>Queued</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{compactNumber(overview.data?.counts?.queued ?? 0)}</p>
        </div>
        <div className="min-w-0 border-b p-3 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <span>Issues</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{compactNumber(overview.data?.unreviewed_issues ?? ((overview.data?.counts?.failed ?? 0) + (overview.data?.counts?.blocked ?? 0)))}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{compactNumber(overview.data?.reviewed_issues ?? 0)} reviewed</p>
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TimerReset className="h-3.5 w-3.5 text-primary" />
            <span>Median total</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{formatMs(overview.data?.medians?.total_ms)}</p>
        </div>
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="manual">Manual Intake</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-0">
          <div className="mb-3 rounded-lg border bg-card/40 p-3">{queueHeader}</div>
          {isLargeScreen ? (
            <div className="h-[72vh] min-h-[28rem] max-h-[54rem]">
              <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 rounded-lg border">
                <ResizablePanel defaultSize={40} minSize={30} maxSize={50} className="min-h-0 min-w-0 overflow-hidden">
                  <Card className="glass-card h-full rounded-r-none border-0 shadow-none">
                    <CardContent className="h-full overflow-y-auto p-0">{queueContent}</CardContent>
                  </Card>
                </ResizablePanel>
                <ResizableHandle withHandle aria-label="Resize render queue and inspector" />
                <ResizablePanel defaultSize={60} minSize={50} className="min-h-0 min-w-0 overflow-hidden">
                  <div className="h-full min-h-0 space-y-3 overflow-y-auto p-3">
                    {queueSummary}
                    {detailContent}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          ) : (
            <div>
              {mobileDetailOpen && selected ? (
                <div className="space-y-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setMobileDetailOpen(false)}>
                    Back to queue
                  </Button>
                  {queueSummary}
                  {detailContent}
                </div>
              ) : (
                <Card className="glass-card">
                  <CardContent className="p-0">{queueContent}</CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-0">
          <ManualVideoIntakePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
