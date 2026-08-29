import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_EFFECTIVE_THRESHOLD,
  LEGACY_THRESHOLD_VERSION,
  resolveEffectiveThreshold,
} from "./effectiveThreshold.ts";

Deno.test("effective threshold falls back to the documented shared default", () => {
  assertEquals(resolveEffectiveThreshold([]), {
    threshold: DEFAULT_EFFECTIVE_THRESHOLD,
    mode: "legacy",
    source: "default",
    version: LEGACY_THRESHOLD_VERSION,
    compatibility_fallback: true,
    policy_mode: null,
  });
  // The shared default is 14, matching the content_filter seed migration and
  // the historical admin/monitoring fallback.
  assertEquals(DEFAULT_EFFECTIVE_THRESHOLD, 14);
});

Deno.test("effective threshold uses content_filter default_threshold when authoritative", () => {
  assertEquals(
    resolveEffectiveThreshold([
      { key: "content_filter", value: { default_threshold: 11 } },
    ]),
    {
      threshold: 11,
      mode: "legacy",
      source: "content_filter",
      version: LEGACY_THRESHOLD_VERSION,
      compatibility_fallback: true,
      policy_mode: null,
    },
  );
});

Deno.test("effective threshold prefers active editorial profile over content_filter", () => {
  assertEquals(
    resolveEffectiveThreshold([
      { key: "content_filter", value: { default_threshold: 11 } },
      {
        key: "editorial_profiles",
        value: { profiles: [{ id: "legacy", threshold: 16 }] },
      },
      { key: "active_profile_id", value: { id: "legacy" } },
    ]),
    {
      threshold: 16,
      mode: "legacy",
      source: "editorial_profile",
      version: LEGACY_THRESHOLD_VERSION,
      compatibility_fallback: true,
      policy_mode: null,
    },
  );
});

Deno.test("active scoring policy direct_focus threshold is authoritative only in active mode", () => {
  const activeRows = [
    {
      key: "scoring_policy",
      value: {
        enabled: true,
        mode: "active",
        active_profile_id: "iran-first",
        profiles: [{
          id: "iran-first",
          thresholds: { direct_focus: { threshold: 17 } },
        }],
      },
    },
    { key: "content_filter", value: { default_threshold: 11 } },
  ];
  assertEquals(resolveEffectiveThreshold(activeRows), {
    threshold: 17,
    mode: "active",
    source: "scoring_policy",
    version: "audience-fit-v2",
    compatibility_fallback: false,
    policy_mode: "active",
  });

  const shadowRows = [
    {
      key: "scoring_policy",
      value: {
        enabled: true,
        mode: "shadow",
        active_profile_id: "iran-first",
        profiles: [{
          id: "iran-first",
          thresholds: { direct_focus: { threshold: 17 } },
        }],
      },
    },
    { key: "content_filter", value: { default_threshold: 11 } },
  ];
  assertEquals(resolveEffectiveThreshold(shadowRows), {
    threshold: 11,
    mode: "legacy",
    source: "content_filter",
    version: LEGACY_THRESHOLD_VERSION,
    compatibility_fallback: true,
    policy_mode: "shadow",
  });

  const disabledRows = [
    {
      key: "scoring_policy",
      value: {
        enabled: false,
        mode: "active",
        active_profile_id: "iran-first",
        profiles: [{
          id: "iran-first",
          thresholds: { direct_focus: { threshold: 17 } },
        }],
      },
    },
    { key: "content_filter", value: { default_threshold: 11 } },
  ];
  assertEquals(resolveEffectiveThreshold(disabledRows), {
    threshold: 11,
    mode: "legacy",
    source: "content_filter",
    version: LEGACY_THRESHOLD_VERSION,
    compatibility_fallback: true,
    policy_mode: "active",
  });
});

Deno.test("effective threshold ignores unknown settings rows and rejects malformed rows", () => {
  assertEquals(
    resolveEffectiveThreshold([
      { key: "content_filter", value: { default_threshold: 13 } },
      { key: "translation_prompt", value: { model: "gpt-main" } },
    ]).threshold,
    13,
  );
  assertEquals(
    (() => {
      try {
        resolveEffectiveThreshold([{ key: "content_filter" }]);
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    })(),
    "effective_threshold_settings_invalid_row",
  );
});

Deno.test("effective threshold rejects non-array and malformed row input", () => {
  assertEquals(
    (() => {
      try {
        resolveEffectiveThreshold({});
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    })(),
    "effective_threshold_settings_invalid_response",
  );
  assertEquals(
    (() => {
      try {
        resolveEffectiveThreshold([{ value: { default_threshold: 13 } }]);
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    })(),
    "effective_threshold_settings_invalid_row",
  );
});
