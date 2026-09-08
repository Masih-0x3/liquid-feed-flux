import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildStepEnvironment, REPO_ROOT, parseWorkflow, runCircleParity, validateCircleWorkflow } from "./run-circleci-parity.mjs";

const workflowSource = readFileSync(`${REPO_ROOT}/.github/workflows/ci.yml`, "utf8");
const circleConfig = readFileSync(`${REPO_ROOT}/.circleci/config.yml`, "utf8");

test("CircleCI parity derives the complete reviewed GitHub job", () => {
  const workflow = validateCircleWorkflow();
  assert.equal(workflow.steps.length, 157);
  assert.equal(workflow.steps.filter((step) => step.run).length, 153);
  assert.equal(workflow.uploadIndexes.length, 2);
  assert.equal(workflow.steps[workflow.collectorIndex].run, 'node scripts/collect-supply-chain-evidence.mjs --collect-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
  assert.equal(workflow.steps[workflow.technicalIndex].run, 'node scripts/collect-supply-chain-evidence.mjs --validate-only --technical-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
  assert.equal(workflow.steps[workflow.ownerIndex].run, 'node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
});

test("CircleCI parity rejects an unsupported workflow control", () => {
  assert.throws(() => parseWorkflow(workflowSource.replace("      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n")), /unsupported control continue-on-error/);
});

test("CircleCI parity rejects a changed checkout expression", () => {
  assert.throws(() => parseWorkflow(workflowSource.replace("ref: ${{ github.event.pull_request.head.sha || github.sha }}", "ref: ${{ github.sha }}")), /checkout ref/);
});

test("CircleCI parity rejects a changed preflight prefix", () => {
  assert.throws(() => parseWorkflow(workflowSource.replace("      - run: node scripts/check-supply-chain-contract.mjs\n", "      - run: node scripts/check-runtime-contract.mjs\n")), /preflight.*prefix/);
});

test("CircleCI config cannot publish the pending bundle as accepted", () => {
  assert.match(circleConfig, /accepted_dir="\$RUNNER_TEMP\/xot-supply-chain-accepted"/);
  assert.match(circleConfig, /passed_owner_accepted/);
  assert.match(circleConfig, /path: \/tmp\/xot-circleci-runner\/xot-supply-chain-accepted/);
  assert.doesNotMatch(circleConfig, /path: \/tmp\/xot-circleci-runner\/xot-supply-chain\n\s+destination: xot-supply-chain-accepted/);
  const parityIndex = circleConfig.indexOf("Verify CircleCI parity contract");
  const snapshotIndex = circleConfig.indexOf("Snapshot accepted supply-chain evidence");
  const copyIndex = circleConfig.indexOf('cp -a "$RUNNER_TEMP/xot-supply-chain" "$accepted_dir"');
  assert.ok(parityIndex >= 0 && parityIndex < snapshotIndex && snapshotIndex < copyIndex);
});

test("CircleCI Node setup persists the resolved Node 24 bin path for nounset children", () => {
  assert.match(circleConfig, /node_bin=\"\$\(dirname \"\$\(command -v node\)\"\)\"/);
  assert.match(circleConfig, /printf 'export PATH=%q:\$PATH\\n' \"\$node_bin\" > \"\$BASH_ENV\"/);
  assert.match(circleConfig, /BASH_ENV=\"\$BASH_ENV\" bash -euo pipefail -c 'node -p/);
});

test("CircleCI stages stop at the same artifact boundaries as the reviewed workflow", () => {
  const prepared = runCircleParity({ stage: "pre-technical", source: workflowSource, execute: false });
  const verified = runCircleParity({ stage: "post-technical", source: workflowSource, execute: false });
  assert.equal(prepared.selected.at(-1).run, 'node scripts/collect-supply-chain-evidence.mjs --collect-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
  assert.equal(verified.selected[0].run, 'node scripts/collect-supply-chain-evidence.mjs --validate-only --technical-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
  assert.equal(verified.selected.at(-1).run, 'node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir "$RUNNER_TEMP/xot-supply-chain"');
});

test("CircleCI parity keeps the owner policy out of pre-owner commands", () => {
  const workflow = validateCircleWorkflow();
  const sourceEnv = { CIRCLE_SHA1: "a".repeat(40), XOT_SUPPLY_OWNER_POLICY_B64: "redacted-test-policy" };
  const preOwner = buildStepEnvironment(workflow.steps[workflow.collectorIndex], sourceEnv.CIRCLE_SHA1, sourceEnv);
  const owner = buildStepEnvironment(workflow.steps[workflow.ownerIndex], sourceEnv.CIRCLE_SHA1, sourceEnv);
  assert.equal(preOwner.XOT_SUPPLY_OWNER_POLICY_B64, undefined);
  assert.equal(owner.XOT_SUPPLY_OWNER_POLICY_B64, sourceEnv.XOT_SUPPLY_OWNER_POLICY_B64);
  assert.equal(owner.XOT_REVIEWED_SHA, sourceEnv.CIRCLE_SHA1);
});
