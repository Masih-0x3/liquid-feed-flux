import type { MonitoringEntry, PipelineEvent } from "@/hooks/useMonitoringData";
import { formatPipelineError, formatXBadge } from "@/lib/pipelineMessages";

export type TimelineTone = "good" | "warn" | "bad" | "muted" | "info";

export interface TimelineDeliverySummary {
  platform: "Telegram" | "X";
  label: string;
  tone: TimelineTone;
  detail: string;
  timestamp: string | null;
  rawTimestamp: string | null;
  timestampLabel: string | null;
}

export interface TimelineEventDisplay {
  title: string;
  platform: string;
  platformTone: TimelineTone;
  statusLabel: string;
  statusTone: TimelineTone;
  timestamp: string;
  rawTimestamp: string | null;
  duration: string | null;
  timingBadges: Array<{ label: string; value: string }>;
  detail: string | null;
  errorTitle: string | null;
  errorDetail: string | null;
  rawStep: string;
}

export interface TimelineEventGroup {
  key: string;
  title: string;
  platform: string;
  platformTone: TimelineTone;
  statusLabel: string;
  statusTone: TimelineTone;
  timestamp: string;
  rawTimestamp: string | null;
  duration: string | null;
  timingBadges: Array<{ label: string; value: string }>;
  detail: string | null;
  updateCount: number;
  events: TimelineEventDisplay[];
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function formatMsDuration(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function buildTimingBadges(meta: Record<string, unknown> | undefined): Array<{ label: string; value: string }> {
  if (!meta) return [];
  const fields: Array<[string, string]> = [
    ["queue_wait_ms", "wait"],
    ["claim_delay_ms", "claim"],
    ["worker_run_ms", "run"],
    ["scoring_call_ms", "score"],
    ["translation_call_ms", "translate"],
    ["telegram_api_ms", "Telegram"],
    ["media_download_ms", "media"],
    ["x_api_ms", "X"],
  ];
  return fields.flatMap(([key, label]) => {
    const value = formatMsDuration(meta[key]);
    return value ? [{ label, value }] : [];
  });
}

function statusTone(status: string): TimelineTone {
  const normalized = status.toLowerCase();
  if (["completed", "posted", "delivered", "success", "approved"].includes(normalized)) return "good";
  if (["failed", "error", "rejected"].includes(normalized)) return "bad";
  if (["queued", "pending", "retrying", "blocked"].includes(normalized)) return "warn";
  if (["running", "processing"].includes(normalized)) return "info";
  return "muted";
}

function classifyStep(step: string): Pick<TimelineEventDisplay, "title" | "platform" | "platformTone" | "detail"> {
  const normalized = step.toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized.includes("hydrate")) {
    return { title: "Tweet hydration", platform: "X read", platformTone: "info", detail: "Fetches full tweet text for truncated posts." };
  }
  if (normalized.includes("x_dispatch")) {
    return { title: "X dispatch", platform: "X", platformTone: "info", detail: "Event-driven X candidate check." };
  }
  if (normalized.includes("x_post") || normalized.includes("x_poster") || normalized.includes("force_x")) {
    return { title: "X posting", platform: "X", platformTone: "info", detail: "External delivery to X." };
  }
  if (normalized === "deliver" || normalized.includes("telegram") || normalized.includes("force_telegram")) {
    return { title: "Telegram delivery", platform: "Telegram", platformTone: "good", detail: "External delivery to Telegram." };
  }
  if (normalized.includes("translate")) {
    return { title: "Translation", platform: "OpenAI", platformTone: "info", detail: "Persian translation step." };
  }
  if (normalized.includes("score") || normalized.includes("filter")) {
    return { title: "Scoring", platform: "OpenAI", platformTone: "info", detail: "Editorial score and delivery decision." };
  }
  if (normalized.includes("dedupe") || normalized.includes("signature")) {
    return { title: "Duplicate gate", platform: "Internal", platformTone: "muted", detail: "Duplicate and coverage check before downstream work." };
  }
  if (normalized.includes("media") || normalized.includes("download") || normalized.includes("resolve")) {
    return { title: "Media processing", platform: "Media", platformTone: "warn", detail: "Resolves and downloads sendable media." };
  }
  if (normalized.includes("enrich")) {
    return { title: "Enrichment", platform: "OpenAI", platformTone: "info", detail: "Manual X draft generation and review." };
  }
  if (normalized.includes("worker") || normalized.includes("reconcile")) {
    return { title: "Worker queue", platform: "Internal", platformTone: "muted", detail: "Queue maintenance or worker dispatch." };
  }
  return { title: titleCase(step), platform: "Internal", platformTone: "muted", detail: null };
}

function describeError(step: string, raw: string | null | undefined): { title: string | null; detail: string | null } {
  if (!raw) return { title: null, detail: null };
  const normalizedStep = step.toLowerCase();
  if (normalizedStep === "deliver" || normalizedStep.includes("telegram")) {
    const formatted = formatPipelineError(raw);
    if (formatted.title === (formatted.detail ?? raw)) {
      return { title: "Telegram request failed", detail: raw };
    }
    return { title: formatted.title, detail: formatted.detail ?? raw };
  }
  const formatted = formatPipelineError(raw);
  return { title: formatted.title, detail: formatted.detail ?? raw };
}

export function describePipelineEvent(event: PipelineEvent): TimelineEventDisplay {
  const classified = classifyStep(event.step);
  const error = describeError(event.step, event.error);
  const timestampSource = event.ended_at ?? event.started_at;
  return {
    ...classified,
    statusLabel: titleCase(event.status || "unknown"),
    statusTone: statusTone(event.status || ""),
    timestamp: formatTimestamp(timestampSource) ?? "No timestamp",
    rawTimestamp: timestampSource ?? null,
    duration: formatDuration(event.started_at, event.ended_at),
    timingBadges: buildTimingBadges(event.meta),
    errorTitle: error.title,
    errorDetail: error.detail,
    rawStep: event.step,
  };
}

function eventTimestampSource(event: PipelineEvent): string | null {
  return event.ended_at ?? event.started_at ?? null;
}

function eventTimestampMs(event: PipelineEvent | TimelineEventDisplay | TimelineEventGroup): number {
  const raw = "rawTimestamp" in event ? event.rawTimestamp : eventTimestampSource(event);
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestCompletedDeliveryEvent(events: PipelineEvent[], platform: "Telegram" | "X"): PipelineEvent | null {
  const matches = events.filter((event) => {
    const step = event.step.toLowerCase().replace(/[-\s]+/g, "_");
    const status = event.status.toLowerCase();
    if (!["completed", "posted", "delivered", "success"].includes(status)) return false;
    if (platform === "Telegram") return step === "deliver" || step.includes("telegram");
    return step.includes("x_post") || step.includes("x_poster") || step.includes("force_x");
  });
  return matches.sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a))[0] ?? null;
}

