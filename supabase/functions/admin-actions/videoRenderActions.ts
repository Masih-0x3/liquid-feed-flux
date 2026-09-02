import type { XMediaRow } from "../_shared/mediaSelection.ts";
import { selectSourceVideo } from "../_shared/videoRenderGate.ts";
import {
  normalizeVideoRenderConfigValue,
  serializeVideoRenderConfig,
} from "../_shared/videoRenderConfig.ts";
import { classifyVideoRendererHealth } from "../_shared/videoRendererHealth.ts";
import type { SupabaseAdminClient } from "./types.ts";
export {
  sanitizeVideoRenderFeedbackLabel,
  saveVideoRenderFeedbackAdmin,
} from "./videoRenderFeedback.ts";
export {
  classifyVideoRendererHealth,
  VIDEO_RENDERER_HEARTBEAT_STALE_AFTER_MS,
} from "../_shared/videoRendererHealth.ts";
export type {
  VideoRendererHealth,
  VideoRendererHealthState,
} from "../_shared/videoRendererHealth.ts";

type QueryResult = { data?: unknown; error?: unknown };

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  upsert(value: Record<string, unknown>, options?: Record<string, unknown>): PromiseLike<{ error?: unknown }>;
  insert(value: Record<string, unknown> | Array<Record<string, unknown>>): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  is(column: string, value: unknown): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
};

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

type ClientRecord = Record<string, unknown>;

function clientRecord(value: unknown): ClientRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ClientRecord
    : {};
}

function clientNullableRecord(value: unknown): ClientRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ClientRecord
    : null;
}

function clientString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clientNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function clientNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clientNonNegativeInteger(value: unknown): number {
  const number = clientNullableNumber(value);
  return number === null ? 0 : Math.max(0, Math.floor(number));
}

export type VideoRenderClientPost = {
  tweet_id: string;
  text_original: string | null;
  url: string | null;
  author_handle: string | null;
  created_at: string | null;
  delivery_decision: string | null;
  final_score: number | null;
};

export type VideoRenderClientMedia = {
  id: string;
  kind: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
};

export type VideoRenderClientFeedback = {
  id: string;
  label: string;
  note: string | null;
  created_at: string | null;
};

export type VideoRenderClientTimingMetrics = {
  total_ms: number | null;
  config_load_ms: number | null;
  source_lookup_ms: number | null;
  post_context_lookup_ms: number | null;
  download_ms: number | null;
  probe_ms: number | null;
  preflight_visual_ms: number | null;
  contact_sheet_ms: number | null;
  vision_frames_ms: number | null;
  vision_inspection_sheets_ms: number | null;
  local_ocr_ms: number | null;
  watermark_vision_ms: number | null;
  delogo_recovery_ms: number | null;
  audio_extract_ms: number | null;
  audio_extract_enhanced_ms: number | null;
  audio_extract_early_ms: number | null;
  transcription_ms: number | null;
  transcript_cleanup_ms: number | null;
  translation_ms: number | null;
  subtitle_generate_ms: number | null;
  encode_ms: number | null;
  upload_ms: number | null;
};

export type VideoRenderClientDiagnostic = 'render_failed' | 'render_blocked';

export type VideoRenderClientHeartbeatStatus = 'online' | 'draining' | 'paused' | 'offline' | 'error' | 'unknown';

export type VideoRenderClientHeartbeat = {
  renderer_id: string | null;
  status: VideoRenderClientHeartbeatStatus;
  version: string | null;
  render_version: string | null;
  running: number;
  processed: number;
  failed: number;
  last_seen_at: string | null;
};

export type VideoRenderClientHealth = {
  state: 'healthy' | 'stale' | 'unavailable' | 'blocked' | 'unknown';
  server_observed_at: string | null;
  last_seen_at: string | null;
  age_ms: number | null;
  renderer_id: string | null;
  reported_status: VideoRenderClientHeartbeatStatus | null;
};

export type VideoRenderClientRenderFields = {
  id: string;
  tweet_id: string;
  source_media_id: string;
  status: string;
  failure_policy: string;
  render_version: string;
  render_revision: number;
  output_file_size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  source_language: string | null;
  target_language: string | null;
  metrics: VideoRenderClientTimingMetrics;
  error: VideoRenderClientDiagnostic | null;
  block_reason: VideoRenderClientDiagnostic | null;
  attempts: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  blocked_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  updated_at: string | null;
  created_at: string | null;
  action_label: string;
  activity_at: string;
};

