import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  E7_EXPECTED_IMAGE,
  E7_EXPECTED_IMAGE_COMMAND,
  E7_EXPECTED_INVENTORY_SHA256,
  E7_EXPECTED_MIGRATION_COUNT,
  E7_EXPECTED_PG_META_IMAGE,
  E7_EXPECTED_PG_META_TAG,
  E7_PG_META_COMMAND,
  E7_NETWORK_ALIAS,
  E7_PROTECTED_RAW_TABLES,
  E7_NEGATIVE_UPDATE_COLUMNS,
  E7_EXPECTED_GENERATED_TYPES_SHA256,
  E7_EXPECTED_GENERATED_TYPES_BYTES,
  E7_EXPECTED_GENERATED_TYPES_LINES,
  E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS,
  adoptInvocationMembers,
  reconcileInvocationGlobalMembers,
  assertNoMountsOrPorts,
  assertExactPgMetaImageInspect,
  assertExactPgMetaContainerInspect,
  assertStoppedHelperOwnership,
  buildNegativeProbeMatrix,
  classifyPermissionDenied,
  inventorySha256,
  normalizePortBindings,
  parseCatalogSample,
  redactDiagnostic,
  sha256,
  splitSqlFixtureSections,
  validateGeneratedTypes,
  buildTypesCaptureEnvelope,
  parseTypesCaptureEnvelope,
  parseGeneratedTypesStdoutCapture,
  assertExpectedGeneratedTypesDigest,
  runBoundedProcess,
  recordTaskResource,
  assertRecordedNetwork,
  assertRecordedContainer,
  runCleanupPhases,
  drainActiveChildren,
  cleanupRecordedContainers,
  E7_DISPOSABLE_PRELUDE,
} from "./e7DisposableBoundary.mjs";

test("E7 constants preserve the disposable boundary", () => {
  assert.equal(E7_EXPECTED_IMAGE, "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459");
  assert.deepEqual(E7_EXPECTED_IMAGE_COMMAND, ["postgres", "-D", "/etc/postgresql"]);
  assert.equal(E7_EXPECTED_MIGRATION_COUNT, 123);
  assert.equal(E7_EXPECTED_PG_META_IMAGE, "public.ecr.aws/supabase/postgres-meta@sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300");
  assert.equal(E7_EXPECTED_PG_META_TAG, "public.ecr.aws/supabase/postgres-meta:v0.96.6");
  assert.deepEqual(E7_PG_META_COMMAND, ["node", "dist/server/server.js"]);
  assert.equal(E7_EXPECTED_INVENTORY_SHA256, "ed1bdf811e3e65828b55624064af64229733772cc8c68d759ddafb9a9c7a6e51");
  assert.equal(E7_NETWORK_ALIAS, "xotpg");
});

test("inventory hashing is deterministic and preserves order-independent catalog entries", () => {
  const entries = [
    { version: "20260101000002", name: "second.sql", sha256: "b".repeat(64) },
    { version: "20260101000001", name: "first.sql", sha256: "a".repeat(64) },
  ];
  assert.equal(
    inventorySha256(entries),
    sha256(JSON.stringify([
      { version: "20260101000001", name: "first.sql", sha256: "a".repeat(64) },
      { version: "20260101000002", name: "second.sql", sha256: "b".repeat(64) },
    ])),
  );
});

test("catalog samples require exactly eight non-empty fields", () => {
  const sample = "2026-08-11 01:02:03+00\tpostgres\tPostgreSQL 17\textensions\tplpgsql\t1\t10\t11";
  assert.deepEqual(parseCatalogSample(sample), {
    postmasterStartTime: "2026-08-11 01:02:03+00",
    currentDatabase: "postgres",
    serverVersion: "PostgreSQL 17",
    extensionsSchema: "extensions",
    plpgsqlExtension: "plpgsql",
    databaseOid: "1",
    postgresRoleOid: "10",
    supabaseAdminRoleOid: "11",
  });
  assert.throws(() => parseCatalogSample(sample.replace(/\t11$/, "")), /incomplete/);
  assert.throws(() => parseCatalogSample(`${sample}\textra`), /incomplete/);
});

