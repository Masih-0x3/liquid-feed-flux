import type { AppRole } from "../_shared/appRole.ts";
import type { AdminActionResponse, SupabaseAdminClient } from "./types.ts";

const MEDIA_BUCKET = "temp-media";
export const MEDIA_ACCESS_SECONDS = 120;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
type Row = Record<string, unknown>;
type Result = { data?: unknown; error?: unknown };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: Row): Query;
  limit(value: number): Query;
  maybeSingle(): PromiseLike<Result>;
};
type MediaStorage = {
  getBucket(bucket: string): PromiseLike<Result>;
  from(bucket: string): {
    list(path: string, options: { search: string; limit: number }): PromiseLike<Result>;
    createSignedUrl(path: string, seconds: number, options?: { download: string }): PromiseLike<{
      data?: { signedUrl?: string }; error?: unknown;
    }>;
  };
};
export type MediaAccessContext = { role: AppRole; storageOrigin: string; now?: () => number };

function table(client: SupabaseAdminClient, name: string): Query { return client.from(name) as Query; }
function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function failure(code: string, status = 200): AdminActionResponse {
  // Stable codes deliberately omit storage paths, provider URLs and SDK errors.
  return { status, body: { ok: false, code } };
}
function validTweetId(value: unknown): value is string { return typeof value === "string" && /^[0-9]{1,30}$/.test(value); }
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9/_.,-]*$/.test(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
async function readOne(query: PromiseLike<Result>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error("media_lookup_failed");
  if (data === null) return null;
  const row = record(data);
  if (!row) throw new Error("media_lookup_invalid");
  return row;
}
async function readRows(query: PromiseLike<Result>): Promise<Row[]> {
  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.some((row) => !record(row))) throw new Error("media_lookup_failed");
  return data as Row[];
}
async function privateStorage(client: SupabaseAdminClient): Promise<MediaStorage | null> {
  const storage = (client as SupabaseAdminClient & { storage: MediaStorage }).storage;
  const { data, error } = await storage.getBucket(MEDIA_BUCKET);
  const bucket = record(data);
  return !error && bucket?.id === MEDIA_BUCKET && bucket.public === false ? storage : null;
}
function assetMetadata(row: Row, source: "source" | "output") {
  const mime = text(source === "source" ? row.mime_type : row.output_mime_type);
  return {
    id: text(row.id), source, kind: mime.startsWith("video/") ? "video" : "image",
    mime_type: mime, file_size: number(source === "source" ? row.file_size : row.output_file_size),
    width: number(row.width), height: number(row.height), duration_ms: number(row.duration_ms),
    available: Boolean(MIME_EXTENSIONS[mime] && (source === "source"
      ? row.downloaded_at && row.storage_path && row.object_id
      : row.status === "completed" && row.output_storage_path)),
  };
}

/** Bounded archive lookup. It never resolves a provider URL or signs an object. */
export async function getMediaCatalog(
  client: SupabaseAdminClient, body: Row, context: MediaAccessContext,
): Promise<AdminActionResponse> {
  if (context.role !== "admin") return failure("media_access_denied", 403);
  if (!validTweetId(body.tweet_id) || Object.keys(body).some((key) => !["action", "tweet_id"].includes(key))) {
    return failure("media_request_invalid", 400);
  }
  try {
    const post = await readOne(table(client, "posts").select("tweet_id,author_handle").eq("tweet_id", body.tweet_id).maybeSingle());
    if (!post || post.tweet_id !== body.tweet_id) return failure("media_post_not_archived");
    if (!await privateStorage(client)) return failure("media_access_unavailable");
    const sources = await readRows(table(client, "media")
      .select("id,tweet_id,object_id,kind,mime_type,file_size,width,height,duration_ms,downloaded_at,storage_path")
      .eq("tweet_id", body.tweet_id).order("ordering", { ascending: true }).limit(16));
    const outputs = await readRows(table(client, "video_renders")
      .select("id,tweet_id,status,output_mime_type,output_file_size,width,height,duration_ms,output_storage_path,expires_at")
      .eq("tweet_id", body.tweet_id).order("created_at", { ascending: false }).limit(8));
    const now = (context.now ?? Date.now)();
    return { body: {
      ok: true, tweet_id: body.tweet_id, author_handle: text(post.author_handle),
      assets: [
        ...sources.filter((row) => row.tweet_id === body.tweet_id).map((row) => assetMetadata(row, "source")),
        ...outputs.filter((row) => row.tweet_id === body.tweet_id).map((row) => ({
          ...assetMetadata(row, "output"),
          available: assetMetadata(row, "output").available && (!row.expires_at || Date.parse(text(row.expires_at)) > now),
        })),
      ],
    } };
  } catch { return failure("media_access_unavailable"); }
}

