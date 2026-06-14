import { assert, assertEquals } from "jsr:@std/assert";
import { computeFinalScore } from "../_shared/scoring.ts";
import {
  buildClassifierToolFunction,
  buildScoringBaseDecisionState,
  parseClassifierToolCallArguments,
  renderScoringSystemPrompt,
  renderScoringUserMessage,
  resolveActiveFeedbackThreshold,
  resolveScoringCallOptions,
  SCORING_AXES_SCHEMA,
} from "./scoringWorkflow.ts";

function toolParts(tool: Record<string, unknown>) {
  const parameters = tool.parameters as Record<string, unknown>;
  return {
    parameters,
    properties: parameters.properties as Record<string, unknown>,
    required: parameters.required as string[],
  };
}

Deno.test("buildClassifierToolFunction builds fallback schema with translated text", () => {
  const tool = buildClassifierToolFunction(null, true);
  const { properties, required } = toolParts(tool);

  assertEquals(tool.name, "classify_importance");
  assertEquals(properties.translated_text, {
    type: "string",
    description: "The Persian translation of the original text",
  });
  assertEquals(properties.axes, SCORING_AXES_SCHEMA);
  assertEquals(required, [
    "translated_text",
    "importance_score",
    "axes",
    "tags",
    "reasoning",
  ]);
});

Deno.test("buildClassifierToolFunction strips translated text for split scoring calls", () => {
  const tool = buildClassifierToolFunction(null, false);
  const { properties, required } = toolParts(tool);

  assertEquals(properties.translated_text, undefined);
  assertEquals(properties.axes, SCORING_AXES_SCHEMA);
  assertEquals(required, ["importance_score", "axes", "tags", "reasoning"]);
});

Deno.test("buildClassifierToolFunction injects axes into custom schemas before stripping translated text", () => {
  const tool = buildClassifierToolFunction(
    JSON.stringify({
      name: "custom_classifier",
      parameters: {
        type: "object",
        properties: {
          translated_text: { type: "string" },
          importance_score: { type: "number" },
        },
        required: ["importance_score", "translated_text"],
      },
    }),
    false,
  );
  const { properties, required } = toolParts(tool);

  assertEquals(tool.name, "custom_classifier");
  assertEquals(properties.translated_text, undefined);
  assertEquals(properties.axes, SCORING_AXES_SCHEMA);
  assertEquals(required, ["importance_score", "axes"]);
});

Deno.test("buildClassifierToolFunction falls back when custom schema is invalid JSON", () => {
  const tool = buildClassifierToolFunction("{bad-json", false);
  const { properties, required } = toolParts(tool);

  assertEquals(tool.name, "classify_importance");
  assertEquals(properties.translated_text, undefined);
  assertEquals(properties.axes, SCORING_AXES_SCHEMA);
  assertEquals(required, ["importance_score", "axes", "tags", "reasoning"]);
});

Deno.test("renderScoringSystemPrompt renders fallback rubric placeholders", () => {
  const prompt = renderScoringSystemPrompt({
    translationPrompt: "Translate into Persian.",
    priorityTopics: ["Hormuz", "nuclear"],
    lowPriorityTopics: [],
    editorialGuidelines: "Boost official escalation signals.",
  });

  assert(prompt.includes("## Task 1: Translation\nTranslate into Persian."));
  assert(prompt.includes("High-priority (boost 1-2): Hormuz, nuclear"));
  assert(prompt.includes("Low-priority (reduce 1-2): none specified"));
  assert(prompt.includes("Boost official escalation signals."));
  assert(!prompt.includes("{translation_prompt}"));
  assert(!prompt.includes("{priority_topics}"));
  assert(!prompt.includes("{low_priority_topics}"));
  assert(!prompt.includes("{editorial_guidelines_block}"));
});

Deno.test("renderScoringSystemPrompt preserves custom prompt replacement behavior", () => {
  const prompt = renderScoringSystemPrompt({
    scoringSystemPrompt:
      "T={translation_prompt}; high={priority_topics}; low={low_priority_topics}; guide={editorial_guidelines_block}",
    translationPrompt: "Translate.",
    priorityTopics: [],
    lowPriorityTopics: ["sports"],
    editorialGuidelines: "",
  });

  assertEquals(
    prompt,
    "T=Translate.; high=none specified; low=sports; guide=",
  );
});

