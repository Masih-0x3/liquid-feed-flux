import {
  type AudienceClass,
  buildScoringPolicyEventMeta,
  normalizeScoringPolicy,
  runScoringPolicy,
  SCORING_POLICY_VERSION,
  type ScoringPolicy,
  type ScoringPolicyCalibrationExample,
  type ScoringPolicyResult,
} from "../_shared/scoringPolicy.ts";
import { loadActiveThreshold } from "./activeThreshold.ts";
import type { RecordFeedbackFn, SupabaseAdminClient } from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  insert(value: Record<string, unknown>): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  is(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  not(column: string, operator: string, value: unknown): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
};

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

export type RunTranslationOnlyFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<
  { ok: boolean; translated?: string; model?: string; error?: string }
>;

export type QueueManualAdvanceFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<{ queued: string; reason?: string }>;

export type ScoringActionDeps = {
  recordFeedback: RecordFeedbackFn;
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  runTranslationOnly: RunTranslationOnlyFn;
  queueManualAdvance: QueueManualAdvanceFn;
  runScoringPolicy?: typeof runScoringPolicy;
  getOpenAiApiKey?: () => string | undefined;
  now?: () => Date;
};

const SCORING_FEEDBACK_REASON_TAGS = new Set([
  "regional_escalation",
  "oil_shipping",
  "leader_statement",
  "global_mega_event",
  "direct_focus",
  "adjacent_context",
  "should_skip",
  "wrong_class",
  "duplicate",
  "stale",
  "source_trust",
  "broad_global",
  "other",
]);

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function nowIso(deps?: Pick<ScoringActionDeps, "now">): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function openAiApiKey(
  deps?: Pick<ScoringActionDeps, "getOpenAiApiKey">,
): string {
  return deps?.getOpenAiApiKey?.() ?? Deno.env.get("OPENAI_API_KEY") ?? "";
}

function checkedSettingValue(
  data: unknown,
  error: unknown,
  failureCode: string,
): Record<string, unknown> | null {
  if (error) throw new Error(failureCode);
  if (data === null || data === undefined) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(failureCode);
  }
  const value = (data as Record<string, unknown>).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(failureCode);
  }
  return value as Record<string, unknown>;
}

export function normalizeScoringFeedbackReasonTag(
  body: Record<string, unknown>,
): string {
  const tag = typeof body.reason_tag === "string"
    ? body.reason_tag.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(
      0,
      80,
    )
    : "";
  return SCORING_FEEDBACK_REASON_TAGS.has(tag) ? tag : "";
}

export function isAudienceClass(value: unknown): value is AudienceClass {
  return value === "direct_focus" || value === "adjacent" ||
    value === "global_exception" ||
    value === "off_topic";
}

export async function loadScoringPolicyConfig(
  supabase: SupabaseAdminClient,
): Promise<ScoringPolicy> {
  const { data, error } = await table(supabase, "settings").select("value").eq(
    "key",
    "scoring_policy",
  ).maybeSingle();
  return normalizeScoringPolicy(
    checkedSettingValue(data, error, "scoring_policy_settings_read_failed"),
  );
}

export async function loadScoringModelOptions(supabase: SupabaseAdminClient) {
  const { data, error } = await table(supabase, "settings").select("value").eq(
    "key",
    "translation_prompt",
  ).maybeSingle();
  const tp = checkedSettingValue(
    data,
    error,
    "scoring_model_settings_read_failed",
  ) ?? {};
  const scoring = tp.scoring && typeof tp.scoring === "object"
    ? tp.scoring as Record<string, unknown>
    : {};
  return {
    model: typeof scoring.model === "string" && scoring.model.trim()
      ? scoring.model
      : "gpt-5.4-mini",
    maxOutputTokens: typeof scoring.max_completion_tokens === "number"
      ? scoring.max_completion_tokens
      : 4000,
    temperature: typeof scoring.temperature === "number"
      ? scoring.temperature
      : null,
    topP: typeof scoring.top_p === "number" ? scoring.top_p : null,
    reasoningEffort: typeof scoring.reasoning_effort === "string"
      ? scoring.reasoning_effort
      : "high",
    verbosity: typeof scoring.verbosity === "string"
      ? scoring.verbosity
      : "low",
    seed: typeof scoring.seed === "number" ? scoring.seed : null,
    serviceTier: typeof scoring.service_tier === "string"
      ? scoring.service_tier
      : "auto",
    parallelToolCalls: typeof scoring.parallel_tool_calls === "boolean"
      ? scoring.parallel_tool_calls
      : true,
  };
}

