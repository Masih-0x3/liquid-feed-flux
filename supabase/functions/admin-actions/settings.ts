import { validateOpenAiMaxCompletionTokens } from "../_shared/openaiCostControls.ts";
import { normalizeScoringPolicy } from "../_shared/scoringPolicy.ts";
import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

type SettingsQueryBuilder = {
  select(columns: string): SettingsQueryBuilder;
  eq(column: string, value: unknown): SettingsQueryBuilder;
  maybeSingle(): Promise<
    { data?: { value?: unknown } | null; error?: unknown }
  >;
  upsert(
    value: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ error?: unknown }>;
};

export const SETTINGS_ALLOWED_KEYS = [
  "translation_prompt",
  "telegram_config",
  "message_template",
  "content_filter",
  "twitter_hydration",
  "x_posting_config",
  "x_rate_limits",
  "x_api_controls",
  "enrichment_config",
  "editorial_profiles",
  "active_profile_id",
  "story_memory",
  "scoring_policy",
] as const;

export function validateSettingsValue(
  key: string,
  value: unknown,
): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `Value for "${key}" must be a JSON object`;
  }
  const v = value as Record<string, unknown>;

  switch (key) {
    case "translation_prompt": {
      const stringFields: Array<[string, number]> = [
        ["system_prompt", 20000],
        ["user_prompt_template", 10000],
        ["model", 100],
        ["scoring_system_prompt", 20000],
        ["classifier_tool_schema", 20000],
      ];
      for (const [field, max] of stringFields) {
        if (v[field] !== undefined && typeof v[field] !== "string") {
          return `translation_prompt.${field} must be a string`;
        }
        if (typeof v[field] === "string" && (v[field] as string).length > max) {
          return `translation_prompt.${field} must be ≤${max} characters`;
        }
      }
      const numFields = [
        "temperature",
        "max_completion_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "seed",
      ];
      for (const f of numFields) {
        if (v[f] !== undefined && v[f] !== null && typeof v[f] !== "number") {
          return `translation_prompt.${f} must be a number`;
        }
      }
      const translationTokenError = validateOpenAiMaxCompletionTokens(
        "translation_prompt.max_completion_tokens",
        v.max_completion_tokens,
      );
      if (translationTokenError) return translationTokenError;
      if (
        v.reasoning_effort !== undefined &&
        !["minimal", "low", "medium", "high"].includes(
          v.reasoning_effort as string,
        )
      ) {
        return "translation_prompt.reasoning_effort must be one of minimal|low|medium|high";
      }
      if (
        v.verbosity !== undefined &&
        !["low", "medium", "high"].includes(v.verbosity as string)
      ) {
        return "translation_prompt.verbosity must be one of low|medium|high";
      }
      if (
        v.service_tier !== undefined &&
        !["auto", "default", "flex", "priority"].includes(
          v.service_tier as string,
        )
      ) {
        return "translation_prompt.service_tier must be one of auto|default|flex|priority";
      }
      if (
        v.parallel_tool_calls !== undefined &&
        typeof v.parallel_tool_calls !== "boolean"
      ) {
        return "translation_prompt.parallel_tool_calls must be a boolean";
      }
      if (v.split_calls !== undefined && typeof v.split_calls !== "boolean") {
        return "translation_prompt.split_calls must be a boolean";
      }
      if (v.scoring !== undefined) {
        if (
          typeof v.scoring !== "object" || v.scoring === null ||
          Array.isArray(v.scoring)
        ) {
          return "translation_prompt.scoring must be an object";
        }
        const sv = v.scoring as Record<string, unknown>;
        if (sv.model !== undefined && typeof sv.model !== "string") {
          return "scoring.model must be a string";
        }
        const snum = ["temperature", "max_completion_tokens", "top_p", "seed"];
        for (const f of snum) {
          if (
            sv[f] !== undefined && sv[f] !== null && typeof sv[f] !== "number"
          ) {
            return `scoring.${f} must be a number`;
          }
        }
        const scoringTokenError = validateOpenAiMaxCompletionTokens(
          "scoring.max_completion_tokens",
          sv.max_completion_tokens,
        );
        if (scoringTokenError) return scoringTokenError;
        if (
          sv.reasoning_effort !== undefined &&
          !["minimal", "low", "medium", "high"].includes(
            sv.reasoning_effort as string,
          )
        ) {
          return "scoring.reasoning_effort must be one of minimal|low|medium|high";
        }
        if (
          sv.verbosity !== undefined &&
          !["low", "medium", "high"].includes(sv.verbosity as string)
        ) {
          return "scoring.verbosity must be one of low|medium|high";
        }
        if (
          sv.service_tier !== undefined &&
          !["auto", "default", "flex", "priority"].includes(
            sv.service_tier as string,
          )
        ) {
          return "scoring.service_tier must be one of auto|default|flex|priority";
        }
        if (
          sv.parallel_tool_calls !== undefined &&
          typeof sv.parallel_tool_calls !== "boolean"
        ) {
          return "scoring.parallel_tool_calls must be a boolean";
        }
      }
      break;
    }
    case "telegram_config": {
      if (
        v.parse_mode !== undefined &&
        !["Markdown", "MarkdownV2", "HTML", ""].includes(v.parse_mode as string)
      ) {
        return "telegram_config.parse_mode must be Markdown, MarkdownV2, HTML, or empty";
      }
      break;
    }
    case "message_template": {
      if (v.template !== undefined && typeof v.template !== "string") {
        return "message_template.template must be a string";
      }
      if (v.template && (v.template as string).length > 2000) {
        return "message_template.template must be ≤2000 characters";
      }
      if (
        v.include_source_link !== undefined &&
        typeof v.include_source_link !== "boolean"
      ) {
        return "message_template.include_source_link must be a boolean";
      }
      if (
        v.source_link_text !== undefined &&
        typeof v.source_link_text !== "string"
      ) {
        return "message_template.source_link_text must be a string";
      }
      if (
        v.custom_hashtags !== undefined && typeof v.custom_hashtags !== "string"
      ) {
        return "message_template.custom_hashtags must be a string";
      }
      break;
    }
    case "twitter_hydration": {
      if (v.enabled !== undefined && typeof v.enabled !== "boolean") {
        return "twitter_hydration.enabled must be a boolean";
      }
      if (
        v.max_attempts !== undefined &&
        (typeof v.max_attempts !== "number" || v.max_attempts < 1 ||
          v.max_attempts > 10)
      ) return "twitter_hydration.max_attempts must be 1-10";
      break;
    }
    case "x_posting_config": {
      const bools = ["enabled", "require_media", "post_only_decision_deliver"];
      for (const f of bools) {
        if (v[f] !== undefined && typeof v[f] !== "boolean") {
          return `x_posting_config.${f} must be a boolean`;
        }
      }
      if (
        v.min_score !== undefined &&
        (typeof v.min_score !== "number" || v.min_score < 1 || v.min_score > 20)
      ) return "x_posting_config.min_score must be 1-20";
      if (
        v.max_chars !== undefined &&
        (typeof v.max_chars !== "number" || v.max_chars < 50 ||
          v.max_chars > 4000)
      ) return "x_posting_config.max_chars must be 50-4000";
      if (
        v.dedupe_window_hours !== undefined &&
        (typeof v.dedupe_window_hours !== "number" ||
          v.dedupe_window_hours < 1 || v.dedupe_window_hours > 720)
      ) return "x_posting_config.dedupe_window_hours must be 1-720";
      const strs: Array<[string, number]> = [["post_template", 1000], [
        "leading_emoji",
        32,
      ], ["hashtags", 500]];
      for (const [f, max] of strs) {
        if (v[f] !== undefined && typeof v[f] !== "string") {
          return `x_posting_config.${f} must be a string`;
        }
        if (typeof v[f] === "string" && (v[f] as string).length > max) {
          return `x_posting_config.${f} must be ≤${max} characters`;
        }
      }
      if (v.hashtag_pool !== undefined) {
        if (!Array.isArray(v.hashtag_pool)) {
          return "x_posting_config.hashtag_pool must be an array of strings";
        }
        if ((v.hashtag_pool as unknown[]).length > 100) {
          return "x_posting_config.hashtag_pool must be ≤100 entries";
        }
        for (const t of v.hashtag_pool as unknown[]) {
          if (typeof t !== "string" || t.length > 64) {
            return "x_posting_config.hashtag_pool entries must be strings ≤64 chars";
          }
        }
      }
      if (
        v.hashtags_per_post !== undefined &&
        (typeof v.hashtags_per_post !== "number" ||
          ![0, 1, 2].includes(v.hashtags_per_post))
      ) {
        return "x_posting_config.hashtags_per_post must be 0, 1, or 2";
      }
      break;
    }
    case "x_rate_limits": {
      const nums: Array<[string, number, number]> = [
        ["posts_per_hour", 1, 1000],
        ["posts_per_day", 1, 10000],
        ["monthly_post_budget", 1, 1000000],
        ["media_uploads_per_day", 1, 10000],
      ];
      for (const [f, min, max] of nums) {
        if (
          v[f] !== undefined &&
          (typeof v[f] !== "number" || (v[f] as number) < min ||
            (v[f] as number) > max)
        ) {
          return `x_rate_limits.${f} must be ${min}-${max}`;
        }
      }
      break;
    }
    case "editorial_profiles": {
      if (!Array.isArray(v.profiles)) {
        return "editorial_profiles.profiles must be an array";
      }
      if ((v.profiles as unknown[]).length > 50) {
        return "editorial_profiles.profiles must be ≤50";
      }
      const axes = [
        "iran_relevance",
        "severity",
        "novelty",
        "credibility",
        "actionability",
        "noise",
      ];
      for (const p of v.profiles as unknown[]) {
        if (!p || typeof p !== "object") {
          return "each profile must be an object";
        }
        const pp = p as Record<string, unknown>;
        if (typeof pp.id !== "string" || !pp.id) return "profile.id required";
        if (
          typeof pp.name !== "string" || !pp.name ||
          (pp.name as string).length > 80
        ) return "profile.name required (≤80)";
        if (
          typeof pp.threshold !== "number" || (pp.threshold as number) < 0 ||
          (pp.threshold as number) > 20
        ) return "profile.threshold must be 0-20";
        if (!pp.weights || typeof pp.weights !== "object") {
          return "profile.weights required";
        }
        for (const ax of axes) {
          const w = (pp.weights as Record<string, unknown>)[ax];
          if (w !== undefined && (typeof w !== "number" || w < 0 || w > 5)) {
            return `profile.weights.${ax} must be 0-5`;
          }
        }
        for (
          const arrKey of [
            "must_include_keywords",
            "must_exclude_keywords",
            "required_tags_any",
            "blocked_tags",
          ]
        ) {
          const a = pp[arrKey];
          if (
            a !== undefined &&
            (!Array.isArray(a) ||
              (a as unknown[]).some((x) =>
                typeof x !== "string" || (x as string).length > 80
              ))
          ) {
            return `profile.${arrKey} must be array of strings ≤80`;
          }
        }
        if (pp.author_overrides !== undefined) {
          if (
            typeof pp.author_overrides !== "object" ||
            pp.author_overrides === null
          ) return "profile.author_overrides must be object";
          for (
            const [, val] of Object.entries(
              pp.author_overrides as Record<string, unknown>,
            )
          ) {
            if (val !== "always_deliver" && val !== "always_skip") {
              return "author_overrides values must be always_deliver|always_skip";
            }
          }
        }
        if (
          pp.editorial_note !== undefined &&
          (typeof pp.editorial_note !== "string" ||
            (pp.editorial_note as string).length > 4000)
        ) return "profile.editorial_note must be string ≤4000";
      }
      break;
    }
    case "active_profile_id": {
      if (v.id !== null && typeof v.id !== "string") {
        return "active_profile_id.id must be string or null";
      }
      if (typeof v.id === "string" && (v.id as string).length > 80) {
        return "active_profile_id.id too long";
      }
      break;
    }
    case "story_memory": {
      if (typeof v.enabled !== "boolean") {
        return "story_memory.enabled must be boolean";
      }
      if (
        typeof v.window_hours !== "number" || v.window_hours < 1 ||
        v.window_hours > 168
      ) return "story_memory.window_hours must be 1-168";
      if (
        typeof v.similarity_threshold !== "number" ||
        v.similarity_threshold < 0.5 || v.similarity_threshold > 0.99
      ) return "story_memory.similarity_threshold must be 0.5-0.99";
      if (
        v.candidate_min_similarity !== undefined &&
        (typeof v.candidate_min_similarity !== "number" ||
          v.candidate_min_similarity < 0.5 || v.candidate_min_similarity > 0.99)
      ) return "story_memory.candidate_min_similarity must be 0.5-0.99";
      if (
        v.auto_duplicate_similarity !== undefined &&
        (typeof v.auto_duplicate_similarity !== "number" ||
          v.auto_duplicate_similarity < 0.5 ||
          v.auto_duplicate_similarity > 0.99)
      ) return "story_memory.auto_duplicate_similarity must be 0.5-0.99";
      if (v.action !== "skip" && v.action !== "mark_and_deliver") {
        return "story_memory.action must be skip|mark_and_deliver";
      }
      if (
        v.mode !== undefined && v.mode !== "hybrid_ai" &&
        v.mode !== "semantic_only" && v.mode !== "review_first"
      ) return "story_memory.mode must be hybrid_ai|semantic_only|review_first";
      if (
        v.adjudicator_model !== undefined &&
        (typeof v.adjudicator_model !== "string" ||
          v.adjudicator_model.length < 1 || v.adjudicator_model.length > 100)
      ) return "story_memory.adjudicator_model must be a string ≤100";
      if (
        v.adjudicator_reasoning_effort !== undefined &&
        (typeof v.adjudicator_reasoning_effort !== "string" ||
          !["low", "medium", "high", "xhigh"].includes(
            v.adjudicator_reasoning_effort as string,
          ))
      ) {
        return "story_memory.adjudicator_reasoning_effort must be low|medium|high|xhigh";
      }
      if (
        v.adjudicator_confidence_threshold !== undefined &&
        (typeof v.adjudicator_confidence_threshold !== "number" ||
          v.adjudicator_confidence_threshold < 0.5 ||
          v.adjudicator_confidence_threshold > 0.95)
      ) return "story_memory.adjudicator_confidence_threshold must be 0.5-0.95";
      if (!Array.isArray(v.bypass_authors)) {
        return "story_memory.bypass_authors must be array";
      }
      if ((v.bypass_authors as unknown[]).length > 100) {
        return "story_memory.bypass_authors must be ≤100";
      }
      break;
    }
    case "scoring_policy": {
      if (v.enabled !== undefined && typeof v.enabled !== "boolean") {
        return "scoring_policy.enabled must be boolean";
      }
      if (v.mode !== undefined && v.mode !== "shadow" && v.mode !== "active") {
        return "scoring_policy.mode must be shadow|active";
      }
      if (
        !Array.isArray(v.profiles) || (v.profiles as unknown[]).length === 0
      ) return "scoring_policy.profiles must be a non-empty array";
      if ((v.profiles as unknown[]).length > 50) {
        return "scoring_policy.profiles must be <=50";
      }
      for (const profile of v.profiles as unknown[]) {
        if (!profile || typeof profile !== "object") {
          return "each scoring profile must be an object";
        }
        const p = profile as Record<string, unknown>;
        if (typeof p.id !== "string" || !p.id || p.id.length > 80) {
          return "scoring profile id required (<=80)";
        }
        if (typeof p.name !== "string" || !p.name || p.name.length > 120) {
          return "scoring profile name required (<=120)";
        }
        for (
          const arrKey of [
            "focus_entities",
            "aliases",
            "geographies",
            "blocked_categories",
            "review_only_exception_ids",
          ]
        ) {
          if (
            p[arrKey] === undefined && arrKey === "review_only_exception_ids"
          ) continue;
          if (!Array.isArray(p[arrKey])) {
            return `scoring profile ${arrKey} must be an array`;
          }
          if (
            (p[arrKey] as unknown[]).some((x) =>
              typeof x !== "string" || x.length > 120
            )
          ) return `scoring profile ${arrKey} entries must be strings <=120`;
        }
        if (typeof p.thresholds !== "object" || p.thresholds === null) {
          return "scoring profile thresholds required";
        }
        const thresholds = p.thresholds as Record<string, unknown>;
        for (
          const cls of [
            "direct_focus",
            "adjacent",
            "global_exception",
            "off_topic",
          ]
        ) {
          const rule = thresholds[cls] as Record<string, unknown> | undefined;
          if (!rule || typeof rule !== "object") {
            return `thresholds.${cls} required`;
          }
          if (
            typeof rule.threshold !== "number" || rule.threshold < 1 ||
            rule.threshold > 99
          ) return `thresholds.${cls}.threshold must be 1-99`;
          if (typeof rule.cap !== "number" || rule.cap < 1 || rule.cap > 20) {
            return `thresholds.${cls}.cap must be 1-20`;
          }
        }
        if (typeof p.axis_weights !== "object" || p.axis_weights === null) {
          return "scoring profile axis_weights required";
        }
      }
      try {
        normalizeScoringPolicy(v);
      } catch (e) {
        return `invalid scoring_policy: ${(e as Error).message}`;
      }
      break;
    }
    case "x_api_controls": {
      if (v.my_x_enabled !== undefined && typeof v.my_x_enabled !== "boolean") {
        return "x_api_controls.my_x_enabled must be a boolean";
      }
      const nums = [
        ["verify_cache_minutes", 1, 1440],
        ["follower_snapshot_stale_minutes", 1, 1440],
        ["usage_sync_interval_hours", 1, 168],
        ["backfill_max_hydrate_jobs_per_run", 1, 500],
      ] as const;
      for (const [field, min, max] of nums) {
        if (
          v[field] !== undefined &&
          (typeof v[field] !== "number" || v[field] < min || v[field] > max)
        ) {
          return `x_api_controls.${field} must be ${min}-${max}`;
        }
      }
      if (v.warning_thresholds !== undefined) {
        if (!Array.isArray(v.warning_thresholds)) {
          return "x_api_controls.warning_thresholds must be an array";
        }
        for (const item of v.warning_thresholds) {
          if (typeof item !== "number" || item < 1 || item > 100) {
            return "x_api_controls.warning_thresholds entries must be 1-100";
          }
        }
      }
      break;
    }
    case "enrichment_config": {
      if (v.enabled !== undefined && typeof v.enabled !== "boolean") {
        return "enrichment_config.enabled must be a boolean";
      }
      if (
        v.mode !== undefined && v.mode !== "creator_analysis" &&
        v.mode !== "legacy"
      ) return "enrichment_config.mode must be creator_analysis|legacy";
      if (
        v.pipeline_mode !== undefined && v.pipeline_mode !== "manual_only" &&
        v.pipeline_mode !== "shadow_review" &&
        v.pipeline_mode !== "required_for_x"
      ) {
        return "enrichment_config.pipeline_mode must be manual_only|shadow_review|required_for_x";
      }
      if (
        v.review_mode !== undefined && v.review_mode !== "shadow_review" &&
        v.review_mode !== "auto_high_confidence" &&
        v.review_mode !== "manual_only"
      ) {
        return "enrichment_config.review_mode must be shadow_review|auto_high_confidence|manual_only";
      }
      if (
        v.require_approval !== undefined &&
        typeof v.require_approval !== "boolean"
      ) return "enrichment_config.require_approval must be a boolean";
      if (
        v.model !== undefined &&
        (typeof v.model !== "string" || v.model.length > 100)
      ) return "enrichment_config.model must be a string <=100";
      break;
    }
  }
  return null;
}

