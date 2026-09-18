// 0X3-672 W5: aggregate paired rounds → per-clip medians + p50/p95 + quality.
// Reads paired-<round>.jsonl files; each line = {clip, before:{...}, after:{...}}.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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

  // A pair only produces a delta when both revisions yielded at least one
  // finite timing — null - null would otherwise fabricate a 0ms delta.
  const delta = Number.isFinite(bMed) && Number.isFinite(aMed) ? aMed - bMed : null;
  const stageRow = { clip: clip.name, bucket: clip.bucket, bMed, aMed, delta, bOk, aOk, stages: {} };
  if (delta === null) issues.push(`${clip.name}: incomplete pair (no finite timing on one or both revisions)`);
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
  // Failed runs contribute nothing — an untimed run is not a zero saving.
  stageRow.modeledSaving = as
    .filter((r) => r?.ok && Number.isFinite(r?.metrics?.total_ms ?? r?.total_ms))
    .map((r) => {
      const m = r?.metrics ?? {};
      const ocr = m.local_ocr_ms ?? 0;
      const window = (m.vision_frames_ms ?? 0) + (m.vision_inspection_sheets_ms ?? 0) + (m.watermark_vision_ms ?? 0);
      const audio = m.audio_extract_ms ?? 0;
      return Math.min(ocr, window) + audio;
    });
  stageRow.modeledSavingMed = median(stageRow.modeledSaving);
  clipRows.push(stageRow);

  if (bOk !== aOk) issues.push(`${clip.name}: ok ${bOk}/${bs.length} -> ${aOk}/${as.length}`);
  if (bOk === 0 && aOk === 0 && bs.length && as.length) {
    // Compare the actual failure classes per revision, not two aggregate
    // booleans — different failure modes must not pass as "parity".
    const classify = (r) => {
      const e = String(r?.error ?? "");
      return e.includes("exceeds max output") ? "output_cap"
        : e.includes("claim expired") ? "lease_lost"
        : e ? "other" : "none";
    };
    const bClasses = new Set(bs.map(classify));
    const aClasses = new Set(as.map(classify));
    const same = bClasses.size === aClasses.size && [...bClasses].every((c) => aClasses.has(c));
    if (!same) issues.push(`${clip.name}: failure class differs before=${[...bClasses].join("/")} after=${[...aClasses].join("/")}`);
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

// Quality equivalence on uploaded outputs from the last round, BOTH revisions:
// - an output is expected exactly when the run succeeded in rendered mode
//   (passthrough "original" selections and failed runs legitimately produce none)
// - expected-but-missing or unprobeable outputs are issues, not log lines
// - before/after artifacts are MD5-compared so byte-identity is executable here
if (doProbe) {
  const lastRound = rounds[rounds.length - 1];
  console.log("\n=== output probes + before/after artifact equivalence (round " + lastRound + ") ===");
  const md5File = async (path) => createHash("md5").update(await readFile(path)).digest("hex");
  let compared = 0, identical = 0;
  for (const clip of manifest.clips) {
    const entry = samples.get(clip.name);
    const lastAfterOk = entry.after.filter((r) => r?.ok).at(-1);
    const lastBeforeOk = entry.before.filter((r) => r?.ok).at(-1);
    const rendered = (r) => (r?.metrics?.processing_mode ?? r?.processing_mode) !== "original_unmodified"
      && (r?.metrics?.processing_mode ?? r?.processing_mode) !== "original_selected";
    const expectAfter = Boolean(lastAfterOk && rendered(lastAfterOk));
    const expectBefore = Boolean(lastBeforeOk && rendered(lastBeforeOk));
    const dirs = { before: join(OUT, `before-${lastRound}`, clip.name), after: join(OUT, `after-${lastRound}`, clip.name) };
    const mp4s = {};
    for (const rev of ["before", "after"]) {
      const files = await readdir(dirs[rev]).catch(() => []);
      mp4s[rev] = files.find((f) => f.endsWith(".mp4")) ?? null;
    }
    for (const rev of ["before", "after"]) {
      const expected = rev === "before" ? expectBefore : expectAfter;
      if (expected && !mp4s[rev]) {
        issues.push(`${clip.name}: ${rev} run succeeded in rendered mode but produced no output`);
        console.log(`${clip.name}: ${rev} MISSING output (expected)`);
      }
      if (!expected && mp4s[rev]) {
        console.log(`${clip.name}: ${rev} produced output though run was ${(rev === "before" ? lastBeforeOk : lastAfterOk) ? "passthrough" : "failed"} — unexpected`);
      }
      if (!expected && !mp4s[rev]) continue;
      if (!mp4s[rev]) continue;
      try {
        const { stdout } = await execFileAsync(FFPROBE, [
          "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height",
          "-of", "json", join(dirs[rev], mp4s[rev]),
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
        console.log(`${clip.name} ${rev}: ${dur.toFixed(1)}s ${v.width}x${v.height} audio=${hasAudio} ${(size / 1048576).toFixed(1)}MB ${flags.length ? "ISSUE " + flags.join(",") : "ok"}`);
        for (const f of flags) issues.push(`${clip.name} ${rev}: ${f}`);
      } catch (e) {
        issues.push(`${clip.name} ${rev}: output present but unprobeable (${clipText(e.message, 80)})`);
        console.log(`${clip.name} ${rev}: probe failed ${clipText(e.message, 80)}`);
      }
    }
    if (mp4s.before && mp4s.after) {
      const hb = await md5File(join(dirs.before, mp4s.before));
      const ha = await md5File(join(dirs.after, mp4s.after));
      compared += 1;
      if (hb === ha) {
        identical += 1;
      } else {
        issues.push(`${clip.name}: before/after output bytes differ (md5 ${hb.slice(0, 8)} vs ${ha.slice(0, 8)})`);
      }
    } else if (expectBefore !== expectAfter) {
      issues.push(`${clip.name}: output presence differs between revisions`);
    }
  }
  console.log(`artifact equivalence: ${identical}/${compared} before/after outputs MD5-identical`);
  if (compared === 0) issues.push("no before/after output pairs compared — equivalence is unproven");
}

console.log("\n=== equivalence ===");
if (issues.length === 0) console.log("all checks passed");
else for (const i of issues) console.log(`ISSUE ${i}`);
if (issues.length > 0) process.exitCode = 1;
