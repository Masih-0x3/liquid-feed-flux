import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireInternalAuth } from "../_shared/internalAuth.ts";
import { callOpenAI, type OpenAICallParams } from "../_shared/openai.ts";
import {
  estimateFoglampSpans,
  finishWorkflowRun,
  recordObservedOpenAICall,
  startWorkflowRun,
  type WorkflowRunStatus,
} from "../_shared/observability.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";
import {
  evaluateExternalPosting,
  externalPostingBlockedResponse,
} from "../_shared/externalPostingGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_CORS_ORIGIN") ?? "https://liquid-feed-flux.lovable.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
initSentryEdge();

interface DigestConfig {
  twitter_consumer_key: string;
  twitter_consumer_secret: string;
  twitter_access_token: string;
  twitter_access_token_secret: string;
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
  twitter_consumer_key: "",
  twitter_consumer_secret: "",
  twitter_access_token: "",
  twitter_access_token_secret: "",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDigestConfigOverride(value: unknown): Partial<DigestConfig> {
  if (!isRecord(value)) return {};

  const frequencyMinutes = readNumber(value.frequency_minutes);
  const maxBullets = readNumber(value.max_bullets);
  const minPosts = readNumber(value.min_posts);

  return {
    ...(readString(value.twitter_consumer_key) !== undefined ? { twitter_consumer_key: readString(value.twitter_consumer_key)! } : {}),
    ...(readString(value.twitter_consumer_secret) !== undefined ? { twitter_consumer_secret: readString(value.twitter_consumer_secret)! } : {}),
    ...(readString(value.twitter_access_token) !== undefined ? { twitter_access_token: readString(value.twitter_access_token)! } : {}),
    ...(readString(value.twitter_access_token_secret) !== undefined ? { twitter_access_token_secret: readString(value.twitter_access_token_secret)! } : {}),
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const sb = createClient<any, any>(supabaseUrl, serviceKey);

  const authError = await requireInternalAuth(req, sb, corsHeaders);
  if (authError) return authError;

  let dryRun = false;
  let workflowRunKey = "";
  let workflowFinalized = false;

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

    const envTwitterConsumerKey = Deno.env.get("TWITTER_CONSUMER_KEY");
    const envTwitterConsumerSecret = Deno.env.get("TWITTER_CONSUMER_SECRET");
    const envTwitterAccessToken = Deno.env.get("TWITTER_ACCESS_TOKEN");
    const envTwitterAccessTokenSecret = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET");
    if (envTwitterConsumerKey) digestConfig.twitter_consumer_key = envTwitterConsumerKey;
    if (envTwitterConsumerSecret) digestConfig.twitter_consumer_secret = envTwitterConsumerSecret;
    if (envTwitterAccessToken) digestConfig.twitter_access_token = envTwitterAccessToken;
    if (envTwitterAccessTokenSecret) digestConfig.twitter_access_token_secret = envTwitterAccessTokenSecret;

    const openaiConfig = readOpenAIConfig(settingsMap.openai_config);
    const periodEnd = new Date();
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
      .order("created_at", { ascending: true });
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

    if (!dryRun && postCount < digestConfig.min_posts) {
      await sb.from("digests").insert({
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        post_ids: (posts || []).map((post) => post.tweet_id),
        status: "skipped",
        error: `Only ${postCount} posts (min: ${digestConfig.min_posts})`,
      });
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
      throw openaiError;
    }

    const openaiEndedAt = new Date();
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
      throw new Error(`OpenAI ${openaiResponse.status}: ${openaiResponse.rawText.slice(0, 500)}`);
    }

    const summary = openaiResponse.content.trim();
    if (!summary) throw new Error("OpenAI returned empty digest summary");

    const timeStr = periodEnd.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
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

    // This legacy digest path has no per-source delivery lineage or claim
    // fencing. Keep it preview-only so it cannot bypass the v1 cutover and
    // post historical/ambiguous source material directly to X.
    if (!dryRun) {
      const postingDecision = await evaluateExternalPosting(sb);
      if (!postingDecision.allowed) {
        await finishDigestWorkflow("skipped", {
          ...workflowMetadata,
          post_count: postCount,
          reason: postingDecision.reason,
        });
        return externalPostingBlockedResponse(postingDecision.reason, corsHeaders);
      }
      await finishDigestWorkflow("skipped", {
        ...workflowMetadata,
        post_count: postCount,
        reason: "digest_compiler_preview_only",
      });
      return jsonResponse({
        skipped: true,
        reason: "digest_compiler_preview_only",
        post_count: postCount,
      });
    }

  } catch (err) {
    await finishDigestWorkflow("failed", { dry_run: dryRun }, err);
    console.error(JSON.stringify({
      function: "digest-compiler",
      action: "error",
      message: (err as Error).message,
    }));
    await captureEdgeException(err, {
      functionName: "digest-compiler",
      action: "error",
      request: req,
      extra: { dry_run: dryRun },
    });

    if (!dryRun && serviceKey && supabaseUrl) {
      try {
        await sb.from("digests").insert({
          period_start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          period_end: new Date().toISOString(),
          status: "failed",
          error: (err as Error).message?.substring(0, 500),
        });
      } catch {
        // Ignore failure logging errors.
      }
    }

    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
