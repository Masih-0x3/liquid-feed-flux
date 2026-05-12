import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { callOpenAI, type ToolFunctionDef } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============= Multi-axis scoring (PR1) =============
// 6 axes, each 0-10. `noise` is inverted (higher = worse).
// Until editorial profiles land in PR2, we use uniform default weights.
export const SCORE_AXIS_KEYS = [
  'iran_relevance',
  'severity',
  'novelty',
  'credibility',
  'actionability',
  'noise',
] as const;
export type ScoreAxisKey = typeof SCORE_AXIS_KEYS[number];
export type ScoreAxes = Partial<Record<ScoreAxisKey, number>>;

const DEFAULT_AXIS_WEIGHTS: Record<ScoreAxisKey, number> = {
  iran_relevance: 1.0,
  severity: 1.0,
  novelty: 1.0,
  credibility: 0.5,
  actionability: 1.0,
  noise: 1.0, // subtractive
};

/** Parse and clamp axes from arbitrary tool-call output. Returns null if no usable axes. */
export function parseScoreAxes(raw: unknown): ScoreAxes | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: ScoreAxes = {};
  let hasAny = false;
  for (const k of SCORE_AXIS_KEYS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(10, Math.round(v)));
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

/**
 * Compute final_score (0-20) from axes using a weights map.
 * Formula: positive_sum = Σ(axis * weight) for non-noise axes; subtract noise * weight.
 * Then normalize to 0-20 against the maximum possible positive sum.
 */
export function computeFinalScore(
  axes: ScoreAxes,
  weights: Record<ScoreAxisKey, number> = DEFAULT_AXIS_WEIGHTS,
): number {
  let posSum = 0;
  let posMax = 0;
  for (const k of SCORE_AXIS_KEYS) {
    if (k === 'noise') continue;
    const w = Math.max(0, weights[k] ?? 0);
    posSum += (axes[k] ?? 0) * w;
    posMax += 10 * w;
  }
  const noiseW = Math.max(0, weights.noise ?? 0);
  const noisePenalty = (axes.noise ?? 0) * noiseW;
  const noiseMax = 10 * noiseW;

  // Normalize to 0..20. Subtract noise as a fraction of its max.
  const positiveNorm = posMax > 0 ? (posSum / posMax) * 20 : 0;
  const noiseNorm = noiseMax > 0 ? (noisePenalty / noiseMax) * 8 : 0; // noise can drag up to 8 pts
  return Math.max(0, Math.min(20, Math.round((positiveNorm - noiseNorm) * 10) / 10));
}

// ============= Editorial profile decision (PR2) =============
export interface EditorialProfile {
  id: string;
  name: string;
  weights: Record<ScoreAxisKey, number>;
  threshold: number;
  must_include_keywords: string[];
  must_exclude_keywords: string[];
  required_tags_any: string[];
  blocked_tags: string[];
  author_overrides: Record<string, 'always_deliver' | 'always_skip'>;
  editorial_note?: string;
}

export interface ProfileDecisionInput {
  profile: EditorialProfile;
  axes: ScoreAxes | null;
  legacyScore: number | null;
  tags: string[];
  text: string;
  authorHandle: string | null;
}

export interface ProfileDecisionResult {
  decision: 'deliver' | 'skip';
  reason: string;
  finalScore: number;
}

/** Apply hard rules + weighted formula. Returns final decision + reason. */
export function applyProfileDecision(input: ProfileDecisionInput): ProfileDecisionResult {
  const { profile, axes, legacyScore, tags, text, authorHandle } = input;
  const norm = (text || '').toLowerCase();
  const handle = (authorHandle || '').toLowerCase();
  const tagSet = new Set((tags || []).map((t) => String(t).toLowerCase()));

  // 1. Author overrides (highest priority)
  if (handle && profile.author_overrides) {
    for (const [h, rule] of Object.entries(profile.author_overrides)) {
      if (h.toLowerCase().replace(/^@/, '') === handle.replace(/^@/, '')) {
        const finalScore = axes ? computeFinalScore(axes, profile.weights) : (legacyScore ?? 0);
        return { decision: rule === 'always_deliver' ? 'deliver' : 'skip', reason: `author_override:${rule}:@${handle}`, finalScore };
      }
    }
  }

  // 2. Blocked tags
  for (const t of profile.blocked_tags || []) {
    if (tagSet.has(t.toLowerCase())) {
      return { decision: 'skip', reason: `blocked_tag:${t}`, finalScore: 0 };
    }
  }

  // 3. Required tags (any)
  if ((profile.required_tags_any || []).length > 0) {
    const ok = profile.required_tags_any.some((t) => tagSet.has(t.toLowerCase()));
    if (!ok) return { decision: 'skip', reason: `missing_required_tag`, finalScore: 0 };
  }

  // 4. Must-exclude keywords
  for (const kw of profile.must_exclude_keywords || []) {
    if (kw && norm.includes(kw.toLowerCase())) {
      return { decision: 'skip', reason: `excluded_keyword:${kw}`, finalScore: 0 };
    }
  }

  // 5. Compute final score with profile weights
  let finalScore = axes ? computeFinalScore(axes, profile.weights) : (legacyScore ?? 0);

  // 6. Must-include keywords boost (+2 each, capped at 20)
  let boost = 0;
  for (const kw of profile.must_include_keywords || []) {
    if (kw && norm.includes(kw.toLowerCase())) boost += 2;
  }
  if (boost > 0) finalScore = Math.min(20, finalScore + boost);

  // 7. Threshold
  if (finalScore >= profile.threshold) {
    return { decision: 'deliver', reason: `score_pass:${finalScore.toFixed(1)}>=${profile.threshold}${boost ? `(+${boost} kw)` : ''}`, finalScore };
  }
  return { decision: 'skip', reason: `below_threshold:${finalScore.toFixed(1)}<${profile.threshold}`, finalScore };
}