Deno.test("renderScoringUserMessage keeps worker scoring prompt shape", () => {
  assertEquals(
    renderScoringUserMessage({
      textOriginal: "Original content",
      authorDisplay: "source",
      accountName: "Source Name",
      publishedAt: "2026-01-01T00:00:00.000Z",
      hasMedia: true,
      url: "https://x.com/source/status/123",
    }),
    `Author: @source (Source Name)
Published: 2026-01-01T00:00:00.000Z
Has media: yes
URL: https://x.com/source/status/123

Content:
Original content`,
  );
});

Deno.test("renderScoringUserMessage uses N/A for missing URL and omits empty account name", () => {
  assertEquals(
    renderScoringUserMessage({
      textOriginal: "Original content",
      authorDisplay: "source",
      accountName: "",
      publishedAt: "unknown",
      hasMedia: false,
      url: null,
    }),
    `Author: @source
Published: unknown
Has media: no
URL: N/A

Content:
Original content`,
  );
});

Deno.test("parseClassifierToolCallArguments preserves legacy score clamping and tags", () => {
  assertEquals(
    parseClassifierToolCallArguments(
      JSON.stringify({
        importance_score: 25,
        tags: ["iran", "military"],
        reasoning: "direct high-impact signal",
      }),
    ),
    {
      importanceScore: 20,
      importanceTags: ["iran", "military"],
      importanceReasoning: "direct high-impact signal",
      scoreAxes: null,
    },
  );

  assertEquals(
    parseClassifierToolCallArguments(JSON.stringify({ importance_score: -3 })),
    {
      importanceScore: 1,
      importanceTags: [],
      importanceReasoning: null,
      scoreAxes: null,
    },
  );
});

Deno.test("parseClassifierToolCallArguments derives score from axes when missing", () => {
  const axes = {
    iran_relevance: 9,
    severity: 8,
    novelty: 7,
    credibility: 6,
    actionability: 5,
    noise: 2,
  };

  assertEquals(
    parseClassifierToolCallArguments(JSON.stringify({ axes })),
    {
      importanceScore: Math.round(computeFinalScore(axes)),
      importanceTags: [],
      importanceReasoning: null,
      scoreAxes: axes,
    },
  );
});

Deno.test("parseClassifierToolCallArguments returns translated text for combined calls", () => {
  assertEquals(
    parseClassifierToolCallArguments(
      JSON.stringify({
        translated_text: "متن فارسی",
        importance_score: 16,
        tags: ["diplomacy"],
        reasoning: "direct diplomacy",
      }),
      { includeTranslatedText: true },
    ),
    {
      translatedText: "متن فارسی",
      importanceScore: 16,
      importanceTags: ["diplomacy"],
      importanceReasoning: "direct diplomacy",
      scoreAxes: null,
    },
  );
});

Deno.test("resolveScoringCallOptions falls back to translation model settings", () => {
  assertEquals(
    resolveScoringCallOptions({
      openaiModel: "gpt-main",
      openaiTemperature: 0.2,
      openaiMaxCompletionTokens: 1200,
      openaiTopP: 0.9,
      openaiReasoningEffort: "low",
      openaiVerbosity: "medium",
      openaiSeed: 44,
      openaiServiceTier: "default",
      openaiParallelToolCalls: false,
    }),
    {
      model: "gpt-main",
      temperature: 0.2,
      maxOutputTokens: 1200,
      topP: 0.9,
      reasoningEffort: "low",
      verbosity: "medium",
      seed: 44,
      serviceTier: "default",
      parallelToolCalls: false,
    },
  );
});

