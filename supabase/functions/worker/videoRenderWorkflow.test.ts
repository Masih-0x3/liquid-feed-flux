import { assert, assertEquals } from "jsr:@std/assert";
import type { XMediaRow } from "../_shared/mediaSelection.ts";
import type { VideoRenderRow } from "../_shared/videoRenderGate.ts";
import {
  enqueuePostDeliveryAfterRenderGate,
  markVideoRenderPosted,
  prepareVideoRenderGate,
} from "./videoRenderWorkflow.ts";

type FakeCall = {
  table: string;
  action: string;
  payload?: unknown;
  options?: unknown;
  filters?: Array<{ column: string; value: unknown }>;
};

type FakeSupabase = {
  calls: FakeCall[];
  from: (table: string) => unknown;
  rpc: (
    name: string,
    payload: unknown,
  ) => Promise<{ data: unknown; error: null }>;
};

const sourceVideo: XMediaRow = {
  id: "media-1",
  kind: "video",
  src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
  storage_path: "2026/6/source.mp4",
  downloaded_at: "2026-06-09T00:00:00Z",
  mime_type: "video/mp4",
  file_size: 10_000_000,
  duration_ms: 60_000,
};

const pendingVideo: XMediaRow = {
  id: "media-2",
  kind: "video",
  src_url: "https://pbs.twimg.com/ext_tw_video_thumb/abc/pu/img/thumb.jpg",
  storage_path: null,
  downloaded_at: null,
  mime_type: "image/jpeg",
  file_size: 100_000,
  duration_ms: 60_000,
};

function render(overrides: Partial<VideoRenderRow>): VideoRenderRow {
  return {
    id: "render-1",
    tweet_id: "tweet-1",
    source_media_id: "media-1",
    status: "queued",
    failure_policy: "post_original",
    output_storage_path: null,
    output_mime_type: null,
    output_file_size: null,
    duration_ms: null,
    width: null,
    height: null,
    render_version: "persian-subtitles-masihh-v1",
    error: null,
    ...overrides,
  };
}

function createFakeSupabase(options: {
  settingsValue?: Record<string, unknown>;
  mediaRows?: XMediaRow[];
  renderRows?: VideoRenderRow[];
  deliveries?: Array<Record<string, unknown>>;
  rpcData?: Record<string, unknown>;
} = {}): FakeSupabase {
  const calls: FakeCall[] = [];
  return {
    calls,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        order(column: string, orderOptions: unknown) {
          calls.push({
            table,
            action: "order",
            payload: { column, options: orderOptions },
            filters: [...filters],
          });
          const data = table === "media"
            ? options.mediaRows ?? []
            : table === "video_renders"
            ? options.renderRows ?? []
            : [];
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() {
          calls.push({ table, action: "maybeSingle", filters: [...filters] });
          return Promise.resolve({
            data: table === "settings"
              ? { value: options.settingsValue ?? { mode: "enabled" } }
              : null,
            error: null,
          });
        },
        upsert(payload: unknown, upsertOptions?: unknown) {
          calls.push({
            table,
            action: "upsert",
            payload,
            options: upsertOptions,
          });
          return Promise.resolve({ data: null, error: null });
        },
        insert(payload: unknown) {
          calls.push({ table, action: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        limit(count: number) {
          calls.push({
            table,
            action: "limit",
            payload: count,
            filters: [...filters],
          });
          return Promise.resolve({
            data: table === "deliveries" ? options.deliveries ?? [] : [],
            error: null,
          });
        },
      };
      return builder;
    },
    rpc(name: string, payload: unknown) {
      calls.push({ table: "rpc", action: name, payload });
      return Promise.resolve({
        data: options.rpcData?.[name] ?? null,
        error: null,
      });
    },
  };
}

function callsFor(
  calls: FakeCall[],
  table: string,
  action?: string,
): FakeCall[] {
  return calls.filter((call) =>
    call.table === table && (!action || call.action === action)
  );
}

function firstCall(calls: FakeCall[], table: string, action: string): FakeCall {
  const call = callsFor(calls, table, action)[0];
  assert(call, `missing ${table}.${action} call`);
  return call;
}

async function withFrozenTime<T>(
  nowMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

async function withMutedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

Deno.test("prepareVideoRenderGate disabled mode bypasses rendering", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "disabled" },
    mediaRows: [sourceVideo],
  });

  const gate = await prepareVideoRenderGate(supabase, "tweet-1", "test");

  assertEquals(gate.ready, true);
  assertEquals(gate.blocked, false);
  assertEquals(gate.decision, {
    action: "none",
    reason: "rendering_disabled",
  });
  assertEquals(
    callsFor(supabase.calls, "rpc", "enqueue_video_render").length,
    0,
  );
});

