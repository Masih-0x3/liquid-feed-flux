import {
  AUTOCHAIN_JOB_TYPES,
  normalizeChainDepth,
  selectAutochainJobTypes,
  shouldAutochain,
} from "./workerAutochain.ts";

Deno.test("normalizeChainDepth clamps invalid values to zero", () => {
  if (normalizeChainDepth(undefined) !== 0) throw new Error("undefined should normalize to 0");
  if (normalizeChainDepth(-2) !== 0) throw new Error("negative depth should normalize to 0");
  if (normalizeChainDepth(1.8) !== 1) throw new Error("fractional depth should floor");
});

Deno.test("selectAutochainJobTypes excludes expensive or manual job types", () => {
  const selected = selectAutochainJobTypes(["translate", "hydrate_tweet", "enrich", "deliver"]);
  if (selected.join(",") !== "translate,deliver") {
    throw new Error(`unexpected selected types: ${selected.join(",")}`);
  }
});

Deno.test("selectAutochainJobTypes defaults to the safe due-now types", () => {
  const selected = selectAutochainJobTypes(null);
  if (selected.join(",") !== AUTOCHAIN_JOB_TYPES.join(",")) {
    throw new Error("default autochain set drifted");
  }
});

Deno.test("shouldAutochain stops at max depth or empty queue", () => {
  if (!shouldAutochain({ chainDepth: 0, pendingCount: 1 })) {
    throw new Error("expected first chained run to be allowed");
  }
  if (!shouldAutochain({ chainDepth: 1, pendingCount: 1 })) {
    throw new Error("expected second chained run to be allowed");
  }
  if (!shouldAutochain({ chainDepth: 2, pendingCount: 1 })) {
    throw new Error("expected third chained run to be allowed");
  }
  if (shouldAutochain({ chainDepth: 3, pendingCount: 1 })) {
    throw new Error("depth 3 should stop chaining");
  }
  if (shouldAutochain({ chainDepth: 0, pendingCount: 0 })) {
    throw new Error("empty due queue should not chain");
  }
});
