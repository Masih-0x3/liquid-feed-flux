import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { StaleMediaObjectError } from "../_shared/staleMediaRepair.ts";
import { TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES } from "../_shared/telegramVideoLimits.ts";
import {
  ExternalPostingBlockedError,
  requireExternalPosting,
} from "../_shared/externalPostingGuard.ts";
import { NonRetryableJobError } from "./jobLifecycle.ts";
import {
  computeAdaptiveSpacing,
  getMediaUrl,
  sendTelegramMedia,
  sendTelegramPhotoFromStorage,
  sendTelegramPhotoGroupFromStorage,
  sendTelegramVideoFromStorage,
} from "./telegramDelivery.ts";

type FetchCall = {
  input: string;
  init?: RequestInit;
  body?: Record<string, unknown>;
};

type MockFetchResponse = {
  status?: number;
  body: Record<string, unknown>;
  error?: Error;
};

const allowProviderCall = async () => {};

function runtimeControlsClient(row: unknown) {
  return {
    from() {
      return {
        select() {
          return Promise.resolve({ data: [row], error: null });
        },
      };
    },
  };
}

function createStorageSupabase(options: {
  signedUrl?: string | null;
  signedUrlThrows?: boolean;
  downloadBlob?: Blob;
  downloadErrorMessage?: string;
} = {}) {
  const calls: Array<{ action: string; path: string }> = [];
  return {
    calls,
    storage: {
      from(bucket: string) {
        assertEquals(bucket, "temp-media");
        return {
          createSignedUrl(path: string, expiresIn: number) {
            calls.push({ action: `sign:${expiresIn}`, path });
            if (options.signedUrlThrows) throw new Error("sign_failed");
            return Promise.resolve({
              data: options.signedUrl ? { signedUrl: options.signedUrl } : null,
              error: null,
            });
          },
          download(path: string) {
            calls.push({ action: "download", path });
            return Promise.resolve({
              data: options.downloadBlob ?? null,
              error: options.downloadBlob ? null : { message: options.downloadErrorMessage ?? "missing" },
            });
          },
        };
      },
    },
  };
}

function createSpacingSupabase(options: { count?: number; throws?: boolean }) {
  const calls: Array<{ action: string; value?: unknown }> = [];
  return {
    calls,
    from(table: string) {
      calls.push({ action: "from", value: table });
      const builder = {
        select(columns: string, selectOptions: unknown) {
          calls.push({ action: "select", value: { columns, selectOptions } });
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push({ action: `eq:${column}`, value });
          return builder;
        },
        gte(column: string, value: unknown) {
          calls.push({ action: `gte:${column}`, value });
          return builder;
        },
        ilike(column: string, value: unknown) {
          calls.push({ action: `ilike:${column}`, value });
          if (options.throws) throw new Error("query_failed");
          return Promise.resolve({ count: options.count ?? 0, error: null });
        },
      };
      return builder;
    },
  };
}

