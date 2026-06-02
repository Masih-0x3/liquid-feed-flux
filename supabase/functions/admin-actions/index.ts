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
import {
  DEFAULT_DUPLICATE_GATE,
  normalizeDuplicateGateConfig,
  runDuplicateGate,
} from "../_shared/dedupe.ts";
import { duplicateXSkipReason } from "../_shared/duplicateGuard.ts";
import {
  SCORING_POLICY_VERSION,
  buildScoringPolicyEventMeta,
  normalizeScoringPolicy,
  runScoringPolicy,
  type AudienceClass,
  type ScoringPolicy,
  type ScoringPolicyResult,
} from "../_shared/scoringPolicy.ts";
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
import { isMyXEnabled, MY_X_DISABLED_RESPONSE } from "../_shared/myXControls.ts";

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

// deno-lint-ignore no-explicit-any
async function setManualScore(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const score = Number(body.score);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const overrideDuplicate = body.override_duplicate === true;
  const expectedAudienceClass = isAudienceClass(body.expected_audience_class) ? body.expected_audience_class : null;
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };
  if (!Number.isInteger(score) || score < 1 || score > 20) return { ok: false, error: 'score must be a whole number between 1 and 20' };

  const threshold = await loadActiveThreshold(supabase);
  const { data: post } = await supabase
    .from('posts')
    .select('tweet_id, final_score, importance_score, dup_of_tweet_id, score_breakdown, text_translated, translated_at')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return { ok: false, error: `Post not found: ${tweetId}` };

  const oldScore = typeof post.final_score === 'number'
    ? post.final_score
    : (typeof post.importance_score === 'number' ? post.importance_score : null);
  const passes = score >= threshold;
  const relatedTweetId = typeof post.dup_of_tweet_id === 'string' ? post.dup_of_tweet_id : null;
  const duplicateBlocks = !!relatedTweetId && !overrideDuplicate;
  const decision = passes && !duplicateBlocks ? 'deliver' : 'skip';
  const decisionReason = duplicateBlocks
    ? `manual_score_blocked_duplicate:${score}>=${threshold}`
    : passes
      ? `manual_score_pass:${score}>=${threshold}`
      : `manual_score_skip:${score}<${threshold}`;
  const existingBreakdown = post.score_breakdown && typeof post.score_breakdown === 'object' ? post.score_breakdown as Record<string, unknown> : {};
  const updatePayload: Record<string, unknown> = {
    final_score: score,
    importance_score: score,
    delivery_decision: decision,
    decision_reason: decisionReason,
    feedback_locked: true,
    score_breakdown: {
      ...existingBreakdown,
      manual: score,
      final: score,
    },
    ...(expectedAudienceClass ? {
      audience_class: expectedAudienceClass,
      audience_confidence: 1,
      audience_reason: reason || 'manual_score_audience_class',
      score_review_status: 'approved',
    } : {}),
  };
  if (overrideDuplicate && relatedTweetId) {
    updatePayload.dup_of_tweet_id = null;
    updatePayload.dup_similarity = null;
    updatePayload.dedupe_status = 'unique';
    updatePayload.dedupe_method = 'none';
    updatePayload.dedupe_confidence = null;
    updatePayload.dedupe_reason = 'manual_score_override';
    updatePayload.dedupe_new_facts = [];
    updatePayload.dedupe_checked_at = new Date().toISOString();
  }

  const { error: upErr } = await supabase.from('posts').update(updatePayload).eq('tweet_id', tweetId);
  if (upErr) return { ok: false, error: upErr.message };

  if (overrideDuplicate && relatedTweetId) {
    const pairA = tweetId < relatedTweetId ? tweetId : relatedTweetId;
    const pairB = tweetId < relatedTweetId ? relatedTweetId : tweetId;
    await supabase.from('story_pair_blocklist').upsert(
      { tweet_a: pairA, tweet_b: pairB, reason: 'manual_score_override' },
      { onConflict: 'tweet_a,tweet_b' },
    ).then(() => null, () => null);
    await recordFeedback(supabase, tweetId, 'not_duplicate', -2, { source: 'manual_score' }, relatedTweetId).catch(() => {});
  }

  const polarity = oldScore == null
    ? (passes ? 2 : -2)
    : score > oldScore + 0.5 ? 2 : score < oldScore - 0.5 ? -2 : 0;
  await recordFeedback(supabase, tweetId, 'manual_score', polarity, {
    old_score: oldScore,
    manual_score: score,
    threshold,
    reason,
    override_duplicate: overrideDuplicate,
    decision,
    expected_audience_class: expectedAudienceClass,
  }).catch(() => {});
  if (expectedAudienceClass) {
    await promoteFeedbackToScoringExample(supabase, {
      tweet_id: tweetId,
      expected_class: expectedAudienceClass,
      expected_decision: passes ? 'deliver' : 'skip',
      expected_score: score,
      note: reason || 'Manual score label',
      source: 'manual_score',
    }).catch(() => null);
  }
  await insertAdminPipelineEvent(supabase, tweetId, 'score', 'completed', {
    mode: 'manual_score',
    manual_score: score,
    threshold,
    decision,
  });

  let translation: { ok: boolean; error?: string } | null = null;
  let advance: { queued: string; reason?: string } | null = null;
  if (passes && !duplicateBlocks) {
    if (!post.text_translated && !post.translated_at) {
      translation = await runTranslationOnly(supabase, tweetId);
      if (!translation.ok) return { ok: true, tweet_id: tweetId, score, threshold, decision, decision_reason: decisionReason, advanced: false, translation_error: translation.error };
    }
    advance = await queueManualAdvance(supabase, tweetId);
  }

  return {
    ok: true,
    tweet_id: tweetId,
    score,
    threshold,
    decision,
    decision_reason: decisionReason,
    duplicate_blocked: duplicateBlocks,
    translated: translation?.ok ?? false,
    advance,
  };
}

// deno-lint-ignore no-explicit-any
async function recordScoreFeedback(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const feedback = typeof body.feedback === 'string' ? body.feedback : '';
  const map: Record<string, { action: string; polarity: number }> = {
    too_low: { action: 'score_too_low', polarity: 2 },
    too_high: { action: 'score_too_high', polarity: -2 },
    correct_deliver: { action: 'correct_deliver', polarity: 1 },
    correct_skip: { action: 'correct_skip', polarity: -1 },
    should_pass_audience: { action: 'should_pass_audience', polarity: 2 },
    should_skip: { action: 'should_skip_audience', polarity: -2 },
    wrong_relevance_class: { action: 'wrong_relevance_class', polarity: 0 },
    global_exception_worth_covering: { action: 'global_exception_worth_covering', polarity: 2 },
    not_global_exception: { action: 'not_global_exception', polarity: -1 },
  };
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };
  const item = map[feedback];
  if (!item) return { ok: false, error: 'feedback must be a supported score feedback action' };
  await recordFeedback(supabase, tweetId, item.action, item.polarity, { feedback });
  const reviewPatch: Record<string, unknown> = { feedback_locked: true };
  if (['correct_skip', 'should_skip', 'not_global_exception'].includes(feedback)) {
    reviewPatch.score_review_status = 'rejected';
    reviewPatch.delivery_decision = 'skip';
    reviewPatch.decision_reason = `score_feedback_skip:${feedback}`;
  } else {
    reviewPatch.score_review_status = 'approved';
  }
  await supabase.from('posts').update(reviewPatch).eq('tweet_id', tweetId);
  const expectedClass = isAudienceClass(body.expected_audience_class) ? body.expected_audience_class : null;
  if (expectedClass || feedback === 'should_pass_audience' || feedback === 'should_skip' || feedback === 'global_exception_worth_covering' || feedback === 'not_global_exception') {
    const inferredClass: AudienceClass =
      expectedClass ?? (feedback === 'global_exception_worth_covering' ? 'global_exception' : feedback === 'not_global_exception' ? 'off_topic' : 'direct_focus');
    const expectedDecision = feedback === 'should_skip' || feedback === 'not_global_exception' ? 'skip' : 'deliver';
    await promoteFeedbackToScoringExample(supabase, {
      tweet_id: tweetId,
      expected_class: inferredClass,
      expected_decision: expectedDecision,
      note: feedback,
      source: 'score_feedback',
    }).catch(() => null);
  }
  await insertAdminPipelineEvent(supabase, tweetId, 'score_feedback', 'completed', { feedback, polarity: item.polarity });
  return { ok: true, tweet_id: tweetId, feedback, polarity: item.polarity };
}

// deno-lint-ignore no-explicit-any
async function ignoreMonitoringItem(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 240)
    : 'manual_ignore';
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };

  const { data: post } = await supabase
    .from('posts')
    .select('tweet_id, dedupe_status')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return { ok: false, error: `Post not found: ${tweetId}` };

  const now = new Date().toISOString();
  const postPatch: Record<string, unknown> = {
    delivery_decision: 'skip',
    decision_reason: `admin_ignored:${reason}`,
    feedback_locked: true,
    score_review_status: 'rejected',
    enrich_status: 'skipped',
  };
  if (post.dedupe_status === 'pending') {
    postPatch.dedupe_status = 'unique';
    postPatch.dedupe_checked_at = now;
    postPatch.dedupe_reason = `admin_ignored:${reason}`;
  }

  const { error: postErr } = await supabase.from('posts').update(postPatch).eq('tweet_id', tweetId);
  if (postErr) return { ok: false, error: postErr.message };

  const { data: xRows, error: xErr } = await supabase
    .from('x_deliveries')
    .update({
      status: 'skipped',
      skip_reason: `admin_ignored:${reason}`,
      last_error: null,
      updated_at: now,
    })
    .eq('post_id', tweetId)
    .in('status', ['pending', 'failed'])
    .select('id');
  if (xErr) return { ok: false, error: xErr.message };

  const { data: deliveryRows, error: deliveryErr } = await supabase
    .from('deliveries')
    .update({
      status: 'skipped',
      last_error: `admin_ignored:${reason}`,
      last_attempt_at: now,
    })
    .eq('subject_type', 'post')
    .eq('subject_id', tweetId)
    .neq('status', 'posted')
    .select('id');
  if (deliveryErr) return { ok: false, error: deliveryErr.message };

  const { data: jobRows, error: jobErr } = await supabase
    .from('jobs')
    .update({
      status: 'completed',
      completed_at: now,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      result_meta: { admin_ignored: true, reason },
    })
    .filter('payload->>tweet_id', 'eq', tweetId)
    .in('status', ['pending', 'running'])
    .select('id, type');
  if (jobErr) return { ok: false, error: jobErr.message };

  await updateLatestPostEnrichment(supabase, tweetId, {
    status: 'skipped',
    feedback_label: 'admin_ignored',
    feedback_note: reason,
    feedback_at: now,
  });
  await recordFeedback(supabase, tweetId, 'admin_ignore', 0, { reason }).catch(() => {});
  await insertAdminPipelineEvent(supabase, tweetId, 'admin_ignore', 'completed', {
    reason,
    x_rows_closed: xRows?.length ?? 0,
    delivery_rows_closed: deliveryRows?.length ?? 0,
    jobs_closed: jobRows?.length ?? 0,
  });

  return {
    ok: true,
    tweet_id: tweetId,
    ignored: true,
    closed: {
      x_deliveries: xRows?.length ?? 0,
      deliveries: deliveryRows?.length ?? 0,
      jobs: jobRows?.length ?? 0,
    },
  };
}

type MonitoringFilter =
  | 'all'
  | 'needs_attention'
  | 'failed_stuck'
  | 'needs_score'
  | 'translation_queue'
  | 'below_threshold'
  | 'manual_review'
  | 'v2_would_post'
  | 'v2_would_skip'
  | 'v1_post_v2_skip'
  | 'v1_skip_v2_post'
  | 'v2_off_topic'
  | 'v2_needs_review'
  | 'duplicates'
  | 'coverage_gap'
  | 'possible_duplicate'
  | 'duplicate_anomalies'
  | 'ready_to_deliver'
  | 'telegram_pending'
  | 'x_pending'
  | 'x_failed'
  | 'delivered_24h'
  | 'hydration';

type MonitoringScoreBucket = 'any' | 'unscored' | 'lt5' | '5_9' | '10_13' | '14_plus' | '17_plus';

type MonitoringTone = 'good' | 'warn' | 'bad' | 'muted' | 'info';

interface MonitoringState {
  code: string;
  stage_label: string;
  tone: MonitoringTone;
  decision_label: string;
  primary_blocker: string | null;
  translation_state: string;
  telegram_state: string;
  x_state: string;
  needs_attention: boolean;
  next_actions: string[];
}

interface DuplicateTargetSummary {
  tweet_id: string;
  text_original: string;
  url: string;
  created_at: string | null;
  author_handle: string | null;
  delivery_decision: string | null;
  decision_reason: string | null;
  final_score: number | null;
  importance_score: number | null;
  dedupe_status: string | null;
  dup_of_tweet_id: string | null;
  dup_similarity: number | null;
  telegram_state: string;
  x_state: string;
  monitoring_state: MonitoringState;
  coverage_state: 'delivered' | 'in_pipeline' | 'also_duplicate' | 'not_covered';
}

const MONITORING_BASE_POST_COLUMNS = [
  'tweet_id',
  'text_original',
  'text_translated',
  'url',
  'created_at',
  'translated_at',
  'has_media',
  'author_handle',
  'importance_score',
  'importance_tags',
  'importance_reasoning',
  'delivery_decision',
  'score_axes',
  'final_score',
  'decision_reason',
  'is_truncated',
  'hydrated_at',
  'hydration_source',
  'dup_of_tweet_id',
  'story_cluster_id',
  'dup_similarity',
  'dedupe_status',
  'dedupe_checked_at',
  'dedupe_method',
  'dedupe_confidence',
  'dedupe_reason',
  'dedupe_new_facts',
  'score_breakdown',
  'feedback_locked',
  'enrich_status',
  'editorial_commentary',
  'humanized_commentary',
  'commentary_hook',
  'commentary_question',
  'narrative_callback',
  'composed_post_text',
  'post_format_hint',
  'background_context',
  'enrich_tokens',
  'enrich_duration_ms',
  'accounts!inner(handle, display_name)',
];

const MONITORING_ENRICHMENT_V2_COLUMNS = [
  'enrichment_version',
  'creator_angle',
  'why_it_matters',
  'source_context',
  'algorithm_signal_scores',
  'aggregator_risk_score',
  'ai_voice_risk_score',
  'monetization_risk_flags',
  'enrichment_review_reason',
  'final_x_text',
];

const MONITORING_SCORING_V2_COLUMNS = [
  'scoring_version',
  'scoring_profile_id',
  'audience_class',
  'audience_confidence',
  'audience_reason',
  'global_exception_class',
  'score_review_status',
];

const MONITORING_POST_SELECT = [...MONITORING_BASE_POST_COLUMNS, ...MONITORING_ENRICHMENT_V2_COLUMNS, ...MONITORING_SCORING_V2_COLUMNS].join(', ');
const MONITORING_POST_SELECT_NO_ENRICHMENT_V2 = [...MONITORING_BASE_POST_COLUMNS, ...MONITORING_SCORING_V2_COLUMNS].join(', ');
const MONITORING_POST_SELECT_NO_SCORING_V2 = MONITORING_BASE_POST_COLUMNS.join(', ');

function normalizeMonitoringFilter(v: unknown): MonitoringFilter {
  const raw = typeof v === 'string' ? v.replaceAll('-', '_') : 'all';
  const allowed: MonitoringFilter[] = [
    'all', 'needs_attention', 'failed_stuck', 'needs_score', 'translation_queue',
    'below_threshold', 'manual_review', 'duplicates', 'coverage_gap',
    'v2_would_post', 'v2_would_skip', 'v1_post_v2_skip', 'v1_skip_v2_post',
    'v2_off_topic', 'v2_needs_review',
    'possible_duplicate', 'duplicate_anomalies', 'ready_to_deliver',
    'telegram_pending', 'x_pending', 'x_failed', 'delivered_24h', 'hydration',
  ];
  if (raw === 'needs_action') return 'needs_attention';
  if (raw === 'failed') return 'failed_stuck';
  if (raw === 'awaiting_review') return 'manual_review';
  if (raw === 'hydration_backlog') return 'hydration';
  if (raw === 'posted_24h' || raw === 'recently_delivered') return 'delivered_24h';
  if (raw === 'ready_to_publish') return 'ready_to_deliver';
  if (raw === 'needs_translation' || raw === 'delivery_pending') return 'translation_queue';
  return allowed.includes(raw as MonitoringFilter) ? raw as MonitoringFilter : 'all';
}

function normalizeMonitoringScoreBucket(v: unknown): MonitoringScoreBucket {
  const raw = typeof v === 'string' ? v : 'any';
  const allowed: MonitoringScoreBucket[] = ['any', 'unscored', 'lt5', '5_9', '10_13', '14_plus', '17_plus'];
  return allowed.includes(raw as MonitoringScoreBucket) ? raw as MonitoringScoreBucket : 'any';
}

function sanitizeSearchTerm(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
}

function postSearchOr(term: string): string {
  const q = `%${term}%`;
  return [
    `tweet_id.ilike.${q}`,
    `author_handle.ilike.${q}`,
    `url.ilike.${q}`,
    `text_original.ilike.${q}`,
    `text_translated.ilike.${q}`,
  ].join(',');
}

