import type {
  MonitoringEntry,
  MonitoringProcessAiCall,
  MonitoringProcessObservability,
  PipelineEvent,
} from "@/hooks/useMonitoringData";

export type ProcessTraceStatus = "completed" | "running" | "pending" | "failed" | "skipped" | "blocked" | "unknown";
export type ProcessTraceTone = "good" | "info" | "warn" | "bad" | "muted";
export type ProcessTraceNodeKind = "system" | "ai" | "delivery" | "export";

export type ProcessTraceNodeId =
  | "ingest"
  | "dedupe"
  | "score"
  | "translate"
  | "enrich"
  | "media"
  | "telegram"
  | "x-dispatch"
  | "x-post"
  | "trace-export";

export interface ProcessTraceNode {
  id: ProcessTraceNodeId;
  label: string;
  shortLabel: string;
  kind: ProcessTraceNodeKind;
  status: ProcessTraceStatus;
  tone: ProcessTraceTone;
  statusLabel: string;
  detail: string;
  evidence: string[];
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  tokens: number | null;
  model: string | null;
  endpoint: string | null;
  agentName: string | null;
  error: string | null;
  skipReason: string | null;
  aiCalls: MonitoringProcessAiCall[];
  optional?: boolean;
}

export interface ProcessTraceEdge {
  id: string;
  from: ProcessTraceNodeId;
  to: ProcessTraceNodeId;
  label: string;
  status: ProcessTraceStatus;
  tone: ProcessTraceTone;
}

export interface ProcessTraceSummary {
  status: ProcessTraceStatus;
  statusLabel: string;
  completed: number;
  running: number;
  failed: number;
  blocked: number;
  skipped: number;
  totalNodes: number;
  aiCalls: number;
  tokens: number;
  hostedExports: number;
  localOnly: number;
  workflowName: string | null;
  workflowRunId: string | null;
}

export interface ProcessTraceMap {
  nodes: ProcessTraceNode[];
  edges: ProcessTraceEdge[];
  summary: ProcessTraceSummary;
  partialReasons: string[];
}

type NodePatch = Partial<Omit<ProcessTraceNode, "id" | "label" | "shortLabel" | "kind" | "evidence" | "aiCalls">> & {
  evidence?: string;
  evidenceItems?: string[];
  aiCall?: MonitoringProcessAiCall;
  aiCalls?: MonitoringProcessAiCall[];
};

const STATUS_LABELS: Record<ProcessTraceStatus, string> = {
  completed: "Completed",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  unknown: "No evidence",
};

const STATUS_PRIORITY: Record<ProcessTraceStatus, number> = {
  failed: 70,
  running: 60,
  blocked: 55,
  pending: 50,
  skipped: 40,
  completed: 30,
  unknown: 0,
};

const CANONICAL_NODES: Array<Pick<ProcessTraceNode, "id" | "label" | "shortLabel" | "kind" | "optional">> = [
  { id: "ingest", label: "Source ingest", shortLabel: "Ingest", kind: "system" },
  { id: "dedupe", label: "Duplicate gate", shortLabel: "Dedupe", kind: "system" },
  { id: "score", label: "Scoring agent", shortLabel: "Score", kind: "ai" },
  { id: "translate", label: "Translation agent", shortLabel: "Translate", kind: "ai" },
  { id: "enrich", label: "Voice enrichment", shortLabel: "Enrich", kind: "ai", optional: true },
  { id: "media", label: "Media preparation", shortLabel: "Media", kind: "system", optional: true },
  { id: "telegram", label: "Telegram delivery", shortLabel: "Telegram", kind: "delivery" },
  { id: "x-dispatch", label: "X dispatch gate", shortLabel: "X gate", kind: "delivery" },
  { id: "x-post", label: "X post", shortLabel: "X post", kind: "delivery" },
  { id: "trace-export", label: "Trace export", shortLabel: "Trace", kind: "export" },
];

