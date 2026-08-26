import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import {
  AppRoleError,
  parseAppRole,
  requireAdmin,
  requireReadOnlyRead,
  resolveCurrentUserRole,
} from "./appRole.ts";
import {
  RuntimeControlsError,
  fetchRuntimeControls,
  isDedupePaused,
  isTranslationPaused,
} from "./runtimeControls.ts";
import {
  checkExternalPosting,
  ExternalPostingBlockedError,
  requireExternalPosting,
} from "./externalPostingGuard.ts";

const PREVIEW_CONTROLS = {
  singleton_id: true,
  environment: "preview",
  dedupe_enabled: false,
  translation_enabled: false,
  posting_mode: "blocked",
  updated_at: "2026-08-12T12:00:00.000Z",
  updated_by: null,
} as const;

const PRODUCTION_CONTROLS = {
  singleton_id: true,
  environment: "production",
  dedupe_enabled: true,
  translation_enabled: true,
  posting_mode: "enabled",
  updated_at: "2026-08-12T12:00:00.000Z",
  updated_by: "00000000-0000-4000-8000-000000000001",
} as const;

function rpcClient(data: unknown, error: unknown = null) {
  return { rpc: () => Promise.resolve({ data, error }) };
}

function controlsClient(rows: unknown[], error: unknown = null) {
  return {
    from: () => ({
      select: () => Promise.resolve({ data: rows, error }),
    }),
  };
}

Deno.test("app roles accept only admin and read_only literals", () => {
  assertEquals(parseAppRole("admin"), "admin");
  assertEquals(parseAppRole("read_only"), "read_only");
  assertEquals(parseAppRole("viewer"), null);
  assertEquals(parseAppRole("operator"), null);
  assertEquals(parseAppRole(null), null);
  assertEquals(parseAppRole({ role: "admin" }), null);
});

Deno.test("role resolution denies missing, unknown, malformed, and failed RPC results", async () => {
  assertEquals(await resolveCurrentUserRole(rpcClient("admin")), "admin");
  assertEquals(await resolveCurrentUserRole(rpcClient("read_only")), "read_only");
  assertEquals(await resolveCurrentUserRole(rpcClient(null)), null);
  assertEquals(await resolveCurrentUserRole(rpcClient("viewer")), null);
  assertEquals(await resolveCurrentUserRole(rpcClient({ role: "admin" })), null);
  assertEquals(await resolveCurrentUserRole(rpcClient("admin", new Error("db unavailable"))), null);
});

Deno.test("admin and read-only read guards enforce the canonical role policy", async () => {
  assertEquals(await requireAdmin(rpcClient("admin")), "admin");
  await assertRejects(
    () => requireAdmin(rpcClient("read_only")),
    AppRoleError,
    "admin role required",
  );
  await assertRejects(
    () => requireAdmin(rpcClient("viewer")),
    AppRoleError,
    "admin role required",
  );
  assertEquals(await requireReadOnlyRead(rpcClient("admin")), "admin");
  assertEquals(await requireReadOnlyRead(rpcClient("read_only")), "read_only");
  await assertRejects(
    () => requireReadOnlyRead(rpcClient(null)),
    AppRoleError,
    "read-only role required",
  );
});

Deno.test("runtime controls require exactly one valid row", async () => {
  assertEquals(await fetchRuntimeControls(controlsClient([PREVIEW_CONTROLS])), PREVIEW_CONTROLS);
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([])),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([PREVIEW_CONTROLS, PREVIEW_CONTROLS])),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([{ ...PREVIEW_CONTROLS, posting_mode: "enabled" }])),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([{
      ...PREVIEW_CONTROLS,
      posting_mode: "enabled",
      dedupe_enabled: true,
      translation_enabled: true,
    }])),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([PREVIEW_CONTROLS], new Error("read failed"))),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
  await assertRejects(
    () => fetchRuntimeControls(controlsClient([{
      ...PREVIEW_CONTROLS,
      updated_at: "not-a-date",
    }])),
    RuntimeControlsError,
    "runtime controls unavailable",
  );
});

Deno.test("runtime controls read the canonical columns from a branched schema", async () => {
  let selectedColumns = "";
  const client = {
    from: () => ({
      select: (columns: string) => {
        selectedColumns = columns;
        return Promise.resolve({
          data: [columns === "*" ? { ...PREVIEW_CONTROLS, singleton_key: "preview" } : PREVIEW_CONTROLS],
          error: null,
        });
      },
    }),
  };

  assertEquals(await fetchRuntimeControls(client), PREVIEW_CONTROLS);
  assertEquals(
    selectedColumns,
    "singleton_id, environment, dedupe_enabled, translation_enabled, posting_mode, updated_at, updated_by",
  );
});

Deno.test("pause decisions are typed and fail closed from control values", async () => {
  const preview = await fetchRuntimeControls(controlsClient([PREVIEW_CONTROLS]));
  assertEquals(isDedupePaused(preview), true);
  assertEquals(isTranslationPaused(preview), true);
  const production = await fetchRuntimeControls(controlsClient([PRODUCTION_CONTROLS]));
  assertEquals(isDedupePaused(production), false);
  assertEquals(isTranslationPaused(production), false);
});

