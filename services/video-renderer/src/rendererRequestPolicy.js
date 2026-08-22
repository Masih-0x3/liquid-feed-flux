export const MAX_RENDERER_REQUEST_BODY_BYTES = 64 * 1024;
export const MAX_RENDERER_REQUEST_BODY_CHUNKS = 256;
export const MAX_RENDERER_REQUEST_JSON_DEPTH = 4;
export const MAX_RENDERER_REQUEST_JSON_NODES = 16;
export const MAX_RENDERER_REQUEST_STRING_LENGTH = 256;
export const MAX_RENDERER_REQUEST_RENDER_ID_LENGTH = 128;

const ALLOWED_DISPATCH_KEYS = new Set(["render_id", "tweet_id", "source"]);

const ERROR_DETAILS = {
  renderer_request_content_length_invalid: { status: 400, message: "request Content-Length is invalid", closeConnection: true },
  renderer_request_content_length_exceeded: { status: 413, message: "request body is too large", closeConnection: true },
  renderer_request_content_encoding_blocked: { status: 415, message: "request Content-Encoding is not supported", closeConnection: true },
  renderer_request_content_type_blocked: { status: 415, message: "request Content-Type must be application/json", closeConnection: true },
  renderer_request_body_too_large: { status: 413, message: "request body is too large", closeConnection: true },
  renderer_request_body_chunk_limit_exceeded: { status: 413, message: "request body is too fragmented", closeConnection: true },
  renderer_request_body_read_failed: { status: 400, message: "request body could not be read", closeConnection: true },
  renderer_request_body_text_invalid: { status: 400, message: "request body must be valid UTF-8", closeConnection: false },
  renderer_request_json_invalid: { status: 400, message: "request body must be valid JSON", closeConnection: false },
  renderer_request_json_depth_exceeded: { status: 400, message: "request JSON is too deeply nested", closeConnection: false },
  renderer_request_json_node_limit_exceeded: { status: 400, message: "request JSON is too complex", closeConnection: false },
  renderer_request_json_shape_invalid: { status: 400, message: "request JSON has an unsupported shape", closeConnection: false },
  renderer_request_json_string_too_long: { status: 400, message: "request JSON contains an oversized string", closeConnection: false },
  renderer_request_render_id_required: { status: 400, message: "render_id is required", closeConnection: false },
  renderer_request_render_id_invalid: { status: 400, message: "render_id is invalid", closeConnection: false },
};

export class RendererRequestInputError extends Error {
  constructor(code) {
    const details = ERROR_DETAILS[code];
    super(details?.message || "request input is invalid");
    this.name = "RendererRequestInputError";
    this.code = code;
    this.status = details?.status || 400;
    this.closeConnection = Boolean(details?.closeConnection);
  }
}

function fail(code) {
  throw new RendererRequestInputError(code);
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return null;
  return typeof value === "string" ? value : undefined;
}

function assertContentLength(headers) {
  const raw = headerValue(headers, "content-length");
  if (raw === undefined) return;
  if (raw === null || raw.trim() === "") return fail("renderer_request_content_length_invalid");
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return fail("renderer_request_content_length_invalid");
  const bytes = Number(normalized);
  if (!Number.isSafeInteger(bytes)) return fail("renderer_request_content_length_invalid");
  if (bytes > MAX_RENDERER_REQUEST_BODY_BYTES) return fail("renderer_request_content_length_exceeded");
}

function assertContentEncoding(headers) {
  const raw = headerValue(headers, "content-encoding");
  if (raw === null) return fail("renderer_request_content_encoding_blocked");
  const encoding = raw?.trim().toLowerCase();
  if (encoding && encoding !== "identity") return fail("renderer_request_content_encoding_blocked");
}

function assertContentType(headers) {
  const raw = headerValue(headers, "content-type");
  if (raw === undefined || raw === null || raw.trim() === "") {
    if (raw === null) return fail("renderer_request_content_type_blocked");
    return;
  }
  const mediaType = raw.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    return fail("renderer_request_content_type_blocked");
  }
}

function growBoundedBuffer(buffer, bytesRead, requiredByteLength) {
  const nextByteLength = Math.min(
    MAX_RENDERER_REQUEST_BODY_BYTES,
    Math.max(requiredByteLength, Math.max(4 * 1024, buffer.byteLength * 2)),
  );
  const next = new Uint8Array(nextByteLength);
  next.set(buffer.subarray(0, bytesRead));
  return next;
}

function asBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  return null;
}

function drainRequest(request) {
  try {
    request.once?.("error", () => undefined);
    request.resume?.();
  } catch {
    // A typed limit error remains authoritative if best-effort drain fails.
  }
}

/**
 * Consume only a fixed amount of an authenticated renderer dispatch body. The
 * caller maps typed failures before generic telemetry so raw request data is
 * neither logged nor returned to the caller.
 */
