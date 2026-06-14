import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { callOpenAI, type ToolFunctionDef } from "../_shared/openai.ts";
import { isAutoEnrichmentEnabled, normalizeEnrichmentConfig, normalizePersonalVoiceProfile, normalizeVoiceGuide, runEnrichPipeline, type EnrichmentConfig, type VoiceSamples } from "../_shared/enrich.ts";
import {
  SCORE_AXIS_KEYS,
  type ScoreAxisKey,
  type ScoreAxes,
  parseScoreAxes,
  computeFinalScore,
  type EditorialProfile,
  type ProfileDecisionInput,
  type ProfileDecisionResult,
  applyProfileDecision,
} from "../_shared/scoring.ts";
import { requireInternalAuth, serviceRoleBearerHeader } from "../_shared/internalAuth.ts";
import {
  DEFAULT_DUPLICATE_GATE,
  normalizeDuplicateGateConfig,
  runDuplicateGate,
} from "../_shared/dedupe.ts";
import { duplicateDecisionPatch } from "../_shared/duplicateGuard.ts";
import { evaluateFinalDedupeGuard } from "../_shared/deliveryDedupeGuard.ts";
import {
  SCORING_POLICY_VERSION,
  buildScoringPolicyEventMeta,
  normalizeScoringPolicy,
  runScoringPolicy,
  type ScoringPolicyCalibrationExample,
  type ScoringPolicyResult,
} from "../_shared/scoringPolicy.ts";
import { applyLearnedFeedbackBias, type FeedbackBiasResult } from "../_shared/feedbackBias.ts";
import {
  AUTOCHAIN_DUE_WINDOW_MS,
  AUTOCHAIN_MAX_DEPTH,
  normalizeChainDepth,
  selectAutochainJobTypes,
  shouldAutochain,
} from "../_shared/workerAutochain.ts";
import { applyRenderedVideoPreference } from "../_shared/videoRenderGate.ts";
import type { XMediaRow } from "../_shared/mediaSelection.ts";
import {
  extractHandleFromUrl,
  extractMediaFromText,
  extractNumericTweetId,
  formatMessageWithTemplate,
  hashUrl,
  isTelegramParseError,
  jobError,
  jobLane,
  jobTimingMeta,
  maxBatchSizeForJobTypes,
  stripMarkdownToPlain,
} from "./workerUtils.ts";
import {
  handleJobFailure,
  insertPipelineEvent,
  mergeJobResultMeta,
  NonRetryableJobError,
  recordPipelineEvent,
} from "./jobLifecycle.ts";
import {
  enqueuePostDeliveryAfterRenderGate as enqueuePostDeliveryAfterRenderGateCore,
  markVideoRenderPosted,
  prepareVideoRenderGate,
  VIDEO_RENDER_DEFER_MS,
} from "./videoRenderWorkflow.ts";
import {
  computeAdaptiveSpacing,
  getMediaUrl,
  sendTelegramMedia,
  sendTelegramPhotoFromStorage,
  sendTelegramPhotoGroupFromStorage,
  sendTelegramVideoFromStorage,
  throwTelegramError,
} from "./telegramDelivery.ts";
import {
  countDailyHydrationsUsed,
  getTwitterCreds,
  hydrateOauthHeader,
  hydratePercentEncode,
  loadHydrationSettings,
  recordXApiCall,
} from "./xApiWorkflow.ts";
import {
  buildResolvedMediaRows,
  buildResolveMediaDownloadJob,
  rmFetchFromFx,
  rmFetchFromVx,
} from "./mediaWorkflow.ts";
import {
  buildClassifierToolFunction,
  parseClassifierToolCallArguments,
  renderScoringSystemPrompt,
  renderScoringUserMessage,
  resolveScoringCallOptions,
} from "./scoringWorkflow.ts";
import {
  renderTranslationUserPrompt as renderTranslationUserPromptText,
} from "./translateWorkflow.ts";

export {
  SCORE_AXIS_KEYS,
  type ScoreAxisKey,
  type ScoreAxes,
  parseScoreAxes,
  computeFinalScore,
  type EditorialProfile,
  type ProfileDecisionInput,
  type ProfileDecisionResult,
  applyProfileDecision,
} from "../_shared/scoring.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};

const SETTINGS_CACHE_MS = 45_000;
// deno-lint-ignore no-explicit-any
let configCache: { expiresAt: number; value: any } | null = null;

