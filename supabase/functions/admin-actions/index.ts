import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { callOpenAI, type ToolFunctionDef } from "../_shared/openai.ts";
import {
  applyProfileDecision,
  computeFinalScore,
  parseScoreAxes,
  type EditorialProfile,
} from "../_shared/scoring.ts";
import { recordXApiEvent } from "../_shared/xApiLedger.ts";
import {
  doesEnrichmentBlockX,
  normalizeEnrichmentConfig,
  type EnrichmentConfig,
} from "../_shared/enrich.ts";
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
import { saveSettingsAdminAction } from "./settings.ts";
import {
  approveEnrichmentAdminAction,
  enrichPostAdminAction,
  generateVoiceProfileAdminAction,
  recordEnrichmentFeedbackAdminAction,
  rejectEnrichmentAdminAction,
  selectEnrichmentVariantAdminAction,
  updateLatestPostEnrichment,
} from "./enrichmentActions.ts";
import {
  dryRunOldMediaCleanupAdminAction,
  getPostPipelineStatusAdminAction,
  rescoreRecentAdminAction,
  resetLearnedBiasesAdminAction,
  runFollowersSnapshotAdminAction,
  summarizeStaleXPendingAdminAction,
} from "./maintenanceActions.ts";
import {
  getXStatusAdminAction,
  recordAdminXApiAttempt,
  sendTestTweetAdminAction,
  testHydrateTweetAdminAction,
  verifyXCredentialsAdminAction,
} from "./xApiActions.ts";
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
import {
  getXPostingDiagnostics,
  hydratePostAdminAction,
  queueHydrationJob,
  rehydrateRecentTruncatedAdminAction,
  resolveXMediaAdminAction,
  runXPostAdminAction,
} from "./xPostingActions.ts";

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
async function queueManualAdvance(supabase: any, tweetId: string): Promise<{ queued: string; reason?: string }> {
  const { data: post } = await supabase
    .from('posts')
    .select('tweet_id, text_translated, translated_at, is_truncated, hydrated_at, enrich_status')
    .eq('tweet_id', tweetId)
    .maybeSingle();
  if (!post) return { queued: 'none', reason: 'post_not_found' };
  if (!post.text_translated && !post.translated_at) return { queued: 'none', reason: 'translation_missing' };
  if (post.is_truncated === true && !post.hydrated_at) {
    const result = await queueHydrationJob(supabase, tweetId, 'manual_score', { insertAdminPipelineEvent });
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
        const result = await dryRunOldMediaCleanupAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
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
        const result = await summarizeStaleXPendingAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'hydrate_post': {
        const result = await hydratePostAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      case 'get_post_pipeline_status': {
        const result = await getPostPipelineStatusAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      case 'resolve_x_media': {
        const result = await resolveXMediaAdminAction(body);
        return jsonResponse(result.body, result.status);
      }

      // ===== X Posting: dry run / retry =====
      case 'dry_run_x_post':
      case 'retry_x_post': {
        const result = await runXPostAdminAction(supabase, body, action, {
          runRescore,
          recordFeedback,
          insertAdminPipelineEvent,
        });
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: credential status =====
      case 'get_x_status': {
        return jsonResponse(getXStatusAdminAction());
      }

      // ===== X API: verify credentials =====
      case 'x_verify_credentials': {
        const result = await verifyXCredentialsAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: send test tweet =====
      case 'send_test_tweet': {
        const result = await sendTestTweetAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== X API: test hydration (no DB write) =====
      case 'test_hydrate_tweet': {
        const result = await testHydrateTweetAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Backfill: re-hydrate recent truncated tweets matching new heuristics =====
      case 'rehydrate_recent_truncated': {
        const result = await rehydrateRecentTruncatedAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Backward-compatible alias for old Story Memory backfill =====
      case 'backfill_signatures': {
        return jsonResponse(await backfillSignaturesAdminAction(supabase, body));
      }

      // ===== Re-score recent posts that are missing score_axes =====
      case 'rescore_recent': {
        const result = await rescoreRecentAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
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
        const result = await runFollowersSnapshotAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
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
        const result = await resetLearnedBiasesAdminAction(supabase);
        return jsonResponse(result.body, result.status);
      }

      // ===== Approve enrichment and queue delivery =====
      case 'approve_enrichment': {
        const result = await approveEnrichmentAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Reject enrichment (plain X posting can still proceed unless enrichment is explicitly required) =====
      case 'reject_enrichment': {
        const result = await rejectEnrichmentAdminAction(supabase, body);
        return jsonResponse(result.body, result.status);
      }

      // ===== Record enrichment feedback without posting =====
      case 'record_enrichment_feedback': {
        const result = await recordEnrichmentFeedbackAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Generate and persist @masihh voice profile from the canonical guide =====
      case 'generate_voice_profile': {
        const result = await generateVoiceProfileAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Select one manual enrichment variant for the X preview, without posting =====
      case 'select_enrichment_variant': {
        const result = await selectEnrichmentVariantAdminAction(supabase, body, { insertAdminPipelineEvent });
        return jsonResponse(result.body, result.status);
      }

      // ===== Manually trigger enrichment on a post (never auto-posts) =====
      case 'enrich_post': {
        const result = await enrichPostAdminAction(supabase, body, {
          insertAdminPipelineEvent,
          runTranslationOnly,
        });
        return jsonResponse(result.body, result.status);
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
