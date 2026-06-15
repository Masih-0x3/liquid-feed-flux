import type { ChatMessage } from "../_shared/openai.ts";

type TranslationUserPromptInput = {
  template?: string | null;
  content: string;
  authorDisplay: string;
  accountName?: string | null;
  publishedAt: string;
};

type TranslationCallConfig = {
  translationPrompt: string;
  openaiModel: string;
  openaiMaxCompletionTokens?: number | null;
  openaiTemperature?: number | null;
  openaiTopP?: number | null;
  openaiFrequencyPenalty?: number | null;
  openaiPresencePenalty?: number | null;
  openaiReasoningEffort?: string | null;
  openaiVerbosity?: string | null;
  openaiSeed?: number | null;
  openaiServiceTier?: string | null;
  openaiParallelToolCalls?: boolean | null;
};

type TranslationCallOptions = {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  seed?: number | null;
  serviceTier?: string | null;
  parallelToolCalls?: boolean | null;
};

type PostTranslationRouteInput = {
  tweetId: string;
  deliveryDecision: string;
  decisionReason: string | null;
  importanceScore: number | null;
  isTruncated: boolean;
  alreadyHydrated: boolean;
  hydrationEnabled: boolean;
  autoEnrichEnabled: boolean;
  duplicateBlocked: boolean;
};

type TranslationResultMetaInput = {
  model: string;
  scoringModel: string;
  usage: unknown;
  scoringUsage: Record<string, unknown> | null;
  translationUsage: Record<string, unknown> | null;
  scoringV2Usage: unknown;
  scoringCallMs: number | null;
  translationCallMs: number | null;
  queueWaitMs: unknown;
  claimDelayMs: unknown;
  finishedAt: string;
  importanceScore: number | null;
  scoringVersion: string | null;
  splitCalls: boolean;
};

type ScoringPolicyUpdateFields = {
  scoringVersion: string;
  scoringProfileId: string;
  audienceClass: string;
  audienceConfidence: number;
  audienceReason: string;
  globalExceptionClass: string | null;
  scoreReviewStatus: string;
};

type PostTranslationUpdatePatchInput = {
  translationSkippedByFilter: boolean;
  translatedText: string | null;
  nowIso: string;
  openaiModel: string;
  translationTokens: number | null;
  translationDurationMs: number | null;
  importanceScore: number | null;
  importanceTags: string[] | null;
  importanceReasoning: string | null;
  deliveryDecision: string;
  scoreAxes: unknown;
  finalScore: number | null;
  decisionReason: string | null;
  scoreBreakdown: Record<string, unknown> | null;
  scoringPolicy: ScoringPolicyUpdateFields | null;
};

type PostTranslationRoute =
  | {
    kind: "hydrate";
    logAction: "hydration_gated_enqueue";
    job: {
      type: "hydrate_tweet";
      payload: { tweet_id: string };
      status: "pending";
      priority: 15;
      idempotency_key: string;
    };
    event: {
      step: "hydrate";
      status: "queued";
      meta: { source: "post-score-gate"; score: number | null };
    };
  }
  | {
    kind: "enrich_and_deliver";
    logAction: "enrich_enqueued";
    enrichJob: {
      type: "enrich";
      payload: { tweet_id: string };
      status: "pending";
      priority: 18;
      idempotency_key: string;
    };
    enrichEvent: {
      step: "enrich";
      status: "queued";
      meta: { source: "translate" };
    };
    delivery: { source: "translate"; resetExisting: false };
  }
  | {
    kind: "deliver";
    delivery: { source: "worker"; resetExisting: true };
  }
  | {
    kind: "skip";
    event: {
      step: "deliver";
      status: "completed";
      meta: {
        skipped: "duplicate_gate" | "content_filter";
        score: number | null;
        decision: string;
        decision_reason: string | null;
      };
    };
  };

export function renderTranslationUserPrompt(
  input: TranslationUserPromptInput,
): string {
  const template = input.template;
  if (template && template.trim()) {
    return template
      .replace(/\{content\}/g, input.content)
      .replace(/\{author\}/g, `@${input.authorDisplay}`)
      .replace(/\{author_handle\}/g, `@${input.authorDisplay}`)
      .replace(/\{author_name\}/g, input.accountName ?? "")
      .replace(/\{published_at\}/g, input.publishedAt)
      .replace(/\{published_date\}/g, input.publishedAt);
  }

  return input.content;
}