// deno-lint-ignore no-explicit-any
async function loadScoringCalibrationExamples(supabase: any, profileId: string): Promise<ScoringPolicyCalibrationExample[]> {
  try {
    const { data, error } = await supabase
      .from('scoring_examples')
      .select('text_original, author_handle, expected_audience_class, expected_decision, expected_score, expected_global_exception_class, note')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(8);
    if (error) throw error;
    return (data ?? []) as ScoringPolicyCalibrationExample[];
  } catch (error) {
    console.warn('worker: failed to load scoring calibration examples:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

class JobDeferred extends Error {
  nextRunAt: string;
  meta: Record<string, unknown>;

  constructor(message: string, delayMs = VIDEO_RENDER_DEFER_MS, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'JobDeferred';
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.meta = meta;
  }
}

type EdgeRuntimeWithWaitUntil = { waitUntil?: (promise: Promise<unknown>) => void };

function scheduleBackground(promise: Promise<unknown>): boolean {
  const edgeRuntime = (globalThis as { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Load config from settings table with fallback defaults
// deno-lint-ignore no-explicit-any
async function loadConfig(supabase: any, options: { bypassCache?: boolean } = {}): Promise<any> {
  if (!options.bypassCache && configCache && configCache.expiresAt > Date.now()) {
    return configCache.value;
  }

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
    storyMemory: {
      ...DEFAULT_DUPLICATE_GATE,
    },
    scoringPolicy: normalizeScoringPolicy(null),
  };

  try {
      const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['translation_prompt', 'message_template', 'content_filter', 'editorial_profiles', 'active_profile_id', 'story_memory', 'scoring_policy']);

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
        if (s.key === 'story_memory' && typeof s.value === 'object' && s.value !== null) {
          defaults.storyMemory = normalizeDuplicateGateConfig({ ...defaults.storyMemory, ...s.value as Record<string, unknown> });
        }
        if (s.key === 'scoring_policy' && typeof s.value === 'object' && s.value !== null) {
          defaults.scoringPolicy = normalizeScoringPolicy(s.value);
        }
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

  configCache = { expiresAt: Date.now() + SETTINGS_CACHE_MS, value: defaults };
  return defaults;
}

// deno-lint-ignore no-explicit-any
async function handleDedupeJob(job: Record<string, unknown>, supabase: any, config: Awaited<ReturnType<typeof loadConfig>>, enqueueNext: boolean): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  if (!tweetId) throw new Error('dedupe: missing tweet_id in job payload');
  const sm = config.storyMemory;
  if (!sm?.enabled) {
    if (enqueueNext) await queueTranslateFromDedupe(supabase, tweetId, payload.post_hydrate === true);
    return true;
  }

  const { data: post, error } = await supabase
    .from('posts')
    .select('tweet_id, text_translated, text_original, author_handle, url, created_at, delivery_decision, decision_reason, feedback_locked')
    .eq('tweet_id', tweetId)
    .single();
  if (error || !post) {
    console.warn(JSON.stringify({ function: 'worker', action: 'dedupe_no_post', tweet_id: tweetId }));
    return true;
  }

  await markDedupePending(supabase, tweetId, payload.post_hydrate === true ? 'running:post_hydrate' : `running:${String(job.type)}`);
  const result = await runDuplicateGate(supabase, post, sm, {
    force: payload.force === true,
    source: payload.post_hydrate === true ? 'post_hydrate' : String(job.type),
  });
  if (!result.ok) {
    console.warn(JSON.stringify({
      function: 'worker',
      action: result.retryable ? 'dedupe_failed_retry' : 'dedupe_failed_closed',
      tweet_id: tweetId,
      error: result.error ?? result.reason,
      failure_phase: result.failure_phase ?? null,
      retryable: result.retryable === true,
      enqueue_translate: false,
    }));
    if (result.retryable) {
      throw new Error(`dedupe_retryable:${result.failure_phase ?? 'unknown'}:${result.error ?? result.reason}`);
    }
    return true;
  }
  if (enqueueNext && result.should_enqueue_translate) {
    await queueTranslateFromDedupe(supabase, tweetId, payload.post_hydrate === true);
  }
  console.log(JSON.stringify({
    function: 'worker',
    action: 'dedupe_complete',
    tweet_id: tweetId,
    status: result.status,
    method: result.method,
    dup_of: result.dup_of_tweet_id,
    confidence: result.confidence,
    enqueue_translate: enqueueNext && result.should_enqueue_translate,
  }));
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const authError = await requireInternalAuth(req, supabase, corsHeaders);
  if (authError) return authError;

  try {
    let requestBody: Record<string, unknown> = {};
    try {
      requestBody = await req.json();
    } catch (_e) {
      requestBody = {};
    }
    const requestedJobTypes = Array.isArray(requestBody.job_types)
      ? requestBody.job_types.map((type) => String(type)).filter(Boolean)
      : null;
    const batchCap = maxBatchSizeForJobTypes(requestedJobTypes);
    const requestedBatchSize = typeof requestBody.batch_size === 'number' && Number.isFinite(requestBody.batch_size)
      ? Math.max(1, Math.min(batchCap, Math.floor(requestBody.batch_size)))
      : batchCap;
    const chainDepth = normalizeChainDepth(requestBody.chain_depth);
    const bypassSettingsCache = requestBody.bypass_settings_cache === true || requestBody.admin === true || requestBody.manual === true;
    const startTime = Date.now();
    console.log(JSON.stringify({
      function: 'worker',
      action: 'start',
      trigger: req.url,
      job_types: requestedJobTypes,
      chain_depth: chainDepth,
      batch_size: requestedBatchSize,
      batch_cap: batchCap,
    }));

    // Load runtime config
    const config = await loadConfig(supabase, { bypassCache: bypassSettingsCache });

    // Use claim_jobs RPC for transactional job claiming
    const { data: jobs, error: claimError } = await supabase
      .rpc('claim_jobs', {
        batch_size: requestedBatchSize,
        job_types: requestedJobTypes,
        worker_id: 'worker-' + crypto.randomUUID().slice(0, 8),
      });

    if (claimError) {
      console.error(JSON.stringify({ function: 'worker', action: 'claim_error', error: claimError.message }));
      throw claimError;
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
            case 'dedupe':
              success = await handleDedupeJob(job, supabase, config, true);
              break;
            case 'compute_signature':
              success = await handleDedupeJob(job, supabase, config, false);
              break;
            case 'enrich':
              success = await handleEnrichJob(job, supabase);
              break;
            default:
              throw new Error(`Unknown job type: ${String(job.type)}`);
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

            const completionMeta = jobTimingMeta(job, 'completed');
            await mergeJobResultMeta(supabase, job, completionMeta);
            await recordPipelineEvent(supabase, job, 'completed', undefined, completionMeta);
            console.log(JSON.stringify({ function: 'worker', action: 'job_complete', job_id: job.id, type: job.type }));
            return { success: true, jobId: job.id };
          } else {
            const jt = String(job.type);
            const failure = new Error(`${jt}: handler returned false (check worker logs for ${jt}_* / job_error)`);
            await handleJobFailure(
              supabase,
              job,
              failure,
            );
            await recordPipelineEvent(supabase, job, 'failed', failure.message);
            return { success: false, jobId: job.id };
          }

        } catch (error) {
          if (error instanceof JobDeferred) {
            await supabase
              .from('jobs')
              .update({
                status: 'pending',
                next_run_at: error.nextRunAt,
                locked_at: null,
                locked_by: null,
                lease_expires_at: null,
                last_error: null,
              })
              .eq('id', job.id);
            await recordPipelineEvent(supabase, job, 'queued', undefined, {
              deferred: true,
              next_run_at: error.nextRunAt,
              ...error.meta,
            });
            console.log(JSON.stringify({
              function: 'worker',
              action: 'job_deferred',
              job_id: job.id,
              type: job.type,
              next_run_at: error.nextRunAt,
              reason: error.message,
            }));
            return { success: false, deferred: true, jobId: job.id, reason: error.message };
          }
          const err = jobError(error);
          console.error(JSON.stringify({ function: 'worker', action: 'job_error', job_id: job.id, type: job.type, error: err.message }));
          await handleJobFailure(supabase, job, err);
          await recordPipelineEvent(supabase, job, 'failed', err.message);
          return { success: false, jobId: job.id, error: err.message };
        }
      } catch (error) {
        const err = jobError(error);
        console.error(JSON.stringify({ function: 'worker', action: 'job_outer_error', job_id: job.id, type: job.type, error: err.message }));
        await handleJobFailure(supabase, job, err);
        await recordPipelineEvent(supabase, job, 'failed', err.message);
        return { success: false, jobId: job.id, error: err.message };
      }
    });

    const results = await Promise.allSettled(jobPromises);
    
    let processedCount = 0;
    let failedCount = 0;
    let deferredCount = 0;
    
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        processedCount++;
      } else if (result.status === 'fulfilled' && result.value.deferred) {
        deferredCount++;
      } else {
        failedCount++;
      }
    });

    const latencyMs = Date.now() - startTime;
    console.log(JSON.stringify({ function: 'worker', action: 'complete', processed: processedCount, deferred: deferredCount, failed: failedCount, latency_ms: latencyMs }));

    // Auto-chain due-now queue work with a hard depth cap. This cuts scheduler
    // wait without reintroducing unbounded DB-triggered function churn.
    try {
      const autochainTypes = selectAutochainJobTypes(requestedJobTypes);
      const dueCutoff = new Date(Date.now() + AUTOCHAIN_DUE_WINDOW_MS).toISOString();
      const { count: pendingCount, error: pendingError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('type', autochainTypes)
        .or(`next_run_at.is.null,next_run_at.lte.${dueCutoff}`);

      if (pendingError) throw pendingError;
      const duePendingCount = pendingCount ?? 0;
      if (autochainTypes.length > 0 && shouldAutochain({ chainDepth, pendingCount: duePendingCount, maxDepth: AUTOCHAIN_MAX_DEPTH })) {
        console.log(JSON.stringify({
          function: 'worker',
          action: 'autochain',
          due_pending: duePendingCount,
          chain_depth: chainDepth,
          next_chain_depth: chainDepth + 1,
          job_types: autochainTypes,
        }));
        await supabase.functions.invoke('worker', {
          body: {
            trigger: 'autochain',
            batch_size: requestedBatchSize,
            chain_depth: chainDepth + 1,
            job_types: autochainTypes,
          },
          headers: serviceRoleBearerHeader(),
        } as Record<string, unknown>);
      }
    } catch (error) {
      console.warn(JSON.stringify({ function: 'worker', action: 'autochain_skipped', error: jobError(error).message }));
    }

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      deferred: deferredCount,
      failed: failedCount,
      total: jobs.length,
      chain_depth: chainDepth,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(JSON.stringify({ function: 'worker', action: 'fatal', error: jobError(error).message }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// deno-lint-ignore no-explicit-any
async function enqueuePostDeliveryAfterRenderGate(supabase: any, tweetId: string, source = 'worker', resetExisting = true) {
  return enqueuePostDeliveryAfterRenderGateCore(supabase, tweetId, source, resetExisting, {
    dispatchXPosterForTarget,
  });
}

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
      .select('tweet_id, text_original, text_translated, account_id, url, tweeted_at, has_media, author_handle, is_truncated, hydrated_at, dedupe_status, dup_of_tweet_id, dedupe_reason, feedback_locked, importance_score, importance_tags, importance_reasoning, score_axes, final_score, delivery_decision, decision_reason, score_breakdown, accounts!inner(handle, display_name)')
      .eq('tweet_id', tweetId)
      .single();

    if (error || !post) {
      throw new Error(`Post not found: ${tweetId}`);
    }

    if (!post.text_original) {
      throw new Error('No original text to translate');
    }

    const initialDuplicatePatch = duplicateDecisionPatch(post as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null });
    if (initialDuplicatePatch) {
      const nowIso = new Date().toISOString();
      const { error: dupSkipUpdateError } = await supabase
        .from('posts')
        .update({
          delivery_decision: initialDuplicatePatch.delivery_decision,
          decision_reason: initialDuplicatePatch.decision_reason,
        })
        .eq('tweet_id', tweetId);
      if (dupSkipUpdateError) throw dupSkipUpdateError;
      console.log(JSON.stringify({ function: 'worker', action: 'translate_skip_duplicate_gate', tweet_id: tweetId, reason: initialDuplicatePatch.decision_reason }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'translate', 'skipped', null, nowIso, null, {
        reason: 'duplicate_gate',
        decision_reason: initialDuplicatePatch.decision_reason,
      });
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, nowIso, null, {
        skipped: 'duplicate_gate',
        decision: 'skip',
      });
      return true;
    }

    const forceScoringV2 = payload.scoring_policy_v2 === true;
    const scoringPolicyConfigured = config.scoringPolicy?.enabled === true || forceScoringV2;
    const legacyFilterEnabled = config.contentFilter.enabled || config.contentFilter.score_only;
    const filterEnabled = scoringPolicyConfigured || legacyFilterEnabled;
    const scoreOnly = config.contentFilter.score_only && !config.contentFilter.enabled;
    const authorHandle = post.author_handle as string | null;

    let translatedText = '';
    let importanceScore: number | null = null;
    let importanceTags: string[] | null = null;
    let importanceReasoning: string | null = null;
    let data: Record<string, unknown> = {};
    let scoringUsage: Record<string, unknown> | null = null;
    let translationUsage: Record<string, unknown> | null = null;
    let translationSkippedByFilter = false;
    let scoringCallMs: number | null = null;
    let translationCallMs: number | null = null;
    const measureScoringCall = async <T>(fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        scoringCallMs = (scoringCallMs ?? 0) + (Date.now() - started);
      }
    };
    const measureTranslationCall = async <T>(fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        translationCallMs = (translationCallMs ?? 0) + (Date.now() - started);
      }
    };
    let scoreAxes: ScoreAxes | null = null;
    const feedbackLocked = post.feedback_locked === true;
    if (feedbackLocked) {
      importanceScore = typeof post.importance_score === 'number' ? post.importance_score : Number(post.importance_score ?? NaN) || null;
      importanceTags = Array.isArray(post.importance_tags) ? post.importance_tags as string[] : null;
      importanceReasoning = typeof post.importance_reasoning === 'string' ? post.importance_reasoning : null;
      scoreAxes = parseScoreAxes(post.score_axes);
      console.log(JSON.stringify({ function: 'worker', action: 'score_skip_feedback_locked', tweet_id: tweetId, score: importanceScore, final_score: post.final_score }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'score', 'skipped', null, new Date().toISOString(), null, {
        reason: 'feedback_locked',
        final_score: post.final_score,
        importance_score: importanceScore,
        scoring_call_ms: scoringCallMs,
      });
    }

    const {
      model: scoringModel,
      temperature: scoringTemperature,
      maxOutputTokens: scoringMaxTokens,
      topP: scoringTopP,
      reasoningEffort: scoringReasoningEffort,
      verbosity: scoringVerbosity,
      seed: scoringSeed,
      serviceTier: scoringServiceTier,
      parallelToolCalls: scoringParallelTools,
    } = resolveScoringCallOptions(config);

    const accountData = (post as Record<string, unknown>).accounts as Record<string, unknown> | null;
    const authorDisplay = authorHandle || (accountData?.handle as string) || 'unknown';
    const accountName = (accountData?.display_name as string) || '';
    const publishedAt = post.tweeted_at ? new Date(post.tweeted_at as string).toISOString() : 'unknown';

    const buildUserMessage = () => renderScoringUserMessage({
      textOriginal: String(post.text_original || ''),
      authorDisplay,
      accountName,
      publishedAt,
      hasMedia: !!post.has_media,
      url: post.url as string | null,
    });

    const buildToolFunction = (includeTranslatedText: boolean): Record<string, unknown> =>
      buildClassifierToolFunction(config.classifierToolSchema, includeTranslatedText);

    const renderSystemPrompt = () => renderScoringSystemPrompt({
      scoringSystemPrompt: config.scoringSystemPrompt,
      translationPrompt: config.translationPrompt,
      priorityTopics: config.contentFilter.priority_topics,
      lowPriorityTopics: config.contentFilter.low_priority_topics,
      editorialGuidelines: config.contentFilter.editorial_guidelines,
    });

    // Helper: render translation user prompt from template (or default)
    const renderTranslationUserPrompt = () => renderTranslationUserPromptText({
      template: config.userPromptTemplate,
      content: post.text_original as string,
      authorDisplay,
      accountName,
      publishedAt,
    });

    // ============ SPLIT PATH: score first, translate only on pass ============
    let scoringPolicyResult: ScoringPolicyResult | null = null;
    const scoringPolicyEnabled = scoringPolicyConfigured;
    const scoringPolicyActive = scoringPolicyEnabled && (config.scoringPolicy?.mode === 'active' || forceScoringV2);
    let splitDecisionState: FeedbackBiasResult | null = null;

    const activeFeedbackThreshold = () => {
      if (typeof config.editorialProfile?.threshold === 'number') return config.editorialProfile.threshold;
      const authorRule = authorHandle ? config.contentFilter.author_rules[authorHandle] : null;
      if (authorRule?.rule === 'custom_threshold' && authorRule.threshold != null) {
        return authorRule.threshold;
      }
      return config.contentFilter.default_threshold;
    };

    const buildBaseDecisionState = (): Omit<FeedbackBiasResult, 'scoreBreakdown'> => {
      if (feedbackLocked) {
        const lockedFinalScore = typeof post.final_score === 'number'
          ? post.final_score
          : Number(post.final_score ?? NaN) || importanceScore;
        return {
          deliveryDecision: post.delivery_decision === 'skip' ? 'skip' : 'deliver',
          decisionReason: typeof post.decision_reason === 'string' ? post.decision_reason : 'feedback_locked',
          finalScore: lockedFinalScore,
        };
      }
      let deliveryDecision = 'deliver';
      let decisionReason: string | null = null;
      let finalScore: number | null = scoringPolicyActive && scoringPolicyResult
        ? scoringPolicyResult.final_score
        : scoreAxes ? computeFinalScore(scoreAxes) : (importanceScore ?? null);

      if (filterEnabled && scoringPolicyActive && scoringPolicyResult && !scoreOnly) {
        deliveryDecision = scoringPolicyResult.delivery_decision;
        decisionReason = scoringPolicyResult.decision_reason;
        finalScore = scoringPolicyResult.final_score;
        importanceScore = Math.round(scoringPolicyResult.final_score);
        importanceTags = scoringPolicyResult.tags;
        importanceReasoning = scoringPolicyResult.audience_reason;
        scoreAxes = scoringPolicyResult.axes as ScoreAxes;
        console.log(JSON.stringify({
          function: 'worker',
          action: 'filter_decision_v2',
          tweet_id: tweetId,
          decision: deliveryDecision,
          final_score: finalScore,
          audience_class: scoringPolicyResult.audience_class,
          profile: scoringPolicyResult.profile_id,
          reason: decisionReason,
        }));
      } else if (legacyFilterEnabled && importanceScore !== null && !scoreOnly) {
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
      } else if (!legacyFilterEnabled && !scoringPolicyActive) {
        decisionReason = 'filter_disabled';
      }

      return { deliveryDecision, decisionReason, finalScore };
    };

    const applyFeedbackBiasToDecision = async (
      state: Omit<FeedbackBiasResult, 'scoreBreakdown'>,
    ): Promise<FeedbackBiasResult> => {
      if (feedbackLocked) {
        return {
          ...state,
          scoreBreakdown: post.score_breakdown && typeof post.score_breakdown === 'object'
            ? post.score_breakdown as Record<string, unknown>
            : null,
        };
      }
      if (state.finalScore === null) {
        return { ...state, scoreBreakdown: null };
      }
      try {
        const { data: biasRow } = await supabase.from('settings').select('value').eq('key', 'learned_biases').maybeSingle();
        let knnPrior = 0;
        const { data: sigRow } = await supabase.from('story_signatures').select('embedding').eq('tweet_id', tweetId).maybeSingle();
        if (sigRow?.embedding) {
          const { data: knnVal } = await supabase.rpc('knn_feedback_prior', { query_embedding: sigRow.embedding, exclude_tweet_id: tweetId });
          knnPrior = typeof knnVal === 'number' ? knnVal : 0;
        }

        return applyLearnedFeedbackBias({
          deliveryDecision: state.deliveryDecision,
          decisionReason: state.decisionReason,
          finalScore: state.finalScore,
          filterEnabled,
          scoreOnly,
          threshold: activeFeedbackThreshold(),
          authorHandle,
          tags: importanceTags,
          learnedBiases: biasRow?.value ?? {},
          knnPrior,
          scoringV2: scoringPolicyResult ? buildScoringPolicyEventMeta(scoringPolicyResult, scoringPolicyActive ? 'active' : 'shadow') : null,
        });
      } catch (biasErr) {
        console.warn('feedback bias (non-fatal):', (biasErr as Error).message);
        return { ...state, scoreBreakdown: null };
      }
    };

    if (feedbackLocked) {
      splitDecisionState = await applyFeedbackBiasToDecision(buildBaseDecisionState());
      const preDecision = splitDecisionState.deliveryDecision;
      console.log(JSON.stringify({
        function: 'worker',
        action: 'pre_translation_gate_feedback_locked',
        tweet_id: tweetId,
        decision: preDecision,
        final_score: splitDecisionState.finalScore,
        reason: splitDecisionState.decisionReason,
      }));

      if (preDecision === 'deliver' || scoreOnly) {
        if (typeof post.text_translated === 'string' && post.text_translated.trim()) {
          translatedText = post.text_translated;
        } else {
          console.log(JSON.stringify({ function: 'worker', action: 'translate_call_start', tweet_id: tweetId, model: config.openaiModel, reasoning_effort: config.openaiReasoningEffort, source: 'feedback_locked' }));
          const trResult = await measureTranslationCall(() => callOpenAI({
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
          }));
          if (!trResult.ok) {
            throw new Error(`OpenAI translation error: ${trResult.status} ${trResult.rawText}`);
          }
          translationUsage = (trResult.raw?.usage as Record<string, unknown> | undefined) ?? null;
          data = trResult.raw;
          translatedText = trResult.content;
          console.log(JSON.stringify({ function: 'worker', action: 'translate_complete', tweet_id: tweetId, chars: translatedText.length, source: 'feedback_locked' }));
        }
      } else {
        translationSkippedByFilter = true;
        console.log(JSON.stringify({ function: 'worker', action: 'translate_skipped_feedback_locked', tweet_id: tweetId, score: importanceScore }));
        await insertPipelineEvent(supabase, 'post', tweetId, 'translate', 'skipped', null, new Date().toISOString(), null, {
          reason: 'feedback_locked_skip',
          score: importanceScore,
          scoring_call_ms: scoringCallMs,
        });
      }
    } else if (filterEnabled && config.splitCalls) {
      if (scoringPolicyEnabled) {
        console.log(JSON.stringify({
          function: 'worker',
          action: 'score_v2_start',
          tweet_id: tweetId,
          mode: scoringPolicyActive ? 'active' : 'shadow',
          model: scoringModel,
        }));
        const calibrationExamples = await loadScoringCalibrationExamples(
          supabase,
          config.scoringPolicy.active_profile_id,
        );
        scoringPolicyResult = await measureScoringCall(() => runScoringPolicy({
          tweet_id: tweetId,
          text: String(post.text_original || ''),
          author_handle: authorHandle,
          account_name: accountName,
          url: post.url as string | null,
          published_at: publishedAt,
        }, config.scoringPolicy, {
          apiKey: openaiApiKey,
          model: scoringModel,
          maxOutputTokens: scoringMaxTokens,
          temperature: scoringTemperature,
          topP: scoringTopP,
          reasoningEffort: scoringReasoningEffort,
          verbosity: scoringVerbosity,
          seed: scoringSeed,
          serviceTier: scoringServiceTier,
          parallelToolCalls: scoringParallelTools,
        }, {
          calibrationExamples,
        }));
        if (!scoringPolicyResult.ok) {
          throw new Error(`OpenAI scoring v2 error: ${scoringPolicyResult.error ?? scoringPolicyResult.audience_reason}`);
        }
        await insertPipelineEvent(
          supabase,
          'post',
          tweetId,
          'score',
          'completed',
          null,
          new Date().toISOString(),
          null,
          {
            ...buildScoringPolicyEventMeta(scoringPolicyResult, scoringPolicyActive ? 'active' : 'shadow'),
            scoring_call_ms: scoringCallMs,
            model: scoringModel,
          },
        );
      }

      if (!scoringPolicyActive && legacyFilterEnabled) {
      const scoreToolFunction = buildToolFunction(false);

      console.log(JSON.stringify({ function: 'worker', action: 'score_start', tweet_id: tweetId, model: scoringModel, reasoning_effort: scoringReasoningEffort }));

      const scoreResult = await measureScoringCall(() => callOpenAI({
        apiKey: openaiApiKey,
        model: scoringModel,
        messages: [
          { role: 'system', content: renderSystemPrompt() },
          { role: 'user', content: buildUserMessage() },
        ],
        tool: scoreToolFunction as unknown as ToolFunctionDef,
        maxOutputTokens: scoringMaxTokens,
        temperature: scoringTemperature,
        topP: scoringTopP,
        reasoningEffort: scoringReasoningEffort,
        verbosity: scoringVerbosity,
        seed: scoringSeed,
        serviceTier: scoringServiceTier,
        parallelToolCalls: scoringParallelTools,
      }));

      if (!scoreResult.ok) {
        throw new Error(`OpenAI scoring error: ${scoreResult.status} ${scoreResult.rawText}`);
      }
      scoringUsage = (scoreResult.raw?.usage as Record<string, unknown> | undefined) ?? null;
      data = scoreResult.raw;

      if (scoreResult.toolCall) {
        try {
          const parsedScore = parseClassifierToolCallArguments(scoreResult.toolCall.arguments);
          importanceScore = parsedScore.importanceScore;
          importanceTags = parsedScore.importanceTags;
          importanceReasoning = parsedScore.importanceReasoning;
          scoreAxes = parsedScore.scoreAxes;
          console.log(JSON.stringify({ function: 'worker', action: 'scored', tweet_id: tweetId, score: importanceScore, axes: scoreAxes, tags: importanceTags, reasoning: importanceReasoning, endpoint: scoreResult.endpoint, model: scoringModel }));
          await insertPipelineEvent(supabase, 'post', tweetId, 'score', 'completed', null, new Date().toISOString(), null, {
            score: importanceScore,
            axes: scoreAxes,
            model: scoringModel,
            scoring_call_ms: scoringCallMs,
          });
        } catch (parseErr) {
          console.warn('Failed to parse score tool call:', (parseErr as Error).message);
        }
      }
      }

      // Decide gate BEFORE translating. Learned feedback must be applied here,
      // otherwise a below-threshold item can skip translation and later become
      // deliverable via feedback_boost with no Persian text persisted.
      splitDecisionState = await applyFeedbackBiasToDecision(buildBaseDecisionState());
      const preDecision = splitDecisionState.deliveryDecision;
      console.log(JSON.stringify({
        function: 'worker',
        action: 'pre_translation_gate',
        tweet_id: tweetId,
        decision: preDecision,
        final_score: splitDecisionState.finalScore,
        reason: splitDecisionState.decisionReason,
      }));

      // Translate only if passing the gate (or in score_only mode where we still translate everything)
      if (preDecision === 'deliver' || scoreOnly) {
        console.log(JSON.stringify({ function: 'worker', action: 'translate_call_start', tweet_id: tweetId, model: config.openaiModel, reasoning_effort: config.openaiReasoningEffort }));
        const trResult = await measureTranslationCall(() => callOpenAI({
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
        }));
        if (!trResult.ok) {
          throw new Error(`OpenAI translation error: ${trResult.status} ${trResult.rawText}`);
        }
        translationUsage = (trResult.raw?.usage as Record<string, unknown> | undefined) ?? null;
        translatedText = trResult.content;
        console.log(JSON.stringify({ function: 'worker', action: 'translate_complete', tweet_id: tweetId, chars: translatedText.length }));
      } else {
        translationSkippedByFilter = true;
        console.log(JSON.stringify({ function: 'worker', action: 'translate_skipped_by_filter', tweet_id: tweetId, score: importanceScore }));
        await insertPipelineEvent(supabase, 'post', tweetId, 'translate', 'skipped', null, new Date().toISOString(), null, {
          reason: 'translation_skipped_not_needed',
          score: importanceScore,
          scoring_call_ms: scoringCallMs,
        });
      }
    } else if (filterEnabled) {
      // ============ COMBINED PATH (legacy, when split_calls = false) ============
      const toolFunction = buildToolFunction(true);
      const result = await measureTranslationCall(() => callOpenAI({
        apiKey: openaiApiKey,
        model: config.openaiModel,
        messages: [
          { role: 'system', content: renderSystemPrompt() },
          { role: 'user', content: buildUserMessage() },
        ],
        tool: toolFunction as unknown as ToolFunctionDef,
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
      }));
      scoringCallMs = scoringCallMs ?? translationCallMs;
      if (!result.ok) throw new Error(`OpenAI API error: ${result.status} ${result.rawText}`);
      data = result.raw;
      if (result.toolCall) {
        try {
          const parsedScore = parseClassifierToolCallArguments(result.toolCall.arguments, { includeTranslatedText: true });
          translatedText = parsedScore.translatedText || '';
          importanceScore = parsedScore.importanceScore;
          importanceTags = parsedScore.importanceTags;
          importanceReasoning = parsedScore.importanceReasoning;
          scoreAxes = parsedScore.scoreAxes;
          console.log(JSON.stringify({ function: 'worker', action: 'scored', tweet_id: tweetId, score: importanceScore, axes: scoreAxes, tags: importanceTags, reasoning: importanceReasoning, endpoint: result.endpoint }));
          await insertPipelineEvent(supabase, 'post', tweetId, 'score', 'completed', null, new Date().toISOString(), null, {
            score: importanceScore,
            axes: scoreAxes,
            model: config.openaiModel,
            scoring_call_ms: scoringCallMs,
            translation_call_ms: translationCallMs,
            combined_model_call: true,
          });
        } catch (parseErr) {
          console.warn('Failed to parse tool call, falling back to content:', (parseErr as Error).message);
          translatedText = result.content;
        }
      } else {
        translatedText = result.content;
      }
    } else {
      // No filtering — simple translation
      const result = await measureTranslationCall(() => callOpenAI({
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
      }));
      if (!result.ok) {
        throw new Error(`OpenAI API error: ${result.status} ${result.rawText}`);
      }
      data = result.raw;
      translatedText = result.content;
    }

    // GUARD: Empty translation = silent failure mode.
    // Reasoning models (gpt-5.x-mini etc.) can burn the entire max_completion_tokens
    // budget on hidden reasoning, returning a tool call with empty `translated_text`
    // or empty content. If we persist that, `text_translated is not null` passes the
    // delivery gate and Telegram's template falls back to the English original — so
    // the user sees an English tweet delivered "without translation". Treat empty
    // output as a transient failure and let the job retry.
    if (!translationSkippedByFilter && (!translatedText || !String(translatedText).trim())) {
      const finishReason = (data?.choices?.[0]?.finish_reason as string | undefined)
        ?? (data?.status as string | undefined)
        ?? 'unknown';
      const usage = data?.usage ?? null;
      console.warn(JSON.stringify({
        function: 'worker', action: 'empty_translation', tweet_id: tweetId,
        model: config.openaiModel, finish_reason: finishReason, usage,
      }));
      throw new Error(`empty_translation: model=${config.openaiModel} finish_reason=${finishReason} (likely reasoning-token budget exhausted; raise openai_max_completion_tokens or lower reasoning_effort)`);
    }

    const nowIso = new Date().toISOString();
    const resultMeta = {
      model: config.openaiModel,
      scoring_model: scoringModel,
      usage: data.usage ?? null,
      scoring_usage: scoringUsage,
      translation_usage: translationUsage,
      scoring_v2_usage: scoringPolicyResult?.usage ?? null,
      scoring_call_ms: scoringCallMs,
      translation_call_ms: translationCallMs,
      queue_wait_ms: jobTimingMeta(job, 'running').queue_wait_ms,
      claim_delay_ms: jobTimingMeta(job, 'running').claim_delay_ms,
      finished_at: nowIso,
      importance_score: importanceScore,
      scoring_version: scoringPolicyResult ? SCORING_POLICY_VERSION : null,
      split_calls: !!(filterEnabled && config.splitCalls),
    };
    try {
      await supabase.from('jobs').update({ result_meta: resultMeta }).eq('id', job.id);
    } catch (_e) { /* best-effort */ }

    // Determine delivery decision based on active editorial profile or legacy
    // content filter. In split mode this was already computed before translation
    // so feedback-boosted posts could receive a translation before delivery.
    const finalDecisionState = splitDecisionState ?? await applyFeedbackBiasToDecision(buildBaseDecisionState());
    let duplicatePatch: ReturnType<typeof duplicateDecisionPatch> = null;
    try {
      const { data: latestDedupe } = await supabase
        .from('posts')
        .select('dedupe_status, dup_of_tweet_id, dedupe_reason')
        .eq('tweet_id', tweetId)
        .maybeSingle();
      duplicatePatch = duplicateDecisionPatch(latestDedupe as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null } | null);
    } catch (dedupeCheckErr) {
      console.warn('latest dedupe check failed (continuing)', (dedupeCheckErr as Error).message);
    }
    const deliveryDecision = duplicatePatch?.delivery_decision ?? finalDecisionState.deliveryDecision;
    const decisionReason = duplicatePatch?.decision_reason ?? finalDecisionState.decisionReason;
    const finalScore = finalDecisionState.finalScore;
    const scoreBreakdown = finalDecisionState.scoreBreakdown;

    const { error: updateError } = await supabase
      .from('posts')
      .update({
        ...(translationSkippedByFilter ? {} : {
          text_translated: translatedText,
          lang_original: 'en',
          translated_at: nowIso,
          translation_model: config.openaiModel,
          translation_tokens: (data?.usage as { total_tokens?: number } | undefined)?.total_tokens ?? null,
          translation_duration_ms: job.started_at ? (Date.now() - new Date(job.started_at as string).getTime()) : null,
        }),
        importance_score: importanceScore,
        importance_tags: importanceTags,
        importance_reasoning: importanceReasoning,
        delivery_decision: deliveryDecision,
        score_axes: scoreAxes ?? null,
        final_score: finalScore,
        decision_reason: decisionReason,
        score_breakdown: scoreBreakdown,
        ...(scoringPolicyResult ? {
          scoring_version: SCORING_POLICY_VERSION,
          scoring_profile_id: scoringPolicyResult.profile_id,
          audience_class: scoringPolicyResult.audience_class,
          audience_confidence: scoringPolicyResult.audience_confidence,
          audience_reason: scoringPolicyResult.audience_reason,
          global_exception_class: scoringPolicyResult.global_exception_class,
          score_review_status: scoringPolicyActive ? scoringPolicyResult.review_status : 'shadow',
        } : {}),
      })
      .eq('tweet_id', tweetId);

    if (updateError) throw updateError;

    // Decide what to enqueue next based on filter decision + truncation state.
    // NEW FLOW: If a tweet PASSED the editorial gate AND is still truncated AND
    // not yet hydrated, enqueue hydrate_tweet instead of deliver. The hydrate
    // job will re-enqueue translate on success, which will fall through to
    // deliver on the second pass (is_truncated will be false by then).
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
      // Enrichment is an optional X-draft layer. In manual-only mode the main
      // pipeline must continue with plain translation delivery.
      let autoEnrichEnabled = false;
      try {
        const { data: enrichCfgRow } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'enrichment_config')
          .maybeSingle();
        const enrichConfig = normalizeEnrichmentConfig((enrichCfgRow?.value ?? { enabled: false }) as Partial<EnrichmentConfig>);
        autoEnrichEnabled = isAutoEnrichmentEnabled(enrichConfig);
      } catch (_e) { /* default to disabled */ }

      if (autoEnrichEnabled) {
        const enrichKey = `enrich:${tweetId}`;
        const { error: enrichJobError } = await supabase
          .from('jobs')
          .upsert({
            type: 'enrich',
            payload: { tweet_id: tweetId },
            status: 'pending',
            priority: 18,
            idempotency_key: enrichKey,
            next_run_at: new Date().toISOString(),
          }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        if (enrichJobError) {
          console.warn('Failed to enqueue enrich job:', enrichJobError);
        } else {
          await insertPipelineEvent(supabase, 'post', tweetId, 'enrich', 'queued', null, null, null, { source: 'translate' });
          console.log(JSON.stringify({ function: 'worker', action: 'enrich_enqueued', tweet_id: tweetId }));
        }
        // Enrichment v2 is shadow/review-first for X, but Telegram delivery
        // remains translation-first and should not wait on enrichment approval.
        await enqueuePostDeliveryAfterRenderGate(supabase, tweetId, 'translate', false);
      } else {
        await enqueuePostDeliveryAfterRenderGate(supabase, tweetId, 'worker', true);
      }
    } else {
      console.log(JSON.stringify({ function: 'worker', action: 'delivery_skipped', tweet_id: tweetId, score: importanceScore, decision: deliveryDecision }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, nowIso, null, {
        skipped: duplicatePatch ? 'duplicate_gate' : 'content_filter',
        score: importanceScore,
        decision: deliveryDecision,
        decision_reason: decisionReason,
      });
    }
    
    return true;
  } catch (error) {
    const e = jobError(error);
    const tid = (job.payload as Record<string, unknown> | undefined)?.tweet_id;
    console.error(JSON.stringify({
      function: 'worker',
      action: 'translate_error',
      tweet_id: tid ?? 'unknown',
      error: e.message,
      name: e.name,
    }));
    if (tid != null && typeof tid === 'string') {
      throw new Error(`translate[${tid}]: ${e.message}`);
    }
    throw e;
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
    const e = jobError(error);
    console.error(JSON.stringify({ function: 'worker', action: 'moderate_error', error: e.message }));
    throw e;
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
      .select('tweet_id, text_original, text_translated, url, tweeted_at, has_media, account_id, author_handle')
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
      .select('id, kind, src_url, storage_path, ordering, downloaded_at, mime_type, file_size, duration_ms, width, height')
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

    // Duplicate Gate is expected to run before translation, but keep this
    // delivery-time guard as a final idempotent safety check.
    const finalGuard = await evaluateFinalDedupeGuard({
      supabase,
      tweetId,
      storyMemory: config.storyMemory,
      source: 'telegram_final_assertion',
    });
    if (finalGuard.action === 'skip') {
      console.log(JSON.stringify({
        function: 'worker',
        action: finalGuard.reason === 'final_duplicate_assertion' ? 'deliver_skip_final_duplicate_assertion' : 'deliver_skip_story_dup',
        tweet_id: tweetId,
        ...finalGuard.meta,
      }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, finalGuard.meta);
      return true;
    }
    if (finalGuard.action === 'fail') {
      console.warn(JSON.stringify({
        function: 'worker',
        action: 'deliver_deferred_dedupe_assertion_failed',
        tweet_id: tweetId,
        error: finalGuard.error,
      }));
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'failed', null, new Date().toISOString(), finalGuard.error, finalGuard.meta);
      return false;
    }

    const renderGate = await prepareVideoRenderGate(supabase, tweetId, 'telegram_delivery');
    if (renderGate.blocked) {
      await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, {
        skipped: 'video_render_blocked',
        reason: renderGate.blockReason,
        gate_action: renderGate.decision.action,
      });
      console.log(JSON.stringify({
        function: 'worker',
        action: 'deliver_skip_video_render_blocked',
        tweet_id: tweetId,
        reason: renderGate.blockReason,
      }));
      return true;
    }
    if (!renderGate.ready) {
      throw new JobDeferred(`video_render_pending:${renderGate.decision.action}`, VIDEO_RENDER_DEFER_MS, {
        tweet_id: tweetId,
        gate_action: renderGate.decision.action,
      });
    }
    const deliveryMedia = applyRenderedVideoPreference(renderGate.mediaRows.length > 0 ? renderGate.mediaRows : ((media as XMediaRow[] | null) ?? []), renderGate.decision);

    const message = formatMessageWithTemplate(post, account, messageTemplate);
    let telegramMessageIds: string[] = [];
    const telegramStartedAt = Date.now();
    const telegramMethods: string[] = [];
    const addTelegramMethod = (method: string) => {
      if (!telegramMethods.includes(method)) telegramMethods.push(method);
    };

    const deliveryMediaRecords = deliveryMedia as Array<Record<string, unknown>>;
    if (deliveryMediaRecords && deliveryMediaRecords.length > 0) {
      const images = deliveryMediaRecords.filter((m: Record<string, unknown>) => m.kind === 'image');
      const videos = deliveryMediaRecords.filter((m: Record<string, unknown>) => m.kind === 'video');
      const audios = deliveryMediaRecords.filter((m: Record<string, unknown>) => m.kind === 'audio');

      if (images.length > 0) {
        if (images.length === 1) {
          const image = images[0];
          addTelegramMethod('sendPhoto');
          const msgIds = await sendTelegramPhotoFromStorage(supabase, telegramBotToken, telegramChatId, image, message);
          telegramMessageIds.push(...msgIds);
        } else {
          addTelegramMethod('sendMediaGroup');
          const msgIds = await sendTelegramPhotoGroupFromStorage(supabase, telegramBotToken, telegramChatId, images.slice(0, 10), message);
          telegramMessageIds.push(...msgIds);
        }
      }

      for (const video of videos) {
        addTelegramMethod('sendVideo');
        const msgIds = await sendTelegramVideoFromStorage(supabase, telegramBotToken, telegramChatId, video, message);
        telegramMessageIds.push(...msgIds);
      }

      for (const audio of audios) {
        addTelegramMethod('sendAudio');
        const audioUrl = await getMediaUrl(supabase, audio);
        const caption = images.length === 0 && videos.length === 0 ? message : 'Audio from tweet';
        const msgIds = await sendTelegramMedia('sendAudio', telegramBotToken, telegramChatId, { audio: audioUrl }, caption);
        telegramMessageIds.push(...msgIds);
      }
    } else {
      addTelegramMethod('sendMessage');
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

    await insertPipelineEvent(supabase, 'post', tweetId, 'deliver', 'completed', null, new Date().toISOString(), null, {
      message_ids: telegramMessageIds,
      telegram_api_ms: Date.now() - telegramStartedAt,
      telegram_method: telegramMethods.join('+') || 'unknown',
      message_count: telegramMessageIds.length,
    });
    await markVideoRenderPosted(supabase, tweetId);
    return true;

  } catch (error) {
    const e = jobError(error);
    console.error(JSON.stringify({ function: 'worker', action: 'deliver_error', tweet_id: tweetId, error: e.message }));
    if (error instanceof NonRetryableJobError) {
      throw new NonRetryableJobError(`deliver[${tweetId}]: ${e.message}`);
    }
    throw new Error(`deliver[${tweetId}]: ${e.message}`);
  }
}

