import { assertEquals, assertRejects } from "jsr:@std/assert";
import { loadActiveThreshold } from "./activeThreshold.ts";

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
