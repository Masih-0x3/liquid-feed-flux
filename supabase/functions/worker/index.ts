import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  callOpenAI,
  type NormalizedOpenAIResponse,
  type OpenAICallParams,
  type ToolFunctionDef,
} from "../_shared/openai.ts";
import {
  estimateFoglampSpans,
  finishWorkflowRun,
  recordObservedOpenAICall,
  recordObservedProviderCall,
  startWorkflowRun,
} from "../_shared/observability.ts";
import {
  repairTranslationReadability,
  translationReadabilityMeta,
} from "../_shared/translationReadability.ts";
import {
  type EnrichmentConfig,
  isAutoEnrichmentEnabled,
  normalizeEnrichmentConfig,
  normalizePersonalVoiceProfile,
  normalizeVoiceGuide,
  runEnrichPipeline,
  type VoiceSamples,
} from "../_shared/enrich.ts";
import {
  parseScoreAxes,
  SCORE_AXIS_KEYS,
  type ScoreAxes,
  type ScoreAxisKey,
} from "../_shared/scoring.ts";
import {
  requireInternalAuth,
  serviceRoleBearerHeader,
} from "../_shared/internalAuth.ts";
import {
  captureEdgeException,
  captureEdgeExceptionBackground,
  initSentryEdge,
} from "../_shared/sentry.ts";
import {
  DEFAULT_DUPLICATE_GATE,
  fetchObservedStoryEmbedding,
  normalizeDuplicateGateConfig,
  runDuplicateGate,
} from "../_shared/dedupe.ts";
import { clampOpenAiMaxCompletionTokens } from "../_shared/openaiCostControls.ts";
import { duplicateDecisionPatch } from "../_shared/duplicateGuard.ts";
import { evaluateFinalDedupeGuard } from "../_shared/deliveryDedupeGuard.ts";
import {
  buildScoringPolicyEventMeta,
  normalizeScoringPolicy,
  runScoringPolicy,
  SCORING_POLICY_VERSION,
  type ScoringPolicyCalibrationExample,
  type ScoringPolicyResult,
} from "../_shared/scoringPolicy.ts";
import {
  applyLearnedFeedbackBias,
  type FeedbackBiasResult,
  normalizeKnnFeedbackPriorDetails,
  priorFromKnnFeedbackDetails,
} from "../_shared/feedbackBias.ts";
import {
  AUTOCHAIN_DUE_WINDOW_MS,
  AUTOCHAIN_MAX_DEPTH,
  normalizeChainDepth,
  selectAutochainJobTypes,
  shouldAutochain,
} from "../_shared/workerAutochain.ts";
import { applyRenderedVideoPreference } from "../_shared/videoRenderGate.ts";
import {
  resolveEffectiveThreshold,
  type EffectiveThresholdEnvelope,
} from "../_shared/effectiveThreshold.ts";
import type { XMediaRow } from "../_shared/mediaSelection.ts";
import {
  isProcessedRenderStoragePath,
  repairStaleMediaObject,
  StaleMediaObjectError,
} from "../_shared/staleMediaRepair.ts";
import {
  extractHandleFromUrl,
  extractMediaFromText,
  extractNumericTweetId,
  formatMessageWithTemplate,
  isTelegramParseError,
  jobError,
  jobLane,
  jobTimingMeta,
  laneCapacityFor,
  maxBatchSizeForJobTypes,
  parseRetryAfterFromMessage,
  runJobsWithLaneCapacity,
  stripMarkdownToPlain,
} from "./workerUtils.ts";
import {
  handleJobFailure,
  insertPipelineEvent,
  JobStateWriteError,
  claimEnvelopedPatch,
  markJobProviderStarted,
  mergeJobResultMeta,
  NonRetryableJobError,
  recordPipelineEvent,
  updateJobOrThrow,
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
  claimTelegramDelivery,
  completeTelegramDelivery,
  markTelegramDeliveryAmbiguous,
  startTelegramDelivery,
} from "./telegramDeliveryClaim.ts";
import {
  buildHydratedTweetPatch,
  countDailyHydrationsUsed,
  getTwitterCreds,
  hydrateOauthHeader,
  hydratePercentEncode,
  loadHydrationSettings,
  recordXApiCall,
} from "./xApiWorkflow.ts";
import {
  buildMediaProcessorDownloadInvokeOptions,
  buildResolvedMediaRows,
  buildResolveMediaDownloadJob,
  rmFetchFromFx,
  rmFetchFromVx,
} from "./mediaWorkflow.ts";
import { filterReviewedRemoteMediaItems } from "../_shared/remoteMediaPolicy.ts";
import {
  fetchRuntimeControls,
  type RuntimeControls,
} from "../_shared/runtimeControls.ts";
import { requireExternalPosting } from "../_shared/externalPostingGuard.ts";
import {
  DeliveryCutoverBlockedError,
  requireDeliveryCutover,
  settleDeliveryCutoverJob,
} from "../_shared/deliveryCutover.ts";
import {
  buildClassifierToolFunction,
  buildScoringBaseDecisionState,
  parseClassifierToolCallArguments,
  renderScoringSystemPrompt,
  renderScoringUserMessage,
  resolveActiveFeedbackThreshold,
  resolveScoringCallOptions,
} from "./scoringWorkflow.ts";
import {
  assertOriginalTextForTranslation,
  buildPostTranslationUpdatePatch,
  buildTranslationCallOptions,
  buildTranslationResultMeta,
  choosePostTranslationRoute,
  renderTranslationUserPrompt as renderTranslationUserPromptText,
  shouldQueueHydrationAfterTranslation,
} from "./translateWorkflow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_CORS_ORIGIN") ??
    "https://liquid-feed-flux.lovable.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-token",
};

const SETTINGS_CACHE_MS = 45_000;
const MAX_RESOLVE_MEDIA_SIGNAL_ROWS = 50;
const ALL_WORKER_JOB_TYPES = [
  "reprocess",
  "dedupe",
  "compute_signature",
  "resolve_media",
  "download_media",
  "hydrate_tweet",
  "translate",
  "moderate",
  "enrich",
  "deliver",
] as const;

/** Build the claim filter from server-authoritative runtime controls. */
export function filterWorkerJobTypes(
  requested: string[] | null,
  controls: Pick<RuntimeControls, "dedupe_enabled" | "translation_enabled">,
): string[] | null {
  const paused = new Set<string>();
  if (!controls.dedupe_enabled) {
    paused.add("dedupe");
    paused.add("compute_signature");
  }
  if (!controls.translation_enabled) paused.add("translate");
  if (requested !== null) return requested.filter((type) => !paused.has(type));
  if (paused.size === 0) return null;
  return ALL_WORKER_JOB_TYPES.filter((type) => !paused.has(type));
}

