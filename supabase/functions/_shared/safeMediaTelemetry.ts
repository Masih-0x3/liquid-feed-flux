export type SafeMediaUrlTelemetry = {
  source_url_scheme: "http" | "https" | "other" | "invalid";
  source_url_host: string | null;
  source_url_path_class: "root" | "single_segment" | "nested" | "invalid";
  source_url_has_query: boolean;
  source_url_has_fragment: boolean;
  source_url_has_credentials: boolean;
  source_url_hash: string | null;
};

export type MediaDownloadEventMeta = {
  media_download_ms?: number;
  reused?: boolean;
  storage_path?: string;
  file_size?: number;
  mime_type?: string;
  event?: "stale_media_download_ignored";
  expected_src_url_hash?: string | null;
};

const SAFE_URL_HASH = /^[a-f0-9]{64}$/i;
const SAFE_MEDIA_ID = /^[a-z0-9_-]{1,128}$/i;
const SAFE_STORAGE_PATH = /^(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/i;
const SAFE_MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;
const KNOWN_MEDIA_ERROR_CODES = new Set([
  "media_download_failed",
  "media_query_failed",
  "media_row_update_failed",
  "media_upload_failed",
  "unsupported_or_placeholder_url",
  "remote_media_url_invalid",
  "remote_media_url_too_long",
  "remote_media_url_scheme_blocked",
  "remote_media_url_credentials_blocked",
  "remote_media_url_port_blocked",
  "remote_media_url_host_blocked",
  "remote_media_url_fragment_blocked",
  "remote_media_redirect_limit_exceeded",
  "remote_media_redirect_location_missing",
  "remote_media_redirect_location_too_long",
  "remote_media_redirect_auto_follow_blocked",
  "remote_media_fetch_timeout",
  "remote_media_fetch_failed",
  "remote_media_response_headers_invalid",
  "remote_media_content_encoding_blocked",
  "remote_media_content_length_invalid",
  "remote_media_content_length_exceeded",
  "remote_media_content_type_blocked",
  "remote_media_response_body_missing",
  "remote_media_body_read_failed",
  "remote_media_body_exceeded",
  "remote_media_magic_mismatch",
  "remote_dns_unavailable",
  "remote_dns_resolution_failed",
  "remote_dns_no_records",
  "remote_dns_result_invalid",
  "remote_dns_non_public",
  "media_item_limit_exceeded",
]);

export function safeMediaUrlHash(value: unknown): string | null {
  return typeof value === "string" && SAFE_URL_HASH.test(value)
    ? value.toLowerCase()
    : null;
}

export function safeMediaUrlTelemetry(
  value: unknown,
  hash: unknown,
): SafeMediaUrlTelemetry {
  const sourceUrlHash = safeMediaUrlHash(hash);
  const invalid: SafeMediaUrlTelemetry = {
    source_url_scheme: "invalid",
    source_url_host: null,
    source_url_path_class: "invalid",
    source_url_has_query: false,
    source_url_has_fragment: false,
    source_url_has_credentials: false,
    source_url_hash: sourceUrlHash,
  };

  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    return invalid;
  }

  try {
    const url = new URL(value);
    const pathDepth = url.pathname.split("/").filter(Boolean).length;
    return {
      source_url_scheme: url.protocol === "https:"
        ? "https"
        : url.protocol === "http:"
        ? "http"
        : "other",
      source_url_host: url.hostname.length > 0 && url.hostname.length <= 253
        ? url.hostname.toLowerCase()
        : null,
      source_url_path_class: pathDepth === 0
        ? "root"
        : pathDepth === 1
        ? "single_segment"
        : "nested",
      source_url_has_query: url.search.length > 0,
      source_url_has_fragment: url.hash.length > 0,
      source_url_has_credentials: url.username.length > 0 || url.password.length > 0,
      source_url_hash: sourceUrlHash,
    };
  } catch {
    return invalid;
  }
}

export function safeMediaDownloadErrorCode(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : "";

  if (KNOWN_MEDIA_ERROR_CODES.has(message)) return message;

  const httpStatus = /HTTP error!\s*status:\s*([1-5]\d{2})/i.exec(message);
  if (httpStatus) return `http_${httpStatus[1]}`;

  return "media_download_failed";
}

function safeTelemetryNumber(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function safeMediaIdentifier(value: unknown): string | null {
  return typeof value === "string" && SAFE_MEDIA_ID.test(value) ? value : null;
}

function safeStoragePath(value: unknown): string | null {
  return typeof value === "string" &&
      value.length <= 512 &&
      SAFE_STORAGE_PATH.test(value)
    ? value
    : null;
}

function safeMimeType(value: unknown): string | null {
  return typeof value === "string" &&
      value.length <= 128 &&
      SAFE_MIME_TYPE.test(value)
    ? value.toLowerCase()
    : null;
}

export function safeMediaDownloadEventMeta(
  value: MediaDownloadEventMeta,
  mediaId: unknown,
  sourceUrl: unknown,
  sourceUrlHash: unknown,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    media_id: safeMediaIdentifier(mediaId),
    ...safeMediaUrlTelemetry(sourceUrl, sourceUrlHash),
  };

  const mediaDownloadMs = safeTelemetryNumber(value.media_download_ms);
  if (mediaDownloadMs !== null) meta.media_download_ms = mediaDownloadMs;

  if (typeof value.reused === "boolean") meta.reused = value.reused;

  const storagePath = safeStoragePath(value.storage_path);
  if (storagePath !== null) meta.storage_path = storagePath;

  const fileSize = safeTelemetryNumber(value.file_size);
  if (fileSize !== null) meta.file_size = fileSize;

  const mimeType = safeMimeType(value.mime_type);
  if (mimeType !== null) meta.mime_type = mimeType;

  if (value.event === "stale_media_download_ignored") {
    meta.event = value.event;
  }

  const expectedSourceUrlHash = safeMediaUrlHash(value.expected_src_url_hash);
  if (expectedSourceUrlHash !== null) {
    meta.expected_src_url_hash = expectedSourceUrlHash;
  }

  return meta;
}
