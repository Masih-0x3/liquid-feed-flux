import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const planPath = path.join(repoRoot, "docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-plan.md");
const ledgerPath = path.join(repoRoot, "docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`AIR_LEDGER_COVERAGE_CONTRACT_FAIL ${message}`);
}

function expectedAirIds(plan) {
  return [...plan.matchAll(/^\| (AIR-\d{3}) \|/gm)].map((match) => match[1]);
}

function parseLedger(ledgerText) {
  return ledgerText.trim().split("\n").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`ledger line ${index + 1} is not valid JSON: ${error.message}`);
    }
  });
}

function assertContract({ plan, ledgerText, packageJson, ci }, label = "current source") {
  const ids = expectedAirIds(plan);
  const expected = Array.from({ length: 80 }, (_, index) =>
    `AIR-${String(index + 1).padStart(3, "0")}`
  );
  if (ids.length !== expected.length || new Set(ids).size !== expected.length ||
    expected.some((id, index) => ids[index] !== id)) {
    fail(`${label}: plan AIR register must contain AIR-001 through AIR-080 exactly once`);
  }

  const rows = parseLedger(ledgerText);
  const latest = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") fail(`${label}: ledger row is not an object`);
    if (!Array.isArray(row.air_ids)) continue;
    for (const airId of row.air_ids) latest.set(airId, row);
  }
  const missing = expected.filter((id) => !latest.has(id));
  if (missing.length > 0) fail(`${label}: AIR IDs have no ledger disposition: ${missing.join(", ")}`);

  for (const id of expected) {
    const row = latest.get(id);
    if (typeof row.timestamp !== "string" || !row.timestamp.trim()) {
      fail(`${label}: ${id} latest disposition lacks a timestamp`);
    }
    if (typeof row.status !== "string" || !row.status.trim()) {
      fail(`${label}: ${id} latest disposition lacks an explicit status`);
    }
    if (typeof row.resource_state !== "string" &&
      (!row.deployment_state || typeof row.deployment_state !== "object")) {
      fail(`${label}: ${id} latest disposition lacks local/release state evidence`);
    }
    if (!row.source_discovery || typeof row.source_discovery !== "object" ||
      !Array.isArray(row.source_discovery.affected_paths) || row.source_discovery.affected_paths.length === 0) {
      fail(`${label}: ${id} latest disposition lacks source-discovery proof`);
    }
    if (!Array.isArray(row.scope_completed) || row.scope_completed.length === 0) {
      fail(`${label}: ${id} latest disposition lacks completed-scope proof`);
    }
    if (!row.adversarial_review || typeof row.adversarial_review !== "object") {
      fail(`${label}: ${id} latest disposition lacks adversarial-review proof`);
    }
    if (!row.validation || typeof row.validation !== "object") {
      fail(`${label}: ${id} latest disposition lacks validation proof`);
    }
    if (!Array.isArray(row.not_closed) || row.not_closed.length === 0) {
      fail(`${label}: ${id} latest disposition lacks remaining-risk proof`);
    }
    if (!row.deployment_state || typeof row.deployment_state !== "object") {
      fail(`${label}: ${id} latest disposition lacks deployment-state proof`);
    }
    const disposition = row.air_dispositions?.[id];
    if (!disposition || typeof disposition !== "object" || Array.isArray(disposition)) {
      fail(`${label}: ${id} latest disposition lacks an explicit owner/evidence/date record`);
    }
    if (typeof disposition.owner !== "string" || !disposition.owner.trim()) {
      fail(`${label}: ${id} latest disposition lacks an evidence owner`);
    }
    if (typeof disposition.required_evidence !== "string" || !disposition.required_evidence.trim()) {
      fail(`${label}: ${id} latest disposition lacks required evidence text`);
    }
    if (typeof disposition.evidence_date !== "string" || !disposition.evidence_date.trim()) {
      fail(`${label}: ${id} latest disposition lacks an evidence date`);
    }
    if (typeof disposition.deadline !== "string" || !disposition.deadline.trim()) {
      fail(`${label}: ${id} latest disposition lacks an owner deadline`);
    }
    const rollbackReceipt = row.rollback_kill_receipt ?? row.kill_switch_receipt ?? row.deployment_state?.rollback;
    if (typeof rollbackReceipt !== "string" || !rollbackReceipt.trim()) {
      fail(`${label}: ${id} latest disposition lacks a rollback/kill-switch receipt`);
    }
    const evidenceTier = row.evidence_tier;
    if (!evidenceTier || typeof evidenceTier !== "object" || Array.isArray(evidenceTier) ||
      !Array.isArray(evidenceTier.achieved) || !Array.isArray(evidenceTier.deferred)) {
      fail(`${label}: ${id} latest disposition lacks an explicit achieved/deferred evidence-tier split`);
    }
    const knownTiers = new Set(["T0", "T1", "T2", "T3", "T4"]);
    if ([...evidenceTier.achieved, ...evidenceTier.deferred].some((tier) =>
      typeof tier !== "string" || !knownTiers.has(tier))) {
      fail(`${label}: ${id} latest disposition contains an unknown evidence tier`);
    }
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:air-ledger-coverage"] !==
    "node scripts/check-air-ledger-coverage.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:air-ledger-coverage")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    plan: fs.readFileSync(planPath, "utf8"),
    ledgerText: fs.readFileSync(ledgerPath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function mutateLatestDispositionField(ledgerText, airId, field, value) {
  const lines = ledgerText.trimEnd().split("\n");
  let latestIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const row = JSON.parse(lines[index]);
    if (Array.isArray(row.air_ids) && row.air_ids.includes(airId) &&
      row.air_dispositions?.[airId]) {
      latestIndex = index;
    }
  }
  if (latestIndex < 0) fail(`mutation fixture could not locate latest ${airId} disposition`);
  const row = JSON.parse(lines[latestIndex]);
  row.air_dispositions[airId][field] = value;
  lines[latestIndex] = JSON.stringify(row);
  return `${lines.join("\n")}\n`;
}

