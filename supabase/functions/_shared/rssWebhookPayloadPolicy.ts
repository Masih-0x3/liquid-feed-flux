export const MAX_RSS_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_RSS_WEBHOOK_BODY_CHUNKS = 4_096;
export const MAX_RSS_WEBHOOK_JSON_DEPTH = 32;
export const MAX_RSS_WEBHOOK_JSON_NODES = 4_096;
export const MAX_RSS_WEBHOOK_JSON_OBJECT_KEYS = 64;
export const MAX_RSS_WEBHOOK_JSON_ARRAY_ITEMS = 64;
export const MAX_RSS_WEBHOOK_STRING_LENGTH = 64 * 1024;
export const MAX_RSS_WEBHOOK_ITEMS = 25;
export const MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM = 16;

// Admin actions share the bounded body reader below, but their legitimate
// settings payloads can contain up to 100 entries. Keep their JSON shape
// limits explicit rather than weakening the tighter RSS ingress contract.
export const MAX_ADMIN_ACTION_JSON_DEPTH = 32;
export const MAX_ADMIN_ACTION_JSON_NODES = 16_384;
export const MAX_ADMIN_ACTION_JSON_OBJECT_KEYS = 256;
export const MAX_ADMIN_ACTION_JSON_ARRAY_ITEMS = 256;
export const MAX_ADMIN_ACTION_STRING_LENGTH = 64 * 1024;

export type RssWebhookPayloadErrorCode =
  | "rss_webhook_content_length_invalid"
  | "rss_webhook_content_length_exceeded"
  | "rss_webhook_content_encoding_blocked"
  | "rss_webhook_body_too_large"
  | "rss_webhook_body_chunk_limit_exceeded"
  | "rss_webhook_body_read_failed"
  | "rss_webhook_body_text_invalid"
  | "rss_webhook_json_invalid"
  | "rss_webhook_json_depth_exceeded"
  | "rss_webhook_json_node_limit_exceeded"
  | "rss_webhook_json_shape_invalid"
  | "rss_webhook_json_string_too_long"
  | "rss_webhook_json_key_blocked"
  | "rss_webhook_item_limit_exceeded"
  | "rss_webhook_item_invalid"
  | "rss_webhook_media_candidate_limit_exceeded";

export class RssWebhookPayloadError extends Error {
  constructor(public readonly code: RssWebhookPayloadErrorCode) {
    super(code);
    this.name = "RssWebhookPayloadError";
  }
}

const BLOCKED_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ITEM_MEDIA_ARRAY_FIELDS = ["enclosure", "media:content"] as const;

type BoundedJsonLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxObjectKeys: number;
  maxArrayItems: number;
  maxStringLength: number;
}>;

const RSS_WEBHOOK_JSON_LIMITS: BoundedJsonLimits = Object.freeze({
  maxDepth: MAX_RSS_WEBHOOK_JSON_DEPTH,
  maxNodes: MAX_RSS_WEBHOOK_JSON_NODES,
  maxObjectKeys: MAX_RSS_WEBHOOK_JSON_OBJECT_KEYS,
  maxArrayItems: MAX_RSS_WEBHOOK_JSON_ARRAY_ITEMS,
  maxStringLength: MAX_RSS_WEBHOOK_STRING_LENGTH,
});

const ADMIN_ACTION_JSON_LIMITS: BoundedJsonLimits = Object.freeze({
  maxDepth: MAX_ADMIN_ACTION_JSON_DEPTH,
  maxNodes: MAX_ADMIN_ACTION_JSON_NODES,
  maxObjectKeys: MAX_ADMIN_ACTION_JSON_OBJECT_KEYS,
  maxArrayItems: MAX_ADMIN_ACTION_JSON_ARRAY_ITEMS,
  maxStringLength: MAX_ADMIN_ACTION_STRING_LENGTH,
});

function fail(code: RssWebhookPayloadErrorCode): never {
  throw new RssWebhookPayloadError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertContentLength(request: Request): void {
  const raw = request.headers.get("content-length");
  if (raw === null || raw.trim() === "") return;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return fail("rss_webhook_content_length_invalid");
  const bytes = Number(normalized);
  if (!Number.isSafeInteger(bytes)) return fail("rss_webhook_content_length_invalid");
  if (bytes > MAX_RSS_WEBHOOK_BODY_BYTES) {
    return fail("rss_webhook_content_length_exceeded");
  }
}

function assertContentEncoding(request: Request): void {
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    return fail("rss_webhook_content_encoding_blocked");
  }
}

