import { assert, assertEquals } from "jsr:@std/assert";
import { computeFinalScore } from "../_shared/scoring.ts";
import {
  buildClassifierToolFunction,
  parseClassifierToolCallArguments,
  renderScoringSystemPrompt,
  renderScoringUserMessage,
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