export function runtimeControlsNoopResponse(
  reason = "runtime_controls_unavailable",
): Response {
  return new Response(JSON.stringify({
    success: false,
    status: "locked",
    reason,
    claimed: 0,
    processed: 0,
  }), {
    status: 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type QueueInsertOutcome = "inserted" | "duplicate";
export type QueueInsertFailureCode =
  | "hydrate_dedupe_enqueue_failed"
  | "dedupe_translate_enqueue_failed"
  | "reprocess_dedupe_enqueue_failed";

/** Classify the exact PostgREST representation from an idempotent queue insert. */
export function classifyQueueInsertResult(
  data: unknown,
  failureCode: QueueInsertFailureCode,
): QueueInsertOutcome {
  if (!Array.isArray(data)) throw new Error(failureCode);
  if (data.length === 0) return "duplicate";
  if (data.length !== 1) throw new Error(failureCode);
  const row = data[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(failureCode);
  const id = (row as Record<string, unknown>).id;
  if (typeof id !== "string" || id.trim() === "") throw new Error(failureCode);
  return "inserted";
}

initSentryEdge();
type ScoringDecisionLog = NonNullable<
  ReturnType<typeof buildScoringBaseDecisionState>["logEvent"]
>;
type FeedbackBiasBaseState = Pick<
  FeedbackBiasResult,
  "deliveryDecision" | "decisionReason" | "finalScore"
>;
// deno-lint-ignore no-explicit-any
let configCache: { expiresAt: number; value: any } | null = null;

// deno-lint-ignore no-explicit-any
async function loadScoringCalibrationExamples(
  supabase: any,
  profileId: string,
): Promise<ScoringPolicyCalibrationExample[]> {
  try {
    const { data, error } = await supabase
      .from("scoring_examples")
      .select(
        "text_original, author_handle, expected_audience_class, expected_decision, expected_score, expected_global_exception_class, note",
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    return (data ?? []) as ScoringPolicyCalibrationExample[];
  } catch (_error) {
    console.warn("worker: failed to load scoring calibration examples");
    return [];
  }
}

class JobDeferred extends Error {
  nextRunAt: string;
  meta: Record<string, unknown>;

  constructor(
    message: string,
    delayMs = VIDEO_RENDER_DEFER_MS,
    meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "JobDeferred";
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.meta = meta;
  }
}

class DeliveryCutoverSettled extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DeliveryCutoverSettled";
  }
}

async function settleBlockedDeliveryJob(
  supabase: any,
  job: Record<string, unknown>,
  reason: string,
): Promise<void> {
  const jobId = typeof job.id === "string" ? job.id : "";
  const settled = await settleDeliveryCutoverJob(supabase, jobId, reason);
  if (!settled) {
    throw new NonRetryableJobError("delivery_cutover_settlement_not_applied");
  }
}

type EdgeRuntimeWithWaitUntil = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

function scheduleBackground(promise: Promise<unknown>): boolean {
  const edgeRuntime =
    (globalThis as { EdgeRuntime?: EdgeRuntimeWithWaitUntil }).EdgeRuntime;
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
async function loadConfig(
  supabase: any,
  options: { bypassCache?: boolean } = {},
): Promise<any> {
  if (
    !options.bypassCache && configCache && configCache.expiresAt > Date.now()
  ) {
    return configCache.value;
  }

  const defaults = {
    translationPrompt:
      "You are a professional translator. Translate the given English text to Persian. Preserve @mentions, #hashtags, URLs, and line breaks exactly. Only return the translated text, nothing else.",
    userPromptTemplate: null as string | null,
    splitCalls: true,
    openaiModel: "gpt-4o-mini",
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
      template: "{translated_text}\n\n📰 #اخبار",
      include_source_link: true,
      source_link_text: "View original",
      custom_hashtags: "#اخبار",
    } as Record<string, unknown>,
    scoringSystemPrompt: null as string | null,
    classifierToolSchema: null as string | null,
    contentFilter: {
      enabled: false,
      // Kept in sync with the shared effective-threshold default (14). The
      // worker uses resolveEffectiveThreshold for the authoritative threshold.
      default_threshold: 14,
      editorial_guidelines: "",
      priority_topics: [] as string[],
      low_priority_topics: [] as string[],
      author_rules: {} as Record<string, { rule: string; threshold?: number }>,
      score_only: false,
    },
    thresholdEnvelope: resolveEffectiveThreshold([]) as EffectiveThresholdEnvelope,
    editorialProfile: null as null | {
      id: string;
      name: string;
      weights: Record<ScoreAxisKey, number>;
      threshold: number;
      must_include_keywords: string[];
      must_exclude_keywords: string[];
      required_tags_any: string[];
      blocked_tags: string[];
      author_overrides: Record<string, "always_deliver" | "always_skip">;
      editorial_note?: string;
    },
    storyMemory: {
      ...DEFAULT_DUPLICATE_GATE,
    },
    xPostingConfig: {
      min_score: 14,
    },
    scoringPolicy: normalizeScoringPolicy(null),
  };

  try {
    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", [
        "translation_prompt",
        "message_template",
        "content_filter",
        "editorial_profiles",
        "active_profile_id",
        "story_memory",
        "x_posting_config",
        "scoring_policy",
      ]);
    if (settingsError) throw settingsError;

    if (settings) {
      // translation_prompt is the authoritative source for OpenAI parameters.
      for (const s of settings) {
        if (
          s.key === "translation_prompt" && typeof s.value === "object" &&
          s.value !== null
        ) {
          const v = s.value as Record<string, unknown>;
          if (v.system_prompt) {
            defaults.translationPrompt = String(v.system_prompt);
          }
          if (
            typeof v.user_prompt_template === "string" &&
            (v.user_prompt_template as string).trim()
          ) {
            defaults.userPromptTemplate = v.user_prompt_template as string;
          }
          if (typeof v.split_calls === "boolean") {
            defaults.splitCalls = v.split_calls as boolean;
          }
          if (typeof v.model === "string" && (v.model as string).trim()) {
            defaults.openaiModel = String(v.model);
          }
          if (typeof v.temperature === "number") {
            defaults.openaiTemperature = v.temperature;
          }
          if (typeof v.max_completion_tokens === "number") {
            defaults.openaiMaxCompletionTokens = clampOpenAiMaxCompletionTokens(
              v.max_completion_tokens as number,
              defaults.openaiMaxCompletionTokens,
            );
          }
          if (typeof v.top_p === "number") {
            defaults.openaiTopP = v.top_p as number;
          }
          if (typeof v.frequency_penalty === "number") {
            defaults.openaiFrequencyPenalty = v.frequency_penalty as number;
          }
          if (typeof v.presence_penalty === "number") {
            defaults.openaiPresencePenalty = v.presence_penalty as number;
          }
          if (typeof v.reasoning_effort === "string") {
            defaults.openaiReasoningEffort = v.reasoning_effort as string;
          }
          if (typeof v.verbosity === "string") {
            defaults.openaiVerbosity = v.verbosity as string;
          }
          if (typeof v.seed === "number") {
            defaults.openaiSeed = v.seed as number;
          }
          if (typeof v.service_tier === "string") {
            defaults.openaiServiceTier = v.service_tier as string;
          }
          if (typeof v.parallel_tool_calls === "boolean") {
            defaults.openaiParallelToolCalls = v.parallel_tool_calls as boolean;
          }
          if (
            typeof v.scoring_system_prompt === "string" &&
            v.scoring_system_prompt.trim()
          ) {
            defaults.scoringSystemPrompt = v.scoring_system_prompt as string;
          }
          if (
            typeof v.classifier_tool_schema === "string" &&
            v.classifier_tool_schema.trim()
          ) {
            defaults.classifierToolSchema = v.classifier_tool_schema as string;
          }
          // Independent scoring params (optional)
          if (typeof v.scoring === "object" && v.scoring !== null) {
            const sv = v.scoring as Record<string, unknown>;
            if (typeof sv.model === "string" && (sv.model as string).trim()) {
              defaults.scoringModel = sv.model as string;
            }
            if (typeof sv.temperature === "number") {
              defaults.scoringTemperature = sv.temperature as number;
            }
            if (typeof sv.max_completion_tokens === "number") {
              defaults.scoringMaxCompletionTokens =
                clampOpenAiMaxCompletionTokens(
                  sv.max_completion_tokens as number,
                  defaults.scoringMaxCompletionTokens,
                );
            }
            if (typeof sv.top_p === "number") {
              defaults.scoringTopP = sv.top_p as number;
            }
            if (typeof sv.reasoning_effort === "string") {
              defaults.scoringReasoningEffort = sv.reasoning_effort as string;
            }
            if (typeof sv.verbosity === "string") {
              defaults.scoringVerbosity = sv.verbosity as string;
            }
            if (typeof sv.seed === "number") {
              defaults.scoringSeed = sv.seed as number;
            }
            if (typeof sv.service_tier === "string") {
              defaults.scoringServiceTier = sv.service_tier as string;
            }
            if (typeof sv.parallel_tool_calls === "boolean") {
              defaults.scoringParallelToolCalls = sv
                .parallel_tool_calls as boolean;
            }
          }
        }
        if (
          s.key === "message_template" && typeof s.value === "object" &&
          s.value !== null
        ) {
          defaults.messageTemplate = {
            ...defaults.messageTemplate,
            ...s.value as Record<string, unknown>,
          };
        }
        if (
          s.key === "content_filter" && typeof s.value === "object" &&
          s.value !== null
        ) {
          defaults.contentFilter = {
            ...defaults.contentFilter,
            ...s.value as Record<string, { rule: string; threshold?: number }>,
          };
        }
        if (
          s.key === "story_memory"
        ) {
          if (
            s.value === null || typeof s.value !== "object" ||
            Array.isArray(s.value)
          ) {
            throw new Error("worker_story_memory_invalid_response");
          }
          defaults.storyMemory = normalizeDuplicateGateConfig({
            ...defaults.storyMemory,
            ...s.value as Record<string, unknown>,
          });
        }
        if (
          s.key === "x_posting_config" && typeof s.value === "object" &&
          s.value !== null
        ) {
          defaults.xPostingConfig = {
            ...defaults.xPostingConfig,
            ...s.value as Record<string, unknown>,
          };
        }
        if (
          s.key === "scoring_policy" && typeof s.value === "object" &&
          s.value !== null
        ) {
          defaults.scoringPolicy = normalizeScoringPolicy(s.value);
        }
      }

      // Resolve active editorial profile (PR2)
      const profilesEntry = settings.find((x) =>
        x.key === "editorial_profiles"
      );
      const activeEntry = settings.find((x) => x.key === "active_profile_id");
      const profilesArr =
        (profilesEntry?.value as { profiles?: unknown[] } | null)?.profiles;
      const activeId = (activeEntry?.value as { id?: string } | null)?.id;
      if (Array.isArray(profilesArr) && activeId) {
        const found = profilesArr.find(
          (p) =>
            p && typeof p === "object" &&
            (p as Record<string, unknown>).id === activeId,
        );
        if (found) {
          defaults.editorialProfile = found as typeof defaults.editorialProfile;
        }
      }
    }
    defaults.thresholdEnvelope = resolveEffectiveThreshold(settings ?? []);
  } catch (e) {
    throw new Error("worker_settings_read_failed");
  }

  configCache = { expiresAt: Date.now() + SETTINGS_CACHE_MS, value: defaults };
  return defaults;
}

// deno-lint-ignore no-explicit-any
async function handleDedupeJob(
  job: Record<string, unknown>,
  supabase: any,
  config: Awaited<ReturnType<typeof loadConfig>>,
  enqueueNext: boolean,
  runtimeControls: RuntimeControls,
): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  if (!tweetId) throw new Error("dedupe: missing tweet_id in job payload");
  if (!runtimeControls.dedupe_enabled) {
    throw new JobDeferred("dedupe_paused", 30_000, {
      tweet_id: tweetId,
      control: "dedupe_enabled",
    });
  }
  let workflowRunKey: string | null = null;
  let workflowFinalized = false;
  const finishDedupeWorkflow = async (
    status: "completed" | "failed" | "skipped",
    metadata?: Record<string, unknown>,
    error?: unknown,
  ) => {
    if (!workflowRunKey || workflowFinalized) return;
    await finishWorkflowRun(supabase, workflowRunKey, status, metadata, error);
    workflowFinalized = true;
  };
  const sm = config.storyMemory;
  if (!sm?.enabled) {
    throw new JobDeferred("dedupe_not_configured", 30_000, {
      tweet_id: tweetId,
      control: "story_memory.enabled",
    });
  }

  const { data: post, error } = await supabase
    .from("posts")
    .select(
      "tweet_id, text_translated, text_original, author_handle, url, created_at, delivery_decision, decision_reason, feedback_locked",
    )
    .eq("tweet_id", tweetId)
    .single();
  if (error || !post) {
    console.warn(
      JSON.stringify({
        function: "worker",
        action: "dedupe_no_post",
        tweet_id: tweetId,
      }),
    );
    return true;
  }

  await markDedupePending(
    supabase,
    tweetId,
    payload.post_hydrate === true
      ? "running:post_hydrate"
      : `running:${String(job.type)}`,
  );
  const workflowRunId = workerWorkflowRunId(job, tweetId, "dedupe");
  workflowRunKey = workerWorkflowRunKey("dedupe", workflowRunId);
  await startWorkflowRun(supabase, {
    runKey: workflowRunKey,
    workflowName: "dedupe-pipeline",
    workflowRunId,
    status: "running",
    source: "worker",
    sourceFunction: "handleDedupeJob",
    subjectType: "post",
    subjectId: tweetId,
    jobId: typeof job.id === "string" ? job.id : null,
    tweetId,
    metadata: {
      job_type: String(job.type),
      source: payload.post_hydrate === true ? "post_hydrate" : String(job.type),
      force: payload.force === true,
      enqueue_next: enqueueNext,
      mode: sm.mode,
      action: sm.action,
    },
  });

  try {
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const result = await runDuplicateGate(supabase, post, sm, {
      force: payload.force === true,
      source: payload.post_hydrate === true ? "post_hydrate" : String(job.type),
      fetchEmbedding: (text) =>
        fetchObservedStoryEmbedding({
          supabase,
          workflowRunKey,
          apiKey: openaiApiKey,
          text,
          metadata: {
            job_type: String(job.type),
            source: payload.post_hydrate === true
              ? "post_hydrate"
              : String(job.type),
            mode: sm.mode,
          },
        }),
      callOpenAI: (params) =>
        callObservedWorkerOpenAI(
          supabase,
          workflowRunKey!,
          params,
          {
            traceName: "dedupe-pipeline",
            operationName: "classify_story_duplicate",
            agentName: "duplicate-adjudicator",
            foglampSkipReason: "dedupe_local_only",
            metadata: {
              job_type: String(job.type),
              source: payload.post_hydrate === true
                ? "post_hydrate"
                : String(job.type),
              mode: sm.mode,
            },
          },
        ),
    });
    if (!result.ok) {
      console.warn(JSON.stringify({
        function: "worker",
        action: result.retryable
          ? "dedupe_failed_retry"
          : "dedupe_failed_closed",
        tweet_id: tweetId,
        error: result.error ?? result.reason,
        failure_phase: result.failure_phase ?? null,
        retryable: result.retryable === true,
        enqueue_translate: false,
      }));
      await finishDedupeWorkflow("failed", {
        job_type: String(job.type),
        status: result.status,
        method: result.method,
        failure_phase: result.failure_phase ?? null,
        retryable: result.retryable === true,
      }, result.error ?? result.reason);
      if (result.retryable) {
        throw new Error(
          `dedupe_retryable:${result.failure_phase ?? "unknown"}:${
            result.error ?? result.reason
          }`,
        );
      }
      return true;
    }
    if (enqueueNext && result.should_enqueue_translate) {
      await queueTranslateFromDedupe(
        supabase,
        tweetId,
        payload.post_hydrate === true,
        runtimeControls,
      );
    }
    await finishDedupeWorkflow("completed", {
      job_type: String(job.type),
      status: result.status,
      method: result.method,
      confidence: result.confidence,
      candidate_count: result.candidates.length,
      enqueue_translate: enqueueNext && result.should_enqueue_translate,
    });
    console.log(JSON.stringify({
      function: "worker",
      action: "dedupe_complete",
      tweet_id: tweetId,
      status: result.status,
      method: result.method,
      dup_of: result.dup_of_tweet_id,
      confidence: result.confidence,
      enqueue_translate: enqueueNext && result.should_enqueue_translate,
    }));
    return true;
  } catch (error) {
    if (error instanceof JobDeferred) throw error;
    const e = workerBoundaryError(error, "dedupe_failed");
    await finishDedupeWorkflow("failed", {
      job_type: String(job.type),
    }, e);
    throw e;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authError = await requireInternalAuth(req, corsHeaders);
  if (authError) return authError;

  const supabase = createClient<any, any>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

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
    const requestedBatchSize = typeof requestBody.batch_size === "number" &&
        Number.isFinite(requestBody.batch_size)
      ? Math.max(1, Math.min(batchCap, Math.floor(requestBody.batch_size)))
      : batchCap;
    const chainDepth = normalizeChainDepth(requestBody.chain_depth);
    const bypassSettingsCache = requestBody.bypass_settings_cache === true ||
      requestBody.admin === true || requestBody.manual === true;
    const startTime = Date.now();
    console.log(JSON.stringify({
      function: "worker",
      action: "start",
      trigger: req.url,
      job_types: requestedJobTypes,
      chain_depth: chainDepth,
      batch_size: requestedBatchSize,
      batch_cap: batchCap,
    }));

    // Runtime controls are the claim admission boundary. A missing, duplicate,
    // malformed, or unreadable row must stop before claim_jobs is called.
    let runtimeControls: RuntimeControls;
    try {
      runtimeControls = await fetchRuntimeControls(supabase);
    } catch (_error) {
      console.error(JSON.stringify({
        function: "worker",
        action: "runtime_controls_unavailable",
        error: "runtime_controls_unavailable",
      }));
      return runtimeControlsNoopResponse();
    }
    const claimJobTypes = filterWorkerJobTypes(requestedJobTypes, runtimeControls);
    if (claimJobTypes !== null && claimJobTypes.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        status: "paused",
        reason: "runtime_controls_paused_all_requested_types",
        claimed: 0,
        processed: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load runtime config
    const config = await loadConfig(supabase, {
      bypassCache: bypassSettingsCache,
    });

    // Use claim_jobs RPC for transactional job claiming
    const { data: jobs, error: claimError } = await supabase
      .rpc("claim_jobs", {
        batch_size: requestedBatchSize,
        job_types: claimJobTypes,
        worker_id: "worker-" + crypto.randomUUID(),
      });

    if (claimError) {
      console.error(
        JSON.stringify({
          function: "worker",
          action: "claim_error",
          error: "worker_claim_failed",
        }),
      );
      throw new Error("worker_claim_failed");
    }

    if (!jobs || jobs.length === 0) {
      console.log(JSON.stringify({ function: "worker", action: "no_jobs" }));
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pending jobs",
          processed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Shape queue per chat and adapt spacing based on recent 429s
    const deliverJobs = jobs.filter((j: Record<string, unknown>) =>
      j.type === "deliver"
    );
    const otherJobs = jobs.filter((j: Record<string, unknown>) =>
      j.type !== "deliver"
    );

    const spacingMs = await computeAdaptiveSpacing(supabase);

    // Group deliver jobs by chat id
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const j of deliverJobs) {
      const key = await getChatIdForJob(j, supabase) || "default";
      if (!groups[key]) groups[key] = [];
      groups[key].push(j);
    }

    const deliverJobsToRun: Record<string, unknown>[] = [];
    const nowMs = Date.now();
    for (const key of Object.keys(groups)) {
      const groupJobs = groups[key];
      if (groupJobs.length === 0) continue;
      groupJobs.sort((a, b) =>
        new Date(a.created_at as string).getTime() -
        new Date(b.created_at as string).getTime()
      );
      const [first, ...rest] = groupJobs;
      deliverJobsToRun.push(first);
      if (rest.length > 0) {
        const baseTime = nowMs + spacingMs;
        for (let i = 0; i < rest.length; i++) {
          const job = rest[i];
          const plannedTime = new Date(baseTime + i * spacingMs);
          const currentNext = job.next_run_at
            ? new Date(job.next_run_at as string)
            : null;
          const shouldUpdate = !currentNext ||
            currentNext.getTime() < plannedTime.getTime();
          if (shouldUpdate) {
            await updateJobOrThrow(supabase, job.id, claimEnvelopedPatch(job, {
              next_run_at: plannedTime.toISOString(),
              status: "pending",
              locked_at: null,
              locked_by: null,
              claim_state: "idle",
              claim_token: null,
              claim_generation: 0,
            }), "deliver_spacing_defer", job.locked_by);
          }
        }
      }
    }

    const toRunJobs = [...otherJobs, ...deliverJobsToRun];
    const laneSelected = { fast: 0, model: 0, delivery: 0 };
    for (const job of toRunJobs) {
      laneSelected[jobLane(String(job.type ?? "unknown"))] += 1;
    }
    const laneCapacity = {
      fast: laneCapacityFor("fast"),
      model: laneCapacityFor("model"),
      delivery: laneCapacityFor("delivery"),
    };
    console.log(
      JSON.stringify({
        function: "worker",
        action: "processing",
        count: toRunJobs.length,
        deferred: jobs.length - toRunJobs.length,
        lane_capacity: laneCapacity,
        lane_selected: laneSelected,
        lane_saturated: {
          fast: laneSelected.fast > laneCapacity.fast,
          model: laneSelected.model > laneCapacity.model,
          delivery: laneSelected.delivery > laneCapacity.delivery,
        },
      }),
    );

    // Process selected jobs with independent bounded lane workers. The claim/fetch
    // batch remains a separate bound and is never used as implicit concurrency.
    const results = await runJobsWithLaneCapacity(
      toRunJobs,
      async (job: Record<string, unknown>, laneMetrics) => {
      try {
        console.log(
          JSON.stringify({
            function: "worker",
            action: "job_start",
            job_id: job.id,
            type: job.type,
          }),
        );

        await recordPipelineEvent(supabase, job, "running", undefined, laneMetrics);

        let success = false;
        const payload = job.payload as Record<string, unknown> | null;
        try {
          // Durable provider-start boundary (SF1 / AIR-005): before ANY
          // side-effect-capable handler runs, persist provider_started_at + the
          // posting claim_state. A DB marker failure or stale rejection MUST abort
          // the job with ZERO provider calls -- never run the provider first.
          if (job.type !== "dedupe" && job.type !== "compute_signature" &&
              job.type !== "resolve_media") {
            let providerStarted = false;
            try {
              providerStarted = await markJobProviderStarted(supabase, job);
            } catch (providerStartError) {
              const err = workerBoundaryError(
                providerStartError,
                "job_provider_start_marker_failed",
              );
              await handleJobFailure(supabase, job, err, laneMetrics);
              await recordPipelineEvent(supabase, job, "failed", err.message, laneMetrics);
              return {
                success: false,
                jobId: job.id,
                error: "job_provider_start_marker_failed",
              };
            }
            if (!providerStarted) {
              const err = workerBoundaryError(
                new NonRetryableJobError("job_provider_start_marker_rejected"),
                "job_provider_start_marker_rejected",
              );
              await handleJobFailure(supabase, job, err, laneMetrics);
              await recordPipelineEvent(supabase, job, "failed", err.message, laneMetrics);
              return {
                success: false,
                jobId: job.id,
                error: "job_provider_start_marker_rejected",
              };
            }
          }
          switch (job.type) {
            case "translate":
              success = await handleTranslateJob(job, supabase, config, runtimeControls);
              break;
            case "moderate":
              success = await handleModerateJob(job, supabase);
              break;
            case "deliver":
              success = await handleDeliverJob(job, supabase, config);
              break;
            case "download_media":
              success = await handleDownloadMediaJob(job, supabase);
              break;
            case "reprocess":
              success = await handleReprocessJob(job, supabase, runtimeControls);
              break;
            case "hydrate_tweet":
              success = await handleHydrateTweetJob(job, supabase, runtimeControls);
              break;
            case "resolve_media":
              success = await handleResolveMediaJob(job, supabase);
              break;
            case "dedupe":
              success = await handleDedupeJob(
                job,
                supabase,
                config,
                true,
                runtimeControls,
              );
              break;
            case "compute_signature":
              success = await handleDedupeJob(
                job,
                supabase,
                config,
                false,
                runtimeControls,
              );
              break;
            case "enrich":
              success = await handleEnrichJob(job, supabase, runtimeControls);
              break;
            default:
              throw new Error(`Unknown job type: ${String(job.type)}`);
          }

          if (success) {
            const completionMeta = jobTimingMeta(job, "completed", laneMetrics);
            // Result metadata is still an active-claim write; persist it before
            // the terminal state transition so the expected posting/preparing
            // claim-state fence remains meaningful.
            await mergeJobResultMeta(supabase, job, completionMeta);
            await updateJobOrThrow(supabase, job.id, claimEnvelopedPatch(job, {
              status: "completed",
              last_error: null,
              completed_at: new Date().toISOString(),
              claim_state: "posted",
            }), "complete", job.locked_by);
            job.claim_state = "posted";
            await recordPipelineEvent(
              supabase,
              job,
              "completed",
              undefined,
              completionMeta,
            );
            console.log(
              JSON.stringify({
                function: "worker",
                action: "job_complete",
                job_id: job.id,
                type: job.type,
              }),
            );
            return { success: true, jobId: job.id };
          } else {
            const jt = String(job.type);
            const failure = new Error(
              `${jt}: handler returned false (check worker logs for ${jt}_* / job_error)`,
            );
            await handleJobFailure(supabase, job, failure, laneMetrics);
            await recordPipelineEvent(supabase, job, "failed", failure.message, laneMetrics);
            return { success: false, jobId: job.id };
          }
        } catch (error) {
          if (error instanceof DeliveryCutoverSettled) {
            await recordPipelineEvent(supabase, job, "completed", error.reason, {
              ...laneMetrics,
              skipped: "delivery_cutover_blocked",
              terminal: true,
            });
            console.log(JSON.stringify({
              function: "worker",
              action: "job_terminally_settled",
              job_id: job.id,
              type: job.type,
              reason: error.reason,
            }));
            return {
              success: true,
              settled: true,
              jobId: job.id,
              reason: error.reason,
            };
          }
          if (error instanceof JobDeferred) {
            await updateJobOrThrow(supabase, job.id, claimEnvelopedPatch(job, {
              status: "pending",
              next_run_at: error.nextRunAt,
              locked_at: null,
              locked_by: null,
              lease_expires_at: null,
              last_error: null,
              claim_state: "idle",
              claim_token: null,
              claim_generation: 0,
            }), "defer", job.locked_by);
            await recordPipelineEvent(supabase, job, "queued", undefined, {
              ...laneMetrics,
              deferred: true,
              next_run_at: error.nextRunAt,
              ...error.meta,
            });
            console.log(JSON.stringify({
              function: "worker",
              action: "job_deferred",
              job_id: job.id,
              type: job.type,
              next_run_at: error.nextRunAt,
              reason: error.message,
            }));
            return {
              success: false,
              deferred: true,
              jobId: job.id,
              reason: error.message,
            };
          }
          if (error instanceof JobStateWriteError && error.operation === "complete") {
            const reconciliationError = new NonRetryableJobError(
              "completion_persistence_unknown",
            );
            console.error(
              JSON.stringify({
                function: "worker",
                action: "job_completion_persistence_unknown",
                job_id: job.id,
                type: job.type,
                error: "completion_persistence_unknown",
              }),
            );
            try {
              await handleJobFailure(supabase, job, reconciliationError, laneMetrics);
              await recordPipelineEvent(
                supabase,
                job,
                "failed",
                reconciliationError.message,
                { ...laneMetrics, reconciliation_required: true },
              );
            } catch (_reconciliationPersistenceError) {
              console.error(
                JSON.stringify({
                  function: "worker",
                  action: "job_completion_reconciliation_persistence_failed",
                  job_id: job.id,
                  type: job.type,
                  error: "worker_completion_reconciliation_persistence_failed",
                }),
              );
              return {
                success: false,
                jobId: job.id,
                error: reconciliationError.message,
                reconciliation_required: true,
                reconciliation_persistence_failed: true,
              };
            }
            return {
              success: false,
              jobId: job.id,
              error: reconciliationError.message,
              reconciliation_required: true,
            };
          }
          const err = workerBoundaryError(error, "worker_job_failed");
          console.error(
            JSON.stringify({
              function: "worker",
              action: "job_error",
              job_id: job.id,
              type: job.type,
              error: err.message,
            }),
          );
          captureEdgeExceptionBackground(err, {
            functionName: "worker",
            action: "job_error",
            tags: { job_type: String(job.type ?? "unknown") },
            extra: { job_id: job.id, payload },
          });
          await handleJobFailure(supabase, job, err, laneMetrics);
          await recordPipelineEvent(supabase, job, "failed", err.message, laneMetrics);
          return { success: false, jobId: job.id, error: err.message };
        }
      } catch (error) {
        const err = workerBoundaryError(error, "worker_outer_failed");
        console.error(
          JSON.stringify({
            function: "worker",
            action: "job_outer_error",
            job_id: job.id,
            type: job.type,
            error: err.message,
          }),
        );
        captureEdgeExceptionBackground(err, {
          functionName: "worker",
          action: "job_outer_error",
          tags: { job_type: String(job.type ?? "unknown") },
          extra: { job_id: job.id },
        });
        await handleJobFailure(supabase, job, err, laneMetrics);
        await recordPipelineEvent(supabase, job, "failed", err.message, laneMetrics);
        return { success: false, jobId: job.id, error: err.message };
      }
      },
    );

    let processedCount = 0;
    let failedCount = 0;
    let deferredCount = 0;

    results.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) {
        processedCount++;
      } else if (result.status === "fulfilled" && result.value.deferred) {
        deferredCount++;
      } else {
        failedCount++;
      }
    });

    const latencyMs = Date.now() - startTime;
    console.log(
      JSON.stringify({
        function: "worker",
        action: "complete",
        processed: processedCount,
        deferred: deferredCount,
        failed: failedCount,
        latency_ms: latencyMs,
      }),
    );

    // Auto-chain due-now queue work with a hard depth cap. This cuts scheduler
    // wait without reintroducing unbounded DB-triggered function churn.
    try {
      const autochainTypes = filterWorkerJobTypes(
        selectAutochainJobTypes(requestedJobTypes),
        runtimeControls,
      ) ?? [];
      const dueCutoff = new Date(Date.now() + AUTOCHAIN_DUE_WINDOW_MS)
        .toISOString();
      const { count: pendingCount, error: pendingError } = autochainTypes.length === 0
        ? { count: 0, error: null }
        : await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .in("type", autochainTypes)
          .or(`next_run_at.is.null,next_run_at.lte.${dueCutoff}`);

      if (pendingError) throw pendingError;
      const duePendingCount = pendingCount ?? 0;
      if (
        autochainTypes.length > 0 &&
        shouldAutochain({
          chainDepth,
          pendingCount: duePendingCount,
          maxDepth: AUTOCHAIN_MAX_DEPTH,
        })
      ) {
        console.log(JSON.stringify({
          function: "worker",
          action: "autochain",
          due_pending: duePendingCount,
          chain_depth: chainDepth,
          next_chain_depth: chainDepth + 1,
          job_types: autochainTypes,
        }));
        await supabase.functions.invoke("worker", {
          body: {
            trigger: "autochain",
            batch_size: requestedBatchSize,
            chain_depth: chainDepth + 1,
            job_types: autochainTypes,
          },
          headers: serviceRoleBearerHeader(),
        } as Record<string, unknown>);
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          function: "worker",
          action: "autochain_skipped",
          error: workerBoundaryError(error, "worker_autochain_failed").message,
        }),
      );
    }

    // SF7: expired-running claim reconciliation rides the existing worker
    // maintenance tail (alongside autochain). Fully-qualified, service_role-only,
    // closed search_path reconcile RPC returns 'running' leases that expired
    // before any provider call back to pending (invalidating the stale token),
    // and reports (never requeues) provider-started expired claims as ambiguous.
    // Best-effort: a reconcile failure must not fail the worker invocation.
    try {
      const { data: reconcile } = await supabase.rpc(
        "reconcile_expired_job_claims",
        { p_max_claims: 200 },
      );
      if (reconcile && typeof reconcile === "object") {
        const rc = reconcile as Record<string, unknown>;
        if ((rc.requeued ?? 0) !== 0 || (rc.ambiguous ?? 0) !== 0) {
          console.log(JSON.stringify({
            function: "worker",
            action: "reconcile_expired_job_claims",
            requeued: rc.requeued,
            ambiguous: rc.ambiguous,
            reconciled_at: rc.reconciled_at,
          }));
        }
      }
    } catch (reconcileError) {
      console.warn(
        JSON.stringify({
          function: "worker",
          action: "reconcile_expired_job_claims_failed",
          error: workerBoundaryError(
            reconcileError,
            "worker_claim_reconcile_failed",
          ).message,
        }),
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        deferred: deferredCount,
        failed: failedCount,
        total: jobs.length,
        chain_depth: chainDepth,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const safeError = workerBoundaryError(error, "worker_fatal");
    console.error(
      JSON.stringify({
        function: "worker",
        action: "fatal",
        error: safeError.message,
      }),
    );
    await captureEdgeException(safeError, {
      functionName: "worker",
      action: "fatal",
      request: req,
    });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// deno-lint-ignore no-explicit-any
async function enqueuePostDeliveryAfterRenderGate(
  supabase: any,
  tweetId: string,
  source = "worker",
  resetExisting = true,
) {
  return enqueuePostDeliveryAfterRenderGateCore(
    supabase,
    tweetId,
    source,
    resetExisting,
    {
      dispatchXPosterForTarget,
    },
  );
}

function workerWorkflowRunId(
  job: Record<string, unknown>,
  fallbackSubjectId: string,
  fallbackType = "translate",
): string {
  return typeof job.id === "string" && job.id.trim()
    ? job.id
    : `${fallbackType}:${fallbackSubjectId}:${Date.now()}`;
}

function workerWorkflowRunKey(type: string, runId: string): string {
  return `worker:${type}:${runId}`;
}

function workerProviderFailureCode(operation: string, status: unknown): string {
  const numericStatus = typeof status === "number" && Number.isInteger(status)
    ? status
    : null;
  return numericStatus !== null && numericStatus >= 100 && numericStatus <= 599
    ? `${operation}_http_${numericStatus}`
    : `${operation}_request_failed`;
}

function workerBoundaryError(reason: unknown, fallbackCode: string): Error {
  const sourceMessage = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
    ? reason
    : "";
  const retryAfterValue = reason && typeof reason === "object" &&
      "retryAfterSeconds" in reason
    ? (reason as { retryAfterSeconds?: unknown }).retryAfterSeconds
    : null;
  const parsedRetryAfter = typeof retryAfterValue === "number" &&
      Number.isFinite(retryAfterValue)
    ? retryAfterValue
    : parseRetryAfterFromMessage(sourceMessage);
  const retryAfter = parsedRetryAfter == null
    ? null
    : Math.max(1, Math.min(86_400, Math.floor(parsedRetryAfter)));
  const safeMessage = retryAfter == null
    ? fallbackCode
    : `${fallbackCode}: retry after ${retryAfter}`;
  const safeError = reason instanceof NonRetryableJobError
    ? new NonRetryableJobError(safeMessage)
    : new Error(safeMessage);
  if (retryAfter != null) {
    Object.assign(safeError, { retryAfterSeconds: retryAfter });
  }
  return safeError;
}

function thrownWorkerOpenAIResponse(
  _error: unknown,
  model: string,
): NormalizedOpenAIResponse {
  const raw = { error: { code: "worker_openai_request_failed" } };
  return {
    ok: false,
    status: 0,
    rawText: JSON.stringify(raw),
    raw,
    content: "",
    toolCall: null,
    webSearchResults: [],
    outputItems: [],
    usage: null,
    endpoint: /^gpt-5\.(4|5)/i.test(model) ? "responses" : "chat.completions",
  };
}

async function callObservedWorkerOpenAI(
  supabase: { from(table: string): unknown },
  workflowRunKey: string,
  params: OpenAICallParams,
  options: {
    operationName: string;
    agentName: string;
    traceName?: string;
    foglampSkipReason?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<NormalizedOpenAIResponse> {
  const traceName = options.traceName ?? "rss-item-pipeline";
  const foglampSkipReason = options.foglampSkipReason ?? "worker_local_only";
  const startedAt = new Date();
  let response: NormalizedOpenAIResponse;
  try {
    response = await callOpenAI(params);
  } catch (error) {
    response = thrownWorkerOpenAIResponse(error, params.model);
    await recordObservedOpenAICall(supabase, {
      workflowRunKey,
      traceName,
      operationName: options.operationName,
      agentName: options.agentName,
      model: params.model,
      endpoint: response.endpoint,
      request: params,
      response,
      status: "failed",
      startedAt,
      endedAt: new Date(),
      spanEstimate: estimateFoglampSpans(params),
      foglampExported: false,
      foglampSkipReason,
      metadata: options.metadata,
    });
    throw new Error("worker_openai_request_failed");
  }

  await recordObservedOpenAICall(supabase, {
    workflowRunKey,
    traceName,
    operationName: options.operationName,
    agentName: options.agentName,
    model: params.model,
    endpoint: response.endpoint,
    request: params,
    response,
    status: response.ok ? "completed" : "failed",
    startedAt,
    endedAt: new Date(),
    spanEstimate: estimateFoglampSpans(params),
    foglampExported: false,
    foglampSkipReason,
    metadata: options.metadata,
  });
  return response;
}

async function handleTranslateJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
  config: Awaited<ReturnType<typeof loadConfig>>,
  runtimeControls: RuntimeControls,
): Promise<boolean> {
  let workflowRunKey: string | null = null;
  try {
    const payload = job.payload as Record<string, unknown>;
    const tweetId = payload.tweet_id as string;
    if (!runtimeControls.translation_enabled) {
      throw new JobDeferred("translation_paused", 30_000, {
        tweet_id: tweetId,
        control: "translation_enabled",
      });
    }
    const workflowRunId = workerWorkflowRunId(job, tweetId);
    workflowRunKey = workerWorkflowRunKey("translate", workflowRunId);
    await startWorkflowRun(supabase, {
      runKey: workflowRunKey,
      workflowName: "rss-item-pipeline",
      workflowRunId,
      status: "running",
      source: "worker",
      sourceFunction: "handleTranslateJob",
      subjectType: "post",
      subjectId: tweetId,
      jobId: typeof job.id === "string" ? job.id : null,
      tweetId,
      metadata: {
        job_type: "translate",
        attempt: typeof job.attempts === "number" ? job.attempts : null,
      },
    });
    console.log(
      JSON.stringify({
        function: "worker",
        action: "translate_start",
        tweet_id: tweetId,
      }),
    );

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const { data: post, error } = await supabase
      .from("posts")
      .select(
        "tweet_id, text_original, text_translated, account_id, url, tweeted_at, has_media, author_handle, is_truncated, hydrated_at, dedupe_status, dup_of_tweet_id, dedupe_reason, feedback_locked, importance_score, importance_tags, importance_reasoning, score_axes, final_score, base_score, learned_score, learned_delta, x_gate_score, learning_confidence, delivery_decision, decision_reason, score_breakdown, accounts!inner(handle, display_name)",
      )
      .eq("tweet_id", tweetId)
      .single();

    if (error || !post) {
      throw new Error(`Post not found: ${tweetId}`);
    }

    assertOriginalTextForTranslation(post.text_original);

    const initialDuplicatePatch = duplicateDecisionPatch(
      post as {
        dedupe_status?: string | null;
        dup_of_tweet_id?: string | null;
        dedupe_reason?: string | null;
      },
    );
    if (initialDuplicatePatch) {
      const nowIso = new Date().toISOString();
      const { error: dupSkipUpdateError } = await supabase
        .from("posts")
        .update({
          delivery_decision: initialDuplicatePatch.delivery_decision,
          decision_reason: initialDuplicatePatch.decision_reason,
        })
        .eq("tweet_id", tweetId);
      if (dupSkipUpdateError) throw dupSkipUpdateError;
      console.log(
        JSON.stringify({
          function: "worker",
          action: "translate_skip_duplicate_gate",
          tweet_id: tweetId,
          reason: initialDuplicatePatch.decision_reason,
        }),
      );
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "translate",
        "skipped",
        null,
        nowIso,
        null,
        {
          reason: "duplicate_gate",
          decision_reason: initialDuplicatePatch.decision_reason,
        },
      );
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "deliver",
        "completed",
        null,
        nowIso,
        null,
        {
          skipped: "duplicate_gate",
          decision: "skip",
        },
      );
      await finishWorkflowRun(supabase, workflowRunKey, "skipped", {
        reason: "duplicate_gate",
        delivery_decision: "skip",
      });
      return true;
    }

    const forceScoringV2 = payload.scoring_policy_v2 === true;
    const scoringPolicyConfigured = config.scoringPolicy?.enabled === true ||
      forceScoringV2;
    const legacyFilterEnabled = config.contentFilter.enabled ||
      config.contentFilter.score_only;
    const filterEnabled = scoringPolicyConfigured || legacyFilterEnabled;
    const scoreOnly = config.contentFilter.score_only &&
      !config.contentFilter.enabled;
    const authorHandle = post.author_handle as string | null;

    let translatedText = "";
    let importanceScore: number | null = null;
    let importanceTags: string[] | null = null;
    let importanceReasoning: string | null = null;
    let data: Record<string, unknown> = {};
    let scoringUsage: Record<string, unknown> | null = null;
    let translationUsage: Record<string, unknown> | null = null;
    let translationReadability: Record<string, unknown> | null = null;
    let translationGeneratedThisRun = false;
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
    const measureTranslationCall = async <T>(
      fn: () => Promise<T>,
    ): Promise<T> => {
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
      importanceScore = typeof post.importance_score === "number"
        ? post.importance_score
        : Number(post.importance_score ?? NaN) || null;
      importanceTags = Array.isArray(post.importance_tags)
        ? post.importance_tags as string[]
        : null;
      importanceReasoning = typeof post.importance_reasoning === "string"
        ? post.importance_reasoning
        : null;
      scoreAxes = parseScoreAxes(post.score_axes);
      console.log(
        JSON.stringify({
          function: "worker",
          action: "score_skip_feedback_locked",
          tweet_id: tweetId,
          score: importanceScore,
          final_score: post.final_score,
        }),
      );
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "score",
        "skipped",
        null,
        new Date().toISOString(),
        null,
        {
          reason: "feedback_locked",
          final_score: post.final_score,
          importance_score: importanceScore,
          scoring_call_ms: scoringCallMs,
        },
      );
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

    const accountData = (post as Record<string, unknown>).accounts as
      | Record<string, unknown>
      | null;
    const authorDisplay = authorHandle || (accountData?.handle as string) ||
      "unknown";
    const accountName = (accountData?.display_name as string) || "";
    const publishedAt = post.tweeted_at
      ? new Date(post.tweeted_at as string).toISOString()
      : "unknown";

    const buildUserMessage = () =>
      renderScoringUserMessage({
        textOriginal: String(post.text_original || ""),
        authorDisplay,
        accountName,
        publishedAt,
        hasMedia: !!post.has_media,
        url: post.url as string | null,
      });

    const buildToolFunction = (
      includeTranslatedText: boolean,
    ): Record<string, unknown> =>
      buildClassifierToolFunction(
        config.classifierToolSchema,
        includeTranslatedText,
      );

    const renderSystemPrompt = () =>
      renderScoringSystemPrompt({
        scoringSystemPrompt: config.scoringSystemPrompt,
        translationPrompt: config.translationPrompt,
        priorityTopics: config.contentFilter.priority_topics,
        lowPriorityTopics: config.contentFilter.low_priority_topics,
        editorialGuidelines: config.contentFilter.editorial_guidelines,
      });

    // Helper: render translation user prompt from template (or default)
    const renderTranslationUserPrompt = () =>
      renderTranslationUserPromptText({
        template: config.userPromptTemplate,
        content: post.text_original as string,
        authorDisplay,
        accountName,
        publishedAt,
      });
    const buildTranslationRequest = () =>
      buildTranslationCallOptions(config, renderTranslationUserPrompt());

    // ============ SPLIT PATH: score first, translate only on pass ============
    let scoringPolicyResult: ScoringPolicyResult | null = null;
    const scoringPolicyEnabled = scoringPolicyConfigured;
    const scoringPolicyActive = scoringPolicyEnabled &&
      config.scoringPolicy?.enabled === true &&
      config.scoringPolicy?.mode === "active";
    const activeLegacyProfile = config.editorialProfile &&
        config.thresholdEnvelope.source === "editorial_profile"
      ? {
        ...config.editorialProfile,
        threshold: config.thresholdEnvelope.threshold,
      }
      : config.editorialProfile;

    // Per-post threshold resolution: the shared envelope gives the system
    // default, but legacy author_rules may still override it. This mirrors the
    // pre-envelope resolveActiveFeedbackThreshold priority (profile, then
    // author custom_threshold, then default) so feedback-bias re-evaluations
    // use the same gate the original decision used.
    const activeFeedbackThreshold = () =>
      resolveActiveFeedbackThreshold({
        editorialProfileThreshold: activeLegacyProfile?.threshold,
        authorHandle,
        authorRules: config.contentFilter.author_rules,
        defaultThreshold: config.thresholdEnvelope.threshold,
      });

    let splitDecisionState: FeedbackBiasResult | null = null;

    const logBaseDecision = (logEvent: ScoringDecisionLog | null) => {
      if (!logEvent) return;
      if (logEvent.kind === "v2") {
        console.log(JSON.stringify({
          function: "worker",
          action: "filter_decision_v2",
          tweet_id: tweetId,
          decision: logEvent.decision,
          final_score: logEvent.finalScore,
          audience_class: logEvent.audienceClass,
          profile: logEvent.profileId,
          reason: logEvent.reason,
        }));
        return;
      }
      if (logEvent.kind === "legacy_profile") {
        console.log(JSON.stringify({
          function: "worker",
          action: "filter_decision",
          tweet_id: tweetId,
          decision: logEvent.decision,
          score: logEvent.score,
          final_score: logEvent.finalScore,
          profile: logEvent.profileId,
          author: logEvent.authorHandle,
          reason: logEvent.reason,
        }));
        return;
      }
      console.log(JSON.stringify({
        function: "worker",
        action: "filter_decision",
        tweet_id: tweetId,
        decision: logEvent.decision,
        score: logEvent.score,
        threshold: logEvent.threshold,
        author: logEvent.authorHandle,
        reason: logEvent.reason,
      }));
    };

    const buildBaseDecisionState = (): FeedbackBiasBaseState => {
      const result = buildScoringBaseDecisionState({
        feedbackLocked,
        postFinalScore: post.final_score,
        postDeliveryDecision: post.delivery_decision,
        postDecisionReason: post.decision_reason,
        importanceScore,
        importanceTags,
        importanceReasoning,
        scoreAxes,
        scoringPolicyActive,
        scoringPolicyResult,
        filterEnabled,
        legacyFilterEnabled,
        scoreOnly,
        editorialProfile: activeLegacyProfile,
        authorHandle,
        authorRules: config.contentFilter.author_rules,
        defaultThreshold: config.thresholdEnvelope.threshold,
        textOriginal: String(post.text_original || ""),
      });
      importanceScore = result.scoringFields.importanceScore;
      importanceTags = result.scoringFields.importanceTags;
      importanceReasoning = result.scoringFields.importanceReasoning;
      scoreAxes = result.scoringFields.scoreAxes;
      logBaseDecision(result.logEvent);
      return result.decisionState;
    };

    const applyFeedbackBiasToDecision = async (
      state: FeedbackBiasBaseState,
    ): Promise<FeedbackBiasResult> => {
      if (feedbackLocked) {
        const baseScore = typeof post.base_score === "number"
          ? post.base_score
          : state.finalScore;
        const learnedScore = typeof post.learned_score === "number"
          ? post.learned_score
          : state.finalScore;
        const xGateScore = typeof post.x_gate_score === "number"
          ? post.x_gate_score
          : baseScore;
        return {
          ...state,
          baseScore,
          learnedScore,
          learnedDelta: typeof post.learned_delta === "number"
            ? post.learned_delta
            : (typeof learnedScore === "number" && typeof baseScore === "number"
              ? Math.round((learnedScore - baseScore) * 1000) / 1000
              : null),
          xGateScore,
          learningConfidence: post.learning_confidence &&
              typeof post.learning_confidence === "object"
            ? post.learning_confidence as Record<string, unknown>
            : null,
          scoreBreakdown:
            post.score_breakdown && typeof post.score_breakdown === "object"
              ? post.score_breakdown as Record<string, unknown>
              : null,
        };
      }
      if (state.finalScore === null) {
        return {
          ...state,
          baseScore: null,
          learnedScore: null,
          learnedDelta: null,
          xGateScore: null,
          learningConfidence: null,
          scoreBreakdown: null,
        };
      }
      try {
        const { data: biasRow } = await supabase.from("settings").select(
          "value",
        ).eq("key", "learned_biases").maybeSingle();
        let knnPrior = 0;
        let knnPriorDetails = null;
        const { data: sigRow } = await supabase.from("story_signatures").select(
          "embedding",
        ).eq("tweet_id", tweetId).maybeSingle();
        if (sigRow?.embedding) {
          const { data: detailsData, error: detailsError } = await supabase.rpc(
            "knn_feedback_prior_details",
            {
              query_embedding: sigRow.embedding,
              exclude_tweet_id: tweetId,
            },
          );
          knnPriorDetails = normalizeKnnFeedbackPriorDetails(detailsData);
          knnPrior = priorFromKnnFeedbackDetails(knnPriorDetails);
          if (!knnPriorDetails || detailsError) {
            const { data: knnVal } = await supabase.rpc("knn_feedback_prior", {
              query_embedding: sigRow.embedding,
              exclude_tweet_id: tweetId,
            });
            knnPrior = typeof knnVal === "number" ? knnVal : 0;
          }
        }

        return applyLearnedFeedbackBias({
          deliveryDecision: state.deliveryDecision,
          decisionReason: state.decisionReason,
          finalScore: state.finalScore,
          filterEnabled,
          scoreOnly,
          threshold: activeFeedbackThreshold(),
          xGateThreshold: typeof config.xPostingConfig?.min_score === "number"
            ? config.xPostingConfig.min_score
            : 14,
          learningMode: config.scoringPolicy?.learning?.mode,
          authorHandle,
          tags: importanceTags,
          learnedBiases: biasRow?.value ?? {},
          knnPrior,
          knnPriorDetails,
          scoringV2: scoringPolicyResult
            ? buildScoringPolicyEventMeta(
              scoringPolicyResult,
              scoringPolicyActive ? "active" : "shadow",
            )
            : null,
        });
      } catch (biasErr) {
        console.warn("worker: feedback_bias_failed (non-fatal)");
        return {
          ...state,
          baseScore: state.finalScore,
          learnedScore: state.finalScore,
          learnedDelta: 0,
          xGateScore: state.finalScore,
          learningConfidence: null,
          scoreBreakdown: state.finalScore === null ? null : {
            ai: state.finalScore,
            base: state.finalScore,
            learned_delta: 0,
            learned: state.finalScore,
            final: state.finalScore,
            x_gate_score: state.finalScore,
            x_gate: state.finalScore,
          },
        };
      }
    };

    if (feedbackLocked) {
      splitDecisionState = await applyFeedbackBiasToDecision(
        buildBaseDecisionState(),
      );
      const preDecision = splitDecisionState.deliveryDecision;
      console.log(JSON.stringify({
        function: "worker",
        action: "pre_translation_gate_feedback_locked",
        tweet_id: tweetId,
        decision: preDecision,
        final_score: splitDecisionState.finalScore,
        reason: splitDecisionState.decisionReason,
      }));

      if (preDecision === "deliver" || scoreOnly) {
        if (
          typeof post.text_translated === "string" &&
          post.text_translated.trim()
        ) {
          translatedText = post.text_translated;
        } else {
          console.log(JSON.stringify({
            function: "worker",
            action: "translate_call_start",
            tweet_id: tweetId,
            model: config.openaiModel,
            reasoning_effort: config.openaiReasoningEffort,
            source: "feedback_locked",
          }));
          const trResult = await measureTranslationCall(() =>
            callObservedWorkerOpenAI(
              supabase,
              workflowRunKey!,
              {
                apiKey: openaiApiKey,
                ...buildTranslationRequest(),
              },
              {
                operationName: "translate",
                agentName: "translator",
                metadata: { path: "feedback_locked" },
              },
            )
          );
          if (!trResult.ok) {
            throw new Error(workerProviderFailureCode("worker_translation", trResult.status));
          }
          translationUsage =
            (trResult.raw?.usage as Record<string, unknown> | undefined) ??
              null;
          data = trResult.raw;
          translatedText = trResult.content;
          translationGeneratedThisRun = true;
          console.log(
            JSON.stringify({
              function: "worker",
              action: "translate_complete",
              tweet_id: tweetId,
              chars: translatedText.length,
              source: "feedback_locked",
            }),
          );
        }
      } else {
        translationSkippedByFilter = true;
        console.log(
          JSON.stringify({
            function: "worker",
            action: "translate_skipped_feedback_locked",
            tweet_id: tweetId,
            score: importanceScore,
          }),
        );
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "translate",
          "skipped",
          null,
          new Date().toISOString(),
          null,
          {
            reason: "feedback_locked_skip",
            score: importanceScore,
            scoring_call_ms: scoringCallMs,
          },
        );
      }
    } else if (filterEnabled && config.splitCalls) {
      if (scoringPolicyEnabled) {
        console.log(JSON.stringify({
          function: "worker",
          action: "score_v2_start",
          tweet_id: tweetId,
          mode: scoringPolicyActive ? "active" : "shadow",
          model: scoringModel,
        }));
        const calibrationExamples = await loadScoringCalibrationExamples(
          supabase,
          config.scoringPolicy.active_profile_id,
        );
        scoringPolicyResult = await measureScoringCall(() =>
          runScoringPolicy(
            {
              tweet_id: tweetId,
              text: String(post.text_original || ""),
              author_handle: authorHandle,
              account_name: accountName,
              url: post.url as string | null,
              published_at: publishedAt,
            },
            config.scoringPolicy,
            {
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
            },
            {
              calibrationExamples,
              callOpenAIImpl: (params) =>
                callObservedWorkerOpenAI(
                  supabase,
                  workflowRunKey!,
                  params,
                  {
                    operationName: "score-v2",
                    agentName: "importance-scorer",
                    metadata: {
                      path: "scoring_policy",
                      mode: scoringPolicyActive ? "active" : "shadow",
                    },
                  },
                ),
            },
          )
        );
        if (!scoringPolicyResult.ok) {
          throw new Error("worker_scoring_policy_failed");
        }
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "score",
          "completed",
          null,
          new Date().toISOString(),
          null,
          {
            ...buildScoringPolicyEventMeta(
              scoringPolicyResult,
              scoringPolicyActive ? "active" : "shadow",
            ),
            scoring_call_ms: scoringCallMs,
            model: scoringModel,
          },
        );
      }

      if (!scoringPolicyActive && legacyFilterEnabled) {
        const scoreToolFunction = buildToolFunction(false);

        console.log(
          JSON.stringify({
            function: "worker",
            action: "score_start",
            tweet_id: tweetId,
            model: scoringModel,
            reasoning_effort: scoringReasoningEffort,
          }),
        );

        const scoreResult = await measureScoringCall(() =>
          callObservedWorkerOpenAI(
            supabase,
            workflowRunKey!,
            {
              apiKey: openaiApiKey,
              model: scoringModel,
              messages: [
                { role: "system", content: renderSystemPrompt() },
                { role: "user", content: buildUserMessage() },
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
            },
            {
              operationName: "score",
              agentName: "importance-scorer",
              metadata: { path: "legacy_split" },
            },
          )
        );

        if (!scoreResult.ok) {
          throw new Error(workerProviderFailureCode("worker_scoring", scoreResult.status));
        }
        scoringUsage =
          (scoreResult.raw?.usage as Record<string, unknown> | undefined) ??
            null;
        data = scoreResult.raw;

        if (scoreResult.toolCall) {
          try {
            const parsedScore = parseClassifierToolCallArguments(
              scoreResult.toolCall.arguments,
            );
            importanceScore = parsedScore.importanceScore;
            importanceTags = parsedScore.importanceTags;
            importanceReasoning = parsedScore.importanceReasoning;
            scoreAxes = parsedScore.scoreAxes;
            console.log(JSON.stringify({
              function: "worker",
              action: "scored",
              tweet_id: tweetId,
              score: importanceScore,
              axes: scoreAxes,
              tags: importanceTags,
              reasoning: importanceReasoning,
              endpoint: scoreResult.endpoint,
              model: scoringModel,
            }));
            await insertPipelineEvent(
              supabase,
              "post",
              tweetId,
              "score",
              "completed",
              null,
              new Date().toISOString(),
              null,
              {
                score: importanceScore,
                axes: scoreAxes,
                model: scoringModel,
                scoring_call_ms: scoringCallMs,
              },
            );
          } catch (parseErr) {
            console.warn("worker: score_tool_parse_failed");
          }
        }
      }

      // Decide gate BEFORE translating. Learned feedback must be applied here,
      // otherwise a below-threshold item can skip translation and later become
      // deliverable via feedback_boost with no Persian text persisted.
      splitDecisionState = await applyFeedbackBiasToDecision(
        buildBaseDecisionState(),
      );
      const preDecision = splitDecisionState.deliveryDecision;
      console.log(JSON.stringify({
        function: "worker",
        action: "pre_translation_gate",
        tweet_id: tweetId,
        decision: preDecision,
        final_score: splitDecisionState.finalScore,
        reason: splitDecisionState.decisionReason,
      }));

      // Translate only if passing the gate (or in score_only mode where we still translate everything)
      if (preDecision === "deliver" || scoreOnly) {
        console.log(
          JSON.stringify({
            function: "worker",
            action: "translate_call_start",
            tweet_id: tweetId,
            model: config.openaiModel,
            reasoning_effort: config.openaiReasoningEffort,
          }),
        );
        const trResult = await measureTranslationCall(() =>
          callObservedWorkerOpenAI(
            supabase,
            workflowRunKey!,
            {
              apiKey: openaiApiKey,
              ...buildTranslationRequest(),
            },
            {
              operationName: "translate",
              agentName: "translator",
              metadata: { path: "split_gate_passed" },
            },
          )
        );
        if (!trResult.ok) {
          throw new Error(workerProviderFailureCode("worker_translation", trResult.status));
        }
        translationUsage =
          (trResult.raw?.usage as Record<string, unknown> | undefined) ?? null;
        translatedText = trResult.content;
        translationGeneratedThisRun = true;
        console.log(
          JSON.stringify({
            function: "worker",
            action: "translate_complete",
            tweet_id: tweetId,
            chars: translatedText.length,
          }),
        );
      } else {
        translationSkippedByFilter = true;
        console.log(
          JSON.stringify({
            function: "worker",
            action: "translate_skipped_by_filter",
            tweet_id: tweetId,
            score: importanceScore,
          }),
        );
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "translate",
          "skipped",
          null,
          new Date().toISOString(),
          null,
          {
            reason: "translation_skipped_not_needed",
            score: importanceScore,
            scoring_call_ms: scoringCallMs,
          },
        );
      }
    } else if (filterEnabled) {
      // ============ COMBINED PATH (legacy, when split_calls = false) ============
      const toolFunction = buildToolFunction(true);
      const result = await measureTranslationCall(() =>
        callObservedWorkerOpenAI(
          supabase,
          workflowRunKey!,
          {
            apiKey: openaiApiKey,
            model: config.openaiModel,
            messages: [
              { role: "system", content: renderSystemPrompt() },
              { role: "user", content: buildUserMessage() },
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
          },
          {
            operationName: "classify-and-translate",
            agentName: "importance-scorer",
            metadata: { path: "combined_filter" },
          },
        )
      );
      scoringCallMs = scoringCallMs ?? translationCallMs;
      if (!result.ok) {
        throw new Error(workerProviderFailureCode("worker_combined", result.status));
      }
      data = result.raw;
      if (result.toolCall) {
        try {
          const parsedScore = parseClassifierToolCallArguments(
            result.toolCall.arguments,
            { includeTranslatedText: true },
          );
          translatedText = parsedScore.translatedText || "";
          translationGeneratedThisRun = true;
          importanceScore = parsedScore.importanceScore;
          importanceTags = parsedScore.importanceTags;
          importanceReasoning = parsedScore.importanceReasoning;
          scoreAxes = parsedScore.scoreAxes;
          console.log(JSON.stringify({
            function: "worker",
            action: "scored",
            tweet_id: tweetId,
            score: importanceScore,
            axes: scoreAxes,
            tags: importanceTags,
            reasoning: importanceReasoning,
            endpoint: result.endpoint,
          }));
          await insertPipelineEvent(
            supabase,
            "post",
            tweetId,
            "score",
            "completed",
            null,
            new Date().toISOString(),
            null,
            {
              score: importanceScore,
              axes: scoreAxes,
              model: config.openaiModel,
              scoring_call_ms: scoringCallMs,
              translation_call_ms: translationCallMs,
              combined_model_call: true,
            },
          );
        } catch (parseErr) {
          console.warn("worker: translation_tool_parse_failed; using content fallback");
          translatedText = result.content;
          translationGeneratedThisRun = true;
        }
      } else {
        translatedText = result.content;
        translationGeneratedThisRun = true;
      }
    } else {
      // No filtering — simple translation
      const result = await measureTranslationCall(() =>
        callObservedWorkerOpenAI(
          supabase,
          workflowRunKey!,
          {
            apiKey: openaiApiKey,
            ...buildTranslationRequest(),
          },
          {
            operationName: "translate",
            agentName: "translator",
            metadata: { path: "translation_only" },
          },
        )
      );
      if (!result.ok) {
        throw new Error(workerProviderFailureCode("worker_translation", result.status));
      }
      data = result.raw;
      translatedText = result.content;
      translationGeneratedThisRun = true;
    }

    if (
      !translationSkippedByFilter && translationGeneratedThisRun &&
      translatedText && String(translatedText).trim()
    ) {
      const readability = await measureTranslationCall(() =>
        repairTranslationReadability({
          apiKey: openaiApiKey,
          model: config.openaiModel,
          originalText: String(post.text_original || ""),
          translatedText,
          callOpenAI: (params) =>
            callObservedWorkerOpenAI(
              supabase,
              workflowRunKey!,
              params,
              {
                operationName: "readability-repair",
                agentName: "readability-repair",
                metadata: { path: "translation_readability" },
              },
            ),
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
        })
      );
      translatedText = readability.text;
      translationReadability = translationReadabilityMeta(readability);
      if (!readability.initial.ok || readability.repaired) {
        console.log(JSON.stringify({
          function: "worker",
          action: "translation_readability_checked",
          tweet_id: tweetId,
          initial_issue_codes: readability.initial.issues.map((issue) =>
            issue.code
          ),
          final_issue_codes: readability.final.issues.map((issue) =>
            issue.code
          ),
          repair_status: readability.repairStatus,
          accepted_repair: readability.acceptedRepair,
          chars_before: readability.initial.metrics.chars,
          chars_after: readability.final.metrics.chars,
        }));
      }
    }

    // GUARD: Empty translation = silent failure mode.
    // Reasoning models (gpt-5.x-mini etc.) can burn the entire max_completion_tokens
    // budget on hidden reasoning, returning a tool call with empty `translated_text`
    // or empty content. If we persist that, `text_translated is not null` passes the
    // delivery gate and Telegram's template falls back to the English original — so
    // the user sees an English tweet delivered "without translation". Treat empty
    // output as a transient failure and let the job retry.
    if (
      !translationSkippedByFilter &&
      (!translatedText || !String(translatedText).trim())
    ) {
      const finishReason =
        (data?.choices?.[0]?.finish_reason as string | undefined) ??
          (data?.status as string | undefined) ??
          "unknown";
      const usage = data?.usage ?? null;
      console.warn(JSON.stringify({
        function: "worker",
        action: "empty_translation",
        tweet_id: tweetId,
        model: config.openaiModel,
        finish_reason: finishReason,
        usage,
      }));
      throw new Error(
        `empty_translation: model=${config.openaiModel} finish_reason=${finishReason} (likely reasoning-token budget exhausted; raise openai_max_completion_tokens or lower reasoning_effort)`,
      );
    }

    const nowIso = new Date().toISOString();
    const resultMeta = buildTranslationResultMeta({
      model: config.openaiModel,
      scoringModel,
      usage: data.usage ?? null,
      scoringUsage,
      translationUsage,
      translationReadability,
      scoringV2Usage: scoringPolicyResult?.usage ?? null,
      scoringCallMs,
      translationCallMs,
      queueWaitMs: jobTimingMeta(job, "running").queue_wait_ms,
      claimDelayMs: jobTimingMeta(job, "running").claim_delay_ms,
      finishedAt: nowIso,
      importanceScore,
      scoringVersion: scoringPolicyResult ? SCORING_POLICY_VERSION : null,
      splitCalls: !!(filterEnabled && config.splitCalls),
    });
    await mergeJobResultMeta(supabase, job, resultMeta);

    // Determine delivery decision based on active editorial profile or legacy
    // content filter. In split mode this was already computed before translation
    // so feedback-boosted posts could receive a translation before delivery.
    const finalDecisionState = splitDecisionState ??
      await applyFeedbackBiasToDecision(buildBaseDecisionState());
    let duplicatePatch: ReturnType<typeof duplicateDecisionPatch> = null;
    try {
      const { data: latestDedupe, error: latestDedupeError } = await supabase
        .from("posts")
        .select("dedupe_status, dup_of_tweet_id, dedupe_reason")
        .eq("tweet_id", tweetId)
        .maybeSingle();
      if (latestDedupeError) throw latestDedupeError;
      duplicatePatch = duplicateDecisionPatch(
        latestDedupe as {
          dedupe_status?: string | null;
          dup_of_tweet_id?: string | null;
          dedupe_reason?: string | null;
        } | null,
      );
    } catch (dedupeCheckErr) {
      throw new NonRetryableJobError("translate_dedupe_state_unknown");
    }
    const deliveryDecision = duplicatePatch?.delivery_decision ??
      finalDecisionState.deliveryDecision;
    const decisionReason = duplicatePatch?.decision_reason ??
      finalDecisionState.decisionReason;
    const finalScore = finalDecisionState.finalScore;
    const baseScore = finalDecisionState.baseScore;
    const learnedScore = finalDecisionState.learnedScore;
    const learnedDelta = finalDecisionState.learnedDelta;
    const xGateScore = finalDecisionState.xGateScore;
    const learningConfidence = finalDecisionState.learningConfidence;
    const scoreBreakdown = finalDecisionState.scoreBreakdown;

    const { error: updateError } = await supabase
      .from("posts")
      .update(buildPostTranslationUpdatePatch({
        translationSkippedByFilter,
        translatedText,
        nowIso,
        openaiModel: config.openaiModel,
        translationTokens:
          (data?.usage as { total_tokens?: number } | undefined)
            ?.total_tokens ?? null,
        translationDurationMs: job.started_at
          ? (Date.now() - new Date(job.started_at as string).getTime())
          : null,
        importanceScore,
        importanceTags,
        importanceReasoning,
        deliveryDecision,
        scoreAxes,
        finalScore,
        baseScore,
        learnedScore,
        learnedDelta,
        xGateScore,
        learningConfidence,
        decisionReason,
        scoreBreakdown,
        scoringPolicy: scoringPolicyResult
          ? {
            scoringVersion: SCORING_POLICY_VERSION,
            scoringProfileId: scoringPolicyResult.profile_id,
            audienceClass: scoringPolicyResult.audience_class,
            audienceConfidence: scoringPolicyResult.audience_confidence,
            audienceReason: scoringPolicyResult.audience_reason,
            globalExceptionClass: scoringPolicyResult.global_exception_class,
            scoreReviewStatus: scoringPolicyActive
              ? scoringPolicyResult.review_status
              : "shadow",
          }
          : null,
      }))
      .eq("tweet_id", tweetId);

    if (updateError) throw updateError;

    // Decide what to enqueue next based on filter decision + truncation state.
    // NEW FLOW: If a tweet PASSED the editorial gate AND is still truncated AND
    // not yet hydrated, enqueue hydrate_tweet instead of deliver. The hydrate
    // job will re-enqueue translate on success, which will fall through to
    // deliver on the second pass (is_truncated will be false by then).
    const isTruncated = (post as Record<string, unknown>).is_truncated === true;
    const alreadyHydrated = !!(post as Record<string, unknown>).hydrated_at;
    const hydrationCfg = await loadHydrationSettings(supabase);
    if (!hydrationCfg.available) {
      throw new JobDeferred(
        "translate_hydration_settings_read_failed",
        30_000,
        { tweet_id: tweetId, check: "hydration_settings" },
      );
    }
    const shouldHydrateNow = shouldQueueHydrationAfterTranslation({
      deliveryDecision,
      isTruncated,
      alreadyHydrated,
      hydrationEnabled: hydrationCfg.enabled,
    });
    let autoEnrichEnabled = false;
    if (deliveryDecision === "deliver" && !shouldHydrateNow) {
      // Enrichment is an optional X-draft layer. In manual-only mode the main
      // pipeline must continue with plain translation delivery.
      try {
        const { data: enrichCfgRow, error: enrichCfgError } = await supabase
          .from("settings")
          .select("value")
          .eq("key", "enrichment_config")
          .maybeSingle();
        if (enrichCfgError) {
          throw new JobDeferred(
            "translate_enrichment_config_read_failed",
            30_000,
            { tweet_id: tweetId, check: "enrichment_config" },
          );
        }
        const enrichConfig = normalizeEnrichmentConfig(
          (enrichCfgRow?.value ?? { enabled: false }) as Partial<
            EnrichmentConfig
          >,
        );
        autoEnrichEnabled = isAutoEnrichmentEnabled(enrichConfig);
      } catch (error) {
        if (error instanceof JobDeferred) throw error;
        throw new JobDeferred(
          "translate_enrichment_config_read_failed",
          30_000,
          { tweet_id: tweetId, check: "enrichment_config" },
        );
      }
    }
    const postTranslationRoute = choosePostTranslationRoute({
      tweetId,
      deliveryDecision,
      decisionReason,
      importanceScore,
      isTruncated,
      alreadyHydrated,
      hydrationEnabled: hydrationCfg.enabled,
      autoEnrichEnabled,
      duplicateBlocked: !!duplicatePatch,
    });

    if (postTranslationRoute.kind === "hydrate") {
      console.log(
        JSON.stringify({
          function: "worker",
          action: "hydration_gated_enqueue",
          tweet_id: tweetId,
          score: importanceScore,
        }),
      );
      const { error: hydrateJobError } = await supabase
        .from("jobs")
        .upsert({
          ...postTranslationRoute.job,
          next_run_at: new Date().toISOString(),
      }, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (hydrateJobError) {
        throw new JobDeferred(
          "hydrate_job_enqueue_failed",
          30_000,
          { tweet_id: tweetId, check: "post_translate_hydrate" },
        );
      } else {
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          postTranslationRoute.event.step,
          postTranslationRoute.event.status,
          null,
          null,
          null,
          postTranslationRoute.event.meta,
        );
      }
    } else if (postTranslationRoute.kind === "enrich_and_deliver") {
      const { error: enrichJobError } = await supabase
        .from("jobs")
        .upsert({
          ...postTranslationRoute.enrichJob,
          next_run_at: new Date().toISOString(),
      }, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (enrichJobError) {
        console.warn(JSON.stringify({
          function: "worker",
          action: "enrich_enqueue_failed",
          tweet_id: tweetId,
          error: "enrich_job_enqueue_failed",
        }));
      } else {
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          postTranslationRoute.enrichEvent.step,
          postTranslationRoute.enrichEvent.status,
          null,
          null,
          null,
          postTranslationRoute.enrichEvent.meta,
        );
        console.log(
          JSON.stringify({
            function: "worker",
            action: "enrich_enqueued",
            tweet_id: tweetId,
          }),
        );
      }
      // Enrichment v2 is shadow/review-first for X, but Telegram delivery
      // remains translation-first and should not wait on enrichment approval.
      await enqueuePostDeliveryAfterRenderGate(
        supabase,
        tweetId,
        postTranslationRoute.delivery.source,
        postTranslationRoute.delivery.resetExisting,
      );
    } else if (postTranslationRoute.kind === "deliver") {
      await enqueuePostDeliveryAfterRenderGate(
        supabase,
        tweetId,
        postTranslationRoute.delivery.source,
        postTranslationRoute.delivery.resetExisting,
      );
    } else {
      console.log(
        JSON.stringify({
          function: "worker",
          action: "delivery_skipped",
          tweet_id: tweetId,
          score: importanceScore,
          decision: deliveryDecision,
        }),
      );
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        postTranslationRoute.event.step,
        postTranslationRoute.event.status,
        null,
        nowIso,
        null,
        postTranslationRoute.event.meta,
      );
    }

    await finishWorkflowRun(supabase, workflowRunKey, "completed", {
      delivery_decision: deliveryDecision,
      route: postTranslationRoute.kind,
      scoring_policy_v2: scoringPolicyResult != null,
      translation_generated: translationGeneratedThisRun,
      translation_skipped_by_filter: translationSkippedByFilter,
    });
    return true;
  } catch (error) {
    if (error instanceof JobDeferred) throw error;
    const e = workerBoundaryError(error, "translate_failed");
    const tid = (job.payload as Record<string, unknown> | undefined)?.tweet_id;
    console.error(JSON.stringify({
      function: "worker",
      action: "translate_error",
      tweet_id: tid ?? "unknown",
      error: e.message,
      name: e.name,
    }));
    if (tid != null && typeof tid === "string") {
      if (workflowRunKey) {
        await finishWorkflowRun(supabase, workflowRunKey, "failed", {
          tweet_id: tid,
        }, e);
      }
      throw new Error(`translate[${tid}]: ${e.message}`);
    }
    if (workflowRunKey) {
      await finishWorkflowRun(supabase, workflowRunKey, "failed", {}, e);
    }
    throw e;
  }
}