function createNode(definition: Pick<ProcessTraceNode, "id" | "label" | "shortLabel" | "kind" | "optional">): ProcessTraceNode {
  return {
    ...definition,
    status: "unknown",
    tone: "muted",
    statusLabel: STATUS_LABELS.unknown,
    detail: "No captured evidence yet.",
    evidence: [],
    startedAt: null,
    endedAt: null,
    durationMs: null,
    tokens: null,
    model: null,
    endpoint: null,
    agentName: null,
    error: null,
    skipReason: null,
    aiCalls: [],
  };
}

function toneForStatus(status: ProcessTraceStatus): ProcessTraceTone {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  if (status === "running" || status === "pending") return "info";
  if (status === "blocked") return "warn";
  return "muted";
}

function setNodeStatus(node: ProcessTraceNode, status: ProcessTraceStatus, tone?: ProcessTraceTone) {
  node.status = status;
  node.tone = tone ?? toneForStatus(status);
  node.statusLabel = STATUS_LABELS[status];
}

function updateNode(node: ProcessTraceNode, patch: NodePatch) {
  if (patch.status) {
    const shouldReplace =
      node.status === "unknown" ||
      STATUS_PRIORITY[patch.status] >= STATUS_PRIORITY[node.status] ||
      patch.status === "completed";
    if (shouldReplace) {
      setNodeStatus(node, patch.status, patch.tone);
    }
  } else if (patch.tone) {
    node.tone = patch.tone;
  }

  if (patch.statusLabel) node.statusLabel = patch.statusLabel;
  if (patch.detail) node.detail = patch.detail;
  if (patch.startedAt) node.startedAt = patch.startedAt;
  if (patch.endedAt) node.endedAt = patch.endedAt;
  if (patch.durationMs != null) node.durationMs = patch.durationMs;
  if (patch.tokens != null) node.tokens = patch.tokens;
  if (patch.model) node.model = patch.model;
  if (patch.endpoint) node.endpoint = patch.endpoint;
  if (patch.agentName) node.agentName = patch.agentName;
  if (patch.error) node.error = patch.error;
  if (patch.skipReason) node.skipReason = patch.skipReason;
  if (patch.evidence) node.evidence.push(patch.evidence);
  if (patch.evidenceItems) node.evidence.push(...patch.evidenceItems);
  if (patch.aiCall) node.aiCalls.push(patch.aiCall);
  if (patch.aiCalls) node.aiCalls.push(...patch.aiCalls);
}

function normalizeStatus(status: string | null | undefined): ProcessTraceStatus {
  const value = (status ?? "").toLowerCase();
  if (["completed", "complete", "done", "success", "succeeded", "delivered", "posted", "approved"].includes(value)) {
    return "completed";
  }
  if (["running", "processing", "in_progress", "active", "generating"].includes(value)) return "running";
  if (["queued", "pending", "waiting", "scheduled", "awaiting_approval", "ready"].includes(value)) return "pending";
  if (["failed", "error", "errored", "rejected"].includes(value)) return "failed";
  if (["skipped", "skip", "not_candidate", "noop", "none"].includes(value)) return "skipped";
  if (["blocked", "duplicate", "below_threshold"].includes(value)) return "blocked";
  return "unknown";
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return timestamps[0] ?? null;
}

