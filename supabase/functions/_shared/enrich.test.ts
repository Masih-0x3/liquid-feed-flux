import { assert, assertEquals } from "jsr:@std/assert";
import {
  allowCompletedEnrichmentForPosting,
  DEFAULT_MASIH_VOICE_GUIDE,
  doesEnrichmentBlockX,
  evaluateAntiAggregatorGate,
  formatNewsWithTake,
  isAutoEnrichmentEnabled,
  makeResearchCacheKey,
  normalizeEnrichmentConfig,
  normalizeLanguageChoice,
  normalizePersonalVoiceProfile,
  normalizeVoiceGuide,
  observedEnrichmentOpenAI,
} from "./enrich.ts";
import type { NormalizedOpenAIResponse, OpenAICallParams } from "./openai.ts";

type RecordedWrite = {
  table: string;
  value: Record<string, unknown> | Array<Record<string, unknown>>;
};

type QueryResult = { data: null; error: null };

class RecordingQuery implements PromiseLike<QueryResult> {
  constructor(private table: string, private writes: RecordedWrite[]) {}

  insert(value: RecordedWrite["value"]): this {
    this.writes.push({ table: this.table, value });
    return this;
  }

  upsert(value: RecordedWrite["value"]): this {
    this.writes.push({ table: this.table, value });
    return this;
  }

  update(value: Record<string, unknown>): this {
    this.writes.push({ table: this.table, value });
    return this;
  }

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  gte(): this {
    return this;
  }

