import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { buildMediaReplacementRows, type ExistingMediaRow } from "./index.ts";

type Item = { type: string; url: string; width?: number; height?: number; duration?: number };

function items(urls: string[]): Item[] {
  return urls.map((url) => ({ type: "image", url, width: 480, height: 640 }));
}

function existingMap(pairs: Array<[number, ExistingMediaRow]>): Map<number, ExistingMediaRow> {
  return new Map<number, ExistingMediaRow>(pairs);
}

function downloadedRow(hash: string, storagePath: string): ExistingMediaRow {
  return {
    src_url_hash: hash,
    storage_path: storagePath,
    downloaded_at: "2026-09-07T09:00:00Z",
    mime_type: "image/jpeg",
    file_size: 123456,
  };
}

Deno.test("buildMediaReplacementRows clears download columns when src_url_hash changed", async () => {
  const { rows, anySrcUrlChanged } = await buildMediaReplacementRows(
    "tweet-1",
    items(["https://pbs.twimg.com/media/new.jpg"]),
    existingMap([[0, downloadedRow("old-hash", "2026/9/tweet_1_0.jpg")]]),
  );

  assertEquals(rows.length, 1);
  assertEquals(rows[0].ordering, 0);
  assertEquals(rows[0].src_url, "https://pbs.twimg.com/media/new.jpg");
  assertEquals(rows[0].kind, "image");
  assertEquals(rows[0].storage_path, null);
  assertEquals(rows[0].downloaded_at, null);
  assertEquals(rows[0].mime_type, null);
  assertEquals(rows[0].file_size, null);
  assertEquals(anySrcUrlChanged, true);
});

Deno.test("buildMediaReplacementRows preserves download columns when src_url_hash unchanged", async () => {
  const url = "https://pbs.twimg.com/media/keep.jpg";
  const firstPass = await buildMediaReplacementRows("tweet-1", items([url]), existingMap([]));
  const stableHash = firstPass.rows[0].src_url_hash;
  assertNotEquals(stableHash, undefined);

  const { rows, anySrcUrlChanged } = await buildMediaReplacementRows(
    "tweet-1",
    items([url]),
    existingMap([[0, downloadedRow(stableHash!, "2026/9/tweet_1_0.jpg")]]),
  );

  assertEquals(rows.length, 1);
  assertEquals(rows[0].src_url_hash, stableHash);
  assertEquals(rows[0].storage_path, "2026/9/tweet_1_0.jpg");
  assertEquals(rows[0].downloaded_at, "2026-09-07T09:00:00Z");
  assertEquals(rows[0].mime_type, "image/jpeg");
  assertEquals(rows[0].file_size, 123456);
  assertEquals(anySrcUrlChanged, false);
});

Deno.test("buildMediaReplacementRows treats a missing existing row as a new row, not a change", async () => {
  const { rows, anySrcUrlChanged } = await buildMediaReplacementRows(
    "tweet-1",
    items(["https://pbs.twimg.com/media/first.jpg", "https://pbs.twimg.com/media/second.jpg"]),
    existingMap([]),
  );

  assertEquals(rows.length, 2);
  for (const row of rows) {
    assertEquals(row.storage_path, null);
    assertEquals(row.downloaded_at, null);
    assertEquals(row.mime_type, null);
    assertEquals(row.file_size, null);
  }
  assertEquals(anySrcUrlChanged, false);
});

Deno.test("buildMediaReplacementRows aggregates mixed changed/unchanged rows", async () => {
  const keepUrl = "https://pbs.twimg.com/media/keep.jpg";
  const changedUrl = "https://pbs.twimg.com/media/changed.jpg";
  const keepPass = await buildMediaReplacementRows("tweet-1", items([keepUrl]), existingMap([]));
  const keepHash = keepPass.rows[0].src_url_hash!;

  const { rows, anySrcUrlChanged } = await buildMediaReplacementRows(
    "tweet-1",
    items([changedUrl, keepUrl]),
    existingMap([[0, downloadedRow("stale-hash-0", "2026/9/tweet_1_0.jpg")], [1, downloadedRow(keepHash, "2026/9/tweet_1_1.jpg")]]),
  );

  assertEquals(rows.length, 2);
  assertEquals(rows[0].ordering, 0);
  assertEquals(rows[0].src_url, changedUrl);
  assertEquals(rows[0].storage_path, null);
  assertEquals(rows[0].downloaded_at, null);
  assertEquals(rows[0].mime_type, null);
  assertEquals(rows[0].file_size, null);
  assertEquals(rows[1].ordering, 1);
  assertEquals(rows[1].src_url, keepUrl);
  assertEquals(rows[1].storage_path, "2026/9/tweet_1_1.jpg");
  assertEquals(rows[1].downloaded_at, "2026-09-07T09:00:00Z");
  assertEquals(rows[1].mime_type, "image/jpeg");
  assertEquals(rows[1].file_size, 123456);
  assertEquals(anySrcUrlChanged, true);
});

Deno.test("buildMediaReplacementRows returns empty rows and no change for an empty sendable set", async () => {
  const { rows, anySrcUrlChanged } = await buildMediaReplacementRows(
    "tweet-1",
    [],
    existingMap([[0, downloadedRow("stale", "p")], [1, downloadedRow("stale", "p")]]),
  );

  assertEquals(rows, []);
  assertEquals(anySrcUrlChanged, false);
});

Deno.test("buildMediaReplacementRows hashes src_url deterministically and preserves dimensions", async () => {
  const url = "https://pbs.twimg.com/media/dim.jpg";
  const sendable = [{ type: "video", url, width: 1280, height: 720, duration: 5_000 }];
  const firstPass = await buildMediaReplacementRows("tweet-9", sendable, existingMap([]));
  const secondPass = await buildMediaReplacementRows("tweet-9", sendable, existingMap([]));

  assertEquals(firstPass.rows[0].src_url_hash, secondPass.rows[0].src_url_hash);
  assertEquals(firstPass.rows[0].tweet_id, "tweet-9");
  assertEquals(firstPass.rows[0].kind, "video");
  assertEquals(firstPass.rows[0].width, 1280);
  assertEquals(firstPass.rows[0].height, 720);
  assertEquals(firstPass.rows[0].duration_ms, 5_000);
  assertEquals(firstPass.rows[0].ordering, 0);
});

Deno.test("buildMediaReplacementRows nulls width/height/duration when absent so the batch columns are uniform", async () => {
  const { rows } = await buildMediaReplacementRows(
    "tweet-1",
    [{ type: "image", url: "https://pbs.twimg.com/media/nodim.jpg" }],
    existingMap([]),
  );

  assertEquals(rows[0].width, null);
  assertEquals(rows[0].height, null);
  assertEquals(rows[0].duration_ms, null);
});
