const METADATA_STRING_LIMIT = 512;
const METADATA_KEY_LIMIT = 80;
const METADATA_KEYS_LIMIT = 32;

function monthPeriodKey(date) {
  return date.toISOString().slice(0, 7);
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message ?? "");
  return String(error);
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function usageNumber(value) {
  return Math.max(0, Math.round(safeNumber(value)));
}

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function metadataValue(value) {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, METADATA_STRING_LIMIT);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value).slice(0, METADATA_STRING_LIMIT);
}

function metadataKey(key) {
  return key.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, METADATA_KEY_LIMIT);
}

function shouldDropMetadataKey(key) {
  return /(api[_-]?key|secret|token|authorization|prompt|content|raw|input|output|text|message)/i
    .test(key);
}

export function sanitizeObservabilityMetadata(metadata = {}) {
  const out = {};
  for (const [key, value] of Object.entries(metadata).slice(0, METADATA_KEYS_LIMIT)) {
    if (shouldDropMetadataKey(key)) continue;
    out[metadataKey(key)] = metadataValue(value);
  }
  return out;
}

function usageFromPayload(payload) {
  const usage = recordValue(payload?.usage);
  const inputTokens = usageNumber(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = usageNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = usageNumber(usage.total_tokens || inputTokens + outputTokens);
  const outputDetails = recordValue(usage.completion_tokens_details ?? usage.output_tokens_details);
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens,
    reasoningTokens: usageNumber(outputDetails.reasoning_tokens),
  };
}

async function safeWrite(label, operation) {
  try {
    const result = await operation();
    if (result?.error) {
      console.warn("[renderer-observability] write failed", {
        label,
        error: errorMessage(result.error),
      });
    }
  } catch (error) {
    console.warn("[renderer-observability] write threw", {
      label,
      error: errorMessage(error),
    });
  }
}

export async function startWorkflowRun(supabase, run) {
  if (!supabase) return;
  const startedAt = run.startedAt ?? new Date();
  await safeWrite("workflow_runs.upsert", () =>
    supabase.from("workflow_runs").upsert({
      run_key: run.runKey,
      workflow_name: run.workflowName,
      workflow_run_id: run.workflowRunId ?? null,
      status: run.status ?? "running",
      source: run.source ?? null,
      source_function: run.sourceFunction ?? null,
      subject_type: run.subjectType ?? null,
      subject_id: run.subjectId ?? null,
      job_id: run.jobId ?? null,
      tweet_id: run.tweetId ?? null,
      root_trace_id: run.rootTraceId ?? null,
      foglamp_workflow_run_id: run.foglampWorkflowRunId ?? run.workflowRunId ?? null,
      started_at: startedAt.toISOString(),
      metadata: sanitizeObservabilityMetadata(run.metadata),
    }, { onConflict: "run_key" }));
}

export async function finishWorkflowRun(supabase, runKey, status, metadata = {}, error = null) {
  if (!supabase) return;
  await safeWrite("workflow_runs.finish", () =>
    supabase.from("workflow_runs").update({
      status,
      ended_at: new Date().toISOString(),
      last_error: error ? errorMessage(error).slice(0, 1000) : null,
      metadata: sanitizeObservabilityMetadata(metadata),
    }).eq("run_key", runKey));
}

function durationMs(startedAt, endedAt) {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

function endpointFromUrl(url) {
  const text = String(url ?? "");
  if (text.includes("/audio/transcriptions")) return "audio.transcriptions";
  if (text.includes("/responses")) return "responses";
  return "openai";
}

function modelFromRequest(init, fallback = null) {
  const body = init?.body;
  if (!body) return fallback;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.model === "string" ? parsed.model : fallback;
    } catch {
      return fallback;
    }
  }
  if (typeof body.get === "function") {
    const value = body.get("model");
    return value == null ? fallback : String(value);
  }
  return fallback;
}

async function payloadFromResponse(response) {
  if (!response || typeof response.clone !== "function") return {};
  try {
    const rawText = await response.clone().text();
    return JSON.parse(rawText);
  } catch {
    return {};
  }
}

