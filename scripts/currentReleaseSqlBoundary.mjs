// Append-only September candidate. Historical E7/E10 inventory pins stay intact.
import {
  inventorySha256,
  buildSqlAssertionProbe,
  buildSqlAssertions,
} from "./e10SqlBoundary.mjs";
import { E7_EXPECTED_PG_META_IMAGE, E7_PG_META_COMMAND } from "./e7DisposableBoundary.mjs";

export const CURRENT_RELEASE_MIGRATION_COUNT = 137;
export const CURRENT_RELEASE_INVENTORY_SHA256 = "321c48bcc6258dabfae83c088a2d6286be0012de8f69cd275b0cf33f424aeeb5";
export const CURRENT_RELEASE_MIGRATION_VERSION = "20260907001640";
export const CURRENT_RELEASE_MIGRATION_NAME = "video_render_feedback_qualified_columns";
export const CURRENT_RELEASE_MIGRATION_SHA256 = "6a8dcb81934646a23dc7cf0f0e0dc19347594d945f1649eb94b1ffa8158218c8";
export const CURRENT_RELEASE_HARNESS_PATHS = Object.freeze([
  "scripts/run-current-release-sql-boundary.mjs", "scripts/currentReleaseSqlBoundary.mjs",
  "scripts/e10SqlBoundary.mjs", "scripts/e7DisposableBoundary.mjs",
  "scripts/current-release-schema-catalog.sql", "scripts/test-preview-video-render-feedback.sql",
]);

export function assertCurrentReleaseMigrationInventory(entries) {
  if (entries.length !== CURRENT_RELEASE_MIGRATION_COUNT) throw new Error(`current release migration count=${entries.length}`);
  const digest = inventorySha256(entries);
  if (digest !== CURRENT_RELEASE_INVENTORY_SHA256) throw new Error(`current release inventory SHA drifted: ${digest}`);
  const latest = entries.find((entry) => entry.version === CURRENT_RELEASE_MIGRATION_VERSION);
  if (!latest || latest.name !== CURRENT_RELEASE_MIGRATION_NAME || latest.sha256 !== CURRENT_RELEASE_MIGRATION_SHA256) {
    throw new Error("current release repair SHA or identity drifted");
  }
  return Object.freeze({ count: entries.length, sha256: digest, migration: latest });
}

export function buildCurrentReleaseSqlAssertionProbe() {
  return buildSqlAssertionProbe() + `
SELECT 'runtime_controls_safe_seed=' || (count(*) = 1 AND bool_and(
  singleton_id AND singleton_key AND environment = 'preview'
  AND posting_mode = 'blocked' AND NOT translation_enabled AND NOT dedupe_enabled
)) FROM public.runtime_controls;
SELECT 'activation_epochs_empty=' || (count(*) = 0) FROM public.runtime_activation_epochs;
`;
}

export const CURRENT_RELEASE_ASSERTION_ROWS = Object.freeze({
  runtime_controls_rows: "1",
  runtime_controls_safe_seed: "true",
  activation_epochs_empty: "true",
  enum_labels: "admin,read_only",
  user_roles_pk: "user_id",
  user_roles_id_unique: "true",
  rls_user_roles: "true",
  rls_runtime_controls: "true",
  table_grants: "true",
  rpc_grants: "true",
  role_functions_search_path: "true",
  update_rpc_security_definer: "true",
  update_rpc_search_path: "true",
});

export function assertCurrentReleaseAssertionRows(rows) {
  for (const [key, expected] of Object.entries(CURRENT_RELEASE_ASSERTION_ROWS)) {
    if (rows?.[key] !== expected) throw new Error(`current release SQL assertion failed: ${key}`);
  }
  if (Object.keys(rows).length !== Object.keys(CURRENT_RELEASE_ASSERTION_ROWS).length) {
    throw new Error("current release SQL assertion row set changed");
  }
  return true;
}

export function buildCurrentReleaseSqlAssertions() {
  // The August 25 bridge deliberately seeds one blocked Preview singleton and
  // changes this exact invariant error. Preserve every E10 negative assertion,
  // exercising its empty-table insert cases inside a rolled-back transaction.
  const historical = buildSqlAssertions();
  const oldMessage = "preview external posting is always blocked";
  if (historical.split(oldMessage).length !== 3) throw new Error("historical invariant assertion changed");
  return "BEGIN;\nDELETE FROM public.runtime_controls;\n"
    + historical.replaceAll(oldMessage, "preview runtime_controls must keep posting_mode=blocked")
    + "\nROLLBACK;";
}

// Docker may return the same mount records in a different array order. Retain
// every field and multiplicity; only the order of this unordered set is normalized.
export function normalizeMountInventory(mounts) {
  return [...mounts].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function assertCurrentTypeHelperOwnership(inspect, helper, databaseId) {
  if (!helper?.id || inspect?.Id !== helper.id || inspect?.Name?.replace(/^\//, "") !== helper.name) throw new Error("type helper ownership mismatch");
  if (inspect.Config?.Image !== E7_EXPECTED_PG_META_IMAGE || JSON.stringify(inspect.Config?.Cmd) !== JSON.stringify(E7_PG_META_COMMAND)) throw new Error("type helper image/command mismatch");
  if (inspect.Config?.Labels?.["xot.e10"] !== "disposable") throw new Error("type helper label mismatch");
  if (!/^[a-f0-9]{64}$/.test(databaseId ?? "") || inspect.HostConfig?.NetworkMode !== `container:${databaseId}`) throw new Error("type helper must share only the owned no-egress database namespace");
  if (Object.keys(inspect.NetworkSettings?.Networks ?? {}).length) throw new Error("type helper has an independent network");
  if ((inspect.Mounts ?? []).length || (inspect.HostConfig?.Binds ?? []).length || (inspect.HostConfig?.Mounts ?? []).length
    || Object.keys(inspect.HostConfig?.PortBindings ?? {}).length || Object.keys(inspect.NetworkSettings?.Ports ?? {}).length) throw new Error("type helper exposes mounts or ports");
  return helper.id;
}
