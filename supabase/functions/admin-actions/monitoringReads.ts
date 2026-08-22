import { loadActiveThreshold } from "./activeThreshold.ts";
import {
  getPayloadTweetId,
  isFailedJobActionable,
  isMissingSchemaError,
  loadPostsByJobReferences,
  monitoringPolicyRuleKind,
  postForJob,
} from "./readHelpers.ts";

export type MonitoringFilter =
  | "all"
  | "needs_attention"
  | "failed_stuck"
  | "needs_score"
  | "translation_queue"
  | "below_threshold"
  | "manual_review"
  | "v2_would_post"
  | "v2_would_skip"
  | "v1_post_v2_skip"
  | "v1_skip_v2_post"
  | "v2_off_topic"
  | "v2_needs_review"
  | "v2_regional_auto"
  | "global_pilot_review"
  | "manual_scoring_feedback"
  | "duplicates"
  | "coverage_gap"
  | "possible_duplicate"
  | "duplicate_anomalies"
  | "ready_to_deliver"
  | "telegram_pending"
  | "x_pending"
  | "x_failed"
  | "delivered_24h"
  | "hydration";

export type MonitoringScoreBucket =
  | "any"
  | "unscored"
  | "lt5"
  | "5_9"
  | "10_13"
  | "14_plus"
  | "17_plus";

type MonitoringTone = "good" | "warn" | "bad" | "muted" | "info";

export interface MonitoringState {
  code: string;
  stage_label: string;
  tone: MonitoringTone;
  decision_label: string;
  primary_blocker: string | null;
  translation_state: string;
  telegram_state: string;
  x_state: string;
  needs_attention: boolean;
  next_actions: string[];
}

export interface DuplicateTargetSummary {
  tweet_id: string;
  text_original: string;
  url: string;
  created_at: string | null;
  author_handle: string | null;
  delivery_decision: string | null;
  decision_reason: string | null;
  final_score: number | null;
  importance_score: number | null;
  dedupe_status: string | null;
  dup_of_tweet_id: string | null;
  dup_similarity: number | null;
  telegram_state: string;
  x_state: string;
  monitoring_state: MonitoringState;
  coverage_state:
    | "delivered"
    | "in_pipeline"
    | "also_duplicate"
    | "not_covered";
}

type MonitoringProcessAiCall = {
  workflow_run_key: string;
  trace_name: string;
  operation_name: string;
  agent_name: string | null;
  model: string | null;
  endpoint: string | null;
  status: string;
  total_tokens: number;
  reasoning_tokens: number;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  foglamp_exported: boolean;
  foglamp_span_estimate: number;
  foglamp_skip_reason: string | null;
  error_message: string | null;
};

type MonitoringProcessRun = {
  run_key: string;
  workflow_name: string;
  workflow_run_id: string | null;
  status: string;
  source_function: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  last_error: string | null;
  ai_call_count: number;
  failed_ai_call_count: number;
  total_tokens: number;
  foglamp_exported: number;
  foglamp_skipped: number;
  calls: MonitoringProcessAiCall[];
};

type MonitoringProcessSnapshot = {
  available: boolean;
  source: "workflow_runs" | "unavailable";
  partial_reason: string | null;
  latest_run: MonitoringProcessRun | null;
  recent_runs: MonitoringProcessRun[];
  ai_calls: number;
  failed_ai_calls: number;
  total_tokens: number;
  foglamp_exported: number;
  foglamp_skipped: number;
};

type MonitoringProcessLookup = {
  byTweet: Map<string, MonitoringProcessSnapshot>;
  unavailableReason: string | null;
};

function checkedMonitoringQuery(
  value: unknown,
  section: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${section}_invalid_response`);
  }
  const result = value as Record<string, unknown>;
  if (result.error) throw result.error;
  return result;
}

function checkedMonitoringRows(
  value: unknown,
  section: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((row) =>
    !row || typeof row !== "object" || Array.isArray(row)
  )) {
    throw new Error(`${section}_invalid_rows`);
  }
  return value as Array<Record<string, unknown>>;
}

function checkedMonitoringCount(
  value: unknown,
  section: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${section}_invalid_count`);
  }
  return value;
}

const MONITORING_BASE_POST_COLUMNS = [
  "tweet_id",
  "text_original",
  "text_translated",
  "url",
  "created_at",
  "translated_at",
  "has_media",
  "author_handle",
  "importance_score",
  "importance_tags",
  "importance_reasoning",
  "delivery_decision",
  "score_axes",
  "final_score",
  "base_score",
  "learned_score",
  "learned_delta",
  "x_gate_score",
  "learning_confidence",
  "decision_reason",
  "is_truncated",
  "hydrated_at",
  "hydration_source",
  "dup_of_tweet_id",
  "story_cluster_id",
  "dup_similarity",
  "dedupe_status",
  "dedupe_checked_at",
  "dedupe_method",
  "dedupe_confidence",
  "dedupe_reason",
  "dedupe_new_facts",
  "score_breakdown",
  "feedback_locked",
  "enrich_status",
  "editorial_commentary",
  "humanized_commentary",
  "commentary_hook",
  "commentary_question",
  "narrative_callback",
  "composed_post_text",
  "post_format_hint",
  "background_context",
  "enrich_tokens",
  "enrich_duration_ms",
  "accounts!inner(handle, display_name)",
];

const MONITORING_ENRICHMENT_V2_COLUMNS = [
  "enrichment_version",
  "creator_angle",
  "why_it_matters",
  "source_context",
  "algorithm_signal_scores",
  "aggregator_risk_score",
  "ai_voice_risk_score",
  "monetization_risk_flags",
  "enrichment_review_reason",
  "final_x_text",
];

const MONITORING_SCORING_V2_COLUMNS = [
  "scoring_version",
  "scoring_profile_id",
  "audience_class",
  "audience_confidence",
  "audience_reason",
  "global_exception_class",
  "score_review_status",
];

const MONITORING_POST_SELECT = [
  ...MONITORING_BASE_POST_COLUMNS,
  ...MONITORING_ENRICHMENT_V2_COLUMNS,
  ...MONITORING_SCORING_V2_COLUMNS,
].join(", ");
const MONITORING_POST_SELECT_NO_ENRICHMENT_V2 = [
  ...MONITORING_BASE_POST_COLUMNS,
  ...MONITORING_SCORING_V2_COLUMNS,
].join(", ");
const MONITORING_POST_SELECT_NO_SCORING_V2 = MONITORING_BASE_POST_COLUMNS.join(
  ", ",
);

export function normalizeMonitoringFilter(v: unknown): MonitoringFilter {
  const raw = typeof v === "string" ? v.replaceAll("-", "_") : "all";
  const allowed: MonitoringFilter[] = [
    "all",
    "needs_attention",
    "failed_stuck",
    "needs_score",
    "translation_queue",
    "below_threshold",
    "manual_review",
    "duplicates",
    "coverage_gap",
    "v2_would_post",
    "v2_would_skip",
    "v1_post_v2_skip",
    "v1_skip_v2_post",
    "v2_off_topic",
    "v2_needs_review",
    "v2_regional_auto",
    "global_pilot_review",
    "manual_scoring_feedback",
    "possible_duplicate",
    "duplicate_anomalies",
    "ready_to_deliver",
    "telegram_pending",
    "x_pending",
    "x_failed",
    "delivered_24h",
    "hydration",
  ];
  return allowed.includes(raw as MonitoringFilter)
    ? raw as MonitoringFilter
    : "all";
}

export function normalizeMonitoringScoreBucket(
  v: unknown,
): MonitoringScoreBucket {
  const raw = typeof v === "string" ? v : "any";
  const allowed: MonitoringScoreBucket[] = [
    "any",
    "unscored",
    "lt5",
    "5_9",
    "10_13",
    "14_plus",
    "17_plus",
  ];
  return allowed.includes(raw as MonitoringScoreBucket)
    ? raw as MonitoringScoreBucket
    : "any";
}

export function sanitizeSearchTerm(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

export function normalizeMonitoringTweetId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const tweetId = v.trim();
  return tweetId.length > 0 && tweetId.length <= 128 ? tweetId : null;
}

function postSearchOr(term: string): string {
  const q = `%${term}%`;
  return [
    `tweet_id.ilike.${q}`,
    `author_handle.ilike.${q}`,
    `url.ilike.${q}`,
    `text_original.ilike.${q}`,
    `text_translated.ilike.${q}`,
  ].join(",");
}

export function isActiveStatus(status: unknown): boolean {
  return status === "pending" || status === "running" || status === "queued" ||
    status === "posting";
}

export function scoreFromPost(post: Record<string, unknown>): number | null {
  if (typeof post.final_score === "number") return post.final_score;
  if (typeof post.importance_score === "number") return post.importance_score;
  return null;
}

export function matchesMonitoringScoreBucket(
  post: Record<string, unknown>,
  bucket: MonitoringScoreBucket,
): boolean {
  const score = scoreFromPost(post);
  switch (bucket) {
    case "any":
      return true;
    case "unscored":
      return score == null;
    case "lt5":
      return score != null && score < 5;
    case "5_9":
      return score != null && score >= 5 && score < 10;
    case "10_13":
      return score != null && score >= 10 && score < 14;
    case "14_plus":
      return score != null && score >= 14;
    case "17_plus":
      return score != null && score >= 17;
  }
}

