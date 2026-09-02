import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = join(root, "docs/plans/2026-07-14-xot-comprehensive-audit-remediation-implementation-ledger.jsonl");
const receiptPath = "docs/plans/2026-08-08-xot-b4-video-render-claim-fencing.json";
const event = "b4_video_render_claim_fencing_final_post_append_acceptance_row515";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const ledger = readFileSync(ledgerPath, "utf8");
const lines = ledger.trimEnd().split("\n");
const parsed = lines.map((line) => JSON.parse(line));
if (parsed.some((row) => row.event === event)) {
  throw new Error(`${event} already exists; append-only ledger was not changed`);
}
if (lines.length !== 514 || parsed[513].event !== "b4_video_render_claim_fencing_accepted_local_t0_t1_row514") {
  throw new Error("B4 final append requires row 514 as the exact predecessor");
}

const receipt = JSON.parse(readFileSync(join(root, receiptPath), "utf8"));
const row = {
  timestamp: "2026-08-09T03:40:00Z",
  event,
  phase: "split-b4-accepted-local-only",
  task_ids: ["root-b4-render-fence-20260809"],
  air_ids: ["AIR-018"],
  risk_tier: "HIGH",
  status: "accepted_local_t0_t1_b4_video_render_claim_fencing_final_post_append_verified; higher_tier evidence deferred; release gate CLOSED",
  goal_reanchor: "Finalize AIR-018 local B4 acceptance after the complete 175-test renderer suite and post-append normal/mutation AIR gates passed; row 514 remains immutable and is superseded only for its earlier 174-test bookkeeping count.",
  predecessor_binding: {
    ledger_row: 514,
    line_sha256: sha256(lines[513]),
    event: parsed[513].event,
  },
  source_discovery: parsed[513].source_discovery,
  current_receipt: {
    ...parsed[513].current_receipt,
    path: receiptPath,
    sha256: sha256(readFileSync(join(root, receiptPath))),
    schema: receipt.schema,
    currentCandidateContract: receipt.currentCandidateContract,
  },
  scope_completed: [
    ...parsed[513].scope_completed,
    "Reran the complete renderer suite after adding the stale-failure assertion: 175/175 passed.",
    "Verified row 514 as the latest AIR-018 disposition with normal and mutation coverage, then appended this final immutable bookkeeping correction.",
  ],
  validation: {
    ...parsed[513].validation,
    renderer_tests_final: "175/175 PASS after final stale-failure assertion",
    post_append_air_coverage: "80/80 PASS normal and mutation with row 514 latest",
    final_source_contract: "PASS normal and mutation",
    final_source_contract_test: "2/2 PASS",
    final_migration_baseline: "PASS current candidate 117; release blockers retained",
    final_strict: "TypeScript PASS; strict-project normal and mutation PASS",
  },
  evidence_tier: parsed[513].evidence_tier,
  air_dispositions: parsed[513].air_dispositions,
  not_closed: parsed[513].not_closed,
  deployment_state: parsed[513].deployment_state,
  rollback_kill_receipt: "Rows 514 and 515 are append-only. No production migration apply, provider call, server, commit, push, deploy, or live action occurred; append another correction if later evidence overturns this local acceptance.",
  resource_state: "Task-owned Claude Code reviews and no-network PostgreSQL containers exited; no B4 test containers, terminals, or subagents remain; dirty user work preserved.",
  adversarial_review: {
    ...parsed[513].adversarial_review,
    verdict: "ACCEPT_LOCAL_T0_T1_FINAL_POST_APPEND_VERIFIED_WITH_EXTERNAL_GATES",
    observed_repairs: [
      ...parsed[513].adversarial_review.observed_repairs,
      "The final full renderer suite was rerun after the last focused assertion, correcting the prior 174-test bookkeeping count to 175/175 without rewriting row 514.",
    ],
  },
};

appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
console.log(`B4_FINAL_LEDGER_APPEND_PASS row=${lines.length + 1} event=${event}`);
