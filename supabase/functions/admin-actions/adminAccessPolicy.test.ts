import { assert, assertEquals, assertFalse } from "jsr:@std/assert";
import {
  ADMIN_ACTION_NAMES,
  isAdminActionName,
  isReadOnlyAdminActionName,
  READ_ONLY_ADMIN_ACTION_NAMES,
} from "../_shared/adminActionNames.ts";

Deno.test("normal dashboard reads are an explicit subset of admin actions", () => {
  assert(READ_ONLY_ADMIN_ACTION_NAMES.length > 0);
  for (const action of READ_ONLY_ADMIN_ACTION_NAMES) {
    assertEquals(isAdminActionName(action), true);
    assertEquals(isReadOnlyAdminActionName(action), true);
  }
  assertFalse(isReadOnlyAdminActionName("save_settings"));
  assertFalse(isReadOnlyAdminActionName("dry_run_x_post"));
  assertFalse(isReadOnlyAdminActionName("x_verify_credentials"));
  assertFalse(isReadOnlyAdminActionName("send_test_tweet"));
  assertFalse(isReadOnlyAdminActionName("update_runtime_controls"));
});

Deno.test("unknown and legacy action names are denied", () => {
  assertEquals(isAdminActionName("viewer"), false);
  assertEquals(isAdminActionName("operator"), false);
  assertEquals(isAdminActionName("unknown_action"), false);
  assertEquals(isReadOnlyAdminActionName("viewer"), false);
});

Deno.test("runtime control actions are registered", () => {
  assert(ADMIN_ACTION_NAMES.includes("get_runtime_controls"));
  assert(ADMIN_ACTION_NAMES.includes("update_runtime_controls"));
});