async function handleModerateJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<boolean> {
  let workflowRunKey: string | null = null;
  try {
    const payload = job.payload as Record<string, unknown>;
    const subjectId = payload.subject_id as string;
    if (!subjectId) throw new Error("moderate: missing subject_id in job payload");
    const subjectType = typeof payload.subject_type === "string"
      ? payload.subject_type
      : "unknown";
    const workflowRunId = workerWorkflowRunId(job, subjectId, "moderate");
    workflowRunKey = workerWorkflowRunKey("moderate", workflowRunId);
    await startWorkflowRun(supabase, {
      runKey: workflowRunKey,
      workflowName: "moderation-pipeline",
      workflowRunId,
      status: "running",
      source: "worker",
      sourceFunction: "handleModerateJob",
      subjectType,
      subjectId,
      jobId: typeof job.id === "string" ? job.id : null,
      tweetId: subjectType === "post" ? subjectId : null,
      metadata: {
        job_type: "moderate",
        subject_type: subjectType,
      },
    });
    console.log(
      JSON.stringify({
        function: "worker",
        action: "moderate_start",
        subject_id: subjectId,
      }),
    );

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) throw new Error("OpenAI API key not configured");

    let content = "";
    if (subjectType === "post") {
      const { data: post } = await supabase
        .from("posts")
        .select("text_translated, text_original")
        .eq("tweet_id", subjectId)
        .single();
      content = post?.text_translated || post?.text_original || "";
    }

    if (!content) throw new Error("No content to moderate");

    const moderationStartedAt = new Date();
    let moderationHttpStatus: number | null = null;
    let moderationErrorCode = "worker_moderation_request_failed";
    let data: Record<string, unknown>;
    try {
      const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: content }),
      });
      moderationHttpStatus = response.status;
      const rawText = await response.text();
      if (!response.ok) {
        moderationErrorCode = workerProviderFailureCode(
          "worker_moderation",
          moderationHttpStatus,
        );
        throw new Error(moderationErrorCode);
      }
      data = JSON.parse(rawText);
      await recordObservedProviderCall(supabase, {
        workflowRunKey: workflowRunKey!,
        traceName: "moderation-pipeline",
        operationName: "moderate_content",
        agentName: "moderation-classifier",
        model: typeof data.model === "string" ? data.model : null,
        endpoint: "moderations",
        status: "completed",
        httpStatus: moderationHttpStatus,
        usage: data.usage && typeof data.usage === "object"
          ? data.usage as Record<string, unknown>
          : null,
        startedAt: moderationStartedAt,
        endedAt: new Date(),
        spanEstimate: 0,
        foglampExported: false,
        foglampSkipReason: "non_chat_endpoint",
        metadata: {
          subject_type: subjectType,
        },
      });
    } catch (_moderationError) {
      await recordObservedProviderCall(supabase, {
        workflowRunKey: workflowRunKey!,
        traceName: "moderation-pipeline",
        operationName: "moderate_content",
        agentName: "moderation-classifier",
        model: null,
        endpoint: "moderations",
        status: "failed",
        httpStatus: moderationHttpStatus,
        usage: null,
        startedAt: moderationStartedAt,
        endedAt: new Date(),
        error: new Error(moderationErrorCode),
        spanEstimate: 0,
        foglampExported: false,
        foglampSkipReason: "non_chat_endpoint",
        metadata: {
          subject_type: subjectType,
        },
      });
      throw new Error(moderationErrorCode);
    }
    const moderation = Array.isArray(data.results) &&
        data.results[0] && typeof data.results[0] === "object"
      ? data.results[0] as Record<string, unknown>
      : {};

    const { error } = await supabase
      .from("moderation_events")
      .insert([{
        subject_type: subjectType,
        subject_id: subjectId,
        verdict: moderation.flagged === true ? null : "allow",
        categories: moderation.categories,
      }]);

    if (error) throw error;
    await finishWorkflowRun(supabase, workflowRunKey!, "completed", {
      job_type: "moderate",
      subject_type: subjectType,
      flagged: moderation.flagged === true,
    });
    return true;
  } catch (error) {
    const e = workerBoundaryError(error, "moderate_failed");
    if (workflowRunKey) {
      await finishWorkflowRun(supabase, workflowRunKey, "failed", {
        job_type: "moderate",
      }, e);
    }
    console.error(
      JSON.stringify({
        function: "worker",
        action: "moderate_error",
        error: e.message,
      }),
    );
    throw e;
  }
}

