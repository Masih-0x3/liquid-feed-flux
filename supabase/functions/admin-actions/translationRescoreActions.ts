import {
  callOpenAI,
  type NormalizedOpenAIResponse,
  type ToolFunctionDef,
} from "../_shared/openai.ts";
import {
  applyProfileDecision,
  computeFinalScore,
  type EditorialProfile,
  parseScoreAxes,
} from "../_shared/scoring.ts";
import {
  type InsertAdminPipelineEventFn,
  loadScoringModelOptions,
  loadScoringPolicyConfig,
  scorePostV2,
} from "./scoringActions.ts";
import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
};

export type RunRescoreResult = {
  ok: boolean;
  error?: string;
  score?: number;
  final_score?: number;
  decision?: string;
  decision_reason?: string | null;
  threshold?: number;
  tags?: string[];
  reasoning?: string | null;
  translated?: string | null;
  model?: string;
};

export type RunRescoreFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<RunRescoreResult>;

export type RunTranslationOnlyResult = {
  ok: boolean;
  translated?: string;
  model?: string;
  error?: string;
};

export type RunTranslationOnlyFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<RunTranslationOnlyResult>;

type CallOpenAIFn = typeof callOpenAI;

type OpenAiDeps = {
  callOpenAI?: CallOpenAIFn;
  getOpenAiApiKey?: () => string | undefined;
  now?: () => Date;
};

export type RunTranslationOnlyDeps = OpenAiDeps & {
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  recordFeedback: RecordFeedbackFn;
};

export type RescorePostDeps = OpenAiDeps & {
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  recordFeedback: RecordFeedbackFn;
  runRescore?: RunRescoreFn;
  loadScoringPolicyConfig?: typeof loadScoringPolicyConfig;
  scorePostV2?: typeof scorePostV2;
  loadScoringModelOptions?: typeof loadScoringModelOptions;
};