function validateInternalToken(req: Request): Response | null {
  const token = req.headers.get('x-internal-token') || '';
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET') || '';
  // Also accept service_role key as Authorization bearer (from cron)
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  if (expected && token === expected) return null;
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;
  if (anonKey && authHeader === `Bearer ${anonKey}`) return null;

  // Allow if no shared secret configured (backwards compat)
  if (!expected) {
    console.warn('No WEBHOOK_SHARED_SECRET configured; allowing request.');
    return null;
  }

  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Load config from settings table with fallback defaults
// deno-lint-ignore no-explicit-any
async function loadConfig(supabase: any): Promise<any> {
  const defaults = {
    translationPrompt: "You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.",
    userPromptTemplate: null as string | null,
    splitCalls: true,
    openaiModel: 'gpt-4o-mini',
    openaiTemperature: 0.2,
    openaiMaxCompletionTokens: 2000,
    openaiTopP: null as number | null,
    openaiFrequencyPenalty: null as number | null,
    openaiPresencePenalty: null as number | null,
    openaiReasoningEffort: null as string | null,
    openaiVerbosity: null as string | null,
    openaiSeed: null as number | null,
    openaiServiceTier: null as string | null,
    openaiParallelToolCalls: null as boolean | null,
    // Scoring (independent). Null = inherit from translation values at use-site.
    scoringModel: null as string | null,
    scoringTemperature: null as number | null,
    scoringMaxCompletionTokens: null as number | null,
    scoringTopP: null as number | null,
    scoringReasoningEffort: null as string | null,
    scoringVerbosity: null as string | null,
    scoringSeed: null as number | null,
    scoringServiceTier: null as string | null,
    scoringParallelToolCalls: null as boolean | null,
    messageTemplate: {
      template: '{translated_text}\n\n📰 #اخبار',
      include_source_link: true,
      source_link_text: 'View original',
      custom_hashtags: '#اخبار'
    } as Record<string, unknown>,
    scoringSystemPrompt: null as string | null,
    classifierToolSchema: null as string | null,
    contentFilter: {
      enabled: false,
      default_threshold: 12,
      editorial_guidelines: '',
      priority_topics: [] as string[],
      low_priority_topics: [] as string[],
      author_rules: {} as Record<string, { rule: string; threshold?: number }>,
      score_only: false,
    },
    editorialProfile: null as null | {
      id: string;
      name: string;
      weights: Record<ScoreAxisKey, number>;
      threshold: number;
      must_include_keywords: string[];
      must_exclude_keywords: string[];
      required_tags_any: string[];
      blocked_tags: string[];
      author_overrides: Record<string, 'always_deliver' | 'always_skip'>;
      editorial_note?: string;
    },
  };

  try {
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['translation_prompt', 'message_template', 'content_filter', 'editorial_profiles', 'active_profile_id']);

    if (settings) {
      // translation_prompt is the authoritative source for OpenAI parameters.
      for (const s of settings) {
        if (s.key === 'translation_prompt' && typeof s.value === 'object' && s.value !== null) {
          const v = s.value as Record<string, unknown>;
          if (v.system_prompt) defaults.translationPrompt = String(v.system_prompt);
          if (typeof v.user_prompt_template === 'string' && (v.user_prompt_template as string).trim()) {
            defaults.userPromptTemplate = v.user_prompt_template as string;
          }
          if (typeof v.split_calls === 'boolean') defaults.splitCalls = v.split_calls as boolean;
          if (typeof v.model === 'string' && (v.model as string).trim()) defaults.openaiModel = String(v.model);
          if (typeof v.temperature === 'number') defaults.openaiTemperature = v.temperature;
          if (typeof v.max_completion_tokens === 'number') defaults.openaiMaxCompletionTokens = Math.max(1, v.max_completion_tokens as number);
          if (typeof v.top_p === 'number') defaults.openaiTopP = v.top_p as number;
          if (typeof v.frequency_penalty === 'number') defaults.openaiFrequencyPenalty = v.frequency_penalty as number;
          if (typeof v.presence_penalty === 'number') defaults.openaiPresencePenalty = v.presence_penalty as number;
          if (typeof v.reasoning_effort === 'string') defaults.openaiReasoningEffort = v.reasoning_effort as string;
          if (typeof v.verbosity === 'string') defaults.openaiVerbosity = v.verbosity as string;
          if (typeof v.seed === 'number') defaults.openaiSeed = v.seed as number;
          if (typeof v.service_tier === 'string') defaults.openaiServiceTier = v.service_tier as string;
          if (typeof v.parallel_tool_calls === 'boolean') defaults.openaiParallelToolCalls = v.parallel_tool_calls as boolean;
          if (typeof v.scoring_system_prompt === 'string' && v.scoring_system_prompt.trim()) {
            defaults.scoringSystemPrompt = v.scoring_system_prompt as string;
          }
          if (typeof v.classifier_tool_schema === 'string' && v.classifier_tool_schema.trim()) {
            defaults.classifierToolSchema = v.classifier_tool_schema as string;
          }
          // Independent scoring params (optional)
          if (typeof v.scoring === 'object' && v.scoring !== null) {
            const sv = v.scoring as Record<string, unknown>;
            if (typeof sv.model === 'string' && (sv.model as string).trim()) defaults.scoringModel = sv.model as string;
            if (typeof sv.temperature === 'number') defaults.scoringTemperature = sv.temperature as number;
            if (typeof sv.max_completion_tokens === 'number') defaults.scoringMaxCompletionTokens = Math.max(1, sv.max_completion_tokens as number);
            if (typeof sv.top_p === 'number') defaults.scoringTopP = sv.top_p as number;
            if (typeof sv.reasoning_effort === 'string') defaults.scoringReasoningEffort = sv.reasoning_effort as string;
            if (typeof sv.verbosity === 'string') defaults.scoringVerbosity = sv.verbosity as string;
            if (typeof sv.seed === 'number') defaults.scoringSeed = sv.seed as number;
            if (typeof sv.service_tier === 'string') defaults.scoringServiceTier = sv.service_tier as string;
            if (typeof sv.parallel_tool_calls === 'boolean') defaults.scoringParallelToolCalls = sv.parallel_tool_calls as boolean;
          }
        }
        if (s.key === 'message_template' && typeof s.value === 'object' && s.value !== null) {
          defaults.messageTemplate = { ...defaults.messageTemplate, ...s.value as Record<string, unknown> };
        }
        if (s.key === 'content_filter' && typeof s.value === 'object' && s.value !== null) {
          defaults.contentFilter = { ...defaults.contentFilter, ...s.value as Record<string, { rule: string; threshold?: number }> };
      }

      // Resolve active editorial profile (PR2)
      const profilesEntry = settings.find((x) => x.key === 'editorial_profiles');
      const activeEntry = settings.find((x) => x.key === 'active_profile_id');
      const profilesArr = (profilesEntry?.value as { profiles?: unknown[] } | null)?.profiles;
      const activeId = (activeEntry?.value as { id?: string } | null)?.id;
      if (Array.isArray(profilesArr) && activeId) {
        const found = profilesArr.find(
          (p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === activeId,
        );
        if (found) defaults.editorialProfile = found as typeof defaults.editorialProfile;
      }
    }
  } catch (e) {
    console.warn('Failed to load config from settings, using defaults:', (e as Error).message);
  }

  return defaults;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate internal token
  const authError = validateInternalToken(req);
  if (authError) return authError;

  try {
    const supabase = createClient<any, any>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const startTime = Date.now();
    console.log(JSON.stringify({ function: 'worker', action: 'start', trigger: req.url }));

    // Load runtime config
    const config = await loadConfig(supabase);

    // Use claim_jobs RPC for transactional job claiming
    const { data: jobs, error: jobError } = await supabase
      .rpc('claim_jobs', { batch_size: 20, worker_id: 'worker-' + crypto.randomUUID().slice(0, 8) });

    if (jobError) {
      console.error(JSON.stringify({ function: 'worker', action: 'claim_error', error: jobError.message }));
      throw jobError;
    }

    if (!jobs || jobs.length === 0) {
      console.log(JSON.stringify({ function: 'worker', action: 'no_jobs' }));
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No pending jobs',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Shape queue per chat and adapt spacing based on recent 429s
    const deliverJobs = jobs.filter((j: Record<string, unknown>) => j.type === 'deliver');
    const otherJobs = jobs.filter((j: Record<string, unknown>) => j.type !== 'deliver');

    const spacingMs = await computeAdaptiveSpacing(supabase);

    // Group deliver jobs by chat id
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const j of deliverJobs) {
      const key = await getChatIdForJob(j, supabase) || 'default';
      if (!groups[key]) groups[key] = [];
      groups[key].push(j);
    }

    const deliverJobsToRun: Record<string, unknown>[] = [];
    const nowMs = Date.now();
    for (const key of Object.keys(groups)) {
      const groupJobs = groups[key];
      if (groupJobs.length === 0) continue;
      groupJobs.sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());
      const [first, ...rest] = groupJobs;
      deliverJobsToRun.push(first);
      if (rest.length > 0) {
        const baseTime = nowMs + spacingMs;
        for (let i = 0; i < rest.length; i++) {
          const job = rest[i];
          const plannedTime = new Date(baseTime + i * spacingMs);
          const currentNext = job.next_run_at ? new Date(job.next_run_at as string) : null;
          const shouldUpdate = !currentNext || currentNext.getTime() < plannedTime.getTime();
          if (shouldUpdate) {
            try {
              await supabase
                .from('jobs')
                .update({ next_run_at: plannedTime.toISOString(), status: 'pending', locked_at: null, locked_by: null })
                .eq('id', job.id);
            } catch (_e) { /* best-effort */ }
          }
        }
      }
    }

    const toRunJobs = [...otherJobs, ...deliverJobsToRun];
    console.log(JSON.stringify({ function: 'worker', action: 'processing', count: toRunJobs.length, deferred: jobs.length - toRunJobs.length }));

    // Process selected jobs in parallel
    const jobPromises = toRunJobs.map(async (job: Record<string, unknown>) => {
      try {
        console.log(JSON.stringify({ function: 'worker', action: 'job_start', job_id: job.id, type: job.type }));

        await recordPipelineEvent(supabase, job, 'running');

        let success = false;
        const payload = job.payload as Record<string, unknown> | null;
        try {
          switch (job.type) {
            case 'translate':
              success = await handleTranslateJob(job, supabase, config);
              break;
            case 'moderate':
              success = await handleModerateJob(job, supabase);
              break;
            case 'deliver':
              success = await handleDeliverJob(job, supabase, config);
              break;
            case 'download_media':
              success = await handleDownloadMediaJob(job, supabase);
              break;
            case 'reprocess':
              success = await handleReprocessJob(job, supabase);
              break;
            case 'hydrate_tweet':
              success = await handleHydrateTweetJob(job, supabase);
              break;
            case 'resolve_media':
              success = await handleResolveMediaJob(job, supabase);
              break;
            default:
              console.error(`Unknown job type: ${job.type}`);
              success = false;
          }

          if (success) {
            await supabase
              .from('jobs')
              .update({ 
                status: 'completed',
                last_error: null,
                completed_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            await recordPipelineEvent(supabase, job, 'completed');
            console.log(JSON.stringify({ function: 'worker', action: 'job_complete', job_id: job.id, type: job.type }));
            return { success: true, jobId: job.id };
          } else {
            await handleJobFailure(supabase, job);
            await recordPipelineEvent(supabase, job, 'failed');
            return { success: false, jobId: job.id };
          }

        } catch (error) {
          console.error(JSON.stringify({ function: 'worker', action: 'job_error', job_id: job.id, error: (error as Error)?.message }));
          await handleJobFailure(supabase, job, error as Error);
          await recordPipelineEvent(supabase, job, 'failed', (error as Error)?.message ?? 'Failed');
          return { success: false, jobId: job.id, error: (error as Error)?.message };
        }
      } catch (error) {
        console.error(JSON.stringify({ function: 'worker', action: 'job_outer_error', job_id: job.id, error: (error as Error)?.message }));
        await handleJobFailure(supabase, job, error as Error);
        await recordPipelineEvent(supabase, job, 'failed', (error as Error)?.message ?? 'Failed');
        return { success: false, jobId: job.id, error: (error as Error)?.message };
      }
    });

    const results = await Promise.allSettled(jobPromises);
    
    let processedCount = 0;
    let failedCount = 0;
    
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        processedCount++;
      } else {
        failedCount++;
      }
    });

    const latencyMs = Date.now() - startTime;
    console.log(JSON.stringify({ function: 'worker', action: 'complete', processed: processedCount, failed: failedCount, latency_ms: latencyMs }));

    // Auto-chain: if next deliver job is due within ~1.5s, invoke worker again
    try {
      const THRESHOLD_MS = 1500;
      const { data: nextDeliver } = await supabase
        .from('jobs')
        .select('next_run_at')
        .eq('status', 'pending')
        .eq('type', 'deliver')
        .not('next_run_at', 'is', null)
        .order('next_run_at', { ascending: true })
        .limit(1)
        .single();
      if (nextDeliver?.next_run_at) {
        const nextAt = new Date(nextDeliver.next_run_at).getTime();
        const delta = nextAt - Date.now();
        if (delta <= THRESHOLD_MS) {
          console.log(JSON.stringify({ function: 'worker', action: 'autochain', delta_ms: delta }));
          await supabase.functions.invoke('worker', { body: { trigger: 'autochain' } });
        }
      }
    } catch (_e) { /* best-effort */ }

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      failed: failedCount,
      total: jobs.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'fatal', error: (error as Error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleTranslateJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any, config: Awaited<ReturnType<typeof loadConfig>>): Promise<boolean> {
  try {
    const payload = job.payload as Record<string, unknown>;
    const tweetId = payload.tweet_id as string;
    console.log(JSON.stringify({ function: 'worker', action: 'translate_start', tweet_id: tweetId }));
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const { data: post, error } = await supabase
      .from('posts')
      .select('tweet_id, text_original, account_id, url, tweeted_at, has_media, author_handle, is_truncated, hydrated_at, accounts!inner(handle, display_name)')
      .eq('tweet_id', tweetId)
      .single();

    if (error || !post) {
      throw new Error(`Post not found: ${tweetId}`);
    }

    if (!post.text_original) {
      throw new Error('No original text to translate');
    }

    const filterEnabled = config.contentFilter.enabled || config.contentFilter.score_only;
    const scoreOnly = config.contentFilter.score_only && !config.contentFilter.enabled;
    const authorHandle = post.author_handle as string | null;

    let translatedText = '';
    let importanceScore: number | null = null;
    let importanceTags: string[] | null = null;
    let importanceReasoning: string | null = null;
    let data: Record<string, unknown> = {};
    let scoringUsage: Record<string, unknown> | null = null;
    let translationUsage: Record<string, unknown> | null = null;

    // Resolve scoring params (fall back to translation values if not set)
    const scoringModel = config.scoringModel ?? config.openaiModel;
    const scoringTemperature = config.scoringTemperature ?? config.openaiTemperature;
    const scoringMaxTokens = config.scoringMaxCompletionTokens ?? config.openaiMaxCompletionTokens;
    const scoringTopP = config.scoringTopP ?? config.openaiTopP;
    const scoringReasoningEffort = config.scoringReasoningEffort ?? config.openaiReasoningEffort;
    const scoringVerbosity = config.scoringVerbosity ?? config.openaiVerbosity;
    const scoringSeed = config.scoringSeed ?? config.openaiSeed;
    const scoringServiceTier = config.scoringServiceTier ?? config.openaiServiceTier;
    const scoringParallelTools = config.scoringParallelToolCalls ?? config.openaiParallelToolCalls;

    // Build shared scoring system + user messages (used by both split and combined paths)
    const scoringGuidelines = config.contentFilter.editorial_guidelines || '';
    const priorityTopics = config.contentFilter.priority_topics.join(', ') || 'none specified';
    const lowPriorityTopics = config.contentFilter.low_priority_topics.join(', ') || 'none specified';
    const guidelinesBlock = scoringGuidelines.trim()
      ? `### Editorial Guidelines (AUTHORITATIVE — these override the default rubric when they conflict)\n---\n${scoringGuidelines}\n---`
      : '';

    const fallbackRubric = `You have two tasks. Complete both carefully.

## Task 1: Translation
{translation_prompt}

## Task 2: News Importance Scoring
You are an editorial assistant scoring news items for a curated Telegram channel focused on Iran and the Middle East.

### STEP A — Assign Relevance Level (state in reasoning)
- DIRECT (Iran gov/IRGC/nuclear/Hormuz/proxies/Israel-Iran/US-Iran war/sanctions on Iran): no cap.
- INDIRECT (Iran is the SUBJECT of foreign discussion): cap at 16.
- NO IRAN NEXUS (pure US/EU/China domestic): cap at 8.

### STEP B — Score 1-20 (importance_score)

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

    const accountData = (post as Record<string, unknown>).accounts as Record<string, unknown> | null;
    const authorDisplay = authorHandle || (accountData?.handle as string) || 'unknown';
    const accountName = (accountData?.display_name as string) || '';
    const publishedAt = post.tweeted_at ? new Date(post.tweeted_at as string).toISOString() : 'unknown';

    const buildUserMessage = () => `Author: @${authorDisplay}${accountName ? ` (${accountName})` : ''}
Published: ${publishedAt}
Has media: ${post.has_media ? 'yes' : 'no'}
URL: ${post.url || 'N/A'}

Content:
${post.text_original}`;

    // Build classifier tool schema (with optional translated_text stripped for split mode)
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
    const buildToolFunction = (includeTranslatedText: boolean): Record<string, unknown> => {
      let base: Record<string, unknown>;
      try {
        base = config.classifierToolSchema
          ? JSON.parse(config.classifierToolSchema)
          : {
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
        console.warn('Invalid classifier_tool_schema, using fallback:', (e as Error).message);
        base = {
          name: 'classify_importance',
          parameters: {
            type: 'object',
            properties: {
              translated_text: { type: 'string' },
              importance_score: { type: 'integer', minimum: 1, maximum: 20 },
              axes: AXES_SCHEMA,
              tags: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
            required: ['translated_text', 'importance_score', 'axes', 'tags', 'reasoning'],
          },
        };
      }
      // Auto-inject axes into customized schemas if missing (PR1 backward-compat)
      const params = base.parameters as Record<string, unknown>;
      const props = { ...(params.properties as Record<string, unknown>) };
      if (!props.axes) {
        props.axes = AXES_SCHEMA;
        const required = Array.from(new Set([...((params.required as string[]) || []), 'axes']));
        base = { ...base, parameters: { ...params, properties: props, required } };
      }
      if (!includeTranslatedText) {
        const p2 = base.parameters as Record<string, unknown>;
        const props2 = { ...(p2.properties as Record<string, unknown>) };
        delete props2.translated_text;
        const required = ((p2.required as string[]) || []).filter((k) => k !== 'translated_text');
        base = { ...base, parameters: { ...p2, properties: props2, required } };
      }
      return base;
    };

    const renderSystemPrompt = () => (config.scoringSystemPrompt ?? fallbackRubric)
      .replace('{translation_prompt}', config.translationPrompt)
      .replace('{priority_topics}', priorityTopics)
      .replace('{low_priority_topics}', lowPriorityTopics)
      .replace('{editorial_guidelines_block}', guidelinesBlock);

    // Helper: render translation user prompt from template (or default)
    const renderTranslationUserPrompt = () => {
      const tpl = config.userPromptTemplate;
      if (tpl && tpl.trim()) {
        return tpl
          .replace(/\{content\}/g, post.text_original as string)
          .replace(/\{author\}/g, `@${authorDisplay}`)
          .replace(/\{author_handle\}/g, `@${authorDisplay}`)
          .replace(/\{author_name\}/g, accountName)
          .replace(/\{published_at\}/g, publishedAt)
          .replace(/\{published_date\}/g, publishedAt);
      }
      return post.text_original as string;
    };

    // ============ SPLIT PATH: score first, translate only on pass ============
    let scoreAxes: ScoreAxes | null = null;
    if (filterEnabled && config.splitCalls) {
      const scoreToolFunction = buildToolFunction(false);

      console.log(JSON.stringify({ function: 'worker', action: 'score_start', tweet_id: tweetId, model: scoringModel, reasoning_effort: scoringReasoningEffort }));

      const scoreResult = await callOpenAI({
        apiKey: openaiApiKey,
        model: scoringModel,
        messages: [
          { role: 'system', content: renderSystemPrompt() },
          { role: 'user', content: buildUserMessage() },
        ],
        tool: scoreToolFunction as ToolFunctionDef,
        maxOutputTokens: scoringMaxTokens,
        temperature: scoringTemperature,
        topP: scoringTopP,
        reasoningEffort: scoringReasoningEffort,
        verbosity: scoringVerbosity,
        seed: scoringSeed,
        serviceTier: scoringServiceTier,
        parallelToolCalls: scoringParallelTools,
      });

      if (!scoreResult.ok) {
        throw new Error(`OpenAI scoring error: ${scoreResult.status} ${scoreResult.rawText}`);
      }
      scoringUsage = scoreResult.raw?.usage ?? null;
      data = scoreResult.raw;

      if (scoreResult.toolCall) {
        try {
          const args = JSON.parse(scoreResult.toolCall.arguments);
          importanceScore = Math.max(1, Math.min(20, args.importance_score || 10));
          importanceTags = args.tags || [];
          importanceReasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
          scoreAxes = parseScoreAxes(args.axes);
          // If axes present and importance_score wasn't, derive it from axes
          if (scoreAxes && (args.importance_score == null)) {
            importanceScore = Math.round(computeFinalScore(scoreAxes));
          }
          console.log(JSON.stringify({ function: 'worker', action: 'scored', tweet_id: tweetId, score: importanceScore, axes: scoreAxes, tags: importanceTags, reasoning: importanceReasoning, endpoint: scoreResult.endpoint, model: scoringModel }));
        } catch (parseErr) {
          console.warn('Failed to parse score tool call:', (parseErr as Error).message);
        }
      }

      // Decide gate BEFORE translating
      let preDecision = 'deliver';
      if (importanceScore !== null && !scoreOnly) {
        if (config.editorialProfile) {
          const r = applyProfileDecision({
            profile: config.editorialProfile,
            axes: scoreAxes,
            legacyScore: importanceScore,
            tags: importanceTags,
            text: String(post.text_original || ''),
            authorHandle,
          });
          preDecision = r.decision;
        } else {
          const authorRule = authorHandle ? config.contentFilter.author_rules[authorHandle] : null;
          if (authorRule?.rule === 'always_deliver') preDecision = 'deliver';
          else if (authorRule?.rule === 'always_skip') preDecision = 'skip';
          else {
            const threshold = authorRule?.rule === 'custom_threshold' && authorRule.threshold != null
              ? authorRule.threshold
              : config.contentFilter.default_threshold;
            preDecision = importanceScore >= threshold ? 'deliver' : 'skip';
          }
        }
      }

      // Translate only if passing the gate (or in score_only mode where we still translate everything)
      if (preDecision === 'deliver' || scoreOnly) {
        console.log(JSON.stringify({ function: 'worker', action: 'translate_call_start', tweet_id: tweetId, model: config.openaiModel, reasoning_effort: config.openaiReasoningEffort }));
        const trResult = await callOpenAI({
          apiKey: openaiApiKey,
          model: config.openaiModel,
          messages: [
            { role: 'system', content: config.translationPrompt },
            { role: 'user', content: renderTranslationUserPrompt() },
          ],
          maxOutputTokens: config.openaiMaxCompletionTokens,
          temperature: config.openaiTemperature,
          topP: config.openaiTopP,
          frequencyPenalty: config.openaiFrequencyPenalty,
          presencePenalty: config.openaiPresencePenalty,
          reasoningEffort: config.openaiReasoningEffort,
          verbosity: config.openaiVerbosity,
          seed: config.openaiSeed,
          serviceTier: config.openaiServiceTier,
          parallelToolCalls: config.openaiParallelToolCalls,
        });
        if (!trResult.ok) {
          throw new Error(`OpenAI translation error: ${trResult.status} ${trResult.rawText}`);
        }
        translationUsage = trResult.raw?.usage ?? null;
        translatedText = trResult.content;
        console.log(JSON.stringify({ function: 'worker', action: 'translate_complete', tweet_id: tweetId, chars: translatedText.length }));
      } else {
        console.log(JSON.stringify({ function: 'worker', action: 'translate_skipped_by_filter', tweet_id: tweetId, score: importanceScore }));
      }
    } else if (filterEnabled) {
      // ============ COMBINED PATH (legacy, when split_calls = false) ============
      const toolFunction = buildToolFunction(true);
      const result = await callOpenAI({
        apiKey: openaiApiKey,
        model: config.openaiModel,
        messages: [
          { role: 'system', content: renderSystemPrompt() },
          { role: 'user', content: buildUserMessage() },
        ],
        tool: toolFunction as ToolFunctionDef,
        maxOutputTokens: config.openaiMaxCompletionTokens,
        temperature: config.openaiTemperature,
        topP: config.openaiTopP,
        frequencyPenalty: config.openaiFrequencyPenalty,
        presencePenalty: config.openaiPresencePenalty,
        reasoningEffort: config.openaiReasoningEffort,
        verbosity: config.openaiVerbosity,
        seed: config.openaiSeed,
        serviceTier: config.openaiServiceTier,
        parallelToolCalls: config.openaiParallelToolCalls,
      });
      if (!result.ok) throw new Error(`OpenAI API error: ${result.status} ${result.rawText}`);
      data = result.raw;
      if (result.toolCall) {
        try {
          const args = JSON.parse(result.toolCall.arguments);
          translatedText = args.translated_text || '';
          importanceScore = Math.max(1, Math.min(20, args.importance_score || 10));
          importanceTags = args.tags || [];
          importanceReasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
          scoreAxes = parseScoreAxes(args.axes);
          if (scoreAxes && (args.importance_score == null)) {
            importanceScore = Math.round(computeFinalScore(scoreAxes));
          }
          console.log(JSON.stringify({ function: 'worker', action: 'scored', tweet_id: tweetId, score: importanceScore, axes: scoreAxes, tags: importanceTags, reasoning: importanceReasoning, endpoint: result.endpoint }));
        } catch (parseErr) {
          console.warn('Failed to parse tool call, falling back to content:', (parseErr as Error).message);
          translatedText = result.content;
        }
      } else {
        translatedText = result.content;
      }
    } else {
      // No filtering — simple translation
      const result = await callOpenAI({
        apiKey: openaiApiKey,
        model: config.openaiModel,
        messages: [
          { role: 'system', content: config.translationPrompt },
          { role: 'user', content: renderTranslationUserPrompt() },
        ],
        maxOutputTokens: config.openaiMaxCompletionTokens,
        temperature: config.openaiTemperature,
        topP: config.openaiTopP,
        frequencyPenalty: config.openaiFrequencyPenalty,
        presencePenalty: config.openaiPresencePenalty,
        reasoningEffort: config.openaiReasoningEffort,
        verbosity: config.openaiVerbosity,
        seed: config.openaiSeed,
        serviceTier: config.openaiServiceTier,
        parallelToolCalls: config.openaiParallelToolCalls,
      });
      if (!result.ok) {
        throw new Error(`OpenAI API error: ${result.status} ${result.rawText}`);
      }
      data = result.raw;
      translatedText = result.content;
    }

    const nowIso = new Date().toISOString();
    const resultMeta = {
      model: config.openaiModel,
      scoring_model: scoringModel,
      usage: data.usage ?? null,
      scoring_usage: scoringUsage,
      translation_usage: translationUsage,
      finished_at: nowIso,
      importance_score: importanceScore,
      split_calls: !!(filterEnabled && config.splitCalls),
    };
    try {
      await supabase.from('jobs').update({ result_meta: resultMeta }).eq('id', job.id);
    } catch (_e) { /* best-effort */ }

    // Determine delivery decision based on active editorial profile or legacy content filter
    let deliveryDecision = 'deliver';
    let decisionReason: string | null = null;
    let finalScore: number | null = scoreAxes ? computeFinalScore(scoreAxes) : (importanceScore ?? null);
    if (filterEnabled && importanceScore !== null && !scoreOnly) {
      if (config.editorialProfile) {
        const r = applyProfileDecision({
          profile: config.editorialProfile,
          axes: scoreAxes,
          legacyScore: importanceScore,
          tags: importanceTags,
          text: String(post.text_original || ''),
          authorHandle,
        });
        deliveryDecision = r.decision;
        decisionReason = r.reason;
        finalScore = r.finalScore;
        console.log(JSON.stringify({ function: 'worker', action: 'filter_decision', tweet_id: tweetId, decision: deliveryDecision, score: importanceScore, final_score: finalScore, profile: config.editorialProfile.id, author: authorHandle, reason: decisionReason }));
      } else {
        // Legacy content_filter path
        const authorRule = authorHandle ? config.contentFilter.author_rules[authorHandle] : null;
        if (authorRule?.rule === 'always_deliver') {
          deliveryDecision = 'deliver';
          decisionReason = `author_rule:always_deliver:${authorHandle}`;
        } else if (authorRule?.rule === 'always_skip') {
          deliveryDecision = 'skip';
          decisionReason = `author_rule:always_skip:${authorHandle}`;
        } else {
          const threshold = authorRule?.rule === 'custom_threshold' && authorRule.threshold != null
            ? authorRule.threshold
            : config.contentFilter.default_threshold;
          deliveryDecision = importanceScore >= threshold ? 'deliver' : 'skip';
          decisionReason = deliveryDecision === 'deliver'
            ? `score_pass:${importanceScore}>=${threshold}`
            : `below_threshold:${importanceScore}<${threshold}`;
        }
        console.log(JSON.stringify({ function: 'worker', action: 'filter_decision', tweet_id: tweetId, decision: deliveryDecision, score: importanceScore, threshold: config.contentFilter.default_threshold, author: authorHandle, reason: decisionReason }));
      }
    } else if (scoreOnly) {
      decisionReason = 'score_only_mode';
    } else if (!filterEnabled) {
      decisionReason = 'filter_disabled';
    }

    const { error: updateError } = await supabase
      .from('posts')
      .update({
        text_translated: translatedText,
        lang_original: 'en',
        translated_at: nowIso,
        translation_model: config.openaiModel,
        translation_tokens: data?.usage?.total_tokens ?? null,
        translation_duration_ms: job.started_at ? (Date.now() - new Date(job.started_at as string).getTime()) : null,
        importance_score: importanceScore,
        importance_tags: importanceTags,
        importance_reasoning: importanceReasoning,
        delivery_decision: deliveryDecision,
        score_axes: scoreAxes ?? null,
        final_score: finalScore,
        decision_reason: decisionReason,
      })
      .eq('tweet_id', tweetId);

    if (updateError) throw updateError;

    // Decide what to enqueue next based on filter decision + truncation state.
    // NEW FLOW: If a tweet PASSED the editorial gate AND is still truncated AND
    // not yet hydrated, enqueue hydrate_tweet instead of deliver. The hydrate
    // job will re-enqueue translate on success, which will fall through to
    // deliver on the second pass (is_truncated will be false by then).
    const isTruncated = (post as Record<string, unknown>).is_truncated === true;
    const alreadyHydrated = !!(post as Record<string, unknown>).hydrated_at;
    const hydrationCfg = await loadHydrationSettings(supabase);
    const shouldHydrateNow =
      deliveryDecision === 'deliver'
      && isTruncated
      && !alreadyHydrated
      && hydrationCfg.enabled;

    if (shouldHydrateNow) {
      console.log(JSON.stringify({ function: 'worker', action: 'hydration_gated_enqueue', tweet_id: tweetId, score: importanceScore }));
      const { error: hydrateJobError } = await supabase
        .from('jobs')
        .upsert({
          type: 'hydrate_tweet',
          payload: { tweet_id: tweetId },
          status: 'pending',
          priority: 15,
          idempotency_key: `hydrate:post-translate:${tweetId}`,
          next_run_at: new Date().toISOString()
        }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (hydrateJobError) {
        console.warn('Failed to create post-translate hydrate job:', hydrateJobError);
      } else {
        await insertPipelineEvent(supabase, 'post', tweetId, 'hydrate', 'queued', null, null, null, { source: 'post-score-gate', score: importanceScore });
      }
    } else if (deliveryDecision === 'deliver') {
      const idempotencyKey = `deliver:${tweetId}`;
      const { error: deliveryJobError } = await supabase
        .from('jobs')
        .upsert({
          type: 'deliver',
          payload: { tweet_id: tweetId },
          status: 'pending',
          priority: 20,
          idempotency_key: idempotencyKey,
          next_run_at: new Date().toISOString()
        }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

      if (deliveryJobError) {
        console.warn('Failed to create delivery job:', deliveryJobError);
      } else {
        await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'queued', null, null, null, { source: 'worker' });
        // Ensure a pending delivery row exists
        try {
          const { data: existingDel } = await supabase
            .from('deliveries')
            .select('id')
            .eq('subject_type', 'post')
            .eq('subject_id', tweetId)
            .eq('status', 'pending')
            .limit(1);
          if (!existingDel || existingDel.length === 0) {
            await supabase.from('deliveries').insert({
              subject_type: 'post', subject_id: tweetId, status: 'pending', attempts: 0
            });
          }
        } catch (_e) { /* best-effort */ }
      }
    } else {
      console.log(JSON.stringify({ function: 'worker', action: 'delivery_skipped', tweet_id: tweetId, score: importanceScore, decision: deliveryDecision }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, nowIso, null, { skipped: 'content_filter', score: importanceScore, decision: deliveryDecision });
    }
    
    return true;
  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'translate_error', error: (error as Error).message }));
    return false;
  }
}

async function handleModerateJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  try {
    const payload = job.payload as Record<string, unknown>;
    const subjectId = payload.subject_id as string;
    console.log(JSON.stringify({ function: 'worker', action: 'moderate_start', subject_id: subjectId }));
    
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) throw new Error('OpenAI API key not configured');

    let content = '';
    if (payload.subject_type === 'post') {
      const { data: post } = await supabase
        .from('posts')
        .select('text_translated, text_original')
        .eq('tweet_id', subjectId)
        .single();
      content = post?.text_translated || post?.text_original || '';
    }

    if (!content) throw new Error('No content to moderate');

    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: content }),
    });

    if (!response.ok) throw new Error(`OpenAI Moderation API error: ${response.statusText}`);

    const data = await response.json();
    const moderation = data.results[0];

    const { error } = await supabase
      .from('moderation_events')
      .insert([{ subject_type: payload.subject_type, subject_id: subjectId, verdict: moderation.flagged ? null : 'allow', categories: moderation.categories }]);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'moderate_error', error: (error as Error).message }));
    return false;
  }
}

async function handleDeliverJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any, config: Awaited<ReturnType<typeof loadConfig>>): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    console.log(JSON.stringify({ function: 'worker', action: 'deliver_start', tweet_id: tweetId }));
    
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const telegramChatId = Deno.env.get('TELEGRAM_CHAT_ID');
    
    if (!telegramBotToken || !telegramChatId) throw new Error('Telegram configuration not set');

    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('tweet_id, text_original, text_translated, url, tweeted_at, has_media, account_id')
      .eq('tweet_id', tweetId)
      .single();

    if (postError || !post) throw new Error(`Post not found: ${tweetId}`);

    const { data: account } = await supabase
      .from('accounts')
      .select('handle, display_name')
      .eq('id', post.account_id)
      .single();

    const messageTemplate = config.messageTemplate as Record<string, unknown>;

    const { data: media } = await supabase
      .from('media')
      .select('id, kind, src_url, storage_path, ordering')
      .eq('tweet_id', tweetId)
      .order('ordering');

    // Idempotency: skip if already posted
    try {
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('id')
        .eq('subject_type', 'post')
        .eq('subject_id', tweetId)
        .eq('status', 'posted')
        .eq('telegram_chat_id', telegramChatId)
        .limit(1);
      if (existingDelivery && existingDelivery.length > 0) {
        console.log(JSON.stringify({ function: 'worker', action: 'deliver_skip_duplicate', tweet_id: tweetId }));
        await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, { skipped: 'duplicate_subject' });
        return true;
      }
    } catch (_e) { /* best-effort */ }

    // Cross-subject dedupe by canonical URL
    if (post.url) {
      try {
        const { data: siblingPosts } = await supabase.from('posts').select('tweet_id').eq('url', post.url);
        const siblingIds = (siblingPosts || []).map((p: Record<string, unknown>) => p.tweet_id as string);
        if (siblingIds.length > 0) {
          const { data: siblingDeliveries } = await supabase
            .from('deliveries').select('id').eq('status', 'posted').eq('subject_type', 'post').in('subject_id', siblingIds).eq('telegram_chat_id', telegramChatId).limit(1);
          if (siblingDeliveries && siblingDeliveries.length > 0) {
            console.log(JSON.stringify({ function: 'worker', action: 'deliver_skip_url_dupe', tweet_id: tweetId, url: post.url }));
            await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, { skipped: 'duplicate_url', url: post.url });
            return true;
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    const message = formatMessageWithTemplate(post, account, messageTemplate);
    let telegramMessageIds: string[] = [];

    if (media && media.length > 0) {
      const images = media.filter((m: Record<string, unknown>) => m.kind === 'image');
      const videos = media.filter((m: Record<string, unknown>) => m.kind === 'video');
      const audios = media.filter((m: Record<string, unknown>) => m.kind === 'audio');

      if (images.length > 0) {
        if (images.length === 1) {
          const image = images[0];
          const msgIds = await sendTelegramPhotoFromStorage(supabase, telegramBotToken, telegramChatId, image, message);
          telegramMessageIds.push(...msgIds);
        } else {
          const msgIds = await sendTelegramPhotoGroupFromStorage(supabase, telegramBotToken, telegramChatId, images.slice(0, 10), message);
          telegramMessageIds.push(...msgIds);
        }
      }

      for (const video of videos) {
        const videoUrl = await getMediaUrl(supabase, video);
        const msgIds = await sendTelegramMedia('sendVideo', telegramBotToken, telegramChatId, { video: videoUrl }, message);
        telegramMessageIds.push(...msgIds);
      }

      for (const audio of audios) {
        const audioUrl = await getMediaUrl(supabase, audio);
        const caption = images.length === 0 && videos.length === 0 ? message : 'Audio from tweet';
        const msgIds = await sendTelegramMedia('sendAudio', telegramBotToken, telegramChatId, { audio: audioUrl }, caption);
        telegramMessageIds.push(...msgIds);
      }
    } else {
      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'Markdown', disable_web_page_preview: false })
      });
      const result = await response.json();
      if (result.ok) {
        telegramMessageIds.push(String(result.result.message_id));
      } else {
        if (isTelegramParseError(result?.description ?? '')) {
          const retryResp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: telegramChatId, text: stripMarkdownToPlain(message), disable_web_page_preview: false })
          });
          const retryRes = await retryResp.json();
          if (retryRes?.ok) {
            telegramMessageIds.push(String(retryRes.result.message_id));
          } else {
            throwTelegramError('sendMessage', result, response.status);
          }
        } else {
          throwTelegramError('sendMessage', result, response.status);
        }
      }
    }

    // Record successful delivery
    await supabase.from('deliveries').insert({
      subject_type: 'post', subject_id: tweetId, telegram_chat_id: telegramChatId,
      telegram_message_ids: telegramMessageIds, status: 'posted',
      posted_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), attempts: 1
    });

    await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, { message_ids: telegramMessageIds });
    return true;

  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'deliver_error', tweet_id: tweetId, error: (error as Error).message }));
    await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'failed', null, null, (error as Error)?.message ?? 'Delivery failed');
    return false;
  }
}

// Download image bytes from temp-media bucket so we can multipart-upload them
// to Telegram. Telegram renders inline photos when given real bytes with a
// proper filename + image/* content-type; passing only a signed URL sometimes
// causes Telegram to fall back to "document" rendering.
async function fetchImageBytes(// deno-lint-ignore no-explicit-any
supabase: any, image: Record<string, unknown>): Promise<{ blob: Blob; filename: string } | null> {
  const storagePath = image.storage_path as string | null;
  if (!storagePath) return null;
  try {
    const { data, error } = await supabase.storage.from('temp-media').download(storagePath);
    if (error || !data) return null;
    const mime = (image.mime_type as string | undefined) || (data as Blob).type || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
    const base = storagePath.split('/').pop()?.replace(/\.[^.]+$/, '') || `photo_${image.id}`;
    const blob = new Blob([await (data as Blob).arrayBuffer()], { type: mime.startsWith('image/') ? mime : 'image/jpeg' });
    return { blob, filename: `${base}.${ext}` };
  } catch (_e) {
    return null;
  }
}

async function sendTelegramPhotoFromStorage(// deno-lint-ignore no-explicit-any
supabase: any, botToken: string, chatId: string, image: Record<string, unknown>, caption: string): Promise<string[]> {
  const bytes = await fetchImageBytes(supabase, image);
  if (!bytes) {
    // Fallback to URL-based send if bytes unavailable
    const imageUrl = await getMediaUrl(supabase, image);
    return await sendTelegramMedia('sendPhoto', botToken, chatId, { photo: imageUrl }, caption);
  }
  const send = async (cap: string, useMarkdown: boolean): Promise<Response> => {
    const fd = new FormData();
    fd.append('chat_id', chatId);
    fd.append('caption', cap);
    if (useMarkdown) fd.append('parse_mode', 'Markdown');
    fd.append('photo', bytes.blob, bytes.filename);
    return await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: fd });
  };
  const resp = await send(caption, true);
  const result = await resp.json();
  if (result.ok) return [String(result.result.message_id)];
  if (isTelegramParseError(result?.description ?? '')) {
    const retry = await send(stripMarkdownToPlain(caption), false);
    const r = await retry.json();
    if (r?.ok) return [String(r.result.message_id)];
  }
  throwTelegramError('sendPhoto', result, resp.status);
  return [];
}

async function sendTelegramPhotoGroupFromStorage(// deno-lint-ignore no-explicit-any
supabase: any, botToken: string, chatId: string, images: Record<string, unknown>[], caption: string): Promise<string[]> {
  const attachments: { blob: Blob; filename: string; attachName: string }[] = [];
  const mediaArr: Record<string, unknown>[] = [];
  for (let i = 0; i < images.length; i++) {
    const bytes = await fetchImageBytes(supabase, images[i]);
    if (bytes) {
      const attachName = `photo${i}`;
      attachments.push({ ...bytes, attachName });
      const m: Record<string, unknown> = { type: 'photo', media: `attach://${attachName}` };
      if (i === 0) { m.caption = caption; m.parse_mode = 'Markdown'; }
      mediaArr.push(m);
    } else {
      const url = await getMediaUrl(supabase, images[i]);
      const m: Record<string, unknown> = { type: 'photo', media: url };
      if (i === 0) { m.caption = caption; m.parse_mode = 'Markdown'; }
      mediaArr.push(m);
    }
  }
  const build = (mArr: Record<string, unknown>[]): FormData => {
    const fd = new FormData();
    fd.append('chat_id', chatId);
    fd.append('media', JSON.stringify(mArr));
    for (const a of attachments) fd.append(a.attachName, a.blob, a.filename);
    return fd;
  };
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMediaGroup`, { method: 'POST', body: build(mediaArr) });
  const result = await resp.json();
  if (result.ok) return result.result.map((m: Record<string, unknown>) => String(m.message_id));
  if (isTelegramParseError(result?.description ?? '')) {
    const retryArr = mediaArr.map((m, idx) => {
      const out: Record<string, unknown> = { type: m.type, media: m.media };
      if (idx === 0 && m.caption) out.caption = stripMarkdownToPlain(String(m.caption));
      return out;
    });
    const retryResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMediaGroup`, { method: 'POST', body: build(retryArr) });
    const r = await retryResp.json();
    if (r?.ok) return r.result.map((m: Record<string, unknown>) => String(m.message_id));
  }
  throwTelegramError('sendMediaGroup', result, resp.status);
  return [];
}