/** One explicit grant, bound to an authenticated admin and a canonical logical object. */
export async function getMediaAccess(
  client: SupabaseAdminClient, body: Row, context: MediaAccessContext,
): Promise<AdminActionResponse> {
  if (context.role !== "admin") return failure("media_access_denied", 403);
  const output = body.render_id !== undefined;
  const idKey = output ? "render_id" : "media_id";
  if (!validTweetId(body.tweet_id) || !validId(body[idKey])
    || !["preview", "download"].includes(text(body.purpose))
    || Object.keys(body).some((key) => !["action", "tweet_id", idKey, "purpose"].includes(key))) {
    return failure("media_request_invalid", 400);
  }
  try {
    const post = await readOne(table(client, "posts").select("tweet_id").eq("tweet_id", body.tweet_id).maybeSingle());
    if (!post || post.tweet_id !== body.tweet_id) return failure("media_not_found");
    const row = await readOne(table(client, output ? "video_renders" : "media")
      .select(output
        ? "id,tweet_id,status,source_media_id,output_storage_path,output_mime_type,output_file_size,width,height,duration_ms,expires_at"
        : "id,tweet_id,object_id,storage_path,mime_type,file_size,width,height,duration_ms,downloaded_at")
      .eq("id", body[idKey]).eq("tweet_id", body.tweet_id).maybeSingle());
    if (!row || row.id !== body[idKey] || row.tweet_id !== body.tweet_id) return failure("media_not_found");
    const now = (context.now ?? Date.now)();
    if (output && (row.status === "expired" || (row.expires_at && !(Date.parse(text(row.expires_at)) > now)))) {
      return failure("media_expired");
    }
    if (output ? row.status !== "completed" : !row.downloaded_at) return failure("media_not_ready");
    const path = output ? row.output_storage_path : row.storage_path;
    if (!safePath(path)) return failure("media_not_found");
    if (!output) {
      if (!validId(row.object_id)) return failure("media_access_unavailable");
      const object = await readOne(table(client, "media_objects")
        .select("id,bucket_id,storage_path,status,deleted_at").eq("id", row.object_id).maybeSingle());
      if (!object || object.id !== row.object_id || object.bucket_id !== MEDIA_BUCKET
        || object.storage_path !== path || object.status !== "active" || object.deleted_at) return failure("media_expired");
    } else {
      // A render cannot authorize an unrelated post's source or output reference.
      const source = await readOne(table(client, "media").select("id,tweet_id")
        .eq("id", row.source_media_id).eq("tweet_id", body.tweet_id).maybeSingle());
      if (!source || source.id !== row.source_media_id || source.tweet_id !== body.tweet_id) return failure("media_not_found");
    }
    const mime = text(output ? row.output_mime_type : row.mime_type);
    const extension = MIME_EXTENSIONS[mime];
    const bytes = number(output ? row.output_file_size : row.file_size);
    if (!extension || !bytes || !Number.isSafeInteger(bytes) || bytes > MAX_ASSET_BYTES) return failure("media_type_unsupported");
    const storage = await privateStorage(client);
    if (!storage) return failure("media_access_unavailable");
    const separator = path.lastIndexOf("/");
    const filename = path.slice(separator + 1);
    const { data: listed, error: listError } = await storage.from(MEDIA_BUCKET)
      .list(separator < 0 ? "" : path.slice(0, separator), { search: filename, limit: 100 });
    if (listError || !Array.isArray(listed)) return failure("media_access_unavailable");
    const stored = listed.map(record).find((object) => object?.name === filename && object.id);
    if (!stored) return failure("media_not_found");
    const metadata = record(stored.metadata);
    if (metadata?.mimetype !== mime || number(metadata.size) !== bytes) return failure("media_type_unsupported");
    const remainingSeconds = output && row.expires_at
      ? Math.floor((Date.parse(text(row.expires_at)) - now) / 1000) : MEDIA_ACCESS_SECONDS;
    const seconds = Math.min(MEDIA_ACCESS_SECONDS, remainingSeconds);
    if (seconds < 1) return failure("media_expired");
    const downloadName = `xot-${body.tweet_id}-${output ? "output" : "source"}-${text(row.id).slice(0, 8)}.${extension}`;
    const { data, error } = await storage.from(MEDIA_BUCKET).createSignedUrl(
      path, seconds, body.purpose === "download" ? { download: downloadName } : undefined,
    );
    if (error || !data?.signedUrl) return failure("media_access_unavailable");
    const origin = new URL(context.storageOrigin);
    const grant = new URL(data.signedUrl);
    const expectedPath = `/storage/v1/object/sign/${MEDIA_BUCKET}/${path}`;
    if (origin.protocol !== "https:" || grant.origin !== origin.origin || grant.username || grant.password
      || decodeURIComponent(grant.pathname) !== expectedPath || !grant.searchParams.get("token")
      || grant.hash || [...grant.searchParams.keys()].some((key) => !["token", "download"].includes(key))) {
      return failure("media_access_unavailable");
    }
    return { body: { ok: true, asset: {
      id: text(row.id), tweet_id: body.tweet_id, source: output ? "output" : "source",
      kind: mime.startsWith("video/") ? "video" : "image", mime_type: mime, file_size: bytes,
      width: number(row.width), height: number(row.height), duration_ms: number(row.duration_ms),
      purpose: body.purpose, signed_url: grant.href, expires_at: new Date(now + seconds * 1000).toISOString(),
      filename: downloadName, provenance: "private_archive",
    } } };
  } catch { return failure("media_access_unavailable"); }
}