export type TranslatePostDeps = {
  runTranslationOnly: RunTranslationOnlyFn;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function openAiApiKey(deps?: OpenAiDeps): string {
  return deps?.getOpenAiApiKey?.() ?? Deno.env.get("OPENAI_API_KEY") ?? "";
}

function nowIso(deps?: Pick<OpenAiDeps, "now">): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function nowMs(deps?: Pick<OpenAiDeps, "now">): number {
  return (deps?.now?.() ?? new Date()).getTime();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function settingsRowsToMap(
  rows: unknown,
): Record<string, Record<string, unknown>> {
  const settingsMap: Record<string, Record<string, unknown>> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const record = asRecord(row);
    if (typeof record.key === "string" && record.value) {
      settingsMap[record.key] = asRecord(record.value);
    }
  }
  return settingsMap;
}

function modelError(result: NormalizedOpenAIResponse): string {
  return `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}`;
}

function defaultTranslationPrompt(): string {
  return "You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.";
}

function sharedCallOptions(settings: Record<string, unknown>) {
  return {
    temperature: typeof settings.temperature === "number"
      ? settings.temperature
      : null,
    topP: typeof settings.top_p === "number" ? settings.top_p : null,
    frequencyPenalty: typeof settings.frequency_penalty === "number"
      ? settings.frequency_penalty
      : null,
    presencePenalty: typeof settings.presence_penalty === "number"
      ? settings.presence_penalty
      : null,
    reasoningEffort: typeof settings.reasoning_effort === "string"
      ? settings.reasoning_effort
      : null,
    verbosity: typeof settings.verbosity === "string"
      ? settings.verbosity
      : null,
    seed: typeof settings.seed === "number" ? settings.seed : null,
    serviceTier: typeof settings.service_tier === "string"
      ? settings.service_tier
      : null,
    parallelToolCalls: typeof settings.parallel_tool_calls === "boolean"
      ? settings.parallel_tool_calls
      : null,
  } as const;
}

function previewCallOptions(settings: Record<string, unknown>) {
  return {
    ...sharedCallOptions(settings),
    temperature: typeof settings.temperature === "number"
      ? settings.temperature
      : 0.2,
  } as const;
}

function axesSchema() {
  return {
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
  };
}

export async function runRescore(
  supabase: SupabaseAdminClient,
  tweetId: string,
  deps: OpenAiDeps = {},
): Promise<RunRescoreResult> {
  const { data: post, error: postErr } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, author_handle, tweeted_at, has_media, url",
    )
    .eq("tweet_id", tweetId)
    .single();
  const postRecord = asRecord(post);
  if (postErr || !post) {
    return { ok: false, error: `Post not found: ${tweetId}` };
  }
  if (!postRecord.text_original) {
    return { ok: false, error: "Post has no original text to score" };
  }

  const { data: settings } = await table(supabase, "settings")
    .select("key, value")
    .in("key", [
      "translation_prompt",
      "content_filter",
      "editorial_profiles",
      "active_profile_id",
    ]);
  const settingsMap = settingsRowsToMap(settings);
  const tp = settingsMap.translation_prompt || {};
  const cf = settingsMap.content_filter || {};

  const profilesArr = (settingsMap.editorial_profiles?.profiles as unknown[]) ??
    [];
  const activeId = typeof settingsMap.active_profile_id?.id === "string"
    ? settingsMap.active_profile_id.id
    : "";
  let editorialProfile: EditorialProfile | null = null;
  if (Array.isArray(profilesArr) && activeId) {
    const found = profilesArr.find((profile) =>
      profile && typeof profile === "object" &&
      (profile as Record<string, unknown>).id === activeId
    );
    if (found && typeof found === "object") {
      editorialProfile = found as EditorialProfile;
    }
  }

  const filterEnabled = cf.enabled === true;
  const scoreOnly = cf.score_only === true;
  const model = typeof tp.model === "string" && tp.model.trim()
    ? tp.model
    : "gpt-4o-mini";
  const translationPrompt = typeof tp.system_prompt === "string" &&
      tp.system_prompt.trim()
    ? tp.system_prompt
    : defaultTranslationPrompt();
  const customScoringPrompt = typeof tp.scoring_system_prompt === "string" &&
      tp.scoring_system_prompt.trim()
    ? tp.scoring_system_prompt
    : null;
  const customToolSchema = typeof tp.classifier_tool_schema === "string" &&
      tp.classifier_tool_schema.trim()
    ? tp.classifier_tool_schema
    : null;
  const maxOutputTokens = typeof tp.max_completion_tokens === "number"
    ? Math.min(8000, Math.max(1, tp.max_completion_tokens))
    : 2000;
  const apiKey = openAiApiKey(deps);
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured" };

  const priorityTopics = Array.isArray(cf.priority_topics)
    ? (cf.priority_topics as string[]).join(", ")
    : "none specified";
  const lowPriorityTopics = Array.isArray(cf.low_priority_topics)
    ? (cf.low_priority_topics as string[]).join(", ")
    : "none specified";
  const guidelines = typeof cf.editorial_guidelines === "string"
    ? cf.editorial_guidelines
    : "";
  const guidelinesBlock = guidelines.trim()
    ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
    : "";

  const scoringTemplate = customScoringPrompt ??
    `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nScore 1-20 with 3-level relevance: DIRECT (no cap), INDIRECT Iran-adjacent (cap 16), NO NEXUS (cap 8). Polls/leaks/analyst reports about Iran conflicts can score 13-16. Do NOT down-score because framing is Western. Prefer higher tier when in doubt.\n\nManual calibration: direct Iran crisis, war, diplomacy, and military-posture items should usually score 17-19 when credible. Trump/Netanyahu/US/Pakistan leadership statements or coordination specifically about Iran are DIRECT audience-fit, not routine foreign politics. Qeshm/Hormuz, air-defense, drones, refueling tankers, US-Israel posture, IRGC/proxy threats, nuclear/escalation signals, and threats against POTUS family or senior US targets are very high impact. Pure Taiwan or unrelated domestic news with no Iran/Middle East nexus remains low/off-topic.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nReasoning MUST state: relevance level, tier, any cap. Call "classify_importance" with BOTH importance_score (1-20) AND axes (all six 0-10 fields).`;
  const systemPrompt = scoringTemplate
    .replace("{translation_prompt}", translationPrompt)
    .replace("{priority_topics}", priorityTopics)
    .replace("{low_priority_topics}", lowPriorityTopics)
    .replace("{editorial_guidelines_block}", guidelinesBlock);

  let baseTool: Record<string, unknown>;
  try {
    baseTool = customToolSchema ? JSON.parse(customToolSchema) : {
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
          axes: axesSchema(),
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
  } catch (e) {
    return {
      ok: false,
      error: `Invalid classifier_tool_schema JSON: ${(e as Error).message}`,
    };
  }

  const params = baseTool.parameters as Record<string, unknown>;
  const props = { ...(params.properties as Record<string, unknown>) };
  if (!props.axes) {
    props.axes = axesSchema();
    const required = Array.from(
      new Set([...((params.required as string[]) || []), "axes"]),
    );
    baseTool = {
      ...baseTool,
      parameters: { ...params, properties: props, required },
    };
  }
  const toolFunction = baseTool as unknown as ToolFunctionDef;

  const userMessage = `Author: @${
    postRecord.author_handle || "unknown"
  }\nPublished: ${
    postRecord.tweeted_at
      ? new Date(postRecord.tweeted_at as string).toISOString()
      : "unknown"
  }\nHas media: ${postRecord.has_media ? "yes" : "no"}\nURL: ${
    postRecord.url || "N/A"
  }\n\nContent:\n${postRecord.text_original}`;

  const result = await (deps.callOpenAI ?? callOpenAI)({
    apiKey,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    tool: toolFunction,
    maxOutputTokens,
    ...sharedCallOptions(tp),
  });
  if (!result.ok) return { ok: false, error: modelError(result) };
  if (!result.toolCall) {
    return { ok: false, error: "Model did not return a tool call" };
  }

  let args: {
    translated_text?: string;
    importance_score?: number;
    axes?: unknown;
    tags?: string[];
    reasoning?: string;
  };
  try {
    args = JSON.parse(result.toolCall.arguments);
  } catch (e) {
    return {
      ok: false,
      error: `Tool-call parse error: ${(e as Error).message}`,
    };
  }

  let importanceScore = Math.max(1, Math.min(20, args.importance_score ?? 10));
  const scoreAxes = parseScoreAxes(args.axes);
  if (scoreAxes && args.importance_score == null) {
    importanceScore = Math.round(computeFinalScore(scoreAxes));
  }
  const newTags = Array.isArray(args.tags) ? args.tags : [];
  const newReasoning = typeof args.reasoning === "string"
    ? args.reasoning
    : null;
  const authorHandle = (postRecord.author_handle as string | null) ?? null;
  const textOriginal = String(postRecord.text_original || "");

  let deliveryDecision = "deliver";
  let decisionReason: string | null = null;
  let finalScore: number | null = scoreAxes
    ? computeFinalScore(scoreAxes)
    : (importanceScore ?? null);

  if (filterEnabled && importanceScore !== null && !scoreOnly) {
    if (editorialProfile) {
      const profileDecision = applyProfileDecision({
        profile: editorialProfile,
        axes: scoreAxes,
        legacyScore: importanceScore,
        tags: newTags,
        text: textOriginal,
        authorHandle,
      });
      deliveryDecision = profileDecision.decision;
      decisionReason = profileDecision.reason;
      finalScore = profileDecision.finalScore;
    } else {
      const authorRules = (cf.author_rules as Record<
        string,
        { rule: string; threshold?: number }
      >) ||
        {};
      const authorRule = authorHandle ? authorRules[authorHandle] : null;
      if (authorRule?.rule === "always_deliver") {
        deliveryDecision = "deliver";
        decisionReason = `author_rule:always_deliver:${authorHandle}`;
      } else if (authorRule?.rule === "always_skip") {
        deliveryDecision = "skip";
        decisionReason = `author_rule:always_skip:${authorHandle}`;
      } else {
        const threshold = authorRule?.rule === "custom_threshold" &&
            authorRule.threshold != null
          ? authorRule.threshold
          : (typeof cf.default_threshold === "number"
            ? cf.default_threshold
            : 12);
        deliveryDecision = importanceScore >= threshold ? "deliver" : "skip";
        decisionReason = deliveryDecision === "deliver"
          ? `score_pass:${importanceScore}>=${threshold}`
          : `below_threshold:${importanceScore}<${threshold}`;
      }
    }
  } else if (scoreOnly) {
    decisionReason = "score_only_mode";
  } else if (!filterEnabled) {
    decisionReason = "filter_disabled";
  }

  const legacyThreshold = typeof cf.default_threshold === "number"
    ? cf.default_threshold
    : 12;
  const thresholdOut = editorialProfile
    ? editorialProfile.threshold
    : legacyThreshold;

  let scoreBreakdown: Record<string, unknown> | null = null;
  if (finalScore !== null) {
    try {
      const { data: biasRow } = await table(supabase, "settings")
        .select("value")
        .eq("key", "learned_biases")
        .maybeSingle();
      const biases = (asRecord(biasRow).value ?? {}) as {
        author_bias?: Record<string, number>;
        tag_bias?: Record<string, number>;
      };
      const authorDelta = authorHandle
        ? (biases.author_bias?.[authorHandle.toLowerCase()] ?? 0)
        : 0;
      let tagDelta = 0;
      for (const tag of newTags) {
        tagDelta += biases.tag_bias?.[String(tag).toLowerCase()] ?? 0;
      }
      tagDelta = Math.max(-2, Math.min(2, tagDelta));

      let knnPrior = 0;
      const { data: sigRow } = await table(supabase, "story_signatures")
        .select("embedding")
        .eq("tweet_id", tweetId)
        .maybeSingle();
      if (asRecord(sigRow).embedding) {
        const { data: knnVal } = await supabase.rpc("knn_feedback_prior", {
          query_embedding: asRecord(sigRow).embedding,
          exclude_tweet_id: tweetId,
        });
        knnPrior = typeof knnVal === "number" ? knnVal : 0;
      }

      const totalBias = Math.max(
        -5,
        Math.min(5, authorDelta + tagDelta + knnPrior),
      );
      const aiFinal = finalScore;
      if (totalBias !== 0) {
        finalScore = Math.max(
          1,
          Math.min(20, Math.round((finalScore + totalBias) * 10) / 10),
        );
        if (filterEnabled && !scoreOnly) {
          const threshold = thresholdOut;
          if (
            finalScore >= threshold && deliveryDecision === "skip" &&
            (decisionReason ?? "").startsWith("below_threshold")
          ) {
            deliveryDecision = "deliver";
            decisionReason = `feedback_boost:${aiFinal.toFixed(1)}+${
              totalBias.toFixed(1)
            }>=${threshold}`;
          } else if (
            finalScore < threshold && deliveryDecision === "deliver" &&
            (decisionReason ?? "").startsWith("score_pass")
          ) {
            deliveryDecision = "skip";
            decisionReason = `feedback_reduce:${aiFinal.toFixed(1)}+${
              totalBias.toFixed(1)
            }<${threshold}`;
          }
        }
      }
      scoreBreakdown = {
        ai: Math.round(aiFinal * 10) / 10,
        ...(authorDelta
          ? { author_bias: Math.round(authorDelta * 1000) / 1000 }
          : {}),
        ...(tagDelta ? { tag_bias: Math.round(tagDelta * 1000) / 1000 } : {}),
        ...(knnPrior ? { knn_prior: Math.round(knnPrior * 1000) / 1000 } : {}),
        final: Math.round(finalScore * 10) / 10,
      };
    } catch {
      // Feedback priors should never block an explicit rescore.
    }
  }

  const updatePayload: Record<string, unknown> = {
    importance_score: importanceScore,
    importance_tags: newTags,
    importance_reasoning: newReasoning,
    delivery_decision: deliveryDecision,
    score_axes: scoreAxes ?? null,
    final_score: finalScore,
    decision_reason: decisionReason,
    score_breakdown: scoreBreakdown,
  };
  if (typeof args.translated_text === "string") {
    updatePayload.text_translated = args.translated_text;
    updatePayload.translated_at = nowIso(deps);
    updatePayload.translation_model = model;
  }

  const { error: upErr } = await table(supabase, "posts").update(updatePayload)
    .eq("tweet_id", tweetId);
  if (upErr) {
    return { ok: false, error: (upErr as { message?: string }).message };
  }

  return {
    ok: true,
    score: importanceScore,
    final_score: finalScore ?? undefined,
    tags: newTags,
    reasoning: newReasoning,
    translated: typeof args.translated_text === "string"
      ? args.translated_text
      : null,
    decision: deliveryDecision,
    decision_reason: decisionReason,
    threshold: thresholdOut,
    model,
  };
}

export async function runTranslationOnly(
  supabase: SupabaseAdminClient,
  tweetId: string,
  deps: RunTranslationOnlyDeps,
): Promise<RunTranslationOnlyResult> {
  const { data: post, error: postErr } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, author_handle, tweeted_at, has_media, url",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  const postRecord = asRecord(post);
  if (postErr || !post) {
    return { ok: false, error: `Post not found: ${tweetId}` };
  }
  if (!postRecord.text_original) {
    return { ok: false, error: "Post has no original text to translate" };
  }

  const { data: settings } = await table(supabase, "settings")
    .select("key, value")
    .in("key", ["translation_prompt"]);
  const row = (Array.isArray(settings) ? settings : []).find((setting) =>
    asRecord(setting).key === "translation_prompt"
  );
  const tp = asRecord(asRecord(row).value);
  const model = typeof tp.model === "string" && tp.model.trim()
    ? tp.model
    : "gpt-4o-mini";
  const systemPrompt = typeof tp.system_prompt === "string" &&
      tp.system_prompt.trim()
    ? tp.system_prompt
    : defaultTranslationPrompt();
  const apiKey = openAiApiKey(deps);
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured" };

  const result = await (deps.callOpenAI ?? callOpenAI)({
    apiKey,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: String(postRecord.text_original) },
    ],
    maxOutputTokens: typeof tp.max_completion_tokens === "number"
      ? Math.min(8000, Math.max(1, tp.max_completion_tokens))
      : 2000,
    ...sharedCallOptions(tp),
  });
  if (!result.ok) {
    await deps.insertAdminPipelineEvent(
      supabase,
      tweetId,
      "translate",
      "failed",
      { mode: "translation_only", model },
      `OpenAI ${result.status}`,
    );
    return { ok: false, error: modelError(result) };
  }
  const translated = result.content.trim();
  if (!translated) {
    await deps.insertAdminPipelineEvent(
      supabase,
      tweetId,
      "translate",
      "failed",
      { mode: "translation_only", model },
      "empty_translation",
    );
    return { ok: false, error: "OpenAI returned an empty translation" };
  }

  const { error: upErr } = await table(supabase, "posts").update({
    text_translated: translated,
    translated_at: nowIso(deps),
    translation_model: model,
    translation_tokens:
      (result.raw?.usage as { total_tokens?: number } | undefined)
        ?.total_tokens ?? null,
  }).eq("tweet_id", tweetId);
  if (upErr) {
    return { ok: false, error: (upErr as { message?: string }).message };
  }
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "translate",
    "completed",
    {
      mode: "translation_only",
      model,
    },
  );
  await deps.recordFeedback(supabase, tweetId, "translate_only", 0).catch(
    () => {},
  );
  return { ok: true, translated, model };
}