export function buildPipelineTimelineGroups(events: PipelineEvent[]): TimelineEventGroup[] {
  const groups = new Map<string, TimelineEventGroup>();

  for (const event of events) {
    const display = describePipelineEvent(event);
    const key = `${display.title}:${display.platform}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        title: display.title,
        platform: display.platform,
        platformTone: display.platformTone,
        statusLabel: display.statusLabel,
        statusTone: display.statusTone,
        timestamp: display.timestamp,
        rawTimestamp: display.rawTimestamp,
        duration: display.duration,
        timingBadges: display.timingBadges,
        detail: display.detail,
        updateCount: 1,
        events: [display],
      });
      continue;
    }

    existing.events.push(display);
    existing.updateCount += 1;
    const ordered = [...existing.events].sort((a, b) => eventTimestampMs(a) - eventTimestampMs(b));
    const latest = ordered[ordered.length - 1];
    existing.statusLabel = latest.statusLabel;
    existing.statusTone = latest.statusTone;
    existing.timestamp = latest.timestamp;
    existing.rawTimestamp = latest.rawTimestamp;
    existing.duration = formatDuration(ordered[0]?.rawTimestamp, latest.rawTimestamp);
    existing.timingBadges = latest.timingBadges;
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      events: [...group.events].sort((a, b) => eventTimestampMs(a) - eventTimestampMs(b)),
    }))
    .sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a));
}

export function buildDeliverySummary(entry: MonitoringEntry, events: PipelineEvent[] = []): TimelineDeliverySummary[] {
  const telegramDelivered = entry.is_delivered || entry.delivery_status === "posted";
  const telegramFailed = entry.delivery_job_status === "failed" || entry.delivery_status === "failed" || Boolean(entry.delivery_error);
  const telegramPending = ["pending", "running", "queued"].includes(entry.delivery_job_status) || entry.delivery_status === "pending";
  const messageCount = entry.telegram_message_ids?.length ?? 0;
  const telegramDeliveryEvent = latestCompletedDeliveryEvent(events, "Telegram");
  const telegramTimestamp = telegramDeliveryEvent ? eventTimestampSource(telegramDeliveryEvent) : null;

  const xBadge = formatXBadge(entry);
  const xPosted = entry.x_status === "posted";
  const xFailed = entry.x_status === "failed";
  const xSkipped = entry.x_status === "skipped";
  const xPending = entry.x_status === "pending";
  const xDeliveryEvent = latestCompletedDeliveryEvent(events, "X");
  const xTimestamp = entry.x_posted_at ?? (xDeliveryEvent ? eventTimestampSource(xDeliveryEvent) : null);

  return [
    {
      platform: "Telegram",
      label: telegramDelivered ? "Delivered" : telegramFailed ? "Failed" : telegramPending ? "Pending" : "Not delivered",
      tone: telegramDelivered ? "good" : telegramFailed ? "bad" : telegramPending ? "warn" : "muted",
      detail: telegramDelivered
        ? `${messageCount || 1} message${messageCount === 1 ? "" : "s"} sent${telegramTimestamp ? "" : " · delivery time unavailable"}`
        : telegramFailed
          ? (formatPipelineError(entry.delivery_error).title || "Telegram delivery failed")
          : telegramPending
            ? "Delivery job is still pending or running"
            : "No Telegram delivery row yet",
      timestamp: formatTimestamp(telegramTimestamp),
      rawTimestamp: telegramTimestamp,
      timestampLabel: telegramTimestamp ? "Delivered at" : null,
    },
    {
      platform: "X",
      label: xPosted ? "Posted" : xFailed ? "Failed" : xSkipped ? "Skipped" : xPending ? "Pending" : "Not posted",
      tone: xPosted ? "good" : xFailed ? "bad" : xPending ? "warn" : "muted",
      detail: xPosted && entry.x_tweet_id
        ? `Tweet ${entry.x_tweet_id}`
        : xBadge.title,
      timestamp: formatTimestamp(xTimestamp),
      rawTimestamp: xTimestamp,
      timestampLabel: xTimestamp ? (xPosted ? "Posted at" : "Last update") : null,
    },
  ];
}
