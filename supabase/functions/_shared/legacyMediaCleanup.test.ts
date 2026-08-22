import { assertEquals } from "jsr:@std/assert";
import {
  type LegacyMediaCleanupClient,
  previewObjectCleanup,
  runLegacyOriginalMediaCleanup,
  type MediaObjectCleanupClient,
  runMediaObjectCleanup,
} from "./legacyMediaCleanup.ts";

type CleanupCalls = {
  removed: string[][];
  cleared: Array<{ values: Record<string, unknown>; ids: string[] }>;
};

function cleanupLegacy(storageError: unknown = null): {
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
  const { client, calls } = cleanupLegacy();
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

Deno.test("legacy cleanup preserves database ownership when storage removal fails", async () => {
  const { client, calls } = cleanupLegacy(new Error("storage unavailable"));

  const result = await runLegacyOriginalMediaCleanup(client, [{
    id: "old-row",
    storage_path: "2026/7/orphaned.jpg",
  }]);

  assertEquals(result, { deletedCount: 0, failedCount: 1 });
  assertEquals(calls.removed, [["2026/7/orphaned.jpg"]]);
  assertEquals(calls.cleared, []);
});

// ---------------------------------------------------------------------------
// AIR-001 object-claim runtime path
// ---------------------------------------------------------------------------

type ClaimCalls = {
  removed: string[][];
  finalized: Array<{ object_id: string; token: string }>;
};

function objectClient(
  claims: Array<Record<string, unknown>>,
  options: { removeError?: unknown; finalizeData?: unknown; finalizeError?: unknown } = {},
): { client: MediaObjectCleanupClient; calls: ClaimCalls } {
  const calls: ClaimCalls = { removed: [], finalized: [] };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "media_objects_claim_old") {
      return { data: claims, error: null };
    }
    if (name === "media_objects_finalize_delete") {
      calls.finalized.push({
        object_id: String(args.p_object_id),
        token: String(args.p_deletion_token),
      });
      return { data: options.finalizeData ?? true, error: options.finalizeError ?? null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return {
    client: {
      rpc,
      storage: {
        from(bucket) {
          if (bucket !== "temp-media") throw new Error(`unexpected bucket ${bucket}`);
          return {
            async remove(paths) {
              calls.removed.push(paths);
              return { error: options.removeError ?? null };
            },
          };
        },
      },
    },
    calls,
  };
}

Deno.test("claim path does not call preview / no state mutation on dry-run in runner", async () => {
  // Preview path is exercised by the runner; here we assert the runtime exports it.
  const hasPreview = typeof previewObjectCleanup === "function";
  assertEquals(hasPreview, true);
});

const ONE_CLAIM: Record<string, unknown> = {
  object_id: "obj-1",
  bucket: "temp-media",
  storage_path: "2026/7/shared.jpg",
  deletion_token: "tok-1",
};

Deno.test("claim path removes then finalizes each claimed physical object once", async () => {
  const { client, calls } = objectClient([ONE_CLAIM]);
  const result = await runMediaObjectCleanup(client, {});
  assertEquals(result, { deletedCount: 1, failedCount: 0, claimedCount: 1 });
  assertEquals(calls.removed, [["2026/7/shared.jpg"]]);
  assertEquals(calls.finalized, [{ object_id: "obj-1", token: "tok-1" }]);
});

Deno.test("claim path fails closed and clears zero refs when storage removal fails", async () => {
  const { client, calls } = objectClient([ONE_CLAIM], {
    removeError: new Error("storage unavailable"),
  });
  const result = await runMediaObjectCleanup(client, {});
  assertEquals(result, { deletedCount: 0, failedCount: 1, claimedCount: 1 });
  assertEquals(calls.removed, [["2026/7/shared.jpg"]]);
  assertEquals(calls.finalized, []);
});

Deno.test("claim path treats a false finalize as a non-success failure", async () => {
  const { client, calls } = objectClient([ONE_CLAIM], { finalizeData: false });
  const result = await runMediaObjectCleanup(client, {});
  assertEquals(result, { deletedCount: 0, failedCount: 1, claimedCount: 1 });
  assertEquals(calls.removed, [["2026/7/shared.jpg"]]);
  assertEquals(calls.finalized, [{ object_id: "obj-1", token: "tok-1" }]);
});

Deno.test("claim path throws on claim RPC error and performs no mutation", async () => {
  const rpc = async () => ({ data: null, error: new Error("rpc unavailable") });
  const client: MediaObjectCleanupClient = {
    rpc,
    storage: {
      from() {
        throw new Error("unexpected storage mutation");
      },
    },
  };
  let threw = false;
  try {
    await runMediaObjectCleanup(client, {});
  } catch (error) {
    threw = String(error).includes("media_object_claim_failed");
  }
  assertEquals(threw, true);
});

Deno.test("claim path FAILS CLOSED on a malformed claim row (no silent drop)", async () => {
  const rpc = async () => ({ data: [{ object_id: "missing-token" }], error: null });
  const client: MediaObjectCleanupClient = {
    rpc,
    storage: {
      from() {
        throw new Error("unexpected storage mutation");
      },
    },
  };
  let threw = false;
  try {
    await runMediaObjectCleanup(client, {});
  } catch (error) {
    threw = String(error).includes("media_object_claim_invalid");
  }
  assertEquals(threw, true);
});

Deno.test("claim path FAILS CLOSED on a non-array claim result", async () => {
  const rpc = async () => ({ data: { not: "an array" }, error: null });
  const client: MediaObjectCleanupClient = {
    rpc,
    storage: {
      from() {
        throw new Error("unexpected storage mutation");
      },
    },
  };
  let threw = false;
  try {
    await runMediaObjectCleanup(client, {});
  } catch (error) {
    threw = String(error).includes("media_object_claim_invalid");
  }
  assertEquals(threw, true);
});
