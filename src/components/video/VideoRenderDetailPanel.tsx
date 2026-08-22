import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Languages, Loader2, RotateCcw, Save, ShieldAlert, Undo2, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import {
  useRetryVideoRender,
  useSaveVideoRenderFeedback,
  useSetVideoRenderReviewed,
  useVideoRenderDetail,
} from '@/hooks/useVideoRenderData';
import {
  createVideoRenderFeedbackDraft,
  isVideoRenderFeedbackDraftCurrent,
  rebaseVideoRenderFeedbackDraft,
  updateVideoRenderFeedbackDraft,
  videoRenderFeedbackKey,
} from '@/lib/videoRenderFeedbackState';
import { contentLanguageAttributes } from '@/lib/contentLanguage';

function statusClass(status?: string | null): string {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-500';
  if (status === 'running' || status === 'queued') return 'border-blue-500/30 bg-blue-500/15 text-blue-500';
  if (status === 'blocked' || status === 'failed') return 'border-red-500/30 bg-red-500/15 text-red-500';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

function formatMs(value: unknown): string {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  const mb = bytes / 1_000_000;
  return mb < 1000 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${(mb / 1000).toFixed(2)} GB`;
}

export function VideoRenderDetailPanel({
  renderId,
  tweetId,
  status,
  enabled = true,
  isVisible = false,
  readOnly = false,
  mutationDisabledTitle,
}: {
  renderId?: string | null;
  tweetId?: string | null;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'expired' | null;
  enabled?: boolean;
  isVisible?: boolean;
  readOnly?: boolean;
  mutationDisabledTitle?: string;
}) {
  const disabledMutationTitle = readOnly ? mutationDisabledTitle : undefined;
  const documentVisible = useDocumentVisibility();
  const detail = useVideoRenderDetail({
    renderId,
    tweetId,
    status,
    enabled,
    isVisible: isVisible && documentVisible,
  });
  const retry = useRetryVideoRender();
  const saveFeedback = useSaveVideoRenderFeedback();
  const setReviewed = useSetVideoRenderReviewed();

  const render = detail.data?.render;
  const tweetRetryPending = retry.isPendingFor({ tweet_id: tweetId });
  const renderRetryPending = retry.isPendingFor({ render_id: render?.id });
  const feedbackTargetKey = videoRenderFeedbackKey({
    render_id: render?.id,
    render_version: render?.render_version,
    render_revision: render?.render_revision,
  });
  const [feedbackDraft, setFeedbackDraft] = useState(() => createVideoRenderFeedbackDraft());
  useEffect(() => {
    setFeedbackDraft((draft) => rebaseVideoRenderFeedbackDraft(draft, feedbackTargetKey));
  }, [feedbackTargetKey]);
  const feedbackDraftCurrent = isVideoRenderFeedbackDraftCurrent(feedbackDraft, feedbackTargetKey);
  const feedbackLabel = feedbackDraftCurrent ? feedbackDraft.label : 'pass';
  const feedbackNote = feedbackDraftCurrent ? feedbackDraft.note : '';
  const feedbackPending = saveFeedback.isPendingFor({
    render_id: render?.id,
    render_version: render?.render_version,
    render_revision: render?.render_revision,
  });
  const metrics = useMemo(() => render?.metrics ?? null, [render?.metrics]);
  const timings = useMemo(() => {
    if (!metrics) return [];
    const entries = Object.entries(metrics)
      .filter(([key, value]) => key.endsWith('_ms') && Number.isFinite(Number(value)))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 8);
    return entries;
  }, [metrics]);

  if (detail.isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (detail.data?.ok === false || detail.error || !render) {
    return (
      <Card className="glass-card border-dashed">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <span>No video render row is available for this post yet.</span>
          </div>
          {tweetId && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => { if (!readOnly) retry.mutate({ tweet_id: tweetId }); }}
              disabled={readOnly || tweetRetryPending}
              title={disabledMutationTitle}
            >
              {tweetRetryPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Queue render
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wand2 className="h-4 w-4 text-primary" />
                Video Render
              </CardTitle>
              <p className="mt-1 break-all text-xs text-muted-foreground">{render.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={statusClass(render.status)}>{render.status}</Badge>
              {render.reviewed_at && <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">Reviewed</Badge>}
              <Badge variant="outline">{render.action_label}</Badge>
              {render.source_language && render.target_language && (
                <Badge variant="outline" className="gap-1">
                  <Languages className="h-3 w-3" />
                  {render.source_language} → {render.target_language}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(render.error || render.block_reason) && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {render.block_reason
                    ? 'This render was blocked. Review its status, retry it, or mark it reviewed.'
                    : 'This render did not complete. Review its status, retry it, or mark it reviewed.'}
                </span>
              </div>
            </div>
          )}

          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Media preview unavailable</p>
              <p>
                Authorised media access has not been configured. Render status and review controls remain available; no remote media was loaded.
              </p>
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-xs text-muted-foreground">Attempts</p>
              <p className="font-medium">{render.attempts ?? 0}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-xs text-muted-foreground">Total time</p>
              <p className="font-medium">{formatMs(metrics?.total_ms)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-xs text-muted-foreground">Output size</p>
              <p className="font-medium">{formatBytes(render.output_file_size)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="font-medium">{render.updated_at ? formatDistanceToNow(new Date(render.updated_at), { addSuffix: true }) : '-'}</p>
            </div>
          </div>

          {timings.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Slowest stages</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {timings.map(([key, value]) => (
                  <div key={key} className="rounded bg-background/60 p-2">
                    <p className="truncate text-xs text-muted-foreground" title={key}>{key.replace(/_ms$/, '').replace(/_/g, ' ')}</p>
                    <p className="font-medium">{formatMs(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Final subtitle</p>
              <pre {...contentLanguageAttributes(render.target_language)} className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5">
                {render.translated_srt || render.persian_srt || '[No subtitle text]'}
              </pre>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="grid gap-1 sm:w-48">
                <Label>Feedback</Label>
                <Select
                  value={feedbackLabel}
                  disabled={readOnly}
                  onValueChange={(label) => setFeedbackDraft((draft) =>
                    updateVideoRenderFeedbackDraft(draft, feedbackTargetKey, { label }),
                  )}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="needs_review">Needs review</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                    <SelectItem value="language">Language</SelectItem>
                    <SelectItem value="translation">Translation</SelectItem>
                    <SelectItem value="subtitle_timing">Subtitle timing</SelectItem>
                    <SelectItem value="subtitle_placement">Subtitle placement</SelectItem>
                    <SelectItem value="watermark">Watermark</SelectItem>
                    <SelectItem value="delogo">Delogo</SelectItem>
                    <SelectItem value="wrong_decision">Wrong decision</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 flex-1 gap-1">
                <Label>Note</Label>
                <Textarea
                  value={feedbackNote}
                  disabled={readOnly}
                  onChange={(event) => setFeedbackDraft((draft) =>
                    updateVideoRenderFeedbackDraft(draft, feedbackTargetKey, { note: event.target.value }),
                  )}
                  placeholder="What should be improved?"
                  className="min-h-10"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => { if (!readOnly) saveFeedback.mutate({
                    render_id: render.id,
                    render_version: render.render_version,
                    render_revision: render.render_revision,
                    label: feedbackLabel,
                    note: feedbackNote,
                  }); }}
                  disabled={readOnly || !feedbackDraftCurrent || feedbackPending}
                  title={disabledMutationTitle}
                >
                  {feedbackPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { if (!readOnly) retry.mutate({ render_id: render.id }); }}
                  disabled={readOnly || renderRetryPending}
                  title={disabledMutationTitle}
                >
                  {renderRetryPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Retry
                </Button>
                {(render.status === 'failed' || render.status === 'blocked') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { if (!readOnly) setReviewed.mutate({ render_id: render.id, reviewed: !render.reviewed_at }); }}
                    disabled={readOnly || setReviewed.isPending}
                    title={disabledMutationTitle}
                  >
                    {setReviewed.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : render.reviewed_at ? <Undo2 className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    {render.reviewed_at ? 'Restore' : 'Mark reviewed'}
                  </Button>
                )}
              </div>
            </div>
            {detail.data?.feedback?.length ? (
              <div className="space-y-1">
                {detail.data.feedback.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded bg-background/60 px-2 py-1 text-xs">
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                    <Badge variant="outline" className="text-[10px]">{item.label.replace(/_/g, ' ')}</Badge>
                    {item.note && <span className="min-w-0 flex-1 break-words text-muted-foreground">{item.note}</span>}
                    <span className="text-muted-foreground">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
