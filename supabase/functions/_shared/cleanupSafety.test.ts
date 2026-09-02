import { assertEquals } from "jsr:@std/assert";
import {
  cleanupDisabledResponse,
  DB_CLEANUP_MUTATIONS_ENABLED_ENV,
  isCleanupMutationEnabled,
  MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
  resolveCleanupExecutionMode,
} from "./cleanupSafety.ts";

Deno.test("cleanup mutation flags fail closed unless exactly enabled", () => {
  assertEquals(isCleanupMutationEnabled(undefined), false);
  assertEquals(isCleanupMutationEnabled(""), false);
  assertEquals(isCleanupMutationEnabled("false"), false);
  assertEquals(isCleanupMutationEnabled("TRUE"), false);
  assertEquals(isCleanupMutationEnabled("1"), false);
  assertEquals(isCleanupMutationEnabled("true"), true);
});

Deno.test("cleanup execution mode keeps dry-run available while mutations are blocked", () => {
  assertEquals(resolveCleanupExecutionMode(true, undefined), "dry_run");
  assertEquals(resolveCleanupExecutionMode(false, undefined), "blocked");
  assertEquals(resolveCleanupExecutionMode(false, "false"), "blocked");
  assertEquals(resolveCleanupExecutionMode(false, "true"), "mutation");
});

Deno.test("cleanup disabled response is explicit and non-success", async () => {
  const response = cleanupDisabledResponse(
    "media-cleanup",
    MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
    { "Access-Control-Allow-Origin": "https://xot.example" },
  );

  assertEquals(response.status, 423);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://xot.example",
  );
  assertEquals(await response.json(), {
    success: false,
    error: "cleanup_disabled_for_safety",
    function: "media-cleanup",
    required_flag: MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV,
    dry_run_available: true,
  });
  assertEquals(
    DB_CLEANUP_MUTATIONS_ENABLED_ENV,
    "DB_CLEANUP_MUTATIONS_ENABLED",
  );
});