export function shouldRestampXPostingStart(
  prevCfg: Record<string, unknown>,
  nextCfg: Record<string, unknown>,
): boolean {
  const prevStart = typeof prevCfg.start_posting_from === "string"
    ? prevCfg.start_posting_from
    : null;
  const nextStart = typeof nextCfg.start_posting_from === "string"
    ? nextCfg.start_posting_from
    : null;
  const userProvidedStart = !!nextStart && nextStart !== prevStart;

  const prevEnabled = !!prevCfg.enabled;
  const nextEnabled = !!nextCfg.enabled;
  const enableTransition = nextEnabled && !prevEnabled;

  const prevMin = typeof prevCfg.min_score === "number"
    ? prevCfg.min_score as number
    : 14;
  const nextMin = typeof nextCfg.min_score === "number"
    ? nextCfg.min_score as number
    : prevMin;
  const thresholdLowered = nextEnabled && nextMin < prevMin;

  const mediaLoosened = nextEnabled && prevCfg.require_media === true &&
    nextCfg.require_media === false;
  const decisionGateLoosened = nextEnabled &&
    prevCfg.post_only_decision_deliver === true &&
    nextCfg.post_only_decision_deliver === false;

  return !userProvidedStart &&
    (enableTransition || thresholdLowered || mediaLoosened ||
      decisionGateLoosened);
}

