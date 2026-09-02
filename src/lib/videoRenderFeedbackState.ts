export type VideoRenderFeedbackTarget = {
  render_id?: string | null;
  render_version?: string | null;
  render_revision?: number | null;
};

export type VideoRenderFeedbackDraft = {
  targetKey: string | null;
  label: string;
  note: string;
};

export type PendingVideoRenderFeedbackKeys = ReadonlyMap<string, number>;

export const DEFAULT_VIDEO_RENDER_FEEDBACK_LABEL = 'pass';

function keyPart(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function videoRenderFeedbackKey(
  input: VideoRenderFeedbackTarget | null | undefined,
): string | null {
  const renderId = keyPart(input?.render_id);
  const renderVersion = keyPart(input?.render_version);
  const renderRevision = positiveSafeInteger(input?.render_revision);
  return renderId && renderVersion && renderRevision
    ? `feedback:render:${renderId}:version:${renderVersion}:revision:${renderRevision}`
    : null;
}

export function createVideoRenderFeedbackDraft(
  targetKey: string | null = null,
): VideoRenderFeedbackDraft {
  return {
    targetKey,
    label: DEFAULT_VIDEO_RENDER_FEEDBACK_LABEL,
    note: '',
  };
}

export function rebaseVideoRenderFeedbackDraft(
  draft: VideoRenderFeedbackDraft,
  targetKey: string | null,
): VideoRenderFeedbackDraft {
  return draft.targetKey === targetKey
    ? draft
    : createVideoRenderFeedbackDraft(targetKey);
}

export function isVideoRenderFeedbackDraftCurrent(
  draft: VideoRenderFeedbackDraft,
  targetKey: string | null,
): boolean {
  return targetKey !== null && draft.targetKey === targetKey;
}

export function updateVideoRenderFeedbackDraft(
  draft: VideoRenderFeedbackDraft,
  targetKey: string | null,
  update: Partial<Pick<VideoRenderFeedbackDraft, 'label' | 'note'>>,
): VideoRenderFeedbackDraft {
  return {
    ...rebaseVideoRenderFeedbackDraft(draft, targetKey),
    ...update,
  };
}

export function beginVideoRenderFeedbackSave(
  pending: PendingVideoRenderFeedbackKeys,
  input: VideoRenderFeedbackTarget,
): Map<string, number> {
  const key = videoRenderFeedbackKey(input);
  const next = new Map(pending);
  if (key) next.set(key, (next.get(key) ?? 0) + 1);
  return next;
}

export function settleVideoRenderFeedbackSave(
  pending: PendingVideoRenderFeedbackKeys,
  input: VideoRenderFeedbackTarget,
): Map<string, number> {
  const key = videoRenderFeedbackKey(input);
  const next = new Map(pending);
  if (!key) return next;

  const count = next.get(key) ?? 0;
  if (count <= 1) next.delete(key);
  else next.set(key, count - 1);
  return next;
}

export function isVideoRenderFeedbackSavePending(
  pending: PendingVideoRenderFeedbackKeys,
  input: VideoRenderFeedbackTarget | null | undefined,
): boolean {
  const key = videoRenderFeedbackKey(input);
  return key !== null && (pending.get(key) ?? 0) > 0;
}
