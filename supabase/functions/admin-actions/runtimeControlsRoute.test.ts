import { assertEquals } from "jsr:@std/assert";
import {
  isExactRuntimeControlFieldUpdateBody,
  isExactRuntimeControlsUpdateBody,
} from "./index.ts";

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

Deno.test("runtime controls field update accepts one named boolean without a stale full-row snapshot", () => {
  assertEquals(isExactRuntimeControlFieldUpdateBody({
    action: "update_runtime_controls",
    control: "dedupe_enabled",
    enabled: true,
  }), true);
  assertEquals(isExactRuntimeControlFieldUpdateBody({
    action: "update_runtime_controls",
    control: "translation_enabled",
    enabled: false,
    dedupe_enabled: true,
  }), false);
  assertEquals(isExactRuntimeControlFieldUpdateBody({
    action: "update_runtime_controls",
    control: "posting_mode",
    enabled: true,
  }), false);
});