async function withMockFetch<T>(
  responses: MockFetchResponse[],
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  let index = 0;
  globalThis.fetch = (async (
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawBody = typeof init?.body === "string"
      ? JSON.parse(init.body)
      : undefined;
    calls.push({ input: String(input), init, body: rawBody });
    const response = responses[index++] ??
      { status: 500, body: { ok: false, description: "unexpected fetch" } };
    if (response.error) throw response.error;
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("getMediaUrl returns signed storage URL when signing succeeds", async () => {
  const supabase = createStorageSupabase({
    signedUrl: "https://signed.example/photo.jpg",
  });

  const url = await getMediaUrl(supabase, {
    storage_path: "media/photo.jpg",
    src_url: "https://origin.example/photo.jpg",
  });

  assertEquals(url, "https://signed.example/photo.jpg");
  assertEquals(supabase.calls, [{
    action: "sign:3600",
    path: "media/photo.jpg",
  }]);
});

Deno.test("getMediaUrl blocks raw source fallback when signing fails", async () => {
  const supabase = createStorageSupabase({ signedUrlThrows: true });

  await assertRejects(
    () => getMediaUrl(supabase, {
      storage_path: "media/photo.jpg",
      src_url: "https://origin.example/photo.jpg",
    }),
    Error,
    "telegram_signed_media_url_unavailable",
  );
});

Deno.test("sendTelegramMedia retries Markdown parse failures as plain text", async () => {
  await withMockFetch([
    {
      status: 400,
      body: {
        ok: false,
        description: "Bad Request: can't parse entities",
      },
    },
    { body: { ok: true, result: { message_id: 42 } } },
  ], async (calls) => {
    const ids = await sendTelegramMedia(
      "sendAudio",
      "token",
      "chat",
      { audio: "https://example.com/audio.mp3" },
      "*bold* [source](https://x.com/post)",
      allowProviderCall,
    );

    assertEquals(ids, ["42"]);
    assertEquals(calls.length, 2);
    assertEquals(calls[0].body?.parse_mode, "Markdown");
    assertEquals(calls[0].body?.caption, "*bold* [source](https://x.com/post)");
    assertEquals(calls[1].body?.parse_mode, undefined);
    assertEquals(calls[1].body?.caption, "bold source https://x com/post");
  });
});

Deno.test("sendTelegramPhotoFromStorage returns the fallback success id", async () => {
  const supabase = createStorageSupabase({
    downloadBlob: new Blob(["photo"], { type: "image/jpeg" }),
  });

  await withMockFetch([
    {
      status: 400,
      body: { ok: false, description: "Bad Request: can't parse entities" },
    },
    { body: { ok: true, result: { message_id: 43 } } },
  ], async (calls) => {
    const ids = await sendTelegramPhotoFromStorage(
      supabase,
      "token",
      "chat",
      { id: "photo-1", storage_path: "media/photo.jpg", mime_type: "image/jpeg" },
      "*caption*",
      allowProviderCall,
    );

    assertEquals(ids, ["43"]);
    assertEquals(calls.length, 2);
  });
});

Deno.test("sendTelegramPhotoGroupFromStorage returns fallback success ids", async () => {
  const supabase = createStorageSupabase({
    downloadBlob: new Blob(["photo"], { type: "image/jpeg" }),
  });

  await withMockFetch([
    {
      status: 400,
      body: { ok: false, description: "Bad Request: can't parse entities" },
    },
    { body: { ok: true, result: [{ message_id: 44 }, { message_id: 45 }] } },
  ], async (calls) => {
    const ids = await sendTelegramPhotoGroupFromStorage(
      supabase,
      "token",
      "chat",
      [
        { id: "photo-1", storage_path: "media/photo-1.jpg", mime_type: "image/jpeg" },
        { id: "photo-2", storage_path: "media/photo-2.jpg", mime_type: "image/jpeg" },
      ],
      "*caption*",
      allowProviderCall,
    );

    assertEquals(ids, ["44", "45"]);
    assertEquals(calls.length, 2);
  });
});

Deno.test("sendTelegramVideoFromStorage returns the fallback success id", async () => {
  const supabase = createStorageSupabase({
    downloadBlob: new Blob(["video"], { type: "video/mp4" }),
  });

  await withMockFetch([
    {
      status: 400,
      body: { ok: false, description: "Bad Request: can't parse entities" },
    },
    { body: { ok: true, result: { message_id: 46 } } },
  ], async (calls) => {
    const ids = await sendTelegramVideoFromStorage(
      supabase,
      "token",
      "chat",
      { id: "video-1", storage_path: "media/video.mp4", mime_type: "video/mp4" },
      "*caption*",
      allowProviderCall,
    );

    assertEquals(ids, ["46"]);
    assertEquals(calls.length, 2);
  });
});

Deno.test("sendTelegramMedia classifies a fallback rate limit from the final response", async () => {
  await withMockFetch([
    {
      status: 400,
      body: {
        ok: false,
        description: "Bad Request: can't parse entities",
      },
    },
    {
      status: 429,
      body: {
        ok: false,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 },
      },
    },
  ], async (calls) => {
    let thrown: unknown;
    try {
      await sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "*caption*",
        allowProviderCall,
      );
    } catch (error) {
      thrown = error;
    }

    assertEquals(calls.length, 2);
    assert(thrown instanceof Error);
    assertEquals((thrown as Error).name, "TelegramRateLimitError");
    assertEquals(
      (thrown as { retryAfterSeconds?: number }).retryAfterSeconds,
      7,
    );
    assert((thrown as Error).message.includes("retry after 7"));
  });
});

Deno.test("sendTelegramMedia reports a fallback server error from the final response", async () => {
  await withMockFetch([
    {
      status: 400,
      body: {
        ok: false,
        description: "Bad Request: can't parse entities",
      },
    },
    {
      status: 500,
      body: {
        ok: false,
        description: "Internal Server Error: final attempt failed",
      },
    },
  ], async (calls) => {
    let thrown: unknown;
    try {
      await sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "*caption*",
        allowProviderCall,
      );
    } catch (error) {
      thrown = error;
    }

    assertEquals(calls.length, 2);
    assert(thrown instanceof Error);
    assertEquals((thrown as Error).name, "Error");
    assert((thrown as Error).message.includes("status 500"));
    assertEquals((thrown as Error).message.includes("final attempt failed"), false);
  });
});

Deno.test("sendTelegramMedia propagates a network throw from the fallback attempt", async () => {
  const retryError = new Error("telegram retry network failed");

  await withMockFetch([
    {
      status: 400,
      body: {
        ok: false,
        description: "Bad Request: can't parse entities",
      },
    },
    { body: {}, error: retryError },
  ], async (calls) => {
    const thrown = await assertRejects(
      () => sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "*caption*",
        allowProviderCall,
      ),
      Error,
      "telegram retry network failed",
    );

    assertEquals(thrown, retryError);
    assertEquals(calls.length, 2);
    assertEquals(calls[1].body?.parse_mode, undefined);
  });
});

