import { assertEquals } from "jsr:@std/assert";
import { effectiveXCandidateCutoff } from "./xCandidateCutover.ts";

Deno.test("X fallback floor includes the immutable cutover and rejects invalid floors", () => {
  assertEquals(
    effectiveXCandidateCutoff([
      "2026-08-25T09:00:00.000Z",
      "2026-08-25T09:13:45.744Z",
      "not-a-date",
    ]),
    "2026-08-25T09:13:45.744Z",
  );
  assertEquals(effectiveXCandidateCutoff([null, undefined, "bad"]), null);
});
