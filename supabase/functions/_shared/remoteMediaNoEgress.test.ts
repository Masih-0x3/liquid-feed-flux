import assert from "node:assert/strict";
import {
  fetchReviewedRemoteJson,
  fetchReviewedRemoteMedia,
  MAX_REMOTE_MEDIA_BYTES,
  MAX_REMOTE_MEDIA_URL_LENGTH,
  MAX_REVIEWED_REMOTE_JSON_BYTES,
  type RemoteMediaDnsResolver,
  type RemoteMediaFetch,
} from "./remoteMediaPolicy.ts";

type Counters = {
  allowed: number;
  forbidden: number;
  nativeFetch: number;
  nativeDns: number;
  pendingInjectedResources: number;
  requestUrls: string[];
};

const PUBLIC_A = "93.184.216.34";
const PUBLIC_AAAA = "2606:2800:220:1:248:1893:25c8:1946";
const MEDIA_URL = "https://pbs.twimg.com/media/no-egress.png";
const JSON_URL = "https://api.fxtwitter.com/status/123";

function mediaPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function mediaBlob(): Blob {
  return new Blob([mediaPng().buffer as ArrayBuffer]);
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });
}

function counters(): Counters {
  return { allowed: 0, forbidden: 0, nativeFetch: 0, nativeDns: 0, pendingInjectedResources: 0, requestUrls: [] };
}

function publicResolver(calls: string[] = []): RemoteMediaDnsResolver {
  return async (hostname, recordType) => {
    calls.push(`${hostname}:${recordType}`);
    return recordType === "A" ? [PUBLIC_A] : [PUBLIC_AAAA];
  };
}

const REVIEWED_FETCH_HOSTS = new Set([
  "pbs.twimg.com",
  "video.twimg.com",
  "api.fxtwitter.com",
  "api.vxtwitter.com",
  "api.x.com",
]);

function countingFetch(
  state: Counters,
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async (input) => {
    throw new Error(`unexpected injected fetch: ${String(input)}`);
  },
): RemoteMediaFetch {
  return async (input, init) => {
    const url = new URL(String(input));
    state.requestUrls.push(url.toString());
    if (REVIEWED_FETCH_HOSTS.has(url.hostname)) state.allowed += 1;
    else state.forbidden += 1;
    state.pendingInjectedResources += 1;
    try {
      return await handler(input, init);
    } finally {
      state.pendingInjectedResources -= 1;
    }
  };
}

async function expectPolicyCode(
  expectedCode: string,
  operation: () => Promise<unknown>,
  label: string,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => (error as { code?: string })?.code === expectedCode,
    `${label}: expected ${expectedCode}`,
  );
}

async function expectForbidden(
  label: string,
  expectedCode: string,
  state: Counters,
  operation: () => Promise<unknown>,
): Promise<void> {
  await expectPolicyCode(expectedCode, operation, label);
  assert.equal(state.forbidden, 0, `${label}: forbidden fetch count must remain zero`);
}

async function expectAllowedFailure(
  label: string,
  expectedCode: string,
  state: Counters,
  operation: () => Promise<unknown>,
  expectedAllowed = 1,
): Promise<void> {
  const beforeAllowed = state.allowed;
  await expectPolicyCode(expectedCode, operation, label);
  assert.equal(state.allowed - beforeAllowed, expectedAllowed, `${label}: allowed simulated fetch count must be exact`);
  assert.equal(state.forbidden, 0, `${label}: forbidden fetch count must remain zero`);
}

function restoreDescriptor(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

function defineDescriptorValue(target: object, key: PropertyKey, descriptor: PropertyDescriptor, value: unknown): void {
  if ("value" in descriptor || "writable" in descriptor) {
    Object.defineProperty(target, key, { ...descriptor, value });
  } else {
    Object.defineProperty(target, key, { ...descriptor, get: () => value });
  }
}

function assertDescriptorRestored(target: object, key: PropertyKey, before: PropertyDescriptor | undefined): void {
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(target, key),
    before,
    `${String(key)} property descriptor must be restored exactly`,
  );
}

