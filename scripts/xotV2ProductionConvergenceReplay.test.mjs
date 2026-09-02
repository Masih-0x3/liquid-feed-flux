import assert from "node:assert/strict";
import test from "node:test";

import * as convergenceReplay from "./xotV2ProductionConvergenceReplay.mjs";

import {
  ACTIVATION_ONLY_X_RETIREMENT,
  EXPECTED_INCLUSION_COUNT,
  EXPECTED_MIGRATION_ORDER,
} from "./build-xot-v2-production-convergence-sql.mjs";

import {
  LOCAL_V1_BASELINE_E10_PREFIX_COUNT,
  LOCAL_V1_BASELINE_EXCLUDED_SUCCESSORS,
  LOCAL_V1_BASELINE_TAIL,
  REPLAY_ASSERTION_PASS,
  REPLAY_ASSERTION_PHASES,
  REPLAY_CONTAINER_PREFIX,
  REPLAY_EXPECTED_IMAGE,
  REPLAY_EXPECTED_IMAGE_COMMAND,
  REPLAY_LABEL_KEY,
  REPLAY_LABEL_VALUE,
  ZERO_WRITE_FIXTURE,
  assertBundleSql,
  assertContainerOwnership,
  assertFingerprintsEqual,
  assertImageInspect,
  assertLocalBaselineAvailable,
  buildActivationAssertionSql,
  buildAssertionBundle,
  buildCatalogFingerprintQuery,
  buildDockerCreateArgs,
  buildDockerInvocation,
  buildPostBundleAssertions,
  buildPostT2Assertions,
  buildPreflightAssertions,
  buildReplayBundle,
  buildRollbackForwardFixAssertions,
  buildZeroWriteAssertionSql,
  buildZeroWriteFixtureSql,
  cleanupDecision,
  cleanupRecordedContainer,
  fingerprintFromRows,
  makeContainerName,
  parseAssertionPass,
  parseAssertionRows,
  readLocalBaseline,
  recoverCidfileId,
  sha256,
  stableJson,
  validateContainerId,
  validateReplayPhaseSql,
} from "./xotV2ProductionConvergenceReplay.mjs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url).pathname;

test("replay constants bind the exact accepted image, context, and ownership identity", () => {
  assert.equal(REPLAY_EXPECTED_IMAGE, "public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453");
  assert.deepEqual(REPLAY_EXPECTED_IMAGE_COMMAND, ["postgres", "-D", "/etc/postgresql"]);
  assert.equal(REPLAY_CONTAINER_PREFIX, "xot-convergence-replay-");
  assert.equal(REPLAY_LABEL_KEY, "xot.convergence-replay");
  assert.equal(REPLAY_LABEL_VALUE, "disposable");
  assert.equal(makeContainerName("abc"), `${REPLAY_CONTAINER_PREFIX}abc`);
  assert.throws(() => makeContainerName("a/b"), /suffix/);
  assert.deepEqual(REPLAY_ASSERTION_PHASES, [
    "preflight",
    "post-bundle-first",
    "post-bundle-second",
    "post-t2",
    "rollback-forward-fix",
  ]);
});

