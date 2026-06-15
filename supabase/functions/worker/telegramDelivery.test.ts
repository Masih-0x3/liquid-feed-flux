import { assert, assertEquals } from "jsr:@std/assert";
import { TELEGRAM_BOT_VIDEO_UPLOAD_MAX_BYTES } from "../_shared/telegramVideoLimits.ts";
import { NonRetryableJobError } from "./jobLifecycle.ts";
import {
  computeAdaptiveSpacing,
  getMediaUrl,
  sendTelegramMedia,
  sendTelegramVideoFromStorage,
} from "./telegramDelivery.ts";

type FetchCall = {
  input: string;
  init?: RequestInit;
  body?: Record<string, unknown>;
};

function createStorageSupabase(options: {
  signedUrl?: string | null;
  signedUrlThrows?: boolean;
  downloadBlob?: Blob;
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
              error: options.downloadBlob ? null : { message: "missing" },
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
  responses: Array<{ status?: number; body: Record<string, unknown> }>,
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

Deno.test("getMediaUrl falls back to source URL when signing fails", async () => {
  const supabase = createStorageSupabase({ signedUrlThrows: true });

  const url = await getMediaUrl(supabase, {
    storage_path: "media/photo.jpg",
    src_url: "https://origin.example/photo.jpg",
  });

  assertEquals(url, "https://origin.example/photo.jpg");
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
    );

    assertEquals(ids, ["42"]);
    assertEquals(calls.length, 2);
    assertEquals(calls[0].body?.parse_mode, "Markdown");
    assertEquals(calls[0].body?.caption, "*bold* [source](https://x.com/post)");
    assertEquals(calls[1].body?.parse_mode, undefined);
    assertEquals(calls[1].body?.caption, "bold source https://x com/post");
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
