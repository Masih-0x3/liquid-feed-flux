import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ARCHIVE_PATH,
  CLI_BIN,
  CLI_VERSION,
  FUNCTION_NAMES,
  FUNCTION_VERIFY_JWT,
  INVENTORY_PATH,
  PROJECT_REF,
  SCHEMA,
  assertSafeRepoPath,
  bindArchive,
  buildFunctionCutoverCards,
  deployArgv,
  entrypointPath,
  functionCard,
  graphFingerprint,
  parseInventory,
  resolveEntrypoint,
  serializeCards,
  sha256,
} from "./build-function-cutover-cards.mjs";

// [id, version, ezbr_sha256] per fixed-ten function, matching the live inventory.
const RECORDS = Object.fromEntries([
  ["webhooks-rssapp", "93044177-46cc-483e-82d5-dd93d8014418", 248, "fd5bbde2af0df70dd02fb7080c7c4def3ed777ece3e700a2fa5667e47ef2b3eb"],
  ["media-processor", "1401e7e1-bf74-468e-ac93-1356ec911d5a", 213, "1becc70c7b8704da03b655c42cdc6fc517c16fac7a71e225b597f9ed96aa06e1"],
  ["digest-compiler", "dc5b1852-2698-4357-bc36-456dd0724a1d", 133, "44dfe946ea25e4ac0ee5b7028925bd0a05bb4cc098d38e6c05d173cf5f06e5dd"],
  ["db-cleanup", "acf7043c-5968-4036-9c16-ef5d0399b095", 174, "50e9afed1bb1ffbdd6ab3fe9a9f9a9eda21d3e5c58dae99d4a00812fb4f23a31"],
  ["media-cleanup", "83bacfb4-9813-48fb-9aa1-095acb2c042e", 210, "87f95aec75740eec4e7eaac10e1bd0ee524a169ed74dc4334a78c4ee95bec4df"],
  ["x-followers-snapshot", "d1ff9294-8b7a-4c02-8dbc-b2ec701bb1a8", 124, "816c5783e45a9d690733940c2a29ca42caecf699975c9a083418cccd2a7d257a"],
  ["admin-retry", "ecc25772-af42-41a9-b7c7-fc98d072f81e", 205, "6060da252c661cc99068fb50e89dd6b31178bcde45cb1bdbcf518720bf14bb33"],
  ["admin-actions", "7679f664-50e5-41fa-b02a-1e58ccb24d9d", 214, "efaa0826d672d150ae3f89517d2b9e9446f8339e026c88976fef53be4cbaa7c8"],
  ["x-poster", "27669ebd-30bb-4dfd-8142-ccdf319a982e", 161, "49c7eedb227889ff9efd6d0192603738228f52d9a0a019476457b6fd166430d1"],
  ["worker", "15d56d97-a8fe-496b-b64f-6cd8d0f44de5", 286, "993ab8806421aa8bd5f8601a2e7d850c4cd26038ff6e9691d85af660c575c5d8"],
].map(([name, id, version, ezbr_sha256]) => [name, { id, version, ezbr_sha256 }]));

function fixtureRecord(name, overrides = {}) {
  return { name, ...RECORDS[name], status: "ACTIVE", verify_jwt: FUNCTION_VERIFY_JWT[name], ...overrides };
}

function fixtureInventory() {
  return {
    schema: "xot-production-function-inventory-v1",
    observedAt: "2026-08-31T04:43:06Z",
    projectRef: PROJECT_REF,
    supabaseCli: CLI_VERSION,
    productionMutated: false,
    functions: FUNCTION_NAMES.map((name) => fixtureRecord(name)),
  };
}

function fixtureGraph() {
  const dep = { specifier: "./_shared/util.ts", code: { specifier: "file:///r/supabase/functions/_shared/util.ts" }, type: null };
  return { modules: [
    { kind: "esm", specifier: "file:///r/supabase/functions/worker/index.ts", dependencies: [dep], local: "/r/supabase/functions/worker/index.ts" },
    { kind: "esm", specifier: "file:///r/supabase/functions/_shared/util.ts", dependencies: [], local: "/r/supabase/functions/_shared/util.ts" },
  ] };
}

const HASHES = {
  "supabase/functions/worker/index.ts": "aaa",
  "supabase/functions/worker/local.ts": "bbb",
  "supabase/functions/_shared/util.ts": "ccc",
  "supabase/functions/worker/other.ts": "ddd",
};
const hashLocal = (path) => sha256(HASHES[path] ?? path);
const ARCHIVE_SHA = "501ef103715dccd5ff87b3096daa6da56aa091c1a422930635a2ed1e00769572";
const REPO = new URL("..", import.meta.url).pathname;

