import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PATH = "supabase/functions/x-poster/index.ts";

function helperSource(source) {
  const start = source.indexOf("async function repairOriginalStaleMediaForX(");
  const end = source.indexOf("// deno-lint-ignore no-explicit-any\nasync function loadVideoRenderConfig", start);
  assert.ok(start >= 0 && end > start, "X-poster stale-repair helper boundary must remain discoverable");
  return source.slice(start, end);
}

function validate(source = readFileSync(join(ROOT, PATH), "utf8")) {
  const helper = helperSource(source);
  assert.match(helper, /try \{[\s\S]*?await repairStaleMediaObject\([\s\S]*?return true;/, "successful stale repair must return queued=true");
  assert.match(helper, /catch \(_repairError\) \{[\s\S]*?stale_media_repair_failed[\s\S]*?return false;/, "repair failures must stay inside the stable X-poster failure envelope");
  assert.doesNotMatch(helper, /console\.warn\([^\n]*_repairError/, "repair diagnostics must not expose the raw repair exception");
}

validate();

if (process.env.MUTATION_TEST === "1") {
  const source = readFileSync(join(ROOT, PATH), "utf8");
  assert.throws(
    () => validate(source.replace("return false;\n  }\n}\n\n// deno-lint-ignore", "throw _repairError;\n  }\n}\n\n// deno-lint-ignore")),
    "X-poster stale-repair escape mutation must fail",
  );
  assert.throws(
    () => validate(source.replace("error: 'stale_media_repair_failed'", "error: _repairError.message")),
    "X-poster raw repair-error telemetry mutation must fail",
  );
}

console.log(`X_POSTER_STALE_REPAIR_SOURCE_CONTRACT_PASS failureEnvelope=stable helperBoundary=contained mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