function isBelowThreshold(
  post: Record<string, unknown>,
  threshold: number,
): boolean {
  const reason = typeof post.decision_reason === "string"
    ? post.decision_reason
    : "";
  const score = scoreFromPost(post);
  return reason.startsWith("below_threshold:") ||
    reason.startsWith("feedback_reduce:") ||
    reason.startsWith("manual_score_skip:") ||
    (post.delivery_decision === "skip" && score != null && score < threshold);
}

export function monitoringScoringV2Snapshot(
  post: Record<string, unknown>,
): Record<string, unknown> | null {
  const breakdown =
    post.score_breakdown && typeof post.score_breakdown === "object"
      ? post.score_breakdown as Record<string, unknown>
      : {};
  const fromBreakdown =
    breakdown.scoring_v2 && typeof breakdown.scoring_v2 === "object"
      ? breakdown.scoring_v2 as Record<string, unknown>
      : null;
  if (fromBreakdown) return fromBreakdown;
  if (
    !post.scoring_version && !post.audience_class &&
    post.audience_confidence == null
  ) return null;
  return {
    version: post.scoring_version ?? null,
    mode: post.score_review_status === "shadow" ? "shadow" : null,
    profile_id: post.scoring_profile_id ?? null,
    audience_class: post.audience_class ?? null,
    audience_confidence: post.audience_confidence ?? null,
    audience_reason: post.audience_reason ?? null,
    global_exception_class: post.global_exception_class ?? null,
    final_score: post.final_score ?? null,
    decision: post.delivery_decision ?? null,
    review_status: post.score_review_status ?? null,
  };
}

function monitoringScoringV2Decision(
  post: Record<string, unknown>,
): string | null {
  const snapshot = monitoringScoringV2Snapshot(post);
  const decision = snapshot?.decision;
  return decision === "deliver" || decision === "skip" ? decision : null;
}

export function isManualScoringFeedbackEntry(
  entry: Record<string, unknown>,
): boolean {
  const reason = typeof entry.decision_reason === "string"
    ? entry.decision_reason
    : "";
  return reason.startsWith("manual_score_") ||
    reason.startsWith("score_feedback_") ||
    (entry.feedback_locked === true &&
      (entry.score_review_status === "approved" ||
        entry.score_review_status === "rejected"));
}

export function matchesMonitoringScoringV2Filter(
  entry: Record<string, unknown>,
  filter: MonitoringFilter,
): boolean {
  const snapshot = monitoringScoringV2Snapshot(entry);
  if (!snapshot) return false;
  const decision = monitoringScoringV2Decision(entry);
  const policyRule = monitoringPolicyRuleKind(snapshot);
  switch (filter) {
    case "v2_would_post":
      return decision === "deliver";
    case "v2_would_skip":
      return decision === "skip";
    case "v1_post_v2_skip":
      return entry.delivery_decision === "deliver" && decision === "skip";
    case "v1_skip_v2_post":
      return entry.delivery_decision === "skip" && decision === "deliver";
    case "v2_off_topic":
      return snapshot.audience_class === "off_topic";
    case "v2_needs_review":
      return snapshot.review_status === "needs_review";
    case "v2_regional_auto":
      return policyRule === "regional_escalation_auto";
    case "global_pilot_review":
      return policyRule === "global_mega_event_review" ||
        (snapshot.global_exception_class === "global_mega_event" &&
          snapshot.review_status === "needs_review");
    default:
      return false;
  }
}

export function deriveMonitoringState(
  post: Record<string, unknown>,
  rpc: Record<string, unknown> | undefined,
  threshold: number,
): MonitoringState {
  const score = scoreFromPost(post);
  const translatedAt = rpc?.translated_at || post.translated_at;
  const hasTranslation = !!(translatedAt ||
    (post.text_translated && post.text_translated !== post.text_original));
  const translateStatus = rpc?.translate_status as string | null | undefined;
  const deliveryStatus = rpc?.delivery_status as string | null | undefined;
  const xStatus = rpc?.x_status as string | null | undefined;
  const hasTranslateError = !!rpc?.translate_error ||
    translateStatus === "failed";
  const hasDeliveryError = !!rpc?.delivery_error || deliveryStatus === "failed";
  const hasXError = !!rpc?.x_error || xStatus === "failed";
  const dedupeStatus = typeof post.dedupe_status === "string"
    ? post.dedupe_status
    : null;
  const dedupeReason = typeof post.dedupe_reason === "string"
    ? post.dedupe_reason
    : "";
  const dedupeJobStatus = rpc?.dedupe_job_status as string | null | undefined;
  const rawDedupeError = !!rpc?.dedupe_error || dedupeJobStatus === "failed" ||
    dedupeStatus === "failed";
  const duplicate = !!post.dup_of_tweet_id;
  const belowThreshold = isBelowThreshold(post, threshold);
  const skipped = !!post.delivery_decision &&
    post.delivery_decision !== "deliver";
  const activeDedupe = isActiveStatus(dedupeJobStatus) ||
    dedupeStatus === "pending";
  const activeTranslate = isActiveStatus(translateStatus);
  const activeDelivery = isActiveStatus(deliveryStatus);
  const activeX = isActiveStatus(xStatus);
  const delivered = deliveryStatus === "posted";
  const xPosted = xStatus === "posted";
  const needsHydration = post.delivery_decision === "deliver" &&
    post.is_truncated === true && !post.hydrated_at;
  const review = post.enrich_status === "awaiting_approval" ||
    post.score_review_status === "needs_review";
  const passDecision = post.delivery_decision === "deliver";
  const terminalSkipDecision = skipped && !passDecision && !activeDedupe;
  const hasDedupeError = rawDedupeError && !terminalSkipDecision;
  const duplicateCoverageGap = dedupeStatus === "coverage_gap" ||
    (dedupeStatus === "uncertain" && duplicate &&
      dedupeReason.includes("coverage_gap:"));

  let state: MonitoringState = {
    code: "unknown",
    stage_label: "Review",
    tone: "info",
    decision_label: "No decision",
    primary_blocker: null,
    translation_state: hasTranslation ? "translated" : "missing",
    telegram_state: delivered ? "delivered" : (deliveryStatus ?? "none"),
    x_state: xStatus ?? "none",
    needs_attention: false,
    next_actions: ["details"],
  };

  if (activeTranslate) state.translation_state = "queued";
  else if (hasTranslateError && !hasTranslation) {
    state.translation_state = "failed";
  } else if (
    !hasTranslation &&
    (skipped || (duplicate && !duplicateCoverageGap) || belowThreshold)
  ) state.translation_state = "not_needed";
  else if (!hasTranslation && (passDecision || duplicateCoverageGap)) {
    state.translation_state = "needs_translation";
  }

  if (hasDedupeError || hasTranslateError || hasDeliveryError || hasXError) {
    state = {
      ...state,
      code: "failed_stuck",
      stage_label: hasDedupeError ? "Dedupe failed" : "Failed/stuck",
      tone: "bad",
      decision_label: hasDedupeError
        ? "Dedupe failed"
        : hasTranslateError
        ? "Translation failed"
        : hasDeliveryError
        ? "Telegram failed"
        : "X failed",
      primary_blocker: hasDedupeError
        ? String(
          rpc?.dedupe_error ?? post.dedupe_reason ?? "Duplicate check failed",
        )
        : hasTranslateError
        ? "Translation failed or exhausted retries"
        : hasDeliveryError
        ? "Telegram delivery failed"
        : "X delivery failed",
      needs_attention: true,
      next_actions: hasDedupeError
        ? ["run_dedupe", "rescore", "manual_score"]
        : ["retry", "rescore", "manual_score"],
    };
  } else if (activeDedupe) {
    state = {
      ...state,
      code: "dedupe_pending",
      stage_label: "Duplicate gate pending",
      tone: "info",
      decision_label: "Checking duplicate",
      primary_blocker: "Duplicate gate is pending or running",
      next_actions: ["details"],
    };
  } else if (duplicateCoverageGap) {
    state = {
      ...state,
      code: "duplicate_coverage_gap",
      stage_label: "Duplicate coverage gap",
      tone: "warn",
      decision_label: "Possible duplicate, not covered",
      primary_blocker:
        "The matched duplicate has not been delivered and is not actively moving through delivery, so this item should keep moving through normal review.",
      needs_attention: true,
      next_actions: ["run_dedupe", "manual_score", "clear_duplicate"],
    };
  } else if (dedupeStatus === "uncertain") {
    state = {
      ...state,
      code: "manual_review",
      stage_label: "Uncertain duplicate",
      tone: "warn",
      decision_label: "Review possible duplicate",
      primary_blocker: String(
        post.dedupe_reason ?? "Duplicate gate needs human review",
      ),
      needs_attention: true,
      next_actions: ["run_dedupe", "manual_score", "clear_duplicate"],
    };
  } else if (dedupeStatus === "related_new_info" && score == null) {
    state = {
      ...state,
      code: "needs_score",
      stage_label: "Related: new info",
      tone: "info",
      decision_label: "Related: new info",
      primary_blocker:
        "Duplicate gate found related coverage with material new information; scoring is next",
      next_actions: ["rescore", "manual_score"],
    };
  } else if (activeTranslate) {
    state = {
      ...state,
      code: "translation_queue",
      stage_label: "Translation queued",
      tone: "info",
      decision_label: "Queued for translation",
      primary_blocker: "Translation job is pending or running",
      next_actions: ["details"],
    };
  } else if (score == null) {
    state = {
      ...state,
      code: "needs_score",
      stage_label: "Needs score",
      tone: "warn",
      decision_label: "Unscored",
      primary_blocker: "No editorial score has been recorded",
      needs_attention: true,
      next_actions: ["rescore", "manual_score"],
    };
  } else if (duplicate) {
    state = {
      ...state,
      code: "blocked_duplicate",
      stage_label: "Duplicate",
      tone: "muted",
      decision_label: "Blocked: duplicate",
      primary_blocker: `Duplicate of ${post.dup_of_tweet_id}`,
      needs_attention: true,
      next_actions: ["clear_duplicate", "manual_score"],
    };
  } else if (belowThreshold || (skipped && !passDecision)) {
    state = {
      ...state,
      code: "below_threshold",
      stage_label: "Below threshold",
      tone: "muted",
      decision_label: belowThreshold ? "Skipped: below threshold" : "Skipped",
      primary_blocker: belowThreshold
        ? `Score ${score} is below threshold ${threshold}`
        : (post.decision_reason as string | null) ??
          "Delivery decision is skip",
      next_actions: ["manual_score", "rescore", "translate_only"],
    };
  } else if (!hasTranslation && passDecision) {
    state = {
      ...state,
      code: "needs_translation",
      stage_label: "Needs translation",
      tone: "warn",
      decision_label: "Needs translation",
      primary_blocker: "Passed scoring but has no translation",
      needs_attention: true,
      translation_state: "needs_translation",
      next_actions: ["translate_only", "rescore"],
    };
  } else if (review) {
    state = {
      ...state,
      code: "manual_review",
      stage_label: "Manual review",
      tone: "warn",
      decision_label: "Awaiting review",
      primary_blocker: post.score_review_status === "needs_review"
        ? "Scoring v2 marked this item for review"
        : "Enrichment is awaiting approval",
      needs_attention: true,
      next_actions: ["details"],
    };
  } else if (needsHydration) {
    state = {
      ...state,
      code: "hydration",
      stage_label: "Hydration",
      tone: "warn",
      decision_label: "Blocked: hydration",
      primary_blocker:
        "Tweet is truncated and needs hydration before publishing",
      needs_attention: true,
      next_actions: ["hydrate"],
    };
  } else if (activeDelivery) {
    state = {
      ...state,
      code: "telegram_pending",
      stage_label: "Telegram pending",
      tone: "info",
      decision_label: "Telegram pending",
      primary_blocker: "Telegram delivery is pending or running",
      next_actions: ["details"],
    };
  } else if (delivered || xPosted) {
    state = {
      ...state,
      code: "delivered",
      stage_label: xPosted ? "X posted" : "Delivered",
      tone: "good",
      decision_label: xPosted ? "X posted" : "Delivered",
      primary_blocker: null,
      next_actions: ["details"],
    };
  } else if (activeX) {
    state = {
      ...state,
      code: "x_pending",
      stage_label: "X pending",
      tone: "info",
      decision_label: "X pending",
      primary_blocker: "X posting is pending or running",
      next_actions: ["details"],
    };
  } else if (passDecision && hasTranslation) {
    state = {
      ...state,
      code: "ready_to_deliver",
      stage_label: "Ready",
      tone: "info",
      decision_label: "Ready to deliver",
      primary_blocker: null,
      next_actions: ["force_telegram", "force_x", "manual_score"],
    };
  }

  return state;
}

