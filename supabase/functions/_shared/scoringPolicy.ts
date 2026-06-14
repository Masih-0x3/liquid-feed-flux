import { callOpenAI, type NormalizedOpenAIResponse, type ToolFunctionDef } from "./openai.ts";

export const SCORING_POLICY_VERSION = "audience-fit-v2";

export const AUDIENCE_CLASSES = [
  "direct_focus",
  "adjacent",
  "global_exception",
  "off_topic",
] as const;
export type AudienceClass = typeof AUDIENCE_CLASSES[number];

export const SCORING_V2_AXIS_KEYS = [
  "focus_relevance",
  "geopolitical_weight",
  "audience_value",
  "materiality",
  "freshness",
  "credibility",
  "noise_penalty",
] as const;
export type ScoringV2AxisKey = typeof SCORING_V2_AXIS_KEYS[number];
export type ScoringV2Axes = Partial<Record<ScoringV2AxisKey, number>>;

export type ScoringPolicyMode = "shadow" | "active";
export type LearningMode = "shadow" | "applied" | "human_only";

export interface ScoringClassRule {
  threshold: number;
  cap: number;
}

export type ScoringPolicyRuleKind = "regional_escalation_auto" | "global_mega_event_review";

export interface ScoringPolicyAppliedRule {
  kind: ScoringPolicyRuleKind;
  original_decision: "deliver" | "skip";
  original_threshold: number;
  original_review_status: "none" | "shadow" | "needs_review";
  matched_terms: string[];
  reason: string;
}

export interface GlobalExceptionRule {
  id: string;
  label: string;
  description: string;
  cap: number;
  threshold: number;
  examples: string[];
}

export interface ScoringPolicyProfile {
  id: string;
  name: string;
  audience_description: string;
  focus_entities: string[];
  aliases: string[];
  geographies: string[];
  blocked_categories: string[];
  prompt_notes: string;
  thresholds: Record<AudienceClass, ScoringClassRule>;
  global_exceptions: GlobalExceptionRule[];
  review_only_exception_ids: string[];
  axis_weights: Record<ScoringV2AxisKey, number>;
  author_overrides: Record<string, "always_deliver" | "always_skip" | "always_review">;
}

export interface ScoringPolicyCalibrationExample {
  text_original: string;
  author_handle?: string | null;
  expected_audience_class: AudienceClass;
  expected_decision: "deliver" | "skip" | "review";
  expected_score?: number | null;
  expected_global_exception_class?: string | null;
  note?: string | null;
}

export interface ScoringPolicy {
  enabled: boolean;
  version: typeof SCORING_POLICY_VERSION;
  mode: ScoringPolicyMode;
  active_profile_id: string;
  profiles: ScoringPolicyProfile[];
  adjudication: {
    enabled: boolean;
    model: string;
    reasoning_effort: "minimal" | "low" | "medium" | "high";
    verbosity: "low" | "medium" | "high";
    confidence_threshold: number;
    borderline_margin: number;
  };
  learning: {
    mode: LearningMode;
    min_examples: number;
    max_adjustment: number;
  };
}

export interface ScoringPolicyPostInput {
  tweet_id?: string;
  text: string;
  author_handle?: string | null;
  account_name?: string | null;
  url?: string | null;
  published_at?: string | null;
}

export interface ScoringPolicyModelOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  reasoningEffort?: string | null;
  verbosity?: string | null;
  seed?: number | null;
  serviceTier?: string | null;
  parallelToolCalls?: boolean | null;
}

export interface ScoringPolicyResult {
  ok: boolean;
  version: typeof SCORING_POLICY_VERSION;
  profile_id: string;
  profile_name: string;
  audience_class: AudienceClass;
  audience_confidence: number;
  audience_reason: string;
  global_exception_class: string | null;
  axes: ScoringV2Axes;
  raw_priority_score: number;
  uncapped_score: number;
  final_score: number;
  threshold: number;
  cap: number;
  delivery_decision: "deliver" | "skip";
  decision_reason: string;
  tags: string[];
  review_status: "none" | "shadow" | "needs_review";
  adjudicated: boolean;
  adjudication_reason?: string;
  policy_rule_applied?: ScoringPolicyAppliedRule | null;
  usage: {
    scoring?: Record<string, number> | null;
    adjudication?: Record<string, number> | null;
  };
  raw?: Record<string, unknown>;
  error?: string;
}