// Helper to send a single Telegram media message with parse error retry
async function sendTelegramMedia(method: string, botToken: string, chatId: string, mediaPayload: Record<string, string>, caption: string): Promise<string[]> {
  const body = { chat_id: chatId, ...mediaPayload, caption, parse_mode: 'Markdown' };
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (result.ok) return [String(result.result.message_id)];

  if (isTelegramParseError(result?.description ?? '')) {
    const retryBody = { chat_id: chatId, ...mediaPayload, caption: stripMarkdownToPlain(caption) };
    const retryResp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(retryBody)
    });
    const retryRes = await retryResp.json();
    if (retryRes?.ok) return [String(retryRes.result.message_id)];
  }

  throwTelegramError(method, result, response.status);
  return []; // unreachable
}

function throwTelegramError(method: string, result: Record<string, unknown>, statusCode: number): never {
  const description = String(result?.description ?? '');
  const retryAfter = extractTelegramRetryAfter(result, description, statusCode);
  if (retryAfter != null) {
    throw new TelegramRateLimitError(`Telegram ${method} failed: ${description}`, retryAfter);
  }
  throw new Error(`Telegram ${method} failed: ${description}`);
}

// Retry policy with dead-lettering
const MAX_ATTEMPTS: Record<string, number> = {
  translate: 5,
  deliver: 8,
  download_media: 3,
  moderate: 3,
  reprocess: 3,
  hydrate_tweet: 3,
  resolve_media: 4,
};

