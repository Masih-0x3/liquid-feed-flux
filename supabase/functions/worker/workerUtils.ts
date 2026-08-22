const FAST_LANE_TYPES = new Set([
  "dedupe",
  "resolve_media",
  "download_media",
  "hydrate_tweet",
  "compute_signature",
]);
const MODEL_LANE_TYPES = new Set(["translate", "enrich"]);
const DELIVERY_LANE_TYPES = new Set(["deliver"]);

type JobLane = "fast" | "model" | "delivery";

export {
  formatMessageWithTemplate,
  stripMarkdownToPlain,
  extractNumericTweetId,
  extractHandleFromUrl,
} from "./tweetNormalizers.ts";

/**
 * Fetch size is a claim bound; these conservative execution caps are deliberately
 * separate so a larger fast-only claim cannot become hidden provider fan-out.
 */
export const DEFAULT_LANE_CAPACITIES: Readonly<Record<JobLane, number>> = {
  fast: 4,
  model: 2,
  delivery: 2,
};

export type LaneExecutionSnapshot = {
  lane: JobLane;
  lane_capacity: number;
  lane_selected: number;
  lane_executing: number;
  lane_saturated: boolean;
};

type ExtractedMediaItem = {
  type: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
};

type ResolvedVariant = {
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

export function laneCapacityFor(lane: JobLane): number {
  return DEFAULT_LANE_CAPACITIES[lane];
}

/**
 * Run the selected jobs with independent per-lane workers and preserve the input
 * order in the all-settled result. A rejected handler is retained as a rejected
 * result so one lane cannot abort accounting for the other lanes.
 */
export async function runJobsWithLaneCapacity<
  TJob extends Record<string, unknown>,
  TResult,
>(
  jobs: TJob[],
  execute: (job: TJob, metrics: LaneExecutionSnapshot) => Promise<TResult> | TResult,
): Promise<PromiseSettledResult<TResult>[]> {
  const selected: Record<JobLane, number> = { fast: 0, model: 0, delivery: 0 };
  const byLane: Record<JobLane, Array<{ job: TJob; index: number }>> = {
    fast: [],
    model: [],
    delivery: [],
  };
  jobs.forEach((job, index) => {
    const lane = jobLane(String(job.type ?? "unknown"));
    selected[lane] += 1;
    byLane[lane].push({ job, index });
  });

  const executing: Record<JobLane, number> = { fast: 0, model: 0, delivery: 0 };
  const settled = new Array<PromiseSettledResult<TResult>>(jobs.length);
  await Promise.all((Object.keys(byLane) as JobLane[]).map(async (lane) => {
    const queue = byLane[lane];
    const workerCount = Math.min(laneCapacityFor(lane), queue.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        executing[lane] += 1;
        const metrics: LaneExecutionSnapshot = {
          lane,
          lane_capacity: laneCapacityFor(lane),
          lane_selected: selected[lane],
          lane_executing: executing[lane],
          lane_saturated: executing[lane] >= laneCapacityFor(lane),
        };
        try {
          settled[item.index] = {
            status: "fulfilled",
            value: await execute(item.job, metrics),
          };
        } catch (reason) {
          settled[item.index] = { status: "rejected", reason };
        } finally {
          executing[lane] -= 1;
        }
      }
    }));
  }));
  return settled;
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

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

const MAX_METRIC_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function nonNegativeMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(MAX_METRIC_DURATION_MS, Math.max(0, Math.round(value)));
}

function boundedAttempt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return Math.min(100_000, value);
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
    ...extra,
    job_id: job.id ?? null,
    job_type: job.type ?? null,
    lane: jobLane(String(job.type ?? "unknown")),
    attempts: boundedAttempt(job.attempts),
    retry_count: (() => {
      const attempts = boundedAttempt(job.attempts);
      return attempts == null ? null : Math.max(0, attempts - 1);
    })(),
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
    retry_after_seconds: retryAfterSeconds ??
      (typeof extra.retry_after_seconds === "number" &&
          Number.isFinite(extra.retry_after_seconds)
        ? Math.max(0, Math.min(86_400, Math.floor(extra.retry_after_seconds)))
        : null),
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
