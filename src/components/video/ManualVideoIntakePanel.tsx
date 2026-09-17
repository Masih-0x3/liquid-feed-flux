import { isSupportedXPostUrl } from '@/lib/xPostUrl';
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
import { useAuth } from '@/contexts/AuthContext';
import { AuthorizedMedia } from '@/components/media/AuthorizedMedia';
import { ConfirmMediaAction } from '@/components/media/ConfirmMediaAction';

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
  const status = row.status ? row.status.replace(/_/g, ' ') : 'unknown';
  const language = row.source_language && row.target_language ? ` · ${row.source_language} to ${row.target_language}` : '';
  return `${status}${language} · ${row.id.slice(0, 8)}`;
}

function rowTitle(row: ManualVideoIntakeRow): string {
  return row.source_handle ? `@${row.source_handle}` : row.tweet_id;
}

type PendingManualPostSnapshot = {
  intakeId: string;
  renderId: string;
  caption: string;
  destination: string;
};

export function ManualVideoIntakePanel() {
  const { isAdmin, role } = useAuth();
  const readOnly = role === 'read_only' && !isAdmin;
  const mutationDisabledTitle = readOnly ? 'Read-only access: manual intake changes are disabled.' : undefined;
  const [tweetUrl, setTweetUrl] = useState('');
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [selectedRenderId, setSelectedRenderId] = useState<string>('');
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [postSnapshot, setPostSnapshot] = useState<PendingManualPostSnapshot | null>(null);
  const [intakeRequest, setIntakeRequest] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

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
  const detail = useManualVideoIntakeDetail({
    intakeId: activeIntakeId,
    renderId: selectedRenderId || null,
    enabled: Boolean(activeIntakeId),
  });
  const snapshot = detail.data?.ok !== false ? detail.data : null;
  const intake = snapshot?.intake ?? selectedFromList;
  const snapshotIntakeId = snapshot?.intake.id;
  const savedCaption = snapshot?.caption.effective;
  const savedDuplicateOverride = snapshot?.intake.duplicate_override;
  const savedDuplicateOverrideReason = snapshot?.intake.duplicate_override_reason;

  const completedRenders = useMemo(
    () => (snapshot?.renders ?? []).filter((row) => row.status === 'completed' && row.has_output),
    [snapshot?.renders],
  );
  const defaultRender = completedRenders[0] ?? null;
  const selectedRender = (snapshot?.renders ?? []).find((row) => row.id === selectedRenderId) ?? null;
  const safety = snapshot?.safety ?? {};
  const duplicateBlocked = safeBoolean(safety.duplicate_blocked);
  const xPostingEnabled = safeBoolean(safety.x_posting_enabled);
  const xAllowVideo = safeBoolean(safety.x_allow_video);
  const captionTooLong = safeBoolean(safety.caption_too_long) || (snapshot ? captionDraft.length > snapshot.caption.max_chars : false);
  const hasOutputVideo = Boolean(
    selectedRender?.id &&
      snapshot?.preview.render_id === selectedRender.id &&
      snapshot.preview.output_available,
  );
  const hasUnsavedCaption = Boolean(
    snapshot && captionDraft.trim() !== snapshot.caption.effective.trim(),
  );
  const isPosting = postIntake.isPending;
  const readyToPost = Boolean(
    snapshot &&
      intake &&
      selectedRender?.id &&
      hasOutputVideo &&
      xPostingEnabled &&
      xAllowVideo &&
      captionDraft.trim() &&
      !hasUnsavedCaption &&
      !captionTooLong &&
      intake.status !== 'posted' &&
      intake.status !== 'canceled' &&
      (!duplicateBlocked || intake.duplicate_override === true),
  );

  useEffect(() => {
    if (!selectedIntakeId && rows[0]?.id) setSelectedIntakeId(rows[0].id);
  }, [rows, selectedIntakeId]);

  useEffect(() => {
    if (!snapshotIntakeId || savedCaption === undefined) return;
    setCaptionDraft(savedCaption);
    setOverrideChecked(savedDuplicateOverride === true);
    setOverrideReason(savedDuplicateOverrideReason ?? '');
  }, [savedCaption, savedDuplicateOverride, savedDuplicateOverrideReason, snapshotIntakeId]);

  useEffect(() => {
    setSelectedRenderId((current) => (
      completedRenders.some((row) => row.id === current)
        ? current
        : defaultRender?.id ?? ''
    ));
  }, [completedRenders, defaultRender?.id]);

  useEffect(() => {
    setPostSnapshot(null);
  }, [snapshot?.intake.id]);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    if (!isSupportedXPostUrl(tweetUrl)) {
      setUrlError('Enter an X or Twitter status URL with its post ID.');
      return;
    }
    setUrlError(null);
    setIntakeRequest(tweetUrl.trim());
  }

  async function confirmCreate() {
    if (!isAdmin || !intakeRequest) return;
    try {
      const result = await createIntake.mutateAsync({ url: intakeRequest });
      setSelectedIntakeId(result.intake.id);
      setTweetUrl('');
      setIntakeRequest(null);
    } catch { /* The mutation hook displays the failure; retain the requested URL. */ }
  }

  async function handleSaveCaption() {
    if (!isAdmin) return;
    if (!intake) return;
    const result = await saveCaption.mutateAsync({ intake_id: intake.id, caption: captionDraft });
    setCaptionDraft(result.caption.effective);
  }

  async function handleSaveOverride() {
    if (!isAdmin) return;
    if (!intake) return;
    const result = await setDuplicateOverride.mutateAsync({
      intake_id: intake.id,
      enabled: overrideChecked,
      reason: overrideChecked ? overrideReason : undefined,
    });
    setOverrideChecked(result.intake.duplicate_override === true);
    setOverrideReason(result.intake.duplicate_override_reason ?? '');
  }

  function openPostConfirmation() {
    if (!isAdmin) return;
    if (!intake || !selectedRender?.id || !snapshot || !readyToPost) return;
    setPostSnapshot({
      intakeId: intake.id,
      renderId: selectedRender.id,
      caption: snapshot.caption.effective.trim(),
      destination: snapshot.destination?.handle
        ? `X · @${snapshot.destination.handle} (cached account identity)`
        : 'X · configured account (account identity is unavailable)',
    });
  }

  async function handlePost() {
    if (!isAdmin) return;
    if (!postSnapshot) return;
    try {
      await postIntake.mutateAsync({
        intake_id: postSnapshot.intakeId,
        render_id: postSnapshot.renderId,
        caption: postSnapshot.caption,
      });
      setPostSnapshot(null);
      await detail.refetch();
      await list.refetch();
    } catch {
      // The mutation hook renders the actionable failure toast. Keep the frozen confirmation open.
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
      {readOnly && (
        <div role="note" className="xl:col-span-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Read-only access. Manual intake, caption, override, and posting changes are disabled. Existing status remains available. Media previews and downloads require administrator access.
        </div>
      )}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-4 w-4 text-primary" />
            Manual Intake
          </CardTitle>
          <CardDescription>Tweet URL to reviewed video post</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreate} noValidate className="space-y-2">
            <Label htmlFor="manual-tweet-url">Tweet URL</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="manual-tweet-url"
                value={tweetUrl}
                onChange={(event) => setTweetUrl(event.target.value)}
                placeholder="https://x.com/account/status/123"
                className="min-w-0"
                type="url" aria-invalid={Boolean(urlError)} aria-describedby="manual-intake-help manual-intake-error"
                disabled={readOnly || createIntake.isPending}
              />
              <Button type="submit" disabled={readOnly || createIntake.isPending || !tweetUrl.trim()} title={mutationDisabledTitle} className="shrink-0">
                {createIntake.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Preparing video" /> : 'Prepare video'}
              </Button>
            </div>
            <p id="manual-intake-help" className="text-xs text-muted-foreground">Preparation may call X and paid translation or video providers. Posting requires a separate review and confirmation.</p>
            <p id="manual-intake-error" role={urlError ? 'alert' : undefined} className="text-sm text-destructive">{urlError}</p>
          </form>
          <AlertDialog open={Boolean(intakeRequest)} onOpenChange={(open) => { if (!open && !createIntake.isPending) setIntakeRequest(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Prepare this video?</AlertDialogTitle>
                <AlertDialogDescription>Fetch the source post, translate its caption and queue video processing. These steps may consume paid provider resources. This action does not publish the manual post.</AlertDialogDescription>
              </AlertDialogHeader>
              <p className="break-all text-sm">{intakeRequest}</p>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={createIntake.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={readOnly || createIntake.isPending} onClick={(event) => { event.preventDefault(); void confirmCreate(); }}>Prepare video</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Recent</Label>
              <Button aria-label="Refresh recent intakes" variant="ghost" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}>
                {list.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            <div className="max-h-[520px] overflow-y-auto rounded-md border">
              {list.isLoading ? (
                <div role="status" aria-label="Loading recent intakes" className="flex min-h-28 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : list.error || list.data?.ok === false ? (
                <p role="alert" className="p-4 text-sm text-destructive">Recent intakes could not be loaded. Use Refresh recent intakes to retry.</p>
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
                      <Badge className={statusClass(row.status)}>{row.status.replace(/_/g, ' ')}</Badge>
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
                      <Badge className={statusClass(intake.status)}>{intake.status.replace(/_/g, ' ')}</Badge>
                    </CardTitle>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="break-all">{intake.tweet_id}</span>
                      <a href={intake.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ConfirmMediaAction key={`refresh:${intake.id}`} title="Process this intake again?" description="Refresh this post and its processing state. This can re-run deduplication, translation and rendering through paid providers; it does not publish the manual post." actionLabel="Process again" disabled={readOnly || refreshIntake.isPending} onConfirm={() => { if (isAdmin) refreshIntake.mutate({ intake_id: intake.id }); }}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={readOnly || refreshIntake.isPending}
                      title={mutationDisabledTitle}
                    >
                      {refreshIntake.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Process again
                    </Button>
                    </ConfirmMediaAction>
                    <ConfirmMediaAction key={`cancel:${intake.id}`} title="Cancel this manual intake?" description="Cancel this intake before posting. Processing that has already started may still complete, but this manual intake will no longer be available to post." actionLabel="Cancel intake" disabled={readOnly || cancelIntake.isPending || intake.status === 'posted' || intake.status === 'canceled'} onConfirm={() => { if (isAdmin) cancelIntake.mutate({ intake_id: intake.id }); }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Cancel manual intake"
                      disabled={readOnly || cancelIntake.isPending || intake.status === 'posted' || intake.status === 'canceled'}
                      title={mutationDisabledTitle}
                    >
                      {cancelIntake.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    </Button>
                    </ConfirmMediaAction>
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
                    {(detail.error || detail.data?.ok === false) && <p role="alert" className="text-sm text-destructive">Intake details could not be loaded. Select the intake again or refresh the recent list to retry.</p>}
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

                    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">Media review</p>
                          {selectedRender && (
                            <Badge variant="outline">
                              {selectedRender.status} · {formatBytes(selectedRender.output_file_size)}
                            </Badge>
                          )}
                        </div>
                        {snapshot?.preview.source_media_id && <AuthorizedMedia tweetId={intake.tweet_id} mediaId={snapshot.preview.source_media_id} title="Intake source video" readOnly={readOnly} />}
                        {selectedRender && <AuthorizedMedia tweetId={intake.tweet_id} renderId={selectedRender.id} title="Intake rendered output" readOnly={readOnly} />}
                        {!snapshot?.preview.source_media_id && !selectedRender && <p role="status" className="text-sm text-muted-foreground">Media is not archived yet. Check processing status before requesting a preview.</p>}
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
                            <Label htmlFor="manual-render-selection">Render selection</Label>
                            <Select value={selectedRenderId} onValueChange={setSelectedRenderId}>
                              <SelectTrigger id="manual-render-selection"><SelectValue /></SelectTrigger>
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
                            <span id="manual-caption-count" className={captionTooLong ? 'text-xs text-red-500' : 'text-xs text-muted-foreground'}>
                              {captionDraft.length}/{snapshot?.caption.max_chars ?? 280}
                            </span>
                          </div>
                          <Textarea
                            id="manual-caption"
                            aria-invalid={captionTooLong}
                            aria-describedby="manual-caption-count"
                            value={captionDraft}
                            onChange={(event) => setCaptionDraft(event.target.value)}
                            disabled={readOnly}
                            dir="auto"
                            className="min-h-40 resize-y"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSaveCaption}
                              disabled={readOnly || saveCaption.isPending || !captionDraft.trim() || captionDraft === snapshot?.caption.effective}
                              title={mutationDisabledTitle}
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
                              disabled={readOnly}
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
                              aria-label="Reason for duplicate override"
                              value={overrideReason}
                              onChange={(event) => setOverrideReason(event.target.value)}
                              disabled={readOnly}
                              placeholder="Reason"
                              className="min-h-20"
                            />
                          )}
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSaveOverride}
                              disabled={readOnly || setDuplicateOverride.isPending || (overrideChecked && !overrideReason.trim())}
                              title={mutationDisabledTitle}
                            >
                              {setDuplicateOverride.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                              Save override
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <Button type="button" onClick={openPostConfirmation} disabled={readOnly || !readyToPost || isPosting} title={mutationDisabledTitle} className="w-full">
                            {isPosting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Post to X
                          </Button>
                          <AlertDialog
                            open={Boolean(postSnapshot)}
                            onOpenChange={(open) => {
                              if (!open && !isPosting) setPostSnapshot(null);
                            }}
                          >
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Post this video to X?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This creates one public post on the configured X account from the frozen render and saved caption below. It uses the X posting API and may incur provider charges.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              {postSnapshot && (
                                <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Destination</p>
                                    <p className="mt-1 break-words">{postSnapshot.destination}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Render</p>
                                    <p className="mt-1 break-all font-mono text-xs">{postSnapshot.renderId}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saved caption</p>
                                    <p dir="auto" className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border bg-background/70 p-2 text-sm">{postSnapshot.caption}</p>
                                  </div>
                                </div>
                              )}
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={readOnly || isPosting}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={readOnly || isPosting}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    void handlePost();
                                  }}
                                >
                                  {isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Post
                                </AlertDialogAction>
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
                              {captionTooLong ? 'Caption too long' : hasUnsavedCaption ? 'Save caption before posting' : !hasOutputVideo ? 'Waiting for the selected output video' : duplicateBlocked && intake.duplicate_override !== true ? 'Duplicate blocked' : 'Not ready'}
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
