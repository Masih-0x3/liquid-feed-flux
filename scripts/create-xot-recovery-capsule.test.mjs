import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createCapsule, parseStatusZ } from "./create-xot-recovery-capsule.mjs";
import { captureGitStatus, verifyCapsule } from "./verify-xot-recovery-capsule.mjs";

const PATH = process.env.PATH ?? "/usr/bin:/bin";
const CREATOR = join(dirname(fileURLToPath(import.meta.url)), "create-xot-recovery-capsule.mjs");
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function dirtyFixture() {
  const repoDir = newRepo("xot-capsule-src-");
  mkdirSync(join(repoDir, "tracked"), { recursive: true });
  writeFileSync(join(repoDir, "tracked", "keep.txt"), "initial\n");
  writeFileSync(join(repoDir, "tracked", "doomed.txt"), "goodbye\n");
  commit(repoDir, "initial commit");

  // Tracked working-tree changes (no staging).
  writeFileSync(join(repoDir, "tracked", "keep.txt"), "modified\n");
  rmSync(join(repoDir, "tracked", "doomed.txt"));

  // Untracked files: text, binary, symlink, nested, and path with a space.
  mkdirSync(join(repoDir, "untracked"), { recursive: true });
  writeFileSync(join(repoDir, "untracked", "new.txt"), "fresh content\n");
  writeFileSync(join(repoDir, "untracked", "blob.bin"), Buffer.from([0x00, 0xff, 0x10, 0x20, 0x80, 0x7f]));
  mkdirSync(join(repoDir, "untracked", "nested"), { recursive: true });
  writeFileSync(join(repoDir, "untracked", "nested", "deep.txt"), "deep\n");
  symlinkSync("../tracked/keep.txt", join(repoDir, "untracked", "link"));
  writeFileSync(join(repoDir, "untracked", "with space.txt"), "has spaces\n");

  return repoDir;
}

function expectedCapsuleFiles(capsuleDir) {
  assert.equal(existsSync(join(capsuleDir, "manifest.json")), true);
  assert.equal(existsSync(join(capsuleDir, "refs.bundle")), true);
  assert.equal(existsSync(join(capsuleDir, "tracked.patch")), true);
  assert.equal(existsSync(join(capsuleDir, "receipt.json")), true);
}

test("parseStatusZ handles tracked, deleted, untracked, and renamed -z entries", () => {
  // Mimics raw `git status --porcelain=v1 -uall -z` output (NUL terminated).
  const raw = [
    " M tracked/keep.txt",
    "?? untracked/new.txt",
    " D tracked/doomed.txt",
    "R  renamed.txt",
    "old-name.txt",
  ].join("\0") + "\0";

  const entries = parseStatusZ(raw);
  assert.equal(entries.length, 4);

  assert.deepEqual(entries[0], { status: " M", path: "tracked/keep.txt" });
  assert.deepEqual(entries[1], { status: "??", path: "untracked/new.txt" });
  assert.deepEqual(entries[2], { status: " D", path: "tracked/doomed.txt" });
  assert.deepEqual(entries[3], { status: "R ", path: "renamed.txt", oldPath: "old-name.txt" });
});

test("createCapsule throws for a non-git directory", () => {
  const dir = temp("xot-not-git-");
  assert.throws(() => createCapsule({ repo: dir }), /not a git repository/);
});

test("createCapsule writes manifest, refs.bundle, tracked.patch, untracked mirror, and receipt", () => {
  const repoDir = dirtyFixture();
  const out = join(dirname(repoDir), `xot-capsule-files-${Date.now()}`);
  const summary = createCapsule({ repo: repoDir, out });
  track(out);

  expectedCapsuleFiles(out);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.schema, "xot-recovery-capsule-v1");
  assert.equal(manifest.source.head, summary.head);
  assert.equal(manifest.source.branch, summary.branch);
  assert.equal(manifest.source.statusSha256, summary.statusSha256);
  assert.equal(Array.isArray(manifest.paths), true);
  assert.equal(manifest.paths.length, summary.counts.total);
  assert.equal(manifest.denylist.hits.length, 0);
});

test("createCapsule status hash matches the verifier's captureGitStatus", () => {
  const repoDir = dirtyFixture();
  const out = join(dirname(repoDir), `xot-capsule-hash-${Date.now()}`);
  const summary = createCapsule({ repo: repoDir, out });
  track(out);

  const expected = captureGitStatus(repoDir);
  assert.equal(summary.statusSha256, expected.sha256);
});

