import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  isProcessedRenderStoragePath,
  isStorageObjectNotFoundError,
  repairStaleMediaObject,
  StaleMediaObjectError,
  staleMediaRepairIdempotencyKey,
  staleMediaObjectErrorForDownload,
} from "./staleMediaRepair.ts";

type FakeCall = {
  table: string;
  op: string;
  value?: unknown;
};

function createRepairSupabase(options: { pendingJobs?: Array<Record<string, unknown>> } = {}) {
  const calls: FakeCall[] = [];
  return {
    calls,
    from(table: string) {
      const builder = {
        update(value: unknown) {
          calls.push({ table, op: "update", value });
          return builder;
        },
        insert(value: unknown) {
          calls.push({ table, op: "insert", value });
          return Promise.resolve({ data: null, error: null });
        },
        select(value: unknown) {
          calls.push({ table, op: "select", value });
          return builder;
        },
        in(column: string, value: unknown) {
          calls.push({ table, op: `in:${column}`, value });
          return builder;
        },
        filter(column: string, operator: string, value: unknown) {
          calls.push({ table, op: `filter:${column}:${operator}`, value });
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push({ table, op: `eq:${column}`, value });
          return builder;
        },
        limit(value: unknown) {
          calls.push({ table, op: "limit", value });
          return Promise.resolve({ data: table === "jobs" ? options.pendingJobs ?? [] : [], error: null });
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

Deno.test("detects storage object-not-found errors", () => {
  assert(isStorageObjectNotFoundError({ message: "Object not found", statusCode: 404 }));
  assert(isStorageObjectNotFoundError(new Error("NoSuchKey: missing object")));
  assert(!isStorageObjectNotFoundError(new Error("network timeout")));
  assert(isProcessedRenderStoragePath("processed/persian-subtitles-v1/2026/06/tweet/render.mp4"));
  assert(!isProcessedRenderStoragePath("2026/6/tweet_0.mp4"));
});

Deno.test("wraps missing storage download errors with media identity", () => {
  const error = staleMediaObjectErrorForDownload(
    "2026/6/tweet_0.mp4",
    { message: "Object not found" },
    { id: "media-1" },
  );

  assert(error instanceof StaleMediaObjectError);
  assertEquals(error?.storagePath, "2026/6/tweet_0.mp4");
  assertEquals(error?.mediaId, "media-1");
  assertStringIncludes(error?.message ?? "", "stale_media_object:2026/6/tweet_0.mp4");
});

Deno.test("repairStaleMediaObject clears guarded media pointer and queues download", async () => {
  const supabase = createRepairSupabase();

  const result = await repairStaleMediaObject(supabase, {
    tweetId: "tweet-1",
    mediaId: "media-1",
    storagePath: "2026/6/tweet_0.mp4",
    source: "telegram_delivery",
  });

  assertEquals(result, { mediaCleared: true, downloadQueued: true });
  assertEquals(supabase.calls.some((call) => call.table === "media" && call.op === "update"), true);
  assertEquals(supabase.calls.some((call) => call.table === "media" && call.op === "eq:id" && call.value === "media-1"), true);
  assertEquals(supabase.calls.some((call) => call.table === "media" && call.op === "eq:storage_path" && call.value === "2026/6/tweet_0.mp4"), true);

  const jobInsert = supabase.calls.find((call) => call.table === "jobs" && call.op === "insert");
  assert(jobInsert);
  const job = jobInsert.value as Record<string, unknown>;
  assertEquals(job.type, "download_media");
  assertEquals((job.payload as Record<string, unknown>).repair, "stale_media_object");
  assertEquals(job.idempotency_key, staleMediaRepairIdempotencyKey("tweet-1", "media-1", "2026/6/tweet_0.mp4"));

  const eventInsert = supabase.calls.find((call) => call.table === "pipeline_events" && call.op === "insert");
  assert(eventInsert);
  const event = eventInsert.value as Record<string, unknown>;
  assertEquals((event.meta as Record<string, unknown>).download_queued, true);
});

Deno.test("repairStaleMediaObject avoids duplicate download job when repair is pending", async () => {
  const supabase = createRepairSupabase({ pendingJobs: [{ id: "job-1" }] });

  const result = await repairStaleMediaObject(supabase, {
    tweetId: "tweet-1",
    mediaId: "media-1",
    storagePath: "2026/6/tweet_0.mp4",
    source: "video_renderer",
  });

  assertEquals(result, { mediaCleared: true, downloadQueued: false });
  assertEquals(supabase.calls.some((call) => call.table === "jobs" && call.op === "insert"), false);
  const eventInsert = supabase.calls.find((call) => call.table === "pipeline_events" && call.op === "insert");
  assert(eventInsert);
  const event = eventInsert.value as Record<string, unknown>;
  assertEquals((event.meta as Record<string, unknown>).download_queued, false);
});
