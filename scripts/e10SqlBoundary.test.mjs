import assert from "node:assert/strict";
import test from "node:test";

import {
  E10_CONTEXT,
  E10_EXPECTED_IMAGE,
  E10_EXPECTED_IMAGE_COMMAND,
  E10_EXPECTED_INVENTORY_SHA256,
  E10_EXPECTED_MIGRATION_COUNT,
  E10_EXPECTED_MIGRATION_SHA256,
  E10_CONTAINER_PREFIX,
  E10_LABEL_KEY,
  E10_LABEL_VALUE,
  E10_INIT_COMPLETE_MARKER,
  E10_DISPOSABLE_PRELUDE,
  buildMigrationInventory,
  inventorySha256,
  buildDockerCreateArgs,
  buildDockerInvocation,
  makeContainerName,
  safeChildEnv,
  redactDiagnostic,
  parseAssertionRows,
  assertExpectedAssertionRows,
  buildSqlAssertionProbe,
  assertContainerOwnership,
  compareResourceInventories,
  buildMutationCases,
  buildSqlAssertions,
  validateContainerId,
  recoverCidfileId,
  parseAssertionPass,
  cleanupDecision,
  cleanupRecordedContainer,
  canEmitSuccess,
  runBoundedProcess,
  drainActiveChildren,
} from "./e10SqlBoundary.mjs";
import { EventEmitter } from "node:events";