export type VideoRenderClientQueueRow = VideoRenderClientRenderFields & {
  post: VideoRenderClientPost | null;
  media: VideoRenderClientMedia | null;
  latest_feedback: VideoRenderClientFeedback | null;
};

export type VideoRenderClientDetailRender = VideoRenderClientRenderFields & {
  original_srt: string | null;
  persian_srt: string | null;
  translated_srt: string | null;
  ass_subtitles: string | null;
};

export function toVideoRenderClientPost(value: unknown): VideoRenderClientPost | null {
  const row = clientNullableRecord(value);
  if (!row) return null;
  return {
    tweet_id: clientString(row.tweet_id),
    text_original: clientNullableString(row.text_original),
    url: clientNullableString(row.url),
    author_handle: clientNullableString(row.author_handle),
    created_at: clientNullableString(row.created_at),
    delivery_decision: clientNullableString(row.delivery_decision),
    final_score: clientNullableNumber(row.final_score),
  };
}

export function toVideoRenderClientMedia(value: unknown): VideoRenderClientMedia | null {
  const row = clientNullableRecord(value);
  if (!row) return null;
  return {
    id: clientString(row.id),
    kind: clientNullableString(row.kind),
    mime_type: clientNullableString(row.mime_type),
    file_size: clientNullableNumber(row.file_size),
    duration_ms: clientNullableNumber(row.duration_ms),
    width: clientNullableNumber(row.width),
    height: clientNullableNumber(row.height),
  };
}

export function toVideoRenderClientFeedback(value: unknown): VideoRenderClientFeedback | null {
  const row = clientNullableRecord(value);
  if (!row) return null;
  return {
    id: clientString(row.id),
    label: clientString(row.label),
    note: clientNullableString(row.note),
    created_at: clientNullableString(row.created_at),
  };
}

export function toVideoRenderClientTimingMetrics(value: unknown): VideoRenderClientTimingMetrics {
  const metrics = clientRecord(value);
  return {
    total_ms: clientNullableNumber(metrics.total_ms),
    config_load_ms: clientNullableNumber(metrics.config_load_ms),
    source_lookup_ms: clientNullableNumber(metrics.source_lookup_ms),
    post_context_lookup_ms: clientNullableNumber(metrics.post_context_lookup_ms),
    download_ms: clientNullableNumber(metrics.download_ms),
    probe_ms: clientNullableNumber(metrics.probe_ms),
    preflight_visual_ms: clientNullableNumber(metrics.preflight_visual_ms),
    contact_sheet_ms: clientNullableNumber(metrics.contact_sheet_ms),
    vision_frames_ms: clientNullableNumber(metrics.vision_frames_ms),
    vision_inspection_sheets_ms: clientNullableNumber(metrics.vision_inspection_sheets_ms),
    local_ocr_ms: clientNullableNumber(metrics.local_ocr_ms),
    watermark_vision_ms: clientNullableNumber(metrics.watermark_vision_ms),
    delogo_recovery_ms: clientNullableNumber(metrics.delogo_recovery_ms),
    audio_extract_ms: clientNullableNumber(metrics.audio_extract_ms),
    audio_extract_enhanced_ms: clientNullableNumber(metrics.audio_extract_enhanced_ms),
    audio_extract_early_ms: clientNullableNumber(metrics.audio_extract_early_ms),
    transcription_ms: clientNullableNumber(metrics.transcription_ms),
    transcript_cleanup_ms: clientNullableNumber(metrics.transcript_cleanup_ms),
    translation_ms: clientNullableNumber(metrics.translation_ms),
    subtitle_generate_ms: clientNullableNumber(metrics.subtitle_generate_ms),
    encode_ms: clientNullableNumber(metrics.encode_ms),
    upload_ms: clientNullableNumber(metrics.upload_ms),
  };
}

export function toVideoRenderClientDiagnostic(
  value: unknown,
  code: VideoRenderClientDiagnostic,
): VideoRenderClientDiagnostic | null {
  return clientNullableString(value) ? code : null;
}

