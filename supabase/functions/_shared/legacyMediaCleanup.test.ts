import { assertEquals } from "jsr:@std/assert";
import {
  type LegacyMediaCleanupClient,
  runLegacyOriginalMediaCleanup,
} from "./legacyMediaCleanup.ts";

type CleanupCalls = {
  removed: string[][];
  cleared: Array<{ values: Record<string, unknown>; ids: string[] }>;
};

function cleanupClient(storageError: unknown = null): {
  client: LegacyMediaCleanupClient;
  calls: CleanupCalls;
} {
  const calls: CleanupCalls = { removed: [], cleared: [] };
  const client: LegacyMediaCleanupClient = {
    storage: {
      from(bucket) {
        if (bucket !== "temp-media") {
          throw new Error(`unexpected bucket ${bucket}`);
        }
        return {
          async remove(paths) {
            calls.removed.push(paths);
            return { error: storageError };
          },
        };
      },
    },
    from(table) {
      if (table !== "media") throw new Error(`unexpected table ${table}`);
      return {
        update(values) {
          return {
            async in(column, ids) {
              if (column !== "id") {
                throw new Error(`unexpected column ${column}`);
              }
              calls.cleared.push({ values, ids });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

Deno.test("legacy cleanup is path-blind when an old row shares a fresh row's object", async () => {
  const { client, calls } = cleanupClient();
  const freshReference = { id: "fresh-row", storage_path: "2026/7/shared.jpg" };

  const result = await runLegacyOriginalMediaCleanup(client, [{
    id: "old-row",
    storage_path: freshReference.storage_path,
  }]);

  assertEquals(result, { deletedCount: 1, failedCount: 0 });
  assertEquals(calls.removed, [[freshReference.storage_path]]);
  assertEquals(calls.cleared[0].ids, ["old-row"]);
  assertEquals(freshReference.storage_path, "2026/7/shared.jpg");
});

Deno.test("legacy cleanup clears database ownership even when storage removal fails", async () => {
  const { client, calls } = cleanupClient(new Error("storage unavailable"));

  const result = await runLegacyOriginalMediaCleanup(client, [{
    id: "old-row",
    storage_path: "2026/7/orphaned.jpg",
  }]);

  assertEquals(result, { deletedCount: 0, failedCount: 1 });
  assertEquals(calls.removed, [["2026/7/orphaned.jpg"]]);
  assertEquals(calls.cleared, [{
    values: {
      storage_path: null,
      downloaded_at: null,
      file_size: null,
      mime_type: null,
    },
    ids: ["old-row"],
  }]);
});
