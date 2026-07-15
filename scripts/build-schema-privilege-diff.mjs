import fs from "node:fs";

import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";

const [replayPath, productionPath, outputPath] = process.argv.slice(2);
if (!replayPath || !productionPath || !outputPath) {
  throw new Error("usage: node build-xot-privilege-diff.mjs REPLAY_DUMP PRODUCTION_DUMP OUTPUT_JSON");
}
const replay = fs.readFileSync(replayPath, "utf8");
const production = fs.readFileSync(productionPath, "utf8");
const facts = buildSchemaPrivilegeFacts(replay, production);

const output = {
  schema_version: "xot-schema-privilege-diff-v1",
  observed_at: "2026-07-14T10:48:00Z",
  methodology: {
    generator: "scripts/build-schema-privilege-diff.mjs",
    generator_version: 1,
    tool_versions: { node: "22.23.1", pg_dump: "Supabase CLI 2.109.1" },
    canonicalization_contract: "normalize CRLF to LF; remove only blank lines, whole-line SQL comments, GRANT, REVOKE, and ALTER DEFAULT PRIVILEGES; preserve every retained byte including quoted content",
  },
  source: facts.source,
  non_privilege_schema: facts.non_privilege_schema,
  assessment: {
    status: "blocked_pending_sr_rls_01_role_matrix",
    interpretation: "production_broader is a syntactic grant comparison, not by itself proof of exploitability; RLS, function security mode, and API exposure still require role-specific testing",
    required_roles: ["anon", "authenticated_viewer", "authenticated_admin", "service_role", "renderer"],
    required_surfaces: ["REST CRUD", "RPC", "Realtime", "Storage"],
    known_same_version_source_divergences: ["20260515080625", "20260515084409", "20260515104839", "20260516021358"],
  },
  default_privilege_assessment: {
    status: "blocked_pending_sr_rls_01_explicit_disposition",
    ...facts.defaultPrivilegeCounts,
    production_future_object_blast_radius: [
      "ALL on future public tables for anon",
      "ALL on future public tables for authenticated",
      "ALL on future public tables for service_role",
      "ALL on future public sequences for anon",
      "ALL on future public sequences for authenticated",
      "ALL on future public sequences for service_role",
      "ALL on future public functions for service_role",
    ],
    required_resolution: "review and explicitly replace or approve every production-only default privilege before any subsequent object-creating migration",
  },
  privileges: facts.privileges,
  disposition: {
    status: "blocked_pending_sr_rls_01",
    reason: "structure parity does not authorize accepting broader production grants; role matrix and authenticated workflow proof are required",
  },
};
if (!output.non_privilege_schema.expected_empty) throw new Error("Non-privilege schema canonical hashes differ");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  non_privilege_expected_empty: true,
  grant_differences: facts.privileges.differing_records,
  production_broader: facts.privileges.production_broader_records,
}));