function growBoundedRssWebhookBodyBuffer(
  buffer: Uint8Array,
  bytesRead: number,
  requiredByteLength: number,
): Uint8Array {
  const nextByteLength = Math.min(
    MAX_RSS_WEBHOOK_BODY_BYTES,
    Math.max(requiredByteLength, Math.max(16 * 1024, buffer.byteLength * 2)),
  );
  const next = new Uint8Array(nextByteLength);
  next.set(buffer.subarray(0, bytesRead));
  return next;
}

export type BoundedRssWebhookBody = {
  /** Exact received bytes for HMAC; never log or persist this value. */
  bytes: Uint8Array;
  /** Fatal UTF-8 decoded text for the bounded JSON parser. */
  text: string;
};

/**
 * Reads an RSS webhook body exactly once with a hard byte cap. Callers reuse
 * `bytes` for HMAC and `text` for JSON parsing, so decoding cannot alter what
 * a signature authenticates (for example, a leading UTF-8 BOM).
 */
export async function readBoundedRssWebhookBody(request: Request): Promise<BoundedRssWebhookBody> {
  assertContentLength(request);
  assertContentEncoding(request);
  if (!request.body) return { bytes: new Uint8Array(), text: "" };

  const reader = request.body.getReader();
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(16 * 1024);
  let bytesRead = 0;
  let chunksRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunksRead += 1;
      if (chunksRead > MAX_RSS_WEBHOOK_BODY_CHUNKS) {
        try {
          await reader.cancel();
        } catch {
          // The chunk-limit failure is authoritative; cancellation is best effort.
        }
        return fail("rss_webhook_body_chunk_limit_exceeded");
      }
      if (value.byteLength > MAX_RSS_WEBHOOK_BODY_BYTES - bytesRead) {
        try {
          await reader.cancel();
        } catch {
          // The size failure is authoritative; stream cancellation is best effort.
        }
        return fail("rss_webhook_body_too_large");
      }
      const nextBytesRead = bytesRead + value.byteLength;
      if (nextBytesRead > buffer.byteLength) {
        buffer = growBoundedRssWebhookBodyBuffer(buffer, bytesRead, nextBytesRead);
      }
      buffer.set(value, bytesRead);
      bytesRead = nextBytesRead;
    }
  } catch (error) {
    if (error instanceof RssWebhookPayloadError) throw error;
    return fail("rss_webhook_body_read_failed");
  } finally {
    reader.releaseLock();
  }

  const bytes = bytesRead === buffer.byteLength ? buffer : buffer.slice(0, bytesRead);
  try {
    return {
      bytes,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return fail("rss_webhook_body_text_invalid");
  }
}

/**
 * Compatibility helper for callers that only parse JSON. Security-sensitive
 * signed paths should use readBoundedRssWebhookBody and retain the bytes.
 */
export async function readBoundedRssWebhookRawBody(request: Request): Promise<string> {
  return (await readBoundedRssWebhookBody(request)).text;
}

export function buildRssWebhookSignatureInput(timestamp: number, rawBodyBytes: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const input = new Uint8Array(prefix.byteLength + rawBodyBytes.byteLength);
  input.set(prefix);
  input.set(rawBodyBytes, prefix.byteLength);
  return input;
}

/**
 * Enforce depth and structural-node caps before JSON.parse can allocate a
 * deeply nested or node-heavy value. JSON.parse remains the syntax authority.
 */
function assertBoundedJsonSyntax(raw: string, limits: BoundedJsonLimits): void {
  let depth = 0;
  let nodes = 0;

  const countNode = () => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      return fail("rss_webhook_json_node_limit_exceeded");
    }
  };

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (/\s/.test(char) || char === "," || char === ":") continue;

    if (char === "\"") {
      countNode();
      index += 1;
      let escaped = false;
      let closed = false;
      for (; index < raw.length; index += 1) {
        const stringChar = raw[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (stringChar === "\\") {
          escaped = true;
          continue;
        }
        if (stringChar === "\"") {
          closed = true;
          break;
        }
      }
      if (!closed) return fail("rss_webhook_json_invalid");
      continue;
    }

    if (char === "{" || char === "[") {
      countNode();
      depth += 1;
      if (depth > limits.maxDepth) {
        return fail("rss_webhook_json_depth_exceeded");
      }
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) return fail("rss_webhook_json_invalid");
      continue;
    }

    if (char === "-" || (char >= "0" && char <= "9")) {
      countNode();
      while (index + 1 < raw.length && /[0-9eE+\-.]/.test(raw[index + 1])) index += 1;
      continue;
    }

    const literal = raw.startsWith("true", index)
      ? "true"
      : raw.startsWith("false", index)
      ? "false"
      : raw.startsWith("null", index)
      ? "null"
      : null;
    if (literal) {
      countNode();
      index += literal.length - 1;
    }
  }

  if (depth !== 0) return fail("rss_webhook_json_invalid");
}

