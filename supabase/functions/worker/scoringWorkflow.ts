import {
  applyProfileDecision,
  computeFinalScore,
  type EditorialProfile,
  parseScoreAxes,
  type ScoreAxes,
} from "../_shared/scoring.ts";
import type { ScoringPolicyResult } from "../_shared/scoringPolicy.ts";

const SCORING_AXES_SCHEMA = {
  type: "object",
  description:
    "Six independent scoring axes (each 0-10). noise is INVERTED (high = bad).",
  properties: {
    iran_relevance: { type: "integer", minimum: 0, maximum: 10 },
    severity: { type: "integer", minimum: 0, maximum: 10 },
    novelty: { type: "integer", minimum: 0, maximum: 10 },
    credibility: { type: "integer", minimum: 0, maximum: 10 },
    actionability: { type: "integer", minimum: 0, maximum: 10 },
    noise: { type: "integer", minimum: 0, maximum: 10 },
  },
  required: [
    "iran_relevance",
    "severity",
    "novelty",
    "credibility",
    "actionability",
    "noise",
  ],
} as const;

type ScoringSystemPromptInput = {
  scoringSystemPrompt?: string | null;
  translationPrompt: string;
  priorityTopics: string[];
  lowPriorityTopics: string[];
  editorialGuidelines?: string | null;
};

type ScoringUserMessageInput = {
  textOriginal: string;
  authorDisplay: string;
  accountName?: string | null;
  publishedAt: string;
  hasMedia: boolean;
  url?: string | null;
};

type ParsedClassifierToolCall = {
  translatedText?: string;
  importanceScore: number;
  importanceTags: string[];
  importanceReasoning: string | null;
  scoreAxes: ScoreAxes | null;
};

type ScoringCallConfig = {
  scoringModel?: string | null;
  openaiModel: string;
  scoringTemperature?: number | null;
  openaiTemperature?: number | null;
  scoringMaxCompletionTokens?: number | null;
  openaiMaxCompletionTokens?: number | null;
  scoringTopP?: number | null;
  openaiTopP?: number | null;
  scoringReasoningEffort?: string | null;
  openaiReasoningEffort?: string | null;
  scoringVerbosity?: string | null;
  openaiVerbosity?: string | null;
  scoringSeed?: number | null;
  openaiSeed?: number | null;
  scoringServiceTier?: string | null;
  openaiServiceTier?: string | null;
  scoringParallelToolCalls?: boolean | null;
  openaiParallelToolCalls?: boolean | null;
};

type ScoringCallOptions = {
  model: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  topP?: number | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  seed?: number | null;
  serviceTier?: string | null;
  parallelToolCalls?: boolean | null;
};

type ScoringAuthorRule = {
  rule: string;
  threshold?: number | null;
};

type BaseScoringDecisionState = {
  deliveryDecision: string;
  decisionReason: string | null;
  finalScore: number | null;
};

type ScoringFields = {
  importanceScore: number | null;
  importanceTags: string[] | null;
  importanceReasoning: string | null;
  scoreAxes: ScoreAxes | null;
};

export type ScoringDecisionLog =
  | {
    kind: "v2";
    decision: string;
    finalScore: number;
    audienceClass: string;
    profileId: string;
    reason: string;
  }
  | {
    kind: "legacy_profile";
    decision: string;
    score: number | null;
    finalScore: number;
    profileId: string;
    authorHandle: string | null;
    reason: string;
  }
  | {
    kind: "legacy_threshold";
    decision: string;
    score: number | null;
    threshold: number;
    authorHandle: string | null;
    reason: string | null;
  };

type ScoringBaseDecisionInput = {
  feedbackLocked: boolean;
  postFinalScore: unknown;
  postDeliveryDecision: unknown;
  postDecisionReason: unknown;
  importanceScore: number | null;
  importanceTags: string[] | null;
  importanceReasoning: string | null;
  scoreAxes: ScoreAxes | null;
  scoringPolicyActive: boolean;
  scoringPolicyResult: ScoringPolicyResult | null;
  filterEnabled: boolean;
  legacyFilterEnabled: boolean;
  scoreOnly: boolean;
  editorialProfile: EditorialProfile | null;
  authorHandle: string | null;
  authorRules: Record<string, ScoringAuthorRule>;
  defaultThreshold: number;
  textOriginal: string;
};