// deno-lint-ignore no-explicit-any
async function getTweetIdsFromFailedJobs(
  supabase: any,
  limit: number,
  offset: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, type, status, payload, result_meta, idempotency_key, created_at",
    )
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit * 3 - 1);
  if (error) throw error;
  const jobRows = checkedMonitoringRows(data, "monitoring_failed_jobs");
  const postByRef = await loadPostsByJobReferences(supabase, jobRows);
  const ids: string[] = [];
  for (const row of jobRows) {
    if (!isFailedJobActionable(row, postForJob(row, postByRef))) continue;
    const tid = getPayloadTweetId(row.payload);
    if (tid && !ids.includes(tid)) ids.push(tid);
    if (ids.length >= limit) break;
  }
  if (ids.length < limit) {
    const { data: dedupeRows, error: dedupeError } = await supabase
      .from("posts")
      .select("tweet_id, dedupe_checked_at")
      .eq("dedupe_status", "failed")
      .order("dedupe_checked_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (dedupeError) throw dedupeError;
    for (const row of checkedMonitoringRows(dedupeRows, "monitoring_failed_dedupe")) {
      const tid = row.tweet_id;
      if (typeof tid !== "string" || tid.length === 0) {
        throw new Error("monitoring_failed_dedupe_invalid_row");
      }
      if (tid && !ids.includes(tid)) ids.push(tid);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

// deno-lint-ignore no-explicit-any
async function getTweetIdsFromXDeliveries(
  supabase: any,
  status: string | string[],
  limit: number,
  offset: number,
  since?: string,
  exactPostId?: string,
): Promise<string[]> {
  let q = supabase
    .from("x_deliveries")
    .select("post_id, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  if (since) q = q.gte("created_at", since);
  if (exactPostId) q = q.eq("post_id", exactPostId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = checkedMonitoringRows(data, "monitoring_x_delivery_ids");
  return [
    ...new Set(
      rows.map((row) => {
        const postId = row.post_id;
        if (typeof postId !== "string" || postId.length === 0) {
          throw new Error("monitoring_x_delivery_ids_invalid_row");
        }
        return postId;
      }),
    ),
  ] as string[];
}

interface LatestJobState {
  status: string;
  last_error?: string | null;
}

function latestJobFor(
  tweetId: string,
  type: string,
  jobStateByTweet: Map<string, Map<string, LatestJobState>>,
): LatestJobState | null {
  return jobStateByTweet.get(tweetId)?.get(type) ?? null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function integer(value: unknown): number {
  return Math.max(0, Math.round(numeric(value)));
}

function nullableInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  return integer(value);
}

function durationSeconds(startedAt: unknown, endedAt: unknown): number | null {
  if (typeof startedAt !== "string" || typeof endedAt !== "string") {
    return null;
  }
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  return Math.max(0, Math.round((ended - started) / 1000));
}

function mapProcessAiCall(row: Record<string, unknown>): MonitoringProcessAiCall {
  return {
    workflow_run_key: String(row.workflow_run_key ?? ""),
    trace_name: String(row.trace_name ?? "unknown"),
    operation_name: String(row.operation_name ?? "unknown"),
    agent_name: textOrNull(row.agent_name),
    model: textOrNull(row.model),
    endpoint: textOrNull(row.endpoint),
    status: String(row.status ?? "unknown"),
    total_tokens: integer(row.total_tokens),
    reasoning_tokens: integer(row.reasoning_tokens),
    duration_ms: nullableInteger(row.duration_ms),
    started_at: textOrNull(row.started_at),
    ended_at: textOrNull(row.ended_at),
    foglamp_exported: row.foglamp_exported === true,
    foglamp_span_estimate: integer(row.foglamp_span_estimate),
    foglamp_skip_reason: textOrNull(row.foglamp_skip_reason),
    error_message: textOrNull(row.error_message),
  };
}

function mapProcessRun(
  row: Record<string, unknown>,
  calls: MonitoringProcessAiCall[],
): MonitoringProcessRun {
  return {
    run_key: String(row.run_key ?? ""),
    workflow_name: String(row.workflow_name ?? "unknown"),
    workflow_run_id: textOrNull(row.workflow_run_id),
    status: String(row.status ?? "unknown"),
    source_function: textOrNull(row.source_function),
    started_at: textOrNull(row.started_at),
    ended_at: textOrNull(row.ended_at),
    duration_seconds: durationSeconds(row.started_at, row.ended_at),
    last_error: textOrNull(row.last_error),
    ai_call_count: calls.length,
    failed_ai_call_count: calls.filter((call) => call.status === "failed")
      .length,
    total_tokens: calls.reduce((sum, call) => sum + call.total_tokens, 0),
    foglamp_exported: calls.filter((call) => call.foglamp_exported).length,
    foglamp_skipped: calls.filter((call) => !call.foglamp_exported).length,
    calls,
  };
}

function unavailableProcessSnapshot(reason: string): MonitoringProcessSnapshot {
  return {
    available: false,
    source: "unavailable",
    partial_reason: reason,
    latest_run: null,
    recent_runs: [],
    ai_calls: 0,
    failed_ai_calls: 0,
    total_tokens: 0,
    foglamp_exported: 0,
    foglamp_skipped: 0,
  };
}

// deno-lint-ignore no-explicit-any
async function loadProcessObservabilityByTweet(
  supabase: any,
  tweetIds: string[],
): Promise<MonitoringProcessLookup> {
  const uniqueTweetIds = [...new Set(tweetIds.filter(Boolean))];
  const empty = {
    byTweet: new Map<string, MonitoringProcessSnapshot>(),
    unavailableReason: null,
  };
  if (uniqueTweetIds.length === 0) return empty;

  try {
    const { data: runData, error: runError } = await supabase
      .from("workflow_runs")
      .select(
        "run_key, workflow_name, workflow_run_id, status, source_function, tweet_id, started_at, ended_at, last_error",
      )
      .in("tweet_id", uniqueTweetIds)
      .order("started_at", { ascending: false })
      .limit(Math.min(Math.max(uniqueTweetIds.length * 5, 25), 250));

    if (runError) {
      return {
        byTweet: new Map(),
        unavailableReason: isMissingSchemaError(runError)
          ? "observability_schema_missing"
          : "workflow_runs_unavailable",
      };
    }

    const runRows = ((runData ?? []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.run_key === "string" && row.run_key);
    const runKeys = [...new Set(runRows.map((row) => row.run_key as string))];
    const callsByRun = new Map<string, MonitoringProcessAiCall[]>();
    let partialReason: string | null = null;

    if (runKeys.length > 0) {
      const { data: callData, error: callError } = await supabase
        .from("ai_call_ledger")
        .select(
          "workflow_run_key, trace_name, operation_name, agent_name, model, endpoint, status, total_tokens, reasoning_tokens, duration_ms, started_at, ended_at, foglamp_exported, foglamp_span_estimate, foglamp_skip_reason, error_message",
        )
        .in("workflow_run_key", runKeys)
        .order("started_at", { ascending: false })
        .limit(1000);

      if (callError) {
        partialReason = isMissingSchemaError(callError)
          ? "ai_call_ledger_schema_missing"
          : "ai_call_ledger_unavailable";
      } else {
        for (
          const call of ((callData ?? []) as Array<Record<string, unknown>>)
            .map(mapProcessAiCall)
        ) {
          if (!call.workflow_run_key) continue;
          if (!callsByRun.has(call.workflow_run_key)) {
            callsByRun.set(call.workflow_run_key, []);
          }
          callsByRun.get(call.workflow_run_key)!.push(call);
        }
      }
    }

    const runsByTweet = new Map<string, Record<string, unknown>[]>();
    for (const row of runRows) {
      const tweetId = textOrNull(row.tweet_id);
      if (!tweetId) continue;
      if (!runsByTweet.has(tweetId)) runsByTweet.set(tweetId, []);
      runsByTweet.get(tweetId)!.push(row);
    }

    const byTweet = new Map<string, MonitoringProcessSnapshot>();
    for (const [tweetId, rows] of runsByTweet) {
      const recentRuns = rows.slice(0, 5).map((row) =>
        mapProcessRun(
          row,
          (callsByRun.get(String(row.run_key ?? "")) ?? []).slice(0, 12),
        )
      );
      const totals = recentRuns.reduce(
        (acc, run) => {
          acc.aiCalls += run.ai_call_count;
          acc.failedAiCalls += run.failed_ai_call_count;
          acc.totalTokens += run.total_tokens;
          acc.foglampExported += run.foglamp_exported;
          acc.foglampSkipped += run.foglamp_skipped;
          return acc;
        },
        {
          aiCalls: 0,
          failedAiCalls: 0,
          totalTokens: 0,
          foglampExported: 0,
          foglampSkipped: 0,
        },
      );
      byTweet.set(tweetId, {
        available: true,
        source: "workflow_runs",
        partial_reason: partialReason,
        latest_run: recentRuns[0] ?? null,
        recent_runs: recentRuns,
        ai_calls: totals.aiCalls,
        failed_ai_calls: totals.failedAiCalls,
        total_tokens: totals.totalTokens,
        foglamp_exported: totals.foglampExported,
        foglamp_skipped: totals.foglampSkipped,
      });
    }

    return { byTweet, unavailableReason: null };
  } catch {
    return {
      byTweet: new Map(),
      unavailableReason: "process_observability_unavailable",
    };
  }
}

// deno-lint-ignore no-explicit-any
async function loadJobStateMap(
  supabase: any,
  tweetIds?: string[],
): Promise<Map<string, Map<string, LatestJobState>>> {
  const wanted = new Set(tweetIds ?? []);
  let query = supabase
    .from("jobs")
    .select("type, status, last_error, payload, created_at")
    .in("type", ["dedupe", "translate", "deliver", "hydrate_tweet", "enrich"])
    .in("status", ["pending", "running", "failed"])
    .order("created_at", { ascending: false })
    .limit(5000);
  // Exact Monitoring rehydration must not retain the page path's global
  // active/failed-jobs scan. A single requested post has an indexed JSON
  // payload lookup; multi-post pages retain the established broad behavior.
  if (wanted.size === 1) {
    query = query.filter("payload->>tweet_id", "eq", [...wanted][0]);
  }
  const { data, error } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("monitoring_job_state_invalid_response");
  }

  const map = new Map<string, Map<string, LatestJobState>>();
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("monitoring_job_state_invalid_row");
    }
    if (typeof row.type !== "string" || typeof row.status !== "string") {
      throw new Error("monitoring_job_state_invalid_row");
    }
    const tid = getPayloadTweetId(row.payload);
    if (!tid || (wanted.size > 0 && !wanted.has(tid))) continue;
    if (!map.has(tid)) map.set(tid, new Map());
    const perTweet = map.get(tid)!;
    if (!perTweet.has(row.type)) {
      perTweet.set(row.type, {
        status: row.status,
        last_error: row.last_error ?? null,
      });
    }
  }
  return map;
}

export function applyJobStateToRpc(
  tweetId: string,
  rpc: Record<string, unknown> | undefined,
  jobStateByTweet: Map<string, Map<string, LatestJobState>>,
): Record<string, unknown> {
  const next = { ...(rpc ?? {}) };
  const dedupe = latestJobFor(tweetId, "dedupe", jobStateByTweet);
  const translate = latestJobFor(tweetId, "translate", jobStateByTweet);
  const deliver = latestJobFor(tweetId, "deliver", jobStateByTweet);
  if (dedupe) {
    next.dedupe_job_status = dedupe.status;
    if (dedupe.last_error) next.dedupe_error = dedupe.last_error;
  }
  if (translate) {
    next.translate_status = translate.status;
    if (translate.last_error) next.translate_error = translate.last_error;
  } else if (!next.translated_at) {
    next.translate_status = null;
    next.translate_error = null;
  }
  if (deliver) {
    next.delivery_job_status = deliver.status;
    if (
      !next.delivery_status || isActiveStatus(deliver.status) ||
      deliver.status === "failed"
    ) {
      next.delivery_status = deliver.status;
    }
    if (deliver.last_error) next.delivery_error = deliver.last_error;
  } else if (!next.posted_at) {
    next.delivery_job_status = null;
  }
  return next;
}

export function toMonitoringEntry(
  post: Record<string, unknown>,
  rpcRaw: Record<string, unknown> | undefined,
  threshold: number,
  jobStateByTweet: Map<string, Map<string, LatestJobState>>,
  duplicateTargets: Map<string, DuplicateTargetSummary> = new Map(),
) {
  const rpc = applyJobStateToRpc(
    post.tweet_id as string,
    rpcRaw,
    jobStateByTweet,
  );
  const translatedAt = rpc?.translated_at || post.translated_at;
  const isTranslated = !!(translatedAt ||
    (post.text_translated && post.text_translated !== post.text_original));
  const deliveryStatus = (rpc?.delivery_status as string) || "";
  const xStatus = (rpc?.x_status as string) ?? null;
  const isTruncated = (rpc?.is_truncated as boolean) ??
    (post.is_truncated as boolean) ?? false;
  const hydratedAt = (rpc?.hydrated_at as string) ??
    (post.hydrated_at as string) ?? null;
  const hasMedia = post.has_media === true;
  let monitoringState = deriveMonitoringState(
    { ...post, is_truncated: isTruncated, hydrated_at: hydratedAt },
    rpc,
    threshold,
  );
  const duplicateOf = typeof post.dup_of_tweet_id === "string"
    ? duplicateTargets.get(post.dup_of_tweet_id) ?? null
    : null;
  if (
    duplicateOf &&
    monitoringState.code === "blocked_duplicate" &&
    (duplicateOf.coverage_state === "not_covered" ||
      duplicateOf.coverage_state === "also_duplicate")
  ) {
    monitoringState = {
      ...monitoringState,
      code: "duplicate_coverage_gap",
      stage_label: "Duplicate coverage gap",
      tone: "warn",
      decision_label: "Duplicate not covered",
      primary_blocker:
        "The matched duplicate has not been delivered and is not actively moving through delivery. Review or re-run duplicate check so one item can be evaluated.",
      needs_attention: true,
      next_actions: ["run_dedupe", "manual_score", "clear_duplicate"],
    };
  }
  const mayCallX = monitoringState.code === "ready_to_deliver" &&
    xStatus !== "posted";
  const xCostReasons: string[] = [];
  if (monitoringState.code === "hydration") {
    xCostReasons.push("hydrate read may be needed");
  }
  if (mayCallX && hasMedia) xCostReasons.push("media upload expected");
  if (mayCallX) xCostReasons.push("tweet write expected");

  return {
    tweet_id: post.tweet_id,
    text_original: post.text_original || "",
    text_translated: post.text_translated || "",
    url: post.url || "",
    created_at: post.created_at,
    has_media: hasMedia,
    account_handle: ((post.accounts as { handle?: string } | null)?.handle) ??
      "",
    author_handle: post.author_handle ?? null,
    delivery_status: deliveryStatus,
    telegram_message_ids: [],
    is_translated: isTranslated,
    is_delivered: deliveryStatus === "posted",
    translation_job_status: (rpc?.translate_status as string) ||
      (isTranslated ? "completed" : ""),
    delivery_job_status: deliveryStatus,
    translation_error: (rpc?.translate_error as string) || "",
    delivery_error: (rpc?.delivery_error as string) || "",
    importance_score: post.importance_score ?? null,
    importance_tags: post.importance_tags ?? null,
    importance_reasoning: post.importance_reasoning ?? null,
    delivery_decision: post.delivery_decision ?? null,
    score_axes: post.score_axes ?? null,
    final_score: post.final_score ?? null,
    base_score: post.base_score ?? null,
    learned_score: post.learned_score ?? null,
    learned_delta: post.learned_delta ?? null,
    x_gate_score: post.x_gate_score ?? null,
    learning_confidence: post.learning_confidence ?? null,
    decision_reason: post.decision_reason ?? null,
    scoring_version: post.scoring_version ?? null,
    scoring_profile_id: post.scoring_profile_id ?? null,
    audience_class: post.audience_class ?? null,
    audience_confidence: post.audience_confidence ?? null,
    audience_reason: post.audience_reason ?? null,
    global_exception_class: post.global_exception_class ?? null,
    score_review_status: post.score_review_status ?? null,
    is_truncated: isTruncated,
    hydrated_at: hydratedAt,
    hydration_source: (rpc?.hydration_source as string) ??
      (post.hydration_source as string) ?? null,
    x_status: xStatus,
    x_tweet_id: (rpc?.x_tweet_id as string) ?? null,
    x_posted_at: (rpc?.x_posted_at as string) ?? null,
    x_error: (rpc?.x_error as string) ?? null,
    x_skip_reason: (rpc?.x_skip_reason as string) ?? null,
    dup_of_tweet_id: post.dup_of_tweet_id ?? null,
    duplicate_of: duplicateOf,
    story_cluster_id: post.story_cluster_id ?? null,
    dup_similarity: post.dup_similarity ?? null,
    dedupe_status: post.dedupe_status ?? null,
    dedupe_checked_at: post.dedupe_checked_at ?? null,
    dedupe_method: post.dedupe_method ?? null,
    dedupe_confidence: post.dedupe_confidence ?? null,
    dedupe_reason: post.dedupe_reason ?? null,
    dedupe_new_facts: post.dedupe_new_facts ?? null,
    score_breakdown: post.score_breakdown ?? null,
    feedback_locked: post.feedback_locked ?? false,
    enrich_status: post.enrich_status ?? null,
    enrichment_version: post.enrichment_version ?? null,
    editorial_commentary: post.editorial_commentary ?? null,
    humanized_commentary: post.humanized_commentary ?? null,
    commentary_hook: post.commentary_hook ?? null,
    commentary_question: post.commentary_question ?? null,
    narrative_callback: post.narrative_callback ?? null,
    composed_post_text: post.composed_post_text ?? null,
    creator_angle: post.creator_angle ?? null,
    why_it_matters: post.why_it_matters ?? null,
    source_context: post.source_context ?? null,
    algorithm_signal_scores: post.algorithm_signal_scores ?? null,
    aggregator_risk_score: post.aggregator_risk_score ?? null,
    ai_voice_risk_score: post.ai_voice_risk_score ?? null,
    monetization_risk_flags: post.monetization_risk_flags ?? null,
    enrichment_review_reason: post.enrichment_review_reason ?? null,
    final_x_text: post.final_x_text ?? null,
    post_format_hint: post.post_format_hint ?? null,
    background_context: post.background_context ?? null,
    enrich_tokens: post.enrich_tokens ?? null,
    enrich_duration_ms: post.enrich_duration_ms ?? null,
    x_cost_flags: {
      may_call_x: mayCallX,
      media_upload_expected: mayCallX && hasMedia,
      hydration_expected: monitoringState.code === "hydration",
      reasons: xCostReasons,
    },
    monitoring_state: monitoringState,
  };
}

// deno-lint-ignore no-explicit-any
async function loadPipelineStatusMap(
  supabase: any,
  tweetIds: string[],
): Promise<Record<string, Record<string, unknown>>> {
  const wanted = new Set(tweetIds.filter(Boolean));
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  if (wanted.size === 0) return statusByTweet;

  const { data, error } = await supabase.rpc("get_post_pipeline_status", {
    tweet_ids: [...wanted],
  });
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("monitoring_pipeline_status_invalid_response");
  }
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("monitoring_pipeline_status_invalid_row");
    }
    const tweetId = (row as Record<string, unknown>).tweet_id;
    if (typeof tweetId !== "string" || !wanted.has(tweetId)) {
      throw new Error("monitoring_pipeline_status_invalid_row");
    }
    statusByTweet[tweetId] = row as Record<string, unknown>;
  }
  return statusByTweet;
}