function clientBoundedToken(value: unknown): string | null {
  const token = clientNullableString(value)?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(token) ? token : null;
}

function clientTimestamp(value: unknown): string | null {
  const timestamp = clientNullableString(value);
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clientHeartbeatStatus(value: unknown): VideoRenderClientHeartbeatStatus | null {
  const status = clientNullableString(value)?.trim().toLowerCase() ?? '';
  return ['online', 'draining', 'paused', 'offline', 'error', 'unknown'].includes(status)
    ? status as VideoRenderClientHeartbeatStatus
    : null;
}

function clientHealthState(value: unknown): VideoRenderClientHealth['state'] {
  const state = clientNullableString(value)?.trim().toLowerCase() ?? '';
  return ['healthy', 'stale', 'unavailable', 'blocked', 'unknown'].includes(state)
    ? state as VideoRenderClientHealth['state']
    : 'unknown';
}

export function toVideoRenderClientHeartbeat(value: unknown): VideoRenderClientHeartbeat | null {
  const heartbeat = clientNullableRecord(value);
  if (!heartbeat) return null;
  return {
    renderer_id: clientBoundedToken(heartbeat.renderer_id),
    status: clientHeartbeatStatus(heartbeat.status) ?? 'unknown',
    version: clientBoundedToken(heartbeat.version),
    render_version: clientBoundedToken(heartbeat.render_version),
    running: clientNonNegativeInteger(heartbeat.running),
    processed: clientNonNegativeInteger(heartbeat.processed),
    failed: clientNonNegativeInteger(heartbeat.failed),
    last_seen_at: clientTimestamp(heartbeat.last_seen_at),
  };
}

export function toVideoRenderClientHealth(value: unknown): VideoRenderClientHealth {
  const health = clientRecord(value);
  return {
    state: clientHealthState(health.state),
    server_observed_at: clientTimestamp(health.server_observed_at),
    last_seen_at: clientTimestamp(health.last_seen_at),
    age_ms: clientNullableNumber(health.age_ms),
    renderer_id: clientBoundedToken(health.renderer_id),
    reported_status: clientHeartbeatStatus(health.reported_status),
  };
}

export function toVideoRenderClientRenderFields(value: unknown): VideoRenderClientRenderFields {
  const row = clientRecord(value);
  return {
    id: clientString(row.id),
    tweet_id: clientString(row.tweet_id),
    source_media_id: clientString(row.source_media_id),
    status: clientString(row.status),
    failure_policy: clientString(row.failure_policy),
    render_version: clientString(row.render_version),
    render_revision: clientNonNegativeInteger(row.render_revision),
    output_file_size: clientNullableNumber(row.output_file_size),
    width: clientNullableNumber(row.width),
    height: clientNullableNumber(row.height),
    duration_ms: clientNullableNumber(row.duration_ms),
    source_language: clientNullableString(row.source_language),
    target_language: clientNullableString(row.target_language),
    metrics: toVideoRenderClientTimingMetrics(row.metrics),
    error: toVideoRenderClientDiagnostic(row.error, 'render_failed'),
    block_reason: toVideoRenderClientDiagnostic(row.block_reason, 'render_blocked'),
    attempts: clientNonNegativeInteger(row.attempts),
    queued_at: clientNullableString(row.queued_at),
    started_at: clientNullableString(row.started_at),
    completed_at: clientNullableString(row.completed_at),
    failed_at: clientNullableString(row.failed_at),
    blocked_at: clientNullableString(row.blocked_at),
    reviewed_at: clientNullableString(row.reviewed_at),
    reviewed_by: clientNullableString(row.reviewed_by),
    updated_at: clientNullableString(row.updated_at),
    created_at: clientNullableString(row.created_at),
    action_label: videoRenderActionLabel(row),
    activity_at: latestTimestamp(
      row.updated_at,
      row.completed_at,
      row.failed_at,
      row.blocked_at,
      row.started_at,
      row.queued_at,
    ),
  };
}

export function toVideoRenderClientQueueRow(
  value: unknown,
  post: unknown,
  media: unknown,
  latestFeedback: unknown,
): VideoRenderClientQueueRow {
  const render = toVideoRenderClientRenderFields(value);
  return {
    id: render.id,
    tweet_id: render.tweet_id,
    source_media_id: render.source_media_id,
    status: render.status,
    failure_policy: render.failure_policy,
    render_version: render.render_version,
    render_revision: render.render_revision,
    output_file_size: render.output_file_size,
    width: render.width,
    height: render.height,
    duration_ms: render.duration_ms,
    source_language: render.source_language,
    target_language: render.target_language,
    metrics: render.metrics,
    error: render.error,
    block_reason: render.block_reason,
    attempts: render.attempts,
    queued_at: render.queued_at,
    started_at: render.started_at,
    completed_at: render.completed_at,
    failed_at: render.failed_at,
    blocked_at: render.blocked_at,
    reviewed_at: render.reviewed_at,
    reviewed_by: render.reviewed_by,
    updated_at: render.updated_at,
    created_at: render.created_at,
    action_label: render.action_label,
    activity_at: render.activity_at,
    post: toVideoRenderClientPost(post),
    media: toVideoRenderClientMedia(media),
    latest_feedback: toVideoRenderClientFeedback(latestFeedback),
  };
}

export function toVideoRenderDetailClientRender(value: unknown): VideoRenderClientDetailRender {
  const render = toVideoRenderClientRenderFields(value);
  const row = clientRecord(value);
  return {
    id: render.id,
    tweet_id: render.tweet_id,
    source_media_id: render.source_media_id,
    status: render.status,
    failure_policy: render.failure_policy,
    render_version: render.render_version,
    render_revision: render.render_revision,
    output_file_size: render.output_file_size,
    width: render.width,
    height: render.height,
    duration_ms: render.duration_ms,
    source_language: render.source_language,
    target_language: render.target_language,
    metrics: render.metrics,
    error: render.error,
    block_reason: render.block_reason,
    attempts: render.attempts,
    queued_at: render.queued_at,
    started_at: render.started_at,
    completed_at: render.completed_at,
    failed_at: render.failed_at,
    blocked_at: render.blocked_at,
    reviewed_at: render.reviewed_at,
    reviewed_by: render.reviewed_by,
    updated_at: render.updated_at,
    created_at: render.created_at,
    action_label: render.action_label,
    activity_at: render.activity_at,
    original_srt: clientNullableString(row.original_srt),
    persian_srt: clientNullableString(row.persian_srt),
    translated_srt: clientNullableString(row.translated_srt),
    ass_subtitles: clientNullableString(row.ass_subtitles),
  };
}

export function latestTimestamp(...values: Array<unknown>): string {
  const times = values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : new Date(0).toISOString();
}

export function videoRenderActionLabel(row: Record<string, unknown>): string {
  const preflight = row.preflight && typeof row.preflight === 'object' ? row.preflight as Record<string, unknown> : {};
  if (row.status === 'blocked') return 'blocked';
  if (row.output_storage_path) return 'rendered';
  if (preflight.processingMode === 'original_unmodified' || preflight.processing_mode === 'original_unmodified') return 'original-selected';
  return String(row.status ?? 'unknown');
}

function validateVideoRenderRows(
  data: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(data)) return null;
  for (const row of data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  }
  return data as Array<Record<string, unknown>>;
}