function fixtureRoots() {
  const prior = mkdtempSync(join(tmpdir(), "xot-cards-prior-"));
  const candidate = mkdtempSync(join(tmpdir(), "xot-cards-candidate-"));
  for (const [root, content] of [[prior, "PRIOR"], [candidate, "CANDIDATE"]]) {
    for (const name of FUNCTION_NAMES) {
      mkdirSync(join(root, `supabase/functions/${name}`), { recursive: true });
      writeFileSync(join(root, entrypointPath(name)), `${content} ${name} entrypoint`);
    }
  }
  return { prior, candidate };
}

const graphFor = (entry) => ({ modules: [{ kind: "esm", specifier: "file:///r/supabase/functions/worker/index.ts", dependencies: [], local: entry }] });
const runCli = (args) => new Promise((resolvePromise) => {
  execFile(process.execPath, [new URL("./build-function-cutover-cards.mjs", import.meta.url).pathname, ...args], (error, stdout, stderr) => resolvePromise({ error, stdout, stderr }));
});
test("fixed ordered ten functions and verify_jwt matrix are exact", () => {
  assert.deepEqual(FUNCTION_NAMES, ["webhooks-rssapp", "media-processor", "digest-compiler", "db-cleanup", "media-cleanup", "x-followers-snapshot", "admin-retry", "admin-actions", "x-poster", "worker"]);
  assert.deepEqual(FUNCTION_VERIFY_JWT, { "webhooks-rssapp": false, "media-processor": false, "digest-compiler": false, "db-cleanup": false, "media-cleanup": false, "x-followers-snapshot": false, "admin-retry": true, "admin-actions": true, "x-poster": false, worker: false });
});

test("deploy argv is exact with --use-api and --no-verify-jwt only when false", () => {
  for (const name of FUNCTION_NAMES) {
    assert.deepEqual(deployArgv(name), [
      "functions", "deploy", name, "--project-ref", PROJECT_REF, "--use-api",
      ...(FUNCTION_VERIFY_JWT[name] ? [] : ["--no-verify-jwt"]),
    ]);
  }
  assert.equal(CLI_BIN, `npx --yes supabase@${CLI_VERSION}`);
});

test("parseInventory accepts the exact live inventory and rejects mutations", () => {
  assert.deepEqual(parseInventory(fixtureInventory()).errors, []);
  const mutations = [
    ["missing record", { functions: fixtureInventory().functions.slice(1) }],
    ["reordered records", { functions: [...fixtureInventory().functions].reverse() }],
    ["wrong project ref", { projectRef: "abcdefghijklmnopqrst" }],
    ["wrong cli version", { supabaseCli: "1.0.0" }],
    ["mutated flag", { productionMutated: true }],
    ["extra function", { functions: [...fixtureInventory().functions, fixtureRecord("worker")] }],
  ];
  for (const [label, patch] of mutations) {
    assert.equal(parseInventory({ ...fixtureInventory(), ...patch }).ok, false, label);
  }
  const wrongVerify = fixtureInventory();
  wrongVerify.functions.find((record) => record.name === "admin-actions").verify_jwt = false;
  assert.equal(parseInventory(wrongVerify).ok, false);
  assert.match(parseInventory({ ...fixtureInventory(), projectRef: "x" }).errors.join("; "), /projectRef/);
});
test("archive binding captures configurable path, bytes, and exact sha256", () => {
  const archive = bindArchive(REPO, ARCHIVE_PATH);
  assert.equal(archive.path, ARCHIVE_PATH);
  assert.equal(archive.sha256, ARCHIVE_SHA);
  assert.ok(archive.bytes > 1000);
  assert.throws(() => bindArchive(REPO, "docs/plans/artifacts/missing.tar.gz"), /ENOENT|no such file/i);
});

test("graphFingerprint is deterministic, sorted, and sensitive to graph changes", () => {
  const first = graphFingerprint(fixtureGraph(), { hashLocal });
  assert.equal(graphFingerprint(fixtureGraph(), { hashLocal }), first);
  assert.equal(graphFingerprint({ modules: [fixtureGraph().modules[1], fixtureGraph().modules[0]] }, { hashLocal }), first, "module order must not matter");
  const changedDep = structuredClone(fixtureGraph());
  changedDep.modules[0].dependencies[0].code.specifier = "file:///r/supabase/functions/worker/other.ts";
  assert.notEqual(graphFingerprint(changedDep, { hashLocal }), first);
  assert.notEqual(graphFingerprint({ modules: fixtureGraph().modules.slice(0, 1) }, { hashLocal }), first, "missing modules must change the fingerprint");
});

