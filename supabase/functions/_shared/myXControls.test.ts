import { assertEquals } from "jsr:@std/assert";
import { isMyXEnabled, MY_X_DISABLED_RESPONSE } from "./myXControls.ts";

Deno.test("isMyXEnabled only enables My X when explicitly true", () => {
  assertEquals(isMyXEnabled(undefined), false);
  assertEquals(isMyXEnabled(null), false);
  assertEquals(isMyXEnabled({}), false);
  assertEquals(isMyXEnabled({ my_x_enabled: false }), false);
  assertEquals(isMyXEnabled({ my_x_enabled: "true" }), false);
  assertEquals(isMyXEnabled({ my_x_enabled: true }), true);
});

Deno.test("disabled response payload is stable", () => {
  assertEquals(MY_X_DISABLED_RESPONSE, {
    ok: true,
    disabled: true,
    reason: "my_x_disabled",
  });
});