test("port bindings ignore exposed-only ports but retain actual published ports", () => {
  assert.deepEqual(normalizePortBindings({ "5432/tcp": null, "8080/tcp": [] }), []);
  assert.equal(normalizePortBindings({ "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] }).length, 1);
});

test("fixture splitting is SQL-aware for quoted semicolons and dollar blocks", () => {
  const sections = splitSqlFixtureSections("SELECT ';';\nDO $$ BEGIN RAISE NOTICE 'x;y'; END $$;\nSELECT 2;");
  assert.equal(sections.length, 3);
});

test("diagnostics and generated types are bounded and redact secrets", () => {
  const diagnostic = redactDiagnostic("password=super-secret db_url=postgres://user:pass@example.test/a?token=abc");
  assert.doesNotMatch(diagnostic, /super-secret|user:pass|token=abc/);
  assert.ok(diagnostic.length < 700);
  assert.equal(validateGeneratedTypes("export type Database = { public: { Tables: {} } }\n"), true);
  assert.equal(validateGeneratedTypes(""), false);
  assert.equal(validateGeneratedTypes("export const nope = 1;"), false);
});

test("generated types enforce the independent expected digest and metadata", () => {
  assert.equal(E7_EXPECTED_GENERATED_TYPES_SHA256, "091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe");
  assert.equal(E7_EXPECTED_GENERATED_TYPES_BYTES, 102811);
  assert.equal(E7_EXPECTED_GENERATED_TYPES_LINES, 3325);
  assert.equal(E7_EXPECTED_GENERATED_TYPES_BASE64_CHARS, 137084);
  assert.throws(() => assertExpectedGeneratedTypesDigest("export type Database = {};"), /digest mismatch|implausible/);
});

test("types capture parser rejects reordered, duplicate, noncanonical, and post-END data", () => {
  const source = "export type Database = { public: { Tables: {} } };";
  const expected = "E7_DISPOSABLE_TYPES_BEGIN sha256=091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe bytes=102811 lines=3325 base64Chars=137084\nE7_DISPOSABLE_TYPES_DATA AAAA\nE7_DISPOSABLE_TYPES_END";
  assert.throws(() => parseTypesCaptureEnvelope(expected), /metadata|digest|roundtrip/);
  assert.throws(() => parseTypesCaptureEnvelope(`${expected}\nE7_DISPOSABLE_TYPES_END`), /exactly/);
  assert.throws(() => parseTypesCaptureEnvelope(expected.replace("E7_DISPOSABLE_TYPES_END", "E7_DISPOSABLE_TYPES_DATA AAAA\nE7_DISPOSABLE_TYPES_END")), /exactly|metadata|digest/);
  assert.throws(() => buildTypesCaptureEnvelope(source), /digest mismatch|implausible/);
});

test("generated types stdout parser requires one envelope and a final runner PASS", () => {
  const pass = "E7_DISPOSABLE_BOUNDARY_PASS image=public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459 pgMeta=public.ecr.aws/supabase/postgres-meta@sha256:a84cc713585eea7b401e4a2561ec4a1e48c87083d1c7ecb4502f204bb4391300 pgMetaTag=public.ecr.aws/supabase/postgres-meta:v0.96.6 context=orbstack migrations=123";
  const runnerShape = `E7_DISPOSABLE_TYPES_BEGIN sha256=091aa7e6634c17b795eea76ccfb8220ae441a2babde2507b07f5946754e87cfe bytes=102811 lines=3325 base64Chars=137084\nE7_DISPOSABLE_TYPES_DATA AAAA\nE7_DISPOSABLE_TYPES_END\n${pass}\n`;
  assert.throws(() => parseGeneratedTypesStdoutCapture(runnerShape), /metadata|digest|roundtrip/);
  for (const malformed of [
    runnerShape.replace(`${pass}\n`, `${pass}\n${pass}\n`),
    runnerShape.replace(`\n${pass}\n`, `\n${pass}\nE7_DISPOSABLE_BOUNDARY_ABORT signal=SIGTERM\n`),
    runnerShape.replace(`\n${pass}\n`, `\n${pass.replace("migrations=123", "migrations=122")}\n`),
  ]) assert.throws(() => parseGeneratedTypesStdoutCapture(malformed), /metadata|digest|roundtrip|exactly|PASS/);
});

test("bounded process runner writes stdin and settles timeout cleanup", async () => {
  const events = [];
  const fakeChild = new EventEmitter();
  fakeChild.pid = 777;
  fakeChild.stdin = {
    chunks: [],
    end(value) { this.chunks.push(value); events.push(`stdin:${value}`); },
  };
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.kill = (signal) => { events.push(`kill:${signal}`); fakeChild.emit("close", null, signal); };
  const result = await runBoundedProcess({
    file: "fake",
    args: ["--no-shell"],
    input: "SELECT 1;\n",
    timeout: 5,
    spawnImpl: () => fakeChild,
  });
  assert.equal(result.status, null);
  assert.deepEqual(events, ["stdin:SELECT 1;\n", "kill:SIGTERM"]);
});

test("bounded process runner enforces input/output limits and escalates SIGTERM to SIGKILL", async () => {
  const events = [];
  const fakeChild = new EventEmitter();
  fakeChild.pid = 778;
  fakeChild.stdin = { end(value) { events.push(`stdin:${value}`); } };
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.kill = (signal) => {
    events.push(`kill:${signal}`);
    if (signal === "SIGKILL") fakeChild.emit("close", null, signal);
  };
  const pending = runBoundedProcess({ file: "fake", input: "12345", maxInput: 4, spawnImpl: () => fakeChild });
  await assert.rejects(pending, /input exceeds maxInput/);

  const timedOut = runBoundedProcess({
    file: "fake", timeout: 2, spawnImpl: () => fakeChild,
    maxBuffer: 4,
    killImpl: (_pid, signal) => events.push(`group:${signal}`),
  });
  fakeChild.stdout.emit("data", "x".repeat(5),);
  await assert.rejects(timedOut, /stdout exceeds maxBuffer/);
  assert.ok(events.includes("group:SIGTERM"));
  assert.ok(events.includes("group:SIGKILL"));
});

test("bounded process runner converts stdin EPIPE into a settled failure", async () => {
  const child = new EventEmitter();
  child.pid = 780;
  child.stdin = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => child.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })));
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("close", 1, "SIGPIPE");
  await assert.rejects(runBoundedProcess({ file: "fake", input: "SELECT 1", spawnImpl: () => child }), /broken pipe/);
});

