import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireInternalAuth } from "../_shared/internalAuth.ts";
import {
  callOpenAI,
  type NormalizedOpenAIResponse,
  type OpenAICallParams,
} from "../_shared/openai.ts";
import {
  estimateFoglampSpans,
  finishWorkflowRun,
  recordObservedOpenAICall,
  startWorkflowRun,
  type WorkflowRunStatus,
} from "../_shared/observability.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_CORS_ORIGIN") ?? "https://liquid-feed-flux.lovable.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
initSentryEdge();

const encoder = new TextEncoder();

interface DigestConfig {
  frequency_minutes: number;
  max_bullets: number;
  min_posts: number;
  header_format: string;
}

interface OpenAIConfig {
  model: string;
  temperature: number;
  max_completion_tokens: number;
}

const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  frequency_minutes: 30,
  max_bullets: 10,
  min_posts: 2,
  header_format: "News Digest - {time}",
};

const DEFAULT_OPENAI_CONFIG: OpenAIConfig = {
  model: "gpt-4o-mini",
  temperature: 0.3,
  max_completion_tokens: 1500,
};

const DIGEST_WORKFLOW_NAME = "digest-compiler";
const DIGEST_TRACE_NAME = "digest-compiler";
const DIGEST_AGENT_NAME = "digest-summarizer";
const DIGEST_OPERATION_NAME = "compile_digest";
const DIGEST_PROMPT_VERSION = "2026-08-08-b3b2";

function digestOpenAiFailureCode(status: unknown): string {
  const numericStatus = typeof status === "number" && Number.isInteger(status)
    ? status
    : null;
  return numericStatus !== null && numericStatus >= 100 && numericStatus <= 599
    ? `digest_openai_http_${numericStatus}`
    : "digest_openai_request_failed";
}

function sanitizeDigestOpenAiResponse(
  response: NormalizedOpenAIResponse,
): NormalizedOpenAIResponse {
  if (response.ok) return response;
  const code = digestOpenAiFailureCode(response.status);
  return {
    ...response,
    rawText: JSON.stringify({ error: { code } }),
    raw: { error: { code } },
    content: "",
    toolCall: null,
    webSearchResults: [],
    outputItems: [],
  };
}

function digestErrorCode(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (message === "digest_openai_request_failed") return message;
  if (/^digest_openai_http_\d{3}$/.test(message)) return message;
  if (message.startsWith("digest_persistence_failed:skipped")) {
    return "digest_persistence_failed:skipped";
  }
  if (message.startsWith("digest_persistence_failed:posted")) {
    return "digest_persistence_failed:posted";
  }
  if (/^digest_checkpoint_failed:(reserve|provider_marker|output|delivery_disabled|fail)$/.test(message)) {
    return message;
  }
  if (["digest_checkpoint_ambiguous", "digest_checkpoint_active", "digest_checkpoint_input_conflict"].includes(message)) {
    return message;
  }
  return "digest_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const CREDENTIAL_LIKE_CONFIG_KEY = /(?:token|secret|password|key|credential|authorization|bearer)/i;
const DIGEST_CONFIG_KEYS = new Set([
  "frequency_minutes",
  "max_bullets",
  "min_posts",
  "header_format",
]);

function assertDigestConfigShape(value: Record<string, unknown>): void {
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    if (!isRecord(entry)) return;
    for (const [key, nested] of Object.entries(entry)) {
      if (CREDENTIAL_LIKE_CONFIG_KEY.test(key)) {
        throw new Error("digest_config must not contain credential-like keys");
      }
      visit(nested);
    }
  };

  visit(value);
  for (const key of Object.keys(value)) {
    if (!DIGEST_CONFIG_KEYS.has(key)) {
      throw new Error("digest_config contains unsupported configuration keys");
    }
  }
}

function readDigestConfigOverride(value: unknown): Partial<DigestConfig> {
  if (!isRecord(value)) return {};
  assertDigestConfigShape(value);

  const frequencyMinutes = readNumber(value.frequency_minutes);
  const maxBullets = readNumber(value.max_bullets);
  const minPosts = readNumber(value.min_posts);

  return {
    ...(frequencyMinutes !== undefined ? { frequency_minutes: Math.max(5, Math.min(1440, Math.round(frequencyMinutes))) } : {}),
    ...(maxBullets !== undefined ? { max_bullets: Math.max(1, Math.min(20, Math.round(maxBullets))) } : {}),
    ...(minPosts !== undefined ? { min_posts: Math.max(1, Math.min(50, Math.round(minPosts))) } : {}),
    ...(readString(value.header_format) !== undefined ? { header_format: readString(value.header_format)! } : {}),
  };
}