test("entrypoint bytes/hashes root at prior vs candidate and differ", () => {
  const { prior, candidate } = fixtureRoots();
  const archive = bindArchive(REPO, ARCHIVE_PATH);
  assert.ok(resolveEntrypoint(prior, "worker").startsWith(prior));
  assert.ok(resolveEntrypoint(candidate, "worker").startsWith(candidate));
  const card = functionCard("worker", fixtureRecord("worker"), archive, { priorRoot: prior, candidateRoot: candidate, denoInfoProvider: graphFor });
  assert.equal(card.prior.entrypointSha256, sha256("PRIOR worker entrypoint"));
  assert.equal(card.candidate.entrypointSha256, sha256("CANDIDATE worker entrypoint"));
  assert.equal(card.prior.entrypointBytes, Buffer.byteLength("PRIOR worker entrypoint"));
  assert.notEqual(card.prior.entrypointSha256, card.candidate.entrypointSha256);
});

test("buildFunctionCutoverCards emits deterministic v1 cards for both roots", () => {
  const { prior, candidate } = fixtureRoots();
  const options = {
    root: REPO,
    priorRoot: prior,
    candidateRoot: candidate,
    inventoryPath: INVENTORY_PATH,
    archivePath: ARCHIVE_PATH,
    denoInfoProvider: graphFor,
  };
  const cards = buildFunctionCutoverCards(options);
  const json = serializeCards(cards);
  assert.equal(cards.schema, SCHEMA);
  assert.equal(cards.productionMutated, false);
  assert.equal(cards.projectRef, PROJECT_REF);
  assert.equal(cards.priorRoot, prior);
  assert.equal(cards.candidateRoot, candidate);
  assert.equal(cards.archive.sha256, ARCHIVE_SHA);
  assert.deepEqual(cards.functions.map((card) => card.name), FUNCTION_NAMES);
  const worker = cards.functions.find((card) => card.name === "worker");
  assert.deepEqual(worker.candidate.argv, deployArgv("worker"));
  assert.deepEqual(worker.rollback.argv, deployArgv("worker"));
  assert.equal(worker.candidate.workingDirectory, candidate);
  assert.equal(worker.rollback.workingDirectory, prior);
  assert.equal(worker.rollback.archive.sha256, ARCHIVE_SHA);
  assert.equal(worker.prior.entrypoint.startsWith(prior), true);
  assert.equal(worker.candidate.entrypoint.startsWith(candidate), true);
  assert.equal(worker.probe.probe.length > 0, true);
  assert.equal(worker.probe.expectedResult.length > 0, true);
  assert.equal(serializeCards(buildFunctionCutoverCards(options)), json, "serialized cards must be deterministic");
  assert.equal(json.endsWith("\n"), true);
});

test("required flags are enforced, unknown flags rejected, paths fail closed", async () => {
  const missing = await runCli([]);
  assert.ok(missing.error && /missing required flag/.test(missing.stderr), "CLI must fail when required flags are missing");
  const unknown = await runCli(["--inventory", "a", "--prior-root", "b", "--candidate-root", "c", "--archive", "d", "--output", "e", "--bogus"]);
  assert.ok(unknown.error && /unknown flag/.test(unknown.stderr), "CLI must reject unknown flags");
  assert.throws(() => assertSafeRepoPath("/etc/passwd"), /outside the repository/);
  assert.throws(() => assertSafeRepoPath("../escape"), /outside the repository/);
  assert.equal(entrypointPath("worker"), "supabase/functions/worker/index.ts");
});

test("real CLI uses every required flag and emits both-root cards", async () => {
  const { prior, candidate } = fixtureRoots();
  const output = `docs/plans/artifacts/xot-cards-test-${process.pid}.json`;
  try {
    const { error, stdout } = await runCli([
      "--inventory", INVENTORY_PATH,
      "--prior-root", prior,
      "--candidate-root", candidate,
      "--archive", ARCHIVE_PATH,
      "--output", output,
    ]);
    assert.equal(error, null, error?.message);
    assert.match(stdout, /FUNCTION_CUTOVER_CARDS_WRITTEN/);
    const cards = JSON.parse(readFileSync(join(REPO, output), "utf8"));
    assert.equal(cards.priorRoot, prior);
    assert.equal(cards.candidateRoot, candidate);
    assert.equal(cards.archive.sha256, ARCHIVE_SHA);
    assert.equal(cards.functions.length, 10);
    assert.equal(cards.functions[0].candidate.entrypoint.startsWith(candidate), true);
    assert.equal(cards.functions[0].prior.entrypoint.startsWith(prior), true);
  } finally {
    rmSync(join(REPO, output), { force: true });
  }
});
