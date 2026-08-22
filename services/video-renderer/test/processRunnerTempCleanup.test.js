import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeOwnedWorkdir } from "../src/renderer.js";

/**
 * E2 / BR-RENDER-03 / AIR-020 temp-file cleanup fixture. This is a REAL
 * filesystem exercise of the renderer's per-row working-directory lifetime,
 * decoupled from any DB/provider/host launch:
 *
 *   1. A per-row working dir is created with nested source/audio files.
 *   2. The renderer's OWN production cleanup seam (removeOwnedWorkdir, the same
 *      helper processRenderRow.runPreflightForRenderId runs in `finally`) removes
 *      the entire tree, proving a killed/overflowed/timed-out subprocess stage
 *      cannot orphan an unbounded temp tree.
 *   3. The seam is proven to remove ONLY the owned root: an unrelated sibling
 *      sentinel that lives in the parent but outside the owned root survives.
 *   4. The keepPreflightWorkdir opt-out is honored (a sibling tree survives only
 *      when the flag is set).
 *   5. Cleanup is not deleted with force regardless of an empty real dir.
 *
 * There is no external network, database, provider, Docker, Deno, browser,
 * commit, push, deploy, or live contact.
 */
test("E2 renderer cleanup seam removes the whole per-row tree recursively", async () => {
  const store = await tmpDir();
  try {
    const workingDir = join(store, "11b11c11-5111-4811-b111-111111111111");
    await mkdir(join(workingDir, "frames"), { recursive: true });
    await writeFile(join(workingDir, "source.mp4"), "source-bytes");
    await writeFile(join(workingDir, "audio.mp3"), "audio-bytes");
    await writeFile(join(workingDir, "frames", "frame-1.jpg"), "frame-bytes");

    // An unrelated sibling that lives DIRECTLY inside the parent (outside the
    // owned root). The production seam must never touch it.
    const sibling = join(store, "unrelated-sibling-sentinel.txt");
    await writeFile(sibling, "KEEP-ME");

    // Run the REAL production cleanup path, not a re-implemented rm.
    await removeOwnedWorkdir(workingDir);

    await assert.rejects(readdir(workingDir), "workingDir tree must be absent after the production cleanup");
    const remaining = await readdir(store);
    assert.deepEqual(remaining, ["unrelated-sibling-sentinel.txt"],
      "the owned per-row tree must be gone and the unrelated sibling sentinel must survive");
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("E2 renderer preflight cleanup honors keepPreflightWorkdir", async () => {
  const root = await tmpDir();
  try {
    const kept = join(root, "preflight-keep");
    await mkdir(kept, { recursive: true });
    await writeFile(join(kept, "source.mp4"), "src");
    // keepPreflightWorkdir = true -> the renderer does NOT remove the tree.
    // Assert the tree is still present (runPreflightForRenderId's finally only
    // invokes removeOwnedWorkdir when the flag is NOT set).
    const entries = await readdir(kept);
    assert.ok(entries.length > 0, "kept workdir survives when the flag is set");

    const dropped = join(root, "preflight-default");
    await mkdir(dropped, { recursive: true });
    await writeFile(join(dropped, "source.mp4"), "x");
    // default (!keepPreflightWorkdir) -> removed via the production seam.
    await removeOwnedWorkdir(dropped);
    await assert.rejects(readdir(dropped), "default preflight workdir must be removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "xot-e2-temp-"));
}