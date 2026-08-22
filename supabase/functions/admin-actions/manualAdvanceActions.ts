import {
  doesEnrichmentBlockX,
  type EnrichmentConfig,
  normalizeEnrichmentConfig,
} from "../_shared/enrich.ts";
import type { SupabaseAdminClient } from "./types.ts";
import {
  type QueueHydrationDeps,
  queueHydrationJob as defaultQueueHydrationJob,
} from "./xPostingActions.ts";
import { insertAdminPipelineEvent as defaultInsertAdminPipelineEvent } from "./sideEffects.ts";

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string): TableQueryBuilder;
  insert(value: Record<string, unknown>): PromiseLike<QueryResult>;
  upsert(
    value: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

type QueueHydrationJobFn = typeof defaultQueueHydrationJob;

export type QueueManualAdvanceDeps = QueueHydrationDeps & {
  queueHydrationJob?: QueueHydrationJobFn;
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

function nowIso(deps?: { now?: () => Date }): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

export async function queueManualAdvance(
  supabase: SupabaseAdminClient,
  tweetId: string,
  deps: Partial<QueueManualAdvanceDeps> = {},
): Promise<{ queued: string; reason?: string }> {
  const insertAdminPipelineEvent = deps.insertAdminPipelineEvent ??
    defaultInsertAdminPipelineEvent;
  const { data: post, error: postError } = await table(supabase, "posts")
    .select(
      "tweet_id, text_translated, translated_at, is_truncated, hydrated_at, enrich_status",
    )
    .eq("tweet_id", tweetId)
    .maybeSingle();
  if (postError) throw postError;
  const postRecord = asRecord(post);
  if (!post) return { queued: "none", reason: "post_not_found" };
  if (!postRecord.text_translated && !postRecord.translated_at) {
    return { queued: "none", reason: "translation_missing" };
  }
  if (postRecord.is_truncated === true && !postRecord.hydrated_at) {
    const result = await (deps.queueHydrationJob ?? defaultQueueHydrationJob)(
      supabase,
      tweetId,
      "manual_score",
      { insertAdminPipelineEvent },
    );
    return { queued: "hydrate", reason: result.reason };
  }

  const { data: enrichCfgRow, error: enrichCfgError } = await table(supabase, "settings")
    .select("value")
    .eq("key", "enrichment_config")
    .maybeSingle();
  if (enrichCfgError) throw enrichCfgError;
  if (enrichCfgRow !== null && (typeof enrichCfgRow !== "object" || Array.isArray(enrichCfgRow))) {
    throw new Error("manual_advance_enrichment_config_invalid_response");
  }
  const enrichCfg = normalizeEnrichmentConfig(
    (asRecord(enrichCfgRow).value ?? { enabled: false }) as Partial<
      EnrichmentConfig
    >,
  );
  if (
    doesEnrichmentBlockX(enrichCfg) &&
    postRecord.enrich_status !== "approved" &&
    postRecord.enrich_status !== "skipped"
  ) {
    const { error: enrichJobError } = await table(supabase, "jobs").upsert({
      type: "enrich",
      payload: { tweet_id: tweetId, source: "manual_score" },
      status: "pending",
      priority: 18,
      idempotency_key: `enrich:${tweetId}`,
      next_run_at: nowIso(deps),
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      last_error: null,
      attempts: 0,
    }, { onConflict: "idempotency_key", ignoreDuplicates: false });
    if (enrichJobError) throw enrichJobError;
    await insertAdminPipelineEvent(supabase, tweetId, "enrich", "queued", {
      source: "manual_score",
    });
    return { queued: "enrich" };
  }

  const { error: deliverJobError } = await table(supabase, "jobs").upsert({
    type: "deliver",
    payload: { tweet_id: tweetId, source: "manual_score" },
    status: "pending",
    priority: 20,
    idempotency_key: `deliver:${tweetId}`,
    next_run_at: nowIso(deps),
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error: null,
    attempts: 0,
  }, { onConflict: "idempotency_key", ignoreDuplicates: false });
  if (deliverJobError) throw deliverJobError;
  const { data: pendingDeliveries, error: pendingDeliveriesError } = await table(supabase, "deliveries")
    .select("id")
    .eq("subject_type", "post")
    .eq("subject_id", tweetId)
    .eq("status", "pending")
    .limit(1);
  if (pendingDeliveriesError) throw pendingDeliveriesError;
  if (!Array.isArray(pendingDeliveries)) throw new Error("manual_advance_pending_delivery_invalid_response");
  if (
    !pendingDeliveries ||
    (pendingDeliveries as { length?: number }).length === 0
  ) {
    const { error: deliveryInsertError } = await table(supabase, "deliveries").insert({
      subject_type: "post",
      subject_id: tweetId,
      status: "pending",
      attempts: 0,
    });
    if (deliveryInsertError) throw deliveryInsertError;
  }
  await insertAdminPipelineEvent(supabase, tweetId, "deliver", "queued", {
    source: "manual_score",
  });
  return { queued: "deliver" };
}
