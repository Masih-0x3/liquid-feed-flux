import { assertEquals } from "jsr:@std/assert";
import {
  buildTranslationCallOptions,
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