async function handleJobFailure(// deno-lint-ignore no-explicit-any
supabase: any, job: Record<string, unknown>, errorOrMessage?: Error | string) {
  const jobType = job.type as string;
  const maxAttempts = MAX_ATTEMPTS[jobType] ?? 5;
  const attempts = (job.attempts as number) ?? 0;
  const errorMsg = typeof errorOrMessage === 'string' ? errorOrMessage : (errorOrMessage?.message || 'Processing failed');
  
  if (attempts >= maxAttempts) {
    // Dead-letter the job
    try {
      await supabase.from('dead_letter_jobs').insert({
        original_job_id: job.id as string,
        type: jobType,
        payload: job.payload,
        attempts,
        last_error: errorMsg,
        result_meta: job.result_meta ?? null,
        source: 'worker'
      });
    } catch (_e) {
      console.error(JSON.stringify({ function: 'worker', action: 'dead_letter_failed', job_id: job.id }));
    }

    await supabase.from('jobs').update({ status: 'failed', last_error: errorMsg }).eq('id', job.id);
    console.log(JSON.stringify({ function: 'worker', action: 'job_dead_lettered', job_id: job.id, attempts }));
  } else {
    // Telegram-aware backoff
    let retryAfterSeconds: number | null = null;
    if (errorOrMessage && typeof errorOrMessage === 'object' && 'retryAfterSeconds' in errorOrMessage) {
      retryAfterSeconds = Math.max(1, Math.floor((errorOrMessage as TelegramRateLimitError).retryAfterSeconds));
    } else {
      retryAfterSeconds = parseRetryAfterFromMessage(errorMsg);
    }

    let nextRunAt: Date;
    if (retryAfterSeconds != null) {
      const jitter = Math.floor(retryAfterSeconds * (Math.random() * 0.2));
      nextRunAt = new Date(Date.now() + (retryAfterSeconds + jitter) * 1000);
    } else {
      // Exponential backoff: 30s, 60s, 120s, 240s, 480s, ...
      const baseDelaySec = 30;
      const delaySec = baseDelaySec * Math.pow(2, attempts);
      const jitterSec = Math.floor(delaySec * Math.random() * 0.2);
      nextRunAt = new Date(Date.now() + (delaySec + jitterSec) * 1000);
    }

    await supabase.from('jobs').update({ 
      status: 'pending', last_error: errorMsg, next_run_at: nextRunAt.toISOString(),
      locked_at: null, locked_by: null, lease_expires_at: null
    }).eq('id', job.id);
  }
}

