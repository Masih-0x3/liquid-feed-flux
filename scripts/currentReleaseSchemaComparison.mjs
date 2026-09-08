import { hash } from "./currentReleaseBaseline.mjs";
import { buildSchemaPrivilegeFacts } from "./schema-privilege-evidence.mjs";

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
const canonical = (value) => JSON.stringify(stableValue(value));
const catalogKeys = {
  relations: (row) => row.name,
  columns: (row) => `${row.relation}.${row.name}`,
  functions: (row) => row.identity,
  constraints: (row) => `${row.relation}.${row.name}`,
  indexes: (row) => `${row.tablename}.${row.indexname}`,
  policies: (row) => `${row.tablename}.${row.policyname}`,
  triggers: (row) => `${row.relation}.${row.name}`,
  views: (row) => row.name,
  sequences: (row) => row.name,
  enum_values: (row) => `${row.type}.${row.label}`,
};

export function compareCurrentReleaseCatalogs(replay, production) {
  const differences = {};
  for (const [category, key] of Object.entries(catalogKeys)) {
    if (!Array.isArray(replay[category]) || !Array.isArray(production[category])) throw new Error(`catalog category absent: ${category}`);
    const left = new Map(replay[category].map((row) => [key(row), row]));
    const right = new Map(production[category].map((row) => [key(row), row]));
    if (left.size !== replay[category].length || right.size !== production[category].length) throw new Error(`duplicate catalog identity: ${category}`);
    const changed = [...left.keys()].filter((id) => right.has(id) && canonical(left.get(id)) !== canonical(right.get(id))).sort()
      .map((id) => ({ id, fields: [...new Set([...Object.keys(left.get(id)), ...Object.keys(right.get(id))])]
        .filter((field) => canonical(left.get(id)[field]) !== canonical(right.get(id)[field])).sort(),
      replay_sha256: hash(canonical(left.get(id))), production_sha256: hash(canonical(right.get(id))) }));
    differences[category] = { replay_count: left.size, production_count: right.size,
      replay_only: [...left.keys()].filter((id) => !right.has(id)).sort(),
      production_only: [...right.keys()].filter((id) => !left.has(id)).sort(), changed };
  }
  return differences;
}

export function buildCurrentReleaseComparison({ replaySql, productionSql, replayCatalog, productionCatalog }) {
  const facts = buildSchemaPrivilegeFacts(replaySql, productionSql);
  return { schema: "xot-current-release-schema-comparison-v1", created_at: new Date().toISOString(),
    status: "pending_owner_review", facts_sha256: hash(JSON.stringify(facts)),
    source: facts.source, non_privilege_schema: facts.non_privilege_schema,
    syntactic_privilege_summary: { differing_records: facts.privileges.differing_records,
      production_broader_records: facts.privileges.production_broader_records,
      replay_broader_records: facts.privileges.replay_broader_records, different_records: facts.privileges.different_records,
      default_privilege_counts: facts.defaultPrivilegeCounts },
    catalog_sources: { replay_sha256: hash(canonical(replayCatalog)), production_sha256: hash(canonical(productionCatalog)),
      replay_database_version: replayCatalog.database_version, production_database_version: productionCatalog.database_version },
    catalog_differences: compareCurrentReleaseCatalogs(replayCatalog, productionCatalog),
    interpretation: "Catalog comparison ignores JSON object-key order only; SQL strings, owners, ACLs and array contents remain exact. Syntactic GRANT/REVOKE counts are not effective-permission or exploitability counts. Full facts reproduce from the protected SQL inputs; no raw function bodies are published here.",
    release: "CLOSED" };
}
