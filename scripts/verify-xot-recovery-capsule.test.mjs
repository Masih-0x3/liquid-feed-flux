import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  CAPSULE_SCHEMA,
  captureGitStatus,
  restoreCapsule,
  sha256,
  verifyCapsule,
} from "./verify-xot-recovery-capsule.mjs";

const PATH = process.env.PATH ?? "/usr/bin:/bin";
const VERIFIER = join(process.cwd(), "scripts", "verify-xot-recovery-capsule.mjs");

// Every temp dir created during a test is tracked here and removed after each
// test so no fixture leaks across tests and the live repo is never touched.
const tracked = [];
function track(dir) {
  tracked.push(dir);
  return dir;
}
function temp(prefix) {
  return track(mkdtempSync(join(tmpdir(), prefix)));
}
test.afterEach(() => {
  for (const dir of tracked.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    env: { PATH },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function newRepo(prefix) {
  const dir = temp(prefix);
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "XOT Capsule Test"]);
  git(dir, ["config", "user.email", "xot-capsule-test@example.invalid"]);
  return dir;
}

function commit(repoDir, message) {
  git(repoDir, ["add", "--all"]);
  git(repoDir, ["commit", "--quiet", "-m", message]);
  return git(repoDir, ["rev-parse", "HEAD"]).trim();
}

// Parse `git status --porcelain=v1 -uall -z` into `[{ xy, path }]` entries.
function statusEntries(repoDir) {
  const raw = git(repoDir, ["status", "--porcelain=v1", "-uall", "-z"]);
  const parts = raw.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.map((entry) => ({ xy: entry.slice(0, 2), path: entry.slice(3) }));
}

function headBlob(repoDir, path) {
  try {
    return git(repoDir, ["rev-parse", `HEAD:${path}`]).trim();
  } catch {
    return null;
  }
}

function buildPathEntry(repoDir, entry) {
  const { xy, path } = entry;
  const abs = join(repoDir, path);
  const stat = lstatSync(abs, { throwIfNoEntry: false });
  if (stat === undefined) {
    return { path, status: "D", type: "deletion", mode: "100644", size: 0, contentId: null, headBlob: headBlob(repoDir, path) };
  }
  if (stat.isSymbolicLink()) {
    return { path, status: xy.trim() || "?", type: "symlink", mode: "120000", size: 0, contentId: readlinkSync(abs), headBlob: null };
  }
  return {
    path,
    status: xy.trim() || "?",
    type: "file",
    mode: "100644",
    size: stat.size,
    contentId: sha256(readFileSync(abs)),
    headBlob: xy === "??" ? null : headBlob(repoDir, path),
  };
}

/**
 * Build a minimal v1 capsule from a dirty fixture repo. This helper is owned
 * by the test and intentionally does NOT import the creator implementation.
 */
function buildCapsule(repoDir) {
  const capsuleDir = temp("xot-capsule-fixture-");
  const untrackedDir = join(capsuleDir, "untracked");
  const status = captureGitStatus(repoDir);
  const head = git(repoDir, ["rev-parse", "HEAD"]).trim();
  const branch = git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const entries = statusEntries(repoDir);

  // refs.bundle: all reachable refs.
  git(repoDir, ["bundle", "create", join(capsuleDir, "refs.bundle"), "--all"]);

  // tracked.patch: binary full-index diff of working-tree changes vs HEAD.
  const patch = git(repoDir, ["diff", "HEAD", "--binary", "--no-color"]);
  writeFileSync(join(capsuleDir, "tracked.patch"), patch);

  // untracked/ copies of every Git-reported untracked path. Symlinks are
  // stored as symlinks so the verifier can readlink and recreate them.
  for (const entry of entries) {
    if (entry.xy !== "??") continue;
    const abs = join(repoDir, entry.path);
    const dest = join(untrackedDir, entry.path);
    mkdirSync(dirname(dest), { recursive: true });
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(abs), dest);
    } else if (stat.isFile()) {
      cpSync(abs, dest);
    }
  }

  const paths = entries.map((entry) => buildPathEntry(repoDir, entry));
  const manifest = {
    schema: CAPSULE_SCHEMA,
    createdAt: "2026-08-21T00:00:00Z",
    source: {
      branch,
      head,
      statusSha256: status.sha256,
      pathCount: paths.length,
      stagedCount: 0,
    },
    paths,
    denylist: { hits: [] },
  };
  writeFileSync(join(capsuleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { capsuleDir, manifest, status };
}

// A representative dirty fixture: modified tracked file, deleted tracked file,
// untracked text/binary/symlink/path-with-space.
function dirtyFixture() {
  const repoDir = newRepo("xot-capsule-src-");
  mkdirSync(join(repoDir, "tracked"), { recursive: true });
  writeFileSync(join(repoDir, "tracked", "keep.txt"), "initial\n");
  writeFileSync(join(repoDir, "tracked", "doomed.txt"), "goodbye\n");
  commit(repoDir, "initial commit");

  // Dirty working-tree state (no staging).
  writeFileSync(join(repoDir, "tracked", "keep.txt"), "modified\n");
  rmSync(join(repoDir, "tracked", "doomed.txt"));

  mkdirSync(join(repoDir, "untracked"), { recursive: true });
  writeFileSync(join(repoDir, "untracked", "new.txt"), "fresh content\n");
  writeFileSync(join(repoDir, "untracked", "blob.bin"), Buffer.from([0x00, 0xff, 0x10, 0x20, 0x80, 0x7f]));
  symlinkSync("../tracked/keep.txt", join(repoDir, "untracked", "link"));
  writeFileSync(join(repoDir, "untracked", "with space.txt"), "has spaces\n");
  return repoDir;
}

test("round-trip: a dirty fixture capsule restores with exact git status and inventory", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir, status } = buildCapsule(repoDir);
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.errors, null, 2));
  assert.equal(receipt.statusSha256, status.sha256);
  assert.equal(receipt.expectedStatusSha256, status.sha256);
  assert.equal(receipt.inventoryChecked, receipt.pathCount);
  assert.equal(receipt.denylistHits, 0);
  assert.equal(existsSync(receipt.restoredDir), false, "restored dir should be cleaned up by default");
});