async function handleDeliverJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    console.log(
      JSON.stringify({
        function: "worker",
        action: "deliver_start",
        tweet_id: tweetId,
      }),
    );

    const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID");

    if (!telegramBotToken || !telegramChatId) {
      throw new Error("Telegram configuration not set");
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select(
        "tweet_id, text_original, text_translated, url, tweeted_at, has_media, account_id, author_handle",
      )
      .eq("tweet_id", tweetId)
      .single();

    if (postError || !post) throw new Error(`Post not found: ${tweetId}`);

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("handle, display_name")
      .eq("id", post.account_id)
      .single();
    if (accountError) {
      throw new JobDeferred(
        "telegram_account_read_failed",
        30_000,
        { tweet_id: tweetId, check: "account" },
      );
    }

    const messageTemplate = config.messageTemplate as Record<string, unknown>;

    const { data: media, error: mediaError } = await supabase
      .from("media")
      .select(
        "id, kind, src_url, storage_path, ordering, downloaded_at, mime_type, file_size, duration_ms, width, height",
      )
      .eq("tweet_id", tweetId)
      .order("ordering");
    if (mediaError) {
      throw new JobDeferred(
        "telegram_media_read_failed",
        30_000,
        { tweet_id: tweetId, check: "media" },
      );
    }

    // Idempotency: skip if already posted
    try {
      const { data: existingDelivery, error: existingDeliveryError } = await supabase
        .from("deliveries")
        .select("id")
        .eq("subject_type", "post")
        .eq("subject_id", tweetId)
        .eq("status", "posted")
        .eq("telegram_chat_id", telegramChatId)
        .limit(1);
      if (existingDeliveryError) throw existingDeliveryError;
      if (!Array.isArray(existingDelivery)) {
        throw new Error("telegram_duplicate_check_invalid_response");
      }
      if (existingDelivery && existingDelivery.length > 0) {
        console.log(
          JSON.stringify({
            function: "worker",
            action: "deliver_skip_duplicate",
            tweet_id: tweetId,
          }),
        );
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "deliver",
          "completed",
          null,
          new Date().toISOString(),
          null,
          { skipped: "duplicate_subject" },
        );
        return true;
      }
    } catch (_e) {
      throw new JobDeferred(
        "telegram_duplicate_check_failed",
        30_000,
        { tweet_id: tweetId, check: "posted_delivery" },
      );
    }

    // Cross-subject dedupe by canonical URL
    if (post.url) {
      try {
        const { data: siblingPosts, error: siblingPostsError } = await supabase.from("posts").select(
          "tweet_id",
        ).eq("url", post.url);
        if (siblingPostsError) throw siblingPostsError;
        if (!Array.isArray(siblingPosts)) {
          throw new Error("telegram_url_sibling_posts_invalid_response");
        }
        const siblingIds = (siblingPosts || []).map((p: unknown) => {
          if (!p || typeof p !== "object" || Array.isArray(p)) {
            throw new Error("telegram_url_sibling_posts_invalid_row");
          }
          const tweetIdValue = (p as Record<string, unknown>).tweet_id;
          if (typeof tweetIdValue !== "string" || tweetIdValue.trim().length === 0) {
            throw new Error("telegram_url_sibling_posts_invalid_row");
          }
          return tweetIdValue.trim();
        });
        if (siblingIds.length > 0) {
          const { data: siblingDeliveries, error: siblingDeliveriesError } = await supabase
            .from("deliveries").select("id").eq("status", "posted").eq(
              "subject_type",
              "post",
            ).in("subject_id", siblingIds).eq(
              "telegram_chat_id",
              telegramChatId,
            ).limit(1);
          if (siblingDeliveriesError) throw siblingDeliveriesError;
          if (!Array.isArray(siblingDeliveries)) {
            throw new Error("telegram_url_sibling_deliveries_invalid_response");
          }
          if (siblingDeliveries && siblingDeliveries.length > 0) {
            console.log(
              JSON.stringify({
                function: "worker",
                action: "deliver_skip_url_dupe",
                tweet_id: tweetId,
                url: post.url,
              }),
            );
            await insertPipelineEvent(
              supabase,
              "post",
              tweetId,
              "deliver",
              "completed",
              null,
              new Date().toISOString(),
              null,
              { skipped: "duplicate_url", url: post.url },
            );
            return true;
          }
        }
      } catch (_e) {
        throw new JobDeferred(
          "telegram_url_duplicate_check_failed",
          30_000,
          { tweet_id: tweetId, check: "url_delivery" },
        );
      }
    }

    // Duplicate Gate is expected to run before translation, but keep this
    // delivery-time guard as a final idempotent safety check.
    const finalGuard = await evaluateFinalDedupeGuard({
      supabase,
      tweetId,
      storyMemory: config.storyMemory,
      source: "telegram_final_assertion",
    });
    if (finalGuard.action === "skip") {
      console.log(JSON.stringify({
        function: "worker",
        action: finalGuard.reason === "final_duplicate_assertion"
          ? "deliver_skip_final_duplicate_assertion"
          : "deliver_skip_story_dup",
        tweet_id: tweetId,
        ...finalGuard.meta,
      }));
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "deliver",
        "completed",
        null,
        new Date().toISOString(),
        null,
        finalGuard.meta,
      );
      return true;
    }
    if (finalGuard.action === "fail") {
      console.warn(JSON.stringify({
        function: "worker",
        action: "deliver_deferred_dedupe_assertion_failed",
        tweet_id: tweetId,
        error: finalGuard.error,
      }));
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "deliver",
        "failed",
        null,
        new Date().toISOString(),
        finalGuard.error,
        finalGuard.meta,
      );
      throw new JobDeferred(
        "telegram_dedupe_assertion_failed",
        30_000,
        {
          tweet_id: tweetId,
          check: "final_dedupe_assertion",
          ...finalGuard.meta,
        },
      );
    }

    const renderGate = await prepareVideoRenderGate(
      supabase,
      tweetId,
      "telegram_delivery",
    );
    if (renderGate.blocked) {
      await insertPipelineEvent(
        supabase,
        "post",
        tweetId,
        "deliver",
        "completed",
        null,
        new Date().toISOString(),
        null,
        {
          skipped: "video_render_blocked",
          reason: renderGate.blockReason,
          gate_action: renderGate.decision.action,
        },
      );
      console.log(JSON.stringify({
        function: "worker",
        action: "deliver_skip_video_render_blocked",
        tweet_id: tweetId,
        reason: renderGate.blockReason,
      }));
      return true;
    }
    if (!renderGate.ready) {
      throw new JobDeferred(
        `video_render_pending:${renderGate.decision.action}`,
        VIDEO_RENDER_DEFER_MS,
        {
          tweet_id: tweetId,
          gate_action: renderGate.decision.action,
        },
      );
    }
    const deliveryMedia = applyRenderedVideoPreference(
      renderGate.mediaRows.length > 0
        ? renderGate.mediaRows
        : ((media as XMediaRow[] | null) ?? []),
      renderGate.decision,
    );

    let telegramClaim: Awaited<ReturnType<typeof claimTelegramDelivery>>;
    try {
      telegramClaim = await claimTelegramDelivery(supabase, {
        tweetId,
        chatId: telegramChatId,
        source: "worker:deliver",
      });
    } catch (_claimError) {
      throw new JobDeferred(
        "telegram_delivery_claim_failed",
        30_000,
        { tweet_id: tweetId, check: "claim" },
      );
    }
    if (!telegramClaim.claimed) {
      if (telegramClaim.reason.startsWith("delivery_cutover_blocked")) {
        const reason = "delivery_cutover_blocked:telegram_claim";
        await settleBlockedDeliveryJob(supabase, job, reason);
        throw new DeliveryCutoverSettled(reason);
      }
      if (telegramClaim.reason === "already_posted") {
        await insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "deliver",
          "completed",
          null,
          new Date().toISOString(),
          null,
          { skipped: "telegram_claim_already_posted" },
        );
        return true;
      }
      if (telegramClaim.reason === "ambiguous") {
        throw new NonRetryableJobError(
          "telegram_delivery_ambiguous_requires_reconciliation",
        );
      }
      throw new JobDeferred(
        `telegram_delivery_claim:${telegramClaim.reason}`,
        30_000,
        { tweet_id: tweetId, claim_reason: telegramClaim.reason },
      );
    }

    const claimIdentity = {
      deliveryId: telegramClaim.deliveryId as string,
      claimToken: telegramClaim.claimToken as string,
      claimGeneration: telegramClaim.claimGeneration as number,
    };
    let providerStarted = false;
    const beforeTelegramProviderCall = async () => {
      try {
        // This check runs for the initial request and every provider retry.
        await requireExternalPosting(supabase);
        await requireDeliveryCutover(supabase, tweetId);
      } catch (error) {
        if (error instanceof DeliveryCutoverBlockedError) {
          await settleBlockedDeliveryJob(supabase, job, error.message);
          throw new DeliveryCutoverSettled(error.message);
        }
        throw new JobDeferred("telegram_external_posting_blocked", 30_000, {
          tweet_id: tweetId,
          check: "external_posting_guard",
        });
      }
      if (providerStarted) return;
      let started = false;
      try {
        started = await startTelegramDelivery(supabase, claimIdentity);
      } catch (_error) {
        throw new JobDeferred(
          "telegram_delivery_claim_start_failed",
          30_000,
          { tweet_id: tweetId },
        );
      }
      if (!started) {
        throw new JobDeferred(
          "telegram_delivery_claim_lost_before_provider",
          30_000,
          { tweet_id: tweetId },
        );
      }
      providerStarted = true;
    };

    const message = formatMessageWithTemplate(post, account, messageTemplate);
    let telegramMessageIds: string[] = [];
    const telegramStartedAt = Date.now();
    const telegramMethods: string[] = [];
    const addTelegramMethod = (method: string) => {
      if (!telegramMethods.includes(method)) telegramMethods.push(method);
    };

    const deliveryMediaRecords = deliveryMedia as Array<
      Record<string, unknown>
    >;
    try {
      if (deliveryMediaRecords && deliveryMediaRecords.length > 0) {
        const images = deliveryMediaRecords.filter((m: Record<string, unknown>) =>
          m.kind === "image"
        );
        const videos = deliveryMediaRecords.filter((m: Record<string, unknown>) =>
          m.kind === "video"
        );
        const audios = deliveryMediaRecords.filter((m: Record<string, unknown>) =>
          m.kind === "audio"
        );

        if (images.length > 0) {
          if (images.length === 1) {
            const image = images[0];
            addTelegramMethod("sendPhoto");
            const msgIds = await sendTelegramPhotoFromStorage(
              supabase,
              telegramBotToken,
              telegramChatId,
              image,
              message,
              beforeTelegramProviderCall,
            );
            telegramMessageIds.push(...msgIds);
          } else {
            addTelegramMethod("sendMediaGroup");
            const msgIds = await sendTelegramPhotoGroupFromStorage(
              supabase,
              telegramBotToken,
              telegramChatId,
              images.slice(0, 10),
              message,
              beforeTelegramProviderCall,
            );
            telegramMessageIds.push(...msgIds);
          }
        }

        for (const video of videos) {
          addTelegramMethod("sendVideo");
          const msgIds = await sendTelegramVideoFromStorage(
            supabase,
            telegramBotToken,
            telegramChatId,
            video,
            message,
            beforeTelegramProviderCall,
          );
          telegramMessageIds.push(...msgIds);
        }

        for (const audio of audios) {
          addTelegramMethod("sendAudio");
          const audioUrl = await getMediaUrl(supabase, audio);
          const caption = images.length === 0 && videos.length === 0
            ? message
            : "Audio from tweet";
          const msgIds = await sendTelegramMedia(
            "sendAudio",
            telegramBotToken,
            telegramChatId,
            { audio: audioUrl },
            caption,
            beforeTelegramProviderCall,
          );
          telegramMessageIds.push(...msgIds);
        }
      } else {
        addTelegramMethod("sendMessage");
        await beforeTelegramProviderCall();
        const response = await fetch(
          `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramChatId,
              text: message,
              parse_mode: "Markdown",
              disable_web_page_preview: false,
            }),
          },
        );
        const result = await response.json();
        if (result.ok) {
          telegramMessageIds.push(String(result.result.message_id));
        } else {
          let finalResult = result;
          let finalStatus = response.status;
          if (isTelegramParseError(result?.description ?? "")) {
            await beforeTelegramProviderCall();
            const retryResp = await fetch(
              `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: telegramChatId,
                  text: stripMarkdownToPlain(message),
                  disable_web_page_preview: false,
                }),
              },
            );
            const retryResult = await retryResp.json();
            finalResult = retryResult;
            finalStatus = retryResp.status;
            if (retryResult?.ok) {
              telegramMessageIds.push(String(retryResult.result.message_id));
            }
          }
          if (!finalResult?.ok) {
            throwTelegramError("sendMessage", finalResult, finalStatus);
          }
        }
      }
    } catch (error) {
      if (providerStarted) {
        try {
          await markTelegramDeliveryAmbiguous(supabase, {
            ...claimIdentity,
            messageIds: telegramMessageIds,
          });
        } catch (_ambiguityError) {
          // The non-retryable boundary remains authoritative if ambiguity persistence fails.
        }
        throw new NonRetryableJobError(
          "telegram_delivery_ambiguous_requires_reconciliation",
        );
      }
      throw error;
    }

    if (!providerStarted) {
      throw new JobDeferred(
        "telegram_delivery_no_provider_call",
        30_000,
        { tweet_id: tweetId, check: "sendable_media" },
      );
    }

    let completed = false;
    try {
      completed = await completeTelegramDelivery(supabase, {
        ...claimIdentity,
        messageIds: telegramMessageIds,
      });
    } catch (_completionError) {
      completed = false;
    }
    if (!completed) {
      try {
        await markTelegramDeliveryAmbiguous(supabase, {
          ...claimIdentity,
          messageIds: telegramMessageIds,
          error: "telegram_delivery_completion_unknown",
        });
      } catch (_ambiguityError) {
        // Do not turn an unknown provider outcome into an automatic retry.
      }
      throw new NonRetryableJobError(
        "telegram_delivery_completion_unknown",
      );
    }

    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "deliver",
      "completed",
      null,
      new Date().toISOString(),
      null,
      {
        message_ids: telegramMessageIds,
        telegram_api_ms: Date.now() - telegramStartedAt,
        telegram_method: telegramMethods.join("+") || "unknown",
        message_count: telegramMessageIds.length,
      },
    );
    await markVideoRenderPosted(supabase, tweetId);
    return true;
  } catch (error) {
    if (
      error instanceof StaleMediaObjectError &&
      !isProcessedRenderStoragePath(error.storagePath)
    ) {
      try {
        await repairStaleMediaObject(supabase, {
          tweetId,
          mediaId: error.mediaId,
          storagePath: error.storagePath,
          source: "telegram_delivery",
        });
      } catch (_repairError) {
        throw new JobDeferred(
          "stale_media_repair_failed",
          30_000,
          {
            tweet_id: tweetId,
            media_id: error.mediaId,
            storage_path: error.storagePath,
            check: "stale_media_repair",
          },
        );
      }
      throw new JobDeferred(
        `stale_media_repair:${error.storagePath}`,
        VIDEO_RENDER_DEFER_MS,
        {
          tweet_id: tweetId,
          media_id: error.mediaId,
          storage_path: error.storagePath,
        },
      );
    }
    if (error instanceof JobDeferred) throw error;
    const e = workerBoundaryError(error, "deliver_failed");
    console.error(
      JSON.stringify({
        function: "worker",
        action: "deliver_error",
        tweet_id: tweetId,
        error: e.message,
      }),
    );
    if (error instanceof NonRetryableJobError) {
      throw new NonRetryableJobError(`deliver[${tweetId}]: ${e.message}`);
    }
    throw new Error(`deliver[${tweetId}]: ${e.message}`);
  }
}