export interface ScoringPolicyEventMeta extends Record<string, unknown> {
  version: typeof SCORING_POLICY_VERSION;
  mode: ScoringPolicyMode;
  profile_id: string;
  audience_class: AudienceClass;
  audience_confidence: number;
  audience_reason: string;
  global_exception_class: string | null;
  raw_priority_score: number;
  uncapped_score: number;
  final_score: number;
  threshold: number;
  cap: number;
  decision: "deliver" | "skip";
  decision_reason: string;
  review_status: "none" | "shadow" | "needs_review";
  adjudicated: boolean;
  adjudication_reason?: string;
  policy_rule_applied?: ScoringPolicyRuleKind | null;
  policy_rule?: ScoringPolicyAppliedRule | null;
  tags: string[];
}

export const DEFAULT_SCORING_V2_WEIGHTS: Record<ScoringV2AxisKey, number> = {
  focus_relevance: 1.8,
  geopolitical_weight: 1.35,
  audience_value: 1.2,
  materiality: 1.25,
  freshness: 0.8,
  credibility: 0.7,
  noise_penalty: 1.0,
};

export const DEFAULT_IRAN_FIRST_SCORING_PROFILE: ScoringPolicyProfile = {
  id: "iran-first",
  name: "Iran-first",
  audience_description:
    "Iranian audiences on X who want concise, high-signal updates about Iran, Iran-adjacent geopolitics, and exceptional global events that materially affect politics, security, oil, markets, or public attention.",
  focus_entities: [
    "Iran",
    "Islamic Republic",
    "IRGC",
    "Quds Force",
    "Iran nuclear program",
    "Hormuz",
    "Persian Gulf",
    "sanctions on Iran",
    "Israel-Iran",
    "US-Iran",
    "Hezbollah",
    "Houthis",
    "Iraqi PMF",
  ],
  aliases: ["Tehran", "Khamenei", "IRGC", "Sepah", "JCPOA", "Persian Gulf", "Strait of Hormuz"],
  geographies: ["Iran", "Middle East", "Persian Gulf", "Iraq", "Syria", "Lebanon", "Yemen", "Israel", "GCC"],
  blocked_categories: ["sports", "entertainment", "celebrity", "weather", "product launch", "routine tech earnings"],
  prompt_notes:
    "Do not down-score an item merely because the speaker or dateline is American or Western. Score the subject matter and audience value. Related world events pass only when they are major enough that an Iran-focused audience would reasonably expect coverage.",
  thresholds: {
    direct_focus: { threshold: 12, cap: 20 },
    adjacent: { threshold: 12.5, cap: 16 },
    global_exception: { threshold: 15, cap: 16 },
    off_topic: { threshold: 99, cap: 8 },
  },
  global_exceptions: [
    {
      id: "world_shock",
      label: "World shock",
      description: "Coup, war outbreak, assassination, regime change, major terror attack, or systemic event with global attention.",
      cap: 18,
      threshold: 15,
      examples: ["coup d'etat", "prime minister assassination", "new war", "major terror attack"],
    },
    {
      id: "oil_energy",
      label: "Oil / energy shock",
      description: "Major oil, gas, shipping, OPEC, or energy-security event that may affect Iran, the region, or global markets.",
      cap: 16,
      threshold: 14,
      examples: ["oil price shock", "OPEC surprise cut", "prime minister comments on oil supply"],
    },
    {
      id: "bitcoin_milestone",
      label: "Bitcoin milestone",
      description: "Major Bitcoin price or policy milestone large enough to become a broad political/economic story.",
      cap: 16,
      threshold: 15,
      examples: ["Bitcoin breaks a major all-time high", "country adopts Bitcoin reserve"],
    },
    {
      id: "major_leader_statement",
      label: "Major leader statement",
      description: "A prime minister, president, monarch, foreign minister, or central-bank head makes a material comment on war, oil, sanctions, or regional security.",
      cap: 16,
      threshold: 14,
      examples: ["prime minister comments on oil", "president announces sanctions strategy"],
    },
    {
      id: "global_mega_event",
      label: "Global mega-event",
      description: "A globally dominant, exceptional non-Iran story that is important enough for an Iran-first audience to review even without an Iran nexus.",
      cap: 18,
      threshold: 18,
      examples: ["major AI company IPO with global market impact", "major migration crisis with worldwide political consequences", "major technology or market shock dominating global attention"],
    },
  ],
  review_only_exception_ids: ["global_mega_event"],
  axis_weights: { ...DEFAULT_SCORING_V2_WEIGHTS },
  author_overrides: {},
};