Deno.test("Preview is blocked before a provider call, even with hostile enabled controls", async () => {
  let providerCalls = 0;
  const result = await checkExternalPosting(
    controlsClient([{ ...PREVIEW_CONTROLS, posting_mode: "enabled" }]),
    { environment: "preview", allowExternalPosting: "true" },
  );
  if (result.allowed) providerCalls += 1;
  assertEquals(result.allowed, false);
  assertEquals(providerCalls, 0);
  if (!result.allowed) assertEquals(result.code, "external_posting_blocked");

  const mismatched = await checkExternalPosting(
    controlsClient([{ ...PRODUCTION_CONTROLS, posting_mode: "enabled" }]),
    { environment: "preview", allowExternalPosting: "true" },
  );
  assertEquals(mismatched.allowed, false);
  if (mismatched.code === "external_posting_blocked") assertEquals(mismatched.reason, "environment_mismatch");
});

Deno.test("production requires the exact environment, env breaker, and enabled control", async () => {
  const allowed = await checkExternalPosting(
    controlsClient([PRODUCTION_CONTROLS]),
    { environment: "production", allowExternalPosting: "true" },
  );
  assertEquals(allowed, { allowed: true, code: "external_posting_allowed" });

  const missingEnvFlag = await checkExternalPosting(
    controlsClient([PRODUCTION_CONTROLS]),
    { environment: "production", allowExternalPosting: undefined },
  );
  assertEquals(missingEnvFlag.allowed, false);
  if (missingEnvFlag.code === "external_posting_blocked") assertEquals(missingEnvFlag.reason, "environment_breaker");

  const blockedDb = await checkExternalPosting(
    controlsClient([{ ...PRODUCTION_CONTROLS, posting_mode: "blocked" }]),
    { environment: "production", allowExternalPosting: "true" },
  );
  assertEquals(blockedDb.allowed, false);
  if (blockedDb.code === "external_posting_blocked") assertEquals(blockedDb.reason, "database_control");

  const malformed = await checkExternalPosting(
    controlsClient([PRODUCTION_CONTROLS]),
    { environment: "staging", allowExternalPosting: "true" },
  );
  assertEquals(malformed.allowed, false);
  if (malformed.code === "external_posting_blocked") assertEquals(malformed.reason, "invalid_environment");
});

Deno.test("posting guard exposes a stable error with no payload or secrets", async () => {
  await assertRejects(
    () => requireExternalPosting(
      controlsClient([PREVIEW_CONTROLS]),
      { environment: "preview", allowExternalPosting: "true" },
    ),
    ExternalPostingBlockedError,
    "external posting is blocked",
  );
  try {
    await requireExternalPosting(
      controlsClient([PREVIEW_CONTROLS]),
      { environment: "preview", allowExternalPosting: "true" },
    );
  } catch (error) {
    assert(error instanceof ExternalPostingBlockedError);
    assertEquals((error as ExternalPostingBlockedError).code, "external_posting_blocked");
    assertEquals((error as ExternalPostingBlockedError).reason, "preview_environment");
    assertStringIncludes(error.message, "external posting is blocked");
    assert(!error.message.includes("story"));
    assert(!error.message.includes("secret"));
  }
});

Deno.test("E10 foundation migration declares canonical roles, RLS, grants, and posting invariants", async () => {
  const migrationUrl = new URL("../../migrations/20260812100000_e10_preview_runtime_controls_and_roles.sql", import.meta.url);
  const sql = await Deno.readTextFile(migrationUrl);
  for (const literal of [
    "ALTER TYPE public.app_role RENAME VALUE 'viewer' TO 'read_only'",
    "user_id uuid PRIMARY KEY",
    "ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id)",
    "id uuid NOT NULL DEFAULT gen_random_uuid()",
    "ADD CONSTRAINT user_roles_id_key UNIQUE (id)",
    "contype IN ('p', 'u')",
    "DROP CONSTRAINT %I",
    "CREATE TABLE IF NOT EXISTS public.runtime_controls",
    "CHECK (singleton_id)",
    "posting_mode IN ('blocked', 'enabled')",
    "CREATE TRIGGER runtime_controls_invariants",
    "posting_mode <> 'blocked'",
    "ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.runtime_controls ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated",
    "GRANT SELECT ON TABLE public.user_roles TO authenticated",
    "REVOKE ALL ON TABLE public.runtime_controls FROM PUBLIC, anon, authenticated",
    "GRANT SELECT ON TABLE public.runtime_controls TO authenticated",
    "REVOKE ALL ON FUNCTION public.update_runtime_controls(boolean, boolean) FROM PUBLIC, anon",
    "GRANT EXECUTE ON FUNCTION public.update_runtime_controls(boolean, boolean) TO authenticated",
    "SET search_path = ''",
    "(SELECT auth.uid())",
  ]) {
    assertStringIncludes(sql, literal, `missing SQL contract: ${literal}`);
  }
  assertStringIncludes(sql, "This shared migration creates zero runtime_controls rows");
  assertStringIncludes(sql, "Staging provisioning inserts exactly one explicit preview row");
  assertStringIncludes(sql, "Production provisioning inserts one explicit production row");
  assert(!/\bINSERT\s+INTO\s+public\.runtime_controls\b/i.test(sql));
  assert(!sql.includes("user_metadata"));
  assert(!sql.includes("CREATE SCHEMA auth"));
  assert(!sql.includes("CREATE SCHEMA storage"));
  assert(!sql.includes("CREATE SCHEMA realtime"));
});
