import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { callOpenAI, type ToolFunctionDef } from "../_shared/openai.ts";
import {
  applyProfileDecision,
  computeFinalScore,
  parseScoreAxes,
  type EditorialProfile,
} from "../_shared/scoring.ts";
import { recordLegacyXApiUsage, recordXApiEvent } from "../_shared/xApiLedger.ts";
import { duplicateXSkipReason } from "../_shared/duplicateGuard.ts";
import {
  allowCompletedEnrichmentForPosting,
  doesEnrichmentBlockX,
  generatePersonalVoiceProfile,
  normalizeEnrichmentConfig,
  normalizeVoiceGuide,
  type VoiceSamples,
  type EnrichmentConfig,
} from "../_shared/enrich.ts";
import {
  hasVideoIntent,
  isSendableImage,
  isValidVideoDownload,
  selectMediaTier,
  type XMediaRow,
} from "../_shared/mediaSelection.ts";
import {
  bulkReprocessAdminAction,
  cancelPendingJobsAdminAction,
  editTranslationAdminAction,
  getHealthAdminAction,
  postThreadAdminAction,
  reconcileStuckJobsAdminAction,
  reprocessAdminAction,
  retryStepAdminAction,
} from "./basicActions.ts";
import { loadActiveThreshold } from "./activeThreshold.ts";
import {
  getEnhancedDashboardSummary,
  getSystemPerformanceSummary,
} from "./dashboardSummaries.ts";
import {
  auditDuplicateCandidatesAdminAction,
  backfillDedupeAdminAction,
  backfillSignaturesAdminAction,
  runDedupeAdminAction,
} from "./dedupeActions.ts";
import {
  getMonitoringEntries,
  getMonitoringOverview,
} from "./monitoringReads.ts";
import {
  bulkIgnoreMonitoringItemsAdminAction,
  ignoreMonitoringItemAdminAction,
} from "./monitoringMutations.ts";
import {
  getVideoRenderDetail,
  getVideoRenderOverview,
  getVideoRenderQueue,
  loadVideoRenderConfigAdmin,
  retryVideoRenderAdmin,
  saveVideoRenderFeedbackAdmin,
  updateVideoRenderConfigAdmin,
} from "./videoRenderActions.ts";
import { getXApiSummary } from "./xApiSummary.ts";
import { isMyXEnabled, MY_X_DISABLED_RESPONSE } from "../_shared/myXControls.ts";
import { saveSettingsAdminAction } from "./settings.ts";
import {
  backfillScoreV2,
  loadScoringModelOptions,
  loadScoringPolicyConfig,
  previewScoringPolicy,
  promoteFeedbackToScoringExample,
  recordScoreFeedback,
  runScoringEval,
  scorePostV2,
  setManualScore,
} from "./scoringActions.ts";

const DEPLOY_SHA = Deno.env.get('DEPLOY_GIT_SHA') ?? 'unknown';
const DEPLOY_TIME = Deno.env.get('DEPLOY_TIME') ?? new Date().toISOString();

function makeCorsHeaders(req?: Request): Record<string, string> {
  const configuredOrigins = (Deno.env.get('ALLOWED_CORS_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...configuredOrigins,
    'https://xot.iraneyes.com',
    'https://xot.vercel.app',
    'https://liquid-feed-flux.lovable.app',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
  ]);
  const origin = req?.headers.get('Origin') ?? '';
  const fallbackOrigin = configuredOrigins[0] ?? 'https://xot.iraneyes.com';
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : fallbackOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

let corsHeaders = makeCorsHeaders();

// Validate JWT and check admin role
async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: missing token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAuth = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: roleData } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (!roleData) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return { userId: data.user.id };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── X API OAuth 1.0a helpers (mirrors worker/index.ts) ──────────────
const X_TEXT_ENCODER = new TextEncoder();
function xPercentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function xHmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', X_TEXT_ENCODER.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, X_TEXT_ENCODER.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function xOauthHeader(method: string, baseUrl: string, queryParams: Record<string, string>, ck: string, cs: string, at: string, ats: string): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort().map((k) => `${xPercentEncode(k)}=${xPercentEncode(allParams[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${xPercentEncode(baseUrl)}&${xPercentEncode(paramString)}`;
  const signingKey = `${xPercentEncode(cs)}&${xPercentEncode(ats)}`;
  oauthParams.oauth_signature = await xHmacSha1(signingKey, baseString);
  return `OAuth ${Object.keys(oauthParams).sort().map((k) => `${xPercentEncode(k)}="${xPercentEncode(oauthParams[k])}"`).join(', ')}`;
}
function getXCreds(): { ck: string; cs: string; at: string; ats: string } | null {
  const ck = Deno.env.get('TWITTER_CONSUMER_KEY');
  const cs = Deno.env.get('TWITTER_CONSUMER_SECRET');
  const at = Deno.env.get('TWITTER_ACCESS_TOKEN');
  const ats = Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET');
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}
// deno-lint-ignore no-explicit-any
async function recordAdminXApiAttempt(
  supabase: any,
  input: {
    action: string;
    endpoint: string;
    method?: string;
    tweetId?: string | null;
    userId?: string | null;
    error?: string | null;
    requestCounted?: boolean;
    estimatedBillableUnit?: string | null;
  },
  response?: Response | null,
  legacy?: { post?: boolean; mediaUpload?: boolean },
) {
  await recordXApiEvent(supabase, {
    source: 'admin-actions',
    sourceAction: input.action,
    endpoint: input.endpoint,
    method: input.method ?? 'GET',
    tweetId: input.tweetId ?? null,
    userId: input.userId ?? null,
    ok: response?.ok ?? false,
    status: response?.status ?? null,
    error: input.error ?? (response && !response.ok ? `HTTP ${response.status}` : null),
    requestCounted: input.requestCounted,
    estimatedBillableUnit: input.estimatedBillableUnit ?? null,
  }, response ?? null);
  if (input.requestCounted !== false) {
    await recordLegacyXApiUsage(supabase, {
      error: input.error ?? (response && !response.ok ? `${input.action}: HTTP ${response.status}` : null),
      post: legacy?.post,
      mediaUpload: legacy?.mediaUpload,
    });
  }
}

type ResolvedMedia = {
  url: string;
  type: 'video' | 'gif' | 'image';
  thumbnail_url?: string;
  resolution?: string;
  bitrate?: number;
  qualityLabel?: string;
};

function upgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('twimg.com')) {
      u.searchParams.set('name', 'orig');
      return u.toString();
    }
  } catch {
    // Keep the original URL if parsing fails.
  }
  return url;
}

