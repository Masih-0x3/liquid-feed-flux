import { assertEquals } from "jsr:@std/assert";
import {
  buildPostTranslationUpdatePatch,
  buildTranslationCallOptions,
  buildTranslationResultMeta,
  choosePostTranslationRoute,
  renderTranslationUserPrompt,
  shouldQueueHydrationAfterTranslation,
} from "./translateWorkflow.ts";

Deno.test("renderTranslationUserPrompt replaces all supported placeholders", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template:
        "{content}|{author}|{author_handle}|{author_name}|{published_at}|{published_date}",
      content: "Original content",
      authorDisplay: "source",
      accountName: "Source Name",
      publishedAt: "2026-01-01T00:00:00.000Z",
    }),
    "Original content|@source|@source|Source Name|2026-01-01T00:00:00.000Z|2026-01-01T00:00:00.000Z",
  );
});

Deno.test("renderTranslationUserPrompt falls back to source content when template is empty", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template: "   ",
      content: "Original content",
      authorDisplay: "source",
      accountName: "Source Name",
      publishedAt: "2026-01-01T00:00:00.000Z",
    }),
    "Original content",
  );
});

Deno.test("renderTranslationUserPrompt uses an empty author name when missing", () => {
  assertEquals(
    renderTranslationUserPrompt({
      template: "{author_name}:{content}",
      content: "Original content",
      authorDisplay: "source",
      accountName: null,
      publishedAt: "unknown",
    }),
    ":Original content",
  );
});

Deno.test("buildTranslationCallOptions returns the translation-only OpenAI request shape", () => {
  assertEquals(
    buildTranslationCallOptions({
      translationPrompt: "Translate to Persian.",
      openaiModel: "gpt-main",
      openaiMaxCompletionTokens: 2000,
      openaiTemperature: 0.2,
      openaiTopP: 0.9,
      openaiFrequencyPenalty: 0.1,
      openaiPresencePenalty: 0.2,
      openaiReasoningEffort: "low",
      openaiVerbosity: "medium",
      openaiSeed: 42,
      openaiServiceTier: "default",
      openaiParallelToolCalls: false,
    }, "Original content"),
    {
      model: "gpt-main",
      messages: [
        { role: "system", content: "Translate to Persian." },
        { role: "user", content: "Original content" },
      ],
      maxOutputTokens: 2000,
      temperature: 0.2,
      topP: 0.9,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      reasoningEffort: "low",
      verbosity: "medium",
      seed: 42,
      serviceTier: "default",
      parallelToolCalls: false,
    },
  );
});

Deno.test("buildTranslationCallOptions preserves nullable optional OpenAI settings", () => {
  assertEquals(
    buildTranslationCallOptions({
      translationPrompt: "Translate.",
      openaiModel: "gpt-main",
      openaiTopP: null,
      openaiFrequencyPenalty: null,
      openaiPresencePenalty: null,
      openaiReasoningEffort: null,
      openaiVerbosity: null,
      openaiSeed: null,
      openaiServiceTier: null,
      openaiParallelToolCalls: null,
    }, "Original content"),
    {
      model: "gpt-main",
      messages: [
        { role: "system", content: "Translate." },
        { role: "user", content: "Original content" },
      ],
      maxOutputTokens: undefined,
      temperature: undefined,
      topP: null,
      frequencyPenalty: null,
      presencePenalty: null,
      reasoningEffort: null,
      verbosity: null,
      seed: null,
      serviceTier: null,
      parallelToolCalls: null,
    },
  );
});

