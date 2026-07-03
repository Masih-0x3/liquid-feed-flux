import { useMemo } from "react";
import { Activity, AlertTriangle, Ban, Check, Loader2, SlidersHorizontal, Sparkles, Timer, Twitter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";
import type {
  AudienceClassValue,
  AudienceFeedback,
  EnrichmentFeedback,
  PendingAction,
  XPostingDiagnosticItem,
} from "@/lib/monitoringActions";
import { decisionScore } from "@/lib/pipelineMessages";
import { monitoringStage } from "@/lib/monitoringState";
import {
  audienceClassLabel,
  formatAge,
  formatBytes,
  formatScoringV2Score,
  toneClass,
} from "@/lib/monitoringViewModel";
import { duplicateCoverageClass, duplicateCoverageLabel } from "@/lib/monitoringDuplicateEvidence";
import { getScoringV2Snapshot, scoringV2DecisionLabel } from "@/lib/scoringV2Monitoring";
import { buildDeliverySummary, buildPipelineTimelineGroups } from "@/lib/timelineDisplay";
import { MediaThumbnails } from "@/components/monitoring/MediaThumbnails";
import { MonitoringDeliveryTimeline } from "@/components/monitoring/MonitoringDeliveryTimeline";
import { MonitoringDuplicateGateCard } from "@/components/monitoring/MonitoringDuplicateGateCard";
import { MonitoringDuplicateMatch } from "@/components/monitoring/MonitoringDuplicateEvidence";
import { VideoRenderDetailPanel } from "@/components/video/VideoRenderDetailPanel";

function scoringReasonTagLabel(value: string | null | undefined): string {
  return value ? value.replace(/_/g, ' ') : 'No reason tag';
}

function scoringRuleLabel(value: string | null | undefined): string {
  if (value === 'regional_escalation_auto') return 'Regional escalation auto';
  if (value === 'global_mega_event_review') return 'Global mega-event review';
  if (value === 'oil_energy_exception') return 'Oil / energy exception';
  if (value === 'major_leader_statement') return 'Major leader statement';
  return value ? value.replace(/_/g, ' ') : 'No policy override';
}

function processStatusTone(status: string | null | undefined): 'good' | 'warn' | 'bad' | 'muted' | 'info' {
  if (status === 'completed') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'skipped') return 'muted';
  if (status === 'running' || status === 'pending') return 'info';
  return 'muted';
}

function compactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDuration(value: number | null | undefined, unit: 'seconds' | 'milliseconds'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const seconds = unit === 'milliseconds' ? value / 1000 : value;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function processReasonLabel(value: string | null | undefined): string {
  return value ? value.replaceAll('_', ' ') : 'not exported';
}

type ProcessObservability = NonNullable<MonitoringEntry['process_observability']>;

function ProcessObservabilityPanel({ observability }: { observability?: ProcessObservability | null }) {
  const latestRun = observability?.latest_run ?? null;
  const latestCalls = latestRun?.calls ?? [];
  const hasEvidence = Boolean(latestRun || (observability?.ai_calls ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />Process Observability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!hasEvidence ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              Trace not captured
            </div>
            <p className="text-muted-foreground">
              {observability?.partial_reason
                ? `Observability is partial: ${processReasonLabel(observability.partial_reason)}.`
                : 'No XOT workflow run has been captured for this post yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {latestRun && (
                <Badge className={toneClass(processStatusTone(latestRun.status))}>
                  {latestRun.status.replaceAll('_', ' ')}
                </Badge>
              )}
              <Badge variant="outline">{observability?.source === 'workflow_runs' ? 'Local ledger' : 'Unavailable'}</Badge>
              {observability?.partial_reason && (
                <Badge variant="outline">Partial: {processReasonLabel(observability.partial_reason)}</Badge>
              )}
            </div>
            {latestRun && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={latestRun.workflow_name}>{latestRun.workflow_name}</p>
                    <p className="truncate text-xs text-muted-foreground" title={latestRun.workflow_run_id ?? latestRun.run_key}>
                      {latestRun.workflow_run_id ?? latestRun.run_key}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Timer className="h-3.5 w-3.5" />
                    {formatDuration(latestRun.duration_seconds, 'seconds')}
                  </div>
                </div>
                {latestRun.last_error && (
                  <p className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                    {latestRun.last_error}
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">AI calls</p>
                <p className="font-medium">{compactNumber(observability?.ai_calls)}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">Tokens</p>
                <p className="font-medium">{compactNumber(observability?.total_tokens)}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">Failures</p>
                <p className="font-medium">{compactNumber(observability?.failed_ai_calls)}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">Hosted trace</p>
                <p className="font-medium">{compactNumber(observability?.foglamp_exported)} / {compactNumber(observability?.foglamp_skipped)} skipped</p>
              </div>
            </div>
            {latestCalls.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">Latest AI calls</p>
                {latestCalls.slice(0, 6).map((call, index) => (
                  <div key={`${call.workflow_run_key}:${call.operation_name}:${call.started_at ?? index}`} className="grid gap-2 rounded-md border p-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-sm" title={call.operation_name}>{call.operation_name}</p>
                        <Badge className={toneClass(processStatusTone(call.status))}>{call.status}</Badge>
                        {call.agent_name && <Badge variant="outline">{call.agent_name}</Badge>}
                      </div>
                      <p className="mt-1 truncate text-muted-foreground" title={[call.model, call.endpoint].filter(Boolean).join(' · ')}>
                        {[call.model, call.endpoint].filter(Boolean).join(' · ') || call.trace_name}
                      </p>
                      {call.error_message && <p className="mt-1 text-destructive">{call.error_message}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Badge variant="outline">{compactNumber(call.total_tokens)} tokens</Badge>
                      <Badge variant="outline">{formatDuration(call.duration_ms, 'milliseconds')}</Badge>
                      <Badge variant={call.foglamp_exported ? 'default' : 'outline'}>
                        {call.foglamp_exported ? 'hosted trace' : processReasonLabel(call.foglamp_skip_reason)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MonitoringDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tweetId: string | null;
  entry: MonitoringEntry | null;
  timeline: PipelineEvent[];
  deliverThreshold: number;
  xPostingEnabled: boolean;
  xDiagnostic: XPostingDiagnosticItem | undefined;
  xDiagnosticLoading: boolean;
  editingEntry: string | null;
  editedContent: string;
  enrichingTweetIds: Set<string>;
  feedbackLoading: string | null;
  onInspectDuplicateMatch: (tweetId: string) => void | Promise<void>;
  onRequestAction: (action: PendingAction) => void;
  onStartEditTranslation: (entry: MonitoringEntry) => void;
  onEditedContentChange: (value: string) => void;
  onSaveEdit: () => void | Promise<void>;
  onCancelEdit: () => void;
  onGenerateEnrichment: (tweetId: string) => void | Promise<void>;
  onOpenManualScore: (entry: MonitoringEntry) => void;
  onScoreFeedback: (entry: MonitoringEntry, feedback: AudienceFeedback, expectedAudienceClass?: AudienceClassValue | '') => void | Promise<void>;
  onEnrichmentFeedback: (entry: MonitoringEntry, feedback: EnrichmentFeedback) => void | Promise<void>;
  onSelectEnrichmentVariant: (entry: MonitoringEntry, variant: string) => void | Promise<void>;
}

export function MonitoringDetailDrawer({
  open,
  onOpenChange,
  tweetId,
  entry,
  timeline,
  deliverThreshold,
  xPostingEnabled,
  xDiagnostic,
  xDiagnosticLoading,
  editingEntry,
  editedContent,
  enrichingTweetIds,
  feedbackLoading,
  onInspectDuplicateMatch,
  onRequestAction,
  onStartEditTranslation,
  onEditedContentChange,
  onSaveEdit,
  onCancelEdit,
  onGenerateEnrichment,
  onOpenManualScore,
  onScoreFeedback,
  onEnrichmentFeedback,
  onSelectEnrichmentVariant,
}: MonitoringDetailDrawerProps) {
  const deliverySummary = useMemo(
    () => entry ? buildDeliverySummary(entry, timeline) : [],
    [entry, timeline],
  );
  const timelineGroups = useMemo(() => buildPipelineTimelineGroups(timeline), [timeline]);
  const selectedScoringV2 = useMemo(
    () => entry ? getScoringV2Snapshot(entry, timeline) : null,
    [entry, timeline],
  );
  const selectedManualScoringFeedback = useMemo(() => {
    const event = timeline.find((item) => item.step === 'score_feedback' || item.meta?.source === 'manual_score' || item.meta?.source === 'score_feedback' || typeof item.meta?.reason_tag === 'string');
    const meta = event?.meta ?? {};
    const reasonTag = typeof meta.reason_tag === 'string' ? meta.reason_tag : null;
    const reason = typeof meta.reason === 'string' ? meta.reason : null;
    const feedback = typeof meta.feedback === 'string' ? meta.feedback : null;
    return reasonTag || reason || feedback ? { reasonTag, reason, feedback } : null;
  }, [timeline]);
  const selectedVoice = entry?.source_context?.voice ?? null;
  const selectedVoiceScores = selectedVoice?.critic?.variants ?? [];
  const isGenerating = entry ? enrichingTweetIds.has(entry.tweet_id) : false;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92svh]">
        <DrawerHeader className="px-4 pb-2 pt-3 text-left">
          <DrawerTitle className="text-base sm:text-lg">Pipeline Details</DrawerTitle>
          <DrawerDescription className="break-all">{tweetId}</DrawerDescription>
        </DrawerHeader>
        <div className="grid max-h-[76svh] gap-3 overflow-y-auto px-3 pb-4 sm:px-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {entry && (
              <>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Why this is here</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge className={toneClass(monitoringStage(entry).tone)}>{monitoringStage(entry).label}</Badge>
                      <Badge variant="outline">{entry.monitoring_state?.decision_label ?? entry.delivery_decision ?? 'No decision'}</Badge>
                      {entry.monitoring_state?.translation_state && <Badge variant="outline">Translation: {entry.monitoring_state.translation_state.replace(/_/g, ' ')}</Badge>}
                    </div>
                    <p className="text-muted-foreground">
                      {entry.monitoring_state?.primary_blocker ?? 'No current blocker. This item is waiting for the next normal pipeline step or is already complete.'}
                    </p>
                    {entry.dup_of_tweet_id && (
                      <div className="rounded-md border bg-muted/20 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase text-muted-foreground">Duplicate match</p>
                          <Badge className={duplicateCoverageClass(entry.duplicate_of?.coverage_state)}>
                            {duplicateCoverageLabel(entry.duplicate_of?.coverage_state)}
                          </Badge>
                        </div>
                        <MonitoringDuplicateMatch entry={entry} onInspectDuplicateMatch={onInspectDuplicateMatch} />
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">Telegram</p>
                        <p className="font-medium">{entry.monitoring_state?.telegram_state === 'none' ? 'No row' : entry.monitoring_state?.telegram_state ?? entry.delivery_status ?? 'No row'}</p>
                      </div>
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">X</p>
                        <p className="font-medium">{entry.monitoring_state?.x_state === 'none' ? 'No row' : entry.monitoring_state?.x_state ?? entry.x_status ?? 'No row'}</p>
                      </div>
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">Next actions</p>
                        <p className="font-medium">{entry.monitoring_state?.next_actions?.join(', ') || 'Details'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <ProcessObservabilityPanel observability={entry.process_observability} />

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Twitter className="h-4 w-4" />Why not on X?
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {xDiagnosticLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />Checking X gates...
                      </div>
                    ) : xDiagnostic ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Badge className={xDiagnostic.eligible ? toneClass('good') : toneClass('warn')}>
                            {xDiagnostic.eligible ? 'Eligible for X' : 'Not eligible yet'}
                          </Badge>
                          {xDiagnostic.enrichment?.text_source && (
                            <Badge variant="outline">
                              Text: {xDiagnostic.enrichment.text_source === 'approved_enrichment' ? 'approved enrichment' : 'plain translation'}
                            </Badge>
                          )}
                          {xDiagnostic.enrichment?.pipeline_mode && (
                            <Badge variant="outline">Enrichment: {xDiagnostic.enrichment.pipeline_mode.replaceAll('_', ' ')}</Badge>
                          )}
                        </div>
                        {xDiagnostic.blockers.length > 0 ? (
                          <div className="space-y-2">
                            {xDiagnostic.blockers.map((blocker) => (
                              <div key={blocker.code} className="rounded-md border bg-muted/30 p-2">
                                <p className="font-medium">{blocker.label}</p>
                                <p className="text-xs text-muted-foreground">{blocker.code.replaceAll('_', ' ')}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
                            This post passes the local X gates. Normal cron still respects budget, spacing, media, and prior-post checks.
                          </p>
                        )}
                        {xDiagnostic.notes.length > 0 && (
                          <div className="space-y-1">
                            {xDiagnostic.notes.map((note) => (
                              <p key={note.code} className="text-xs text-muted-foreground">{note.label}</p>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Hydration</p>
                            <p className="font-medium">{xDiagnostic.hydration?.is_truncated ? xDiagnostic.hydration?.hydrated_at ? 'Hydrated' : 'Needed' : 'Not needed'}</p>
                          </div>
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Media</p>
                            <p className="font-medium">{xDiagnostic.media?.has_media ? `${xDiagnostic.media.downloaded ?? 0}/${xDiagnostic.media.rows ?? 0} ready` : 'No media gate'}</p>
                          </div>
                          <div className="rounded-md border p-2">
                            <p className="text-xs text-muted-foreground">Latest X</p>
                            <p className="font-medium">{xDiagnostic.latest_x?.status ?? 'No row'}</p>
                          </div>
                          <div className="rounded-md border p-2 sm:col-span-3">
                            <p className="text-xs text-muted-foreground">SQL candidate gate</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge variant={xDiagnostic.candidate?.sql_gate_passed ? 'default' : 'outline'}>
                                {xDiagnostic.candidate?.sql_gate_passed ? 'candidate' : 'not candidate'}
                              </Badge>
                              {xDiagnostic.candidate?.reason && <span className="text-xs text-muted-foreground">{xDiagnostic.candidate.reason.replaceAll('_', ' ')}</span>}
                              {xDiagnostic.candidate?.dispatch_source && <span className="text-xs text-muted-foreground">source {xDiagnostic.candidate.dispatch_source}</span>}
                              {typeof xDiagnostic.candidate?.age_ms === 'number' && <span className="text-xs text-muted-foreground">age {formatAge(Math.round(xDiagnostic.candidate.age_ms / 1000))}</span>}
                            </div>
                          </div>
                        </div>
                        {(xDiagnostic.media?.row_details?.length ?? 0) > 0 && (
                          <div className="space-y-2 rounded-md border p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-muted-foreground">Media rows</p>
                              <Badge variant="outline">
                                {xDiagnostic.media?.selected_tier ?? 'unknown'}
                                {xDiagnostic.media?.selected_reason ? `: ${xDiagnostic.media.selected_reason.replaceAll('_', ' ')}` : ''}
                              </Badge>
                            </div>
                            <div className="grid gap-2">
                              {xDiagnostic.media?.row_details?.map((row, index) => (
                                <div key={row.id ?? index} className="grid gap-1 rounded border bg-muted/20 p-2 text-xs sm:grid-cols-[1fr_auto]">
                                  <div className="min-w-0">
                                    <p className="font-medium">
                                      {row.kind ?? 'unknown'} · {row.mime_type ?? 'not downloaded'} · {formatBytes(row.file_size)}
                                    </p>
                                    <p className="text-muted-foreground">
                                      {row.video_intent ? 'video intent' : 'image/text media'} · {row.downloaded ? 'downloaded' : 'not downloaded'}
                                    </p>
                                  </div>
                                  <Badge className={row.sendable ? toneClass('good') : toneClass('warn')}>
                                    {(row.role ?? 'not_sendable').replaceAll('_', ' ')}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button size="sm" variant="outline" onClick={() => onGenerateEnrichment(entry.tweet_id)} disabled={isGenerating}>
                            {isGenerating
                              ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                              : <Sparkles className="w-3 h-3 mr-1.5" />}
                            {isGenerating ? 'Generating draft' : 'Generate enrichment draft'}
                          </Button>
                          <Button size="sm" disabled={!xPostingEnabled} onClick={() => onRequestAction({ type: 'force_x', entry })}>
                            <Twitter className="w-3 h-3 mr-1.5" />Post plain to X
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground">X diagnostics are not available from the deployed admin function yet.</p>
                    )}
                  </CardContent>
                </Card>

                <MonitoringDuplicateGateCard
                  entry={entry}
                  onRunDedupe={(targetEntry) => onRequestAction({ type: 'run_dedupe', entry: targetEntry })}
                />

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Content</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">English</p>
                      <p className="rounded-md border bg-muted/30 p-3">{entry.text_original || '[No content]'}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs font-medium uppercase text-muted-foreground">Persian</p>
                        <div className="grid grid-cols-2 gap-2 sm:flex">
                          <Button size="sm" variant="outline" className="justify-center" onClick={() => onRequestAction({ type: 'translate', entry })}>Get translation</Button>
                          <Button size="sm" variant="outline" className="justify-center" onClick={() => onStartEditTranslation(entry)}>Edit</Button>
                        </div>
                      </div>
                      {editingEntry === entry.tweet_id ? (
                        <div className="space-y-2">
                          <Textarea value={editedContent} onChange={(event) => onEditedContentChange(event.target.value)} className="min-h-[120px]" dir="rtl" />
                          <div className="grid grid-cols-2 gap-2 sm:flex">
                            <Button size="sm" onClick={onSaveEdit}>Save</Button>
                            <Button size="sm" variant="outline" onClick={onCancelEdit}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-md border bg-card p-3 leading-relaxed" dir="rtl">{entry.text_translated || '[Not translated yet]'}</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <MediaThumbnails tweetId={entry.tweet_id} />
                {entry.has_media && (
                  <div className="mt-4">
                    <VideoRenderDetailPanel tweetId={entry.tweet_id} enabled={open} compact />
                  </div>
                )}

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Scoring</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">Current</p>
                        <p className="font-medium">{decisionScore(entry) ?? '—'} / ≥{deliverThreshold}</p>
                      </div>
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">Decision</p>
                        <p className="font-medium">{entry.monitoring_state?.decision_label ?? entry.delivery_decision ?? 'No decision'}</p>
                      </div>
                      <div className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">Feedback</p>
                        <p className="font-medium">{entry.feedback_locked ? 'Locked' : 'Open'}</p>
                      </div>
                    </div>
                    {selectedScoringV2 && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">V2 comparison</p>
                            <p className="text-sm font-medium">{selectedScoringV2.profile_id ?? entry.scoring_profile_id ?? 'iran-first'}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{selectedScoringV2.mode ?? entry.score_review_status ?? 'v2'}</Badge>
                            <Badge className={selectedScoringV2.decision === 'deliver' ? toneClass('good') : selectedScoringV2.decision === 'skip' ? toneClass('muted') : toneClass('info')}>
                              {scoringV2DecisionLabel(selectedScoringV2.decision)}
                            </Badge>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-4">
                          <div className="rounded-md border bg-background/50 p-2">
                            <p className="text-xs text-muted-foreground">Legacy decision</p>
                            <p className="font-medium">{entry.delivery_decision ?? 'No decision'}</p>
                          </div>
                          <div className="rounded-md border bg-background/50 p-2">
                            <p className="text-xs text-muted-foreground">V2 score</p>
                            <p className="font-medium">{formatScoringV2Score(selectedScoringV2)}</p>
                          </div>
                          <div className="rounded-md border bg-background/50 p-2">
                            <p className="text-xs text-muted-foreground">V2 audience</p>
                            <p className="font-medium">{audienceClassLabel(selectedScoringV2.audience_class)}</p>
                          </div>
                          <div className="rounded-md border bg-background/50 p-2">
                            <p className="text-xs text-muted-foreground">V2 review</p>
                            <p className="font-medium">{selectedScoringV2.review_status ?? 'none'}</p>
                          </div>
                        </div>
                        {selectedScoringV2.audience_reason && (
                          <p className="mt-2 rounded-md border bg-background/50 p-2 text-xs leading-5">{selectedScoringV2.audience_reason}</p>
                        )}
                      </div>
                    )}
                    {(selectedScoringV2?.policy_rule_applied || selectedScoringV2?.policy_rule || selectedManualScoringFeedback) && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">V2 tuning</p>
                            <p className="text-sm font-medium">
                              {scoringRuleLabel(selectedScoringV2?.policy_rule_applied ?? selectedScoringV2?.policy_rule?.kind)}
                            </p>
                          </div>
                          {selectedManualScoringFeedback?.reasonTag && (
                            <Badge variant="outline">{scoringReasonTagLabel(selectedManualScoringFeedback.reasonTag)}</Badge>
                          )}
                        </div>
                        {selectedScoringV2?.policy_rule && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">Original V2 decision</p>
                              <p className="font-medium">{scoringV2DecisionLabel(selectedScoringV2.policy_rule.original_decision)}</p>
                            </div>
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">Final decision</p>
                              <p className="font-medium">{scoringV2DecisionLabel(selectedScoringV2.decision)}</p>
                            </div>
                            <div className="rounded-md border bg-background/50 p-2">
                              <p className="text-xs text-muted-foreground">Original threshold</p>
                              <p className="font-medium">{selectedScoringV2.policy_rule.original_threshold}</p>
                            </div>
                          </div>
                        )}
                        {selectedScoringV2?.policy_rule?.matched_terms?.length ? (
                          <p className="mt-2 rounded-md border bg-background/50 p-2 text-xs">
                            <span className="text-muted-foreground">Matched terms:</span> {selectedScoringV2.policy_rule.matched_terms.join(', ')}
                          </p>
                        ) : null}
                        {selectedScoringV2?.policy_rule?.reason && (
                          <p className="mt-2 text-xs text-muted-foreground">{selectedScoringV2.policy_rule.reason}</p>
                        )}
                        {selectedManualScoringFeedback && (
                          <div className="mt-2 rounded-md border bg-background/50 p-2 text-xs">
                            <p className="font-medium">Manual scoring feedback</p>
                            <p className="text-muted-foreground">
                              {selectedManualScoringFeedback.reasonTag ? scoringReasonTagLabel(selectedManualScoringFeedback.reasonTag) : 'No reason tag'}
                              {selectedManualScoringFeedback.feedback ? ` - ${selectedManualScoringFeedback.feedback.replaceAll('_', ' ')}` : ''}
                            </p>
                            {selectedManualScoringFeedback.reason && <p className="mt-1 text-muted-foreground">{selectedManualScoringFeedback.reason}</p>}
                          </div>
                        )}
                      </div>
                    )}
                    {entry.scoring_version && (
                      <div className="grid gap-2 sm:grid-cols-4">
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Audience</p>
                          <p className="font-medium">{audienceClassLabel(entry.audience_class)}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Confidence</p>
                          <p className="font-medium">{entry.audience_confidence != null ? entry.audience_confidence.toFixed(2) : '—'}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Profile</p>
                          <p className="truncate font-medium" title={entry.scoring_profile_id ?? undefined}>{entry.scoring_profile_id ?? '—'}</p>
                        </div>
                        <div className="rounded-md border p-2">
                          <p className="text-xs text-muted-foreground">Review</p>
                          <p className="font-medium">{entry.score_review_status ?? 'none'}</p>
                        </div>
                      </div>
                    )}
                    {entry.audience_reason && <p className="rounded-md border bg-muted/30 p-2">{entry.audience_reason}</p>}
                    {entry.importance_reasoning && <p className="rounded-md border bg-muted/30 p-2">{entry.importance_reasoning}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="w-full sm:w-auto" onClick={() => onOpenManualScore(entry)}>
                        <SlidersHorizontal className="w-3 h-3 mr-1.5" />Manual score
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onScoreFeedback(entry, 'should_pass_audience', (entry.audience_class as AudienceClassValue | null) ?? 'direct_focus')} disabled={feedbackLoading === `${entry.tweet_id}:should_pass_audience`}>
                        Should pass
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onScoreFeedback(entry, 'should_skip', (entry.audience_class as AudienceClassValue | null) ?? 'off_topic')} disabled={feedbackLoading === `${entry.tweet_id}:should_skip`}>
                        Should skip
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onScoreFeedback(entry, 'wrong_relevance_class')} disabled={feedbackLoading === `${entry.tweet_id}:wrong_relevance_class`}>
                        Wrong class
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onScoreFeedback(entry, 'global_exception_worth_covering', 'global_exception')} disabled={feedbackLoading === `${entry.tweet_id}:global_exception_worth_covering`}>
                        Global exception
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onScoreFeedback(entry, 'not_global_exception', 'off_topic')} disabled={feedbackLoading === `${entry.tweet_id}:not_global_exception`}>
                        Not exception
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {entry.enrich_status && entry.enrich_status !== 'skipped' && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Enrichment Studio</CardTitle>
                        <Button size="sm" variant="outline" onClick={() => onGenerateEnrichment(entry.tweet_id)} disabled={isGenerating}>
                          {isGenerating
                            ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                            : <Sparkles className="w-3 h-3 mr-1.5" />}
                          {isGenerating ? 'Generating' : 'Generate draft'}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={entry.enrich_status === 'awaiting_approval' ? 'secondary' : entry.enrich_status === 'rejected' ? 'destructive' : 'outline'}>{entry.enrich_status}</Badge>
                        {entry.enrichment_version && <Badge variant="outline">{entry.enrichment_version}</Badge>}
                        {typeof entry.aggregator_risk_score === 'number' && <Badge className={entry.aggregator_risk_score >= 70 ? toneClass('bad') : entry.aggregator_risk_score >= 35 ? toneClass('warn') : toneClass('good')}>Aggregator {entry.aggregator_risk_score}</Badge>}
                        {typeof entry.ai_voice_risk_score === 'number' && <Badge className={entry.ai_voice_risk_score >= 70 ? toneClass('bad') : entry.ai_voice_risk_score >= 35 ? toneClass('warn') : toneClass('good')}>AI voice {entry.ai_voice_risk_score}</Badge>}
                      </div>
                      {entry.enrichment_review_reason && <p className="rounded-md border bg-muted/30 p-2">{entry.enrichment_review_reason}</p>}
                      {selectedVoice && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Intent</p>
                            <p className="font-medium">{selectedVoice.intent?.replaceAll('_', ' ') || '—'}</p>
                          </div>
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Language</p>
                            <p className="font-medium">{selectedVoice.language_choice || '—'}</p>
                          </div>
                          <div className="rounded-md border bg-muted/20 p-2">
                            <p className="text-xs text-muted-foreground">Selected</p>
                            <p className="font-medium">{selectedVoice.selected_variant?.replaceAll('_', ' ') || '—'}</p>
                          </div>
                        </div>
                      )}
                      <div className="grid gap-2 lg:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Original</p>
                          <p className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">{entry.text_original || '[No original text]'}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Translation</p>
                          <p dir="rtl" className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2">{entry.text_translated || '[No translation yet]'}</p>
                        </div>
                      </div>
                      {entry.monetization_risk_flags && entry.monetization_risk_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entry.monetization_risk_flags.map((flag) => <Badge key={flag} variant="outline" className="text-xs">{flag}</Badge>)}
                        </div>
                      )}
                      {selectedVoice?.variants && selectedVoice.variants.length > 0 && (
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-muted-foreground">Manual voice variants</p>
                            {selectedVoice.critic?.overall_reason && <p className="max-w-[70%] truncate text-xs text-muted-foreground" title={selectedVoice.critic.overall_reason}>{selectedVoice.critic.overall_reason}</p>}
                          </div>
                          <div className="grid gap-2 xl:grid-cols-3">
                            {selectedVoice.variants.map((variant) => {
                              const score = selectedVoiceScores.find((item) => item.kind === variant.kind);
                              const selected = selectedVoice.selected_variant === variant.kind;
                              return (
                                <div key={variant.kind || variant.label} className={`rounded-md border bg-muted/20 p-3 ${selected ? 'border-primary/60' : ''}`}>
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge variant={selected ? 'default' : 'outline'}>{variant.label || variant.kind?.replaceAll('_', ' ')}</Badge>
                                    <Badge variant="outline">{variant.language_choice === 'english' ? 'News + P.S.' : 'خبر + پ.ن'}</Badge>
                                    {typeof score?.voice_match === 'number' && <Badge variant="outline">Voice {score.voice_match}</Badge>}
                                    {typeof score?.platform_risk === 'number' && <Badge className={score.platform_risk >= 70 ? toneClass('bad') : score.platform_risk >= 35 ? toneClass('warn') : toneClass('good')}>Risk {score.platform_risk}</Badge>}
                                  </div>
                                  <p dir="auto" className="whitespace-pre-wrap rounded-md border bg-background/60 p-2 text-sm">{variant.final_x_text}</p>
                                  <p className="mt-2 text-xs text-muted-foreground">{variant.voice_rationale}</p>
                                  {score?.rationale && <p className="mt-1 text-xs text-muted-foreground">{score.rationale}</p>}
                                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                    {typeof score?.too_ai === 'number' && <span>AI {score.too_ai}</span>}
                                    {typeof score?.too_soft === 'number' && <span>Soft {score.too_soft}</span>}
                                    {typeof score?.too_newsy === 'number' && <span>Newsy {score.too_newsy}</span>}
                                    {typeof score?.too_long === 'number' && <span>Long {score.too_long}</span>}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={selected ? 'secondary' : 'outline'}
                                    className="mt-2 w-full"
                                    onClick={() => onSelectEnrichmentVariant(entry, variant.kind || 'raw_masihh')}
                                    disabled={selected || feedbackLoading === `${entry.tweet_id}:variant:${variant.kind}`}
                                  >
                                    {selected ? 'Selected' : 'Use this preview'}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {entry.creator_angle && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Creator angle</p>
                          <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{entry.creator_angle}</p>
                        </div>
                      )}
                      {entry.why_it_matters && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Why it matters</p>
                          <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{entry.why_it_matters}</p>
                        </div>
                      )}
                      {entry.final_x_text && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">Final X preview</p>
                          <p dir="auto" className="whitespace-pre-wrap rounded-md border bg-muted/30 p-2">{entry.final_x_text}</p>
                        </div>
                      )}
                      {!entry.final_x_text && entry.composed_post_text && <p dir="rtl" className="rounded-md border bg-muted/30 p-2">{entry.composed_post_text}</p>}
                      {entry.algorithm_signal_scores && (
                        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                          {Object.entries(entry.algorithm_signal_scores).map(([key, value]) => (
                            <div key={key} className="rounded-md border bg-muted/20 p-2">
                              <p className="text-muted-foreground">{key.replaceAll('_', ' ')}</p>
                              <p className="font-semibold">{value}/5</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {entry.source_context?.sources && entry.source_context.sources.length > 0 && (
                        <p className="text-xs text-muted-foreground">Sources checked: {entry.source_context.sources.slice(0, 3).join(' | ')}</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button size="sm" onClick={() => onRequestAction({ type: 'approve_enrichment', entry })} disabled={entry.enrich_status === 'approved'}>
                          <Check className="w-3 h-3 mr-1.5" />Approve for X
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onRequestAction({ type: 'reject_enrichment', entry })} disabled={entry.enrich_status === 'rejected'}>
                          <Ban className="w-3 h-3 mr-1.5" />Reject
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ['sounds_like_me', 'Sounds like me'],
                          ['too_soft', 'Too soft'],
                          ['too_ai', 'Too AI'],
                          ['too_newsy', 'Too newsy'],
                          ['not_blunt_enough', 'Not blunt enough'],
                          ['too_long', 'Too long'],
                          ['good_clapback', 'Good clapback'],
                          ['strong_angle', 'Strong angle'],
                          ['too_risky', 'Too risky'],
                        ] as const).map(([value, label]) => (
                          <Button key={value} size="sm" variant="outline" onClick={() => onEnrichmentFeedback(entry, value)} disabled={feedbackLoading === `${entry.tweet_id}:enrich:${value}`}>
                            {label}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
          <MonitoringDeliveryTimeline
            deliverySummary={deliverySummary}
            timelineGroups={timelineGroups}
            eventCount={timeline.length}
            showDeliverySummary={Boolean(entry)}
          />
        </div>
        <DrawerFooter className="border-t bg-background/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:px-4">
          <DrawerClose asChild><Button variant="outline">Close</Button></DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
