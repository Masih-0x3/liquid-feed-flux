import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PATH = "supabase/functions/_shared/staleMediaRepair.ts";

function validate(source = readFileSync(join(ROOT, PATH), "utf8")) {
  assert.match(source, /if \(pendingRepairError\) \{[\s\S]*?stale_media_pending_check_failed/, "pending-job query errors must fail closed");
  assert.match(source, /if \(!Array\.isArray\(pendingRepairs\)\) \{[\s\S]*?stale_media_pending_check_invalid_response/, "malformed pending-job responses must fail closed");
  assert.match(source, /const hasPendingRepair = Array\.isArray\(pendingRepairs\) && pendingRepairs\.length > 0;/, "pending-job state must only be derived from a validated array");
  assert.match(source, /idempotency_key:\s*staleMediaRepairIdempotencyKey\(/, "repair enqueue must retain its idempotency key");
}

validate();

if (process.env.MUTATION_TEST === "1") {
  const source = readFileSync(join(ROOT, PATH), "utf8");
  assert.throws(
    () => validate(source.replace("if (!Array.isArray(pendingRepairs)) {", "if (Array.isArray(pendingRepairs)) {")),
    "malformed pending-job response mutation must fail",
  );
  assert.throws(
    () => validate(source.replace("const hasPendingRepair = Array.isArray(pendingRepairs) && pendingRepairs.length > 0;", "const hasPendingRepair = pendingRepairs.length > 0;")),
    "fail-open pending-job fallback mutation must fail",
  );
}

console.log(`STALE_MEDIA_REPAIR_SOURCE_CONTRACT_PASS malformedPendingResponse=fail_closed idempotencyKey=required mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