Deno.test("buildTranslationResultMeta preserves worker job result metadata", () => {
  assertEquals(
    buildTranslationResultMeta({
      model: "gpt-translation",
      scoringModel: "gpt-scoring",
      usage: { total_tokens: 30 },
      scoringUsage: { total_tokens: 10 },
      translationUsage: { total_tokens: 20 },
      scoringV2Usage: { total_tokens: 5 },
      scoringCallMs: 111,
      translationCallMs: 222,
      queueWaitMs: 333,
      claimDelayMs: 444,
      finishedAt: "2026-01-01T00:00:00.000Z",
      importanceScore: 16,
      scoringVersion: "scoring-v2",
      splitCalls: true,
    }),
    {
      model: "gpt-translation",
      scoring_model: "gpt-scoring",
      usage: { total_tokens: 30 },
      scoring_usage: { total_tokens: 10 },
      translation_usage: { total_tokens: 20 },
      scoring_v2_usage: { total_tokens: 5 },
      scoring_call_ms: 111,
      translation_call_ms: 222,
      queue_wait_ms: 333,
      claim_delay_ms: 444,
      finished_at: "2026-01-01T00:00:00.000Z",
      importance_score: 16,
      scoring_version: "scoring-v2",
      split_calls: true,
    },
  );
});

Deno.test("buildPostTranslationUpdatePatch preserves translation and scoring fields", () => {
  assertEquals(
    buildPostTranslationUpdatePatch({
      translationSkippedByFilter: false,
      translatedText: "Translated text",
      nowIso: "2026-01-01T00:00:00.000Z",
      openaiModel: "gpt-translation",
      translationTokens: 44,
      translationDurationMs: 555,
      importanceScore: 17,
      importanceTags: ["direct_focus"],
      importanceReasoning: "important",
      deliveryDecision: "deliver",
      scoreAxes: { iran_relevance: 10, severity: 7 },
      finalScore: 17.2,
      decisionReason: "direct_focus:17.2>=14",
      scoreBreakdown: { feedback_delta: 0.2 },
      scoringPolicy: {
        scoringVersion: "scoring-v2",
        scoringProfileId: "iran-first",
        audienceClass: "direct_focus",
        audienceConfidence: 0.91,
        audienceReason: "direct audience fit",
        globalExceptionClass: null,
        scoreReviewStatus: "approved",
      },
    }),
    {
      text_translated: "Translated text",
      lang_original: "en",
      translated_at: "2026-01-01T00:00:00.000Z",
      translation_model: "gpt-translation",
      translation_tokens: 44,
      translation_duration_ms: 555,
      importance_score: 17,
      importance_tags: ["direct_focus"],
      importance_reasoning: "important",
      delivery_decision: "deliver",
      score_axes: { iran_relevance: 10, severity: 7 },
      final_score: 17.2,
      decision_reason: "direct_focus:17.2>=14",
      score_breakdown: { feedback_delta: 0.2 },
      scoring_version: "scoring-v2",
      scoring_profile_id: "iran-first",
      audience_class: "direct_focus",
      audience_confidence: 0.91,
      audience_reason: "direct audience fit",
      global_exception_class: null,
      score_review_status: "approved",
    },
  );
});

Deno.test("buildPostTranslationUpdatePatch omits translation fields when skipped by filter", () => {
  assertEquals(
    buildPostTranslationUpdatePatch({
      translationSkippedByFilter: true,
      translatedText: null,
      nowIso: "2026-01-01T00:00:00.000Z",
      openaiModel: "gpt-translation",
      translationTokens: null,
      translationDurationMs: null,
      importanceScore: 8,
      importanceTags: null,
      importanceReasoning: null,
      deliveryDecision: "skip",
      scoreAxes: null,
      finalScore: 8,
      decisionReason: "below_threshold:8<12",
      scoreBreakdown: null,
      scoringPolicy: null,
    }),
    {
      importance_score: 8,
      importance_tags: null,
      importance_reasoning: null,
      delivery_decision: "skip",
      score_axes: null,
      final_score: 8,
      decision_reason: "below_threshold:8<12",
      score_breakdown: null,
    },
  );
});

Deno.test("shouldQueueHydrationAfterTranslation gates only deliverable unhydrated truncated posts", () => {
  assertEquals(
    shouldQueueHydrationAfterTranslation({
      deliveryDecision: "deliver",
      isTruncated: true,
      alreadyHydrated: false,
      hydrationEnabled: true,
    }),
    true,
  );
  assertEquals(
    shouldQueueHydrationAfterTranslation({
      deliveryDecision: "skip",
      isTruncated: true,
      alreadyHydrated: false,
      hydrationEnabled: true,
    }),
    false,
  );
  assertEquals(
    shouldQueueHydrationAfterTranslation({
      deliveryDecision: "deliver",
      isTruncated: true,
      alreadyHydrated: true,
      hydrationEnabled: true,
    }),
    false,
  );
  assertEquals(
    shouldQueueHydrationAfterTranslation({
      deliveryDecision: "deliver",
      isTruncated: true,
      alreadyHydrated: false,
      hydrationEnabled: false,
    }),
    false,
  );
});