function getPayloadTweetId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).tweet_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isActiveStatus(status: unknown): boolean {
  return status === 'pending' || status === 'running' || status === 'queued';
}

function scoreFromPost(post: Record<string, unknown>): number | null {
  if (typeof post.final_score === 'number') return post.final_score;
  if (typeof post.importance_score === 'number') return post.importance_score;
  return null;
}

function matchesMonitoringScoreBucket(post: Record<string, unknown>, bucket: MonitoringScoreBucket): boolean {
  const score = scoreFromPost(post);
  switch (bucket) {
    case 'any':
      return true;
    case 'unscored':
      return score == null;
    case 'lt5':
      return score != null && score < 5;
    case '5_9':
      return score != null && score >= 5 && score < 10;
    case '10_13':
      return score != null && score >= 10 && score < 14;
    case '14_plus':
      return score != null && score >= 14;
    case '17_plus':
      return score != null && score >= 17;
  }
}

function isBelowThreshold(post: Record<string, unknown>, threshold: number): boolean {
  const reason = typeof post.decision_reason === 'string' ? post.decision_reason : '';
  const score = scoreFromPost(post);
  return reason.startsWith('below_threshold:')
    || reason.startsWith('feedback_reduce:')
    || reason.startsWith('manual_score_skip:')
    || (post.delivery_decision === 'skip' && score != null && score < threshold);
}

function monitoringScoringV2Snapshot(post: Record<string, unknown>): Record<string, unknown> | null {
  const breakdown = post.score_breakdown && typeof post.score_breakdown === 'object'
    ? post.score_breakdown as Record<string, unknown>
    : {};
  const fromBreakdown = breakdown.scoring_v2 && typeof breakdown.scoring_v2 === 'object'
    ? breakdown.scoring_v2 as Record<string, unknown>
    : null;
  if (fromBreakdown) return fromBreakdown;
  if (!post.scoring_version && !post.audience_class && post.audience_confidence == null) return null;
  return {
    version: post.scoring_version ?? null,
    mode: post.score_review_status === 'shadow' ? 'shadow' : null,
    profile_id: post.scoring_profile_id ?? null,
    audience_class: post.audience_class ?? null,
    audience_confidence: post.audience_confidence ?? null,
    audience_reason: post.audience_reason ?? null,
    global_exception_class: post.global_exception_class ?? null,
    final_score: post.final_score ?? null,
    decision: post.delivery_decision ?? null,
    review_status: post.score_review_status ?? null,
  };
}

function monitoringScoringV2Decision(post: Record<string, unknown>): string | null {
  const snapshot = monitoringScoringV2Snapshot(post);
  const decision = snapshot?.decision;
  return decision === 'deliver' || decision === 'skip' ? decision : null;
}

function matchesMonitoringScoringV2Filter(entry: Record<string, unknown>, filter: MonitoringFilter): boolean {
  const snapshot = monitoringScoringV2Snapshot(entry);
  if (!snapshot) return false;
  const decision = monitoringScoringV2Decision(entry);
  switch (filter) {
    case 'v2_would_post':
      return decision === 'deliver';
    case 'v2_would_skip':
      return decision === 'skip';
    case 'v1_post_v2_skip':
      return entry.delivery_decision === 'deliver' && decision === 'skip';
    case 'v1_skip_v2_post':
      return entry.delivery_decision === 'skip' && decision === 'deliver';
    case 'v2_off_topic':
      return snapshot.audience_class === 'off_topic';
    case 'v2_needs_review':
      return snapshot.review_status === 'needs_review';
    default:
      return false;
  }
}

function deriveMonitoringState(
  post: Record<string, unknown>,
  rpc: Record<string, unknown> | undefined,
  threshold: number,
): MonitoringState {
  const score = scoreFromPost(post);
  const translatedAt = rpc?.translated_at || post.translated_at;
  const hasTranslation = !!(translatedAt || (post.text_translated && post.text_translated !== post.text_original));
  const translateStatus = rpc?.translate_status as string | null | undefined;
  const deliveryStatus = rpc?.delivery_status as string | null | undefined;
  const xStatus = rpc?.x_status as string | null | undefined;
  const hasTranslateError = !!rpc?.translate_error || translateStatus === 'failed';
  const hasDeliveryError = !!rpc?.delivery_error || deliveryStatus === 'failed';
  const hasXError = !!rpc?.x_error || xStatus === 'failed';
  const dedupeStatus = typeof post.dedupe_status === 'string' ? post.dedupe_status : null;
  const dedupeReason = typeof post.dedupe_reason === 'string' ? post.dedupe_reason : '';
  const dedupeJobStatus = rpc?.dedupe_job_status as string | null | undefined;
  const hasDedupeError = !!rpc?.dedupe_error || dedupeJobStatus === 'failed' || dedupeStatus === 'failed';
  const duplicate = !!post.dup_of_tweet_id;
  const belowThreshold = isBelowThreshold(post, threshold);
  const skipped = !!post.delivery_decision && post.delivery_decision !== 'deliver';
  const activeDedupe = isActiveStatus(dedupeJobStatus) || dedupeStatus === 'pending';
  const activeTranslate = isActiveStatus(translateStatus);
  const activeDelivery = isActiveStatus(deliveryStatus);
  const activeX = isActiveStatus(xStatus);
  const delivered = deliveryStatus === 'posted';
  const xPosted = xStatus === 'posted';
  const needsHydration = post.delivery_decision === 'deliver' && post.is_truncated === true && !post.hydrated_at;
  const review = post.enrich_status === 'awaiting_approval' || post.score_review_status === 'needs_review';
  const passDecision = post.delivery_decision === 'deliver';
  const duplicateCoverageGap = dedupeStatus === 'coverage_gap'
    || (dedupeStatus === 'uncertain' && duplicate && dedupeReason.includes('coverage_gap:'));

  let state: MonitoringState = {
    code: 'unknown',
    stage_label: 'Review',
    tone: 'info',
    decision_label: 'No decision',
    primary_blocker: null,
    translation_state: hasTranslation ? 'translated' : 'missing',
    telegram_state: delivered ? 'delivered' : (deliveryStatus ?? 'none'),
    x_state: xStatus ?? 'none',
    needs_attention: false,
    next_actions: ['details'],
  };

  if (activeTranslate) state.translation_state = 'queued';
  else if (hasTranslateError && !hasTranslation) state.translation_state = 'failed';
  else if (!hasTranslation && (skipped || (duplicate && !duplicateCoverageGap) || belowThreshold)) state.translation_state = 'not_needed';
  else if (!hasTranslation && (passDecision || duplicateCoverageGap)) state.translation_state = 'needs_translation';

  if (hasDedupeError || hasTranslateError || hasDeliveryError || hasXError) {
    state = {
      ...state,
      code: 'failed_stuck',
      stage_label: hasDedupeError ? 'Dedupe failed' : 'Failed/stuck',
      tone: 'bad',
      decision_label: hasDedupeError ? 'Dedupe failed' : hasTranslateError ? 'Translation failed' : hasDeliveryError ? 'Telegram failed' : 'X failed',
      primary_blocker: hasDedupeError ? String(rpc?.dedupe_error ?? post.dedupe_reason ?? 'Duplicate check failed') : hasTranslateError ? 'Translation failed or exhausted retries' : hasDeliveryError ? 'Telegram delivery failed' : 'X delivery failed',
      needs_attention: true,
      next_actions: hasDedupeError ? ['run_dedupe', 'rescore', 'manual_score'] : ['retry', 'rescore', 'manual_score'],
    };
  } else if (activeDedupe) {
    state = {
      ...state,
      code: 'dedupe_pending',
      stage_label: 'Duplicate gate pending',
      tone: 'info',
      decision_label: 'Checking duplicate',
      primary_blocker: 'Duplicate gate is pending or running',
      next_actions: ['details'],
    };
  } else if (duplicateCoverageGap) {
    state = {
      ...state,
      code: 'duplicate_coverage_gap',
      stage_label: 'Duplicate coverage gap',
      tone: 'warn',
      decision_label: 'Possible duplicate, not covered',
      primary_blocker: 'The matched duplicate has not been delivered and is not actively moving through delivery, so this item should keep moving through normal review.',
      needs_attention: true,
      next_actions: ['run_dedupe', 'manual_score', 'clear_duplicate'],
    };
  } else if (dedupeStatus === 'uncertain') {
    state = {
      ...state,
      code: 'manual_review',
      stage_label: 'Uncertain duplicate',
      tone: 'warn',
      decision_label: 'Review possible duplicate',
      primary_blocker: String(post.dedupe_reason ?? 'Duplicate gate needs human review'),
      needs_attention: true,
      next_actions: ['run_dedupe', 'manual_score', 'clear_duplicate'],
    };
  } else if (dedupeStatus === 'related_new_info' && score == null) {
    state = {
      ...state,
      code: 'needs_score',
      stage_label: 'Related: new info',
      tone: 'info',
      decision_label: 'Related: new info',
      primary_blocker: 'Duplicate gate found related coverage with material new information; scoring is next',
      next_actions: ['rescore', 'manual_score'],
    };
  } else if (activeTranslate) {
    state = {
      ...state,
      code: 'translation_queue',
      stage_label: 'Translation queued',
      tone: 'info',
      decision_label: 'Queued for translation',
      primary_blocker: 'Translation job is pending or running',
      next_actions: ['details'],
    };
  } else if (score == null) {
    state = {
      ...state,
      code: 'needs_score',
      stage_label: 'Needs score',
      tone: 'warn',
      decision_label: 'Unscored',
      primary_blocker: 'No editorial score has been recorded',
      needs_attention: true,
      next_actions: ['rescore', 'manual_score'],
    };
  } else if (duplicate) {
    state = {
      ...state,
      code: 'blocked_duplicate',
      stage_label: 'Duplicate',
      tone: 'muted',
      decision_label: 'Blocked: duplicate',
      primary_blocker: `Duplicate of ${post.dup_of_tweet_id}`,
      needs_attention: true,
      next_actions: ['clear_duplicate', 'manual_score'],
    };
  } else if (belowThreshold || (skipped && !passDecision)) {
    state = {
      ...state,
      code: 'below_threshold',
      stage_label: 'Below threshold',
      tone: 'muted',
      decision_label: belowThreshold ? 'Skipped: below threshold' : 'Skipped',
      primary_blocker: belowThreshold ? `Score ${score} is below threshold ${threshold}` : (post.decision_reason as string | null) ?? 'Delivery decision is skip',
      next_actions: ['manual_score', 'rescore', 'translate_only'],
    };
  } else if (!hasTranslation && passDecision) {
    state = {
      ...state,
      code: 'needs_translation',
      stage_label: 'Needs translation',
      tone: 'warn',
      decision_label: 'Needs translation',
      primary_blocker: 'Passed scoring but has no translation',
      needs_attention: true,
      translation_state: 'needs_translation',
      next_actions: ['translate_only', 'rescore'],
    };
  } else if (review) {
    state = {
      ...state,
      code: 'manual_review',
      stage_label: 'Manual review',
      tone: 'warn',
      decision_label: 'Awaiting review',
      primary_blocker: post.score_review_status === 'needs_review' ? 'Scoring v2 marked this item for review' : 'Enrichment is awaiting approval',
      needs_attention: true,
      next_actions: ['details'],
    };
  } else if (needsHydration) {
    state = {
      ...state,
      code: 'hydration',
      stage_label: 'Hydration',
      tone: 'warn',
      decision_label: 'Blocked: hydration',
      primary_blocker: 'Tweet is truncated and needs hydration before publishing',
      needs_attention: true,
      next_actions: ['hydrate'],
    };
  } else if (activeDelivery) {
    state = {
      ...state,
      code: 'telegram_pending',
      stage_label: 'Telegram pending',
      tone: 'info',
      decision_label: 'Telegram pending',
      primary_blocker: 'Telegram delivery is pending or running',
      next_actions: ['details'],
    };
  } else if (delivered || xPosted) {
    state = {
      ...state,
      code: 'delivered',
      stage_label: xPosted ? 'X posted' : 'Delivered',
      tone: 'good',
      decision_label: xPosted ? 'X posted' : 'Delivered',
      primary_blocker: null,
      next_actions: ['details'],
    };
  } else if (activeX) {
    state = {
      ...state,
      code: 'x_pending',
      stage_label: 'X pending',
      tone: 'info',
      decision_label: 'X pending',
      primary_blocker: 'X posting is pending or running',
      next_actions: ['details'],
    };
  } else if (passDecision && hasTranslation) {
    state = {
      ...state,
      code: 'ready_to_deliver',
      stage_label: 'Ready',
      tone: 'info',
      decision_label: 'Ready to deliver',
      primary_blocker: null,
      next_actions: ['force_telegram', 'force_x', 'manual_score'],
    };
  }

  return state;
}