test("the real repository bundle builds through the builder with 23 ordered sources and one outer transaction", async () => {
  const bundle = await buildReplayBundle({ root: process.cwd() });
  const result = assertBundleSql(bundle);
  assert.equal(result.inclusionCount, EXPECTED_INCLUSION_COUNT);
  assert.equal(result.sourceOrder.length, EXPECTED_MIGRATION_ORDER.length);
  assert.deepEqual(result.sourceOrder, EXPECTED_MIGRATION_ORDER);
  assert.equal(bundle.startsWith("BEGIN;\n"), true);
  assert.equal(bundle.endsWith("COMMIT;\n"), true);
  assert.equal(bundle.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
  assert.doesNotMatch(bundle, /\nCOMMIT;[\s\S]*\nBEGIN;/);
});

test("bundle validator rejects reordering, missing sources, nested control, and the X retirement", () => {
  const valid = `BEGIN;\n${EXPECTED_MIGRATION_ORDER.map((name) => `-- Source: ${name}\nSELECT 1;`).join("\n")}\nCOMMIT;\n`;
  assertBundleSql(valid);
  assert.throws(
    () => assertBundleSql(valid.replace(`-- Source: ${EXPECTED_MIGRATION_ORDER[0]}`, "-- Source: omitted.sql")),
    /inclusion count|source order/,
  );
  assert.throws(
    () => assertBundleSql(valid.replace(
      `-- Source: ${EXPECTED_MIGRATION_ORDER[0]}`,
      `-- Source: ${EXPECTED_MIGRATION_ORDER[0]}\n-- ${ACTIVATION_ONLY_X_RETIREMENT}`,
    )),
    /activation-only X retirement/,
  );
  assert.throws(
    () => assertBundleSql(valid.replace("\nCOMMIT;\n", "\nCOMMIT;\nBEGIN;\n")),
    /one outer BEGIN\/COMMIT/,
  );
  assert.throws(() => assertBundleSql("SELECT 1;"), /outer BEGIN\/COMMIT/);
});

test("the local V1 baseline is derived only from accepted repository evidence", async () => {
  const baseline = await readLocalBaseline(process.cwd());
  assert.equal(baseline.label, "local-v1-frontier-derived");
  assert.equal(baseline.e10PrefixCount, LOCAL_V1_BASELINE_E10_PREFIX_COUNT);
  assert.equal(baseline.migrations.length, LOCAL_V1_BASELINE_E10_PREFIX_COUNT + LOCAL_V1_BASELINE_TAIL.length);
  assert.equal(baseline.lastMigration, "20260825104845_v1_delivery_cutover_settle_reason_prefix.sql");
  assert.equal(baseline.migrations.some((entry) => LOCAL_V1_BASELINE_EXCLUDED_SUCCESSORS.includes(entry.filename)), false);
  for (const entry of baseline.migrations) assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assertLocalBaselineAvailable(baseline.migrations);
  assert.throws(
    () => assertLocalBaselineAvailable(baseline.migrations.slice(0, LOCAL_V1_BASELINE_E10_PREFIX_COUNT - 1)),
    /exactly \d+ migrations/,
  );
  assert.throws(
    () => assertLocalBaselineAvailable([
      ...baseline.migrations,
      { filename: LOCAL_V1_BASELINE_EXCLUDED_SUCCESSORS[0], sha256: "a".repeat(64) },
    ]),
    /must not include convergence successor/,
  );
});

test("zero-write fixture SQL is deterministic and contains no credentials or network use", () => {
  const first = buildZeroWriteFixtureSql();
  const second = buildZeroWriteFixtureSql();
  assert.equal(first, second);
  assert.match(first, new RegExp(ZERO_WRITE_FIXTURE.pendingTweetId));
  assert.match(first, new RegExp(ZERO_WRITE_FIXTURE.runningJobId));
  assert.doesNotMatch(first, /http|fetch|curl|wget|password|secret|token|Bearer/i);
});

test("assertion phases are offline, mutation-scoped, and carry the final sentinel only once", () => {
  const preflight = buildPreflightAssertions();
  const post = buildPostBundleAssertions();
  const postT2 = buildPostT2Assertions();
  const rollback = buildRollbackForwardFixAssertions();
  const zeroWrite = buildZeroWriteAssertionSql();
  const activation = buildActivationAssertionSql();
  for (const [label, sql] of Object.entries({ preflight, post, postT2, rollback, zeroWrite, activation })) {
    assert.doesNotMatch(sql, /http|fetch|curl|wget|supabase\.co/i, `${label} must be offline`);
  }
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i, "preflight is read-only");
  assert.match(post, /trg_00_historical_delivery_job_zero_write/);
  assert.match(post, /post_bundle_runtime_controls_singleton/);
  assert.match(postT2, /runtime_activation_epochs/);
  assert.match(rollback, /runtime_activation_epochs_immutable/);
  assert.match(zeroWrite, /delivery_cutover_blocked:historical_deliver_job_zero_write/);
  assert.match(zeroWrite, new RegExp(REPLAY_ASSERTION_PASS));
  assert.equal(parseAssertionPass(`${zeroWrite}\n${REPLAY_ASSERTION_PASS}\n`), REPLAY_ASSERTION_PASS);
  assert.throws(() => parseAssertionPass(`${REPLAY_ASSERTION_PASS}\n${REPLAY_ASSERTION_PASS}\n`), /count=2/);
  assert.throws(() => parseAssertionPass("nothing\n"), /count=0/);
});