const REGIONAL_ESCALATION_TERMS = [
  "ballistic",
  "missile",
  "air raid",
  "sirens",
  "explosion",
  "explosions",
  "drone attack",
  "fighter jets",
  "iranian attacks",
  "crude",
  "oil",
  "terminal",
  "hormuz",
  "houthi",
  "houthis",
  "erbil",
  "saudi",
  "dubai",
  "oman",
  "gulf",
];

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  enabled: false,
  version: SCORING_POLICY_VERSION,
  mode: "shadow",
  active_profile_id: DEFAULT_IRAN_FIRST_SCORING_PROFILE.id,
  profiles: [DEFAULT_IRAN_FIRST_SCORING_PROFILE],
  adjudication: {
    enabled: true,
    model: "gpt-5.4-mini",
    reasoning_effort: "low",
    verbosity: "low",
    confidence_threshold: 0.72,
    borderline_margin: 1.0,
  },
  learning: {
    mode: "shadow",
    min_examples: 8,
    max_adjustment: 2,
  },
};

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

function strings(v: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(v)) return fallback;
  return [...new Set(v.map((x) => typeof x === "string" ? x.trim() : "").filter(Boolean).slice(0, 200))];
}

function normalizeClassRule(v: unknown, fallback: ScoringClassRule): ScoringClassRule {
  const src = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    threshold: clampNumber(src.threshold, 1, 99, fallback.threshold),
    cap: clampNumber(src.cap, 1, 20, fallback.cap),
  };
}

function normalizeException(v: unknown, fallback: GlobalExceptionRule): GlobalExceptionRule {
  const src = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    id: typeof src.id === "string" && src.id.trim() ? src.id.trim().slice(0, 80) : fallback.id,
    label: typeof src.label === "string" && src.label.trim() ? src.label.trim().slice(0, 120) : fallback.label,
    description: typeof src.description === "string" ? src.description.slice(0, 800) : fallback.description,
    cap: clampNumber(src.cap, 1, 20, fallback.cap),
    threshold: clampNumber(src.threshold, 1, 20, fallback.threshold),
    examples: strings(src.examples, fallback.examples).slice(0, 20),
  };
}

function normalizeProfile(v: unknown, fallback: ScoringPolicyProfile): ScoringPolicyProfile {
  const src = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const thresholds = src.thresholds && typeof src.thresholds === "object" ? src.thresholds as Record<string, unknown> : {};
  const weights = src.axis_weights && typeof src.axis_weights === "object" ? src.axis_weights as Record<string, unknown> : {};
  const fallbackExceptions = fallback.global_exceptions;
  const rawExceptions = Array.isArray(src.global_exceptions) ? src.global_exceptions : fallbackExceptions;
  const authorOverrides: ScoringPolicyProfile["author_overrides"] = {};
  if (src.author_overrides && typeof src.author_overrides === "object") {
    for (const [rawHandle, rawRule] of Object.entries(src.author_overrides as Record<string, unknown>)) {
      const handle = rawHandle.toLowerCase().replace(/^@/, "").trim();
      if (!handle) continue;
      if (rawRule === "always_deliver" || rawRule === "always_skip" || rawRule === "always_review") {
        authorOverrides[handle] = rawRule;
      }
    }
  }

  const axisWeights = {} as Record<ScoringV2AxisKey, number>;
  for (const key of SCORING_V2_AXIS_KEYS) {
    axisWeights[key] = clampNumber(weights[key], 0, 5, fallback.axis_weights[key]);
  }

  return {
    id: typeof src.id === "string" && src.id.trim() ? src.id.trim().slice(0, 80) : fallback.id,
    name: typeof src.name === "string" && src.name.trim() ? src.name.trim().slice(0, 120) : fallback.name,
    audience_description: typeof src.audience_description === "string" && src.audience_description.trim()
      ? src.audience_description.slice(0, 2000)
      : fallback.audience_description,
    focus_entities: strings(src.focus_entities, fallback.focus_entities),
    aliases: strings(src.aliases, fallback.aliases),
    geographies: strings(src.geographies, fallback.geographies),
    blocked_categories: strings(src.blocked_categories, fallback.blocked_categories),
    prompt_notes: typeof src.prompt_notes === "string" ? src.prompt_notes.slice(0, 4000) : fallback.prompt_notes,
    thresholds: {
      direct_focus: normalizeClassRule(thresholds.direct_focus, fallback.thresholds.direct_focus),
      adjacent: normalizeClassRule(thresholds.adjacent, fallback.thresholds.adjacent),
      global_exception: normalizeClassRule(thresholds.global_exception, fallback.thresholds.global_exception),
      off_topic: normalizeClassRule(thresholds.off_topic, fallback.thresholds.off_topic),
    },
    global_exceptions: rawExceptions.slice(0, 30).map((item, index) => normalizeException(item, fallbackExceptions[index] ?? fallbackExceptions[0])),
    review_only_exception_ids: strings(src.review_only_exception_ids, fallback.review_only_exception_ids).slice(0, 30),
    axis_weights: axisWeights,
    author_overrides: authorOverrides,
  };
}