async function withRuntimeGuards<T>(operation: (state: Counters) => Promise<T>): Promise<T> {
  const state = counters();
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const dnsDescriptor = Object.getOwnPropertyDescriptor(Deno, "resolveDns");
  const originalFetch = globalThis.fetch;
  const originalResolveDns = Deno.resolveDns;
  assert.ok(fetchDescriptor && dnsDescriptor, "fetch and DNS descriptors must be present");
  defineDescriptorValue(globalThis, "fetch", fetchDescriptor, async () => {
    state.nativeFetch += 1;
    throw new Error("native fetch escape");
  });
  defineDescriptorValue(Deno, "resolveDns", dnsDescriptor, async () => {
      state.nativeDns += 1;
      throw new Error("native DNS escape");
  });
  try {
    return await operation(state);
  } finally {
    restoreDescriptor(globalThis, "fetch", fetchDescriptor);
    restoreDescriptor(Deno, "resolveDns", dnsDescriptor);
    assert.equal(globalThis.fetch, originalFetch, "global fetch identity must be restored");
    assert.equal(Deno.resolveDns, originalResolveDns, "native resolver identity must be restored");
    assertDescriptorRestored(globalThis, "fetch", fetchDescriptor);
    assertDescriptorRestored(Deno, "resolveDns", dnsDescriptor);
    assert.equal(state.nativeFetch, 0, "native/global fetch must never be reached");
    assert.equal(state.nativeDns, 0, "native/global DNS must never be reached");
    assert.equal(state.pendingInjectedResources, 0, "injected fetch resources must be fully settled");
  }
}

async function withFastTimers<T>(operation: () => Promise<T>): Promise<T> {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
  const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
  assert.ok(setTimeoutDescriptor && clearTimeoutDescriptor, "timer descriptors must be present");
  const active = new Set<unknown>();
  const fastSetTimeout = (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const handle = originalSetTimeout(
      callback,
      (delay ?? 0) >= 1_000 ? 5 : delay,
      ...args,
    );
    active.add(handle);
    return handle;
  };
  const trackedClearTimeout = (handle: Parameters<typeof clearTimeout>[0]) => {
    active.delete(handle);
    originalClearTimeout(handle as never);
  };
  defineDescriptorValue(globalThis, "setTimeout", setTimeoutDescriptor, fastSetTimeout);
  defineDescriptorValue(globalThis, "clearTimeout", clearTimeoutDescriptor, trackedClearTimeout);
  try {
    return await operation();
  } finally {
    for (const handle of active) originalClearTimeout(handle as never);
    active.clear();
    restoreDescriptor(globalThis, "setTimeout", setTimeoutDescriptor);
    restoreDescriptor(globalThis, "clearTimeout", clearTimeoutDescriptor);
    assert.equal(globalThis.setTimeout, originalSetTimeout, "setTimeout identity must be restored");
    assert.equal(globalThis.clearTimeout, originalClearTimeout, "clearTimeout identity must be restored");
    assertDescriptorRestored(globalThis, "setTimeout", setTimeoutDescriptor);
    assertDescriptorRestored(globalThis, "clearTimeout", clearTimeoutDescriptor);
    assert.equal(active.size, 0, "accelerated policy timers must be torn down");
  }
}

