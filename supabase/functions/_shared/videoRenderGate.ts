import {
  hasVideoIntent,
  isValidVideoDownload,
  type XMediaRow,
} from "./mediaSelection.ts";

export type VideoRenderStatus = "queued" | "running" | "completed" | "failed" | "expired" | "blocked";
export type VideoRenderFailurePolicy = "post_original" | "block";

export interface VideoRenderRow {
  id: string;
  tweet_id: string;
  source_media_id: string | null;
  status: VideoRenderStatus;
  failure_policy?: VideoRenderFailurePolicy | null;
  output_storage_path?: string | null;
  output_mime_type?: string | null;
  output_file_size?: number | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  render_version?: string | null;
  error?: string | null;
  block_reason?: string | null;
  source_language?: string | null;
  target_language?: string | null;
  preflight?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type VideoRenderGateDecision =
  | { action: "none"; reason: "no_video" | "rendering_disabled" }
  | { action: "wait_media"; media: XMediaRow; reason: "source_video_pending" }
  | { action: "enqueue_render"; media: XMediaRow; reason: "no_render" | "render_expired" }
  | { action: "wait_render"; media: XMediaRow; render: VideoRenderRow; reason: "render_pending" }
  | { action: "use_render"; media: XMediaRow; render: VideoRenderRow }
  | { action: "use_original"; media: XMediaRow; render: VideoRenderRow; reason: "render_failed_post_original" | "render_not_needed" }
  | { action: "block"; media: XMediaRow; render: VideoRenderRow; reason: string };

export interface VideoRenderGateInput {
  tweetId: string;
  mediaRows: XMediaRow[];
  renderRows: VideoRenderRow[];
  renderingEnabled?: boolean;
}

function sortableTime(row: VideoRenderRow): number {
  const raw = row.updated_at ?? row.created_at ?? "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function newestFirst(a: VideoRenderRow, b: VideoRenderRow): number {
  return sortableTime(b) - sortableTime(a);
}

function renderForSource(render: VideoRenderRow, source: XMediaRow, tweetId: string): boolean {
  if (render.tweet_id !== tweetId) return false;
  if (!render.source_media_id) return true;
  return Boolean(source.id && render.source_media_id === source.id);
}

function completedWithoutProcessing(row: VideoRenderRow): boolean {
  if (row.status !== "completed" || row.output_storage_path) return false;
  const preflight = row.preflight ?? {};
  return preflight.processingMode === "original_unmodified" ||
    preflight.processing_mode === "original_unmodified";
}

export function selectSourceVideo(mediaRows: XMediaRow[]): XMediaRow | null {
  return mediaRows.find(isValidVideoDownload) ?? null;
}

export function decideVideoRenderGate(input: VideoRenderGateInput): VideoRenderGateDecision {
  if (input.renderingEnabled === false) return { action: "none", reason: "rendering_disabled" };

  const source = selectSourceVideo(input.mediaRows);
  if (!source) {
    const pendingVideo = input.mediaRows.find(hasVideoIntent);
    return pendingVideo
      ? { action: "wait_media", media: pendingVideo, reason: "source_video_pending" }
      : { action: "none", reason: "no_video" };
  }

  const relevant = input.renderRows
    .filter((row) => renderForSource(row, source, input.tweetId))
    .sort(newestFirst);

  const latest = relevant[0];
  if (latest?.status === "blocked") {
    return { action: "block", media: source, render: latest, reason: latest.block_reason ?? latest.error ?? "video_render_blocked" };
  }

  const completed = relevant.find((row) => row.status === "completed" && !!row.output_storage_path);
  if (completed) return { action: "use_render", media: source, render: completed };

  const originalCompleted = relevant.find(completedWithoutProcessing);
  if (originalCompleted) {
    return { action: "use_original", media: source, render: originalCompleted, reason: "render_not_needed" };
  }

  const pending = relevant.find((row) => row.status === "queued" || row.status === "running");
  if (pending) return { action: "wait_render", media: source, render: pending, reason: "render_pending" };

  const failed = relevant.find((row) => row.status === "failed");
  if (failed) {
    const policy = failed.failure_policy ?? "post_original";
    if (policy === "post_original") {
      return { action: "use_original", media: source, render: failed, reason: "render_failed_post_original" };
    }
    return { action: "block", media: source, render: failed, reason: "render_failed" };
  }

  const expired = relevant.find((row) => row.status === "expired");
  if (expired) return { action: "enqueue_render", media: source, reason: "render_expired" };

  return { action: "enqueue_render", media: source, reason: "no_render" };
}

export function applyRenderedVideoPreference(
  mediaRows: XMediaRow[],
  decision: VideoRenderGateDecision,
): XMediaRow[] {
  if (decision.action !== "use_render") return mediaRows;
  const sourceId = decision.media.id;
  const outputPath = decision.render.output_storage_path;
  if (!sourceId || !outputPath) return mediaRows;

  return mediaRows.map((row) => {
    if (row.id !== sourceId) return row;
    return {
      ...row,
      storage_path: outputPath,
      mime_type: decision.render.output_mime_type ?? "video/mp4",
      file_size: decision.render.output_file_size ?? row.file_size ?? null,
      duration_ms: decision.render.duration_ms ?? row.duration_ms ?? null,
      downloaded_at: row.downloaded_at ?? decision.render.updated_at ?? new Date(0).toISOString(),
    };
  });
}