Deno.test("prepareVideoRenderGate active mode enqueues render and dispatches renderer", async () => {
  const supabase = createFakeSupabase({
    settingsValue: {
      mode: "enabled",
      render_version: "test-render-v1",
      failure_policy: "block",
    },
    mediaRows: [sourceVideo],
    renderRows: [],
    rpcData: { enqueue_video_render: "render-123" },
  });
  const dispatched: Array<[string, string, string]> = [];

  const gate = await prepareVideoRenderGate(supabase, "tweet-1", "test", {
    dispatchVideoRendererForTarget: async (
      _supabase,
      renderId,
      tweetId,
      source,
    ) => {
      dispatched.push([renderId, tweetId, source]);
    },
  });

  assertEquals(gate.ready, false);
  assertEquals(gate.blocked, false);
  assertEquals(gate.decision.action, "enqueue_render");
  assertEquals(dispatched, [["render-123", "tweet-1", "test"]]);
  const rpc = firstCall(supabase.calls, "rpc", "enqueue_video_render")
    .payload as Record<string, unknown>;
  assertEquals(rpc.p_source_media_id, "media-1");
  assertEquals(rpc.p_render_version, "test-render-v1");
  assertEquals(rpc.p_failure_policy, "block");
});

Deno.test("prepareVideoRenderGate shadow mode queues source-media download but stays ready", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "shadow" },
    mediaRows: [pendingVideo],
    renderRows: [],
  });

  const gate = await prepareVideoRenderGate(supabase, "tweet-1", "shadow-test");

  assertEquals(gate.ready, true);
  assertEquals(gate.blocked, false);
  assertEquals(gate.decision.action, "wait_media");
  const job = firstCall(supabase.calls, "jobs", "upsert")
    .payload as Record<string, unknown>;
  assertEquals(job.type, "download_media");
  assertEquals(job.idempotency_key, "download_media:video_render:tweet-1");
  const event = firstCall(supabase.calls, "pipeline_events", "insert")
    .payload as Record<string, unknown>;
  const meta = event.meta as Record<string, unknown>;
  assertEquals(event.step, "video_render");
  assertEquals(event.status, "queued");
  assertEquals(meta.shadow, true);
  assertEquals(meta.waiting_for, "source_media_download");
});

Deno.test("prepareVideoRenderGate active block records blocked event", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "enabled" },
    mediaRows: [sourceVideo],
    renderRows: [
      render({
        status: "blocked",
        block_reason: "watermark_detected",
      }),
    ],
  });

  const gate = await prepareVideoRenderGate(supabase, "tweet-1", "telegram");

  assertEquals(gate.ready, false);
  assertEquals(gate.blocked, true);
  assertEquals(gate.blockReason, "watermark_detected");
  const event = firstCall(supabase.calls, "pipeline_events", "insert")
    .payload as Record<string, unknown>;
  assertEquals(event.step, "video_render");
  assertEquals(event.status, "blocked");
  assertEquals(event.error, "watermark_detected");
});

Deno.test("enqueuePostDeliveryAfterRenderGate dispatches X only when delivery is ready", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "enabled" },
    mediaRows: [],
    renderRows: [],
  });
  const xDispatches: Array<[string, string]> = [];

  await withFrozenTime(Date.parse("2026-01-01T00:00:00.000Z"), async () => {
    await enqueuePostDeliveryAfterRenderGate(
      supabase,
      "tweet-1",
      "ready-test",
      true,
      {
        dispatchXPosterForTarget: async (_supabase, tweetId, source) => {
          xDispatches.push([tweetId, source]);
        },
      },
    );
  });

  const job = firstCall(supabase.calls, "jobs", "upsert")
    .payload as Record<string, unknown>;
  assertEquals(job.type, "deliver");
  assertEquals(job.next_run_at, "2026-01-01T00:00:00.000Z");
  assertEquals(xDispatches, [["tweet-1", "ready-test"]]);
  assertEquals(callsFor(supabase.calls, "deliveries", "insert").length, 1);
});

Deno.test("enqueuePostDeliveryAfterRenderGate defers delivery while active render is pending", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "enabled" },
    mediaRows: [sourceVideo],
    renderRows: [render({ status: "running" })],
  });
  const xDispatches: Array<[string, string]> = [];

  await withMutedConsole(async () => {
    await withFrozenTime(Date.parse("2026-01-01T00:00:00.000Z"), async () => {
      await enqueuePostDeliveryAfterRenderGate(
        supabase,
        "tweet-1",
        "wait-test",
        true,
        {
          dispatchXPosterForTarget: async (_supabase, tweetId, source) => {
            xDispatches.push([tweetId, source]);
          },
        },
      );
    });
  });

  const job = firstCall(supabase.calls, "jobs", "upsert")
    .payload as Record<string, unknown>;
  assertEquals(job.type, "deliver");
  assertEquals(job.next_run_at, "2026-01-01T00:00:30.000Z");
  assertEquals(xDispatches, []);
});

Deno.test("markVideoRenderPosted uses configured retention hours", async () => {
  const supabase = createFakeSupabase({
    settingsValue: { mode: "enabled", retention_hours: 48 },
  });

  await markVideoRenderPosted(supabase, "tweet-1");

  const rpc = firstCall(supabase.calls, "rpc", "mark_video_render_posted")
    .payload as Record<string, unknown>;
  assertEquals(rpc.p_tweet_id, "tweet-1");
  assertEquals(rpc.p_retention_hours, 48);
});
