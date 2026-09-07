import { assertEquals } from "jsr:@std/assert";
import {
  getSettingsAdminAction,
  getSettingsSamplesAdminAction,
  shouldRestampXPostingStart,
  validateSettingsValue,
} from "./settings.ts";

function readQuery(data: unknown, error: unknown = null) {
  const query = {
    select(_columns: string) { return query; },
    in(_column: string, _values: readonly string[]) { return query; },
    order(_column: string, _options?: Record<string, unknown>) { return query; },
    limit(_value: number) { return query; },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve({ data, error }).then(
        onfulfilled ?? ((value) => value as TResult1),
      );
    },
  };
  return query;
}

Deno.test("read-only settings action returns only the requested allowlisted rows", async () => {
  const query = readQuery([
    { key: "x_posting_config", value: { enabled: false } },
    { key: "private_future_setting", value: "must not cross" },
  ]);
  const result = await getSettingsAdminAction({ from: () => query } as never, {
    keys: ["x_posting_config", "private_future_setting"],
  });

  assertEquals(result.body, {
    success: true,
    rows: [{ key: "x_posting_config", value: { enabled: false } }],
  });
});

Deno.test("read-only settings samples return bounded post metadata", async () => {
  const query = readQuery([{
    tweet_id: "tweet-1",
    text_original: "source",
    text_translated: "translated",
    url: "https://x.com/source/status/1",
    tweeted_at: "2026-08-29T00:00:00.000Z",
    has_media: true,
    accounts: { handle: "source", display_name: "Source" },
    secret: "must not cross",
  }]);
  const result = await getSettingsSamplesAdminAction({ from: () => query } as never);

  assertEquals(result.body, {
    success: true,
    samples: [{
      tweet_id: "tweet-1",
      text_original: "source",
      text_translated: "translated",
      url: "https://x.com/source/status/1",
      tweeted_at: "2026-08-29T00:00:00.000Z",
      has_media: true,
      accounts: { handle: "source", display_name: "Source" },
    }],
  });
});

Deno.test("settings validator rejects invalid shapes without touching storage", () => {
  assertEquals(
    validateSettingsValue("message_template", null),
    'Value for "message_template" must be a JSON object',
  );
  assertEquals(
    validateSettingsValue("message_template", { template: 123 }),
    "message_template.template must be a string",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", { enabled: "yes" }),
    "x_posting_config.enabled must be a boolean",
  );
  assertEquals(
    validateSettingsValue("x_api_controls", { my_x_enabled: "true" }),
    "x_api_controls.my_x_enabled must be a boolean",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", {
      max_candidate_age_minutes: 0,
    }),
    "x_posting_config.max_candidate_age_minutes must be 1-1440",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", { max_posts_per_run: 21 }),
    "x_posting_config.max_posts_per_run must be 1-20",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", { max_posts_per_run: 1.5 }),
    "x_posting_config.max_posts_per_run must be 1-20",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", { daily_budget: 1.5 }),
    "x_posting_config.daily_budget must be a non-negative whole number",
  );
  assertEquals(
    validateSettingsValue("x_posting_config", { min_spacing_minutes: -1 }),
    "x_posting_config.min_spacing_minutes must be a non-negative whole number",
  );
  assertEquals(
    validateSettingsValue("x_rate_limits", { posts_per_hour: 1.5 }),
    "x_rate_limits.posts_per_hour must be a whole number 1-1000",
  );
  assertEquals(
    validateSettingsValue("x_rate_limits", { hydrations_per_day: 1.5 }),
    "x_rate_limits.hydrations_per_day must be a whole number 1-10000",
  );
});

Deno.test("settings validator accepts minimal known setting payloads", () => {
  assertEquals(
    validateSettingsValue("message_template", { template: "Post: {{text}}" }),
    null,
  );
  assertEquals(
    validateSettingsValue("x_posting_config", {
      enabled: true,
      min_score: 14,
      require_media: false,
      max_candidate_age_minutes: 30,
      max_posts_per_run: 1,
      daily_budget: 2,
      min_spacing_minutes: 5,
    }),
    null,
  );
  assertEquals(
    validateSettingsValue("x_rate_limits", {
      posts_per_hour: 20,
      posts_per_day: 100,
      monthly_post_budget: 2500,
      media_uploads_per_day: 200,
      hydrations_per_day: 400,
    }),
    null,
  );
  assertEquals(
    validateSettingsValue("enrichment_config", {
      enabled: true,
      pipeline_mode: "shadow_review",
    }),
    null,
  );
  assertEquals(
    validateSettingsValue("translation_prompt", {
      model: "gpt-5.4-mini",
      max_completion_tokens: 4_000,
      scoring: { max_completion_tokens: 4_000 },
    }),
    null,
  );
});