  in(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

function recordingSupabase(writes: RecordedWrite[]) {
  return {
    from(table: string) {
      return new RecordingQuery(table, writes);
    },
  };
}

Deno.test("normalizeEnrichmentConfig defaults to creator-analysis shadow review", () => {
  const cfg = normalizeEnrichmentConfig({ enabled: true });

  assertEquals(cfg.model, "gpt-5.4-mini");
  assertEquals(cfg.version, "creator-analysis-v2");
  assertEquals(cfg.mode, "creator_analysis");
  assertEquals(cfg.pipeline_mode, "shadow_review");
  assertEquals(cfg.review_mode, "shadow_review");
  assertEquals(cfg.source_attribution_policy, "compact");
  assert(cfg.banned_phrases.includes("فوری"));
});

Deno.test("normalizeEnrichmentConfig keeps disabled enrichment manual-only and non-blocking", () => {
  const cfg = normalizeEnrichmentConfig({ enabled: false, review_mode: "shadow_review" });

  assertEquals(cfg.pipeline_mode, "manual_only");
  assertEquals(isAutoEnrichmentEnabled(cfg), false);
  assertEquals(doesEnrichmentBlockX(cfg), false);
});

Deno.test("normalizeEnrichmentConfig separates auto generation from X blocking", () => {
  const shadow = normalizeEnrichmentConfig({ enabled: true, pipeline_mode: "shadow_review" });
  const required = normalizeEnrichmentConfig({ enabled: true, pipeline_mode: "required_for_x" });
  const auto = normalizeEnrichmentConfig({ enabled: true, require_approval: false, review_mode: "auto_high_confidence" });

  assertEquals(isAutoEnrichmentEnabled(shadow), true);
  assertEquals(doesEnrichmentBlockX(shadow), false);
  assertEquals(isAutoEnrichmentEnabled(required), true);
  assertEquals(doesEnrichmentBlockX(required), true);
  assertEquals(allowCompletedEnrichmentForPosting(auto), true);
});

Deno.test("anti-aggregator gate rejects copied translation with no creator angle", () => {
  const cfg = normalizeEnrichmentConfig({
    min_creator_angle_chars: 80,
    aggregator_review_threshold: 35,
    aggregator_reject_threshold: 70,
  });
  const translation = "این یک متن خبری طولانی درباره ایران و تحریم‌ها و واکنش‌های سیاسی امروز است.";

  const result = evaluateAntiAggregatorGate({
    config: cfg,
    finalText: translation,
    textTranslated: translation,
    creatorAngle: "",
    whyItMatters: "",
    formatUsed: "plain_opinion",
    previousFormatUsed: null,
    sameSourceRecentCount: 0,
  });

  assertEquals(result.publish_recommendation, "reject");
  assert(result.monetization_risk_flags.includes("mostly_translated_source_text"));
});

Deno.test("anti-aggregator gate flags habitual breaking language and repeated source density", () => {
  const cfg = normalizeEnrichmentConfig({ same_source_review_threshold: 2 });

  const result = evaluateAntiAggregatorGate({
    config: cfg,
    finalText: "BREAKING فوری: این تحلیل تازه نشان می‌دهد چرا این خبر برای مخاطب ایرانی مهم است.",
    textTranslated: "این خبر درباره سیاست منطقه‌ای است.",
    creatorAngle: "این تحلیل تازه نشان می‌دهد چرا این خبر برای مخاطب ایرانی مهم است و صرفا بازنشر خبر نیست.",
    whyItMatters: "چون روی سیاست منطقه‌ای اثر مستقیم دارد.",
    formatUsed: "analytical",
    previousFormatUsed: "analytical",
    sameSourceRecentCount: 3,
  });

  assertEquals(result.publish_recommendation, "reject");
  assert(result.monetization_risk_flags.some((flag) => flag.startsWith("banned_phrase:")));
  assert(result.monetization_risk_flags.includes("same_source_density"));
});

Deno.test("research cache key is stable by source URL", async () => {
  const a = await makeResearchCacheKey("https://example.com/story?utm=1", "different text");
  const b = await makeResearchCacheKey("https://example.com/story?utm=1", "other text");
  assertEquals(a, b);
});

Deno.test("voice guide defaults to @masihh manual enrichment source", () => {
  const guide = normalizeVoiceGuide(null);
  const profile = normalizePersonalVoiceProfile(null);

  assert(guide.guide.includes("@masihh"));
  assertEquals(guide.guide, DEFAULT_MASIH_VOICE_GUIDE);
  assertEquals(profile.handle, "@masihh");
  assertEquals(profile.intent_rules.clapback.includes("sharp") || profile.intent_rules.clapback.includes("Reactive"), true);
  assert(profile.language_rules.some((rule) => rule.toLowerCase().includes("persian")));
  assert(profile.language_rules.some((rule) => rule.toLowerCase().includes("never mix")));
  assert(guide.guide.includes("پ.ن"));
});

Deno.test("enrichment language normalization rejects mixed drafts", () => {
  assertEquals(normalizeLanguageChoice("mixed"), "persian");
  assertEquals(normalizeLanguageChoice("english"), "english");

  const persian = formatNewsWithTake({
    language: "persian",
    news: "نخست‌وزیر اسرائیل درباره ایران موضع تازه‌ای گرفت.",
    take: "حساب این تهدید آخرش برای تهران می‌رود، نه مردم ایران.",
  });

  assertEquals(
    persian,
    "خبر: نخست‌وزیر اسرائیل درباره ایران موضع تازه‌ای گرفت.\n\nپ.ن: حساب این تهدید آخرش برای تهران می‌رود، نه مردم ایران.",
  );

  const english = formatNewsWithTake({
    language: "english",
    news: "Netanyahu said Iran is now in the frame.",
    take: "The bill goes to Tehran, not the Iranian people.",
  });

  assertEquals(
    english,
    "News: Netanyahu said Iran is now in the frame.\n\nP.S.: The bill goes to Tehran, not the Iranian people.",
  );
});

Deno.test("voice profile normalization preserves generated rules with safe fallbacks", () => {
  const profile = normalizePersonalVoiceProfile({
    version: "custom",
    summary: "Blunt single-language voice",
    language_rules: ["Choose Persian or English based on audience"],
    tone_rules: ["Direct, sarcastic, anti-regime"],
    intent_rules: { news_reaction: "Lead with the take" },
    hashtags: ["#Iran"],
  });

  assertEquals(profile.version, "custom");
  assertEquals(profile.summary, "Blunt single-language voice");
  assertEquals(profile.intent_rules.news_reaction, "Lead with the take");
  assert(profile.intent_rules.clapback.length > 0);
  assertEquals(profile.hashtags, ["#Iran"]);
});

Deno.test("observed enrichment OpenAI records local ledger rows without prompt metadata", async () => {
  const writes: RecordedWrite[] = [];
  const response: NormalizedOpenAIResponse = {
    ok: true,
    status: 200,
    rawText: "{}",
    raw: {},
    content: "",
    toolCall: { name: "compose_post", arguments: "{}" },
    webSearchResults: [],
    outputItems: [],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 6,
      total_tokens: 17,
    },
    endpoint: "responses",
  };
  const requests: OpenAICallParams[] = [];
  const callModel = observedEnrichmentOpenAI(
    recordingSupabase(writes),
    "worker:enrich:job-1",
    async (request) => {
      requests.push(request);
      return response;
    },
  );

  await callModel({
    apiKey: "test-key",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "SECRET prompt text" }],
    tool: {
      name: "compose_post",
      parameters: { type: "object", properties: {}, required: [] },
    },
    maxOutputTokens: 100,
  }, {
    operationName: "compose_post",
    agentName: "composer",
    metadata: {
      tweet_id: "tweet-1",
      prompt_text: "SECRET prompt text",
      has_source_url: true,
    },
  });

  assertEquals(requests.length, 1);
  const aiWrite = writes.find((write) => write.table === "ai_call_ledger");
  assert(aiWrite && !Array.isArray(aiWrite.value));
  const aiRow = aiWrite.value as Record<string, unknown>;
  assertEquals(aiRow.trace_name, "enrichment-pipeline");
  assertEquals(aiRow.operation_name, "compose_post");
  assertEquals(aiRow.agent_name, "composer");
  assertEquals(aiRow.total_tokens, 17);
  assertEquals(aiRow.foglamp_exported, false);
  assertEquals(aiRow.foglamp_skip_reason, "enrichment_local_only");
  assertEquals(aiRow.foglamp_span_estimate, 2);
  const metadata = aiRow.metadata as Record<string, unknown>;
  assertEquals(metadata.tweet_id, "tweet-1");
  assertEquals(metadata.has_source_url, true);
  assertEquals("prompt_text" in metadata, false);

  const budgetWrite = writes.find((write) => write.table === "budget_ledger");
  assert(budgetWrite && Array.isArray(budgetWrite.value));
  const budgetRows = budgetWrite.value as Array<Record<string, unknown>>;
  assert(budgetRows.some((row) => row.provider === "openai" && row.unit === "token" && row.quantity === 17));
  assert(budgetRows.some((row) => row.provider === "foglamp" && row.unit === "estimated_span_skipped" && row.quantity === 2));
});
