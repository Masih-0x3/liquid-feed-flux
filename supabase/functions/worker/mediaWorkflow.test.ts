import { assertEquals } from "jsr:@std/assert";
import {
  buildMediaProcessorDownloadInvokeOptions,
  buildResolvedMediaRows,
  buildResolveMediaDownloadJob,
  rmFetchFromFx,
  rmFetchFromVx,
} from "./mediaWorkflow.ts";
import type { RemoteMediaDnsResolver } from "../_shared/remoteMediaPolicy.ts";

type FetchCall = {
  input: string;
  redirect?: RequestRedirect;
};

const publicDnsResolver: RemoteMediaDnsResolver = async (_hostname, recordType) =>
  recordType === "A" ? ["93.184.216.34"] : ["2606:2800:220:1:248:1893:25c8:1946"];

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchSequence(responses: Response[]) {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input: String(input), redirect: init?.redirect });
    return responses[index++] ?? response({}, 404);
  };
  return { calls, fetchImpl };
}

Deno.test("rmFetchFromFx picks best video variant and upgrades photos", async () => {
  const { calls, fetchImpl } = fetchSequence([
    response({
      tweet: {
        media: {
          videos: [
            {
              type: "video",
              url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/fallback.mp4",
              width: 720,
              height: 1280,
              duration: 5.9,
              variants: [
                {
                  url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/low.mp4",
                  bitrate: 200_000,
                  content_type: "video/mp4",
                },
                {
                  url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/high.mp4",
                  bitrate: 1_200_000,
                  content_type: "video/mp4",
                },
              ],
            },
          ],
          photos: [
            {
              url:
                "https://pbs.twimg.com/media/photo.jpg?format=jpg&name=small",
              width: 640,
              height: 480,
            },
          ],
        },
      },
    }),
  ]);

  const rows = await rmFetchFromFx("source", "123", fetchImpl, publicDnsResolver);

  assertEquals(calls, [{
    input: "https://api.fxtwitter.com/source/status/123",
    redirect: "error",
  }]);
  assertEquals(rows, [
    {
      kind: "video",
      url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/high.mp4",
      width: 720,
      height: 1280,
      duration_ms: 5900,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/photo.jpg?format=jpg&name=orig",
      width: 640,
      height: 480,
    },
  ]);
});

Deno.test("rmFetchFromVx parses extended media and upgrades image URLs", async () => {
  const { fetchImpl } = fetchSequence([
    response({
      media_extended: [
        {
          type: "gif",
          url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/loop.mp4",
          duration_millis: 4200,
          size: { width: 720, height: 1280 },
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/vx.jpg?format=jpg&name=small",
          size: { width: 1320, height: 981 },
        },
        { type: "unknown", url: "https://example.com/ignored" },
      ],
    }),
  ]);

  const rows = await rmFetchFromVx("source", "123", fetchImpl, publicDnsResolver);

  assertEquals(rows, [
    {
      kind: "gif",
      url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/loop.mp4",
      duration_ms: 4200,
      width: 720,
      height: 1280,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/vx.jpg?format=jpg&name=orig",
      width: 1320,
      height: 981,
    },
  ]);
});

Deno.test("rmFetchFromVx tolerates missing or malformed size metadata", async () => {
  const { fetchImpl } = fetchSequence([
    response({
      media_extended: [
        {
          type: "video",
          url: "https://video.twimg.com/ext_tw_video/abc/vid/1280x720/clip.mp4",
          duration_millis: 26200,
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/no-size.jpg?format=jpg&name=small",
          size: null,
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/bad-size.jpg?format=jpg&name=small",
          size: "1320x981",
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/non-numeric.jpg?format=jpg&name=small",
          size: { width: "1320", height: "981" },
        },
        { type: "unknown", url: "https://example.com/ignored" },
      ],
    }),
  ]);

  const rows = await rmFetchFromVx("source", "123", fetchImpl, publicDnsResolver);

  assertEquals(rows, [
    {
      kind: "video",
      url: "https://video.twimg.com/ext_tw_video/abc/vid/1280x720/clip.mp4",
      duration_ms: 26200,
      width: undefined,
      height: undefined,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/no-size.jpg?format=jpg&name=orig",
      width: undefined,
      height: undefined,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/bad-size.jpg?format=jpg&name=orig",
      width: undefined,
      height: undefined,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/non-numeric.jpg?format=jpg&name=orig",
      width: undefined,
      height: undefined,
    },
  ]);
});

