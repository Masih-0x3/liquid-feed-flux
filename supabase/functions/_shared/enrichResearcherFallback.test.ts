import { assert, assertEquals } from "jsr:@std/assert";
import { runEnrichPipeline } from "./enrich.ts";
import type { NormalizedOpenAIResponse, OpenAICallParams } from "./openai.ts";

// Integration test for the Researcher agent's `sources` fallback.
//
// The Researcher's tool schema marks `sources` as required, but the function
// tool is registered without `strict: true`, so the model may legally omit
// `sources` from its function-call JSON. When that happens, `runResearcher`
// falls back to `resp.webSearchResults?.map(r => r.url) ?? []` (enrich.ts:1214).
// Before the parser fix, `webSearchResults` was always `[]`, so this fallback
// was dead and `output.sources` was empty. With the fix, `url_citation`
// annotations from the Responses API message populate `webSearchResults`, and
// the fallback now recovers cited URLs.
//
// These tests run the FULL enrichment pipeline via `runEnrichPipeline` with an
// injected `callOpenAI` that dispatches by tool name, so the wiring from the
// parser -> `runResearcher` -> `runComposer` -> `source_context.sources` is
// exercised end-to-end. No real network egress (the injected caller never hits
// fetch); the supabase mock returns empty reads and records writes.

