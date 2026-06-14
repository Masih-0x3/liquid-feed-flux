#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compactText,
  loadLocalEnv,
  markdownLink,
  parseArgs,
  parseGoldenRange,
  readJson,
  resolveRunRoot,
  writeJson,
} from "./lib.js";

function outputFor(entry) {
  return readJson(join(entry.output_dir, "preview-output.json"), {});
}

function runFor(entry) {
  return readJson(join(entry.output_dir, "run.json"), {});
}

function delogoCount(output) {
  return Array.isArray(output?.preflight?.delogoRegions) ? output.preflight.delogoRegions.length : 0;
}

function actionLabels(output) {
  const actions = [];
  const subtitle = String(output?.subtitle ?? "");
  if (subtitle.endsWith(".fa.srt")) actions.push("subtitle: fa");
  else if (subtitle.endsWith(".en.srt")) actions.push("subtitle: en");
  else actions.push("subtitle: none");
  const hasDelogo = delogoCount(output) > 0;
  const watermarkApplied = output?.preflight?.watermarkApplied ?? Boolean(output?.preview_rendered && subtitle);
  actions.push(`watermark: ${watermarkApplied ? "yes" : "no"}`);
  actions.push(`delogo: ${hasDelogo ? "yes" : "no"}`);
  if (output?.original_selected) actions.push("original-selected");
  if (output?.preflight?.block?.blocked) actions.push("blocked");
  if (output?.preview_rendered) actions.push("rendered");
  return actions.join(", ");
}

function decisionFor(output, run) {
  if (run.status === "failed") return "failed";
  if (output?.preflight?.block?.blocked) return "blocked";
  if (output?.original_selected) return "original-selected";
  if (output?.preview_rendered) return "rendered";
  return "unknown";
}

function verdictFor(output, run) {
  if (run.status === "failed") return "fail";
  if (output?.preflight?.block?.blocked) return "needs_review";
  if (output?.original_selected) {
    const reason = String(output?.no_subtitle_reason ?? output?.preflight?.noSubtitleReason ?? "");
    return /no_audio_stream/i.test(reason) ? "pass" : "needs_review";
  }
  if (output?.preview_rendered && output?.subtitle) return delogoCount(output) > 0 ? "needs_review" : "pass";
  if (output?.preview_rendered) return "needs_review";
  return "needs_review";
}

function notesFor(entry, output, run) {
  const notes = [];
  if (run.error) notes.push(compactText(run.error, 110));
  if (output?.no_subtitle_reason) notes.push(`no subtitle: ${output.no_subtitle_reason}`);
  if (output?.preflight?.block?.reason) notes.push(`block: ${output.preflight.block.reason}`);
  if (delogoCount(output) > 0) notes.push(`delogo regions: ${delogoCount(output)}`);
  const renderReason = output?.preflight?.watermarkOnly?.reason || output?.preflight?.vision?.renderDecision?.reason;
  if (renderReason) notes.push(compactText(renderReason, 130));
  if (!notes.length && entry.text_preview) notes.push(compactText(entry.text_preview, 130));
  return notes.join("; ");
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const runRoot = await resolveRunRoot(args);
  const manifest = await readJson(join(runRoot, "golden-set.json"));
  const entries = parseGoldenRange(args, manifest.entries ?? []);
  if (entries.length === 0) throw new Error("No entries selected for this summary.");
  const batch = Number(args.batch ?? 1);
  const batchLabel = String(batch).padStart(2, "0");
  const rows = [];
  for (const entry of entries) {
    const [output, run] = await Promise.all([outputFor(entry), runFor(entry)]);
    const previewPath = output?.preview ?? (existsSync(join(entry.output_dir, "preview.mp4")) ? join(entry.output_dir, "preview.mp4") : null);
    const row = {
      id: entry.golden_id,
      original: entry.local_file,
      output: previewPath,
      decision: decisionFor(output, run),
      source_target: `${output?.source_language ?? "?"} -> ${output?.target_language ?? "none"}`,
      actions: actionLabels(output),
      self_qa: verdictFor(output, run),
      notes: notesFor(entry, output, run),
      output_dir: entry.output_dir,
      contact_sheet: join(entry.output_dir, "contact-sheet.jpg"),
      raw_source_srt: join(entry.output_dir, "preview.raw-source.srt"),
      cleaned_source_srt: join(entry.output_dir, "preview.cleaned-source.srt"),
      final_srt: output?.subtitle ?? null,
    };
    rows.push(row);
  }

  const reviewJsonPath = join(runRoot, `batch-${batchLabel}-review.json`);
  const reviewMdPath = join(runRoot, `batch-${batchLabel}-review.md`);
  await writeJson(reviewJsonPath, {
    generated_at: new Date().toISOString(),
    run_root: runRoot,
    batch,
    rows,
  });

  const lines = [
    `# XOT Golden Video Batch ${batchLabel}`,
    "",
    `Run: ${runRoot}`,
    "",
    "Reply with IDs only, for example: `G003 subtitle too high`, `G006 wrong language`, `G009 watermark too strong`.",
    "",
    "| ID | Original | Output | Decision | Source -> Target | Actions | Self-QA | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => [
      row.id,
      markdownLink("original", row.original),
      row.output ? markdownLink("output", row.output) : "",
      row.decision,
      row.source_target,
      row.actions,
      row.self_qa,
      row.notes.replace(/\|/g, "/"),
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Artifact Directories",
    "",
    ...rows.map((row) => `- ${row.id}: ${markdownLink("output dir", row.output_dir)} ${row.final_srt ? `- ${markdownLink("SRT", row.final_srt)}` : ""}`),
    "",
  ];
  await mkdir(runRoot, { recursive: true });
  await writeFile(reviewMdPath, lines.join("\n"));
  console.log(JSON.stringify({ review: reviewMdPath, rows: rows.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
