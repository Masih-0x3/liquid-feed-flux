// 0X3-672 W5: aggregate paired rounds → per-clip medians + p50/p95 + quality.
// Reads paired-<round>.jsonl files; each line = {clip, before:{...}, after:{...}}.

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUT = process.env.BENCH_OUT || new URL("../out", import.meta.url).pathname;
const COHORT = process.env.COHORT_DIR || new URL("../cohort", import.meta.url).pathname;
const FFPROBE = process.env.FFPROBE || "ffprobe";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return percentile(s, 50);
}
function stats(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), mean: s.length ? Math.round(s.reduce((a, b) => a + b) / s.length) : null };
}

const rounds = (process.argv.find((a) => a.startsWith("--rounds=")) || "--rounds=p1").split("=")[1].split(",");
const doProbe = process.argv.includes("--probe");

const manifest = JSON.parse(await readFile(join(COHORT, "manifest.json"), "utf8"));

// clip -> {before:[runs], after:[runs]} — detail files carry metrics/uploads.
const samples = new Map(manifest.clips.map((c) => [c.name, { before: [], after: [] }]));
for (const round of rounds) {
  const raw = await readFile(join(OUT, `paired-${round}.jsonl`), "utf8");
  for (const line of raw.trim().split("\n")) {
    const pair = JSON.parse(line);
    const entry = samples.get(pair.clip);
    if (!entry) continue;
    for (const rev of ["before", "after"]) {
      let detail = {};
      try {
        detail = JSON.parse(await readFile(join(OUT, `${rev}-${round}`, `${pair.clip}.result.json`), "utf8"));
      } catch { /* missing detail → keep summary */ }
      entry[rev].push({ ...pair[rev], ...detail });
    }
  }
}

const STAGES = [
  "download_ms", "probe_ms", "preflight_visual_ms", "contact_sheet_ms",
  "vision_frames_ms", "vision_inspection_sheets_ms", "watermark_vision_ms",
  "local_ocr_ms", "audio_extract_ms", "transcription_ms", "transcript_cleanup_ms",
  "translation_ms", "subtitle_generate_ms", "encode_ms", "upload_ms",
];

const clipRows = [];
const issues = [];

for (const clip of manifest.clips) {
  const { before: bs, after: as } = samples.get(clip.name);
  const bMed = median(bs.map((r) => r?.metrics?.total_ms ?? r?.total_ms));
  const aMed = median(as.map((r) => r?.metrics?.total_ms ?? r?.total_ms));
  const bOk = bs.filter((r) => r?.ok).length;
  const aOk = as.filter((r) => r?.ok).length;

  const stageRow = { clip: clip.name, bucket: clip.bucket, bMed, aMed, delta: aMed - bMed, bOk, aOk, stages: {} };
  for (const stage of STAGES) {
    stageRow.stages[stage] = {
      b: median(bs.map((r) => r?.metrics?.[stage])),
      a: median(as.map((r) => r?.metrics?.[stage])),
    };
  }
  // Noise-immune model: each run's own stage durations measure what the
  // serial ordering would have cost vs the overlapped ordering.
  // before: ocr serial after inspection sheets; audio serial after preflight.
  // after:  ocr hidden under frames+inspection+vision; audio hidden under
  //         preflight+vision window (always fully covered).
  stageRow.modeledSaving = as.map((r) => {
    const m = r?.metrics ?? {};
    const ocr = m.local_ocr_ms ?? 0;
    const window = (m.vision_frames_ms ?? 0) + (m.vision_inspection_sheets_ms ?? 0) + (m.watermark_vision_ms ?? 0);
    const audio = m.audio_extract_ms ?? 0;
    return Math.min(ocr, window) + audio;
  });
  stageRow.modeledSavingMed = median(stageRow.modeledSaving);
  clipRows.push(stageRow);

  if (bOk !== aOk) issues.push(`${clip.name}: ok ${bOk}/${bs.length} -> ${aOk}/${as.length}`);
  if (bOk === 0 && aOk === 0) {
    const sameFailure = bs.every((r) => String(r?.error ?? "").includes("exceeds max output"))
      === as.every((r) => String(r?.error ?? "").includes("exceeds max output"));
    if (!sameFailure) issues.push(`${clip.name}: failure mode differs`);
  }
}

