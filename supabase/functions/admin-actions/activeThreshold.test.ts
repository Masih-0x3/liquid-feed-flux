import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  loadActiveThreshold,
  loadActiveThresholdEnvelope,
} from "./activeThreshold.ts";
import { resolveEffectiveThreshold } from "../_shared/effectiveThreshold.ts";

function settingsClient(rows: unknown[]) {
  const query = {
    select() {
      return query;
    },
    in() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    from() {
      return query;
    },
  };
}

Deno.test("active threshold reads the settings row contract", async () => {
  assertEquals(
    await loadActiveThreshold(settingsClient([
      { key: "content_filter", value: { default_threshold: 18 } },
      { key: "scoring_policy", value: { enabled: false } },
    ])),
    18,
  );
});

Deno.test("active threshold rejects a malformed settings row", async () => {
  await assertRejects(
    () => loadActiveThreshold(settingsClient([
      { key: "content_filter" },
    ])),
    Error,
    "active_threshold_settings_invalid_row",
  );
});

Deno.test("active policy envelope is identical for admin and worker resolution", async () => {
  const rows = [
    {
      key: "scoring_policy",
      value: {
        enabled: true,
        mode: "active",
        active_profile_id: "iran-first",
        profiles: [{ id: "iran-first", thresholds: { direct_focus: { threshold: 17 } } }],
      },
    },
    { key: "content_filter", value: { default_threshold: 11 } },
  ];
  const expected = resolveEffectiveThreshold(rows);
  assertEquals(await loadActiveThresholdEnvelope(settingsClient(rows)), expected);
  assertEquals(await loadActiveThreshold(settingsClient(rows)), expected.threshold);
});

Deno.test("legacy profile wins over content-filter threshold and marks compatibility", async () => {
  const envelope = await loadActiveThresholdEnvelope(settingsClient([
    { key: "content_filter", value: { default_threshold: 11 } },
    {
      key: "editorial_profiles",
      value: { profiles: [{ id: "legacy", threshold: 16 }] },
    },
    { key: "active_profile_id", value: { id: "legacy" } },
  ]));
  assertEquals(envelope, {
    threshold: 16,
    mode: "legacy",
    source: "editorial_profile",
    version: "legacy-threshold-v1",
    compatibility_fallback: true,
    policy_mode: null,
  });
});
