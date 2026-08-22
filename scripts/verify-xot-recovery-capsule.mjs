#!/usr/bin/env node

// XOT recovery capsule verifier (R1 bounded S1 candidate).
//
// This script is the independent restore+verify half of the R1 recovery
// capsule contract. It does NOT depend on the creator implementation
// (`scripts/create-xot-recovery-capsule.mjs`) and never touches the live
// repository. It reconstructs the capsule's Git-visible state in a fresh
// temporary checkout and proves the restored state and path inventory match
// the capsule manifest.
//
// Capsule layout (contract `xot-recovery-capsule-v1`):
//   <capsule>/
//     manifest.json     path inventory + source snapshot metadata
//     refs.bundle       `git bundle` of all reachable/archived refs
//     tracked.patch     binary full-index patch (`git diff HEAD --binary`)
//     untracked/        exact copies of every Git-reported untracked path
//
// Validation is deliberately practical: one Git-visible-state proof
// (reconstructed `git status --porcelain=v1 -uall` bytes equal the manifest
// snapshot hash) plus one content/inventory proof (every manifest path
// restores with the recorded type and content id). No repeated hash ceremony.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const CAPSULE_SCHEMA = "xot-recovery-capsule-v1";
const PATH = process.env.PATH ?? "/usr/bin:/bin";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(repoDir, args, { expectZero = true } = {}) {
  try {
    return execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      env: { PATH },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (expectZero) {
      const stderr = error.stderr ? error.stderr.toString().trim() : "";
      throw new Error(
        `git ${args.join(" ")} failed in ${repoDir}${stderr ? `: ${stderr}` : ""}`,
      );
    }
    return error.stdout ? error.stdout.toString() : "";
  }
}

/**
 * Capture the sorted `git status --porcelain=v1 -uall` bytes for a repo.
 * Uses `-z` (null-separated, unquoted paths) so paths with spaces or special
 * characters survive intact, then sorts entries for a stable snapshot hash.
 */
export function captureGitStatus(repoDir) {
  const raw = git(repoDir, ["status", "--porcelain=v1", "-uall", "-z"]);
  const parts = raw.split("\0");
  // `-z` terminates with a trailing NUL → one empty trailing element.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  // Renames in `-z` emit `XY src\0dst`; this capsule contract has no renames,
  // so every remaining part is a single `XY path` entry.
  const sorted = [...parts].sort().join("\n");
  const bytes = Buffer.from(sorted + "\n", "utf8");
  const lines = sorted ? sorted.split("\n") : [];
  const stagedCount = lines.filter((line) => line[0] !== " " && line[0] !== "?").length;
  return { bytes, sha256: sha256(bytes), lines, stagedCount };
}

function assertSafeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
    throw new Error(`invalid manifest path: ${String(path)}`);
  }
  const parts = path.split(/[\\/]/);
  if (parts.includes("..") || parts.includes(".")) {
    throw new Error(`manifest path traverses outside the checkout: ${path}`);
  }
}

