import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractScripts = [
  "check-admin-actions-cors-contract.mjs",
  "check-admin-feedback-persistence-contract.mjs",
  "check-admin-operation-contract.mjs",
  "check-admin-retry-error-boundary-contract.mjs",
  "check-admin-role-auth-contract.mjs",
  "check-telegram-delivery-fail-closed-contract.mjs",
  "check-telegram-fallback-final-response-contract.mjs",
  "check-telegram-media-access-contract.mjs",
  "check-worker-config-read-contract.mjs",
  "check-worker-queue-insert-result-contract.mjs",
  "check-worker-x-api-workflow-contract.mjs",
  "check-x-api-credentials-read-contract.mjs",
  "check-x-api-ledger-contract.mjs",
  "check-x-post-delivery-claim-contract.mjs",
  "check-x-poster-ambiguity-contract.mjs",
  "check-x-poster-read-gates-contract.mjs",
  "check-x-poster-self-heal-contract.mjs",
  "check-x-posting-diagnostics-bounds-contract.mjs",
];

test("Node 20 contract scripts do not use import.meta.dirname", () => {
  const offenders = contractScripts.filter((fileName) =>
    fs.readFileSync(path.join(repoRoot, "scripts", fileName), "utf8").includes("import.meta.dirname")
  );
  assert.deepEqual(offenders, []);
});