test("round-trip: a created capsule verifies with the verifier", () => {
  const repoDir = dirtyFixture();
  const out = join(dirname(repoDir), `xot-capsule-roundtrip-${Date.now()}`);
  createCapsule({ repo: repoDir, out });
  track(out);

  const receipt = verifyCapsule(out);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.errors, null, 2));
  assert.equal(receipt.statusSha256, receipt.expectedStatusSha256);
  assert.equal(receipt.inventoryChecked, receipt.pathCount);
  assert.equal(receipt.denylistHits, 0);
});

test("round-trip with deletion, binary, symlink, and path-with-space restores exactly", () => {
  const repoDir = dirtyFixture();
  const out = join(dirname(repoDir), `xot-capsule-types-${Date.now()}`);
  createCapsule({ repo: repoDir, out });
  track(out);

  const receipt = verifyCapsule(out, { keep: true });
  track(receipt.restoredDir);
  assert.equal(receipt.ok, true, JSON.stringify(receipt.errors, null, 2));

  const restored = receipt.restoredDir;
  assert.equal(readFileSync(join(restored, "tracked", "keep.txt"), "utf8"), "modified\n");
  assert.equal(existsSync(join(restored, "tracked", "doomed.txt")), false);
  assert.equal(readFileSync(join(restored, "untracked", "new.txt"), "utf8"), "fresh content\n");
  assert.deepEqual(
    [...readFileSync(join(restored, "untracked", "blob.bin"))],
    [0x00, 0xff, 0x10, 0x20, 0x80, 0x7f],
  );
  assert.equal(readFileSync(join(restored, "untracked", "nested", "deep.txt"), "utf8"), "deep\n");
  assert.equal(readlinkSync(join(restored, "untracked", "link")), "../tracked/keep.txt");
  assert.equal(readFileSync(join(restored, "untracked", "with space.txt"), "utf8"), "has spaces\n");
});

test("createCapsule rejects staged changes", () => {
  const repoDir = newRepo("xot-staged-");
  writeFileSync(join(repoDir, "file.txt"), "initial\n");
  commit(repoDir, "initial");
  writeFileSync(join(repoDir, "file.txt"), "staged\n");
  git(repoDir, ["add", "file.txt"]);

  assert.throws(
    () => createCapsule({ repo: repoDir, out: join(dirname(repoDir), `xot-staged-out-${Date.now()}`) }),
    /staged changes/,
  );
});

test("createCapsule records untracked .env.local as a denylist hit", () => {
  const repoDir = newRepo("xot-denylist-");
  writeFileSync(join(repoDir, "safe.txt"), "safe\n");
  commit(repoDir, "initial");
  writeFileSync(join(repoDir, ".env.local"), "SECRET=1\n");
  writeFileSync(join(repoDir, "safe-new.txt"), "new\n");

  const out = join(dirname(repoDir), `xot-denylist-out-${Date.now()}`);
  const summary = createCapsule({ repo: repoDir, out });
  track(out);

  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.denylist.hits, [".env.local"]);
  assert.equal(existsSync(join(out, "untracked", ".env.local")), false);
  // The rest of the untracked payload is still present.
  assert.equal(existsSync(join(out, "untracked", "safe-new.txt")), true);
  // Verification fails closed because a denylisted path was in the source status.
  const receipt = verifyCapsule(out);
  assert.equal(receipt.ok, false);
  assert.match(receipt.errors.join("\n"), /denylist/);
});

test("createCapsule rejects tracked .env-like secret paths", () => {
  const repoDir = newRepo("xot-tracked-secret-");
  writeFileSync(join(repoDir, "id_rsa"), "private-key\n");
  git(repoDir, ["add", "id_rsa"]);
  commit(repoDir, "initial");
  writeFileSync(join(repoDir, "id_rsa"), "modified-private-key\n");

  assert.throws(
    () => createCapsule({ repo: repoDir, out: join(dirname(repoDir), `xot-secret-out-${Date.now()}`) }),
    /tracked secret-like path/,
  );
});

test("CLI prints XOT_RECOVERY_CAPSULE_CREATED and exits 0 for a valid fixture", () => {
  const repoDir = dirtyFixture();
  const out = join(dirname(repoDir), `xot-capsule-cli-${Date.now()}`);
  const result = spawnSync(process.execPath, [CREATOR, "--repo", repoDir, "--out", out], {
    encoding: "utf8",
    env: { ...process.env, PATH },
    timeout: 120000,
  });
  track(out);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /XOT_RECOVERY_CAPSULE_CREATED/);
  expectedCapsuleFiles(out);
});
