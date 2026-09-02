import type { SupabaseAdminClient } from "./types.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  insert(value: Record<string, unknown>): PromiseLike<QueryResult>;
  select(columns: string): TableQueryBuilder;
  upsert(
    value: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

type SideEffectDeps = {
  now?: () => Date;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nowIso(deps?: SideEffectDeps): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function feedbackResidual(
  polarity: number,
  meta?: Record<string, unknown>,
): number {
  const oldScore = finiteNumber(meta?.old_score);
  const targetScore = finiteNumber(meta?.manual_score) ??
    finiteNumber(meta?.new_score);
  const residual = oldScore !== null && targetScore !== null
    ? targetScore - oldScore
    : polarity;
  return Math.max(-2, Math.min(2, residual));
}

export async function recordFeedback(
  supabase: SupabaseAdminClient,
  tweetId: string,
  feedbackAction: string,
  polarity: number,
  meta?: Record<string, unknown>,
  relatedTweetId?: string | null,
  deps: SideEffectDeps = {},
) {
  const { error: feedbackInsertError } = await table(supabase, "feedback_events").insert({
    tweet_id: tweetId,
    related_tweet_id: relatedTweetId ?? null,
    action: feedbackAction,
    polarity,
    meta: meta ?? {},
    source: "admin_action",
  });
  if (feedbackInsertError) throw feedbackInsertError;

  if (
    polarity === 0 ||
    ["not_duplicate", "confirm_duplicate"].includes(feedbackAction)
  ) {
    return;
  }

  const { data: post, error: postError } = await table(supabase, "posts")
    .select("author_handle, importance_tags")
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (postError) throw postError;
  const postRecord = asRecord(post);
  if (!post) return;

  const { data: biasRow, error: biasReadError } = await table(supabase, "settings")
    .select("value")
    .eq("key", "learned_biases")
    .maybeSingle();
  if (biasReadError) throw biasReadError;
  if (biasRow !== null && (typeof biasRow !== "object" || Array.isArray(biasRow))) {
    throw new Error("learned_biases_invalid_response");
  }
  const biases = (asRecord(biasRow).value ?? {
    author_bias: {},
    tag_bias: {},
    keyword_bias: {},
  }) as {
    author_bias: Record<string, number>;
    tag_bias: Record<string, number>;
    keyword_bias: Record<string, number>;
  };

  const residual = feedbackResidual(polarity, meta);
  const perEventClamp = 0.5;
  const perKeyCap = 3;
  const clampDelta = (delta: number) =>
    Math.max(-perEventClamp, Math.min(perEventClamp, delta));
  const clampTotal = (total: number) =>
    Math.max(-perKeyCap, Math.min(perKeyCap, total));

  if (postRecord.author_handle) {
    const handle = String(postRecord.author_handle).toLowerCase();
    biases.author_bias[handle] = clampTotal(
      (biases.author_bias[handle] || 0) + clampDelta(residual * 0.25),
    );
  }

  const tags = Array.isArray(postRecord.importance_tags)
    ? postRecord.importance_tags as string[]
    : [];
  if (tags.length > 0) {
    const perTag = residual * 0.1 / tags.length;
    for (const tag of tags) {
      const normalizedTag = String(tag).toLowerCase();
      biases.tag_bias[normalizedTag] = clampTotal(
        (biases.tag_bias[normalizedTag] || 0) + clampDelta(perTag),
      );
    }
  }

  const { error: biasWriteError } = await table(supabase, "settings").upsert({
    key: "learned_biases",
    value: biases,
    updated_at: nowIso(deps),
  }, { onConflict: "key" });
  if (biasWriteError) throw biasWriteError;
}

export async function insertAdminPipelineEvent(
  supabase: SupabaseAdminClient,
  tweetId: string,
  step: string,
  status: string,
  meta?: Record<string, unknown>,
  error?: string | null,
  deps: SideEffectDeps = {},
) {
  try {
    const { error: pipelineEventError } = await table(supabase, "pipeline_events").insert({
      subject_type: "post",
      subject_id: tweetId,
      step,
      status,
      started_at: nowIso(deps),
      ended_at: status === "completed" || status === "failed" ||
          status === "skipped"
        ? nowIso(deps)
        : null,
      error: error ?? null,
      meta: { source: "admin-actions", ...(meta ?? {}) },
    });
    if (pipelineEventError) {
      console.warn(JSON.stringify({
        function: "admin-actions",
        action: "pipeline_event_insert_failed",
        error: "admin_pipeline_event_insert_failed",
      }));
    }
  } catch (_error) {
    console.warn(JSON.stringify({
      function: "admin-actions",
      action: "pipeline_event_insert_failed",
      error: "admin_pipeline_event_insert_failed",
    }));
  }
}
