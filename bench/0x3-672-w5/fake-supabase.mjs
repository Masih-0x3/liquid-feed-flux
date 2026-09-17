// Minimal fake Supabase client for the 0X3-672 W5 benchmark.
// Absorbs every table/storage/rpc/functions seam that processRenderRow touches
// so the real local stages (ffprobe, ffmpeg, tesseract) run unchanged while all
// external services are stubbed deterministically.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

function ok(data = null) {
  return Promise.resolve({ data, error: null });
}

function makeQuery(table, fixtures) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    filter() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    update() { return builder; },
    upsert() { return ok({}); },
    insert() { return ok({}); },
    maybeSingle() { return ok(fixtures[table]?.single ?? null); },
    single() { return ok(fixtures[table]?.single ?? null); },
    then(resolve, reject) {
      return Promise.resolve({ data: fixtures[table]?.rows ?? [], error: null }).then(resolve, reject);
    },
  };
  return builder;
}

export function createFakeSupabase({ cohortDir, uploadDir, media, post }) {
  const uploads = [];
  const fixtures = {
    settings: {
      single: {
        key: "video_render_config",
        value: { mode: "enabled", render_version: "bench-v1" },
      },
    },
    media: { single: media },
    posts: { single: post },
    jobs: { rows: [] },
    video_renders: { single: null },
  };

  return {
    uploads,
    from(table) { return makeQuery(table, fixtures); },
    storage: {
      from() {
        return {
          async download(path) {
            const file = join(cohortDir, basename(path));
            const bytes = await readFile(file);
            return { data: new Blob([bytes], { type: "video/mp4" }), error: null };
          },
          async upload(path, data, options = {}) {
            const bytes = data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : Buffer.from(data);
            const dest = join(uploadDir, basename(path));
            await mkdir(uploadDir, { recursive: true });
            await writeFile(dest, bytes);
            uploads.push({ path, bytes: bytes.byteLength, dest, contentType: options.contentType ?? null });
            return { data: { path }, error: null };
          },
          async remove(paths) { return { data: { removed: paths }, error: null }; },
          async createSignedUrl(path) { return { data: { signedUrl: `fake://${path}` }, error: null }; },
        };
      },
    },
    async rpc(name, args = {}) {
      switch (name) {
        case "renew_video_render_lease":
          return { data: true, error: null };
        case "complete_video_render":
          return { data: [{ accepted: true, render_id: args.p_render_id, queued_deliver: false, dispatch_x: false }], error: null };
        case "fail_video_render":
          return { data: [{ accepted: true, render_id: args.p_render_id }], error: null };
        case "block_video_render":
          return { data: [{ accepted: true, render_id: args.p_render_id, blocked: true }], error: null };
        default:
          return { data: null, error: null };
      }
    },
    functions: {
      async invoke() { return { data: {}, error: null }; },
    },
  };
}