export function normalizeScoringPolicy(raw: unknown): ScoringPolicy {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const profilesRaw = Array.isArray(src.profiles) && src.profiles.length > 0 ? src.profiles : DEFAULT_SCORING_POLICY.profiles;
  const profiles = profilesRaw.slice(0, 50).map((profile, index) => normalizeProfile(
    profile,
    index === 0 ? DEFAULT_IRAN_FIRST_SCORING_PROFILE : { ...DEFAULT_IRAN_FIRST_SCORING_PROFILE, id: `profile-${index + 1}`, name: `Profile ${index + 1}` },
  ));
  const active = typeof src.active_profile_id === "string" && profiles.some((p) => p.id === src.active_profile_id)
    ? src.active_profile_id
    : profiles[0].id;
  const adj = src.adjudication && typeof src.adjudication === "object" ? src.adjudication as Record<string, unknown> : {};
  const learning = src.learning && typeof src.learning === "object" ? src.learning as Record<string, unknown> : {};
  return {
    enabled: src.enabled === true,
    version: SCORING_POLICY_VERSION,
    mode: src.mode === "active" ? "active" : "shadow",
    active_profile_id: active,
    profiles,
    adjudication: {
      enabled: adj.enabled !== false,
      model: typeof adj.model === "string" && adj.model.trim() ? adj.model.trim().slice(0, 100) : DEFAULT_SCORING_POLICY.adjudication.model,
      reasoning_effort: ["minimal", "low", "medium", "high"].includes(String(adj.reasoning_effort)) ? adj.reasoning_effort as "minimal" | "low" | "medium" | "high" : "low",
      verbosity: ["low", "medium", "high"].includes(String(adj.verbosity)) ? adj.verbosity as "low" | "medium" | "high" : "low",
      confidence_threshold: clampNumber(adj.confidence_threshold, 0.5, 0.95, DEFAULT_SCORING_POLICY.adjudication.confidence_threshold),
      borderline_margin: clampNumber(adj.borderline_margin, 0, 4, DEFAULT_SCORING_POLICY.adjudication.borderline_margin),
    },
    learning: {
      mode: learning.mode === "applied" ? "applied" : learning.mode === "human_only" ? "human_only" : "shadow",
      min_examples: Math.round(clampNumber(learning.min_examples, 1, 200, DEFAULT_SCORING_POLICY.learning.min_examples)),
      max_adjustment: clampNumber(learning.max_adjustment, 0, 5, DEFAULT_SCORING_POLICY.learning.max_adjustment),
    },
  };
}

export function getActiveScoringProfile(policy: ScoringPolicy, profileId?: string | null): ScoringPolicyProfile {
  const id = profileId || policy.active_profile_id;
  return policy.profiles.find((profile) => profile.id === id) ?? policy.profiles[0] ?? DEFAULT_IRAN_FIRST_SCORING_PROFILE;
}

export function parseScoringV2Axes(raw: unknown): ScoringV2Axes {
  const out: ScoringV2Axes = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of SCORING_V2_AXIS_KEYS) {
    out[key] = Math.round(clampNumber(src[key], 0, 10, 0));
  }
  return out;
}