// deno-lint-ignore no-explicit-any
async function loadDuplicateTargetMap(
  supabase: any,
  rows: Record<string, unknown>[],
  threshold: number,
): Promise<Map<string, DuplicateTargetSummary>> {
  const ids = [
    ...new Set(
      rows.map((row) => row.dup_of_tweet_id).filter((id): id is string =>
        typeof id === "string" && id.length > 0
      ),
    ),
  ];
  const map = new Map<string, DuplicateTargetSummary>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("posts")
    .select(
      "tweet_id, text_original, url, created_at, author_handle, delivery_decision, decision_reason, importance_score, final_score, dedupe_status, dup_of_tweet_id, dup_similarity, translated_at, text_translated, is_truncated, hydrated_at, enrich_status, score_review_status",
    )
    .in("tweet_id", ids);
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("monitoring_duplicate_target_invalid_response");
  }

  const wanted = new Set(ids);
  const targets: Record<string, unknown>[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("monitoring_duplicate_target_invalid_row");
    }
    const tweetId = (row as Record<string, unknown>).tweet_id;
    if (typeof tweetId !== "string" || !wanted.has(tweetId)) {
      throw new Error("monitoring_duplicate_target_invalid_row");
    }
    targets.push(row as Record<string, unknown>);
  }
  const targetIds = targets.map((post) => post.tweet_id as string);
  const jobStateByTweet = await loadJobStateMap(supabase, targetIds);
  const statusByTweet = await loadPipelineStatusMap(supabase, targetIds);

  for (const post of targets) {
    const tweetId = post.tweet_id as string;
    const rpc = applyJobStateToRpc(
      tweetId,
      statusByTweet[tweetId],
      jobStateByTweet,
    );
    const state = deriveMonitoringState(post, rpc, threshold);
    const telegramState = state.telegram_state;
    const xState = state.x_state;
    const delivered = telegramState === "delivered" ||
      telegramState === "posted" || xState === "posted";
    const active = isActiveStatus(telegramState) || isActiveStatus(xState) ||
      post.delivery_decision === "deliver";
    const coverageState = delivered
      ? "delivered"
      : active
      ? "in_pipeline"
      : post.dup_of_tweet_id
      ? "also_duplicate"
      : "not_covered";

    map.set(tweetId, {
      tweet_id: tweetId,
      text_original: String(post.text_original ?? ""),
      url: String(post.url ?? ""),
      created_at: typeof post.created_at === "string" ? post.created_at : null,
      author_handle: typeof post.author_handle === "string"
        ? post.author_handle
        : null,
      delivery_decision: typeof post.delivery_decision === "string"
        ? post.delivery_decision
        : null,
      decision_reason: typeof post.decision_reason === "string"
        ? post.decision_reason
        : null,
      final_score: typeof post.final_score === "number"
        ? post.final_score
        : null,
      importance_score: typeof post.importance_score === "number"
        ? post.importance_score
        : null,
      dedupe_status: typeof post.dedupe_status === "string"
        ? post.dedupe_status
        : null,
      dup_of_tweet_id: typeof post.dup_of_tweet_id === "string"
        ? post.dup_of_tweet_id
        : null,
      dup_similarity: typeof post.dup_similarity === "number"
        ? post.dup_similarity
        : null,
      telegram_state: telegramState,
      x_state: xState,
      monitoring_state: state,
      coverage_state: coverageState,
    });
  }

  return map;
}