// ─── handleEnrichJob: 5-agent editorial pipeline ────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleEnrichJob(job: Record<string, unknown>, supabase: any): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  const forceReview = payload.force_review === true;
  if (!tweetId) throw new Error('enrich: missing tweet_id in job payload');

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) throw new Error('enrich: OPENAI_API_KEY not set');

  console.log(JSON.stringify({ function: 'worker', action: 'enrich_start', tweet_id: tweetId }));

  // Load post
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, text_original, text_translated, importance_score, delivery_decision, author_handle, url, created_at')
    .eq('tweet_id', tweetId)
    .single();
  if (postErr || !post) throw new Error(`enrich: post not found: ${tweetId}`);
  if (!post.text_translated) throw new Error(`enrich: no translation for ${tweetId}`);

  // Load enrichment_config
  const { data: configRow } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'enrichment_config')
    .single();
  const enrichConfig = normalizeEnrichmentConfig((configRow?.value ?? { enabled: false }) as Partial<EnrichmentConfig>);
  if (!enrichConfig.enabled && !forceReview) {
    // Enrichment disabled -- mark skipped and pass through to deliver (unless manual test)
    await supabase.from('posts').update({ enrich_status: 'skipped' }).eq('tweet_id', tweetId);
    await enqueueDeliverAfterEnrich(supabase, tweetId);
    console.log(JSON.stringify({ function: 'worker', action: 'enrich_skipped_disabled', tweet_id: tweetId }));
    return true;
  }

  // Load @masihh voice guide/profile plus secondary voice samples.
  const { data: voiceRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['voice_samples', 'voice_guide', 'personal_voice_profile']);
  const voiceSettings = new Map((voiceRows ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
  const voiceSamples = (voiceSettings.get('voice_samples') ?? { samples: [], updated_at: null }) as VoiceSamples;
  const voiceGuide = normalizeVoiceGuide(voiceSettings.get('voice_guide'));
  const voiceProfile = normalizePersonalVoiceProfile(voiceSettings.get('personal_voice_profile'));

  // Get recent formats for variety (avoid last 3, not just 1)
  const { data: recentFormatPosts } = await supabase
    .from('posts')
    .select('post_format_hint')
    .eq('delivery_decision', 'deliver')
    .not('post_format_hint', 'is', null)
    .neq('tweet_id', tweetId)
    .order('created_at', { ascending: false })
    .limit(3);
  const recentFormats = (recentFormatPosts || []).map((p: { post_format_hint: string }) => p.post_format_hint).filter(Boolean) as string[];
  const previousFormatUsed = recentFormats.length > 0 ? recentFormats.join(',') : null;

  let sameSourceRecentCount = 0;
  if (post.author_handle) {
    const since = new Date(Date.now() - enrichConfig.same_source_window_hours * 3600 * 1000).toISOString();
    const { count } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('author_handle', post.author_handle)
      .gte('created_at', since)
      .neq('tweet_id', tweetId);
    sameSourceRecentCount = count ?? 0;
  }

  // Mark enrichment in progress
  await supabase.from('posts').update({ enrich_status: 'pending' }).eq('tweet_id', tweetId);
  const startedAt = new Date().toISOString();
  await insertPipelineEvent(supabase, 'post', tweetId, 'enrich', 'running', startedAt);

  try {
    const result = await runEnrichPipeline({
      supabase,
      apiKey: openaiApiKey,
      config: enrichConfig,
      voiceSamples,
      voiceGuide,
      voiceProfile,
      tweetId,
      textOriginal: post.text_original,
      textTranslated: post.text_translated,
      importanceScore: post.importance_score,
      previousFormatUsed,
      sourceUrl: post.url,
      sourceLabel: post.author_handle,
      sameSourceRecentCount,
    });

    // Store results. Shadow/review mode is conservative: no auto-delivery until
    // the critic/gate proves trustworthy and the setting is deliberately relaxed.
    const autoCanComplete = !forceReview && !enrichConfig.require_approval && enrichConfig.review_mode === 'auto_high_confidence';
    const enrichStatus = result.publishRecommendation === 'reject'
      ? 'rejected'
      : autoCanComplete && result.publishRecommendation === 'approve'
        ? 'completed'
        : 'awaiting_approval';
    const sourceContextWithVoice = {
      ...result.composer.source_context,
      voice: {
        ...(result.composer.source_context.voice ?? {}),
        profile_version: voiceProfile.version,
        intent: result.composer.intent,
        language_choice: result.composer.language_choice,
        selected_variant: result.composer.selected_variant,
        variants: result.composer.variants,
        critic: result.voiceCritic,
      },
    };

    await supabase.from('posts').update({
      enrichment_version: enrichConfig.version,
      background_context: result.researcher ? result.researcher : null,
      editorial_commentary: result.analyst.commentary,
      humanized_commentary: result.humanizer.humanized_commentary,
      commentary_hook: result.humanizer.humanized_hook,
      commentary_question: result.humanizer.humanized_question,
      narrative_callback: result.archivist?.callback_suggestion ?? null,
      narrative_ref_post_id: result.archivist?.referenced_post_id ?? null,
      composed_post_text: result.composer.opinion_section,
      creator_angle: result.composer.creator_angle,
      why_it_matters: result.composer.why_it_matters,
      source_context: sourceContextWithVoice,
      algorithm_signal_scores: result.critic.algorithm_signal_scores,
      aggregator_risk_score: result.critic.aggregator_risk_score,
      ai_voice_risk_score: result.critic.ai_voice_risk_score,
      monetization_risk_flags: result.critic.monetization_risk_flags,
      enrichment_review_reason: result.enrichmentReviewReason,
      final_x_text: result.composer.final_x_text,
      post_format_hint: result.composer.format_used,
      thread_continuation: result.composer.thread_continuation,
      enrich_status: enrichStatus,
      enrich_model: enrichConfig.model,
      enrich_tokens: result.totalTokens,
      enrich_duration_ms: result.durationMs,
    }).eq('tweet_id', tweetId);

    await supabase.from('post_enrichments').insert({
      post_id: tweetId,
      version: enrichConfig.version,
      status: enrichStatus,
      model: enrichConfig.model,
      creator_angle: result.composer.creator_angle,
      why_it_matters: result.composer.why_it_matters,
      source_context: sourceContextWithVoice,
      algorithm_signal_scores: result.critic.algorithm_signal_scores,
      aggregator_risk_score: result.critic.aggregator_risk_score,
      ai_voice_risk_score: result.critic.ai_voice_risk_score,
      monetization_risk_flags: result.critic.monetization_risk_flags,
      enrichment_review_reason: result.enrichmentReviewReason,
      final_x_text: result.composer.final_x_text,
      thread_continuation: result.composer.thread_continuation,
      format_used: result.composer.format_used,
      critic_output: {
        critic: result.critic,
        voice_critic: result.voiceCritic,
        voice_variants: result.composer.variants,
        voice_intent: result.composer.intent,
        language_choice: result.composer.language_choice,
        selected_variant: result.composer.selected_variant,
        anti_aggregator: result.antiAggregator,
        publish_recommendation: result.publishRecommendation,
      },
    });

    const endedAt = new Date().toISOString();
    await insertPipelineEvent(supabase, 'post', tweetId, 'enrich', 'completed', startedAt, endedAt, null, {
      tokens: result.totalTokens,
      duration_ms: result.durationMs,
      format: result.composer.format_used,
      has_callback: result.archivist?.has_callback ?? false,
      status: enrichStatus,
      publish_recommendation: result.publishRecommendation,
      aggregator_risk_score: result.critic.aggregator_risk_score,
      ai_voice_risk_score: result.critic.ai_voice_risk_score,
      risk_flags: result.critic.monetization_risk_flags,
    });

    // If not requiring approval AND not a manual test, enqueue deliver immediately
    if (enrichStatus === 'completed') {
      await enqueueDeliverAfterEnrich(supabase, tweetId);
    }

    console.log(JSON.stringify({
      function: 'worker', action: 'enrich_complete', tweet_id: tweetId,
      tokens: result.totalTokens, duration_ms: result.durationMs,
      format: result.composer.format_used, awaiting_approval: forceReview || enrichConfig.require_approval,
    }));
    return true;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    await supabase.from('posts').update({ enrich_status: 'failed' }).eq('tweet_id', tweetId);
    await insertPipelineEvent(supabase, 'post', tweetId, 'enrich', 'failed', startedAt, new Date().toISOString(), err.message);
    throw err;
  }
}

// deno-lint-ignore no-explicit-any
async function enqueueDeliverAfterEnrich(supabase: any, tweetId: string, source = 'enrich', resetExisting = true) {
  await enqueuePostDeliveryAfterRenderGate(supabase, tweetId, source, resetExisting);
}

async function handleDownloadMediaJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    const started = Date.now();
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'running', new Date(started).toISOString());
    
    const { data, error } = await supabase.functions.invoke('media-processor', {
      body: { action: 'download_media', tweet_id: tweetId },
      headers: serviceRoleBearerHeader(),
    } as Record<string, unknown>);

    if (error) throw new Error(`Media processor error: ${error.message}`);
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'completed', new Date(started).toISOString(), new Date().toISOString(), null, {
      media_download_ms: Date.now() - started,
      result: data ?? null,
    });
    return true;
  } catch (error) {
    const e = jobError(error);
    await insertPipelineEvent(supabase, 'post', tweetId, 'media', 'failed', null, null, e.message);
    throw new Error(`download_media[${tweetId}]: ${e.message}`);
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

    if (await isDuplicateGateEnabled(supabase)) {
      await supabase.from('jobs').upsert({
        type: 'dedupe',
        payload: { tweet_id: tweetId, force: true, source: 'reprocess' },
        status: 'pending',
        priority: 30,
        idempotency_key: `dedupe:reprocess:${tweetId}`,
        next_run_at: new Date().toISOString(),
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      await markDedupePending(supabase, tweetId, 'queued:reprocess');
      await insertPipelineEvent(supabase, 'post', tweetId, 'dedupe', 'queued', new Date().toISOString(), null, null, { source: 'reprocess' });
    } else {
      await supabase.from('jobs').upsert({
        type: 'translate', payload: { tweet_id: tweetId }, status: 'pending',
        idempotency_key: `translate:reprocess:${tweetId}`, next_run_at: new Date().toISOString()
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    }

    return true;
  } catch (error) {
    const e = jobError(error);
    console.error(JSON.stringify({ function: 'worker', action: 'reprocess_error', tweet_id: tweetId, error: e.message }));
    throw new Error(`reprocess[${tweetId}]: ${e.message}`);
  }
}

async function dispatchXPosterForTarget(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string, source: string): Promise<void> {
  const meta = {
    dispatch_source: source,
    target_tweet_id: tweetId,
    gated: true,
  };
  await insertPipelineEvent(supabase, 'post', tweetId, 'x_dispatch', 'queued', new Date().toISOString(), null, null, meta);
  const invokePromise = supabase.functions.invoke('x-poster', {
    body: {
      source: 'worker-dispatch',
      target_tweet_id: tweetId,
    },
    headers: serviceRoleBearerHeader(),
  } as Record<string, unknown>).then(({ error }: { error?: { message?: string } | null }) => {
    if (error) {
      return insertPipelineEvent(supabase, 'post', tweetId, 'x_dispatch', 'failed', null, new Date().toISOString(), error.message ?? 'x-poster invoke failed', meta);
    }
    return undefined;
  }).catch((error: unknown) => insertPipelineEvent(
    supabase,
    'post',
    tweetId,
    'x_dispatch',
    'failed',
    null,
    new Date().toISOString(),
    error instanceof Error ? error.message : String(error),
    meta,
  ));

  if (!scheduleBackground(invokePromise)) {
    await Promise.race([invokePromise, sleep(1500)]);
  }
}

// deno-lint-ignore no-explicit-any
async function getChatIdForJob(_job: Record<string, unknown>, _supabase: any): Promise<string | null> {
  try { return Deno.env.get('TELEGRAM_CHAT_ID') || null; } catch (_e) { return null; }
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

async function queueTranslateFromDedupe(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string, postHydrate = false): Promise<void> {
  const idempotencyKey = postHydrate ? `translate:hydrate:${tweetId}` : `translate:${tweetId}`;
  await supabase.from('jobs').upsert({
    type: 'translate',
    payload: { tweet_id: tweetId, ...(postHydrate ? { post_hydrate: true } : {}) },
    status: 'pending',
    priority: 10,
    idempotency_key: idempotencyKey,
    next_run_at: new Date().toISOString(),
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

  try {
    await supabase.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'translate',
      status: 'queued',
      started_at: new Date().toISOString(),
      meta: { source: postHydrate ? 'dedupe_after_hydrate' : 'dedupe' },
    });
  } catch { /* best-effort */ }
}

async function markDedupePending(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string, reason: string): Promise<void> {
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

async function isDuplicateGateEnabled(// deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'story_memory').maybeSingle();
    return normalizeDuplicateGateConfig(data?.value ?? DEFAULT_DUPLICATE_GATE).enabled;
  } catch {
    return DEFAULT_DUPLICATE_GATE.enabled;
  }
}

async function queueDedupeOrTranslateAfterHydrate(// deno-lint-ignore no-explicit-any
supabase: any, tweetId: string): Promise<void> {
  if (!(await isDuplicateGateEnabled(supabase))) {
    await queueTranslateAfterHydrate(supabase, tweetId, false);
    return;
  }

  await supabase.from('jobs').upsert({
    type: 'dedupe',
    payload: { tweet_id: tweetId, post_hydrate: true },
    status: 'pending',
    priority: 30,
    idempotency_key: `dedupe:hydrate:${tweetId}`,
    next_run_at: new Date().toISOString(),
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  await markDedupePending(supabase, tweetId, 'queued:hydrate');

  try {
    await supabase.from('pipeline_events').insert({
      subject_type: 'post',
      subject_id: tweetId,
      step: 'dedupe',
      status: 'queued',
      started_at: new Date().toISOString(),
      meta: { source: 'hydrate' },
    });
  } catch { /* best-effort */ }
}

async function handleHydrateTweetJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || '');
  if (!tweetId) {
    console.error('hydrate_tweet: missing tweet_id');
    throw new Error('hydrate_tweet: missing tweet_id in job payload');
  }

  // Load post; idempotent if already hydrated
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, text_original, url, hydrated_at, is_truncated')
    .eq('tweet_id', tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error('hydrate_tweet: post not found', tweetId, postErr?.message);
    throw new Error(`hydrate_tweet[${tweetId}]: post not found${postErr?.message ? `: ${postErr.message}` : ''}`);
  }

  if (post.hydrated_at) {
    console.log('hydrate_tweet: already hydrated, ensuring post-hydrate pipeline exists', tweetId);
    await queueDedupeOrTranslateAfterHydrate(supabase, tweetId);
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
    throw new Error(`hydrate_tweet[${tweetId}]: oauth_signing_failed: ${(e as Error).message}`);
  }

  let res: Response;
  try {
    res = await fetch(fullUrl, { method: 'GET', headers: { Authorization: auth } });
  } catch (e) {
    console.error('hydrate_tweet: network error', (e as Error).message);
    await recordXApiCall(supabase, `network: ${(e as Error).message}`, null, numericId);
    throw new Error(`hydrate_tweet[${tweetId}]: network_error: ${(e as Error).message}`);
  }

  await recordXApiCall(supabase, res.ok ? null : `http_${res.status}`, res, numericId);

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
    throw new Error(`hydrate_tweet[${tweetId}]: x_api_auth_${res.status}: ${txt.slice(0, 500)}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`hydrate_tweet: HTTP ${res.status}`, txt.slice(0, 300));
    throw new Error(`hydrate_tweet[${tweetId}]: x_api_http_${res.status}: ${txt.slice(0, 500)}`);
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch (e) {
    console.error('hydrate_tweet: invalid JSON', (e as Error).message);
    throw new Error(`hydrate_tweet[${tweetId}]: invalid_x_api_json: ${(e as Error).message}`);
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
    throw new Error(`hydrate_tweet[${tweetId}]: post_update_failed: ${updErr.message}`);
  }

  console.log(`hydrate_tweet: success ${tweetId} (orig=${(post.text_original || '').length} chars → full=${fullText.length} chars)`);
  await queueDedupeOrTranslateAfterHydrate(supabase, tweetId);
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

async function handleResolveMediaJob(job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
supabase: any): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || '');
  if (!tweetId) {
    console.error('resolve_media: missing tweet_id');
    throw new Error('resolve_media: missing tweet_id in job payload');
  }

  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('tweet_id, url, author_handle, has_media')
    .eq('tweet_id', tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error('resolve_media: post not found', tweetId, postErr?.message);
    throw new Error(`resolve_media[${tweetId}]: post not found${postErr?.message ? `: ${postErr.message}` : ''}`);
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
  const rows = await buildResolvedMediaRows(tweetId, resolved);

  const { error: insErr } = await supabase.from('media').upsert(rows, { onConflict: 'tweet_id,ordering' });
  if (insErr) {
    console.error('resolve_media: insert failed', insErr.message);
    await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'failed',
      null, new Date().toISOString(), `upsert_failed: ${insErr.message}`, { handle, numericId, count: rows.length });
    throw new Error(`resolve_media[${tweetId}]: media_upsert_failed: ${insErr.message}`);
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
  const { error: dlErr } = await supabase.from('jobs').insert(buildResolveMediaDownloadJob(tweetId));
  if (dlErr) console.warn('resolve_media: failed to enqueue download_media', dlErr.message);

  await insertPipelineEvent(supabase, 'post', tweetId, 'resolve_media', 'completed',
    null, new Date().toISOString(), null, { source, count: rows.length });

  console.log(`resolve_media: ${tweetId} resolved ${rows.length} item(s) via ${source}`);
  return true;
}