// Self-contained supabase mock: every chain method returns the chain, and
// awaiting it resolves `{ data: null, error: null }`. Supports all methods
// touched by the pipeline + observability (select/insert/upsert/update/eq/neq/
// gte/in/order/limit/maybeSingle/single).
function mockSupabase() {
  type QueryResult = { data: null; error: null };
  interface Chain {
    [m: string]: unknown;
    then<TResult1 = QueryResult, TResult2 = never>(
      onf?: ((v: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onr?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  }
  const chain = {} as Chain;
  for (const m of [
    "select", "insert", "upsert", "update", "eq", "neq", "gte", "in", "order",
    "limit", "maybeSingle", "single",
  ]) {
    chain[m] = () => chain;
  }
  chain.then = (onf, onr) =>
    Promise.resolve({ data: null, error: null } as QueryResult).then(onf, onr);
  return { from: () => chain };
}

function baseResponse(
  toolCall: { name: string; arguments: string } | null,
  webSearchResults: NormalizedOpenAIResponse["webSearchResults"] = [],
): NormalizedOpenAIResponse {
  return {
    ok: true,
    status: 200,
    rawText: "{}",
    raw: {},
    content: "",
    toolCall,
    webSearchResults,
    outputItems: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    endpoint: "responses",
  };
}

// Build a dispatching `callOpenAI`. The Researcher call returns the scenario
// under test (a toolCall whose arguments OMIT `sources`, plus populated
// `webSearchResults` from an annotated message). Other agents return minimal
// valid toolCalls so the pipeline completes; voice-critic and critic return
// `null` toolCalls to take their documented fallback paths.
function makeCallOpenAI(researcher: NormalizedOpenAIResponse, log: OpenAICallParams[]) {
  return async (request: OpenAICallParams): Promise<NormalizedOpenAIResponse> => {
    log.push(request);
    switch (request.tool?.name) {
      case "provide_background":
        return researcher;
      case "compose_analysis":
        return baseResponse({
          name: "compose_analysis",
          arguments: JSON.stringify({
            commentary: "c",
            hook: "h",
            significance: "s",
            creator_angle: "ca",
            why_it_matters: "w",
          }),
        });
      case "humanize_text":
        return baseResponse({
          name: "humanize_text",
          arguments: JSON.stringify({
            humanized_commentary: "hc",
            humanized_hook: "hh",
          }),
        });
      case "compose_post":
        return baseResponse({
          name: "compose_post",
          arguments: JSON.stringify({
            intent: "news_reaction",
            language_choice: "persian",
            selected_variant: "raw_masihh",
            variants: [],
            format_used: "plain_opinion",
          }),
        });
      case "critique_voice_match":
      case "critique_enrichment":
        // Take the documented fallback path (no toolCall -> conservative review).
        return baseResponse(null);
      default:
        return baseResponse(null);
    }
  };
}

Deno.test("Researcher sources fallback recovers cited URLs from webSearchResults when the model omits sources (T15)", async () => {
  // The model omitted `sources` from its function-call JSON. Before the parser
  // fix, `webSearchResults` was always `[]` so `output.sources` was empty.
  // With the fix, the `url_citation` annotations populate `webSearchResults`,
  // and the fallback recovers them.
  const researcherResponse = baseResponse(
    {
      name: "provide_background",
      arguments: JSON.stringify({
        background_summary: "Background context.",
        key_facts: ["fact one"],
        related_events: "Prior events.",
        // NOTE: `sources` intentionally omitted -- the fallback firing path.
      }),
    },
    [{ url: "https://r.example.com/news", title: "R", snippet: "" }],
  );

  const requests: OpenAICallParams[] = [];
  const result = await runEnrichPipeline({
    supabase: mockSupabase() as never,
    apiKey: "test-key",
    config: { enabled: true, research_cache_hours: 0 } as never,
    voiceSamples: { samples: [], updated_at: null } as never,
    tweetId: "tweet-1",
    textOriginal: "Some news happened today.",
    textTranslated: "خبر امروز رخ داد.",
    importanceScore: null, // do not skip research
    previousFormatUsed: null,
    callOpenAI: makeCallOpenAI(researcherResponse, requests),
  } as never);

  // T15: the recovered cited URL flows into ResearcherOutput.sources.
  assertEquals(result.researcher?.sources, ["https://r.example.com/news"]);
  assertEquals(result.researcher?.background_summary, "Background context.");
  assertEquals(result.researcher?.key_facts, ["fact one"]);

  // The Researcher request must carry the web_search built-in tool and force
  // the function tool (G8/G15 wiring).
  const researcherRequest = requests.find((r) => r.tool?.name === "provide_background");
  assert(researcherRequest, "researcher call was made");
  assertEquals(
    researcherRequest.builtInTools,
    [{ type: "web_search" }],
    "researcher must request the web_search built-in tool",
  );
  assertEquals(researcherRequest.tool?.name, "provide_background");
});

Deno.test("Composer source_context.sources reflects the Researcher fallback URLs (T16)", async () => {
  // One cited URL recovered via the fallback; the Composer persists it onto
  // the draft's source_context.sources (enrich.ts:1624,1635-1640), subject to
  // the 4-URL cap the Composer applies in its prompt (enrich.ts:1444). With a
  // single URL the cap is irrelevant.
  const researcherResponse = baseResponse(
    {
      name: "provide_background",
      arguments: JSON.stringify({
        background_summary: "Background context.",
        key_facts: ["fact one"],
        related_events: "Prior events.",
        // `sources` intentionally omitted.
      }),
    },
    [
      { url: "https://r.example.com/news", title: "R", snippet: "" },
      { url: "https://r2.example.com/backgrounder", title: "R2", snippet: "" },
    ],
  );

  const result = await runEnrichPipeline({
    supabase: mockSupabase() as never,
    apiKey: "test-key",
    config: { enabled: true, research_cache_hours: 0 } as never,
    voiceSamples: { samples: [], updated_at: null } as never,
    tweetId: "tweet-2",
    textOriginal: "Some news happened today.",
    textTranslated: "خبر امروز رخ داد.",
    importanceScore: null,
    previousFormatUsed: null,
    callOpenAI: makeCallOpenAI(researcherResponse, []),
  } as never);

  // T16: the draft's source_context.sources mirrors the recovered URLs.
  assertEquals(result.researcher?.sources, [
    "https://r.example.com/news",
    "https://r2.example.com/backgrounder",
  ]);
  assertEquals(result.composer.source_context.sources, [
    "https://r.example.com/news",
    "https://r2.example.com/backgrounder",
  ]);
  assertEquals(result.composer.source_context.attribution_policy, "compact");
});

Deno.test("when the model self-reports sources, webSearchResults fallback is not used (regression guard)", async () => {
  // The model included `sources` in its function-call JSON. The fallback must
  // NOT override it even if `webSearchResults` is non-empty.
  const researcherResponse = baseResponse(
    {
      name: "provide_background",
      arguments: JSON.stringify({
        background_summary: "b",
        key_facts: ["f"],
        related_events: "e",
        sources: ["https://self-reported.example.com"],
      }),
    },
    [{ url: "https://annotation-only.example.com", title: "A", snippet: "" }],
  );

  const result = await runEnrichPipeline({
    supabase: mockSupabase() as never,
    apiKey: "test-key",
    config: { enabled: true, research_cache_hours: 0 } as never,
    voiceSamples: { samples: [], updated_at: null } as never,
    tweetId: "tweet-3",
    textOriginal: "Some news happened today.",
    textTranslated: "خبر امروز رخ داد.",
    importanceScore: null,
    previousFormatUsed: null,
    callOpenAI: makeCallOpenAI(researcherResponse, []),
  } as never);

  assertEquals(result.researcher?.sources, ["https://self-reported.example.com"]);
  assertEquals(
    result.composer.source_context.sources,
    ["https://self-reported.example.com"],
  );
});
