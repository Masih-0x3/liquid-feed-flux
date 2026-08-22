import { assertEquals } from "jsr:@std/assert";
import { evaluateFinalDedupeGuard } from "./deliveryDedupeGuard.ts";
import type { FinalDuplicateAssertionResult } from "./dedupe.ts";

Deno.test("evaluateFinalDedupeGuard fails closed when final dedupe assertion throws", async () => {
  const supabase = makeFakeSupabase();

  const decision = await evaluateFinalDedupeGuard({
    supabase,
    tweetId: "newer",
    storyMemory: { enabled: true, action: "skip" },
    assertDuplicateState: async () => {
      throw new Error("dedupe_post_update_failed:constraint violation");
    },
  });

  assertEquals(decision.action, "fail");
  assertEquals(decision.reason, "dedupe_assertion_failed");
  assertEquals(decision.meta.reason, "dedupe_assertion_failed");
});

Deno.test("evaluateFinalDedupeGuard fails closed on an unknown assertion outcome", async () => {
  const supabase = makeFakeSupabase();

  const decision = await evaluateFinalDedupeGuard({
    supabase,
    tweetId: "newer",
    storyMemory: { enabled: true, action: "skip" },
    assertDuplicateState: async () => ({
      checked: true,
      blocked: false,
      outcome: "unknown",
      reason: "final_assertion_embedding_failed:provider unavailable",
      result: null,
    }),
  });

  assertEquals(decision.action, "fail");
  assertEquals(decision.reason, "dedupe_assertion_failed");
  if (decision.action !== "fail") {
    throw new Error(`Expected a failed dedupe decision, got ${decision.action}`);
  }
  assertEquals(decision.error, "dedupe_assertion_unknown");
});

Deno.test("evaluateFinalDedupeGuard skips when final assertion blocks a duplicate", async () => {
  const supabase = makeFakeSupabase();

  const decision = await evaluateFinalDedupeGuard({
    supabase,
    tweetId: "newer",
    storyMemory: { enabled: true, action: "skip" },
    assertDuplicateState: async () => ({
      checked: true,
      blocked: true,
      outcome: "blocked",
      reason: "final_assertion_high_semantic_similarity:0.970",
      result: {
        dup_of_tweet_id: "older",
      } as FinalDuplicateAssertionResult["result"],
    }),
  });

  assertEquals(decision.action, "skip");
  assertEquals(decision.reason, "final_duplicate_assertion");
  assertEquals(decision.meta.dup_of, "older");
});

Deno.test("evaluateFinalDedupeGuard skips existing duplicate decisions", async () => {
  const supabase = makeFakeSupabase({
    dedupeRow: {
      dedupe_status: "duplicate",
      dedupe_reason: "same event",
      dup_of_tweet_id: "older",
      dup_similarity: 0.91,
      story_cluster_id: "11111111-1111-1111-1111-111111111111",
    },
  });

  const decision = await evaluateFinalDedupeGuard({
    supabase,
    tweetId: "newer",
    storyMemory: { enabled: true, action: "skip" },
    assertDuplicateState: async () => ({
      checked: true,
      blocked: false,
      outcome: "allowed",
      reason: "already_checked",
      result: null,
    }),
  });

  assertEquals(decision.action, "skip");
  assertEquals(decision.reason, "story_dup");
  assertEquals(decision.meta.reason, "duplicate_gate");
});

Deno.test("evaluateFinalDedupeGuard fails closed when persisted dedupe state cannot be read", async () => {
  const supabase = makeFakeSupabase({ selectError: "database unavailable" });

  const decision = await evaluateFinalDedupeGuard({
    supabase,
    tweetId: "newer",
    storyMemory: { enabled: true, action: "skip" },
    assertDuplicateState: async () => ({
      checked: true,
      blocked: false,
      outcome: "allowed",
      reason: "no_semantic_candidates",
      result: null,
    }),
  });

  assertEquals(decision.action, "fail");
  assertEquals(decision.reason, "dedupe_assertion_failed");
  if (decision.action !== "fail") {
    throw new Error(`Expected a failed dedupe decision, got ${decision.action}`);
  }
  assertEquals(decision.error, "dedupe_state_lookup_failed");
  assertEquals(decision.error?.includes("database unavailable"), false);
});

function makeFakeSupabase(options: {
  dedupeRow?: Record<string, unknown> | null;
  selectError?: string;
} = {}) {
  return {
    from(table: string) {
      return new FakeBuilder(table, options);
    },
  };
}

class FakeBuilder {
  private filters: Record<string, unknown> = {};

  constructor(
    private table: string,
    private options: {
      dedupeRow?: Record<string, unknown> | null;
      selectError?: string;
    },
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  single() {
    if (this.options.selectError) {
      return Promise.resolve({ data: null, error: { message: this.options.selectError } });
    }
    if (this.table === "posts" && this.filters.tweet_id) {
      return Promise.resolve({ data: this.options.dedupeRow ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
}