test("E10 constants bind the exact image, context, inventory, and migration", () => {
  assert.equal(E10_CONTEXT, "orbstack");
  assert.equal(E10_EXPECTED_IMAGE, "public.ecr.aws/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459");
  assert.deepEqual(E10_EXPECTED_IMAGE_COMMAND, ["postgres", "-D", "/etc/postgresql"]);
  assert.equal(E10_EXPECTED_MIGRATION_COUNT, 129);
  assert.equal(E10_EXPECTED_INVENTORY_SHA256, "6953713d9eaee2bc00a4a0b38f9fbdb28233a7adfcc205674bda1ff0d8c29a77");
  assert.equal(E10_EXPECTED_MIGRATION_SHA256, "66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7");
  assert.equal(E10_CONTAINER_PREFIX, "xot-e10-sql-");
  assert.equal(E10_LABEL_KEY, "xot.e10");
  assert.equal(E10_LABEL_VALUE, "disposable");
  assert.equal(E10_INIT_COMPLETE_MARKER, "PostgreSQL init process complete; ready for start up.");
  assert.match(E10_DISPOSABLE_PRELUDE, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
});

test("migration inventory uses the version and filename stem and is order independent", () => {
  const entries = buildMigrationInventory([
    { file: "20260102000000_second.sql", sha256: "b".repeat(64) },
    { file: "20260101000000_first.sql", sha256: "a".repeat(64) },
  ]);
  assert.deepEqual(entries, [
    { version: "20260101000000", name: "first", sha256: "a".repeat(64) },
    { version: "20260102000000", name: "second", sha256: "b".repeat(64) },
  ]);
  assert.equal(inventorySha256(entries), inventorySha256([...entries].reverse()));
  assert.throws(() => buildMigrationInventory([{ file: "bad.sql", sha256: "a" }]), /migration filename/);
});

test("container arguments are exact, detached from host ports and mounts", () => {
  const name = "xot-e10-sql-test123";
  assert.deepEqual(buildDockerCreateArgs(name, "/tmp/xot-e10-sql.cid"), [
    "create", "--pull=never", "--cidfile", "/tmp/xot-e10-sql.cid", "--network", "none", "--label", "xot.e10=disposable",
    "--name", name, "--env", "POSTGRES_PASSWORD", E10_EXPECTED_IMAGE,
    ...E10_EXPECTED_IMAGE_COMMAND,
  ]);
  assert.deepEqual(buildDockerInvocation(["inspect", name]), ["--context", "orbstack", "inspect", name]);
  assert.match(makeContainerName("abc"), /^xot-e10-sql-abc$/);
  assert.throws(() => buildDockerCreateArgs("other-container"), /prefix/);
});

test("cidfile recovery accepts one Docker ID and rejects missing, duplicate, or malformed content", async () => {
  assert.equal(validateContainerId(`${"a".repeat(64)}\n`), "a".repeat(64));
  assert.throws(() => validateContainerId(`${"a".repeat(64)}\n${"b".repeat(64)}`), /one container ID/);
  assert.equal(await recoverCidfileId("cid", { readFileImpl: async () => `${"b".repeat(64)}\n` }), "b".repeat(64));
  assert.equal(await recoverCidfileId("missing", { readFileImpl: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), null);
});

test("child environment is minimal and does not inherit arbitrary secrets", () => {
  const env = safeChildEnv({ PATH: "/bin", HOME: "/tmp", SECRET_TOKEN: "do-not-copy", POSTGRES_PASSWORD: "pw" }, { POSTGRES_PASSWORD: "generated" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/tmp", POSTGRES_PASSWORD: "generated" });
  assert.equal(env.SECRET_TOKEN, undefined);
});

test("diagnostics are bounded and redact URLs, bearer tokens, and credentials", () => {
  const result = redactDiagnostic(`postgres://user:pw@example.test/db token=secret Bearer ${"x".repeat(64)} ${"y".repeat(800)}`);
  assert.doesNotMatch(result, /user:pw|token=secret|Bearer x{64}/);
  assert.ok(result.length <= 641);
});

test("SQL assertion output parser rejects malformed, duplicate, and secret-bearing rows", () => {
  const rows = parseAssertionRows("runtime_controls_rows=0\nenum_labels=admin,read_only\nuser_roles_pk=user_id\nuser_roles_id_unique=true\nrls_user_roles=true\nrls_runtime_controls=true\ntable_grants=true\nrpc_grants=true\nrole_functions_search_path=true\nupdate_rpc_security_definer=true\nupdate_rpc_search_path=true\n");
  assert.equal(rows.runtime_controls_rows, "0");
  assert.equal(rows.enum_labels, "admin,read_only");
  assert.equal(rows.rls_user_roles, "true");
  assert.equal(rows.rls_runtime_controls, "true");
  assert.throws(() => parseAssertionRows("runtime_controls_rows=0\nruntime_controls_rows=1\n"), /duplicate/);
  assert.throws(() => parseAssertionRows("not-a-row"), /row/);
  assert.throws(() => parseAssertionRows("password=secret\n"), /sensitive/);
  assertExpectedAssertionRows(rows);
  assert.throws(() => assertExpectedAssertionRows({ ...rows, enum_labels: "admin,viewer" }), /enum/);
});

test("container ownership requires the recorded exact id, name, label, none network, and no resources", () => {
  const inspect = {
    Id: "a".repeat(64),
    Name: "/xot-e10-sql-test123",
    Config: { Image: E10_EXPECTED_IMAGE, Cmd: E10_EXPECTED_IMAGE_COMMAND, Labels: { "xot.e10": "disposable" } },
    HostConfig: { NetworkMode: "none", Binds: [], Mounts: [], PortBindings: {} },
    Mounts: [],
    NetworkSettings: { Ports: {}, Networks: { none: {} } },
  };
  assert.equal(assertContainerOwnership(inspect, { id: inspect.Id, name: "xot-e10-sql-test123" }), inspect.Id);
  for (const mutated of [
    { ...inspect, Id: "b".repeat(64) },
    { ...inspect, Name: "/wrong" },
    { ...inspect, Config: { ...inspect.Config, Labels: {} } },
    { ...inspect, NetworkSettings: { Ports: {}, Networks: { bridge: {} } } },
    { ...inspect, Mounts: [{ Source: "/tmp" }] },
  ]) assert.throws(() => assertContainerOwnership(mutated, { id: inspect.Id, name: "xot-e10-sql-test123" }));
});

test("resource comparison covers skillmap identity/state and exact xot-e10 inventory", () => {
  const before = {
    skillmap: [{ id: "skill-id", name: "supabase_demo_skillmap", state: "running" }],
    xotE10: { containers: [], volumes: [], networks: [] },
  };
  assert.equal(compareResourceInventories(before, structuredClone(before)), true);
  assert.equal(compareResourceInventories(before, { ...structuredClone(before), skillmap: [{ ...before.skillmap[0], state: "exited" }] }), false);
  assert.equal(compareResourceInventories(before, { ...structuredClone(before), xotE10: { containers: ["new"], volumes: [], networks: [] } }), false);
});

test("mutation cases cover preview invariant, singleton duplication, and role uniqueness", () => {
  const cases = buildMutationCases();
  assert.deepEqual(Object.keys(cases), ["previewInsertBlocked", "previewUpdateBlocked", "previewSingletonInsert", "duplicateSingletonRejected", "roleUniqueness"]);
  for (const [name, sql] of Object.entries(cases)) {
    if (name !== "previewSingletonInsert") assert.match(sql, /BEGIN|DO \$\$/);
  }
  assert.match(cases.previewInsertBlocked, /posting_mode[\s\S]*enabled/i);
  assert.match(cases.roleUniqueness, /read_only.*admin|admin.*read_only/is);
});

test("SQL assertion bundle is offline and includes each E10 acceptance invariant", () => {
  const sql = buildSqlAssertions();
  assert.match(buildSqlAssertionProbe(), /runtime_controls_rows/);
  assert.doesNotMatch(sql, /http|fetch|curl|wget|supabase\.co/i);
  for (const needle of [
    "runtime_controls", "admin", "read_only", "user_roles_pk", "relrowsecurity",
    "has_table_privilege", "has_function_privilege", "search_path", "SECURITY DEFINER",
    "posting_mode", "duplicate singleton", "admin/read_only uniqueness", "E10_SQL_ASSERTION_PASS",
  ]) assert.match(sql, new RegExp(needle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "i"));
});

test("strict mutation sentinel parser accepts one final line and rejects duplicates or post-data", () => {
  assert.equal(parseAssertionPass("row=true\nE10_SQL_ASSERTION_PASS\n"), "E10_SQL_ASSERTION_PASS");
  assert.throws(() => parseAssertionPass("E10_SQL_ASSERTION_PASS\nE10_SQL_ASSERTION_PASS\n"), /count=2/);
  assert.throws(() => parseAssertionPass("E10_SQL_ASSERTION_PASS\npost-data\n"), /not final/);
});

test("cleanup state machine never removes without an exact recorded ID and ownership proof", () => {
  assert.deepEqual(cleanupDecision({}), { remove: false, reason: "no-recorded-id" });
  assert.deepEqual(cleanupDecision({ id: "a".repeat(64) }), { remove: false, reason: "ownership-unproven" });
  assert.deepEqual(cleanupDecision({ id: "a".repeat(64), ownershipProven: true }), { remove: true, reason: "owned-exact-id" });
  assert.equal(canEmitSuccess({ status: "ACCEPTED_LOCAL_SQL_T1", cleanupStatus: "removed", unchanged: true }), true);
  assert.equal(canEmitSuccess({ status: "ACCEPTED_LOCAL_SQL_T1", cleanupStatus: "failed", unchanged: true, cleanupError: new Error("rm failed") }), false);
  assert.equal(canEmitSuccess({ status: "ACCEPTED_LOCAL_SQL_T1", cleanupStatus: "removed", unchanged: true, tempError: new Error("rm temp failed") }), false);
});

test("injectable cleanup inspects ownership before exact-ID removal and proves absence", async () => {
  const calls = [];
  const id = "a".repeat(64);
  let inspectCount = 0;
  const result = await cleanupRecordedContainer({
    id,
    inspect: async (value) => { calls.push(`inspect:${value}`); inspectCount += 1; if (inspectCount === 1) return { Id: value }; throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
    assertOwnership: (item, record) => { calls.push(`owner:${record.id}`); assert.equal(item.Id, record.id); },
    remove: async (value) => { calls.push(`rm:${value}`); },
  });
  assert.equal(result.status, "removed");
  assert.deepEqual(calls, [`inspect:${id}`, `owner:${id}`, `rm:${id}`, `inspect:${id}`]);
});

test("injectable cleanup does not remove on ownership mismatch, while primary SQL failure still permits only failed receipt", async () => {
  const calls = [];
  const result = await cleanupRecordedContainer({
    id: "b".repeat(64),
    inspect: async () => ({ Id: "other" }),
    assertOwnership: () => { throw new Error("ownership mismatch"); },
    remove: async () => { calls.push("rm"); },
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, []);
  assert.equal(canEmitSuccess({ status: "ACCEPTED_LOCAL_SQL_T1", cleanupStatus: "removed", cleanupError: new Error("primary SQL failed"), unchanged: true }), false);
});

test("SQL proconfig assertions use PostgreSQL's empty-path representation", () => {
  const sql = buildSqlAssertionProbe();
  assert.match(sql, /'search_path=""'/g);
  assert.doesNotMatch(sql, /'search_path='\s*=\s*ANY/);
});

test("bounded runner calls process-group kill callback on timeout and drain escalates after bounded wait", async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 812;
  child.stdin = { end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => { events.push(`child:${signal}`); if (signal === "SIGKILL") child.emit("close", null, signal); };
  const pending = runBoundedProcess({ file: "fake", timeout: 2, spawnImpl: () => child, killImpl: (pid, signal) => events.push(`group:${pid}:${signal}`) });
  await new Promise((resolve) => setTimeout(resolve, 8));
  child.emit("close", null, "SIGTERM");
  await pending;
  assert.ok(events.some((event) => event === "group:812:SIGTERM"));
  let resolveClose;
  const drainingChild = { pid: 813, __e10ClosePromise: new Promise((resolve) => { resolveClose = resolve; }) };
  const drainEvents = [];
  const drain = drainActiveChildren(new Set([drainingChild]), { timeout: 2, termImpl: () => drainEvents.push("TERM"), killImpl: () => { drainEvents.push("KILL"); resolveClose(); } });
  await drain;
  assert.deepEqual(drainEvents, ["TERM", "KILL"]);
});

test("termination is idempotent across timeout and input failure, and close cancels the force kill", async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 814;
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => events.push(`child:${signal}`);
  const pending = runBoundedProcess({
    file: "fake", timeout: 2, forceDelay: 10, maxBuffer: 1, spawnImpl: () => child,
    killImpl: (pid, signal) => events.push(`group:${pid}:${signal}`),
  });
  child.stdout.emit("data", "xx");
  child.stdin.emit("error", new Error("second failure"));
  child.emit("close", null, "SIGTERM");
  await assert.rejects(pending, /stdout exceeds maxBuffer/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(events.filter((event) => event === "group:814:SIGTERM").length, 1);
  assert.equal(events.filter((event) => event === "child:SIGTERM").length, 1);
  assert.equal(events.filter((event) => event.includes("SIGKILL")).length, 0);
});

test("a child that stays open receives one force kill after one TERM", async () => {
  const events = [];
  const child = new EventEmitter();
  child.pid = 815;
  child.stdin = { end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    events.push(`child:${signal}`);
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, signal));
  };
  const pending = runBoundedProcess({
    file: "fake", timeout: 2, forceDelay: 10, spawnImpl: () => child,
    killImpl: (pid, signal) => events.push(`group:${pid}:${signal}`),
  });
  const result = await pending;
  assert.equal(result.status, null);
  assert.equal(events.filter((event) => event === "group:815:SIGTERM").length, 1);
  assert.equal(events.filter((event) => event === "child:SIGTERM").length, 1);
  assert.equal(events.filter((event) => event === "group:815:SIGKILL").length, 1);
  assert.equal(events.filter((event) => event === "child:SIGKILL").length, 1);
});
