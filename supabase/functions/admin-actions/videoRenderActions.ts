import type { XMediaRow } from "../_shared/mediaSelection.ts";
import { selectSourceVideo } from "../_shared/videoRenderGate.ts";
import {
  normalizeVideoRenderConfigValue,
  serializeVideoRenderConfig,
} from "../_shared/videoRenderConfig.ts";
import type { SupabaseAdminClient } from "./types.ts";

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

type StorageClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data?: { signedUrl?: string }; error?: unknown }>;
    };
  };
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

const VIDEO_RENDER_FEEDBACK_LABELS = new Set([
  'pass',
  'needs_review',
  'fail',
  'language',
  'transcription',
  'translation',
  'subtitle_timing',
  'subtitle_style',
  'subtitle_placement',
  'watermark',
  'delogo',
  'wrong_decision',
  'other',
]);

export function sanitizeVideoRenderFeedbackLabel(value: unknown): string {
  const label = typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 80) : '';
  return VIDEO_RENDER_FEEDBACK_LABELS.has(label) ? label : 'other';
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

async function signedTempMediaUrl(supabase: SupabaseAdminClient, path: unknown): Promise<string | null> {
  if (typeof path !== 'string' || !path.trim()) return null;
  const { data, error } = await (supabase as SupabaseAdminClient & StorageClient).storage.from('temp-media').createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function loadVideoRenderConfigAdmin(supabase: SupabaseAdminClient) {
  const { data, error } = await table(supabase, 'settings').select('value').eq('key', 'video_render_config').maybeSingle();
  if (error) throw error;
  const config = normalizeVideoRenderConfigValue((data as { value?: unknown } | null | undefined)?.value);
  return { ok: true, config: serializeVideoRenderConfig(config) };
}

export async function updateVideoRenderConfigAdmin(supabase: SupabaseAdminClient, body: Record<string, unknown>) {
  const patch = body.config && typeof body.config === 'object' ? body.config : body;
  const { data: existing } = await table(supabase, 'settings').select('value').eq('key', 'video_render_config').maybeSingle();
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
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [cfg, rendersRes, heartbeatRes] = await Promise.all([
    loadVideoRenderConfigAdmin(supabase),
    table(supabase, 'video_renders')
      .select('status, metrics, queued_at, started_at, completed_at, failed_at, blocked_at, reviewed_at, updated_at, output_file_size')
      .gte('created_at', since)
      .order('updated_at', { ascending: false })
      .limit(5000),
    table(supabase, 'video_renderer_heartbeats')
      .select('renderer_id, status, version, render_version, running, processed, failed, last_error, last_seen_at, metadata')
      .order('last_seen_at', { ascending: false })
      .limit(10),
  ]);
  if (rendersRes.error) throw rendersRes.error;
  if (heartbeatRes.error) throw heartbeatRes.error;

  const counts: Record<string, number> = { queued: 0, running: 0, completed: 0, failed: 0, blocked: 0, expired: 0 };
  const totals = { render_ms: [] as number[], total_ms: [] as number[], output_bytes: 0 };
  let unreviewedIssues = 0;
  let reviewedIssues = 0;
  let oldestQueuedAt: string | null = null;
  for (const row of (rendersRes.data ?? []) as Array<Record<string, unknown>>) {
    const status = String(row.status ?? 'unknown');
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 'failed' || status === 'blocked') {
      if (row.reviewed_at) reviewedIssues += 1;
      else unreviewedIssues += 1;
    }
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
    heartbeats: heartbeatRes.data ?? [],
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
    .select('id, tweet_id, source_media_id, status, failure_policy, render_version, output_storage_path, output_file_size, width, height, duration_ms, source_language, target_language, metrics, error, block_reason, attempts, queued_at, started_at, completed_at, failed_at, blocked_at, reviewed_at, reviewed_by, updated_at, created_at, preflight')
    .in('status', statuses)
    .order('updated_at', { ascending: false });
  if (reviewState === 'unreviewed') query = query.is('reviewed_at', null);
  const { data: renders, error } = await query.limit(limit);
  if (error) throw error;

  const renderRows = (renders ?? []) as Array<Record<string, unknown>>;
  const tweetIds = [...new Set(renderRows.map((row) => String(row.tweet_id)).filter(Boolean))];
  const mediaIds = [...new Set(renderRows.map((row) => String(row.source_media_id)).filter(Boolean))];
  const [postsRes, mediaRes, feedbackRes] = await Promise.all([
    tweetIds.length
      ? table(supabase, 'posts').select('tweet_id, text_original, url, author_handle, created_at, delivery_decision, final_score').in('tweet_id', tweetIds)
      : Promise.resolve({ data: [], error: null }),
    mediaIds.length
      ? table(supabase, 'media').select('id, kind, storage_path, mime_type, src_url, file_size, duration_ms, width, height').in('id', mediaIds)
      : Promise.resolve({ data: [], error: null }),
    renderRows.length > 0
      ? table(supabase, 'video_render_feedback').select('render_id, label, note, created_at').in('render_id', renderRows.map((row) => row.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (postsRes.error) throw postsRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (feedbackRes.error) throw feedbackRes.error;
  const posts = new Map(((postsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [row.tweet_id, row]));
  const media = new Map(((mediaRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [row.id, row]));
  const feedbackByRender = new Map<string, Record<string, unknown>>();
  for (const item of (feedbackRes.data ?? []) as Array<Record<string, unknown>>) {
    if (!feedbackByRender.has(String(item.render_id))) feedbackByRender.set(String(item.render_id), item);
  }

  return {
    ok: true,
    rows: renderRows.map((row) => ({
      ...row,
      post: posts.get(row.tweet_id) ?? null,
      media: media.get(row.source_media_id) ?? null,
      latest_feedback: feedbackByRender.get(String(row.id)) ?? null,
      action_label: videoRenderActionLabel(row),
      activity_at: latestTimestamp(row.updated_at, row.completed_at, row.failed_at, row.blocked_at, row.started_at, row.queued_at),
    })),
  };
}

export async function getVideoRenderDetail(supabase: SupabaseAdminClient, body: Record<string, unknown>) {
  const renderId = typeof body.render_id === 'string' ? body.render_id.trim() : '';
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  let query = table(supabase, 'video_renders')
    .select('id, tweet_id, source_media_id, status, failure_policy, render_version, output_storage_path, output_mime_type, output_file_size, width, height, duration_ms, original_srt, persian_srt, translated_srt, ass_subtitles, source_language, target_language, preflight, metrics, error, block_reason, attempts, queued_at, started_at, completed_at, failed_at, blocked_at, reviewed_at, reviewed_by, posted_at, expires_at, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (renderId) query = query.eq('id', renderId);
  else if (tweetId) query = query.eq('tweet_id', tweetId);
  else return { ok: false, error: 'render_id or tweet_id is required' };

  const { data: renderRows, error } = await query;
  if (error) throw error;
  const render = ((renderRows ?? []) as Array<Record<string, unknown>>)[0];
  if (!render) return { ok: false, error: 'video render not found' };

  const [postRes, mediaRes, feedbackRes] = await Promise.all([
    table(supabase, 'posts').select('tweet_id, text_original, text_translated, url, author_handle, created_at, delivery_decision, final_score, x_tweet_id').eq('tweet_id', render.tweet_id).maybeSingle(),
    table(supabase, 'media').select('id, kind, storage_path, mime_type, src_url, file_size, duration_ms, width, height').eq('id', render.source_media_id).maybeSingle(),
    table(supabase, 'video_render_feedback').select('id, label, note, metadata, created_at, created_by').eq('render_id', render.id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (postRes.error) throw postRes.error;
  if (mediaRes.error) throw mediaRes.error;
  if (feedbackRes.error) throw feedbackRes.error;

  const media = mediaRes.data as Record<string, unknown> | null | undefined;
  const sourceUrl = await signedTempMediaUrl(supabase, media?.storage_path);
  const outputUrl = await signedTempMediaUrl(supabase, render.output_storage_path);
  return {
    ok: true,
    render: {
      ...render,
      action_label: videoRenderActionLabel(render),
      source_signed_url: sourceUrl,
      output_signed_url: outputUrl,
    },
    post: postRes.data ?? null,
    media: mediaRes.data ?? null,
    feedback: feedbackRes.data ?? [],
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
  await table(supabase, 'pipeline_events').insert(eventRows).then(() => null, () => null);

  return {
    ok: true,
    reviewed,
    updated: ((updated ?? []) as Array<unknown>).length,
    render_ids: renderIds,
  };
}

export async function saveVideoRenderFeedbackAdmin(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  insertAdminPipelineEvent: InsertAdminPipelineEventFn,
  userId?: string,
) {
  const renderId = typeof body.render_id === 'string' ? body.render_id.trim() : '';
  if (!renderId) return { ok: false, error: 'render_id is required' };
  const label = sanitizeVideoRenderFeedbackLabel(body.label);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : null;
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {};
  const { data: render, error: renderError } = await table(supabase, 'video_renders').select('tweet_id').eq('id', renderId).maybeSingle();
  if (renderError) throw renderError;
  if (!(render as { tweet_id?: unknown } | null | undefined)?.tweet_id) return { ok: false, error: 'video render not found' };
  const tweetId = String((render as { tweet_id: unknown }).tweet_id);
  const { data, error } = await table(supabase, 'video_render_feedback').insert({
    render_id: renderId,
    tweet_id: tweetId,
    label,
    note,
    metadata,
    created_by: userId ?? null,
  }).select('id, label, note, created_at').single();
  if (error) throw error;
  await insertAdminPipelineEvent(supabase, tweetId, 'video_render_feedback', 'completed', {
    render_id: renderId,
    label,
  });
  return { ok: true, feedback: data };
}