export async function loadScoringCalibrationExamples(
  supabase: SupabaseAdminClient,
  profileId: string,
): Promise<ScoringPolicyCalibrationExample[]> {
  try {
    const { data, error } = await table(supabase, "scoring_examples")
      .select(
        "text_original, author_handle, expected_audience_class, expected_decision, expected_score, expected_global_exception_class, note",
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    return (Array.isArray(data)
      ? data
      : []) as ScoringPolicyCalibrationExample[];
  } catch {
    throw new Error("scoring_calibration_read_failed");
  }
}

export function scoringPolicyPostUpdate(
  result: ScoringPolicyResult,
  active: boolean,
): Record<string, unknown> {
  const scoringV2Meta = buildScoringPolicyEventMeta(
    result,
    active ? "active" : "shadow",
  );
  const shadowUpdate = {
    scoring_version: SCORING_POLICY_VERSION,
    scoring_profile_id: result.profile_id,
    audience_class: result.audience_class,
    audience_confidence: result.audience_confidence,
    audience_reason: result.audience_reason,
    global_exception_class: result.global_exception_class,
    score_review_status: active ? result.review_status : "shadow",
  };
  if (!active) return shadowUpdate;

  return {
    ...shadowUpdate,
    score_axes: result.axes,
    importance_score: Math.round(result.final_score),
    importance_tags: result.tags,
    importance_reasoning: result.audience_reason,
    base_score: result.final_score,
    learned_score: result.final_score,
    learned_delta: 0,
    x_gate_score: result.final_score,
    learning_confidence: null,
    score_breakdown: {
      ai: result.uncapped_score,
      base: result.final_score,
      learned_delta: 0,
      learned: result.final_score,
      final: result.final_score,
      x_gate_score: result.final_score,
      x_gate: result.final_score,
      scoring_v2: {
        ...scoringV2Meta,
      },
    },
    final_score: result.final_score,
    delivery_decision: result.delivery_decision,
    decision_reason: result.decision_reason,
  };
}

export async function promoteFeedbackToScoringExample(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  userId?: string,
) {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  const expectedClass = body.expected_class ?? body.expected_audience_class;
  const expectedDecision = typeof body.expected_decision === "string"
    ? body.expected_decision
    : "";
  if (!tweetId) return { ok: false, error: "tweet_id is required" };
  if (!isAudienceClass(expectedClass)) {
    return {
      ok: false,
      error:
        "expected_class must be direct_focus|adjacent|global_exception|off_topic",
    };
  }
  if (!["deliver", "skip", "review"].includes(expectedDecision)) {
    return {
      ok: false,
      error: "expected_decision must be deliver|skip|review",
    };
  }

  const policy = await loadScoringPolicyConfig(supabase);
  const profileId = typeof body.profile_id === "string"
    ? body.profile_id
    : policy.active_profile_id;
  const { data: post, error } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, author_handle, final_score, global_exception_class",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: "scoring_example_post_read_failed" };
  if (
    !post || typeof post !== "object" ||
    !(post as Record<string, unknown>).text_original
  ) {
    return { ok: false, error: `Post not found or empty: ${tweetId}` };
  }
  const postRow = post as Record<string, unknown>;

  const { data, error: insertError } = await table(supabase, "scoring_examples")
    .insert({
      tweet_id: tweetId,
      source: typeof body.source === "string" ? body.source : "admin_feedback",
      profile_id: profileId,
      text_original: postRow.text_original,
      author_handle: postRow.author_handle,
      expected_audience_class: expectedClass,
      expected_decision: expectedDecision,
      expected_score: typeof body.expected_score === "number"
        ? body.expected_score
        : postRow.final_score,
      expected_global_exception_class:
        typeof body.expected_global_exception_class === "string"
          ? body.expected_global_exception_class
          : postRow.global_exception_class,
      note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
      created_by: userId ?? null,
    }).select("id").single();
  if (insertError) return { ok: false, error: "scoring_example_insert_failed" };
  return {
    ok: true,
    example_id: (data as { id?: unknown } | null | undefined)?.id,
  };
}

export async function setManualScore(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ScoringActionDeps,
) {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  const score = Number(body.score);
  const reason = typeof body.reason === "string"
    ? body.reason.trim().slice(0, 500)
    : "";
  const reasonTag = normalizeScoringFeedbackReasonTag(body);
  const overrideDuplicate = body.override_duplicate === true;
  const expectedAudienceClass = isAudienceClass(body.expected_audience_class)
    ? body.expected_audience_class
    : null;
  if (!tweetId) return { ok: false, error: "tweet_id is required" };
  if (!Number.isInteger(score) || score < 1 || score > 20) {
    return {
      ok: false,
      error: "score must be a whole number between 1 and 20",
    };
  }
  if (!reasonTag) {
    return {
      ok: false,
      error: "reason_tag is required for manual score feedback",
    };
  }

  const threshold = await loadActiveThreshold(supabase);
  const { data: post, error: postReadError } = await table(supabase, "posts")
    .select(
      "tweet_id, final_score, importance_score, dup_of_tweet_id, score_breakdown, text_translated, translated_at",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (postReadError) {
    return { ok: false, error: "manual_score_post_read_failed" };
  }
  if (!post || typeof post !== "object") {
    return { ok: false, error: `Post not found: ${tweetId}` };
  }
  const postRow = post as Record<string, unknown>;

  const oldScore = typeof postRow.final_score === "number"
    ? postRow.final_score
    : (typeof postRow.importance_score === "number"
      ? postRow.importance_score
      : null);
  const passes = score >= threshold;
  const relatedTweetId = typeof postRow.dup_of_tweet_id === "string"
    ? postRow.dup_of_tweet_id
    : null;
  const duplicateBlocks = !!relatedTweetId && !overrideDuplicate;
  const decision = passes && !duplicateBlocks ? "deliver" : "skip";
  const decisionReason = duplicateBlocks
    ? `manual_score_blocked_duplicate:${score}>=${threshold}`
    : passes
    ? `manual_score_pass:${score}>=${threshold}`
    : `manual_score_skip:${score}<${threshold}`;
  const existingBreakdown =
    postRow.score_breakdown && typeof postRow.score_breakdown === "object"
      ? postRow.score_breakdown as Record<string, unknown>
      : {};
  const updatePayload: Record<string, unknown> = {
    final_score: score,
    base_score: score,
    learned_score: score,
    learned_delta: 0,
    x_gate_score: score,
    learning_confidence: {
      source: "manual_score",
      feedback_locked: true,
    },
    importance_score: score,
    delivery_decision: decision,
    decision_reason: decisionReason,
    feedback_locked: true,
    score_breakdown: {
      ...existingBreakdown,
      manual: score,
      base: score,
      learned_delta: 0,
      learned: score,
      final: score,
      x_gate_score: score,
      x_gate: score,
    },
    ...(expectedAudienceClass
      ? {
        audience_class: expectedAudienceClass,
        audience_confidence: 1,
        audience_reason: reason || "manual_score_audience_class",
        score_review_status: "approved",
      }
      : {}),
  };
  if (overrideDuplicate && relatedTweetId) {
    updatePayload.dup_of_tweet_id = null;
    updatePayload.dup_similarity = null;
    updatePayload.dedupe_status = "unique";
    updatePayload.dedupe_method = "none";
    updatePayload.dedupe_confidence = null;
    updatePayload.dedupe_reason = "manual_score_override";
    updatePayload.dedupe_new_facts = [];
    updatePayload.dedupe_checked_at = nowIso(deps);
  }

  const { error: upErr } = await table(supabase, "posts").update(updatePayload)
    .eq("tweet_id", tweetId);
  if (upErr) return { ok: false, error: "manual_score_post_update_failed" };

  if (overrideDuplicate && relatedTweetId) {
    const pairA = tweetId < relatedTweetId ? tweetId : relatedTweetId;
    const pairB = tweetId < relatedTweetId ? relatedTweetId : tweetId;
    const { error: blocklistError } = await table(supabase, "story_pair_blocklist").upsert(
      { tweet_a: pairA, tweet_b: pairB, reason: "manual_score_override" },
      { onConflict: "tweet_a,tweet_b" },
    );
    if (blocklistError) {
      return {
        ok: false,
        tweet_id: tweetId,
        score,
        threshold,
        decision,
        partial_update: true,
        error: "manual_score_blocklist_write_failed",
      };
    }
    try {
      await deps.recordFeedback(supabase, tweetId, "not_duplicate", -2, {
        source: "manual_score",
      }, relatedTweetId);
    } catch {
      return {
        ok: false,
        tweet_id: tweetId,
        score,
        threshold,
        decision,
        partial_update: true,
        error: "manual_score_duplicate_feedback_failed",
      };
    }
  }

  const polarity = oldScore == null
    ? (passes ? 2 : -2)
    : score > oldScore + 0.5
    ? 2
    : score < oldScore - 0.5
    ? -2
    : 0;
  try {
    await deps.recordFeedback(supabase, tweetId, "manual_score", polarity, {
      old_score: oldScore,
      manual_score: score,
      threshold,
      reason_tag: reasonTag,
      reason,
      override_duplicate: overrideDuplicate,
      decision,
      expected_audience_class: expectedAudienceClass,
    });
  } catch {
    return {
      ok: false,
      tweet_id: tweetId,
      score,
      threshold,
      decision,
      partial_update: true,
      error: "manual_score_feedback_write_failed",
    };
  }
  if (expectedAudienceClass) {
    try {
      await promoteFeedbackToScoringExample(supabase, {
        tweet_id: tweetId,
        expected_class: expectedAudienceClass,
        expected_decision: passes ? "deliver" : "skip",
        expected_score: score,
        note: [reasonTag, reason].filter(Boolean).join(": ") ||
          "Manual score label",
        source: "manual_score",
      });
    } catch {
      return {
        ok: false,
        tweet_id: tweetId,
        score,
        threshold,
        decision,
        partial_update: true,
        error: "manual_score_example_write_failed",
      };
    }
  }
  await deps.insertAdminPipelineEvent(supabase, tweetId, "score", "completed", {
    mode: "manual_score",
    manual_score: score,
    threshold,
    decision,
    reason_tag: reasonTag,
    reason,
  });

  let translation: { ok: boolean; error?: string } | null = null;
  let advance: { queued: string; reason?: string } | null = null;
  if (passes && !duplicateBlocks) {
    if (!postRow.text_translated && !postRow.translated_at) {
      translation = await deps.runTranslationOnly(supabase, tweetId);
      if (!translation.ok) {
        return {
          ok: true,
          tweet_id: tweetId,
          score,
          threshold,
          decision,
          decision_reason: decisionReason,
          advanced: false,
          translation_error: translation.error,
        };
      }
    }
    advance = await deps.queueManualAdvance(supabase, tweetId);
  }

  return {
    ok: true,
    tweet_id: tweetId,
    score,
    threshold,
    decision,
    decision_reason: decisionReason,
    duplicate_blocked: duplicateBlocks,
    translated: translation?.ok ?? false,
    advance,
  };
}

export async function recordScoreFeedback(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<ScoringActionDeps, "recordFeedback" | "insertAdminPipelineEvent">,
) {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  const feedback = typeof body.feedback === "string" ? body.feedback : "";
  const reasonTag = normalizeScoringFeedbackReasonTag(body);
  const reason = typeof body.reason === "string"
    ? body.reason.trim().slice(0, 500)
    : "";
  const map: Record<string, { action: string; polarity: number }> = {
    too_low: { action: "score_too_low", polarity: 2 },
    too_high: { action: "score_too_high", polarity: -2 },
    correct_deliver: { action: "correct_deliver", polarity: 1 },
    correct_skip: { action: "correct_skip", polarity: -1 },
    should_pass_audience: { action: "should_pass_audience", polarity: 2 },
    should_skip: { action: "should_skip_audience", polarity: -2 },
    wrong_relevance_class: { action: "wrong_relevance_class", polarity: 0 },
    global_exception_worth_covering: {
      action: "global_exception_worth_covering",
      polarity: 2,
    },
    not_global_exception: { action: "not_global_exception", polarity: -1 },
  };
  if (!tweetId) return { ok: false, error: "tweet_id is required" };
  const item = map[feedback];
  if (!item) {
    return {
      ok: false,
      error: "feedback must be a supported score feedback action",
    };
  }
  if (!reasonTag) {
    return { ok: false, error: "reason_tag is required for score feedback" };
  }

  await deps.recordFeedback(supabase, tweetId, item.action, item.polarity, {
    feedback,
    reason_tag: reasonTag,
    reason,
  });
  const reviewPatch: Record<string, unknown> = { feedback_locked: true };
  if (
    ["correct_skip", "should_skip", "not_global_exception"].includes(feedback)
  ) {
    reviewPatch.score_review_status = "rejected";
    reviewPatch.delivery_decision = "skip";
    reviewPatch.decision_reason = `score_feedback_skip:${feedback}`;
  } else {
    reviewPatch.score_review_status = "approved";
  }
  const { error: reviewUpdateError } = await table(supabase, "posts").update(reviewPatch).eq("tweet_id", tweetId);
  if (reviewUpdateError) throw new Error("score_feedback_post_update_failed");

  const expectedClass = isAudienceClass(body.expected_audience_class)
    ? body.expected_audience_class
    : null;
  if (
    expectedClass || feedback === "should_pass_audience" ||
    feedback === "should_skip" ||
    feedback === "global_exception_worth_covering" ||
    feedback === "not_global_exception"
  ) {
    const inferredClass: AudienceClass = expectedClass ??
      (feedback === "global_exception_worth_covering"
        ? "global_exception"
        : feedback === "not_global_exception"
        ? "off_topic"
        : "direct_focus");
    const expectedDecision =
      feedback === "should_skip" || feedback === "not_global_exception"
        ? "skip"
        : "deliver";
    try {
      await promoteFeedbackToScoringExample(supabase, {
        tweet_id: tweetId,
        expected_class: inferredClass,
        expected_decision: expectedDecision,
        note: [reasonTag, reason || feedback].filter(Boolean).join(": "),
        source: "score_feedback",
      });
    } catch {
      return {
        ok: false,
        tweet_id: tweetId,
        feedback,
        partial_update: true,
        error: "score_feedback_example_write_failed",
      };
    }
  }
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "score_feedback",
    "completed",
    {
      feedback,
      polarity: item.polarity,
      reason_tag: reasonTag,
      reason,
    },
  );
  return {
    ok: true,
    tweet_id: tweetId,
    feedback,
    polarity: item.polarity,
    reason_tag: reasonTag,
  };
}

export async function scorePostV2(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<
    ScoringActionDeps,
    "insertAdminPipelineEvent" | "runScoringPolicy" | "getOpenAiApiKey"
  >,
) {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (!tweetId) return { ok: false, error: "tweet_id is required" };
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const policy = await loadScoringPolicyConfig(supabase);
  if (!policy.enabled && !force) {
    return {
      ok: false,
      error: "scoring_policy is disabled; pass force=true for an explicit run",
    };
  }

  const { data: post, error } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, author_handle, url, tweeted_at, accounts!inner(handle, display_name)",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: "scoring_post_read_failed" };
  if (
    !post || typeof post !== "object" ||
    !(post as Record<string, unknown>).text_original
  ) {
    return { ok: false, error: `Post not found or empty: ${tweetId}` };
  }
  const postRow = post as Record<string, unknown>;

  const apiKey = openAiApiKey(deps);
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured" };
  const model = await loadScoringModelOptions(supabase);
  const account = postRow.accounts as Record<string, unknown> | null;
  const profileId = typeof body.profile_id === "string"
    ? body.profile_id
    : null;
  const calibrationExamples = await loadScoringCalibrationExamples(
    supabase,
    profileId ?? policy.active_profile_id,
  );
  const runPolicy = deps.runScoringPolicy ?? runScoringPolicy;
  const result = await runPolicy(
    {
      tweet_id: tweetId,
      text: postRow.text_original as string,
      author_handle: postRow.author_handle as string | undefined,
      account_name: account?.display_name as string | undefined,
      url: postRow.url as string | undefined,
      published_at: postRow.tweeted_at as string | undefined,
    },
    policy,
    { apiKey, ...model },
    {
      profileId,
      forceAdjudication: body.force_adjudication === true,
      calibrationExamples,
    },
  );
  if (!result.ok) {
    return { ok: false, error: "scoring_policy_failed" };
  }

  const active = policy.mode === "active";
  if (!dryRun) {
    const { error: updateError } = await table(supabase, "posts")
      .update(scoringPolicyPostUpdate(result, active))
      .eq("tweet_id", tweetId);
    if (updateError) return { ok: false, error: "scoring_post_update_failed" };
    await deps.insertAdminPipelineEvent(
      supabase,
      tweetId,
      "score",
      "completed",
      buildScoringPolicyEventMeta(result, active ? "active" : "shadow"),
    );
  }

  return { ok: true, dry_run: dryRun, active, result };
}

export async function previewScoringPolicy(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<ScoringActionDeps, "runScoringPolicy" | "getOpenAiApiKey" | "now">,
) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "text is required" };
  if (text.length > 8000) {
    return { ok: false, error: "text must be <=8000 characters" };
  }
  const apiKey = openAiApiKey(deps);
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured" };
  const policy = await loadScoringPolicyConfig(supabase);
  const model = await loadScoringModelOptions(supabase);
  const profileId = typeof body.profile_id === "string"
    ? body.profile_id
    : null;
  const calibrationExamples = await loadScoringCalibrationExamples(
    supabase,
    profileId ?? policy.active_profile_id,
  );
  const runPolicy = deps.runScoringPolicy ?? runScoringPolicy;
  const result = await runPolicy(
    {
      text,
      author_handle: typeof body.author_handle === "string"
        ? body.author_handle
        : null,
      url: typeof body.url === "string" ? body.url : null,
      published_at: nowIso(deps),
    },
    policy,
    { apiKey, ...model },
    {
      profileId,
      forceAdjudication: body.force_adjudication === true,
      calibrationExamples,
    },
  );
  return { ok: result.ok, result, error: result.ok ? undefined : result.error };
}