export async function readBoundedRendererRequestBody(request) {
  assertContentLength(request?.headers);
  assertContentEncoding(request?.headers);
  assertContentType(request?.headers);

  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array(4 * 1024);
    let bytesRead = 0;
    let chunksRead = 0;
    let settled = false;

    const cleanup = () => {
      request.off?.("data", onData);
      request.off?.("end", onEnd);
      request.off?.("error", onError);
      request.off?.("aborted", onAborted);
      request.off?.("close", onClose);
    };
    const rejectWith = (error, shouldDrain = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (shouldDrain) drainRequest(request);
      reject(error);
    };
    const onData = (chunk) => {
      if (settled) return;
      chunksRead += 1;
      if (chunksRead > MAX_RENDERER_REQUEST_BODY_CHUNKS) {
        return rejectWith(new RendererRequestInputError("renderer_request_body_chunk_limit_exceeded"), true);
      }
      const bytes = asBytes(chunk);
      if (!bytes) return rejectWith(new RendererRequestInputError("renderer_request_body_read_failed"), true);
      if (bytes.byteLength > MAX_RENDERER_REQUEST_BODY_BYTES - bytesRead) {
        return rejectWith(new RendererRequestInputError("renderer_request_body_too_large"), true);
      }
      const nextBytesRead = bytesRead + bytes.byteLength;
      if (nextBytesRead > buffer.byteLength) {
        buffer = growBoundedBuffer(buffer, bytesRead, nextBytesRead);
      }
      buffer.set(bytes, bytesRead);
      bytesRead = nextBytesRead;
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const bodyBytes = bytesRead === buffer.byteLength ? buffer : buffer.slice(0, bytesRead);
      try {
        resolve({
          bytes: bodyBytes,
          text: new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes),
        });
      } catch {
        reject(new RendererRequestInputError("renderer_request_body_text_invalid"));
      }
    };
    const onError = () => rejectWith(new RendererRequestInputError("renderer_request_body_read_failed"), true);
    const onAborted = () => rejectWith(new RendererRequestInputError("renderer_request_body_read_failed"), true);
    const onClose = () => {
      if (!request.complete) rejectWith(new RendererRequestInputError("renderer_request_body_read_failed"), true);
    };

    request.once?.("end", onEnd);
    request.once?.("error", onError);
    request.once?.("aborted", onAborted);
    request.once?.("close", onClose);
    request.on?.("data", onData);
  });
}

function assertBoundedJsonSyntax(raw) {
  let depth = 0;
  let nodes = 0;

  const countNode = () => {
    nodes += 1;
    if (nodes > MAX_RENDERER_REQUEST_JSON_NODES) {
      return fail("renderer_request_json_node_limit_exceeded");
    }
  };

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (/\s/.test(char) || char === "," || char === ":") continue;

    if (char === '"') {
      countNode();
      let stringLength = 0;
      let closed = false;
      index += 1;
      for (; index < raw.length; index += 1) {
        const stringChar = raw[index];
        if (stringChar === "\\") {
          stringLength += 1;
          index += 1;
          continue;
        }
        if (stringChar === '"') {
          closed = true;
          break;
        }
        stringLength += 1;
        if (stringLength > MAX_RENDERER_REQUEST_STRING_LENGTH) {
          return fail("renderer_request_json_string_too_long");
        }
      }
      if (!closed) return fail("renderer_request_json_invalid");
      continue;
    }

    if (char === "{" || char === "[") {
      countNode();
      depth += 1;
      if (depth > MAX_RENDERER_REQUEST_JSON_DEPTH) {
        return fail("renderer_request_json_depth_exceeded");
      }
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) return fail("renderer_request_json_invalid");
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

  if (depth !== 0) return fail("renderer_request_json_invalid");
}

function parseRendererDispatchJson(raw) {
  if (!raw) return fail("renderer_request_render_id_required");
  assertBoundedJsonSyntax(raw);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail("renderer_request_json_invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("renderer_request_json_shape_invalid");
  }
  const keys = Object.keys(payload);
  if (keys.length > ALLOWED_DISPATCH_KEYS.size || keys.some((key) => !ALLOWED_DISPATCH_KEYS.has(key))) {
    return fail("renderer_request_json_shape_invalid");
  }
  for (const key of ["tweet_id", "source"]) {
    const value = payload[key];
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_RENDERER_REQUEST_STRING_LENGTH)) {
      return fail("renderer_request_json_shape_invalid");
    }
  }
  if (typeof payload.render_id !== "string" || !payload.render_id.trim()) {
    return fail("renderer_request_render_id_required");
  }
  const renderId = payload.render_id.trim();
  if (renderId.length > MAX_RENDERER_REQUEST_RENDER_ID_LENGTH) {
    return fail("renderer_request_render_id_invalid");
  }
  return { renderId };
}

export async function readBoundedRendererDispatchRequest(request) {
  const { text } = await readBoundedRendererRequestBody(request);
  return parseRendererDispatchJson(text);
}
