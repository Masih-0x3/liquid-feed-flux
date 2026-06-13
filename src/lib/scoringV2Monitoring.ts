import type { MonitoringEntry, MonitoringFilter, PipelineEvent } from "@/hooks/useMonitoringData";

export type ScoringV2Mode = "shadow" | "active";
export type ScoringV2Decision = "deliver" | "skip";

export interface ScoringV2Snapshot {
  version?: string | null;
  mode?: ScoringV2Mode | null;
  profile_id?: string | null;
  audience_class?: string | null;
  audience_confidence?: number | null;
  audience_reason?: string | null;
  global_exception_class?: string | null;
  raw_priority_score?: number | null;
  uncapped_score?: number | null;
  final_score?: number | null;
  threshold?: number | null;
  cap?: number | null;
  decision?: ScoringV2Decision | null;
  decision_reason?: string | null;
  review_status?: string | null;
  adjudicated?: boolean | null;
  tags?: string[] | null;
}

export type ScoringV2MonitoringFilter = Extract<
  MonitoringFilter,
  "v2_would_post" | "v2_would_skip" | "v1_post_v2_skip" | "v1_skip_v2_post" | "v2_off_topic" | "v2_needs_review"
>;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function decisionValue(value: unknown): ScoringV2Decision | null {
  return value === "deliver" || value === "skip" ? value : null;
}

function modeValue(value: unknown): ScoringV2Mode | null {
  return value === "shadow" || value === "active" ? value : null;
}

function tagsValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags = value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
  return tags.length > 0 ? tags : null;
}

export function normalizeScoringV2Snapshot(raw: unknown): ScoringV2Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const version = stringValue(value.version);
  const mode = modeValue(value.mode);
  const audienceClass = stringValue(value.audience_class);
  const finalScore = numberValue(value.final_score);
  const threshold = numberValue(value.threshold);
  const decision = decisionValue(value.decision);
  if (!version && !mode && !audienceClass && finalScore == null && threshold == null && !decision) return null;
  return {
    version,
    mode,
    profile_id: stringValue(value.profile_id),
    audience_class: audienceClass,
    audience_confidence: numberValue(value.audience_confidence),
    audience_reason: stringValue(value.audience_reason),
    global_exception_class: stringValue(value.global_exception_class),
    raw_priority_score: numberValue(value.raw_priority_score),
    uncapped_score: numberValue(value.uncapped_score),
    final_score: finalScore,
    threshold,
    cap: numberValue(value.cap),
    decision,
    decision_reason: stringValue(value.decision_reason),
    review_status: stringValue(value.review_status),
    adjudicated: booleanValue(value.adjudicated),
    tags: tagsValue(value.tags),
  };
}

function eventTime(event: PipelineEvent): number {
  const raw = event.ended_at ?? event.started_at;
  const time = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

export function latestScoringV2Event(events: PipelineEvent[] = []): ScoringV2Snapshot | null {
  const latest = events
    .filter((event) => event.step === "score" && event.status === "completed" && event.meta?.version === "audience-fit-v2")
    .sort((a, b) => eventTime(b) - eventTime(a))[0];
  return latest ? normalizeScoringV2Snapshot(latest.meta) : null;
}

export function getScoringV2Snapshot(entry: MonitoringEntry, events: PipelineEvent[] = []): ScoringV2Snapshot | null {
  const fromEvents = latestScoringV2Event(events);
  if (fromEvents) return fromEvents;

  const fromBreakdown = normalizeScoringV2Snapshot(entry.score_breakdown?.scoring_v2);
  if (fromBreakdown) return fromBreakdown;

  if (!entry.scoring_version && !entry.audience_class && entry.audience_confidence == null) return null;
  return {
    version: entry.scoring_version,
    mode: entry.score_review_status === "shadow" ? "shadow" : null,
    profile_id: entry.scoring_profile_id,
    audience_class: entry.audience_class,
    audience_confidence: entry.audience_confidence,
    audience_reason: entry.audience_reason,
    global_exception_class: entry.global_exception_class,
    final_score: entry.final_score,
    decision: decisionValue(entry.delivery_decision),
    review_status: entry.score_review_status,
  };
}

export function matchesScoringV2Filter(entry: MonitoringEntry, filter: ScoringV2MonitoringFilter): boolean {
  const snapshot = getScoringV2Snapshot(entry);
  if (!snapshot) return false;
  const v1Decision = entry.delivery_decision;
  switch (filter) {
    case "v2_would_post":
      return snapshot.decision === "deliver";
    case "v2_would_skip":
      return snapshot.decision === "skip";
    case "v1_post_v2_skip":
      return v1Decision === "deliver" && snapshot.decision === "skip";
    case "v1_skip_v2_post":
      return v1Decision === "skip" && snapshot.decision === "deliver";
    case "v2_off_topic":
      return snapshot.audience_class === "off_topic";
    case "v2_needs_review":
      return snapshot.review_status === "needs_review";
  }
}

export function scoringV2DecisionLabel(decision?: string | null): string {
  if (decision === "deliver") return "Would post";
  if (decision === "skip") return "Would skip";
  return "No V2 decision";
}
