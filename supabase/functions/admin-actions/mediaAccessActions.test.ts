import { strict as assert } from "node:assert";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { getMediaAccess, getMediaCatalog, type MediaAccessContext } from "./mediaAccessActions.ts";
import { isReadOnlyAdminActionName } from "../_shared/adminActionNames.ts";
import { archivePostIdentityVariants, isArchivePostIdentity, MAX_ARCHIVE_POST_VARIANTS } from "../_shared/archivePostIdentity.ts";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const OBJECT_ID = "22222222-2222-4222-8222-222222222222";
const RENDER_ID = "33333333-3333-4333-8333-333333333333";
const TWEET_ID = "123456";
const URL_STATUS_ID = "2092144212879765707";
const URL_TWEET_ID = `https://twitter.com/Archive_News/status/${URL_STATUS_ID}`;
const ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const NOW = Date.parse("2026-09-11T12:00:00Z");
type Row = Record<string, unknown>;
function likePattern(pattern: string): RegExp {
  let expression = "";
  let escaped = false;
  for (const character of pattern) {
    if (!escaped && character === "\\") { escaped = true; continue; }
    expression += !escaped && ["%", "*", "_"].includes(character)
      ? character === "_" ? "." : ".*" : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    escaped = false;
  }
  assert.equal(escaped, false);
  return new RegExp(`^${expression}$`, "i");
}
function fixture(patch: { tweetId?: string; posts?: Row[]; unfilteredPosts?: boolean; media?: Row; object?: Row; render?: Row; bucket?: Row; stored?: Row | null; signUrl?: string; failTable?: string } = {}) {
  const tweetId = patch.tweetId ?? TWEET_ID;
  const media = { id: MEDIA_ID, tweet_id: tweetId, object_id: OBJECT_ID, storage_path: "2026/9/source.mp4", downloaded_at: "2026-09-11", mime_type: "video/mp4", file_size: 256, ...patch.media };
  const output = { id: RENDER_ID, tweet_id: tweetId, source_media_id: MEDIA_ID, output_storage_path: "processed/v1/2026/09/123456/output.mp4", status: "completed", output_mime_type: "video/mp4", output_file_size: 256, expires_at: "2026-09-11T13:00:00Z", ...patch.render };
  const rows: Record<string, Row[]> = {
    posts: patch.posts ?? [{ tweet_id: tweetId, author_handle: "example" }], media: [media], video_renders: [output],
    media_objects: [{ id: OBJECT_ID, storage_path: media.storage_path, bucket_id: "temp-media", status: "active", deleted_at: null, ...patch.object }],
  };
  const signed: { path: string; seconds: number; download?: string }[] = [];
  const queries: string[] = [];
  const reads: { table: string; limit?: number; or?: string; equals: [string, unknown][] }[] = [];
  const client = {
    from(name: string) {
      queries.push(name);
      const filters: [string, unknown][] = [];
      const read: typeof reads[number] = { table: name, equals: filters };
      reads.push(read);
      let patterns: RegExp[] | undefined;
      const result = () => patch.failTable === name ? { data: null, error: {} } : {
        data: rows[name].filter((row) => patch.unfilteredPosts && name === "posts"
          || (filters.every(([key, value]) => row[key] === value) && (!patterns || patterns.some((pattern) => pattern.test(String(row.tweet_id)))))).slice(0, read.limit), error: null,
      };
      const builder = {
        select(_value: string) { return builder; }, order(_key: string) { return builder; }, limit(value: number) { read.limit = value; return builder; },
        eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
        or(value: string) {
          read.or = value;
          patterns = value.split(",").map((filter) => {
            assert.match(filter, /^tweet_id\.ilike\.[A-Za-z0-9:/._\\-]+$/);
            return likePattern(filter.slice("tweet_id.ilike.".length));
          });
          return builder;
        },
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
  return { client, signed, queries, reads };
}
const context: MediaAccessContext = { role: "admin", storageOrigin: ORIGIN, now: () => NOW };
const sourceRequest = { action: "get_media_access", tweet_id: TWEET_ID, media_id: MEDIA_ID, purpose: "preview" };

Deno.test("archive grant requires admin before any lookup or signing", async () => {
  const f = fixture();
  for (const role of ["read_only", null, "viewer"]) {
    const result = await getMediaAccess(f.client, sourceRequest, { ...context, role } as MediaAccessContext);
    assert.equal(result.status, 403);
    assert.equal((await getMediaCatalog(f.client, { tweet_id: URL_TWEET_ID }, { ...context, role } as MediaAccessContext)).status, 403);
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

Deno.test("URL-backed source and output grants preserve exact identity and safe attachment names", async () => {
  for (const output of [false, true]) {
    const bytes = output ? 6652812 : 684638;
    const f = fixture({ tweetId: URL_TWEET_ID, media: { file_size: bytes }, render: { output_file_size: bytes }, stored: { metadata: { mimetype: "video/mp4", size: bytes } } });
    const response = await getMediaAccess(f.client, {
      action: "get_media_access", tweet_id: URL_TWEET_ID, purpose: "download", ...(output ? { render_id: RENDER_ID } : { media_id: MEDIA_ID }),
    }, context);
    const body = response.body as { ok: boolean; asset: Row };
    assert.equal(body.ok, true);
    assert.equal(body.asset.tweet_id, URL_TWEET_ID);
    assert.equal(body.asset.file_size, bytes);
    assert.equal(body.asset.mime_type, "video/mp4");
    assert.equal(body.asset.provenance, "private_archive");
    assert.match(String(body.asset.filename), new RegExp(`^xot-${URL_STATUS_ID}-${output ? "output" : "source"}-[0-9a-f]{8}\\.mp4$`));
    assert.equal(f.signed[0].download, body.asset.filename);
    assert.equal(f.signed[0].seconds, 120);
    assert.equal(f.reads.some((read) => read.or), false, "grant lookup must never resolve aliases");
  }
});

Deno.test("catalog resolves complete URL variants and case while preserving literal handle underscores", async () => {
  for (const reference of [
    URL_TWEET_ID,
    `https://x.com/archive_news/status/${URL_STATUS_ID}?s=20`,
    `http://www.twitter.com/ARCHIVE_NEWS/status/${URL_STATUS_ID}/`,
    `https://mobile.twitter.com/archive_news/status/${URL_STATUS_ID}`,
    `https://fxtwitter.com/archive_news/status/${URL_STATUS_ID}/video/1`,
    `https://vxtwitter.com/archive_news/status/${URL_STATUS_ID}#share`,
  ]) {
    const f = fixture({ tweetId: URL_TWEET_ID, posts: [
      { tweet_id: URL_TWEET_ID },
      { tweet_id: URL_TWEET_ID.replace("Archive_News", "ArchiveXNews") },
      { tweet_id: URL_TWEET_ID.replace(URL_STATUS_ID, `${URL_STATUS_ID}0`) },
    ] });
    const response = await getMediaCatalog(f.client, { action: "get_media_catalog", tweet_id: reference }, context);
    const body = response.body as { ok: boolean; tweet_id: string; assets: Row[] };
    assert.equal(body.ok, true);
    assert.equal(body.tweet_id, URL_TWEET_ID);
    assert.equal(body.assets.length, 2);
    assert.equal(body.assets.every((asset) => asset.available), true);
    assert.equal(f.reads[0].limit, 2);
    assert.equal(f.reads[0].or!.split(",").length, MAX_ARCHIVE_POST_VARIANTS);
    assert.equal(f.reads[0].or!.includes("%"), false);
    assert.match(f.reads[0].or!, /archive\\_news/i);
    assert.deepEqual(f.reads.slice(1).map((read) => read.equals), [[["tweet_id", URL_TWEET_ID]], [["tweet_id", URL_TWEET_ID]]]);
    assert.equal(f.queries.filter((name) => name === "posts").length, 1);
    assert.equal(f.signed.length, 0);
  }
});

Deno.test("deployed SDK version transports unquoted literal ILIKE escapes without network access", async () => {
  const requests: URL[] = [];
  const client = createClient(ORIGIN, "synthetic-test-key", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input) => {
      requests.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url));
      return Promise.resolve(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    } },
  });
  const response = await getMediaCatalog(client, { tweet_id: URL_TWEET_ID }, context);
  assert.equal((response.body as Row).code, "media_post_not_archived");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/rest/v1/posts");
  assert.equal(requests[0].searchParams.get("limit"), "2");
  const transported = requests[0].searchParams.get("or")!;
  assert.equal(transported.split(",").length, MAX_ARCHIVE_POST_VARIANTS);
  assert.equal(transported.startsWith(`(tweet_id.ilike.${URL_STATUS_ID},tweet_id.ilike.https://twitter.com/Archive\\_News/status/${URL_STATUS_ID},`), true);
  assert.equal(transported.includes('"'), false);
  assert.equal(transported.includes("%"), false);
  assert.equal(transported.includes("*"), false);
});

Deno.test("numeric catalogs stay exact and URL references can resolve numeric archive keys", async () => {
  for (const reference of [TWEET_ID, `https://x.com/example/status/${TWEET_ID}`]) {
    const f = fixture();
    const body = (await getMediaCatalog(f.client, { tweet_id: reference }, context)).body as Row;
    assert.equal(body.ok, true);
    assert.equal(body.tweet_id, TWEET_ID);
  }
  assert.deepEqual(archivePostIdentityVariants(TWEET_ID), [TWEET_ID]);
  const f = fixture({ tweetId: URL_TWEET_ID });
  assert.equal(((await getMediaCatalog(f.client, { tweet_id: URL_STATUS_ID }, context)).body as Row).code, "media_post_not_archived");
  assert.equal(f.reads[0].or, `tweet_id.ilike.${URL_STATUS_ID}`);
});

Deno.test("ambiguous catalog identities fail closed before reading or signing media", async () => {
  for (const secondIdentity of [URL_STATUS_ID, URL_TWEET_ID.replace("twitter.com", "x.com"), URL_TWEET_ID.toLowerCase()]) {
    const f = fixture({ tweetId: URL_TWEET_ID, posts: [{ tweet_id: URL_TWEET_ID }, { tweet_id: secondIdentity }] });
    assert.equal(((await getMediaCatalog(f.client, { tweet_id: URL_TWEET_ID }, context)).body as Row).code, "media_post_ambiguous");
    assert.deepEqual(f.queries, ["posts"]);
    assert.equal(f.signed.length, 0);
  }
});

Deno.test("catalog rejects unrelated database results and malformed reference inputs", async () => {
  const f = fixture({ posts: [{ tweet_id: URL_TWEET_ID.replace("Archive_News", "Other") }], unfilteredPosts: true });
  assert.equal(((await getMediaCatalog(f.client, { tweet_id: URL_TWEET_ID }, context)).body as Row).code, "media_access_unavailable");
  for (const tweet_id of ["https://evil.invalid/a/status/123", "https://x.com.evil.invalid/a/status/123", "https://user@x.com/a/status/123", "https://x.com:443/a/status/123", "https://x.com/a%5fb/status/123", "https://x.com/a/status/123/../456", "https://x.com/a/status/123,other", "1".repeat(31), 123]) {
    const invalid = fixture();
    assert.equal((await getMediaCatalog(invalid.client, { tweet_id }, context)).status, 400);
    assert.equal((await getMediaAccess(invalid.client, { ...sourceRequest, tweet_id }, context)).status, 400);
    assert.deepEqual(invalid.queries, []);
    assert.deepEqual(invalid.signed, []);
  }
});

Deno.test("grant identity is exact even when different stored keys share a numeric status ID", async () => {
  for (const requested of [URL_STATUS_ID, URL_TWEET_ID.toLowerCase(), URL_TWEET_ID.replace("twitter.com", "x.com")]) {
    const f = fixture({ tweetId: URL_TWEET_ID, posts: [{ tweet_id: requested }, { tweet_id: URL_TWEET_ID }] });
    assert.equal(((await getMediaAccess(f.client, { ...sourceRequest, tweet_id: requested }, context)).body as Row).code, "media_not_found");
    assert.equal(f.signed.length, 0);
  }
  const f = fixture({ tweetId: URL_TWEET_ID, media: { tweet_id: URL_STATUS_ID } });
  assert.equal(((await getMediaAccess(f.client, { tweet_id: URL_TWEET_ID, render_id: RENDER_ID, purpose: "preview" }, context)).body as Row).code, "media_not_found");
  assert.equal(f.signed.length, 0);
  for (const alias of [`${URL_TWEET_ID}?s=20`, URL_TWEET_ID.replace("twitter.com", "fxtwitter.com")]) {
    assert.equal(isArchivePostIdentity(alias), false);
    assert.equal((await getMediaAccess(f.client, { ...sourceRequest, tweet_id: alias }, context)).status, 400);
  }
});

Deno.test("URL-backed grants retain private storage, object metadata and retention checks", async () => {
  for (const [patch, expected] of [
    [{ bucket: { public: true } }, "media_access_unavailable"],
    [{ stored: null }, "media_not_found"],
    [{ stored: { metadata: { mimetype: "video/mp4", size: 257 } } }, "media_type_unsupported"],
    [{ render: { expires_at: "2026-09-11T11:59:59Z" } }, "media_expired"],
  ] as const) {
    const f = fixture({ tweetId: URL_TWEET_ID, ...patch });
    assert.equal(((await getMediaAccess(f.client, { tweet_id: URL_TWEET_ID, render_id: RENDER_ID, purpose: "preview" }, context)).body as Row).code, expected);
    assert.equal(f.signed.length, 0);
  }
  const f = fixture({ tweetId: URL_TWEET_ID, render: { expires_at: "2026-09-11T12:00:30Z" } });
  assert.equal(((await getMediaAccess(f.client, { tweet_id: URL_TWEET_ID, render_id: RENDER_ID, purpose: "preview" }, context)).body as Row).ok, true);
  assert.equal(f.signed[0].seconds, 30);
});