function assertBoundedJsonShape(value: unknown, limits: BoundedJsonLimits): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes) {
      return fail("rss_webhook_json_node_limit_exceeded");
    }
    if (current.depth > limits.maxDepth) {
      return fail("rss_webhook_json_depth_exceeded");
    }

    if (typeof current.value === "string") {
      if (current.value.length > limits.maxStringLength) {
        return fail("rss_webhook_json_string_too_long");
      }
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return fail("rss_webhook_json_shape_invalid");
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;

    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayItems) {
        return fail("rss_webhook_json_shape_invalid");
      }
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    if (!isRecord(current.value)) return fail("rss_webhook_json_shape_invalid");
    const entries = Object.entries(current.value);
    if (entries.length > limits.maxObjectKeys) {
      return fail("rss_webhook_json_shape_invalid");
    }
    for (const [key, child] of entries) {
      if (key.length > limits.maxStringLength) {
        return fail("rss_webhook_json_string_too_long");
      }
      if (BLOCKED_JSON_KEYS.has(key)) return fail("rss_webhook_json_key_blocked");
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function parseBoundedJson(rawBody: string, limits: BoundedJsonLimits): unknown {
  if (rawBody.length === 0) return fail("rss_webhook_json_invalid");
  assertBoundedJsonSyntax(rawBody, limits);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail("rss_webhook_json_invalid");
  }
  assertBoundedJsonShape(parsed, limits);
  return parsed;
}

export function parseBoundedRssWebhookJson(rawBody: string): unknown {
  return parseBoundedJson(rawBody, RSS_WEBHOOK_JSON_LIMITS);
}

/**
 * Admin actions use the same safe parser, with explicit limits that preserve
 * supported settings payloads without widening the RSS webhook envelope.
 */
export function parseBoundedAdminActionJson(rawBody: string): unknown {
  return parseBoundedJson(rawBody, ADMIN_ACTION_JSON_LIMITS);
}

function readRssWebhookItemCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [payload];

  const data = isRecord(payload.data) ? payload.data : null;
  if (data && Array.isArray(data.items_new)) return data.items_new;
  if (data && Array.isArray(data.items)) return data.items;
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.item !== undefined) return Array.isArray(payload.item) ? payload.item : [payload.item];
  if (Array.isArray(payload.entries)) return payload.entries;
  if (payload.entry !== undefined) return Array.isArray(payload.entry) ? payload.entry : [payload.entry];
  return [payload];
}

function assertBoundedItemMediaCandidates(item: Record<string, unknown>): void {
  for (const field of ITEM_MEDIA_ARRAY_FIELDS) {
    const value = item[field];
    if (Array.isArray(value) && value.length > MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM) {
      return fail("rss_webhook_media_candidate_limit_exceeded");
    }
  }
}

/**
 * Preserves the historical RSS.app payload precedence while guaranteeing that
 * only bounded record items reach the existing persistence loop.
 */
export function extractBoundedRssWebhookItems(payload: unknown): Array<Record<string, unknown>> {
  const candidates = readRssWebhookItemCandidates(payload);
  if (candidates.length > MAX_RSS_WEBHOOK_ITEMS) {
    return fail("rss_webhook_item_limit_exceeded");
  }

  const items: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) return fail("rss_webhook_item_invalid");
    assertBoundedItemMediaCandidates(candidate);
    items.push(candidate);
  }
  return items;
}

export function isRssWebhookPayloadError(error: unknown): error is RssWebhookPayloadError {
  return error instanceof RssWebhookPayloadError;
}

export function rssWebhookPayloadErrorStatus(error: RssWebhookPayloadError): 400 | 413 | 415 {
  switch (error.code) {
    case "rss_webhook_content_length_exceeded":
    case "rss_webhook_body_too_large":
    case "rss_webhook_body_chunk_limit_exceeded":
    case "rss_webhook_json_depth_exceeded":
    case "rss_webhook_json_node_limit_exceeded":
    case "rss_webhook_json_string_too_long":
    case "rss_webhook_item_limit_exceeded":
    case "rss_webhook_media_candidate_limit_exceeded":
      return 413;
    case "rss_webhook_content_encoding_blocked":
      return 415;
    default:
      return 400;
  }
}