Deno.test("sendTelegramMedia throws TelegramRateLimitError with retry-after", async () => {
  await withMockFetch([
    {
      status: 429,
      body: {
        ok: false,
        description: "Too Many Requests: retry after 9",
        parameters: { retry_after: 9 },
      },
    },
  ], async () => {
    let thrown: unknown;
    try {
      await sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "caption",
        allowProviderCall,
      );
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error);
    assertEquals((thrown as Error).name, "TelegramRateLimitError");
    assertEquals(
      (thrown as { retryAfterSeconds?: number }).retryAfterSeconds,
      9,
    );
  });
});

Deno.test("sendTelegramVideoFromStorage rejects declared oversized videos before download", async () => {
  const supabase = createStorageSupabase({
    downloadBlob: new Blob(["small"], { type: "video/mp4" }),
  });
  let thrown: unknown;

  try {
    await sendTelegramVideoFromStorage(
      supabase,
      "token",
      "chat",
      {
        storage_path: "media/video.mp4",
        file_size: TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES + 1,
        mime_type: "video/mp4",
      },
      "caption",
      allowProviderCall,
    );
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof NonRetryableJobError);
  assertEquals(
    (thrown as Error).message,
    "telegram_video_too_large_for_bot_api:50MB>50MB",
  );
  assertEquals(supabase.calls.length, 0);
});

Deno.test("sendTelegramVideoFromStorage throws repairable stale media error when storage object is missing", async () => {
  const supabase = createStorageSupabase({
    downloadErrorMessage: "Object not found",
  });
  let thrown: unknown;

  try {
    await sendTelegramVideoFromStorage(
      supabase,
      "token",
      "chat",
      {
        id: "media-1",
        storage_path: "2026/6/tweet_0.mp4",
        mime_type: "video/mp4",
      },
      "caption",
      allowProviderCall,
    );
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof StaleMediaObjectError);
  assertEquals((thrown as StaleMediaObjectError).storagePath, "2026/6/tweet_0.mp4");
  assertEquals((thrown as StaleMediaObjectError).mediaId, "media-1");
  assertEquals(supabase.calls, [{ action: "download", path: "2026/6/tweet_0.mp4" }]);
});

Deno.test("computeAdaptiveSpacing preserves current zero-or-fallback behavior", async () => {
  assertEquals(
    await computeAdaptiveSpacing(createSpacingSupabase({ count: 0 })),
    800,
  );
  assertEquals(
    await computeAdaptiveSpacing(createSpacingSupabase({ count: 1 })),
    1500,
  );
  assertEquals(
    await computeAdaptiveSpacing(createSpacingSupabase({ count: 3 })),
    1500,
  );
  assertEquals(
    await computeAdaptiveSpacing(createSpacingSupabase({ throws: true })),
    1500,
  );
});

Deno.test("Telegram provider callback blocks before the first request", async () => {
  let guardCalls = 0;
  await withMockFetch([], async (calls) => {
    await assertRejects(
      () => sendTelegramMedia(
        "sendAudio",
        "token",
        "chat",
        { audio: "https://example.com/audio.mp3" },
        "caption",
        async () => {
          guardCalls += 1;
          throw new Error("external_posting_blocked");
        },
      ),
      Error,
      "external_posting_blocked",
    );
    assertEquals(guardCalls, 1);
    assertEquals(calls.length, 0);
  });
});

Deno.test("Telegram provider guard blocks malformed strict controls before the first request", async () => {
  const controls = {
    singleton_id: true,
    environment: "production",
    dedupe_enabled: true,
    translation_enabled: true,
    posting_mode: "enabled",
    updated_at: "not-a-date",
    updated_by: null,
  };
  const guard = () => requireExternalPosting(
    runtimeControlsClient(controls),
    { environment: "production", allowExternalPosting: "true" },
  );

  await withMockFetch([], async (calls) => {
    await assertRejects(
      () => sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "caption",
        guard,
      ),
      ExternalPostingBlockedError,
      "external posting is blocked",
    );
    assertEquals(calls.length, 0);
  });
});

Deno.test("Telegram parse retry calls the provider guard again", async () => {
  let guardCalls = 0;
  await withMockFetch([
    { status: 400, body: { ok: false, description: "Bad Request: can't parse entities" } },
  ], async (calls) => {
    await assertRejects(
      () => sendTelegramMedia(
        "sendPhoto",
        "token",
        "chat",
        { photo: "https://example.com/photo.jpg" },
        "*caption*",
        async () => {
          guardCalls += 1;
          if (guardCalls > 1) throw new Error("external_posting_blocked");
        },
      ),
      Error,
    );
    assertEquals(guardCalls, 2);
    assertEquals(calls.length, 1);
  });
});
