import assert from "node:assert/strict";
import test from "node:test";
import {
  isStorageObjectNotFoundError,
  outputQualityAttempts,
  recordRenderFailure,
  repairStaleSourceMedia,
} from "../src/renderer.js";

function thenableResult(value) {
  return {
    then(resolve) {
      resolve(value);
    },
  };
}

function createRepairSupabase({ pendingJobs = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const builder = {
        update(value) {
          calls.push({ table, op: "update", value });
          return builder;
        },
        insert(value) {
          calls.push({ table, op: "insert", value });
          return Promise.resolve({ data: null, error: null });
        },
        select(value) {
          calls.push({ table, op: "select", value });
          return builder;
        },
        in(column, value) {
          calls.push({ table, op: `in:${column}`, value });
          return builder;
        },
        filter(column, operator, value) {
          calls.push({ table, op: `filter:${column}:${operator}`, value });
          return builder;
        },
        eq(column, value) {
          calls.push({ table, op: `eq:${column}`, value });
          return builder;
        },
        limit(value) {
          calls.push({ table, op: "limit", value });
          return Promise.resolve({ data: table === "jobs" ? pendingJobs : [], error: null });
        },
        then(resolve) {
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

test("records render failure with awaitable Supabase RPC builders that do not expose catch", async () => {
  const calls = [];
  const supabase = {
    rpc(name, payload) {
      calls.push({ name, payload });
      return thenableResult({ data: { accepted: true, queued_deliver: false }, error: null });
    },
  };

  const data = await recordRenderFailure(supabase, {
    row: {
      id: "render-1",
      claim_token: "22222222-2222-4222-8222-222222222222",
      claim_generation: 7,
    },
    rendererId: "renderer-a",
    error: new Error("primary render failure"),
    metrics: { total_ms: 123 },
  });

  assert.deepEqual(data, { accepted: true, queued_deliver: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "fail_video_render");
  assert.deepEqual(calls[0].payload, {
    p_render_id: "render-1",
    p_worker_id: "renderer-a",
    p_claim_token: "22222222-2222-4222-8222-222222222222",
    p_claim_generation: 7,
    p_error: "primary render failure",
    p_metrics: { total_ms: 123 },
  });
});

test("does not surface a stale failure write as accepted", async () => {
  const supabase = {
    rpc() {
      return thenableResult({
        data: { accepted: false, reason: "stale_video_render_claim", queued_deliver: true },
        error: null,
      });
    },
  };

  const data = await recordRenderFailure(supabase, {
    row: {
      id: "render-1",
      claim_token: "22222222-2222-4222-8222-222222222222",
      claim_generation: 7,
    },
    rendererId: "renderer-a",
    error: new Error("late stale failure"),
    metrics: {},
  });

  assert.equal(data, null);
});

test("detects missing Supabase storage object errors", () => {
  assert.equal(isStorageObjectNotFoundError({ message: "Object not found", statusCode: 404 }), true);
  assert.equal(isStorageObjectNotFoundError(new Error("NoSuchKey: missing object")), true);
  assert.equal(isStorageObjectNotFoundError(new Error("temporary network failure")), false);
});

test("repairs stale renderer source media and queues a redownload", async () => {
  const supabase = createRepairSupabase();

  const result = await repairStaleSourceMedia(supabase, {
    row: { id: "render-1", tweet_id: "tweet-1" },
    source: { id: "media-1", tweet_id: "tweet-1" },
    storagePath: "2026/6/tweet_0.mp4",
  });

  assert.deepEqual(result, { mediaCleared: true, downloadQueued: true });
  assert.equal(supabase.calls.some((call) => call.table === "media" && call.op === "update"), true);
  assert.equal(supabase.calls.some((call) => call.table === "media" && call.op === "eq:id" && call.value === "media-1"), true);
  assert.equal(supabase.calls.some((call) => call.table === "media" && call.op === "eq:storage_path" && call.value === "2026/6/tweet_0.mp4"), true);

  const jobInsert = supabase.calls.find((call) => call.table === "jobs" && call.op === "insert");
  assert.ok(jobInsert);
  assert.equal(jobInsert.value.type, "download_media");
  assert.equal(jobInsert.value.payload.repair, "stale_media_object");
  assert.match(jobInsert.value.idempotency_key, /^download_media:stale_storage:tweet-1:media-1:/);

  const eventInsert = supabase.calls.find((call) => call.table === "pipeline_events" && call.op === "insert");
  assert.ok(eventInsert);
  assert.equal(eventInsert.value.meta.download_queued, true);
});

test("builds bounded output-size retry quality ladder", () => {
  assert.deepEqual(outputQualityAttempts(
    { crf: 20, preset: "fast" },
    { outputRetryCrfStep: 4, maxOutputRetryCrf: 30 },
  ), [
    { crf: 20, preset: "fast" },
    { crf: 24, preset: "fast" },
    { crf: 28, preset: "fast" },
    { crf: 30, preset: "fast" },
  ]);

  assert.deepEqual(outputQualityAttempts(
    { crf: 28, preset: "veryfast" },
    { outputRetryCrfStep: 4, maxOutputRetryCrf: 30 },
  ), [
    { crf: 28, preset: "veryfast" },
    { crf: 30, preset: "veryfast" },
  ]);
});
