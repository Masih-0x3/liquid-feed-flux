import {
  DEFAULT_DUPLICATE_GATE,
  type DuplicateGatePost,
  normalizeDuplicateGateConfig,
  runDuplicateGate,
} from "../_shared/dedupe.ts";
import {
  type CompatibilityUsageEvent,
  recordCompatibilityUsage,
} from "../_shared/compatibilityTelemetry.ts";
import type {
  AdminActionResponse,
  RecordFeedbackFn,
  SupabaseAdminClient,
} from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  update(value: Record<string, unknown>): TableQueryBuilder;
  upsert(
    value: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: Record<string, unknown>,
  ): PromiseLike<{ error?: unknown }>;
  eq(column: string, value: unknown): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  is(column: string, value: unknown): TableQueryBuilder;
  not(column: string, operator: string, value: unknown): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type DedupeActionDeps = {
  runDuplicateGate?: typeof runDuplicateGate;
  now?: () => Date;
  actorId?: string | null;
  recordCompatibilityUsage?: (
    supabase: SupabaseAdminClient,
    event: CompatibilityUsageEvent,
  ) => Promise<void>;
};

export type ClearDuplicateDeps = {
  recordFeedback: RecordFeedbackFn;
  now?: () => Date;
  warn?: (message: string, error?: unknown) => void;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

export async function loadDuplicateGateConfig(supabase: SupabaseAdminClient) {
  const { data } = await table(supabase, "settings").select("value").eq(
    "key",
    "story_memory",
  ).maybeSingle();
  const row = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  return normalizeDuplicateGateConfig(row?.value ?? DEFAULT_DUPLICATE_GATE);
}

export async function markDedupePending(
  supabase: SupabaseAdminClient,
  tweetId: string,
  reason: string,
) {
  await table(supabase, "posts")
    .update({
      dedupe_status: "pending",
      dedupe_method: null,
      dedupe_confidence: null,
      dedupe_reason: reason,
      dedupe_checked_at: null,
    })
    .eq("tweet_id", tweetId)
    .then(() => null, () => null);
}

export async function runDedupeAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: DedupeActionDeps = {},
) {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id.trim() : "";
  if (!tweetId) return { ok: false, error: "tweet_id is required" };

  const { data: post, error } = await table(supabase, "posts")
    .select(
      "tweet_id, text_original, text_translated, author_handle, url, created_at, delivery_decision, decision_reason, feedback_locked",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (error) return { ok: false, error: errorMessage(error) };
  if (!post || typeof post !== "object") {
    return { ok: false, error: "post not found" };
  }

  const config = await loadDuplicateGateConfig(supabase);
  const dryRun = body.dry_run === true;
  if (!dryRun) await markDedupePending(supabase, tweetId, "running:admin");

  const runGate = deps.runDuplicateGate ?? runDuplicateGate;
  const result = await runGate(
    supabase as never,
    post as DuplicateGatePost,
    config,
    {
      dryRun,
      force: body.force === true,
      source: "admin_actions.run_dedupe",
    },
  );

  if (
    !dryRun && body.enqueue_next === true && result.should_enqueue_translate
  ) {
    await table(supabase, "jobs").upsert({
      type: "translate",
      payload: { tweet_id: tweetId },
      status: "pending",
      priority: 10,
      idempotency_key: `translate:dedupe-admin:${tweetId}`,
      next_run_at: (deps.now?.() ?? new Date()).toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  }

  return {
    ok: result.ok,
    tweet_id: tweetId,
    config_enabled: config.enabled,
    result,
  };
}

export async function backfillDedupeAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: DedupeActionDeps = {},
) {
  const hours =
    typeof body.hours === "number" && body.hours > 0 && body.hours <= 168
      ? Math.floor(body.hours)
      : 48;
  const max = typeof body.max === "number" && body.max > 0
    ? Math.min(Math.floor(body.max), 2000)
    : 500;
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  let query = table(supabase, "posts")
    .select("tweet_id, dedupe_checked_at")
    .not("text_original", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(max);
  if (!force) query = query.is("dedupe_checked_at", null);

  const { data, error } = await query;
  if (error) return { ok: false, error: errorMessage(error) };
  const posts = Array.isArray(data)
    ? data as Array<Record<string, unknown>>
    : [];

  let queued = 0;
  const stamp = now.getTime();
  for (const post of posts) {
    const tweetId = post.tweet_id as string;
    if (dryRun) {
      queued += 1;
      continue;
    }
    const { error: jobError } = await table(supabase, "jobs").upsert({
      type: "dedupe",
      payload: { tweet_id: tweetId, force, source: "backfill" },
      status: "pending",
      priority: 30,
      idempotency_key: force
        ? `dedupe:backfill:${tweetId}:${stamp}`
        : `dedupe:backfill:${tweetId}`,
      next_run_at: (deps.now?.() ?? new Date()).toISOString(),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (!jobError) {
      await markDedupePending(supabase, tweetId, "queued:backfill");
      queued += 1;
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    force,
    hours,
    max,
    scanned: posts.length,
    queued,
  };
}

export async function auditDuplicateCandidatesAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
) {
  const windowHours =
    typeof body.window_hours === "number" && body.window_hours > 0 &&
      body.window_hours <= 168
      ? Math.floor(body.window_hours)
      : 48;
  const candidateMinSimilarity =
    typeof body.candidate_min_similarity === "number"
      ? Math.min(Math.max(body.candidate_min_similarity, 0.5), 0.99)
      : 0.78;
  const limit = typeof body.limit === "number" && body.limit > 0
    ? Math.min(Math.floor(body.limit), 5000)
    : 500;

  const { data, error } = await supabase.rpc("audit_duplicate_candidates", {
    window_hours: windowHours,
    candidate_min_similarity: candidateMinSimilarity,
    match_limit: limit,
  });
  if (error) return { ok: false, error: errorMessage(error) };

  const rows = Array.isArray(data)
    ? data as Array<Record<string, unknown>>
    : [];
  const proposed = rows.reduce<Record<string, number>>((acc, row) => {
    const key = typeof row.proposed_status === "string"
      ? row.proposed_status
      : "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    dry_run: true,
    window_hours: windowHours,
    candidate_min_similarity: candidateMinSimilarity,
    count: rows.length,
    proposed,
    rows,
  };
}

export async function clearDuplicateAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: ClearDuplicateDeps,
): Promise<AdminActionResponse> {
  const tweetId = typeof body.tweet_id === "string" ? body.tweet_id : "";
  const relatedTweetId = typeof body.related_tweet_id === "string"
    ? body.related_tweet_id
    : null;
  if (!tweetId) {
    return { body: { error: "tweet_id is required" }, status: 400 };
  }

  const { error: clearError } = await table(supabase, "posts").update({
    dup_of_tweet_id: null,
    dup_similarity: null,
    dedupe_status: "unique",
    dedupe_method: "none",
    dedupe_confidence: null,
    dedupe_reason: "cleared_by_admin",
    dedupe_new_facts: [],
    dedupe_checked_at: (deps.now?.() ?? new Date()).toISOString(),
    delivery_decision: "deliver",
    decision_reason: "dup_cleared_by_admin",
    feedback_locked: true,
  }).eq("tweet_id", tweetId);
  if (clearError) throw clearError;

  if (relatedTweetId) {
    const pairA = tweetId < relatedTweetId ? tweetId : relatedTweetId;
    const pairB = tweetId < relatedTweetId ? relatedTweetId : tweetId;
    await table(supabase, "story_pair_blocklist").upsert(
      { tweet_a: pairA, tweet_b: pairB, reason: "not_duplicate_admin" },
      { onConflict: "tweet_a,tweet_b" },
    ).then(
      () => null,
      (error: unknown) =>
        (deps.warn ?? console.warn)(
          "blocklist upsert failed",
          error instanceof Error ? error.message : error,
        ),
    );
  }

  await deps.recordFeedback(
    supabase,
    tweetId,
    "not_duplicate",
    -2,
    {},
    relatedTweetId,
  ).catch(() => {});
  return {
    body: {
      success: true,
      message: "Duplicate cleared and pair blocklisted",
    },
  };
}

export async function backfillSignaturesAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: DedupeActionDeps = {},
) {
  await (deps.recordCompatibilityUsage ?? recordCompatibilityUsage)(supabase, {
    source: "admin-actions",
    feature: "admin_action_alias",
    legacyValue: "backfill_signatures",
    canonicalValue: "backfill_dedupe",
    action: "backfill_signatures",
    actorId: deps.actorId,
  });
  const result = await backfillDedupeAdminAction(supabase, body, deps);
  return { ...result, alias: "backfill_dedupe" };
}
