import { assertEquals } from "jsr:@std/assert";
import {
  getXApiSummary,
  type RecordAdminXApiAttemptFn,
  type RecordXApiEventFn,
} from "./xApiSummary.ts";
import type { SupabaseAdminClient } from "./types.ts";

type FakeCall = {
  table: string;
  op: string;
  column?: string;
  value?: unknown;
  columns?: string;
  options?: Record<string, unknown>;
};

function fakeSupabase() {
  const calls: FakeCall[] = [];
  let deliveryQueryCount = 0;
  const client: SupabaseAdminClient & { calls: FakeCall[] } = {
    calls,
    from(tableName: string) {
      const state = {
        tableName,
        hasMediaFilter: false,
        deliveryQueryNumber: tableName === "x_deliveries" ? ++deliveryQueryCount : 0,
      };
      const resolve = () => {
        if (state.tableName === "x_api_events") {
          return {
            data: [
              {
                created_at: "2026-06-15T11:00:00.000Z",
                source: "worker",
                ok: true,
                estimated_billable_unit: "post_write",
                request_counted: true,
              },
              {
                created_at: "2026-06-15T10:55:00.000Z",
                source: "admin-actions",
                ok: false,
                estimated_billable_unit: "official_usage_lookup",
                request_counted: false,
                error: "HTTP 429",
              },
              {
                created_at: "2026-06-15T10:45:00.000Z",
                source: "worker",
                ok: true,
                estimated_billable_unit: null,
              },
            ],
          };
        }
        if (state.tableName === "x_deliveries") {
          if (state.deliveryQueryNumber === 1) return { count: 1 };
          return { count: state.hasMediaFilter ? 2 : 5 };
        }
        if (state.tableName === "settings") {
          return {
            data: {
              value: {
                posts_per_hour: 10,
                posts_per_day: 50,
                monthly_post_budget: 1000,
                hydrations_per_day: 25,
              },
            },
          };
        }
        return {};
      };
      const builder = {
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve(resolve()).then(onfulfilled ?? ((value) => value as TResult1));
        },
        select(columns: string, options?: Record<string, unknown>) {
          calls.push({ table: tableName, op: "select", columns, options });
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push({ table: tableName, op: "eq", column, value });
          return builder;
        },
        gt(column: string, value: unknown) {
          calls.push({ table: tableName, op: "gt", column, value });
          if (tableName === "x_deliveries" && column === "media_count") state.hasMediaFilter = true;
          return builder;
        },
        gte(column: string, value: unknown) {
          calls.push({ table: tableName, op: "gte", column, value });
          return builder;
        },
        order(column: string, options?: Record<string, unknown>) {
          calls.push({ table: tableName, op: "order", column, options });
          return builder;
        },
        limit(value: number) {
          calls.push({ table: tableName, op: "limit", value });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(resolve());
        },
      };
      return builder;
    },
    rpc() {
      return Promise.resolve({});
    },
  };
  return client;
}

function deps(loggedEvents: Array<Record<string, unknown>> = []) {
  const recordAdminXApiAttempt: RecordAdminXApiAttemptFn = async () => {
    throw new Error("recordAdminXApiAttempt should not be called in this test");
  };
  const recordXApiEvent: RecordXApiEventFn = async (_supabase, input) => {
    loggedEvents.push(input);
  };
  return {
    recordAdminXApiAttempt,
    recordXApiEvent,
    readEnv: () => undefined,
  };
}

Deno.test("x api summary counts local events, deliveries, and configured budgets", async () => {
  const result = await getXApiSummary(fakeSupabase(), { window_hours: 48 }, deps());

  assertEquals(result.summary.window_hours, 48);
  assertEquals(result.summary.attempts, 3);
  assertEquals(result.summary.counted_attempts, 2);
  assertEquals(result.summary.failed_attempts, 1);
  assertEquals(result.summary.success_rate, 66.7);
  assertEquals(result.summary.by_unit, {
    post_write: 1,
    official_usage_lookup: 1,
    api_request: 1,
  });
  assertEquals(result.summary.by_source, {
    worker: 2,
    "admin-actions": 1,
  });
  assertEquals(result.summary.posts_last_hour, 1);
  assertEquals(result.summary.posts_local, 5);
  assertEquals(result.summary.media_posts_local, 2);
  assertEquals(result.summary.latest_event_at, "2026-06-15T11:00:00.000Z");
  assertEquals(result.summary.latest_error, "HTTP 429");
  assertEquals(result.summary.configured_budget, {
    posts_per_hour: 10,
    posts_per_day: 50,
    monthly_post_budget: 1000,
    hydrations_per_day: 25,
  });
  assertEquals(result.summary.official_usage, { synced: false, reason: "not_requested" });
});

Deno.test("x api summary logs official usage sync failure when bearer token is missing", async () => {
  const loggedEvents: Array<Record<string, unknown>> = [];
  const result = await getXApiSummary(fakeSupabase(), { sync_official_usage: true }, deps(loggedEvents));

  assertEquals(result.summary.official_usage, { synced: false, reason: "bearer_token_missing" });
  assertEquals(loggedEvents, [
    {
      source: "admin-actions",
      sourceAction: "usage_sync",
      endpoint: "/2/usage/tweets",
      method: "GET",
      requestCounted: false,
      ok: false,
      error: "bearer_token_missing",
      estimatedBillableUnit: "official_usage_lookup",
    },
  ]);
});
