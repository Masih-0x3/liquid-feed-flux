// Shared OpenAI call helper that routes between /v1/chat/completions and /v1/responses.
//
// The OpenAI Responses API is REQUIRED for some newer models (notably the
// gpt-5.4 family) when using `reasoning_effort` / `verbosity`. The Chat
// Completions endpoint rejects those params for those models with HTTP 400.
//
// This helper accepts a chat-completions style request (messages + tools)
// and adapts it to the right endpoint, then normalizes the response back
// into a chat-completions-shaped object so callers don't need to branch.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface ToolFunctionDef {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface OpenAICallParams {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tool?: ToolFunctionDef; // optional single function tool (we only ever force one)
  builtInTools?: Array<{ type: string; [key: string]: unknown }>; // e.g. { type: 'web_search' }
  maxOutputTokens?: number;
  temperature?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  reasoningEffort?: string | null; // minimal | low | medium | high
  verbosity?: string | null;       // low | medium | high
  seed?: number | null;
  serviceTier?: string | null;     // 'auto' is treated as omit
  parallelToolCalls?: boolean | null;
}

export interface NormalizedToolCall {
  name: string;
  arguments: string; // JSON string
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface NormalizedOpenAIResponse {
  ok: boolean;
  status: number;
  rawText: string;
  raw: Record<string, unknown>;
  content: string;             // assistant text (or '')
  toolCall: NormalizedToolCall | null;
  webSearchResults: WebSearchResult[];
  outputItems: Array<Record<string, unknown>>; // raw Responses API output items
  usage: Record<string, number> | null;
  endpoint: 'chat.completions' | 'responses';
}

// gpt-5.4* and gpt-5.5* require the Responses API for reasoning_effort/verbosity.
// We route the entire family through Responses to be safe (also accepts function tools).
export function requiresResponsesApi(model: string): boolean {
  return /^gpt-5\.(4|5)/i.test(model);
}

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[34])/i.test(model);
}

export function useMaxCompletionTokens(model: string): boolean {
  // Modern models (gpt-5.x, gpt-4.1, o-series). Legacy gpt-4o / gpt-4 / gpt-3.5 use max_tokens.
  return !/^(gpt-4o($|-)|gpt-4($|-)|gpt-3\.5)/i.test(model);
}

export async function callOpenAI(p: OpenAICallParams): Promise<NormalizedOpenAIResponse> {
  if (requiresResponsesApi(p.model)) {
    return await callResponsesApi(p);
  }
  return await callChatCompletions(p);
}

async function callChatCompletions(p: OpenAICallParams): Promise<NormalizedOpenAIResponse> {
  const tokenParam = useMaxCompletionTokens(p.model) ? 'max_completion_tokens' : 'max_tokens';
  const reasoning = isReasoningModel(p.model);

  const body: Record<string, unknown> = {
    model: p.model,
    messages: p.messages,
  };
  if (p.maxOutputTokens) body[tokenParam] = p.maxOutputTokens;
  if (!reasoning && typeof p.temperature === 'number') body.temperature = p.temperature;
  if (!reasoning && typeof p.topP === 'number') body.top_p = p.topP;
  if (!reasoning) {
    if (typeof p.frequencyPenalty === 'number') body.frequency_penalty = p.frequencyPenalty;
    if (typeof p.presencePenalty === 'number') body.presence_penalty = p.presencePenalty;
  }
  if (reasoning && p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  if (reasoning && p.verbosity) body.verbosity = p.verbosity;
  if (typeof p.seed === 'number') body.seed = p.seed;
  if (p.serviceTier && p.serviceTier !== 'auto') body.service_tier = p.serviceTier;
  if (typeof p.parallelToolCalls === 'boolean') body.parallel_tool_calls = p.parallelToolCalls;

  if (p.builtInTools?.length) {
    console.warn(`[openai] builtInTools (${p.builtInTools.map(t => t.type).join(', ')}) requested but model "${p.model}" uses Chat Completions API which does not support built-in tools like web_search. These tools will be IGNORED. Switch to a gpt-5.x model to use built-in tools.`);
  }

  if (p.tool) {
    body.tools = [{ type: 'function', function: p.tool }];
    body.tool_choice = { type: 'function', function: { name: p.tool.name } };
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rawText = await resp.text();
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(rawText); } catch { raw = { raw_text: rawText }; }

  const choice = (raw as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> }).choices?.[0]?.message;
  const tc = choice?.tool_calls?.[0];
  const toolCall: NormalizedToolCall | null = tc?.function?.arguments
    ? { name: tc.function.name || (p.tool?.name ?? ''), arguments: tc.function.arguments }
    : null;

  return {
    ok: resp.ok,
    status: resp.status,
    rawText,
    raw,
    content: choice?.content ?? '',
    toolCall,
    webSearchResults: [],
    outputItems: [],
    usage: (raw as { usage?: Record<string, number> }).usage ?? null,
    endpoint: 'chat.completions',
  };
}

