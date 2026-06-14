import { assertEquals } from "jsr:@std/assert";
import {
  buildTranslationCallOptions,
  renderTranslationUserPrompt,
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
