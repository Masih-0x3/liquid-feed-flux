// Algorithm-aware enrichment pipeline:
// Archivist + Researcher (parallel) -> Creator Analyst -> Humanizer -> Composer -> Critic/Gate
import { callOpenAI } from "./openai.ts";

export interface EnrichmentConfig {
  enabled: boolean;
  model: string;
  version: string;
  mode: "creator_analysis" | "legacy";
  pipeline_mode: "manual_only" | "shadow_review" | "required_for_x";
  review_mode: "shadow_review" | "auto_high_confidence" | "manual_only";
  source_attribution_policy: "compact" | "always" | "none";
  analyst_prompt: string;
  researcher_prompt: string;
  humanizer_prompt: string;
  archivist_prompt: string;
  composer_prompt: string;
  critic_prompt: string;
  max_research_tokens: number;
  max_analysis_tokens: number;
  max_humanizer_tokens: number;
  max_archivist_tokens: number;
  max_composer_tokens: number;
  max_critic_tokens: number;
  skip_research_below_score: number;
  archivist_lookback_days: number;
  archivist_max_posts: number;
  require_approval: boolean;
  thread_above_score: number;
  banned_phrases: string[];
  aggregator_review_threshold: number;
  aggregator_reject_threshold: number;
  ai_voice_review_threshold: number;
  ai_voice_reject_threshold: number;
  same_source_window_hours: number;
  same_source_review_threshold: number;
  research_cache_hours: number;
  min_creator_angle_chars: number;
}

export interface VoiceSamples {
  samples: string[];
  updated_at: string | null;
}

export interface ArchivistOutput {
  has_callback: boolean;
  callback_type: "continuation" | "validation" | "contradiction" | "thematic" | null;
  callback_suggestion: string | null;
  referenced_post_id: string | null;
  narrative_summary: string | null;
}

export interface ResearcherOutput {
  background_summary: string;
  key_facts: string[];
  related_events: string;
  sources: string[];
  cached?: boolean;
}

export interface AnalystOutput {
  commentary: string;
  hook: string;
  suggested_question: string | null;
  uses_callback: boolean;
  significance: string;
  creator_angle: string;
  why_it_matters: string;
}

export interface HumanizerOutput {
  humanized_commentary: string;
  humanized_hook: string;
  humanized_question: string | null;
  changes_made: string;
}

export interface ComposerOutput {
  opinion_section: string;
  final_x_text: string;
  creator_angle: string;
  why_it_matters: string;
  source_context: {
    attribution_policy: EnrichmentConfig["source_attribution_policy"];
    source_label: string | null;
    source_url: string | null;
    sources: string[];
  };
  format_used: string;
  thread_continuation: string | null;
}

export interface AlgorithmSignalScores {
  reply: number;
  repost_share: number;
  dwell: number;
  profile_follow: number;
  not_interested: number;
  mute_block_report: number;
}

export interface CriticOutput {
  algorithm_signal_scores: AlgorithmSignalScores;
  aggregator_risk_score: number;
  ai_voice_risk_score: number;
  monetization_risk_flags: string[];
  publish_recommendation: "approve" | "needs_human_review" | "reject";
  enrichment_review_reason: string;
}

export interface AntiAggregatorGateOutput {
  aggregator_risk_score: number;
  monetization_risk_flags: string[];
  publish_recommendation: "approve" | "needs_human_review" | "reject";
  reason: string;
}

export interface EnrichResult {
  archivist: ArchivistOutput | null;
  researcher: ResearcherOutput | null;
  analyst: AnalystOutput;
  humanizer: HumanizerOutput;
  composer: ComposerOutput;
  critic: CriticOutput;
  antiAggregator: AntiAggregatorGateOutput;
  publishRecommendation: "approve" | "needs_human_review" | "reject";
  enrichmentReviewReason: string;
  totalTokens: number;
  durationMs: number;
}

interface RecentPost {
  tweet_id: string;
  text_translated: string | null;
  editorial_commentary: string | null;
  commentary_hook: string | null;
  importance_score: number | null;
  tweeted_at: string | null;
}

// Style modifiers randomly injected per run for variety
const STYLE_MODIFIERS = [
  'Use a provocative rhetorical question that challenges the regime narrative.',
  'Be unusually blunt and short -- 2 punchy sentences max. Hit hard, move on.',
  'Point out the hypocrisy or ironic contrast in the situation.',
  'Use dry sarcasm -- mock the regime or its apologists.',
  'Connect this to a broader pattern of regime behavior over the past decades.',
  'Focus on what this means for ordinary Iranians -- the people on the street.',
  'Channel righteous anger -- this is about real people suffering under a theocracy.',
  'Use a vivid metaphor that makes the political situation visceral.',
  'Be analytical and strategic -- focus on what this means for the power balance.',
  'Write as if explaining to a friend in a voice message -- raw and unfiltered.',
  'Start with the most damning or counterintuitive angle the mainstream misses.',
  'Use the language young Iranians on social media would use -- informal, fiery, zero respect for the regime.',
  'Frame this in terms of the larger freedom movement -- where does this fit in the arc toward regime change?',
  'Mock the Western appeasement angle if relevant -- "بازم مذاکره؟"',
  'Name the human cost explicitly -- prisoners, families, lives destroyed.',
];

