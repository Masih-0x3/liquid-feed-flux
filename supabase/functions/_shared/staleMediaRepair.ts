import type { XMediaRow } from "./mediaSelection.ts";

export class StaleMediaObjectError extends Error {
  storagePath: string;
  mediaId: string | null;
  originalMessage: string;

  constructor(
    storagePath: string,
    originalMessage: string,
    media: Pick<XMediaRow, "id"> | null = null,
  ) {
    super(`stale_media_object:${storagePath}:${originalMessage}`);
    this.name = "StaleMediaObjectError";
    this.storagePath = storagePath;
    this.mediaId = media?.id ?? null;
    this.originalMessage = originalMessage;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "");
}

export function isStorageObjectNotFoundError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const statusCode = error && typeof error === "object" && "statusCode" in error
    ? String((error as { statusCode?: unknown }).statusCode ?? "")
    : "";
  return statusCode === "404" ||
    message.includes("object not found") ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("nosuchkey");
}

export function staleMediaObjectErrorForDownload(
  storagePath: string,
  error: unknown,
  media: Pick<XMediaRow, "id"> | null = null,
): StaleMediaObjectError | null {
  if (!isStorageObjectNotFoundError(error)) return null;
  return new StaleMediaObjectError(storagePath, errorMessage(error), media);
}

export function isProcessedRenderStoragePath(storagePath: string): boolean {
  return storagePath.startsWith("processed/");
}

export async function repairStaleMediaObject(
  supabase: any,
  params: {
    tweetId: string;
    mediaId: string | null;
    storagePath: string;
    source: string;
    priority?: number;
  },
): Promise<{ mediaCleared: boolean; downloadQueued: boolean }> {
  const now = new Date().toISOString();
  let mediaCleared = false;

  if (params.mediaId) {
    const { error } = await supabase
      .from("media")
      .update({
        storage_path: null,
        downloaded_at: null,
        file_size: null,
        mime_type: null,
      })
      .eq("id", params.mediaId)
      .eq("storage_path", params.storagePath);
    if (error) throw new Error(`stale media clear failed: ${error.message ?? "unknown error"}`);
    mediaCleared = true;
  }

  let hasPendingRepair = false;
  try {
    const { data } = await supabase
      .from("jobs")
      .select("id")
      .in("type", ["resolve_media", "download_media"])
      .in("status", ["pending", "running"])
      .filter("payload->>tweet_id", "eq", params.tweetId)
      .limit(1);
    hasPendingRepair = Array.isArray(data) && data.length > 0;
  } catch (_e) {
    hasPendingRepair = false;
  }

  let downloadQueued = false;
  if (!hasPendingRepair) {
    const { error } = await supabase.from("jobs").insert({
      type: "download_media",
      payload: {
        tweet_id: params.tweetId,
        source: params.source,
        repair: "stale_media_object",
        media_id: params.mediaId,
        stale_storage_path: params.storagePath,
      },
      status: "pending",
      idempotency_key:
        `download_media:stale_storage:${params.tweetId}:${params.mediaId ?? params.storagePath}:${Date.now()}`,
      next_run_at: now,
      priority: params.priority ?? 12,
    });
    if (error) throw new Error(`stale media download enqueue failed: ${error.message ?? "unknown error"}`);
    downloadQueued = true;
  }

  try {
    await supabase.from("pipeline_events").insert({
      subject_type: "post",
      subject_id: params.tweetId,
      step: "download_media",
      status: "queued",
      started_at: null,
      completed_at: null,
      error: null,
      meta: {
        source: params.source,
        repair: "stale_media_object",
        media_id: params.mediaId,
        storage_path: params.storagePath,
        media_cleared: mediaCleared,
        download_queued: downloadQueued,
      },
    });
  } catch (_e) {
  }

  return { mediaCleared, downloadQueued };
}
