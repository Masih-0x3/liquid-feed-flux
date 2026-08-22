#!/usr/bin/env node

// XOT recovery capsule creator (R1 bounded S1 candidate).
//
// Creates a sanitized, local-only Git recovery capsule that the independent
// verifier in `scripts/verify-xot-recovery-capsule.mjs` can reconstruct and
// prove byte-for-byte. The capsule contains only Git-visible state:
//
//   - refs.bundle       git bundle of all refs/ at the source HEAD
//   - tracked.patch     binary full-index patch (working tree vs HEAD)
//   - untracked/        exact copies of every Git-reported untracked path
//   - manifest.json     path inventory and source snapshot metadata
//
// Sensitive paths (.env files, credentials, keys, node_modules, .git) are
// excluded from the sanitized bundle and recorded as denylist hits. Staged
// changes are rejected so the working-tree patch applied by the verifier
// reconstructs the exact Git status.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import process from "node:process";

export const SCHEMA = "xot-recovery-capsule-v1";
export const RECEIPT_SCHEMA = "xot-recovery-capsule-receipt-v1";

const ALLOWED_ENV_EXAMPLES = new Set([
  ".env.example",
  ".env.template",
  ".env.sample",
]);

function sha256(input) {
  if (Buffer.isBuffer(input)) {
    return createHash("sha256").update(input).digest("hex");
  }
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function git(args, { cwd, encoding = "utf8", maxBuffer = 200 * 1024 * 1024 } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding, maxBuffer, stdio: "pipe" });
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? String(error.stderr ?? "");
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`);
  }
}

/**
 * Parse `git status --porcelain=v1 -uall -z` into status records.
 * Each record is `{ status, path, oldPath }`. Renames are represented by a
 * single record whose `path` is the destination and `oldPath` is the source.
 */
export function parseStatusZ(text) {
  const tokens = text.split("\0").filter((token) => token.length > 0);
  const entries = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i++];
    const status = token.slice(0, 2);
    const path = token.slice(3);
    const entry = { status, path };
    if (status[0] === "R" || status[1] === "R") {
      if (i < tokens.length) {
        entry.oldPath = tokens[i++];
      }
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Capture the sorted `git status --porcelain=v1 -uall -z` bytes for a repo.
 * The returned hash must match the verifier's captureGitStatus exactly.
 */
function captureGitStatus(cwd) {
  const raw = git(["status", "--porcelain=v1", "-uall", "-z"], { cwd });
  const parts = raw.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  const sorted = [...parts].sort().join("\n");
  const bytes = Buffer.from(sorted + "\n", "utf8");
  return { raw, bytes, sha256: sha256(bytes), sorted };
}

function headBlobs(cwd) {
  const output = git(["ls-tree", "-r", "-z", "HEAD"], { cwd });
  const map = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1);
    const [mode, , sha] = meta.split(" ");
    if (!mode || !sha || !path) continue;
    map.set(path, { mode, sha });
  }
  return map;
}

function getBranchAndHead(cwd) {
  const head = git(["rev-parse", "HEAD"], { cwd }).trim();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).trim();
  return { head, branch };
}

function getUpstream(cwd) {
  try {
    const out = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "HEAD@{u}"], { cwd }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getStash(cwd) {
  try {
    const out = git(["rev-parse", "--verify", "--quiet", "refs/stash"], { cwd }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getRefs(cwd, kind) {
  const out = git(["for-each-ref", "--format=%(refname:short)\t%(objectname)", `refs/${kind}`], { cwd });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha] = line.split("\t");
      return { name, sha };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getWorktrees(cwd) {
  try {
    return git(["worktree", "list", "--porcelain"], { cwd });
  } catch {
    return "";
  }
}

function getUnreachableCommits(cwd) {
  const output = git(["fsck", "--no-reflogs", "--unreachable"], { cwd });
  return output
    .split("\n")
    .filter((line) => /unreachable commit [0-9a-f]{40}/.test(line))
    .map((line) => line.match(/unreachable commit ([0-9a-f]{40})/)[1])
    .sort();
}

function assertSafePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (relativePath.startsWith("/") || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`path is invalid or traverses outside the repository: ${relativePath}`);
  }
}

function denylistReason(relativePath) {
  const basename = relativePath.split("/").pop();
  if (basename === ".env" || (basename.startsWith(".env") && !ALLOWED_ENV_EXAMPLES.has(basename))) {
    return "env-file";
  }
  if (/(^|\/)node_modules(\/|$)/.test(relativePath)) return "node-modules";
  if (/(^|\/)\.git(\/|$)/.test(relativePath)) return "git-dir";
  if (/\.(key|pem|p12|pfx)$/i.test(basename)) return "key-material";
  if (/^(id_rsa|id_ecdsa|id_ed25519|id_dsa)$/.test(basename)) return "ssh-private-key";
  return null;
}

function fileKind(stats) {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "unknown";
}

function hashEntry(fullPath) {
  const stats = lstatSync(fullPath);
  if (stats.isSymbolicLink()) {
    const target = readlinkSync(fullPath);
    return { sha256: sha256(target), target };
  }
  return { sha256: sha256(readFileSync(fullPath)), target: null };
}

function gitModeString(stats) {
  if (stats.isSymbolicLink()) return "120000";
  if (stats.isFile()) {
    const perms = (stats.mode & 0o777).toString(8).padStart(3, "0");
    return `100${perms}`;
  }
  return String(stats.mode.toString(8));
}

function copyEntry(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const stats = lstatSync(src);
  if (stats.isSymbolicLink()) {
    const target = readlinkSync(src);
    symlinkSync(target, dest);
  } else if (stats.isFile()) {
    cpSync(src, dest);
    chmodSync(dest, stats.mode & 0o777);
  } else if (stats.isDirectory()) {
    mkdirSync(dest, { recursive: true });
  }
}

function defaultOutputDir(repoRoot) {
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dirname(repoRoot), `xot-recovery-capsule-${now}`);
}

function hasStagedChanges(cwd) {
  try {
    git(["diff", "--cached", "--quiet"], { cwd });
    return false;
  } catch {
    return true;
  }
}

function buildPathRecord(repoRoot, entry, heads) {
  const fullPath = join(repoRoot, entry.path);
  const isUntracked = entry.status === "??";
  const isDeleted = entry.status[0] === "D" || entry.status[1] === "D";
  const headEntry = heads.get(entry.path) || (entry.oldPath ? heads.get(entry.oldPath) : undefined);

  if (isDeleted) {
    return {
      path: entry.path,
      status: entry.status,
      oldPath: entry.oldPath ?? null,
      type: "deletion",
      mode: headEntry?.mode ?? "100644",
      size: 0,
      contentId: null,
      headBlob: headEntry?.sha ?? null,
    };
  }

  const stats = lstatSync(fullPath);
  const kind = fileKind(stats);
  if (kind === "directory") {
    return {
      path: entry.path,
      status: entry.status,
      oldPath: entry.oldPath ?? null,
      type: "directory",
      mode: gitModeString(stats),
      size: 0,
      contentId: null,
      headBlob: null,
    };
  }

  const { sha256: fileHash, target } = hashEntry(fullPath);
  const contentId = kind === "symlink" ? target : fileHash;
  return {
    path: entry.path,
    status: entry.status,
    oldPath: entry.oldPath ?? null,
    type: kind,
    mode: kind === "symlink" ? "120000" : gitModeString(stats),
    size: kind === "symlink" ? 0 : stats.size,
    contentId,
    headBlob: isUntracked ? null : headEntry?.sha ?? null,
  };
}

export function createCapsule({ repo, out } = {}) {
  const repoRoot = resolve(repo || process.cwd());

  try {
    git(["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot });
  } catch {
    throw new Error(`not a git repository: ${repoRoot}`);
  }

  const actualRepoRoot = git(["rev-parse", "--show-toplevel"], { cwd: repoRoot }).trim();

  const outputDir = resolve(out || defaultOutputDir(actualRepoRoot));
  if (outputDir === actualRepoRoot || outputDir.startsWith(actualRepoRoot + sep)) {
    throw new Error(`output directory must be outside the source repository: ${outputDir}`);
  }

  if (existsSync(outputDir)) {
    throw new Error(`output directory already exists: ${outputDir}`);
  }

  if (hasStagedChanges(actualRepoRoot)) {
    throw new Error(
      "refusing to create a capsule with staged changes; unstage or commit before capture",
    );
  }

  mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  const { head, branch } = getBranchAndHead(actualRepoRoot);
  const upstream = getUpstream(actualRepoRoot);
  const stash = getStash(actualRepoRoot);
  const branches = getRefs(actualRepoRoot, "heads");
  const tags = getRefs(actualRepoRoot, "tags");
  const worktrees = getWorktrees(actualRepoRoot);

  const status = captureGitStatus(actualRepoRoot);
  const statusEntries = parseStatusZ(status.raw);
  const heads = headBlobs(actualRepoRoot);
  const unreachableCommits = getUnreachableCommits(actualRepoRoot);

  // Reject any tracked secret-like path before capture.
  for (const entry of statusEntries) {
    assertSafePath(entry.path);
    if (entry.oldPath) assertSafePath(entry.oldPath);
    const reason = denylistReason(entry.path);
    if (reason && entry.status !== "??") {
      throw new Error(
        `refusing to create a sanitized capsule with tracked secret-like path: ${entry.path} (${reason})`,
      );
    }
  }

  // Git recovery bundle of all refs plus currently unreachable commits. The
  // source refs are never changed; archiveRefs is a redacted name-to-object
  // map that lets the verifier prove those commits survive in the bundle.
  const bundlePath = join(outputDir, "refs.bundle");
  git(["bundle", "create", bundlePath, "--all", ...unreachableCommits], { cwd: actualRepoRoot });

  // Binary full-index working-tree patch relative to HEAD.
  const trackedPatch = git(["diff", "HEAD", "--binary", "--full-index", "--no-color"], {
    cwd: actualRepoRoot,
    encoding: "buffer",
  });
  const trackedPatchPath = join(outputDir, "tracked.patch");
  writeFileSync(trackedPatchPath, trackedPatch);

  // Exact copies of every untracked path, excluding denylisted ones.
  const untrackedDir = join(outputDir, "untracked");
  const denylistHits = [];
  const filteredEntries = [];

  for (const entry of statusEntries) {
    const reason = denylistReason(entry.path);
    if (reason) {
      if (entry.status === "??") {
        denylistHits.push(entry.path);
        continue;
      }
      // Tracked denylist was already rejected above; unreachable.
      continue;
    }

    if (entry.status === "??") {
      const fullPath = join(actualRepoRoot, entry.path);
      const dest = join(untrackedDir, entry.path);
      copyEntry(fullPath, dest);
    }

    filteredEntries.push(entry);
  }

  const pathRecords = [];
  for (const entry of filteredEntries) {
    if (entry.oldPath) {
      // The rename source is a deletion in the reconstructed tree.
      const oldHead = heads.get(entry.oldPath);
      if (oldHead) {
        pathRecords.push({
          path: entry.oldPath,
          status: "D ",
          oldPath: null,
          type: "deletion",
          mode: oldHead.mode,
          size: 0,
          contentId: null,
          headBlob: oldHead.sha,
        });
      }
    }
    pathRecords.push(buildPathRecord(actualRepoRoot, entry, heads));
  }

  const counts = {
    modified: 0,
    deleted: 0,
    untracked: 0,
    added: 0,
    renamed: 0,
    staged: 0,
    total: pathRecords.length,
  };

  for (const p of pathRecords) {
    const s = p.status;
    if (s[0] === "A" || s[1] === "A") counts.added += 1;
    if (s[0] === "D" || s[1] === "D") counts.deleted += 1;
    if (s[0] === "M" || s[1] === "M") counts.modified += 1;
    if (s[0] === "R" || s[1] === "R") counts.renamed += 1;
    if (s === "??") counts.untracked += 1;
    if (s[0] !== " " && s[0] !== "?") counts.staged += 1;
  }

  const manifest = {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    source: {
      repo: actualRepoRoot,
      outputDir,
      head,
      branch,
      upstream,
      statusSha256: status.sha256,
      statusCanonical: status.sorted,
      pathCount: pathRecords.length,
      stagedCount: hasStagedChanges(actualRepoRoot) ? 1 : 0,
    },
    paths: pathRecords.sort((a, b) => a.path.localeCompare(b.path)),
    denylist: { hits: denylistHits.sort((a, b) => a.localeCompare(b)) },
    metadata: {
      stash,
      branches,
      tags,
      worktrees: worktrees.split("\n").filter(Boolean),
      unreachableCommits,
      archiveRefs: unreachableCommits.map((sha, index) => ({
        name: `archive/xot-pre-recovery/unreachable-${index + 1}`,
        sha,
      })),
    },
  };

  const finalStatus = captureGitStatus(actualRepoRoot);
  if (finalStatus.sha256 !== status.sha256 || finalStatus.sorted !== status.sorted) {
    throw new Error("source worktree changed during capsule creation; discard this capsule and retry");
  }
  if (hasStagedChanges(actualRepoRoot)) {
    throw new Error("staged changes appeared during capsule creation");
  }
  manifest.source.statusSha256 = finalStatus.sha256;

  const manifestPath = join(outputDir, "manifest.json");
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(manifestPath, manifestText);
  const manifestSha256 = sha256(manifestText);
  const bundleSha256 = sha256(readFileSync(bundlePath));
  const trackedPatchSha256 = sha256(trackedPatch);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    createdAt: manifest.createdAt,
    sourceRepo: actualRepoRoot,
    outputDir,
    manifestSha256,
    bundleSha256,
    trackedPatchSha256,
    statusSha256: status.sha256,
    head,
    branch,
    upstream,
    counts: {
      modified: counts.modified,
      deleted: counts.deleted,
      untracked: counts.untracked,
      staged: counts.staged,
      added: counts.added,
      renamed: counts.renamed,
      total: counts.total,
    },
  };
  writeFileSync(join(outputDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");

  return {
    outputDir,
    manifestPath,
    manifestSha256,
    bundleSha256,
    trackedPatchSha256,
    statusSha256: status.sha256,
    counts,
    head,
    branch,
    upstream,
  };
}

function main() {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      repo: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(`Usage: node scripts/create-xot-recovery-capsule.mjs [options]

Options:
  --repo <path>              Source git repository (default: current directory)
  --out <path>               Capsule output directory (default: sibling of repo)
  --help                     Show this help`);
    process.exit(0);
  }

  const summary = createCapsule({
    repo: values.repo,
    out: values.out,
  });

  console.log(
    `XOT_RECOVERY_CAPSULE_CREATED outputDir=${summary.outputDir} manifestSha256=${summary.manifestSha256} statusSha256=${summary.statusSha256} head=${summary.head} branch=${summary.branch} counts=${JSON.stringify(summary.counts)}`,
  );
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`XOT_RECOVERY_CAPSULE_ERROR ${error.message}`);
    process.exit(1);
  }
}
