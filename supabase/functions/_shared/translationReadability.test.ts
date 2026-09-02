import { assert, assertEquals } from "jsr:@std/assert";
import type { NormalizedOpenAIResponse, OpenAICallParams } from "./openai.ts";
import {
  analyzeTranslationReadability,
  repairTranslationReadability,
  translationReadabilityMeta,
} from "./translationReadability.ts";

function openAiResponse(content: string): NormalizedOpenAIResponse {
  return {
    ok: true,
    status: 200,
    rawText: "{}",
    raw: { usage: { total_tokens: 11 } },
    content,
    toolCall: null,
    webSearchResults: [],
    outputItems: [],
    usage: { total_tokens: 11 },
    endpoint: "responses",
  };
}

Deno.test("analyzeTranslationReadability flags raw English spans and Latin starts", () => {
  const analysis = analyzeTranslationReadability(
    "The Michael Knowles Show درباره مذاکرات ایران حرف زد",
  );

  assertEquals(analysis.ok, false);
  assert(
    analysis.issues.some((issue) => issue.code === "starts_latin"),
  );
  assert(
    analysis.issues.some((issue) => issue.code === "raw_english_span"),
  );
  assert(
    analysis.issues.some((issue) => issue.code === "missing_final_punctuation"),
  );
});

Deno.test("analyzeTranslationReadability allows concise native Persian", () => {
  const analysis = analyzeTranslationReadability(
    "ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران درباره توافق همچنان ادامه دارد.",
  );

  assertEquals(analysis.ok, true);
  assertEquals(analysis.issues, []);
});

Deno.test("repairTranslationReadability retries once and accepts improved Persian", async () => {
  const calls: OpenAICallParams[] = [];
  const result = await repairTranslationReadability({
    apiKey: "key",
    model: "gpt-5.4-mini",
    originalText:
      "J.D. Vance said on The Michael Knowles Show that technical talks continue.",
    translatedText:
      "The Michael Knowles Show برنامه‌ای بود که جی‌دی ونس در آن گفت مذاکرات فنی بین آمریکا و ایران ادامه دارد",
    maxOutputTokens: 2000,
    callOpenAI: async (request) => {
      calls.push(request);
      return openAiResponse(
        "جی‌دی ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران همچنان ادامه دارد.",
      );
    },
  });

  assertEquals(calls.length, 1);
  assertEquals(result.repairStatus, "accepted");
  assertEquals(result.acceptedRepair, true);
  assertEquals(
    result.text,
    "جی‌دی ونس در برنامه «مایکل نولز شو» گفت گفت‌وگوهای فنی آمریکا و ایران همچنان ادامه دارد.",
  );
  assertEquals(translationReadabilityMeta(result).repair_status, "accepted");
});

Deno.test("repairTranslationReadability preserves original text when repair fails", async () => {
  const result = await repairTranslationReadability({
    apiKey: "key",
    model: "gpt-5.4-mini",
    originalText: "Source",
    translatedText: "The Michael Knowles Show درباره ایران",
    callOpenAI: async () => ({
      ...openAiResponse(""),
      ok: false,
      status: 429,
      rawText: "rate limited",
    }),
  });

  assertEquals(result.repairStatus, "failed");
  assertEquals(result.text, "The Michael Knowles Show درباره ایران");
  assertEquals(result.repairError, "translation_readability_openai_http_429");
});

Deno.test("repairTranslationReadability redacts thrown provider messages", async () => {
  const result = await repairTranslationReadability({
    apiKey: "key",
    model: "gpt-5.4-mini",
    originalText: "Source",
    translatedText: "The Michael Knowles Show درباره ایران",
    callOpenAI: async () => {
      throw new Error("SECRET provider response");
    },
  });

  assertEquals(result.repairStatus, "failed");
  assertEquals(result.repairError, "translation_readability_openai_request_failed");
});