Deno.test("settings validator rejects runaway OpenAI output token caps", () => {
  assertEquals(
    validateSettingsValue("translation_prompt", {
      max_completion_tokens: 50_000,
    }),
    "translation_prompt.max_completion_tokens must be 1-8000",
  );
  assertEquals(
    validateSettingsValue("translation_prompt", {
      scoring: { max_completion_tokens: 50_000 },
    }),
    "scoring.max_completion_tokens must be 1-8000",
  );
});

Deno.test("x posting config restamps when saved changes expand eligibility", () => {
  assertEquals(
    shouldRestampXPostingStart({ enabled: false }, { enabled: true }),
    true,
  );
  assertEquals(
    shouldRestampXPostingStart({ enabled: true, min_score: 15 }, {
      enabled: true,
      min_score: 12,
    }),
    true,
  );
  assertEquals(
    shouldRestampXPostingStart({ enabled: true, require_media: true }, {
      enabled: true,
      require_media: false,
    }),
    true,
  );
  assertEquals(
    shouldRestampXPostingStart(
      { enabled: true, post_only_decision_deliver: true },
      { enabled: true, post_only_decision_deliver: false },
    ),
    true,
  );
  assertEquals(
    shouldRestampXPostingStart(
      { enabled: true, max_candidate_age_minutes: 30 },
      { enabled: true, max_candidate_age_minutes: 120 },
    ),
    true,
  );
});

Deno.test("x posting config does not restamp when user supplies an explicit new start point", () => {
  assertEquals(
    shouldRestampXPostingStart(
      { enabled: false, start_posting_from: "2026-01-01T00:00:00.000Z" },
      { enabled: true, start_posting_from: "2026-06-01T00:00:00.000Z" },
    ),
    false,
  );
  assertEquals(
    shouldRestampXPostingStart({ enabled: true, min_score: 12 }, {
      enabled: true,
      min_score: 14,
    }),
    false,
  );
});

const validStoryMemoryBase = {
  enabled: true,
  window_hours: 48,
  similarity_threshold: 0.86,
  action: "skip",
};

Deno.test("story_memory.bypass_authors validator rejects non-string and malformed entries", () => {
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      bypass_authors: "trusted",
    }),
    "story_memory.bypass_authors must be array",
  );
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      bypass_authors: new Array(101).fill("a"),
    }),
    "story_memory.bypass_authors must be ≤100",
  );
  for (
    const bad of [
      ["nested"],
      true,
      false,
      null,
      12345,
      undefined,
      {},
      [],
    ]
  ) {
    assertEquals(
      validateSettingsValue("story_memory", {
        ...validStoryMemoryBase,
        bypass_authors: [bad],
      }),
      "story_memory.bypass_authors entries must be strings",
    );
  }
  for (const bad of ["", "   ", "@", "@   "]) {
    assertEquals(
      validateSettingsValue("story_memory", {
        ...validStoryMemoryBase,
        bypass_authors: [bad],
      }),
      "story_memory.bypass_authors entries must be handles ≤15 chars",
    );
  }
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      bypass_authors: ["@abcdefghijklmnop"],
    }),
    "story_memory.bypass_authors entries must be handles ≤15 chars",
  );
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      bypass_authors: ["abcdefghijklmnop"],
    }),
    "story_memory.bypass_authors entries must be handles ≤15 chars",
  );
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      bypass_authors: ["valid", ["nested"]],
    }),
    "story_memory.bypass_authors entries must be strings",
  );
});

Deno.test("story_memory.bypass_authors validator accepts valid handles and a full payload", () => {
  for (const ok of ["@Trusted", "Trusted", "  @Trusted  ", "abc", "abcdefghijklmno"]) {
    assertEquals(
      validateSettingsValue("story_memory", {
        ...validStoryMemoryBase,
        bypass_authors: [ok],
      }),
      null,
    );
  }
  assertEquals(
    validateSettingsValue("story_memory", {
      ...validStoryMemoryBase,
      candidate_min_similarity: 0.78,
      auto_duplicate_similarity: 0.94,
      mode: "hybrid_ai",
      adjudicator_model: "gpt-5.4-mini",
      adjudicator_reasoning_effort: "medium",
      adjudicator_confidence_threshold: 0.8,
      bypass_authors: ["@Trusted", "source", "PressDesk"],
    }),
    null,
  );
});
