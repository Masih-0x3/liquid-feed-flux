// 0X3-672 W5 benchmark: run the full cohort through one renderer revision.
// Spawns a fresh node process per clip so module state and fetch stubs never
// leak between renders. Writes results-<rev>.jsonl under /bench/out.

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const rendererSrc = arg("src");
const rev = arg("rev", "rev");
const cohortDir = arg("cohort", "/bench/cohort");
const outRoot = arg("out", "/bench/out");
const workRoot = arg("workdir", `/bench/work/${rev}`);
const only = arg("only"); // comma list for smoke runs

if (!rendererSrc) {
  console.error("usage: run-cohort.mjs --src <renderer-src> --rev <name> [--only clip-01,clip-02]");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(join(cohortDir, "manifest.json"), "utf8"));
const clips = manifest.clips.filter((c) => !only || only.split(",").includes(c.name));

// Truncate on grapheme boundaries — a raw code-unit slice can split a
// surrogate pair and corrupt the recorded error text.
const graphemes = new Intl.Segmenter();
function clipText(value, max = 300) {
  let out = "";
  for (const seg of graphemes.segment(String(value))) {
    if (out.length + seg.segment.length > max) break;
    out += seg.segment;
  }
  return out;
}

const outDir = join(outRoot, rev);
await mkdir(outDir, { recursive: true });
await mkdir(workRoot, { recursive: true });

const results = [];
for (const clip of clips) {
  const t0 = Date.now();
  try {
    const { stdout } = await execFileAsync("node", [
      join(HERE, "run-clip.mjs"),
      "--src", rendererSrc,
      "--cohort", cohortDir,
      "--clip", clip.name,
      "--workdir", workRoot,
      "--out", outDir,
    ], { maxBuffer: 16 * 1024 * 1024, env: process.env });
    const line = stdout.trim().split("\n").pop();
    results.push(JSON.parse(line));
  } catch (error) {
    results.push({ clip: clip.name, ok: false, error: clipText(error.message) });
  }
  const last = results[results.length - 1];
  console.log(`[${rev}] ${clip.name} ${last.ok ? "ok" : "FAIL"} ${last.total_ms ?? "-"}ms wall=${Date.now() - t0}ms ${last.error ?? ""}`);
}

const jsonl = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
await writeFile(join(outRoot, `results-${rev}.jsonl`), jsonl);
const okCount = results.filter((r) => r.ok).length;
console.log(`[${rev}] done: ${okCount}/${results.length} ok`);
