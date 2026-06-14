const FAST_LANE_TYPES = new Set([
  "dedupe",
  "resolve_media",
  "download_media",
  "hydrate_tweet",
  "compute_signature",
]);
const MODEL_LANE_TYPES = new Set(["translate", "enrich"]);
const DELIVERY_LANE_TYPES = new Set(["deliver"]);

export type JobLane = "fast" | "model" | "delivery";

export type ExtractedMediaItem = {
  type: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
};

export type ResolvedVariant = {
  url: string;
  bitrate?: number;
  content_type?: string;
};

export function jobLane(type: string): JobLane {
  if (FAST_LANE_TYPES.has(type)) return "fast";
  if (MODEL_LANE_TYPES.has(type)) return "model";
  if (DELIVERY_LANE_TYPES.has(type)) return "delivery";
  return "fast";
}

export function maxBatchSizeForJobTypes(jobTypes: string[] | null): number {
  if (
    jobTypes && jobTypes.length > 0 &&
    jobTypes.every((type) => jobLane(type) === "fast")
  ) {
    return 40;
  }
  return 20;
}

export async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** Normalize any thrown/failure value to `Error` for `last_error` + dead-letter rows. */
export function jobError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason.trim());
  }
  try {
    const serialized = JSON.stringify(reason);
    if (serialized && serialized !== "{}") return new Error(serialized);
  } catch {
    // Fall through to the string fallback.
  }
  return new Error(String(reason ?? "unknown_error"));
}

export function formatMessageWithTemplate(
  post: Record<string, unknown>,
  account: Record<string, unknown> | null,
  messageTemplate: Record<string, unknown>,
): string {
  const placeholders: Record<string, string> = {
    "{translated_text}": String(
      post.text_translated || post.text_original || "",
    ),
    "{original_text}": String(post.text_original || ""),
    "{author_handle}": String(account?.handle || ""),
    "{author_name}": String(account?.display_name || ""),
    "{source_link}": messageTemplate.include_source_link && post.url
      ? `[${messageTemplate.source_link_text || "View original"}](${post.url})`
      : "",
    "{published_date}": post.tweeted_at
      ? new Date(post.tweeted_at as string).toLocaleDateString("fa-IR")
      : "",
    "{published_time}": post.tweeted_at
      ? new Date(post.tweeted_at as string).toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      })
      : "",
    "{hashtags}": String(messageTemplate.custom_hashtags || ""),
    "{media_info}": post.has_media ? "📸 تصویر" : "",
  };

  return Object.entries(placeholders).reduce((template, [key, value]) => {
    return template.replace(
      new RegExp(key.replace(/[{}]/g, "\\$&"), "g"),
      value,
    );
  }, String(messageTemplate.template || "{translated_text}"));
}

export function finiteMediaNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function videoUploadFilename(
  video: Record<string, unknown>,
  storagePath: string,
  mime: string,
): string {
  const existingExt = storagePath.match(/\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i)
    ?.[1]?.toLowerCase();
  const ext = existingExt ??
    (mime.includes("quicktime")
      ? "mov"
      : mime.includes("webm")
      ? "webm"
      : mime.includes("x-m4v")
      ? "m4v"
      : "mp4");
  const base = storagePath.split("/").pop()?.replace(/\.[^.]+$/, "") ||
    (typeof video.id === "string" && video.id ? `video_${video.id}` : "video");
  return `${base}.${ext}`;
}

export function extractMediaFromText(text: string): ExtractedMediaItem[] {
  const mediaItems: ExtractedMediaItem[] = [];
  if (!text) return mediaItems;

  const directMediaRegex =
    /https?:\/\/pbs\.twimg\.com\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|mov)/gi;
  const directMatches = text.match(directMediaRegex);
  if (directMatches) {
    for (const match of directMatches) {
      const isVideo = /\.(mp4|mov)$/i.test(match);
      mediaItems.push({ type: isVideo ? "video" : "image", url: match });
    }
  }
  return mediaItems;
}

