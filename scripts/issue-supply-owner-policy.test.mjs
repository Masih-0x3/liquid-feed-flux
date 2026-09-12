import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerPolicy } from "./issue-supply-owner-policy.mjs";
import { supplyEvidenceSha256, validateOwnerPolicy } from "./collect-supply-chain-evidence.mjs";

const BASE = {
  evidenceSha256: supplyEvidenceSha256({ actionableIds: [], observedIds: [], nonfixableIds: [] }),
  reviewedSha: "a".repeat(40),
  owner: "release-security",
  observed: 0,
  nonfixable: 0,
  signedAt: new Date("2026-09-11T00:00:00Z"),
  days: 30,
};

test("issue owner policy produces a v2 policy that passes the collector validator", () => {
  const policy = buildOwnerPolicy(BASE);
  assert.equal(policy.schema, "xot-hosted-supply-owner-policy-v2");
  assert.equal(policy.evidenceSha256, BASE.evidenceSha256);
  assert.equal(policy.expiresAt, "2026-10-11T00:00:00.000Z");
  assert.deepEqual(
    validateOwnerPolicy(policy, {
      actionableHighOrCritical: 0,
      observedHighOrCritical: 0,
      nonfixableHighOrCritical: 0,
      actionableIds: [],
      observedIds: [],
      nonfixableIds: [],
      now: Date.parse("2026-09-12T00:00:00Z"),
    }),
    [],
  );
});

test("issue owner policy refuses actionable findings and malformed inputs", () => {
  assert.throws(() => buildOwnerPolicy({ ...BASE, actionable: 1, observed: 1 }), /actionable high\/critical/);
  assert.throws(() => buildOwnerPolicy({ ...BASE, evidenceSha256: "zz" }), /64-hex/);
  assert.throws(() => buildOwnerPolicy({ ...BASE, reviewedSha: "bad" }), /40-hex/);
  assert.throws(() => buildOwnerPolicy({ ...BASE, owner: " " }), /owner is required/);
  assert.throws(() => buildOwnerPolicy({ ...BASE, observed: 2, nonfixable: 0 }), /observed = actionable \+ nonfixable/);
  assert.throws(() => buildOwnerPolicy({ ...BASE, days: 0 }), /days must be/);
});