function mutateLatestRowField(ledgerText, airId, field, value) {
  const lines = ledgerText.trimEnd().split("\n");
  let latestIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const row = JSON.parse(lines[index]);
    if (Array.isArray(row.air_ids) && row.air_ids.includes(airId)) latestIndex = index;
  }
  if (latestIndex < 0) fail(`mutation fixture could not locate latest ${airId} row`);
  const row = JSON.parse(lines[latestIndex]);
  row[field] = value;
  lines[latestIndex] = JSON.stringify(row);
  return `${lines.join("\n")}\n`;
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("AIR_LEDGER_COVERAGE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    plan: input.plan.replace("| AIR-080 |", "| AIR-081 |"),
  }), "missing AIR register row mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: input.ledgerText.replace(/"AIR-080"/, ""),
  }), "missing AIR ledger disposition mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestRowField(input.ledgerText, "AIR-001", "status", ""),
  }), "missing explicit status mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestRowField(input.ledgerText, "AIR-001", "timestamp", ""),
  }), "missing timestamp mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestDispositionField(input.ledgerText, "AIR-001", "owner", ""),
  }), "missing disposition owner mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestDispositionField(input.ledgerText, "AIR-001", "required_evidence", ""),
  }), "missing required evidence mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestDispositionField(input.ledgerText, "AIR-001", "deadline", ""),
  }), "missing owner deadline mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestRowField(input.ledgerText, "AIR-001", "rollback_kill_receipt", ""),
  }), "missing rollback receipt mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestRowField(input.ledgerText, "AIR-001", "evidence_tier", null),
  }), "missing evidence tier split mutant");
  assertRejects((input) => ({
    ...input,
    ledgerText: mutateLatestRowField(input.ledgerText, "AIR-001", "validation", null),
  }), "missing validation proof mutant");
}

console.log(
  `AIR_LEDGER_COVERAGE_CONTRACT_PASS airIds=80 latestDispositions=80 selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
