import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const migrationsDirectory = path.join(repoRoot, "supabase/migrations");
const roleRpcName = "current_user_is_admin";
const roleMigrationFileName = "20260724183000_add_current_user_is_admin_rpc.sql";
const entrypoints = [
  {
    name: "admin-actions",
    filePath: path.join(repoRoot, "supabase/functions/admin-actions/index.ts"),
  },
  {
    name: "admin-retry",
    filePath: path.join(repoRoot, "supabase/functions/admin-retry/index.ts"),
  },
];

// This is an intentional source-integrity tripwire, not a general TypeScript
// analyzer. These complete entrypoints are security-reviewed as a unit; any
// byte change requires a new security review and corresponding digest update.
const reviewedEntrypointSha256 = {
  "admin-actions": "075a68ce1dffb09a9d02f3c5aa2e0d6467d96f59b188db1becd9434ab975d6f3",
  "admin-retry": "4f6451cb6bd8c91d1ea913bdb2031fbda764fb2a7e508851a7ad6662e00b449c",
};

// A later root migration can replace this RPC without changing either Edge
// entrypoint. Pin the whole active inventory so an add/remove/rename/body
// change fails before the authorization contract can pass.
const reviewedActiveMigrationInventorySha256 =
  "58d61cb7b2bc385778a95e2ede7560d0e252637e4a433c16b7b4764f726e98be";

// The inventory pin is the enforcement mechanism. Keep this exact SQL fixture
// as readable, reviewable evidence of the caller-bound database contract.
const reviewedRoleMigrationSql = `
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS user_role
    WHERE user_role.user_id = (SELECT auth.uid())
      AND user_role.role = 'admin'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
`;

function fail(category, message) {
  throw new Error(`ADMIN_ROLE_AUTH_SOURCE_CONTRACT_FAIL [${category}] ${message}`);
}

function failProtectedMigration(message) {
  throw new Error(`ADMIN_ROLE_AUTH_PROTECTED_MIGRATION_BLOCKED [protected_migration_inventory] ${message}`);
}

function assert(condition, category, message) {
  if (!condition) fail(category, message);
}

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readRegularText(filePath, label) {
  assert(fs.lstatSync(filePath).isFile(), "regular_file", `${label} must be a regular file`);
  return fs.readFileSync(filePath, "utf8");
}

function readActiveMigrations() {
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => {
      const filePath = path.join(migrationsDirectory, entry.name);
      return { name: entry.name, source: readRegularText(filePath, `active migration ${entry.name}`) };
    })
    .sort((left, right) => compareNames(left.name, right.name));
}

function activeMigrationInventoryDigest(migrations) {
  assert(Array.isArray(migrations), "migration_inventory", "active migrations must be an array");
  const names = migrations.map((migration) => migration?.name);
  assert(
    names.every((name) => typeof name === "string" && name.endsWith(".sql")),
    "migration_inventory",
    "every active migration must have a .sql filename",
  );
  assert(
    new Set(names).size === names.length,
    "migration_inventory",
    "active migration inventory must not contain duplicate filenames",
  );
  const reviewedEntries = migrations.map((migration) => {
    assert(
      typeof migration.source === "string",
      "migration_inventory",
      `active migration ${migration.name} must have source text`,
    );
    return { name: migration.name, sha256: sha256(migration.source) };
  }).sort((left, right) => compareNames(left.name, right.name));
  return sha256(JSON.stringify(reviewedEntries));
}

function canonicalSql(source) {
  return source.replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ").trim();
}

function assertRoleMigration(source) {
  assert(
    canonicalSql(source) === canonicalSql(reviewedRoleMigrationSql),
    "role_migration_sql",
    "role migration must match the review-approved caller-bound function and privilege statements",
  );
}