export function buildTranslationCallOptions(
  config: TranslationCallConfig,
  userPrompt: string,
): TranslationCallOptions {
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: config.translationPrompt },
      { role: "user", content: userPrompt },
    ],
    maxOutputTokens: config.openaiMaxCompletionTokens,
    temperature: config.openaiTemperature,
    topP: config.openaiTopP,
    frequencyPenalty: config.openaiFrequencyPenalty,
    presencePenalty: config.openaiPresencePenalty,
    reasoningEffort: config.openaiReasoningEffort,
    verbosity: config.openaiVerbosity,
    seed: config.openaiSeed,
    serviceTier: config.openaiServiceTier,
    parallelToolCalls: config.openaiParallelToolCalls,
  };
}

export function buildTranslationResultMeta(
  input: TranslationResultMetaInput,
): Record<string, unknown> {
  return {
    model: input.model,
    scoring_model: input.scoringModel,
    usage: input.usage,
    scoring_usage: input.scoringUsage,
    translation_usage: input.translationUsage,
    scoring_v2_usage: input.scoringV2Usage,
    scoring_call_ms: input.scoringCallMs,
    translation_call_ms: input.translationCallMs,
    queue_wait_ms: input.queueWaitMs,
    claim_delay_ms: input.claimDelayMs,
    finished_at: input.finishedAt,
    importance_score: input.importanceScore,
    scoring_version: input.scoringVersion,
    split_calls: input.splitCalls,
  };
}

export function buildPostTranslationUpdatePatch(
  input: PostTranslationUpdatePatchInput,
): Record<string, unknown> {
  return {
    ...(input.translationSkippedByFilter ? {} : {
      text_translated: input.translatedText,
      lang_original: "en",
      translated_at: input.nowIso,
      translation_model: input.openaiModel,
      translation_tokens: input.translationTokens,
      translation_duration_ms: input.translationDurationMs,
    }),
    importance_score: input.importanceScore,
    importance_tags: input.importanceTags,
    importance_reasoning: input.importanceReasoning,
    delivery_decision: input.deliveryDecision,
    score_axes: input.scoreAxes ?? null,
    final_score: input.finalScore,
    decision_reason: input.decisionReason,
    score_breakdown: input.scoreBreakdown,
    ...(input.scoringPolicy
      ? {
        scoring_version: input.scoringPolicy.scoringVersion,
        scoring_profile_id: input.scoringPolicy.scoringProfileId,
        audience_class: input.scoringPolicy.audienceClass,
        audience_confidence: input.scoringPolicy.audienceConfidence,
        audience_reason: input.scoringPolicy.audienceReason,
        global_exception_class: input.scoringPolicy.globalExceptionClass,
        score_review_status: input.scoringPolicy.scoreReviewStatus,
      }
      : {}),
  };
}

export function shouldQueueHydrationAfterTranslation(
  input: Pick<
    PostTranslationRouteInput,
    "deliveryDecision" | "isTruncated" | "alreadyHydrated" | "hydrationEnabled"
  >,
): boolean {
  return input.deliveryDecision === "deliver" && input.isTruncated &&
    !input.alreadyHydrated && input.hydrationEnabled;
}

export function choosePostTranslationRoute(
  input: PostTranslationRouteInput,
): PostTranslationRoute {
  if (shouldQueueHydrationAfterTranslation(input)) {
    return {
      kind: "hydrate",
      logAction: "hydration_gated_enqueue",
      job: {
        type: "hydrate_tweet",
        payload: { tweet_id: input.tweetId },
        status: "pending",
        priority: 15,
        idempotency_key: `hydrate:post-translate:${input.tweetId}`,
      },
      event: {
        step: "hydrate",
        status: "queued",
        meta: { source: "post-score-gate", score: input.importanceScore },
      },
    };
  }

  if (input.deliveryDecision === "deliver" && input.autoEnrichEnabled) {
    return {
      kind: "enrich_and_deliver",
      logAction: "enrich_enqueued",
      enrichJob: {
        type: "enrich",
        payload: { tweet_id: input.tweetId },
        status: "pending",
        priority: 18,
        idempotency_key: `enrich:${input.tweetId}`,
      },
      enrichEvent: {
        step: "enrich",
        status: "queued",
        meta: { source: "translate" },
      },
      delivery: { source: "translate", resetExisting: false },
    };
  }

  if (input.deliveryDecision === "deliver") {
    return {
      kind: "deliver",
      delivery: { source: "worker", resetExisting: true },
    };
  }

  return {
    kind: "skip",
    event: {
      step: "deliver",
      status: "completed",
      meta: {
        skipped: input.duplicateBlocked ? "duplicate_gate" : "content_filter",
        score: input.importanceScore,
        decision: input.deliveryDecision,
        decision_reason: input.decisionReason,
      },
    },
  };
}