// ─── handleEnrichJob: 5-agent editorial pipeline ────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleEnrichJob(
  job: Record<string, unknown>,
  supabase: any,
  runtimeControls: RuntimeControls,
): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  if (!runtimeControls.translation_enabled) {
    throw new JobDeferred("translation_paused", 30_000, {
      tweet_id: tweetId,
      control: "translation_enabled",
      stage: "enrich",
    });
  }
  const forceReview = payload.force_review === true;
  let workflowRunKey: string | null = null;
  if (!tweetId) throw new Error("enrich: missing tweet_id in job payload");

  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) throw new Error("enrich: OPENAI_API_KEY not set");

  console.log(
    JSON.stringify({
      function: "worker",
      action: "enrich_start",
      tweet_id: tweetId,
    }),
  );

  // Load post
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select(
      "tweet_id, text_original, text_translated, importance_score, delivery_decision, author_handle, url, created_at",
    )
    .eq("tweet_id", tweetId)
    .single();
  if (postErr || !post) throw new Error(`enrich: post not found: ${tweetId}`);
  if (!post.text_translated) {
    throw new Error(`enrich: no translation for ${tweetId}`);
  }

  // Load enrichment_config
  const { data: configRow, error: configError } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "enrichment_config")
    .single();
  if (configError) {
    throw new JobDeferred(
      "enrich_config_read_failed",
      30_000,
      { tweet_id: tweetId, check: "enrichment_config" },
    );
  }
  const enrichConfig = normalizeEnrichmentConfig(
    (configRow?.value ?? { enabled: false }) as Partial<EnrichmentConfig>,
  );
  if (!enrichConfig.enabled && !forceReview) {
    // Enrichment disabled -- mark skipped and pass through to deliver (unless manual test)
    const { error: enrichSkipError } = await supabase.from("posts").update({ enrich_status: "skipped" }).eq(
      "tweet_id",
      tweetId,
    );
    if (enrichSkipError) {
      throw new JobDeferred(
        "enrich_skip_status_write_failed",
        30_000,
        { tweet_id: tweetId, check: "skip_status" },
      );
    }
    await enqueueDeliverAfterEnrich(supabase, tweetId);
    console.log(
      JSON.stringify({
        function: "worker",
        action: "enrich_skipped_disabled",
        tweet_id: tweetId,
      }),
    );
    return true;
  }

  // Load @masihh voice guide/profile plus secondary voice samples.
  const { data: voiceRows, error: voiceSettingsError } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["voice_samples", "voice_guide", "personal_voice_profile"]);
  if (voiceSettingsError) {
    throw new JobDeferred(
      "enrich_voice_settings_read_failed",
      30_000,
      { tweet_id: tweetId, check: "voice_settings" },
    );
  }
  if (!Array.isArray(voiceRows)) {
    throw new JobDeferred(
      "enrich_voice_settings_invalid_response",
      30_000,
      { tweet_id: tweetId, check: "voice_settings" },
    );
  }
  const voiceSettings = new Map(
    voiceRows.map((
      row: { key: string; value: unknown },
    ) => [row.key, row.value]),
  );
  const voiceSamples = (voiceSettings.get("voice_samples") ??
    { samples: [], updated_at: null }) as VoiceSamples;
  const voiceGuide = normalizeVoiceGuide(voiceSettings.get("voice_guide"));
  const voiceProfile = normalizePersonalVoiceProfile(
    voiceSettings.get("personal_voice_profile"),
  );

  // Get recent formats for variety (avoid last 3, not just 1)
  const { data: recentFormatPosts } = await supabase
    .from("posts")
    .select("post_format_hint")
    .eq("delivery_decision", "deliver")
    .not("post_format_hint", "is", null)
    .neq("tweet_id", tweetId)
    .order("created_at", { ascending: false })
    .limit(3);
  const recentFormats = (recentFormatPosts || []).map((
    p: { post_format_hint: string },
  ) => p.post_format_hint).filter(Boolean) as string[];
  const previousFormatUsed = recentFormats.length > 0
    ? recentFormats.join(",")
    : null;

  let sameSourceRecentCount = 0;
  if (post.author_handle) {
    const since = new Date(
      Date.now() - enrichConfig.same_source_window_hours * 3600 * 1000,
    ).toISOString();
    const { count } = await supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("author_handle", post.author_handle)
      .gte("created_at", since)
      .neq("tweet_id", tweetId);
    sameSourceRecentCount = count ?? 0;
  }

  // Mark enrichment in progress
  const { error: enrichPendingError } = await supabase.from("posts").update({ enrich_status: "pending" }).eq(
    "tweet_id",
    tweetId,
  );
  if (enrichPendingError) {
    throw new JobDeferred(
      "enrich_pending_status_write_failed",
      30_000,
      { tweet_id: tweetId, check: "pending_status" },
    );
  }
  const startedAt = new Date().toISOString();
  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "enrich",
    "running",
    startedAt,
  );
  const workflowRunId = workerWorkflowRunId(job, tweetId, "enrich");
  workflowRunKey = workerWorkflowRunKey("enrich", workflowRunId);
  await startWorkflowRun(supabase, {
    runKey: workflowRunKey,
    workflowName: "enrichment-pipeline",
    workflowRunId,
    status: "running",
    source: "worker",
    sourceFunction: "handleEnrichJob",
    subjectType: "post",
    subjectId: tweetId,
    jobId: typeof job.id === "string" ? job.id : null,
    tweetId,
    metadata: {
      job_type: "enrich",
      force_review: forceReview,
      pipeline_mode: enrichConfig.pipeline_mode,
      review_mode: enrichConfig.review_mode,
      importance_score: post.importance_score,
      has_source_url: Boolean(post.url),
      has_source_label: Boolean(post.author_handle),
      same_source_recent_count: sameSourceRecentCount,
    },
  });

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
      workflowRunKey,
    });

    // Store results. Shadow/review mode is conservative: no auto-delivery until
    // the critic/gate proves trustworthy and the setting is deliberately relaxed.
    const autoCanComplete = !forceReview && !enrichConfig.require_approval &&
      enrichConfig.review_mode === "auto_high_confidence";
    const enrichStatus = result.publishRecommendation === "reject"
      ? "rejected"
      : autoCanComplete && result.publishRecommendation === "approve"
      ? "completed"
      : "awaiting_approval";
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

    const { error: enrichPostWriteError } = await supabase.from("posts").update({
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
    }).eq("tweet_id", tweetId);
    if (enrichPostWriteError) {
      throw new NonRetryableJobError(
        "enrich_result_persistence_unknown:posts",
      );
    }

    const { error: enrichmentInsertError } = await supabase.from("post_enrichments").insert({
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
    if (enrichmentInsertError) {
      throw new NonRetryableJobError(
        "enrich_result_persistence_unknown:post_enrichments",
      );
    }

    const endedAt = new Date().toISOString();
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "enrich",
      "completed",
      startedAt,
      endedAt,
      null,
      {
        tokens: result.totalTokens,
        duration_ms: result.durationMs,
        format: result.composer.format_used,
        has_callback: result.archivist?.has_callback ?? false,
        status: enrichStatus,
        publish_recommendation: result.publishRecommendation,
        aggregator_risk_score: result.critic.aggregator_risk_score,
        ai_voice_risk_score: result.critic.ai_voice_risk_score,
        risk_flags: result.critic.monetization_risk_flags,
      },
    );
    // If not requiring approval AND not a manual test, enqueue deliver immediately
    if (enrichStatus === "completed") {
      await enqueueDeliverAfterEnrich(supabase, tweetId);
    }
    await finishWorkflowRun(supabase, workflowRunKey, "completed", {
      job_type: "enrich",
      post_count: 1,
      token_count: result.totalTokens,
      duration_ms: result.durationMs,
      status: enrichStatus,
      publish_recommendation: result.publishRecommendation,
      agent_count: 7,
    });

    console.log(JSON.stringify({
      function: "worker",
      action: "enrich_complete",
      tweet_id: tweetId,
      tokens: result.totalTokens,
      duration_ms: result.durationMs,
      format: result.composer.format_used,
      awaiting_approval: forceReview || enrichConfig.require_approval,
    }));
    return true;
  } catch (e) {
    if (e instanceof JobDeferred) throw e;
    const err = workerBoundaryError(e, "enrich_failed");
    if (workflowRunKey) {
      await finishWorkflowRun(supabase, workflowRunKey, "failed", {
        job_type: "enrich",
        post_count: 1,
      }, err);
    }
    const { error: enrichFailureStatusError } = await supabase.from("posts").update({ enrich_status: "failed" }).eq(
      "tweet_id",
      tweetId,
    );
    if (enrichFailureStatusError) {
      console.error(JSON.stringify({
        function: "worker",
        action: "enrich_failure_status_write_failed",
        tweet_id: tweetId,
        error: "enrich_failure_status_write_failed",
      }));
    }
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "enrich",
      "failed",
      startedAt,
      new Date().toISOString(),
      err.message,
    );
    if (enrichFailureStatusError) {
      throw new NonRetryableJobError(
        "enrich_failure_status_persistence_unknown",
      );
    }
    throw err;
  }
}