function validateVideoRenderRowsWithFields(
  data: unknown,
  fields: string[],
): Array<Record<string, unknown>> | null {
  const rows = validateVideoRenderRows(data);
  if (!rows) return null;
  return rows.every((row) => fields.every((field) => {
    const value = row[field];
    return typeof value === 'string' && value.trim().length > 0;
  }))
    ? rows
    : null;
}

function isNullableVideoRenderRecord(value: unknown): boolean {
  return value == null || (
    typeof value === 'object' && !Array.isArray(value)
  );
}

function isVideoRenderConfigEnvelope(value: unknown): value is { value?: unknown } {
  return value === null || value === undefined || (
    typeof value === 'object' && !Array.isArray(value) && "value" in value
  );
}

function isVideoRenderConfigValue(value: unknown): boolean {
  return value !== null && value !== undefined &&
    typeof value === 'object' && !Array.isArray(value);
}

export async function loadVideoRenderConfigAdmin(supabase: SupabaseAdminClient) {
  const { data, error } = await table(supabase, 'settings').select('value').eq('key', 'video_render_config').maybeSingle();
  if (error) throw error;
  if (!isVideoRenderConfigEnvelope(data) || !isVideoRenderConfigValue(data?.value)) {
    throw new Error('video_render_config_invalid_response');
  }
  const config = normalizeVideoRenderConfigValue((data as { value?: unknown } | null | undefined)?.value);
  return { ok: true, config: serializeVideoRenderConfig(config) };
}

