import {
  isMyXEnabled,
  MY_X_DISABLED_RESPONSE,
} from "../_shared/myXControls.ts";
import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

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
  ): PromiseLike<QueryResult>;
  eq(column: string, value: unknown): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  lt(column: string, value: unknown): TableQueryBuilder;
  in(column: string, values: unknown[]): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

type FunctionInvokerClient = SupabaseAdminClient & {
  functions: {
    invoke(
      name: string,
      options?: Record<string, unknown>,
    ): PromiseLike<QueryResult>;
  };
};

type MaintenanceDeps = {
  readEnv?: (key: string) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function readEnv(key: string, deps?: Pick<MaintenanceDeps, "readEnv">): string {
  return deps?.readEnv?.(key) ?? Deno.env.get(key) ?? "";
}

function nowIso(deps?: Pick<MaintenanceDeps, "now">): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function nowMs(deps?: Pick<MaintenanceDeps, "now">): number {
  return (deps?.now?.() ?? new Date()).getTime();
}

export async function dryRunOldMediaCleanupAdminAction(
  supabase: FunctionInvokerClient,
  body: Record<string, unknown>,
  deps: Pick<MaintenanceDeps, "readEnv"> = {},
): Promise<AdminActionResponse> {
  const daysOld = typeof body.days_old === "number"
    ? Math.max(1, Math.min(365, Math.floor(body.days_old)))
    : 1;
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", deps);
  const { data, error } = await supabase.functions.invoke("media-processor", {
    body: { action: "cleanup_old_media", days_old: daysOld, dry_run: true },
    headers: { Authorization: `Bearer ${serviceKey}` },
  } as Record<string, unknown>);
  if (error) throw error;
  return { body: { success: true, dry_run: true, result: data } };
}

export async function summarizeStaleXPendingAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<MaintenanceDeps, "now"> = {},
): Promise<AdminActionResponse> {
  const olderThanHours = Math.min(
    Math.max(Number(body.older_than_hours) || 24, 1),
    720,
  );
  const close = body.close === true;
  if (close) {
    return {
      body: {
        ok: false,
        code: "delivery_cutover_blocked",
        error: "Historical X delivery cleanup is disabled during the immutable cutover",
      },
      status: 409,
    };
  }
  const cutoff = new Date(
    nowMs(deps) - olderThanHours * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await table(supabase, "x_deliveries")
    .select("id, post_id, created_at, skip_reason, last_error")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  const rows = Array.isArray(data)
    ? data as Array<Record<string, unknown>>
    : [];
  const ids = rows.map((row) => row.id);
  if (close && ids.length > 0) {
    const { error: updErr } = await table(supabase, "x_deliveries")
      .update({
        status: "skipped",
        skip_reason: "stale_pending_closed_by_admin",
        last_error:
          "Closed by admin maintenance action without retrying or posting",
      })
      .in("id", ids);
    if (updErr) throw updErr;
  }
  return {
    body: {
      success: true,
      closed: close ? ids.length : 0,
      matched: ids.length,
      rows,
      older_than_hours: olderThanHours,
    },
  };
}

export async function rescoreRecentAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<MaintenanceDeps, "now"> = {},
): Promise<AdminActionResponse> {
  const hours = typeof body.hours === "number" && body.hours > 0 &&
      body.hours <= 168
    ? body.hours
    : 48;
  const onlyMissing = body.only_missing !== false;
  const since = new Date(nowMs(deps) - hours * 60 * 60 * 1000).toISOString();
  const { data: posts, error: fetchErr } = await table(supabase, "posts")
    .select("tweet_id, score_axes")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (fetchErr) {
    return {
      body: {
        ok: false,
        error: (fetchErr as { message?: string }).message,
      },
      status: 500,
    };
  }
  const rows = Array.isArray(posts)
    ? posts as Array<Record<string, unknown>>
    : [];
  const targets = rows.filter((post) =>
    !onlyMissing || post.score_axes == null
  );
  let queued = 0;
  const stamp = nowMs(deps);
  for (const post of targets) {
    const tweetId = post.tweet_id as string;
    const { error } = await table(supabase, "jobs").upsert({
      type: "translate",
      payload: { tweet_id: tweetId, force_rescore: true },
      status: "pending",
      priority: 9,
      idempotency_key: `translate:rescore:${tweetId}:${stamp}`,
      next_run_at: nowIso(deps),
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (!error) queued++;
  }
  return {
    body: {
      ok: true,
      scanned: rows.length,
      matched: targets.length,
      queued,
      hours,
    },
  };
}

export async function getPostPipelineStatusAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<AdminActionResponse> {
  const tweetIds = Array.isArray(body.tweet_ids)
    ? body.tweet_ids
      .filter((id: unknown): id is string =>
        typeof id === "string" && id.trim().length > 0
      )
      .map((id: string) => id.trim())
      .slice(0, 100)
    : [];
  if (tweetIds.length === 0) {
    return { body: { error: "tweet_ids array is required" }, status: 400 };
  }
  const { data, error } = await supabase.rpc("get_post_pipeline_status", {
    tweet_ids: tweetIds,
  });
  if (error) throw error;
  return { body: { success: true, statuses: data ?? [] } };
}

export async function runFollowersSnapshotAdminAction(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: Pick<MaintenanceDeps, "readEnv" | "fetchImpl"> = {},
): Promise<AdminActionResponse> {
  const { data: controlsRow } = await table(supabase, "settings")
    .select("value")
    .eq("key", "x_api_controls")
    .maybeSingle();
  const controls = ((controlsRow as Record<string, unknown> | null)?.value ??
    {}) as Record<string, unknown>;
  if (!isMyXEnabled(controls)) {
    return { body: MY_X_DISABLED_RESPONSE };
  }

  const supabaseUrl = readEnv("SUPABASE_URL", deps);
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", deps);
  const force = body.force === true;
  const dryRun = body.dry_run === true;
  const includeFollowing = body.include_following !== false;
  try {
    const resp = await (deps.fetchImpl ?? fetch)(
      `${supabaseUrl}/functions/v1/x-followers-snapshot`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trigger: "manual",
          force,
          dry_run: dryRun,
          include_following: includeFollowing,
        }),
      },
    );
    const text = await resp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (!resp.ok) {
      return {
        body: {
          ok: false,
          error: `snapshot ${resp.status}: ${text.slice(0, 300)}`,
          raw: parsed,
        },
      };
    }
    return { body: { ok: true, ...(parsed as Record<string, unknown>) } };
  } catch (e) {
    return { body: { ok: false, error: (e as Error).message } };
  }
}

export async function resetLearnedBiasesAdminAction(
  supabase: SupabaseAdminClient,
  deps: Pick<MaintenanceDeps, "now"> = {},
): Promise<AdminActionResponse> {
  await table(supabase, "settings").upsert({
    key: "learned_biases",
    value: { author_bias: {}, tag_bias: {}, keyword_bias: {} },
    updated_at: nowIso(deps),
  }, { onConflict: "key" });
  return { body: { success: true, message: "Learned biases reset" } };
}