// deno-lint-ignore no-explicit-any
async function getTweetIdsFromFailedJobs(supabase: any, limit: number, offset: number): Promise<string[]> {
  const { data } = await supabase
    .from('jobs')
    .select('payload, created_at')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit * 3 - 1);
  const ids: string[] = [];
  for (const row of data ?? []) {
    const tid = getPayloadTweetId(row.payload);
    if (tid && !ids.includes(tid)) ids.push(tid);
    if (ids.length >= limit) break;
  }
  if (ids.length < limit) {
    const { data: dedupeRows } = await supabase
      .from('posts')
      .select('tweet_id, dedupe_checked_at')
      .eq('dedupe_status', 'failed')
      .order('dedupe_checked_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    for (const row of dedupeRows ?? []) {
      const tid = row.tweet_id as string;
      if (tid && !ids.includes(tid)) ids.push(tid);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

// deno-lint-ignore no-explicit-any
async function getTweetIdsFromXDeliveries(
  supabase: any,
  status: string,
  limit: number,
  offset: number,
  since?: string,
): Promise<string[]> {
  let q = supabase
    .from('x_deliveries')
    .select('post_id, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (since) q = q.gte('created_at', since);
  const { data } = await q;
  return [...new Set((data ?? []).map((row: { post_id?: string }) => row.post_id).filter(Boolean))] as string[];
}

// deno-lint-ignore no-explicit-any
async function loadActiveThreshold(supabase: any): Promise<number> {
  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['content_filter', 'editorial_profiles', 'active_profile_id', 'scoring_policy']);
  const byKey: Record<string, Record<string, unknown>> = {};
  for (const row of settings ?? []) {
    if (row.value && typeof row.value === 'object') byKey[row.key] = row.value as Record<string, unknown>;
  }
  const activeId = typeof byKey.active_profile_id?.id === 'string' ? byKey.active_profile_id.id : '';
  if (byKey.scoring_policy) {
    const policy = normalizeScoringPolicy(byKey.scoring_policy);
    if (policy.enabled && policy.mode === 'active') {
      const profile = policy.profiles.find((p) => p.id === policy.active_profile_id) ?? policy.profiles[0];
      if (profile?.thresholds?.direct_focus?.threshold) return profile.thresholds.direct_focus.threshold;
    }
  }
  const profiles = Array.isArray(byKey.editorial_profiles?.profiles) ? byKey.editorial_profiles.profiles as Array<Record<string, unknown>> : [];
  const active = profiles.find((p) => p.id === activeId);
  if (typeof active?.threshold === 'number') return active.threshold;
  if (typeof byKey.content_filter?.default_threshold === 'number') return byKey.content_filter.default_threshold as number;
  return 14;
}

interface LatestJobState {
  status: string;
  last_error?: string | null;
}

function latestJobFor(tweetId: string, type: string, jobStateByTweet: Map<string, Map<string, LatestJobState>>): LatestJobState | null {
  return jobStateByTweet.get(tweetId)?.get(type) ?? null;
}

// deno-lint-ignore no-explicit-any
async function loadJobStateMap(supabase: any, tweetIds?: string[]): Promise<Map<string, Map<string, LatestJobState>>> {
  const wanted = new Set(tweetIds ?? []);
  const { data } = await supabase
    .from('jobs')
    .select('type, status, last_error, payload, created_at')
    .in('type', ['dedupe', 'translate', 'deliver', 'hydrate_tweet', 'enrich'])
    .in('status', ['pending', 'running', 'failed'])
    .order('created_at', { ascending: false })
    .limit(5000);

  const map = new Map<string, Map<string, LatestJobState>>();
  for (const row of data ?? []) {
    const tid = getPayloadTweetId(row.payload);
    if (!tid || (wanted.size > 0 && !wanted.has(tid))) continue;
    if (!map.has(tid)) map.set(tid, new Map());
    const perTweet = map.get(tid)!;
    if (!perTweet.has(row.type)) {
      perTweet.set(row.type, { status: row.status, last_error: row.last_error ?? null });
    }
  }
  return map;
}

function applyJobStateToRpc(
  tweetId: string,
  rpc: Record<string, unknown> | undefined,
  jobStateByTweet: Map<string, Map<string, LatestJobState>>,
): Record<string, unknown> {
  const next = { ...(rpc ?? {}) };
  const dedupe = latestJobFor(tweetId, 'dedupe', jobStateByTweet);
  const translate = latestJobFor(tweetId, 'translate', jobStateByTweet);
  const deliver = latestJobFor(tweetId, 'deliver', jobStateByTweet);
  if (dedupe) {
    next.dedupe_job_status = dedupe.status;
    if (dedupe.last_error) next.dedupe_error = dedupe.last_error;
  }
  if (translate) {
    next.translate_status = translate.status;
    if (translate.last_error) next.translate_error = translate.last_error;
  } else if (!next.translated_at) {
    next.translate_status = null;
    next.translate_error = null;
  }
  if (deliver) {
    next.delivery_job_status = deliver.status;
    if (!next.delivery_status || isActiveStatus(deliver.status) || deliver.status === 'failed') {
      next.delivery_status = deliver.status;
    }
    if (deliver.last_error) next.delivery_error = deliver.last_error;
  } else if (!next.posted_at) {
    next.delivery_job_status = null;
  }
  return next;
}

function toMonitoringEntry(
  post: Record<string, unknown>,
  rpcRaw: Record<string, unknown> | undefined,
  threshold: number,
  jobStateByTweet: Map<string, Map<string, LatestJobState>>,
  duplicateTargets: Map<string, DuplicateTargetSummary> = new Map(),
) {
  const rpc = applyJobStateToRpc(post.tweet_id as string, rpcRaw, jobStateByTweet);
  const translatedAt = rpc?.translated_at || post.translated_at;
  const isTranslated = !!(translatedAt || (post.text_translated && post.text_translated !== post.text_original));
  const deliveryStatus = (rpc?.delivery_status as string) || '';
  const xStatus = (rpc?.x_status as string) ?? null;
  const isTruncated = (rpc?.is_truncated as boolean) ?? (post.is_truncated as boolean) ?? false;
  const hydratedAt = (rpc?.hydrated_at as string) ?? (post.hydrated_at as string) ?? null;
  const hasMedia = post.has_media === true;
  let monitoringState = deriveMonitoringState({ ...post, is_truncated: isTruncated, hydrated_at: hydratedAt }, rpc, threshold);
  const duplicateOf = typeof post.dup_of_tweet_id === 'string' ? duplicateTargets.get(post.dup_of_tweet_id) ?? null : null;
  if (
    duplicateOf
    && monitoringState.code === 'blocked_duplicate'
    && (duplicateOf.coverage_state === 'not_covered' || duplicateOf.coverage_state === 'also_duplicate')
  ) {
    monitoringState = {
      ...monitoringState,
      code: 'duplicate_coverage_gap',
      stage_label: 'Duplicate coverage gap',
      tone: 'warn',
      decision_label: 'Duplicate not covered',
      primary_blocker: 'The matched duplicate has not been delivered and is not actively moving through delivery. Review or re-run duplicate check so one item can be evaluated.',
      needs_attention: true,
      next_actions: ['run_dedupe', 'manual_score', 'clear_duplicate'],
    };
  }
  const mayCallX = monitoringState.code === 'ready_to_deliver' && xStatus !== 'posted';
  const xCostReasons: string[] = [];
  if (monitoringState.code === 'hydration') xCostReasons.push('hydrate read may be needed');
  if (mayCallX && hasMedia) xCostReasons.push('media upload expected');
  if (mayCallX) xCostReasons.push('tweet write expected');

  return {
    tweet_id: post.tweet_id,
    text_original: post.text_original || '',
    text_translated: post.text_translated || '',
    url: post.url || '',
    created_at: post.created_at,
    has_media: hasMedia,
    account_handle: ((post.accounts as { handle?: string } | null)?.handle) ?? '',
    author_handle: post.author_handle ?? null,
    delivery_status: deliveryStatus,
    telegram_message_ids: [],
    is_translated: isTranslated,
    is_delivered: deliveryStatus === 'posted',
    translation_job_status: (rpc?.translate_status as string) || (isTranslated ? 'completed' : ''),
    delivery_job_status: deliveryStatus,
    translation_error: (rpc?.translate_error as string) || '',
    delivery_error: (rpc?.delivery_error as string) || '',
    importance_score: post.importance_score ?? null,
    importance_tags: post.importance_tags ?? null,
    importance_reasoning: post.importance_reasoning ?? null,
    delivery_decision: post.delivery_decision ?? null,
    score_axes: post.score_axes ?? null,
    final_score: post.final_score ?? null,
    decision_reason: post.decision_reason ?? null,
    scoring_version: post.scoring_version ?? null,
    scoring_profile_id: post.scoring_profile_id ?? null,
    audience_class: post.audience_class ?? null,
    audience_confidence: post.audience_confidence ?? null,
    audience_reason: post.audience_reason ?? null,
    global_exception_class: post.global_exception_class ?? null,
    score_review_status: post.score_review_status ?? null,
    is_truncated: isTruncated,
    hydrated_at: hydratedAt,
    hydration_source: (rpc?.hydration_source as string) ?? (post.hydration_source as string) ?? null,
    x_status: xStatus,
    x_tweet_id: (rpc?.x_tweet_id as string) ?? null,
    x_posted_at: (rpc?.x_posted_at as string) ?? null,
    x_error: (rpc?.x_error as string) ?? null,
    x_skip_reason: (rpc?.x_skip_reason as string) ?? null,
    dup_of_tweet_id: post.dup_of_tweet_id ?? null,
    duplicate_of: duplicateOf,
    story_cluster_id: post.story_cluster_id ?? null,
    dup_similarity: post.dup_similarity ?? null,
    dedupe_status: post.dedupe_status ?? null,
    dedupe_checked_at: post.dedupe_checked_at ?? null,
    dedupe_method: post.dedupe_method ?? null,
    dedupe_confidence: post.dedupe_confidence ?? null,
    dedupe_reason: post.dedupe_reason ?? null,
    dedupe_new_facts: post.dedupe_new_facts ?? null,
    score_breakdown: post.score_breakdown ?? null,
    feedback_locked: post.feedback_locked ?? false,
    enrich_status: post.enrich_status ?? null,
    enrichment_version: post.enrichment_version ?? null,
    editorial_commentary: post.editorial_commentary ?? null,
    humanized_commentary: post.humanized_commentary ?? null,
    commentary_hook: post.commentary_hook ?? null,
    commentary_question: post.commentary_question ?? null,
    narrative_callback: post.narrative_callback ?? null,
    composed_post_text: post.composed_post_text ?? null,
    creator_angle: post.creator_angle ?? null,
    why_it_matters: post.why_it_matters ?? null,
    source_context: post.source_context ?? null,
    algorithm_signal_scores: post.algorithm_signal_scores ?? null,
    aggregator_risk_score: post.aggregator_risk_score ?? null,
    ai_voice_risk_score: post.ai_voice_risk_score ?? null,
    monetization_risk_flags: post.monetization_risk_flags ?? null,
    enrichment_review_reason: post.enrichment_review_reason ?? null,
    final_x_text: post.final_x_text ?? null,
    post_format_hint: post.post_format_hint ?? null,
    background_context: post.background_context ?? null,
    enrich_tokens: post.enrich_tokens ?? null,
    enrich_duration_ms: post.enrich_duration_ms ?? null,
    x_cost_flags: {
      may_call_x: mayCallX,
      media_upload_expected: mayCallX && hasMedia,
      hydration_expected: monitoringState.code === 'hydration',
      reasons: xCostReasons,
    },
    monitoring_state: monitoringState,
  };
}

// deno-lint-ignore no-explicit-any
async function loadDuplicateTargetMap(supabase: any, rows: Record<string, unknown>[], threshold: number): Promise<Map<string, DuplicateTargetSummary>> {
  const ids = [...new Set(rows.map((row) => row.dup_of_tweet_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const map = new Map<string, DuplicateTargetSummary>();
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from('posts')
    .select('tweet_id, text_original, url, created_at, author_handle, delivery_decision, decision_reason, importance_score, final_score, dedupe_status, dup_of_tweet_id, dup_similarity, translated_at, text_translated, is_truncated, hydrated_at, enrich_status, score_review_status')
    .in('tweet_id', ids);
  if (error) return map;

  const targets = (data ?? []) as Record<string, unknown>[];
  const targetIds = targets.map((post) => post.tweet_id as string).filter(Boolean);
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  const jobStateByTweet = await loadJobStateMap(supabase, targetIds);
  if (targetIds.length > 0) {
    const { data: statuses } = await supabase.rpc('get_post_pipeline_status', { tweet_ids: targetIds });
    for (const row of statuses ?? []) statusByTweet[row.tweet_id as string] = row;
  }

  for (const post of targets) {
    const tweetId = post.tweet_id as string;
    const rpc = applyJobStateToRpc(tweetId, statusByTweet[tweetId], jobStateByTweet);
    const state = deriveMonitoringState(post, rpc, threshold);
    const telegramState = state.telegram_state;
    const xState = state.x_state;
    const delivered = telegramState === 'delivered' || telegramState === 'posted' || xState === 'posted';
    const active = isActiveStatus(telegramState) || isActiveStatus(xState) || post.delivery_decision === 'deliver';
    const coverageState = delivered
      ? 'delivered'
      : active
        ? 'in_pipeline'
        : post.dup_of_tweet_id
          ? 'also_duplicate'
          : 'not_covered';

    map.set(tweetId, {
      tweet_id: tweetId,
      text_original: String(post.text_original ?? ''),
      url: String(post.url ?? ''),
      created_at: typeof post.created_at === 'string' ? post.created_at : null,
      author_handle: typeof post.author_handle === 'string' ? post.author_handle : null,
      delivery_decision: typeof post.delivery_decision === 'string' ? post.delivery_decision : null,
      decision_reason: typeof post.decision_reason === 'string' ? post.decision_reason : null,
      final_score: typeof post.final_score === 'number' ? post.final_score : null,
      importance_score: typeof post.importance_score === 'number' ? post.importance_score : null,
      dedupe_status: typeof post.dedupe_status === 'string' ? post.dedupe_status : null,
      dup_of_tweet_id: typeof post.dup_of_tweet_id === 'string' ? post.dup_of_tweet_id : null,
      dup_similarity: typeof post.dup_similarity === 'number' ? post.dup_similarity : null,
      telegram_state: telegramState,
      x_state: xState,
      monitoring_state: state,
      coverage_state: coverageState,
    });
  }

  return map;
}

function entryTweetId(entry: Record<string, unknown>): string {
  return String(entry.tweet_id ?? '');
}

function entryCreatedAtMs(entry: Record<string, unknown>): number {
  const value = typeof entry.created_at === 'string' ? Date.parse(entry.created_at) : Number.NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function entryIsDeliveredOrPosted(entry: Record<string, unknown>): boolean {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return entry.is_delivered === true || entry.x_status === 'posted' || state.telegram_state === 'delivered' || state.x_state === 'posted';
}

function entryHasActiveDeliveryPath(entry: Record<string, unknown>): boolean {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return entry.delivery_decision === 'deliver'
    || ['ready_to_deliver', 'telegram_pending', 'x_pending', 'hydration'].includes(state.code)
    || isActiveStatus(state.telegram_state)
    || isActiveStatus(state.x_state);
}

function chooseDuplicateCanonical(entries: Record<string, unknown>[]): Record<string, unknown> {
  return [...entries].sort((a, b) => {
    const deliveredDelta = Number(entryIsDeliveredOrPosted(b)) - Number(entryIsDeliveredOrPosted(a));
    if (deliveredDelta !== 0) return deliveredDelta;
    const activeDelta = Number(entryHasActiveDeliveryPath(b)) - Number(entryHasActiveDeliveryPath(a));
    if (activeDelta !== 0) return activeDelta;
    const scoreDelta = (scoreFromPost(b) ?? -1) - (scoreFromPost(a) ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return entryCreatedAtMs(a) - entryCreatedAtMs(b);
  })[0];
}

function clusterMemberFromEntry(entry: Record<string, unknown>, canonicalTweetId: string): Record<string, unknown> {
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  return {
    tweet_id: entryTweetId(entry),
    text_original: String(entry.text_original ?? ''),
    url: String(entry.url ?? ''),
    created_at: typeof entry.created_at === 'string' ? entry.created_at : null,
    author_handle: typeof entry.author_handle === 'string' ? entry.author_handle : null,
    final_score: typeof entry.final_score === 'number' ? entry.final_score : null,
    importance_score: typeof entry.importance_score === 'number' ? entry.importance_score : null,
    dedupe_status: typeof entry.dedupe_status === 'string' ? entry.dedupe_status : null,
    dup_of_tweet_id: typeof entry.dup_of_tweet_id === 'string' ? entry.dup_of_tweet_id : null,
    dup_similarity: typeof entry.dup_similarity === 'number' ? entry.dup_similarity : null,
    dedupe_confidence: typeof entry.dedupe_confidence === 'number' ? entry.dedupe_confidence : null,
    dedupe_reason: typeof entry.dedupe_reason === 'string' ? entry.dedupe_reason : null,
    telegram_state: state.telegram_state ?? String(entry.delivery_status ?? 'none'),
    x_state: typeof entry.x_status === 'string' ? entry.x_status : state.x_state ?? 'none',
    coverage_state: entryIsDeliveredOrPosted(entry) ? 'delivered' : entryHasActiveDeliveryPath(entry) ? 'in_pipeline' : entry.dup_of_tweet_id ? 'also_duplicate' : 'not_covered',
    is_canonical: entryTweetId(entry) === canonicalTweetId,
  };
}

function clusterMemberFromTarget(target: DuplicateTargetSummary, canonicalTweetId: string): Record<string, unknown> {
  return {
    tweet_id: target.tweet_id,
    text_original: target.text_original,
    url: target.url,
    created_at: target.created_at,
    author_handle: target.author_handle,
    final_score: target.final_score,
    importance_score: target.importance_score,
    dedupe_status: target.dedupe_status,
    dup_of_tweet_id: target.dup_of_tweet_id,
    dup_similarity: target.dup_similarity,
    telegram_state: target.telegram_state,
    x_state: target.x_state,
    coverage_state: target.coverage_state,
    is_canonical: target.tweet_id === canonicalTweetId,
  };
}

function duplicateClusterCounts(members: Record<string, unknown>[]) {
  return {
    total: members.length,
    delivered: members.filter((m) => m.coverage_state === 'delivered' || m.telegram_state === 'delivered' || m.telegram_state === 'posted').length,
    x_posted: members.filter((m) => m.x_state === 'posted').length,
    blocked: members.filter((m) => m.dedupe_status === 'duplicate' || typeof m.dup_of_tweet_id === 'string').length,
    uncertain: members.filter((m) => m.dedupe_status === 'uncertain').length,
    coverage_gap: members.filter((m) => m.coverage_state === 'not_covered' || m.dedupe_status === 'coverage_gap').length,
  };
}

function attachDuplicateClusters(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  const referencedIds = new Set(entries.map((entry) => typeof entry.dup_of_tweet_id === 'string' ? entry.dup_of_tweet_id : '').filter(Boolean));
  const storyCounts = new Map<string, number>();
  for (const entry of entries) {
    const story = typeof entry.story_cluster_id === 'string' ? entry.story_cluster_id : '';
    if (story) storyCounts.set(story, (storyCounts.get(story) ?? 0) + 1);
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const entry of entries) {
    const tweetId = entryTweetId(entry);
    const story = typeof entry.story_cluster_id === 'string' ? entry.story_cluster_id : '';
    const dupOf = typeof entry.dup_of_tweet_id === 'string' ? entry.dup_of_tweet_id : '';
    const key = story && (storyCounts.get(story) ?? 0) > 1
      ? `story:${story}`
      : dupOf
        ? `root:${dupOf}`
        : referencedIds.has(tweetId)
          ? `root:${tweetId}`
          : '';
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const clusterByTweet = new Map<string, Record<string, unknown>>();
  const hidden = new Set<string>();
  for (const [clusterId, group] of groups) {
    if (group.length === 0) continue;
    const canonical = chooseDuplicateCanonical(group);
    const canonicalTweetId = entryTweetId(canonical);
    const membersById = new Map<string, Record<string, unknown>>();
    for (const entry of group) {
      membersById.set(entryTweetId(entry), clusterMemberFromEntry(entry, canonicalTweetId));
      const target = entry.duplicate_of as DuplicateTargetSummary | null | undefined;
      if (target?.tweet_id && !membersById.has(target.tweet_id)) {
        membersById.set(target.tweet_id, clusterMemberFromTarget(target, canonicalTweetId));
      }
    }
    const members = [...membersById.values()].sort((a, b) => Number(Boolean(b.is_canonical)) - Number(Boolean(a.is_canonical)) || entryCreatedAtMs(a) - entryCreatedAtMs(b));
    if (members.length < 2) continue;
    const counts = duplicateClusterCounts(members);
    const coverageState = counts.delivered > 0 || counts.x_posted > 0
      ? 'covered'
      : members.some((m) => m.coverage_state === 'in_pipeline')
        ? 'in_pipeline'
        : counts.coverage_gap > 0
          ? 'coverage_gap'
          : 'unknown';
    const cluster = {
      cluster_id: clusterId,
      canonical_tweet_id: canonicalTweetId,
      members,
      counts,
      has_x_anomaly: counts.x_posted > 1,
      coverage_state: coverageState,
    };
    for (const entry of group) {
      clusterByTweet.set(entryTweetId(entry), cluster);
      if (entryTweetId(entry) !== canonicalTweetId) hidden.add(entryTweetId(entry));
    }
  }

  return entries.map((entry) => ({
    ...entry,
    duplicate_cluster: clusterByTweet.get(entryTweetId(entry)) ?? null,
    hidden_in_cluster: hidden.has(entryTweetId(entry)),
  }));
}

function matchesMonitoringFilter(entry: Record<string, unknown>, filter: MonitoringFilter): boolean {
  if (filter === 'all') return true;
  const state = (entry.monitoring_state ?? {}) as MonitoringState;
  switch (filter) {
    case 'needs_attention':
      return state.needs_attention === true;
    case 'failed_stuck':
      return state.code === 'failed_stuck';
    case 'needs_score':
      return state.code === 'needs_score';
    case 'translation_queue':
      return state.translation_state === 'queued' || state.translation_state === 'needs_translation';
    case 'below_threshold':
      return state.code === 'below_threshold';
    case 'manual_review':
      return state.code === 'manual_review';
    case 'v2_would_post':
    case 'v2_would_skip':
    case 'v1_post_v2_skip':
    case 'v1_skip_v2_post':
    case 'v2_off_topic':
    case 'v2_needs_review':
      return matchesMonitoringScoringV2Filter(entry, filter);
    case 'duplicates':
      return !!entry.dup_of_tweet_id;
    case 'coverage_gap':
      return state.code === 'duplicate_coverage_gap' || entry.dedupe_status === 'coverage_gap';
    case 'possible_duplicate':
      return entry.dedupe_status === 'uncertain' || entry.dedupe_status === 'coverage_gap' || state.code === 'duplicate_coverage_gap';
    case 'duplicate_anomalies': {
      const target = (entry.duplicate_of ?? null) as DuplicateTargetSummary | null;
      return entry.x_status === 'posted' && target?.x_state === 'posted';
    }
    case 'ready_to_deliver':
      return state.code === 'ready_to_deliver';
    case 'telegram_pending':
      return state.code === 'telegram_pending';
    case 'x_pending':
      return state.code === 'x_pending' || entry.x_status === 'pending';
    case 'x_failed':
      return entry.x_status === 'failed';
    case 'delivered_24h':
      return state.code === 'delivered' || entry.x_status === 'posted';
    case 'hydration':
      return state.code === 'hydration';
  }
}

// deno-lint-ignore no-explicit-any
async function getMonitoringEntries(supabase: any, body: Record<string, unknown>) {
  const filter = normalizeMonitoringFilter(body.filter);
  const scoreBucket = normalizeMonitoringScoreBucket(body.score_bucket);
  const search = sanitizeSearchTerm(body.search);
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const cursor = Math.max(Number(body.cursor) || 0, 0);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const threshold = await loadActiveThreshold(supabase);

  let idOrder: string[] | null = null;
  if (filter === 'failed_stuck') idOrder = await getTweetIdsFromFailedJobs(supabase, limit, cursor);
  if (filter === 'x_pending') idOrder = await getTweetIdsFromXDeliveries(supabase, 'pending', limit, cursor);
  if (filter === 'x_failed') idOrder = await getTweetIdsFromXDeliveries(supabase, 'failed', limit, cursor);
  if (filter === 'delivered_24h') idOrder = await getTweetIdsFromXDeliveries(supabase, 'posted', limit, cursor, since24h);

  if (idOrder && idOrder.length === 0) {
    return { success: true, entries: [], next_cursor: null, filter, search };
  }

  const needsInMemoryScoreFilter = scoreBucket !== 'any' && scoreBucket !== 'unscored';
  const needsInMemoryFilter = filter !== 'all' || needsInMemoryScoreFilter;
  const scanLimit = idOrder ? limit : needsInMemoryFilter ? Math.min(limit * 8, 500) : limit;
  const buildQuery = (selectColumns: string) => {
    let q = supabase
      .from('posts')
      .select(selectColumns)
      .order('created_at', { ascending: false });

    if (idOrder) {
      q = q.in('tweet_id', idOrder);
    } else {
      switch (filter) {
        case 'manual_review':
          q = q.or('enrich_status.eq.awaiting_approval,dedupe_status.eq.uncertain');
          break;
        case 'duplicates':
          q = q.not('dup_of_tweet_id', 'is', null);
          break;
        case 'coverage_gap':
          q = q.or('dedupe_status.eq.coverage_gap,dedupe_status.eq.uncertain');
          break;
        case 'possible_duplicate':
          q = q.or('dedupe_status.eq.uncertain,dedupe_status.eq.coverage_gap');
          break;
        case 'duplicate_anomalies':
          q = q.not('dup_of_tweet_id', 'is', null);
          break;
        case 'hydration':
          q = q.eq('is_truncated', true).is('hydrated_at', null);
          break;
        case 'below_threshold':
          q = q.eq('delivery_decision', 'skip');
          break;
        case 'v2_would_post':
        case 'v2_would_skip':
        case 'v1_post_v2_skip':
        case 'v1_skip_v2_post':
        case 'v2_off_topic':
        case 'v2_needs_review':
          q = q.not('scoring_version', 'is', null);
          break;
        case 'ready_to_deliver':
          q = q.eq('delivery_decision', 'deliver').not('text_translated', 'is', null).or('is_truncated.eq.false,hydrated_at.not.is.null');
          break;
        case 'needs_score':
          q = q.is('final_score', null).is('importance_score', null);
          break;
      }
      if (scoreBucket === 'unscored') {
        q = q.is('final_score', null).is('importance_score', null);
      }
      q = q.range(cursor, cursor + scanLimit - 1);
    }

    if (search) q = q.or(postSearchOr(search));
    return q;
  };

  let result = await buildQuery(MONITORING_POST_SELECT);
  if (result.error && isMissingSchemaError(result.error)) {
    result = await buildQuery(MONITORING_POST_SELECT_NO_ENRICHMENT_V2);
  }
  if (result.error && isMissingSchemaError(result.error)) {
    result = await buildQuery(MONITORING_POST_SELECT_NO_SCORING_V2);
  }
  const posts = result.data;
  if (result.error) throw result.error;
  const rows = (posts ?? []) as Record<string, unknown>[];
  if (idOrder) {
    const rank = new Map(idOrder.map((id, index) => [id, index]));
    rows.sort((a, b) => (rank.get(a.tweet_id as string) ?? 0) - (rank.get(b.tweet_id as string) ?? 0));
  }

  const tweetIds = rows.map((p) => p.tweet_id as string).filter(Boolean);
  const statusByTweet: Record<string, Record<string, unknown>> = {};
  const jobStateByTweet = await loadJobStateMap(supabase, tweetIds);
  if (tweetIds.length > 0) {
    const { data: statuses } = await supabase.rpc('get_post_pipeline_status', { tweet_ids: tweetIds });
    for (const row of statuses ?? []) statusByTweet[row.tweet_id as string] = row;
  }
  const duplicateTargets = await loadDuplicateTargetMap(supabase, rows, threshold);
  const entries = rows
    .map((post) => toMonitoringEntry(post, statusByTweet[post.tweet_id as string], threshold, jobStateByTweet, duplicateTargets))
    .filter((entry: Record<string, unknown>) => matchesMonitoringFilter(entry, filter) && matchesMonitoringScoreBucket(entry, scoreBucket));
  const clusteredEntries = attachDuplicateClusters(entries);
  const visibleEntries = clusteredEntries.filter((entry) => entry.hidden_in_cluster !== true);

  return {
    success: true,
    entries: visibleEntries.slice(0, limit),
    next_cursor: rows.length === scanLimit ? cursor + scanLimit : null,
    filter,
    score_bucket: scoreBucket,
    search,
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isMissingSchemaError(error: unknown): boolean {
  const message = String((error as { message?: unknown; details?: unknown; code?: unknown })?.message ?? error ?? '');
  const details = String((error as { details?: unknown })?.details ?? '');
  const code = String((error as { code?: unknown })?.code ?? '');
  return code === '42P01' || code === '42703' || /does not exist|schema cache|column|relation/i.test(`${message} ${details}`);
}

function intervalAgeSeconds(timestamp: unknown): number | null {
  if (typeof timestamp !== 'string') return null;
  const ms = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

// deno-lint-ignore no-explicit-any
async function hasDedupePostColumns(supabase: any): Promise<boolean> {
  const { error } = await supabase.from('posts').select('dedupe_status', { head: true, count: 'exact' }).limit(1);
  if (error && isMissingSchemaError(error)) return false;
  if (error) throw error;
  return true;
}

// deno-lint-ignore no-explicit-any
async function loadDashboardPosts(supabase: any, since: string, dedupeAvailable: boolean) {
  const select = [
    'tweet_id',
    'text_original',
    'text_translated',
    'created_at',
    'delivery_decision',
    'final_score',
    'importance_score',
    'dup_of_tweet_id',
    'is_truncated',
    'hydrated_at',
    ...(dedupeAvailable ? ['dedupe_status'] : []),
  ].join(', ');
  const { data, error } = await supabase
    .from('posts')
    .select(select)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

function queueLaneForType(type: string): 'fast' | 'model' | 'delivery' {
  if (['translate', 'enrich'].includes(type)) return 'model';
  if (type === 'deliver') return 'delivery';
  return 'fast';
}

function summarizeLanePressure(byType: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const lanes = new Map<string, { lane: string; pending: number; running: number; failed: number; queueWaitP95: Array<number | null> }>();
  for (const row of byType) {
    const lane = typeof row.lane === 'string' ? row.lane : queueLaneForType(String(row.type ?? 'unknown'));
    if (!lanes.has(lane)) lanes.set(lane, { lane, pending: 0, running: 0, failed: 0, queueWaitP95: [] });
    const item = lanes.get(lane)!;
    item.pending += num(row.pending);
    item.running += num(row.running);
    item.failed += num(row.failed);
    item.queueWaitP95.push(typeof row.queue_wait_p95_seconds === 'number' ? row.queue_wait_p95_seconds : null);
  }
  return [...lanes.values()].map((lane) => ({
    lane: lane.lane,
    pending: lane.pending,
    running: lane.running,
    failed: lane.failed,
    max_queue_wait_p95_seconds: Math.max(0, ...lane.queueWaitP95.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))),
  }));
}

// deno-lint-ignore no-explicit-any
async function loadDashboardQueueBreakdown(supabase: any, since: string, staleCutoff: string) {
  const [{ data: jobs, error }, { data: activeJobs, error: activeError }] = await Promise.all([
    supabase
      .from('jobs')
      .select('type, status, created_at, started_at, locked_at, completed_at, lease_expires_at, result_meta')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('jobs')
      .select('type, status, created_at, locked_at, lease_expires_at')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: true })
      .limit(5000),
  ]);
  if (error) throw error;
  if (activeError) throw activeError;

  const rows = (jobs ?? []) as Array<Record<string, unknown>>;
  const activeRows = (activeJobs ?? []) as Array<Record<string, unknown>>;
  const byType = new Map<string, {
    type: string;
    lane: string;
    pending: number;
    running: number;
    failed: number;
    queueWaits: number[];
    runs: number[];
  }>();
  const ensure = (type: unknown) => {
    const key = typeof type === 'string' && type ? type : 'unknown';
    if (!byType.has(key)) byType.set(key, {
      type: key,
      lane: queueLaneForType(key),
      pending: 0,
      running: 0,
      failed: 0,
      queueWaits: [],
      runs: [],
    });
    return byType.get(key)!;
  };

  let failed24h = 0;
  for (const row of rows) {
    const item = ensure(row.type);
    const meta = row.result_meta && typeof row.result_meta === 'object' ? row.result_meta as Record<string, unknown> : {};
    const queueWaitMs = typeof meta.queue_wait_ms === 'number'
      ? meta.queue_wait_ms
      : durationSeconds(row.created_at, row.started_at ?? row.locked_at) != null
        ? Number(durationSeconds(row.created_at, row.started_at ?? row.locked_at)) * 1000
        : null;
    const runMs = typeof meta.worker_run_ms === 'number'
      ? meta.worker_run_ms
      : durationSeconds(row.started_at ?? row.locked_at, row.completed_at) != null
        ? Number(durationSeconds(row.started_at ?? row.locked_at, row.completed_at)) * 1000
        : null;
    if (queueWaitMs != null && Number.isFinite(queueWaitMs)) item.queueWaits.push(queueWaitMs / 1000);
    if (runMs != null && Number.isFinite(runMs)) item.runs.push(runMs / 1000);
    if (row.status === 'failed') {
      item.failed += 1;
      failed24h += 1;
    }
  }

  let pending = 0;
  let running = 0;
  let staleRunning = 0;
  let oldestPendingAgeSeconds: number | null = null;
  for (const row of activeRows) {
    const item = ensure(row.type);
    if (row.status === 'pending') {
      pending += 1;
      item.pending += 1;
      const age = intervalAgeSeconds(row.created_at);
      if (age != null) oldestPendingAgeSeconds = Math.max(oldestPendingAgeSeconds ?? 0, age);
    }
    if (row.status === 'running') {
      running += 1;
      item.running += 1;
      const leaseExpired = typeof row.lease_expires_at === 'string' && row.lease_expires_at < new Date().toISOString();
      const lockedStale = typeof row.lease_expires_at !== 'string'
        && typeof row.locked_at === 'string'
        && row.locked_at < staleCutoff;
      if (leaseExpired || lockedStale) staleRunning += 1;
    }
  }

  return {
    pending,
    running,
    failed_24h: failed24h,
    stale_running: staleRunning,
    oldest_pending_age_seconds: oldestPendingAgeSeconds,
    by_type: [...byType.values()]
      .map((item) => {
        const queueSummary = summarizeDurations(item.queueWaits);
        const runSummary = summarizeDurations(item.runs);
        return {
          type: item.type,
          lane: item.lane,
          pending: item.pending,
          running: item.running,
          failed: item.failed,
          queue_wait_p50_seconds: queueSummary.p50_seconds,
          queue_wait_p95_seconds: queueSummary.p95_seconds,
          run_p50_seconds: runSummary.p50_seconds,
          run_p95_seconds: runSummary.p95_seconds,
        };
      })
      .sort((a, b) => (b.pending + b.running + b.failed) - (a.pending + a.running + a.failed))
      .slice(0, 8),
  };
}

function xDeliveryTime(row: Record<string, unknown>): number {
  const raw = typeof row.posted_at === 'string' ? row.posted_at : row.created_at;
  const time = typeof raw === 'string' ? new Date(raw).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function latestXDeliveriesByPost(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const postId = String(row.post_id ?? '');
    if (!postId) continue;
    const existing = latest.get(postId);
    if (!existing || xDeliveryTime(row) > xDeliveryTime(existing)) latest.set(postId, row);
  }
  return [...latest.values()];
}

// deno-lint-ignore no-explicit-any
async function loadDashboardXLocalUsage(supabase: any, base: Record<string, unknown>, since: string) {
  const xPosting = (base.x_posting && typeof base.x_posting === 'object' ? base.x_posting : {}) as Record<string, unknown>;
  const metrics = (base.metrics && typeof base.metrics === 'object' ? base.metrics : {}) as Record<string, unknown>;
  const health = (base.health && typeof base.health === 'object' ? base.health : {}) as Record<string, unknown>;

  const [{ data: xRows, error: xError }, { data: eventRows, error: eventError }] = await Promise.all([
    supabase
      .from('x_deliveries')
      .select('post_id, status, media_count, created_at, posted_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('x_api_events')
      .select('endpoint, ok, request_counted, estimated_billable_unit, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);
  if (xError) throw xError;

  const deliveries = (xRows ?? []) as Array<Record<string, unknown>>;
  const latestDeliveries = latestXDeliveriesByPost(deliveries);
  const posts24h = new Set(deliveries.filter((row) => row.status === 'posted').map((row) => row.post_id).filter(Boolean)).size;
  const failedDeliveryRows24h = deliveries.filter((row) => row.status === 'failed').length;
  const failedPosts24h = latestDeliveries.filter((row) => row.status === 'failed').length;
  const mediaUploads24h = deliveries.reduce((sum, row) => sum + num(row.media_count), 0);

  if (eventError && !isMissingSchemaError(eventError)) throw eventError;
  const eventsAvailable = !eventError;
  const events = eventsAvailable ? (eventRows ?? []) as Array<Record<string, unknown>> : [];
  const attempts = events.length;
  const counted = events.filter((row) => row.request_counted !== false).length;
  const failedAttempts = events.filter((row) => row.ok === false).length;
  const hydrations = events.filter((row) => {
    const endpoint = String(row.endpoint ?? '');
    const unit = String(row.estimated_billable_unit ?? '');
    return unit === 'read' || endpoint.includes('/2/tweets');
  }).length;

  return {
    available: eventsAvailable,
    source: eventsAvailable ? 'x_api_events' : 'x_deliveries_fallback',
    attempts_24h: eventsAvailable ? attempts : num(metrics.x_api_calls_24h),
    counted_attempts_24h: eventsAvailable ? counted : num(metrics.x_api_calls_24h),
    failed_attempts_24h: eventsAvailable ? failedAttempts : failedDeliveryRows24h,
    posts_24h: posts24h || num(xPosting.posted_24h),
    failed_posts_24h: failedPosts24h,
    media_uploads_24h: mediaUploads24h || num(xPosting.media_uploads_24h),
    hydrations_24h: eventsAvailable ? hydrations : num(metrics.posts_hydrated_24h),
    monthly_posts: num(xPosting.monthly_posts, num(health.x_monthly_posts)),
    monthly_budget: num(xPosting.monthly_budget, num(health.x_monthly_budget, 2500)),
    budget_used_pct: num(xPosting.budget_used_pct, num(health.x_budget_used_pct)),
    official_usage_synced: false,
  };
}

// deno-lint-ignore no-explicit-any
async function loadDashboardActivity(supabase: any) {
  const [postsRes, jobsRes, deliveriesRes, xDeliveriesRes] = await Promise.all([
    supabase
      .from('posts')
      .select('tweet_id, text_original, created_at, text_translated, accounts!inner(handle)')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('jobs')
      .select('id, type, status, created_at, last_error, payload')
      .in('status', ['failed', 'pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('deliveries')
      .select('id, subject_id, status, created_at, posted_at, last_error')
      .eq('subject_type', 'post')
      .in('status', ['posted', 'failed', 'pending'])
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('x_deliveries')
      .select('id, post_id, status, created_at, posted_at, last_error')
      .in('status', ['posted', 'failed', 'pending'])
      .order('created_at', { ascending: false })
      .limit(8),
  ]);
  for (const res of [postsRes, jobsRes, deliveriesRes, xDeliveriesRes]) {
    if (res.error) throw res.error;
  }

  const items: Array<Record<string, unknown>> = [];
  for (const post of postsRes.data ?? []) {
    const account = post.accounts as { handle?: string } | null;
    const tweetId = String(post.tweet_id);
    items.push({
      id: `post-${tweetId}`,
      kind: 'post',
      status: post.text_translated ? 'success' : 'pending',
      title: `Ingested @${account?.handle ?? 'unknown'}`,
      description: String(post.text_original ?? 'No content').replace(/\s+/g, ' ').slice(0, 140),
      timestamp: post.created_at,
      route: `/monitoring?search=${encodeURIComponent(tweetId)}`,
    });
  }
  for (const job of jobsRes.data ?? []) {
    const tweetId = getPayloadTweetId(job.payload);
    items.push({
      id: `job-${job.id}`,
      kind: 'job',
      status: job.status === 'failed' ? 'failed' : 'pending',
      title: `${job.type} job ${job.status}`,
      description: job.last_error ? String(job.last_error).slice(0, 140) : 'Pipeline job needs attention',
      timestamp: job.created_at,
      route: tweetId ? `/monitoring?search=${encodeURIComponent(tweetId)}` : '/monitoring?filter=failed_stuck',
    });
  }
  for (const delivery of deliveriesRes.data ?? []) {
    const tweetId = String(delivery.subject_id ?? '');
    items.push({
      id: `delivery-${delivery.id}`,
      kind: 'delivery',
      status: delivery.status === 'posted' ? 'success' : delivery.status === 'failed' ? 'failed' : 'pending',
      title: `Telegram ${delivery.status}`,
      description: delivery.last_error ? String(delivery.last_error).slice(0, 140) : 'Telegram delivery state changed',
      timestamp: delivery.posted_at ?? delivery.created_at,
      route: tweetId ? `/monitoring?search=${encodeURIComponent(tweetId)}` : '/monitoring',
    });
  }
  for (const x of xDeliveriesRes.data ?? []) {
    const tweetId = String(x.post_id ?? '');
    items.push({
      id: `x-${x.id}`,
      kind: 'x',
      status: x.status === 'posted' ? 'success' : x.status === 'failed' ? 'failed' : 'pending',
      title: `X ${x.status}`,
      description: x.last_error ? String(x.last_error).slice(0, 140) : 'X delivery state changed',
      timestamp: x.posted_at ?? x.created_at,
      route: tweetId ? `/monitoring?search=${encodeURIComponent(tweetId)}` : '/monitoring?filter=x_failed',
    });
  }
  return items
    .filter((item) => typeof item.timestamp === 'string')
    .sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime())
    .slice(0, 16);
}

function toTimeMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function durationSeconds(start: unknown, end: unknown): number | null {
  const startMs = toTimeMs(start);
  const endMs = toTimeMs(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 100) / 10;
}

function summarizeDurations(values: Array<number | null>): Record<string, unknown> {
  const sorted = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, avg_seconds: null, p50_seconds: null, p90_seconds: null, p95_seconds: null };
  }
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    avg_seconds: Math.round(avg * 10) / 10,
    p50_seconds: Math.round(percentile(0.5) * 10) / 10,
    p90_seconds: Math.round(percentile(0.9) * 10) / 10,
    p95_seconds: Math.round(percentile(0.95) * 10) / 10,
  };
}

function latestTimestampBySubject(rows: Array<Record<string, unknown>>, idKey: string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const id = String(row[idKey] ?? '');
    const timestamp = String(row.posted_at ?? row.created_at ?? '');
    if (!id || !timestamp) continue;
    const existing = latest.get(id);
    if (!existing || new Date(timestamp).getTime() > new Date(existing).getTime()) latest.set(id, timestamp);
  }
  return latest;
}

function latestEventTimestampBySubject(rows: Array<Record<string, unknown>>, idKey: string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    const id = String(row[idKey] ?? '');
    const timestamp = String(row.ended_at ?? row.started_at ?? row.created_at ?? '');
    if (!id || !timestamp) continue;
    const existing = latest.get(id);
    if (!existing || new Date(timestamp).getTime() > new Date(existing).getTime()) latest.set(id, timestamp);
  }
  return latest;
}

function estimateMonthlyRuns(schedule: unknown): number {
  const value = String(schedule ?? '').trim();
  if (value === '* * * * *') return 43_200;
  if (value === '*/2 * * * *') return 21_600;
  if (value === '*/10 * * * *') return 4_320;
  if (/^0 \*\/6 \* \* \*$/.test(value)) return 120;
  if (/^0 \d+ \* \* \*$/.test(value)) return 30;
  if (/^0 \d+ \* \* [0-6]$/.test(value)) return 4;
  return 30;
}

function cronCadenceSeconds(schedule: unknown): number | null {
  const value = String(schedule ?? '').trim();
  if (value === '* * * * *') return 60;
  if (value === '*/2 * * * *') return 120;
  if (value === '*/10 * * * *') return 600;
  const everySeconds = value.match(/^\*\/(\d+) \* \* \* \* \*$/);
  if (everySeconds) return Number(everySeconds[1]);
  const everyMinutes = value.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) return Number(everyMinutes[1]) * 60;
  return null;
}

function percentUsed(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round((used / limit) * 1000) / 10;
}

// deno-lint-ignore no-explicit-any
async function loadPerformanceWindow(supabase: any, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const postsRes = await supabase
    .from('posts')
    .select('tweet_id, created_at, dedupe_checked_at, translated_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10000);
  if (postsRes.error && !isMissingSchemaError(postsRes.error)) throw postsRes.error;

  const posts = ((postsRes.error ? [] : postsRes.data) ?? []) as Array<Record<string, unknown>>;
  const [{ data: deliveries, error: deliveryError }, { data: xDeliveries, error: xError }, { data: scoreEvents, error: scoreError }] = await Promise.all([
    supabase
      .from('deliveries')
      .select('subject_id, status, created_at, posted_at')
      .eq('subject_type', 'post')
      .eq('status', 'posted')
      .gte('created_at', since)
      .limit(10000),
    supabase
      .from('x_deliveries')
      .select('post_id, status, created_at, posted_at')
      .eq('status', 'posted')
      .gte('created_at', since)
      .limit(10000),
    supabase
      .from('pipeline_events')
      .select('subject_id, status, created_at, started_at, ended_at')
      .eq('subject_type', 'post')
      .eq('step', 'score')
      .in('status', ['completed', 'skipped'])
      .gte('created_at', since)
      .limit(10000),
  ]);
  if (deliveryError) throw deliveryError;
  if (xError) throw xError;
  if (scoreError) throw scoreError;

  const telegramByTweet = latestTimestampBySubject((deliveries ?? []) as Array<Record<string, unknown>>, 'subject_id');
  const xByTweet = latestTimestampBySubject((xDeliveries ?? []) as Array<Record<string, unknown>>, 'post_id');
  const scoreByTweet = latestEventTimestampBySubject((scoreEvents ?? []) as Array<Record<string, unknown>>, 'subject_id');

  const ingestToDedupe: Array<number | null> = [];
  const ingestToScore: Array<number | null> = [];
  const dedupeToTranslation: Array<number | null> = [];
  const scoreToTranslation: Array<number | null> = [];
  const ingestToTranslation: Array<number | null> = [];
  const translationToTelegram: Array<number | null> = [];
  const translationToX: Array<number | null> = [];
  const telegramEndToEnd: Array<number | null> = [];
  const xEndToEnd: Array<number | null> = [];

  for (const post of posts) {
    const tweetId = String(post.tweet_id ?? '');
    const scoreAt = scoreByTweet.get(tweetId);
    ingestToDedupe.push(durationSeconds(post.created_at, post.dedupe_checked_at));
    ingestToScore.push(durationSeconds(post.created_at, scoreAt));
    dedupeToTranslation.push(durationSeconds(post.dedupe_checked_at, post.translated_at));
    scoreToTranslation.push(durationSeconds(scoreAt, post.translated_at));
    ingestToTranslation.push(durationSeconds(post.created_at, post.translated_at));
    const telegramAt = telegramByTweet.get(tweetId);
    const xAt = xByTweet.get(tweetId);
    translationToTelegram.push(durationSeconds(post.translated_at, telegramAt));
    translationToX.push(durationSeconds(post.translated_at, xAt));
    telegramEndToEnd.push(durationSeconds(post.created_at, telegramAt));
    xEndToEnd.push(durationSeconds(post.created_at, xAt));
  }

  return {
    window_hours: windowHours,
    sampled_posts: posts.length,
    stages: {
      ingest_to_dedupe: summarizeDurations(ingestToDedupe),
      ingest_to_score: summarizeDurations(ingestToScore),
      dedupe_to_translation: summarizeDurations(dedupeToTranslation),
      score_to_translation: summarizeDurations(scoreToTranslation),
      ingest_to_translation: summarizeDurations(ingestToTranslation),
      translation_to_telegram: summarizeDurations(translationToTelegram),
      translation_to_x: summarizeDurations(translationToX),
      telegram_end_to_end: summarizeDurations(telegramEndToEnd),
      x_end_to_end: summarizeDurations(xEndToEnd),
    },
  };
}

function normalizeResourceUsage(raw: unknown): Record<string, unknown> {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const dbBytes = num(value.db_bytes);
  const dbLimit = num(value.db_limit_bytes, 500_000_000);
  const storageBytes = num(value.temp_media_bytes);
  const storageLimit = num(value.storage_limit_bytes, 1_000_000_000);
  const edgeLimit = num(value.edge_monthly_limit, 500_000);
  const cronJobs = Array.isArray(value.cron_jobs) ? value.cron_jobs as Array<Record<string, unknown>> : [];
  const projectedCronMonthly = cronJobs.reduce((sum, job) => sum + (job.active === false ? 0 : estimateMonthlyRuns(job.schedule)), 0);
  const workerCron = cronJobs.find((job) => job.active !== false && String(job.jobname ?? '').startsWith('invoke-worker-every')) ?? null;
  const workerCadenceSeconds = workerCron ? cronCadenceSeconds(workerCron.schedule) : null;

  return {
    available: value.available !== false,
    error: typeof value.error === 'string' ? value.error : null,
    db_bytes: dbBytes,
    db_limit_bytes: dbLimit,
    db_used_pct: percentUsed(dbBytes, dbLimit),
    temp_media_bytes: storageBytes,
    temp_media_objects: num(value.temp_media_objects),
    storage_limit_bytes: storageLimit,
    storage_used_pct: percentUsed(storageBytes, storageLimit),
    edge_monthly_limit: edgeLimit,
    projected_cron_invocations_monthly: projectedCronMonthly,
    edge_cron_used_pct: percentUsed(projectedCronMonthly, edgeLimit),
    cron_failures_24h: typeof value.cron_failures_24h === 'number' ? value.cron_failures_24h : null,
    cron_jobs: cronJobs,
    worker_dispatch_mode: 'event-driven + cron fallback',
    worker_cron: workerCron,
    worker_cadence_seconds: workerCadenceSeconds,
    worker_cadence_warning: workerCadenceSeconds != null && workerCadenceSeconds > 60,
    duplicate_translate_jobs_24h: num(value.duplicate_translate_jobs_24h),
  };
}

// deno-lint-ignore no-explicit-any
async function getSystemPerformanceSummary(supabase: any) {
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [window6h, window24h, resourceRes, queueBreakdown] = await Promise.all([
    loadPerformanceWindow(supabase, 6),
    loadPerformanceWindow(supabase, 24),
    supabase.rpc('get_system_resource_usage'),
    loadDashboardQueueBreakdown(supabase, since24h, staleCutoff),
  ]);
  const byType = Array.isArray(queueBreakdown.by_type) ? queueBreakdown.by_type as Array<Record<string, unknown>> : [];

  return {
    success: true,
    generated_at: new Date().toISOString(),
    windows: {
      '6h': window6h,
      '24h': window24h,
    },
    queue: {
      pending: queueBreakdown.pending,
      running: queueBreakdown.running,
      stale_running: queueBreakdown.stale_running,
      failed_24h: queueBreakdown.failed_24h,
      oldest_pending_age_seconds: queueBreakdown.oldest_pending_age_seconds,
      scheduler_wait_seconds: queueBreakdown.oldest_pending_age_seconds,
      by_type: byType,
      lane_pressure: summarizeLanePressure(byType),
    },
    resources: resourceRes.error && isMissingSchemaError(resourceRes.error)
      ? normalizeResourceUsage({ available: false, error: resourceRes.error.message })
      : normalizeResourceUsage(resourceRes.data),
  };
}

// deno-lint-ignore no-explicit-any
async function getEnhancedDashboardSummary(supabase: any) {
  const { data: base, error } = await supabase.rpc('get_dashboard_summary');
  if (error) throw error;

  const dashboard = (base && typeof base === 'object' ? base : {}) as Record<string, unknown>;
  const metrics = (dashboard.metrics && typeof dashboard.metrics === 'object' ? dashboard.metrics : {}) as Record<string, unknown>;
  const health = (dashboard.health && typeof dashboard.health === 'object' ? dashboard.health : {}) as Record<string, unknown>;
  const heartbeat = (dashboard.ingest_heartbeat && typeof dashboard.ingest_heartbeat === 'object' ? dashboard.ingest_heartbeat : {}) as Record<string, unknown>;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const dedupeAvailable = await hasDedupePostColumns(supabase);
  const [posts, deliveriesRes, xDeliveriesRes, queueBreakdown, xLocalUsage, activity, systemPerformance] = await Promise.all([
    loadDashboardPosts(supabase, since, dedupeAvailable),
    supabase.from('deliveries').select('subject_id, status, posted_at, created_at').eq('subject_type', 'post').gte('created_at', since).limit(10000),
    supabase.from('x_deliveries').select('post_id, status, posted_at, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10000),
    loadDashboardQueueBreakdown(supabase, since, staleCutoff),
    loadDashboardXLocalUsage(supabase, dashboard, since),
    loadDashboardActivity(supabase),
    getSystemPerformanceSummary(supabase).catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);
  if (deliveriesRes.error) throw deliveriesRes.error;
  if (xDeliveriesRes.error) throw xDeliveriesRes.error;

  const telegramPosted = new Set((deliveriesRes.data ?? []).filter((row: Record<string, unknown>) => row.status === 'posted').map((row: Record<string, unknown>) => row.subject_id));
  const xByTweet = new Map<string, Record<string, unknown>>();
  for (const row of latestXDeliveriesByPost((xDeliveriesRes.data ?? []) as Array<Record<string, unknown>>)) {
    const postId = String(row.post_id ?? '');
    if (postId && !xByTweet.has(postId)) xByTweet.set(postId, row);
  }

  let scored = 0;
  let translated = 0;
  let readyToDeliver = 0;
  let needsScore = 0;
  let duplicates = 0;
  let duplicateGateChecked = 0;
  let xFailed = 0;
  for (const post of posts) {
    const tweetId = String(post.tweet_id ?? '');
    const score = typeof post.final_score === 'number' ? post.final_score : post.importance_score;
    const hasScore = typeof score === 'number';
    const hasTranslation = typeof post.text_translated === 'string' && post.text_translated.trim() !== '' && post.text_translated !== post.text_original;
    const dedupeStatus = typeof post.dedupe_status === 'string' ? post.dedupe_status : null;
    const duplicate = dedupeStatus === 'duplicate'
      || (
        Boolean(post.dup_of_tweet_id)
        && !['coverage_gap', 'uncertain', 'related_new_info'].includes(dedupeStatus ?? '')
      );
    if (hasScore) scored += 1;
    else if (!duplicate) needsScore += 1;
    if (hasTranslation) translated += 1;
    if (duplicate) duplicates += 1;
    if (dedupeStatus) duplicateGateChecked += 1;
    if (post.delivery_decision === 'deliver' && hasTranslation && !telegramPosted.has(tweetId) && !duplicate) readyToDeliver += 1;
    if (xByTweet.get(tweetId)?.status === 'failed') xFailed += 1;
  }

  const xFailedActionable = Math.max(xFailed, num(xLocalUsage.failed_posts_24h));
  const failedStuck = queueBreakdown.failed_24h + queueBreakdown.stale_running;
  const needsAttention = failedStuck + xFailedActionable;
  const lastIngestAge = typeof heartbeat.age_seconds === 'number' ? heartbeat.age_seconds : null;
  const budgetPct = num(xLocalUsage.budget_used_pct, num(health.x_budget_used_pct));
  let severity: 'ok' | 'warning' | 'critical' = 'ok';
  let primaryIssue = 'Pipeline is operating normally';
  let recommendedRoute = '/monitoring';
  if (queueBreakdown.stale_running > 0) {
    severity = 'critical';
    primaryIssue = `${queueBreakdown.stale_running} stale running job${queueBreakdown.stale_running === 1 ? '' : 's'}`;
    recommendedRoute = '/monitoring?filter=failed_stuck';
  } else if (xFailedActionable > 0) {
    severity = 'critical';
    primaryIssue = `${xFailedActionable} X failed post${xFailedActionable === 1 ? '' : 's'} in 24h`;
    recommendedRoute = '/monitoring?filter=x_failed';
  } else if (queueBreakdown.failed_24h > 0) {
    severity = 'warning';
    primaryIssue = `${queueBreakdown.failed_24h} failed job${queueBreakdown.failed_24h === 1 ? '' : 's'} in 24h`;
    recommendedRoute = '/monitoring?filter=failed_stuck';
  } else if (budgetPct >= 90) {
    severity = 'warning';
    primaryIssue = `X local budget estimate is at ${budgetPct}%`;
    recommendedRoute = '/settings#x-automation';
  } else if (heartbeat.state === 'warning' || heartbeat.state === 'critical') {
    severity = heartbeat.state === 'critical' ? 'critical' : 'warning';
    primaryIssue = `Ingest ${heartbeat.state}`;
    recommendedRoute = '/settings';
  }

  return {
    ...dashboard,
    ops_status: {
      severity,
      primary_issue: primaryIssue,
      recommended_route: recommendedRoute,
      last_ingest_age_seconds: lastIngestAge,
      stale_job_count: queueBreakdown.stale_running,
    },
    pipeline_counts: {
      ingested: num(metrics.posts_ingested, posts.length),
      duplicate_gate_available: dedupeAvailable,
      duplicate_gate_checked: dedupeAvailable ? duplicateGateChecked : null,
      duplicates: dedupeAvailable ? duplicates : null,
      scored,
      translated,
      telegram_delivered: num(metrics.posts_delivered),
      x_posted: num(metrics.x_posts_24h),
      needs_attention: needsAttention,
      failed_stuck: failedStuck,
      ready_to_deliver: readyToDeliver,
      translation_queue: queueBreakdown.by_type.find((row) => row.type === 'translate')?.pending ?? 0,
      x_failed: xFailedActionable,
      stale_jobs: queueBreakdown.stale_running,
    },
    queue_breakdown: queueBreakdown,
    x_local_usage: xLocalUsage,
    system_performance: systemPerformance,
    activity,
  };
}

// deno-lint-ignore no-explicit-any
async function getMonitoringOverview(supabase: any, body: Record<string, unknown>) {
  const windowHours = Math.min(Math.max(Number(body.window_hours) || 24, 1), 720);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const threshold = await loadActiveThreshold(supabase);
  const [
    postsRes,
    deliveriesRes,
    xDeliveriesRes,
    staleJobs,
    staleXPending,
  ] = await Promise.all([
    supabase
      .from('posts')
      .select('tweet_id, text_original, text_translated, translated_at, has_media, delivery_decision, final_score, importance_score, decision_reason, dup_of_tweet_id, is_truncated, hydrated_at, enrich_status, dedupe_status, dedupe_reason')
      .order('created_at', { ascending: false })
      .limit(10000),
    supabase
      .from('deliveries')
      .select('subject_id, status, last_error, posted_at, created_at')
      .eq('subject_type', 'post')
      .order('created_at', { ascending: false })
      .limit(10000),
    supabase
      .from('x_deliveries')
      .select('post_id, status, last_error, skip_reason, x_tweet_id, posted_at, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'running').lt('locked_at', staleCutoff),
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  const jobStateByTweet = await loadJobStateMap(supabase);
  const deliveryByTweet = new Map<string, Record<string, unknown>>();
  for (const row of deliveriesRes.data ?? []) {
    if (row.subject_id && !deliveryByTweet.has(row.subject_id)) {
      deliveryByTweet.set(row.subject_id, {
        delivery_status: row.status,
        posted_at: row.posted_at,
        delivery_error: row.last_error,
      });
    }
  }
  const xByTweet = new Map<string, Record<string, unknown>>();
  for (const row of xDeliveriesRes.data ?? []) {
    if (row.post_id && !xByTweet.has(row.post_id)) {
      xByTweet.set(row.post_id, {
        x_status: row.status,
        x_tweet_id: row.x_tweet_id,
        x_posted_at: row.posted_at,
        x_error: row.last_error,
        x_skip_reason: row.skip_reason,
      });
    }
  }

  const counts = {
    needs_attention: 0,
    failed_stuck: 0,
    translation_queue: 0,
    needs_score: 0,
    ready_to_deliver: 0,
    manual_review: 0,
    duplicates: 0,
    coverage_gap: 0,
    possible_duplicate: 0,
    duplicate_anomalies: 0,
    hydration: 0,
    x_pending: 0,
    x_failed: 0,
    delivered_24h: 0,
    telegram_pending: 0,
    below_threshold: 0,
    stale_jobs: staleJobs.count ?? 0,
    stale_x_pending_24h: staleXPending.count ?? 0,
  };

  for (const post of postsRes.data ?? []) {
    const tid = post.tweet_id as string;
    const rpc = {
      ...(deliveryByTweet.get(tid) ?? {}),
      ...(xByTweet.get(tid) ?? {}),
      translated_at: post.translated_at,
      is_truncated: post.is_truncated,
      hydrated_at: post.hydrated_at,
    };
    const state = deriveMonitoringState(post, applyJobStateToRpc(tid, rpc, jobStateByTweet), threshold);
    if (state.needs_attention) counts.needs_attention += 1;
    if (state.code === 'failed_stuck') counts.failed_stuck += 1;
    if (state.translation_state === 'queued' || state.translation_state === 'needs_translation') counts.translation_queue += 1;
    if (state.code === 'needs_score') counts.needs_score += 1;
    if (state.code === 'ready_to_deliver') counts.ready_to_deliver += 1;
    if (state.code === 'manual_review') counts.manual_review += 1;
    if (state.code === 'blocked_duplicate') counts.duplicates += 1;
    if (state.code === 'duplicate_coverage_gap') counts.coverage_gap += 1;
    if (state.code === 'duplicate_coverage_gap' || post.dedupe_status === 'uncertain') counts.possible_duplicate += 1;
    if (
      typeof post.dup_of_tweet_id === 'string'
      && xByTweet.get(tid)?.x_status === 'posted'
      && xByTweet.get(post.dup_of_tweet_id)?.x_status === 'posted'
    ) {
      counts.duplicate_anomalies += 1;
    }
    if (state.code === 'hydration') counts.hydration += 1;
    if (state.code === 'x_pending') counts.x_pending += 1;
    if (state.x_state === 'failed') counts.x_failed += 1;
    if (state.code === 'telegram_pending') counts.telegram_pending += 1;
    if (state.code === 'below_threshold') counts.below_threshold += 1;
  }

  for (const row of xDeliveriesRes.data ?? []) {
    if (row.status === 'posted' && row.posted_at && row.posted_at >= since) counts.delivered_24h += 1;
  }
  counts.needs_attention += counts.stale_jobs;

  return {
    success: true,
    overview: {
      window_hours: windowHours,
      counts: {
        ...counts,
        // Backward-compatible aliases for frontend bundles deployed before this change.
        needs_action: counts.needs_attention,
        failed: counts.failed_stuck,
        waiting_translation: counts.translation_queue,
        delivery_pending: counts.telegram_pending,
        awaiting_review: counts.manual_review,
        duplicate_skipped: counts.duplicates,
        hydration_backlog: counts.hydration,
        posted_24h: counts.delivered_24h,
        ready_to_publish: counts.ready_to_deliver,
      },
    },
  };
}

// deno-lint-ignore no-explicit-any
async function getXApiSummary(supabase: any, body: Record<string, unknown>) {
  const windowHours = Math.min(Math.max(Number(body.window_hours) || 24, 1), 720);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await supabase
    .from('x_api_events')
    .select('created_at, source, source_action, endpoint, method, http_status, ok, estimated_billable_unit, request_counted, error')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;

  const byUnit: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let attempts = 0;
  let counted = 0;
  let failed = 0;
  for (const event of events ?? []) {
    attempts += 1;
    if (event.request_counted !== false) counted += 1;
    if (!event.ok) failed += 1;
    const unit = event.estimated_billable_unit ?? 'api_request';
    byUnit[unit] = (byUnit[unit] ?? 0) + 1;
    bySource[event.source] = (bySource[event.source] ?? 0) + 1;
  }

  const [{ count: postedCount }, { count: mediaCount }, { data: limitsRow }] = await Promise.all([
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gte('created_at', since),
    supabase.from('x_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'posted').gt('media_count', 0).gte('created_at', since),
    supabase.from('settings').select('value').eq('key', 'x_rate_limits').maybeSingle(),
  ]);

  let officialUsage: Record<string, unknown> = { synced: false, reason: 'not_requested' };
  if (body.sync_official_usage === true) {
    const bearer = Deno.env.get('X_BEARER_TOKEN') || Deno.env.get('TWITTER_BEARER_TOKEN') || '';
    if (!bearer) {
      officialUsage = { synced: false, reason: 'bearer_token_missing' };
      await recordXApiEvent(supabase, {
        source: 'admin-actions',
        sourceAction: 'usage_sync',
        endpoint: '/2/usage/tweets',
        method: 'GET',
        requestCounted: false,
        ok: false,
        error: 'bearer_token_missing',
        estimatedBillableUnit: 'official_usage_lookup',
      });
    } else {
      const endpoint = 'https://api.x.com/2/usage/tweets';
      try {
        const resp = await fetch(endpoint, { headers: { Authorization: `Bearer ${bearer}` } });
        const text = await resp.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        await recordAdminXApiAttempt(supabase, {
          action: 'usage_sync',
          endpoint,
          method: 'GET',
          estimatedBillableUnit: 'official_usage_lookup',
        }, resp);
        officialUsage = resp.ok
          ? { synced: true, data: parsed }
          : { synced: false, reason: `HTTP ${resp.status}`, raw: parsed };
      } catch (e) {
        await recordAdminXApiAttempt(supabase, {
          action: 'usage_sync',
          endpoint,
          method: 'GET',
          estimatedBillableUnit: 'official_usage_lookup',
          error: (e as Error).message,
        }, null);
        officialUsage = { synced: false, reason: (e as Error).message };
      }
    }
  }

  const limits = (limitsRow?.value ?? {}) as Record<string, unknown>;
  return {
    success: true,
    summary: {
      window_hours: windowHours,
      attempts,
      counted_attempts: counted,
      failed_attempts: failed,
      success_rate: attempts > 0 ? Math.round(((attempts - failed) / attempts) * 1000) / 10 : 100,
      by_unit: byUnit,
      by_source: bySource,
      posts_local: postedCount ?? 0,
      media_posts_local: mediaCount ?? 0,
      configured_budget: {
        posts_per_hour: limits.posts_per_hour ?? null,
        posts_per_day: limits.posts_per_day ?? null,
        monthly_post_budget: limits.monthly_post_budget ?? null,
        hydrations_per_day: limits.hydrations_per_day ?? null,
      },
      latest_events: (events ?? []).slice(0, 20),
      official_usage: officialUsage,
    },
  };
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

function isAudienceClass(v: unknown): v is AudienceClass {
  return v === 'direct_focus' || v === 'adjacent' || v === 'global_exception' || v === 'off_topic';
}

// deno-lint-ignore no-explicit-any
async function loadScoringPolicyConfig(supabase: any): Promise<ScoringPolicy> {
  const { data } = await supabase.from('settings').select('value').eq('key', 'scoring_policy').maybeSingle();
  return normalizeScoringPolicy(data?.value ?? null);
}

// deno-lint-ignore no-explicit-any
async function loadScoringModelOptions(supabase: any) {
  const { data } = await supabase.from('settings').select('value').eq('key', 'translation_prompt').maybeSingle();
  const tp = (data?.value ?? {}) as Record<string, unknown>;
  const scoring = tp.scoring && typeof tp.scoring === 'object' ? tp.scoring as Record<string, unknown> : {};
  return {
    model: typeof scoring.model === 'string' && scoring.model.trim() ? scoring.model : 'gpt-5.4-mini',
    maxOutputTokens: typeof scoring.max_completion_tokens === 'number' ? scoring.max_completion_tokens : 4000,
    temperature: typeof scoring.temperature === 'number' ? scoring.temperature : null,
    topP: typeof scoring.top_p === 'number' ? scoring.top_p : null,
    reasoningEffort: typeof scoring.reasoning_effort === 'string' ? scoring.reasoning_effort : 'high',
    verbosity: typeof scoring.verbosity === 'string' ? scoring.verbosity : 'low',
    seed: typeof scoring.seed === 'number' ? scoring.seed : null,
    serviceTier: typeof scoring.service_tier === 'string' ? scoring.service_tier : 'auto',
    parallelToolCalls: typeof scoring.parallel_tool_calls === 'boolean' ? scoring.parallel_tool_calls : true,
  };
}

function scoringPolicyPostUpdate(result: ScoringPolicyResult, active: boolean): Record<string, unknown> {
  const scoringV2Meta = buildScoringPolicyEventMeta(result, active ? 'active' : 'shadow');
  return {
    scoring_version: SCORING_POLICY_VERSION,
    scoring_profile_id: result.profile_id,
    audience_class: result.audience_class,
    audience_confidence: result.audience_confidence,
    audience_reason: result.audience_reason,
    global_exception_class: result.global_exception_class,
    score_review_status: active ? result.review_status : 'shadow',
    score_axes: result.axes,
    importance_score: Math.round(result.final_score),
    importance_tags: result.tags,
    importance_reasoning: result.audience_reason,
    score_breakdown: {
      ai: result.uncapped_score,
      final: result.final_score,
      scoring_v2: {
        ...scoringV2Meta,
      },
    },
    ...(active ? {
      final_score: result.final_score,
      delivery_decision: result.delivery_decision,
      decision_reason: result.decision_reason,
    } : {}),
  };
}

// deno-lint-ignore no-explicit-any
async function scorePostV2(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const policy = await loadScoringPolicyConfig(supabase);
  if (!policy.enabled && !force) return { ok: false, error: 'scoring_policy is disabled; pass force=true for an explicit run' };

  const { data: post, error } = await supabase
    .from('posts')
    .select('tweet_id, text_original, author_handle, url, tweeted_at, accounts!inner(handle, display_name)')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!post?.text_original) return { ok: false, error: `Post not found or empty: ${tweetId}` };

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };
  const model = await loadScoringModelOptions(supabase);
  const account = post.accounts as Record<string, unknown> | null;
  const result = await runScoringPolicy({
    tweet_id: tweetId,
    text: post.text_original,
    author_handle: post.author_handle,
    account_name: account?.display_name as string | undefined,
    url: post.url,
    published_at: post.tweeted_at,
  }, policy, { apiKey: openaiApiKey, ...model }, {
    profileId: typeof body.profile_id === 'string' ? body.profile_id : null,
    forceAdjudication: body.force_adjudication === true,
  });
  if (!result.ok) return { ok: false, error: result.error ?? result.audience_reason, result };

  const active = policy.mode === 'active' || body.apply === true;
  if (!dryRun) {
    const { error: updateError } = await supabase
      .from('posts')
      .update(scoringPolicyPostUpdate(result, active))
      .eq('tweet_id', tweetId);
    if (updateError) return { ok: false, error: updateError.message };
    await insertAdminPipelineEvent(supabase, tweetId, 'score', 'completed', buildScoringPolicyEventMeta(result, active ? 'active' : 'shadow'));
  }

  return { ok: true, dry_run: dryRun, active, result };
}

// deno-lint-ignore no-explicit-any
async function previewScoringPolicy(supabase: any, body: Record<string, unknown>) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, error: 'text is required' };
  if (text.length > 8000) return { ok: false, error: 'text must be <=8000 characters' };
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };
  const policy = await loadScoringPolicyConfig(supabase);
  const model = await loadScoringModelOptions(supabase);
  const result = await runScoringPolicy({
    text,
    author_handle: typeof body.author_handle === 'string' ? body.author_handle : null,
    url: typeof body.url === 'string' ? body.url : null,
    published_at: new Date().toISOString(),
  }, policy, { apiKey: openaiApiKey, ...model }, {
    profileId: typeof body.profile_id === 'string' ? body.profile_id : null,
    forceAdjudication: body.force_adjudication === true,
  });
  return { ok: result.ok, result, error: result.ok ? undefined : result.error };
}

// deno-lint-ignore no-explicit-any
async function promoteFeedbackToScoringExample(supabase: any, body: Record<string, unknown>, userId?: string) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  const expectedClass = body.expected_class ?? body.expected_audience_class;
  const expectedDecision = typeof body.expected_decision === 'string' ? body.expected_decision : '';
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };
  if (!isAudienceClass(expectedClass)) return { ok: false, error: 'expected_class must be direct_focus|adjacent|global_exception|off_topic' };
  if (!['deliver', 'skip', 'review'].includes(expectedDecision)) return { ok: false, error: 'expected_decision must be deliver|skip|review' };
  const policy = await loadScoringPolicyConfig(supabase);
  const profileId = typeof body.profile_id === 'string' ? body.profile_id : policy.active_profile_id;
  const { data: post, error } = await supabase
    .from('posts')
    .select('tweet_id, text_original, author_handle, final_score, global_exception_class')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!post?.text_original) return { ok: false, error: `Post not found or empty: ${tweetId}` };
  const { data, error: insertError } = await supabase.from('scoring_examples').insert({
    tweet_id: tweetId,
    source: typeof body.source === 'string' ? body.source : 'admin_feedback',
    profile_id: profileId,
    text_original: post.text_original,
    author_handle: post.author_handle,
    expected_audience_class: expectedClass,
    expected_decision: expectedDecision,
    expected_score: typeof body.expected_score === 'number' ? body.expected_score : post.final_score,
    expected_global_exception_class: typeof body.expected_global_exception_class === 'string'
      ? body.expected_global_exception_class
      : post.global_exception_class,
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
    created_by: userId ?? null,
  }).select('id').single();
  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true, example_id: data?.id };
}

// deno-lint-ignore no-explicit-any
async function backfillScoreV2(supabase: any, body: Record<string, unknown>) {
  const hours = typeof body.hours === 'number' && body.hours > 0 && body.hours <= 720 ? Math.floor(body.hours) : 48;
  const max = typeof body.max === 'number' && body.max > 0 ? Math.min(Math.floor(body.max), 500) : 100;
  const dryRun = body.dry_run !== false;
  const force = body.force === true;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  let q = supabase
    .from('posts')
    .select('tweet_id, scoring_version')
    .not('text_original', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(max);
  if (!force) q = q.is('scoring_version', null);
  const { data: posts, error } = await q;
  if (error) return { ok: false, error: error.message };
  if (dryRun) return { ok: true, dry_run: true, matched: posts?.length ?? 0, queued: 0, hours, max };

  let queued = 0;
  const stamp = Date.now();
  for (const post of posts ?? []) {
    const tweetId = post.tweet_id as string;
    const { error: jobError } = await supabase.from('jobs').upsert({
      type: 'translate',
      payload: { tweet_id: tweetId, force_rescore: true, scoring_policy_v2: true },
      status: 'pending',
      priority: 9,
      idempotency_key: `score-v2:${tweetId}:${stamp}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (!jobError) queued += 1;
  }
  return { ok: true, dry_run: false, matched: posts?.length ?? 0, queued, hours, max };
}

// deno-lint-ignore no-explicit-any
async function runScoringEval(supabase: any, body: Record<string, unknown>) {
  const policy = await loadScoringPolicyConfig(supabase);
  const profileId = typeof body.profile_id === 'string' ? body.profile_id : policy.active_profile_id;
  const limit = typeof body.limit === 'number' ? Math.min(Math.max(Math.floor(body.limit), 1), 30) : 10;
  let q = supabase
    .from('scoring_examples')
    .select('id, text_original, author_handle, expected_audience_class, expected_decision')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (Array.isArray(body.case_ids) && body.case_ids.length > 0) q = q.in('id', body.case_ids.slice(0, limit));
  const { data: examples, error } = await q;
  if (error) return { ok: false, error: error.message };
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };
  const model = await loadScoringModelOptions(supabase);
  const rows = [];
  let correct = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let ambiguous = 0;
  for (const example of examples ?? []) {
    const result = await runScoringPolicy({
      text: example.text_original as string,
      author_handle: example.author_handle as string | null,
      published_at: new Date().toISOString(),
    }, policy, { apiKey: openaiApiKey, ...model }, { profileId });
    const expectedDecision = example.expected_decision as string;
    const expectedClass = example.expected_audience_class as string;
    const classOk = result.audience_class === expectedClass;
    const decisionOk = expectedDecision === 'review'
      ? result.review_status === 'needs_review'
      : result.delivery_decision === expectedDecision;
    if (classOk && decisionOk) correct += 1;
    if (expectedDecision === 'skip' && result.delivery_decision === 'deliver') falsePositive += 1;
    if (expectedDecision === 'deliver' && result.delivery_decision === 'skip') falseNegative += 1;
    if (result.review_status === 'needs_review') ambiguous += 1;
    rows.push({
      example_id: example.id,
      expected_class: expectedClass,
      expected_decision: expectedDecision,
      audience_class: result.audience_class,
      decision: result.delivery_decision,
      score: result.final_score,
      threshold: result.threshold,
      ok: classOk && decisionOk,
    });
  }
  const count = rows.length;
  const summary = {
    profile_id: profileId,
    accuracy: count > 0 ? Math.round((correct / count) * 1000) / 10 : null,
    correct,
    false_positive_count: falsePositive,
    false_negative_count: falseNegative,
    ambiguous_count: ambiguous,
  };
  const { data: inserted, error: insertError } = await supabase.from('scoring_evaluations').insert({
    profile_id: profileId,
    scoring_version: SCORING_POLICY_VERSION,
    model: model.model,
    example_count: count,
    accuracy: summary.accuracy,
    false_positive_count: falsePositive,
    false_negative_count: falseNegative,
    ambiguous_count: ambiguous,
    summary,
    results: rows,
  }).select('id').single();
  if (insertError) return { ok: false, error: insertError.message, summary, results: rows };
  return { ok: true, evaluation_id: inserted?.id, summary, results: rows };
}

// deno-lint-ignore no-explicit-any
async function loadDuplicateGateConfig(supabase: any) {
  const { data } = await supabase.from('settings').select('value').eq('key', 'story_memory').maybeSingle();
  return normalizeDuplicateGateConfig(data?.value ?? DEFAULT_DUPLICATE_GATE);
}

// deno-lint-ignore no-explicit-any
async function markDedupePending(supabase: any, tweetId: string, reason: string) {
  await supabase
    .from('posts')
    .update({
      dedupe_status: 'pending',
      dedupe_method: null,
      dedupe_confidence: null,
      dedupe_reason: reason,
      dedupe_checked_at: null,
    })
    .eq('tweet_id', tweetId)
    .then(() => null, () => null);
}

// deno-lint-ignore no-explicit-any
async function runDedupeAdminAction(supabase: any, body: Record<string, unknown>) {
  const tweetId = typeof body.tweet_id === 'string' ? body.tweet_id.trim() : '';
  if (!tweetId) return { ok: false, error: 'tweet_id is required' };
  const { data: post, error } = await supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, author_handle, url, created_at, delivery_decision, decision_reason, feedback_locked')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!post) return { ok: false, error: 'post not found' };

  const config = await loadDuplicateGateConfig(supabase);
  const dryRun = body.dry_run === true;
  if (!dryRun) await markDedupePending(supabase, tweetId, 'running:admin');
  const result = await runDuplicateGate(supabase, post, config, {
    dryRun,
    force: body.force === true,
    source: 'admin_actions.run_dedupe',
  });

  if (!dryRun && body.enqueue_next === true && result.should_enqueue_translate) {
    await supabase.from('jobs').upsert({
      type: 'translate',
      payload: { tweet_id: tweetId },
      status: 'pending',
      priority: 10,
      idempotency_key: `translate:dedupe-admin:${tweetId}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  }

  return { ok: result.ok, tweet_id: tweetId, config_enabled: config.enabled, result };
}

// deno-lint-ignore no-explicit-any
async function backfillDedupeAdminAction(supabase: any, body: Record<string, unknown>) {
  const hours = typeof body.hours === 'number' && body.hours > 0 && body.hours <= 168 ? Math.floor(body.hours) : 48;
  const max = typeof body.max === 'number' && body.max > 0 ? Math.min(Math.floor(body.max), 2000) : 500;
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('posts')
    .select('tweet_id, dedupe_checked_at')
    .not('text_original', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(max);
  if (!force) query = query.is('dedupe_checked_at', null);

  const { data: posts, error } = await query;
  if (error) return { ok: false, error: error.message };

  let queued = 0;
  const stamp = Date.now();
  for (const post of posts ?? []) {
    const tweetId = post.tweet_id as string;
    if (dryRun) {
      queued += 1;
      continue;
    }
    const { error: jobError } = await supabase.from('jobs').upsert({
      type: 'dedupe',
      payload: { tweet_id: tweetId, force, source: 'backfill' },
      status: 'pending',
      priority: 30,
      idempotency_key: force ? `dedupe:backfill:${tweetId}:${stamp}` : `dedupe:backfill:${tweetId}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (!jobError) {
      await markDedupePending(supabase, tweetId, 'queued:backfill');
      queued += 1;
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    force,
    hours,
    max,
    scanned: posts?.length ?? 0,
    queued,
  };
}

// deno-lint-ignore no-explicit-any
async function auditDuplicateCandidatesAdminAction(supabase: any, body: Record<string, unknown>) {
  const windowHours = typeof body.window_hours === 'number' && body.window_hours > 0 && body.window_hours <= 168
    ? Math.floor(body.window_hours)
    : 48;
  const candidateMinSimilarity = typeof body.candidate_min_similarity === 'number'
    ? Math.min(Math.max(body.candidate_min_similarity, 0.5), 0.99)
    : 0.78;
  const limit = typeof body.limit === 'number' && body.limit > 0
    ? Math.min(Math.floor(body.limit), 5000)
    : 500;

  const { data, error } = await supabase.rpc('audit_duplicate_candidates', {
    window_hours: windowHours,
    candidate_min_similarity: candidateMinSimilarity,
    match_limit: limit,
  });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const proposed = rows.reduce<Record<string, number>>((acc, row) => {
    const key = typeof row.proposed_status === 'string' ? row.proposed_status : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    dry_run: true,
    window_hours: windowHours,
    candidate_min_similarity: candidateMinSimilarity,
    count: rows.length,
    proposed,
    rows,
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

function validateSettingsValue(key: string, value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `Value for "${key}" must be a JSON object`;
  }
  const v = value as Record<string, unknown>;

  switch (key) {
    case 'translation_prompt': {
      const stringFields: Array<[string, number]> = [
        ['system_prompt', 20000],
        ['user_prompt_template', 10000],
        ['model', 100],
        ['scoring_system_prompt', 20000],
        ['classifier_tool_schema', 20000],
      ];
      for (const [field, max] of stringFields) {
        if (v[field] !== undefined && typeof v[field] !== 'string') {
          return `translation_prompt.${field} must be a string`;
        }
        if (typeof v[field] === 'string' && (v[field] as string).length > max) {
          return `translation_prompt.${field} must be ≤${max} characters`;
        }
      }
      const numFields = ['temperature', 'max_completion_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'];
      for (const f of numFields) {
        if (v[f] !== undefined && v[f] !== null && typeof v[f] !== 'number') {
          return `translation_prompt.${f} must be a number`;
        }
      }
      if (v.reasoning_effort !== undefined && !['minimal', 'low', 'medium', 'high'].includes(v.reasoning_effort as string)) {
        return 'translation_prompt.reasoning_effort must be one of minimal|low|medium|high';
      }
      if (v.verbosity !== undefined && !['low', 'medium', 'high'].includes(v.verbosity as string)) {
        return 'translation_prompt.verbosity must be one of low|medium|high';
      }
      if (v.service_tier !== undefined && !['auto', 'default', 'flex', 'priority'].includes(v.service_tier as string)) {
        return 'translation_prompt.service_tier must be one of auto|default|flex|priority';
      }
      if (v.parallel_tool_calls !== undefined && typeof v.parallel_tool_calls !== 'boolean') {
        return 'translation_prompt.parallel_tool_calls must be a boolean';
      }
      if (v.split_calls !== undefined && typeof v.split_calls !== 'boolean') {
        return 'translation_prompt.split_calls must be a boolean';
      }
      if (v.scoring !== undefined) {
        if (typeof v.scoring !== 'object' || v.scoring === null || Array.isArray(v.scoring)) {
          return 'translation_prompt.scoring must be an object';
        }
        const sv = v.scoring as Record<string, unknown>;
        if (sv.model !== undefined && typeof sv.model !== 'string') return 'scoring.model must be a string';
        const snum = ['temperature', 'max_completion_tokens', 'top_p', 'seed'];
        for (const f of snum) {
          if (sv[f] !== undefined && sv[f] !== null && typeof sv[f] !== 'number') {
            return `scoring.${f} must be a number`;
          }
        }
        if (sv.reasoning_effort !== undefined && !['minimal', 'low', 'medium', 'high'].includes(sv.reasoning_effort as string)) {
          return 'scoring.reasoning_effort must be one of minimal|low|medium|high';
        }
        if (sv.verbosity !== undefined && !['low', 'medium', 'high'].includes(sv.verbosity as string)) {
          return 'scoring.verbosity must be one of low|medium|high';
        }
        if (sv.service_tier !== undefined && !['auto', 'default', 'flex', 'priority'].includes(sv.service_tier as string)) {
          return 'scoring.service_tier must be one of auto|default|flex|priority';
        }
        if (sv.parallel_tool_calls !== undefined && typeof sv.parallel_tool_calls !== 'boolean') {
          return 'scoring.parallel_tool_calls must be a boolean';
        }
      }
      break;
    }
    case 'telegram_config': {
      if (v.parse_mode !== undefined && !['Markdown', 'MarkdownV2', 'HTML', ''].includes(v.parse_mode as string)) {
        return 'telegram_config.parse_mode must be Markdown, MarkdownV2, HTML, or empty';
      }
      break;
    }
    case 'message_template': {
      if (v.template !== undefined && typeof v.template !== 'string') {
        return 'message_template.template must be a string';
      }
      if (v.template && (v.template as string).length > 2000) {
        return 'message_template.template must be ≤2000 characters';
      }
      if (v.include_source_link !== undefined && typeof v.include_source_link !== 'boolean') {
        return 'message_template.include_source_link must be a boolean';
      }
      if (v.source_link_text !== undefined && typeof v.source_link_text !== 'string') {
        return 'message_template.source_link_text must be a string';
      }
      if (v.custom_hashtags !== undefined && typeof v.custom_hashtags !== 'string') {
        return 'message_template.custom_hashtags must be a string';
      }
      break;
    }
      case 'twitter_hydration': {
        if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'twitter_hydration.enabled must be a boolean';
        if (v.max_attempts !== undefined && (typeof v.max_attempts !== 'number' || v.max_attempts < 1 || v.max_attempts > 10)) return 'twitter_hydration.max_attempts must be 1-10';
        break;
      }
      case 'x_posting_config': {
        const bools = ['enabled', 'require_media', 'post_only_decision_deliver'];
        for (const f of bools) if (v[f] !== undefined && typeof v[f] !== 'boolean') return `x_posting_config.${f} must be a boolean`;
        if (v.min_score !== undefined && (typeof v.min_score !== 'number' || v.min_score < 1 || v.min_score > 20)) return 'x_posting_config.min_score must be 1-20';
        if (v.max_chars !== undefined && (typeof v.max_chars !== 'number' || v.max_chars < 50 || v.max_chars > 4000)) return 'x_posting_config.max_chars must be 50-4000';
        if (v.dedupe_window_hours !== undefined && (typeof v.dedupe_window_hours !== 'number' || v.dedupe_window_hours < 1 || v.dedupe_window_hours > 720)) return 'x_posting_config.dedupe_window_hours must be 1-720';
        const strs: Array<[string, number]> = [['post_template', 1000], ['leading_emoji', 32], ['hashtags', 500]];
        for (const [f, max] of strs) {
          if (v[f] !== undefined && typeof v[f] !== 'string') return `x_posting_config.${f} must be a string`;
          if (typeof v[f] === 'string' && (v[f] as string).length > max) return `x_posting_config.${f} must be ≤${max} characters`;
        }
        if (v.hashtag_pool !== undefined) {
          if (!Array.isArray(v.hashtag_pool)) return 'x_posting_config.hashtag_pool must be an array of strings';
          if ((v.hashtag_pool as unknown[]).length > 100) return 'x_posting_config.hashtag_pool must be ≤100 entries';
          for (const t of v.hashtag_pool as unknown[]) {
            if (typeof t !== 'string' || t.length > 64) return 'x_posting_config.hashtag_pool entries must be strings ≤64 chars';
          }
        }
        if (v.hashtags_per_post !== undefined && (typeof v.hashtags_per_post !== 'number' || ![0, 1, 2].includes(v.hashtags_per_post))) {
          return 'x_posting_config.hashtags_per_post must be 0, 1, or 2';
        }
        break;
      }
      case 'x_rate_limits': {
        const nums: Array<[string, number, number]> = [
          ['posts_per_hour', 1, 1000],
          ['posts_per_day', 1, 10000],
          ['monthly_post_budget', 1, 1000000],
          ['media_uploads_per_day', 1, 10000],
        ];
        for (const [f, min, max] of nums) {
          if (v[f] !== undefined && (typeof v[f] !== 'number' || (v[f] as number) < min || (v[f] as number) > max)) {
            return `x_rate_limits.${f} must be ${min}-${max}`;
          }
        }
        break;
      }
      case 'editorial_profiles': {
        if (!Array.isArray(v.profiles)) return 'editorial_profiles.profiles must be an array';
        if ((v.profiles as unknown[]).length > 50) return 'editorial_profiles.profiles must be ≤50';
        const AXES = ['iran_relevance','severity','novelty','credibility','actionability','noise'];
        for (const p of v.profiles as unknown[]) {
          if (!p || typeof p !== 'object') return 'each profile must be an object';
          const pp = p as Record<string, unknown>;
          if (typeof pp.id !== 'string' || !pp.id) return 'profile.id required';
          if (typeof pp.name !== 'string' || !pp.name || (pp.name as string).length > 80) return 'profile.name required (≤80)';
          if (typeof pp.threshold !== 'number' || (pp.threshold as number) < 0 || (pp.threshold as number) > 20) return 'profile.threshold must be 0-20';
          if (!pp.weights || typeof pp.weights !== 'object') return 'profile.weights required';
          for (const ax of AXES) {
            const w = (pp.weights as Record<string, unknown>)[ax];
            if (w !== undefined && (typeof w !== 'number' || w < 0 || w > 5)) return `profile.weights.${ax} must be 0-5`;
          }
          for (const arrKey of ['must_include_keywords','must_exclude_keywords','required_tags_any','blocked_tags']) {
            const a = pp[arrKey];
            if (a !== undefined && (!Array.isArray(a) || (a as unknown[]).some((x) => typeof x !== 'string' || (x as string).length > 80))) {
              return `profile.${arrKey} must be array of strings ≤80`;
            }
          }
          if (pp.author_overrides !== undefined) {
            if (typeof pp.author_overrides !== 'object' || pp.author_overrides === null) return 'profile.author_overrides must be object';
            for (const [, val] of Object.entries(pp.author_overrides as Record<string, unknown>)) {
              if (val !== 'always_deliver' && val !== 'always_skip') return 'author_overrides values must be always_deliver|always_skip';
            }
          }
          if (pp.editorial_note !== undefined && (typeof pp.editorial_note !== 'string' || (pp.editorial_note as string).length > 4000)) return 'profile.editorial_note must be string ≤4000';
        }
        break;
      }
      case 'active_profile_id': {
        if (v.id !== null && typeof v.id !== 'string') return 'active_profile_id.id must be string or null';
        if (typeof v.id === 'string' && (v.id as string).length > 80) return 'active_profile_id.id too long';
        break;
      }
      case 'story_memory': {
        if (typeof v.enabled !== 'boolean') return 'story_memory.enabled must be boolean';
        if (typeof v.window_hours !== 'number' || v.window_hours < 1 || v.window_hours > 168) return 'story_memory.window_hours must be 1-168';
        if (typeof v.similarity_threshold !== 'number' || v.similarity_threshold < 0.5 || v.similarity_threshold > 0.99) return 'story_memory.similarity_threshold must be 0.5-0.99';
        if (v.candidate_min_similarity !== undefined && (typeof v.candidate_min_similarity !== 'number' || v.candidate_min_similarity < 0.5 || v.candidate_min_similarity > 0.99)) return 'story_memory.candidate_min_similarity must be 0.5-0.99';
        if (v.auto_duplicate_similarity !== undefined && (typeof v.auto_duplicate_similarity !== 'number' || v.auto_duplicate_similarity < 0.5 || v.auto_duplicate_similarity > 0.99)) return 'story_memory.auto_duplicate_similarity must be 0.5-0.99';
        if (v.action !== 'skip' && v.action !== 'mark_and_deliver') return 'story_memory.action must be skip|mark_and_deliver';
        if (v.mode !== undefined && v.mode !== 'hybrid_ai' && v.mode !== 'semantic_only' && v.mode !== 'review_first') return 'story_memory.mode must be hybrid_ai|semantic_only|review_first';
        if (v.adjudicator_model !== undefined && (typeof v.adjudicator_model !== 'string' || v.adjudicator_model.length < 1 || v.adjudicator_model.length > 100)) return 'story_memory.adjudicator_model must be a string ≤100';
        if (v.adjudicator_reasoning_effort !== undefined && (typeof v.adjudicator_reasoning_effort !== 'string' || !['low', 'medium', 'high', 'xhigh'].includes(v.adjudicator_reasoning_effort as string))) return 'story_memory.adjudicator_reasoning_effort must be low|medium|high|xhigh';
        if (v.adjudicator_confidence_threshold !== undefined && (typeof v.adjudicator_confidence_threshold !== 'number' || v.adjudicator_confidence_threshold < 0.5 || v.adjudicator_confidence_threshold > 0.95)) return 'story_memory.adjudicator_confidence_threshold must be 0.5-0.95';
        if (!Array.isArray(v.bypass_authors)) return 'story_memory.bypass_authors must be array';
        if ((v.bypass_authors as unknown[]).length > 100) return 'story_memory.bypass_authors must be ≤100';
        break;
      }
      case 'scoring_policy': {
        if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'scoring_policy.enabled must be boolean';
        if (v.mode !== undefined && v.mode !== 'shadow' && v.mode !== 'active') return 'scoring_policy.mode must be shadow|active';
        if (!Array.isArray(v.profiles) || (v.profiles as unknown[]).length === 0) return 'scoring_policy.profiles must be a non-empty array';
        if ((v.profiles as unknown[]).length > 50) return 'scoring_policy.profiles must be <=50';
        for (const profile of v.profiles as unknown[]) {
          if (!profile || typeof profile !== 'object') return 'each scoring profile must be an object';
          const p = profile as Record<string, unknown>;
          if (typeof p.id !== 'string' || !p.id || p.id.length > 80) return 'scoring profile id required (<=80)';
          if (typeof p.name !== 'string' || !p.name || p.name.length > 120) return 'scoring profile name required (<=120)';
          for (const arrKey of ['focus_entities', 'aliases', 'geographies', 'blocked_categories']) {
            if (!Array.isArray(p[arrKey])) return `scoring profile ${arrKey} must be an array`;
            if ((p[arrKey] as unknown[]).some((x) => typeof x !== 'string' || x.length > 120)) return `scoring profile ${arrKey} entries must be strings <=120`;
          }
          if (typeof p.thresholds !== 'object' || p.thresholds === null) return 'scoring profile thresholds required';
          const thresholds = p.thresholds as Record<string, unknown>;
          for (const cls of ['direct_focus', 'adjacent', 'global_exception', 'off_topic']) {
            const rule = thresholds[cls] as Record<string, unknown> | undefined;
            if (!rule || typeof rule !== 'object') return `thresholds.${cls} required`;
            if (typeof rule.threshold !== 'number' || rule.threshold < 1 || rule.threshold > 99) return `thresholds.${cls}.threshold must be 1-99`;
            if (typeof rule.cap !== 'number' || rule.cap < 1 || rule.cap > 20) return `thresholds.${cls}.cap must be 1-20`;
          }
          if (typeof p.axis_weights !== 'object' || p.axis_weights === null) return 'scoring profile axis_weights required';
        }
        try { normalizeScoringPolicy(v); } catch (e) { return `invalid scoring_policy: ${(e as Error).message}`; }
        break;
      }
      case 'x_api_controls': {
        if (v.my_x_enabled !== undefined && typeof v.my_x_enabled !== 'boolean') {
          return 'x_api_controls.my_x_enabled must be a boolean';
        }
        const nums = [
          ['verify_cache_minutes', 1, 1440],
          ['follower_snapshot_stale_minutes', 1, 1440],
          ['usage_sync_interval_hours', 1, 168],
          ['backfill_max_hydrate_jobs_per_run', 1, 500],
        ] as const;
        for (const [field, min, max] of nums) {
          if (v[field] !== undefined && (typeof v[field] !== 'number' || v[field] < min || v[field] > max)) {
            return `x_api_controls.${field} must be ${min}-${max}`;
          }
        }
        if (v.warning_thresholds !== undefined) {
          if (!Array.isArray(v.warning_thresholds)) return 'x_api_controls.warning_thresholds must be an array';
          for (const item of v.warning_thresholds) {
            if (typeof item !== 'number' || item < 1 || item > 100) return 'x_api_controls.warning_thresholds entries must be 1-100';
          }
        }
        break;
      }
      case 'enrichment_config': {
        if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'enrichment_config.enabled must be a boolean';
        if (v.mode !== undefined && v.mode !== 'creator_analysis' && v.mode !== 'legacy') return 'enrichment_config.mode must be creator_analysis|legacy';
        if (v.pipeline_mode !== undefined && v.pipeline_mode !== 'manual_only' && v.pipeline_mode !== 'shadow_review' && v.pipeline_mode !== 'required_for_x') {
          return 'enrichment_config.pipeline_mode must be manual_only|shadow_review|required_for_x';
        }
        if (v.review_mode !== undefined && v.review_mode !== 'shadow_review' && v.review_mode !== 'auto_high_confidence' && v.review_mode !== 'manual_only') {
          return 'enrichment_config.review_mode must be shadow_review|auto_high_confidence|manual_only';
        }
        if (v.require_approval !== undefined && typeof v.require_approval !== 'boolean') return 'enrichment_config.require_approval must be a boolean';
        if (v.model !== undefined && (typeof v.model !== 'string' || v.model.length > 100)) return 'enrichment_config.model must be a string <=100';
        break;
      }
    }
    return null;
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
        const { key, value } = body;
        if (!key || value === undefined) {
          return jsonResponse({ error: 'key and value are required' }, 400);
        }
        // Only allow non-secret settings keys
        const allowedKeys = ['translation_prompt', 'telegram_config', 'message_template', 'content_filter', 'twitter_hydration', 'x_posting_config', 'x_rate_limits', 'x_api_controls', 'enrichment_config', 'editorial_profiles', 'active_profile_id', 'story_memory', 'scoring_policy'];
        if (!allowedKeys.includes(key)) {
          return jsonResponse({ error: `Setting key "${key}" is not allowed` }, 400);
        }

        // Validate value shape per key
        const validationError = validateSettingsValue(key, value);
        if (validationError) {
          return jsonResponse({ error: validationError }, 400);
        }

        // Auto-stamp `start_posting_from` to "now" on any change that could
        // make previously-ingested posts newly eligible (forward-only guarantee):
        //  - disabled → enabled
        //  - min_score lowered
        //  - require_media turned off
        //  - post_only_decision_deliver turned off
        // The user can still override by explicitly passing start_posting_from in the payload.
        let valueToSave = value;
        if (key === 'x_posting_config' && value && typeof value === 'object') {
          const { data: prev } = await supabase.from('settings').select('value').eq('key', 'x_posting_config').maybeSingle();
          const prevCfg = (prev?.value ?? {}) as Record<string, unknown>;
          const nextCfg = value as Record<string, unknown>;
          const prevStart = typeof prevCfg.start_posting_from === 'string' ? prevCfg.start_posting_from : null;
          const nextStart = typeof nextCfg.start_posting_from === 'string' ? nextCfg.start_posting_from : null;
          const userProvidedStart = !!nextStart && nextStart !== prevStart;

          const prevEnabled = !!prevCfg.enabled;
          const nextEnabled = !!nextCfg.enabled;
          const enableTransition = nextEnabled && !prevEnabled;

          const prevMin = typeof prevCfg.min_score === 'number' ? prevCfg.min_score as number : 14;
          const nextMin = typeof nextCfg.min_score === 'number' ? nextCfg.min_score as number : prevMin;
          const thresholdLowered = nextEnabled && nextMin < prevMin;

          const mediaLoosened = nextEnabled && prevCfg.require_media === true && nextCfg.require_media === false;
          const decisionGateLoosened = nextEnabled && prevCfg.post_only_decision_deliver === true && nextCfg.post_only_decision_deliver === false;

          if (!userProvidedStart && (enableTransition || thresholdLowered || mediaLoosened || decisionGateLoosened)) {
            valueToSave = { ...nextCfg, start_posting_from: new Date().toISOString() };
            console.log('[admin-actions] re-stamped x_posting_config.start_posting_from', {
              enableTransition, thresholdLowered, mediaLoosened, decisionGateLoosened, prevMin, nextMin, prevStart, nextStart,
            });
          }
        }

        const { error } = await supabase
          .from('settings')
          .upsert({ key, value: valueToSave, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error) throw error;
        return jsonResponse({ success: true, message: `Settings "${key}" saved` });
      }

      // ===== Edit translation =====
      case 'edit_translation': {
        const { tweet_id, text_translated } = body;
        if (!tweet_id || text_translated === undefined) {
          return jsonResponse({ error: 'tweet_id and text_translated are required' }, 400);
        }
        const { error } = await supabase
          .from('posts')
          .update({ text_translated })
          .eq('tweet_id', tweet_id);
        if (error) throw error;
        await recordFeedback(supabase, tweet_id, 'edit_translation', 0).catch(() => {});
        return jsonResponse({ success: true, message: 'Translation updated' });
      }

      // ===== Retry step (translate/deliver/media) =====
      case 'retry_step': {
        const { tweet_id, step } = body;
        if (!tweet_id || !step) {
          return jsonResponse({ error: 'tweet_id and step are required' }, 400);
        }
        const { data: result, error } = await supabase.rpc('retry_step', { tweet_id, step });
        if (error) throw error;
        if (step === 'deliver') {
          await recordFeedback(supabase, tweet_id, 'force_deliver', 2).catch(() => {});
          await supabase.from('posts').update({ feedback_locked: true }).eq('tweet_id', tweet_id);
        }
        return jsonResponse({ success: true, message: `${step} retry queued` });
      }

      // ===== Reprocess (full re-run) =====
      case 'reprocess': {
        const { tweet_id } = body;
        if (!tweet_id) {
          return jsonResponse({ error: 'tweet_id is required' }, 400);
        }
        const idempotencyKey = `reprocess:${tweet_id}`;
        const { error } = await supabase
          .from('jobs')
          .upsert({
            type: 'reprocess',
            payload: { tweet_id },
            status: 'pending',
            idempotency_key: idempotencyKey,
            next_run_at: new Date().toISOString()
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        if (error) throw error;
        await recordFeedback(supabase, tweet_id, 'reprocess', 0).catch(() => {});
        return jsonResponse({ success: true, message: 'Reprocess job queued' });
      }

      // ===== Cancel pending/running jobs =====
      case 'cancel_pending_jobs': {
        const { types, include_running } = body as { types?: string[]; include_running?: boolean };
        const statuses = include_running === false ? ['pending'] : ['pending', 'running'];
        let query = supabase
          .from('jobs')
          .update({
            status: 'failed',
            last_error: 'Manually canceled by admin',
            completed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
            lease_expires_at: null,
          })
          .in('status', statuses);
        if (Array.isArray(types) && types.length > 0) {
          query = query.in('type', types);
        }
        const { data, error } = await query.select('id, type');
        if (error) throw error;
        const canceled = data?.length ?? 0;
        const byType: Record<string, number> = {};
        (data || []).forEach((r: { type: string }) => { byType[r.type] = (byType[r.type] || 0) + 1; });
        return jsonResponse({ success: true, canceled, by_type: byType, message: `Canceled ${canceled} job(s)` });
      }

      // ===== Bulk reprocess =====
      case 'bulk_reprocess': {
        const { tweet_ids } = body;
        if (!tweet_ids || !Array.isArray(tweet_ids) || tweet_ids.length === 0) {
          return jsonResponse({ error: 'tweet_ids array is required' }, 400);
        }
        const jobs = tweet_ids.map((tid: string) => ({
          type: 'reprocess',
          payload: { tweet_id: tid },
          status: 'pending',
          idempotency_key: `reprocess:${tid}`,
          next_run_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('jobs').upsert(jobs, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        if (error) throw error;
        return jsonResponse({ success: true, message: `${tweet_ids.length} reprocess jobs queued` });
      }

      // ===== Post thread =====
      case 'post_thread': {
        const { thread_id } = body;
        if (!thread_id) {
          return jsonResponse({ error: 'thread_id is required' }, 400);
        }
        const { error } = await supabase
          .from('deliveries')
          .insert({ subject_type: 'thread', subject_id: thread_id, status: 'pending' });
        if (error) throw error;
        return jsonResponse({ success: true, message: 'Thread queued for delivery' });
      }

      // ===== System health =====
      case 'get_health': {
        const { data, error } = await supabase.rpc('get_system_health');
        if (error) throw error;
        return jsonResponse({ success: true, health: data });
      }

      case 'reconcile_stuck_jobs': {
        const { data, error } = await supabase.rpc('reconcile_stuck_jobs');
        if (error) throw error;
        await supabase.from('pipeline_events').insert({
          subject_type: 'system',
          subject_id: 'queue',
          step: 'reconcile',
          status: 'completed',
          meta: { source: 'admin_dashboard', result: data },
          ended_at: new Date().toISOString(),
        });
        return jsonResponse({ success: true, result: data });
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
        return jsonResponse(await getXApiSummary(supabase, body));
      }

      case 'get_x_posting_diagnostics': {
        return jsonResponse(await getXPostingDiagnostics(supabase, body));
      }

      case 'score_post_v2': {
        return jsonResponse(await scorePostV2(supabase, body));
      }

      case 'preview_scoring_policy': {
        return jsonResponse(await previewScoringPolicy(supabase, body));
      }

      case 'run_scoring_eval': {
        return jsonResponse(await runScoringEval(supabase, body));
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
        const result = await backfillDedupeAdminAction(supabase, body);
        return jsonResponse({ ...result, alias: 'backfill_dedupe' });
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
          const v2 = await scorePostV2(supabase, { ...body, tweet_id: tweetId, force: true });
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
        return jsonResponse(await setManualScore(supabase, body));
      }

      case 'record_score_feedback': {
        return jsonResponse(await recordScoreFeedback(supabase, body));
      }

      case 'ignore_monitoring_item': {
        return jsonResponse(await ignoreMonitoringItem(supabase, body));
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
