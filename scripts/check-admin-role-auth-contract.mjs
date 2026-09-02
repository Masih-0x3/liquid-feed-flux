import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalMigrationPath = path.join(
  repoRoot,
  "supabase/migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql",
);
const canonicalMigrationSha256 =
  "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7";
const entrypointPaths = {
  adminActions: path.join(repoRoot, "supabase/functions/admin-actions/index.ts"),
  adminRetry: path.join(repoRoot, "supabase/functions/admin-retry/index.ts"),
};

function fail(message) {
  throw new Error(`ADMIN_ROLE_AUTH_SOURCE_CONTRACT_FAIL ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assertRoleMigration(sql) {
  const required = [
    "CREATE TYPE public.app_role AS ENUM ('admin', 'read_only')",
    "user_id uuid PRIMARY KEY",
    "ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id)",
    "CREATE OR REPLACE FUNCTION public.current_user_role()",
    "CREATE OR REPLACE FUNCTION public.current_user_is_admin()",
    "SET search_path = ''",
    "(SELECT auth.uid())",
    "REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated",
    "GRANT SELECT ON TABLE public.user_roles TO authenticated",
    "REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon",
    "GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated",
    "REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC, anon",
    "GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated",
  ];
  for (const needle of required) assert(sql.includes(needle), `canonical role migration lost: ${needle}`);
}

function assertEntrypoint(input, label) {
  assert(input.includes("resolveCurrentUserRole"), `${label} must resolve the canonical role helper`);
  assert(!input.includes("current_user_is_admin"), `${label} must not call the legacy admin-only role RPC`);
  assert(input.includes("status: 403"), `${label} must reject forbidden roles with 403`);
  if (label === "admin-actions") {
    assert(input.includes("isReadOnlyAdminActionName"), "admin-actions must enforce the read-only allowlist");
    assert(input.includes("authResult.role === \"read_only\""), "admin-actions must reject read-only mutations");
  } else {
    assert(input.includes("role !== \"admin\""), "admin-retry must enforce admin-only mutation access");
  }
}

function replaceOnce(input, needle, replacement, label) {
  const index = input.indexOf(needle);
  assert(index >= 0, `mutation fixture missing ${label}`);
  return input.slice(0, index) + replacement + input.slice(index + needle.length);
}

const migration = read(canonicalMigrationPath);
const entrypoints = Object.fromEntries(
  Object.entries(entrypointPaths).map(([name, file]) => [name, read(file)]),
);

assert(sha256(migration) === canonicalMigrationSha256, "canonical role migration hash changed; review the new exact hash");
assertRoleMigration(migration);
assertEntrypoint(entrypoints.adminActions, "admin-actions");
assertEntrypoint(entrypoints.adminRetry, "admin-retry");

const selfTest = process.argv.includes("--self-test");
if (selfTest) {
  const sourceMutants = [
    ["admin-actions role resolver", entrypoints.adminActions, "resolveCurrentUserRole", "resolveCurrentUserRolE", "admin-actions"],
    ["admin-retry role resolver", entrypoints.adminRetry, "resolveCurrentUserRole", "resolveCurrentUserRolE", "admin-retry"],
  ];
  for (const [name, input, needle, replacement, label] of sourceMutants) {
    let rejected = false;
    try {
      assertEntrypoint(input.replaceAll(needle, replacement), label);
    } catch (error) {
      rejected = String(error).includes("ADMIN_ROLE_AUTH_SOURCE_CONTRACT_FAIL");
    }
    assert(rejected, `${name} mutant was not rejected`);
  }

  const migrationMutants = [
    ["caller binding", "(SELECT auth.uid())", "(SELECT NULL)"],
    ["role reader", "current_user_role()", "current_user_rolE()"],
    ["admin reader", "current_user_is_admin()", "current_user_is_admiN()"],
    ["fixed search path", "SET search_path = ''", "SET search_path = 'public'"],
    ["public revoke", "REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated", "REVOKE ALL ON TABLE public.user_roles FROM anon"],
    ["authenticated grant", "GRANT SELECT ON TABLE public.user_roles TO authenticated", "GRANT SELECT ON TABLE public.user_roles TO anon"],
    ["one-role primary key", "user_id uuid PRIMARY KEY", "user_id uuid NOT NULL"],
  ];
  for (const [name, needle, replacement] of migrationMutants) {
    let rejected = false;
    try {
      const mutant = migration.replaceAll(needle, replacement);
      assertRoleMigration(mutant);
    } catch (error) {
      rejected = String(error).includes("ADMIN_ROLE_AUTH_SOURCE_CONTRACT_FAIL");
    }
    assert(rejected, `${name} migration mutant was not rejected`);
  }
}

console.log(`ADMIN_ROLE_AUTH_SOURCE_CONTRACT_PASS migration=20260812100000_e10_preview_runtime_controls_and_roles.sql role=admin|read_only selfTest=${selfTest ? "pass" : "skipped"}`);
