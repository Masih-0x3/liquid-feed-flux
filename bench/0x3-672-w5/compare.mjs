// 0X3-672 W5 benchmark: compare before/after results.
// p50/p95 on total + stage timings; quality equivalence via ffprobe on the
// uploaded outputs (duration, audio presence, size cap, subtitle mode).

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUT = process.env.BENCH_OUT || new URL("../out", import.meta.url).pathname;
const COHORT = process.env.COHORT_DIR || new URL("../cohort", import.meta.url).pathname;
const FFPROBE = process.env.FFPROBE || "ffprobe";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const revA = arg("a", "before");
const revB = arg("b", "after");
const doProbe = process.argv.includes("--probe");

async function loadResults(rev) {
  const raw = await readFile(join(OUT, `results-${rev}.jsonl`), "utf8");
  const rows = raw.trim().split("\n").map(JSON.parse);
  const map = new Map();
  for (const row of rows) map.set(row.clip, row);
  // merge per-clip detail files (carry metrics + uploads)
  for (const row of rows) {
    try {
      const detail = JSON.parse(await readFile(join(OUT, rev, `${row.clip}.result.json`), "utf8"));
      map.set(row.clip, { ...row, ...detail });
    } catch { /* keep summary row */ }
  }
  return map;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

const STAGES = [
  "total_ms",
  "download_ms",
  "probe_ms",
  "preflight_visual_ms",
  "contact_sheet_ms",
  "vision_frames_ms",
  "vision_inspection_sheets_ms",
  "watermark_vision_ms",
  "local_ocr_ms",
  "audio_extract_ms",
  "transcription_ms",
  "transcript_cleanup_ms",
  "translation_ms",
  "subtitle_generate_ms",
  "encode_ms",
  "upload_ms",
];

const manifest = JSON.parse(await readFile(join(COHORT, "manifest.json"), "utf8"));
const clipMeta = new Map(manifest.clips.map((c) => [c.name, c]));

const before = await loadResults(revA);
const after = await loadResults(revB);

console.log(`\n=== ${revA} vs ${revB} ===\n`);
console.log("clip                 bucket  before_ms  after_ms   delta  quality");
const deltas = [];
const qualityIssues = [];

for (const clip of manifest.clips) {
  const a = before.get(clip.name);
  const b = after.get(clip.name);
  if (!a || !b) { qualityIssues.push(`${clip.name}: missing result`); continue; }
  const totalA = a.metrics?.total_ms ?? a.total_ms;
  const totalB = b.metrics?.total_ms ?? b.total_ms;
  const delta = Number.isFinite(totalA) && Number.isFinite(totalB) ? totalB - totalA : null;
  if (delta !== null) deltas.push(delta);

  let qual = "ok";
  const issues = [];
  if (a.ok !== b.ok) issues.push(`ok ${a.ok}->${b.ok}`);
  if ((a.metrics?.no_subtitle_reason ?? null) !== (b.metrics?.no_subtitle_reason ?? null) &&
      clip.audio) issues.push("subtitle_reason_diff");
  const upA = a.uploads?.[0]?.bytes ?? null;
  const upB = b.uploads?.[0]?.bytes ?? null;
  if (upA !== null && upB !== null) {
    const rel = Math.abs(upA - upB) / Math.max(upA, upB);
    if (rel > 0.35) issues.push(`size_diff ${(rel * 100).toFixed(0)}%`);
    if (upB > 49_000_000) issues.push("over_49MB");
  }
  if (issues.length) { qual = issues.join(","); qualityIssues.push(`${clip.name}: ${qual}`); }

  if (doProbe && upB) {
    const clipDir = join(OUT, revB, clip.name);
    const files = await readdir(clipDir).catch(() => []);
    const dest = files.find((f) => f.endsWith(".mp4")) ? join(clipDir, files.find((f) => f.endsWith(".mp4"))) : null;
    try {
      if (!dest) throw new Error("no uploaded mp4");
      const { stdout } = await execFileAsync(FFPROBE, [
        "-v", "error", "-show_entries", "format=duration:stream=codec_type",
        "-of", "json", dest,
      ]);
      const probed = JSON.parse(stdout);
      const dur = Number(probed?.format?.duration ?? 0);
      const hasAudio = (probed?.streams ?? []).some((s) => s.codec_type === "audio");
      if (Math.abs(dur - clip.duration_s) > 1.5) qualityIssues.push(`${clip.name}: duration ${dur} vs ${clip.duration_s}`);
      if (hasAudio !== clip.audio) qualityIssues.push(`${clip.name}: audio ${hasAudio} vs expected ${clip.audio}`);
    } catch (e) {
      qualityIssues.push(`${clip.name}: probe failed ${e.message.slice(0, 80)}`);
    }
  }

  console.log(
    `${clip.name.padEnd(20)} ${clip.bucket.padEnd(6)} ${String(totalA).padStart(9)} ${String(totalB).padStart(9)} ${String(delta).padStart(7)}  ${qual}`,
  );
}

console.log("\n=== totals ===");
for (const [label, rows] of [[revA, before], [revB, after]]) {
  const totals = manifest.clips.map((c) => {
    const r = rows.get(c.name);
    return r?.metrics?.total_ms ?? r?.total_ms;
  });
  const s = stats(totals);
  console.log(`${label}: n=${s.n} p50=${s.p50}ms p95=${s.p95}ms mean=${s.mean}ms min=${s.min} max=${s.max}`);
}

const p95A = stats(manifest.clips.map((c) => before.get(c.name)?.metrics?.total_ms ?? before.get(c.name)?.total_ms)).p95;
const p95B = stats(manifest.clips.map((c) => after.get(c.name)?.metrics?.total_ms ?? after.get(c.name)?.total_ms)).p95;
if (Number.isFinite(p95A) && Number.isFinite(p95B) && p95A > 0) {
  console.log(`p95 delta: ${(((p95B - p95A) / p95A) * 100).toFixed(1)}%`);
}

console.log("\n=== stage medians (ms) ===");
console.log("stage".padEnd(24) + revA.padStart(10) + revB.padStart(10) + "  delta");
for (const stage of STAGES) {
  const key = stage === "total_ms" ? "total_ms" : stage;
  const valsA = manifest.clips.map((c) => before.get(c.name)?.metrics?.[key] ?? (key === "total_ms" ? before.get(c.name)?.total_ms : null));
  const valsB = manifest.clips.map((c) => after.get(c.name)?.metrics?.[key] ?? (key === "total_ms" ? after.get(c.name)?.total_ms : null));
  const sA = stats(valsA);
  const sB = stats(valsB);
  if (sA.n === 0 && sB.n === 0) continue;
  console.log(`${stage.padEnd(24)}${String(sA.p50).padStart(10)}${String(sB.p50).padStart(10)}  ${String((sB.p50 ?? 0) - (sA.p50 ?? 0)).padStart(6)}`);
}

console.log("\n=== quality ===");
if (qualityIssues.length === 0) console.log("all equivalence checks passed");
else for (const issue of qualityIssues) console.log(`ISSUE ${issue}`);