export async function previewTranslationAdminAction(
  body: Record<string, unknown>,
  deps: OpenAiDeps = {},
): Promise<AdminActionResponse> {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return { body: { ok: false, error: "text is required" }, status: 400 };
  }
  if (text.length > 8000) {
    return {
      body: { ok: false, error: "text must be ≤8000 characters" },
      status: 400,
    };
  }

  const ts = asRecord(body.translation_settings);
  const cf = asRecord(body.content_filter);
  const authorHandle = typeof body.author_handle === "string"
    ? body.author_handle.trim()
    : "";

  const model = typeof ts.model === "string" &&
      /^[a-zA-Z0-9._-]{1,100}$/.test(ts.model)
    ? ts.model
    : "gpt-4o-mini";
  const translationPrompt = typeof ts.system_prompt === "string" &&
      ts.system_prompt.trim()
    ? ts.system_prompt
    : defaultTranslationPrompt();
  const maxTokens = typeof ts.max_completion_tokens === "number"
    ? Math.min(8000, Math.max(1, ts.max_completion_tokens))
    : 2000;
  const customScoringPrompt = typeof ts.scoring_system_prompt === "string" &&
      ts.scoring_system_prompt.trim()
    ? ts.scoring_system_prompt
    : null;
  const customToolSchema = typeof ts.classifier_tool_schema === "string" &&
      ts.classifier_tool_schema.trim()
    ? ts.classifier_tool_schema
    : null;
  const filterEnabled = cf.enabled === true || cf.score_only === true;
  const apiKey = openAiApiKey(deps);
  if (!apiKey) {
    return {
      body: { ok: false, error: "OPENAI_API_KEY is not configured" },
      status: 500,
    };
  }

  const startedAt = nowMs(deps);
  let translatedText = "";
  let importanceScore: number | null = null;
  let importanceTags: string[] | null = null;
  let reasoning: string | null = null;
  let raw: Record<string, unknown> = {};
  let usedEndpoint: "chat.completions" | "responses" = "chat.completions";

  try {
    if (filterEnabled) {
      const priorityTopics = Array.isArray(cf.priority_topics)
        ? (cf.priority_topics as string[]).join(", ")
        : "none specified";
      const lowPriorityTopics = Array.isArray(cf.low_priority_topics)
        ? (cf.low_priority_topics as string[]).join(", ")
        : "none specified";
      const guidelines = typeof cf.editorial_guidelines === "string"
        ? cf.editorial_guidelines
        : "";
      const guidelinesBlock = guidelines.trim()
        ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
        : "";

      const scoringTemplate = customScoringPrompt ??
        `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nYou are an editorial assistant. Score 1-20 based on importance to an Iran/Middle East news channel. Cap non-Iran content at 8.\n\nManual calibration: direct Iran crisis, war, diplomacy, and military-posture items should usually score 17-19 when credible. Trump/Netanyahu/US/Pakistan leadership statements or coordination specifically about Iran are DIRECT audience-fit, not routine foreign politics. Qeshm/Hormuz, air-defense, drones, refueling tankers, US-Israel posture, IRGC/proxy threats, nuclear/escalation signals, and threats against POTUS family or senior US targets are very high impact. Pure Taiwan or unrelated domestic news with no Iran/Middle East nexus remains low/off-topic.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nYou MUST call the "classify_importance" tool.`;
      const systemPrompt = scoringTemplate
        .replace("{translation_prompt}", translationPrompt)
        .replace("{priority_topics}", priorityTopics)
        .replace("{low_priority_topics}", lowPriorityTopics)
        .replace("{editorial_guidelines_block}", guidelinesBlock);

      let toolFunction: ToolFunctionDef;
      try {
        toolFunction = customToolSchema ? JSON.parse(customToolSchema) : {
          name: "classify_importance",
          description:
            "Provide the Persian translation and importance classification of this news item",
          parameters: {
            type: "object",
            properties: {
              translated_text: { type: "string" },
              importance_score: { type: "integer", minimum: 1, maximum: 20 },
              tags: { type: "array", items: { type: "string" } },
              reasoning: { type: "string" },
            },
            required: [
              "translated_text",
              "importance_score",
              "tags",
              "reasoning",
            ],
          },
        };
      } catch (e) {
        return {
          body: {
            ok: false,
            error: `Invalid classifier_tool_schema JSON: ${
              (e as Error).message
            }`,
          },
          status: 400,
        };
      }

      const userMessage = `Author: @${authorHandle || "preview"}\nPublished: ${
        nowIso(deps)
      }\nHas media: no\nURL: N/A\n\nContent:\n${text}`;
      const result = await (deps.callOpenAI ?? callOpenAI)({
        apiKey,
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tool: toolFunction,
        maxOutputTokens: maxTokens,
        ...previewCallOptions(ts),
      });
      raw = result.raw;
      usedEndpoint = result.endpoint;
      if (!result.ok) {
        return {
          body: {
            ok: false,
            error: modelError(result),
            result: { raw, endpoint: usedEndpoint },
          },
        };
      }

      if (result.toolCall) {
        try {
          const args = JSON.parse(result.toolCall.arguments);
          translatedText = args.translated_text || "";
          importanceScore = Math.max(
            1,
            Math.min(20, args.importance_score || 10),
          );
          importanceTags = Array.isArray(args.tags) ? args.tags : [];
          reasoning = typeof args.reasoning === "string"
            ? args.reasoning
            : null;
        } catch (parseErr) {
          translatedText = result.content;
          reasoning = `Tool-call parse error: ${(parseErr as Error).message}`;
        }
      } else {
        translatedText = result.content;
      }
    } else {
      const result = await (deps.callOpenAI ?? callOpenAI)({
        apiKey,
        model,
        messages: [
          { role: "system", content: translationPrompt },
          { role: "user", content: text },
        ],
        maxOutputTokens: maxTokens,
        ...previewCallOptions(ts),
      });
      raw = result.raw;
      usedEndpoint = result.endpoint;
      if (!result.ok) {
        return {
          body: {
            ok: false,
            error: modelError(result),
            result: { raw, endpoint: usedEndpoint },
          },
        };
      }
      translatedText = result.content;
    }

    const usage = (raw as { usage?: Record<string, number> }).usage ?? null;
    return {
      body: {
        ok: true,
        result: {
          translated_text: translatedText,
          importance_score: importanceScore,
          importance_tags: importanceTags,
          reasoning,
          model,
          endpoint: usedEndpoint,
          usage,
          duration_ms: nowMs(deps) - startedAt,
          used_filter: filterEnabled,
          raw,
        },
      },
    };
  } catch (e) {
    return { body: { ok: false, error: (e as Error).message } };
  }
}