const DEFAULT_BANNED_PHRASES = [
  "BREAKING",
  "Breaking",
  "فوری",
  "قابل توجه است",
  "جالب است که",
  "لازم به ذکر است",
  "در همین راستا",
];

const DEFAULT_ENRICHMENT_CONFIG: EnrichmentConfig = {
  enabled: false,
  model: "gpt-5.4-mini",
  version: "creator-analysis-v2",
  mode: "creator_analysis",
  pipeline_mode: "manual_only",
  review_mode: "shadow_review",
  source_attribution_policy: "compact",
  analyst_prompt: "You are the editorial voice of a Persian-language X account writing original creator analysis for Iranian audiences. Add context, implication, contradiction, pattern, human consequence, or strategic reading. Do not simply summarize the source.",
  researcher_prompt: "You are a senior news researcher specializing in Iran, the Middle East, and US foreign policy. Return factual background only.",
  humanizer_prompt: "Rewrite Persian analysis so it sounds like a real Iranian commentator, not an AI system or news anchor.",
  archivist_prompt: "You are an editorial archivist. Identify narrative connections to recent coverage only when they genuinely add value.",
  composer_prompt: "You are a Persian X editor. Compose a creator-quality post that leads with original analysis, then the factual news, then compact context if useful.",
  critic_prompt: "You are a strict X creator-quality critic. Judge whether this Persian post adds original creator value, avoids aggregator/clickbait patterns, and is likely to earn healthy replies, reposts, dwell, profile clicks, and follows without causing mute/block/report/not-interested reactions. Be conservative.",
  max_research_tokens: 4000,
  max_analysis_tokens: 2000,
  max_humanizer_tokens: 2000,
  max_archivist_tokens: 2000,
  max_composer_tokens: 2000,
  max_critic_tokens: 2000,
  skip_research_below_score: 16,
  archivist_lookback_days: 3,
  archivist_max_posts: 10,
  require_approval: true,
  thread_above_score: 18,
  banned_phrases: DEFAULT_BANNED_PHRASES,
  aggregator_review_threshold: 35,
  aggregator_reject_threshold: 70,
  ai_voice_review_threshold: 35,
  ai_voice_reject_threshold: 70,
  same_source_window_hours: 6,
  same_source_review_threshold: 3,
  research_cache_hours: 24,
  min_creator_angle_chars: 80,
};

export function normalizeEnrichmentConfig(raw: Partial<EnrichmentConfig> | null | undefined): EnrichmentConfig {
  const input = raw ?? {};
  const cfg = { ...DEFAULT_ENRICHMENT_CONFIG, ...input } as EnrichmentConfig;
  cfg.version = cfg.version || "creator-analysis-v2";
  cfg.mode = cfg.mode || "creator_analysis";
  const requestedPipelineMode = typeof input.pipeline_mode === "string" ? input.pipeline_mode : null;
  if (!requestedPipelineMode || !["manual_only", "shadow_review", "required_for_x"].includes(requestedPipelineMode)) {
    cfg.pipeline_mode = cfg.enabled
      ? cfg.review_mode === "manual_only" ? "manual_only" : "shadow_review"
      : "manual_only";
  }
  cfg.review_mode = cfg.review_mode || "shadow_review";
  cfg.source_attribution_policy = cfg.source_attribution_policy || "compact";
  cfg.model = cfg.model || "gpt-5.4-mini";
  cfg.banned_phrases = Array.isArray(cfg.banned_phrases) && cfg.banned_phrases.length > 0 ? cfg.banned_phrases : DEFAULT_BANNED_PHRASES;
  cfg.aggregator_review_threshold = clampNumber(cfg.aggregator_review_threshold, 0, 100, 35);
  cfg.aggregator_reject_threshold = clampNumber(cfg.aggregator_reject_threshold, cfg.aggregator_review_threshold, 100, 70);
  cfg.ai_voice_review_threshold = clampNumber(cfg.ai_voice_review_threshold, 0, 100, 35);
  cfg.ai_voice_reject_threshold = clampNumber(cfg.ai_voice_reject_threshold, cfg.ai_voice_review_threshold, 100, 70);
  cfg.same_source_window_hours = clampNumber(cfg.same_source_window_hours, 1, 72, 6);
  cfg.same_source_review_threshold = clampNumber(cfg.same_source_review_threshold, 1, 20, 3);
  cfg.research_cache_hours = clampNumber(cfg.research_cache_hours, 0, 168, 24);
  cfg.min_creator_angle_chars = clampNumber(cfg.min_creator_angle_chars, 20, 400, 80);
  cfg.max_critic_tokens = clampNumber(cfg.max_critic_tokens, 500, 8000, 2000);
  return cfg;
}

export function isAutoEnrichmentEnabled(config: EnrichmentConfig): boolean {
  return config.enabled === true && config.pipeline_mode !== "manual_only";
}

export function doesEnrichmentBlockX(config: EnrichmentConfig): boolean {
  return config.enabled === true && config.pipeline_mode === "required_for_x";
}

