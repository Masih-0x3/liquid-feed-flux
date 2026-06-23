import { assertEquals } from "jsr:@std/assert";
import {
  shouldRestampXPostingStart,
  validateSettingsValue,
} from "./settings.ts";

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