test("resource ledger records stdout before inspect and rejects incomplete ownership", () => {
  const ledger = { networkCreated: false, databaseCreated: false, helperCreated: false };
  recordTaskResource(ledger, "network", "network-id\n", "xot-e7-disposable-random");
  recordTaskResource(ledger, "container", "container-id\n", "xot-e7-disposable-random");
  recordTaskResource(ledger, "helper", "helper-id\n", "xot-e7-disposable-pg-meta-random");
  assert.equal(ledger.networkCreated, true);
  assert.equal(ledger.databaseCreated, true);
  assert.equal(ledger.helperCreated, true);
  assert.equal(ledger.network.id, "network-id");
  assert.throws(() => recordTaskResource(ledger, "network", "", "xot-e7-disposable-random"), /resource id/);
  assert.throws(() => assertRecordedNetwork({ Id: "other", Name: "xot-e7-disposable-random", Internal: true, Labels: { "xot.e7": "disposable" } }, ledger.network), /ownership/);
  assert.throws(() => assertRecordedContainer({ Id: "other", Name: "/xot-e7-disposable-random" }, ledger.container, "xot-e7-disposable-random"), /ownership/);
});

test("pg-meta image and helper ownership are exact and isolated", () => {
  const image = { RepoDigests: [E7_EXPECTED_PG_META_IMAGE], RepoTags: [E7_EXPECTED_PG_META_TAG], Config: { Cmd: E7_PG_META_COMMAND } };
  assert.doesNotThrow(() => assertExactPgMetaImageInspect(image));
  assert.throws(() => assertExactPgMetaImageInspect({ ...image, RepoTags: ["public.ecr.aws/supabase/postgres-meta:v0.96.5"] }), /tag/);
  const record = { id: "helper-id", name: "xot-e7-disposable-pg-meta-random" };
  const helper = {
    Id: record.id, Name: `/${record.name}`, Config: {
      Image: E7_EXPECTED_PG_META_IMAGE,
      Labels: { "xot.e7": "disposable", "com.supabase.cli": "gen-types", "com.supabase.cli.engine": "postgres-meta", "com.supabase.cli.version": "2.111.0" },
    },
    NetworkSettings: { Networks: { "xot-e7-disposable-random": {}, }, Ports: {} },
    HostConfig: { Binds: [], Mounts: [], PortBindings: {} }, Mounts: [],
  };
  assert.doesNotThrow(() => assertExactPgMetaContainerInspect(helper, record, "xot-e7-disposable-random"));
  assert.doesNotThrow(() => assertStoppedHelperOwnership({ ...helper, State: { Running: false } }, record, "xot-e7-disposable-random"));
  assert.throws(() => assertStoppedHelperOwnership({ ...helper, Id: "unrelated" }, record, "xot-e7-disposable-random"), /stopped helper ownership/);
  assert.throws(() => assertExactPgMetaContainerInspect({ ...helper, Config: { ...helper.Config, Labels: { ...helper.Config.Labels, "com.supabase.cli.engine": "wrong" } } }, record, "xot-e7-disposable-random"), /provenance/);
});

