import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationInventory, E10_EXPECTED_MIGRATION_COUNT } from "./e10SqlBoundary.mjs";
import { E7_EXPECTED_PG_META_IMAGE, E7_PG_META_COMMAND } from "./e7DisposableBoundary.mjs";
import {
  assertCurrentReleaseMigrationInventory,
  CURRENT_RELEASE_INVENTORY_SHA256,
  CURRENT_RELEASE_MIGRATION_VERSION,
  CURRENT_RELEASE_ASSERTION_ROWS,
  assertCurrentReleaseAssertionRows,
  buildCurrentReleaseSqlAssertions,
  normalizeMountInventory,
  assertCurrentTypeHelperOwnership,
} from "./currentReleaseSqlBoundary.mjs";

const entries = (await readMigrationInventory(fileURLToPath(new URL("../supabase/migrations", import.meta.url))))
  .filter((entry) => entry.version <= CURRENT_RELEASE_MIGRATION_VERSION);

test("current candidate pins all 137 source bodies without rewriting historical E10", () => {
  const actual = assertCurrentReleaseMigrationInventory(entries);
  assert.equal(actual.count, 137);
  assert.equal(actual.sha256, CURRENT_RELEASE_INVENTORY_SHA256);
  assert.equal(E10_EXPECTED_MIGRATION_COUNT, 129);
});

test("current candidate rejects missing, extra, renamed and modified migrations", () => {
  assert.throws(() => assertCurrentReleaseMigrationInventory(entries.slice(1)), /count/);
  assert.throws(() => assertCurrentReleaseMigrationInventory([...entries, entries[0]]), /count/);
  for (const change of [{ name: "renamed" }, { sha256: "0".repeat(64) }, { version: "99999999999999" }]) {
    const changed = entries.map((entry, index) => index === 0 ? { ...entry, ...change } : entry);
    assert.throws(() => assertCurrentReleaseMigrationInventory(changed), /SHA drifted/);
  }
});

test("current runner retains E10 SQL assertions, isolation, cleanup and bounded resources", () => {
  const source = readFileSync(new URL("./run-current-release-sql-boundary.mjs", import.meta.url), "utf8");
  for (const required of [
    "assertImageInspect(imageInspect)", "assertContainerOwnership(item, resource)",
    "buildDockerCreateArgs(CONTAINER, cidfile)", "cleanupRecordedContainer({",
    "assertExpectedAssertionRows(assertionRows)", "buildSqlAssertions()",
    "parseAssertionPass(assertions.stdout)", "compareResourceInventories(baseline, after)",
    '"--cpus=1", "--memory=1g", "--pids-limit=256"',
    'schema: "xot-current-release-sql-boundary-receipt-v1"',
  ]) assert.ok(source.includes(required), required);
  assert.ok(!source.includes("supabase db push"));
});

test("current seed assertions reject each failed safety or privilege fact", () => {
  assert.equal(assertCurrentReleaseAssertionRows(CURRENT_RELEASE_ASSERTION_ROWS), true);
  for (const key of Object.keys(CURRENT_RELEASE_ASSERTION_ROWS)) {
    assert.throws(() => assertCurrentReleaseAssertionRows({ ...CURRENT_RELEASE_ASSERTION_ROWS, [key]: "wrong" }), /assertion failed/);
  }
  assert.throws(() => assertCurrentReleaseAssertionRows({ ...CURRENT_RELEASE_ASSERTION_ROWS, extra: "true" }), /row set/);
});

test("current mutation tests retain insert/update/duplicate/RLS/grant negatives and roll back", () => {
  const sql = buildCurrentReleaseSqlAssertions();
  assert.ok(sql.startsWith("BEGIN;\nDELETE FROM public.runtime_controls;"));
  assert.ok(sql.endsWith("ROLLBACK;"));
  for (const text of ["preview posting invariant insert was not blocked", "preview posting invariant update was not blocked",
    "duplicate singleton was not rejected", "admin/read_only uniqueness was not enforced", "RLS is not enabled",
    "anon table grant is too broad", "public RPC grant is present", "preview runtime_controls must keep posting_mode=blocked",
    "E10_SQL_ASSERTION_PASS"]) assert.ok(sql.includes(text), text);
});

test("mount inventory ignores order but detects changed, missing, added and duplicate mounts", () => {
  const mounts = [{ Source: "/a", Destination: "/b", RW: true }, { Source: "/c", Destination: "/d", RW: false }];
  const expected = normalizeMountInventory(mounts);
  assert.deepEqual(normalizeMountInventory([...mounts].reverse()), expected);
  for (const changed of [mounts.slice(1), [...mounts, mounts[0]],
    [{ ...mounts[0], Source: "/different" }, mounts[1]],
    [{ ...mounts[0], RW: false }, mounts[1]]]) {
    assert.notDeepEqual(normalizeMountInventory(changed), expected);
  }
});

test("type helper can share only the exact owned no-egress database namespace", () => {
  const db = "a".repeat(64);
  const helper = { id: "b".repeat(64), name: "xot-e10-sql-test-types" };
  const original = { Id: helper.id, Name: `/${helper.name}`,
    Config: { Image: E7_EXPECTED_PG_META_IMAGE, Cmd: [...E7_PG_META_COMMAND], Labels: { "xot.e10": "disposable" } },
    HostConfig: { NetworkMode: `container:${db}`, Binds: [], Mounts: [], PortBindings: {} },
    NetworkSettings: { Networks: {}, Ports: {} }, Mounts: [] };
  assert.equal(assertCurrentTypeHelperOwnership(original, helper, db), helper.id);
  for (const mutate of [
    (item) => { item.Id = "c".repeat(64); }, (item) => { item.Config.Image = "other"; },
    (item) => { item.HostConfig.NetworkMode = "host"; },
    (item) => { item.HostConfig.NetworkMode = `container:${"c".repeat(64)}`; },
    (item) => { item.NetworkSettings.Networks.bridge = {}; },
    (item) => { item.Mounts.push({ Source: "/private", Destination: "/data" }); },
    (item) => { item.HostConfig.PortBindings["8080/tcp"] = [{ HostPort: "8080" }]; },
  ]) { const item = structuredClone(original); mutate(item); assert.throws(() => assertCurrentTypeHelperOwnership(item, helper, db)); }
});