async function callResponsesApi(p: OpenAICallParams): Promise<NormalizedOpenAIResponse> {
  // Map chat messages -> Responses API `input`. The Responses API accepts the
  // same role/content shape but `system` is conventionally passed as
  // top-level `instructions`. We collapse all system messages into instructions
  // and pass the remainder as input items.
  const sys = p.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const rest = p.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model: p.model,
    input: rest,
  };
  if (sys) body.instructions = sys;
  if (p.maxOutputTokens) body.max_output_tokens = p.maxOutputTokens;

  // Reasoning + verbosity (the whole reason we're on this endpoint).
  if (p.reasoningEffort) body.reasoning = { effort: p.reasoningEffort };
  if (p.verbosity) body.text = { verbosity: p.verbosity };

  if (typeof p.seed === 'number') body.seed = p.seed;
  if (p.serviceTier && p.serviceTier !== 'auto') body.service_tier = p.serviceTier;
  if (typeof p.parallelToolCalls === 'boolean') body.parallel_tool_calls = p.parallelToolCalls;
  // Note: temperature, top_p, frequency_penalty, presence_penalty are not supported
  // by the Responses API for reasoning models (which is the only family we
  // route here). Intentionally omitted.

  const tools: Array<Record<string, unknown>> = [];
  if (p.builtInTools?.length) {
    for (const t of p.builtInTools) tools.push(t);
  }
  if (p.tool) {
    tools.push({
      type: 'function',
      name: p.tool.name,
      description: p.tool.description,
      parameters: p.tool.parameters,
    });
    body.tool_choice = { type: 'function', name: p.tool.name };
  }
  if (tools.length) body.tools = tools;

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const rawText = await resp.text();
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(rawText); } catch { raw = { raw_text: rawText }; }

  // Normalize: pull tool call (function_call output item), web search results, and assistant text.
  type OutputItem =
    | { type: 'message'; content?: Array<{ type: string; text?: string }> }
    | { type: 'function_call'; name?: string; arguments?: string; call_id?: string }
    | { type: 'web_search_call'; status?: string; results?: Array<{ url?: string; title?: string; snippet?: string }> }
    | { type: string; [k: string]: unknown };
  const output = ((raw as { output?: OutputItem[] }).output ?? []) as OutputItem[];
  let toolCall: NormalizedToolCall | null = null;
  let content = '';
  const webSearchResults: WebSearchResult[] = [];
  for (const item of output) {
    if (item.type === 'function_call') {
      const fc = item as { name?: string; arguments?: string };
      if (fc.arguments) toolCall = { name: fc.name || (p.tool?.name ?? ''), arguments: fc.arguments };
    } else if (item.type === 'web_search_call') {
      const ws = item as { results?: Array<{ url?: string; title?: string; snippet?: string }> };
      for (const r of ws.results ?? []) {
        if (r.url) webSearchResults.push({ url: r.url, title: r.title ?? '', snippet: r.snippet ?? '' });
      }
    } else if (item.type === 'message') {
      const msg = item as { content?: Array<{ type: string; text?: string }> };
      for (const c of msg.content ?? []) {
        if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
          content += c.text;
        }
      }
    }
  }
  // Convenience: many Responses payloads expose `output_text` as a string.
  if (!content) {
    const ot = (raw as { output_text?: string }).output_text;
    if (typeof ot === 'string') content = ot;
  }

  // Normalize usage to chat-completions-ish shape.
  const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
  const usage: Record<string, number> | null = u
    ? {
        prompt_tokens: u.input_tokens ?? 0,
        completion_tokens: u.output_tokens ?? 0,
        total_tokens: u.total_tokens ?? ((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
      }
    : null;

  return {
    ok: resp.ok,
    status: resp.status,
    rawText,
    raw,
    content,
    toolCall,
    webSearchResults,
    outputItems: output as Array<Record<string, unknown>>,
    usage,
    endpoint: 'responses',
  };
}