export function computeScoringV2AxisScore(axes: ScoringV2Axes, weights: Record<ScoringV2AxisKey, number>): number {
  let weighted = 0;
  let max = 0;
  for (const key of SCORING_V2_AXIS_KEYS) {
    if (key === "noise_penalty") continue;
    const w = Math.max(0, weights[key] ?? 0);
    weighted += (axes[key] ?? 0) * w;
    max += 10 * w;
  }
  const positive = max > 0 ? (weighted / max) * 20 : 0;
  const noise = ((axes.noise_penalty ?? 0) / 10) * 8 * Math.max(0, weights.noise_penalty ?? 1);
  return Math.max(1, Math.min(20, Math.round((positive - noise) * 10) / 10));
}

function getClassRule(profile: ScoringPolicyProfile, audienceClass: AudienceClass, exceptionClass: string | null): ScoringClassRule {
  if (audienceClass === "global_exception" && exceptionClass) {
    const exception = profile.global_exceptions.find((rule) => rule.id === exceptionClass);
    if (exception) return { cap: exception.cap, threshold: exception.threshold };
  }
  return profile.thresholds[audienceClass] ?? profile.thresholds.off_topic;
}

function normalizeAudienceClass(v: unknown): AudienceClass {
  return AUDIENCE_CLASSES.includes(v as AudienceClass) ? v as AudienceClass : "off_topic";
}

function matchedRegionalEscalationTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return REGIONAL_ESCALATION_TERMS.filter((term) => lower.includes(term));
}

function normalizeModelResult(rawArgs: Record<string, unknown>, profile: ScoringPolicyProfile): Omit<ScoringPolicyResult, "ok" | "version" | "profile_id" | "profile_name" | "delivery_decision" | "decision_reason" | "review_status" | "adjudicated" | "usage"> {
  const audienceClass = normalizeAudienceClass(rawArgs.audience_class);
  const globalExceptionClass = audienceClass === "global_exception" && typeof rawArgs.global_exception_class === "string"
    ? rawArgs.global_exception_class.trim() || null
    : null;
  const axes = parseScoringV2Axes(rawArgs.axes);
  const rawPriority = Math.round(clampNumber(rawArgs.priority_score, 1, 20, rawArgs.importance_score as number ?? 10));
  const axisScore = computeScoringV2AxisScore(axes, profile.axis_weights);
  const uncapped = Math.round(((rawPriority * 0.55) + (axisScore * 0.45)) * 10) / 10;
  const rule = getClassRule(profile, audienceClass, globalExceptionClass);
  const finalScore = Math.min(rule.cap, uncapped);
  return {
    audience_class: audienceClass,
    audience_confidence: Math.round(clampNumber(rawArgs.audience_confidence, 0, 1, 0.5) * 100) / 100,
    audience_reason: typeof rawArgs.audience_reason === "string" && rawArgs.audience_reason.trim()
      ? rawArgs.audience_reason.trim().slice(0, 1000)
      : (typeof rawArgs.reasoning === "string" ? rawArgs.reasoning.slice(0, 1000) : "No audience reason returned"),
    global_exception_class: globalExceptionClass,
    axes,
    raw_priority_score: rawPriority,
    uncapped_score: uncapped,
    final_score: Math.round(finalScore * 10) / 10,
    threshold: rule.threshold,
    cap: rule.cap,
    tags: strings(rawArgs.tags).slice(0, 20),
    raw: rawArgs,
  };
}

