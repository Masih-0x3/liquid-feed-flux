import { assertEquals, assertRejects } from "jsr:@std/assert";
import { ExternalPostingBlockedError } from "../_shared/externalPostingGuard.ts";

const originalServe = Deno.serve;
Deno.serve = (() => undefined) as typeof Deno.serve;
let guardedExternalProviderFetch: typeof import("./index.ts").guardedExternalProviderFetch;
try {
  ({ guardedExternalProviderFetch } = await import("./index.ts"));
} finally {
  Deno.serve = originalServe;
}

const PREVIEW_CONTROLS = {
  singleton_id: true,
  environment: "preview",
  dedupe_enabled: false,
  translation_enabled: false,
  posting_mode: "blocked",
  updated_at: "2026-08-12T12:00:00.000Z",
  updated_by: null,
} as const;

const PRODUCTION_CONTROLS = {
  singleton_id: true,
  environment: "production",
  dedupe_enabled: true,
  translation_enabled: true,
  posting_mode: "enabled",
  updated_at: "2026-08-12T12:00:00.000Z",
  updated_by: "00000000-0000-4000-8000-000000000001",
} as const;

function controlsClient(row: unknown) {
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

Deno.test("X provider guard blocks preview before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("unexpected");
  };
  try {
    await assertRejects(
      () => guardedExternalProviderFetch(
        controlsClient(PREVIEW_CONTROLS),
        "https://api.x.test/2/tweets",
        { method: "POST" },
        { environment: "preview", allowExternalPosting: "true" },
      ),
      ExternalPostingBlockedError,
      "external posting is blocked",
    );
    assertEquals(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("X provider guard permits production only after every condition passes", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ data: { id: "123" } }), { status: 200 });
  };
  try {
    const response = await guardedExternalProviderFetch(
      controlsClient(PRODUCTION_CONTROLS),
      "https://api.x.test/2/tweets",
      { method: "POST" },
      { environment: "production", allowExternalPosting: "true" },
    );
    assertEquals(response.status, 200);
    assertEquals(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("X provider guard blocks missing or malformed controls before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response("unexpected");
  };
  try {
    for (const controls of [null, [{ ...PRODUCTION_CONTROLS, posting_mode: "invalid" }]]) {
      await assertRejects(
        () => guardedExternalProviderFetch(
          controlsClient(controls),
          "https://api.x.test/2/tweets",
          { method: "POST" },
          { environment: "production", allowExternalPosting: "true" },
        ),
        ExternalPostingBlockedError,
        "external posting is blocked",
      );
    }
    assertEquals(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