Deno.test("rmFetchFromVx + buildResolvedMediaRows persists vx dimensions end-to-end", async () => {
  const { fetchImpl } = fetchSequence([
    response({
      media_extended: [
        {
          type: "video",
          url: "https://video.twimg.com/amplify_video/2052547918842728454/vid/avc1/1280x720/a.mp4",
          duration_millis: 26200,
          size: { width: 1280, height: 720 },
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/HJ2FRflX0AAdufV.jpg",
          size: { width: 1320, height: 981 },
        },
      ],
    }),
  ]);

  const resolved = await rmFetchFromVx("source", "123", fetchImpl, publicDnsResolver);
  assertEquals(resolved !== null, true);
  const rows = await buildResolvedMediaRows("tweet-vx", resolved!);

  assertEquals(rows.length, 2);
  assertEquals(rows[0].width, 1280);
  assertEquals(rows[0].height, 720);
  assertEquals(rows[0].duration_ms, 26200);
  assertEquals(rows[1].width, 1320);
  assertEquals(rows[1].height, 981);
  assertEquals(rows[1].duration_ms, null);
});

Deno.test("buildResolvedMediaRows clears stale storage metadata for resolved rows", async () => {
  const rows = await buildResolvedMediaRows("tweet-1", [
    {
      kind: "video",
      url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/high.mp4",
      width: 719.6,
      height: 1280.4,
      duration_ms: 5900.6,
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/photo.jpg?format=jpg&name=orig",
    },
  ]);

  assertEquals(rows.length, 2);
  assertEquals(rows[0], {
    tweet_id: "tweet-1",
    kind: "video",
    src_url: "https://video.twimg.com/ext_tw_video/abc/vid/720x1280/high.mp4",
    src_url_hash: rows[0].src_url_hash,
    width: 720,
    height: 1280,
    duration_ms: 5901,
    ordering: 0,
    storage_path: null,
    downloaded_at: null,
    file_size: null,
    mime_type: null,
  });
  assertEquals(rows[0].src_url_hash.length, 64);
  assertEquals(rows[1].ordering, 1);
  assertEquals(rows[1].storage_path, null);
  assertEquals(rows[1].downloaded_at, null);
  assertEquals(rows[1].file_size, null);
  assertEquals(rows[1].mime_type, null);
});

Deno.test("buildResolvedMediaRows excludes unreviewed proxy media URLs before persistence", async () => {
  const rows = await buildResolvedMediaRows("tweet-1", [
    {
      kind: "video",
      url: "https://video.example/internal-looking.mp4",
    },
    {
      kind: "image",
      url: "https://pbs.twimg.com/media/photo.jpg?format=jpg&name=orig",
    },
  ]);

  assertEquals(rows.length, 1);
  assertEquals(rows[0].src_url, "https://pbs.twimg.com/media/photo.jpg?format=jpg&name=orig");
  assertEquals(rows[0].ordering, 0);
});

Deno.test("buildResolveMediaDownloadJob keeps per-invocation idempotency key", () => {
  assertEquals(buildResolveMediaDownloadJob("tweet-1", 1_767_225_600_000), {
    type: "download_media",
    payload: { tweet_id: "tweet-1" },
    status: "pending",
    idempotency_key: "download_media:resolve:tweet-1:1767225600000",
    next_run_at: "2026-01-01T00:00:00.000Z",
  });
});

Deno.test("buildMediaProcessorDownloadInvokeOptions preserves media processor handoff payload", () => {
  const headers = { Authorization: "Bearer service-role" };

  assertEquals(
    buildMediaProcessorDownloadInvokeOptions("tweet-1", headers),
    {
      body: { action: "download_media", tweet_id: "tweet-1" },
      headers,
    },
  );
});
