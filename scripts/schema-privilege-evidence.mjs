import crypto from "node:crypto";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parsePrivilegeLine(line) {
  const match = line.match(/^(GRANT|REVOKE) (.+?) ON (TABLE|FUNCTION|SEQUENCE|SCHEMA) (.+?) (TO|FROM) (.+);$/);
  if (!match) return null;
  const action = match[1].toLowerCase();
  const expectedConnector = action === "grant" ? "TO" : "FROM";
  if (match[5] !== expectedConnector) return null;
  return {
    key: `${action} ${match[3]} ${match[4]} ${expectedConnector} ${match[6]}`,
    action,
    object_type: match[3].toLowerCase(),
    object_name: match[4],
    grantee: match[6].replaceAll('"', ""),
    privileges: match[2].split(",").map((item) => item.trim()).sort(),
  };
}

export function canonicalNonPrivilege(value) {
  return value.split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed
        && !trimmed.startsWith("--")
        && !parsePrivilegeLine(trimmed)
        && !trimmed.startsWith("ALTER DEFAULT PRIVILEGES ");
    })
    .join("\n");
}

export function parsePrivilegeStatements(value) {
  const records = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    const record = parsePrivilegeLine(line);
    if (record) records.push(record);
  }
  return records;
}

export const parseGrants = parsePrivilegeStatements;

export function defaultPrivilegeLines(value) {
  return value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ALTER DEFAULT PRIVILEGES "))
    .sort();
}

export function buildSchemaPrivilegeFacts(replay, production) {
  const replayGrants = parsePrivilegeStatements(replay);
  const productionGrants = parsePrivilegeStatements(production);
  const replayMap = new Map(replayGrants.map((entry) => [entry.key, entry]));
  const productionMap = new Map(productionGrants.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...replayMap.keys(), ...productionMap.keys()])].sort();
  const differences = [];
  for (const key of keys) {
    const replayEntry = replayMap.get(key);
    const productionEntry = productionMap.get(key);
    const replayPrivileges = replayEntry?.privileges ?? [];
    const productionPrivileges = productionEntry?.privileges ?? [];
    if (JSON.stringify(replayPrivileges) === JSON.stringify(productionPrivileges)) continue;
    const replaySet = new Set(replayPrivileges);
    const productionSet = new Set(productionPrivileges);
    const isRevoke = (replayEntry ?? productionEntry).action === "revoke";
    const grantProductionBroader = (productionPrivileges.includes("ALL") && !replayPrivileges.includes("ALL"))
      || replayPrivileges.every((item) => productionSet.has(item));
    const grantReplayBroader = (replayPrivileges.includes("ALL") && !productionPrivileges.includes("ALL"))
      || productionPrivileges.every((item) => replaySet.has(item));
    const productionBroader = isRevoke ? grantReplayBroader : grantProductionBroader;
    const replayBroader = isRevoke ? grantProductionBroader : grantReplayBroader;
    differences.push({
      statement: (replayEntry ?? productionEntry).action,
      object_type: (replayEntry ?? productionEntry).object_type,
      object_name: (replayEntry ?? productionEntry).object_name,
      grantee: (replayEntry ?? productionEntry).grantee,
      replay_privileges: replayPrivileges,
      production_privileges: productionPrivileges,
      classification: productionBroader && !replayBroader
        ? "production_broader"
        : replayBroader && !productionBroader
          ? "replay_broader"
          : "different",
    });
  }

  const replayDefaults = defaultPrivilegeLines(replay);
  const productionDefaults = defaultPrivilegeLines(production);
  const replayDefaultSet = new Set(replayDefaults);
  const productionDefaultSet = new Set(productionDefaults);
  const replayOnlyDefaults = replayDefaults.filter((line) => !productionDefaultSet.has(line));
  const productionOnlyDefaults = productionDefaults.filter((line) => !replayDefaultSet.has(line));
  const commonDefaults = replayDefaults.filter((line) => productionDefaultSet.has(line));
  const replayCanonical = canonicalNonPrivilege(replay);
  const productionCanonical = canonicalNonPrivilege(production);

  return {
    source: {
      replay: {
        sha256: sha256(replay),
        lines: replay.split(/\r?\n/).length - 1,
        bytes: Buffer.byteLength(replay),
      },
      production: {
        sha256: sha256(production),
        lines: production.split(/\r?\n/).length - 1,
        bytes: Buffer.byteLength(production),
      },
    },
    non_privilege_schema: {
      replay_sha256: sha256(replayCanonical),
      production_sha256: sha256(productionCanonical),
      expected_empty: replayCanonical === productionCanonical,
      excluded_from_this_hash: ["comments", "blank lines", "GRANT", "REVOKE", "ALTER DEFAULT PRIVILEGES"],
    },
    privileges: {
      replay_grant_records: replayGrants.filter((item) => item.action === "grant").length,
      production_grant_records: productionGrants.filter((item) => item.action === "grant").length,
      replay_revoke_records: replayGrants.filter((item) => item.action === "revoke").length,
      production_revoke_records: productionGrants.filter((item) => item.action === "revoke").length,
      differing_records: differences.length,
      production_broader_records: differences.filter((item) => item.classification === "production_broader").length,
      replay_broader_records: differences.filter((item) => item.classification === "replay_broader").length,
      different_records: differences.filter((item) => item.classification === "different").length,
      differences,
      default_privileges: { replay: replayDefaults, production: productionDefaults },
    },
    defaultPrivilegeCounts: {
      replay_clauses: replayDefaults.length,
      production_clauses: productionDefaults.length,
      common_clauses: commonDefaults.length,
      replay_only: replayOnlyDefaults.length,
      production_only: productionOnlyDefaults.length,
    },
  };
}
