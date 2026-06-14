import {
  computeFinalScore,
  parseScoreAxes,
  type ScoreAxes,
} from "../_shared/scoring.ts";

export const SCORING_AXES_SCHEMA = {
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

export type ScoringSystemPromptInput = {
  scoringSystemPrompt?: string | null;
  translationPrompt: string;
  priorityTopics: string[];
  lowPriorityTopics: string[];
  editorialGuidelines?: string | null;
};

export type ScoringUserMessageInput = {
  textOriginal: string;
  authorDisplay: string;
  accountName?: string | null;
  publishedAt: string;
  hasMedia: boolean;
  url?: string | null;
};

export type ParsedClassifierToolCall = {
  translatedText?: string;
  importanceScore: number;
  importanceTags: string[];
  importanceReasoning: string | null;
  scoreAxes: ScoreAxes | null;
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