test("phase bundles validate without nested COMMIT and reject unknown phases", () => {
  for (const phase of REPLAY_ASSERTION_PHASES) {
    const sql = buildAssertionBundle(phase);
    validateReplayPhaseSql(phase, sql);
    assert.match(sql, /SELECT/);
  }
  assert.throws(() => buildAssertionBundle("nope"), /unknown assertion phase/);
  assert.throws(() => validateReplayPhaseSql("nope", "SELECT 1;"), /unknown assertion phase/);
});

test("fingerprint rows normalize to a stable digest and identical fingerprints pass", () => {
  const rows = "public.accounts|relkind=r relrowsecurity=true|\npublic.jobs|relkind=r relrowsecurity=true|\n";
  const digest = fingerprintFromRows(rows);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(fingerprintFromRows(rows), fingerprintFromRows(`${rows.trim()}\n`));
  assert.equal(fingerprintFromRows(rows), fingerprintFromRows(rows.split("\n").reverse().join("\n")));
  assertFingerprintsEqual(digest, digest);
  assert.throws(() => assertFingerprintsEqual(digest, sha256("other")), /semantic catalog drift/);
  assert.throws(() => assertFingerprintsEqual(digest, "not-a-hash"), /invalid/);
});

test("catalog fingerprint query covers the required semantic surface without volatile OIDs or timestamps", () => {
  const sql = buildCatalogFingerprintQuery();
  for (const needle of [
    "tables", "columns", "constraints", "indexes", "policies", "routines", "triggers", "enums",
    "role_grants", "default_acl", "relrowsecurity", "pg_get_functiondef", "pg_get_triggerdef",
    "runtime_cutover", "zero_write_contract", "trg_00_historical_delivery_job_zero_write",
  ]) assert.match(sql, new RegExp(needle));
  assert.doesNotMatch(sql, /pg_get_userbyid/);
  assert.doesNotMatch(sql, /now\(\)|clock_timestamp|current_timestamp/);
});

test("assertion row parsing is strict about duplicates and sensitive keys", () => {
  const rows = parseAssertionRows(`post_bundle_t2_absent=true\npost_bundle_runtime_controls_rows=1\n${REPLAY_ASSERTION_PASS}\n`);
  assert.equal(rows.post_bundle_t2_absent, "true");
  assert.throws(() => parseAssertionRows("a=1\na=2\n"), /duplicate/);
  assert.throws(() => parseAssertionRows("password=x\n"), /sensitive/);
  assert.throws(() => parseAssertionRows("not-a-row\n"), /malformed/);
});

test("container ownership requires exact recorded id, name, image, label, none network, and no mounts or ports", () => {
  const id = "a".repeat(64);
  const inspect = {
    Id: id,
    Name: "/xot-convergence-replay-test123",
    Config: { Image: REPLAY_EXPECTED_IMAGE, Cmd: REPLAY_EXPECTED_IMAGE_COMMAND, Labels: { [REPLAY_LABEL_KEY]: REPLAY_LABEL_VALUE } },
    HostConfig: { NetworkMode: "none", Binds: [], Mounts: [], PortBindings: {} },
    Mounts: [],
    NetworkSettings: { Ports: {}, Networks: { none: {} } },
  };
  assert.equal(assertContainerOwnership(inspect, { id, name: "xot-convergence-replay-test123" }), id);
  for (const mutated of [
    { ...inspect, Id: "b".repeat(64) },
    { ...inspect, Name: "/wrong" },
    { ...inspect, Config: { ...inspect.Config, Labels: {} } },
    { ...inspect, HostConfig: { ...inspect.HostConfig, NetworkMode: "bridge" } },
    { ...inspect, Mounts: [{ Source: "/tmp" }] },
    { ...inspect, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }] }, Networks: { none: {} } } },
  ]) assert.throws(() => assertContainerOwnership(mutated, { id, name: "xot-convergence-replay-test123" }));
  assertImageInspect({ RepoDigests: [REPLAY_EXPECTED_IMAGE], Config: { Cmd: REPLAY_EXPECTED_IMAGE_COMMAND, Volumes: {} } });
  assert.throws(() => assertImageInspect({ RepoDigests: ["other"], Config: {} }), /digest/);
});

