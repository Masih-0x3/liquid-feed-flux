import {
  type EnrichmentConfig,
  generatePersonalVoiceProfile,
  normalizeEnrichmentConfig,
  normalizeVoiceGuide,
  type VoiceSamples,
} from "../_shared/enrich.ts";
import {
  finishWorkflowRun,
  recordObservedProviderCall,
  startWorkflowRun,
} from "../_shared/observability.ts";
import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type InsertAdminPipelineEventFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
) => Promise<void>;

export type RunTranslationOnlyFn = (
  supabase: SupabaseAdminClient,
  tweetId: string,
) => Promise<
  { ok: boolean; translated?: string; model?: string; error?: string }
>;

export type DispatchWorkerForManualEnrichFn = () => Promise<{
  ok: boolean;
  status?: number;
  processed?: number;
  message?: string;
  error?: string;
}>;

export type EnrichmentActionDeps = {
  insertAdminPipelineEvent: InsertAdminPipelineEventFn;
  runTranslationOnly?: RunTranslationOnlyFn;
  dispatchWorkerForManualEnrich?: DispatchWorkerForManualEnrichFn;
  generatePersonalVoiceProfile?: typeof generatePersonalVoiceProfile;
  readEnv?: (key: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const ENRICHMENT_FEEDBACK_LABELS = new Set([
  "too_ai",
  "too_cheesy",
  "too_aggregator",
  "strong_angle",
  "needs_more_context",
  "unsafe_for_monetization",
  "sounds_like_me",
  "too_soft",
  "too_newsy",
  "not_blunt_enough",
  "too_long",
  "good_clapback",
  "too_risky",
]);

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function nowIso(deps?: { now?: () => Date }): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function readEnv(
  key: string,
  deps?: Pick<EnrichmentActionDeps, "readEnv">,
): string {
  return deps?.readEnv?.(key) ?? Deno.env.get(key) ?? "";
}

function voiceProfileEndpointForModel(model: string): string {
  return /^gpt-5\.(4|5)/i.test(model) ? "responses" : "chat.completions";
}

function voiceProfileUsageRecord(
  usage: unknown,
): Record<string, unknown> | null {
  if (typeof usage === "number") return { total_tokens: usage };
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    return usage as Record<string, unknown>;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

export async function updateLatestPostEnrichment(
  supabase: SupabaseAdminClient,
  tweetId: string,
  patch: Record<string, unknown>,
) {
  const { data } = await table(supabase, "post_enrichments")
    .select("id")
    .eq("post_id", tweetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = asRecord(data);
  if (!row.id) return;

  await table(supabase, "post_enrichments")
    .update(patch)
    .eq("id", row.id)
    .then(() => null, () => null);
}

export async function dispatchWorkerForManualEnrich(
  deps: Pick<EnrichmentActionDeps, "readEnv" | "fetchImpl"> = {},
): ReturnType<DispatchWorkerForManualEnrichFn> {
  const supabaseUrl = readEnv("SUPABASE_URL", deps);
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", deps);
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: "missing Supabase URL or service role key" };
  }

  try {
    const resp = await (deps.fetchImpl ?? fetch)(
      `${supabaseUrl}/functions/v1/worker`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trigger: "manual_enrich",
          job_types: ["enrich"],
          batch_size: 3,
        }),
      },
    );
    const text = await resp.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: typeof parsed.error === "string"
          ? parsed.error
          : text.slice(0, 300),
      };
    }
    return {
      ok: true,
      status: resp.status,
      processed: typeof parsed.processed === "number"
        ? parsed.processed
        : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function approveEnrichmentAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<EnrichmentActionDeps, "insertAdminPipelineEvent" | "now">,
): Promise<AdminActionResponse> {
  const tweetId = body.tweet_id as string | undefined;
  if (!tweetId) return { body: { error: "tweet_id is required" }, status: 400 };

  await table(supabase, "posts").update({ enrich_status: "approved" }).eq(
    "tweet_id",
    tweetId,
  );
  await updateLatestPostEnrichment(supabase, tweetId, {
    status: "approved",
    approved_at: nowIso(deps),
  });
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "enrich",
    "completed",
    {
      source: "approve_enrichment",
      approved_for_x: true,
    },
  );

  return {
    body: { ok: true, message: `Enrichment approved for X text on ${tweetId}` },
  };
}

export async function rejectEnrichmentAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<EnrichmentActionDeps, "now"> = {},
): Promise<AdminActionResponse> {
  const tweetId = body.tweet_id as string | undefined;
  if (!tweetId) return { body: { error: "tweet_id is required" }, status: 400 };

  await table(supabase, "posts").update({ enrich_status: "rejected" }).eq(
    "tweet_id",
    tweetId,
  );
  await updateLatestPostEnrichment(supabase, tweetId, {
    status: "rejected",
    rejected_at: nowIso(deps),
  });

  return { body: { ok: true, message: `Enrichment rejected for ${tweetId}` } };
}

export async function recordEnrichmentFeedbackAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<EnrichmentActionDeps, "insertAdminPipelineEvent" | "now">,
): Promise<AdminActionResponse> {
  const tweetId = body.tweet_id as string | undefined;
  const feedback = body.feedback;
  if (!tweetId) return { body: { error: "tweet_id is required" }, status: 400 };
  if (!feedback || typeof feedback !== "string") {
    return { body: { error: "feedback is required" }, status: 400 };
  }
  if (!ENRICHMENT_FEEDBACK_LABELS.has(feedback)) {
    return {
      body: { error: `unsupported feedback: ${feedback}` },
      status: 400,
    };
  }
  await updateLatestPostEnrichment(supabase, tweetId, {
    feedback_label: feedback,
    feedback_note: typeof body.note === "string"
      ? body.note.slice(0, 500)
      : null,
    feedback_at: nowIso(deps),
  });
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "enrich_feedback",
    "completed",
    { feedback },
  );
  return { body: { ok: true } };
}

export async function generateVoiceProfileAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: EnrichmentActionDeps,
): Promise<AdminActionResponse> {
  const openaiApiKey = readEnv("OPENAI_API_KEY", deps);
  if (!openaiApiKey) {
    return {
      body: { ok: false, error: "OPENAI_API_KEY is not configured" },
      status: 500,
    };
  }

  const stamp = nowIso(deps);
  const guide = normalizeVoiceGuide({
    guide: typeof body.guide === "string" ? body.guide : undefined,
    updated_at: stamp,
  });
  const { data: rows } = await table(supabase, "settings")
    .select("key, value")
    .in("key", ["enrichment_config", "voice_samples"]);
  const settings = new Map(
    ((Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>).map((
      row,
    ) => [row.key, row.value]),
  );
  const config = normalizeEnrichmentConfig(
    (settings.get("enrichment_config") ?? { enabled: false }) as Partial<
      EnrichmentConfig
    >,
  );
  const voiceSamples = (settings.get("voice_samples") ??
    { samples: [], updated_at: null }) as VoiceSamples;
  const generator = deps.generatePersonalVoiceProfile ??
    generatePersonalVoiceProfile;
  const model = config.model || "gpt-5.4-mini";
  const workflowRunId = `settings-voice-profile:${crypto.randomUUID()}`;
  const workflowRunKey = `admin-actions:${workflowRunId}`;
  const metadata = {
    guide_source: typeof body.guide === "string" ? "custom" : "default",
    sample_count: Array.isArray(voiceSamples.samples)
      ? voiceSamples.samples.length
      : 0,
  };
  await startWorkflowRun(supabase, {
    runKey: workflowRunKey,
    workflowName: "settings-voice-profile",
    workflowRunId,
    status: "running",
    source: "admin-actions",
    sourceFunction: "generateVoiceProfileAdminAction",
    subjectType: "settings",
    subjectId: "personal_voice_profile",
    metadata,
  });

  let result: Awaited<ReturnType<typeof generatePersonalVoiceProfile>>;
  let aiCallRecorded = false;
  const aiStartedAt = new Date();
  try {
    result = await generator({
      apiKey: openaiApiKey,
      model,
      voiceGuide: guide,
      voiceSamples,
    });
    await recordObservedProviderCall(supabase, {
      workflowRunKey,
      traceName: "settings-voice-profile",
      operationName: "generate_voice_profile",
      agentName: "voice-profile-generator",
      model,
      endpoint: voiceProfileEndpointForModel(model),
      status: "completed",
      usage: voiceProfileUsageRecord(result.usage),
      startedAt: aiStartedAt,
      endedAt: new Date(),
      spanEstimate: 2,
      foglampExported: false,
      foglampSkipReason: "settings_local_only",
      metadata,
    });
    aiCallRecorded = true;

    await table(supabase, "settings").upsert([
      { key: "voice_guide", value: guide, updated_at: stamp },
      {
        key: "personal_voice_profile",
        value: result.profile,
        updated_at: stamp,
      },
    ], { onConflict: "key" });

    await finishWorkflowRun(supabase, workflowRunKey, "completed", {
      ...metadata,
      usage_total_tokens: voiceProfileUsageRecord(result.usage)?.total_tokens ??
        null,
    });
  } catch (error) {
    if (!aiCallRecorded) {
      await recordObservedProviderCall(supabase, {
        workflowRunKey,
        traceName: "settings-voice-profile",
        operationName: "generate_voice_profile",
        agentName: "voice-profile-generator",
        model,
        endpoint: voiceProfileEndpointForModel(model),
        status: "failed",
        usage: null,
        startedAt: aiStartedAt,
        endedAt: new Date(),
        error,
        spanEstimate: 2,
        foglampExported: false,
        foglampSkipReason: "settings_local_only",
        metadata,
      });
    }
    await finishWorkflowRun(supabase, workflowRunKey, "failed", metadata, error);
    throw error;
  }

  return { body: { ok: true, profile: result.profile, usage: result.usage } };
}

export async function selectEnrichmentVariantAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<EnrichmentActionDeps, "insertAdminPipelineEvent">,
): Promise<AdminActionResponse> {
  const tweetId = body.tweet_id as string | undefined;
  const variant = body.variant;
  if (!tweetId) return { body: { error: "tweet_id is required" }, status: 400 };
  if (!variant || typeof variant !== "string") {
    return { body: { error: "variant is required" }, status: 400 };
  }

  const { data: post, error: postErr } = await table(supabase, "posts")
    .select("source_context")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (postErr) throw postErr;
  const sourceContext = asRecord(asRecord(post).source_context);
  const voice = asRecord(sourceContext.voice);
  const variants = Array.isArray(voice.variants)
    ? voice.variants as Array<Record<string, unknown>>
    : [];
  const selected = variants.find((item) => item.kind === variant);
  if (!selected) {
    return {
      body: { ok: false, error: `Variant not found: ${variant}` },
      status: 404,
    };
  }

  const updatedVoice = { ...voice, selected_variant: variant };
  const updatedSourceContext = { ...sourceContext, voice: updatedVoice };
  const finalXText = typeof selected.final_x_text === "string"
    ? selected.final_x_text
    : null;
  if (!finalXText) {
    return {
      body: { ok: false, error: `Variant ${variant} has no final_x_text` },
      status: 400,
    };
  }

  const patch = {
    final_x_text: finalXText,
    composed_post_text: finalXText,
    creator_angle: typeof selected.creator_angle === "string"
      ? selected.creator_angle
      : null,
    why_it_matters: typeof selected.why_it_matters === "string"
      ? selected.why_it_matters
      : null,
    source_context: updatedSourceContext,
  };
  const { error: updateErr } = await table(supabase, "posts").update(patch).eq(
    "tweet_id",
    tweetId,
  );
  if (updateErr) throw updateErr;
  await updateLatestPostEnrichment(supabase, tweetId, {
    final_x_text: finalXText,
    creator_angle: patch.creator_angle,
    why_it_matters: patch.why_it_matters,
    source_context: updatedSourceContext,
  });
  await deps.insertAdminPipelineEvent(
    supabase,
    tweetId,
    "enrich_variant",
    "completed",
    { selected_variant: variant },
  );
  return {
    body: { ok: true, selected_variant: variant, final_x_text: finalXText },
  };
}

