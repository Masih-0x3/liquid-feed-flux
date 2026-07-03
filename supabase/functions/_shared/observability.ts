import type { NormalizedOpenAIResponse, OpenAICallParams } from "./openai.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type SupabaseLike = {
  from(table: string): unknown;
};

type QueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string, options?: Record<string, unknown>): QueryBuilder;
  insert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
  ): QueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): QueryBuilder;
  update(value: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  in(column: string, values: unknown[]): QueryBuilder;
  order(column: string, options?: Record<string, unknown>): QueryBuilder;
  limit(value: number): QueryBuilder;
};

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type ObservabilityWorkflowRun = {
  runKey: string;
  workflowName: string;
  workflowRunId?: string | null;
  status?: WorkflowRunStatus;
  source?: string | null;
  sourceFunction?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  jobId?: string | null;
  tweetId?: string | null;
  rootTraceId?: string | null;
  foglampWorkflowRunId?: string | null;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
};

export type ObservedOpenAICall = {
  workflowRunKey: string;
  traceName: string;
  operationName: string;
  agentName?: string | null;
  model?: string | null;
  endpoint?: NormalizedOpenAIResponse["endpoint"] | null;
  request?: OpenAICallParams;
  response?: NormalizedOpenAIResponse;
  status?: "completed" | "failed" | "skipped";
  startedAt: Date;
  endedAt: Date;
  spanEstimate?: number;
  foglampExported?: boolean;
  foglampSkipReason?: string | null;
  metadata?: Record<string, unknown>;
};

export type ObservedProviderCall = {
  workflowRunKey: string;
  traceName: string;
  operationName: string;
  agentName?: string | null;
  provider?: string | null;
  model?: string | null;
  endpoint: string;
  status?: "completed" | "failed" | "skipped";
  httpStatus?: number | null;
  usage?: Record<string, unknown> | null;
  startedAt: Date;
  endedAt: Date;
  error?: unknown;
  spanEstimate?: number;
  foglampExported?: boolean;
  foglampSkipReason?: string | null;
  metadata?: Record<string, unknown>;
};

export type FoglampBudgetSettings = {
  enabled: boolean;
  hasApiKey: boolean;
  monthlySpanLimit: number;
  monthlySpanCap: number;
  monthlySpanWarn: number;
  recordInputs: boolean;
  recordOutputs: boolean;
};

export type FoglampBudgetDecision = {
  allowed: boolean;
  reason: string | null;
  periodKey: string;
  spanEstimate: number;
  spansUsed: number;
  spansRemaining: number;
  settings: FoglampBudgetSettings;
};

const METADATA_STRING_LIMIT = 512;
const METADATA_KEY_LIMIT = 80;
const METADATA_KEYS_LIMIT = 32;
const DEFAULT_FOGLAMP_MONTHLY_LIMIT = 10_000;
const DEFAULT_FOGLAMP_MONTHLY_CAP = 8_000;
const DEFAULT_FOGLAMP_MONTHLY_WARN = 6_000;

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (value == null || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function monthPeriodKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function asBuilder(value: unknown): QueryBuilder {
  return value as QueryBuilder;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function usageNumber(value: unknown): number {
  return Math.max(0, Math.round(safeNumber(value)));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") return value.slice(0, METADATA_STRING_LIMIT);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value).slice(0, METADATA_STRING_LIMIT);
}

function metadataKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, METADATA_KEY_LIMIT);
}

function shouldDropMetadataKey(key: string): boolean {
  return /(api[_-]?key|secret|token|authorization|prompt|content|raw|input|output|text|message)/i
    .test(key);
}

export function sanitizeObservabilityMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!metadata) return out;
  for (
    const [key, value] of Object.entries(metadata).slice(
      0,
      METADATA_KEYS_LIMIT,
    )
  ) {
    if (shouldDropMetadataKey(key)) continue;
    out[metadataKey(key)] = metadataValue(value);
  }
  return out;
}

export function foglampMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string> {
  const sanitized = sanitizeObservabilityMetadata(metadata);
  return Object.fromEntries(
    Object.entries(sanitized).map(([key, value]) => [key, String(value)]),
  );
}