function assertContract(inputs) {
  assert(inputs && typeof inputs === "object", "inputs", "contract inputs must be an object");
  assert(inputs.entrypoints && typeof inputs.entrypoints === "object", "inputs", "entrypoint inputs are missing");

  for (const entrypoint of entrypoints) {
    const source = inputs.entrypoints[entrypoint.name];
    assert(typeof source === "string", "entrypoint_hash", `${entrypoint.filePath} source is missing`);
    assert(
      sha256(source) === reviewedEntrypointSha256[entrypoint.name],
      "entrypoint_hash",
      `${entrypoint.filePath} differs from its review-pinned SHA-256`,
    );
  }

  if (activeMigrationInventoryDigest(inputs.migrations) !== reviewedActiveMigrationInventorySha256) {
    failProtectedMigration(
      "active migration inventory differs from its review-pinned SHA-256; protected owner/evidence review is required",
    );
  }
  const roleMigrations = inputs.migrations.filter((migration) => migration.name === roleMigrationFileName);
  assert(
    roleMigrations.length === 1,
    "role_migration",
    `active migration inventory must contain exactly one ${roleMigrationFileName}`,
  );
  assertRoleMigration(roleMigrations[0].source);

  return { functions: entrypoints.length, migrations: inputs.migrations.length, roleRpc: roleRpcName };
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  assert(index >= 0, "mutation_test", `${label} fixture text is missing`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + needle.length)}`;
}

function expectRejected(name, inputs, category) {
  let failure;
  try {
    assertContract(inputs);
  } catch (error) {
    failure = error;
  }
  assert(failure, "mutation_test", `${name} mutant was not rejected`);
  assert(
    String(failure).includes(`[${category}]`),
    "mutation_test",
    `${name} mutant failed with an unexpected category: ${String(failure)}`,
  );
}

const currentInputs = {
  entrypoints: Object.fromEntries(entrypoints.map((entrypoint) => [
    entrypoint.name,
    readRegularText(entrypoint.filePath, entrypoint.name),
  ])),
  migrations: readActiveMigrations(),
};

const selfTest = process.env.MUTATION_TEST === "1";
let result;
let protectedMigrationBlocker = null;
try {
  result = assertContract(currentInputs);
} catch (error) {
  if (String(error).startsWith("Error: ADMIN_ROLE_AUTH_PROTECTED_MIGRATION_BLOCKED")) {
    protectedMigrationBlocker = error;
    result = {
      functions: entrypoints.length,
      migrations: currentInputs.migrations.length,
      roleRpc: roleRpcName,
    };
  } else {
    throw error;
  }
}

if (selfTest) {
  expectRejected(
    "admin-actions-one-byte-role-rpc-mutation",
    {
      ...currentInputs,
      entrypoints: {
        ...currentInputs.entrypoints,
        "admin-actions": replaceOnce(
          currentInputs.entrypoints["admin-actions"],
          roleRpcName,
          "current_user_is_admiN",
          "admin-actions role RPC",
        ),
      },
    },
    "entrypoint_hash",
  );
  expectRejected(
    "admin-retry-one-byte-role-rpc-mutation",
    {
      ...currentInputs,
      entrypoints: {
        ...currentInputs.entrypoints,
        "admin-retry": replaceOnce(
          currentInputs.entrypoints["admin-retry"],
          roleRpcName,
          "current_user_is_admiN",
          "admin-retry role RPC",
        ),
      },
    },
    "entrypoint_hash",
  );
  expectRejected(
    "role-migration-caller-binding-mutation",
    {
      ...currentInputs,
      migrations: currentInputs.migrations.map((migration) =>
        migration.name === roleMigrationFileName
          ? {
            ...migration,
            source: replaceOnce(migration.source, "(SELECT auth.uid())", "(SELECT NULL)", "role migration auth.uid"),
          }
          : migration,
      ),
    },
    "protected_migration_inventory",
  );
  expectRejected(
    "later-role-rpc-override",
    {
      ...currentInputs,
      migrations: [
        ...currentInputs.migrations,
        {
          name: "20260724183001_later_role_rpc_override.sql",
          source: "CREATE OR REPLACE FUNCTION public.current_user_is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true; $$;\n",
        },
      ],
    },
    "protected_migration_inventory",
  );
}

if (protectedMigrationBlocker) {
  console.log(
    `ADMIN_ROLE_AUTH_SOURCE_CONTRACT_BLOCKED functions=${result.functions} migrations=${result.migrations} rpc=${result.roleRpc} reason=protected_migration_inventory selfTest=${selfTest ? "pass" : "skipped"}`,
  );
  if (!selfTest) process.exitCode = 2;
} else {
  console.log(
    `ADMIN_ROLE_AUTH_SOURCE_CONTRACT_PASS functions=${result.functions} migrations=${result.migrations} rpc=${result.roleRpc} selfTest=${selfTest ? "pass" : "skipped"}`,
  );
}
