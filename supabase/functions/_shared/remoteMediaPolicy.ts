export const REVIEWED_REMOTE_MEDIA_HOSTS = [
  "pbs.twimg.com",
  "video.twimg.com",
] as const;

export const REVIEWED_REMOTE_JSON_HOSTS = [
  "api.fxtwitter.com",
  "api.vxtwitter.com",
  "api.x.com",
] as const;

export const MAX_REMOTE_MEDIA_URL_LENGTH = 4_096;
export const MAX_REMOTE_MEDIA_ITEMS_PER_POST = 4;
export const MAX_REMOTE_MEDIA_CANDIDATES_PER_POST = 8;
export const MAX_REMOTE_MEDIA_REDIRECTS = 3;
export const MAX_REMOTE_MEDIA_BYTES = 50 * 1024 * 1024;
export const REMOTE_MEDIA_TTFB_TIMEOUT_MS = 10_000;
export const REMOTE_MEDIA_TOTAL_TIMEOUT_MS = 30_000;

export const MAX_REVIEWED_REMOTE_JSON_URL_LENGTH = 4_096;
export const MAX_REVIEWED_REMOTE_JSON_BYTES = 512 * 1024;
export const MAX_REVIEWED_REMOTE_JSON_ARRAY_ITEMS = 64;
export const MAX_REVIEWED_REMOTE_JSON_OBJECT_KEYS = 64;
export const MAX_REVIEWED_REMOTE_JSON_DEPTH = 16;
export const MAX_REVIEWED_REMOTE_JSON_NODES = 1_024;
export const MAX_REVIEWED_REMOTE_JSON_STRING_LENGTH = 64 * 1024;
export const REVIEWED_REMOTE_JSON_TTFB_TIMEOUT_MS = 10_000;
export const REVIEWED_REMOTE_JSON_TOTAL_TIMEOUT_MS = 20_000;

const REVIEWED_REMOTE_MEDIA_HOST_SET = new Set<string>(
  REVIEWED_REMOTE_MEDIA_HOSTS,
);

const REVIEWED_REMOTE_JSON_HOST_BY_PROVIDER = {
  fxtwitter: "api.fxtwitter.com",
  vxtwitter: "api.vxtwitter.com",
  x_api: "api.x.com",
} as const;

const REVIEWED_MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export type ReviewedRemoteMediaMime =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "video/mp4"
  | "video/webm"
  | "video/quicktime";

export type ReviewedRemoteJsonProvider =
  | keyof typeof REVIEWED_REMOTE_JSON_HOST_BY_PROVIDER;

export type RemoteMediaPolicyErrorCode =
  | "remote_media_url_invalid"
  | "remote_media_url_too_long"
  | "remote_media_url_scheme_blocked"
  | "remote_media_url_credentials_blocked"
  | "remote_media_url_port_blocked"
  | "remote_media_url_host_blocked"
  | "remote_media_url_fragment_blocked"
  | "remote_media_redirect_limit_exceeded"
  | "remote_media_redirect_location_missing"
  | "remote_media_redirect_location_too_long"
  | "remote_media_redirect_auto_follow_blocked"
  | "remote_media_fetch_timeout"
  | "remote_media_fetch_failed"
  | "remote_media_response_headers_invalid"
  | "remote_media_content_encoding_blocked"
  | "remote_media_content_length_invalid"
  | "remote_media_content_length_exceeded"
  | "remote_media_content_type_blocked"
  | "remote_media_response_body_missing"
  | "remote_media_body_read_failed"
  | "remote_media_body_exceeded"
  | "remote_media_magic_mismatch"
  | "remote_dns_unavailable"
  | "remote_dns_resolution_failed"
  | "remote_dns_no_records"
  | "remote_dns_result_invalid"
  | "remote_dns_non_public"
  | "remote_json_url_invalid"
  | "remote_json_url_too_long"
  | "remote_json_url_scheme_blocked"
  | "remote_json_url_credentials_blocked"
  | "remote_json_url_port_blocked"
  | "remote_json_url_host_blocked"
  | "remote_json_url_fragment_blocked"
  | "remote_json_authorization_invalid"
  | "remote_json_redirect_blocked"
  | "remote_json_fetch_timeout"
  | "remote_json_fetch_failed"
  | "remote_json_response_headers_invalid"
  | "remote_json_content_encoding_blocked"
  | "remote_json_content_length_invalid"
  | "remote_json_content_length_exceeded"
  | "remote_json_content_type_blocked"
  | "remote_json_response_body_missing"
  | "remote_json_body_read_failed"
  | "remote_json_body_exceeded"
  | "remote_json_body_text_invalid"
  | "remote_json_body_invalid"
  | "remote_json_shape_invalid";