Deno.test("choosePostTranslationRoute returns hydrate job for gated truncated posts", () => {
  assertEquals(
    choosePostTranslationRoute({
      tweetId: "123",
      deliveryDecision: "deliver",
      decisionReason: "score_pass",
      importanceScore: 15,
      isTruncated: true,
      alreadyHydrated: false,
      hydrationEnabled: true,
      autoEnrichEnabled: true,
      duplicateBlocked: false,
    }),
    {
      kind: "hydrate",
      logAction: "hydration_gated_enqueue",
      job: {
        type: "hydrate_tweet",
        payload: { tweet_id: "123" },
        status: "pending",
        priority: 15,
        idempotency_key: "hydrate:post-translate:123",
      },
      event: {
        step: "hydrate",
        status: "queued",
        meta: { source: "post-score-gate", score: 15 },
      },
    },
  );
});

Deno.test("choosePostTranslationRoute returns enrich and delivery route when enrichment is automatic", () => {
  assertEquals(
    choosePostTranslationRoute({
      tweetId: "123",
      deliveryDecision: "deliver",
      decisionReason: "score_pass",
      importanceScore: 15,
      isTruncated: false,
      alreadyHydrated: false,
      hydrationEnabled: true,
      autoEnrichEnabled: true,
      duplicateBlocked: false,
    }),
    {
      kind: "enrich_and_deliver",
      logAction: "enrich_enqueued",
      enrichJob: {
        type: "enrich",
        payload: { tweet_id: "123" },
        status: "pending",
        priority: 18,
        idempotency_key: "enrich:123",
      },
      enrichEvent: {
        step: "enrich",
        status: "queued",
        meta: { source: "translate" },
      },
      delivery: { source: "translate", resetExisting: false },
    },
  );
});

Deno.test("choosePostTranslationRoute returns plain delivery route when enrichment is not automatic", () => {
  assertEquals(
    choosePostTranslationRoute({
      tweetId: "123",
      deliveryDecision: "deliver",
      decisionReason: "score_pass",
      importanceScore: 15,
      isTruncated: false,
      alreadyHydrated: false,
      hydrationEnabled: true,
      autoEnrichEnabled: false,
      duplicateBlocked: false,
    }),
    {
      kind: "deliver",
      delivery: { source: "worker", resetExisting: true },
    },
  );
});

Deno.test("choosePostTranslationRoute preserves duplicate and content-filter skip metadata", () => {
  assertEquals(
    choosePostTranslationRoute({
      tweetId: "123",
      deliveryDecision: "skip",
      decisionReason: "duplicate_story",
      importanceScore: 15,
      isTruncated: false,
      alreadyHydrated: false,
      hydrationEnabled: true,
      autoEnrichEnabled: false,
      duplicateBlocked: true,
    }),
    {
      kind: "skip",
      event: {
        step: "deliver",
        status: "completed",
        meta: {
          skipped: "duplicate_gate",
          score: 15,
          decision: "skip",
          decision_reason: "duplicate_story",
        },
      },
    },
  );

  assertEquals(
    choosePostTranslationRoute({
      tweetId: "123",
      deliveryDecision: "skip",
      decisionReason: "below_threshold:8<12",
      importanceScore: 8,
      isTruncated: false,
      alreadyHydrated: false,
      hydrationEnabled: true,
      autoEnrichEnabled: false,
      duplicateBlocked: false,
    }),
    {
      kind: "skip",
      event: {
        step: "deliver",
        status: "completed",
        meta: {
          skipped: "content_filter",
          score: 8,
          decision: "skip",
          decision_reason: "below_threshold:8<12",
        },
      },
    },
  );
});