Deno.test("remote media capsule has zero egress for forbidden targets", async () => {
  await withRuntimeGuards(async (state) => {
    const forbidden = [
      ["http://127.0.0.1/a.png", "remote_media_url_scheme_blocked"],
      ["https://127.0.0.1/a.png", "remote_media_url_host_blocked"],
      ["https://10.0.0.1/a.png", "remote_media_url_host_blocked"],
      ["https://172.16.0.1/a.png", "remote_media_url_host_blocked"],
      ["https://192.168.1.1/a.png", "remote_media_url_host_blocked"],
      ["https://169.254.169.254/latest/meta-data", "remote_media_url_host_blocked"],
      ["https://255.255.255.255/a.png", "remote_media_url_host_blocked"],
      ["https://2130706433/a.png", "remote_media_url_host_blocked"],
      ["https://0x7f000001/a.png", "remote_media_url_host_blocked"],
      ["https://0x7f.0.0.1/a.png", "remote_media_url_host_blocked"],
      ["https://127.1/a.png", "remote_media_url_host_blocked"],
      ["https://0177.0.0.1/a.png", "remote_media_url_host_blocked"],
      ["https://[::1]/a.png", "remote_media_url_host_blocked"],
      ["https://[fe80::1]/a.png", "remote_media_url_host_blocked"],
      ["https://pbs.twimg.com.evil.example/a.png", "remote_media_url_host_blocked"],
      ["https://pbs.twimg.com:444/a.png", "remote_media_url_port_blocked"],
      ["https://pbs.twimg.com/a.png#fragment", "remote_media_url_fragment_blocked"],
    ] as const;
    for (const [url, code] of forbidden) {
      await expectForbidden(
        url,
        code,
        state,
        () => fetchReviewedRemoteMedia(url, countingFetch(state), publicResolver()),
      );
    }

    const dnsCases = [
      ["127.0.0.1", "remote_dns_non_public"],
      ["", "remote_dns_no_records"],
    ] as const;
    for (const [record, code] of dnsCases) {
      const resolver: RemoteMediaDnsResolver = async (_host, recordType) =>
        recordType === "A" ? (record ? [record] : []) : [];
      await expectForbidden(
        `DNS ${code}`,
        code,
        state,
        () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state), resolver),
      );
    }
    await expectForbidden(
      "malformed DNS result",
      "remote_dns_result_invalid",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state), async () => [123 as unknown as string]),
    );
    await expectForbidden(
      "resolver error",
      "remote_dns_resolution_failed",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state), async () => { throw new Error("resolver"); }),
    );

    const redirectCalls: string[] = [];
    const redirects = await fetchReviewedRemoteMedia(
      MEDIA_URL,
      countingFetch(state, async (input) => {
        redirectCalls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }),
      publicResolver(),
    ).catch((error) => error);
    assert.equal((redirects as { code?: string }).code, "remote_media_url_host_blocked");
    assert.deepEqual(redirectCalls, [MEDIA_URL], "redirect-to-private must use exactly one allowed simulated fetch hop");
    assert.equal(state.allowed, 1, "redirect-to-private allowed fetch count must be exact");
    assert.equal(state.forbidden, 0, "redirected forbidden target must never be fetched");

    for (const location of ["https://2130706433/secret", "https://[fe80::1]/secret"]) {
      const calls: string[] = [];
      const beforeAllowed = state.allowed;
      const result = await fetchReviewedRemoteMedia(
        MEDIA_URL,
        countingFetch(state, async (input) => {
          calls.push(String(input));
          return new Response(null, { status: 302, headers: { location } });
        }),
        publicResolver(),
      ).catch((error) => error);
      assert.equal((result as { code?: string }).code, "remote_media_url_host_blocked");
      assert.deepEqual(calls, [MEDIA_URL], `redirect target ${location} must not reach a second fetch hop`);
      assert.equal(state.allowed - beforeAllowed, 1, `redirect target ${location} must have exactly one allowed hop`);
      assert.equal(state.forbidden, 0, `redirect target ${location} must keep forbidden count zero`);
    }
  });
});