test("recorded database ID is removed even when post-run validation fails", async () => {
  const calls = [];
  const errors = await cleanupRecordedContainers(new Set(["db-created-id"]), {
    validate: async (id) => { calls.push(`validate:${id}`); throw new Error("mount validation failed"); },
    remove: async (id) => { calls.push(`remove:${id}`); },
  });
  assert.deepEqual(calls, ["validate:db-created-id", "remove:db-created-id"]);
  assert.equal(errors.length, 1);
});

test("cleanup phases aggregate failures and never short-circuit later ownership phases", async () => {
  const calls = [];
  const errors = await runCleanupPhases([
    ["children", async () => { calls.push("children"); throw new Error("child failure"); }],
    ["temp", async () => { calls.push("temp"); throw new Error("temp failure"); }],
    ["containers", async () => { calls.push("containers"); }],
    ["network", async () => { calls.push("network"); }],
  ]);
  assert.deepEqual(calls, ["children", "temp", "containers", "network"]);
  assert.deepEqual(errors.map(({ phase }) => phase), ["children", "temp"]);
});

test("active children drain with TERM, bounded wait, KILL, and close settlement", async () => {
  const events = [];
  let resolveClose;
  const child = { pid: 779, __e7ClosePromise: new Promise((resolve) => { resolveClose = resolve; }) };
  child.resolveClose = resolveClose;
  const active = new Set([child]);
  const drain = drainActiveChildren(active, {
    timeout: 2,
    termImpl: () => events.push("TERM"),
    killImpl: () => { events.push("KILL"); child.resolveClose(); },
  });
  await drain;
  assert.deepEqual(events, ["TERM", "KILL"]);
});

test("permission classifier requires SQLSTATE 42501", () => {
  assert.equal(classifyPermissionDenied({ stderr: "ERROR:  42501: permission denied for table video_renders" }), true);
  assert.equal(classifyPermissionDenied({ stderr: "ERROR:  42501: relation does not exist" }), false);
  assert.equal(classifyPermissionDenied({ stderr: "ERROR: relation does not exist" }), false);
  assert.equal(classifyPermissionDenied({ message: "syntax error at or near SELECT" }), false);
});

test("negative probe matrix covers CRUD for both browser roles on every raw table plus RPC denial", () => {
  const matrix = buildNegativeProbeMatrix();
  assert.equal(E7_PROTECTED_RAW_TABLES.length, 4);
  assert.equal(matrix.filter((probe) => probe.kind === "table").length, 32);
  assert.equal(matrix.filter((probe) => probe.kind === "rpc").length, 2);
  for (const table of E7_PROTECTED_RAW_TABLES) {
    for (const role of ["anon", "authenticated"]) {
      assert.deepEqual(
        matrix.filter((probe) => probe.kind === "table" && probe.table === table && probe.role === role).map((probe) => probe.operation).sort(),
        ["DELETE", "INSERT", "SELECT", "UPDATE"],
      );
      const update = matrix.find((probe) => probe.kind === "table" && probe.table === table && probe.role === role && probe.operation === "UPDATE");
      const column = E7_NEGATIVE_UPDATE_COLUMNS[table];
      assert.equal(update.statement, `UPDATE public.${table} SET ${column} = ${column} WHERE false;`);
    }
  }
});

test("network ownership adopts only invocation-attributed helper members", () => {
  const startedAt = "2026-08-11T10:00:00.000Z";
  const endedAt = "2026-08-11T10:00:05.000Z";
  const before = new Map([["db-id", { name: "xot-e7-disposable-db", image: "postgres", created: "2026-08-11T09:59:00.000Z" }]]);
  const after = [
    { id: "db-id", name: "xot-e7-disposable-db", image: "postgres", created: "2026-08-11T09:59:00.000Z", networks: ["xot-e7"] },
    { id: "helper-id", name: "supabase_cmd_123", image: "supabase/cli:2.111.0", created: "2026-08-11T10:00:02.000Z", networks: ["xot-e7"], labels: { "com.supabase.cli": "gen-types" } },
  ];
  const owned = adoptInvocationMembers({ before, after, startedAt, endedAt });
  assert.deepEqual([...owned.keys()], ["db-id", "helper-id"]);
  assert.throws(() => adoptInvocationMembers({
    before,
    after: [...after, { id: "unrelated-id", name: "supabase_unrelated", image: "supabase/cli:2.111.0", created: "2026-08-11T09:00:00.000Z", networks: ["xot-e7"], labels: { "com.supabase.cli": "other-run" } }],
    startedAt,
    endedAt,
  }), /unattributed/);
});