Deno.test("resolveScoringCallOptions prefers scoring-specific settings", () => {
  assertEquals(
    resolveScoringCallOptions({
      openaiModel: "gpt-main",
      openaiTemperature: 0.2,
      openaiMaxCompletionTokens: 1200,
      openaiTopP: 0.9,
      openaiReasoningEffort: "low",
      openaiVerbosity: "medium",
      openaiSeed: 44,
      openaiServiceTier: "default",
      openaiParallelToolCalls: false,
      scoringModel: "gpt-score",
      scoringTemperature: 0,
      scoringMaxCompletionTokens: 600,
      scoringTopP: 0.7,
      scoringReasoningEffort: "minimal",
      scoringVerbosity: "low",
      scoringSeed: 12,
      scoringServiceTier: "auto",
      scoringParallelToolCalls: true,
    }),
    {
      model: "gpt-score",
      temperature: 0,
      maxOutputTokens: 600,
      topP: 0.7,
      reasoningEffort: "minimal",
      verbosity: "low",
      seed: 12,
      serviceTier: "auto",
      parallelToolCalls: true,
    },
  );
});

Deno.test("resolveActiveFeedbackThreshold prefers profile then custom author threshold then default", () => {
  assertEquals(
    resolveActiveFeedbackThreshold({
      editorialProfileThreshold: 14,
      authorHandle: "source",
      authorRules: { source: { rule: "custom_threshold", threshold: 9 } },
      defaultThreshold: 12,
    }),
    14,
  );

  assertEquals(
    resolveActiveFeedbackThreshold({
      editorialProfileThreshold: null,
      authorHandle: "source",
      authorRules: { source: { rule: "custom_threshold", threshold: 9 } },
      defaultThreshold: 12,
    }),
    9,
  );

  assertEquals(
    resolveActiveFeedbackThreshold({
      editorialProfileThreshold: null,
      authorHandle: "source",
      authorRules: { source: { rule: "always_deliver" } },
      defaultThreshold: 12,
    }),
    12,
  );
});

Deno.test("buildScoringBaseDecisionState preserves feedback-locked decisions", () => {
  const result = buildScoringBaseDecisionState({
    feedbackLocked: true,
    postFinalScore: "bad",
    postDeliveryDecision: "skip",
    postDecisionReason: "manual_skip",
    importanceScore: 13,
    importanceTags: ["manual"],
    importanceReasoning: "locked",
    scoreAxes: null,
    scoringPolicyActive: false,
    scoringPolicyResult: null,
    filterEnabled: true,
    legacyFilterEnabled: true,
    scoreOnly: false,
    editorialProfile: null,
    authorHandle: "source",
    authorRules: {},
    defaultThreshold: 12,
    textOriginal: "Original",
  });

  assertEquals(result, {
    decisionState: {
      deliveryDecision: "skip",
      decisionReason: "manual_skip",
      finalScore: 13,
    },
    scoringFields: {
      importanceScore: 13,
      importanceTags: ["manual"],
      importanceReasoning: "locked",
      scoreAxes: null,
    },
    logEvent: null,
  });
});

Deno.test("buildScoringBaseDecisionState applies scoring policy active fields", () => {
  const scoringPolicyResult = {
    final_score: 17.4,
    delivery_decision: "deliver",
    decision_reason: "direct_focus:17.4>=14",
    tags: ["direct_focus"],
    audience_reason: "direct audience fit",
    axes: { focus_relevance: 9, geopolitical_weight: 8 },
    audience_class: "direct_focus",
    profile_id: "iran-first",
  };

  const result = buildScoringBaseDecisionState({
    feedbackLocked: false,
    postFinalScore: null,
    postDeliveryDecision: null,
    postDecisionReason: null,
    importanceScore: 10,
    importanceTags: ["legacy"],
    importanceReasoning: "legacy",
    scoreAxes: null,
    scoringPolicyActive: true,
    scoringPolicyResult: scoringPolicyResult as never,
    filterEnabled: true,
    legacyFilterEnabled: false,
    scoreOnly: false,
    editorialProfile: null,
    authorHandle: "source",
    authorRules: {},
    defaultThreshold: 12,
    textOriginal: "Original",
  });

  assertEquals(result.decisionState, {
    deliveryDecision: "deliver",
    decisionReason: "direct_focus:17.4>=14",
    finalScore: 17.4,
  });
  assertEquals(result.scoringFields, {
    importanceScore: 17,
    importanceTags: ["direct_focus"],
    importanceReasoning: "direct audience fit",
    scoreAxes: scoringPolicyResult.axes as never,
  });
  assertEquals(result.logEvent, {
    kind: "v2",
    decision: "deliver",
    finalScore: 17.4,
    audienceClass: "direct_focus",
    profileId: "iran-first",
    reason: "direct_focus:17.4>=14",
  });
});

