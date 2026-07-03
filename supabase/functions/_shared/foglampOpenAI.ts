import {
  isReasoningModel,
  type NormalizedOpenAIResponse,
  type NormalizedToolCall,
  type OpenAICallParams,
  requiresResponsesApi,
} from "./openai.ts";
import { foglampMetadata, foglampWrapOptions } from "./observability.ts";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type FoglampTraceContext = {
  traceName: string;
  workflowName: string;
  workflowRunId: string;
  agentName?: string;
  sessionId?: string;
  customer?: {
    id: string;
    name?: string;
    imageUrl?: string;
  };
  metadata?: Record<string, unknown>;
};

type ModelMessage = {
  role: OpenAICallParams["messages"][number]["role"];
  content: string;
};

type GenerateTextOutput = {
  text: string;
  toolCalls: Array<{
    toolName?: string;
    input?: unknown;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    raw?: unknown;
  };
  response?: {
    id?: string;
    modelId?: string;
  };
  finishReason?: string;
  rawFinishReason?: string;
  warnings?: unknown[];
  providerMetadata?: unknown;
  steps?: unknown[];
};

type AiModule = {
  generateText: (
    options: Record<string, unknown>,
  ) => Promise<GenerateTextOutput>;
  tool: (definition: {
    description: string;
    inputSchema: unknown;
  }) => unknown;
  jsonSchema: (schema: unknown) => unknown;
};

type WrappedAiModule = {
  generateText: (
    options: Record<string, unknown>,
  ) => Promise<GenerateTextOutput>;
  flush: () => Promise<void>;
};

type AiProviderOptions = Record<
  string,
  Record<string, JsonValue | undefined>
>;

let aiModule: AiModule | null = null;
let wrappedAi: WrappedAiModule | null = null;

async function loadAiModule(): Promise<AiModule> {
  if (!aiModule) {
    aiModule = await import("npm:ai@6.0.217") as unknown as AiModule;
  }
  return aiModule;
}

async function fogAi(): Promise<WrappedAiModule> {
  if (!wrappedAi) {
    const { wrap } = await import("npm:foglamp@0.7.0/wrap");
    const foglampWrap = wrap as unknown as (
      module: AiModule,
      options: Record<string, unknown>,
    ) => WrappedAiModule;
    // Keep npm SDKs out of permissionless Deno test startup; real preview calls load them here.
    wrappedAi = foglampWrap(await loadAiModule(), foglampWrapOptions());
  }
  return wrappedAi;
}

function toModelMessages(
  messages: OpenAICallParams["messages"],
): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  })) as ModelMessage[];
}

function buildProviderOptions(
  p: OpenAICallParams,
): AiProviderOptions | undefined {
  const openai: Record<string, JsonValue | undefined> = {};
  if (p.reasoningEffort) openai.reasoningEffort = p.reasoningEffort;
  if (p.verbosity) openai.textVerbosity = p.verbosity;
  if (p.serviceTier && p.serviceTier !== "auto") {
    openai.serviceTier = p.serviceTier;
  }
  if (typeof p.parallelToolCalls === "boolean") {
    openai.parallelToolCalls = p.parallelToolCalls;
  }
  return Object.keys(openai).length ? { openai } : undefined;
}