Deno.test("remote media capsule enforces redirect, body, encoding, MIME and timeout boundaries", async () => {
  await withRuntimeGuards(async (state) => {
    const hops: string[] = [];
    const rebindCalls: string[] = [];
    const resolverCalls = new Map<string, number>();
    await expectPolicyCode(
      "remote_dns_non_public",
      () => fetchReviewedRemoteMedia(
        MEDIA_URL,
        countingFetch(state, async (input) => {
          rebindCalls.push(String(input));
          return new Response(null, {
            status: 302,
            headers: { location: MEDIA_URL },
          });
        }),
        async (host, type) => {
          const callsForHost = (resolverCalls.get(host) ?? 0) + 1;
          resolverCalls.set(host, callsForHost);
          hops.push(`${host}:${type}:${callsForHost}`);
          return callsForHost <= 2
            ? (type === "A" ? [PUBLIC_A] : [PUBLIC_AAAA])
            : (type === "A" ? ["10.0.0.1"] : []);
        },
      ),
      "DNS rebinding representation across redirect hops",
    );
    assert.deepEqual(rebindCalls, [MEDIA_URL], "DNS rebound must not reach a second forbidden fetch hop");
    assert.equal(state.allowed, 1, "DNS rebound must have exactly one allowed simulated fetch");
    assert.equal(state.nativeFetch, 0);
    assert.deepEqual([...resolverCalls.values()], [4], "A and AAAA must be rechecked on the rebound hop");
    assert.ok(hops.some((entry) => entry.endsWith(":1")), "first DNS hop must be observed");

    let mediaAllowedCalls = 0;
    const mediaOk = await fetchReviewedRemoteMedia(
      MEDIA_URL,
      countingFetch(state, async () => {
        mediaAllowedCalls += 1;
        return new Response(mediaBlob(), { headers: { "content-type": "image/png" } });
      }),
      publicResolver(),
    );
    assert.equal(mediaOk.contentType, "image/png");
    assert.equal(mediaAllowedCalls, 1, "allowed media fetch must run exactly once");

    let redirectCount = 0;
    await expectAllowedFailure(
      "bounded redirect chain",
      "remote_media_redirect_limit_exceeded",
      state,
      () => fetchReviewedRemoteMedia(
        MEDIA_URL,
        countingFetch(state, async () => {
          redirectCount += 1;
          return new Response(null, { status: 302, headers: { location: MEDIA_URL } });
        }),
        publicResolver(),
      ),
      4,
    );
    assert.equal(redirectCount, 4, "redirect chain must stop at the configured maximum");

    await expectAllowedFailure(
      "declared oversized media",
      "remote_media_content_length_exceeded",
      state,
      () => fetchReviewedRemoteMedia(
        MEDIA_URL,
        countingFetch(state, async () => new Response(mediaBlob(), {
          headers: { "content-type": "image/png", "content-length": String(MAX_REMOTE_MEDIA_BYTES + 1) },
        })),
        publicResolver(),
      ),
    );
    let cancelled = 0;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_REMOTE_MEDIA_BYTES + 1)); },
      cancel() { cancelled += 1; },
    });
    await expectAllowedFailure(
      "streamed oversized media",
      "remote_media_body_exceeded",
      state,
      () => fetchReviewedRemoteMedia(
        MEDIA_URL,
        countingFetch(state, async () => new Response(oversized, { headers: { "content-type": "image/png" } })),
        publicResolver(),
      ),
    );
    assert.equal(cancelled, 1, "streamed oversized media must cancel its reader");

    await expectAllowedFailure(
      "compressed media",
      "remote_media_content_encoding_blocked",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async () => new Response(mediaBlob(), {
        headers: { "content-type": "image/png", "content-encoding": "gzip" },
      })), publicResolver()),
    );
    await expectAllowedFailure(
      "media MIME mismatch",
      "remote_media_content_type_blocked",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async () => new Response(mediaBlob(), {
        headers: { "content-type": "text/html" },
      })), publicResolver()),
    );
    await expectAllowedFailure(
      "media magic mismatch",
      "remote_media_magic_mismatch",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async () => new Response(mediaBlob(), {
        headers: { "content-type": "image/jpeg" },
      })), publicResolver()),
    );
    await expectAllowedFailure(
      "simulated certificate/TLS fetch failure",
      "remote_media_fetch_failed",
      state,
      () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async () => { throw new Error("simulated certificate/TLS failure"); }), publicResolver()),
    );

    await withFastTimers(async () => {
      await expectAllowedFailure(
        "slow TTFB timeout",
        "remote_media_fetch_timeout",
        state,
        () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async (_input, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        })), publicResolver()),
      );

      let activeAbortListeners = 0;
      await expectAllowedFailure(
        "slow body total timeout",
        "remote_media_fetch_timeout",
        state,
        () => fetchReviewedRemoteMedia(MEDIA_URL, countingFetch(state, async (_input, init) => {
          const signal = init?.signal;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              activeAbortListeners += 1;
              signal?.addEventListener("abort", () => {
                activeAbortListeners -= 1;
                controller.error(new DOMException("aborted", "AbortError"));
              }, { once: true });
            },
          });
          return new Response(body, { headers: { "content-type": "image/png" } });
        }), publicResolver()),
      );
      assert.equal(activeAbortListeners, 0, "total-timeout body abort listener must be removed");
    });
    assert.equal(state.forbidden, 0, "timeout fixture must not invoke a forbidden fetch");
  });
});

