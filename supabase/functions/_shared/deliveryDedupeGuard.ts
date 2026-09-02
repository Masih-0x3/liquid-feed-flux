import {
  assertFinalDuplicateState,
  type DuplicateGateConfig,
  type DuplicateGateRunOptions,
  type FinalDuplicateAssertionResult,
} from "./dedupe.ts";
import { duplicateDecisionPatch } from "./duplicateGuard.ts";

export type FinalDedupeGuardDecision =
  | {
    action: "allow";
    reason: null;
    meta: Record<string, unknown>;
  }
  | {
    action: "skip";
    reason: "final_duplicate_assertion" | "story_dup";
    meta: Record<string, unknown>;
  }
  | {
    action: "fail";
    reason: "dedupe_assertion_failed";
    error: string;
    meta: Record<string, unknown>;
  };

export interface FinalDedupeGuardParams {
  supabase: unknown;
  tweetId: string;
  storyMemory: unknown;
  source?: string;
  assertDuplicateState?: (
    supabase: unknown,
    tweetId: string,
    rawConfig: unknown,
    options?: DuplicateGateRunOptions,
  ) => Promise<FinalDuplicateAssertionResult>;
}

type DedupeLookupQuery = {
  select(columns: string): DedupeLookupQuery;
  eq(column: string, value: unknown): DedupeLookupQuery;
  single(): PromiseLike<{ data?: unknown; error?: unknown }>;
};

type DedupeLookupClient = {
  from(table: string): DedupeLookupQuery;
};

function checkedDedupeLookupClient(client: unknown): DedupeLookupClient | null {
  if (!client || typeof client !== "object") return null;
  const from = (client as { from?: unknown }).from;
  return typeof from === "function" ? client as DedupeLookupClient : null;
}

export async function evaluateFinalDedupeGuard(params: FinalDedupeGuardParams): Promise<FinalDedupeGuardDecision> {
  const source = params.source ?? "telegram_final_assertion";
  const storyMemory = normalizeStoryMemoryLike(params.storyMemory);
  if (!storyMemory.enabled || storyMemory.action !== "skip") {
    return { action: "allow", reason: null, meta: { source, reason: "dedupe_disabled" } };
  }

  const assertDuplicateState = params.assertDuplicateState ?? assertFinalDuplicateState;
  try {
    const lookupClient = checkedDedupeLookupClient(params.supabase);
    if (!lookupClient) return failDecision(source, "dedupe_state_lookup_failed");
    const finalAssertion = await assertDuplicateState(params.supabase, params.tweetId, params.storyMemory, { source });
    if (finalAssertion.outcome === "unknown") {
      return failDecision(source, "dedupe_assertion_unknown");
    }
    if (finalAssertion.blocked) {
      return {
        action: "skip",
        reason: "final_duplicate_assertion",
        meta: {
          skipped: "final_duplicate_assertion",
          reason: finalAssertion.reason,
          dup_of: finalAssertion.result?.dup_of_tweet_id ?? null,
          source,
        },
      };
    }

    const { data: dupRow, error } = await lookupClient
      .from("posts")
      .select("dedupe_status, dedupe_reason, dup_of_tweet_id, dup_similarity, story_cluster_id")
      .eq("tweet_id", params.tweetId)
      .single();
    if (error) {
      return failDecision(source, "dedupe_state_lookup_failed");
    }

    const duplicatePatch = duplicateDecisionPatch(dupRow as { dedupe_status?: string | null; dup_of_tweet_id?: string | null; dedupe_reason?: string | null } | null);
    if (duplicatePatch) {
      const row = dupRow as Record<string, unknown>;
      return {
        action: "skip",
        reason: "story_dup",
        meta: {
          skipped: "story_dup",
          reason: "duplicate_gate",
          decision_reason: duplicatePatch.decision_reason,
          dup_of: row.dup_of_tweet_id ?? null,
          similarity: row.dup_similarity ?? null,
          story_cluster_id: row.story_cluster_id ?? null,
          source,
        },
      };
    }

    return { action: "allow", reason: null, meta: { source, reason: finalAssertion.reason } };
  } catch (_e) {
    return failDecision(source, "dedupe_assertion_failed");
  }
}

function failDecision(source: string, error: string): FinalDedupeGuardDecision {
  return {
    action: "fail",
    reason: "dedupe_assertion_failed",
    error,
    meta: {
      skipped: "dedupe_assertion_failed",
      reason: "dedupe_assertion_failed",
      error,
      source,
    },
  };
}

function normalizeStoryMemoryLike(value: unknown): Pick<DuplicateGateConfig, "enabled" | "action"> {
  if (!value || typeof value !== "object") return { enabled: false, action: "skip" };
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    action: record.action === "mark_and_deliver" ? "mark_and_deliver" : "skip",
  };
}
