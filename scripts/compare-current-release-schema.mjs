// Read-only, redacted report. All four inputs must already be protected locally.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { protectedInput, parseEvidenceJson } from "./currentReleaseBaseline.mjs";
import { buildCurrentReleaseComparison } from "./currentReleaseSchemaComparison.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = process.argv.slice(2);
if (paths.length !== 4) throw new Error("usage: node scripts/compare-current-release-schema.mjs REPLAY_SQL PRODUCTION_SQL REPLAY_CATALOG PRODUCTION_CATALOG");
const inputs = paths.map((path) => protectedInput(root, path).toString());
console.log(JSON.stringify(buildCurrentReleaseComparison({ replaySql: inputs[0], productionSql: inputs[1],
  replayCatalog: parseEvidenceJson(inputs[2]), productionCatalog: parseEvidenceJson(inputs[3]) }), null, 2));
