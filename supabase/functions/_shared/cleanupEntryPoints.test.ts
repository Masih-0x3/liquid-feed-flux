import { assertEquals } from "jsr:@std/assert";
import { createDbCleanupHandler } from "../db-cleanup/handler.ts";
import { createMediaCleanupHandler } from "../media-cleanup/handler.ts";
import { cleanupOldMedia } from "../media-processor/cleanupOldMedia.ts";
import { createMediaProcessorHandler } from "../media-processor/handler.ts";

const headers = { "Access-Control-Allow-Origin": "https://xot.example" };
const noAuthError = async () => await Promise.resolve(null);
const noCapture = async () => await Promise.resolve();
const okResponse = async () =>
  await Promise.resolve(new Response(JSON.stringify({ success: true })));

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://xot.example/functions/v1/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("cleanup entrypoints reject before constructing a service client", async () => {
  const rejectInternalAuth = async () =>
    await Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers,
    }));

  let processorClientCreates = 0;
  const processor = createMediaProcessorHandler({
    corsHeaders: headers,
    createSupabase: () => {
      processorClientCreates += 1;
      return {};
    },
    requireInternalAuth: rejectInternalAuth,
    getEnv: () => undefined,
    downloadMediaForTweet: okResponse,
    cleanupOldMedia: okResponse,
    getMediaInfo: okResponse,
    captureException: noCapture,
  });
  assertEquals((await processor(jsonRequest({ action: "get_media_info" }))).status, 401);
  assertEquals(processorClientCreates, 0);

  let mediaCleanupClientCreates = 0;
  const mediaCleanup = createMediaCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => {
      mediaCleanupClientCreates += 1;
      return {};
    },
    requireInternalAuth: rejectInternalAuth,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => undefined,
    captureException: noCapture,
  });
  assertEquals((await mediaCleanup(jsonRequest({}))).status, 401);
  assertEquals(mediaCleanupClientCreates, 0);

  let dbCleanupClientCreates = 0;
  const dbCleanup = createDbCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => {
      dbCleanupClientCreates += 1;
      return {};
    },
    requireInternalAuth: rejectInternalAuth,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => undefined,
    captureException: noCapture,
  });
  assertEquals((await dbCleanup(jsonRequest({}))).status, 401);
  assertEquals(dbCleanupClientCreates, 0);
});

Deno.test("media-cleanup blocks malformed or absent mutation flags before invoking media-processor", async () => {
  for (const enableValue of [undefined, "", "false", "TRUE", "1"]) {
    let invokeCount = 0;
    const handler = createMediaCleanupHandler({
      corsHeaders: headers,
      createSupabase: () => ({
        functions: {
          invoke: async () => {
            invokeCount += 1;
            return await Promise.resolve({ data: null, error: null });
          },
        },
      }),
      requireInternalAuth: noAuthError,
      serviceRoleBearerHeader: () => ({}),
      getEnv: () => enableValue,
      captureException: noCapture,
    });

    const response = await handler(jsonRequest({}));
    assertEquals(response.status, 423);
    assertEquals(invokeCount, 0);
    assertEquals((await response.json()).error, "cleanup_disabled_for_safety");
  }
});

Deno.test("media-cleanup forwards an explicit dry-run without enabling mutations", async () => {
  const invocations: Array<{ name: string; options: Record<string, unknown> }> =
    [];
  const handler = createMediaCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => ({
      functions: {
        invoke: async (name: string, options: Record<string, unknown>) => {
          invocations.push({ name, options });
          return await Promise.resolve({
            data: { dry_run: true, would_delete: 3 },
            error: null,
          });
        },
      },
    }),
    requireInternalAuth: noAuthError,
    serviceRoleBearerHeader: () => ({ Authorization: "redacted-test-value" }),
    getEnv: () => undefined,
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({ dry_run: true, days_old: 2 }));
  assertEquals(response.status, 200);
  assertEquals(invocations.length, 1);
  assertEquals(invocations[0].name, "media-processor");
  assertEquals(invocations[0].options.body, {
    action: "cleanup_old_media",
    days_old: 2,
    dry_run: true,
  });
});

Deno.test("media-cleanup rejects a malformed delegated response", async () => {
  const handler = createMediaCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => ({
      functions: {
        invoke: async () => await Promise.resolve({ data: null, error: null }),
      },
    }),
    requireInternalAuth: noAuthError,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => "true",
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({}));
  assertEquals(response.status, 500);
});

Deno.test("media-processor blocks cleanup before selection or mutation workflow", async () => {
  for (const enableValue of [undefined, "false", "TRUE", "1"]) {
    let cleanupCount = 0;
    const handler = createMediaProcessorHandler({
      corsHeaders: headers,
      createSupabase: () => ({}),
      requireInternalAuth: noAuthError,
      getEnv: () => enableValue,
      downloadMediaForTweet: okResponse,
      cleanupOldMedia: async () => {
        cleanupCount += 1;
        return await okResponse();
      },
      getMediaInfo: okResponse,
      captureException: noCapture,
    });

    const response = await handler(
      jsonRequest({ action: "cleanup_old_media" }),
    );
    assertEquals(response.status, 423);
    assertEquals(cleanupCount, 0);
  }
});

