import { assertEquals } from "jsr:@std/assert";
import { callOpenAI } from "./openai.ts";

// These tests exercise `callResponsesApi` (not exported) indirectly via
// `callOpenAI({ model: "gpt-5.4-..." })`, which routes gpt-5.4* models to the
// Responses API. `globalThis.fetch` is stubbed with a body-spying mock so we can
// assert both the normalized parse AND the request shape (e.g. that we never
// set `include`). No real network egress occurs.

type FetchCall = {
  input: string;
  init?: RequestInit;
  body?: Record<string, unknown>;
};

async function withMockFetch<T>(
  responses: { status?: number; body: Record<string, unknown> }[],
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  let index = 0;
  globalThis.fetch = (async (
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawBody = typeof init?.body === "string"
      ? JSON.parse(init.body)
      : undefined;
    calls.push({ input: String(input), init, body: rawBody });
    const response = responses[index++] ??
      { status: 500, body: { error: "unexpected fetch" } };
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const RESPONSES_URL = "https://api.openai.com/v1/responses";

function urlCitation(url: string, title = ""): Record<string, unknown> {
  return { type: "url_citation", start_index: 0, end_index: 1, url, title };
}

function messageItem(
  content: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: "msg_test",
    type: "message",
    status: "completed",
    role: "assistant",
    content,
  };
}

function webSearchCallItem(): Record<string, unknown> {
  return {
    type: "web_search_call",
    id: "ws_test",
    status: "completed",
    action: { type: "search", query: "test query" },
  };
}

function functionCallItem(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "function_call",
    id: "fc_test",
    call_id: "call_test",
    name,
    arguments: JSON.stringify(args),
  };
}

Deno.test("callResponsesApi captures url_citation annotations from message output_text content", async () => {
  // Fixture mirrors the OpenAI docs' "Output and citations" shape: a
  // web_search_call with NO `results` field, plus a message whose
  // content[0].annotations carries the cited URL.
  const payload = {
    output: [
      webSearchCallItem(),
      messageItem([
        {
          type: "output_text",
          text: "On March 6, 2025, several news outlets reported on AI.",
          annotations: [urlCitation("https://example.com/ai-news", "AI News")],
        },
      ]),
    ],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  };

  await withMockFetch([{ status: 200, body: payload }], async (calls) => {
    const result = await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "search the web for AI news" }],
    });

    assertEquals(result.ok, true);
    assertEquals(result.status, 200);
    assertEquals(result.endpoint, "responses");
    assertEquals(calls[0].input, RESPONSES_URL);
    assertEquals(result.webSearchResults, [
      { url: "https://example.com/ai-news", title: "AI News", snippet: "" },
    ]);
    assertEquals(
      result.content,
      "On March 6, 2025, several news outlets reported on AI.",
    );
    assertEquals(result.toolCall, null);
  });
});

Deno.test("callResponsesApi skips annotations without url or with non-url_citation type", async () => {
  const payload = {
    output: [
      messageItem([
        {
          type: "output_text",
          text: "x",
          annotations: [
            {
              type: "url_citation",
              url: "https://keep.example.com",
              title: "Keep",
            },
            { type: "url_citation", title: "NoUrl" },
            {
              type: "other_annotation",
              url: "https://skip.example.com",
              title: "Skip",
            },
            { type: "url_citation", url: "", title: "Empty" },
          ],
        },
      ]),
    ],
  };

  await withMockFetch([{ status: 200, body: payload }], async () => {
    const result = await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "search" }],
    });
    assertEquals(result.webSearchResults, [
      { url: "https://keep.example.com", title: "Keep", snippet: "" },
    ]);
  });
});

Deno.test("callResponsesApi still parses function_call tool calls alongside annotated messages", async () => {
  // Researcher-like payload: forced tool_choice yields a function_call AND an
  // annotated assistant message. The fallback `webSearchResults` must be
  // populated even though a tool call is present.
  const payload = {
    output: [
      webSearchCallItem(),
      messageItem([
        {
          type: "output_text",
          text: "Background context follows.",
          annotations: [urlCitation("https://r.example.com", "R")],
        },
      ]),
      functionCallItem("provide_background", {
        background_summary: "s",
        sources: ["https://explicit.example.com"],
      }),
    ],
  };

  await withMockFetch([{ status: 200, body: payload }], async () => {
    const result = await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "research" }],
      tool: {
        name: "provide_background",
        parameters: { type: "object", properties: {}, required: [] },
      },
    });

    assertEquals(result.toolCall, {
      name: "provide_background",
      arguments: JSON.stringify({
        background_summary: "s",
        sources: ["https://explicit.example.com"],
      }),
    });
    assertEquals(result.webSearchResults, [
      { url: "https://r.example.com", title: "R", snippet: "" },
    ]);
    assertEquals(result.content, "Background context follows.");
  });
});

Deno.test("callResponsesApi returns empty webSearchResults for messages without annotations (no regression)", async () => {
  // Non-web-search callers (Archivist, Analyst, Humanizer, Composer, Critic)
  // never receive annotations; webSearchResults must remain [].
  const payload = {
    output: [
      messageItem([{ type: "output_text", text: "no annotations here" }]),
    ],
  };

  await withMockFetch([{ status: 200, body: payload }], async () => {
    const result = await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "go" }],
    });
    assertEquals(result.webSearchResults, []);
    assertEquals(result.content, "no annotations here");
  });
});

Deno.test("callResponsesApi treats web_search_call without results as a no-op (default docs shape)", async () => {
  // The documented default `web_search_call` carries id/action/status only
  // -- no `results` array. The parser must not crash or invent entries.
  const payload = { output: [webSearchCallItem()] };

  await withMockFetch([{ status: 200, body: payload }], async () => {
    const result = await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "go" }],
    });
    assertEquals(result.webSearchResults, []);
    assertEquals(result.content, "");
  });
});

Deno.test("callResponsesApi never sets `include` on the request body (relies on default annotations)", async () => {
  // The parser relies on default `url_citation` annotations rather than
  // `web_search_call.results` or `web_search_call.action.sources`, both of
  // which require `include`. Pin that the request shape does not silently
  // start requesting an alternate citation source.
  const payload = {
    output: [
      webSearchCallItem(),
      messageItem([{ type: "output_text", text: "x" }]),
    ],
  };

  await withMockFetch([{ status: 200, body: payload }], async (calls) => {
    await callOpenAI({
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "go" }],
      builtInTools: [{ type: "web_search" }],
    });
    const body = calls[0].body!;
    assertEquals("include" in body, false);
    assertEquals(body.tools, [{ type: "web_search" }]);
  });
});
