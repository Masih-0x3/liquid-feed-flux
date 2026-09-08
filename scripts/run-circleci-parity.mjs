#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/ci.yml");
export const CIRCLE_SHA_ENV = "CIRCLE_SHA1";
export const OWNER_POLICY_ENV = "XOT_SUPPLY_OWNER_POLICY_B64";
export const RUNNER_TEMP_ENV = "RUNNER_TEMP";
export const BASH_ENV_ENV = "BASH_ENV";

const SHA_RE = /^[a-f0-9]{40}$/;
const CHECKOUT_REF = "${{ github.event.pull_request.head.sha || github.sha }}";
const OWNER_POLICY_REF = "${{ vars.XOT_SUPPLY_OWNER_POLICY_B64 }}";
const CHECKOUT_ACTION = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const SETUP_NODE_ACTION = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const UPLOAD_ARTIFACT_ACTION = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const COLLECT_COMMAND = 'node scripts/collect-supply-chain-evidence.mjs --collect-only --output-dir "$RUNNER_TEMP/xot-supply-chain"';
const TECHNICAL_VALIDATE_COMMAND = 'node scripts/collect-supply-chain-evidence.mjs --validate-only --technical-only --output-dir "$RUNNER_TEMP/xot-supply-chain"';
const OWNER_VALIDATE_COMMAND = 'node scripts/collect-supply-chain-evidence.mjs --validate-only --output-dir "$RUNNER_TEMP/xot-supply-chain"';
const REQUIRED_PREFIX_COMMANDS = [
  "node scripts/check-supply-chain-contract.mjs",
  "npm ci --ignore-scripts",
  "node scripts/check-supply-chain-contract.mjs",
  "npm --prefix services/video-renderer ci --ignore-scripts",
  "npm rebuild --ignore-scripts=false deno",
  COLLECT_COMMAND,
];