function readOpenAIConfig(value: unknown): OpenAIConfig {
  if (!isRecord(value)) return DEFAULT_OPENAI_CONFIG;

  const model = readString(value.model) || DEFAULT_OPENAI_CONFIG.model;
  const temperature = readNumber(value.temperature);
  const maxCompletionTokens = readNumber(value.max_completion_tokens) ?? readNumber(value.max_tokens);

  return {
    model,
    temperature: temperature !== undefined ? Math.max(0, Math.min(2, temperature)) : DEFAULT_OPENAI_CONFIG.temperature,
    max_completion_tokens: maxCompletionTokens !== undefined
      ? Math.max(600, Math.min(4000, Math.round(maxCompletionTokens)))
      : DEFAULT_OPENAI_CONFIG.max_completion_tokens,
  };
}

function usesMaxCompletionTokens(model: string): boolean {
  return /^(gpt-5|gpt-4\.1|o3|o4)/.test(model);
}

function supportsTemperature(model: string): boolean {
  return !usesMaxCompletionTokens(model);
}

export function floorDigestPeriodEnd(now: Date, frequencyMinutes: number): Date {
  const intervalMs = Math.max(1, Math.round(frequencyMinutes)) * 60_000;
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildThreadTweets(summary: string, header: string): string[] {
  const lines = summary.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const tweets: string[] = [];
  let current = `${header}\n\n`;

  for (const line of lines) {
    if ((current + line + "\n").length > 270) {
      tweets.push(current.trim());
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) tweets.push(current.trim());
  return tweets;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authError = await requireInternalAuth(req, corsHeaders);
  if (authError) return authError;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const sb = createClient<any, any>(supabaseUrl, serviceKey);

  let dryRun = false;
  let workflowRunKey = "";
  let workflowFinalized = false;
  let checkpointRunStarted = false;

  const finishDigestWorkflow = async (
    status: Extract<WorkflowRunStatus, "completed" | "failed" | "skipped">,
    metadata?: Record<string, unknown>,
    error?: unknown,
  ) => {
    if (!workflowRunKey || workflowFinalized) return;
    await finishWorkflowRun(sb, workflowRunKey, status, metadata, error);
    workflowFinalized = true;
  };

  try {
    if (!supabaseUrl || !serviceKey || !openaiKey) {
      throw new Error("Missing required Supabase/OpenAI environment configuration");
    }

    let requestBody: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (isRecord(parsed)) requestBody = parsed;
    } catch {
      requestBody = {};
    }

    dryRun = requestBody.dry_run === true;

    const { data: settingsRows, error: settingsError } = await sb
      .from("settings")
      .select("key, value")
      .in("key", ["digest_config", "openai_config"]);
    if (settingsError) throw settingsError;

    const settingsMap = Object.fromEntries((settingsRows || []).map((row) => [row.key, row.value])) as Record<string, unknown>;
    const hasSavedDigestConfig = isRecord(settingsMap.digest_config);

    const digestConfig = {
      ...DEFAULT_DIGEST_CONFIG,
      ...readDigestConfigOverride(settingsMap.digest_config),
      ...(dryRun ? readDigestConfigOverride(requestBody.config) : {}),
    } satisfies DigestConfig;

    const openaiConfig = readOpenAIConfig(settingsMap.openai_config);
    const periodEnd = floorDigestPeriodEnd(new Date(), digestConfig.frequency_minutes);
    const periodStart = new Date(periodEnd.getTime() - digestConfig.frequency_minutes * 60 * 1000);

    const workflowRunId = `digest:${periodEnd.toISOString()}`;
    workflowRunKey = `digest-compiler:${periodEnd.toISOString()}`;
    const workflowMetadata = {
      dry_run: dryRun,
      frequency_minutes: digestConfig.frequency_minutes,
      max_bullets: digestConfig.max_bullets,
      min_posts: digestConfig.min_posts,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    };

    if (!dryRun && !hasSavedDigestConfig) {
      await startWorkflowRun(sb, {
        runKey: workflowRunKey,
        workflowName: DIGEST_WORKFLOW_NAME,
        workflowRunId,
        status: "running",
        source: "edge_function",
        sourceFunction: "digest-compiler",
        subjectType: "digest",
        subjectId: periodEnd.toISOString(),
        metadata: { ...workflowMetadata, reason: "no_config" },
      });
      await finishDigestWorkflow("skipped", { ...workflowMetadata, reason: "no_config" });
      return jsonResponse({ skipped: true, reason: "no_config" });
    }

    const { data: posts, error: postsErr } = await sb
      .from("posts")
      .select("tweet_id, text_translated, text_original, author_handle, created_at")
      .gte("created_at", periodStart.toISOString())
      .lte("created_at", periodEnd.toISOString())
      .not("text_translated", "is", null)
      .eq("delivery_decision", "deliver")
      .order("created_at", { ascending: true })
      .order("tweet_id", { ascending: true });
    if (postsErr) throw postsErr;

    const postCount = posts?.length ?? 0;
    await startWorkflowRun(sb, {
      runKey: workflowRunKey,
      workflowName: DIGEST_WORKFLOW_NAME,
      workflowRunId,
      status: "running",
      source: "edge_function",
      sourceFunction: "digest-compiler",
      subjectType: "digest",
      subjectId: periodEnd.toISOString(),
      metadata: { ...workflowMetadata, post_count: postCount },
    });

    const runKey = `digest:${periodEnd.toISOString()}`;
    const inputFingerprint = await sha256Hex(
      JSON.stringify({
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        digest_config: digestConfig,
        openai_config: openaiConfig,
        prompt_version: DIGEST_PROMPT_VERSION,
        posts: (posts || []).map((post) => ({
          tweet_id: post.tweet_id,
          text: post.text_translated || post.text_original || "",
          author_handle: post.author_handle || "",
          created_at: post.created_at,
        })),
      }),
    );
    let claimToken = "";
    let claimGeneration = 0;

    const reserveDigestRun = async (): Promise<Record<string, unknown>> => {
      const { data: reserveData, error: reserveError } = await sb.rpc("reserve_digest_run", {
        p_run_key: runKey,
        p_input_fingerprint: inputFingerprint,
        p_period_start: periodStart.toISOString(),
        p_period_end: periodEnd.toISOString(),
        p_post_ids: (posts || []).map((post) => post.tweet_id),
        p_delivery_key: `digest-delivery:${runKey}`,
        p_lease_seconds: 300,
      });
      if (reserveError || !isRecord(reserveData)) {
        throw new Error("digest_checkpoint_failed:reserve");
      }
      return reserveData;
    };

    if (!dryRun && postCount < digestConfig.min_posts) {
      const reserveData = await reserveDigestRun();
      const reserveReason = readString(reserveData.reason) ?? "invalid";
      if (reserveReason === "already_completed") {
        await finishDigestWorkflow("skipped", {
          ...workflowMetadata,
          post_count: postCount,
          reason: "below_min_posts",
          replay: true,
        });
        return jsonResponse({ skipped: true, replay: true, post_count: postCount });
      }
      if (reserveReason === "ambiguous") throw new Error("digest_checkpoint_ambiguous");
      if (reserveReason === "active") throw new Error("digest_checkpoint_active");
      if (reserveReason === "input_conflict") throw new Error("digest_checkpoint_input_conflict");
      if (reserveData.reserved !== true) throw new Error("digest_checkpoint_failed:reserve");

      claimToken = readString(reserveData.claim_token) ?? "";
      claimGeneration = readNumber(reserveData.claim_generation) ?? 0;
      if (!claimToken || !Number.isInteger(claimGeneration) || claimGeneration < 1) {
        throw new Error("digest_checkpoint_failed:reserve");
      }
      checkpointRunStarted = true;
      const skipReason = `Only ${postCount} posts (min: ${digestConfig.min_posts})`;
      const skippedOutputKey = await sha256Hex(JSON.stringify({
        run_key: runKey,
        status: "skipped",
        reason: skipReason,
      }));
      const { data: skippedPersisted, error: skippedError } = await sb.rpc("persist_skipped_digest", {
        p_run_key: runKey,
        p_claim_token: claimToken,
        p_claim_generation: claimGeneration,
        p_output_key: skippedOutputKey,
        p_reason: skipReason,
      });
      if (skippedError || skippedPersisted !== true) {
        throw new Error("digest_persistence_failed:skipped");
      }
      await finishDigestWorkflow("skipped", {
        ...workflowMetadata,
        post_count: postCount,
        reason: "below_min_posts",
      });
      return jsonResponse({ skipped: true, post_count: postCount });
    }

    if (postCount === 0) {
      await finishDigestWorkflow("skipped", {
        ...workflowMetadata,
        post_count: 0,
        reason: "no_posts",
      });
      return jsonResponse({
        dry_run: dryRun,
        skipped: true,
        reason: "no_posts",
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_count: 0,
      });
    }

    const bulletPrompt = (posts || [])
      .map((post, index) => `${index + 1}. @${post.author_handle || "unknown"}: ${post.text_translated || post.text_original || ""}`)
      .join("\n");

    const systemPrompt = `You are a senior news editor compiling a concise news digest.

Guidelines:
- Write at most ${digestConfig.max_bullets} bullet points.
- Merge duplicate or related stories.
- Prioritize geopolitical, military, sanctions, and breaking news.
- Keep a neutral journalistic tone.
- Use the same language as the source posts.
- Do not include usernames, handles, links, or source attribution.`;

    const openaiRequest: OpenAICallParams = {
      apiKey: openaiKey,
      model: openaiConfig.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: bulletPrompt },
      ],
      maxOutputTokens: openaiConfig.max_completion_tokens,
      temperature: supportsTemperature(openaiConfig.model) ? openaiConfig.temperature : null,
    };

    if (!dryRun) {
      const reserveData = await reserveDigestRun();
      const reserveReason = readString(reserveData.reason) ?? "invalid";
      if (reserveReason === "already_completed") {
        await finishDigestWorkflow("completed", {
          ...workflowMetadata,
          post_count: postCount,
          replay: true,
          delivery_state: "disabled",
        });
        return jsonResponse({
          success: true,
          replay: true,
          delivery_state: "disabled",
          digest_id: readString(reserveData.digest_id) ?? null,
          post_count: postCount,
        });
      }
      if (reserveReason === "output_ready") {
        const { data: checkpointed, error: checkpointError } = await sb.rpc("checkpoint_digest_delivery_disabled", {
          p_run_key: runKey,
          p_input_fingerprint: inputFingerprint,
        });
        if (checkpointError || checkpointed !== true) {
          throw new Error("digest_checkpoint_failed:delivery_disabled");
        }
        await finishDigestWorkflow("completed", {
          ...workflowMetadata,
          post_count: postCount,
          resumed: true,
          delivery_state: "disabled",
        });
        return jsonResponse({
          success: true,
          resumed: true,
          delivery_state: "disabled",
          digest_id: readString(reserveData.digest_id) ?? null,
          post_count: postCount,
        });
      }
      if (reserveReason === "ambiguous") throw new Error("digest_checkpoint_ambiguous");
      if (reserveReason === "active") throw new Error("digest_checkpoint_active");
      if (reserveReason === "input_conflict") throw new Error("digest_checkpoint_input_conflict");
      if (reserveData.reserved !== true) throw new Error("digest_checkpoint_failed:reserve");

      claimToken = readString(reserveData.claim_token) ?? "";
      claimGeneration = readNumber(reserveData.claim_generation) ?? 0;
      if (!claimToken || !Number.isInteger(claimGeneration) || claimGeneration < 1) {
        throw new Error("digest_checkpoint_failed:reserve");
      }
      checkpointRunStarted = true;

      const { data: providerMarked, error: providerMarkerError } = await sb.rpc("mark_digest_provider_started", {
        p_run_key: runKey,
        p_claim_token: claimToken,
        p_claim_generation: claimGeneration,
      });
      if (providerMarkerError || providerMarked !== true) {
        throw new Error("digest_checkpoint_failed:provider_marker");
      }
    }

    const aiMetadata = {
      ...workflowMetadata,
      post_count: postCount,
      dry_run: dryRun,
    };
    const openaiStartedAt = new Date();
    let openaiResponse;
    try {
      openaiResponse = await callOpenAI(openaiRequest);
    } catch (openaiError) {
      const openaiEndedAt = new Date();
      await recordObservedOpenAICall(sb, {
        workflowRunKey,
        traceName: DIGEST_TRACE_NAME,
        operationName: DIGEST_OPERATION_NAME,
        agentName: DIGEST_AGENT_NAME,
        model: openaiConfig.model,
        request: openaiRequest,
        status: "failed",
        startedAt: openaiStartedAt,
        endedAt: openaiEndedAt,
        spanEstimate: estimateFoglampSpans(openaiRequest),
        foglampExported: false,
        foglampSkipReason: "digest_local_only",
        metadata: { ...aiMetadata, failure_stage: "request_threw" },
      });
      if (!dryRun && checkpointRunStarted) {
        const { data: failedRun, error: failError } = await sb.rpc("fail_digest_run", {
          p_run_key: runKey,
          p_claim_token: claimToken,
          p_claim_generation: claimGeneration,
          p_reason: "digest_provider_outcome_unknown",
        });
        if (failError || failedRun !== true) {
          throw new Error("digest_checkpoint_failed:fail");
        }
      }
      throw new Error("digest_openai_request_failed");
    }

    const openaiEndedAt = new Date();
    openaiResponse = sanitizeDigestOpenAiResponse(openaiResponse);
    await recordObservedOpenAICall(sb, {
      workflowRunKey,
      traceName: DIGEST_TRACE_NAME,
      operationName: DIGEST_OPERATION_NAME,
      agentName: DIGEST_AGENT_NAME,
      model: openaiConfig.model,
      endpoint: openaiResponse.endpoint,
      request: openaiRequest,
      response: openaiResponse,
      status: openaiResponse.ok ? "completed" : "failed",
      startedAt: openaiStartedAt,
      endedAt: openaiEndedAt,
      spanEstimate: estimateFoglampSpans(openaiRequest),
      foglampExported: false,
      foglampSkipReason: "digest_local_only",
      metadata: aiMetadata,
    });

    if (!openaiResponse.ok) {
      if (!dryRun && checkpointRunStarted) {
        const { data: failedRun, error: failError } = await sb.rpc("fail_digest_run", {
          p_run_key: runKey,
          p_claim_token: claimToken,
          p_claim_generation: claimGeneration,
          p_reason: digestOpenAiFailureCode(openaiResponse.status),
        });
        if (failError || failedRun !== true) {
          throw new Error("digest_checkpoint_failed:fail");
        }
      }
      throw new Error(digestOpenAiFailureCode(openaiResponse.status));
    }

    const summary = openaiResponse.content.trim();
    if (!summary) {
      if (!dryRun && checkpointRunStarted) {
        const { data: failedRun, error: failError } = await sb.rpc("fail_digest_run", {
          p_run_key: runKey,
          p_claim_token: claimToken,
          p_claim_generation: claimGeneration,
          p_reason: "digest_empty_output",
        });
        if (failError || failedRun !== true) {
          throw new Error("digest_checkpoint_failed:fail");
        }
      }
      throw new Error("OpenAI returned empty digest summary");
    }

    const timeStr = periodEnd.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const header = digestConfig.header_format.replace("{time}", timeStr);
    const tweets = buildThreadTweets(summary, header);

    if (dryRun) {
      await finishDigestWorkflow("completed", {
        ...workflowMetadata,
        post_count: postCount,
        tweet_count: tweets.length,
        dry_run: true,
      });
      return jsonResponse({
        dry_run: true,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_count: postCount,
        tweet_count: tweets.length,
        formatted_tweets: tweets,
        usage: openaiResponse.usage ?? null,
      });
    }

    const outputKey = await sha256Hex(JSON.stringify({ run_key: runKey, summary, tweets }));
    const { data: outputPersisted, error: outputError } = await sb.rpc("persist_digest_output", {
      p_run_key: runKey,
      p_claim_token: claimToken,
      p_claim_generation: claimGeneration,
      p_output_key: outputKey,
      p_summary_text: summary,
      p_formatted_tweets: tweets,
      p_status: "compiled",
    });
    if (outputError || outputPersisted !== true) {
      throw new Error("digest_checkpoint_failed:output");
    }

    const { data: deliveryCheckpointed, error: deliveryCheckpointError } = await sb.rpc("checkpoint_digest_delivery_disabled", {
      p_run_key: runKey,
      p_input_fingerprint: inputFingerprint,
    });
    if (deliveryCheckpointError || deliveryCheckpointed !== true) {
      throw new Error("digest_checkpoint_failed:delivery_disabled");
    }

    await finishDigestWorkflow("completed", {
      ...workflowMetadata,
      post_count: postCount,
      tweet_count: tweets.length,
      delivery_state: "disabled",
    });
    return jsonResponse({
      success: true,
      compiled: true,
      tweet_count: tweets.length,
      post_count: postCount,
      delivery_state: "disabled",
    });
  } catch (err) {
    const safeError = new Error(digestErrorCode(err));
    await finishDigestWorkflow("failed", { dry_run: dryRun }, safeError);
    console.error(JSON.stringify({
      function: "digest-compiler",
      action: "error",
      message: safeError.message,
    }));
    await captureEdgeException(safeError, {
      functionName: "digest-compiler",
      action: "error",
      request: req,
      extra: { dry_run: dryRun },
    });

    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
