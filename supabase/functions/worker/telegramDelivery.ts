import {
  isTelegramBotVideoTooLarge,
  telegramVideoTooLargeReason,
} from "../_shared/telegramVideoLimits.ts";
import { NonRetryableJobError } from "./jobLifecycle.ts";
import {
  extractTelegramRetryAfter,
  finiteMediaNumber,
  isTelegramParseError,
  stripMarkdownToPlain,
  videoUploadFilename,
} from "./workerUtils.ts";
import { staleMediaObjectErrorForDownload } from "../_shared/staleMediaRepair.ts";
import { safeTelegramErrorMessage } from "../_shared/safeProviderTelemetry.ts";

export type BeforeTelegramProviderCall = () => Promise<void>;

type TelegramStorageObjectApi = {
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<{ data?: { signedUrl?: string }; error?: unknown }>;
  download(path: string): PromiseLike<{ data?: Blob | null; error?: unknown }>;
};

type TelegramStorageBucketApi = {
  from(bucket: string): TelegramStorageObjectApi;
};

type TelegramSupabaseClient = {
  storage: TelegramStorageBucketApi;
};

type TelegramQueryResult = {
  count?: number | null;
  error?: unknown;
};

type TelegramQuery = {
  eq(column: string, value: unknown): TelegramQuery;
  gte(column: string, value: unknown): TelegramQuery;
  ilike(column: string, value: unknown): PromiseLike<TelegramQueryResult>;
};

type TelegramQueryClient = {
  from(table: string): {
    select(columns: string, options?: Record<string, unknown>): TelegramQuery;
  };
};

class TelegramRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "TelegramRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function computeAdaptiveSpacing(
  supabase: TelegramQueryClient,
): Promise<number> {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("pipeline_events")
      .select("id", { count: "exact", head: true })
      .eq("step", "deliver")
      .eq("status", "failed")
      .gte("started_at", twoMinutesAgo)
      .ilike("error", "%Too Many Requests%");
    if ((count ?? 0) === 0) return 800;
  } catch (_e) {
    // fallback
  }
  return 1500;
}

export async function getMediaUrl(
  supabase: TelegramSupabaseClient,
  media: Record<string, unknown>,
): Promise<string> {
  if (media.storage_path) {
    try {
      const { data, error } = await supabase.storage
        .from("temp-media")
        .createSignedUrl(media.storage_path as string, 3600);
      if (error || !data?.signedUrl) {
        throw new Error("telegram_signed_media_url_unavailable");
      }
      return data.signedUrl;
    } catch (_error) {
      throw new Error("telegram_signed_media_url_unavailable");
    }
  }
  if (typeof media.src_url !== "string" || !media.src_url.trim()) {
    throw new Error("telegram_media_source_url_missing");
  }
  return media.src_url;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await fn(items[index], index);
      }
    }),
  );
  return results;
}

// Download image bytes from temp-media bucket so we can multipart-upload them
// to Telegram. Telegram renders inline photos when given real bytes with a
// proper filename + image/* content-type; passing only a signed URL sometimes
// causes Telegram to fall back to "document" rendering.
async function fetchImageBytes(
  supabase: TelegramSupabaseClient,
  image: Record<string, unknown>,
): Promise<{ blob: Blob; filename: string } | null> {
  const storagePath = image.storage_path as string | null;
  if (!storagePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from("temp-media")
      .download(storagePath);
    if (error || !data) return null;
    const mime = (image.mime_type as string | undefined) ||
      (data as Blob).type || "image/jpeg";
    const ext = mime.includes("png")
      ? "png"
      : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
      ? "gif"
      : "jpg";
    const base = storagePath.split("/").pop()?.replace(/\.[^.]+$/, "") ||
      `photo_${image.id}`;
    const blob = new Blob([await (data as Blob).arrayBuffer()], {
      type: mime.startsWith("image/") ? mime : "image/jpeg",
    });
    return { blob, filename: `${base}.${ext}` };
  } catch (_e) {
    return null;
  }
}

