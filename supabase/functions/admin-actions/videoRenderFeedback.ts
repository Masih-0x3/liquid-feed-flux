import type { SupabaseAdminClient } from "./types.ts";

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

type VideoRenderFeedbackRow = {
  id?: unknown;
  tweet_id?: unknown;
  label?: unknown;
  note?: unknown;
  created_at?: unknown;
  render_version?: unknown;
  render_revision?: unknown;
};

const VIDEO_RENDER_FEEDBACK_LABELS = new Set([
  "pass",
  "needs_review",
  "fail",
  "language",
  "transcription",
  "translation",
  "subtitle_timing",
  "subtitle_style",
  "subtitle_placement",
  "watermark",
  "delogo",
  "wrong_decision",
  "other",
]);

export function sanitizeVideoRenderFeedbackLabel(value: unknown): string {
  const label = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80)
    : "";
  return VIDEO_RENDER_FEEDBACK_LABELS.has(label) ? label : "other";
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function firstFeedbackRow(value: unknown): VideoRenderFeedbackRow | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const row = value[0];
  return row && typeof row === "object" ? row as VideoRenderFeedbackRow : null;
}

export async function saveVideoRenderFeedbackAdmin(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  insertAdminPipelineEvent: InsertAdminPipelineEventFn,
  userId?: string,
) {
  const renderId = typeof body.render_id === "string" ? body.render_id.trim() : "";
  if (!renderId) return { ok: false, error: "render_id is required" };
  const expectedRenderVersion = typeof body.render_version === "string"
    ? body.render_version.trim()
    : "";
  if (!expectedRenderVersion) {
    return { ok: false, error: "render_version is required" };
  }
  const expectedRenderRevision = positiveSafeInteger(body.render_revision);
  if (!expectedRenderRevision) {
    return { ok: false, error: "render_revision is required" };
  }

  const label = sanitizeVideoRenderFeedbackLabel(body.label);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
  const metadata = body.metadata && typeof body.metadata === "object"
    ? body.metadata as Record<string, unknown>
    : {};
  const { data, error } = await supabase.rpc("save_video_render_feedback_if_current", {
    p_render_id: renderId,
    p_expected_render_version: expectedRenderVersion,
    p_expected_render_revision: expectedRenderRevision,
    p_label: label,
    p_note: note,
    p_metadata: metadata,
    p_created_by: userId ?? null,
  });
  if (error) throw error;

  const feedback = firstFeedbackRow(data);
  const tweetId = typeof feedback?.tweet_id === "string" ? feedback.tweet_id : "";
  if (!feedback || !tweetId) {
    return { ok: false, error: "video render changed; refresh before saving feedback" };
  }

  await insertAdminPipelineEvent(supabase, tweetId, "video_render_feedback", "completed", {
    render_id: renderId,
    render_version: expectedRenderVersion,
    render_revision: expectedRenderRevision,
    label,
  });
  return { ok: true, feedback };
}