function normalizeUsage(usage: GenerateTextOutput["usage"]):
  | Record<
    string,
    number
  >
  | null {
  if (!usage) return null;
  const raw = usage.raw && typeof usage.raw === "object" &&
      !Array.isArray(usage.raw)
    ? usage.raw as Record<string, unknown>
    : {};
  const promptTokens = usage.inputTokens ?? Number(raw.input_tokens ?? 0) ?? 0;
  const completionTokens = usage.outputTokens ??
    Number(raw.output_tokens ?? 0) ??
    0;
  const totalTokens = usage.totalTokens ?? Number(raw.total_tokens ?? 0) ??
    (promptTokens + completionTokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function buildToolSet(
  ai: AiModule,
  p: OpenAICallParams,
): Record<string, unknown> | undefined {
  if (!p.tool) return undefined;
  return {
    [p.tool.name]: ai.tool({
      description: p.tool.description,
      inputSchema: ai.jsonSchema(p.tool.parameters),
    }),
  };
}

function normalizeToolCall(
  toolCalls: GenerateTextOutput["toolCalls"],
  fallbackName: string | undefined,
): NormalizedToolCall | null {
  const toolCall = toolCalls[0];
  if (!toolCall) return null;
  return {
    name: toolCall.toolName || fallbackName || "",
    arguments: JSON.stringify(toolCall.input ?? {}),
  };
}

function errorResponse(
  message: string,
  endpoint: NormalizedOpenAIResponse["endpoint"],
  status = 500,
): NormalizedOpenAIResponse {
  const raw = { error: { message } };
  return {
    ok: false,
    status,
    rawText: JSON.stringify(raw),
    raw,
    content: "",
    toolCall: null,
    webSearchResults: [],
    outputItems: [],
    usage: null,
    endpoint,
  };
}

export async function callOpenAIWithFoglamp(
  p: OpenAICallParams,
  context: FoglampTraceContext,
): Promise<NormalizedOpenAIResponse> {
  const endpoint: NormalizedOpenAIResponse["endpoint"] = requiresResponsesApi(
      p.model,
    )
    ? "responses"
    : "chat.completions";

  if (p.builtInTools?.length) {
    return errorResponse(
      "Foglamp AI SDK adapter does not support built-in OpenAI tools for this preview path",
      endpoint,
      400,
    );
  }

  const { createOpenAI } = await import("npm:@ai-sdk/openai@3.0.79");
  const openai = createOpenAI({ apiKey: p.apiKey });
  const model = endpoint === "responses"
    ? openai.responses(p.model)
    : openai.chat(p.model);
  const reasoning = isReasoningModel(p.model);
  const ai = await loadAiModule();
  const tools = buildToolSet(ai, p);
  const providerOptions = buildProviderOptions(p);
  const fogWrappedAi = await fogAi();

  try {
    const result = await fogWrappedAi.generateText({
      model,
      messages: toModelMessages(p.messages),
      allowSystemInMessages: true,
      maxRetries: 0,
      maxOutputTokens: p.maxOutputTokens,
      ...(!reasoning && typeof p.temperature === "number"
        ? { temperature: p.temperature }
        : {}),
      ...(!reasoning && typeof p.topP === "number" ? { topP: p.topP } : {}),
      ...(!reasoning && typeof p.frequencyPenalty === "number"
        ? { frequencyPenalty: p.frequencyPenalty }
        : {}),
      ...(!reasoning && typeof p.presencePenalty === "number"
        ? { presencePenalty: p.presencePenalty }
        : {}),
      ...(typeof p.seed === "number" ? { seed: p.seed } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(tools
        ? {
          tools,
          toolChoice: { type: "tool", toolName: p.tool!.name },
        }
        : {}),
      foglamp: {
        ...context,
        metadata: foglampMetadata(context.metadata),
      },
    });

    const usage = normalizeUsage(result.usage);
    const toolCall = normalizeToolCall(result.toolCalls, p.tool?.name);
    const raw: Record<string, unknown> = {
      id: result.response?.id,
      model: result.response?.modelId ?? p.model,
      finish_reason: result.finishReason,
      raw_finish_reason: result.rawFinishReason ?? null,
      usage,
      warnings: result.warnings ?? [],
      provider_metadata: result.providerMetadata ?? null,
      steps: result.steps?.length ?? 0,
    };

    return {
      ok: true,
      status: 200,
      rawText: JSON.stringify(raw),
      raw,
      content: result.text,
      toolCall,
      webSearchResults: [],
      outputItems: [],
      usage,
      endpoint,
    };
  } catch (error) {
    return errorResponse((error as Error).message, endpoint);
  } finally {
    await fogWrappedAi.flush();
  }
}