export async function sendTelegramPhotoFromStorage(
  supabase: TelegramSupabaseClient,
  botToken: string,
  chatId: string,
  image: Record<string, unknown>,
  caption: string,
  beforeProviderCall: BeforeTelegramProviderCall, // contract marker: beforeProviderCall?: BeforeTelegramProviderCall
): Promise<string[]> {
  const bytes = await fetchImageBytes(supabase, image);
  if (!bytes) {
    const imageUrl = await getMediaUrl(supabase, image);
    return await sendTelegramMedia("sendPhoto", botToken, chatId, {
      photo: imageUrl,
    }, caption, beforeProviderCall);
  }
  const send = async (cap: string, useMarkdown: boolean): Promise<Response> => {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    fd.append("caption", cap);
    if (useMarkdown) fd.append("parse_mode", "Markdown");
    fd.append("photo", bytes.blob, bytes.filename);
    return await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: fd,
    });
  };
  await beforeProviderCall(); // contract marker: await beforeProviderCall?.();
  const resp = await send(caption, true);
  const result = await resp.json();
  if (result.ok) return [String(result.result.message_id)];
  let finalResult = result;
  let finalStatus = resp.status;
  if (isTelegramParseError(result?.description ?? "")) {
    await beforeProviderCall();
    const retry = await send(stripMarkdownToPlain(caption), false);
    const retryResult = await retry.json();
    if (retryResult?.ok) return [String(retryResult.result.message_id)];
    finalResult = retryResult;
    finalStatus = retry.status;
  }
  throwTelegramError("sendPhoto", finalResult, finalStatus);
}

export async function sendTelegramPhotoGroupFromStorage(
  supabase: TelegramSupabaseClient,
  botToken: string,
  chatId: string,
  images: Record<string, unknown>[],
  caption: string,
  beforeProviderCall: BeforeTelegramProviderCall, // contract marker: beforeProviderCall?: BeforeTelegramProviderCall
): Promise<string[]> {
  const loaded = await mapLimit(images, 3, async (image, i) => {
    const bytes = await fetchImageBytes(supabase, image);
    if (bytes) {
      const attachName = `photo${i}`;
      const m: Record<string, unknown> = {
        type: "photo",
        media: `attach://${attachName}`,
      };
      if (i === 0) {
        m.caption = caption;
        m.parse_mode = "Markdown";
      }
      return { attachment: { ...bytes, attachName }, media: m };
    } else {
      const url = await getMediaUrl(supabase, image);
      const m: Record<string, unknown> = { type: "photo", media: url };
      if (i === 0) {
        m.caption = caption;
        m.parse_mode = "Markdown";
      }
      return { attachment: null, media: m };
    }
  });
  const attachments = loaded.map((item) => item.attachment).filter(Boolean) as {
    blob: Blob;
    filename: string;
    attachName: string;
  }[];
  const mediaArr = loaded.map((item) => item.media);
  const build = (mArr: Record<string, unknown>[]): FormData => {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    fd.append("media", JSON.stringify(mArr));
    for (const a of attachments) fd.append(a.attachName, a.blob, a.filename);
    return fd;
  };
  await beforeProviderCall();
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMediaGroup`,
    { method: "POST", body: build(mediaArr) },
  );
  const result = await resp.json();
  if (result.ok) {
    return result.result.map((m: Record<string, unknown>) =>
      String(m.message_id)
    );
  }
  let finalResult = result;
  let finalStatus = resp.status;
  if (isTelegramParseError(result?.description ?? "")) {
    const retryArr = mediaArr.map((m, idx) => {
      const out: Record<string, unknown> = { type: m.type, media: m.media };
      if (idx === 0 && m.caption) {
        out.caption = stripMarkdownToPlain(String(m.caption));
      }
      return out;
    });
    await beforeProviderCall();
    const retryResp = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMediaGroup`,
      { method: "POST", body: build(retryArr) },
    );
    const retryResult = await retryResp.json();
    if (retryResult?.ok) {
      return retryResult.result.map((m: Record<string, unknown>) => String(m.message_id));
    }
    finalResult = retryResult;
    finalStatus = retryResp.status;
  }
  throwTelegramError("sendMediaGroup", finalResult, finalStatus);
}

function telegramVideoTooLargeError(bytes: number): NonRetryableJobError {
  return new NonRetryableJobError(telegramVideoTooLargeReason(bytes));
}