export async function enrichPostAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: EnrichmentActionDeps,
): Promise<AdminActionResponse> {
  const tweetId = body.tweet_id as string | undefined;
  if (!tweetId) return { body: { error: "tweet_id is required" }, status: 400 };
  if (!deps.runTranslationOnly) {
    throw new Error("runTranslationOnly dependency is required");
  }

  const { data: existingPost, error: existingErr } = await table(
    supabase,
    "posts",
  )
    .select("tweet_id, text_translated, translated_at")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  const post = asRecord(existingPost);
  if (!existingPost) {
    return {
      body: { ok: false, error: `Post not found: ${tweetId}` },
      status: 404,
    };
  }

  let translation:
    | { ok: boolean; translated?: string; model?: string; error?: string }
    | null = null;
  if (!post.text_translated && !post.translated_at) {
    translation = await deps.runTranslationOnly(supabase, tweetId);
    if (!translation.ok) {
      return {
        body: {
          ok: false,
          error: `translation preflight failed: ${translation.error}`,
          translation,
        },
        status: 200,
      };
    }
  }

  await table(supabase, "posts").update({
    enrich_status: "pending",
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
  }).eq("tweet_id", tweetId);

  const stamp = nowIso(deps);
  const { error: jobErr } = await table(supabase, "jobs").upsert({
    type: "enrich",
    payload: { tweet_id: tweetId, force_review: true },
    idempotency_key: `enrich:${tweetId}`,
    status: "pending",
    attempts: 0,
    created_at: stamp,
    locked_at: null,
    lease_expires_at: null,
    next_run_at: stamp,
    last_error: null,
  }, { onConflict: "idempotency_key", ignoreDuplicates: false });
  if (jobErr) throw jobErr;
  await deps.insertAdminPipelineEvent(supabase, tweetId, "enrich", "queued", {
    source: "manual_enrich_post",
    translation_preflight: translation?.ok === true,
  });
  const workerDispatch = deps.dispatchWorkerForManualEnrich
    ? await deps.dispatchWorkerForManualEnrich()
    : await dispatchWorkerForManualEnrich(deps);
  if (!workerDispatch.ok) {
    await deps.insertAdminPipelineEvent(
      supabase,
      tweetId,
      "enrich_dispatch",
      "failed",
      {
        source: "manual_enrich_post",
        queued: true,
        error: workerDispatch.error,
        status: workerDispatch.status,
      },
      workerDispatch.error ?? null,
    );
  } else {
    await deps.insertAdminPipelineEvent(
      supabase,
      tweetId,
      "enrich_dispatch",
      "completed",
      {
        source: "manual_enrich_post",
        processed: workerDispatch.processed,
        message: workerDispatch.message,
      },
    );
  }
  return {
    body: {
      ok: true,
      message: `Enrichment draft queued for ${tweetId}`,
      translation_preflight: translation,
      worker_dispatch: workerDispatch,
    },
  };
}
