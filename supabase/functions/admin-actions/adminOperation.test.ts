import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  getAdminOperationStatus,
  isSupportedAdminOperationId,
  validateAdminOperationIdentity,
} from "./adminOperation.ts";
import type { SupabaseAdminClient } from "./types.ts";

function fakeSupabase(job: Record<string, unknown> | null): SupabaseAdminClient {
  return {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve({ data: job, error: null }); },
      };
      return builder;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); },
  };
}

Deno.test("admin operation status maps absent, active, completed, and failed jobs", async () => {
  assertEquals(await getAdminOperationStatus(fakeSupabase(null), "reprocess:t1"), {
    operation_id: "reprocess:t1",
    operation_status: "unknown",
  });
  assertEquals(await getAdminOperationStatus(fakeSupabase({ status: "pending" }), "reprocess:t1"), {
    operation_id: "reprocess:t1",
    operation_status: "still_running",
  });
  assertEquals(await getAdminOperationStatus(fakeSupabase({ status: "completed" }), "reprocess:t1"), {
    operation_id: "reprocess:t1",
    operation_status: "committed",
  });
  assertEquals(await getAdminOperationStatus(fakeSupabase({ status: "failed" }), "reprocess:t1"), {
    operation_id: "reprocess:t1",
    operation_status: "failed",
  });
});

Deno.test("admin operation identity rejects mismatched or unsupported keys", () => {
  assertEquals(validateAdminOperationIdentity("reprocess", "t1", "reprocess:t1"), true);
  assertEquals(validateAdminOperationIdentity("hydrate_post", "t1", "hydrate:manual_monitoring:t1"), true);
  assertEquals(validateAdminOperationIdentity("reprocess", "t1", "hydrate:manual_monitoring:t1"), false);
  assertEquals(validateAdminOperationIdentity("run_dedupe", "t1", "dedupe:t1"), false);
  assertEquals(validateAdminOperationIdentity("reprocess", "abc:def", "reprocess:abc:def"), false);
  assertEquals(validateAdminOperationIdentity("reprocess", "t1 ", "reprocess:t1"), false);
  assertEquals(isSupportedAdminOperationId("reprocess:abc:def"), false);
  assertEquals(isSupportedAdminOperationId("reprocess:t1"), true);
});

Deno.test("admin operation status fails closed on database errors", async () => {
  const client: SupabaseAdminClient = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve({ data: null, error: new Error("db") }); },
      };
      return builder;
    },
    rpc() { return Promise.resolve({ data: null, error: null }); },
  };
  await assertRejects(() => getAdminOperationStatus(client, "reprocess:t1"), Error, "admin_operation_status_read_failed");
});
