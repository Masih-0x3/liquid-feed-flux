import { strict as assert } from "node:assert";
import { getMediaAccess, getMediaCatalog, type MediaAccessContext } from "./mediaAccessActions.ts";
import { isReadOnlyAdminActionName } from "../_shared/adminActionNames.ts";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "22222222-2222-4222-8222-222222222222";
const RENDER_ID = "33333333-3333-4333-8333-333333333333";
const TWEET_ID = "123456";
const ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const NOW = Date.parse("2026-09-11T12:00:00Z");
type Row = Record<string, unknown>;
function fixture(patch: { media?: Row; object?: Row; render?: Row; bucket?: Row; stored?: Row | null; signUrl?: string; failTable?: string } = {}) {
  const media = { id: MEDIA_ID, tweet_id: TWEET_ID, object_id: OBJECT_ID, storage_path: "2026/9/source.mp4", downloaded_at: "2026-09-11", mime_type: "video/mp4", file_size: 256, ...patch.media };
  const output = { id: RENDER_ID, tweet_id: TWEET_ID, source_media_id: MEDIA_ID, output_storage_path: "processed/v1/2026/09/123456/output.mp4", status: "completed", output_mime_type: "video/mp4", output_file_size: 256, expires_at: "2026-09-11T13:00:00Z", ...patch.render };
  const rows: Record<string, Row[]> = {
    posts: [{ tweet_id: TWEET_ID, author_handle: "example" }], media: [media], video_renders: [output],
    media_objects: [{ id: OBJECT_ID, storage_path: media.storage_path, bucket_id: "temp-media", status: "active", deleted_at: null, ...patch.object }],
  };
  const signed: { path: string; seconds: number; download?: string }[] = [];
  const queries: string[] = [];
  const client = {
    from(name: string) {
      queries.push(name);
      const filters: [string, unknown][] = [];
      const result = () => patch.failTable === name ? { data: null, error: {} } : { data: rows[name].filter((row) => filters.every(([key, value]) => row[key] === value)), error: null };
      const builder = {
        select(_value: string) { return builder; }, order(_key: string) { return builder; }, limit(_value: number) { return builder; },
        eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
        maybeSingle() { const read = result(); return Promise.resolve({ ...read, data: read.data?.[0] ?? null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); },
    storage: {
      getBucket() { return Promise.resolve({ data: { id: "temp-media", public: false, ...patch.bucket }, error: null }); },
      from(bucket: string) {
        assert.equal(bucket, "temp-media");
        return {
          list(_path: string, options: { search: string }) {
            return Promise.resolve({ data: patch.stored === null ? [] : [{ id: OBJECT_ID, name: options.search, metadata: { mimetype: "video/mp4", size: 256 }, ...patch.stored }], error: null });
          },
          createSignedUrl(path: string, seconds: number, options?: { download: string }) {
            signed.push({ path, seconds, download: options?.download });
            return Promise.resolve({ data: { signedUrl: patch.signUrl ?? `${ORIGIN}/storage/v1/object/sign/temp-media/${path}?token=synthetic${options ? `&download=${options.download}` : ""}` }, error: null });
          },
        };
      },
    },
  };
  return { client, signed, queries };
}
const context: MediaAccessContext = { role: "admin", storageOrigin: ORIGIN, now: () => NOW };
const sourceRequest = { action: "get_media_access", tweet_id: TWEET_ID, media_id: MEDIA_ID, purpose: "preview" };

Deno.test("archive grant requires admin before any lookup or signing", async () => {
  const f = fixture();
  for (const role of ["read_only", null, "viewer"]) {
    const result = await getMediaAccess(f.client, sourceRequest, { ...context, role } as MediaAccessContext);
    assert.equal(result.status, 403);
  }
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.signed, []);
  assert.equal(isReadOnlyAdminActionName("get_media_access"), false);
  assert.equal(isReadOnlyAdminActionName("get_media_catalog"), false);
});
Deno.test("archive grant rejects client paths, mixed IDs and cross-post requests", async () => {
  for (const request of [{ ...sourceRequest, path: "private/secret.mp4" }, { ...sourceRequest, render_id: RENDER_ID }, { ...sourceRequest, media_id: "https://example.com/a" }]) {
    const f = fixture();
    assert.equal((await getMediaAccess(f.client, request, context)).status, 400);
    assert.equal(f.signed.length, 0);
  }
  const f = fixture({ media: { tweet_id: "999" } });
  assert.equal(((await getMediaAccess(f.client, sourceRequest, context)).body as Row).code, "media_not_found");
  assert.equal(f.signed.length, 0);
});
Deno.test("archive grant returns bounded provenance and semantic video metadata", async () => {
  const f = fixture();
  const result = await getMediaAccess(f.client, sourceRequest, context);
  const body = result.body as { ok: boolean; asset: Row };
  assert.equal(body.ok, true);
  assert.equal(body.asset.kind, "video");
  assert.equal(body.asset.mime_type, "video/mp4");
  assert.equal(body.asset.provenance, "private_archive");
  assert.equal(body.asset.expires_at, "2026-09-11T12:02:00.000Z");
  assert.equal("storage_path" in body.asset, false);
  assert.equal("src_url" in body.asset, false);
  assert.equal(f.signed[0].seconds, 120);
});
Deno.test("archive image uses image semantics and download attachment name", async () => {
  const f = fixture({ media: { mime_type: "image/png", storage_path: "2026/9/image.png" }, stored: { metadata: { mimetype: "image/png", size: 256 } } });
  const result = await getMediaAccess(f.client, { ...sourceRequest, purpose: "download" }, context);
  const body = result.body as { ok: boolean; asset: Row };
  assert.equal(body.ok, true);
  assert.equal(body.asset.kind, "image");
  assert.match(f.signed[0].download!, /\.png$/);
  assert.equal(body.asset.purpose, "download");
});
Deno.test("archive grants reject public buckets, missing objects, lifecycle claims and MIME mismatch", async () => {
  for (const [patch, code] of [
    [{ bucket: { public: true } }, "media_access_unavailable"],
    [{ stored: null }, "media_not_found"],
    [{ object: { status: "deleting" } }, "media_expired"],
    [{ object: { storage_path: "different.mp4" } }, "media_expired"],
    [{ stored: { metadata: { mimetype: "text/html", size: 256 } } }, "media_type_unsupported"],
    [{ stored: { metadata: { mimetype: "video/mp4", size: 500 } } }, "media_type_unsupported"],
    [{ media: { mime_type: "image/svg+xml" } }, "media_type_unsupported"],
    [{ media: { storage_path: "../secret.mp4" } }, "media_not_found"],
    [{ failTable: "media_objects" }, "media_access_unavailable"],
  ] as const) {
    const f = fixture(patch);
    assert.equal(((await getMediaAccess(f.client, sourceRequest, context)).body as Row).code, code);
    assert.equal(f.signed.length, 0);
  }
});
Deno.test("render grants verify completed source ownership and respect retention expiry", async () => {
  const request = { action: "get_media_access", tweet_id: TWEET_ID, render_id: RENDER_ID, purpose: "preview" };
  for (const [patch, code] of [
    [{ render: { status: "running" } }, "media_not_ready"],
    [{ render: { output_storage_path: null } }, "media_not_found"],
    [{ render: { expires_at: "2026-09-11T11:59:59Z" } }, "media_expired"],
    [{ media: { tweet_id: "999" } }, "media_not_found"],
  ] as const) {
    const f = fixture(patch);
    assert.equal(((await getMediaAccess(f.client, request, context)).body as Row).code, code);
    assert.equal(f.signed.length, 0);
  }
  const f = fixture({ render: { expires_at: "2026-09-11T12:00:30Z" } });
  assert.equal(((await getMediaAccess(f.client, request, context)).body as Row).ok, true);
  assert.equal(f.signed[0].seconds, 30);
});
Deno.test("archive grant rejects signer origin and canonical path substitutions", async () => {
  for (const signUrl of [`https://media.invalid/source.mp4?token=a`, `${ORIGIN}/storage/v1/object/public/temp-media/2026/9/source.mp4`, `${ORIGIN}/storage/v1/object/sign/temp-media/other.mp4?token=a`]) {
    const f = fixture({ signUrl });
    assert.equal(((await getMediaAccess(f.client, sourceRequest, context)).body as Row).code, "media_access_unavailable");
  }
});
Deno.test("archive catalog exposes no storage/provider URLs and never signs an object", async () => {
  const f = fixture();
  const response = await getMediaCatalog(f.client, { action: "get_media_catalog", tweet_id: TWEET_ID }, context);
  const body = response.body as { ok: boolean; assets: Row[] };
  assert.equal(body.ok, true);
  assert.equal(body.assets.length, 2);
  assert.equal(body.assets[0].available, true);
  assert.equal("storage_path" in body.assets[0], false);
  assert.equal("signed_url" in body.assets[0], false);
  assert.equal(f.signed.length, 0);
});