test("restoreCapsule reconstructs the working tree without verifying", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  const out = temp("xot-capsule-out-");
  const restore = restoreCapsule(capsuleDir, out);
  assert.equal(restore.ok, true, JSON.stringify(restore.errors, null, 2));
  assert.equal(readFileSync(join(out, "tracked", "keep.txt"), "utf8"), "modified\n");
  assert.equal(existsSync(join(out, "tracked", "doomed.txt")), false);
  assert.equal(readFileSync(join(out, "untracked", "new.txt"), "utf8"), "fresh content\n");
  assert.deepEqual(
    [...readFileSync(join(out, "untracked", "blob.bin"))],
    [0x00, 0xff, 0x10, 0x20, 0x80, 0x7f],
  );
  assert.equal(readlinkSync(join(out, "untracked", "link")), "../tracked/keep.txt");
  assert.equal(readFileSync(join(out, "untracked", "with space.txt"), "utf8"), "has spaces\n");
});

test("tampered untracked content fails the inventory check", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  writeFileSync(join(capsuleDir, "untracked", "untracked", "new.txt"), "tampered\n");
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, false);
  assert.match(receipt.errors.join("\n"), /untracked\/new\.txt: content hash mismatch/);
});

test("a missing untracked path fails the inventory check", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  rmSync(join(capsuleDir, "untracked", "untracked", "blob.bin"));
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, false);
  assert.match(receipt.errors.join("\n"), /untracked\/blob\.bin: expected file but missing/);
});

test("a deletion reconstructs as a deletion (not a silent restore)", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  const out = temp("xot-capsule-del-out-");
  const receipt = verifyCapsule(capsuleDir, { outDir: out, keep: true });
  assert.equal(receipt.ok, true, JSON.stringify(receipt.errors, null, 2));
  assert.equal(existsSync(join(out, "tracked", "doomed.txt")), false, "deleted file must not be restored");
});

test("denylist hit fails closed before any restore", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir, manifest } = buildCapsule(repoDir);
  manifest.denylist.hits.push("untracked/secret.env");
  writeFileSync(join(capsuleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, false);
  assert.match(receipt.errors.join("\n"), /denylist hit/);
  assert.equal(receipt.restoredDir, null);
});

test("a corrupted status snapshot hash is rejected", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir, manifest } = buildCapsule(repoDir);
  manifest.source.statusSha256 = "0".repeat(64);
  writeFileSync(join(capsuleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, false);
  assert.match(receipt.errors.join("\n"), /git status hash mismatch/);
});

test("an empty-tree capsule (no dirty paths) verifies cleanly", () => {
  const repoDir = newRepo("xot-capsule-clean-src-");
  writeFileSync(join(repoDir, "solo.txt"), "only\n");
  commit(repoDir, "only commit");
  const { capsuleDir, status } = buildCapsule(repoDir);
  const receipt = verifyCapsule(capsuleDir);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.errors, null, 2));
  assert.equal(receipt.inventoryChecked, 0);
  assert.equal(receipt.statusSha256, status.sha256);
});

test("CLI prints a pass receipt and exits 0 on a valid capsule", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  const result = execFileSync(process.execPath, [VERIFIER, "--capsule", capsuleDir], {
    encoding: "utf8",
    env: { PATH },
  });
  assert.match(result, /XOT_RECOVERY_CAPSULE_PASS/);
});

test("CLI exits non-zero and reports errors on a tampered capsule", () => {
  const repoDir = dirtyFixture();
  const { capsuleDir } = buildCapsule(repoDir);
  writeFileSync(join(capsuleDir, "untracked", "untracked", "new.txt"), "tampered\n");
  let status = -1;
  let stderr = "";
  try {
    execFileSync(process.execPath, [VERIFIER, "--capsule", capsuleDir], {
      encoding: "utf8",
      env: { PATH },
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    status = error.status;
    stderr = error.stderr ? error.stderr.toString() : "";
  }
  assert.notEqual(status, 0);
  assert.match(stderr, /XOT_RECOVERY_CAPSULE_FAIL/);
});