// deno-lint-ignore no-explicit-any
async function enqueueDeliverAfterEnrich(
  supabase: any,
  tweetId: string,
  source = "enrich",
  resetExisting = true,
) {
  await enqueuePostDeliveryAfterRenderGate(
    supabase,
    tweetId,
    source,
    resetExisting,
  );
}

async function handleDownloadMediaJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  try {
    const started = Date.now();
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "media",
      "running",
      new Date(started).toISOString(),
    );

    const { data, error } = await supabase.functions.invoke(
      "media-processor",
      buildMediaProcessorDownloadInvokeOptions(
        tweetId,
        serviceRoleBearerHeader(),
      ),
    );

    if (error) throw new Error("media_processor_invoke_failed");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("media_processor_invalid_response");
    }
    const mediaProcessorResult = data as Record<string, unknown>;
    const downloaded = typeof mediaProcessorResult.downloaded === "number" &&
        Number.isSafeInteger(mediaProcessorResult.downloaded) &&
        mediaProcessorResult.downloaded >= 0
      ? Math.min(mediaProcessorResult.downloaded, 1000)
      : null;
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "media",
      "completed",
      new Date(started).toISOString(),
      new Date().toISOString(),
      null,
      {
        media_download_ms: Date.now() - started,
        processor_success: mediaProcessorResult.success === true,
        downloaded,
      },
    );
    return true;
  } catch (error) {
    const e = jobError(error);
    const errorCode = e.message === "media_processor_invoke_failed" ||
        e.message === "media_processor_invalid_response"
      ? e.message
      : "media_download_failed";
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "media",
      "failed",
      null,
      null,
      errorCode,
    );
    throw new Error(`download_media[${tweetId}]: ${errorCode}`);
  }
}