function durationMs(startedAt: string | null | undefined, endedAt: string | null | undefined): number | null {
  if (!startedAt || !endedAt) return null;
  const value = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function textIncludes(value: string | null | undefined, terms: string[]): boolean {
  const normalized = (value ?? "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function eventNodeId(event: PipelineEvent): ProcessTraceNodeId | null {
  const step = event.step.toLowerCase();
  const metaSource = typeof event.meta?.source === "string" ? event.meta.source.toLowerCase() : "";
  const joined = `${step} ${metaSource}`;

  if (textIncludes(joined, ["dedupe", "duplicate"])) return "dedupe";
  if (textIncludes(joined, ["score", "scoring", "audience"])) return "score";
  if (textIncludes(joined, ["translate", "translation"])) return "translate";
  if (textIncludes(joined, ["enrich", "voice", "commentary", "compose"])) return "enrich";
  if (textIncludes(joined, ["media", "hydrate", "download"])) return "media";
  if (textIncludes(joined, ["telegram", "deliver"])) return "telegram";
  if (textIncludes(joined, ["x_post", "post_to_x", "force_x", "tweet"])) return "x-post";
  if (textIncludes(joined, ["x_dispatch", "dispatch", "candidate", "x gate"])) return "x-dispatch";
  if (textIncludes(joined, ["ingest", "rss", "source"])) return "ingest";
  return null;
}

function aiCallNodeId(call: MonitoringProcessAiCall): ProcessTraceNodeId | null {
  const joined = [call.operation_name, call.agent_name, call.trace_name, call.endpoint].filter(Boolean).join(" ").toLowerCase();
  if (textIncludes(joined, ["translate", "translation", "translator"])) return "translate";
  if (textIncludes(joined, ["score", "scoring", "rank", "audience", "classifier"])) return "score";
  if (textIncludes(joined, ["enrich", "voice", "compose", "commentary", "draft"])) return "enrich";
  if (textIncludes(joined, ["dedupe", "duplicate", "embedding", "similarity"])) return "dedupe";
  return null;
}

function hasScoreEvidence(entry: MonitoringEntry): boolean {
  return entry.final_score != null || entry.importance_score != null || Boolean(entry.delivery_decision || entry.scoring_version);
}

function isDuplicateBlocked(entry: MonitoringEntry): boolean {
  return Boolean(entry.dup_of_tweet_id || entry.dedupe_status === "duplicate");
}

function isBelowThresholdSkip(entry: MonitoringEntry): boolean {
  return entry.delivery_decision === "skip" || entry.monitoring_state?.code === "below_threshold";
}

function shouldShowEnrichment(entry: MonitoringEntry, node: ProcessTraceNode): boolean {
  return Boolean(
    entry.enrich_status ||
      entry.enrichment_version ||
      entry.editorial_commentary ||
      entry.humanized_commentary ||
      entry.composed_post_text ||
      entry.creator_angle ||
      entry.why_it_matters ||
      entry.final_x_text ||
      entry.enrich_tokens != null ||
      entry.enrich_duration_ms != null ||
      node.evidence.length > 0 ||
      node.aiCalls.length > 0,
  );
}

function shouldShowMedia(entry: MonitoringEntry, node: ProcessTraceNode): boolean {
  return Boolean(entry.has_media || entry.hydrated_at || entry.x_cost_flags?.media_upload_expected || node.evidence.length > 0);
}

function applyTimelineEvents(nodes: Map<ProcessTraceNodeId, ProcessTraceNode>, events: PipelineEvent[]) {
  for (const event of events) {
    const nodeId = eventNodeId(event);
    if (!nodeId) continue;
    const node = nodes.get(nodeId);
    if (!node) continue;
    const status = normalizeStatus(event.status);
    updateNode(node, {
      status,
      detail: event.error || `${event.step.replaceAll("_", " ")} ${event.status.replaceAll("_", " ")}`,
      startedAt: event.started_at,
      endedAt: event.ended_at,
      durationMs: durationMs(event.started_at, event.ended_at),
      error: event.error ?? undefined,
      evidence: `timeline:${event.step}:${event.status}`,
    });
  }
}

function applyAiCalls(nodes: Map<ProcessTraceNodeId, ProcessTraceNode>, observability: MonitoringProcessObservability | null | undefined) {
  const calls = observability?.latest_run?.calls?.length ? observability.latest_run.calls : [];
  for (const call of calls) {
    const nodeId = aiCallNodeId(call);
    if (!nodeId) continue;
    const node = nodes.get(nodeId);
    if (!node) continue;
    updateNode(node, {
      status: normalizeStatus(call.status),
      detail: call.operation_name,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      durationMs: call.duration_ms,
      tokens: (node.tokens ?? 0) + (call.total_tokens ?? 0),
      model: call.model ?? undefined,
      endpoint: call.endpoint ?? undefined,
      agentName: call.agent_name ?? undefined,
      error: call.error_message ?? undefined,
      skipReason: call.foglamp_skip_reason ?? undefined,
      aiCall: call,
      evidence: `ai_call:${call.operation_name}:${call.status}`,
    });
  }
}

function applyEntryState(nodes: Map<ProcessTraceNodeId, ProcessTraceNode>, entry: MonitoringEntry, observability: MonitoringProcessObservability | null | undefined) {
  updateNode(nodes.get("ingest")!, {
    status: "completed",
    detail: entry.author_handle ? `Captured from ${entry.author_handle}` : "Captured from source feed.",
    startedAt: entry.created_at,
    endedAt: entry.created_at,
    evidence: "entry:created_at",
  });

  const dedupe = nodes.get("dedupe")!;
  if (isDuplicateBlocked(entry)) {
    updateNode(dedupe, {
      status: "blocked",
      detail: entry.dup_of_tweet_id ? `Matched duplicate ${entry.dup_of_tweet_id}.` : "Duplicate gate blocked this item.",
      endedAt: entry.dedupe_checked_at,
      skipReason: entry.dedupe_reason ?? "duplicate",
      evidence: "entry:duplicate_gate",
    });
  } else if (entry.dedupe_status === "failed") {
    updateNode(dedupe, {
      status: "failed",
      detail: entry.dedupe_reason ?? "Duplicate check failed.",
      endedAt: entry.dedupe_checked_at,
      error: entry.dedupe_reason ?? undefined,
      evidence: "entry:dedupe_failed",
    });
  } else if (entry.dedupe_status === "uncertain") {
    updateNode(dedupe, {
      status: "pending",
      tone: "warn",
      detail: entry.dedupe_reason ?? "Duplicate gate needs review.",
      endedAt: entry.dedupe_checked_at,
      evidence: "entry:dedupe_uncertain",
    });
  } else if (entry.dedupe_status || entry.dedupe_checked_at) {
    updateNode(dedupe, {
      status: "completed",
      tone: entry.dedupe_status === "coverage_gap" ? "warn" : "good",
      detail: entry.dedupe_reason ?? (entry.dedupe_status ? entry.dedupe_status.replaceAll("_", " ") : "Duplicate gate checked."),
      endedAt: entry.dedupe_checked_at,
      evidence: "entry:dedupe_status",
    });
  }

  const score = nodes.get("score")!;
  if (hasScoreEvidence(entry)) {
    const value = entry.final_score ?? entry.importance_score;
    updateNode(score, {
      status: "completed",
      detail: value != null ? `Score ${value}${entry.delivery_decision ? ` · ${entry.delivery_decision}` : ""}` : entry.delivery_decision ?? "Scoring decision captured.",
      evidence: "entry:score",
    });
  } else if (isDuplicateBlocked(entry)) {
    updateNode(score, {
      status: "skipped",
      detail: "Skipped after duplicate gate.",
      skipReason: "duplicate",
      evidence: "entry:score_skipped_duplicate",
    });
  }

  const translate = nodes.get("translate")!;
  if (entry.translation_error) {
    updateNode(translate, {
      status: "failed",
      detail: "Translation failed.",
      error: entry.translation_error,
      evidence: "entry:translation_error",
    });
  } else if (entry.is_translated || Boolean(entry.text_translated)) {
    updateNode(translate, {
      status: "completed",
      detail: "Persian translation is available.",
      evidence: "entry:translated",
    });
  } else {
    const translationStatus = normalizeStatus(entry.translation_job_status);
    if (translationStatus !== "unknown") {
      updateNode(translate, {
        status: translationStatus,
        detail: `Translation job ${entry.translation_job_status.replaceAll("_", " ")}.`,
        evidence: "entry:translation_job_status",
      });
    } else if (isDuplicateBlocked(entry) || isBelowThresholdSkip(entry)) {
      updateNode(translate, {
        status: "skipped",
        detail: isDuplicateBlocked(entry) ? "Skipped after duplicate gate." : "Skipped because the item is below the delivery threshold.",
        skipReason: isDuplicateBlocked(entry) ? "duplicate" : "below_threshold",
        evidence: "entry:translation_skipped",
      });
    }
  }

  const enrich = nodes.get("enrich")!;
  if (entry.enrich_status || entry.final_x_text || entry.composed_post_text) {
    const enrichStatus = entry.enrich_status ? normalizeStatus(entry.enrich_status) : "completed";
    updateNode(enrich, {
      status: enrichStatus === "unknown" ? "pending" : enrichStatus,
      detail: entry.enrich_status ? entry.enrich_status.replaceAll("_", " ") : "Enriched X copy is available.",
      durationMs: entry.enrich_duration_ms,
      tokens: entry.enrich_tokens,
      evidence: "entry:enrichment",
    });
  } else if (isDuplicateBlocked(entry) || isBelowThresholdSkip(entry)) {
    updateNode(enrich, {
      status: "skipped",
      detail: "No enrichment needed for a skipped item.",
      skipReason: isDuplicateBlocked(entry) ? "duplicate" : "below_threshold",
      evidence: "entry:enrichment_skipped",
    });
  }

  const media = nodes.get("media")!;
  if (entry.has_media) {
    updateNode(media, {
      status: entry.hydrated_at || entry.x_status === "posted" ? "completed" : "pending",
      detail: entry.hydrated_at ? "Media/hydration evidence is available." : "Media exists and may need preparation.",
      endedAt: entry.hydrated_at,
      evidence: "entry:media",
    });
  }

  const telegram = nodes.get("telegram")!;
  if (entry.delivery_error) {
    updateNode(telegram, {
      status: "failed",
      detail: "Telegram delivery failed.",
      error: entry.delivery_error,
      evidence: "entry:delivery_error",
    });
  } else if (entry.is_delivered || entry.telegram_message_ids.length > 0 || entry.monitoring_state?.telegram_state === "delivered") {
    updateNode(telegram, {
      status: "completed",
      detail: entry.telegram_message_ids.length > 0 ? `${entry.telegram_message_ids.length} Telegram message ID(s).` : "Telegram delivery is marked delivered.",
      evidence: "entry:telegram_delivered",
    });
  } else {
    const status = normalizeStatus(entry.delivery_status || entry.delivery_job_status || entry.monitoring_state?.telegram_state);
    if (status !== "unknown") {
      updateNode(telegram, {
        status,
        detail: `Telegram state ${entry.delivery_status || entry.delivery_job_status || entry.monitoring_state?.telegram_state}.`,
        evidence: "entry:telegram_status",
      });
    } else if (isDuplicateBlocked(entry) || isBelowThresholdSkip(entry)) {
      updateNode(telegram, {
        status: "skipped",
        detail: isDuplicateBlocked(entry) ? "Skipped after duplicate gate." : "Skipped because this item was not selected for delivery.",
        skipReason: isDuplicateBlocked(entry) ? "duplicate" : "below_threshold",
        evidence: "entry:telegram_skipped",
      });
    }
  }

  const xDispatch = nodes.get("x-dispatch")!;
  const xPost = nodes.get("x-post")!;
  if (entry.x_status === "posted") {
    updateNode(xDispatch, {
      status: "completed",
      detail: "X gate passed and dispatch completed.",
      evidence: "entry:x_dispatch_posted",
    });
    updateNode(xPost, {
      status: "completed",
      detail: entry.x_tweet_id ? `Posted as ${entry.x_tweet_id}.` : "X post completed.",
      endedAt: entry.x_posted_at,
      evidence: "entry:x_posted",
    });
  } else if (entry.x_status === "failed" || entry.x_error) {
    updateNode(xDispatch, {
      status: "completed",
      detail: "X dispatch attempted.",
      evidence: "entry:x_dispatch_attempted",
    });
    updateNode(xPost, {
      status: "failed",
      detail: "X post failed.",
      error: entry.x_error ?? undefined,
      evidence: "entry:x_failed",
    });
  } else {
    const xStatus = normalizeStatus(entry.x_status ?? entry.monitoring_state?.x_state);
    if (xStatus !== "unknown") {
      updateNode(xDispatch, {
        status: xStatus === "skipped" ? "skipped" : xStatus,
        detail: `X gate state ${entry.x_status ?? entry.monitoring_state?.x_state}.`,
        skipReason: entry.x_skip_reason ?? undefined,
        evidence: "entry:x_dispatch_status",
      });
      updateNode(xPost, {
        status: xStatus,
        detail: entry.x_skip_reason ? entry.x_skip_reason.replaceAll("_", " ") : `X post state ${entry.x_status ?? entry.monitoring_state?.x_state}.`,
        skipReason: entry.x_skip_reason ?? undefined,
        evidence: "entry:x_status",
      });
    } else if (entry.x_skip_reason || isDuplicateBlocked(entry) || isBelowThresholdSkip(entry)) {
      const reason = entry.x_skip_reason ?? (isDuplicateBlocked(entry) ? "duplicate" : "below_threshold");
      updateNode(xDispatch, {
        status: "skipped",
        detail: reason.replaceAll("_", " "),
        skipReason: reason,
        evidence: "entry:x_dispatch_skipped",
      });
      updateNode(xPost, {
        status: "skipped",
        detail: reason.replaceAll("_", " "),
        skipReason: reason,
        evidence: "entry:x_post_skipped",
      });
    }
  }

  const traceExport = nodes.get("trace-export")!;
  const latestRun = observability?.latest_run ?? null;
  const firstSkipReason = latestRun?.calls.find((call) => call.foglamp_skip_reason)?.foglamp_skip_reason ?? null;
  if ((observability?.foglamp_exported ?? 0) > 0 || (latestRun?.foglamp_exported ?? 0) > 0) {
    updateNode(traceExport, {
      status: "completed",
      detail: "Hosted Foglamp trace exported.",
      evidence: "observability:foglamp_exported",
    });
  } else if (latestRun || (observability?.ai_calls ?? 0) > 0 || (observability?.foglamp_skipped ?? 0) > 0) {
    updateNode(traceExport, {
      status: "skipped",
      detail: firstSkipReason ? firstSkipReason.replaceAll("_", " ") : "Local-only trace captured; hosted export did not run.",
      skipReason: firstSkipReason ?? "local_only",
      evidence: "observability:foglamp_skipped",
    });
  } else {
    updateNode(traceExport, {
      status: observability?.available === false ? "unknown" : "pending",
      detail: observability?.partial_reason ? observability.partial_reason.replaceAll("_", " ") : "No workflow ledger evidence yet.",
      evidence: "observability:no_trace",
    });
  }
}

function edgeToneFromNode(node: ProcessTraceNode): ProcessTraceTone {
  if (node.status === "failed") return "bad";
  if (node.status === "blocked") return "warn";
  if (node.status === "running" || node.status === "pending") return "info";
  if (node.status === "completed") return "good";
  return "muted";
}

function buildEdges(nodes: ProcessTraceNode[]): ProcessTraceEdge[] {
  const ids = new Set(nodes.map((node) => node.id));
  const edgeDefs: Array<[ProcessTraceNodeId, ProcessTraceNodeId, string]> = [
    ["ingest", "dedupe", "intake"],
    ["dedupe", "score", "gate"],
    ["score", "translate", "score"],
    ["translate", "enrich", "copy"],
    ["translate", "media", "assets"],
    ["enrich", "media", "assets"],
    ["enrich", "telegram", "deliver"],
    ["media", "telegram", "deliver"],
    ["translate", "telegram", "deliver"],
    ["enrich", "x-dispatch", "candidate"],
    ["media", "x-dispatch", "candidate"],
    ["translate", "x-dispatch", "candidate"],
    ["x-dispatch", "x-post", "post"],
    ["x-post", "trace-export", "trace"],
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: ProcessTraceEdge[] = [];
  const seenTargets = new Set<ProcessTraceNodeId>();

  for (const [from, to, label] of edgeDefs) {
    if (!ids.has(from) || !ids.has(to)) continue;
    if ((to === "telegram" || to === "x-dispatch") && seenTargets.has(to)) continue;
    if (to === "media" && seenTargets.has(to)) continue;
    seenTargets.add(to);
    const target = byId.get(to)!;
    edges.push({
      id: `${from}-${to}`,
      from,
      to,
      label,
      status: target.status,
      tone: edgeToneFromNode(target),
    });
  }

  return edges;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildSummary(nodes: ProcessTraceNode[], observability: MonitoringProcessObservability | null | undefined): ProcessTraceSummary {
  const failed = nodes.filter((node) => node.status === "failed").length;
  const running = nodes.filter((node) => node.status === "running" || node.status === "pending").length;
  const blocked = nodes.filter((node) => node.status === "blocked").length;
  const skipped = nodes.filter((node) => node.status === "skipped").length;
  const completed = nodes.filter((node) => node.status === "completed").length;
  const status: ProcessTraceStatus = failed > 0 ? "failed" : running > 0 ? "running" : blocked > 0 ? "blocked" : completed > 0 ? "completed" : "unknown";
  const latestRun = observability?.latest_run ?? null;

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    completed,
    running,
    failed,
    blocked,
    skipped,
    totalNodes: nodes.length,
    aiCalls: observability?.ai_calls ?? latestRun?.ai_call_count ?? nodes.reduce((sum, node) => sum + node.aiCalls.length, 0),
    tokens: observability?.total_tokens ?? latestRun?.total_tokens ?? nodes.reduce((sum, node) => sum + (node.tokens ?? 0), 0),
    hostedExports: observability?.foglamp_exported ?? latestRun?.foglamp_exported ?? 0,
    localOnly: observability?.foglamp_skipped ?? latestRun?.foglamp_skipped ?? 0,
    workflowName: latestRun?.workflow_name ?? null,
    workflowRunId: latestRun?.workflow_run_id ?? latestRun?.run_key ?? null,
  };
}

export function buildProcessTraceMap(
  entry: MonitoringEntry,
  timeline: PipelineEvent[] = [],
  observability: MonitoringProcessObservability | null | undefined = entry.process_observability,
): ProcessTraceMap {
  const nodes = new Map<ProcessTraceNodeId, ProcessTraceNode>(
    CANONICAL_NODES.map((definition) => [definition.id, createNode(definition)]),
  );

  applyTimelineEvents(nodes, timeline);
  applyAiCalls(nodes, observability);
  applyEntryState(nodes, entry, observability);

  const visibleNodes = [...nodes.values()].filter((node) => {
    if (node.id === "enrich") return shouldShowEnrichment(entry, node);
    if (node.id === "media") return shouldShowMedia(entry, node);
    return true;
  });

  for (const node of visibleNodes) {
    node.evidence = unique(node.evidence);
    node.aiCalls = unique(node.aiCalls.map((call) => `${call.workflow_run_key}:${call.operation_name}:${call.started_at ?? ""}`))
      .map((key) => node.aiCalls.find((call) => `${call.workflow_run_key}:${call.operation_name}:${call.started_at ?? ""}` === key))
      .filter((call): call is MonitoringProcessAiCall => Boolean(call));
    if (!node.endedAt) node.endedAt = latestTimestamp(node.aiCalls.map((call) => call.ended_at));
    if (!node.startedAt) node.startedAt = latestTimestamp(node.aiCalls.map((call) => call.started_at));
  }

  const partialReasons = unique([
    observability?.partial_reason ? observability.partial_reason.replaceAll("_", " ") : "",
    ...visibleNodes.flatMap((node) => [node.error, node.skipReason ? node.skipReason.replaceAll("_", " ") : ""]),
  ]);

  return {
    nodes: visibleNodes,
    edges: buildEdges(visibleNodes),
    summary: buildSummary(visibleNodes, observability),
    partialReasons,
  };
}