export class RemoteMediaPolicyError extends Error {
  readonly code: RemoteMediaPolicyErrorCode;

  constructor(code: RemoteMediaPolicyErrorCode) {
    super(code);
    this.name = "RemoteMediaPolicyError";
    this.code = code;
  }
}

type UrlBearing = { url: unknown };

export type ReviewedRemoteMediaItems<T> = {
  accepted: T[];
  rejected: number;
};

export type ReviewedRemoteMediaResponse = {
  body: Uint8Array;
  contentType: ReviewedRemoteMediaMime;
  finalUrl: URL;
};

export type ReviewedRemoteJsonResponse = {
  body: unknown;
  response: Response;
  finalUrl: URL;
};

export type RemoteMediaFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RemoteMediaDnsRecordType = "A" | "AAAA";

export type RemoteMediaDnsResolver = (
  hostname: string,
  recordType: RemoteMediaDnsRecordType,
  options?: { signal?: AbortSignal },
) => Promise<string[]>;

type RemoteRequestTimeoutCode =
  | "remote_media_fetch_timeout"
  | "remote_json_fetch_timeout";

export type ReviewedRemoteJsonFetchOptions = {
  authorization?: string;
  fetchImpl?: RemoteMediaFetch;
  resolveDns?: RemoteMediaDnsResolver;
};

function fail(code: RemoteMediaPolicyErrorCode): never {
  throw new RemoteMediaPolicyError(code);
}

export function validateReviewedRemoteMediaUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0) {
    return fail("remote_media_url_invalid");
  }
  if (value.length > MAX_REMOTE_MEDIA_URL_LENGTH) {
    return fail("remote_media_url_too_long");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("remote_media_url_invalid");
  }

  if (url.protocol !== "https:") return fail("remote_media_url_scheme_blocked");
  if (url.username || url.password) {
    return fail("remote_media_url_credentials_blocked");
  }
  if (url.port) return fail("remote_media_url_port_blocked");
  if (!REVIEWED_REMOTE_MEDIA_HOST_SET.has(url.hostname.toLowerCase())) {
    return fail("remote_media_url_host_blocked");
  }
  if (url.hash) return fail("remote_media_url_fragment_blocked");

  return url;
}

function normalizeRemoteMediaAcceptanceLimit(value: number): number {
  const requested = Number.isFinite(value)
    ? Math.floor(value)
    : MAX_REMOTE_MEDIA_CANDIDATES_PER_POST;
  return Math.max(0, Math.min(MAX_REMOTE_MEDIA_CANDIDATES_PER_POST, requested));
}

export function filterReviewedRemoteMediaItems<T extends UrlBearing>(
  items: readonly T[],
  maxAccepted = MAX_REMOTE_MEDIA_ITEMS_PER_POST,
): ReviewedRemoteMediaItems<T> {
  const accepted: T[] = [];
  let rejected = 0;
  const acceptanceLimit = normalizeRemoteMediaAcceptanceLimit(maxAccepted);
  const inspectionLimit = Math.min(
    items.length,
    MAX_REMOTE_MEDIA_CANDIDATES_PER_POST,
  );

  for (let index = 0; index < inspectionLimit; index += 1) {
    if (accepted.length >= acceptanceLimit) {
      rejected += 1;
      continue;
    }

    try {
      validateReviewedRemoteMediaUrl(items[index].url);
      accepted.push(items[index]);
    } catch (error) {
      if (!(error instanceof RemoteMediaPolicyError)) throw error;
      rejected += 1;
    }
  }

  rejected += items.length - inspectionLimit;
  return { accepted, rejected };
}

