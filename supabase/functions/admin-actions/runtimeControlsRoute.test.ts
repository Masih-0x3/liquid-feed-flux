import { assertEquals } from "jsr:@std/assert";
import { isExactRuntimeControlsUpdateBody } from "./index.ts";

Deno.test("runtime controls update accepts only the exact narrow body", () => {
  assertEquals(isExactRuntimeControlsUpdateBody({
    action: "update_runtime_controls",
    dedupe_enabled: false,
    translation_enabled: true,
  }), true);
  assertEquals(isExactRuntimeControlsUpdateBody({
    action: "update_runtime_controls",
    dedupe_enabled: false,
    translation_enabled: true,
    posting_mode: "enabled",
  }), false);
  assertEquals(isExactRuntimeControlsUpdateBody({
    action: "update_runtime_controls",
    dedupe_enabled: "false",
    translation_enabled: true,
  }), false);
});
