import { FormEvent, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  useCancelManualVideoIntake,
  useCreateManualVideoIntake,
  useManualVideoIntakeDetail,
  useManualVideoIntakeList,
  usePostManualVideoIntake,
  useRefreshManualVideoIntake,
  useSaveManualVideoCaption,
  useSetManualVideoDuplicateOverride,
  type ManualVideoIntakeRow,
  type ManualVideoSnapshot,
} from '@/hooks/useManualVideoIntakeData';

function statusClass(status?: string | null): string {
  if (status === 'posted' || status === 'ready') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-500';
  if (status === 'rendering' || status === 'render_queued' || status === 'media_downloading' || status === 'translating') return 'border-blue-500/30 bg-blue-500/15 text-blue-500';
  if (status === 'blocked' || status === 'failed') return 'border-red-500/30 bg-red-500/15 text-red-500';
  if (status === 'canceled') return 'border-muted-foreground/30 bg-muted text-muted-foreground';
  return 'border-amber-500/30 bg-amber-500/15 text-amber-500';
}

function safeBoolean(value: unknown): boolean {
  return value === true;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
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

function renderLabel(row: NonNullable<ManualVideoSnapshot['renders']>[number]): string {
  const status = row.status ? row.status.replaceAll('_', ' ') : 'unknown';
  const language = row.source_language && row.target_language ? ` · ${row.source_language} to ${row.target_language}` : '';
  return `${status}${language} · ${row.id.slice(0, 8)}`;
}

function rowTitle(row: ManualVideoIntakeRow): string {
  return row.source_handle ? `@${row.source_handle}` : row.tweet_id;
}

export function ManualVideoIntakePanel() {
  const [tweetUrl, setTweetUrl] = useState('');
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [selectedRenderId, setSelectedRenderId] = useState<string>('');
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const list = useManualVideoIntakeList();
  const createIntake = useCreateManualVideoIntake();
  const refreshIntake = useRefreshManualVideoIntake();
  const saveCaption = useSaveManualVideoCaption();
  const setDuplicateOverride = useSetManualVideoDuplicateOverride();
  const cancelIntake = useCancelManualVideoIntake();
  const postIntake = usePostManualVideoIntake();

  const rows = useMemo(() => list.data?.rows ?? [], [list.data?.rows]);
  const selectedFromList = useMemo(
    () => rows.find((row) => row.id === selectedIntakeId) ?? rows[0] ?? null,
    [rows, selectedIntakeId],
  );
  const activeIntakeId = selectedIntakeId ?? selectedFromList?.id ?? null;
  const detail = useManualVideoIntakeDetail({ intakeId: activeIntakeId, enabled: Boolean(activeIntakeId) });
  const snapshot = detail.data?.ok !== false ? detail.data : null;
  const intake = snapshot?.intake ?? selectedFromList;

  const completedRenders = useMemo(
    () => (snapshot?.renders ?? []).filter((row) => row.status === 'completed' && row.output_storage_path),
    [snapshot?.renders],
  );
  const defaultRender = completedRenders[0] ?? snapshot?.latest_render ?? null;
  const selectedRender = (snapshot?.renders ?? []).find((row) => row.id === selectedRenderId) ?? defaultRender;
  const previewUrl = snapshot?.preview.output_signed_url || snapshot?.preview.source_signed_url || null;
  const isOutputPreview = Boolean(snapshot?.preview.output_signed_url);
  const safety = snapshot?.safety ?? {};
  const duplicateBlocked = safeBoolean(safety.duplicate_blocked);
  const xPostingEnabled = safeBoolean(safety.x_posting_enabled);
  const xAllowVideo = safeBoolean(safety.x_allow_video);
  const captionTooLong = safeBoolean(safety.caption_too_long) || (snapshot ? captionDraft.length > snapshot.caption.max_chars : false);
  const hasOutputVideo = Boolean(snapshot?.preview.output_signed_url);
  const isPosting = postIntake.isPending;
  const readyToPost = Boolean(
    snapshot &&
      intake &&
      selectedRender?.id &&
      hasOutputVideo &&
      xPostingEnabled &&
      xAllowVideo &&
      captionDraft.trim() &&
      !captionTooLong &&
      intake.status !== 'posted' &&
      intake.status !== 'canceled' &&
      (!duplicateBlocked || intake.duplicate_override === true),
  );

  useEffect(() => {
    if (!selectedIntakeId && rows[0]?.id) setSelectedIntakeId(rows[0].id);
  }, [rows, selectedIntakeId]);

  useEffect(() => {
    if (!snapshot) return;
    setCaptionDraft(snapshot.caption.effective ?? '');
    setOverrideChecked(snapshot.intake.duplicate_override === true);
    setOverrideReason(snapshot.intake.duplicate_override_reason ?? '');
  }, [snapshot?.intake.id, snapshot?.caption.effective, snapshot?.intake.duplicate_override, snapshot?.intake.duplicate_override_reason, snapshot]);

  useEffect(() => {
    if (defaultRender?.id) setSelectedRenderId(defaultRender.id);
  }, [defaultRender?.id]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await createIntake.mutateAsync({ url: tweetUrl });
    setSelectedIntakeId(result.intake.id);
    setTweetUrl('');
  }

  async function handleSaveCaption() {
    if (!intake) return;
    const result = await saveCaption.mutateAsync({ intake_id: intake.id, caption: captionDraft });
    setCaptionDraft(result.caption.effective);
  }

  async function handleSaveOverride() {
    if (!intake) return;
    const result = await setDuplicateOverride.mutateAsync({
      intake_id: intake.id,
      enabled: overrideChecked,
      reason: overrideChecked ? overrideReason : undefined,
    });
    setOverrideChecked(result.intake.duplicate_override === true);
    setOverrideReason(result.intake.duplicate_override_reason ?? '');
  }

  async function handlePost() {
    if (!intake || !selectedRender?.id) return;
    await postIntake.mutateAsync({
      intake_id: intake.id,
      render_id: selectedRender.id,
      caption: captionDraft,
    });
    await detail.refetch();
    await list.refetch();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-4 w-4 text-primary" />
            Manual Intake
          </CardTitle>
          <CardDescription>Tweet URL to reviewed video post</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} className="space-y-2">
            <Label htmlFor="manual-tweet-url">Tweet URL</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="manual-tweet-url"
                value={tweetUrl}
                onChange={(event) => setTweetUrl(event.target.value)}
                placeholder="https://x.com/account/status/123"
                className="min-w-0"
              />
              <Button type="submit" disabled={createIntake.isPending || !tweetUrl.trim()} className="sm:w-28">
                {createIntake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Recent</Label>
              <Button variant="ghost" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}>
                {list.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            <div className="max-h-[520px] overflow-y-auto rounded-md border">
              {list.isLoading ? (
                <div className="flex min-h-28 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">No manual intakes yet.</div>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedIntakeId(row.id)}
                    className={`block w-full border-b p-3 text-left last:border-b-0 hover:bg-muted/40 ${activeIntakeId === row.id ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{rowTitle(row)}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.tweet_id}</p>
                      </div>
                      <Badge className={statusClass(row.status)}>{row.status.replaceAll('_', ' ')}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{row.updated_at ? formatDistanceToNow(new Date(row.updated_at), { addSuffix: true }) : '-'}</span>
                      {row.posted_x_tweet_id && <span className="text-emerald-500">posted</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!intake ? (
          <Card className="glass-card border-dashed">
            <CardContent className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
              Select or run an intake.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {intake.source_handle ? `@${intake.source_handle}` : intake.tweet_id}
                      <Badge className={statusClass(intake.status)}>{intake.status.replaceAll('_', ' ')}</Badge>
                    </CardTitle>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="break-all">{intake.tweet_id}</span>
                      <a href={intake.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refreshIntake.mutate({ intake_id: intake.id })}
                      disabled={refreshIntake.isPending}
                    >
                      {refreshIntake.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Refresh
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelIntake.mutate({ intake_id: intake.id })}
                      disabled={cancelIntake.isPending || intake.status === 'posted' || intake.status === 'canceled'}
                    >
                      {cancelIntake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {detail.isFetching && !snapshot ? (
                  <div className="flex min-h-72 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <>
                    {(intake.last_error || safeString(safety.lookup_warning)) && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Blocked</AlertTitle>
                        <AlertDescription>{intake.last_error || safeString(safety.lookup_warning)}</AlertDescription>
                      </Alert>
                    )}

                    {duplicateBlocked && intake.duplicate_override !== true && (
                      <Alert className="border-amber-500/40 bg-amber-500/10">
                        <ShieldAlert className="h-4 w-4 text-amber-500" />
                        <AlertTitle>Duplicate Gate</AlertTitle>
                        <AlertDescription>
                          {safeString(safety.dedupe && typeof safety.dedupe === 'object' ? (safety.dedupe as Record<string, unknown>).result && ((safety.dedupe as Record<string, unknown>).result as Record<string, unknown>).reason : null) ?? 'Duplicate review is blocking posting.'}
                        </AlertDescription>
                      </Alert>
                    )}

                    {(!xPostingEnabled || !xAllowVideo) && (
                      <Alert className="border-blue-500/40 bg-blue-500/10">
                        <Ban className="h-4 w-4 text-blue-500" />
                        <AlertTitle>X Posting Guard</AlertTitle>
                        <AlertDescription>
                          {!xPostingEnabled ? 'X posting is disabled.' : 'Video posting is disabled in X posting settings.'}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>{isOutputPreview ? 'Processed Output' : 'Source Video'}</Label>
                          {selectedRender && (
                            <Badge variant="outline">
                              {selectedRender.status} · {formatBytes(selectedRender.output_file_size)}
                            </Badge>
                          )}
                        </div>
                        {previewUrl ? (
                          <video src={previewUrl} controls className="aspect-video w-full rounded-md border bg-black object-contain" />
                        ) : (
                          <div className="flex aspect-video items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground">
                            Video preview unavailable.
                          </div>
                        )}
                        <div className="grid gap-2 text-sm sm:grid-cols-3">
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Render</p>
                            <p className="truncate font-medium">{selectedRender?.id ?? '-'}</p>
                          </div>
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Duration</p>
                            <p className="font-medium">{formatMs(selectedRender?.duration_ms ?? null)}</p>
                          </div>
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Media rows</p>
                            <p className="font-medium">{snapshot?.media.length ?? 0}</p>
                          </div>
                        </div>
                        {completedRenders.length > 1 && (
                          <div className="grid gap-1">
                            <Label>Render Selection</Label>
                            <Select value={selectedRenderId} onValueChange={setSelectedRenderId}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {completedRenders.map((row) => (
                                  <SelectItem key={row.id} value={row.id}>{renderLabel(row)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="manual-caption">Caption</Label>
                            <span className={captionTooLong ? 'text-xs text-red-500' : 'text-xs text-muted-foreground'}>
                              {captionDraft.length}/{snapshot?.caption.max_chars ?? 280}
                            </span>
                          </div>
                          <Textarea
                            id="manual-caption"
                            value={captionDraft}
                            onChange={(event) => setCaptionDraft(event.target.value)}
                            dir="auto"
                            className="min-h-40 resize-y"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSaveCaption}
                              disabled={saveCaption.isPending || !captionDraft.trim() || captionDraft === snapshot?.caption.effective}
                            >
                              {saveCaption.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                              Save
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                          <div className="flex items-start gap-2">
                            <Checkbox
                              id="manual-duplicate-override"
                              checked={overrideChecked}
                              onCheckedChange={(checked) => setOverrideChecked(checked === true)}
                            />
                            <div className="grid gap-1">
                              <Label htmlFor="manual-duplicate-override">Duplicate override</Label>
                              <p className="text-xs text-muted-foreground">
                                {intake.duplicate_override ? 'Enabled' : duplicateBlocked ? 'Required to post this duplicate.' : 'Off'}
                              </p>
                            </div>
                          </div>
                          {overrideChecked && (
                            <Textarea
                              value={overrideReason}
                              onChange={(event) => setOverrideReason(event.target.value)}
                              placeholder="Reason"
                              className="min-h-20"
                            />
                          )}
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSaveOverride}
                              disabled={setDuplicateOverride.isPending || (overrideChecked && !overrideReason.trim())}
                            >
                              {setDuplicateOverride.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                              Save override
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button disabled={!readyToPost || isPosting} className="w-full">
                                {isPosting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Post to X
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Post this video to X?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This creates a public X post from the selected rendered video and saved caption.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handlePost}>Post</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          {readyToPost ? (
                            <div className="flex items-center gap-2 text-xs text-emerald-500">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Ready
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {captionTooLong ? 'Caption too long' : !hasOutputVideo ? 'Waiting for output video' : duplicateBlocked && intake.duplicate_override !== true ? 'Duplicate blocked' : 'Not ready'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {snapshot?.preview.subtitle_text && (
                      <div className="rounded-md border bg-muted/20 p-3">
                        <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Subtitle</p>
                        <pre dir="auto" className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5">{snapshot.preview.subtitle_text}</pre>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