function readManifest(capsuleDir) {
  const manifestPath = join(capsuleDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`capsule manifest not found at ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`capsule manifest is not valid JSON: ${error.message}`);
  }
  if (parsed.schema !== CAPSULE_SCHEMA) {
    throw new Error(
      `capsule manifest schema mismatch: expected ${CAPSULE_SCHEMA}, got ${String(parsed.schema)}`,
    );
  }
  if (!parsed.source || typeof parsed.source.statusSha256 !== "string") {
    throw new Error("capsule manifest missing required source.statusSha256");
  }
  if (!Array.isArray(parsed.paths)) {
    throw new Error("capsule manifest missing required paths array");
  }
  const paths = new Set();
  for (const entry of parsed.paths) {
    assertSafeRelativePath(entry.path);
    if (paths.has(entry.path)) throw new Error(`duplicate manifest path: ${entry.path}`);
    paths.add(entry.path);
  }
  if (parsed.source.stagedCount !== 0) {
    throw new Error("capsule source contains staged changes");
  }
  return parsed;
}

function denylistHits(manifest) {
  const hits = manifest.denylist && Array.isArray(manifest.denylist.hits)
    ? manifest.denylist.hits
    : [];
  return hits;
}

function cloneFromBundle(capsuleDir, outDir) {
  const bundle = join(capsuleDir, "refs.bundle");
  if (!existsSync(bundle)) {
    throw new Error("capsule missing refs.bundle");
  }
  // Clone into a fresh checkout. The bundle carries the branch ref so the
  // working tree is checked out at the recorded HEAD.
  execFileSync("git", ["clone", "--quiet", bundle, outDir], {
    encoding: "utf8",
    env: { PATH },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function applyTrackedPatch(capsuleDir, outDir) {
  const patch = join(capsuleDir, "tracked.patch");
  if (!existsSync(patch)) {
    throw new Error("capsule missing tracked.patch");
  }
  const bytes = readFileSync(patch);
  // An empty patch means no tracked working-tree changes; skip cleanly.
  if (bytes.length === 0 || bytes.toString("utf8").trim() === "") return false;
  // Apply the binary full-index patch relative to the fresh checkout.
  execFileSync("git", ["-C", outDir, "apply", "--binary", "--whitespace=nowarn", patch], {
    encoding: "utf8",
    env: { PATH },
    maxBuffer: 64 * 1024 * 1024,
  });
  return true;
}

function restoreUntracked(capsuleDir, outDir) {
  const untrackedRoot = join(capsuleDir, "untracked");
  if (!existsSync(untrackedRoot)) return 0;
  let count = 0;
  const visit = (srcDir, relDir) => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const srcPath = join(srcDir, entry.name);
      const destPath = join(outDir, relPath);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(srcPath);
        mkdirSync(dirname(destPath), { recursive: true });
        symlinkSync(target, destPath);
        count += 1;
      } else if (entry.isDirectory()) {
        visit(srcPath, relPath);
      } else if (entry.isFile()) {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath);
        chmodSync(destPath, lstatSync(srcPath).mode & 0o777);
        count += 1;
      }
    }
  };
  visit(untrackedRoot, "");
  return count;
}

function listUntrackedPayload(capsuleDir) {
  const root = join(capsuleDir, "untracked");
  const paths = [];
  if (!existsSync(root)) return paths;
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full, path);
      else paths.push(path);
    }
  };
  visit(root, "");
  return paths.sort();
}

function manifestUntrackedPaths(manifest) {
  return manifest.paths.filter((entry) => entry.status === "??").map((entry) => entry.path).sort();
}

function verifyArchiveObjects(restoredDir, manifest) {
  const metadata = manifest.metadata ?? {};
  const commits = Array.isArray(metadata.unreachableCommits) ? metadata.unreachableCommits : [];
  const errors = [];
  for (const sha of commits) {
    try {
      git(restoredDir, ["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      errors.push(`archive commit missing from bundle: ${sha}`);
    }
  }
  if (metadata.stash) {
    try {
      git(restoredDir, ["cat-file", "-e", `${metadata.stash}^{commit}`]);
    } catch {
      errors.push(`stash commit missing from bundle: ${metadata.stash}`);
    }
  }
  return errors;
}

/**
 * Verify a single restored path against its manifest inventory entry.
 * Returns null on match or an error string describing the mismatch.
 */
function verifyPathEntry(restoredDir, entry) {
  const restoredPath = join(restoredDir, entry.path);
  if (entry.type === "deletion") {
    if (lstatSync(restoredPath, { throwIfNoEntry: false })) {
      return `path ${entry.path}: expected deletion but file exists`;
    }
    // A deleted tracked file may leave a dangling symlink in rare cases; the
    // git status proof below is the authoritative deletion witness.
    return null;
  }
  const stat = lstatSync(restoredPath, { throwIfNoEntry: false });
  if (!stat) {
    return `path ${entry.path}: expected ${entry.type} but missing`;
  }
  if (entry.type === "symlink") {
    if (!stat.isSymbolicLink()) {
      return `path ${entry.path}: expected symlink, got ${stat.isFile() ? "file" : "other"}`;
    }
    const target = readlinkSync(restoredPath);
    if (target !== entry.contentId) {
      return `path ${entry.path}: symlink target mismatch`;
    }
    if (entry.mode !== "120000") return `path ${entry.path}: symlink mode mismatch`;
    return null;
  }
  if (entry.type === "file") {
    if (!stat.isFile()) {
      return `path ${entry.path}: expected file, got ${stat.isSymbolicLink() ? "symlink" : "other"}`;
    }
    const content = readFileSync(restoredPath);
    if (sha256(content) !== entry.contentId) {
      return `path ${entry.path}: content hash mismatch`;
    }
    const mode = `100${(stat.mode & 0o777).toString(8).padStart(3, "0")}`;
    if (mode !== entry.mode) return `path ${entry.path}: file mode mismatch`;
    if (stat.size !== entry.size) return `path ${entry.path}: file size mismatch`;
    return null;
  }
  return `path ${entry.path}: unknown type ${String(entry.type)}`;
}

/**
 * Restore a capsule into a fresh temporary checkout.
 * Returns { ok, restoredDir, manifest, errors }.
 * The caller owns cleanup of restoredDir unless `keep` is set.
 */
export function restoreCapsule(capsuleDir, outDir) {
  const errors = [];
  const manifest = (() => {
    try {
      return readManifest(capsuleDir);
    } catch (error) {
      errors.push(error.message);
      return null;
    }
  })();
  if (!manifest) return { ok: false, restoredDir: null, manifest: null, errors };

  const denylist = denylistHits(manifest);
  if (denylist.length > 0) {
    // Fail closed: a denylist hit means a sensitive path entered the capsule.
    // Record paths only, never values.
    errors.push(`denylist hit: capsule contains ${denylist.length} sensitive path(s)`);
    for (const hit of denylist) errors.push(`denylist path: ${hit}`);
    return { ok: false, restoredDir: null, manifest, errors };
  }

  const restoredDir = outDir ?? mkdtempSync(join(tmpdir(), "xot-capsule-restore-"));
  try {
    cloneFromBundle(capsuleDir, restoredDir);
    applyTrackedPatch(capsuleDir, restoredDir);
    restoreUntracked(capsuleDir, restoredDir);
    return { ok: true, restoredDir, manifest, errors };
  } catch (error) {
    errors.push(error.message);
    return { ok: false, restoredDir, manifest, errors };
  }
}

/**
 * Full verification: restore, then prove Git-visible state and path inventory
 * match the capsule manifest. Returns a redacted receipt (no file contents).
 */
export function verifyCapsule(capsuleDir, { outDir, keep = false } = {}) {
  const errors = [];
  let restoredDir = null;
  let manifest = null;
  let statusResult = null;
  let inventoryChecked = 0;

  const restore = restoreCapsule(capsuleDir, outDir);
  restoredDir = restore.restoredDir;
  manifest = restore.manifest;
  errors.push(...restore.errors);

  if (restore.ok) {
    // 1. Git-visible state proof: reconstructed status bytes must equal the
    //    manifest snapshot hash.
    try {
      statusResult = captureGitStatus(restoredDir);
      if (statusResult.sha256 !== manifest.source.statusSha256) {
        errors.push(
          `git status hash mismatch: restored=${statusResult.sha256} manifest=${manifest.source.statusSha256}`,
        );
      }
      if (statusResult.stagedCount !== 0) {
        errors.push(`restored checkout has ${statusResult.stagedCount} staged path(s)`);
      }
    } catch (error) {
      errors.push(`git status capture failed: ${error.message}`);
    }

    // 2. Content/inventory proof: every manifest path restores with the
    //    recorded type and content id. One clear check, no layered re-hashing.
    for (const entry of manifest.paths) {
      const problem = verifyPathEntry(restoredDir, entry);
      if (problem) errors.push(problem);
      inventoryChecked += 1;
    }
    const expectedPayload = manifestUntrackedPaths(manifest);
    const actualPayload = listUntrackedPayload(capsuleDir);
    if (JSON.stringify(expectedPayload) !== JSON.stringify(actualPayload)) {
      errors.push("untracked payload inventory mismatch");
    }
    errors.push(...verifyArchiveObjects(restoredDir, manifest));
  }

  const ok = errors.length === 0;
  const receipt = {
    schema: CAPSULE_SCHEMA,
    ok,
    capsuleDir: isAbsolute(capsuleDir) ? capsuleDir : relative(process.cwd(), resolve(capsuleDir)) || ".",
    restoredDir: restoredDir
      ? (isAbsolute(restoredDir) ? restoredDir : relative(process.cwd(), restoredDir))
      : null,
    sourceHead: manifest?.source?.head ?? null,
    sourceBranch: manifest?.source?.branch ?? null,
    statusSha256: statusResult?.sha256 ?? null,
    expectedStatusSha256: manifest?.source?.statusSha256 ?? null,
    pathCount: manifest?.source?.pathCount ?? null,
    inventoryChecked,
    denylistHits: manifest ? denylistHits(manifest).length : null,
    errors,
  };

  if (restoredDir && !keep) {
    try {
      rmSync(restoredDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; report but do not flip the verification verdict.
      receipt.cleanupError = true;
    }
  }
  return receipt;
}

function parseArgv(argv) {
  const capsuleIndex = argv.indexOf("--capsule");
  const outIndex = argv.indexOf("--out");
  const capsule = capsuleIndex !== -1 ? argv[capsuleIndex + 1] : process.env.XOT_RECOVERY_CAPSULE_DIR;
  const out = outIndex !== -1 ? argv[outIndex + 1] : process.env.XOT_RECOVERY_CAPSULE_RESTORE_DIR;
  const keep = argv.includes("--keep");
  return { capsule, out, keep };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { capsule, out, keep } = parseArgv(process.argv.slice(2));
  if (!capsule) {
    console.error("usage: verify-xot-recovery-capsule.mjs --capsule <dir> [--out <dir>] [--keep]");
    process.exit(2);
  }
  const receipt = verifyCapsule(capsule, { outDir: out, keep });
  if (receipt.ok) {
    console.log(
      `XOT_RECOVERY_CAPSULE_PASS head=${receipt.sourceHead} paths=${receipt.inventoryChecked}`
      + ` status=${receipt.statusSha256?.slice(0, 12)}`
      + (keep && receipt.restoredDir ? ` restored=${receipt.restoredDir}` : ""),
    );
    process.exit(0);
  }
  for (const error of receipt.errors) console.error(error);
  console.error("XOT_RECOVERY_CAPSULE_FAIL");
  process.exit(1);
}