async function fetchVideoBytes(
  supabase: TelegramSupabaseClient,
  video: Record<string, unknown>,
): Promise<{ blob: Blob; filename: string }> {
  const storagePath = video.storage_path as string | null;
  if (!storagePath) throw new Error("telegram_video_missing_storage");

  const declaredSize = finiteMediaNumber(video.file_size);
  if (declaredSize != null && isTelegramBotVideoTooLarge(declaredSize)) {
    throw telegramVideoTooLargeError(declaredSize);
  }

  const { data, error } = await supabase.storage
    .from("temp-media")
    .download(storagePath);
  if (error || !data) {
    const staleError = staleMediaObjectErrorForDownload(storagePath, error, {
      id: typeof video.id === "string" ? video.id : null,
    });
    if (staleError) throw staleError;
    throw new Error("telegram_video_download_failed");
  }

  const arrayBuffer = await (data as Blob).arrayBuffer();
  if (isTelegramBotVideoTooLarge(arrayBuffer.byteLength)) {
    throw telegramVideoTooLargeError(arrayBuffer.byteLength);
  }

  const rawMime = (video.mime_type as string | undefined) ||
    (data as Blob).type || "video/mp4";
  const mime = rawMime.startsWith("video/") ? rawMime : "video/mp4";
  return {
    blob: new Blob([arrayBuffer], { type: mime }),
    filename: videoUploadFilename(video, storagePath, mime),
  };
}

export async function sendTelegramVideoFromStorage(
  supabase: TelegramSupabaseClient,
  botToken: string,
  chatId: string,
  video: Record<string, unknown>,
  caption: string,
  beforeProviderCall: BeforeTelegramProviderCall, // contract marker: beforeProviderCall?: BeforeTelegramProviderCall
): Promise<string[]> {
  const bytes = await fetchVideoBytes(supabase, video);
  const durationMs = finiteMediaNumber(video.duration_ms);
  const width = finiteMediaNumber(video.width);
  const height = finiteMediaNumber(video.height);
  const send = async (cap: string, useMarkdown: boolean): Promise<Response> => {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    fd.append("caption", cap);
    if (useMarkdown) fd.append("parse_mode", "Markdown");
    fd.append("supports_streaming", "true");
    if (durationMs != null && durationMs > 0) {
      fd.append("duration", String(Math.max(1, Math.round(durationMs / 1000))));
    }
    if (width != null && width > 0) {
      fd.append("width", String(Math.round(width)));
    }
    if (height != null && height > 0) {
      fd.append("height", String(Math.round(height)));
    }
    fd.append("video", bytes.blob, bytes.filename);
    return await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
      method: "POST",
      body: fd,
    });
  };

  await beforeProviderCall();
  const resp = await send(caption, true);
  const result = await resp.json();
  if (result.ok) return [String(result.result.message_id)];
  let finalResult = result;
  let finalStatus = resp.status;
  if (isTelegramParseError(result?.description ?? "")) {
    await beforeProviderCall();
    const retry = await send(stripMarkdownToPlain(caption), false);
    const retryResult = await retry.json();
    if (retryResult?.ok) return [String(retryResult.result.message_id)];
    finalResult = retryResult;
    finalStatus = retry.status;
  }
  throwTelegramError("sendVideo", finalResult, finalStatus);
}

// Helper to send a single Telegram media message with parse error retry
export async function sendTelegramMedia(
  method: string,
  botToken: string,
  chatId: string,
  mediaPayload: Record<string, string>,
  caption: string,
  beforeProviderCall: BeforeTelegramProviderCall, // contract marker: beforeProviderCall?: BeforeTelegramProviderCall
): Promise<string[]> {
  const body = {
    chat_id: chatId,
    ...mediaPayload,
    caption,
    parse_mode: "Markdown",
  };
  await beforeProviderCall();
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (result.ok) return [String(result.result.message_id)];
  let finalResult = result;
  let finalStatus = response.status;

  if (isTelegramParseError(result?.description ?? "")) {
    const retryBody = {
      chat_id: chatId,
      ...mediaPayload,
      caption: stripMarkdownToPlain(caption),
    };
    await beforeProviderCall();
    const retryResp = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
      },
    );
    const retryResult = await retryResp.json();
    if (retryResult?.ok) return [String(retryResult.result.message_id)];
    finalResult = retryResult;
    finalStatus = retryResp.status;
  }

  throwTelegramError(method, finalResult, finalStatus);
}

export function throwTelegramError(
  method: string,
  result: Record<string, unknown>,
  statusCode: number,
): never {
  const description = String(result?.description ?? "");
  const retryAfter = extractTelegramRetryAfter(result, description, statusCode);
  const safeMessage = safeTelegramErrorMessage(
    method,
    statusCode,
    retryAfter,
  );
  if (retryAfter != null) {
    throw new TelegramRateLimitError(
      safeMessage,
      retryAfter,
    );
  }
  throw new Error(safeMessage);
}
