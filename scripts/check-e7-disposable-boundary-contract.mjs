import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const paths = {
  helper: join(root, "scripts/e7DisposableBoundary.mjs"),
  runner: join(root, "scripts/run-e7-disposable-boundary.mjs"),
  fixture: join(root, "scripts/e7-disposable-catalog-fixture.sql"),
  pure: join(root, "scripts/e7DisposableBoundary.test.mjs"),
  wrapper: join(root, "scripts/check-e7-disposable-boundary-contract.test.mjs"),
  package: join(root, "package.json"),
  workflow: join(root, ".github/workflows/ci.yml"),
};

function source(path) { return readFileSync(path, "utf8"); }
function fail(message) { throw new Error(`E7_DISPOSABLE_SOURCE_CONTRACT_FAIL ${message}`); }
function requireText(text, needle, label) { if (!text.includes(needle)) fail(`${label} missing ${needle}`); }
function reject(text, pattern, label) { if (pattern.test(text)) fail(`${label} contains forbidden ${pattern}`); }

function assertHelperContract(helper, pure) {
  for (const name of [
    "E7_CONTEXT", "E7_EXPECTED_IMAGE", "E7_EXPECTED_IMAGE_COMMAND", "E7_EXPECTED_PG_META_IMAGE", "E7_EXPECTED_PG_META_TAG", "E7_PG_META_COMMAND", "E7_EXPECTED_MIGRATION_COUNT",
    "E7_EXPECTED_INVENTORY_SHA256", "E7_NETWORK_ALIAS", "E7_EXPECTED_GENERATED_TYPES_SHA256", "E7_EXPECTED_GENERATED_TYPES_BYTES", "E7_EXPECTED_GENERATED_TYPES_LINES", "E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS", "inventorySha256", "normalizePortBindings",
    "parseCatalogSample", "redactDiagnostic", "splitSqlFixtureSections", "validateGeneratedTypes", "assertExpectedGeneratedTypesDigest", "buildTypesCaptureEnvelope", "parseTypesCaptureEnvelope", "parseGeneratedTypesStdoutCapture",
    "E7_PROTECTED_RAW_TABLES", "E7_NEGATIVE_UPDATE_COLUMNS", "E7_DISPOSABLE_PRELUDE", "classifyPermissionDenied", "buildNegativeProbeMatrix", "adoptInvocationMembers", "isInvocationAttributedPgMetaHelper", "reconcileInvocationGlobalMembers", "runBoundedProcess", "assertNoMountsOrPorts", "recordTaskResource", "assertRecordedNetwork", "assertRecordedContainer", "runCleanupPhases", "drainActiveChildren", "cleanupRecordedContainers", "maxBuffer", "maxInput",
    "detached: true", "stdio: [\"pipe\", \"pipe\", \"pipe\"]", "assertExactPgMetaImageInspect", "assertExactPgMetaContainerInspect", "assertStoppedHelperOwnership", "kind === \"helper\"", "helperCreated",
  ]) requireText(helper, name, "shared helper");
  reject(helper, /\^supabase(?:_|-)/, "shared ownership helper");
  reject(helper, /\|\|\s*true/, "shared ownership helper");
  const attributionGuard = helper.match(/function isInvocationAttributedPgMetaHelper\(member\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  if (!attributionGuard) fail("E7 attribution guard is missing");
  requireText(attributionGuard, 'labels["xot.e7"] === "disposable"', "E7 attribution guard");
  requireText(attributionGuard, "^xot-e7-disposable-pg-meta-", "E7 attribution guard");
  reject(attributionGuard, /com\.supabase\.cli|postgres-meta|member\.image|image\)/, "E7 attribution guard");
  for (const needle of [
    'E7_CONTEXT = "orbstack"',
    'E7_EXPECTED_IMAGE = "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459"',
    'E7_EXPECTED_IMAGE_COMMAND = Object.freeze(["postgres", "-D", "/etc/postgresql"])',
    'E7_EXPECTED_PG_META_IMAGE = "public.ecr.aws/supabase/postgres-meta@sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300"',
    'E7_EXPECTED_PG_META_TAG = "public.ecr.aws/supabase/postgres-meta:v0.96.6"',
    'E7_PG_META_COMMAND = Object.freeze(["node", "dist/server/server.js"])',
    'E7_EXPECTED_MIGRATION_COUNT = 123',
    'E7_EXPECTED_INVENTORY_SHA256 = "ed1bdf811e3e65828b55624064af64229733772cc8c68d759ddafb9a9c7a6e51"',
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    "CREATE ROLE anon NOLOGIN",
    "CREATE ROLE authenticated NOLOGIN",
    "CREATE ROLE service_role NOLOGIN",
    "CREATE SCHEMA IF NOT EXISTS auth",
    "CREATE SCHEMA IF NOT EXISTS storage",
    "CREATE TABLE IF NOT EXISTS storage.buckets",
    "CREATE TABLE IF NOT EXISTS storage.objects",
    "ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY",
    'video_renders: "updated_at"', 'video_render_feedback: "note"', 'video_renderer_heartbeats: "updated_at"', 'manual_video_intakes: "updated_at"',
  ]) requireText(helper, needle, "shared helper");
  if (!/ERROR:\\s\+42501:\[\^\\n\]\*permission denied/.test(helper)) fail("permission classifier is weak");
  requireText(pure, "catalog samples require exactly eight non-empty fields", "pure tests");
  requireText(pure, "fixture splitting is SQL-aware", "pure tests");
  requireText(pure, "global reconciliation ignores unrelated containers", "pure tests");
  requireText(pure, "generic-gen-types", "pure tests");
  requireText(pure, "generic-engine", "pure tests");
  requireText(pure, "generic-image", "pure tests");
  requireText(pure, "generated types stdout parser requires one envelope and a final runner PASS", "pure tests");
  requireText(pure, "E7_DISPOSABLE_BOUNDARY_ABORT signal=SIGTERM", "pure tests");
  if (!/E7_TYPES_BEGIN|buildTypesCaptureEnvelope/.test(helper)) fail("types envelope markers are missing");
  if (!/export function parseTypesCaptureEnvelope\(output\)/.test(helper)) fail("types envelope parser is missing");
  if (!/export function parseGeneratedTypesStdoutCapture\(output\)/.test(helper)) fail("stdout capture parser is missing");
  requireText(helper, "generated types stdout capture must contain exactly one envelope and final PASS", "stdout capture parser grammar");
  requireText(helper, "generated types stdout capture PASS boundary is invalid or not final", "stdout capture parser PASS boundary");
  requireText(helper, "assertCanonicalBase64(data)", "types envelope canonical encoding");
  requireText(helper, "Buffer.from(source, \"utf8\").toString(\"base64\") !== data", "types envelope roundtrip");
}

function assertRunnerContract(runner) {
  for (const needle of [
    'E7_CONTEXT,',
    'E7_EXPECTED_IMAGE,',
    'E7_EXPECTED_IMAGE_COMMAND,',
    'E7_EXPECTED_PG_META_IMAGE,',
    'E7_EXPECTED_PG_META_TAG,',
    'E7_PG_META_COMMAND,',
    'E7_EXPECTED_MIGRATION_COUNT,',
    'E7_EXPECTED_INVENTORY_SHA256,',
    '"--pull=never"',
    '"--internal"',
    '"--network-alias", E7_NETWORK_ALIAS',
    'networkId',
    'SUPABASE_TELEMETRY_DISABLED: "1"',
    'SUPABASE_UPDATE_DISABLED: "1"',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_PROJECT_REF',
    '"create", "--pull=never"',
    '"start", "-a", "--"',
    'PG_META_DB_URL=${dbUrl}',
    '"--env", "PGPASSWORD"',
    'PG_CONN_TIMEOUT_SECS=15',
    'PG_QUERY_TIMEOUT_SECS=15',
    'PG_META_GENERATE_TYPES=typescript',
    'PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
    'PG_META_GENERATE_TYPES_SWIFT_ACCESS_CONTROL=internal',
    'PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true',
    '"com.supabase.cli.engine=postgres-meta"',
    'com.supabase.cli.version=${E7_EXPECTED_SUPABASE_VERSION}',
    'assertNetworkMembersOnly()',
    'const cachedImage',
    'assertExactImageInspect(cachedImage)',
    'ownedNetworkMembers',
    'unknown network endpoint attached',
    'taskMkdtemp("xot-e7-supabase-")',
    'taskMkdtemp("xot-e7-version-")',
    'activeChildren',
    'taskTempDirectories',
    'terminateActiveChildren()',
    'cleanupTaskTempDirectories()',
    'runBoundedProcess',
    'input: options.input',
    'generateTypesWithOwnership',
    'globalContainerIds',
    'globalContainerMetadata',
    'reconcileInvocationGlobalMembers',
    'startedAt',
    'endedAt',
    'E7_EXPECTED_PG_META_IMAGE',
    'E7_EXPECTED_PG_META_TAG',
    'E7_PG_META_COMMAND',
    'for (const [index, migration] of migrations.entries())',
    'runRoleNegativeProbes',
    'buildNegativeProbeMatrix()',
    'classifyPermissionDenied(result)',
    'recordTaskResource',
    'recordTaskResource(resourceLedger, "helper"',
    'resourceLedger.helper',
    'helperCreated',
    'networkCreated',
    'databaseCreated',
    'runCleanupPhases',
    'drainActiveChildren',
    'assertRecordedNetwork',
    'assertRecordedContainer',
    'Health?.Status',
    'State?.StartedAt',
    'POSTGRES_PASSWORD',
    'PGPASSWORD',
    'PGPASSWORD: PASSWORD',
    'sslmode=disable',
    'allowEnvKeys: ["PGPASSWORD"]',
    '"-e", "POSTGRES_PASSWORD"',
    'safeChildEnv',
    'maxBuffer',
    'maxInput',
    'runPsql(fixture, "catalog-fixture")',
    'E7_DISPOSABLE_PRELUDE,',
    'E7_EMIT_TYPES_BASE64',
    'buildTypesCaptureEnvelope',
    'writeStdout(text)',
    'process.stdout.write(text, (error) =>',
    'await writeStdout(block)',
    'generatedTypes',
    'signalReceived',
    'E7_DISPOSABLE_BOUNDARY_ABORT signal=${signal}',
    'process.exitCode = 1',
    'void terminateActiveChildren()',
    'assertNoMountsOrPorts',
    'runPsql(E7_DISPOSABLE_PRELUDE, "prelude")',
    '"-c", "cron.database_name=postgres"',
    '"-c", "cron.launch_active_jobs=off"',
    'SHOW cron.database_name;',
    'SHOW cron.launch_active_jobs;',
    'try {',
    'finally {',
    'process.once(signal',
  ]) requireText(runner, needle, "runner");
  reject(runner, /--pull["']?,\s*["']always|--pull=always/i, "runner");
  reject(runner, /--network["']?,\s*["']none|--network=none/i, "runner");
  reject(runner, /--publish|--volume|--mount/, "runner");
  reject(runner, /POSTGRES_USER\s*=|POSTGRES_USER override|\"POSTGRES_USER\"/, "runner");
  reject(runner, /POSTGRES_PASSWORD=\$\{PASSWORD\}/, "runner");
  reject(runner, /postgresql:\/\/[^\s`]*:[^@\s`]+@/, "runner");
  reject(runner, /env:\s*process\.env\b/, "runner");
  reject(runner, /\bnpx\b|supabase\s+(?:link|start|db\s+push)|gen["']?,\s*["']types|--project-id|--local\b|--profile|--workdir|download/i, "runner");
  reject(runner, /execFile|promisify/, "runner");
  reject(runner, /await process\.stdout\.write|Promise\.resolve\(process\.stdout\.write|await writeStdout\(block\)\.then/, "runner");
  if (!/let stdoutWriteChain = Promise\.resolve\(\);[\s\S]*stdoutWriteChain = write\.catch\(\(\) => \{\}\);/.test(runner)) fail("stdout writes are not serialized");
  if ((runner.match(/E7_EXPECTED_MIGRATION_COUNT/g) ?? []).length < 2) fail("runner does not enforce migration count");
  if (!/inventorySha256\(migrations\)\s*!==\s*E7_EXPECTED_INVENTORY_SHA256/.test(runner)) fail("runner does not enforce migration inventory SHA");
  requireText(runner, ".filter((name) => /^\\d{14}_.+\\.sql$/.test(name)).sort()", "runner migration ordering");
  if ((runner.match(/applyMigrations\(\)/g) ?? []).length !== 2) fail("migration replay is not exactly once");
  if (!/const generated = result\.stdout/.test(runner) || !/return \{ source: generated, digest \}/.test(runner)) fail("generated types are not retained in memory");
  if (!/assertExpectedGeneratedTypesDigest\(generated\)/.test(runner)) fail("generated types expected digest is not asserted");
  if (!/version\.stdout\.trim\(\) !== E7_EXPECTED_SUPABASE_VERSION/.test(runner)) fail("Supabase CLI version is not exact equality checked");
  if (!/docker\(\[\"rm\", \"-f\", \"-v\",/.test(runner) || !/docker\(\[\"network\", \"rm\"/.test(runner)) fail("cleanup is incomplete");
  if (/try \{ await docker\(\[\"rm\", \"-f\", \"-v\", \"--\", CONTAINER/.test(runner)) fail("cleanup removes an unrecorded container name");
  if (!/assertInternalNetwork\(/.test(runner) || !/network\.Internal/.test(source(paths.helper))) fail("internal network identity is not asserted");
  if (!/recordTaskResource\(resourceLedger, "network", created\.stdout, NETWORK\)/.test(runner)) fail("network resource is not recorded before inspect");
  if (!/recordTaskResource\(resourceLedger, "container", created\.stdout, CONTAINER\)/.test(runner)) fail("database resource is not recorded before inspect");
  if (!/ownedNetworkMembers\.set\(resourceLedger\.container\.id/.test(runner)) fail("database ID is not ledgered before inspect");
  if (!/if \(resourceLedger\.container\?\.id\) ids\.add\(resourceLedger\.container\.id\)/.test(runner)) fail("recorded database ID is not included in cleanup set");
  if (!/cleanupRecordedContainers\(ids/.test(runner)) fail("exact recorded container cleanup is not attempted after validation failure");
  if ((runner.match(/assertRecordedNetwork\(network, resourceLedger\.network\)/g) ?? []).length < 2) fail("network identity is not guarded before cleanup and use");
  if (!/const errors = await runCleanupPhases\(cleanupPhases\)/.test(runner)) fail("cleanup phases short-circuit or are not aggregated");
  if (!/const ids = new Set\(ownedNetworkMembers\.keys\(\)/.test(runner)) fail("cleanup does not restrict removal to tracked task containers");
  if (!/assertNoMountsOrPorts\((?:inspection|details)\)/.test(runner)) fail("mount and port absence is not asserted");
  if (!/assertExactPgMetaContainerInspect\(helperInspection, resourceLedger\.helper, NETWORK\)/.test(runner)) fail("pg-meta helper is not validated before start");
  if (!/else if \(resourceLedger\.helper\?\.id === id\) assertExactPgMetaContainerInspect\(details, resourceLedger\.helper, NETWORK\)/.test(runner)) fail("pg-meta helper cleanup is not exact");
  if (!/if \(resourceLedger\.helper\?\.id\) ids\.add\(resourceLedger\.helper\.id\)/.test(runner)) fail("recorded pg-meta helper is not included in cleanup set");
  if (!/reconcileInvocationGlobalMembers\(\{[\s\S]*after: \[\.\.\.afterGlobal\.values\(\)\]/.test(runner)) fail("global container reconciliation is not metadata-based");
  if (!/assertStoppedHelperOwnership\(stoppedHelper, resourceLedger\.helper, NETWORK\)/.test(runner)) fail("stopped helper global ownership is not exact and re-inspected");
  if (/splitSqlFixtureSections\(fixture\)/.test(runner) || /for \(const \[index, section\] of splitSqlFixtureSections/.test(runner)) fail("fixture is split into multiple psql sessions");
  if (!/const cachedImage[\s\S]*assertExactImageInspect\(cachedImage\)[\s\S]*await docker\(\["run"/.test(runner)) fail("cached postgres image is not inspected before docker run");
  if (!/const cachedImage[\s\S]*assertExactPgMetaImageInspect\(cachedImage\)[\s\S]*await docker\(\[[\s\S]*"create"[\s\S]*E7_EXPECTED_PG_META_IMAGE/.test(runner)) fail("cached pg-meta image is not inspected before helper create");
  if (!/"create", "--pull=never", "--network", networkId/.test(runner)) fail("pg-meta helper is not attached to the exact internal task network");
  if (!/runPsql\(E7_DISPOSABLE_PRELUDE, "prelude"\)[\s\S]*applyMigrations\(\)/.test(runner)) fail("prelude is not executed before migrations");
  if ((runner.match(/runPsql\(E7_DISPOSABLE_PRELUDE/g) ?? []).length !== 1) fail("prelude execution is not exactly once");
  if ((runner.match(/cron\.database_name=postgres/g) ?? []).length !== 1 || (runner.match(/cron\.launch_active_jobs=off/g) ?? []).length !== 1) fail("cron launch hardening is not exact");
  if (!/E7_DISPOSABLE_BOUNDARY_CANDIDATE/.test(runner) || !/E7_DISPOSABLE_BOUNDARY_PASS/.test(runner) || !/pgMeta=\$\{E7_EXPECTED_PG_META_IMAGE\}/.test(runner) || !/pgMetaTag=\$\{E7_EXPECTED_PG_META_TAG\}/.test(runner)) fail("candidate/final pass sentinels are missing engine provenance");
  if (!/candidatePass && !cleanupError && unchanged/.test(runner)) fail("final pass does not depend on cleanup proof");
  if (!/candidatePass && !cleanupError && unchanged && !signalReceived/.test(runner)) fail("final pass does not depend on signal proof");
  if (/process\.exit\(1\)/.test(runner)) fail("signal handler exits before cleanup");
  if (!/await writeStdout\(block\);\s*if \(signalReceived\) process\.exitCode = 1;/.test(runner)) fail("final stdout write does not recheck signal state");
  if (!/candidatePass && !cleanupError && unchanged && !signalReceived/.test(runner)) fail("final pass does not depend on signal proof");
  if (!/emitTypesBase64 && emitTypesBase64 !== "1"/.test(runner)) fail("types capture opt-in is not exact");
}

function assertFixtureContract(fixture) {
  for (const needle of [
    "pg_attribute", "format_type", "pg_attrdef", "pg_get_expr", "pg_constraint", "pg_get_constraintdef", "pg_indexes", "indexdef", "pg_policies", "relrowsecurity",
    "aclexplode", "pg_default_acl", "prosecdef", "proconfig", "search_path=(\"\"|public(, ?pg_catalog)?$)", "fn.proowner IN", "trusted local owner", "pg_roles", "has_table_privilege", "SET LOCAL ROLE service_role", "BEGIN;", "ROLLBACK;",
    "video_renders", "video_render_feedback", "video_renderer_heartbeats", "manual_video_intakes",
    "media_objects", "webhook_receipts", "digest_runs", "jobs", "x_deliveries", "deliveries", "claim_telegram_delivery", "start_telegram_delivery", "complete_telegram_delivery", "mark_telegram_delivery_ambiguous", "deletion_token:uuid:no", "delivery_key:text:no", "provider_started_at:timestamp with time zone:no", "output_persisted_at:timestamp with time zone:no", "output_digest_id:uuid:no", "output_key:text:no",
    "Service role can manage video renders", "service-only fenced table", "RLS disabled for admin fenced table", "set_config('search_path', 'pg_catalog', true)", "exact admin policy missing", "qual=% with_check=%", "left(COALESCE(actual_qual, '<missing>'), 240)", "Admins can manage jobs", "Admins can manage x_deliveries", "Admins can manage deliveries", "private.has_role((SELECT auth.uid()AS uid),''admin''::public.app_role)", "authenticated'::name", "policyname IN ('Authenticated can view jobs', 'Authenticated can view x_deliveries'", "default_details", "string_agg", "LIMIT 20", "defaclrole=%s", "namespace=%s", "objtype=%s", "grantee=%s", "privilege_type=%s", "is_grantable=%s", "left(COALESCE(default_details, '<none>'), 1000)", "SETOF public.jobs", "SETOF public.video_renders", "deliveries_claim_state_check", "jobs_claim_state_check", "x_deliveries_claim_state_check", "idx_jobs_claim_expires_at", "idx_x_deliveries_claim_generation", "claim_state default drifted", "post_ids default drifted", "identity := format('public.%s'", "old unfenced X overload remains", "old unfenced video overload remains", "renderer database role exists",
  ]) requireText(fixture, needle, "SQL fixture");
  const serviceTables = "ARRAY['media_objects', 'webhook_receipts', 'digest_runs']";
  const adminTables = "ARRAY['jobs', 'x_deliveries', 'deliveries']";
  if ((fixture.match(new RegExp(serviceTables.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) fail("service-only table membership is not exact");
  if ((fixture.match(new RegExp(adminTables.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) fail("admin-console table membership is not exact");
  if (!/table_name text;[\s\S]*BEGIN\s+PERFORM set_config\('search_path', 'pg_catalog', true\);[\s\S]*FROM pg_policies/.test(fixture)) fail("admin policy lookup is not search-path canonicalized");
  if (!/expected_result text;[\s\S]*BEGIN\s+PERFORM set_config\('search_path', 'pg_catalog', true\);[\s\S]*pg_get_function_result\(fn\.oid\)/.test(fixture)) fail("RPC result-shape lookup is not search-path canonicalized");
  for (const needle of ["rls_enabled IS DISTINCT FROM true", "policy_count <> 1", "bad_default <> 0", "defaclnamespace = 'public'::regnamespace", "defaclobjtype IN ('r', 'S', 'f')", "renderer_role <> 0", "pg_get_function_result(fn.oid) <> expected_result", "has_function_privilege('anon', fn.oid, 'EXECUTE')", "has_function_privilege('service_role', fn.oid, 'EXECUTE')", "has_table_privilege('anon'", "to_regprocedure('public.complete_x_post_delivery", "to_regprocedure('public.renew_video_render_lease", "to_regprocedure('public.claim_video_renders(integer)') IS NOT NULL", "claim_video_render_by_id(NULL::uuid", "e7_fixture_counts"]) requireText(fixture, needle, "SQL fixture");
  for (const needle of ["_media_object_eligible(uuid,text,integer)|boolean", "claim_telegram_delivery(text,text,text,text,integer)|jsonb", "renew_video_render_lease(uuid,text,uuid,bigint,integer)|boolean", "complete_video_render(uuid,text,uuid,bigint,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb)|jsonb", "block_video_render(uuid,text,uuid,bigint,text,jsonb,jsonb)|jsonb", "fail_video_render(uuid,text,uuid,bigint,text,jsonb)|jsonb"]) requireText(fixture, needle, "SQL fixture RPC surface");
  reject(fixture, /line\s*parse|CREATE\s+TABLE\s+.*browser/i, "SQL fixture");
  if (/SELECT public\.claim_video_renders\(0/.test(fixture)) fail("positive video claim is not guaranteed zero-row");
  if (!/BEGIN;\s*SET LOCAL ROLE service_role;\s*DO \$\$[\s\S]*current_user <> 'service_role'[\s\S]*SELECT public\.media_objects_finalize_delete[\s\S]*ROLLBACK;/.test(fixture)) fail("positive service-role fenced call is not transactional or role asserted");
}

function assertPackageAndCiContract(packageJson, workflow) {
  const scripts = packageJson.scripts ?? {};
  if (scripts["check:e7-disposable-boundary"] !== "node scripts/check-e7-disposable-boundary-contract.mjs") fail("package source checker script is not registered");
  if (scripts["test:e7-disposable-boundary-contract"] !== "node --test scripts/check-e7-disposable-boundary-contract.test.mjs") fail("package mutation wrapper script is not registered");
  if (scripts["test:e7-disposable-boundary-pure"] !== "node --test scripts/e7DisposableBoundary.test.mjs") fail("package pure test script is not registered");
  if (scripts["test:e7-disposable-boundary"] !== "node scripts/run-e7-disposable-boundary.mjs") fail("package runtime runner script is not registered");
  if (scripts["test:run-e7-disposable-boundary"]) fail("redundant test:run-e7-disposable-boundary script is registered");
  requireText(workflow, "npm run check:e7-disposable-boundary", "CI");
  requireText(workflow, "npm run test:e7-disposable-boundary-contract", "CI");
  requireText(workflow, "npm run test:e7-disposable-boundary-pure", "CI");
  reject(workflow, /npm run test:e7-disposable-boundary(?:\s|$)/, "CI");
}

function assertContract(overrides = {}) {
  const helper = overrides.helper ?? source(paths.helper);
  const runner = overrides.runner ?? source(paths.runner);
  const fixture = overrides.fixture ?? source(paths.fixture);
  const pure = overrides.pure ?? source(paths.pure);
  const wrapper = overrides.wrapper ?? source(paths.wrapper);
  const packageJson = overrides.packageJson ?? JSON.parse(source(paths.package));
  const workflow = overrides.workflow ?? source(paths.workflow);
  assertHelperContract(helper, pure);
  assertRunnerContract(runner);
  assertFixtureContract(fixture);
  assertPackageAndCiContract(packageJson, workflow);
  requireText(wrapper, "MUTATION_TEST", "mutation wrapper");
}

const normalInputs = {
  helper: source(paths.helper), runner: source(paths.runner), fixture: source(paths.fixture),
  pure: source(paths.pure), wrapper: source(paths.wrapper), packageJson: JSON.parse(source(paths.package)), workflow: source(paths.workflow),
};

assertContract(normalInputs);

if (process.env.MUTATION_TEST === "1") {
  const mutations = [
    ["pull always", { runner: normalInputs.runner.replace('"--pull=never"', '"--pull=always"') }],
    ["non-internal network", { runner: normalInputs.runner.replace('"--internal"', '"--network", "none"') }],
    ["published port", { runner: normalInputs.runner.replace('"--network-alias", E7_NETWORK_ALIAS', '"--publish", "5432:5432", "--network-alias", E7_NETWORK_ALIAS') }],
    ["missing telemetry", { runner: normalInputs.runner.replace('SUPABASE_TELEMETRY_DISABLED: "1",', "") }],
    ["missing update disable", { runner: normalInputs.runner.replace('SUPABASE_UPDATE_DISABLED: "1"', "") }],
    ["missing stdin", { runner: normalInputs.runner.replace("input: options.input", "input: undefined") }],
    ["exec file regression", { runner: normalInputs.runner.replace("runBoundedProcess", "execFile") }],
    ["generic ownership adoption", { helper: normalInputs.helper.replace('label === "com.supabase.cli" && String(value) === "gen-types"', 'label === "com.supabase.cli" && String(value) === "gen-types" || /^supabase_/.test(String(member.name))') }],
    ["permission bypass", { runner: normalInputs.runner.replace("classifyPermissionDenied(result)", "true") }],
    ["stdout capture flag broadened", { runner: normalInputs.runner.replace('emitTypesBase64 && emitTypesBase64 !== "1"', 'emitTypesBase64') }],
    ["stdout capture before cleanup", { runner: normalInputs.runner.replace("candidatePass && !cleanupError && unchanged && !signalReceived", "candidatePass") }],
    ["stdout write replaced", { runner: normalInputs.runner.replace("await writeStdout(block)", "console.log(block)") }],
    ["stdout callback promise removed", { runner: normalInputs.runner.replace("process.stdout.write(text, (error) => error ? reject(error) : resolve());", "process.stdout.write(text); resolve();") }],
    ["stdout boolean awaited", { runner: normalInputs.runner.replace("await writeStdout(block)", "await process.stdout.write(block)") }],
    ["stdout abort boolean promise", { runner: normalInputs.runner.replace("signalAbortWrite = writeStdout(`E7_DISPOSABLE_BOUNDARY_ABORT signal=${signal}\\n`).catch(() => {});", "signalAbortWrite = Promise.resolve(process.stdout.write(`E7_DISPOSABLE_BOUNDARY_ABORT signal=${signal}\\n`));") }],
    ["stdout capture parser removed", { helper: normalInputs.helper.replace("export function parseGeneratedTypesStdoutCapture", "export function parseGeneratedTypesStdoutCapture_removed") }],
    ["signal exits immediately", { runner: normalInputs.runner.replace("void terminateActiveChildren();", "process.exit(1);") }],
    ["signal abort sentinel removed", { runner: normalInputs.runner.replace("signalAbortWrite = writeStdout(`E7_DISPOSABLE_BOUNDARY_ABORT signal=${signal}\\n`).catch(() => {});", "signalAbortWrite = Promise.resolve();") }],
    ["final write signal recheck removed", { runner: normalInputs.runner.replace("if (signalReceived) process.exitCode = 1;", "if (false) process.exitCode = 1;") }],
    ["types digest assertion removed", { runner: normalInputs.runner.replace("assertExpectedGeneratedTypesDigest(generated)", "validateGeneratedTypes(generated)") }],
    ["types envelope parser removed", { helper: normalInputs.helper.replace("export function parseTypesCaptureEnvelope", "export function parseTypesCaptureEnvelope_removed") }],
    ["types envelope canonical base64 removed", { helper: normalInputs.helper.replace("assertCanonicalBase64(data);", "void data;") }],
    ["fixture RLS disabled", { fixture: normalInputs.fixture.replace("IF rls_enabled IS DISTINCT FROM true", "IF rls_enabled IS DISTINCT FROM false") }],
    ["fixture browser policy", { fixture: normalInputs.fixture.replaceAll("policy_count <> 1", "policy_count < 0") }],
    ["fixture default grants", { fixture: normalInputs.fixture.replace("bad_default <> 0", "bad_default < 0") }],
    ["fixture renderer role", { fixture: normalInputs.fixture.replace("renderer_role <> 0", "renderer_role < 0") }],
    ["fixture old overload", { fixture: normalInputs.fixture.replace("to_regprocedure('public.claim_video_renders(integer)') IS NOT NULL", "to_regprocedure('public.claim_video_renders(integer)') IS NULL") }],
    ["fixture result shape", { fixture: normalInputs.fixture.replace("pg_get_function_result(fn.oid) <> expected_result", "pg_get_function_result(fn.oid) = expected_result") }],
    ["fixture browser execute", { fixture: normalInputs.fixture.replace("has_function_privilege('anon', fn.oid, 'EXECUTE') OR has_function_privilege('authenticated', fn.oid, 'EXECUTE')", "false") }],
    ["fixture permission transaction", { fixture: normalInputs.fixture.replace("BEGIN;\nSET LOCAL ROLE service_role;", "SET LOCAL ROLE service_role;") }],
    ["fixture unsafe search path", { fixture: normalInputs.fixture.replace("search_path=(\"\"|public(, ?pg_catalog)?$)", "search_path=.*") }],
    ["deletion token text", { fixture: normalInputs.fixture.replace("deletion_token:uuid:no", "deletion_token:text:no") }],
    ["omitted Telegram RPC", { fixture: normalInputs.fixture.replace("claim_telegram_delivery(text,text,text,text,integer)|jsonb", "claim_telegram_delivery_removed(text,text,text,text,integer)|jsonb") }],
    ["missing effective table privilege", { fixture: normalInputs.fixture.replaceAll("has_table_privilege('anon'", "has_table_privilege_removed('anon'") }],
    ["side effectful video claim", { fixture: normalInputs.fixture.replace("claim_video_render_by_id(NULL::uuid", "claim_video_renders(0, 'e7-fixture'::text); SELECT public.claim_video_render_by_id(NULL::uuid") }],
    ["lost trusted RPC owner", { fixture: normalInputs.fixture.replace("trusted local owner", "untrusted owner") }],
    ["inventory count", { helper: normalInputs.helper.replace("E7_EXPECTED_MIGRATION_COUNT = 123", "E7_EXPECTED_MIGRATION_COUNT = 122") }],
    ["missing prelude", { runner: normalInputs.runner.replace('runPsql(E7_DISPOSABLE_PRELUDE, "prelude")', 'runPsql("", "prelude")') }],
    ["prelude after migrations", { runner: normalInputs.runner.replace('await runPsql(E7_DISPOSABLE_PRELUDE, "prelude");\n    const cronDatabaseName', 'const cronDatabaseName').replace('migrations = await applyMigrations();', 'migrations = await applyMigrations();\n    await runPsql(E7_DISPOSABLE_PRELUDE, "prelude");') }],
    ["cron database setting changed", { runner: normalInputs.runner.replace('"cron.database_name=postgres"', '"cron.database_name=other"') }],
    ["cron launch setting changed", { runner: normalInputs.runner.replace('"cron.launch_active_jobs=off"', '"cron.launch_active_jobs=on"') }],
    ["mount guard bypass", { runner: normalInputs.runner.replaceAll("assertNoMountsOrPorts(details)", "assertNoHostPorts(inspection)") }],
    ["prelude object removed", { helper: normalInputs.helper.replace("CREATE TABLE IF NOT EXISTS storage.objects", "CREATE TABLE IF NOT EXISTS storage.missing_objects") }],
    ["missing early network ledger", { runner: normalInputs.runner.replace('recordTaskResource(resourceLedger, "network", created.stdout, NETWORK);', "") }],
    ["missing early database ledger", { runner: normalInputs.runner.replace('recordTaskResource(resourceLedger, "container", created.stdout, CONTAINER);', "") }],
    ["missing network identity guard", { runner: normalInputs.runner.replaceAll('assertRecordedNetwork(network, resourceLedger.network);', "") }],
    ["missing recorded database cleanup", { runner: normalInputs.runner.replace('if (resourceLedger.container?.id) ids.add(resourceLedger.container.id);', "") }],
    ["password in Supabase URL", { runner: normalInputs.runner.replace('postgresql://supabase_admin@', 'postgresql://supabase_admin:secret@') }],
    ["missing PGPASSWORD", { runner: normalInputs.runner.replace('PGPASSWORD: PASSWORD', 'PGPASSWORD_REMOVED: PASSWORD') }],
    ["missing pg-meta digest", { helper: normalInputs.helper.replace("a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300", "bad-pg-meta-digest") }],
    ["missing pg-meta tag", { helper: normalInputs.helper.replace("postgres-meta:v0.96.6", "postgres-meta:v0.96.5") }],
    ["missing pg-meta types env", { runner: normalInputs.runner.replace('"--env", "PG_META_GENERATE_TYPES=typescript",', '') }],
    ["missing pg-meta password env", { runner: normalInputs.runner.replace('"--env", "PGPASSWORD",', '') }],
    ["pg-meta host network", { runner: normalInputs.runner.replace('"create", "--pull=never", "--network", networkId', '"create", "--pull=never", "--network", "host"') }],
    ["CLI gen types invocation", { runner: normalInputs.runner.replace('"create", "--pull=never"', '"gen", "types"') }],
    ["missing early pg-meta ledger", { runner: normalInputs.runner.replace('recordTaskResource(resourceLedger, "helper", created.stdout, PG_META_CONTAINER);', '') }],
    ["missing pg-meta cleanup ledger", { runner: normalInputs.runner.replace('if (resourceLedger.helper?.id) ids.add(resourceLedger.helper.id);', '') }],
    ["global metadata reconciliation removed", { runner: normalInputs.runner.replace('    reconcileInvocationGlobalMembers({', '    reconcileInvocationGlobalMembers_removed({') }],
    ["global attribution guard broadened", { helper: normalInputs.helper.replace('|| /^xot-e7-disposable-pg-meta-/i.test(name);', '|| /^xot-e7-disposable-pg-meta-/i.test(name)\n    || true;') }],
    ["generic CLI label attribution", { helper: normalInputs.helper.replace('|| /^xot-e7-disposable-pg-meta-/i.test(name);', '|| /^xot-e7-disposable-pg-meta-/i.test(name)\n    || labels["com.supabase.cli"] === "gen-types";') }],
    ["generic engine attribution", { helper: normalInputs.helper.replace('|| /^xot-e7-disposable-pg-meta-/i.test(name);', '|| /^xot-e7-disposable-pg-meta-/i.test(name)\n    || labels["com.supabase.cli.engine"] === "postgres-meta";') }],
    ["generic image attribution", { helper: normalInputs.helper.replace('|| /^xot-e7-disposable-pg-meta-/i.test(name);', '|| /^xot-e7-disposable-pg-meta-/i.test(name)\n    || /postgres-meta/i.test(String(member?.image ?? ""));') }],
    ["missing stopped-helper reinspection", { runner: normalInputs.runner.replace('assertStoppedHelperOwnership(stoppedHelper, resourceLedger.helper, NETWORK);', '') }],
    ["unasserted service role", { fixture: normalInputs.fixture.replace("current_user <> 'service_role'", "current_user = 'service_role'") }],
    ["missing webhook provider column", { fixture: normalInputs.fixture.replaceAll("provider_started_at:timestamp with time zone:no", "provider_started_removed:timestamp with time zone:no") }],
    ["missing digest output column", { fixture: normalInputs.fixture.replace("output_persisted_at:timestamp with time zone:no", "output_persisted_removed:timestamp with time zone:no") }],
    ["delivery key wrongly not-null", { fixture: normalInputs.fixture.replace("delivery_key:text:no", "delivery_key:text:yes") }],
    ["service-only ACL loop weakened", { fixture: normalInputs.fixture.replaceAll("service-only fenced table", "fenced table") }],
    ["admin RLS disabled", { fixture: normalInputs.fixture.replace("RLS disabled for admin fenced table", "RLS check removed for admin fenced table") }],
    ["admin policy bypass", { fixture: normalInputs.fixture.replaceAll("public.app_role", "public.bad_role") }],
    ["authenticated view policy restored", { fixture: normalInputs.fixture.replace("Authenticated can view jobs", "Authenticated can view jobs removed") }],
    ["admin table moved to service-only", { fixture: normalInputs.fixture.replace("ARRAY['media_objects', 'webhook_receipts', 'digest_runs']", "ARRAY['media_objects', 'webhook_receipts', 'digest_runs', 'jobs']") }],
    ["admin table omitted", { fixture: normalInputs.fixture.replace("ARRAY['jobs', 'x_deliveries', 'deliveries']", "ARRAY['jobs', 'x_deliveries']") }],
    ["service and admin membership overlap", { fixture: normalInputs.fixture.replace("ARRAY['media_objects', 'webhook_receipts', 'digest_runs']", "ARRAY['media_objects', 'webhook_receipts', 'digest_runs', 'x_deliveries']") }],
    ["admin policy diagnostic removed", { fixture: normalInputs.fixture.replace("left(COALESCE(actual_qual, '<missing>'), 240)", "actual_qual") }],
    ["admin policy search path canonicalization removed", { fixture: normalInputs.fixture.replace("BEGIN\n  PERFORM set_config('search_path', 'pg_catalog', true);\n  FOREACH table_name", "BEGIN\n  FOREACH table_name") }],
    ["admin policy auth qualification removed", { fixture: normalInputs.fixture.replaceAll("auth.uid()AS uid", "uid()AS uid") }],
    ["admin policy app role qualification removed", { fixture: normalInputs.fixture.replaceAll("public.app_role", "app_role") }],
    ["default ACL diagnostic removed", { fixture: normalInputs.fixture.replace("left(COALESCE(default_details, '<none>'), 1000)", "default_details") }],
    ["RPC result-shape canonicalization removed", { fixture: normalInputs.fixture.replace("  expected_result text;\n  fn record;\nBEGIN\n  PERFORM set_config('search_path', 'pg_catalog', true);\n  FOREACH pair", "  expected_result text;\n  fn record;\nBEGIN\n  FOREACH pair") }],
    ["default ACL schema widened", { fixture: normalInputs.fixture.replaceAll("d.defaclnamespace = 'public'::regnamespace", "true") }],
    ["default ACL object types widened", { fixture: normalInputs.fixture.replaceAll("d.defaclobjtype IN ('r', 'S', 'f')", "true") }],
    ["generic negative update column", { helper: normalInputs.helper.replace('video_render_feedback: "note"', 'video_render_feedback: "updated_at"') }],
    ["fixture split replay", { runner: normalInputs.runner.replace('await runPsql(fixture, "catalog-fixture");', 'for (const section of splitSqlFixtureSections(fixture)) await runPsql(section, "catalog-fixture");') }],
    ["weak permission classifier", { helper: normalInputs.helper.replace("42501:[^\\n]*permission denied", "42501") }],
    ["cleanup short circuit", { runner: normalInputs.runner.replace('const errors = await runCleanupPhases(cleanupPhases);', 'const errors = await cleanupPhases[0][1]();') }],
    ["missing skillmap health", { runner: normalInputs.runner.replace('item?.State?.Health?.Status,', '') }],
  ];
  for (const [label, mutated] of mutations) {
    let rejected = false;
    try { assertContract({ ...normalInputs, ...mutated }); } catch (error) { rejected = String(error).includes("E7_DISPOSABLE_SOURCE_CONTRACT_FAIL"); }
    if (!rejected) fail(`mutation was accepted: ${label}`);
  }
}

console.log(`E7_DISPOSABLE_SOURCE_CONTRACT_PASS selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);

export { assertContract };