function formatMessageWithTemplate(post: Record<string, unknown>, account: Record<string, unknown> | null, messageTemplate: Record<string, unknown>): string {
  const placeholders: Record<string, string> = {
    '{translated_text}': String(post.text_translated || post.text_original || ''),
    '{original_text}': String(post.text_original || ''),
    '{author_handle}': String(account?.handle || ''),
    '{author_name}': String(account?.display_name || ''),
    '{source_link}': messageTemplate.include_source_link && post.url ? 
      `[${messageTemplate.source_link_text || 'View original'}](${post.url})` : '',
    '{published_date}': post.tweeted_at ? new Date(post.tweeted_at as string).toLocaleDateString('fa-IR') : '',
    '{published_time}': post.tweeted_at ? new Date(post.tweeted_at as string).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '',
    '{hashtags}': String(messageTemplate.custom_hashtags || ''),
    '{media_info}': post.has_media ? '📸 تصویر' : ''
  };

  return Object.entries(placeholders).reduce((template, [key, value]) => {
    return template.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  }, String(messageTemplate.template || '{translated_text}'));
}

async function getMediaUrl(// deno-lint-ignore no-explicit-any
supabase: any, media: Record<string, unknown>): Promise<string> {
  if (media.storage_path) {
    try {
      const { data } = await supabase.storage.from('temp-media').createSignedUrl(media.storage_path as string, 3600);
      if (data?.signedUrl) return data.signedUrl;
    } catch (_e) { /* fallback */ }
  }
  return media.src_url as string;
}

