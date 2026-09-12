#!/usr/bin/env node

// Issue an exact-evidence owner policy (xot-hosted-supply-owner-policy-v2).
//
// The policy binds the evidence fingerprint (observed/actionable/nonfixable
// finding IDs), not the head SHA — it stays valid across pushes whose scans
// produce an identical finding set. Re-issue is required only when the scan
// output changes (new advisory, version bump, scanner database update).
//
// Usage:
//   node scripts/issue-supply-owner-policy.mjs --evidence <dir> --owner <name> [--reviewed-sha <sha>] [--days <n>]
//   node scripts/issue-supply-owner-policy.mjs --fingerprint <sha256> --owner <name> --observed <n> --nonfixable <n> [--reviewed-sha <sha>]
//
// --evidence points at a downloaded xot-supply-chain artifact directory (the
// artifact name embeds the run head SHA). --fingerprint accepts the
// expected evidenceSha256 printed by the owner-validation failure line.
// Output: the policy JSON and its base64 payload for XOT_SUPPLY_OWNER_POLICY_B64.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evidenceOwnerSummary, supplyEvidenceSha256 } from "./collect-supply-chain-evidence.mjs";

const SHA_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export function buildOwnerPolicy({ evidenceSha256, reviewedSha, owner, actionable = 0, observed, nonfixable, signedAt = new Date(), days = 30 } = {}) {
  if (!SHA256_RE.test(evidenceSha256 ?? "")) throw new Error("evidenceSha256 must be a 64-hex fingerprint");
  if (!SHA_RE.test(reviewedSha ?? "")) throw new Error("reviewedSha must be a 40-hex SHA (records the head reviewed at signing)");
  if (typeof owner !== "string" || owner.trim().length === 0) throw new Error("owner is required (named security/release owner)");
  if (actionable !== 0) throw new Error(`evidence contains ${actionable} actionable high/critical findings; fix them — this policy can only accept zero actionable findings`);
  if (!Number.isInteger(observed) || observed < 0 || !Number.isInteger(nonfixable) || nonfixable < 0 || observed !== actionable + nonfixable) {
    throw new Error("observed/nonfixable counts must be non-negative integers with observed = actionable + nonfixable");
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("days must be an integer between 1 and 365");
  const signed = signedAt instanceof Date ? signedAt : new Date(signedAt);
  return {
    schema: "xot-hosted-supply-owner-policy-v2",
    evidenceSha256,
    reviewedSha,
    owner,
    signedAt: signed.toISOString(),
    expiresAt: new Date(signed.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    decision: "accept_zero_actionable_no_waivers",
    actionableHighOrCritical: 0,
    observedHighOrCritical: observed,
    nonfixableHighOrCritical: nonfixable,
    baseImageClassification: "reviewed-non-actionable",
    waiverEntries: [],
  };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const evidenceDir = arg("evidence");
  const fingerprint = arg("fingerprint");
  const owner = arg("owner");
  const reviewedSha = arg("reviewed-sha") ?? spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const days = Number(arg("days") ?? 30);

  let summary = null;
  let evidenceSha256 = fingerprint;
  if (evidenceDir) {
    summary = evidenceOwnerSummary(evidenceDir);
    evidenceSha256 = supplyEvidenceSha256(summary);
  }
  const policy = buildOwnerPolicy({
    evidenceSha256,
    reviewedSha,
    owner,
    actionable: summary?.actionableHighOrCritical ?? Number(arg("actionable") ?? 0),
    observed: summary?.observedHighOrCritical ?? Number(arg("observed") ?? NaN),
    nonfixable: summary?.nonfixableHighOrCritical ?? Number(arg("nonfixable") ?? NaN),
    days,
  });
  const encoded = Buffer.from(JSON.stringify(policy)).toString("base64");
  console.log(JSON.stringify(policy, null, 2));
  console.log("\n--- set the variable (GitHub) ---");
  console.log(`gh variable set XOT_SUPPLY_OWNER_POLICY_B64 --repo Masih-0x3/liquid-feed-flux --body '${encoded}'`);
  console.log("\n--- raw base64 (CircleCI project env, same var name) ---");
  console.log(encoded);
  console.log("\nISSUE_OWNER_POLICY_OK evidenceSha256=" + evidenceSha256);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`ISSUE_OWNER_POLICY_FAIL\n- ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