export function getFoglampBudgetSettings(): FoglampBudgetSettings {
  const monthlySpanLimit = Math.max(
    0,
    Math.round(
      envNumber("FOGLAMP_MONTHLY_SPAN_LIMIT", DEFAULT_FOGLAMP_MONTHLY_LIMIT),
    ),
  );
  const configuredCap = Math.round(
    envNumber("FOGLAMP_MONTHLY_SPAN_CAP", DEFAULT_FOGLAMP_MONTHLY_CAP),
  );
  const monthlySpanCap = Math.max(
    0,
    Math.min(monthlySpanLimit || configuredCap, configuredCap),
  );
  const monthlySpanWarn = Math.max(
    0,
    Math.min(
      monthlySpanCap,
      Math.round(
        envNumber("FOGLAMP_MONTHLY_SPAN_WARN", DEFAULT_FOGLAMP_MONTHLY_WARN),
      ),
    ),
  );

  return {
    enabled: envFlag("FOGLAMP_ENABLED", true),
    hasApiKey: Boolean(readEnv("FOGLAMP_API_KEY")),
    monthlySpanLimit,
    monthlySpanCap,
    monthlySpanWarn,
    recordInputs: envFlag("FOGLAMP_RECORD_INPUTS", false),
    recordOutputs: envFlag("FOGLAMP_RECORD_OUTPUTS", false),
  };
}

export function foglampWrapOptions(): Record<string, unknown> {
  return {
    apiKey: readEnv("FOGLAMP_API_KEY"),
    endpoint: readEnv("FOGLAMP_INGEST_URL"),
    debug: readEnv("FOGLAMP_DEBUG") === "1",
    hud: readEnv("FOGLAMP_HUD") === "1",
    recordInputs: envFlag("FOGLAMP_RECORD_INPUTS", false),
    recordOutputs: envFlag("FOGLAMP_RECORD_OUTPUTS", false),
  };
}

async function safeWrite(
  label: string,
  operation: () => PromiseLike<QueryResult> | QueryBuilder,
): Promise<void> {
  try {
    const result = await operation();
    if (result?.error) {
      console.warn("[observability] write failed", {
        label,
        error: errorMessage(result.error),
      });
    }
  } catch (error) {
    console.warn("[observability] write threw", {
      label,
      error: errorMessage(error),
    });
  }
}

export async function startWorkflowRun(
  supabase: SupabaseLike | undefined,
  run: ObservabilityWorkflowRun,
): Promise<void> {
  if (!supabase) return;
  const startedAt = run.startedAt ?? new Date();
  await safeWrite(
    "workflow_runs.upsert",
    () =>
      asBuilder(supabase.from("workflow_runs")).upsert({
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
        foglamp_workflow_run_id: run.foglampWorkflowRunId ??
          run.workflowRunId ?? null,
        started_at: startedAt.toISOString(),
        metadata: sanitizeObservabilityMetadata(run.metadata),
      }, { onConflict: "run_key" }),
  );
}

export async function finishWorkflowRun(
  supabase: SupabaseLike | undefined,
  runKey: string,
  status: Extract<WorkflowRunStatus, "completed" | "failed" | "skipped">,
  metadata?: Record<string, unknown>,
  error?: unknown,
): Promise<void> {
  if (!supabase) return;
  await safeWrite(
    "workflow_runs.finish",
    () =>
      asBuilder(supabase.from("workflow_runs")).update({
        status,
        ended_at: new Date().toISOString(),
        last_error: error ? errorMessage(error).slice(0, 1000) : null,
        ...(metadata
          ? { metadata: sanitizeObservabilityMetadata(metadata) }
          : {}),
      }).eq("run_key", runKey),
  );
}

export async function readFoglampBudgetDecision(
  supabase: SupabaseLike | undefined,
  spanEstimate: number,
  now = new Date(),
): Promise<FoglampBudgetDecision> {
  const settings = getFoglampBudgetSettings();
  const normalizedSpanEstimate = Math.max(0, Math.ceil(spanEstimate));
  const periodKey = monthPeriodKey(now);
  const base = {
    periodKey,
    spanEstimate: normalizedSpanEstimate,
    spansUsed: 0,
    spansRemaining: settings.monthlySpanCap,
    settings,
  };

  if (!settings.enabled) {
    return { ...base, allowed: false, reason: "disabled" };
  }
  if (!settings.hasApiKey) {
    return { ...base, allowed: false, reason: "missing_api_key" };
  }
  if (!supabase) {
    return { ...base, allowed: false, reason: "missing_budget_store" };
  }

  try {
    const result = await asBuilder(supabase.from("budget_ledger"))
      .select("quantity")
      .eq("provider", "foglamp")
      .eq("unit", "estimated_span")
      .eq("period_key", periodKey)
      .limit(10000);
    if (result.error) {
      return { ...base, allowed: false, reason: "budget_lookup_failed" };
    }
    const spansUsed = Array.isArray(result.data)
      ? result.data.reduce(
        (sum, row) => sum + safeNumber(recordValue(row).quantity),
        0,
      )
      : 0;
    const spansRemaining = Math.max(0, settings.monthlySpanCap - spansUsed);
    if (spansUsed + normalizedSpanEstimate > settings.monthlySpanCap) {
      return {
        ...base,
        allowed: false,
        reason: "monthly_cap_reached",
        spansUsed,
        spansRemaining,
      };
    }
    return {
      ...base,
      allowed: true,
      reason: null,
      spansUsed,
      spansRemaining,
    };
  } catch {
    return { ...base, allowed: false, reason: "budget_lookup_failed" };
  }
}