async function handleDownloadMediaJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'running', new Date().toISOString());
    
    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: { action: 'download_media', tweet_id: tweetId },
      headers: { 'x-internal-token': Deno.env.get('WEBHOOK_SHARED_SECRET') || '' }
    } as Record<string, unknown>);

    if (error) throw new Error(`Media processor error: ${error.message}`);
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'completed', null, new Date().toISOString());
    return true;
  } catch (error) {
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'failed', null, null, (error as Error)?.message ?? 'Download failed');
    return false;
  }
}

async function handleReprocessJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    const { data: post, error: postError } = await supabase
      .from('posts').select('tweet_id, text_original').eq('tweet_id', tweetId).single();
    if (postError || !post) throw new Error(`Post not found: ${tweetId}`);

    const mediaItems = extractMediaFromText(post.text_original || '');
    await supabase.from('media').delete().eq('tweet_id', tweetId);

    if (mediaItems.length > 0) {
      const mediaRows = await Promise.all(
        mediaItems.map(async (media, index) => ({
          tweet_id: tweetId, kind: media.type, src_url: media.url,
          src_url_hash: await hashUrl(media.url),
          width: media.width, height: media.height, duration_ms: media.duration, ordering: index
        }))
      );
      await supabase.from('media').insert(mediaRows);
      await supabase.from('posts').update({ has_media: true }).eq('tweet_id', tweetId);
      await supabase.from('jobs').upsert({
        type: 'download_media', payload: { tweet_id: tweetId }, status: 'pending',
        idempotency_key: `download_media:reprocess:${tweetId}`, next_run_at: new Date().toISOString()
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    } else {
      await supabase.from('posts').update({ has_media: false }).eq('tweet_id', tweetId);
    }

    await supabase.from('jobs').upsert({
      type: 'translate', payload: { tweet_id: tweetId }, status: 'pending',
      idempotency_key: `translate:reprocess:${tweetId}`, next_run_at: new Date().toISOString()
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

    return true;
  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'reprocess_error', tweet_id: tweetId, error: (error as Error).message }));
    return false;
  }
}

function extractMediaFromText(text: string): Array<{type: string, url: string, width?: number, height?: number, duration?: number}> {
  const mediaItems: Array<{type: string, url: string, width?: number, height?: number, duration?: number}> = [];
  if (!text) return mediaItems;
  
  const directMediaRegex = /https?:\/\/pbs\.twimg\.com\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|mov)/gi;
  const directMatches = text.match(directMediaRegex);
  if (directMatches) {
    for (const match of directMatches) {
      const isVideo = /\.(mp4|mov)$/i.test(match);
      mediaItems.push({ type: isVideo ? 'video' : 'image', url: match });
    }
  }
  return mediaItems;
}

// Pipeline events helpers
async function recordPipelineEvent(// deno-lint-ignore no-explicit-any
supabase: any, job: Record<string, unknown>, state: 'running' | 'completed' | 'failed', error?: string) {
  try {
    const payload = job.payload as Record<string, unknown> | null;
    const subjectType = (payload?.subject_type as string) ?? 'post';
    const subjectId = (payload?.tweet_id as string) ?? (payload?.subject_id as string) ?? null;
    if (!subjectId) return;
    const step = normalizeStep(job.type as string);
    const now = new Date().toISOString();
    await insertPipelineEvent(supabase, subjectType, subjectId, step, state, state === 'running' ? now : null, state === 'completed' ? now : null, error);
  } catch (_e) { /* best-effort */ }
}

function normalizeStep(type: string): string {
  switch (type) {
    case 'translate': return 'translate';
    case 'deliver': return 'deliver';
    case 'download_media': return 'media';
    case 'moderate': return 'moderate';
    case 'hydrate_tweet': return 'hydrate';
    case 'resolve_media': return 'resolve_media';
    default: return type;
  }
}

async function insertPipelineEvent(
  // deno-lint-ignore no-explicit-any
supabase: any, subjectType: string, subjectId: string,
  step: string, status: string, startedAt?: string | null, endedAt?: string | null,
  error?: string | null, meta?: Record<string, unknown> | null
) {
  try {
    await supabase.from('pipeline_events').insert({
      subject_type: subjectType, subject_id: subjectId, step, status,
      started_at: startedAt ?? null, ended_at: endedAt ?? null, error: error ?? null, meta: meta ?? null
    });
  } catch (_e) { /* best-effort */ }
}

// Telegram helpers
class TelegramRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'TelegramRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function extractTelegramRetryAfter(result: Record<string, unknown>, description: string, statusCode: number): number | null {
  try {
    if (statusCode === 429) {
      const params = result?.parameters as Record<string, unknown> | undefined;
      const apiParam = params?.retry_after;
      if (typeof apiParam === 'number' && isFinite(apiParam)) return Math.max(1, Math.floor(apiParam));
    }
    return parseRetryAfterFromMessage(description);
  } catch (_e) { return null; }
}

function parseRetryAfterFromMessage(message: string): number | null {
  if (!message) return null;
  const m = message.match(/retry\s+after\s+(\d+)/i);
  if (m && m[1]) { const n = parseInt(m[1], 10); return isFinite(n) ? Math.max(1, n) : null; }
  return null;
}

function isTelegramParseError(description: string): boolean {
  if (!description) return false;
  return /can't parse entities/i.test(description) || /parse_mode/i.test(description);
}

