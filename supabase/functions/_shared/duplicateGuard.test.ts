import { assertEquals } from "jsr:@std/assert";
import { duplicateBlockTarget, duplicateDecisionPatch, duplicateXSkipReason } from "./duplicateGuard.ts";

Deno.test("duplicate guard blocks explicit duplicate targets", () => {
  const post = {
    dedupe_status: "duplicate",
    dup_of_tweet_id: "canonical",
    dedupe_reason: "same event",
  };

  assertEquals(duplicateBlockTarget(post), "canonical");
  assertEquals(duplicateXSkipReason(post), "duplicate_gate:canonical");
  assertEquals(duplicateDecisionPatch(post), {
    delivery_decision: "skip",
    decision_reason: "duplicate_gate:canonical",
  });
});

Deno.test("duplicate guard treats duplicate status without target as blocked", () => {
  assertEquals(duplicateBlockTarget({ dedupe_status: "duplicate", dup_of_tweet_id: null }), "duplicate");
  assertEquals(duplicateXSkipReason({ dedupe_status: "duplicate" }), "duplicate_gate:duplicate");
});

Deno.test("duplicate guard ignores cleared or unique rows", () => {
  assertEquals(duplicateBlockTarget({ dedupe_status: "unique", dup_of_tweet_id: null }), null);
  assertEquals(duplicateDecisionPatch({ dedupe_status: "uncertain", dup_of_tweet_id: null }), null);
  assertEquals(duplicateXSkipReason(null), null);
});

Deno.test("duplicate guard does not block coverage gaps or review states with a matched target", () => {
  for (const status of ["coverage_gap", "uncertain", "related_new_info"]) {
    const post = { dedupe_status: status, dup_of_tweet_id: "canonical" };
    assertEquals(duplicateBlockTarget(post), null);
    assertEquals(duplicateDecisionPatch(post), null);
    assertEquals(duplicateXSkipReason(post), null);
  }
});