function entryTweetId(entry: Record<string, unknown>): string {
  return String(entry.tweet_id ?? "");
}

function entryCreatedAtMs(entry: Record<string, unknown>): number {
  const value = typeof entry.created_at === "string"
    ? Date.parse(entry.created_at)
    : Number.NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function entryIsDeliveredOrPosted(entry: Record<string, unknown>): boolean {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return entry.is_delivered === true || entry.x_status === "posted" ||
    state.telegram_state === "delivered" || state.x_state === "posted";
}

function entryHasActiveDeliveryPath(entry: Record<string, unknown>): boolean {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return entry.delivery_decision === "deliver" ||
    ["ready_to_deliver", "telegram_pending", "x_pending", "hydration"].includes(
      state.code,
    ) ||
    isActiveStatus(state.telegram_state) ||
    isActiveStatus(state.x_state);
}

function chooseDuplicateCanonical(
  entries: Record<string, unknown>[],
): Record<string, unknown> {
  return [...entries].sort((a, b) => {
    const deliveredDelta = Number(entryIsDeliveredOrPosted(b)) -
      Number(entryIsDeliveredOrPosted(a));
    if (deliveredDelta !== 0) return deliveredDelta;
    const activeDelta = Number(entryHasActiveDeliveryPath(b)) -
      Number(entryHasActiveDeliveryPath(a));
    if (activeDelta !== 0) return activeDelta;
    const scoreDelta = (scoreFromPost(b) ?? -1) - (scoreFromPost(a) ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return entryCreatedAtMs(a) - entryCreatedAtMs(b);
  })[0];
}

function clusterMemberFromEntry(
  entry: Record<string, unknown>,
  canonicalTweetId: string,
): Record<string, unknown> {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return {
    tweet_id: entryTweetId(entry),
    text_original: String(entry.text_original ?? ""),
    url: String(entry.url ?? ""),
    created_at: typeof entry.created_at === "string" ? entry.created_at : null,
    author_handle: typeof entry.author_handle === "string"
      ? entry.author_handle
      : null,
    final_score: typeof entry.final_score === "number"
      ? entry.final_score
      : null,
    importance_score: typeof entry.importance_score === "number"
      ? entry.importance_score
      : null,
    dedupe_status: typeof entry.dedupe_status === "string"
      ? entry.dedupe_status
      : null,
    dup_of_tweet_id: typeof entry.dup_of_tweet_id === "string"
      ? entry.dup_of_tweet_id
      : null,
    dup_similarity: typeof entry.dup_similarity === "number"
      ? entry.dup_similarity
      : null,
    dedupe_confidence: typeof entry.dedupe_confidence === "number"
      ? entry.dedupe_confidence
      : null,
    dedupe_reason: typeof entry.dedupe_reason === "string"
      ? entry.dedupe_reason
      : null,
    telegram_state: state.telegram_state ??
      String(entry.delivery_status ?? "none"),
    x_state: typeof entry.x_status === "string"
      ? entry.x_status
      : state.x_state ?? "none",
    coverage_state: entryIsDeliveredOrPosted(entry)
      ? "delivered"
      : entryHasActiveDeliveryPath(entry)
      ? "in_pipeline"
      : entry.dup_of_tweet_id
      ? "also_duplicate"
      : "not_covered",
    is_canonical: entryTweetId(entry) === canonicalTweetId,
  };
}

function clusterMemberFromTarget(
  target: DuplicateTargetSummary,
  canonicalTweetId: string,
): Record<string, unknown> {
  return {
    tweet_id: target.tweet_id,
    text_original: target.text_original,
    url: target.url,
    created_at: target.created_at,
    author_handle: target.author_handle,
    final_score: target.final_score,
    importance_score: target.importance_score,
    dedupe_status: target.dedupe_status,
    dup_of_tweet_id: target.dup_of_tweet_id,
    dup_similarity: target.dup_similarity,
    telegram_state: target.telegram_state,
    x_state: target.x_state,
    coverage_state: target.coverage_state,
    is_canonical: target.tweet_id === canonicalTweetId,
  };
}

function duplicateClusterCounts(members: Record<string, unknown>[]) {
  return {
    total: members.length,
    delivered:
      members.filter((m) =>
        m.coverage_state === "delivered" || m.telegram_state === "delivered" ||
        m.telegram_state === "posted"
      ).length,
    x_posted: members.filter((m) => m.x_state === "posted").length,
    blocked:
      members.filter((m) =>
        m.dedupe_status === "duplicate" || typeof m.dup_of_tweet_id === "string"
      ).length,
    uncertain: members.filter((m) => m.dedupe_status === "uncertain").length,
    coverage_gap:
      members.filter((m) =>
        m.coverage_state === "not_covered" || m.dedupe_status === "coverage_gap"
      ).length,
  };
}

export function attachDuplicateClusters(
  entries: Record<string, unknown>[],
): Record<string, unknown>[] {
  const referencedIds = new Set(
    entries.map((entry) =>
      typeof entry.dup_of_tweet_id === "string" ? entry.dup_of_tweet_id : ""
    ).filter(Boolean),
  );
  const storyCounts = new Map<string, number>();
  for (const entry of entries) {
    const story = typeof entry.story_cluster_id === "string"
      ? entry.story_cluster_id
      : "";
    if (story) storyCounts.set(story, (storyCounts.get(story) ?? 0) + 1);
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const entry of entries) {
    const tweetId = entryTweetId(entry);
    const story = typeof entry.story_cluster_id === "string"
      ? entry.story_cluster_id
      : "";
    const dupOf = typeof entry.dup_of_tweet_id === "string"
      ? entry.dup_of_tweet_id
      : "";
    const key = story && (storyCounts.get(story) ?? 0) > 1
      ? `story:${story}`
      : dupOf
      ? `root:${dupOf}`
      : referencedIds.has(tweetId)
      ? `root:${tweetId}`
      : "";
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const clusterByTweet = new Map<string, Record<string, unknown>>();
  const hidden = new Set<string>();
  for (const [clusterId, group] of groups) {
    if (group.length === 0) continue;
    const canonical = chooseDuplicateCanonical(group);
    const canonicalTweetId = entryTweetId(canonical);
    const membersById = new Map<string, Record<string, unknown>>();
    for (const entry of group) {
      membersById.set(
        entryTweetId(entry),
        clusterMemberFromEntry(entry, canonicalTweetId),
      );
      const target = entry.duplicate_of as
        | DuplicateTargetSummary
        | null
        | undefined;
      if (target?.tweet_id && !membersById.has(target.tweet_id)) {
        membersById.set(
          target.tweet_id,
          clusterMemberFromTarget(target, canonicalTweetId),
        );
      }
    }
    const members = [...membersById.values()].sort((a, b) =>
      Number(Boolean(b.is_canonical)) - Number(Boolean(a.is_canonical)) ||
      entryCreatedAtMs(a) - entryCreatedAtMs(b)
    );
    if (members.length < 2) continue;
    const counts = duplicateClusterCounts(members);
    const coverageState = counts.delivered > 0 || counts.x_posted > 0
      ? "covered"
      : members.some((m) => m.coverage_state === "in_pipeline")
      ? "in_pipeline"
      : counts.coverage_gap > 0
      ? "coverage_gap"
      : "unknown";
    const cluster = {
      cluster_id: clusterId,
      canonical_tweet_id: canonicalTweetId,
      members,
      counts,
      has_x_anomaly: counts.x_posted > 1,
      coverage_state: coverageState,
    };
    for (const entry of group) {
      clusterByTweet.set(entryTweetId(entry), cluster);
      if (entryTweetId(entry) !== canonicalTweetId) {
        hidden.add(entryTweetId(entry));
      }
    }
  }

  return entries.map((entry) => ({
    ...entry,
    duplicate_cluster: clusterByTweet.get(entryTweetId(entry)) ?? null,
    hidden_in_cluster: hidden.has(entryTweetId(entry)),
  }));
}

export function matchesMonitoringFilter(
  entry: Record<string, unknown>,
  filter: MonitoringFilter,
): boolean {
  if (filter === "all") return true;
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  switch (filter) {
    case "needs_attention":
      return state.needs_attention === true;
    case "failed_stuck":
      return state.code === "failed_stuck";
    case "needs_score":
      return state.code === "needs_score";
    case "translation_queue":
      return state.translation_state === "queued" ||
        state.translation_state === "needs_translation";
    case "below_threshold":
      return state.code === "below_threshold";
    case "manual_review":
      return state.code === "manual_review";
    case "v2_would_post":
    case "v2_would_skip":
    case "v1_post_v2_skip":
    case "v1_skip_v2_post":
    case "v2_off_topic":
    case "v2_needs_review":
    case "v2_regional_auto":
    case "global_pilot_review":
      return matchesMonitoringScoringV2Filter(entry, filter);
    case "manual_scoring_feedback":
      return isManualScoringFeedbackEntry(entry);
    case "duplicates":
      return !!entry.dup_of_tweet_id;
    case "coverage_gap":
      return state.code === "duplicate_coverage_gap" ||
        entry.dedupe_status === "coverage_gap";
    case "possible_duplicate":
      return entry.dedupe_status === "uncertain" ||
        entry.dedupe_status === "coverage_gap" ||
        state.code === "duplicate_coverage_gap";
    case "duplicate_anomalies": {
      const target = (entry.duplicate_of ?? null) as
        | DuplicateTargetSummary
        | null;
      return entry.x_status === "posted" && target?.x_state === "posted";
    }
    case "ready_to_deliver":
      return state.code === "ready_to_deliver";
    case "telegram_pending":
      return state.code === "telegram_pending";
    case "x_pending":
      return state.code === "x_pending" || entry.x_status === "pending" ||
        entry.x_status === "posting";
    case "x_failed":
      return entry.x_status === "failed";
    case "delivered_24h":
      return state.code === "delivered" || entry.x_status === "posted";
    case "hydration":
      return state.code === "hydration";
  }
}

// deno-lint-ignore no-explicit-any
export async function getMonitoringEntries(
  supabase: any,
  body: Record<string, unknown>,
) {
  const filter = normalizeMonitoringFilter(body.filter);
  const scoreBucket = normalizeMonitoringScoreBucket(body.score_bucket);
  const search = sanitizeSearchTerm(body.search);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const cursor = Math.max(Number(body.cursor) || 0, 0);
  const hasExactTweetId = Object.prototype.hasOwnProperty.call(body, "tweet_id");
  const exactTweetId = normalizeMonitoringTweetId(body.tweet_id);
  if (hasExactTweetId && !exactTweetId) {
    return { success: false, error: "Invalid monitoring tweet id" };
  }
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const threshold = await loadActiveThreshold(supabase);
  const emptyExactResult = () => ({
    success: true,
    entries: [],
    next_cursor: null,
    filter,
    score_bucket: scoreBucket,
    search,
  });

  let idOrder: string[] | null = null;
  if (!exactTweetId && filter === "failed_stuck") {
    idOrder = await getTweetIdsFromFailedJobs(supabase, limit, cursor);
  }
  if (!exactTweetId && filter === "x_pending") {
    idOrder = await getTweetIdsFromXDeliveries(
      supabase,
      ["pending", "posting"],
      limit,
      cursor,
    );
  }
  if (!exactTweetId && filter === "x_failed") {
    idOrder = await getTweetIdsFromXDeliveries(
      supabase,
      "failed",
      limit,
      cursor,
    );
  }
  if (!exactTweetId && filter === "delivered_24h") {
    idOrder = await getTweetIdsFromXDeliveries(
      supabase,
      "posted",
      limit,
      cursor,
      since24h,
    );
  }

  // X-delivery-backed filters are defined by related x_deliveries rows rather
  // than the post projection alone. Keep exact lookups inside their same
  // bounded status/window membership predicates before the generic entry view.
  if (exactTweetId && filter === "x_pending") {
    const pendingTweetIds = await getTweetIdsFromXDeliveries(
      supabase,
      ["pending", "posting"],
      1,
      0,
      undefined,
      exactTweetId,
    );
    if (!pendingTweetIds.includes(exactTweetId)) return emptyExactResult();
  }
  if (exactTweetId && filter === "x_failed") {
    const failedTweetIds = await getTweetIdsFromXDeliveries(
      supabase,
      "failed",
      1,
      0,
      undefined,
      exactTweetId,
    );
    if (!failedTweetIds.includes(exactTweetId)) return emptyExactResult();
  }
  if (exactTweetId && filter === "delivered_24h") {
    const deliveredTweetIds = await getTweetIdsFromXDeliveries(
      supabase,
      "posted",
      1,
      0,
      since24h,
      exactTweetId,
    );
    if (!deliveredTweetIds.includes(exactTweetId)) {
      return emptyExactResult();
    }
  }
  // failed_stuck has actionability rules spanning jobs and dedupe fallback
  // ordering. There is no bounded exact predicate yet, so fail closed here;
  // the client preserves offset pages and lets its deadline-triggered resync
  // obtain the canonical paginated view instead of injecting a false member.
  if (exactTweetId && filter === "failed_stuck") return emptyExactResult();

  if (!exactTweetId && idOrder && idOrder.length === 0) {
    return { success: true, entries: [], next_cursor: null, filter, search };
  }

  const needsInMemoryScoreFilter = scoreBucket !== "any" &&
    scoreBucket !== "unscored";
  const needsInMemoryFilter = filter !== "all" || needsInMemoryScoreFilter;
  const scanLimit = exactTweetId
    ? 1
    : idOrder
    ? limit
    : needsInMemoryFilter
    ? Math.min(limit * 8, 500)
    : limit;
  const buildQuery = (selectColumns: string) => {
    let q = supabase
      .from("posts")
      .select(selectColumns)
      .order("created_at", { ascending: false });

    if (exactTweetId) {
      q = q.eq("tweet_id", exactTweetId).limit(1);
    } else if (idOrder) {
      q = q.in("tweet_id", idOrder);
    } else {
      switch (filter) {
        case "manual_review":
          q = q.or(
            "enrich_status.eq.awaiting_approval,dedupe_status.eq.uncertain",
          );
          break;
        case "duplicates":
          q = q.not("dup_of_tweet_id", "is", null);
          break;
        case "coverage_gap":
          q = q.or("dedupe_status.eq.coverage_gap,dedupe_status.eq.uncertain");
          break;
        case "possible_duplicate":
          q = q.or("dedupe_status.eq.uncertain,dedupe_status.eq.coverage_gap");
          break;
        case "duplicate_anomalies":
          q = q.not("dup_of_tweet_id", "is", null);
          break;
        case "hydration":
          q = q.eq("is_truncated", true).is("hydrated_at", null);
          break;
        case "below_threshold":
          q = q.eq("delivery_decision", "skip");
          break;
        case "v2_would_post":
        case "v2_would_skip":
        case "v1_post_v2_skip":
        case "v1_skip_v2_post":
        case "v2_off_topic":
        case "v2_needs_review":
        case "v2_regional_auto":
        case "global_pilot_review":
          q = q.not("scoring_version", "is", null);
          break;
        case "manual_scoring_feedback":
          q = q.eq("feedback_locked", true);
          break;
        case "ready_to_deliver":
          q = q.eq("delivery_decision", "deliver").not(
            "text_translated",
            "is",
            null,
          ).or("is_truncated.eq.false,hydrated_at.not.is.null");
          break;
        case "needs_score":
          q = q.is("final_score", null).is("importance_score", null);
          break;
      }
      if (scoreBucket === "unscored") {
        q = q.is("final_score", null).is("importance_score", null);
      }
      q = q.range(cursor, cursor + scanLimit - 1);
    }

    if (search) q = q.or(postSearchOr(search));
    return q;
  };

  let result = await buildQuery(MONITORING_POST_SELECT);
  if (result.error && isMissingSchemaError(result.error)) {
    result = await buildQuery(MONITORING_POST_SELECT_NO_ENRICHMENT_V2);
  }
  if (result.error && isMissingSchemaError(result.error)) {
    result = await buildQuery(MONITORING_POST_SELECT_NO_SCORING_V2);
  }
  const posts = result.data;
  if (result.error) throw result.error;
  const rows = (posts ?? []) as Record<string, unknown>[];
  if (idOrder) {
    const rank = new Map(idOrder.map((id, index) => [id, index]));
    rows.sort((a, b) =>
      (rank.get(a.tweet_id as string) ?? 0) -
      (rank.get(b.tweet_id as string) ?? 0)
    );
  }

  const tweetIds = rows.map((p) => p.tweet_id as string).filter(Boolean);
  const jobStateByTweet = await loadJobStateMap(supabase, tweetIds);
  const statusByTweet = await loadPipelineStatusMap(supabase, tweetIds);
  const duplicateTargets = await loadDuplicateTargetMap(
    supabase,
    rows,
    threshold,
  );
  const processObservability = await loadProcessObservabilityByTweet(
    supabase,
    tweetIds,
  );
  const entries = rows
    .map((post) => {
      const base = toMonitoringEntry(
        post,
        statusByTweet[post.tweet_id as string],
        threshold,
        jobStateByTweet,
        duplicateTargets,
      );
      const tweetId = String(base.tweet_id ?? "");
      return {
        ...base,
        process_observability:
          processObservability.byTweet.get(tweetId) ??
            (processObservability.unavailableReason
              ? unavailableProcessSnapshot(
                processObservability.unavailableReason,
              )
              : null),
      };
    })
    .filter((entry: Record<string, unknown>) =>
      matchesMonitoringFilter(entry, filter) &&
      matchesMonitoringScoreBucket(entry, scoreBucket)
    );
  const clusteredEntries = attachDuplicateClusters(entries);
  const visibleEntries = clusteredEntries.filter((entry) =>
    entry.hidden_in_cluster !== true
  );

  return {
    success: true,
    entries: visibleEntries.slice(0, limit),
    next_cursor: exactTweetId ? null : rows.length === scanLimit ? cursor + scanLimit : null,
    filter,
    score_bucket: scoreBucket,
    search,
  };
}

function latestDashboardHudTimestamp(entry: Record<string, unknown>): number {
  const observability = (entry.process_observability ?? null) as
    | MonitoringProcessSnapshot
    | null;
  const latestRun = observability?.latest_run ?? null;
  const candidates = [
    latestRun?.started_at,
    latestRun?.ended_at,
    entry.x_posted_at,
    entry.hydrated_at,
    entry.dedupe_checked_at,
    entry.created_at,
  ].filter((value): value is string =>
    typeof value === "string" && value.length > 0
  );
  const times = candidates
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : 0;
}

function dashboardHudRank(entry: Record<string, unknown>): number {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  const observability = (entry.process_observability ?? null) as
    | MonitoringProcessSnapshot
    | null;
  const latestRunStatus = observability?.latest_run?.status ?? null;
  if (latestRunStatus === "running" || latestRunStatus === "pending") return 50;
  if (
    entry.translation_job_status === "running" ||
    entry.translation_job_status === "pending" ||
    entry.delivery_job_status === "running" ||
    entry.delivery_job_status === "pending" ||
    state.translation_state === "pending" ||
    state.telegram_state === "pending" ||
    state.x_state === "pending"
  ) return 45;
  if (
    latestRunStatus === "failed" ||
    Boolean(entry.translation_error) ||
    Boolean(entry.delivery_error) ||
    Boolean(entry.x_error) ||
    entry.x_status === "failed" ||
    state.needs_attention === true
  ) return 40;
  if (
    entry.enrich_status === "awaiting_approval" ||
    entry.dedupe_status === "uncertain" ||
    state.code === "manual_review"
  ) return 35;
  if (
    entry.x_status === "posted" ||
    state.x_state === "posted" ||
    state.code === "delivered"
  ) return 20;
  return 10;
}

// deno-lint-ignore no-explicit-any
export async function getDashboardProcessHud(
  supabase: any,
  body: Record<string, unknown> = {},
) {
  const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 30);
  const windowHours = Math.min(
    Math.max(Number(body.window_hours) || 24, 1),
    24,
  );

  try {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
      .toISOString();
    const threshold = await loadActiveThreshold(supabase);
    const queryLimit = Math.min(limit * 4, 120);

    const buildQuery = (selectColumns: string) =>
      supabase
        .from("posts")
        .select(selectColumns)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(queryLimit);

    let result = await buildQuery(MONITORING_POST_SELECT);
    if (result.error && isMissingSchemaError(result.error)) {
      result = await buildQuery(MONITORING_POST_SELECT_NO_ENRICHMENT_V2);
    }
    if (result.error && isMissingSchemaError(result.error)) {
      result = await buildQuery(MONITORING_POST_SELECT_NO_SCORING_V2);
    }
    if (result.error) throw result.error;

    const rows = ((result.data ?? []) as Array<Record<string, unknown>>);
    const tweetIds = rows.map((post) => post.tweet_id as string).filter(Boolean);
    const jobStateByTweet = await loadJobStateMap(supabase, tweetIds);
    const statusByTweet = await loadPipelineStatusMap(supabase, tweetIds);
    const duplicateTargets = await loadDuplicateTargetMap(
      supabase,
      rows,
      threshold,
    );
    const processObservability = await loadProcessObservabilityByTweet(
      supabase,
      tweetIds,
    );
    const entries = rows.map((post) => {
      const base = toMonitoringEntry(
        post,
        statusByTweet[post.tweet_id as string],
        threshold,
        jobStateByTweet,
        duplicateTargets,
      );
      const tweetId = String(base.tweet_id ?? "");
      return {
        ...base,
        process_observability:
          processObservability.byTweet.get(tweetId) ??
            (processObservability.unavailableReason
              ? unavailableProcessSnapshot(
                processObservability.unavailableReason,
              )
              : null),
      };
    })
      .sort((a, b) =>
        dashboardHudRank(b) - dashboardHudRank(a) ||
        latestDashboardHudTimestamp(b) - latestDashboardHudTimestamp(a)
      );

    return {
      success: true,
      process_hud: {
        available: true,
        generated_at: new Date().toISOString(),
        window_hours: windowHours,
        source: "local-ledger",
        partial_reason: null,
        error: null,
        truncated: entries.length > limit || rows.length === queryLimit,
        entries: entries.slice(0, limit),
      },
    };
  } catch (error) {
    return {
      success: true,
      process_hud: {
        available: false,
        generated_at: new Date().toISOString(),
        window_hours: windowHours,
        source: "unavailable",
        partial_reason: "dashboard_process_hud_unavailable",
        error: "monitoring_process_hud_unavailable",
        truncated: false,
        entries: [],
      },
    };
  }
}

// deno-lint-ignore no-explicit-any
export async function getMonitoringOverview(
  supabase: any,
  body: Record<string, unknown>,
) {
  const windowHours = Math.min(
    Math.max(Number(body.window_hours) || 24, 1),
    720,
  );
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
    .toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const threshold = await loadActiveThreshold(supabase);
  const [
    postsRes,
    deliveriesRes,
    xDeliveriesRes,
    staleJobs,
    staleXPending,
  ] = await Promise.all([
    supabase
      .from("posts")
      .select(
        "tweet_id, text_original, text_translated, translated_at, has_media, delivery_decision, final_score, base_score, learned_score, learned_delta, x_gate_score, learning_confidence, importance_score, decision_reason, dup_of_tweet_id, is_truncated, hydrated_at, enrich_status, dedupe_status, dedupe_reason, scoring_version, audience_class, global_exception_class, score_review_status, score_breakdown, feedback_locked",
      )
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("deliveries")
      .select("subject_id, status, last_error, posted_at, created_at")
      .eq("subject_type", "post")
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("x_deliveries")
      .select(
        "post_id, status, last_error, skip_reason, x_tweet_id, posted_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq(
      "status",
      "running",
    ).lt("locked_at", staleCutoff),
    supabase.from("x_deliveries").select("id", { count: "exact", head: true })
      .in("status", ["pending", "posting"]).lt(
        "created_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      ),
  ]);
  const postsQuery = checkedMonitoringQuery(
    postsRes,
    "monitoring_overview_posts",
  );
  const deliveriesQuery = checkedMonitoringQuery(
    deliveriesRes,
    "monitoring_overview_deliveries",
  );
  const xDeliveriesQuery = checkedMonitoringQuery(
    xDeliveriesRes,
    "monitoring_overview_x_deliveries",
  );
  const staleJobsQuery = checkedMonitoringQuery(
    staleJobs,
    "monitoring_overview_stale_jobs",
  );
  const staleXPendingQuery = checkedMonitoringQuery(
    staleXPending,
    "monitoring_overview_stale_x_pending",
  );
  const posts = checkedMonitoringRows(
    postsQuery.data,
    "monitoring_overview_posts",
  );
  const deliveries = checkedMonitoringRows(
    deliveriesQuery.data,
    "monitoring_overview_deliveries",
  );
  const xDeliveries = checkedMonitoringRows(
    xDeliveriesQuery.data,
    "monitoring_overview_x_deliveries",
  );
  const staleJobsCount = checkedMonitoringCount(
    staleJobsQuery.count,
    "monitoring_overview_stale_jobs",
  );
  const staleXPendingCount = checkedMonitoringCount(
    staleXPendingQuery.count,
    "monitoring_overview_stale_x_pending",
  );
  const jobStateByTweet = await loadJobStateMap(supabase);
  const deliveryByTweet = new Map<string, Record<string, unknown>>();
  for (const row of deliveries) {
    const subjectId = row.subject_id;
    if (typeof subjectId === "string" && subjectId && !deliveryByTweet.has(subjectId)) {
      deliveryByTweet.set(subjectId, {
        delivery_status: row.status,
        posted_at: row.posted_at,
        delivery_error: row.last_error,
      });
    }
  }
  const xByTweet = new Map<string, Record<string, unknown>>();
  for (const row of xDeliveries) {
    const postId = row.post_id;
    if (typeof postId === "string" && postId && !xByTweet.has(postId)) {
      xByTweet.set(postId, {
        x_status: row.status,
        x_tweet_id: row.x_tweet_id,
        x_posted_at: row.posted_at,
        x_error: row.last_error,
        x_skip_reason: row.skip_reason,
      });
    }
  }

  const counts = {
    needs_attention: 0,
    failed_stuck: 0,
    translation_queue: 0,
    needs_score: 0,
    ready_to_deliver: 0,
    manual_review: 0,
    duplicates: 0,
    coverage_gap: 0,
    possible_duplicate: 0,
    duplicate_anomalies: 0,
    hydration: 0,
    x_pending: 0,
    x_failed: 0,
    delivered_24h: 0,
    telegram_pending: 0,
    below_threshold: 0,
    v2_regional_auto: 0,
    global_pilot_review: 0,
    manual_scoring_feedback: 0,
    stale_jobs: staleJobsCount,
    stale_x_pending_24h: staleXPendingCount,
  };

  for (const post of posts) {
    const tid = post.tweet_id as string;
    const rpc = {
      ...(deliveryByTweet.get(tid) ?? {}),
      ...(xByTweet.get(tid) ?? {}),
      translated_at: post.translated_at,
      is_truncated: post.is_truncated,
      hydrated_at: post.hydrated_at,
    };
    const state = deriveMonitoringState(
      post,
      applyJobStateToRpc(tid, rpc, jobStateByTweet),
      threshold,
    );
    if (state.needs_attention) counts.needs_attention += 1;
    if (state.code === "failed_stuck") counts.failed_stuck += 1;
    if (
      state.translation_state === "queued" ||
      state.translation_state === "needs_translation"
    ) counts.translation_queue += 1;
    if (state.code === "needs_score") counts.needs_score += 1;
    if (state.code === "ready_to_deliver") counts.ready_to_deliver += 1;
    if (state.code === "manual_review") counts.manual_review += 1;
    if (state.code === "blocked_duplicate") counts.duplicates += 1;
    if (state.code === "duplicate_coverage_gap") counts.coverage_gap += 1;
    if (
      state.code === "duplicate_coverage_gap" ||
      post.dedupe_status === "uncertain"
    ) counts.possible_duplicate += 1;
    if (
      typeof post.dup_of_tweet_id === "string" &&
      xByTweet.get(tid)?.x_status === "posted" &&
      xByTweet.get(post.dup_of_tweet_id)?.x_status === "posted"
    ) {
      counts.duplicate_anomalies += 1;
    }
    if (state.code === "hydration") counts.hydration += 1;
    if (state.code === "x_pending") counts.x_pending += 1;
    if (state.x_state === "failed") counts.x_failed += 1;
    if (state.code === "telegram_pending") counts.telegram_pending += 1;
    if (state.code === "below_threshold") counts.below_threshold += 1;
    if (matchesMonitoringScoringV2Filter(post, "v2_regional_auto")) {
      counts.v2_regional_auto += 1;
    }
    if (matchesMonitoringScoringV2Filter(post, "global_pilot_review")) {
      counts.global_pilot_review += 1;
    }
    if (isManualScoringFeedbackEntry(post)) counts.manual_scoring_feedback += 1;
  }

  for (const row of xDeliveries) {
    if (row.status === "posted" && row.posted_at && row.posted_at >= since) {
      counts.delivered_24h += 1;
    }
  }
  counts.needs_attention += counts.stale_jobs;

  return {
    success: true,
    overview: {
      window_hours: windowHours,
      threshold,
      counts,
    },
  };
}