function stripMarkdownToPlain(text: string): string {
  if (!text) return text;
  return text.replace(/[\\*_`\[\]()~>#+=|{}.!-]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function computeAdaptiveSpacing(// deno-lint-ignore no-explicit-any
supabase: any): Promise<number> {
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('pipeline_events')
      .select('id', { count: 'exact', head: true })
      .eq('step', 'deliver').eq('status', 'failed')
      .gte('started_at', twoMinutesAgo)
      .ilike('error', '%Too Many Requests%');
    if ((count ?? 0) === 0) return 800;
  } catch (_e) { /* fallback */ }
  return 1500;
}

// deno-lint-ignore no-explicit-any
async function getChatIdForJob(_job: Record<string, unknown>, _supabase: any): Promise<string | null> {
  try { return Deno.env.get('TELEGRAM_CHAT_ID') || null; } catch (_e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────
// Tweet hydration via X API v2 (for truncated tweets)
// ─────────────────────────────────────────────────────────────────────

const HYDRATE_TEXT_ENCODER = new TextEncoder();

function hydratePercentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hydrateHmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", HYDRATE_TEXT_ENCODER.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, HYDRATE_TEXT_ENCODER.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hydrateOauthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  tokenSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort()
    .map((k) => `${hydratePercentEncode(k)}=${hydratePercentEncode(allParams[k])}`).join("&");
  const baseString = `${method.toUpperCase()}&${hydratePercentEncode(baseUrl)}&${hydratePercentEncode(paramString)}`;
  const signingKey = `${hydratePercentEncode(consumerSecret)}&${hydratePercentEncode(tokenSecret)}`;
  oauthParams.oauth_signature = await hydrateHmacSha1(signingKey, baseString);
  return `OAuth ${Object.keys(oauthParams).sort()
    .map((k) => `${hydratePercentEncode(k)}="${hydratePercentEncode(oauthParams[k])}"`).join(", ")}`;
}

// Reads Twitter creds strictly from environment secrets.
async function getTwitterCreds(// deno-lint-ignore no-explicit-any
_supabase: any): Promise<{ ck: string; cs: string; at: string; ats: string } | null> {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY") || "";
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET") || "";
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN") || "";
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET") || "";
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}

// Best-effort increment of x_api_usage settings counter (rolling 24h).
async function recordXApiCall(// deno-lint-ignore no-explicit-any
supabase: any, errorMsg?: string | null): Promise<void> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'x_api_usage').maybeSingle();
    const cur = (data?.value || {}) as Record<string, unknown>;
    const total = (typeof cur.total === 'number' ? cur.total : 0) + 1;
    const calls = Array.isArray(cur.calls_24h) ? (cur.calls_24h as string[]) : [];
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const trimmed = calls.filter((ts) => { try { return new Date(ts) >= cutoff; } catch { return false; } });
    trimmed.push(now.toISOString());
    await supabase.from('settings').update({
      value: { total, calls_24h: trimmed, last_call_at: now.toISOString(), last_error: errorMsg ?? null },
      updated_at: now.toISOString(),
    }).eq('key', 'x_api_usage');
  } catch (e) {
    console.warn('recordXApiCall failed:', (e as Error).message);
  }
}

// Load hydration toggle + daily budget from settings.
// - twitter_hydration.enabled (default true): master kill switch
// - x_rate_limits.hydrations_per_day (default 100): max X reads per 24h for hydration
async function loadHydrationSettings(// deno-lint-ignore no-explicit-any
supabase: any): Promise<{ enabled: boolean; daily_budget: number }> {
  let enabled = true;
  let daily_budget = 100;
  try {
    const { data: th } = await supabase.from('settings').select('value').eq('key', 'twitter_hydration').maybeSingle();
    if (th?.value && typeof th.value === 'object') {
      const v = th.value as Record<string, unknown>;
      if (v.enabled === false) enabled = false;
    }
  } catch { /* keep default */ }
  try {
    const { data: rl } = await supabase.from('settings').select('value').eq('key', 'x_rate_limits').maybeSingle();
    if (rl?.value && typeof rl.value === 'object') {
      const v = rl.value as Record<string, unknown>;
      const n = Number(v.hydrations_per_day);
      if (Number.isFinite(n) && n > 0) daily_budget = Math.floor(n);
    }
  } catch { /* keep default */ }
  return { enabled, daily_budget };
}

// Count hydration X API calls in the last 24h. We use posts.hydrated_at with
// hydration_source='x_api' (the only source that consumed an actual X read).
async function countDailyHydrationsUsed(// deno-lint-ignore no-explicit-any
supabase: any): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('posts')
      .select('tweet_id', { count: 'exact', head: true })
      .eq('hydration_source', 'x_api')
      .gte('hydrated_at', since);
    return Number(count || 0);
  } catch { return 0; }
}

async function queueTranslateAfterHydrate(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string, fallback: boolean): Promise<void> {
  // CRITICAL: must use a key DISTINCT from the initial `translate:${tweetId}`
  // job. Otherwise the upsert is ignored (idempotency collision) and the
  // truncated translation is never replaced with the full hydrated text,
  // causing the x-poster / Telegram pipeline to deliver stale truncated copy.
  await supabase.from('jobs').upsert({
    type: 'translate',
    payload: { tweet_id: tweetId, post_hydrate: true },
    status: 'pending',
    priority: 10,
    idempotency_key: `translate:hydrate:${tweetId}`,
    next_run_at: new Date().toISOString(),
    result_meta: fallback ? { fallback: 'truncated' } : null,
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

  try {
    await supabase.from('pipeline_events').insert({
      subject_type: 'post', subject_id: tweetId,
      step: 'translate', status: 'queued',
      started_at: new Date().toISOString(),
      meta: { source: fallback ? 'hydrate_fallback' : 'hydrate' },
    });
  } catch { /* best-effort */ }
}

// Extract numeric tweet id from RSS guid/url. Twitter tweet IDs are 18-19 digit numbers.
function extractNumericTweetId(rawTweetId: string, url?: string | null): string | null {
  const candidates: string[] = [rawTweetId];
  if (url) candidates.push(url);
  for (const c of candidates) {
    if (!c) continue;
    // /status/123456789 — most reliable
    const m1 = c.match(/status\/(\d{5,25})/);
    if (m1) return m1[1];
    // raw long digit string
    const m2 = c.match(/(?:^|[^0-9])(\d{15,25})(?:$|[^0-9])/);
    if (m2) return m2[1];
  }
  return null;
}

async function handleHydrateTweetJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || '');
  if (!tweetId) {
    console.error('hydrate_tweet: missing tweet_id');
    return false;
  }

  // Load post; idempotent if already hydrated
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, text_original, url, hydrated_at, is_truncated')
    .eq('tweet_id', tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error('hydrate_tweet: post not found', tweetId, postErr?.message);
    return false;
  }

  if (post.hydrated_at) {
    console.log('hydrate_tweet: already hydrated, ensuring translate job exists', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, false);
    return true;
  }

  // Kill switch + daily budget gate. If hydration is disabled or the daily
  // X-API budget is exhausted, mark the post as a budget fallback (no read
  // consumed) and let the existing flow continue with the truncated text.
  const hydrationCfg = await loadHydrationSettings(supabase);
  if (!hydrationCfg.enabled) {
    console.warn('hydrate_tweet: disabled by settings, falling back', tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'disabled_fallback',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    return true;
  }
  const used24h = await countDailyHydrationsUsed(supabase);
  if (used24h >= hydrationCfg.daily_budget) {
    console.warn(`hydrate_tweet: daily budget exhausted (${used24h}/${hydrationCfg.daily_budget}), falling back`, tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'budget_exhausted_fallback',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    try {
      await supabase.from('pipeline_events').insert({
        subject_type: 'post', subject_id: tweetId,
        step: 'hydrate', status: 'completed',
        ended_at: new Date().toISOString(),
        meta: { fallback: 'budget_exhausted', used_24h: used24h, budget: hydrationCfg.daily_budget }
      });
    } catch { /* best-effort */ }
    return true;
  }

  const numericId = extractNumericTweetId(tweetId, post.url as string | null);
  if (!numericId) {
    console.warn('hydrate_tweet: cannot extract numeric tweet id, falling back to translate', tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'no_id_fallback',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    return true;
  }

  const creds = await getTwitterCreds(supabase);
  if (!creds) {
    console.error('hydrate_tweet: Twitter creds not configured, falling back to truncated translate', tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'no_creds_fallback',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    await recordXApiCall(supabase, 'no_creds');
    return true;
  }

  const baseUrl = `https://api.x.com/2/tweets/${numericId}`;
  const queryParams = { 'tweet.fields': 'note_tweet,text,lang' };
  const fullUrl = `${baseUrl}?${Object.entries(queryParams).map(([k, v]) => `${hydratePercentEncode(k)}=${hydratePercentEncode(v)}`).join('&')}`;

  let auth: string;
  try {
    auth = await hydrateOauthHeader('GET', baseUrl, queryParams, creds.ck, creds.cs, creds.at, creds.ats);
  } catch (e) {
    console.error('hydrate_tweet: oauth signing failed', (e as Error).message);
    return false;
  }

  let res: Response;
  try {
    res = await fetch(fullUrl, { method: 'GET', headers: { Authorization: auth } });
  } catch (e) {
    console.error('hydrate_tweet: network error', (e as Error).message);
    await recordXApiCall(supabase, `network: ${(e as Error).message}`);
    return false; // retryable via handleJobFailure
  }

  await recordXApiCall(supabase, res.ok ? null : `http_${res.status}`);

  if (res.status === 404) {
    console.warn('hydrate_tweet: tweet not found on X (404), falling back to truncated translate', tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'x_api_404',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    return true;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('x-rate-limit-reset') || '0', 10);
    const waitSec = retryAfter > 0 ? Math.max(60, retryAfter - Math.floor(Date.now() / 1000)) : 900;
    throw new Error(`hydrate_tweet rate limited, retry after ${waitSec}s`);
  }

  if (res.status === 401 || res.status === 403) {
    const txt = await res.text().catch(() => '');
    console.error(`hydrate_tweet: auth failed ${res.status}`, txt.slice(0, 300));
    return false; // will retry, then dead-letter; admin must rotate creds
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`hydrate_tweet: HTTP ${res.status}`, txt.slice(0, 300));
    return false;
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch (e) {
    console.error('hydrate_tweet: invalid JSON', (e as Error).message);
    return false;
  }

  const data = (json.data || {}) as Record<string, unknown>;
  const noteTweet = (data.note_tweet || {}) as Record<string, unknown>;
  const fullText = (noteTweet.text as string) || (data.text as string) || '';
  const lang = (data.lang as string) || null;

  if (!fullText) {
    console.warn('hydrate_tweet: empty text from X API, falling back', tweetId);
    await supabase.from('posts').update({
      hydrated_at: new Date().toISOString(),
      hydration_source: 'x_api_empty',
    }).eq('tweet_id', tweetId);
    await queueTranslateAfterHydrate(supabase, tweetId, true);
    return true;
  }

  const updatePayload: Record<string, unknown> = {
    text_original: fullText,
    hydrated_at: new Date().toISOString(),
    hydration_source: 'x_api',
    is_truncated: false,
    // CRITICAL: invalidate the stale truncated translation so downstream
    // delivery gates (x-poster, telegram) won't pick up the old text before
    // the post-hydrate re-translation completes.
    translated_at: null,
    text_translated: null,
  };
  if (lang) updatePayload.lang_original = lang;

  const { error: updErr } = await supabase.from('posts').update(updatePayload).eq('tweet_id', tweetId);
  if (updErr) {
    console.error('hydrate_tweet: post update failed', updErr.message);
    return false;
  }

  console.log(`hydrate_tweet: success ${tweetId} (orig=${(post.text_original || '').length} chars → full=${fullText.length} chars)`);
  await queueTranslateAfterHydrate(supabase, tweetId, false);
  await maybeEnqueueResolveMedia(supabase, tweetId, fullText);
  return true;
}

// Inspect existing media rows + (optionally) hydrated text and enqueue a
// resolve_media job if any video signal is present. Safe to call multiple
// times; idempotency_key guards against duplicates.
async function maybeEnqueueResolveMedia(// deno-lint-ignore no-explicit-any
  supabase: any, tweetId: string, extraText?: string): Promise<void> {
  try {
    const { data: mediaRows } = await supabase
      .from('media')
      .select('kind, src_url')
      .eq('tweet_id', tweetId);

    const haystack: string[] = [];
    if (extraText) haystack.push(extraText);
    let hasVideoKind = false;
    for (const m of (mediaRows || []) as Array<{ kind?: string; src_url?: string }>) {
      if (m.kind === 'video' || m.kind === 'gif') hasVideoKind = true;
      if (m.src_url) haystack.push(m.src_url);
    }
    const blob = haystack.join(' ');
    const hasSignal = hasVideoKind
      || /video\.twimg\.com/i.test(blob)
      || /(tweet_video_thumb|amplify_video_thumb|ext_tw_video_thumb)/i.test(blob)
      || /pic\.twitter\.com\//i.test(blob);

    if (!hasSignal) return;

    const { error: jobErr } = await supabase.from('jobs').upsert({
      type: 'resolve_media',
      payload: { tweet_id: tweetId },
      status: 'pending',
      priority: 12,
      idempotency_key: `resolve_media:${tweetId}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

    if (jobErr) {
      console.warn('maybeEnqueueResolveMedia: job upsert failed', jobErr.message);
      return;
    }
    await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'queued',
      null, new Date().toISOString(), null, { source: 'hydrate' });
    console.log('maybeEnqueueResolveMedia: enqueued resolve_media for', tweetId);
  } catch (e) {
    console.warn('maybeEnqueueResolveMedia: unexpected error', (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// resolve_media: zero-X-API video/media discovery via public proxies.
// Mirrors the client-side Downloader page logic so we don't burn quota.
// ───────────────────────────────────────────────────────────────────────────

type ResolvedVariant = { url: string; bitrate?: number; content_type?: string };
type ResolvedMediaRow = {
  kind: 'video' | 'image' | 'gif';
  url: string;
  width?: number;
  height?: number;
  duration_ms?: number;
};

function rmUpgradeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('twimg.com')) {
      u.searchParams.set('name', 'orig');
      return u.toString();
    }
  } catch { /* noop */ }
  return url;
}

function rmPickBestVariant(variants: ResolvedVariant[]): ResolvedVariant | undefined {
  const mp4s = variants.filter((v) => (v.content_type ?? '').includes('mp4') || v.url.includes('.mp4'));
  const pool = mp4s.length ? mp4s : variants;
  return [...pool].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

async function rmFetchFromFx(handle: string, id: string): Promise<ResolvedMediaRow[] | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${handle}/status/${id}`);
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const t = (json?.tweet ?? {}) as Record<string, unknown>;
    const media = (t.media ?? {}) as Record<string, unknown>;
    const out: ResolvedMediaRow[] = [];

    const videos = (media.videos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const v of videos) {
      const variants = (v.variants as ResolvedVariant[] | undefined) ?? [];
      let url = (v.url as string) || '';
      if (variants.length) {
        const best = rmPickBestVariant(variants);
        if (best?.url) url = best.url;
      }
      if (!url) continue;
      // fxtwitter returns `duration` in SECONDS (often fractional, e.g. 5.9).
      // Our media.duration_ms column is INTEGER → must convert + round.
      const rawDur = v.duration as number | undefined;
      const durMs = typeof rawDur === 'number' && isFinite(rawDur)
        ? Math.round(rawDur * 1000) : null;
      out.push({
        kind: (v.type as string) === 'gif' ? 'gif' : 'video',
        url,
        width: v.width as number | undefined,
        height: v.height as number | undefined,
        duration_ms: durMs ?? undefined,
      });
    }

    const photos = (media.photos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of photos) {
      const url = p.url as string | undefined;
      if (!url) continue;
      out.push({
        kind: 'image',
        url: rmUpgradeImageUrl(url),
        width: p.width as number | undefined,
        height: p.height as number | undefined,
      });
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn('resolve_media: fxtwitter failed', (e as Error).message);
    return null;
  }
}

async function rmFetchFromVx(handle: string, id: string): Promise<ResolvedMediaRow[] | null> {
  try {
    const res = await fetch(`https://api.vxtwitter.com/${handle}/status/${id}`);
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const extended = (json.media_extended as Array<Record<string, unknown>> | undefined) ?? [];
    const out: ResolvedMediaRow[] = [];
    for (const m of extended) {
      const type = String(m.type || '');
      const url = m.url as string | undefined;
      if (!url) continue;
      if (type === 'video' || type === 'gif') {
        out.push({
          kind: type === 'gif' ? 'gif' : 'video',
          url,
          duration_ms: m.duration_millis as number | undefined,
        });
      } else if (type === 'image') {
        out.push({ kind: 'image', url: rmUpgradeImageUrl(url) });
      }
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn('resolve_media: vxtwitter failed', (e as Error).message);
    return null;
  }
}

async function handleResolveMediaJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || '');
  if (!tweetId) {
    console.error('resolve_media: missing tweet_id');
    return false;
  }

  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, url, author_handle, has_media')
    .eq('tweet_id', tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error('resolve_media: post not found', tweetId, postErr?.message);
    return false;
  }

  const numericId = extractNumericTweetId(tweetId, post.url as string | null);
  const handle = (post.author_handle as string | null) || extractHandleFromUrl(post.url as string | null) || 'i';
  if (!numericId) {
    console.warn('resolve_media: cannot extract numeric tweet id, giving up', tweetId);
    // Don't block delivery — proceed with whatever media we already have.
    return true;
  }

  let resolved = await rmFetchFromFx(handle, numericId);
  let source: 'fxtwitter' | 'vxtwitter' | null = resolved ? 'fxtwitter' : null;
  if (!resolved) {
    resolved = await rmFetchFromVx(handle, numericId);
    if (resolved) source = 'vxtwitter';
  }

  if (!resolved || resolved.length === 0) {
    console.warn('resolve_media: no media found via proxies', tweetId);
    await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'failed',
      null, new Date().toISOString(), 'no_media_via_proxy', { handle, numericId });
    // Don't fail the job hard — let delivery proceed with text.
    return true;
  }

  // Build rows FIRST (and validate). Only after a successful upsert do we
  // prune stale rows. Previous flow deleted everything up-front, so any
  // insert error (e.g. type mismatch) wiped the tweet's media permanently.
  // IMPORTANT: explicitly clear storage_path / downloaded_at / file_size /
  // mime_type. The pre-resolve row at ordering=0 is usually the RSS
  // thumbnail (a .jpg already in storage). Without nulling these, the upsert
  // would overwrite src_url/kind to "video" but leave the stale jpg bytes
  // attached, and download_media (which filters `storage_path IS NULL`)
  // would skip the row — causing x-poster to upload the thumbnail bytes as
  // the "video" and Telegram to send it as a document.
  const rows = await Promise.all(resolved.map(async (m, index) => ({
    tweet_id: tweetId,
    kind: m.kind,
    src_url: m.url,
    src_url_hash: await hashUrl(m.url),
    width: m.width != null ? Math.round(m.width) : null,
    height: m.height != null ? Math.round(m.height) : null,
    duration_ms: m.duration_ms != null ? Math.round(m.duration_ms) : null,
    ordering: index,
    storage_path: null,
    downloaded_at: null,
    file_size: null,
    mime_type: null,
  })));

  const { error: insErr } = await supabase.from('media').upsert(rows, { onConflict: 'tweet_id,ordering' });
  if (insErr) {
    console.error('resolve_media: insert failed', insErr.message);
    await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'failed',
      null, new Date().toISOString(), `upsert_failed: ${insErr.message}`, { handle, numericId, count: rows.length });
    return false;
  }

  // Prune any leftover higher-ordering rows from a previous (longer) resolution.
  const { error: prnErr } = await supabase.from('media')
    .delete().eq('tweet_id', tweetId).gte('ordering', rows.length);
  if (prnErr) console.warn('resolve_media: prune leftover rows failed', prnErr.message);

  // Make sure has_media is true so deliver attaches files.
  await supabase.from('posts').update({ has_media: true }).eq('tweet_id', tweetId);

  // Trigger the existing download_media flow to pull bytes into temp-media.
  // Use a distinct idempotency key from the initial RSS-thumbnail download:
  // the original `download_media:<tweet_id>` job is already `completed`, so reusing
  // it would no-op (ignoreDuplicates) and the freshly-resolved video/image rows
  // would never be fetched into storage.
  // Use a per-invocation unique idempotency key. A static
  // `download_media:resolve:<tweet_id>` key would collide with a previously
  // completed job from an earlier resolve attempt and (with
  // ignoreDuplicates) get silently dropped — leaving freshly-resolved rows
  // with storage_path=null and causing text-only posts.
  const dlKey = `download_media:resolve:${tweetId}:${Date.now()}`;
  const { error: dlErr } = await supabase.from('jobs').insert({
    type: 'download_media',
    payload: { tweet_id: tweetId },
    status: 'pending',
    idempotency_key: dlKey,
    next_run_at: new Date().toISOString(),
  });
  if (dlErr) console.warn('resolve_media: failed to enqueue download_media', dlErr.message);

  await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'completed',
    null, new Date().toISOString(), null, { source, count: rows.length });

  console.log(`resolve_media: ${tweetId} resolved ${rows.length} item(s) via ${source}`);
  return true;
}

function extractHandleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\//i);
  return m ? m[1] : null;
}
