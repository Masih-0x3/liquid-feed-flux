// Read-only builder. Emits redacted inventory/hash metadata; never SQL bodies.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCurrentReleaseBaseline } from "./currentReleaseBaseline.mjs";
import { GATE_REQUIRED_CHECKS, MANIFEST_PATH, SUCCESSOR_V5_CANDIDATE_RECEIPT_PATH } from "./check-migration-baseline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--remote-json") {
  throw new Error("usage: node scripts/build-current-release-baseline.mjs --remote-json PRIVATE_CAPTURE_PATH");
}
console.log(JSON.stringify(buildCurrentReleaseBaseline({ root, remotePath: args[1], historicalPath: MANIFEST_PATH,
  predecessorPath: SUCCESSOR_V5_CANDIDATE_RECEIPT_PATH, gateChecks: GATE_REQUIRED_CHECKS }), null, 2));