Deno.test("buildScoringBaseDecisionState applies legacy author threshold rules", () => {
  const custom = buildScoringBaseDecisionState({
    feedbackLocked: false,
    postFinalScore: null,
    postDeliveryDecision: null,
    postDecisionReason: null,
    importanceScore: 10,
    importanceTags: null,
    importanceReasoning: null,
    scoreAxes: null,
    scoringPolicyActive: false,
    scoringPolicyResult: null,
    filterEnabled: true,
    legacyFilterEnabled: true,
    scoreOnly: false,
    editorialProfile: null,
    authorHandle: "source",
    authorRules: { source: { rule: "custom_threshold", threshold: 11 } },
    defaultThreshold: 12,
    textOriginal: "Original",
  });

  assertEquals(custom.decisionState, {
    deliveryDecision: "skip",
    decisionReason: "below_threshold:10<11",
    finalScore: 10,
  });
  assertEquals(custom.logEvent, {
    kind: "legacy_threshold",
    decision: "skip",
    score: 10,
    threshold: 12,
    authorHandle: "source",
    reason: "below_threshold:10<11",
  });

  const forced = buildScoringBaseDecisionState({
    feedbackLocked: false,
    postFinalScore: null,
    postDeliveryDecision: null,
    postDecisionReason: null,
    importanceScore: 1,
    importanceTags: null,
    importanceReasoning: null,
    scoreAxes: null,
    scoringPolicyActive: false,
    scoringPolicyResult: null,
    filterEnabled: true,
    legacyFilterEnabled: true,
    scoreOnly: false,
    editorialProfile: null,
    authorHandle: "source",
    authorRules: { source: { rule: "always_deliver" } },
    defaultThreshold: 12,
    textOriginal: "Original",
  });

  assertEquals(forced.decisionState, {
    deliveryDecision: "deliver",
    decisionReason: "author_rule:always_deliver:source",
    finalScore: 1,
  });
});

Deno.test("buildScoringBaseDecisionState records score-only and disabled filter reasons", () => {
  const scoreOnly = buildScoringBaseDecisionState({
    feedbackLocked: false,
    postFinalScore: null,
    postDeliveryDecision: null,
    postDecisionReason: null,
    importanceScore: 8,
    importanceTags: null,
    importanceReasoning: null,
    scoreAxes: null,
    scoringPolicyActive: false,
    scoringPolicyResult: null,
    filterEnabled: true,
    legacyFilterEnabled: true,
    scoreOnly: true,
    editorialProfile: null,
    authorHandle: null,
    authorRules: {},
    defaultThreshold: 12,
    textOriginal: "Original",
  });
  assertEquals(scoreOnly.decisionState, {
    deliveryDecision: "deliver",
    decisionReason: "score_only_mode",
    finalScore: 8,
  });

  const disabled = buildScoringBaseDecisionState({
    feedbackLocked: false,
    postFinalScore: null,
    postDeliveryDecision: null,
    postDecisionReason: null,
    importanceScore: null,
    importanceTags: null,
    importanceReasoning: null,
    scoreAxes: null,
    scoringPolicyActive: false,
    scoringPolicyResult: null,
    filterEnabled: false,
    legacyFilterEnabled: false,
    scoreOnly: false,
    editorialProfile: null,
    authorHandle: null,
    authorRules: {},
    defaultThreshold: 12,
    textOriginal: "Original",
  });
  assertEquals(disabled.decisionState, {
    deliveryDecision: "deliver",
    decisionReason: "filter_disabled",
    finalScore: null,
  });
});