export function isRecordValue(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function nonNegativeMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

export function jobTimingMeta(
  job: Record<string, unknown>,
  state: "queued" | "running" | "completed" | "failed",
  extra: Record<string, unknown> = {},
  nowMs = Date.now(),
): Record<string, unknown> {
  const createdMs = timestampMs(job.created_at);
  const nextRunMs = timestampMs(job.next_run_at);
  const startedMs = timestampMs(job.locked_at) ?? timestampMs(job.started_at) ??
    (state === "running" ? nowMs : null);
  const queueReferenceMs = state === "running" ? nowMs : startedMs ?? nowMs;
  const retryAfterSeconds = typeof extra.error === "string"
    ? parseRetryAfterFromMessage(extra.error)
    : null;
  return {
    job_id: job.id ?? null,
    job_type: job.type ?? null,
    lane: jobLane(String(job.type ?? "unknown")),
    attempts: job.attempts ?? null,
    priority: job.priority ?? null,
    queue_wait_ms: nonNegativeMs(
      createdMs == null ? null : queueReferenceMs - createdMs,
    ),
    claim_delay_ms: nonNegativeMs(
      nextRunMs == null ? null : queueReferenceMs - nextRunMs,
    ),
    worker_run_ms: state === "running" || state === "queued"
      ? null
      : nonNegativeMs(startedMs == null ? null : nowMs - startedMs),
    retry_after_seconds: retryAfterSeconds,
    ...extra,
  };
}

export function normalizeStep(type: string): string {
  switch (type) {
    case "translate":
      return "translate";
    case "deliver":
      return "deliver";
    case "download_media":
      return "media";
    case "moderate":
      return "moderate";
    case "hydrate_tweet":
      return "hydrate";
    case "resolve_media":
      return "resolve_media";
    default:
      return type;
  }
}

export function extractTelegramRetryAfter(
  result: Record<string, unknown>,
  description: string,
  statusCode: number,
): number | null {
  try {
    if (statusCode === 429) {
      const params = result?.parameters as Record<string, unknown> | undefined;
      const apiParam = params?.retry_after;
      if (typeof apiParam === "number" && isFinite(apiParam)) {
        return Math.max(1, Math.floor(apiParam));
      }
    }
    return parseRetryAfterFromMessage(description);
  } catch {
    return null;
  }
}

export function parseRetryAfterFromMessage(message: string): number | null {
  if (!message) return null;
  const match = message.match(/retry\s+after\s+(\d+)/i);
  if (match && match[1]) {
    const value = parseInt(match[1], 10);
    return isFinite(value) ? Math.max(1, value) : null;
  }
  return null;
}

export function isTelegramParseError(description: string): boolean {
  if (!description) return false;
  return /can't parse entities/i.test(description) ||
    /parse_mode/i.test(description);
}

export function stripMarkdownToPlain(text: string): string {
  if (!text) return text;
  return text.replace(/[\\*_`\[\]()~>#+=|{}.!-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Extract numeric tweet id from RSS guid/url. Twitter tweet IDs are 18-19 digit numbers.
export function extractNumericTweetId(
  rawTweetId: string,
  url?: string | null,
): string | null {
  const candidates: string[] = [rawTweetId];
  if (url) candidates.push(url);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const statusMatch = candidate.match(/status\/(\d{5,25})/);
    if (statusMatch) return statusMatch[1];
    const rawIdMatch = candidate.match(/(?:^|[^0-9])(\d{15,25})(?:$|[^0-9])/);
    if (rawIdMatch) return rawIdMatch[1];
  }
  return null;
}

export function rmUpgradeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("twimg.com")) {
      parsed.searchParams.set("name", "orig");
      return parsed.toString();
    }
  } catch {
    // Keep original URL on invalid input.
  }
  return url;
}

export function rmPickBestVariant(
  variants: ResolvedVariant[],
): ResolvedVariant | undefined {
  const mp4s = variants.filter((variant) =>
    (variant.content_type ?? "").includes("mp4") || variant.url.includes(".mp4")
  );
  const pool = mp4s.length ? mp4s : variants;
  return [...pool].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

export function extractHandleFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\//i,
  );
  return match ? match[1] : null;
}
