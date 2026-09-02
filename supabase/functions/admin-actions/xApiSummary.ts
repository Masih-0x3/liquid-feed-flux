import type { SupabaseAdminClient } from "./types.ts";
import type { AppRole } from "../_shared/appRole.ts";

type QueryResult = { data?: unknown; count?: number | null; error?: unknown };

type TableQueryBuilder = PromiseLike<QueryResult> & {
  select(columns: string, options?: Record<string, unknown>): TableQueryBuilder;
  eq(column: string, value: unknown): TableQueryBuilder;
  gt(column: string, value: unknown): TableQueryBuilder;
  gte(column: string, value: unknown): TableQueryBuilder;
  order(column: string, options?: Record<string, unknown>): TableQueryBuilder;
  limit(value: number): TableQueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type RecordAdminXApiAttemptFn = (
  supabase: SupabaseAdminClient,
  input: {
    action: string;
    endpoint: string;
    method?: string;
    tweetId?: string | null;
    userId?: string | null;
    error?: string | null;
    requestCounted?: boolean;
    estimatedBillableUnit?: string | null;
  },
  response?: Response | null,
) => Promise<void>;

export type RecordXApiEventFn = (
  supabase: SupabaseAdminClient,
  input: {
    source: string;
    sourceAction: string;
    endpoint: string;
    method?: string;
    tweetId?: string | null;
    userId?: string | null;
    status?: number | null;
    ok?: boolean;
    error?: string | null;
    estimatedBillableUnit?: string | null;
    requestCounted?: boolean;
    metadata?: Record<string, unknown>;
  },
  response?: Response | null,
) => Promise<void>;

export type XApiSummaryDependencies = {
  recordAdminXApiAttempt: RecordAdminXApiAttemptFn;
  recordXApiEvent: RecordXApiEventFn;
  readEnv?: (key: string) => string | undefined;
  fetchUsage?: typeof fetch;
  role?: AppRole;
};

function table(supabase: SupabaseAdminClient, name: string): TableQueryBuilder {
  return supabase.from(name) as TableQueryBuilder;
}

function readNumber(value: unknown, fallback: number | null = null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function getXApiSummary(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>,
  deps: XApiSummaryDependencies,
) {
  if (body.sync_official_usage === true && deps.role === "read_only") {
    return {
      success: false,
      error: "admin_role_required",
      code: "admin_role_required",
      status: 403,
    };
  }
  const windowHours = Math.min(Math.max(Number(body.window_hours) || 24, 1), 720);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: events, error } = await table(supabase, "x_api_events")
    .select("created_at, source, source_action, endpoint, method, http_status, ok, estimated_billable_unit, request_counted, error")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;

  const eventRows = (events ?? []) as Array<Record<string, unknown>>;
  const latestEvent = eventRows[0] ?? null;
  const latestErrorEvent = eventRows.find((event) =>
    typeof event.error === "string" && event.error.trim().length > 0
  );
  const latestEventAt = typeof latestEvent?.created_at === "string" ? latestEvent.created_at : null;
  const latestError = typeof latestErrorEvent?.error === "string" ? latestErrorEvent.error : null;
  const byUnit: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let attempts = 0;
  let counted = 0;
  let failed = 0;
  for (const event of eventRows) {
    attempts += 1;
    if (event.request_counted !== false) counted += 1;
    if (!event.ok) failed += 1;
    const unit = String(event.estimated_billable_unit ?? "api_request");
    const source = String(event.source ?? "unknown");
    byUnit[unit] = (byUnit[unit] ?? 0) + 1;
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  const [{ count: postedLastHour }, { count: postedCount }, { count: mediaCount }, { data: limitsRow }] = await Promise.all([
    table(supabase, "x_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted")
      .gte("created_at", oneHourAgo),
    table(supabase, "x_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted")
      .gte("created_at", since),
    table(supabase, "x_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted")
      .gt("media_count", 0)
      .gte("created_at", since),
    table(supabase, "settings").select("value").eq("key", "x_rate_limits").maybeSingle(),
  ]);

  let officialUsage: Record<string, unknown> = { synced: false, reason: "not_requested" };
  if (body.sync_official_usage === true) {
    const readEnv = deps.readEnv ?? ((key: string) => Deno.env.get(key) ?? undefined);
    const bearer = readEnv("X_BEARER_TOKEN") || readEnv("TWITTER_BEARER_TOKEN") || "";
    if (!bearer) {
      officialUsage = { synced: false, reason: "bearer_token_missing" };
      await deps.recordXApiEvent(supabase, {
        source: "admin-actions",
        sourceAction: "usage_sync",
        endpoint: "/2/usage/tweets",
        method: "GET",
        requestCounted: false,
        ok: false,
        error: "bearer_token_missing",
        estimatedBillableUnit: "official_usage_lookup",
      });
    } else {
      const endpoint = "https://api.x.com/2/usage/tweets";
      try {
        const resp = await (deps.fetchUsage ?? fetch)(endpoint, { headers: { Authorization: `Bearer ${bearer}` } });
        const text = await resp.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        await deps.recordAdminXApiAttempt(supabase, {
          action: "usage_sync",
          endpoint,
          method: "GET",
          estimatedBillableUnit: "official_usage_lookup",
        }, resp);
        const status = Number.isInteger(resp.status) && resp.status >= 100 && resp.status <= 599
          ? resp.status
          : 0;
        officialUsage = resp.ok
          ? { synced: true, data: parsed }
          : { synced: false, reason: `official_usage_http_${status}` };
      } catch (e) {
        const errorCode = "official_usage_request_failed";
        await deps.recordAdminXApiAttempt(supabase, {
          action: "usage_sync",
          endpoint,
          method: "GET",
          estimatedBillableUnit: "official_usage_lookup",
          error: errorCode,
        }, null);
        officialUsage = { synced: false, reason: errorCode };
      }
    }
  }

  const limits = ((limitsRow as { value?: unknown } | null | undefined)?.value ?? {}) as Record<string, unknown>;
  return {
    success: true,
    summary: {
      window_hours: windowHours,
      attempts,
      counted_attempts: counted,
      failed_attempts: failed,
      success_rate: attempts > 0 ? Math.round(((attempts - failed) / attempts) * 1000) / 10 : 100,
      by_unit: byUnit,
      by_source: bySource,
      posts_last_hour: readNumber(postedLastHour, 0),
      posts_local: readNumber(postedCount, 0),
      media_posts_local: readNumber(mediaCount, 0),
      latest_event_at: latestEventAt,
      latest_error: latestError,
      configured_budget: {
        posts_per_hour: limits.posts_per_hour ?? null,
        posts_per_day: limits.posts_per_day ?? null,
        monthly_post_budget: limits.monthly_post_budget ?? null,
        hydrations_per_day: limits.hydrations_per_day ?? null,
      },
      latest_events: eventRows.slice(0, 20),
      official_usage: officialUsage,
    },
  };
}