const fail = (message) => { throw new Error(`CircleCI workflow parity rejected: ${message}`); };

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseStep(block, index) {
  const first = block[0];
  const actionLines = block.filter((line) => /^      - uses:\s*/.test(line) || /^        uses:\s*/.test(line));
  const runLines = block.filter((line) => /^      - run:\s*/.test(line) || /^        run:\s*/.test(line));
  if (actionLines.length > 1) fail(`step ${index + 1} contains multiple uses declarations`);
  if (runLines.length > 1) fail(`step ${index + 1} contains multiple run declarations`);

  const unsupported = block.filter((line) => /^\s+(?:if|continue-on-error|working-directory|shell|timeout-minutes):/.test(line));
  if (unsupported.length > 0) fail(`step ${index + 1} contains unsupported control ${unsupported[0].trim().split(":", 1)[0]}`);

  const env = {};
  const envIndex = block.findIndex((line) => line === "        env:");
  if (envIndex >= 0) {
    for (let lineIndex = envIndex + 1; lineIndex < block.length; lineIndex += 1) {
      const line = block[lineIndex];
      if (/^        \S/.test(line) || /^      - /.test(line)) break;
      const match = line.match(/^          ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!match) fail(`step ${index + 1} contains unsupported env syntax: ${line.trim()}`);
      env[match[1]] = scalar(match[2]);
    }
  }

  const action = actionLines.length === 1
    ? scalar(actionLines[0].replace(/^\s*(?:-\s+)?uses:\s*/, "").replace(/\s+#.*$/, ""))
    : null;
  const run = runLines.length === 1
    ? scalar(runLines[0].replace(/^\s*(?:-\s+)?run:\s*/, ""))
    : null;
  if (action && run) fail(`step ${index + 1} mixes uses and run`);
  if (!action && !run) fail(`step ${index + 1} has neither uses nor run`);
  return { index, block, action, run, env, name: first.replace(/^\s*-\s*(?:name:\s*)?/, "").trim() };
}

export function parseWorkflow(source) {
  const lines = source.split(/\r?\n/);
  const jobIndex = lines.indexOf("  lint-build:");
  if (jobIndex < 0) fail("lint-build job is missing");
  const end = lines.findIndex((line, index) => index > jobIndex && /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line));
  const jobLines = lines.slice(jobIndex + 1, end < 0 ? lines.length : end);
  if (jobLines[0] !== "    runs-on: ubuntu-latest" || jobLines[1] !== "    steps:") {
    fail("lint-build must retain the reviewed runs-on and steps properties");
  }
  const stepStarts = jobLines.flatMap((line, index) => /^      -\s+/.test(line) ? [index] : []);
  if (stepStarts.length === 0) fail("lint-build has no steps");
  const steps = stepStarts.map((start, position) => parseStep(
    jobLines.slice(start, stepStarts[position + 1] ?? jobLines.length),
    position,
  ));

  const actionSteps = steps.filter((step) => step.action);
  if (actionSteps.length !== 4) fail(`expected checkout, setup-node, and two artifact actions; found ${actionSteps.length}`);
  if (actionSteps[0].action !== CHECKOUT_ACTION) fail("checkout action is missing or changed");
  if (actionSteps[1].action !== SETUP_NODE_ACTION) fail("setup-node action is missing or changed");
  if (actionSteps[2].action !== UPLOAD_ARTIFACT_ACTION || actionSteps[3].action !== UPLOAD_ARTIFACT_ACTION) fail("artifact uploads must use the reviewed immutable action");

  const checkoutWith = Object.fromEntries(steps[0].block
    .map((line) => line.match(/^          ([A-Za-z0-9_-]+):\s*(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], scalar(match[2])]));
  if (checkoutWith.ref !== CHECKOUT_REF) fail("checkout ref is not the reviewed exact-SHA expression");
  const setupWith = Object.fromEntries(steps[1].block
    .map((line) => line.match(/^          ([A-Za-z0-9_-]+):\s*(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], scalar(match[2])]));
  if (setupWith["node-version"] !== "24" || setupWith.cache !== "npm") fail("setup-node must select Node 24 with npm caching");

  const uploadSteps = actionSteps.slice(2);
  const uploadWith = uploadSteps.map((step) => Object.fromEntries(
    step.block
      .map((line) => line.match(/^          ([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], scalar(match[2])]),
  ));
  if (uploadWith.some((withValues) => withValues["if-no-files-found"] !== "error" || withValues.path !== "${{ runner.temp }}/xot-supply-chain" || !withValues.name)
    || uploadWith[0].name !== `xot-supply-chain-${CHECKOUT_REF}`
    || uploadWith[1].name !== `xot-supply-chain-accepted-${CHECKOUT_REF}`) {
    fail("artifact uploads must retain the reviewed names, evidence path, and fail-closed missing-file policy");
  }
  const collectorIndex = steps.findIndex((step) => step.run === COLLECT_COMMAND);
  const technicalIndex = steps.findIndex((step) => step.run === TECHNICAL_VALIDATE_COMMAND);
  const ownerIndex = steps.findIndex((step) => step.run === OWNER_VALIDATE_COMMAND);
  const uploadIndexes = uploadSteps.map((step) => step.index);
  if (collectorIndex < 0 || technicalIndex !== uploadIndexes[0] + 1 || ownerIndex !== uploadIndexes[1] - 1) {
    fail("supply-chain collection, technical validation, and final owner validation boundaries changed");
  }
  const runSteps = steps.filter((step) => step.run);
  if (REQUIRED_PREFIX_COMMANDS.some((command, index) => runSteps[index]?.run !== command)) {
    fail("the direct supply-chain preflight, immutable installs, Deno bootstrap, and collection prefix changed");
  }
  for (const index of [collectorIndex, technicalIndex, ownerIndex]) {
    if (steps[index].env.XOT_REVIEWED_SHA !== CHECKOUT_REF) fail("supply-chain evidence commands must bind XOT_REVIEWED_SHA to the reviewed checkout");
  }
  if (!(collectorIndex < uploadIndexes[0] && uploadIndexes[0] < technicalIndex && technicalIndex < ownerIndex && ownerIndex < uploadIndexes[1])) {
    fail("supply-chain evidence sequence is not blocking and ordered");
  }
  if (steps[ownerIndex].env.XOT_SUPPLY_OWNER_POLICY_MODE !== "exact-head" || steps[ownerIndex].env[OWNER_POLICY_ENV] !== OWNER_POLICY_REF) {
    fail("final owner validation must use exact-head and the repository owner-policy variable");
  }
  return { steps, collectorIndex, technicalIndex, ownerIndex, uploadIndexes };
}

function envValue(value, circleSha, allowOwnerPolicy, ownerPolicyValue) {
  if (value === CHECKOUT_REF) return circleSha;
  if (value === OWNER_POLICY_REF) {
    if (!allowOwnerPolicy) return undefined;
    return ownerPolicyValue;
  }
  if (value.includes("${{")) fail(`unsupported GitHub expression in step environment: ${value}`);
  return value;
}

export function buildStepEnvironment(step, circleSha, sourceEnv = process.env) {
  const env = { ...sourceEnv };
  delete env[OWNER_POLICY_ENV];
  // Circle's shell has already loaded the setup step's Node 24 PATH. Do not
  // let a derived nounset child source Circle's bootstrap bashrc again.
  delete env[BASH_ENV_ENV];
  const ownerStep = step.run === OWNER_VALIDATE_COMMAND;
  if (ownerStep && sourceEnv[OWNER_POLICY_ENV] !== undefined) env[OWNER_POLICY_ENV] = sourceEnv[OWNER_POLICY_ENV];
  for (const [key, value] of Object.entries(step.env)) {
    const resolved = envValue(value, circleSha, ownerStep, sourceEnv[OWNER_POLICY_ENV]);
    if (resolved === undefined) delete env[key];
    else env[key] = resolved;
  }
  return env;
}

function stageSteps(workflow, stage) {
  const { steps, uploadIndexes } = workflow;
  if (stage === "pre-technical") return steps.slice(0, uploadIndexes[0]).filter((step) => step.run);
  if (stage === "post-technical") return steps.slice(uploadIndexes[0] + 1, uploadIndexes[1]).filter((step) => step.run);
  fail(`unsupported stage ${JSON.stringify(stage)}`);
}

function exactCircleCheckout() {
  const circleSha = process.env[CIRCLE_SHA_ENV]?.trim() ?? "";
  if (!SHA_RE.test(circleSha)) fail(`${CIRCLE_SHA_ENV} must contain a lowercase 40-character commit SHA`);
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0 || result.signal) fail("git rev-parse HEAD failed");
  const checkoutSha = result.stdout.trim();
  if (checkoutSha !== circleSha) fail(`Circle checkout ${checkoutSha || "<missing>"} does not equal ${CIRCLE_SHA_ENV}`);
  return circleSha;
}

export function validateCircleWorkflow(source = readFileSync(WORKFLOW_PATH, "utf8")) {
  return parseWorkflow(source);
}

export function runCircleParity({ stage, source = readFileSync(WORKFLOW_PATH, "utf8"), execute = true } = {}) {
  const workflow = parseWorkflow(source);
  const selected = stageSteps(workflow, stage);
  if (!execute) return { workflow, selected };
  const circleSha = exactCircleCheckout();
  const runnerTemp = process.env[RUNNER_TEMP_ENV];
  if (!runnerTemp) fail(`${RUNNER_TEMP_ENV} must be set by CircleCI so evidence cannot be written to an implicit location`);
  for (const step of selected) {
    const env = buildStepEnvironment(step, circleSha);
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
      cwd: REPO_ROOT,
      env,
      stdio: "inherit",
    });
    if (result.status !== 0 || result.signal) fail(`step ${step.index + 1} failed${result.signal ? ` with signal ${result.signal}` : ` with status ${result.status}`}`);
  }
  return { workflow, selected, circleSha };
}

function main() {
  const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length);
  if (!stage) fail("--stage=pre-technical or --stage=post-technical is required");
  const checkOnly = process.argv.includes("--check-only");
  const result = runCircleParity({ stage, execute: !checkOnly });
  if (checkOnly) console.log(`CIRCLECI_PARITY_PASS stage=${stage} workflowSteps=${result.workflow.steps.length} runSteps=${result.workflow.steps.filter((step) => step.run).length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