async function handleReprocessJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
  runtimeControls: RuntimeControls,
): Promise<boolean> {
  const payload = job.payload as Record<string, unknown>;
  const tweetId = payload.tweet_id as string;
  if (!runtimeControls.dedupe_enabled) {
    throw new JobDeferred("dedupe_paused", 30_000, {
      tweet_id: tweetId,
      control: "dedupe_enabled",
    });
  }
  try {
    const { data: post, error: postError } = await supabase
      .from("posts").select("tweet_id, text_original").eq("tweet_id", tweetId)
      .single();
    if (postError || !post) throw new Error("reprocess_post_read_failed");

    const extractedMediaItems = extractMediaFromText(post.text_original || "");
    const { accepted: mediaItems, rejected: rejectedMediaItems } =
      filterReviewedRemoteMediaItems(extractedMediaItems);
    // Retain the live attachment set until its staged replacement can commit atomically.
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "media",
      "skipped",
      null,
      new Date().toISOString(),
      "reprocess_media_staging_required",
      {
        extracted_media_count: extractedMediaItems.length,
        reviewed_media_count: mediaItems.length,
        rejected_media_count: rejectedMediaItems,
      },
    );

    const { data: insertedRows, error: enqueueError } = await supabase.from("jobs").upsert({
      type: "dedupe",
      payload: { tweet_id: tweetId, force: true, source: "reprocess" },
      status: "pending",
      priority: 30,
      idempotency_key: `dedupe:reprocess:${tweetId}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
    if (enqueueError) {
      throw new Error("reprocess_dedupe_enqueue_failed");
    }
    if (classifyQueueInsertResult(insertedRows, "reprocess_dedupe_enqueue_failed") === "duplicate") return true;
    await markDedupePending(supabase, tweetId, "queued:reprocess");
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "dedupe",
      "queued",
      new Date().toISOString(),
      null,
      null,
      { source: "reprocess" },
    );

    return true;
  } catch (error) {
    if (error instanceof JobDeferred) throw error;
    const e = jobError(error);
    const knownErrors = new Set([
      "reprocess_post_read_failed",
      "reprocess_media_staging_required",
      "reprocess_dedupe_enqueue_failed",
    ]);
    const errorCode = knownErrors.has(e.message) ? e.message : "reprocess_failed";
    console.error(
      JSON.stringify({
        function: "worker",
        action: "reprocess_error",
        tweet_id: tweetId,
        error: errorCode,
      }),
    );
    throw new Error(`reprocess[${tweetId}]: ${errorCode}`);
  }
}

async function dispatchXPosterForTarget( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  source: string,
): Promise<void> {
  const meta = {
    dispatch_source: source,
    target_tweet_id: tweetId,
    gated: true,
  };
  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "x_dispatch",
    "queued",
    new Date().toISOString(),
    null,
    null,
    meta,
  );
  const invokePromise = supabase.functions.invoke("x-poster", {
    body: {
      source: "worker-dispatch",
      target_tweet_id: tweetId,
    },
    headers: serviceRoleBearerHeader(),
  } as Record<string, unknown>).then(
    ({ error }: { error?: { message?: string } | null }) => {
      if (error) {
        return insertPipelineEvent(
          supabase,
          "post",
          tweetId,
          "x_dispatch",
          "failed",
          null,
          new Date().toISOString(),
          "x_poster_invoke_failed",
          meta,
        );
      }
      return undefined;
    },
  ).catch((error: unknown) =>
    insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "x_dispatch",
      "failed",
      null,
      new Date().toISOString(),
      "x_poster_invoke_failed",
      meta,
    )
  );

  if (!scheduleBackground(invokePromise)) {
    await Promise.race([invokePromise, sleep(1500)]);
  }
}

// deno-lint-ignore no-explicit-any
async function getChatIdForJob(
  _job: Record<string, unknown>,
  _supabase: any,
): Promise<string | null> {
  try {
    return Deno.env.get("TELEGRAM_CHAT_ID") || null;
  } catch (_e) {
    return null;
  }
}

async function queueTranslateAfterHydrate( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  fallback: boolean,
  _runtimeControls: RuntimeControls,
): Promise<void> {
  // Hydration always hands off to dedupe. The claim filter, not this helper,
  // pauses dedupe. This prevents a disabled dedupe control from bypassing to
  // translation while keeping the canonical pending job visible.
  try {
    await queueDedupeAfterHydrate(supabase, tweetId, fallback);
  } catch (error) {
    if (error instanceof JobDeferred) throw error;
    throw new Error("hydrate_translate_enqueue_failed");
  }
}

async function queueDedupeAfterHydrate( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  fallback = false,
): Promise<void> {
  const { data: insertedRows, error: enqueueError } = await supabase.from("jobs").upsert({
    type: "dedupe",
    payload: { tweet_id: tweetId, post_hydrate: true },
    status: "pending",
    priority: 30,
    idempotency_key: `dedupe:hydrate:${tweetId}`,
    next_run_at: new Date().toISOString(),
    result_meta: fallback ? { fallback: "truncated" } : null,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
  if (enqueueError) {
    throw new Error("hydrate_dedupe_enqueue_failed");
  }
  // `ignoreDuplicates` returns an empty representation for an existing
  // idempotency key. Do not reset a completed or running post when the
  // canonical job already exists.
  if (classifyQueueInsertResult(insertedRows, "hydrate_dedupe_enqueue_failed") === "duplicate") return;
  await markDedupePending(supabase, tweetId, "queued:hydrate");
  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "dedupe",
    "queued",
    new Date().toISOString(),
    null,
    null,
    { source: fallback ? "hydrate_fallback" : "hydrate" },
  );
}

async function queueTranslateFromDedupe( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  postHydrate = false,
  _runtimeControls?: RuntimeControls,
): Promise<void> {
  const idempotencyKey = postHydrate
    ? `translate:hydrate:${tweetId}`
    : `translate:${tweetId}`;
  const { data: insertedRows, error: enqueueError } = await supabase.from("jobs").upsert({
    type: "translate",
    payload: {
      tweet_id: tweetId,
      ...(postHydrate ? { post_hydrate: true } : {}),
    },
    status: "pending",
    priority: 10,
    idempotency_key: idempotencyKey,
    next_run_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
  if (enqueueError) {
    throw new Error("dedupe_translate_enqueue_failed");
  }
  // An ignored duplicate is already represented by the durable idempotency
  // key. It must not create a second queue event or alter post state.
  if (classifyQueueInsertResult(insertedRows, "dedupe_translate_enqueue_failed") === "duplicate") return;

  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "translate",
    "queued",
    new Date().toISOString(),
    null,
    null,
    { source: postHydrate ? "dedupe_after_hydrate" : "dedupe" },
  );
}

async function markDedupePending( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("posts")
    .update({
      dedupe_status: "pending",
      dedupe_method: null,
      dedupe_confidence: null,
      dedupe_reason: reason,
      dedupe_checked_at: null,
    })
    .eq("tweet_id", tweetId);
  if (error) {
    throw new Error("dedupe_pending_update_failed");
  }
}

// Legacy read-only seam retained for compatibility with existing lifecycle
// source checks. RuntimeControls and the claim filter are authoritative; this
// helper is not used for queue routing or pause decisions.
async function isDuplicateGateEnabled( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from("settings").select("value").eq(
    "key",
    "story_memory",
  ).maybeSingle();
  if (error) {
    throw new JobDeferred("duplicate_gate_config_read_failed", 30_000, {
      tweet_id: tweetId,
      check: "story_memory",
    });
  }
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
    throw new JobDeferred("duplicate_gate_config_invalid_response", 30_000, {
      tweet_id: tweetId,
      check: "story_memory",
    });
  }
  return normalizeDuplicateGateConfig(data?.value ?? DEFAULT_DUPLICATE_GATE).enabled;
}

async function queueDedupeOrTranslateAfterHydrate( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  _runtimeControls: RuntimeControls,
): Promise<void> {
  try {
    await queueDedupeAfterHydrate(supabase, tweetId);
  } catch (error) {
    if (error instanceof JobDeferred) throw error;
    throw new Error("hydrate_dedupe_enqueue_failed");
  }
}

async function handleHydrateTweetJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
  runtimeControls: RuntimeControls,
): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || "");
  if (!tweetId) {
    console.error("hydrate_tweet: missing tweet_id");
    throw new Error("hydrate_tweet: missing tweet_id in job payload");
  }

  // Load post; idempotent if already hydrated
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("tweet_id, text_original, url, hydrated_at, is_truncated")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error("hydrate_tweet: post read failed", tweetId);
    throw new Error("hydrate_post_read_failed");
  }

  if (post.hydrated_at) {
    console.log(
      "hydrate_tweet: already hydrated, ensuring post-hydrate pipeline exists",
      tweetId,
    );
    await queueDedupeOrTranslateAfterHydrate(supabase, tweetId, runtimeControls);
    return true;
  }

  // Kill switch + daily budget gate. If hydration is disabled or the daily
  // X-API budget is exhausted, mark the post as a budget fallback (no read
  // consumed) and let the existing flow continue with the truncated text.
  const hydrationCfg = await loadHydrationSettings(supabase);
  if (!hydrationCfg.available) {
    throw new JobDeferred(
      "hydrate_settings_read_failed",
      30_000,
      { tweet_id: tweetId, check: "hydration_settings" },
    );
  }
  if (!hydrationCfg.enabled) {
    console.warn("hydrate_tweet: disabled by settings, falling back", tweetId);
    await markHydrationFallback(supabase, tweetId, "disabled_fallback");
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    return true;
  }
  const used24h = await countDailyHydrationsUsed(supabase);
  if (used24h === null) {
    throw new JobDeferred(
      "hydrate_usage_read_failed",
      30_000,
      { tweet_id: tweetId, check: "hydration_usage" },
    );
  }
  if (used24h >= hydrationCfg.daily_budget) {
    console.warn(
      `hydrate_tweet: daily budget exhausted (${used24h}/${hydrationCfg.daily_budget}), falling back`,
      tweetId,
    );
    await markHydrationFallback(
      supabase,
      tweetId,
      "budget_exhausted_fallback",
    );
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "hydrate",
      "completed",
      null,
      new Date().toISOString(),
      null,
      {
        fallback: "budget_exhausted",
        used_24h: used24h,
        budget: hydrationCfg.daily_budget,
      },
    );
    return true;
  }

  const numericId = extractNumericTweetId(tweetId, post.url as string | null);
  if (!numericId) {
    console.warn(
      "hydrate_tweet: cannot extract numeric tweet id, falling back to translate",
      tweetId,
    );
    await markHydrationFallback(supabase, tweetId, "no_id_fallback");
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    return true;
  }

  const creds = await getTwitterCreds(supabase);
  if (!creds) {
    console.error(
      "hydrate_tweet: Twitter creds not configured, falling back to truncated translate",
      tweetId,
    );
    await markHydrationFallback(supabase, tweetId, "no_creds_fallback");
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    await recordXApiCall(supabase, "no_creds");
    return true;
  }

  const baseUrl = `https://api.x.com/2/tweets/${numericId}`;
  const queryParams = { "tweet.fields": "note_tweet,text,lang" };
  const fullUrl = `${baseUrl}?${
    Object.entries(queryParams).map(([k, v]) =>
      `${hydratePercentEncode(k)}=${hydratePercentEncode(v)}`
    ).join("&")
  }`;

  let auth: string;
  try {
    auth = await hydrateOauthHeader(
      "GET",
      baseUrl,
      queryParams,
      creds.ck,
      creds.cs,
      creds.at,
      creds.ats,
    );
  } catch (_e) {
    console.error("hydrate_tweet: oauth signing failed", tweetId);
    throw new Error("hydrate_oauth_signing_failed");
  }

  let res: Response;
  try {
    // Read-only X hydration is intentionally outside the external-posting
    // breaker. The breaker protects media uploads and tweet writes.
    res = await fetch(fullUrl, {
      method: "GET",
      headers: { Authorization: auth },
    });
  } catch (_e) {
    console.error("hydrate_tweet: network error", tweetId);
    await recordXApiCall(
      supabase,
      "network_error",
      null,
      numericId,
    );
    throw new Error("hydrate_x_api_network_failed");
  }

  await recordXApiCall(
    supabase,
    res.ok ? null : `http_${res.status}`,
    res,
    numericId,
  );

  if (res.status === 404) {
    console.warn(
      "hydrate_tweet: tweet not found on X (404), falling back to truncated translate",
      tweetId,
    );
    await markHydrationFallback(supabase, tweetId, "x_api_404");
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    return true;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(
      res.headers.get("x-rate-limit-reset") || "0",
      10,
    );
    const waitSec = retryAfter > 0
      ? Math.min(86_400, Math.max(60, retryAfter - Math.floor(Date.now() / 1000)))
      : 900;
    throw new Error(`hydrate_x_api_rate_limited: retry after ${waitSec}`);
  }

  if (res.status === 401 || res.status === 403) {
    console.error("hydrate_tweet: X API authentication failed", res.status);
    throw new Error(workerProviderFailureCode("hydrate_x_api_auth", res.status));
  }

  if (!res.ok) {
    console.error("hydrate_tweet: X API request failed", res.status);
    throw new Error(workerProviderFailureCode("hydrate_x_api", res.status));
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch (_e) {
    console.error("hydrate_tweet: invalid X API response JSON", tweetId);
    throw new Error("hydrate_x_api_invalid_json");
  }

  const hydratedPatch = buildHydratedTweetPatch(json);
  if (!hydratedPatch) {
    console.warn("hydrate_tweet: empty text from X API, falling back", tweetId);
    await markHydrationFallback(supabase, tweetId, "x_api_empty");
    await queueTranslateAfterHydrate(supabase, tweetId, true, runtimeControls);
    return true;
  }

  const { fullText, updatePayload } = hydratedPatch;
  const { error: updErr } = await supabase.from("posts").update(updatePayload)
    .eq("tweet_id", tweetId);
  if (updErr) {
    console.error("hydrate_tweet: post update failed", tweetId);
    throw new Error("hydrate_post_update_failed");
  }

  console.log(
    `hydrate_tweet: success ${tweetId} (orig=${
      (post.text_original || "").length
    } chars → full=${fullText.length} chars)`,
  );
  await queueDedupeOrTranslateAfterHydrate(supabase, tweetId, runtimeControls);
  await maybeEnqueueResolveMedia(supabase, tweetId, fullText);
  return true;
}

async function markHydrationFallback(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  hydrationSource: string,
): Promise<void> {
  const { error } = await supabase.from("posts").update({
    hydrated_at: new Date().toISOString(),
    hydration_source: hydrationSource,
  }).eq("tweet_id", tweetId);
  if (error) {
    throw new JobDeferred(
      "hydrate_fallback_status_write_failed",
      30_000,
      { tweet_id: tweetId, check: "fallback_status", source: hydrationSource },
    );
  }
}

// Inspect existing media rows + (optionally) hydrated text and enqueue a
// resolve_media job if any video signal is present. Safe to call multiple
// times; idempotency_key guards against duplicates.
async function maybeEnqueueResolveMedia( // deno-lint-ignore no-explicit-any
  supabase: any,
  tweetId: string,
  extraText?: string,
): Promise<void> {
  try {
    const { data: mediaRows, error: mediaQueryError } = await supabase
      .from("media")
      .select("kind, src_url")
      .eq("tweet_id", tweetId)
      .order("ordering", { ascending: true })
      .limit(MAX_RESOLVE_MEDIA_SIGNAL_ROWS);
    if (mediaQueryError) {
      throw new Error("resolve_media_signal_read_failed");
    }
    if (!Array.isArray(mediaRows)) {
      throw new Error("resolve_media_signal_invalid_response");
    }

    const haystack: string[] = [];
    if (extraText) haystack.push(extraText);
    let hasVideoKind = false;
    for (
      const m of mediaRows as Array<{ kind?: string; src_url?: string }>
    ) {
      if (m.kind === "video" || m.kind === "gif") hasVideoKind = true;
      if (m.src_url) haystack.push(m.src_url);
    }
    const blob = haystack.join(" ");
    const hasSignal = hasVideoKind ||
      /video\.twimg\.com/i.test(blob) ||
      /(tweet_video_thumb|amplify_video_thumb|ext_tw_video_thumb)/i.test(
        blob,
      ) ||
      /pic\.twitter\.com\//i.test(blob);

    if (!hasSignal) return;

    const { error: jobErr } = await supabase.from("jobs").upsert({
      type: "resolve_media",
      payload: { tweet_id: tweetId },
      status: "pending",
      priority: 12,
      idempotency_key: `resolve_media:${tweetId}`,
      next_run_at: new Date().toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });

    if (jobErr) {
      throw new Error("resolve_media_enqueue_failed");
    }
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "resolve_media",
      "queued",
      null,
      new Date().toISOString(),
      null,
      { source: "hydrate" },
    );
    console.log(
      "maybeEnqueueResolveMedia: enqueued resolve_media for",
      tweetId,
    );
  } catch (_e) {
    console.error("maybeEnqueueResolveMedia failed");
    throw new Error("resolve_media_enqueue_failed");
  }
}

async function handleResolveMediaJob(
  job: Record<string, unknown>, // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<boolean> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const tweetId = String(payload.tweet_id || "");
  if (!tweetId) {
    console.error("resolve_media: missing tweet_id");
    throw new Error("resolve_media: missing tweet_id in job payload");
  }

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("tweet_id, url, author_handle, has_media")
    .eq("tweet_id", tweetId)
    .maybeSingle();

  if (postErr || !post) {
    console.error("resolve_media: post read failed", tweetId);
    throw new Error("resolve_media_post_read_failed");
  }

  const numericId = extractNumericTweetId(tweetId, post.url as string | null);
  const handle = (post.author_handle as string | null) ||
    extractHandleFromUrl(post.url as string | null) || "i";
  if (!numericId) {
    console.warn(
      "resolve_media: cannot extract numeric tweet id, giving up",
      tweetId,
    );
    // Don't block delivery — proceed with whatever media we already have.
    return true;
  }

  let resolved = await rmFetchFromFx(handle, numericId);
  let source: "fxtwitter" | "vxtwitter" | null = resolved ? "fxtwitter" : null;
  if (!resolved) {
    resolved = await rmFetchFromVx(handle, numericId);
    if (resolved) source = "vxtwitter";
  }

  if (!resolved || resolved.length === 0) {
    console.warn("resolve_media: no media found via proxies", tweetId);
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "resolve_media",
      "failed",
      null,
      new Date().toISOString(),
      "no_media_via_proxy",
      { handle, numericId },
    );
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
  if (rows.length === 0) {
    console.warn("resolve_media: proxy media rejected by reviewed-host policy", tweetId);
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "resolve_media",
      "failed",
      null,
      new Date().toISOString(),
      "no_reviewed_media_url",
      { source, resolved_count: resolved.length },
    );
    // Keep existing rows intact rather than pruning based on an unsafe proxy response.
    return true;
  }

  const { error: insErr } = await supabase.from("media").upsert(rows, {
    onConflict: "tweet_id,ordering",
  });
  if (insErr) {
    console.error("resolve_media: insert failed", tweetId);
    await insertPipelineEvent(
      supabase,
      "post",
      tweetId,
      "resolve_media",
      "failed",
      null,
      new Date().toISOString(),
      "media_upsert_failed",
      { handle, numericId, count: rows.length },
    );
    throw new Error("resolve_media_upsert_failed");
  }

  // Prune any leftover higher-ordering rows from a previous (longer) resolution.
  const { error: prnErr } = await supabase.from("media")
    .delete().eq("tweet_id", tweetId).gte("ordering", rows.length);
  if (prnErr) {
    throw new Error("resolve_media_prune_failed");
  }

  // Make sure has_media is true so deliver attaches files.
  const { error: mediaFlagErr } = await supabase.from("posts").update({ has_media: true }).eq(
    "tweet_id",
    tweetId,
  );
  if (mediaFlagErr) {
    throw new Error("resolve_media_flag_update_failed");
  }

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
  const { error: dlErr } = await supabase.from("jobs").insert(
    buildResolveMediaDownloadJob(tweetId),
  );
  if (dlErr) {
    throw new Error("resolve_media_download_enqueue_failed");
  }

  await insertPipelineEvent(
    supabase,
    "post",
    tweetId,
    "resolve_media",
    "completed",
    null,
    new Date().toISOString(),
    null,
    { source, count: rows.length },
  );

  console.log(
    `resolve_media: ${tweetId} resolved ${rows.length} item(s) via ${source}`,
  );
  return true;
}