export function allowCompletedEnrichmentForPosting(config: EnrichmentConfig): boolean {
  return config.require_approval === false && config.review_mode === "auto_high_confidence";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomTopP(): number {
  return 0.85 + Math.random() * 0.15; // 0.85 - 1.0
}

function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function charLen(text: string | null | undefined): number {
  return cleanText(text).length;
}

function tokenize(text: string): string[] {
  return cleanText(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function overlapRatio(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = new Set(tokenize(b));
  if (aTokens.length === 0 || bTokens.size === 0) return 0;
  let matches = 0;
  for (const token of aTokens) if (bTokens.has(token)) matches++;
  return matches / aTokens.length;
}

function clampScore(value: unknown, fallback = 0): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampSignal(value: unknown, fallback = 3): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function forceArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function combineRecommendation(
  a: "approve" | "needs_human_review" | "reject",
  b: "approve" | "needs_human_review" | "reject",
): "approve" | "needs_human_review" | "reject" {
  if (a === "reject" || b === "reject") return "reject";
  if (a === "needs_human_review" || b === "needs_human_review") return "needs_human_review";
  return "approve";
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeResearchCacheKey(sourceUrl: string | null | undefined, textOriginal: string): Promise<string> {
  const source = cleanText(sourceUrl) || cleanText(textOriginal).slice(0, 800);
  return `enrich-research-v2:${await sha256Hex(source)}`;
}

export function evaluateAntiAggregatorGate(params: {
  config: EnrichmentConfig;
  finalText: string;
  textTranslated: string;
  creatorAngle: string;
  whyItMatters: string;
  formatUsed: string | null;
  previousFormatUsed: string | null;
  sameSourceRecentCount: number;
}): AntiAggregatorGateOutput {
  const flags: string[] = [];
  const text = cleanText(params.finalText);
  const creatorAngleLength = charLen(params.creatorAngle);
  const whyLength = charLen(params.whyItMatters);
  const copyRatio = overlapRatio(text, params.textTranslated);
  const hashtagCount = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const bannedHits = params.config.banned_phrases.filter((phrase) => phrase && text.toLowerCase().includes(phrase.toLowerCase()));
  const repeatedFormat = params.formatUsed && params.previousFormatUsed?.split(",").map((f) => f.trim()).includes(params.formatUsed);

  if (bannedHits.length > 0) flags.push(`banned_phrase:${bannedHits.slice(0, 3).join("|")}`);
  if (creatorAngleLength < params.config.min_creator_angle_chars) flags.push("thin_creator_angle");
  if (whyLength < 30) flags.push("thin_why_it_matters");
  if (copyRatio > 0.72 && creatorAngleLength < params.config.min_creator_angle_chars * 1.25) flags.push("mostly_translated_source_text");
  if (hashtagCount > 2) flags.push("excessive_hashtags");
  if (repeatedFormat) flags.push("repeated_format");
  if (params.sameSourceRecentCount >= params.config.same_source_review_threshold) flags.push("same_source_density");

  let risk = 0;
  risk += Math.round(copyRatio * 25);
  risk += Math.max(0, params.config.min_creator_angle_chars - creatorAngleLength) > 0 ? 20 : 0;
  risk += Math.max(0, 30 - whyLength) > 0 ? 10 : 0;
  risk += bannedHits.length * 15;
  risk += hashtagCount > 2 ? 10 : 0;
  risk += repeatedFormat ? 10 : 0;
  risk += params.sameSourceRecentCount >= params.config.same_source_review_threshold ? 12 : 0;
  risk = Math.max(0, Math.min(100, risk));

  let publishRecommendation: AntiAggregatorGateOutput["publish_recommendation"] = "approve";
  if (risk >= params.config.aggregator_reject_threshold || flags.includes("mostly_translated_source_text") || bannedHits.length >= 2) {
    publishRecommendation = "reject";
  } else if (risk >= params.config.aggregator_review_threshold || flags.length > 0) {
    publishRecommendation = "needs_human_review";
  }

  return {
    aggregator_risk_score: risk,
    monetization_risk_flags: flags,
    publish_recommendation: publishRecommendation,
    reason: flags.length > 0 ? flags.join(", ") : "Original creator analysis with low aggregator risk.",
  };
}

// deno-lint-ignore no-explicit-any
export async function runEnrichPipeline(params: {
  supabase: any;
  apiKey: string;
  config: EnrichmentConfig;
  voiceSamples: VoiceSamples;
  tweetId: string;
  textOriginal: string;
  textTranslated: string;
  importanceScore: number | null;
  previousFormatUsed: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  sameSourceRecentCount?: number;
}): Promise<EnrichResult> {
  const config = normalizeEnrichmentConfig(params.config);
  const { supabase, apiKey, voiceSamples, tweetId, textOriginal, textTranslated, importanceScore, previousFormatUsed } = params;
  const startTime = Date.now();
  let totalTokens = 0;

  const skipResearch = importanceScore !== null && config.skip_research_below_score > 0 && importanceScore < config.skip_research_below_score;
  const researchCacheKey = await makeResearchCacheKey(params.sourceUrl, textOriginal);

  // Pick a style modifier for this run
  const [styleModifier] = pickRandom(STYLE_MODIFIERS, 1);

  // Phase 1: Archivist + Researcher in parallel
  const [archivistResult, researcherResult] = await Promise.all([
    runArchivist(supabase, apiKey, config, tweetId, textOriginal, textTranslated),
    skipResearch ? Promise.resolve(null) : runResearcher(supabase, apiKey, config, tweetId, textOriginal, params.sourceUrl ?? null, researchCacheKey),
  ]);

  if (archivistResult?.usage) totalTokens += archivistResult.usage;
  if (researcherResult?.usage) totalTokens += researcherResult.usage;

  // Phase 2: Analyst
  const analystResult = await runAnalyst(apiKey, config, textOriginal, textTranslated, archivistResult?.output ?? null, researcherResult?.output ?? null, styleModifier);
  totalTokens += analystResult.usage;

  // Phase 3: Humanizer
  const humanizerResult = await runHumanizer(apiKey, config, voiceSamples, analystResult.output, styleModifier);
  totalTokens += humanizerResult.usage;

  // Phase 4: Composer
  const composerResult = await runComposer(apiKey, config, textTranslated, humanizerResult.output, analystResult.output, archivistResult?.output ?? null, researcherResult?.output ?? null, previousFormatUsed, styleModifier, params.sourceLabel ?? null, params.sourceUrl ?? null);
  totalTokens += composerResult.usage;

  const antiAggregator = evaluateAntiAggregatorGate({
    config,
    finalText: composerResult.output.final_x_text,
    textTranslated,
    creatorAngle: composerResult.output.creator_angle,
    whyItMatters: composerResult.output.why_it_matters,
    formatUsed: composerResult.output.format_used,
    previousFormatUsed,
    sameSourceRecentCount: params.sameSourceRecentCount ?? 0,
  });

  // Phase 5: Algorithm-aware Critic
  const criticResult = await runCritic(apiKey, config, textOriginal, textTranslated, composerResult.output, antiAggregator);
  totalTokens += criticResult.usage;
  const critic = criticResult.output;
  const publishRecommendation = combineRecommendation(antiAggregator.publish_recommendation, critic.publish_recommendation);
  const enrichmentReviewReason = [
    critic.enrichment_review_reason,
    antiAggregator.reason,
  ].filter(Boolean).join(" | ");

  return {
    archivist: archivistResult?.output ?? null,
    researcher: researcherResult?.output ?? null,
    analyst: analystResult.output,
    humanizer: humanizerResult.output,
    composer: composerResult.output,
    critic,
    antiAggregator,
    publishRecommendation,
    enrichmentReviewReason,
    totalTokens,
    durationMs: Date.now() - startTime,
  };
}

// ─── Agent 0: Archivist ───────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function runArchivist(supabase: any, apiKey: string, config: EnrichmentConfig, tweetId: string, textOriginal: string, textTranslated: string): Promise<{ output: ArchivistOutput; usage: number } | null> {
  try {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.archivist_lookback_days);

    const { data: recentPosts } = await supabase
      .from('posts')
      .select('tweet_id, text_translated, editorial_commentary, commentary_hook, importance_score, tweeted_at')
      .eq('delivery_decision', 'deliver')
      .neq('tweet_id', tweetId)
      .gte('created_at', lookbackDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(config.archivist_max_posts);

    if (!recentPosts || recentPosts.length === 0) {
      return { output: { has_callback: false, callback_type: null, callback_suggestion: null, referenced_post_id: null, narrative_summary: null }, usage: 0 };
    }

    const postsContext = (recentPosts as RecentPost[]).map((p, i) => {
      const text = p.text_translated || '[no translation]';
      const commentary = p.editorial_commentary ? `\nOur commentary: ${p.editorial_commentary}` : '';
      return `[${i + 1}] ID: ${p.tweet_id}\nScore: ${p.importance_score ?? '?'}\nDate: ${p.tweeted_at ?? 'unknown'}\nContent: ${text}${commentary}`;
    }).join('\n\n');

    const systemPrompt = `${config.archivist_prompt}

IMPORTANT RULES:
- You receive the news item in English (original source language).
- Your callback_suggestion MUST be written in Persian/Farsi.
- Only suggest a callback if it genuinely enriches the new post. Do not force connections.
- A callback should feel like a natural "as we reported earlier" or "this follows the pattern we noted" -- never mechanical.`;

    const tool = {
      name: 'find_narrative_thread',
      description: 'Report whether this story connects to recent coverage',
      parameters: {
        type: 'object',
        properties: {
          has_callback: { type: 'boolean', description: 'Whether a reference to past coverage is warranted' },
          callback_type: { type: 'string', enum: ['continuation', 'validation', 'contradiction', 'thematic', 'null'], description: 'Type of narrative connection, or "null" if none' },
          callback_suggestion: { type: 'string', description: 'A natural Persian phrase for referencing the prior post (e.g. "همونطور که قبلا گفتیم..."). Empty if none.' },
          referenced_post_id: { type: 'string', description: 'The tweet_id of the referenced post, or empty if none' },
          narrative_summary: { type: 'string', description: 'One sentence in English summarizing the ongoing narrative thread (internal use)' },
        },
        required: ['has_callback', 'callback_type'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `NEW STORY (English original):\n${textOriginal}\n\nRECENT POSTS we published (last ${config.archivist_lookback_days} days):\n${postsContext}` },
      ],
      tool,
      maxOutputTokens: config.max_archivist_tokens,
      topP: randomTopP(),
    });

    if (!resp.ok || !resp.toolCall) {
      console.warn('Archivist failed:', resp.status, resp.content?.slice(0, 200));
      return { output: { has_callback: false, callback_type: null, callback_suggestion: null, referenced_post_id: null, narrative_summary: null }, usage: resp.usage?.total_tokens ?? 0 };
    }

    const parsed = JSON.parse(resp.toolCall.arguments);
    const callbackType = parsed.callback_type === 'null' ? null : parsed.callback_type;

    // Validate referenced_post_id against known IDs to prevent FK violations
    // that would crash the entire enrich UPDATE and lose all 5 agents' work
    const knownIds = new Set((recentPosts as RecentPost[]).map(p => p.tweet_id));
    const rawRefId = parsed.referenced_post_id || null;
    const validatedRefId = (rawRefId && knownIds.has(rawRefId)) ? rawRefId : null;
    if (rawRefId && !validatedRefId) {
      console.warn(`Archivist returned unknown referenced_post_id "${rawRefId}" -- discarding to prevent FK violation`);
    }

    return {
      output: {
        has_callback: parsed.has_callback ?? false,
        callback_type: callbackType,
        callback_suggestion: parsed.callback_suggestion || null,
        referenced_post_id: validatedRefId,
        narrative_summary: parsed.narrative_summary || null,
      },
      usage: resp.usage?.total_tokens ?? 0,
    };
  } catch (e) {
    console.warn('Archivist error (non-fatal):', (e as Error).message);
    return null;
  }
}

// ─── Agent 1: Researcher ──────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function runResearcher(supabase: any, apiKey: string, config: EnrichmentConfig, tweetId: string, textOriginal: string, sourceUrl: string | null, cacheKey: string): Promise<{ output: ResearcherOutput; usage: number } | null> {
  try {
    if (config.research_cache_hours > 0) {
      const { data: cached } = await supabase
        .from('enrichment_research_cache')
        .select('research')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (cached?.research) {
        const research = cached.research as ResearcherOutput;
        return { output: { ...research, cached: true }, usage: 0 };
      }
    }

    const systemPrompt = `${config.researcher_prompt}

IMPORTANT RULES:
- The news item is provided in English. Research in English for best results.
- Return all text fields (background_summary, key_facts, related_events) in ENGLISH.
  The downstream agents will handle the Persian translation.
- Focus on factual context: who, what, when, where, why.
- Prioritize recent events (last 7 days) and their direct predecessors.
- Include specific numbers, dates, and names when available.`;

    const tool = {
      name: 'provide_background',
      description: 'Return structured background research for this news item',
      parameters: {
        type: 'object',
        properties: {
          background_summary: { type: 'string', description: '2-3 sentences of essential context (in English)' },
          key_facts: { type: 'array', items: { type: 'string' }, description: 'Array of specific factual bullet points with dates/numbers (in English)' },
          related_events: { type: 'string', description: 'What led to this, what happened before (in English)' },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs consulted during research' },
        },
        required: ['background_summary', 'key_facts', 'related_events', 'sources'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Research background context for this news item:\n\n${textOriginal}` },
      ],
      tool,
      builtInTools: [{ type: 'web_search' }],
      maxOutputTokens: config.max_research_tokens,
    });

    if (!resp.ok || !resp.toolCall) {
      console.warn('Researcher failed:', resp.status, resp.content?.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(resp.toolCall.arguments);
    const output: ResearcherOutput = {
      background_summary: parsed.background_summary || '',
      key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts : [],
      related_events: parsed.related_events || '',
      sources: Array.isArray(parsed.sources) ? parsed.sources : (resp.webSearchResults?.map(r => r.url) ?? []),
    };

    if (config.research_cache_hours > 0) {
      await supabase.from('enrichment_research_cache').upsert({
        cache_key: cacheKey,
        post_id: tweetId,
        source_url: sourceUrl,
        source_hash: cacheKey.replace('enrich-research-v2:', ''),
        research: output,
        model: config.model,
        expires_at: new Date(Date.now() + config.research_cache_hours * 3600 * 1000).toISOString(),
      }, { onConflict: 'cache_key' });
    }

    return { output, usage: resp.usage?.total_tokens ?? 0 };
  } catch (e) {
    console.warn('Researcher error (non-fatal):', (e as Error).message);
    return null;
  }
}

// ─── Agent 2: Analyst ─────────────────────────────────────────────────
async function runAnalyst(apiKey: string, config: EnrichmentConfig, textOriginal: string, textTranslated: string, archivist: ArchivistOutput | null, researcher: ResearcherOutput | null, styleModifier: string): Promise<{ output: AnalystOutput; usage: number }> {
  const contextParts: string[] = [];
  contextParts.push(`NEWS ITEM (English original):\n${textOriginal}`);

  if (researcher) {
    contextParts.push(`BACKGROUND RESEARCH (English):\n${researcher.background_summary}\nKey facts:\n${researcher.key_facts.map(f => `• ${f}`).join('\n')}`);
  }
  if (archivist?.has_callback && archivist.callback_suggestion) {
    contextParts.push(`NARRATIVE CALLBACK AVAILABLE:\nType: ${archivist.callback_type}\nSuggested Persian phrasing: ${archivist.callback_suggestion}\nContext: ${archivist.narrative_summary}\n\nIncorporate this callback ONLY if it genuinely adds value. Do not force it.`);
  }

  const systemPrompt = `${config.analyst_prompt}

CRITICAL INSTRUCTIONS:
- You receive the news in ENGLISH for precision. Read it carefully.
- ALL your output (commentary, hook, question) MUST be written in PERSIAN/FARSI.
- Your core job is ORIGINAL CREATOR ANALYSIS, not a translated news recap.
- Add one of these forms of value: context, implication, contradiction, broader pattern, human consequence, or strategic reading.
- The hook should make people stop and think, not scream "BREAKING" or copy a wire-service headline.
- Style direction for THIS post: ${styleModifier}
- Never start with "در خبری..." or "طبق گزارش..." -- these are AI-tells.
- Never use "قابل توجه است که" or "جالب است که" -- banned phrases.
- Never use "BREAKING", siren emojis, or generic outrage.
- Vary your sentence structure. Mix short punchy sentences with longer analytical ones.`;

  const tool = {
    name: 'compose_analysis',
    description: 'Return editorial commentary for this news item',
    parameters: {
      type: 'object',
      properties: {
        commentary: { type: 'string', description: '2-4 sentences of sharp editorial analysis in PERSIAN' },
        hook: { type: 'string', description: 'A compelling attention-grabbing opening line in PERSIAN (not a summary)' },
        suggested_question: { type: 'string', description: 'Optional provocative question in PERSIAN to drive engagement, or empty' },
        uses_callback: { type: 'boolean', description: 'Whether the narrative callback was incorporated' },
        significance: { type: 'string', description: 'One sentence on why this matters (English, internal use only)' },
        creator_angle: { type: 'string', description: 'The original Persian analytical angle that makes this more than aggregation' },
        why_it_matters: { type: 'string', description: 'A compact Persian explanation of why this matters to Iranian/X audiences' },
      },
      required: ['commentary', 'hook', 'uses_callback', 'significance', 'creator_angle', 'why_it_matters'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextParts.join('\n\n---\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_analysis_tokens,
    topP: randomTopP(),
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Analyst agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  return {
    output: {
      commentary: parsed.commentary || '',
      hook: parsed.hook || '',
      suggested_question: parsed.suggested_question || null,
      uses_callback: parsed.uses_callback ?? false,
      significance: parsed.significance || '',
      creator_angle: parsed.creator_angle || parsed.commentary || '',
      why_it_matters: parsed.why_it_matters || parsed.significance || '',
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}

// ─── Agent 3: Humanizer ───────────────────────────────────────────────
async function runHumanizer(apiKey: string, config: EnrichmentConfig, voiceSamples: VoiceSamples, analyst: AnalystOutput, styleModifier: string): Promise<{ output: HumanizerOutput; usage: number }> {
  const samplesBlock = voiceSamples.samples.length > 0
    ? `\n\nVOICE SAMPLES (real tweets from this author -- match this style):\n${voiceSamples.samples.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`
    : '';

  const systemPrompt = `${config.humanizer_prompt}
${samplesBlock}

CRITICAL INSTRUCTIONS:
- Input is in PERSIAN. Output MUST remain in PERSIAN.
- Your job: make AI-generated text sound like a human wrote it on their phone.
- Style direction for THIS post: ${styleModifier}

ANTI-AI-DETECTION TECHNIQUES (apply at least 3):
1. Vary sentence lengths aggressively (mix 3-word fragments with longer ones)
2. Use colloquial language only when it fits the voice sample; do not force slang
3. Occasionally skip formal connecting words -- use dashes or ellipses instead
4. Keep one human texture: a casual aside, a parenthetical thought, or an interrupted structure
5. Never use: "قابل توجه", "جالب است", "در همین راستا", "لازم به ذکر است"
6. Avoid cheesy slogans, fake fire, and over-performed sarcasm
7. If the text sounds like a news anchor or an AI content farm, rewrite it as a sharp human note`;

  const tool = {
    name: 'humanize_text',
    description: 'Return the humanized version of the commentary',
    parameters: {
      type: 'object',
      properties: {
        humanized_commentary: { type: 'string', description: 'The rewritten commentary matching the author voice (PERSIAN)' },
        humanized_hook: { type: 'string', description: 'The rewritten hook (PERSIAN)' },
        humanized_question: { type: 'string', description: 'The rewritten question (PERSIAN), or empty if none' },
        changes_made: { type: 'string', description: 'Brief English note on what was changed (internal)' },
      },
      required: ['humanized_commentary', 'humanized_hook', 'changes_made'],
    },
  };

  const userContent = `Rewrite this to sound authentically human. Keep the meaning but change the texture:\n\nCommentary: ${analyst.commentary}\nHook: ${analyst.hook}${analyst.suggested_question ? `\nQuestion: ${analyst.suggested_question}` : ''}`;

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    tool,
    maxOutputTokens: config.max_humanizer_tokens,
    topP: randomTopP(),
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Humanizer agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  return {
    output: {
      humanized_commentary: parsed.humanized_commentary || analyst.commentary,
      humanized_hook: parsed.humanized_hook || analyst.hook,
      humanized_question: parsed.humanized_question || null,
      changes_made: parsed.changes_made || '',
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}

// ─── Agent 4: Composer ────────────────────────────────────────────────
// The Composer now produces a full X-ready draft for creator-analysis mode
// while also keeping the legacy opinion_section populated for older UI code.
async function runComposer(
  apiKey: string,
  config: EnrichmentConfig,
  textTranslated: string,
  humanizer: HumanizerOutput,
  analyst: AnalystOutput,
  archivist: ArchivistOutput | null,
  researcher: ResearcherOutput | null,
  previousFormatUsed: string | null,
  styleModifier: string,
  sourceLabel: string | null,
  sourceUrl: string | null,
): Promise<{ output: ComposerOutput; usage: number }> {
  const components: string[] = [];
  components.push(`FACTUAL NEWS TRANSLATION (Persian):\n${textTranslated}`);
  components.push(`CREATOR ANGLE (Persian): ${analyst.creator_angle}`);
  components.push(`WHY IT MATTERS (Persian): ${analyst.why_it_matters}`);
  components.push(`COMMENTARY (Persian): ${humanizer.humanized_commentary}`);
  components.push(`HOOK (Persian): ${humanizer.humanized_hook}`);
  if (humanizer.humanized_question) components.push(`QUESTION (Persian): ${humanizer.humanized_question}`);
  if (archivist?.has_callback && archivist.callback_suggestion) {
    components.push(`NARRATIVE CALLBACK (Persian): ${archivist.callback_suggestion}`);
  }
  if (researcher?.background_summary) {
    components.push(`BACKGROUND (English, for context only): ${researcher.background_summary}`);
    if (researcher.sources?.length) components.push(`SOURCES: ${researcher.sources.slice(0, 4).join(' | ')}`);
  }
  if (sourceLabel || sourceUrl) components.push(`SOURCE ATTRIBUTION POLICY: ${config.source_attribution_policy}; Source label: ${sourceLabel ?? 'unknown'}; URL: ${sourceUrl ?? 'none'}`);

  const avoidFormats: string[] = previousFormatUsed
    ? previousFormatUsed.split(',').map(f => f.trim()).filter(Boolean)
    : [];

  const systemPrompt = `${config.composer_prompt}

CRITICAL INSTRUCTIONS:
- Your output MUST be in PERSIAN/FARSI.
- You are composing the FULL X draft.
- Lead with original creator analysis, not a wire headline.
- Include the factual news clearly, but do not let copied translation dominate the post.
- Add one compact "why this matters" or callback when it genuinely adds value.
- Compact attribution policy: ${config.source_attribution_policy}. If attribution is compact, mention the source only when it improves trust and do not make the post link-heavy.
- Target <= 260 characters before hashtags when possible; never exceed the account's 280 character formatter budget.
- Never use siren emojis, "BREAKING", "فوری", or formulaic outrage.
- Style direction: ${styleModifier}
${avoidFormats.length > 0 ? `- DO NOT use format "${avoidFormats.join('" or "')}" -- pick something different.` : ''}

FORMAT OPTIONS (choose the one that fits this content best):
- context_and_take: Brief context/background if needed, then your sharp opinion
- question_and_take: Open with a provocative question, then your opinion
- callback_take: Reference a prior story, show how this connects, give your take
- sharp_reaction: Direct punchy reaction, no preamble -- hit hard and move on
- analytical: More measured analysis with reasoning -- connect the dots
- plain_opinion: Clean short opinion, no formatting tricks

VARIETY IS CRITICAL. Each post should feel structurally different from the last.`;

  const tool = {
    name: 'compose_post',
    description: 'Write the opinion/context section that will appear below the news',
    parameters: {
      type: 'object',
      properties: {
        creator_angle: { type: 'string', description: 'Original Persian analytical angle; should stand alone as creator value.' },
        why_it_matters: { type: 'string', description: 'Compact Persian reason this matters to the audience.' },
        opinion_section: { type: 'string', description: 'Legacy opinion/context section in PERSIAN. Do not repeat the full news text here.' },
        final_x_text: { type: 'string', description: 'Full X-ready Persian draft. Lead with creator analysis, include factual news, and keep it non-clickbait.' },
        format_used: { type: 'string', enum: ['context_and_take', 'question_and_take', 'callback_take', 'sharp_reaction', 'analytical', 'plain_opinion'], description: 'Which format was chosen' },
        thread_continuation: { type: 'string', description: 'Extended analysis in PERSIAN for a reply thread if the topic warrants depth, or empty' },
      },
      required: ['creator_angle', 'why_it_matters', 'opinion_section', 'final_x_text', 'format_used'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: components.join('\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_composer_tokens,
    topP: randomTopP(),
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Composer agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  const creatorAngle = parsed.creator_angle || analyst.creator_angle || humanizer.humanized_hook || '';
  const whyItMatters = parsed.why_it_matters || analyst.why_it_matters || analyst.significance || '';
  const finalXText = parsed.final_x_text || [creatorAngle, textTranslated, whyItMatters].filter(Boolean).join('\n\n');
  const sources = researcher?.sources?.filter(Boolean) ?? [];
  return {
    output: {
      opinion_section: parsed.opinion_section || '',
      final_x_text: finalXText,
      creator_angle: creatorAngle,
      why_it_matters: whyItMatters,
      source_context: {
        attribution_policy: config.source_attribution_policy,
        source_label: sourceLabel,
        source_url: sourceUrl,
        sources,
      },
      format_used: parsed.format_used || 'plain_opinion',
      thread_continuation: parsed.thread_continuation || null,
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}

// ─── Agent 5: Algorithm-Aware Critic ─────────────────────────────────
async function runCritic(
  apiKey: string,
  config: EnrichmentConfig,
  textOriginal: string,
  textTranslated: string,
  composer: ComposerOutput,
  gate: AntiAggregatorGateOutput,
): Promise<{ output: CriticOutput; usage: number }> {
  const systemPrompt = `${config.critic_prompt}

SCORING CONTEXT:
- X's public algorithm repo describes ranking as multi-action prediction: replies, reposts/shares, clicks, dwell, profile clicks, and follow-author are positive signals.
- Negative predicted actions include not-interested, mute, block, and report.
- X's April 2026 monetization enforcement reduced payouts for rapid-fire aggregation, stolen reposts, and habitual clickbait.

STRICT RULES:
- Reward original creator analysis and useful context.
- Penalize source-copying, generic "news account" language, cheesy outrage, repeated "BREAKING/فوری" framing, and link-heavy aggregation.
- Be conservative: if monetization or authenticity risk is unclear, choose needs_human_review.`;

  const tool = {
    name: 'critique_enrichment',
    description: 'Evaluate the enriched X draft for algorithm fit, monetization safety, and human voice',
    parameters: {
      type: 'object',
      properties: {
        algorithm_signal_scores: {
          type: 'object',
          properties: {
            reply: { type: 'number', description: '1-5 likelihood of healthy replies' },
            repost_share: { type: 'number', description: '1-5 likelihood of repost/share value' },
            dwell: { type: 'number', description: '1-5 likelihood readers pause/dwell' },
            profile_follow: { type: 'number', description: '1-5 likelihood of profile click/follow-author value' },
            not_interested: { type: 'number', description: '1-5 risk of not-interested' },
            mute_block_report: { type: 'number', description: '1-5 risk of mute, block, or report' },
          },
          required: ['reply', 'repost_share', 'dwell', 'profile_follow', 'not_interested', 'mute_block_report'],
        },
        aggregator_risk_score: { type: 'number', description: '0-100 risk that this looks like aggregator/clickbait content' },
        ai_voice_risk_score: { type: 'number', description: '0-100 risk that this sounds AI-generated or cheesy' },
        monetization_risk_flags: { type: 'array', items: { type: 'string' }, description: 'Specific risk flags' },
        publish_recommendation: { type: 'string', enum: ['approve', 'needs_human_review', 'reject'] },
        enrichment_review_reason: { type: 'string', description: 'Plain-English reason for Monitoring' },
      },
      required: ['algorithm_signal_scores', 'aggregator_risk_score', 'ai_voice_risk_score', 'monetization_risk_flags', 'publish_recommendation', 'enrichment_review_reason'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `ORIGINAL SOURCE TEXT:\n${textOriginal}`,
          `PERSIAN TRANSLATION:\n${textTranslated}`,
          `CREATOR ANGLE:\n${composer.creator_angle}`,
          `WHY IT MATTERS:\n${composer.why_it_matters}`,
          `FINAL X DRAFT:\n${composer.final_x_text}`,
          `DETERMINISTIC GATE:\nRisk ${gate.aggregator_risk_score}/100; ${gate.reason}`,
        ].join('\n\n---\n\n'),
      },
    ],
    tool,
    maxOutputTokens: config.max_critic_tokens,
    reasoningEffort: 'low',
    verbosity: 'low',
  });

  if (!resp.ok || !resp.toolCall) {
    const fallbackRecommendation = gate.publish_recommendation === 'approve' ? 'needs_human_review' : gate.publish_recommendation;
    return {
      output: {
        algorithm_signal_scores: {
          reply: 3,
          repost_share: 3,
          dwell: 3,
          profile_follow: 3,
          not_interested: 3,
          mute_block_report: 3,
        },
        aggregator_risk_score: gate.aggregator_risk_score,
        ai_voice_risk_score: 50,
        monetization_risk_flags: [...gate.monetization_risk_flags, 'critic_failed'],
        publish_recommendation: fallbackRecommendation,
        enrichment_review_reason: `Critic failed; conservative review required. ${gate.reason}`,
      },
      usage: resp.usage?.total_tokens ?? 0,
    };
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  const signals = parsed.algorithm_signal_scores ?? {};
  const criticAggregatorRisk = clampScore(parsed.aggregator_risk_score, gate.aggregator_risk_score);
  const aiVoiceRisk = clampScore(parsed.ai_voice_risk_score, 50);
  const flags = [...new Set([...forceArray(parsed.monetization_risk_flags), ...gate.monetization_risk_flags])];
  let recommendation = parsed.publish_recommendation === 'approve' || parsed.publish_recommendation === 'reject'
    ? parsed.publish_recommendation
    : 'needs_human_review';

  if (criticAggregatorRisk >= config.aggregator_reject_threshold || aiVoiceRisk >= config.ai_voice_reject_threshold) {
    recommendation = 'reject';
  } else if (
    criticAggregatorRisk >= config.aggregator_review_threshold ||
    aiVoiceRisk >= config.ai_voice_review_threshold ||
    flags.length > 0
  ) {
    recommendation = recommendation === 'reject' ? 'reject' : 'needs_human_review';
  }

  return {
    output: {
      algorithm_signal_scores: {
        reply: clampSignal(signals.reply),
        repost_share: clampSignal(signals.repost_share),
        dwell: clampSignal(signals.dwell),
        profile_follow: clampSignal(signals.profile_follow),
        not_interested: clampSignal(signals.not_interested),
        mute_block_report: clampSignal(signals.mute_block_report),
      },
      aggregator_risk_score: Math.max(criticAggregatorRisk, gate.aggregator_risk_score),
      ai_voice_risk_score: aiVoiceRisk,
      monetization_risk_flags: flags,
      publish_recommendation: recommendation,
      enrichment_review_reason: parsed.enrichment_review_reason || gate.reason,
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}