async function writeBudgetRows(supabase, call, usage) {
  const rows = [];
  const periodKey = monthPeriodKey(call.endedAt);
  if (usage.totalTokens > 0) {
    rows.push({
      provider: "openai",
      unit: "token",
      quantity: usage.totalTokens,
      period_key: periodKey,
      workflow_run_key: call.workflowRunKey,
      source_table: "ai_call_ledger",
      metadata: sanitizeObservabilityMetadata({
        trace_name: call.traceName,
        operation_name: call.operationName,
        agent_name: call.agentName ?? null,
        model: call.model ?? null,
      }),
    });
  }
  const spanEstimate = Math.max(0, Math.ceil(call.spanEstimate ?? 0));
  if (spanEstimate > 0) {
    rows.push({
      provider: "foglamp",
      unit: call.foglampExported ? "estimated_span" : "estimated_span_skipped",
      quantity: spanEstimate,
      period_key: periodKey,
      workflow_run_key: call.workflowRunKey,
      source_table: "ai_call_ledger",
      metadata: sanitizeObservabilityMetadata({
        trace_name: call.traceName,
        operation_name: call.operationName,
        agent_name: call.agentName ?? null,
        skip_reason: call.foglampSkipReason ?? null,
      }),
    });
  }
  if (rows.length === 0) return;
  await safeWrite("budget_ledger.insert", () => supabase.from("budget_ledger").insert(rows));
}

export async function recordObservedProviderCall(supabase, call) {
  if (!supabase || !call.workflowRunKey) return;
  const usage = usageFromPayload(call.payload);
  const status = call.status ?? (call.httpStatus && call.httpStatus >= 400 ? "failed" : "completed");
  const spanEstimate = Math.max(0, Math.ceil(call.spanEstimate ?? 0));
  await safeWrite("ai_call_ledger.insert", () =>
    supabase.from("ai_call_ledger").insert({
      workflow_run_key: call.workflowRunKey,
      trace_name: call.traceName,
      operation_name: call.operationName,
      agent_name: call.agentName ?? null,
      provider: call.provider ?? "openai",
      model: call.model ?? null,
      endpoint: call.endpoint,
      status,
      http_status: call.httpStatus ?? null,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      reasoning_tokens: usage.reasoningTokens,
      duration_ms: durationMs(call.startedAt, call.endedAt),
      started_at: call.startedAt.toISOString(),
      ended_at: call.endedAt.toISOString(),
      error_message: call.error ? errorMessage(call.error).slice(0, 1000) : null,
      foglamp_exported: call.foglampExported === true,
      foglamp_span_estimate: spanEstimate,
      foglamp_skip_reason: call.foglampSkipReason ?? null,
      metadata: sanitizeObservabilityMetadata(call.metadata),
    }));
  await writeBudgetRows(supabase, { ...call, endedAt: call.endedAt }, usage);
}

export function createObservedOpenAIFetch({
  supabase,
  workflowRunKey,
  operationName,
  agentName,
  metadata = {},
  fetchImpl = fetch,
}) {
  return async (url, init = {}) => {
    const startedAt = new Date();
    const endpoint = endpointFromUrl(url);
    const model = modelFromRequest(init);
    try {
      const response = await fetchImpl(url, init);
      const endedAt = new Date();
      const payload = await payloadFromResponse(response);
      await recordObservedProviderCall(supabase, {
        workflowRunKey,
        traceName: "video-renderer-ai",
        operationName,
        agentName,
        model,
        endpoint,
        status: response?.ok === false ? "failed" : "completed",
        httpStatus: typeof response?.status === "number" ? response.status : null,
        payload,
        startedAt,
        endedAt,
        spanEstimate: 0,
        foglampExported: false,
        foglampSkipReason: "non_chat_endpoint",
        metadata,
      });
      return response;
    } catch (error) {
      await recordObservedProviderCall(supabase, {
        workflowRunKey,
        traceName: "video-renderer-ai",
        operationName,
        agentName,
        model,
        endpoint,
        status: "failed",
        httpStatus: null,
        payload: {},
        startedAt,
        endedAt: new Date(),
        error,
        spanEstimate: 0,
        foglampExported: false,
        foglampSkipReason: "non_chat_endpoint",
        metadata,
      });
      throw error;
    }
  };
}