Deno.test("remote JSON capsule uses the same no-egress boundary and tears down total timeout", async () => {
  await withRuntimeGuards(async (state) => {
    const resolver = publicResolver();
    const ok = await fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
      resolveDns: resolver,
      fetchImpl: countingFetch(state, async (input, init) => {
        assert.equal(new URL(String(input)).hostname, "api.fxtwitter.com");
        assert.equal(init?.redirect, "error");
        assert.equal(new Headers(init?.headers).get("accept-encoding"), "identity");
        return jsonResponse({ tweet: { media: [] } });
      }),
    });
    assert.deepEqual(ok.body, { tweet: { media: [] } });
    assert.equal(state.allowed, 1, "allowed JSON fetch must run exactly once");

    await expectForbidden(
      "JSON invalid port",
      "remote_json_url_port_blocked",
      state,
      () => fetchReviewedRemoteJson("fxtwitter", "https://api.fxtwitter.com:444/status/123", {
        resolveDns: resolver,
        fetchImpl: countingFetch(state),
      }),
    );
    await expectAllowedFailure(
      "JSON redirect",
      "remote_json_redirect_blocked",
      state,
      () => fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
        resolveDns: resolver,
        fetchImpl: countingFetch(state, async () => new Response(null, { status: 302, headers: { location: "https://example.com" } })),
      }),
    );
    await expectAllowedFailure(
      "JSON compressed encoding",
      "remote_json_content_encoding_blocked",
      state,
      () => fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
        resolveDns: resolver,
        fetchImpl: countingFetch(state, async () => jsonResponse({}, { "content-encoding": "gzip" })),
      }),
    );
    await expectAllowedFailure(
      "JSON MIME mismatch",
      "remote_json_content_type_blocked",
      state,
      () => fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
        resolveDns: resolver,
        fetchImpl: countingFetch(state, async () => new Response("{}", { headers: { "content-type": "text/plain" } })),
      }),
    );
    await expectAllowedFailure(
      "JSON oversized declaration",
      "remote_json_content_length_exceeded",
      state,
      () => fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
        resolveDns: resolver,
        fetchImpl: countingFetch(state, async () => jsonResponse({}, { "content-length": String(MAX_REVIEWED_REMOTE_JSON_BYTES + 1) })),
      }),
    );

    await withFastTimers(async () => {
      await expectAllowedFailure(
        "JSON total/TTFB timeout",
        "remote_json_fetch_timeout",
        state,
        () => fetchReviewedRemoteJson("fxtwitter", JSON_URL, {
          resolveDns: resolver,
          fetchImpl: countingFetch(state, async (_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          })),
        }),
      );
    });
    assert.equal(state.forbidden, 0, "JSON forbidden request count must remain zero");
  });
});