export function finalizeScoringPolicyResult(
  rawArgs: Record<string, unknown>,
  policy: ScoringPolicy,
  profile: ScoringPolicyProfile,
  authorHandle?: string | null,
  postText = "",
): ScoringPolicyResult {
  const base = normalizeModelResult(rawArgs, profile);
  const handle = (authorHandle ?? "").toLowerCase().replace(/^@/, "");
  const authorRule = handle ? profile.author_overrides[handle] : undefined;
  let decision: "deliver" | "skip" = base.final_score >= base.threshold ? "deliver" : "skip";
  let reason = `scoring_v2:${base.audience_class}:${base.final_score.toFixed(1)}>=${base.threshold}`;
  if (base.final_score < base.threshold) reason = `scoring_v2_below:${base.audience_class}:${base.final_score.toFixed(1)}<${base.threshold}`;
  let reviewStatus: "none" | "shadow" | "needs_review" = shouldAdjudicate(base, policy) || authorRule === "always_review" ? "needs_review" : "none";
  const originalDecision = decision;
  const originalThreshold = base.threshold;
  const originalReviewStatus = reviewStatus;
  let appliedRule: ScoringPolicyAppliedRule | null = null;

  if (base.audience_class === "global_exception" && base.global_exception_class && profile.review_only_exception_ids.includes(base.global_exception_class)) {
    decision = "skip";
    reviewStatus = "needs_review";
    reason = `scoring_v2_review_only_exception:${base.global_exception_class}:${base.final_score.toFixed(1)}>=${base.threshold}`;
    appliedRule = {
      kind: "global_mega_event_review",
      original_decision: originalDecision,
      original_threshold: originalThreshold,
      original_review_status: originalReviewStatus,
      matched_terms: [base.global_exception_class],
      reason: "Global mega-event pilot is review-only and cannot auto-deliver.",
    };
  } else if (
    authorRule !== "always_skip" &&
    base.audience_class === "adjacent" &&
    decision === "skip" &&
    base.final_score >= 10 &&
    base.final_score < base.threshold
  ) {
    const matchedTerms = matchedRegionalEscalationTerms(postText);
    if (matchedTerms.length > 0) {
      decision = "deliver";
      reviewStatus = authorRule === "always_review" ? "needs_review" : "none";
      reason = `scoring_v2_rule:regional_escalation_auto:${base.final_score.toFixed(1)}<${base.threshold}`;
      appliedRule = {
        kind: "regional_escalation_auto",
        original_decision: originalDecision,
        original_threshold: originalThreshold,
        original_review_status: originalReviewStatus,
        matched_terms: matchedTerms,
        reason: "Adjacent regional-security or Gulf/oil escalation item promoted by policy rule.",
      };
    }
  }

  if (authorRule === "always_deliver" && appliedRule?.kind !== "global_mega_event_review") {
    decision = "deliver";
    reason = `scoring_v2_author:always_deliver:@${handle}`;
  } else if (authorRule === "always_skip") {
    decision = "skip";
    reason = `scoring_v2_author:always_skip:@${handle}`;
  }
  return {
    ok: true,
    version: SCORING_POLICY_VERSION,
    profile_id: profile.id,
    profile_name: profile.name,
    ...base,
    delivery_decision: decision,
    decision_reason: reason,
    review_status: reviewStatus,
    adjudicated: false,
    policy_rule_applied: appliedRule,
    usage: {},
  };
}

export function buildScoringPolicyEventMeta(result: ScoringPolicyResult, mode: ScoringPolicyMode): ScoringPolicyEventMeta {
  return {
    version: SCORING_POLICY_VERSION,
    mode,
    profile_id: result.profile_id,
    audience_class: result.audience_class,
    audience_confidence: result.audience_confidence,
    audience_reason: result.audience_reason,
    global_exception_class: result.global_exception_class,
    raw_priority_score: result.raw_priority_score,
    uncapped_score: result.uncapped_score,
    final_score: result.final_score,
    threshold: result.threshold,
    cap: result.cap,
    decision: result.delivery_decision,
    decision_reason: result.decision_reason,
    review_status: result.review_status,
    adjudicated: result.adjudicated,
    ...(result.adjudication_reason ? { adjudication_reason: result.adjudication_reason } : {}),
    ...(result.policy_rule_applied ? {
      policy_rule_applied: result.policy_rule_applied.kind,
      policy_rule: result.policy_rule_applied,
    } : {}),
    tags: result.tags,
  };
}

export function shouldAdjudicate(
  result: Pick<ScoringPolicyResult, "audience_confidence" | "audience_class" | "final_score" | "threshold">,
  policy: ScoringPolicy,
): boolean {
  if (!policy.adjudication.enabled) return false;
  if (result.audience_confidence < policy.adjudication.confidence_threshold) return true;
  if (result.audience_class === "global_exception") return true;
  return Math.abs(result.final_score - result.threshold) <= policy.adjudication.borderline_margin;
}

function stillNeedsReviewAfterAdjudication(
  result: Pick<ScoringPolicyResult, "audience_confidence" | "final_score" | "threshold">,
  policy: ScoringPolicy,
): boolean {
  return result.audience_confidence < policy.adjudication.confidence_threshold;
}

function renderProfileForPrompt(profile: ScoringPolicyProfile): string {
  return JSON.stringify({
    name: profile.name,
    audience_description: profile.audience_description,
    focus_entities: profile.focus_entities,
    aliases: profile.aliases,
    geographies: profile.geographies,
    blocked_categories: profile.blocked_categories,
    thresholds: profile.thresholds,
    global_exceptions: profile.global_exceptions,
    prompt_notes: profile.prompt_notes,
  }, null, 2);
}