function usageFromRecord(usage: Record<string, unknown>) {
  const promptTokens = usageNumber(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens,
  );
  const completionTokens = usageNumber(
    usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens,
  );
  const totalTokens = usageNumber(
    usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens,
  );
  const outputDetails = recordValue(usage.output_tokens_details);
  const reasoningTokens = usageNumber(
    usage.reasoning_tokens ?? outputDetails.reasoning_tokens,
  );
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
  };
}

function usageFromResponse(response?: NormalizedOpenAIResponse) {
  const usage = response?.usage ?? recordValue(response?.raw?.usage);
  return usageFromRecord(usage);
}

function durationMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round(endedAt.getTime() - startedAt.getTime()));
}

async function writeBudgetRows(
  supabase: SupabaseLike,
  call: {
    workflowRunKey: string;
    traceName: string;
    operationName: string;
    agentName?: string | null;
    model?: string | null;
    endedAt: Date;
    spanEstimate?: number;
    foglampExported?: boolean;
    foglampSkipReason?: string | null;
  },
  usage: ReturnType<typeof usageFromResponse>,
): Promise<void> {
  const periodKey = monthPeriodKey(call.endedAt);
  const rows: Array<Record<string, unknown>> = [];
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

  const spanEstimate = Math.max(0, Math.ceil(call.spanEstimate ?? 1));
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
  await safeWrite(
    "budget_ledger.insert",
    () => asBuilder(supabase.from("budget_ledger")).insert(rows),
  );
}

export async function recordObservedOpenAICall(
  supabase: SupabaseLike | undefined,
  call: ObservedOpenAICall,
): Promise<void> {
  if (!supabase) return;
  const usage = usageFromResponse(call.response);
  const status = call.status ??
    (call.response?.ok === false ? "failed" : "completed");
  const spanEstimate = Math.max(0, Math.ceil(call.spanEstimate ?? 1));

  await safeWrite(
    "ai_call_ledger.insert",
    () =>
      asBuilder(supabase.from("ai_call_ledger")).insert({
        workflow_run_key: call.workflowRunKey,
        trace_name: call.traceName,
        operation_name: call.operationName,
        agent_name: call.agentName ?? null,
        provider: "openai",
        model: call.model ?? call.request?.model ?? null,
        endpoint: call.endpoint ?? call.response?.endpoint ?? null,
        status,
        http_status: call.response?.status ?? null,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        reasoning_tokens: usage.reasoningTokens,
        duration_ms: durationMs(call.startedAt, call.endedAt),
        started_at: call.startedAt.toISOString(),
        ended_at: call.endedAt.toISOString(),
        error_message: call.response?.ok === false
          ? errorMessage(call.response.raw?.error ?? call.response.rawText)
            .slice(0, 1000)
          : null,
        foglamp_exported: call.foglampExported === true,
        foglamp_span_estimate: spanEstimate,
        foglamp_skip_reason: call.foglampSkipReason ?? null,
        metadata: sanitizeObservabilityMetadata(call.metadata),
      }),
  );
  await writeBudgetRows(supabase, {
    ...call,
    model: call.model ?? call.request?.model ?? null,
  }, usage);
}

export async function recordObservedProviderCall(
  supabase: SupabaseLike | undefined,
  call: ObservedProviderCall,
): Promise<void> {
  if (!supabase) return;
  const usage = usageFromRecord(recordValue(call.usage));
  const status = call.status ?? (call.httpStatus && call.httpStatus >= 400
    ? "failed"
    : "completed");
  const spanEstimate = Math.max(0, Math.ceil(call.spanEstimate ?? 0));

  await safeWrite(
    "ai_call_ledger.insert",
    () =>
      asBuilder(supabase.from("ai_call_ledger")).insert({
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
      }),
  );
  await writeBudgetRows(supabase, call, usage);
}

export function estimateFoglampSpans(request: OpenAICallParams): number {
  return request.tool ? 2 : 1;
}
