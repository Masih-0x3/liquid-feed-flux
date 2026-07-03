import { assertEquals } from "jsr:@std/assert";
import {
  applyJobStateToRpc,
  attachDuplicateClusters,
  deriveMonitoringState,
  getMonitoringEntries,
  matchesMonitoringFilter,
  normalizeMonitoringFilter,
  sanitizeSearchTerm,
} from "./monitoringReads.ts";

type FakeCall = {
  table?: string;
  name?: string;
  op: string;
  columns?: string;
  column?: string;
  value?: unknown;
  values?: unknown[];
};

type FakeMonitoringSupabaseOptions = {
  postRows?: Array<Record<string, unknown>>;
  pipelineRows?: Array<Record<string, unknown>>;
  xDeliveryRows?: Array<Record<string, unknown>>;
  workflowRows?: Array<Record<string, unknown>>;
  aiCallRows?: Array<Record<string, unknown>>;
};

function fakeMonitoringSupabase(options: FakeMonitoringSupabaseOptions = {}) {
  const calls: FakeCall[] = [];
  let postsSelectCount = 0;
  const postRows = options.postRows ?? [
    {
      tweet_id: "t1",
      text_original: "source",
      text_translated: "translated",
      url: "https://x.com/status/t1",
      created_at: "2026-01-01T00:00:00.000Z",
      translated_at: "2026-01-01T00:01:00.000Z",
      has_media: false,
      author_handle: "source",
      importance_score: 16,
      final_score: 16,
      delivery_decision: "deliver",
      accounts: { handle: "feed" },
    },
  ];
  const pipelineRows = options.pipelineRows ?? [];
  const xDeliveryRows = options.xDeliveryRows ?? [];
  const workflowRows = options.workflowRows ?? [];
  const aiCallRows = options.aiCallRows ?? [];

  const query = (table: string) => {
    const state = {
      table,
      columns: "",
      head: false,
      maybeSingle: false,
    };
    const resolve = () => {
      if (state.table === "settings") {
        return {
          data: [
            { key: "content_filter", value: { default_threshold: 14 } },
            { key: "active_profile_id", value: { id: "default" } },
          ],
        };
      }
      if (state.table === "posts") {
        if (state.head) return {};
        if (
          state.columns.includes("enrichment_version") &&
          postsSelectCount++ === 0
        ) {
          return {
            error: {
              code: "42703",
              message: "column enrichment_version does not exist",
            },
          };
        }
        if (state.columns.includes("tweet_id, text_original, url")) {
          return { data: [] };
        }
        return { data: postRows };
      }
      if (state.table === "jobs") return { data: [] };
      if (state.table === "x_deliveries") return { data: xDeliveryRows };
      if (state.table === "workflow_runs") return { data: workflowRows };
      if (state.table === "ai_call_ledger") return { data: aiCallRows };
      return { data: [] };
    };
    const builder = {
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
          | null,
        _onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(resolve()).then(
          onfulfilled ?? ((value) => value as TResult1),
        );
      },
      select(columns: string, options?: Record<string, unknown>) {
        state.columns = columns;
        state.head = options?.head === true;
        calls.push({ table, op: "select", columns });
        return builder;
      },
      eq(column: string, value: unknown) {
        calls.push({ table, op: "eq", column, value });
        return builder;
      },
      in(column: string, values: unknown[]) {
        calls.push({ table, op: "in", column, values });
        return builder;
      },
      not(column: string, value: unknown) {
        calls.push({ table, op: "not", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        calls.push({ table, op: "is", column, value });
        return builder;
      },
      or(value: string) {
        calls.push({ table, op: "or", value });
        return builder;
      },
      order(column: string) {
        calls.push({ table, op: "order", column });
        return builder;
      },
      range(column: number, value: number) {
        calls.push({ table, op: "range", column: String(column), value });
        return builder;
      },
      limit(value: number) {
        calls.push({ table, op: "limit", value });
        return builder;
      },
      maybeSingle() {
        state.maybeSingle = true;
        return Promise.resolve(resolve());
      },
    };
    return builder;
  };

  const client = {
    calls,
    from: query,
    rpc(name: string) {
      calls.push({ op: "rpc", name });
      return Promise.resolve({
        data: name === "get_post_pipeline_status" ? pipelineRows : [],
      });
    },
  };
  return client;
}

Deno.test("monitoring filters and search sanitization are stable", () => {
  assertEquals(normalizeMonitoringFilter("failed-stuck"), "failed_stuck");
  assertEquals(
    normalizeMonitoringFilter("ready_to_deliver"),
    "ready_to_deliver",
  );
  assertEquals(normalizeMonitoringFilter("needs-action"), "all");
  assertEquals(normalizeMonitoringFilter("unknown"), "all");
  assertEquals(sanitizeSearchTerm("  bad%,_( query )  "), "bad query ");
});

Deno.test("monitoring state handles terminal skips and duplicate coverage gaps", () => {
  assertEquals(
    deriveMonitoringState(
      {
        delivery_decision: "skip",
        decision_reason: "below_threshold:8<14",
        final_score: 8,
        dedupe_status: "failed",
      },
      { dedupe_job_status: "failed" },
      14,
    ).code,
    "below_threshold",
  );

  const coverageGap = deriveMonitoringState(
    {
      delivery_decision: "skip",
      dedupe_status: "coverage_gap",
      dedupe_reason: "coverage_gap:canonical_not_delivered",
      dup_of_tweet_id: "root",
    },
    {},
    14,
  );
  assertEquals(coverageGap.code, "duplicate_coverage_gap");
  assertEquals(coverageGap.needs_attention, true);
});

Deno.test("applyJobStateToRpc overlays active job state onto pipeline RPC state", () => {
  const jobs = new Map<
    string,
    Map<string, { status: string; last_error?: string | null }>
  >();
  jobs.set(
    "t1",
    new Map([
      ["translate", { status: "failed", last_error: "translate down" }],
      ["deliver", { status: "pending" }],
    ]),
  );

  assertEquals(applyJobStateToRpc("t1", { delivery_status: "posted" }, jobs), {
    delivery_status: "pending",
    delivery_job_status: "pending",
    translate_status: "failed",
    translate_error: "translate down",
  });
});

Deno.test("duplicate clusters choose an active canonical and hide duplicate members", () => {
  const entries = attachDuplicateClusters([
    {
      tweet_id: "old",
      created_at: "2026-01-01T00:00:00.000Z",
      story_cluster_id: "s1",
      final_score: 10,
      monitoring_state: {
        telegram_state: "none",
        x_state: "none",
        code: "blocked_duplicate",
      },
    },
    {
      tweet_id: "active",
      created_at: "2026-01-01T00:01:00.000Z",
      story_cluster_id: "s1",
      final_score: 8,
      delivery_decision: "deliver",
      monitoring_state: {
        telegram_state: "none",
        x_state: "none",
        code: "ready_to_deliver",
      },
    },
  ]);

  assertEquals(
    entries.find((entry) => entry.tweet_id === "old")?.hidden_in_cluster,
    true,
  );
  assertEquals(
    (entries[0].duplicate_cluster as Record<string, unknown>)
      .canonical_tweet_id,
    "active",
  );
});

Deno.test("matchesMonitoringFilter keeps V2 and manual feedback filters available after extraction", () => {
  assertEquals(
    matchesMonitoringFilter({
      score_breakdown: {
        scoring_v2: {
          decision: "deliver",
          policy_rule_applied: "regional_escalation_auto",
        },
      },
      monitoring_state: { code: "ready_to_deliver" },
    }, "v2_regional_auto"),
    true,
  );
  assertEquals(
    matchesMonitoringFilter({
      decision_reason: "score_feedback_skip:should_skip",
      feedback_locked: true,
      monitoring_state: { code: "below_threshold" },
    }, "manual_scoring_feedback"),
    true,
  );
});

Deno.test("getMonitoringEntries falls back when optional monitoring columns are missing", async () => {
  const supabase = fakeMonitoringSupabase();
  const result = await getMonitoringEntries(supabase, { limit: 10 });
  const postSelects = supabase.calls
    .filter((call) => call.table === "posts" && call.op === "select")
    .map((call) => call.columns ?? "");

  assertEquals(result.success, true);
  assertEquals(result.entries.length, 1);
  assertEquals(
    postSelects.some((columns) => columns.includes("enrichment_version")),
    true,
  );
  assertEquals(
    postSelects.some((columns) =>
      !columns.includes("enrichment_version") &&
      columns.includes("scoring_version")
    ),
    true,
  );
});

Deno.test("getMonitoringEntries preserves x-delivery status filter row id order", async () => {
  const supabase = fakeMonitoringSupabase({
    xDeliveryRows: [
      { post_id: "x2", created_at: "2026-01-01T00:02:00.000Z" },
      { post_id: "x1", created_at: "2026-01-01T00:01:00.000Z" },
      { post_id: "x2", created_at: "2026-01-01T00:00:00.000Z" },
    ],
    postRows: [
      {
        tweet_id: "x1",
        text_original: "first",
        text_translated: "first translated",
        url: "https://x.com/status/x1",
        created_at: "2026-01-01T00:01:00.000Z",
        translated_at: "2026-01-01T00:01:30.000Z",
        has_media: false,
        author_handle: "source",
        final_score: 15,
        delivery_decision: "deliver",
        accounts: { handle: "feed" },
      },
      {
        tweet_id: "x2",
        text_original: "second",
        text_translated: "second translated",
        url: "https://x.com/status/x2",
        created_at: "2026-01-01T00:02:00.000Z",
        translated_at: "2026-01-01T00:02:30.000Z",
        has_media: false,
        author_handle: "source",
        final_score: 16,
        delivery_decision: "deliver",
        accounts: { handle: "feed" },
      },
    ],
    pipelineRows: [
      { tweet_id: "x1", x_status: "failed" },
      { tweet_id: "x2", x_status: "failed" },
    ],
  });

  const result = await getMonitoringEntries(supabase, {
    filter: "x_failed",
    limit: 10,
  });
  const xDeliveryStatusFilter = supabase.calls.find((call) =>
    call.table === "x_deliveries" && call.op === "eq" &&
    call.column === "status"
  );
  const postsIdFilter = supabase.calls.find((call) =>
    call.table === "posts" && call.op === "in" && call.column === "tweet_id"
  );

  assertEquals(result.success, true);
  assertEquals(
    result.entries.map((entry: Record<string, unknown>) => entry.tweet_id),
    ["x2", "x1"],
  );
  assertEquals(xDeliveryStatusFilter?.value, "failed");
  assertEquals(postsIdFilter?.values, ["x2", "x1"]);
});

Deno.test("getMonitoringEntries attaches process observability evidence by tweet", async () => {
  const supabase = fakeMonitoringSupabase({
    postRows: [
      {
        tweet_id: "obs-1",
        text_original: "source",
        text_translated: "translated",
        url: "https://x.com/status/obs-1",
        created_at: "2026-01-01T00:00:00.000Z",
        translated_at: "2026-01-01T00:01:00.000Z",
        has_media: false,
        author_handle: "source",
        final_score: 16,
        delivery_decision: "deliver",
        accounts: { handle: "feed" },
      },
    ],
    workflowRows: [
      {
        run_key: "post:obs-1:job:abc",
        workflow_name: "rss-item-pipeline",
        workflow_run_id: "worker:obs-1:abc",
        status: "completed",
        source_function: "worker",
        tweet_id: "obs-1",
        started_at: "2026-01-01T00:00:00.000Z",
        ended_at: "2026-01-01T00:00:04.000Z",
      },
    ],
    aiCallRows: [
      {
        workflow_run_key: "post:obs-1:job:abc",
        trace_name: "rss-item-pipeline",
        operation_name: "translate",
        agent_name: "translator",
        model: "gpt-4.1-mini",
        endpoint: "chat_completions",
        status: "completed",
        total_tokens: 120,
        reasoning_tokens: 0,
        duration_ms: 1234,
        started_at: "2026-01-01T00:00:01.000Z",
        ended_at: "2026-01-01T00:00:02.234Z",
        foglamp_exported: false,
        foglamp_span_estimate: 1,
        foglamp_skip_reason: "worker_local_only",
      },
    ],
  });

  const result = await getMonitoringEntries(supabase, { limit: 10 });
  const entry = result.entries[0] as Record<string, unknown>;
  const observability = entry.process_observability as Record<
    string,
    unknown
  >;
  const latestRun = observability.latest_run as Record<string, unknown>;

  assertEquals(observability.available, true);
  assertEquals(observability.ai_calls, 1);
  assertEquals(observability.total_tokens, 120);
  assertEquals(observability.foglamp_skipped, 1);
  assertEquals(latestRun.workflow_name, "rss-item-pipeline");
  assertEquals(latestRun.duration_seconds, 4);
  assertEquals(
    ((latestRun.calls as Array<Record<string, unknown>>)[0]).agent_name,
    "translator",
  );
});