export async function updateVideoRenderConfigAdmin(supabase: SupabaseAdminClient, body: Record<string, unknown>) {
  const patch = body.config && typeof body.config === 'object' ? body.config : body;
  const { data: existing, error: existingError } = await table(supabase, 'settings').select('value').eq('key', 'video_render_config').maybeSingle();
  if (existingError) return { ok: false, error: 'video_render_config_read_failed' };
  if (!isVideoRenderConfigEnvelope(existing) || !isVideoRenderConfigValue(existing?.value)) {
    return { ok: false, error: 'video_render_config_invalid_response' };
  }
  const existingConfig = normalizeVideoRenderConfigValue((existing as { value?: unknown } | null | undefined)?.value);
  const next = normalizeVideoRenderConfigValue({
    ...serializeVideoRenderConfig(existingConfig),
    ...(patch as Record<string, unknown>),
  });
  const serialized = serializeVideoRenderConfig(next);
  const { error } = await table(supabase, 'settings').upsert({
    key: 'video_render_config',
    value: serialized,
    description: 'Video subtitle, delogo, and @Masihh watermark renderer configuration',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw error;
  return { ok: true, config: serialized };
}

export async function getVideoRenderOverview(supabase: SupabaseAdminClient) {
  const windowStartMs = Date.now();
  const since = new Date(windowStartMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [cfg, rendersRes, issuesRes, heartbeatRes] = await Promise.all([
    loadVideoRenderConfigAdmin(supabase),
    table(supabase, 'video_renders')
      .select('status, metrics, queued_at, started_at, completed_at, failed_at, blocked_at, updated_at, output_file_size')
      .gte('created_at', since)
      .order('updated_at', { ascending: false })
      .limit(5000),
    table(supabase, 'video_renders')
      .select('status, reviewed_at')
      .in('status', ['failed', 'blocked'])
      .limit(5000),
    table(supabase, 'video_renderer_heartbeats')
      .select('renderer_id, status, version, render_version, running, processed, failed, last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(10),
  ]);
  const healthObservedAtMs = Date.now();
  if (rendersRes.error) throw rendersRes.error;
  if (issuesRes.error) throw issuesRes.error;
  if (heartbeatRes.error) throw heartbeatRes.error;
  const renderRows = validateVideoRenderRows(rendersRes.data);
  const issueRows = validateVideoRenderRows(issuesRes.data);
  const heartbeatRows = validateVideoRenderRows(heartbeatRes.data);
  if (!renderRows || !issueRows || !heartbeatRows) {
    return { ok: false, error: 'video_render_overview_invalid_response' };
  }

  const counts: Record<string, number> = { queued: 0, running: 0, completed: 0, failed: 0, blocked: 0, expired: 0 };
  const totals = { render_ms: [] as number[], total_ms: [] as number[], output_bytes: 0 };
  let unreviewedIssues = 0;
  let reviewedIssues = 0;
  let oldestQueuedAt: string | null = null;
  for (const row of renderRows) {
    const status = String(row.status ?? 'unknown');
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 'queued' && typeof row.queued_at === 'string') {
      oldestQueuedAt = oldestQueuedAt && oldestQueuedAt < row.queued_at ? oldestQueuedAt : row.queued_at;
    }
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics as Record<string, unknown> : {};
    const renderMs = Number(metrics.ffmpeg_encode_ms ?? metrics.render_ms);
    const totalMs = Number(metrics.total_ms);
    if (Number.isFinite(renderMs)) totals.render_ms.push(renderMs);
    if (Number.isFinite(totalMs)) totals.total_ms.push(totalMs);
    const bytes = Number(row.output_file_size ?? 0);
    if (Number.isFinite(bytes) && bytes > 0) totals.output_bytes += bytes;
  }
  for (const row of issueRows) {
    if (row.reviewed_at) reviewedIssues += 1;
    else unreviewedIssues += 1;
  }
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    ok: true,
    config: cfg.config,
    counts,
    unreviewed_issues: unreviewedIssues,
    reviewed_issues: reviewedIssues,
    oldest_queued_at: oldestQueuedAt,
    medians: {
      render_ms: median(totals.render_ms),
      total_ms: median(totals.total_ms),
    },
    output_bytes_7d: totals.output_bytes,
    heartbeats: heartbeatRows
      .map((heartbeat) => toVideoRenderClientHeartbeat(heartbeat))
      .filter((heartbeat): heartbeat is VideoRenderClientHeartbeat => heartbeat !== null),
    renderer_health: toVideoRenderClientHealth(classifyVideoRendererHealth(heartbeatRows, healthObservedAtMs)),
  };
}

export function normalizeVideoRenderStatuses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['queued', 'running', 'failed', 'blocked', 'completed'];
  const allowed = new Set(['queued', 'running', 'completed', 'failed', 'blocked', 'expired']);
  return value.map((item) => String(item)).filter((item) => allowed.has(item)).slice(0, 6);
}

export type VideoRenderReviewState = 'unreviewed' | 'all';

export function normalizeVideoRenderReviewState(value: unknown): VideoRenderReviewState {
  return value === 'all' ? 'all' : 'unreviewed';
}

export function normalizeVideoRenderIds(body: Record<string, unknown>): string[] {
  const values = Array.isArray(body.render_ids)
    ? body.render_ids
    : [body.render_id];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return [...new Set(values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter((value) => uuidPattern.test(value)))]
    .slice(0, 100);
}

export async function getVideoRenderQueue(supabase: SupabaseAdminClient, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const statuses = normalizeVideoRenderStatuses(body.statuses ?? body.status);
  const reviewState = normalizeVideoRenderReviewState(body.review_state);
  let query = table(supabase, 'video_renders')
    .select('id, tweet_id, source_media_id, status, failure_policy, render_version, render_revision, output_storage_path, output_file_size, width, height, duration_ms, source_language, target_language, metrics, error, block_reason, attempts, queued_at, started_at, completed_at, failed_at, blocked_at, reviewed_at, reviewed_by, updated_at, created_at, preflight')
    .in('status', statuses)
    .order('updated_at', { ascending: false });
  if (reviewState === 'unreviewed') query = query.is('reviewed_at', null);
  const { data: renders, error } = await query.limit(limit);
  if (error) throw error;

  const renderRows = validateVideoRenderRowsWithFields(
    renders,
    ['id', 'tweet_id', 'source_media_id'],
  );
  if (!renderRows) return { ok: false, error: 'video_render_queue_invalid_response' };
  const tweetIds = [...new Set(renderRows.map((row) => String(row.tweet_id)).filter(Boolean))];
  const mediaIds = [...new Set(renderRows.map((row) => String(row.source_media_id)).filter(Boolean))];
  const [postsRes, mediaRes, feedbackRes] = await Promise.all([
    tweetIds.length
      ? table(supabase, 'posts').select('tweet_id, text_original, url, author_handle, created_at, delivery_decision, final_score').in('tweet_id', tweetIds)
      : Promise.resolve({ data: [], error: null }),
    mediaIds.length
      ? table(supabase, 'media').select('id, kind, mime_type, file_size, duration_ms, width, height').in('id', mediaIds)
      : Promise.resolve({ data: [], error: null }),
    renderRows.length > 0
      ? table(supabase, 'video_render_feedback').select('render_id, label, note, created_at').in('render_id', renderRows.map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (postsRes.error) throw postsRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (feedbackRes.error) throw feedbackRes.error;
  const postRows = validateVideoRenderRowsWithFields(postsRes.data, ['tweet_id']);
  const mediaRows = validateVideoRenderRowsWithFields(mediaRes.data, ['id']);
  const feedbackRows = validateVideoRenderRowsWithFields(feedbackRes.data, ['render_id']);
  if (!postRows || !mediaRows || !feedbackRows) {
    return { ok: false, error: 'video_render_queue_related_invalid_response' };
  }
  const posts = new Map(postRows.map((row) => [row.tweet_id, row]));
  const media = new Map(mediaRows.map((row) => [row.id, row]));
  const feedbackByRender = new Map<string, Record<string, unknown>>();
  for (const item of feedbackRows) {
    if (!feedbackByRender.has(String(item.render_id))) feedbackByRender.set(String(item.render_id), item);
  }

  return {
    ok: true,
    rows: renderRows.map((row) => toVideoRenderClientQueueRow(
      row,
      posts.get(row.tweet_id) ?? null,
      media.get(row.source_media_id) ?? null,
      feedbackByRender.get(String(row.id)) ?? null,
    )),
  };
}

export async function getVideoRenderDetail(supabase: SupabaseAdminClient, body: Record<string, unknown>) {
  const renderId = typeof body.render_id === 'string' ? body.render_id.trim() : '';
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  let query = table(supabase, 'video_renders')
    .select('id, tweet_id, source_media_id, status, failure_policy, render_version, render_revision, output_storage_path, output_mime_type, output_file_size, width, height, duration_ms, original_srt, persian_srt, translated_srt, ass_subtitles, source_language, target_language, preflight, metrics, error, block_reason, attempts, queued_at, started_at, completed_at, failed_at, blocked_at, reviewed_at, reviewed_by, posted_at, expires_at, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (renderId) query = query.eq('id', renderId);
  else if (tweetId) query = query.eq('tweet_id', tweetId);
  else return { ok: false, error: 'render_id or tweet_id is required' };

  const { data: renderRows, error } = await query;
  if (error) throw error;
  const validatedRenderRows = validateVideoRenderRowsWithFields(
    renderRows,
    ['id', 'tweet_id', 'source_media_id'],
  );
  if (!validatedRenderRows) {
    return { ok: false, error: 'video_render_detail_invalid_response' };
  }
  const render = validatedRenderRows[0];
  if (!render) return { ok: false, error: 'video render not found' };

  const [postRes, mediaRes, feedbackRes] = await Promise.all([
    table(supabase, 'posts').select('tweet_id, text_original, text_translated, url, author_handle, created_at, delivery_decision, final_score').eq('tweet_id', render.tweet_id).maybeSingle(),
    table(supabase, 'media').select('id, kind, mime_type, file_size, duration_ms, width, height').eq('id', render.source_media_id).maybeSingle(),
    table(supabase, 'video_render_feedback').select('id, label, note, metadata, created_at, created_by').eq('render_id', render.id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (postRes.error) throw postRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (feedbackRes.error) throw feedbackRes.error;
  if (!isNullableVideoRenderRecord(postRes.data) || !isNullableVideoRenderRecord(mediaRes.data)) {
    return { ok: false, error: 'video_render_detail_related_invalid_response' };
  }
  const feedbackRows = validateVideoRenderRowsWithFields(feedbackRes.data, ['id']);
  if (!feedbackRows) return { ok: false, error: 'video_render_detail_related_invalid_response' };

  return {
    ok: true,
    render: toVideoRenderDetailClientRender(render),
    post: toVideoRenderClientPost(postRes.data),
    media: toVideoRenderClientMedia(mediaRes.data),
    feedback: feedbackRows
      .map((item) => toVideoRenderClientFeedback(item))
      .filter((item): item is VideoRenderClientFeedback => item !== null),
  };
}

export async function retryVideoRenderAdmin(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  insertAdminPipelineEvent: InsertAdminPipelineEventFn,
) {
  const renderId = typeof body.render_id === 'string' ? body.render_id.trim() : '';
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const configRow = await table(supabase, 'settings').select('value').eq('key', 'video_render_config').maybeSingle();
  if (configRow.error) return { ok: false, error: 'video_render_config_read_failed' };
  if (!isVideoRenderConfigEnvelope(configRow.data) || !isVideoRenderConfigValue((configRow.data as { value?: unknown } | null | undefined)?.value)) {
    return { ok: false, error: 'video_render_config_invalid_response' };
  }
  const cfg = normalizeVideoRenderConfigValue((configRow.data as { value?: unknown } | null | undefined)?.value);
  let render: Record<string, unknown> | null = null;

  if (renderId) {
    const { data, error } = await table(supabase, 'video_renders').select('id, tweet_id, source_media_id').eq('id', renderId).maybeSingle();
    if (error) throw error;
    render = data as Record<string, unknown> | null;
  }

  if (!render && tweetId) {
    const { data: mediaRows, error: mediaError } = await table(supabase, 'media')
      .select('id, storage_path, downloaded_at, mime_type, file_size, kind, duration_ms, src_url')
      .eq('tweet_id', tweetId)
      .order('ordering', { ascending: true });
    if (mediaError) throw mediaError;
    const source = selectSourceVideo((mediaRows ?? []) as XMediaRow[]);
    if (!source?.id) return { ok: false, error: 'No downloaded source video found for this post' };
    const { data: id, error } = await supabase.rpc('enqueue_video_render', {
      p_tweet_id: tweetId,
      p_source_media_id: source.id,
      p_render_version: cfg.renderVersion,
      p_failure_policy: cfg.failurePolicy,
    });
    if (error) throw error;
    render = { id, tweet_id: tweetId, source_media_id: source.id };
  }

  if (!render?.id || !render?.tweet_id || !render?.source_media_id) return { ok: false, error: 'render_id or tweet_id is required' };

  const { error: updateError } = await table(supabase, 'video_renders').update({
    status: 'queued',
    failure_policy: cfg.failurePolicy,
    render_version: cfg.renderVersion,
    output_storage_path: null,
    output_file_size: null,
    error: null,
    block_reason: null,
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    queued_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    failed_at: null,
    blocked_at: null,
    reviewed_at: null,
    reviewed_by: null,
  }).eq('id', render.id);
  if (updateError) throw updateError;

  await insertAdminPipelineEvent(supabase, String(render.tweet_id), 'video_render', 'queued', {
    source: 'admin_retry_video_render',
    render_id: render.id,
    mode: cfg.mode,
  });

  return { ok: true, render_id: render.id, tweet_id: render.tweet_id, mode: cfg.mode };
}

export async function setVideoRenderReviewedAdmin(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  userId?: string,
) {
  const renderIds = normalizeVideoRenderIds(body);
  if (!renderIds.length) return { ok: false, error: 'render_id or render_ids is required' };
  const reviewed = body.reviewed !== false;

  const { data: candidates, error: loadError } = await table(supabase, 'video_renders')
    .select('id, tweet_id, status')
    .in('id', renderIds);
  if (loadError) throw loadError;

  const rows = (candidates ?? []) as Array<Record<string, unknown>>;
  if (rows.length !== renderIds.length) {
    return { ok: false, error: 'One or more video renders were not found' };
  }
  const unsupported = rows.filter((row) => row.status !== 'failed' && row.status !== 'blocked');
  if (unsupported.length) {
    return { ok: false, error: 'Only failed or blocked video renders can be marked reviewed' };
  }

  const reviewedAt = reviewed ? new Date().toISOString() : null;
  const { data: updated, error: updateError } = await table(supabase, 'video_renders')
    .update({
      reviewed_at: reviewedAt,
      reviewed_by: reviewed ? userId ?? null : null,
    })
    .in('id', renderIds)
    .select('id, tweet_id, status, reviewed_at, reviewed_by');
  if (updateError) throw updateError;

  const eventRows = rows.map((row) => ({
    subject_type: 'post',
    subject_id: String(row.tweet_id),
    step: 'video_render_review',
    status: 'completed',
    started_at: reviewedAt ?? new Date().toISOString(),
    ended_at: reviewedAt ?? new Date().toISOString(),
    actor: userId ?? 'admin',
    meta: {
      source: 'admin-actions',
      render_id: row.id,
      reviewed,
    },
  }));
  try {
    const { error: pipelineEventError } = await table(supabase, 'pipeline_events').insert(eventRows);
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: 'admin-actions',
        action: 'video_render_review_pipeline_event_insert_failed',
        error: 'video_render_review_pipeline_event_insert_failed',
      }));
    }
  } catch (_e) {
    console.warn(JSON.stringify({
      function: 'admin-actions',
      action: 'video_render_review_pipeline_event_insert_failed',
      error: 'video_render_review_pipeline_event_insert_failed',
    }));
  }

  return {
    ok: true,
    reviewed,
    updated: ((updated ?? []) as Array<unknown>).length,
    render_ids: renderIds,
  };
}