type ScoringBaseDecisionResult = {
  decisionState: BaseScoringDecisionState;
  scoringFields: ScoringFields;
  logEvent: ScoringDecisionLog | null;
};

const FALLBACK_SCORING_RUBRIC = `You have two tasks. Complete both carefully.

## Task 1: Translation
{translation_prompt}

## Task 2: News Importance Scoring
You are an editorial assistant scoring news items for a curated Telegram channel focused on Iran and the Middle East.

### STEP A — Assign Relevance Level (state in reasoning)
- DIRECT (Iran gov/IRGC/nuclear/Hormuz/proxies/Israel-Iran/US-Iran war/sanctions on Iran): no cap.
- INDIRECT (Iran is the SUBJECT of foreign discussion): cap at 16.
- NO IRAN NEXUS (pure US/EU/China domestic): cap at 8.

### STEP B — Score 1-20 (importance_score)
- Manual calibration from production feedback: direct Iran crisis, war, diplomacy, and military-posture items should usually land in 17-19 when credible. Trump/Netanyahu/US/Pakistan leadership statements or coordination specifically about Iran are DIRECT audience-fit, not routine foreign politics. Qeshm/Hormuz, air-defense, drones, refueling tankers, US-Israel posture, IRGC/proxy threats, nuclear/escalation signals, and threats against POTUS family or senior US targets should be treated as very high impact. Pure Taiwan or unrelated domestic news with no Iran/Middle East nexus remains low.

### STEP C — Score the 6 axes (axes object), each 0-10
- iran_relevance: 8-10 if DIRECT, 4-7 if INDIRECT, 0-3 if NONE.
- severity: how big the event itself is — strike/war > policy > analysis > routine.
- novelty: breaking new info > update > recap/rehash.
- credibility: official statement > named reporter > anonymous/rumor.
- actionability: does it materially shift policy/markets/the war picture?
- noise: INVERTED — high if spam/promo/personal/sports, low for substantive news.

### Topics
High-priority (boost 1-2): {priority_topics}
Low-priority (reduce 1-2): {low_priority_topics}

{editorial_guidelines_block}

You MUST call the "classify_importance" tool with BOTH importance_score (1-20) AND axes (all 6 axes).`;

function fallbackClassifierTool(): Record<string, unknown> {
  return {
    name: "classify_importance",
    description: "Provide importance classification of this news item",
    parameters: {
      type: "object",
      properties: {
        translated_text: {
          type: "string",
          description: "The Persian translation of the original text",
        },
        importance_score: { type: "integer", minimum: 1, maximum: 20 },
        axes: SCORING_AXES_SCHEMA,
        tags: { type: "array", items: { type: "string" } },
        reasoning: {
          type: "string",
          description:
            "Required: state relevance level, tier, and any cap applied",
        },
      },
      required: [
        "translated_text",
        "importance_score",
        "axes",
        "tags",
        "reasoning",
      ],
    },
  };
}

export function buildClassifierToolFunction(
  classifierToolSchema: string | null | undefined,
  includeTranslatedText: boolean,
): Record<string, unknown> {
  let base: Record<string, unknown>;
  try {
    base = classifierToolSchema
      ? JSON.parse(classifierToolSchema)
      : fallbackClassifierTool();
  } catch (e) {
    console.warn(
      "Invalid classifier_tool_schema, using fallback:",
      (e as Error).message,
    );
    base = {
      name: "classify_importance",
      parameters: {
        type: "object",
        properties: {
          translated_text: { type: "string" },
          importance_score: { type: "integer", minimum: 1, maximum: 20 },
          axes: SCORING_AXES_SCHEMA,
          tags: { type: "array", items: { type: "string" } },
          reasoning: { type: "string" },
        },
        required: [
          "translated_text",
          "importance_score",
          "axes",
          "tags",
          "reasoning",
        ],
      },
    };
  }

  const params = base.parameters as Record<string, unknown>;
  const props = { ...(params.properties as Record<string, unknown>) };
  if (!props.axes) {
    props.axes = SCORING_AXES_SCHEMA;
    const required = Array.from(
      new Set([...((params.required as string[]) || []), "axes"]),
    );
    base = { ...base, parameters: { ...params, properties: props, required } };
  }

  if (!includeTranslatedText) {
    const p2 = base.parameters as Record<string, unknown>;
    const props2 = { ...(p2.properties as Record<string, unknown>) };
    delete props2.translated_text;
    const required = ((p2.required as string[]) || []).filter((key) =>
      key !== "translated_text"
    );
    base = { ...base, parameters: { ...p2, properties: props2, required } };
  }

  return base;
}