export async function saveSettingsAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const key = body.key as string | undefined;
  const value = body.value;
  if (!key || value === undefined) {
    return { body: { error: "key and value are required" }, status: 400 };
  }
  if (
    !SETTINGS_ALLOWED_KEYS.includes(key as typeof SETTINGS_ALLOWED_KEYS[number])
  ) {
    return {
      body: { error: `Setting key "${key}" is not allowed` },
      status: 400,
    };
  }

  const validationError = validateSettingsValue(key, value);
  if (validationError) {
    return { body: { error: validationError }, status: 400 };
  }

  let valueToSave = value;
  if (key === "x_posting_config" && value && typeof value === "object") {
    const settings = supabase.from("settings") as SettingsQueryBuilder;
    const { data: prev } = await settings.select("value").eq(
      "key",
      "x_posting_config",
    ).maybeSingle();
    const prevCfg = (prev?.value ?? {}) as Record<string, unknown>;
    const nextCfg = value as Record<string, unknown>;

    if (shouldRestampXPostingStart(prevCfg, nextCfg)) {
      valueToSave = {
        ...nextCfg,
        start_posting_from: new Date().toISOString(),
      };
      console.log(
        "[admin-actions] re-stamped x_posting_config.start_posting_from",
        {
          enableTransition: !!nextCfg.enabled && !prevCfg.enabled,
          thresholdLowered: !!nextCfg.enabled &&
            typeof nextCfg.min_score === "number" &&
            nextCfg.min_score <
              (typeof prevCfg.min_score === "number" ? prevCfg.min_score : 14),
          mediaLoosened: !!nextCfg.enabled && prevCfg.require_media === true &&
            nextCfg.require_media === false,
          decisionGateLoosened: !!nextCfg.enabled &&
            prevCfg.post_only_decision_deliver === true &&
            nextCfg.post_only_decision_deliver === false,
          prevMin: typeof prevCfg.min_score === "number"
            ? prevCfg.min_score
            : 14,
          nextMin: typeof nextCfg.min_score === "number"
            ? nextCfg.min_score
            : (typeof prevCfg.min_score === "number" ? prevCfg.min_score : 14),
          prevStart: typeof prevCfg.start_posting_from === "string"
            ? prevCfg.start_posting_from
            : null,
          nextStart: typeof nextCfg.start_posting_from === "string"
            ? nextCfg.start_posting_from
            : null,
        },
      );
    }
  }

  const settings = supabase.from("settings") as SettingsQueryBuilder;
  const { error } = await settings.upsert({
    key,
    value: valueToSave,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
  return { body: { success: true, message: `Settings "${key}" saved` } };
}
