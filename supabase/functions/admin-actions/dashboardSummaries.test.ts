import { assertEquals } from "jsr:@std/assert";
import {
  checkedDashboardRowsQuery,
  cronCadenceSeconds,
  durationSeconds,
  estimateMonthlyRuns,
  latestXDeliveriesByPost,
  normalizeResourceUsage,
  percentUsed,
  queueLaneForType,
  summarizeDurations,
  summarizeLanePressure,
  withDashboardFallback,
} from "./dashboardSummaries.ts";

Deno.test("dashboard queue helpers classify lanes and summarize pressure", () => {
  assertEquals(queueLaneForType("translate"), "model");
  assertEquals(queueLaneForType("enrich"), "model");
  assertEquals(queueLaneForType("deliver"), "delivery");
  assertEquals(queueLaneForType("dedupe"), "fast");
  assertEquals(summarizeLanePressure([
    { type: "translate", pending: 2, running: 1, failed: 1, queue_wait_p95_seconds: 12 },
    { type: "enrich", pending: 3, running: 0, failed: 2, queue_wait_p95_seconds: 20 },
    { type: "deliver", pending: 1, running: 1, failed: 0, queue_wait_p95_seconds: 8 },
  ]), [
    { lane: "model", pending: 5, running: 1, failed: 3, max_queue_wait_p95_seconds: 20 },
    { lane: "delivery", pending: 1, running: 1, failed: 0, max_queue_wait_p95_seconds: 8 },
  ]);
});

Deno.test("dashboard duration helpers compute rounded stage summaries", () => {
  assertEquals(durationSeconds("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.340Z"), 2.3);
  assertEquals(durationSeconds("bad", "2026-01-01T00:00:02.340Z"), null);
  assertEquals(summarizeDurations([1, 2, 3, null, 10]), {
    count: 4,
    avg_seconds: 4,
    p50_seconds: 2,
    p90_seconds: 3,
    p95_seconds: 3,
  });
});

Deno.test("dashboard resource helpers estimate cron and storage pressure", () => {
  assertEquals(estimateMonthlyRuns("* * * * *"), 43_200);
  assertEquals(estimateMonthlyRuns("*/10 * * * *"), 4_320);
  assertEquals(cronCadenceSeconds("*/2 * * * *"), 120);
  assertEquals(cronCadenceSeconds("0 3 * * *"), null);
  assertEquals(percentUsed(250, 1000), 25);
  assertEquals(percentUsed(1, 0), null);
  assertEquals(normalizeResourceUsage({
    db_bytes: 250_000_000,
    db_limit_bytes: 500_000_000,
    temp_media_bytes: 50_000_000_000,
    temp_media_objects: 10,
    storage_limit_bytes: 100_000_000_000,
    edge_monthly_limit: 50_000,
    cron_jobs: [
      { jobname: "invoke-worker-every-1m", schedule: "* * * * *", active: true },
      { jobname: "disabled", schedule: "* * * * *", active: false },
    ],
  }), {
    available: true,
    error: null,
    db_bytes: 250_000_000,
    db_limit_bytes: 500_000_000,
    db_used_pct: 50,
    temp_media_bytes: 50_000_000_000,
    temp_media_objects: 10,
    storage_limit_bytes: 100_000_000_000,
    storage_used_pct: 50,
    edge_monthly_limit: 50_000,
    projected_cron_invocations_monthly: 43_200,
    edge_cron_used_pct: 86.4,
    cron_failures_24h: null,
    cron_jobs: [
      { jobname: "invoke-worker-every-1m", schedule: "* * * * *", active: true },
      { jobname: "disabled", schedule: "* * * * *", active: false },
    ],
    worker_dispatch_mode: "event-driven + cron fallback",
    worker_cron: { jobname: "invoke-worker-every-1m", schedule: "* * * * *", active: true },
    worker_cadence_seconds: 60,
    worker_cadence_warning: false,
    duplicate_translate_jobs_24h: 0,
  });
});

Deno.test("dashboard fallback helper converts optional query errors to safe rows", async () => {
  const errors: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const rows = await withDashboardFallback(
      "activity",
      checkedDashboardRowsQuery(Promise.resolve({
        data: null,
        error: { message: "schema cache reload required" },
      })),
      { data: [], error: null },
    );
    assertEquals(rows, { data: [], error: null });
    assertEquals(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});

Deno.test("latestXDeliveriesByPost keeps the newest row per post", () => {
  assertEquals(latestXDeliveriesByPost([
    { post_id: "a", status: "failed", created_at: "2026-01-01T00:00:00.000Z" },
    { post_id: "a", status: "posted", posted_at: "2026-01-01T00:02:00.000Z" },
    { post_id: "b", status: "pending", created_at: "2026-01-01T00:01:00.000Z" },
  ]), [
    { post_id: "a", status: "posted", posted_at: "2026-01-01T00:02:00.000Z" },
    { post_id: "b", status: "pending", created_at: "2026-01-01T00:01:00.000Z" },
  ]);
});