function pickBestVideoVariant<T extends { url: string; bitrate?: number; content_type?: string }>(
  variants: T[],
): T | undefined {
  const mp4s = variants.filter((v) => (v.content_type ?? '').includes('mp4') || v.url.includes('.mp4'));
  const pool = mp4s.length ? mp4s : variants;
  return [...pool].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'XOT-admin-media-resolver/1.0' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveXMedia(username: string, tweetId: string) {
  try {
    const res = await fetchWithTimeout(`https://api.fxtwitter.com/${username}/status/${tweetId}`);
    if (res.ok) {
      const json = await res.json();
      const t = json?.tweet;
      if (t && (t.media?.videos?.length || t.media?.photos?.length)) {
        const media: ResolvedMedia[] = [];

        for (const v of t.media.videos ?? []) {
          const variants: Array<{ url: string; bitrate?: number; content_type?: string }> = v.variants ?? [];
          const best = pickBestVideoVariant(variants) ?? { url: v.url, bitrate: undefined };
          const w = v.width;
          const h = v.height;
          media.push({
            url: best.url,
            type: v.type === 'gif' ? 'gif' : 'video',
            thumbnail_url: v.thumbnail_url,
            resolution: w && h ? `${w}x${h}` : undefined,
            bitrate: best.bitrate ? Math.round(best.bitrate / 1000) : undefined,
            qualityLabel:
              best.bitrate && h
                ? `${h}p @ ${(best.bitrate / 1_000_000).toFixed(1)}Mbps`
                : best.bitrate
                  ? `${(best.bitrate / 1_000_000).toFixed(1)}Mbps`
                  : 'best',
          });
        }

        for (const p of t.media.photos ?? []) {
          media.push({
            url: upgradeImageUrl(p.url),
            type: 'image',
            resolution: p.width && p.height ? `${p.width}x${p.height}` : undefined,
            qualityLabel: 'original',
          });
        }

        if (media.length) {
          return {
            user_name: t.author?.name ?? username,
            user_screen_name: t.author?.screen_name ?? username,
            user_profile_image_url: t.author?.avatar_url,
            tweetID: tweetId,
            media,
          };
        }
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({ function: 'admin-actions', action: 'resolve_x_media', provider: 'fxtwitter', ok: false, error: err instanceof Error ? err.message : String(err) }));
  }

  const vxRes = await fetchWithTimeout(`https://api.vxtwitter.com/${username}/status/${tweetId}`);
  if (!vxRes.ok) {
    throw new Error('Failed to fetch tweet. The post might be private, deleted, or rate-limited.');
  }
  const vx = await vxRes.json();
  const items: ResolvedMedia[] = (vx.media_extended ?? []).map(
    (m: { url: string; type: string; thumbnail_url?: string; size?: { width?: number; height?: number } }) => {
      const isVideo = m.type === 'video' || m.type === 'gif';
      return {
        url: isVideo ? m.url : upgradeImageUrl(m.url),
        type: (m.type as 'video' | 'gif' | 'image') ?? 'image',
        thumbnail_url: m.thumbnail_url,
        resolution: m.size?.width && m.size?.height ? `${m.size.width}x${m.size.height}` : undefined,
        qualityLabel: isVideo ? 'best available' : 'original',
      };
    },
  );

  if (!items.length) throw new Error('No media found in this post.');

  return {
    user_name: vx.user_name,
    user_screen_name: vx.user_screen_name,
    user_profile_image_url: vx.user_profile_image_url,
    tweetID: vx.tweetID ?? tweetId,
    media: items,
  };
}

// Inline rescore: re-runs the translation+scoring tool call against current settings
// and persists the new translation/score/decision (aligned with worker: axes + final_score + editorial profile).
// deno-lint-ignore no-explicit-any
async function runRescore(supabase: any, tweetId: string): Promise<{
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
}> {
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, text_original, author_handle, tweeted_at, has_media, url')
    .eq('tweet_id', tweetId)
    .single();
  if (postErr || !post) return { ok: false, error: `Post not found: ${tweetId}` };
  if (!post.text_original) return { ok: false, error: 'Post has no original text to score' };

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['translation_prompt', 'content_filter', 'editorial_profiles', 'active_profile_id']);
  const settingsMap: Record<string, Record<string, unknown>> = {};
  for (const s of settings ?? []) {
    if (s.value && typeof s.value === 'object') settingsMap[s.key] = s.value as Record<string, unknown>;
  }
  const tp = settingsMap['translation_prompt'] || {};
  const cf = settingsMap['content_filter'] || {};

  const profilesObj = settingsMap['editorial_profiles'];
  const activeObj = settingsMap['active_profile_id'];
  const profilesArr = (profilesObj?.profiles as unknown[]) ?? [];
  const activeId = typeof activeObj?.id === 'string' ? activeObj.id : '';
  let editorialProfile: EditorialProfile | null = null;
  if (Array.isArray(profilesArr) && activeId) {
    const found = profilesArr.find(
      (p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === activeId,
    );
    if (found && typeof found === 'object') editorialProfile = found as EditorialProfile;
  }

  const filterEnabled = cf.enabled === true;
  const scoreOnly = cf.score_only === true;

  const model = typeof tp.model === 'string' && (tp.model as string).trim() ? tp.model as string : 'gpt-4o-mini';
  const translationPrompt = typeof tp.system_prompt === 'string' && (tp.system_prompt as string).trim()
    ? tp.system_prompt as string
    : 'You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.';
  const customScoringPrompt = typeof tp.scoring_system_prompt === 'string' && (tp.scoring_system_prompt as string).trim() ? tp.scoring_system_prompt as string : null;
  const customToolSchema = typeof tp.classifier_tool_schema === 'string' && (tp.classifier_tool_schema as string).trim() ? tp.classifier_tool_schema as string : null;
  const tsTemperature = typeof tp.temperature === 'number' ? tp.temperature as number : null;
  const tsMaxTokens = typeof tp.max_completion_tokens === 'number' ? Math.min(8000, Math.max(1, tp.max_completion_tokens as number)) : 2000;
  const tsTopP = typeof tp.top_p === 'number' ? tp.top_p as number : null;
  const tsFreqPen = typeof tp.frequency_penalty === 'number' ? tp.frequency_penalty as number : null;
  const tsPresPen = typeof tp.presence_penalty === 'number' ? tp.presence_penalty as number : null;
  const tsReasoningEffort = typeof tp.reasoning_effort === 'string' ? tp.reasoning_effort as string : null;
  const tsVerbosity = typeof tp.verbosity === 'string' ? tp.verbosity as string : null;
  const tsSeed = typeof tp.seed === 'number' ? tp.seed as number : null;
  const tsServiceTier = typeof tp.service_tier === 'string' ? tp.service_tier as string : null;
  const tsParallelToolCalls = typeof tp.parallel_tool_calls === 'boolean' ? tp.parallel_tool_calls as boolean : null;

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };

  const priorityTopics = Array.isArray(cf.priority_topics) ? (cf.priority_topics as string[]).join(', ') : 'none specified';
  const lowPriorityTopics = Array.isArray(cf.low_priority_topics) ? (cf.low_priority_topics as string[]).join(', ') : 'none specified';
  const guidelines = typeof cf.editorial_guidelines === 'string' ? cf.editorial_guidelines as string : '';
  const guidelinesBlock = guidelines.trim()
    ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
    : '';

  const scoringTemplate = customScoringPrompt ?? `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nScore 1-20 with 3-level relevance: DIRECT (no cap), INDIRECT Iran-adjacent (cap 16), NO NEXUS (cap 8). Polls/leaks/analyst reports about Iran conflicts can score 13-16. Do NOT down-score because framing is Western. Prefer higher tier when in doubt.\n\nManual calibration: direct Iran crisis, war, diplomacy, and military-posture items should usually score 17-19 when credible. Trump/Netanyahu/US/Pakistan leadership statements or coordination specifically about Iran are DIRECT audience-fit, not routine foreign politics. Qeshm/Hormuz, air-defense, drones, refueling tankers, US-Israel posture, IRGC/proxy threats, nuclear/escalation signals, and threats against POTUS family or senior US targets are very high impact. Pure Taiwan or unrelated domestic news with no Iran/Middle East nexus remains low/off-topic.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nReasoning MUST state: relevance level, tier, any cap. Call "classify_importance" with BOTH importance_score (1-20) AND axes (all six 0-10 fields).`;
  const systemPrompt = scoringTemplate
    .replace('{translation_prompt}', translationPrompt)
    .replace('{priority_topics}', priorityTopics)
    .replace('{low_priority_topics}', lowPriorityTopics)
    .replace('{editorial_guidelines_block}', guidelinesBlock);

  const AXES_SCHEMA = {
    type: 'object',
    description: 'Six independent scoring axes (each 0-10). noise is INVERTED (high = bad).',
    properties: {
      iran_relevance: { type: 'integer', minimum: 0, maximum: 10 },
      severity: { type: 'integer', minimum: 0, maximum: 10 },
      novelty: { type: 'integer', minimum: 0, maximum: 10 },
      credibility: { type: 'integer', minimum: 0, maximum: 10 },
      actionability: { type: 'integer', minimum: 0, maximum: 10 },
      noise: { type: 'integer', minimum: 0, maximum: 10 },
    },
    required: ['iran_relevance', 'severity', 'novelty', 'credibility', 'actionability', 'noise'],
  };

  let baseTool: Record<string, unknown>;
  try {
    baseTool = customToolSchema ? JSON.parse(customToolSchema) : {
      name: 'classify_importance',
      description: 'Provide importance classification of this news item',
      parameters: {
        type: 'object',
        properties: {
          translated_text: { type: 'string', description: 'The Persian translation of the original text' },
          importance_score: { type: 'integer', minimum: 1, maximum: 20 },
          axes: AXES_SCHEMA,
          tags: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string', description: 'Required: state relevance level, tier, and any cap applied' },
        },
        required: ['translated_text', 'importance_score', 'axes', 'tags', 'reasoning'],
      },
    };
  } catch (e) {
    return { ok: false, error: `Invalid classifier_tool_schema JSON: ${(e as Error).message}` };
  }

  const params = baseTool.parameters as Record<string, unknown>;
  const props = { ...(params.properties as Record<string, unknown>) };
  if (!props.axes) {
    props.axes = AXES_SCHEMA;
    const required = Array.from(new Set([...((params.required as string[]) || []), 'axes']));
    baseTool = { ...baseTool, parameters: { ...params, properties: props, required } };
  }

  const toolFunction = baseTool as unknown as ToolFunctionDef;

  const userMessage = `Author: @${post.author_handle || 'unknown'}\nPublished: ${post.tweeted_at ? new Date(post.tweeted_at as string).toISOString() : 'unknown'}\nHas media: ${post.has_media ? 'yes' : 'no'}\nURL: ${post.url || 'N/A'}\n\nContent:\n${post.text_original}`;

  const result = await callOpenAI({
    apiKey: openaiApiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tool: toolFunction,
    maxOutputTokens: tsMaxTokens,
    temperature: tsTemperature,
    topP: tsTopP,
    frequencyPenalty: tsFreqPen,
    presencePenalty: tsPresPen,
    reasoningEffort: tsReasoningEffort,
    verbosity: tsVerbosity,
    seed: tsSeed,
    serviceTier: tsServiceTier,
    parallelToolCalls: tsParallelToolCalls,
  });
  if (!result.ok) return { ok: false, error: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}` };
  if (!result.toolCall) return { ok: false, error: 'Model did not return a tool call' };

  let args: { translated_text?: string; importance_score?: number; axes?: unknown; tags?: string[]; reasoning?: string };
  try { args = JSON.parse(result.toolCall.arguments); }
  catch (e) { return { ok: false, error: `Tool-call parse error: ${(e as Error).message}` }; }

  let importanceScore = Math.max(1, Math.min(20, args.importance_score ?? 10));
  const scoreAxes = parseScoreAxes(args.axes);
  if (scoreAxes && args.importance_score == null) {
    importanceScore = Math.round(computeFinalScore(scoreAxes));
  }
  const newTags = Array.isArray(args.tags) ? args.tags : [];
  const newReasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
  const authorHandle = (post.author_handle as string | null) ?? null;
  const textOriginal = String(post.text_original || '');

  let deliveryDecision = 'deliver';
  let decisionReason: string | null = null;
  let finalScore: number | null = scoreAxes ? computeFinalScore(scoreAxes) : (importanceScore ?? null);

  if (filterEnabled && importanceScore !== null && !scoreOnly) {
    if (editorialProfile) {
      const r = applyProfileDecision({
        profile: editorialProfile,
        axes: scoreAxes,
        legacyScore: importanceScore,
        tags: newTags,
        text: textOriginal,
        authorHandle,
      });
      deliveryDecision = r.decision;
      decisionReason = r.reason;
      finalScore = r.finalScore;
    } else {
      const author_rules = (cf.author_rules as Record<string, { rule: string; threshold?: number }>) || {};
      const authorRule = authorHandle ? author_rules[authorHandle] : null;
      if (authorRule?.rule === 'always_deliver') {
        deliveryDecision = 'deliver';
        decisionReason = `author_rule:always_deliver:${authorHandle}`;
      } else if (authorRule?.rule === 'always_skip') {
        deliveryDecision = 'skip';
        decisionReason = `author_rule:always_skip:${authorHandle}`;
      } else {
        const threshold = authorRule?.rule === 'custom_threshold' && authorRule.threshold != null
          ? authorRule.threshold
          : (typeof cf.default_threshold === 'number' ? cf.default_threshold as number : 12);
        deliveryDecision = importanceScore >= threshold ? 'deliver' : 'skip';
        decisionReason = deliveryDecision === 'deliver'
          ? `score_pass:${importanceScore}>=${threshold}`
          : `below_threshold:${importanceScore}<${threshold}`;
      }
    }
  } else if (scoreOnly) {
    decisionReason = 'score_only_mode';
  } else if (!filterEnabled) {
    decisionReason = 'filter_disabled';
  }

  const legacyThreshold = typeof cf.default_threshold === 'number' ? cf.default_threshold as number : 12;
  const thresholdOut = editorialProfile ? editorialProfile.threshold : legacyThreshold;

  // Feedback bias + kNN prior
  let scoreBreakdown: Record<string, unknown> | null = null;
  if (finalScore !== null) {
    try {
      const { data: biasRow } = await supabase.from('settings').select('value').eq('key', 'learned_biases').maybeSingle();
      const biases = (biasRow?.value ?? {}) as { author_bias?: Record<string, number>; tag_bias?: Record<string, number> };
      const authorDelta = authorHandle ? (biases.author_bias?.[(authorHandle).toLowerCase()] ?? 0) : 0;
      let tagDelta = 0;
      for (const t of newTags) tagDelta += biases.tag_bias?.[String(t).toLowerCase()] ?? 0;
      tagDelta = Math.max(-2, Math.min(2, tagDelta));

      let knnPrior = 0;
      const { data: sigRow } = await supabase.from('story_signatures').select('embedding').eq('tweet_id', tweetId).maybeSingle();
      if (sigRow?.embedding) {
        const { data: knnVal } = await supabase.rpc('knn_feedback_prior', { query_embedding: sigRow.embedding, exclude_tweet_id: tweetId });
        knnPrior = typeof knnVal === 'number' ? knnVal : 0;
      }

      const totalBias = Math.max(-5, Math.min(5, authorDelta + tagDelta + knnPrior));
      const aiFinal = finalScore;
      if (totalBias !== 0) {
        finalScore = Math.max(1, Math.min(20, Math.round((finalScore + totalBias) * 10) / 10));
        if (filterEnabled && !scoreOnly) {
          const thr = thresholdOut;
          if (finalScore >= thr && deliveryDecision === 'skip' && (decisionReason ?? '').startsWith('below_threshold')) {
            deliveryDecision = 'deliver';
            decisionReason = `feedback_boost:${aiFinal.toFixed(1)}+${totalBias.toFixed(1)}>=${thr}`;
          } else if (finalScore < thr && deliveryDecision === 'deliver' && (decisionReason ?? '').startsWith('score_pass')) {
            deliveryDecision = 'skip';
            decisionReason = `feedback_reduce:${aiFinal.toFixed(1)}+${totalBias.toFixed(1)}<${thr}`;
          }
        }
      }
      scoreBreakdown = {
        ai: Math.round(aiFinal * 10) / 10,
        ...(authorDelta ? { author_bias: Math.round(authorDelta * 1000) / 1000 } : {}),
        ...(tagDelta ? { tag_bias: Math.round(tagDelta * 1000) / 1000 } : {}),
        ...(knnPrior ? { knn_prior: Math.round(knnPrior * 1000) / 1000 } : {}),
        final: Math.round(finalScore * 10) / 10,
      };
    } catch (_e) { /* non-fatal */ }
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
  if (typeof args.translated_text === 'string') {
    updatePayload.text_translated = args.translated_text;
    updatePayload.translated_at = new Date().toISOString();
    updatePayload.translation_model = model;
  }

  const { error: upErr } = await supabase.from('posts').update(updatePayload).eq('tweet_id', tweetId);
  if (upErr) return { ok: false, error: upErr.message };

  return {
    ok: true,
    score: importanceScore,
    final_score: finalScore ?? undefined,
    tags: newTags,
    reasoning: newReasoning,
    translated: typeof args.translated_text === 'string' ? args.translated_text : null,
    decision: deliveryDecision,
    decision_reason: decisionReason,
    threshold: thresholdOut,
    model,
  };
}

// deno-lint-ignore no-explicit-any
async function recordFeedback(
  supabase: any,
  tweetId: string,
  feedbackAction: string,
  polarity: number,
  meta?: Record<string, unknown>,
  relatedTweetId?: string | null,
) {
  await supabase.from('feedback_events').insert({
    tweet_id: tweetId,
    related_tweet_id: relatedTweetId ?? null,
    action: feedbackAction,
    polarity,
    meta: meta ?? {},
    source: 'admin_action',
  });

  if (polarity === 0 || ['not_duplicate', 'confirm_duplicate'].includes(feedbackAction)) return;

  const { data: post } = await supabase
    .from('posts')
    .select('author_handle, importance_tags')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return;

  const { data: biasRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'learned_biases')
    .maybeSingle();
  const biases = (biasRow?.value ?? { author_bias: {}, tag_bias: {}, keyword_bias: {} }) as {
    author_bias: Record<string, number>;
    tag_bias: Record<string, number>;
    keyword_bias: Record<string, number>;
  };

  const PER_EVENT_CLAMP = 0.5;
  const PER_KEY_CAP = 3;
  const clampD = (d: number) => Math.max(-PER_EVENT_CLAMP, Math.min(PER_EVENT_CLAMP, d));
  const clampT = (t: number) => Math.max(-PER_KEY_CAP, Math.min(PER_KEY_CAP, t));

  if (post.author_handle) {
    const handle = (post.author_handle as string).toLowerCase();
    biases.author_bias[handle] = clampT((biases.author_bias[handle] || 0) + clampD(polarity * 0.6));
  }

  const tags = Array.isArray(post.importance_tags) ? post.importance_tags as string[] : [];
  if (tags.length > 0) {
    const perTag = polarity * 0.2 / tags.length;
    for (const tag of tags) {
      const t = String(tag).toLowerCase();
      biases.tag_bias[t] = clampT((biases.tag_bias[t] || 0) + clampD(perTag));
    }
  }

  await supabase.from('settings').upsert({
    key: 'learned_biases',
    value: biases,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

// deno-lint-ignore no-explicit-any
async function insertAdminPipelineEvent(
  supabase: any,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) {
  await supabase.from('pipeline_events').insert({
    subject_type: 'post',
    subject_id: tweetId,
    step,
    status,
    started_at: new Date().toISOString(),
    ended_at: status === 'completed' || status === 'failed' || status === 'skipped' ? new Date().toISOString() : null,
    error: error ?? null,
    meta: { source: 'admin-actions', ...(meta ?? {}) },
  }).then(() => null, () => null);
}

// deno-lint-ignore no-explicit-any
async function updateLatestPostEnrichment(supabase: any, tweetId: string, patch: Record<string, unknown>) {
  const { data } = await supabase
    .from('post_enrichments')
    .select('id')
    .eq('post_id', tweetId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.id) return;

  await supabase
    .from('post_enrichments')
    .update(patch)
    .eq('id', data.id)
    .then(() => null, () => null);
}

async function dispatchWorkerForManualEnrich(): Promise<{ ok: boolean; status?: number; processed?: number; message?: string; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: 'missing Supabase URL or service role key' };
  }

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/worker`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trigger: 'manual_enrich',
        job_types: ['enrich'],
        batch_size: 3,
      }),
    });
    const text = await resp.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (_e) {
      parsed = { message: text.slice(0, 300) };
    }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: typeof parsed.error === 'string' ? parsed.error : text.slice(0, 300),
      };
    }
    return {
      ok: true,
      status: resp.status,
      processed: typeof parsed.processed === 'number' ? parsed.processed : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// deno-lint-ignore no-explicit-any
async function runTranslationOnly(supabase: any, tweetId: string): Promise<{ ok: boolean; translated?: string; model?: string; error?: string }> {
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, text_original, author_handle, tweeted_at, has_media, url')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (postErr || !post) return { ok: false, error: `Post not found: ${tweetId}` };
  if (!post.text_original) return { ok: false, error: 'Post has no original text to translate' };

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['translation_prompt']);
  const row = (settings ?? []).find((s: Record<string, unknown>) => s.key === 'translation_prompt');
  const tp = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<string, unknown>;
  const model = typeof tp.model === 'string' && tp.model.trim() ? tp.model : 'gpt-4o-mini';
  const systemPrompt = typeof tp.system_prompt === 'string' && tp.system_prompt.trim()
    ? tp.system_prompt
    : 'You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.';
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };

  const result = await callOpenAI({
    apiKey: openaiApiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(post.text_original) },
    ],
    maxOutputTokens: typeof tp.max_completion_tokens === 'number' ? Math.min(8000, Math.max(1, tp.max_completion_tokens)) : 2000,
    temperature: typeof tp.temperature === 'number' ? tp.temperature : null,
    topP: typeof tp.top_p === 'number' ? tp.top_p : null,
    frequencyPenalty: typeof tp.frequency_penalty === 'number' ? tp.frequency_penalty : null,
    presencePenalty: typeof tp.presence_penalty === 'number' ? tp.presence_penalty : null,
    reasoningEffort: typeof tp.reasoning_effort === 'string' ? tp.reasoning_effort : null,
    verbosity: typeof tp.verbosity === 'string' ? tp.verbosity : null,
    seed: typeof tp.seed === 'number' ? tp.seed : null,
    serviceTier: typeof tp.service_tier === 'string' ? tp.service_tier : null,
    parallelToolCalls: typeof tp.parallel_tool_calls === 'boolean' ? tp.parallel_tool_calls : null,
  });
  if (!result.ok) {
    await insertAdminPipelineEvent(supabase, tweetId, 'translate', 'failed', { mode: 'translation_only', model }, `OpenAI ${result.status}`);
    return { ok: false, error: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}` };
  }
  const translated = result.content.trim();
  if (!translated) {
    await insertAdminPipelineEvent(supabase, tweetId, 'translate', 'failed', { mode: 'translation_only', model }, 'empty_translation');
    return { ok: false, error: 'OpenAI returned an empty translation' };
  }

  const { error: upErr } = await supabase.from('posts').update({
    text_translated: translated,
    translated_at: new Date().toISOString(),
    translation_model: model,
    translation_tokens: (result.raw?.usage as { total_tokens?: number } | undefined)?.total_tokens ?? null,
  }).eq('tweet_id', tweetId);
  if (upErr) return { ok: false, error: upErr.message };
  await insertAdminPipelineEvent(supabase, tweetId, 'translate', 'completed', { mode: 'translation_only', model });
  await recordFeedback(supabase, tweetId, 'translate_only', 0).catch(() => {});
  return { ok: true, translated, model };
}

// deno-lint-ignore no-explicit-any
async function queueHydrationJob(supabase: any, tweetId: string, source: string): Promise<{ queued: boolean; reason?: string }> {
  const { data: pending } = await supabase
    .from('jobs')
    .select('id')
    .eq('type', 'hydrate_tweet')
    .in('status', ['pending', 'running'])
    .filter('payload->>tweet_id', 'eq', tweetId)
    .limit(1);
  if (pending && pending.length > 0) {
    return { queued: false, reason: 'hydrate_job_already_pending' };
  }
  const { error } = await supabase.from('jobs').upsert({
    type: 'hydrate_tweet',
    payload: { tweet_id: tweetId, source },
    status: 'pending',
    priority: 15,
    idempotency_key: `hydrate:${source}:${tweetId}`,
    next_run_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
  }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
  if (error) throw error;
  await insertAdminPipelineEvent(supabase, tweetId, 'hydrate', 'queued', { source });
  return { queued: true };
}

// deno-lint-ignore no-explicit-any
async function queueManualAdvance(supabase: any, tweetId: string): Promise<{ queued: string; reason?: string }> {
  const { data: post } = await supabase
    .from('posts')
    .select('tweet_id, text_translated, translated_at, is_truncated, hydrated_at, enrich_status')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return { queued: 'none', reason: 'post_not_found' };
  if (!post.text_translated && !post.translated_at) return { queued: 'none', reason: 'translation_missing' };
  if (post.is_truncated === true && !post.hydrated_at) {
    const result = await queueHydrationJob(supabase, tweetId, 'manual_score');
    return { queued: 'hydrate', reason: result.reason };
  }

  const { data: enrichCfgRow } = await supabase.from('settings').select('value').eq('key', 'enrichment_config').maybeSingle();
  const enrichCfg = normalizeEnrichmentConfig((enrichCfgRow?.value ?? { enabled: false }) as Partial<EnrichmentConfig>);
  if (doesEnrichmentBlockX(enrichCfg) && post.enrich_status !== 'approved' && post.enrich_status !== 'skipped') {
    await supabase.from('jobs').upsert({
      type: 'enrich',
      payload: { tweet_id: tweetId, source: 'manual_score' },
      status: 'pending',
      priority: 18,
      idempotency_key: `enrich:${tweetId}`,
      next_run_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
    await insertAdminPipelineEvent(supabase, tweetId, 'enrich', 'queued', { source: 'manual_score' });
    return { queued: 'enrich' };
  }

  await supabase.from('jobs').upsert({
    type: 'deliver',
    payload: { tweet_id: tweetId, source: 'manual_score' },
    status: 'pending',
    priority: 20,
    idempotency_key: `deliver:${tweetId}`,
    next_run_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
  }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
  const { data: pendingDel } = await supabase
    .from('deliveries')
    .select('id')
    .eq('subject_type', 'post')
    .eq('subject_id', tweetId)
    .eq('status', 'pending')
    .limit(1);
  if (!pendingDel || pendingDel.length === 0) {
    await supabase.from('deliveries').insert({ subject_type: 'post', subject_id: tweetId, status: 'pending', attempts: 0 });
  }
  await insertAdminPipelineEvent(supabase, tweetId, 'deliver', 'queued', { source: 'manual_score' });
  return { queued: 'deliver' };
}

type XDiagnosticBlocker = {
  code: string;
  label: string;
  severity: 'blocker' | 'deferred' | 'note';
};

const DEFAULT_X_POSTING_DIAG_CONFIG = {
  enabled: false,
  min_score: 14,
  allow_video: false,
  dedupe_window_hours: 48,
  post_only_decision_deliver: true,
  start_posting_from: null as string | null,
};

const DEFAULT_X_RATE_LIMIT_DIAG_CONFIG = {
  posts_per_hour: 20,
  posts_per_day: 100,
  monthly_post_budget: 2500,
  media_uploads_per_day: 200,
};

function mergeRecord<T extends Record<string, unknown>>(defaults: T, raw: unknown): T {
  return { ...defaults, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}) } as T;
}

function xQuotaBlock(snapshot: {
  posts_1h: number;
  posts_24h: number;
  posts_30d: number;
  media_24h: number;
}, limits: typeof DEFAULT_X_RATE_LIMIT_DIAG_CONFIG): string | null {
  if (snapshot.posts_1h >= limits.posts_per_hour) return 'rate_limit_hour';
  if (snapshot.posts_24h >= limits.posts_per_day) return 'rate_limit_day';
  if (snapshot.posts_30d >= limits.monthly_post_budget) return 'rate_limit_month';
  if (snapshot.media_24h >= limits.media_uploads_per_day) return 'rate_limit_media';
  return null;
}

// deno-lint-ignore no-explicit-any
async function getXPostingDiagnostics(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
  const [settingsRows, threshold] = await Promise.all([
    supabase.from('settings').select('key, value').in('key', ['x_posting_config', 'x_rate_limits', 'enrichment_config']),
    loadActiveThreshold(supabase).catch(() => 14),
  ]);
  const settings = Object.fromEntries((settingsRows.data ?? []).map((row: Record<string, unknown>) => [String(row.key), row.value]));
  const xCfg = mergeRecord(DEFAULT_X_POSTING_DIAG_CONFIG, settings.x_posting_config);
  const xLimits = mergeRecord(DEFAULT_X_RATE_LIMIT_DIAG_CONFIG, settings.x_rate_limits);
  const enrichCfg = normalizeEnrichmentConfig((settings.enrichment_config ?? { enabled: false }) as Partial<EnrichmentConfig>);
  const enrichmentRequiredForX = doesEnrichmentBlockX(enrichCfg);
  const allowCompletedEnrichment = allowCompletedEnrichmentForPosting(enrichCfg);

  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [posts1h, posts24h, posts30d, media24h] = await Promise.all([
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since1h),
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since24h),
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since30d),
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gt('media_count', 0).gte('created_at', since24h),
  ]);
  const quotaSnapshot = {
    posts_1h: posts1h.count ?? 0,
    posts_24h: posts24h.count ?? 0,
    posts_30d: posts30d.count ?? 0,
    media_24h: media24h.count ?? 0,
  };
  const quotaReason = xQuotaBlock(quotaSnapshot, xLimits);

  let q = supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, created_at, url, author_handle, has_media, delivery_decision, decision_reason, final_score, importance_score, dup_of_tweet_id, dedupe_status, dedupe_reason, is_truncated, hydrated_at, enrich_status, final_x_text')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tweetId) q = q.eq('tweet_id', tweetId).limit(1);
  const { data: posts, error } = await q;
  if (error) return { success: false, error: error.message };
  const candidateRes = await supabase.rpc('get_x_post_candidates', {
    candidate_limit: limit,
    target_tweet_id: tweetId || null,
  }).catch((candidateError: unknown) => ({ data: [], error: candidateError }));
  const sqlCandidatesById = new Map<string, Record<string, unknown>>();
  if (!candidateRes.error) {
    for (const row of (candidateRes.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.tweet_id ?? '');
      if (id) sqlCandidatesById.set(id, row);
    }
  }

  const dedupeCutoff = new Date(Date.now() - Number(xCfg.dedupe_window_hours || 48) * 3600 * 1000).toISOString();
  const startFrom = typeof xCfg.start_posting_from === 'string' ? xCfg.start_posting_from : null;
  const effectiveCutoff = startFrom && startFrom > dedupeCutoff ? startFrom : dedupeCutoff;

  const items: Array<Record<string, unknown>> = [];
  for (const post of posts ?? []) {
    const tid = post.tweet_id as string;
    const [latestX, activeJobs, mediaRows] = await Promise.all([
      supabase
        .from('x_deliveries')
        .select('status, skip_reason, last_error, x_tweet_id, posted_at, created_at')
        .eq('post_id', tid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('jobs')
        .select('type, status, last_error, created_at')
        .in('status', ['pending', 'running'])
        .filter('payload->>tweet_id', 'eq', tid)
        .order('created_at', { ascending: false }),
      supabase
        .from('media')
        .select('id, downloaded_at, storage_path, kind, mime_type, file_size, duration_ms, src_url')
        .eq('tweet_id', tid),
    ]);
    const blockers: XDiagnosticBlocker[] = [];
    const notes: XDiagnosticBlocker[] = [];
    const score = typeof post.final_score === 'number'
      ? post.final_score
      : typeof post.importance_score === 'number'
        ? post.importance_score
        : null;
    const hasTranslation = typeof post.text_translated === 'string' && post.text_translated.trim().length > 0;
    const latestStatus = latestX.data?.status as string | undefined;
    const jobs = (activeJobs.data ?? []) as Array<Record<string, unknown>>;
    const activeJobTypes = new Set(jobs.map((job) => String(job.type)));
    const activeEnrichJob = jobs.some((job) => job.type === 'enrich');
    const activeMediaJob = jobs.some((job) => job.type === 'resolve_media' || job.type === 'download_media');
    const activeHydrateJob = jobs.some((job) => job.type === 'hydrate_tweet');
    const media = ((mediaRows.data ?? []) as XMediaRow[]);
    const downloadedMedia = media.filter((row) => row.downloaded_at && row.storage_path).length;
    const mediaSelection = selectMediaTier(media, { allowVideo: xCfg.allow_video === true });
    const enrichStatus = typeof post.enrich_status === 'string' ? post.enrich_status : null;
    const enrichmentApproved = enrichStatus === 'approved' || enrichStatus === 'enriched' || (enrichStatus === 'completed' && allowCompletedEnrichment);

    if (!xCfg.enabled) blockers.push({ code: 'x_disabled', label: 'X posting is disabled in Settings', severity: 'blocker' });
    if (post.created_at && String(post.created_at) < effectiveCutoff) blockers.push({ code: 'before_start_posting_from', label: 'Older than X posting cutover window', severity: 'blocker' });
    if (!hasTranslation) blockers.push({ code: 'missing_translation', label: 'Missing Persian translation', severity: 'blocker' });
    if (score == null) blockers.push({ code: 'missing_score', label: 'Missing editorial score', severity: 'blocker' });
    else if (score < Number(xCfg.min_score || threshold)) blockers.push({ code: 'score_below_x_min', label: `Score ${score} is below X minimum ${xCfg.min_score || threshold}`, severity: 'blocker' });
    if (xCfg.post_only_decision_deliver && post.delivery_decision !== 'deliver') blockers.push({ code: 'decision_not_deliver', label: `Decision is ${post.delivery_decision ?? 'unset'}`, severity: 'blocker' });
    const duplicateSkipReason = duplicateXSkipReason(post as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null });
    if (duplicateSkipReason) {
      blockers.push({ code: 'duplicate_gate', label: `Duplicate of ${post.dup_of_tweet_id ?? 'another post'}`, severity: 'blocker' });
    } else if (post.dedupe_status === 'coverage_gap') {
      notes.push({ code: 'coverage_gap', label: `Possible duplicate is not covered yet (${post.dup_of_tweet_id ?? 'no canonical'})`, severity: 'note' });
    } else if (post.dedupe_status === 'uncertain' && post.dup_of_tweet_id) {
      notes.push({ code: 'possible_duplicate', label: `Possible duplicate of ${post.dup_of_tweet_id}; human review or re-run dedupe recommended`, severity: 'note' });
    }
    if (post.is_truncated === true && !post.hydrated_at) {
      blockers.push({
        code: activeHydrateJob ? 'hydration_pending' : 'waiting_hydration',
        label: activeHydrateJob ? 'Hydration job is pending/running' : 'Tweet is truncated and needs hydration before X',
        severity: 'deferred',
      });
    }
    if (latestStatus === 'posted') blockers.push({ code: 'already_posted', label: `Already posted to X${latestX.data?.x_tweet_id ? ` (${latestX.data.x_tweet_id})` : ''}`, severity: 'blocker' });
    if (latestStatus === 'failed' || latestStatus === 'skipped') blockers.push({ code: `previous_x_${latestStatus}`, label: `Previous X row is ${latestStatus}; automatic retry is disabled`, severity: 'blocker' });
    if (enrichmentRequiredForX && enrichStatus && !enrichmentApproved && enrichStatus !== 'skipped') {
      blockers.push({ code: `enrichment_${enrichStatus}`, label: `Required enrichment is ${enrichStatus}`, severity: 'blocker' });
    } else if (enrichStatus === 'pending' && !activeEnrichJob) {
      notes.push({ code: 'stale_enrichment_pending_ignored', label: 'Stale enrichment pending is ignored because enrichment is not required for X', severity: 'note' });
    } else if (enrichStatus && !enrichmentApproved && enrichStatus !== 'skipped') {
      notes.push({ code: `enrichment_${enrichStatus}_not_required`, label: `Enrichment is ${enrichStatus}, but plain X posting is allowed`, severity: 'note' });
    }
    if (post.has_media === true && mediaSelection.tier === 'blocked') {
      const labels: Record<string, string> = {
        video_pending_resolution: activeMediaJob ? 'Video is resolving/downloading' : 'Video media needs resolution before X',
        video_media_mismatch: 'Video row has non-video bytes; X posting is blocked until media is re-resolved',
        video_disabled_by_config: 'Video posting is disabled in Settings',
      };
      blockers.push({
        code: mediaSelection.reason ?? 'media_blocked',
        label: labels[mediaSelection.reason ?? ''] ?? `Media blocked: ${mediaSelection.reason ?? 'unknown reason'}`,
        severity: mediaSelection.reason === 'video_disabled_by_config' ? 'blocker' : 'deferred',
      });
    } else if (post.has_media === true && downloadedMedia === 0) {
      blockers.push({
        code: activeMediaJob ? 'media_pending' : 'media_missing',
        label: activeMediaJob ? 'Media is still resolving/downloading' : 'Source has media but no downloaded X-uploadable media',
        severity: 'deferred',
      });
    }
    if (quotaReason) blockers.push({ code: quotaReason, label: `X quota blocked: ${quotaReason}`, severity: 'blocker' });

    const eligible = blockers.length === 0;
    const sqlCandidate = sqlCandidatesById.get(tid) ?? null;
    items.push({
      tweet_id: tid,
      eligible,
      blockers,
      notes,
      score,
      threshold: xCfg.min_score || threshold,
      decision: post.delivery_decision ?? null,
      latest_x: latestX.data ?? null,
      candidate: {
        sql_gate_passed: Boolean(sqlCandidate),
        reason: sqlCandidate?.candidate_reason ?? (eligible ? 'local_gate_only' : 'blocked'),
        age_ms: sqlCandidate?.candidate_age_ms ?? (post.created_at ? Date.now() - new Date(String(post.created_at)).getTime() : null),
        dispatch_source: sqlCandidate?.dispatch_source ?? null,
      },
      active_jobs: jobs.map((job) => ({ type: job.type, status: job.status, error: job.last_error ?? null })),
      active_job_types: [...activeJobTypes],
      hydration: {
        is_truncated: post.is_truncated === true,
        hydrated_at: post.hydrated_at ?? null,
        active_hydrate_job: activeHydrateJob,
      },
      media: {
        has_media: post.has_media === true,
        rows: media.length,
        downloaded: downloadedMedia,
        active_media_job: activeMediaJob,
        selected_tier: mediaSelection.tier,
        selected_reason: mediaSelection.reason ?? null,
        row_details: media.map((row) => ({
          id: row.id ?? null,
          kind: row.kind ?? null,
          mime_type: row.mime_type ?? null,
          file_size: row.file_size ?? null,
          downloaded: Boolean(row.downloaded_at && row.storage_path),
          video_intent: hasVideoIntent(row),
          sendable: isValidVideoDownload(row) || isSendableImage(row),
          role: String(row.kind ?? '').toLowerCase() === 'thumbnail'
            ? 'thumbnail_only'
            : hasVideoIntent(row)
              ? isValidVideoDownload(row) ? 'sendable_video' : 'video_blocked'
              : isSendableImage(row) ? 'sendable_image' : 'not_sendable',
        })),
      },
      enrichment: {
        status: enrichStatus,
        pipeline_mode: enrichCfg.pipeline_mode,
        required_for_x: enrichmentRequiredForX,
        approved_for_text: enrichmentApproved,
        text_source: enrichmentApproved && typeof post.final_x_text === 'string' && post.final_x_text.trim() ? 'approved_enrichment' : 'plain_translation',
      },
    });
  }

  return {
    success: true,
    diagnostics: {
      generated_at: new Date().toISOString(),
      config: {
        x_enabled: xCfg.enabled,
        x_min_score: xCfg.min_score,
        start_posting_from: xCfg.start_posting_from,
        effective_cutoff: effectiveCutoff,
        enrichment_pipeline_mode: enrichCfg.pipeline_mode,
        enrichment_required_for_x: enrichmentRequiredForX,
      },
      quota: {
        ...quotaSnapshot,
        blocked_reason: quotaReason,
      },
      eligible_candidates: items.filter((item) => item.eligible),
      rejected_or_deferred_candidates: items.filter((item) => !item.eligible),
      items,
    },
  };
}

// deno-lint-ignore no-explicit-any
async function summarizeStaleXPending(supabase: any, body: Record<string, unknown>) {
  const olderThanHours = Math.min(Math.max(Number(body.older_than_hours) || 24, 1), 720);
  const close = body.close === true;
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('x_deliveries')
    .select('id, post_id, created_at, skip_reason, last_error')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  const ids = (data ?? []).map((row: { id: string }) => row.id);
  if (close && ids.length > 0) {
    const { error: updErr } = await supabase
      .from('x_deliveries')
      .update({
        status: 'skipped',
        skip_reason: 'stale_pending_closed_by_admin',
        last_error: 'Closed by admin maintenance action without retrying or posting',
      })
      .in('id', ids);
    if (updErr) throw updErr;
  }
  return { success: true, closed: close ? ids.length : 0, matched: ids.length, rows: data ?? [], older_than_hours: olderThanHours };
}

serve(async (req) => {
  corsHeaders = makeCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawText = await req.text();
    let body: any = {};
    try { body = rawText ? JSON.parse(rawText) : {}; } catch (e) {
      console.error('[admin-actions] body parse failed', { rawText: rawText.slice(0, 200), err: (e as Error).message });
    }
    const { action } = body;

    const authResult = await requireAdmin(req);
    if (authResult instanceof Response) return authResult;

    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (!action) {
      console.error('[admin-actions] missing action', { rawText: rawText.slice(0, 200), contentType: req.headers.get('content-type') });
      return jsonResponse({ error: 'Missing action parameter', received: rawText.slice(0, 200) }, 400);
    }

    switch (action) {
      case 'version': {
        return jsonResponse({ ok: true, sha: DEPLOY_SHA, deployed_at: DEPLOY_TIME });
      }

      // ===== Settings =====
      case 'save_settings': {
        const result = await saveSettingsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Edit translation =====
      case 'edit_translation': {
        const result = await editTranslationAdminAction(supabase, body, recordFeedback);
        return jsonResponse(result.body, result.status);
      }

      // ===== Retry step (translate/deliver/media) =====
      case 'retry_step': {
        const result = await retryStepAdminAction(supabase, body, recordFeedback);
        return jsonResponse(result.body, result.status);
      }

      // ===== Reprocess (full re-run) =====
      case 'reprocess': {
        const result = await reprocessAdminAction(supabase, body, recordFeedback);
        return jsonResponse(result.body, result.status);
      }

      // ===== Cancel pending/running jobs =====
      case 'cancel_pending_jobs': {
        const result = await cancelPendingJobsAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Bulk reprocess =====
      case 'bulk_reprocess': {
        const result = await bulkReprocessAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Bulk ignore =====
      case 'bulk_ignore': {
        const result = await bulkIgnoreMonitoringItemsAdminAction(supabase, body, {
          updateLatestPostEnrichment,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== Post thread =====
      case 'post_thread': {
        const result = await postThreadAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== System health =====
      case 'get_health': {
        const result = await getHealthAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      case 'reconcile_stuck_jobs': {
        const result = await reconcileStuckJobsAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      case 'get_dashboard_summary': {
        const dashboard = await getEnhancedDashboardSummary(supabase);
        return jsonResponse({ success: true, dashboard });
      }

      case 'get_system_performance_summary': {
        return jsonResponse(await getSystemPerformanceSummary(supabase));
      }

      case 'dry_run_old_media_cleanup': {
        const daysOld = typeof body.days_old === 'number' ? Math.max(1, Math.min(365, Math.floor(body.days_old))) : 1;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const { data, error } = await supabase.functions.invoke('media-processor', {
          body: { action: 'cleanup_old_media', days_old: daysOld, dry_run: true },
          headers: { Authorization: `Bearer ${serviceKey}` },
        } as Record<string, unknown>);
        if (error) throw error;
        return jsonResponse({ success: true, dry_run: true, result: data });
      }

      case 'get_monitoring_overview': {
        return jsonResponse(await getMonitoringOverview(supabase, body));
      }

      case 'get_monitoring_entries': {
        return jsonResponse(await getMonitoringEntries(supabase, body));
      }

      case 'get_x_api_summary': {
        return jsonResponse(await getXApiSummary(supabase, body, {
          recordAdminXApiAttempt,
          recordXApiEvent,
        }));
      }

      case 'get_video_render_config': {
        return jsonResponse(await loadVideoRenderConfigAdmin(supabase));
      }

      case 'update_video_render_config': {
        return jsonResponse(await updateVideoRenderConfigAdmin(supabase, body));
      }

      case 'get_video_render_overview': {
        return jsonResponse(await getVideoRenderOverview(supabase));
      }

      case 'get_video_render_queue': {
        return jsonResponse(await getVideoRenderQueue(supabase, body));
      }

      case 'get_video_render_detail': {
        return jsonResponse(await getVideoRenderDetail(supabase, body));
      }

      case 'retry_video_render': {
        return jsonResponse(await retryVideoRenderAdmin(supabase, body, insertAdminPipelineEvent));
      }

      case 'save_video_render_feedback': {
        return jsonResponse(await saveVideoRenderFeedbackAdmin(supabase, body, insertAdminPipelineEvent, authResult.userId));
      }

      case 'get_x_posting_diagnostics': {
        return jsonResponse(await getXPostingDiagnostics(supabase, body));
      }

      case 'score_post_v2': {
        return jsonResponse(await scorePostV2(supabase, body, { insertAdminPipelineEvent }));
      }

      case 'preview_scoring_policy': {
        return jsonResponse(await previewScoringPolicy(supabase, body, {}));
      }

      case 'run_scoring_eval': {
        return jsonResponse(await runScoringEval(supabase, body, {}));
      }

      case 'promote_feedback_to_scoring_example': {
        return jsonResponse(await promoteFeedbackToScoringExample(supabase, body, authResult.userId));
      }

      case 'backfill_score_v2': {
        return jsonResponse(await backfillScoreV2(supabase, body));
      }

      case 'run_dedupe': {
        return jsonResponse(await runDedupeAdminAction(supabase, body));
      }

      case 'backfill_dedupe': {
        return jsonResponse(await backfillDedupeAdminAction(supabase, body));
      }

      case 'audit_duplicate_candidates': {
        return jsonResponse(await auditDuplicateCandidatesAdminAction(supabase, body));
      }

      case 'summarize_stale_x_pending': {
        return jsonResponse(await summarizeStaleXPending(supabase, body));
      }

      case 'hydrate_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!tweetId) return jsonResponse({ ok: false, error: 'tweet_id is required' }, 400);
        const result = await queueHydrationJob(supabase, tweetId, 'manual_monitoring');
        return jsonResponse({ ok: true, queued: result.queued, reason: result.reason });
      }

      case 'get_post_pipeline_status': {
        const tweetIds = Array.isArray(body.tweet_ids)
          ? body.tweet_ids
            .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id: string) => id.trim())
            .slice(0, 100)
          : [];
        if (tweetIds.length === 0) {
          return jsonResponse({ error: 'tweet_ids array is required' }, 400);
        }
        const { data, error } = await supabase.rpc('get_post_pipeline_status', { tweet_ids: tweetIds });
        if (error) throw error;
        return jsonResponse({ success: true, statuses: data ?? [] });
      }

      case 'resolve_x_media': {
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!/^[A-Za-z0-9_]{1,15}$/.test(username) || !/^[0-9]{5,32}$/.test(tweetId)) {
          return jsonResponse({ error: 'Valid username and tweet_id are required' }, 400);
        }
        const tweet = await resolveXMedia(username, tweetId);
        return jsonResponse({ success: true, tweet });
      }

      // ===== X Posting: dry run / retry =====
      case 'dry_run_x_post':
      case 'retry_x_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : null;
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        const { data: xPostingRow } = await supabase.from('settings').select('value').eq('key', 'x_posting_config').maybeSingle();
        const xPostingCfg = (xPostingRow?.value ?? {}) as Record<string, unknown>;
        const xPostingEnabled = xPostingCfg.enabled === true;
        if (action === 'retry_x_post' && !xPostingEnabled) {
          return jsonResponse({
            ok: false,
            skipped: true,
            error: 'X posting is turned off in Settings → X Automation. Turn on “Enable X posting” before posting to X.',
          }, 200);
        }

        // Pre-flight: when forcing a specific tweet, ensure it has a translation
        // and a score. Dry-run stays read-only; it never rescues missing state.
        let prep: { ran: boolean; ok: boolean; score?: number; decision?: string; error?: string; hydrate?: string } = { ran: false, ok: true };
        if (tweetId && action === 'retry_x_post') {
          const { data: existing } = await supabase
            .from('posts')
            .select('text_translated, importance_score, final_score, is_truncated, hydrated_at, dedupe_status, dup_of_tweet_id, dedupe_reason')
            .eq('tweet_id', tweetId)
            .maybeSingle();
          const duplicateSkipReason = duplicateXSkipReason(existing as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null } | null);
          if (duplicateSkipReason) {
            return jsonResponse({
              ok: false,
              skipped: true,
              status: 'skipped',
              reason: 'duplicate_gate',
              error: 'This post is marked as a duplicate. Clear or override the duplicate first before forcing X.',
              dup_of_tweet_id: (existing as { dup_of_tweet_id?: string | null } | null)?.dup_of_tweet_id ?? null,
            }, 200);
          }
          const needsRescore = !existing
            || !existing.text_translated
            || typeof existing.text_translated !== 'string'
            || (existing.text_translated as string).trim().length === 0
            || existing.importance_score == null
            || existing.final_score == null;
          if (needsRescore) {
            const r = await runRescore(supabase, tweetId);
            prep = { ran: true, ok: r.ok, score: r.score, decision: r.decision, error: r.error };
            if (!r.ok) {
              return jsonResponse({ ok: false, error: `pre-post translate/score failed: ${r.error}`, prep }, 200);
            }
          }

          const { data: afterPrep } = await supabase
            .from('posts')
            .select('is_truncated, hydrated_at')
            .eq('tweet_id', tweetId)
            .maybeSingle();
          if (afterPrep?.is_truncated === true && !afterPrep?.hydrated_at) {
            const hydrate = await queueHydrationJob(supabase, tweetId, 'force_x');
            return jsonResponse({
              ok: true,
              status: 'waiting_hydration',
              queued: hydrate.queued ? 'hydrate' : false,
              reason: hydrate.reason ?? 'truncated_post_requires_hydration_before_x',
              prep: { ...prep, hydrate: hydrate.queued ? 'queued' : hydrate.reason },
            }, 200);
          }
        }

        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/x-poster`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dry_run: action === 'dry_run_x_post',
              ...(tweetId ? { tweet_id: tweetId } : {}),
            }),
          });
          const text = await resp.text();
          let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
          if (!resp.ok) return jsonResponse({ ok: false, error: `x-poster ${resp.status}: ${text.slice(0, 300)}`, raw: parsed, prep }, 200);
          const parsedObj = parsed as { results?: Array<Record<string, unknown>> };
          const result = tweetId ? (parsedObj?.results?.[0] ?? null) : null;
          if (tweetId && action === 'retry_x_post' && result?.status === 'posted') {
            await recordFeedback(supabase, tweetId, 'force_x', 1).catch(() => {});
            await supabase.from('posts').update({ feedback_locked: true }).eq('tweet_id', tweetId);
          }
          return jsonResponse({
            ok: true,
            prep,
            ...(parsed as Record<string, unknown>),
            ...(result
              ? {
                status: (result.status as string | undefined) ?? undefined,
                x_tweet_id: (result.x_tweet_id as string | undefined) ?? undefined,
                error: (result.error as string | undefined) ?? undefined,
              }
              : {}),
          });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message, prep }, 200);
        }
      }


      // ===== X API: credential status =====
      case 'get_x_status': {
        return jsonResponse({
          success: true,
          status: {
            TWITTER_CONSUMER_KEY: !!Deno.env.get('TWITTER_CONSUMER_KEY'),
            TWITTER_CONSUMER_SECRET: !!Deno.env.get('TWITTER_CONSUMER_SECRET'),
            TWITTER_ACCESS_TOKEN: !!Deno.env.get('TWITTER_ACCESS_TOKEN'),
            TWITTER_ACCESS_TOKEN_SECRET: !!Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET'),
          },
        });
      }

      // ===== X API: verify credentials =====
      case 'x_verify_credentials': {
        const { data: controlsRow } = await supabase.from('settings').select('value').eq('key', 'x_api_controls').maybeSingle();
        const controls = (controlsRow?.value ?? {}) as Record<string, unknown>;
        const cacheMinutes = typeof controls.verify_cache_minutes === 'number' ? controls.verify_cache_minutes : 15;
        const { data: cachedRow } = await supabase.from('settings').select('value').eq('key', 'x_self_id').maybeSingle();
        const cached = (cachedRow?.value ?? {}) as Record<string, unknown>;
        const cachedAt = typeof cached.cached_at === 'string' ? new Date(cached.cached_at).getTime() : 0;
        const hasFreshCachedSelf = cached.id && cached.username && cachedAt > Date.now() - cacheMinutes * 60 * 1000;
        if (hasFreshCachedSelf) {
          return jsonResponse({
            ok: true,
            cached: true,
            id: cached.id,
            handle: cached.username,
            name: cached.name,
            cached_at: cached.cached_at,
          });
        }
        if (!isMyXEnabled(controls)) {
          return jsonResponse({
            ok: false,
            disabled: true,
            reason: 'owned_reads_disabled',
            error: 'Owned-read credential verification is paused to prevent X API user-read charges.',
          }, 200);
        }
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const url = 'https://api.x.com/2/users/me';
        try {
          const auth = await xOauthHeader('GET', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
          const resp = await fetch(url, { headers: { Authorization: auth } });
          const text = await resp.text();
          let parsedBody: unknown;
          try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
          await recordAdminXApiAttempt(supabase, { action: 'verify_credentials', endpoint: url, method: 'GET' }, resp);
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}`, raw: parsedBody });
          const user = (parsedBody as { data?: { id?: string; username?: string; name?: string } })?.data;
          if (user?.id) {
            await supabase.from('settings').upsert({
              key: 'x_self_id',
              value: { id: user.id, username: user.username, name: user.name, cached_at: new Date().toISOString() },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'key' });
          }
          return jsonResponse({ ok: true, id: user?.id, handle: user?.username, name: user?.name, raw: parsedBody });
        } catch (e) {
          await recordAdminXApiAttempt(supabase, { action: 'verify_credentials', endpoint: url, method: 'GET', error: (e as Error).message }, null);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== X API: send test tweet =====
      case 'send_test_tweet': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const replyTo = typeof body.in_reply_to_tweet_id === 'string' ? body.in_reply_to_tweet_id.trim() : '';
        if (text.length === 0 || text.length > 280) {
          return jsonResponse({ ok: false, error: 'text must be 1-280 characters' }, 400);
        }
        if (replyTo && !/^\d{1,25}$/.test(replyTo)) {
          return jsonResponse({ ok: false, error: 'in_reply_to_tweet_id must be a numeric tweet ID' }, 400);
        }
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const url = 'https://api.x.com/2/tweets';
        const payload: Record<string, unknown> = { text };
        if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
        try {
          // Per X docs, POST body params are NOT included in OAuth signature for /2/tweets JSON body
          const auth = await xOauthHeader('POST', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
          const resp = await fetch(url, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const respText = await resp.text();
          let respBody: unknown;
          try { respBody = JSON.parse(respText); } catch { respBody = respText; }
          await recordAdminXApiAttempt(supabase, { action: 'send_test_tweet', endpoint: url, method: 'POST' }, resp, { post: resp.ok });
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${respText.slice(0, 300)}`, response: respBody });
          const created = (respBody as { data?: { id?: string; text?: string } })?.data;
          return jsonResponse({ ok: true, tweet_id: created?.id, response: respBody });
        } catch (e) {
          await recordAdminXApiAttempt(supabase, { action: 'send_test_tweet', endpoint: url, method: 'POST', error: (e as Error).message }, null);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== X API: test hydration (no DB write) =====
      case 'test_hydrate_tweet': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!/^\d{1,25}$/.test(tweetId)) {
          return jsonResponse({ ok: false, error: 'tweet_id must be a numeric tweet ID' }, 400);
        }
        const creds = getXCreds();
        if (!creds) return jsonResponse({ ok: false, error: 'One or more TWITTER_* secrets are missing' }, 200);
        const baseUrl = `https://api.x.com/2/tweets/${tweetId}`;
        const queryParams = { 'tweet.fields': 'note_tweet,text,lang' };
        try {
          const auth = await xOauthHeader('GET', baseUrl, queryParams, creds.ck, creds.cs, creds.at, creds.ats);
          const url = `${baseUrl}?${Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
          const resp = await fetch(url, { headers: { Authorization: auth } });
          const respText = await resp.text();
          let respBody: unknown;
          try { respBody = JSON.parse(respText); } catch { respBody = respText; }
          await recordAdminXApiAttempt(supabase, { action: 'test_hydrate', endpoint: baseUrl, method: 'GET', tweetId }, resp);
          if (!resp.ok) return jsonResponse({ ok: false, error: `HTTP ${resp.status}: ${respText.slice(0, 300)}`, raw: respBody });
          const data = (respBody as { data?: { text?: string; lang?: string; note_tweet?: { text?: string } } })?.data;
          return jsonResponse({
            ok: true,
            tweet_id: tweetId,
            text: data?.text,
            lang: data?.lang,
            note_tweet: data?.note_tweet?.text,
            raw: respBody,
          });
        } catch (e) {
          await recordAdminXApiAttempt(supabase, { action: 'test_hydrate', endpoint: baseUrl, method: 'GET', tweetId, error: (e as Error).message }, null);
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== Backfill: re-hydrate recent truncated tweets matching new heuristics =====
      case 'rehydrate_recent_truncated': {
        const hours = typeof body.hours === 'number' && body.hours > 0 && body.hours <= 168 ? body.hours : 24;
        const dryRun = body.dry_run !== false;
        const force = body.force === true;
        const requestedMax = typeof body.max === 'number' && body.max > 0 ? Math.floor(body.max) : null;
        const threshold = await loadActiveThreshold(supabase);
        const { data: controlsRow } = await supabase.from('settings').select('value').eq('key', 'x_api_controls').maybeSingle();
        const controls = (controlsRow?.value ?? {}) as Record<string, unknown>;
        const defaultMax = typeof controls.backfill_max_hydrate_jobs_per_run === 'number' ? controls.backfill_max_hydrate_jobs_per_run : 100;
        const maxJobs = Math.min(Math.max(requestedMax ?? defaultMax, 1), 500);
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        // Pull recent posts that haven't been hydrated yet. Cap at 500 to stay safe.
        const { data: posts, error: fetchErr } = await supabase
          .from('posts')
          .select('tweet_id, text_original, url, delivery_decision, final_score, importance_score')
          .is('hydrated_at', null)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500);

        if (fetchErr) return jsonResponse({ ok: false, error: fetchErr.message }, 500);

        // Re-implement the same heuristics as webhooks-rssapp/detectTruncation
        const looksTruncated = (raw: string | null | undefined): boolean => {
          if (!raw) return false;
          const t = raw.trim();
          if (!t) return false;
          if (/(^|\s)(show\s+more|show\s+this\s+thread|read\s+more)\s*$/i.test(t)) return true;
          if (/(\u2026|\.{3}|\[\u2026\]|\[\.{3}\])\s*$/.test(t) && t.length >= 200) return true;
          if (t.length >= 270) {
            const last = t.charAt(t.length - 1);
            if (!['.', '!', '?', '\u061F', '"', ')', '\u201D', '\u300D'].includes(last)) return true;
          }
          if (/\b(pic\.?|pic\.t|pic\.tw(?:itter)?(?:\.c(?:om?)?)?\/?)\s*$/i.test(t)) return true;
          if (t.length >= 240 && /(\u2026|\[\u2026\]|\.{3}|\[\.{3}\])/.test(t)) {
            const last = t.charAt(t.length - 1);
            if (!['"', ')', '\u201D', '\u300D', ']', '}'].includes(last)) return true;
          }
          if (t.length >= 240) {
            const tokens = t.split(/\s+/);
            const lastToken = tokens[tokens.length - 1] || '';
            if (/^(a|an|the|to|of|in|on|for|and|or|but|with|by|at|as|is|was|are|were|has|have|had)\.?$/i.test(lastToken)) return true;
          }
          return false;
        };

        const truncatedMatches = (posts ?? []).filter((p) => looksTruncated(p.text_original as string | null));
        const matches = truncatedMatches.filter((p) => {
          if (force) return true;
          const score = typeof p.final_score === 'number' ? p.final_score : p.importance_score;
          return p.delivery_decision === 'deliver' && typeof score === 'number' && score >= threshold;
        }).slice(0, maxJobs);
        const excludedByGate = truncatedMatches.length - matches.length;
        let queued = 0;
        let skippedExisting = 0;
        const errors: string[] = [];

        for (const p of matches) {
          const tweetId = p.tweet_id as string;
          const { data: existingJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('type', 'hydrate_tweet')
            .in('status', ['pending', 'running'])
            .filter('payload->>tweet_id', 'eq', tweetId)
            .limit(1);
          if (existingJob && existingJob.length > 0) {
            skippedExisting++;
            continue;
          }

          if (dryRun) {
            queued++;
            continue;
          }

          // Mark as truncated so worker behavior is consistent
          const { error: upErr } = await supabase
            .from('posts')
            .update({ is_truncated: true })
            .eq('tweet_id', tweetId);
          if (upErr) { errors.push(`update ${tweetId}: ${upErr.message}`); continue; }

          const { error: jobErr } = await supabase
            .from('jobs')
            .upsert({
              type: 'hydrate_tweet',
              payload: { tweet_id: tweetId },
              status: 'pending',
              priority: 15,
              idempotency_key: `hydrate:backfill:${tweetId}`,
              next_run_at: new Date().toISOString(),
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

          if (jobErr) { errors.push(`job ${tweetId}: ${jobErr.message}`); continue; }
          queued++;
        }

        return jsonResponse({
          ok: true,
          dry_run: dryRun,
          scanned: posts?.length ?? 0,
          matched: matches.length,
          excluded_by_gate: excludedByGate,
          queued,
          skipped_existing: skippedExisting,
          max: maxJobs,
          hours,
          force,
          errors: errors.slice(0, 10),
        });
      }

      // ===== Backward-compatible alias for old Story Memory backfill =====
      case 'backfill_signatures': {
        return jsonResponse(await backfillSignaturesAdminAction(supabase, body));
      }

      // ===== Re-score recent posts that are missing score_axes =====
      case 'rescore_recent': {
        const hours = typeof body.hours === 'number' && body.hours > 0 && body.hours <= 168 ? body.hours : 48;
        const onlyMissing = body.only_missing !== false; // default true
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from('posts')
          .select('tweet_id, score_axes')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(2000);
        const { data: posts, error: fetchErr } = await q;
        if (fetchErr) return jsonResponse({ ok: false, error: fetchErr.message }, 500);
        const targets = (posts ?? []).filter((p) => !onlyMissing || p.score_axes == null);
        let queued = 0;
        const stamp = Date.now();
        for (const p of targets) {
          const tid = p.tweet_id as string;
          const { error } = await supabase.from('jobs').upsert({
            type: 'translate',
            payload: { tweet_id: tid, force_rescore: true },
            status: 'pending',
            priority: 9,
            idempotency_key: `translate:rescore:${tid}:${stamp}`,
            next_run_at: new Date().toISOString(),
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
          if (!error) queued++;
        }
        return jsonResponse({ ok: true, scanned: posts?.length ?? 0, matched: targets.length, queued, hours });
      }

      case 'preview_translation': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return jsonResponse({ ok: false, error: 'text is required' }, 400);
        if (text.length > 8000) return jsonResponse({ ok: false, error: 'text must be ≤8000 characters' }, 400);

        const ts = (body.translation_settings ?? {}) as Record<string, unknown>;
        const cf = (body.content_filter ?? {}) as Record<string, unknown>;
        const authorHandle = typeof body.author_handle === 'string' ? body.author_handle.trim() : '';

        const model = typeof ts.model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(ts.model) ? ts.model : 'gpt-4o-mini';
        const translationPrompt = typeof ts.system_prompt === 'string' && ts.system_prompt.trim()
          ? ts.system_prompt as string
          : 'You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.';
        const temperature = typeof ts.temperature === 'number' ? ts.temperature : 0.2;
        const maxTokens = typeof ts.max_completion_tokens === 'number' ? Math.min(8000, Math.max(1, ts.max_completion_tokens)) : 2000;
        const topP = typeof ts.top_p === 'number' ? ts.top_p : null;
        const freqPen = typeof ts.frequency_penalty === 'number' ? ts.frequency_penalty : null;
        const presPen = typeof ts.presence_penalty === 'number' ? ts.presence_penalty : null;
        const reasoningEffort = typeof ts.reasoning_effort === 'string' ? ts.reasoning_effort as string : null;
        const verbosity = typeof ts.verbosity === 'string' ? ts.verbosity as string : null;
        const seed = typeof ts.seed === 'number' ? ts.seed : null;
        const serviceTier = typeof ts.service_tier === 'string' ? ts.service_tier as string : null;
        const parallelToolCalls = typeof ts.parallel_tool_calls === 'boolean' ? ts.parallel_tool_calls as boolean : null;
        // Note: token-param choice and reasoning-vs-non-reasoning gating now
        // live inside the shared callOpenAI helper, which also routes the
        // gpt-5.4 family to the /v1/responses endpoint as required by OpenAI.
        const customScoringPrompt = typeof ts.scoring_system_prompt === 'string' && ts.scoring_system_prompt.trim() ? ts.scoring_system_prompt as string : null;
        const customToolSchema = typeof ts.classifier_tool_schema === 'string' && ts.classifier_tool_schema.trim() ? ts.classifier_tool_schema as string : null;

        const sharedCallOpts = {
          temperature,
          topP,
          frequencyPenalty: freqPen,
          presencePenalty: presPen,
          reasoningEffort,
          verbosity,
          seed,
          serviceTier,
          parallelToolCalls,
        } as const;

        const filterEnabled = cf.enabled === true || cf.score_only === true;

        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) return jsonResponse({ ok: false, error: 'OPENAI_API_KEY is not configured' }, 500);

        const startedAt = Date.now();
        let translatedText = '';
        let importanceScore: number | null = null;
        let importanceTags: string[] | null = null;
        let reasoning: string | null = null;
        let raw: Record<string, unknown> = {};
        let usedEndpoint: 'chat.completions' | 'responses' = 'chat.completions';

        try {
          if (filterEnabled) {
            const priorityTopics = Array.isArray(cf.priority_topics) ? (cf.priority_topics as string[]).join(', ') : 'none specified';
            const lowPriorityTopics = Array.isArray(cf.low_priority_topics) ? (cf.low_priority_topics as string[]).join(', ') : 'none specified';
            const guidelines = typeof cf.editorial_guidelines === 'string' ? cf.editorial_guidelines : '';
            const guidelinesBlock = guidelines.trim()
              ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${guidelines}\n---`
              : '';

            const scoringTemplate = customScoringPrompt ?? `You have two tasks. Complete both carefully.\n\n## Task 1: Translation\n{translation_prompt}\n\n## Task 2: News Importance Scoring\nYou are an editorial assistant. Score 1-20 based on importance to an Iran/Middle East news channel. Cap non-Iran content at 8.\n\nManual calibration: direct Iran crisis, war, diplomacy, and military-posture items should usually score 17-19 when credible. Trump/Netanyahu/US/Pakistan leadership statements or coordination specifically about Iran are DIRECT audience-fit, not routine foreign politics. Qeshm/Hormuz, air-defense, drones, refueling tankers, US-Israel posture, IRGC/proxy threats, nuclear/escalation signals, and threats against POTUS family or senior US targets are very high impact. Pure Taiwan or unrelated domestic news with no Iran/Middle East nexus remains low/off-topic.\n\nHigh-priority: {priority_topics}\nLow-priority: {low_priority_topics}\n\n{editorial_guidelines_block}\n\nYou MUST call the "classify_importance" tool.`;
            const systemPrompt = scoringTemplate
              .replace('{translation_prompt}', translationPrompt)
              .replace('{priority_topics}', priorityTopics)
              .replace('{low_priority_topics}', lowPriorityTopics)
              .replace('{editorial_guidelines_block}', guidelinesBlock);

            let toolFunction: ToolFunctionDef;
            try {
              toolFunction = customToolSchema
                ? JSON.parse(customToolSchema)
                : {
                    name: 'classify_importance',
                    description: 'Provide the Persian translation and importance classification of this news item',
                    parameters: {
                      type: 'object',
                      properties: {
                        translated_text: { type: 'string' },
                        importance_score: { type: 'integer', minimum: 1, maximum: 20 },
                        tags: { type: 'array', items: { type: 'string' } },
                        reasoning: { type: 'string' },
                      },
                      required: ['translated_text', 'importance_score', 'tags', 'reasoning'],
                    },
                  };
            } catch (e) {
              return jsonResponse({ ok: false, error: `Invalid classifier_tool_schema JSON: ${(e as Error).message}` }, 400);
            }

            const userMessage = `Author: @${authorHandle || 'preview'}\nPublished: ${new Date().toISOString()}\nHas media: no\nURL: N/A\n\nContent:\n${text}`;

            const result = await callOpenAI({
              apiKey: openaiApiKey,
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
              ],
              tool: toolFunction,
              maxOutputTokens: maxTokens,
              ...sharedCallOpts,
            });
            raw = result.raw;
            usedEndpoint = result.endpoint;
            if (!result.ok) return jsonResponse({ ok: false, error: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}`, result: { raw, endpoint: usedEndpoint } });

            if (result.toolCall) {
              try {
                const args = JSON.parse(result.toolCall.arguments);
                translatedText = args.translated_text || '';
                importanceScore = Math.max(1, Math.min(20, args.importance_score || 10));
                importanceTags = Array.isArray(args.tags) ? args.tags : [];
                reasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
              } catch (parseErr) {
                translatedText = result.content;
                reasoning = `Tool-call parse error: ${(parseErr as Error).message}`;
              }
            } else {
              translatedText = result.content;
            }
          } else {
            // Simple translation only
            const result = await callOpenAI({
              apiKey: openaiApiKey,
              model,
              messages: [
                { role: 'system', content: translationPrompt },
                { role: 'user', content: text },
              ],
              maxOutputTokens: maxTokens,
              ...sharedCallOpts,
            });
            raw = result.raw;
            usedEndpoint = result.endpoint;
            if (!result.ok) return jsonResponse({ ok: false, error: `OpenAI ${result.status}: ${result.rawText.slice(0, 500)}`, result: { raw, endpoint: usedEndpoint } });
            translatedText = result.content;
          }

          const usage = (raw as { usage?: Record<string, number> }).usage ?? null;
          return jsonResponse({
            ok: true,
            result: {
              translated_text: translatedText,
              importance_score: importanceScore,
              importance_tags: importanceTags,
              reasoning,
              model,
              endpoint: usedEndpoint,
              usage,
              duration_ms: Date.now() - startedAt,
              used_filter: filterEnabled,
              raw,
            },
          });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message });
        }
      }

      // ===== Re-score an existing post using current settings =====
      case 'rescore_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        if (!tweetId) return jsonResponse({ ok: false, error: 'tweet_id is required' }, 400);
        const scoringPolicy = await loadScoringPolicyConfig(supabase);
        if (scoringPolicy.enabled === true || body.scoring_policy_v2 === true) {
          const v2 = await scorePostV2(supabase, { ...body, tweet_id: tweetId, force: true }, { insertAdminPipelineEvent });
          return jsonResponse({
            ok: v2.ok,
            tweet_id: tweetId,
            score: v2.result?.raw_priority_score,
            final_score: v2.result?.final_score,
            tags: v2.result?.tags,
            reasoning: v2.result?.audience_reason,
            decision: v2.result?.delivery_decision,
            decision_reason: v2.result?.decision_reason,
            threshold: v2.result?.threshold,
            model: (await loadScoringModelOptions(supabase)).model,
            audience_class: v2.result?.audience_class,
            audience_confidence: v2.result?.audience_confidence,
            error: v2.ok ? undefined : v2.error,
          });
        }
        const { data: prePost } = await supabase.from('posts').select('final_score').eq('tweet_id', tweetId).maybeSingle();
        const oldScore = prePost?.final_score != null ? Number(prePost.final_score) : null;
        const r = await runRescore(supabase, tweetId);
        if (!r.ok) return jsonResponse({ ok: false, error: r.error }, 200);
        if (oldScore !== null && r.final_score != null) {
          const diff = r.final_score - oldScore;
          if (Math.abs(diff) >= 0.5) {
            const act = diff < 0 ? 'dispute_high' : 'dispute_low';
            const pol = diff < 0 ? -1 : 1;
            await recordFeedback(supabase, tweetId, act, pol, { old_score: oldScore, new_score: r.final_score }).catch(() => {});
          }
        }
        return jsonResponse({
          ok: true,
          tweet_id: tweetId,
          score: r.score,
          final_score: r.final_score,
          tags: r.tags,
          reasoning: r.reasoning,
          decision: r.decision,
          decision_reason: r.decision_reason,
          threshold: r.threshold,
          model: r.model,
        });
      }

      case 'translate_post': {
        const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
        const mode = typeof body.mode === 'string' ? body.mode : 'translation_only';
        if (!tweetId) return jsonResponse({ ok: false, error: 'tweet_id is required' }, 400);
        if (mode !== 'translation_only') return jsonResponse({ ok: false, error: 'Only translation_only mode is supported' }, 400);
        const result = await runTranslationOnly(supabase, tweetId);
        return jsonResponse({ ...result, tweet_id: tweetId, mode });
      }

      case 'set_manual_score': {
        return jsonResponse(await setManualScore(supabase, body, {
          recordFeedback,
          insertAdminPipelineEvent,
          runTranslationOnly,
          queueManualAdvance,
        }));
      }

      case 'record_score_feedback': {
        return jsonResponse(await recordScoreFeedback(supabase, body, {
          recordFeedback,
          insertAdminPipelineEvent,
        }));
      }

      case 'ignore_monitoring_item': {
        const result = await ignoreMonitoringItemAdminAction(supabase, body, {
          updateLatestPostEnrichment,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== Run X followers snapshot manually =====
      case 'run_followers_snapshot': {
        const { data: controlsRow } = await supabase.from('settings').select('value').eq('key', 'x_api_controls').maybeSingle();
        const controls = (controlsRow?.value ?? {}) as Record<string, unknown>;
        if (!isMyXEnabled(controls)) {
          return jsonResponse(MY_X_DISABLED_RESPONSE);
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const force = body.force === true;
        const dryRun = body.dry_run === true;
        const includeFollowing = body.include_following !== false;
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/x-followers-snapshot`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trigger: 'manual', force, dry_run: dryRun, include_following: includeFollowing }),
          });
          const text = await resp.text();
          let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
          if (!resp.ok) return jsonResponse({ ok: false, error: `snapshot ${resp.status}: ${text.slice(0, 300)}`, raw: parsed }, 200);
          return jsonResponse({ ok: true, ...(parsed as Record<string, unknown>) });
        } catch (e) {
          return jsonResponse({ ok: false, error: (e as Error).message }, 200);
        }
      }

      // ===== Clear duplicate (not-a-duplicate feedback) =====
      case 'clear_dup': {
        const { tweet_id, related_tweet_id } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);
        const { error: clrErr } = await supabase.from('posts').update({
          dup_of_tweet_id: null,
          dup_similarity: null,
          dedupe_status: 'unique',
          dedupe_method: 'none',
          dedupe_confidence: null,
          dedupe_reason: 'cleared_by_admin',
          dedupe_new_facts: [],
          dedupe_checked_at: new Date().toISOString(),
          delivery_decision: 'deliver',
          decision_reason: 'dup_cleared_by_admin',
          feedback_locked: true,
        }).eq('tweet_id', tweet_id);
        if (clrErr) throw clrErr;
        if (related_tweet_id) {
          const pairA = tweet_id < related_tweet_id ? tweet_id : related_tweet_id;
          const pairB = tweet_id < related_tweet_id ? related_tweet_id : tweet_id;
          await supabase.from('story_pair_blocklist').upsert(
            { tweet_a: pairA, tweet_b: pairB, reason: 'not_duplicate_admin' },
            { onConflict: 'tweet_a,tweet_b' },
          ).then(() => null, (e: Error) => console.warn('blocklist upsert failed', e.message));
        }
        await recordFeedback(supabase, tweet_id, 'not_duplicate', -2, {}, related_tweet_id).catch(() => {});
        return jsonResponse({ success: true, message: 'Duplicate cleared and pair blocklisted' });
      }

      // ===== Reset learned biases =====
      case 'reset_learned_biases': {
        await supabase.from('settings').upsert({
          key: 'learned_biases',
          value: { author_bias: {}, tag_bias: {}, keyword_bias: {} },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
        return jsonResponse({ success: true, message: 'Learned biases reset' });
      }

      // ===== Approve enrichment and queue delivery =====
      case 'approve_enrichment': {
        const { tweet_id } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);

        await supabase.from('posts').update({ enrich_status: 'approved' }).eq('tweet_id', tweet_id);
        await updateLatestPostEnrichment(supabase, tweet_id, { status: 'approved', approved_at: new Date().toISOString() });
        await insertAdminPipelineEvent(supabase, tweet_id, 'enrich', 'completed', { source: 'approve_enrichment', approved_for_x: true });

        return jsonResponse({ ok: true, message: `Enrichment approved for X text on ${tweet_id}` });
      }

      // ===== Reject enrichment (plain X posting can still proceed unless enrichment is explicitly required) =====
      case 'reject_enrichment': {
        const { tweet_id } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);

        await supabase.from('posts').update({ enrich_status: 'rejected' }).eq('tweet_id', tweet_id);
        await updateLatestPostEnrichment(supabase, tweet_id, { status: 'rejected', rejected_at: new Date().toISOString() });

        return jsonResponse({ ok: true, message: `Enrichment rejected for ${tweet_id}` });
      }

      // ===== Record enrichment feedback without posting =====
      case 'record_enrichment_feedback': {
        const { tweet_id, feedback, note } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);
        if (!feedback || typeof feedback !== 'string') return jsonResponse({ error: 'feedback is required' }, 400);
        const allowed = new Set([
          'too_ai',
          'too_cheesy',
          'too_aggregator',
          'strong_angle',
          'needs_more_context',
          'unsafe_for_monetization',
          'sounds_like_me',
          'too_soft',
          'too_newsy',
          'not_blunt_enough',
          'too_long',
          'good_clapback',
          'too_risky',
        ]);
        if (!allowed.has(feedback)) return jsonResponse({ error: `unsupported feedback: ${feedback}` }, 400);
        await updateLatestPostEnrichment(supabase, tweet_id, {
          feedback_label: feedback,
          feedback_note: typeof note === 'string' ? note.slice(0, 500) : null,
          feedback_at: new Date().toISOString(),
        });
        await insertAdminPipelineEvent(supabase, tweet_id, 'enrich_feedback', 'completed', { feedback });
        return jsonResponse({ ok: true });
      }

      // ===== Generate and persist @masihh voice profile from the canonical guide =====
      case 'generate_voice_profile': {
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) return jsonResponse({ ok: false, error: 'OPENAI_API_KEY is not configured' }, 500);

        const guide = normalizeVoiceGuide({
          guide: typeof body.guide === 'string' ? body.guide : undefined,
          updated_at: new Date().toISOString(),
        });
        const { data: rows } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['enrichment_config', 'voice_samples']);
        const settings = new Map((rows ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
        const config = normalizeEnrichmentConfig((settings.get('enrichment_config') ?? { enabled: false }) as Partial<EnrichmentConfig>);
        const voiceSamples = (settings.get('voice_samples') ?? { samples: [], updated_at: null }) as VoiceSamples;
        const result = await generatePersonalVoiceProfile({
          apiKey: openaiApiKey,
          model: config.model || 'gpt-5.4-mini',
          voiceGuide: guide,
          voiceSamples,
        });

        await supabase.from('settings').upsert([
          { key: 'voice_guide', value: guide, updated_at: new Date().toISOString() },
          { key: 'personal_voice_profile', value: result.profile, updated_at: new Date().toISOString() },
        ], { onConflict: 'key' });

        return jsonResponse({ ok: true, profile: result.profile, usage: result.usage });
      }

      // ===== Select one manual enrichment variant for the X preview, without posting =====
      case 'select_enrichment_variant': {
        const { tweet_id, variant } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);
        if (!variant || typeof variant !== 'string') return jsonResponse({ error: 'variant is required' }, 400);

        const { data: post, error: postErr } = await supabase
          .from('posts')
          .select('source_context')
          .eq('tweet_id', tweet_id)
          .maybeSingle();
        if (postErr) throw postErr;
        const sourceContext = (post?.source_context && typeof post.source_context === 'object' ? post.source_context : {}) as Record<string, unknown>;
        const voice = (sourceContext.voice && typeof sourceContext.voice === 'object' ? sourceContext.voice : {}) as Record<string, unknown>;
        const variants = Array.isArray(voice.variants) ? voice.variants as Array<Record<string, unknown>> : [];
        const selected = variants.find((item) => item.kind === variant);
        if (!selected) return jsonResponse({ ok: false, error: `Variant not found: ${variant}` }, 404);

        const updatedVoice = { ...voice, selected_variant: variant };
        const updatedSourceContext = { ...sourceContext, voice: updatedVoice };
        const finalXText = typeof selected.final_x_text === 'string' ? selected.final_x_text : null;
        if (!finalXText) return jsonResponse({ ok: false, error: `Variant ${variant} has no final_x_text` }, 400);

        const patch = {
          final_x_text: finalXText,
          composed_post_text: finalXText,
          creator_angle: typeof selected.creator_angle === 'string' ? selected.creator_angle : null,
          why_it_matters: typeof selected.why_it_matters === 'string' ? selected.why_it_matters : null,
          source_context: updatedSourceContext,
        };
        const { error: updateErr } = await supabase.from('posts').update(patch).eq('tweet_id', tweet_id);
        if (updateErr) throw updateErr;
        await updateLatestPostEnrichment(supabase, tweet_id, {
          final_x_text: finalXText,
          creator_angle: patch.creator_angle,
          why_it_matters: patch.why_it_matters,
          source_context: updatedSourceContext,
        });
        await insertAdminPipelineEvent(supabase, tweet_id, 'enrich_variant', 'completed', { selected_variant: variant });
        return jsonResponse({ ok: true, selected_variant: variant, final_x_text: finalXText });
      }

      // ===== Manually trigger enrichment on a post (never auto-posts) =====
      case 'enrich_post': {
        const { tweet_id } = body;
        if (!tweet_id) return jsonResponse({ error: 'tweet_id is required' }, 400);

        const { data: existingPost, error: existingErr } = await supabase
          .from('posts')
          .select('tweet_id, text_translated, translated_at')
          .eq('tweet_id', tweet_id)
          .maybeSingle();
        if (existingErr) throw existingErr;
        if (!existingPost) return jsonResponse({ ok: false, error: `Post not found: ${tweet_id}` }, 404);

        let translation: { ok: boolean; translated?: string; model?: string; error?: string } | null = null;
        if (!existingPost.text_translated && !existingPost.translated_at) {
          translation = await runTranslationOnly(supabase, tweet_id);
          if (!translation.ok) {
            return jsonResponse({ ok: false, error: `translation preflight failed: ${translation.error}`, translation }, 200);
          }
        }

        // Reset enrichment fields so the pipeline runs fresh
        await supabase.from('posts').update({
          enrich_status: 'pending',
          background_context: null,
          editorial_commentary: null,
          humanized_commentary: null,
          commentary_hook: null,
          commentary_question: null,
          narrative_callback: null,
          narrative_ref_post_id: null,
          composed_post_text: null,
          enrichment_version: null,
          creator_angle: null,
          why_it_matters: null,
          source_context: null,
          algorithm_signal_scores: null,
          aggregator_risk_score: null,
          ai_voice_risk_score: null,
          monetization_risk_flags: [],
          enrichment_review_reason: null,
          final_x_text: null,
          post_format_hint: null,
          thread_continuation: null,
          enrich_model: null,
          enrich_tokens: null,
          enrich_duration_ms: null,
        }).eq('tweet_id', tweet_id);

        // Upsert an enrich job with force_review flag, clearing all lock fields
        const { error: jobErr } = await supabase.from('jobs').upsert({
          type: 'enrich',
          payload: { tweet_id, force_review: true },
          idempotency_key: `enrich:${tweet_id}`,
          status: 'pending',
          attempts: 0,
          created_at: new Date().toISOString(),
          locked_at: null,
          lease_expires_at: null,
          next_run_at: new Date().toISOString(),
          last_error: null,
        }, { onConflict: 'idempotency_key', ignoreDuplicates: false });
        if (jobErr) throw jobErr;
        await insertAdminPipelineEvent(supabase, tweet_id, 'enrich', 'queued', {
          source: 'manual_enrich_post',
          translation_preflight: translation?.ok === true,
        });
        const workerDispatch = await dispatchWorkerForManualEnrich();
        if (!workerDispatch.ok) {
          await insertAdminPipelineEvent(supabase, tweet_id, 'enrich_dispatch', 'failed', {
            source: 'manual_enrich_post',
            queued: true,
            error: workerDispatch.error,
            status: workerDispatch.status,
          }, workerDispatch.error ?? null);
        } else {
          await insertAdminPipelineEvent(supabase, tweet_id, 'enrich_dispatch', 'completed', {
            source: 'manual_enrich_post',
            processed: workerDispatch.processed,
            message: workerDispatch.message,
          });
        }
        return jsonResponse({
          ok: true,
          message: `Enrichment draft queued for ${tweet_id}`,
          translation_preflight: translation,
          worker_dispatch: workerDispatch,
        });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Admin action error:', message);
    return jsonResponse({ error: message }, 500);
  }
});