export async function rescorePostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: RescorePostDeps,
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (!tweetId) {
    return { body: { ok: false, error: "tweet_id is required" }, status: 400 };
  }
  const scoringPolicy = await (deps.loadScoringPolicyConfig ??
    loadScoringPolicyConfig)(supabase);
  if (scoringPolicy.enabled === true || body.scoring_policy_v2 === true) {
    const v2 = await (deps.scorePostV2 ?? scorePostV2)(
      supabase,
      { ...body, tweet_id: tweetId, force: true },
      { insertAdminPipelineEvent: deps.insertAdminPipelineEvent },
    );
    return {
      body: {
        ok: v2.ok,
        tweet_id: tweetId,
        score: v2.result?.raw_priority_score,
        final_score: v2.result?.final_score,
        tags: v2.result?.tags,
        reasoning: v2.result?.audience_reason,
        decision: v2.result?.delivery_decision,
        decision_reason: v2.result?.decision_reason,
        threshold: v2.result?.threshold,
        model: (await (deps.loadScoringModelOptions ??
          loadScoringModelOptions)(supabase)).model,
        audience_class: v2.result?.audience_class,
        audience_confidence: v2.result?.audience_confidence,
        error: v2.ok ? undefined : v2.error,
      },
    };
  }

  const { data: prePost } = await table(supabase, "posts")
    .select("final_score")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  const oldScore = asRecord(prePost).final_score != null
    ? Number(asRecord(prePost).final_score)
    : null;
  const result =
    await (deps.runRescore ?? ((client, id) => runRescore(client, id, deps)))(
      supabase,
      tweetId,
    );
  if (!result.ok) {
    return { body: { ok: false, error: result.error }, status: 200 };
  }
  if (oldScore !== null && result.final_score != null) {
    const diff = result.final_score - oldScore;
    if (Math.abs(diff) >= 0.5) {
      const action = diff < 0 ? "dispute_high" : "dispute_low";
      const polarity = diff < 0 ? -1 : 1;
      await deps.recordFeedback(supabase, tweetId, action, polarity, {
        old_score: oldScore,
        new_score: result.final_score,
      }).catch(() => {});
    }
  }
  return {
    body: {
      ok: true,
      tweet_id: tweetId,
      score: result.score,
      final_score: result.final_score,
      tags: result.tags,
      reasoning: result.reasoning,
      decision: result.decision,
      decision_reason: result.decision_reason,
      threshold: result.threshold,
      model: result.model,
    },
  };
}

export async function translatePostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: TranslatePostDeps,
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode : "translation_only";
  if (!tweetId) {
    return { body: { ok: false, error: "tweet_id is required" }, status: 400 };
  }
  if (mode !== "translation_only") {
    return {
      body: { ok: false, error: "Only translation_only mode is supported" },
      status: 400,
    };
  }
  const result = await deps.runTranslationOnly(supabase, tweetId);
  return { body: { ...result, tweet_id: tweetId, mode } };
}
