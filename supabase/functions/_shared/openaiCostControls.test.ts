import { assertEquals } from "jsr:@std/assert";
import {
  clampOpenAiMaxCompletionTokens,
  OPENAI_MAX_COMPLETION_TOKENS_LIMIT,
  validateOpenAiMaxCompletionTokens,
} from "./openaiCostControls.ts";

Deno.test("OpenAI max completion token clamp bounds live settings", () => {
  assertEquals(
    clampOpenAiMaxCompletionTokens(50_000, 2_000),
    OPENAI_MAX_COMPLETION_TOKENS_LIMIT,
  );
  assertEquals(clampOpenAiMaxCompletionTokens(1_500.4, 2_000), 1_500);
  assertEquals(clampOpenAiMaxCompletionTokens(Number.NaN, 2_000), 2_000);
});

Deno.test("OpenAI max completion token validator rejects runaway caps", () => {
  assertEquals(
    validateOpenAiMaxCompletionTokens(
      "translation_prompt.max_completion_tokens",
      50_000,
    ),
    "translation_prompt.max_completion_tokens must be 1-8000",
  );
  assertEquals(
    validateOpenAiMaxCompletionTokens(
      "translation_prompt.max_completion_tokens",
      4_000,
    ),
    null,
  );
});
