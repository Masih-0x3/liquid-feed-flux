// 0X3-672 W5 benchmark: paired interleaved run.
// For each clip: run BEFORE then AFTER back-to-back so sustained host load
// affects both revisions nearly equally. The delta per pair is the signal.

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const beforeSrc = arg("before");
const afterSrc = arg("after");
const cohortDir = arg("cohort", "/bench/cohort");
const outRoot = arg("out", "/bench/out");
const only = arg("only");
const round = arg("round", "p1");

if (!beforeSrc || !afterSrc) {
  console.error("usage: run-paired.mjs --before <src> --after <src> [--round p2] [--only a,b]");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(join(cohortDir, "manifest.json"), "utf8"));
const clips = manifest.clips.filter((c) => !only || only.split(",").includes(c.name));

async function runOne(src, rev, clip) {
  const workRoot = `/tmp/bench-work/${rev}`;
  const outDir = join(outRoot, `${rev}-${round}`);
  await mkdir(outDir, { recursive: true });
  await mkdir(workRoot, { recursive: true });
  try {
    const { stdout } = await execFileAsync("node", [
      join(HERE, "run-clip.mjs"),
      "--src", src,
      "--cohort", cohortDir,
      "--clip", clip.name,
      "--workdir", workRoot,
      "--out", outDir,
    ], { maxBuffer: 16 * 1024 * 1024, env: process.env });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    return { clip: clip.name, ok: false, error: error.message.slice(0, 300) };
  }
}

const pairs = [];
for (const clip of clips) {
  const t0 = Date.now();
  const b = await runOne(beforeSrc, "before", clip);
  const mid = Date.now();
  const a = await runOne(afterSrc, "after", clip);
  const end = Date.now();
  pairs.push({ clip: clip.name, before: b, after: a, wall_ms: end - t0 });
  console.log(`${clip.name}: before=${b.total_ms ?? "-"}ms(${b.ok ? "ok" : "FAIL"}) after=${a.total_ms ?? "-"}ms(${a.ok ? "ok" : "FAIL"}) delta=${(a.total_ms ?? 0) - (b.total_ms ?? 0)}ms b=${mid - t0}ms a=${end - mid}ms`);
}

await writeFile(
  join(outRoot, `paired-${round}.jsonl`),
  pairs.map((p) => JSON.stringify(p)).join("\n") + "\n",
);
const okPairs = pairs.filter((p) => p.before.ok && p.after.ok).length;
console.log(`paired ${round}: ${okPairs}/${pairs.length} pairs both-ok`);
