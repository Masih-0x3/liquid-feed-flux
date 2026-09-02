import { assertEquals } from "jsr:@std/assert";
import {
  ACTIVE_CLAIM_STATES,
  assertClaimEnvelope,
  CLAIM_GENERATION_PATCH_KEY,
  CLAIM_STATE_PATCH_KEY,
  claimFencePairs,
  CLAIM_TOKEN_PATCH_KEY,
  embedClaimEnvelope,
  extractClaimEnvelope,
  withProviderBoundary,
} from "./durableClaimFence.ts";

Deno.test("extractClaimEnvelope accepts a fresh claimed row", () => {
  const envelope = extractClaimEnvelope({
    claim_token: "abc-token",
    claim_generation: 3,
    claim_state: "preparing",
  });
  assertEquals(envelope, { claimToken: "abc-token", claimGeneration: 3 });
});

Deno.test("extractClaimEnvelope normalizes a string generation", () => {
  const envelope = extractClaimEnvelope({
    claim_token: "tok",
    claim_generation: "7",
    claim_state: "ready",
  });
  assertEquals(envelope, { claimToken: "tok", claimGeneration: 7 });
});

Deno.test("extractClaimEnvelope returns null without a token", () => {
  assertEquals(extractClaimEnvelope({ claim_generation: 1 }), null);
  assertEquals(extractClaimEnvelope(null), null);
  assertEquals(extractClaimEnvelope(undefined), null);
});

Deno.test("extractClaimEnvelope returns null for a missing or zero generation", () => {
  assertEquals(extractClaimEnvelope({ claim_token: "t" }), null);
  assertEquals(extractClaimEnvelope({ claim_token: "t", claim_generation: 0 }), null);
  assertEquals(extractClaimEnvelope({ claim_token: "t", claim_generation: -2 }), null);
});

Deno.test("embedClaimEnvelope attaches the reserved patch keys additively", () => {
  const patch = embedClaimEnvelope(
    { status: "completed", extra: 1 },
    { claim_token: "tok", claim_generation: 4 },
  );
  assertEquals(patch.status, "completed");
  assertEquals(patch.extra, 1);
  assertEquals(patch[CLAIM_TOKEN_PATCH_KEY], "tok");
  assertEquals(patch[CLAIM_GENERATION_PATCH_KEY], 4);
  assertEquals(patch[CLAIM_STATE_PATCH_KEY], undefined);
});

Deno.test("embedClaimEnvelope leaves the patch untouched when the fence is absent", () => {
  const patch = embedClaimEnvelope({ status: "defer" }, {});
  assertEquals(patch, { status: "defer" });
});

Deno.test("claimFencePairs emits token+generation equality and an optional state gate", () => {
  const base = claimFencePairs({ claim_token: "tok", claim_generation: 9 });
  assertEquals(base, [
    ["claim_token", "tok"],
    ["claim_generation", 9],
  ]);
  const gated = claimFencePairs(
    { claim_token: "tok", claim_generation: 9, claim_state: "posting" },
    "posting",
  );
  assertEquals(gated, [
    ["claim_token", "tok"],
    ["claim_generation", 9],
    ["claim_state", "posting"],
  ]);
});

Deno.test("claimFencePairs rejects a state guard outside the active set", () => {
  const pairs = claimFencePairs(
    { claim_token: "tok", claim_generation: 1, claim_state: "ambiguous" },
    "ambiguous",
  );
  assertEquals(pairs, [
    ["claim_token", "tok"],
    ["claim_generation", 1],
  ]);
});

Deno.test("assertClaimEnvelope passes for an active claim and fails closed otherwise", () => {
  assertClaimEnvelope(
    { claim_token: "tok", claim_generation: 1, claim_state: "preparing" },
    "complete",
    () => {
      throw new Error("unexpected");
    },
  );
  let failed = false;
  try {
    assertClaimEnvelope({ id: "x", locked_by: "w" }, "complete", () => {
      failed = true;
      throw new Error("missing_claim_fence");
    });
  } catch {
    // Expected fail-closed callback.
  }
  assertEquals(failed, true);
  // A terminal/ambiguous claim_state is not writable by a running worker.
  let stateFailed = false;
  try {
    assertClaimEnvelope(
      { claim_token: "tok", claim_generation: 1, claim_state: "ambiguous" },
      "complete",
      () => {
        stateFailed = true;
        throw new Error("invalid_claim_state:ambiguous");
      },
    );
  } catch {
    // Expected fail-closed callback.
  }
  assertEquals(stateFailed, true);
  let missingStateFailed = false;
  try {
    assertClaimEnvelope(
      { claim_token: "tok", claim_generation: 1 },
      "complete",
      () => {
        missingStateFailed = true;
        throw new Error("missing_claim_state");
      },
    );
  } catch {
    // Expected fail-closed callback.
  }
  assertEquals(missingStateFailed, true);
});

Deno.test("ACTIVE_CLAIM_STATES pins the durable writer vocabulary", () => {
  for (const state of ["preparing", "ready", "posting", "idle"]) {
    assertEquals(ACTIVE_CLAIM_STATES.has(state), true);
  }
  for (const state of ["posted", "failed", "ambiguous", "skipped"]) {
    assertEquals(ACTIVE_CLAIM_STATES.has(state), false);
  }
});
Deno.test("withProviderBoundary runs marker, provider, complete in order", async () => {
  const order: string[] = [];
  const out = await withProviderBoundary({
    markStarted: async () => { order.push("marker"); return true; },
    provider: async () => { order.push("provider"); return { id: "x1" }; },
    complete: async () => { order.push("complete"); return true; },
  });
  assertEquals(out.status, "success");
  assertEquals(order, ["marker", "provider", "complete"]);
});

Deno.test("withProviderBoundary marker DB error => zero provider calls (SF1)", async () => {
  let providerCalls = 0;
  const out = await withProviderBoundary({
    markStarted: async () => { throw new Error("db_down"); },
    provider: async () => { providerCalls += 1; return "x"; },
    complete: async () => true,
  });
  assertEquals(out.status, "marker_failed");
  assertEquals(providerCalls, 0);
});

Deno.test("withProviderBoundary rejected marker never calls the provider (SF1)", async () => {
  let providerCalls = 0;
  const out = await withProviderBoundary({
    markStarted: async () => false,
    provider: async () => { providerCalls += 1; return "x"; },
    complete: async () => true,
  });
  assertEquals(out.status, "marker_rejected");
  assertEquals(providerCalls, 0);
});

Deno.test("withProviderBoundary provider-allowed-but-completion-unknown => ambiguous (SF1)", async () => {
  const out = await withProviderBoundary({
    markStarted: async () => true,
    provider: async () => ({ posted: true }),
    complete: async () => false,
  });
  assertEquals(out.status, "ambiguous");
  if (out.status === "ambiguous") assertEquals(out.completionSucceeded, false);
});