test("docker create args are exact, offline, unpulled, and never publish ports or mounts", () => {
  assert.deepEqual(buildDockerCreateArgs("xot-convergence-replay-test123", "/tmp/replay.cid"), [
    "create", "--pull=never", "--cidfile", "/tmp/replay.cid", "--network", "none",
    "--label", "xot.convergence-replay=disposable",
    "--name", "xot-convergence-replay-test123", "--env", "POSTGRES_PASSWORD", REPLAY_EXPECTED_IMAGE,
    ...REPLAY_EXPECTED_IMAGE_COMMAND,
  ]);
  assert.deepEqual(buildDockerInvocation(["ps", "-aq"]), ["--context", "orbstack", "ps", "-aq"]);
  assert.throws(() => buildDockerCreateArgs("other-name", "/tmp/replay.cid"), /prefix/);
  assert.throws(() => buildDockerCreateArgs("xot-convergence-replay-test123", "/tmp/a\nb"), /cidfile/);
});

test("cidfile recovery accepts one ID and rejects missing, duplicate, or malformed content", async () => {
  assert.equal(validateContainerId(`${"a".repeat(64)}\n`), "a".repeat(64));
  assert.throws(() => validateContainerId(`${"a".repeat(64)}\n${"b".repeat(64)}`), /one container ID/);
  assert.equal(await recoverCidfileId("cid", { readFileImpl: async () => `${"b".repeat(64)}\n` }), "b".repeat(64));
  assert.equal(await recoverCidfileId("missing", { readFileImpl: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } }), null);
});

test("cleanup removes only after exact-ID ownership is proven and then proves absence", async () => {
  assert.deepEqual(cleanupDecision({}), { remove: false, reason: "no-recorded-id" });
  assert.deepEqual(cleanupDecision({ id: "a".repeat(64) }), { remove: false, reason: "ownership-unproven" });
  assert.deepEqual(cleanupDecision({ id: "a".repeat(64), ownershipProven: true }), { remove: true, reason: "owned-exact-id" });
  const calls = [];
  const id = "a".repeat(64);
  const result = await cleanupRecordedContainer({
    id,
    inspect: async (value) => { calls.push(`inspect:${value}`); if (calls.filter((c) => c.startsWith("inspect")).length === 1) return { Id: value }; throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
    assertOwnership: (item, record) => { calls.push(`owner:${record.id}`); assert.equal(item.Id, record.id); },
    remove: async (value) => { calls.push(`rm:${value}`); },
  });
  assert.equal(result.status, "removed");
  assert.deepEqual(calls, [`inspect:${id}`, `owner:${id}`, `rm:${id}`, `inspect:${id}`]);
  const refused = await cleanupRecordedContainer({
    id,
    inspect: async () => ({ Id: "other" }),
    assertOwnership: () => { throw new Error("ownership mismatch"); },
    remove: async () => { calls.push("rm-must-not-run"); },
  });
  assert.equal(refused.status, "failed");
  assert.equal(calls.includes("rm-must-not-run"), false);
});

test("stableJson sorts keys so equal objects hash identically", () => {
  assert.equal(stableJson({ b: 1, a: [2, 1] }), stableJson({ a: [2, 1], b: 1 }));
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }));
});

test("semantic drift is false for equal fingerprints and true for different fingerprints", () => {
  const semanticDriftFromFingerprints = convergenceReplay.semanticDriftFromFingerprints
    ?? (() => "missing");
  assert.equal(semanticDriftFromFingerprints("same", "same"), false);
  assert.equal(semanticDriftFromFingerprints("first", "second"), true);
  assert.equal(semanticDriftFromFingerprints(null, "second"), null);
});