export async function backfillScoreV2(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<ScoringActionDeps, "now"> = {},
) {
  const hours =
    typeof body.hours === "number" && body.hours > 0 && body.hours <= 720
      ? Math.floor(body.hours)
      : 48;
  const max = typeof body.max === "number" && body.max > 0
    ? Math.min(Math.floor(body.max), 500)
    : 100;
  const dryRun = body.dry_run !== false;
  const force = body.force === true;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  let query = table(supabase, "posts")
    .select("tweet_id, scoring_version")
    .not("text_original", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(max);
  if (!force) query = query.is("scoring_version", null);
  const { data, error } = await query;
  if (error) return { ok: false, error: "scoring_backfill_read_failed" };
  if (!Array.isArray(data)) {
    return { ok: false, error: "scoring_backfill_invalid_response" };
  }
  const posts: Array<Record<string, unknown>> = [];
  for (const post of data) {
    if (!post || typeof post !== "object" || Array.isArray(post)) {
      return { ok: false, error: "scoring_backfill_invalid_row" };
    }
    const tweetId = (post as Record<string, unknown>).tweet_id;
    if (typeof tweetId !== "string" || tweetId.trim().length === 0) {
      return { ok: false, error: "scoring_backfill_invalid_row" };
    }
    posts.push(post as Record<string, unknown>);
  }
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      matched: posts.length,
      queued: 0,
      hours,
      max,
    };
  }

  let queued = 0;
  const stamp = now.getTime();
  for (const post of posts) {
    const tweetId = post.tweet_id as string;
    const { error: jobError } = await table(supabase, "jobs").upsert({
      type: "translate",
      payload: {
        tweet_id: tweetId,
        force_rescore: true,
        scoring_policy_v2: true,
      },
      status: "pending",
      priority: 9,
      idempotency_key: `score-v2:${tweetId}:${stamp}`,
      next_run_at: (deps.now?.() ?? new Date()).toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (jobError) {
      return {
        ok: false,
        dry_run: false,
        matched: posts.length,
        queued,
        hours,
        max,
        error: "scoring_backfill_enqueue_failed",
      };
    }
    queued += 1;
  }
  return {
    ok: true,
    dry_run: false,
    matched: posts.length,
    queued,
    hours,
    max,
  };
}

export async function runScoringEval(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<ScoringActionDeps, "runScoringPolicy" | "getOpenAiApiKey" | "now">,
) {
  const policy = await loadScoringPolicyConfig(supabase);
  const profileId = typeof body.profile_id === "string"
    ? body.profile_id
    : policy.active_profile_id;
  const limit = typeof body.limit === "number"
    ? Math.min(Math.max(Math.floor(body.limit), 1), 30)
    : 10;
  let query = table(supabase, "scoring_examples")
    .select(
      "id, text_original, author_handle, expected_audience_class, expected_decision",
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (Array.isArray(body.case_ids) && body.case_ids.length > 0) {
    query = query.in("id", body.case_ids.slice(0, limit));
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: "scoring_eval_read_failed" };
  if (!Array.isArray(data)) {
    return { ok: false, error: "scoring_eval_invalid_response" };
  }
  const examples: Array<Record<string, unknown>> = [];
  for (const example of data) {
    if (!example || typeof example !== "object" || Array.isArray(example)) {
      return { ok: false, error: "scoring_eval_invalid_row" };
    }
    const id = (example as Record<string, unknown>).id;
    const text = (example as Record<string, unknown>).text_original;
    if (typeof id !== "string" || id.trim().length === 0 ||
      typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, error: "scoring_eval_invalid_row" };
    }
    examples.push(example as Record<string, unknown>);
  }
  const apiKey = openAiApiKey(deps);
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured" };
  const model = await loadScoringModelOptions(supabase);
  const runPolicy = deps.runScoringPolicy ?? runScoringPolicy;
  const rows = [];
  let correct = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let ambiguous = 0;
  for (const example of examples) {
    const calibrationExamples = examples
      .filter((candidate) => candidate.id !== example.id)
      .slice(0, 8) as unknown as ScoringPolicyCalibrationExample[];
    const result = await runPolicy(
      {
        text: example.text_original as string,
        author_handle: example.author_handle as string | null,
        published_at: nowIso(deps),
      },
      policy,
      { apiKey, ...model },
      { profileId, calibrationExamples },
    );
    const expectedDecision = example.expected_decision as string;
    const expectedClass = example.expected_audience_class as string;
    const classOk = result.audience_class === expectedClass;
    const decisionOk = expectedDecision === "review"
      ? result.review_status === "needs_review"
      : result.delivery_decision === expectedDecision;
    if (classOk && decisionOk) correct += 1;
    if (expectedDecision === "skip" && result.delivery_decision === "deliver") {
      falsePositive += 1;
    }
    if (expectedDecision === "deliver" && result.delivery_decision === "skip") {
      falseNegative += 1;
    }
    if (result.review_status === "needs_review") ambiguous += 1;
    rows.push({
      example_id: example.id,
      expected_class: expectedClass,
      expected_decision: expectedDecision,
      audience_class: result.audience_class,
      decision: result.delivery_decision,
      score: result.final_score,
      threshold: result.threshold,
      ok: classOk && decisionOk,
    });
  }
  const count = rows.length;
  const summary = {
    profile_id: profileId,
    accuracy: count > 0 ? Math.round((correct / count) * 1000) / 10 : null,
    correct,
    false_positive_count: falsePositive,
    false_negative_count: falseNegative,
    ambiguous_count: ambiguous,
  };
  const { data: inserted, error: insertError } = await table(
    supabase,
    "scoring_evaluations",
  ).insert({
    profile_id: profileId,
    scoring_version: SCORING_POLICY_VERSION,
    model: model.model,
    example_count: count,
    accuracy: summary.accuracy,
    false_positive_count: falsePositive,
    false_negative_count: falseNegative,
    ambiguous_count: ambiguous,
    summary,
    results: rows,
  }).select("id").single();
  if (insertError) {
    return {
      ok: false,
      error: "scoring_eval_insert_failed",
      summary,
      results: rows,
    };
  }
  return {
    ok: true,
    evaluation_id: (inserted as { id?: unknown } | null | undefined)?.id,
    summary,
    results: rows,
  };
}