test("global reconciliation ignores unrelated containers but rejects an attributed detached helper", () => {
  const startedAt = "2026-08-11T10:00:00.000Z";
  const endedAt = "2026-08-11T10:00:05.000Z";
  const before = new Map([["db-id", { name: "xot-e7-disposable-db" }]]);
  const unrelated = {
    id: "f5ad-unrelated", name: "unrelated-worker", image: "redis:7",
    created: "2026-08-11T10:00:02.000Z", networks: ["bridge"], labels: {},
    Mounts: [], HostConfig: { Binds: [], Mounts: [], PortBindings: {} },
    NetworkSettings: { Ports: {} },
  };
  const helper = {
    id: "helper-id", name: "xot-e7-disposable-pg-meta-run",
    image: E7_EXPECTED_PG_META_IMAGE, created: "2026-08-11T10:00:02.000Z",
    networks: [], labels: {
      "xot.e7": "disposable", "com.supabase.cli": "gen-types",
      "com.supabase.cli.engine": "postgres-meta", "com.supabase.cli.version": "2.111.0",
    }, Mounts: [], HostConfig: { Binds: [], Mounts: [], PortBindings: {} },
    NetworkSettings: { Ports: {} },
  };
  const genericGenTypes = {
    ...unrelated, id: "generic-gen-types", name: "supabase_cmd_unrelated",
    labels: { "com.supabase.cli": "gen-types" },
  };
  const genericEngine = {
    ...unrelated, id: "generic-engine", name: "postgres-meta-unrelated",
    labels: { "com.supabase.cli.engine": "postgres-meta" },
  };
  const genericImage = {
    ...unrelated, id: "generic-image", name: "unrelated-worker",
    image: "public.ecr.aws/supabase/postgres-meta:latest", labels: {},
  };
  const owned = reconcileInvocationGlobalMembers({
    before,
    after: [unrelated, genericGenTypes, genericEngine, genericImage],
    startedAt, endedAt, networkName: "xot-e7-disposable-network",
  });
  assert.deepEqual([...owned.keys()], ["db-id"]);
  assert.throws(() => reconcileInvocationGlobalMembers({
    before, after: [unrelated, helper], startedAt, endedAt,
    networkName: "xot-e7-disposable-network",
  }), /network/);
  assert.throws(() => reconcileInvocationGlobalMembers({
    before, after: [{ ...helper, name: "generic-helper", labels: { "xot.e7": "disposable" } }],
    startedAt, endedAt, networkName: "xot-e7-disposable-network",
  }), /network/);
  assert.throws(() => reconcileInvocationGlobalMembers({
    before, after: [{ ...helper, labels: {}, networks: [] }],
    startedAt, endedAt, networkName: "xot-e7-disposable-network",
  }), /network/);
});

test("E7 prelude contains the E6-equivalent disposable catalog bootstrap", () => {
  for (const needle of [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    "CREATE ROLE anon NOLOGIN",
    "CREATE ROLE authenticated NOLOGIN",
    "CREATE ROLE service_role NOLOGIN",
    "CREATE SCHEMA IF NOT EXISTS auth",
    "CREATE TABLE IF NOT EXISTS auth.users",
    "CREATE OR REPLACE FUNCTION auth.uid()",
    "CREATE OR REPLACE FUNCTION auth.role()",
    "CREATE SCHEMA IF NOT EXISTS storage",
    "CREATE TABLE IF NOT EXISTS storage.buckets",
    "CREATE TABLE IF NOT EXISTS storage.objects",
    "ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY",
  ]) assert.match(E7_DISPOSABLE_PRELUDE, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("mount and port inspection rejects configured or active bindings", () => {
  assert.doesNotThrow(() => assertNoMountsOrPorts({ Mounts: [], HostConfig: { Binds: [], Mounts: [], PortBindings: {} }, NetworkSettings: { Ports: {} } }));
  assert.throws(() => assertNoMountsOrPorts({ Mounts: [{ Type: "volume" }], HostConfig: { Binds: [], Mounts: [], PortBindings: {} }, NetworkSettings: { Ports: {} } }), /mount/);
  assert.throws(() => assertNoMountsOrPorts({ Mounts: [], HostConfig: { Binds: [], Mounts: [], PortBindings: { "5432/tcp": [{ HostPort: "5432" }] } }, NetworkSettings: { Ports: {} } }), /port/);
});