function scoringTool(): ToolFunctionDef {
  return {
    name: "score_for_audience",
    description: "Classify audience fit and score a news item for the configured editorial profile.",
    parameters: {
      type: "object",
      properties: {
        audience_class: { type: "string", enum: [...AUDIENCE_CLASSES] },
        audience_confidence: { type: "number", minimum: 0, maximum: 1 },
        audience_reason: { type: "string" },
        global_exception_class: {
          type: "string",
          description: "Configured global exception id, or an empty string when not applicable.",
        },
        priority_score: { type: "integer", minimum: 1, maximum: 20 },
        axes: {
          type: "object",
          properties: Object.fromEntries(SCORING_V2_AXIS_KEYS.map((key) => [key, { type: "integer", minimum: 0, maximum: 10 }])),
          required: [...SCORING_V2_AXIS_KEYS],
        },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["audience_class", "audience_confidence", "audience_reason", "priority_score", "axes", "tags"],
    },
  };
}

function adjudicationTool(): ToolFunctionDef {
  return {
    name: "adjudicate_audience_score",
    description: "Review an initial audience-fit score and return corrected fields if the first pass was wrong or borderline.",
    parameters: scoringTool().parameters,
  };
}

function renderCalibrationExamples(examples: ScoringPolicyCalibrationExample[] = []): string {
  const normalized = examples
    .filter((example) => typeof example.text_original === "string" && example.text_original.trim())
    .slice(0, 8)
    .map((example, index) => ({
      n: index + 1,
      author: example.author_handle ? `@${example.author_handle.replace(/^@/, "")}` : "unknown",
      expected_audience_class: example.expected_audience_class,
      expected_decision: example.expected_decision,
      expected_score: typeof example.expected_score === "number" ? example.expected_score : null,
      expected_global_exception_class: example.expected_global_exception_class ?? null,
      note: example.note ?? null,
      text: example.text_original.slice(0, 700),
    }));
  if (normalized.length === 0) return "";
  return `\n\nRecent human calibration examples:\n${JSON.stringify(normalized, null, 2)}\nUse these examples to calibrate audience fit, but still apply the policy to the current item.`;
}

function renderScoringPrompt(profile: ScoringPolicyProfile, calibrationExamples: ScoringPolicyCalibrationExample[] = []): string {
  return `You are the audience-fit scorer for an automated news account.

Use ONLY the provided scoring policy. Do not enforce duplicate detection; that already ran before this step.

Audience classes:
- direct_focus: the item is directly about the profile focus entities, aliases, geography, or mandate.
- adjacent: the item materially affects, discusses, or changes the context around the focus, but the focus is not the main subject.
- global_exception: the item is not focus-specific, but it is a major world event explicitly covered by the profile's exception rules.
- off_topic: routine or unrelated content for this audience.

Policy:
${renderProfileForPrompt(profile)}

Scoring rules:
- Return a 1-20 priority_score before caps.
- Use the neutral axes exactly as requested.
- Apply blocked categories by lowering audience_class to off_topic when appropriate.
- A global exception must match one configured exception id; otherwise choose off_topic.
- Be narrow by default. Broad world news only passes when it is truly exceptional for this profile.
- Explain the audience fit in audience_reason.${renderCalibrationExamples(calibrationExamples)}`;
}

function renderPostInput(input: ScoringPolicyPostInput): string {
  return `Author: ${input.author_handle ? `@${input.author_handle}` : "unknown"}${input.account_name ? ` (${input.account_name})` : ""}
Published: ${input.published_at ?? "unknown"}
URL: ${input.url ?? "N/A"}

Content:
${input.text}`;
}

async function parseToolResult(response: NormalizedOpenAIResponse): Promise<Record<string, unknown>> {
  if (!response.ok) {
    return { error: `OpenAI ${response.status}: ${response.rawText.slice(0, 500)}` };
  }
  if (!response.toolCall?.arguments) return { error: "missing_score_tool_call" };
  try {
    return JSON.parse(response.toolCall.arguments) as Record<string, unknown>;
  } catch (e) {
    return { error: `invalid_score_tool_json:${(e as Error).message}` };
  }
}

export async function runScoringPolicy(
  input: ScoringPolicyPostInput,
  policyInput: ScoringPolicy | unknown,
  modelOptions: ScoringPolicyModelOptions,
  opts: {
    profileId?: string | null;
    forceAdjudication?: boolean;
    calibrationExamples?: ScoringPolicyCalibrationExample[];
    callOpenAIImpl?: typeof callOpenAI;
  } = {},
): Promise<ScoringPolicyResult> {
  const policy = normalizeScoringPolicy(policyInput);
  const profile = getActiveScoringProfile(policy, opts.profileId);
  const call = opts.callOpenAIImpl ?? callOpenAI;
  const calibrationExamples = opts.calibrationExamples ?? [];
  const scoringResponse = await call({
    apiKey: modelOptions.apiKey,
    model: modelOptions.model || "gpt-5.4-mini",
    messages: [
      { role: "system", content: renderScoringPrompt(profile, calibrationExamples) },
      { role: "user", content: renderPostInput(input) },
    ],
    tool: scoringTool(),
    maxOutputTokens: modelOptions.maxOutputTokens ?? 4000,
    temperature: modelOptions.temperature,
    topP: modelOptions.topP,
    reasoningEffort: modelOptions.reasoningEffort ?? "high",
    verbosity: modelOptions.verbosity ?? "low",
    seed: modelOptions.seed,
    serviceTier: modelOptions.serviceTier,
    parallelToolCalls: modelOptions.parallelToolCalls,
  });
  const rawArgs = await parseToolResult(scoringResponse);
  if (rawArgs.error) {
    return {
      ok: false,
      version: SCORING_POLICY_VERSION,
      profile_id: profile.id,
      profile_name: profile.name,
      audience_class: "off_topic",
      audience_confidence: 0,
      audience_reason: String(rawArgs.error),
      global_exception_class: null,
      axes: {},
      raw_priority_score: 1,
      uncapped_score: 1,
      final_score: 1,
      threshold: profile.thresholds.off_topic.threshold,
      cap: profile.thresholds.off_topic.cap,
      delivery_decision: "skip",
      decision_reason: "scoring_v2_failed",
      tags: [],
      review_status: "needs_review",
      adjudicated: false,
      usage: { scoring: scoringResponse.usage },
      error: String(rawArgs.error),
    };
  }

  let result = finalizeScoringPolicyResult(rawArgs, policy, profile, input.author_handle, input.text);
  result.usage.scoring = scoringResponse.usage;
  result.raw = { scoring: scoringResponse.raw };

  if ((opts.forceAdjudication || shouldAdjudicate(result, policy)) && policy.adjudication.enabled) {
    const adjudicationResponse = await call({
      apiKey: modelOptions.apiKey,
      model: policy.adjudication.model || modelOptions.model || "gpt-5.4-mini",
      messages: [
        { role: "system", content: `${renderScoringPrompt(profile, calibrationExamples)}\n\nYou are adjudicating a borderline or low-confidence first pass. Correct it only when the evidence supports a better class or score.` },
        { role: "user", content: `${renderPostInput(input)}\n\nFirst pass:\n${JSON.stringify(result, null, 2)}` },
      ],
      tool: adjudicationTool(),
      maxOutputTokens: modelOptions.maxOutputTokens ?? 4000,
      reasoningEffort: policy.adjudication.reasoning_effort,
      verbosity: policy.adjudication.verbosity,
      topP: modelOptions.topP,
      seed: modelOptions.seed,
      serviceTier: modelOptions.serviceTier,
      parallelToolCalls: modelOptions.parallelToolCalls,
    });
    const adjudicatedArgs = await parseToolResult(adjudicationResponse);
    if (!adjudicatedArgs.error) {
      const next = finalizeScoringPolicyResult(adjudicatedArgs, policy, profile, input.author_handle, input.text);
      result = {
        ...next,
        review_status: next.policy_rule_applied?.kind === "global_mega_event_review"
          ? "needs_review"
          : stillNeedsReviewAfterAdjudication(next, policy) ? "needs_review" : "none",
        adjudicated: true,
        adjudication_reason: "borderline_or_low_confidence",
        usage: { scoring: scoringResponse.usage, adjudication: adjudicationResponse.usage },
        raw: { scoring: scoringResponse.raw, adjudication: adjudicationResponse.raw },
      };
    } else {
      result = {
        ...result,
        review_status: "needs_review",
        adjudicated: false,
        adjudication_reason: String(adjudicatedArgs.error),
        usage: { scoring: scoringResponse.usage, adjudication: adjudicationResponse.usage },
      };
    }
  }

  return result;
}