export function renderScoringSystemPrompt(
  input: ScoringSystemPromptInput,
): string {
  const scoringGuidelines = input.editorialGuidelines || "";
  const priorityTopics = input.priorityTopics.join(", ") || "none specified";
  const lowPriorityTopics = input.lowPriorityTopics.join(", ") ||
    "none specified";
  const guidelinesBlock = scoringGuidelines.trim()
    ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${scoringGuidelines}\n---`
    : "";

  return (input.scoringSystemPrompt ?? FALLBACK_SCORING_RUBRIC)
    .replace("{translation_prompt}", input.translationPrompt)
    .replace("{priority_topics}", priorityTopics)
    .replace("{low_priority_topics}", lowPriorityTopics)
    .replace("{editorial_guidelines_block}", guidelinesBlock);
}

export function renderScoringUserMessage(
  input: ScoringUserMessageInput,
): string {
  return `Author: @${input.authorDisplay}${
    input.accountName ? ` (${input.accountName})` : ""
  }
Published: ${input.publishedAt}
Has media: ${input.hasMedia ? "yes" : "no"}
URL: ${input.url || "N/A"}

Content:
${input.textOriginal}`;
}

export function parseClassifierToolCallArguments(
  argumentsJson: string,
  options: { includeTranslatedText?: boolean } = {},
): ParsedClassifierToolCall {
  const args = JSON.parse(argumentsJson) as Record<string, unknown>;
  const scoreAxes = parseScoreAxes(args.axes);
  let importanceScore = Math.max(
    1,
    Math.min(20, Number(args.importance_score || 10)),
  );

  if (scoreAxes && args.importance_score == null) {
    importanceScore = Math.round(computeFinalScore(scoreAxes));
  }

  const parsed: ParsedClassifierToolCall = {
    importanceScore,
    importanceTags: (args.tags || []) as string[],
    importanceReasoning: typeof args.reasoning === "string"
      ? args.reasoning
      : null,
    scoreAxes,
  };

  if (options.includeTranslatedText) {
    parsed.translatedText = (args.translated_text || "") as string;
  }

  return parsed;
}

export function resolveScoringCallOptions(
  config: ScoringCallConfig,
): ScoringCallOptions {
  return {
    model: config.scoringModel ?? config.openaiModel,
    temperature: config.scoringTemperature ?? config.openaiTemperature,
    maxOutputTokens: config.scoringMaxCompletionTokens ??
      config.openaiMaxCompletionTokens,
    topP: config.scoringTopP ?? config.openaiTopP,
    reasoningEffort: config.scoringReasoningEffort ??
      config.openaiReasoningEffort,
    verbosity: config.scoringVerbosity ?? config.openaiVerbosity,
    seed: config.scoringSeed ?? config.openaiSeed,
    serviceTier: config.scoringServiceTier ?? config.openaiServiceTier,
    parallelToolCalls: config.scoringParallelToolCalls ??
      config.openaiParallelToolCalls,
  };
}

export function resolveActiveFeedbackThreshold(input: {
  editorialProfileThreshold?: number | null;
  authorHandle?: string | null;
  authorRules: Record<string, ScoringAuthorRule>;
  defaultThreshold: number;
}): number {
  if (typeof input.editorialProfileThreshold === "number") {
    return input.editorialProfileThreshold;
  }
  const authorRule = input.authorHandle
    ? input.authorRules[input.authorHandle]
    : null;
  if (authorRule?.rule === "custom_threshold" && authorRule.threshold != null) {
    return authorRule.threshold;
  }
  return input.defaultThreshold;
}

export function buildScoringBaseDecisionState(
  input: ScoringBaseDecisionInput,
): ScoringBaseDecisionResult {
  const scoringFields: ScoringFields = {
    importanceScore: input.importanceScore,
    importanceTags: input.importanceTags,
    importanceReasoning: input.importanceReasoning,
    scoreAxes: input.scoreAxes,
  };

  if (input.feedbackLocked) {
    const lockedFinalScore = typeof input.postFinalScore === "number"
      ? input.postFinalScore
      : Number(input.postFinalScore ?? NaN) || input.importanceScore;
    return {
      decisionState: {
        deliveryDecision: input.postDeliveryDecision === "skip"
          ? "skip"
          : "deliver",
        decisionReason: typeof input.postDecisionReason === "string"
          ? input.postDecisionReason
          : "feedback_locked",
        finalScore: lockedFinalScore,
      },
      scoringFields,
      logEvent: null,
    };
  }

  let deliveryDecision = "deliver";
  let decisionReason: string | null = null;
  let finalScore: number | null =
    input.scoringPolicyActive && input.scoringPolicyResult
      ? input.scoringPolicyResult.final_score
      : input.scoreAxes
      ? computeFinalScore(input.scoreAxes)
      : input.importanceScore ?? null;
  let logEvent: ScoringDecisionLog | null = null;

  if (
    input.filterEnabled && input.scoringPolicyActive &&
    input.scoringPolicyResult && !input.scoreOnly
  ) {
    deliveryDecision = input.scoringPolicyResult.delivery_decision;
    decisionReason = input.scoringPolicyResult.decision_reason;
    finalScore = input.scoringPolicyResult.final_score;
    scoringFields.importanceScore = Math.round(
      input.scoringPolicyResult.final_score,
    );
    scoringFields.importanceTags = input.scoringPolicyResult.tags;
    scoringFields.importanceReasoning =
      input.scoringPolicyResult.audience_reason;
    scoringFields.scoreAxes = input.scoringPolicyResult.axes as ScoreAxes;
    logEvent = {
      kind: "v2",
      decision: deliveryDecision,
      finalScore,
      audienceClass: input.scoringPolicyResult.audience_class,
      profileId: input.scoringPolicyResult.profile_id,
      reason: decisionReason,
    };
  } else if (
    input.legacyFilterEnabled && input.importanceScore !== null &&
    !input.scoreOnly
  ) {
    if (input.editorialProfile) {
      const result = applyProfileDecision({
        profile: input.editorialProfile,
        axes: input.scoreAxes,
        legacyScore: input.importanceScore,
        tags: input.importanceTags ?? [],
        text: input.textOriginal,
        authorHandle: input.authorHandle,
      });
      deliveryDecision = result.decision;
      decisionReason = result.reason;
      finalScore = result.finalScore;
      logEvent = {
        kind: "legacy_profile",
        decision: deliveryDecision,
        score: input.importanceScore,
        finalScore,
        profileId: input.editorialProfile.id,
        authorHandle: input.authorHandle,
        reason: decisionReason,
      };
    } else {
      const authorRule = input.authorHandle
        ? input.authorRules[input.authorHandle]
        : null;
      if (authorRule?.rule === "always_deliver") {
        deliveryDecision = "deliver";
        decisionReason = `author_rule:always_deliver:${input.authorHandle}`;
      } else if (authorRule?.rule === "always_skip") {
        deliveryDecision = "skip";
        decisionReason = `author_rule:always_skip:${input.authorHandle}`;
      } else {
        const threshold = authorRule?.rule === "custom_threshold" &&
            authorRule.threshold != null
          ? authorRule.threshold
          : input.defaultThreshold;
        deliveryDecision = input.importanceScore >= threshold
          ? "deliver"
          : "skip";
        decisionReason = deliveryDecision === "deliver"
          ? `score_pass:${input.importanceScore}>=${threshold}`
          : `below_threshold:${input.importanceScore}<${threshold}`;
      }
      logEvent = {
        kind: "legacy_threshold",
        decision: deliveryDecision,
        score: input.importanceScore,
        threshold: input.defaultThreshold,
        authorHandle: input.authorHandle,
        reason: decisionReason,
      };
    }
  } else if (input.scoreOnly) {
    decisionReason = "score_only_mode";
  } else if (!input.legacyFilterEnabled && !input.scoringPolicyActive) {
    decisionReason = "filter_disabled";
  }

  return {
    decisionState: { deliveryDecision, decisionReason, finalScore },
    scoringFields,
    logEvent,
  };
}
