import { assertEquals } from "jsr:@std/assert";
import { downloadMediaForTweet } from "./index.ts";
import {
  selectMediaTier,
  type XMediaRow,
} from "../_shared/mediaSelection.ts";

// Importing ./index.ts starts a background `serve(handler)` so the entry
// point begins listening on :8000 (the same harmless side effect appears
// in admin-actions/runtimeControlsRoute.test.ts). It does not block
// tests; the assertions below exercise `downloadMediaForTweet` directly
// with a stub Supabase client to assert the reuse-by-hash branch's
// observable contracts.

interface RecordedMediaUpdate {
  values: Record<string, unknown>;
}

interface RecordedPipelineEvent {
  step: string;
  status: string;
  error: string | null;
  meta: Record<string, unknown>;
}

interface RecordedScope {
  mediaItems: Record<string, unknown>[];
  existingRows: Record<string, unknown>[];
  mediaUpdates: RecordedMediaUpdate[];
  pipelineEvents: RecordedPipelineEvent[];
  uploadCalls: string[];
  removeCalls: string[][];
  updateMatches: boolean;
}

function createStubClient(scope: RecordedScope) {
  // The terminal resolution for a `guardedMediaUpdate` SELECT chain:
  //   from('media').update(values).eq('id', _).is('storage_path', null)
  //     [.eq('src_url_hash', _) | .is('src_url_hash', null)]
  //     .select('id').maybeSingle()
  // `.maybeSingle()` resolves to `{data, error}`; `data` is null when the
  // conditional `eq/is` guards decided the row no longer matches.
  const updateSelectTerminal = () => ({
    select: () => ({
      maybeSingle: () =>
        Promise.resolve({
          data: scope.updateMatches ? { id: "row-id" } : null,
          error: null,
        }),
    }),
  });

  return {
    from(table: string) {
      if (table === "pipeline_events") {
        return {
          insert(values: Record<string, unknown>) {
            scope.pipelineEvents.push({
              step: typeof values.step === "string" ? values.step : "",
              status: typeof values.status === "string" ? values.status : "",
              error: typeof values.error === "string" ? values.error : null,
              meta: (values.meta as Record<string, unknown> | undefined) ?? {},
            });
            return Promise.resolve({ error: null });
          },
        };
      }
      // table === "media"
      // Two SELECT chains share the .select(_) entry — the initial per-tweet
      // selection (terminating in .limit()) and the cross-tweet reuse lookup
      // (terminating in .not()). Spread both into one chain object.
      return {
        select(_columns: string) {
          return {
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({ data: scope.mediaItems, error: null }),
                }),
              }),
            }),
            in: () => ({
              not: () =>
                Promise.resolve({ data: scope.existingRows, error: null }),
            }),
          };
        },
        update(values: Record<string, unknown>) {
          scope.mediaUpdates.push({ values });
          return {
            eq: () => ({
              is: () => ({
                eq: () => updateSelectTerminal(),
                is: () => updateSelectTerminal(),
              }),
            }),
          };
        },
      };
    },
    storage: {
      from(_bucket: string) {
        return {
          upload(path: string, _body: Uint8Array, _options?: Record<string, unknown>) {
            scope.uploadCalls.push(path);
            return Promise.resolve({ error: null });
          },
          remove(paths: string[]) {
            scope.removeCalls.push(paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

interface MediaItemOpts {
  id: string;
  tweetId: string;
  srcUrl: string;
  srcUrlHash: string;
  ordering?: number;
  kind?: string;
}

function mediaItem(opts: MediaItemOpts): Record<string, unknown> {
  return {
    id: opts.id,
    tweet_id: opts.tweetId,
    src_url: opts.srcUrl,
    src_url_hash: opts.srcUrlHash,
    ordering: opts.ordering ?? 0,
    kind: opts.kind ?? "image",
    storage_path: null,
    downloaded_at: null,
    mime_type: null,
    file_size: null,
  };
}

interface DonorOpts {
  storagePath: string;
  srcUrlHash: string;
  fileSize: number | null;
  mimeType: string | null;
}

function donorRow(opts: DonorOpts): Record<string, unknown> {
  return {
    src_url_hash: opts.srcUrlHash,
    storage_path: opts.storagePath,
    file_size: opts.fileSize,
    mime_type: opts.mimeType,
  };
}

function freshScope(overrides: Partial<RecordedScope> = {}): RecordedScope {
  return {
    mediaItems: [],
    existingRows: [],
    mediaUpdates: [],
    pipelineEvents: [],
    uploadCalls: [],
    removeCalls: [],
    updateMatches: true,
    ...overrides,
  };
}

Deno.test("reuse-by-hash copies the donor's file_size and mime_type onto the reused row and emits a completed/reused event", async () => {
  const srcUrlHash = "a".repeat(64);
  const scope = freshScope({
    mediaItems: [mediaItem({
      id: "media-row-200",
      tweetId: "200",
      srcUrl: "https://pbs.twimg.com/media/photo.jpg",
      srcUrlHash,
    })],
    existingRows: [donorRow({
      storagePath: "2026/5/tweet_0_donor.jpg",
      srcUrlHash,
      fileSize: 1024,
      mimeType: "image/jpeg",
    })],
  });
  const client = createStubClient(scope);

  const response = await downloadMediaForTweet(client as never, "200", false);
  const body = await response.json();

  assertEquals(body.success, true);
  assertEquals(body.downloaded, 0);
  assertEquals(body.reused, 1);
  assertEquals(body.failed, 0);
  assertEquals(body.skipped_over_limit, 0);
  assertEquals(body.total, 1);
  assertEquals(body.media_items_total, 1);
  assertEquals(body.media_downloaded, 0);
  assertEquals(body.media_reused, 1);
  assertEquals(body.media_failed, 0);
  assertEquals(typeof body.media_download_ms, "number");

  assertEquals(scope.uploadCalls, [], "reuse must not upload a new storage object");
  assertEquals(scope.mediaUpdates.length, 1);
  assertEquals(scope.mediaUpdates[0].values.storage_path, "2026/5/tweet_0_donor.jpg");
  assertEquals(scope.mediaUpdates[0].values.file_size, 1024);
  assertEquals(scope.mediaUpdates[0].values.mime_type, "image/jpeg");
  assertEquals(typeof scope.mediaUpdates[0].values.downloaded_at, "string");

  const reusedEvent = scope.pipelineEvents.find((e) => e.meta.reused === true);
  assertEquals(reusedEvent?.step, "download_media");
  assertEquals(reusedEvent?.status, "completed");
  assertEquals(reusedEvent?.error, null);
  assertEquals(reusedEvent?.meta.storage_path, "2026/5/tweet_0_donor.jpg");
  assertEquals(reusedEvent?.meta.file_size, 1024);
  assertEquals(reusedEvent?.meta.mime_type, "image/jpeg");
  assertEquals(typeof reusedEvent?.meta.media_download_ms, "number");
});

Deno.test("reuse-by-hash produces a row shape that selectMediaTier treats as sendable image", async () => {
  const srcUrlHash = "b".repeat(64);
  const scope = freshScope({
    mediaItems: [mediaItem({
      id: "media-row-201",
      tweetId: "201",
      srcUrl: "https://pbs.twimg.com/media/cat.png",
      srcUrlHash,
    })],
    existingRows: [donorRow({
      storagePath: "2026/4/cat.png",
      srcUrlHash,
      fileSize: 4096,
      mimeType: "image/png",
    })],
  });
  const client = createStubClient(scope);
  await downloadMediaForTweet(client as never, "201", false);

  assertEquals(scope.mediaUpdates.length, 1);
  const values = scope.mediaUpdates[0].values;
  const reusedRow: XMediaRow = {
    kind: "image",
    src_url: "https://pbs.twimg.com/media/cat.png",
    storage_path: values.storage_path as string,
    downloaded_at: values.downloaded_at as string,
    mime_type: values.mime_type as string,
    file_size: values.file_size as number,
  };
  assertEquals(selectMediaTier([reusedRow]), { tier: "image", items: [reusedRow] });
});

Deno.test("reuse-by-hash produces a row shape that selectMediaTier treats as sendable video", async () => {
  const srcUrlHash = "c".repeat(64);
  const scope = freshScope({
    mediaItems: [mediaItem({
      id: "media-row-202",
      tweetId: "202",
      srcUrl: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
      srcUrlHash,
      kind: "video",
    })],
    existingRows: [donorRow({
      storagePath: "2026/5/donor.mp4",
      srcUrlHash,
      fileSize: 2_000_000,
      mimeType: "video/mp4",
    })],
  });
  const client = createStubClient(scope);
  await downloadMediaForTweet(client as never, "202", false);

  assertEquals(scope.mediaUpdates.length, 1);
  const values = scope.mediaUpdates[0].values;
  const reusedRow: XMediaRow = {
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/video.mp4",
    storage_path: values.storage_path as string,
    downloaded_at: values.downloaded_at as string,
    mime_type: values.mime_type as string,
    file_size: values.file_size as number,
    duration_ms: 30_000,
  };
  assertEquals(selectMediaTier([reusedRow], { allowVideo: true }), { tier: "video", items: [reusedRow] });
});

Deno.test("a donor lacking file_size/mime_type falls through to a fresh-download attempt instead of producing a metadata-null reuse", async () => {
  const srcUrlHash = "d".repeat(64);
  const scope = freshScope({
    mediaItems: [mediaItem({
      id: "media-row-203",
      tweetId: "203",
      srcUrl: "https://pbs.twimg.com/media/broken.jpg",
      srcUrlHash,
    })],
    // A previously reused row survived as a donor with null metadata — the
    // exact donor shape the buggy reuse branch used to produce.
    existingRows: [donorRow({
      storagePath: "2026/5/old_reuse.jpg",
      srcUrlHash,
      fileSize: null,
      mimeType: null,
    })],
  });
  const client = createStubClient(scope);

  const response = await downloadMediaForTweet(client as never, "203", false);
  const body = await response.json();

  // The branch must NOT have stamped a reuse with the broken donor.
  assertEquals(scope.mediaUpdates, [], "must not call guardedMediaUpdate with a metadata-null donor");
  assertEquals(scope.uploadCalls, [], "must not upload a new storage object for a metadata-null donor either");
  assertEquals(
    scope.pipelineEvents.some((e) => e.meta.reused === true),
    false,
    "must not emit a reused event when the donor lacks metadata",
  );

  // The fall-through attempts a fresh download. Without real network
  // access (tests run with --allow-net scoped to loopback), the fresh
  // download throws, the catch block records a failed event, and
  // failedCount bumps to 1. The guarantee the bug fix needs is observable
  // as the absence of the reuse-shaped side effects above — the
  // downloaded/reused/failed breakdown confirms the branch did not return
  // early on a metadata-null donor.
  assertEquals(body.reused, 0);
  assertEquals(body.downloaded, 0);
  assertEquals(body.failed, 1);
  assertEquals(scope.pipelineEvents.length, 1);
  assertEquals(scope.pipelineEvents[0].status, "failed");
});

Deno.test("when multiple donors exist for the same hash, a metadata-bearing donor is preferred over a metadata-null one", async () => {
  const srcUrlHash = "e".repeat(64);
  const scope = freshScope({
    mediaItems: [mediaItem({
      id: "media-row-204",
      tweetId: "204",
      srcUrl: "https://pbs.twimg.com/media/pref.jpg",
      srcUrlHash,
    })],
    // The metadata-null donor is returned FIRST — mimicking a previously
    // reused row surviving as a donor alongside a freshly downloaded row
    // for the same src_url_hash. Without donor preference we would reuse
    // the broken donor (the legacy bug, in a chain one hop away).
    existingRows: [
      donorRow({ storagePath: "2026/5/old_reuse.jpg", srcUrlHash, fileSize: null, mimeType: null }),
      donorRow({ storagePath: "2026/5/healthy.jpg", srcUrlHash, fileSize: 2048, mimeType: "image/jpeg" }),
    ],
  });
  const client = createStubClient(scope);
  await downloadMediaForTweet(client as never, "204", false);

  assertEquals(scope.mediaUpdates.length, 1);
  assertEquals(scope.mediaUpdates[0].values.storage_path, "2026/5/healthy.jpg");
  assertEquals(scope.mediaUpdates[0].values.file_size, 2048);
  assertEquals(scope.mediaUpdates[0].values.mime_type, "image/jpeg");
  assertEquals(scope.uploadCalls, []);
  assertEquals(
    scope.pipelineEvents.find((e) => e.meta.reused === true)?.meta.storage_path,
    "2026/5/healthy.jpg",
  );
});