function parseIpv4(value: string): number[] | null {
  const pieces = value.split(".");
  if (pieces.length !== 4) return null;
  const octets: number[] = [];
  for (const piece of pieces) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(piece)) return null;
    const octet = Number(piece);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function parseIpv6(value: string): number[] | null {
  if (!value || value.length > 64 || value.includes("[") ||
    value.includes("]") || value.includes("%")) {
    return null;
  }

  let normalized = value.toLowerCase();
  const tailSeparator = normalized.lastIndexOf(":");
  const tail = tailSeparator >= 0 ? normalized.slice(tailSeparator + 1) : "";
  if (tail.includes(".")) {
    const ipv4 = parseIpv4(tail);
    if (!ipv4 || tailSeparator < 0) return null;
    const first = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const second = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, tailSeparator + 1)}${first}:${second}`;
  }

  const compressed = normalized.split("::");
  if (compressed.length > 2) return null;
  const hasCompression = compressed.length === 2;
  const left = compressed[0] ? compressed[0].split(":") : [];
  const right = hasCompression && compressed[1] ? compressed[1].split(":") : [];
  const supplied = [...left, ...right];
  if (supplied.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if ((!hasCompression && supplied.length !== 8) ||
    (hasCompression && supplied.length >= 8)) {
    return null;
  }

  const groups = supplied.map((part) => Number.parseInt(part, 16));
  if (!hasCompression) return groups;
  const missing = 8 - groups.length;
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
}

function isPublicIpv4(address: number[]): boolean {
  const [a, b, c] = address;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: number[]): boolean {
  const [first, second] = address;
  // Permit only ordinary global-unicast space. The early 2001::/23 block
  // contains IETF special/transition ranges (including Teredo), 2002::/16
  // is 6to4 (which can embed a private IPv4 destination), and 3f00::/8 is
  // IANA-reserved rather than routable public service space.
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001 && second < 0x0200) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2002 || first >= 0x3f00) return false;
  return true;
}

/** True only for a syntactically valid globally-routable IPv4 or IPv6 address. */
export function isPublicRemoteIpAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const ipv4 = parseIpv4(value);
  if (ipv4) return isPublicIpv4(ipv4);
  const ipv6 = parseIpv6(value);
  return ipv6 ? isPublicIpv6(ipv6) : false;
}

type DenoDnsRuntime = {
  resolveDns?: RemoteMediaDnsResolver;
};

function defaultRemoteMediaDnsResolver(
  hostname: string,
  recordType: RemoteMediaDnsRecordType,
  options?: { signal?: AbortSignal },
): Promise<string[]> {
  const runtime = (globalThis as unknown as { Deno?: DenoDnsRuntime }).Deno;
  if (!runtime || typeof runtime.resolveDns !== "function") {
    return fail("remote_dns_unavailable");
  }
  return runtime.resolveDns(hostname, recordType, options);
}

function awaitDnsWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutCode: RemoteRequestTimeoutCode,
): Promise<T> {
  if (signal.aborted) return fail(timeoutCode);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RemoteMediaPolicyError(timeoutCode));
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function resolveDnsRecords(
  hostname: string,
  recordType: RemoteMediaDnsRecordType,
  resolver: RemoteMediaDnsResolver,
  signal: AbortSignal,
  timeoutCode: RemoteRequestTimeoutCode,
): Promise<string[]> {
  if (signal.aborted) return fail(timeoutCode);
  try {
    const records = await awaitDnsWithAbort(
      Promise.resolve().then(() => resolver(hostname, recordType, { signal })),
      signal,
      timeoutCode,
    );
    if (!Array.isArray(records) || records.length > 16 ||
      records.some((record) => typeof record !== "string")) {
      return fail("remote_dns_result_invalid");
    }
    if (signal.aborted) return fail(timeoutCode);
    return records;
  } catch (error) {
    if (error instanceof RemoteMediaPolicyError) throw error;
    if (signal.aborted) return fail(timeoutCode);
    return fail("remote_dns_resolution_failed");
  }
}

/**
 * DNS is resolved immediately before every approved outbound hop. The caller
 * must still use an egress layer capable of connection pinning for a complete
 * DNS-rebinding guarantee; native Fetch cannot bind a TLS connection to this
 * inspected address set.
 */
export async function assertReviewedRemotePublicDns(
  hostname: string,
  resolver: RemoteMediaDnsResolver,
  signal: AbortSignal,
  timeoutCode: RemoteRequestTimeoutCode = "remote_media_fetch_timeout",
): Promise<void> {
  const [ipv4Records, ipv6Records] = await Promise.all([
    resolveDnsRecords(hostname, "A", resolver, signal, timeoutCode),
    resolveDnsRecords(hostname, "AAAA", resolver, signal, timeoutCode),
  ]);
  const records = [...ipv4Records, ...ipv6Records];
  if (records.length === 0) return fail("remote_dns_no_records");
  if (records.some((record) => !isPublicRemoteIpAddress(record))) {
    return fail("remote_dns_non_public");
  }
}

function reviewedMimeFromHeader(value: string | null): ReviewedRemoteMediaMime {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    return fail("remote_media_content_type_blocked");
  }
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  if (!REVIEWED_MEDIA_MIME_TYPES.has(mime)) {
    return fail("remote_media_content_type_blocked");
  }
  return mime as ReviewedRemoteMediaMime;
}

function assertIdentityContentEncoding(
  value: string | null,
  blockedCode:
    | "remote_media_content_encoding_blocked"
    | "remote_json_content_encoding_blocked",
): void {
  if (value === null || value.length === 0) return;
  if (value.length > 128 || value.trim().toLowerCase() !== "identity") {
    fail(blockedCode);
  }
}

function assertDeclaredContentLength(
  value: string | null,
  maxBytes: number,
  invalidCode:
    | "remote_media_content_length_invalid"
    | "remote_json_content_length_invalid",
  exceededCode:
    | "remote_media_content_length_exceeded"
    | "remote_json_content_length_exceeded",
): void {
  if (value === null || value.length === 0) return;
  if (value.length > 32 || !/^\d+$/.test(value)) {
    fail(invalidCode);
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) {
    fail(invalidCode);
  }
  if (bytes > maxBytes) {
    fail(exceededCode);
  }
}

function assertBoundedMediaHeaders(response: Response): ReviewedRemoteMediaMime {
  const contentType = response.headers.get("content-type");
  const contentEncoding = response.headers.get("content-encoding");
  const contentLength = response.headers.get("content-length");
  if (
    (contentType?.length ?? 0) > 128 ||
    (contentEncoding?.length ?? 0) > 128 ||
    (contentLength?.length ?? 0) > 32
  ) {
    return fail("remote_media_response_headers_invalid");
  }

  assertIdentityContentEncoding(contentEncoding, "remote_media_content_encoding_blocked");
  assertDeclaredContentLength(
    contentLength,
    MAX_REMOTE_MEDIA_BYTES,
    "remote_media_content_length_invalid",
    "remote_media_content_length_exceeded",
  );
  return reviewedMimeFromHeader(contentType);
}

function startsWithBytes(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
): boolean {
  if (bytes.byteLength < expected.length + offset) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) return "";
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

export function detectReviewedRemoteMediaMagic(
  bytes: Uint8Array,
): ReviewedRemoteMediaMime | null {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (asciiAt(bytes, 0, 6) === "GIF87a" || asciiAt(bytes, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    return asciiAt(bytes, 8, 4) === "qt  "
      ? "video/quicktime"
      : "video/mp4";
  }
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

export function assertReviewedRemoteMediaMagic(
  contentType: ReviewedRemoteMediaMime,
  bytes: Uint8Array,
): void {
  if (detectReviewedRemoteMediaMagic(bytes) !== contentType) {
    fail("remote_media_magic_mismatch");
  }
}

export async function readBoundedRemoteMediaBody(
  response: Response,
): Promise<Uint8Array> {
  if (!response.body) return fail("remote_media_response_body_missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_REMOTE_MEDIA_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The policy failure is more useful than a best-effort cancellation failure.
        }
        return fail("remote_media_body_exceeded");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RemoteMediaPolicyError) throw error;
    return fail("remote_media_body_read_failed");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isRedirect(response: Response): boolean {
  return response.status === 301 || response.status === 302 ||
    response.status === 303 || response.status === 307 || response.status === 308;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Error and redirect bodies are never used; cancellation is best effort only.
  }
}

export async function fetchReviewedRemoteMedia(
  source: string | URL,
  fetchImpl: RemoteMediaFetch = fetch,
  resolveDns: RemoteMediaDnsResolver = defaultRemoteMediaDnsResolver,
): Promise<ReviewedRemoteMediaResponse> {
  let currentUrl = validateReviewedRemoteMediaUrl(source.toString());
  const controller = new AbortController();
  const totalTimer = setTimeout(
    () => controller.abort(),
    REMOTE_MEDIA_TOTAL_TIMEOUT_MS,
  );

  try {
    for (let redirects = 0; redirects <= MAX_REMOTE_MEDIA_REDIRECTS; redirects += 1) {
      const ttfbTimer = setTimeout(
        () => controller.abort(),
        REMOTE_MEDIA_TTFB_TIMEOUT_MS,
      );
      let response: Response;
      try {
        await assertReviewedRemotePublicDns(
          currentUrl.hostname,
          resolveDns,
          controller.signal,
        );
        response = await fetchImpl(currentUrl, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Encoding": "identity",
          },
        });
      } catch (error) {
        if (error instanceof RemoteMediaPolicyError) throw error;
        if (controller.signal.aborted) return fail("remote_media_fetch_timeout");
        return fail("remote_media_fetch_failed");
      } finally {
        clearTimeout(ttfbTimer);
      }

      if (isRedirect(response) || response.redirected) {
        if (response.redirected) {
          await cancelResponseBody(response);
          return fail("remote_media_redirect_auto_follow_blocked");
        }
        if (redirects >= MAX_REMOTE_MEDIA_REDIRECTS) {
          await cancelResponseBody(response);
          return fail("remote_media_redirect_limit_exceeded");
        }
        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (!location) return fail("remote_media_redirect_location_missing");
        if (location.length > MAX_REMOTE_MEDIA_URL_LENGTH) {
          return fail("remote_media_redirect_location_too_long");
        }
        try {
          currentUrl = validateReviewedRemoteMediaUrl(
            new URL(location, currentUrl).toString(),
          );
        } catch (error) {
          if (error instanceof RemoteMediaPolicyError) throw error;
          return fail("remote_media_url_invalid");
        }
        continue;
      }

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      let contentType: ReviewedRemoteMediaMime;
      try {
        contentType = assertBoundedMediaHeaders(response);
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
      let body: Uint8Array;
      try {
        body = await readBoundedRemoteMediaBody(response);
      } catch (error) {
        if (controller.signal.aborted) return fail("remote_media_fetch_timeout");
        throw error;
      }
      assertReviewedRemoteMediaMagic(contentType, body);
      return { body, contentType, finalUrl: currentUrl };
    }
  } finally {
    clearTimeout(totalTimer);
  }

  return fail("remote_media_redirect_limit_exceeded");
}

export function validateReviewedRemoteJsonUrl(
  provider: ReviewedRemoteJsonProvider,
  value: unknown,
): URL {
  if (typeof value !== "string" || value.length === 0) {
    return fail("remote_json_url_invalid");
  }
  if (value.length > MAX_REVIEWED_REMOTE_JSON_URL_LENGTH) {
    return fail("remote_json_url_too_long");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("remote_json_url_invalid");
  }

  if (url.protocol !== "https:") return fail("remote_json_url_scheme_blocked");
  if (url.username || url.password) return fail("remote_json_url_credentials_blocked");
  if (url.port) return fail("remote_json_url_port_blocked");
  if (url.hostname.toLowerCase() !== REVIEWED_REMOTE_JSON_HOST_BY_PROVIDER[provider]) {
    return fail("remote_json_url_host_blocked");
  }
  if (url.hash) return fail("remote_json_url_fragment_blocked");
  return url;
}

function assertBoundedJsonHeaders(response: Response): void {
  const contentType = response.headers.get("content-type");
  const contentEncoding = response.headers.get("content-encoding");
  const contentLength = response.headers.get("content-length");
  if (
    (contentType?.length ?? 0) > 128 ||
    (contentEncoding?.length ?? 0) > 128 ||
    (contentLength?.length ?? 0) > 32
  ) {
    return fail("remote_json_response_headers_invalid");
  }
  const mime = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(mime)) {
    return fail("remote_json_content_type_blocked");
  }
  assertIdentityContentEncoding(contentEncoding, "remote_json_content_encoding_blocked");
  assertDeclaredContentLength(
    contentLength,
    MAX_REVIEWED_REMOTE_JSON_BYTES,
    "remote_json_content_length_invalid",
    "remote_json_content_length_exceeded",
  );
}

async function readBoundedRemoteJsonBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return fail("remote_json_response_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_REVIEWED_REMOTE_JSON_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Best effort only; the bounded-policy error is authoritative.
        }
        return fail("remote_json_body_exceeded");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RemoteMediaPolicyError) throw error;
    return fail("remote_json_body_read_failed");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function assertReviewedRemoteJsonShape(body: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{
    value: body,
    depth: 0,
  }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_REVIEWED_REMOTE_JSON_NODES ||
      current.depth > MAX_REVIEWED_REMOTE_JSON_DEPTH) {
      return fail("remote_json_shape_invalid");
    }
    if (typeof current.value === "string") {
      if (current.value.length > MAX_REVIEWED_REMOTE_JSON_STRING_LENGTH) {
        return fail("remote_json_shape_invalid");
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_REVIEWED_REMOTE_JSON_ARRAY_ITEMS) {
        return fail("remote_json_shape_invalid");
      }
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (current.value && typeof current.value === "object") {
      const values = Object.values(current.value as Record<string, unknown>);
      if (values.length > MAX_REVIEWED_REMOTE_JSON_OBJECT_KEYS) {
        return fail("remote_json_shape_invalid");
      }
      for (const value of values) {
        stack.push({ value, depth: current.depth + 1 });
      }
    }
  }
}

function reviewedJsonHeaders(authorization?: string): Headers {
  if (authorization !== undefined &&
    (authorization.length === 0 || authorization.length > 4_096 || /[\r\n]/.test(authorization))) {
    return fail("remote_json_authorization_invalid");
  }
  const headers = new Headers({
    Accept: "application/json",
    "Accept-Encoding": "identity",
  });
  if (authorization) headers.set("Authorization", authorization);
  return headers;
}

export async function fetchReviewedRemoteJson(
  provider: ReviewedRemoteJsonProvider,
  source: string | URL,
  options: ReviewedRemoteJsonFetchOptions = {},
): Promise<ReviewedRemoteJsonResponse> {
  const currentUrl = validateReviewedRemoteJsonUrl(provider, source.toString());
  const controller = new AbortController();
  const totalTimer = setTimeout(
    () => controller.abort(),
    REVIEWED_REMOTE_JSON_TOTAL_TIMEOUT_MS,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveDns = options.resolveDns ?? defaultRemoteMediaDnsResolver;
  try {
    const ttfbTimer = setTimeout(
      () => controller.abort(),
      REVIEWED_REMOTE_JSON_TTFB_TIMEOUT_MS,
    );
    let response: Response;
    try {
      await assertReviewedRemotePublicDns(
        currentUrl.hostname,
        resolveDns,
        controller.signal,
        "remote_json_fetch_timeout",
      );
      response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: "error",
        headers: reviewedJsonHeaders(options.authorization),
      });
    } catch (error) {
      if (error instanceof RemoteMediaPolicyError) throw error;
      if (controller.signal.aborted) return fail("remote_json_fetch_timeout");
      return fail("remote_json_fetch_failed");
    } finally {
      clearTimeout(ttfbTimer);
    }

    if (isRedirect(response) || response.redirected) {
      await cancelResponseBody(response);
      return fail("remote_json_redirect_blocked");
    }

    try {
      assertBoundedJsonHeaders(response);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedRemoteJsonBody(response);
    } catch (error) {
      if (controller.signal.aborted) return fail("remote_json_fetch_timeout");
      throw error;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail("remote_json_body_text_invalid");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail("remote_json_body_invalid");
    }
    assertReviewedRemoteJsonShape(body);
    return { body, response, finalUrl: currentUrl };
  } finally {
    clearTimeout(totalTimer);
  }
}