Deno.test("media-processor propagates dry-run to the cleanup workflow with the flag absent", async () => {
  const calls: Array<{ dryRun: boolean; daysOld: number }> = [];
  const handler = createMediaProcessorHandler({
    corsHeaders: headers,
    createSupabase: () => ({}),
    requireInternalAuth: noAuthError,
    getEnv: () => undefined,
    downloadMediaForTweet: okResponse,
    cleanupOldMedia: async (_supabase, dryRun, daysOld) => {
      calls.push({ dryRun, daysOld });
      return await okResponse();
    },
    getMediaInfo: okResponse,
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({
    action: "cleanup_old_media",
    dry_run: true,
    days_old: 4,
  }));
  assertEquals(response.status, 200);
  assertEquals(calls, [{ dryRun: true, daysOld: 4 }]);
});

Deno.test("dry-run performs selection reads without storage or database mutation", async () => {
  const rpcCalls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "get_old_media") {
        return await Promise.resolve({ data: [], error: null });
      }
      if (name === "media_objects_preview_old") {
        return await Promise.resolve({
          data: [{ object_id: "obj-1", storage_path: "2026/7/media.jpg" }],
          error: null,
        });
      }
      if (name === "get_expired_video_render_paths") {
        return await Promise.resolve({
          data: [{ id: "render-1", output_storage_path: "renders/output.mp4" }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from: () => {
        throw new Error("dry-run attempted storage mutation");
      },
    },
    from: () => {
      throw new Error("dry-run attempted database mutation");
    },
  };

  const response = await cleanupOldMedia(client, true, 1, headers);
  assertEquals(response.status, 200);
  assertEquals(rpcCalls, [
    "get_old_media",
    "media_objects_preview_old",
    "get_expired_video_render_paths",
  ]);
  assertEquals(await response.json(), {
    success: true,
    dry_run: true,
    would_delete: 2,
    would_delete_original_media: 1,
    would_delete_processed_video_renders: 1,
  });
});

Deno.test("media cleanup dry-run preview count reflects physical objects (one per shared path)", async () => {
  const client = {
    rpc: async (name: string) => {
      if (name === "get_old_media") {
        return await Promise.resolve({ data: [], error: null });
      }
      if (name === "media_objects_preview_old") {
        return await Promise.resolve({
          data: [{ object_id: "obj-1", storage_path: "shared/a.jpg" }],
          error: null,
        });
      }
      if (name === "get_expired_video_render_paths") {
        return await Promise.resolve({ data: [], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: { from: () => { throw new Error("dry-run storage mutation"); } },
    from: () => { throw new Error("dry-run db mutation"); },
  };

  const response = await cleanupOldMedia(client, true, 1, headers);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    dry_run: true,
    would_delete: 1,
    would_delete_original_media: 1,
    would_delete_processed_video_renders: 0,
  });
});

Deno.test("db-cleanup blocks before cleanup_old_data or nested media cleanup", async () => {
  for (const enableValue of [undefined, "", "false", "TRUE", "1"]) {
    let rpcCount = 0;
    let invokeCount = 0;
    const handler = createDbCleanupHandler({
      corsHeaders: headers,
      createSupabase: () => ({
        rpc: async () => {
          rpcCount += 1;
          return await Promise.resolve({ data: null, error: null });
        },
        functions: {
          invoke: async () => {
            invokeCount += 1;
            return await Promise.resolve({ data: null, error: null });
          },
        },
        from: () => {
          throw new Error("blocked request reached database reads");
        },
      }),
      requireInternalAuth: noAuthError,
      serviceRoleBearerHeader: () => ({}),
      getEnv: () => enableValue,
      captureException: noCapture,
    });

    const response = await handler(jsonRequest({}));
    assertEquals(response.status, 423);
    assertEquals(rpcCount, 0);
    assertEquals(invokeCount, 0);
  }
});

Deno.test("db-cleanup dry-run performs count reads without RPC or function mutation", async () => {
  const tables: string[] = [];
  let rpcCount = 0;
  let invokeCount = 0;
  const handler = createDbCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => ({
      from: (table: string) => {
        tables.push(table);
        const terminal = {
          lt: async () => await Promise.resolve({ count: 2 }),
        };
        return {
          select: () => ({
            ...terminal,
            in: () => terminal,
          }),
        };
      },
      rpc: async () => {
        rpcCount += 1;
        return await Promise.resolve({ data: null, error: null });
      },
      functions: {
        invoke: async () => {
          invokeCount += 1;
          return await Promise.resolve({ data: null, error: null });
        },
      },
    }),
    requireInternalAuth: noAuthError,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => undefined,
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({ dry_run: true }));
  assertEquals(response.status, 200);
  assertEquals(tables, ["pipeline_events", "jobs"]);
  assertEquals(rpcCount, 0);
  assertEquals(invokeCount, 0);
});

Deno.test("db-cleanup does not claim success when nested media cleanup fails", async () => {
  const handler = createDbCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => ({
      from: () => {
        throw new Error("unexpected db read");
      },
      rpc: async () => await Promise.resolve({ data: { deleted: 2 }, error: null }),
      functions: {
        invoke: async () => await Promise.resolve({
          data: null,
          error: new Error("media processor unavailable"),
        }),
      },
    }),
    requireInternalAuth: noAuthError,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => "true",
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({}));
  assertEquals(response.status, 500);
});

Deno.test("db-cleanup rejects a malformed primary cleanup RPC response", async () => {
  const handler = createDbCleanupHandler({
    corsHeaders: headers,
    createSupabase: () => ({
      from: () => {
        throw new Error("unexpected db read");
      },
      rpc: async () => await Promise.resolve({ data: null, error: null }),
      functions: {
        invoke: async () => await Promise.resolve({ data: { ok: true }, error: null }),
      },
    }),
    requireInternalAuth: noAuthError,
    serviceRoleBearerHeader: () => ({}),
    getEnv: () => "true",
    captureException: noCapture,
  });

  const response = await handler(jsonRequest({}));
  assertEquals(response.status, 500);
});