console.log("\nclip                 bucket  b_med_ms  a_med_ms   delta_ms  model_save  b_ok a_ok");
for (const r of clipRows) {
  console.log(`${r.clip.padEnd(20)} ${r.bucket.padEnd(6)} ${String(r.bMed ?? "-").padStart(9)} ${String(r.aMed ?? "-").padStart(9)} ${String(r.delta).padStart(9)} ${String(r.modeledSavingMed ?? "-").padStart(10)}  ${r.bOk}/${r.aOk}`);
}

// Pool per-clip medians → cohort p50/p95 on median total times + on deltas.
const bMeds = clipRows.map((r) => r.bMed);
const aMeds = clipRows.map((r) => r.aMed);
const deltas = clipRows.filter((r) => Number.isFinite(r.delta)).map((r) => r.delta);
const bS = stats(bMeds), aS = stats(aMeds), dS = stats(deltas);
console.log(`\ncohort (per-clip medians): before p50=${bS.p50}ms p95=${bS.p95}ms | after p50=${aS.p50}ms p95=${aS.p95}ms`);
if (bS.p95 > 0 && aS.p95 > 0) console.log(`p95 change: ${(((aS.p95 - bS.p95) / bS.p95) * 100).toFixed(1)}%`);
if (bS.p50 > 0 && aS.p50 > 0) console.log(`p50 change: ${(((aS.p50 - bS.p50) / bS.p50) * 100).toFixed(1)}%`);
console.log(`delta stats: p50=${dS.p50}ms p95=${dS.p95}ms mean=${dS.mean}ms`);

const modeled = clipRows.map((r) => r.modeledSavingMed).filter(Number.isFinite);
const mS = stats(modeled);
console.log(`modeled overlap saving: p50=${mS.p50}ms p95=${mS.p95}ms mean=${mS.mean}ms total=${modeled.reduce((a, b) => a + b, 0)}ms`);
const meanTotal = stats([...bMeds, ...aMeds].filter(Number.isFinite)).mean;
if (mS.mean && meanTotal) console.log(`modeled saving ≈ ${((mS.mean / meanTotal) * 100).toFixed(1)}% of mean clip time`);

// Per-stage medians across cohort.
console.log("\nstage (cohort medians)      before_ms  after_ms   delta_ms");
for (const stage of STAGES) {
  const bVals = clipRows.map((r) => r.stages[stage].b);
  const aVals = clipRows.map((r) => r.stages[stage].a);
  const b = stats(bVals).p50, a = stats(aVals).p50;
  if (b === null && a === null) continue;
  console.log(`${stage.padEnd(24)} ${String(b ?? "-").padStart(9)} ${String(a ?? "-").padStart(9)} ${String((a ?? 0) - (b ?? 0)).padStart(9)}`);
}

// Quality equivalence on uploaded outputs from the last round's after dir.
if (doProbe) {
  console.log("\n=== output probes (after, round " + rounds[rounds.length - 1] + ") ===");
  const lastRound = rounds[rounds.length - 1];
  for (const clip of manifest.clips) {
    const clipDir = join(OUT, `after-${lastRound}`, clip.name);
    const files = await readdir(clipDir).catch(() => []);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    if (!mp4) { console.log(`${clip.name}: no output`); continue; }
    try {
      const { stdout } = await execFileAsync(FFPROBE, [
        "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height",
        "-of", "json", join(clipDir, mp4),
      ]);
      const probed = JSON.parse(stdout);
      const dur = Number(probed?.format?.duration ?? 0);
      const size = Number(probed?.format?.size ?? 0);
      const streams = probed?.streams ?? [];
      const hasAudio = streams.some((s) => s.codec_type === "audio");
      const v = streams.find((s) => s.codec_type === "video") ?? {};
      const flags = [];
      if (Math.abs(dur - clip.duration_s) > 1.5) flags.push(`dur ${dur}vs${clip.duration_s}`);
      if (hasAudio !== clip.audio) flags.push("audio-mismatch");
      if (size > 49_000_000) flags.push("over-49MB");
      if (v.width !== clip.width || v.height !== clip.height) flags.push(`res ${v.width}x${v.height}`);
      console.log(`${clip.name}: ${dur.toFixed(1)}s ${v.width}x${v.height} audio=${hasAudio} ${(size / 1048576).toFixed(1)}MB ${flags.length ? "ISSUE " + flags.join(",") : "ok"}`);
      for (const f of flags) issues.push(`${clip.name}: ${f}`);
    } catch (e) {
      console.log(`${clip.name}: probe failed ${e.message.slice(0, 80)}`);
    }
  }
}

console.log("\n=== equivalence ===");
if (issues.length === 0) console.log("all checks passed");
else for (const i of issues) console.log(`ISSUE ${i}`);
