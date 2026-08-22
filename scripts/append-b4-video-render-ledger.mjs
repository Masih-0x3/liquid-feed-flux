import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = join(root, "docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl");
const receiptPath = "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json";
const event = "b4_video_render_claim_fencing_accepted_local_t0_t1_row514";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(path) {
  return sha256(readFileSync(join(root, path)));
}

const ledger = readFileSync(ledgerPath, "utf8");
const lines = ledger.trimEnd().split("\n");
if (lines.some((line) => JSON.parse(line).event === event)) {
  throw new Error(`${event} already exists; append-only ledger was not changed`);
}
if (lines.length !== 513) {
  throw new Error(`B4 ledger append expected 513 predecessor rows, found ${lines.length}`);
}

const receipt = JSON.parse(readFileSync(join(root, receiptPath), "utf8"));
const row = {
  timestamp: "2026-08-09T03:30:00Z",
  event,
  phase: "split-b4-accepted-local-only",
  task_ids: ["root-b4-render-fence-20260809"],
  air_ids: ["AIR-018"],
  risk_tier: "HIGH",
  status: "accepted_local_t0_t1_b4_video_render_claim_fencing; higher_tier_runtime_and_release_evidence_deferred; release gate CLOSED",
  goal_reanchor: "Close the local AIR-018 renderer ownership race with token-generation claims, exact lease renewal, fenced terminal writes, immutable generation outputs, and exact stale-output cleanup without production contact.",
  predecessor_binding: {
    ledger_row: 513,
    line_sha256: sha256(lines[512]),
    event: JSON.parse(lines[512]).event,
  },
  source_discovery: {
    invariant: "Only the current running renderer claim identified by renderer id, random token, and monotonic generation may renew, complete, block, or fail; output keys are generation-specific and non-overwriting; explicit stale completion cleans only its generation and never dispatches downstream.",
    affected_paths: [
      "supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql",
      "services/video-renderer/src/renderLease.js",
      "services/video-renderer/src/renderer.js",
      "services/video-renderer/test/renderLease.test.js",
      "services/video-renderer/test/rendererFailure.test.js",
      "scripts/check-renderer-claim-fence-contract.mjs",
      "scripts/check-renderer-claim-fence-contract.test.mjs",
      "scripts/test-b4-video-render-fencing.sql",
      "scripts/check-migration-baseline.mjs",
      "scripts/check-migration-baseline.test.mjs",
      "scripts/build-b4-video-render-claim-fence-receipt.mjs",
      "scripts/append-b4-video-render-ledger.mjs",
      receiptPath,
      "package.json",
      ".github/workflows/ci.yml",
    ],
  },
  current_receipt: {
    path: receiptPath,
    sha256: fileHash(receiptPath),
    schema: receipt.schema,
    currentCandidateContract: receipt.currentCandidateContract,
    migration: {
      ordinal: 117,
      version: "20260808123000",
      path: "supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql",
      sha256: fileHash("supabase/migrations/20260808123000_b4_video_render_claim_fencing.sql"),
    },
    lease_runtime_sha256: fileHash("services/video-renderer/src/renderLease.js"),
    renderer_runtime_sha256: fileHash("services/video-renderer/src/renderer.js"),
    checker_sha256: fileHash("scripts/check-renderer-claim-fence-contract.mjs"),
  },
  scope_completed: [
    "Added random claim tokens and monotonic claim generations; legacy unfenced running claims requeue atomically at migration.",
    "Added exact-fence bounded renewal that cannot resurrect an expired lease.",
    "Dropped fenceless terminal overloads; complete, block, and fail now gate row, event, and delivery effects on the current fence.",
    "Added generation-specific non-upserting outputs, fail-closed renewal tracking, explicit terminal acceptance, and exact rejected-generation cleanup.",
    "Advanced the author current-candidate chain from accepted B3b2 to 117 migrations without changing the protected release manifest.",
  ],
  validation: {
    tdd_red: "PASS: missing lease module, unfenced failure payload, implicit terminal acceptance, and missing cleanup helper failed before implementation",
    source_contract: "PASS normal and mutation",
    source_contract_test: "2/2 PASS",
    renderer_tests: "174/174 PASS",
    disposable_postgres: "PASS network=none host_ports=0 production_contact=false; legacy requeue, rotation, renewal, expired rejection, stale/current/double completion, block/fail, one release, exact events; container removed",
    migration_baseline: "PASS current candidate 117; protected release blockers retained",
    migration_tests: "62/62 PASS",
    renderer_boundaries: "capacity normal/mutation, request, error, process, and boundary typecheck PASS",
    strict_typescript: "PASS",
    strict_project: "PASS normal and mutation",
    air_coverage_pre_append: "80/80 PASS normal and mutation",
    video_render_rls_broad_gate: "BLOCKED outside this slice: already rejected five earlier post-lockdown migrations and now also lists B4 for aggregate review",
    claude_code: "Initial Claude Code 2.1.226 GLM-5.2 high SQL/runtime subagent design review accepted in part; inaccurate items reworked. Second post-implementation subagent review timed out, was terminated, and produced no accepted output.",
  },
  evidence_tier: {
    achieved: ["T0", "T1"],
    deferred: ["T2", "T3", "T4"],
    note: "T1 is isolated disposable PostgreSQL plus local renderer tests only; no production equivalence, hosted runtime, staging, deployment, or live renderer claim.",
  },
  air_dispositions: {
    "AIR-018": {
      owner: "renderer and database reliability owner",
      classification: "accepted_local_t0_t1_video_render_claim_fencing",
      required_evidence: "Aggregate raw-table/RLS review, production replay, generated types, hosted CI, long-render renewal metrics, staging, deployment, and live runtime remain required for higher-tier closure.",
      evidence_date: "2026-08-09",
      deadline: "2026-08-15T00:00:00Z",
    },
  },
  not_closed: [
    "AIR-018 higher-tier aggregate RLS, production-equivalence, CI, staging, deploy, long-render metrics, and live evidence are NOT_CLOSED.",
    "Protected migration evidence, historical Supabase PAT alert #1, generated production types, reviewed role/grant proof, hosted CI, staging, deployment, browser, and live verification remain unresolved.",
    "Release gate CLOSED.",
  ],
  deployment_state: {
    local: "B4 renderer claim fencing accepted at T0+T1",
    server: "not run",
    browser: "not run",
    database: "temporary isolated disposable only; production not contacted",
    staged: "no",
    committed: "no",
    pushed: "no",
    ci: "not run",
    staging: "not run",
    deployed: "no",
    live: "not run",
  },
  rollback_kill_receipt: "No production migration apply, provider call, server, commit, push, deploy, or live action occurred. Revert only B4 local paths and append a correcting ledger row if overturned; never rewrite prior ledger rows.",
  resource_state: "Task-owned Claude Code reviews and no-network PostgreSQL containers exited; no B4 test containers, terminals, or subagents remain; dirty user work preserved.",
  adversarial_review: {
    verdict: "ACCEPT_LOCAL_T0_T1_WITH_EXTERNAL_GATES",
    method: "TDD, mutation testing, isolated PostgreSQL stale-fence/reclaim/double-write faults, immutable-output review, renderer full suite, successor-chain validation, strict checks, and pre-append AIR coverage.",
    disproved_mutations: ["claim-token removal", "generation-fence bypass", "mutable overwrite", "cleanup bypass", "implicit terminal acceptance"],
    observed_repairs: ["SQL fixture now tolerates pre-existing Supabase roles.", "Failure writes now require explicit accepted=true before reaching downstream invocation logic."],
    scope_limit: "No production Supabase, renderer server, provider, browser, hosted CI, staging, deploy, commit, push, or live verification. Aggregate video-render RLS review remains outside this slice.",
  },
};

appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
console.log(`B4_LEDGER_APPEND_PASS row=${lines.length + 1} event=${event}`);
