#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  SERVICE_ROOT,
  TEMP_MEDIA_BUCKET,
  createReadOnlySupabase,
  loadLocalEnv,
  parseArgs,
  parseGoldenRange,
  readJson,
  resolveRunRoot,
  writeJson,
} from "./lib.js";

async function blobToBuffer(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

async function downloadSource(supabase, entry) {
  if (existsSync(entry.local_file)) return { downloaded: false, source: "existing" };
  await mkdir(dirname(entry.local_file), { recursive: true });
  if (supabase && entry.storage_path) {
    const { data, error } = await supabase.storage.from(TEMP_MEDIA_BUCKET).download(entry.storage_path);
    if (!error && data) {
      await writeFile(entry.local_file, await blobToBuffer(data));
      return { downloaded: true, source: "storage" };
    }
    if (!entry.src_url) throw new Error(`storage download failed for ${entry.storage_path}: ${error?.message ?? "unknown error"}`);
  }
  if (!entry.src_url) throw new Error("entry has neither storage_path nor src_url");
  const response = await fetch(entry.src_url);
  if (!response.ok) throw new Error(`source fetch failed ${response.status} for ${entry.src_url}`);
  await writeFile(entry.local_file, Buffer.from(await response.arrayBuffer()));
  return { downloaded: true, source: "src_url" };
}

function previewEnv() {
  const env = { ...process.env };
  env.PREVIEW_SECONDS = env.PREVIEW_SECONDS || "300";
  env.DELOGO_ENGINE = env.DELOGO_ENGINE || "opencv";
  if (!env.OPENCV_PYTHON && existsSync("/tmp/xot-opencv-venv/bin/python")) {
    env.OPENCV_PYTHON = "/tmp/xot-opencv-venv/bin/python";
  }
  return env;
}

function runPreview(entry) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(SERVICE_ROOT, "src/preview.js"), entry.local_file, entry.output_dir], {
      cwd: SERVICE_ROOT,
      env: previewEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, duration_ms: Date.now() - started });
    });
  });
}

async function writePreviewOutput(entry, runResult) {
  await mkdir(entry.output_dir, { recursive: true });
  await writeFile(join(entry.output_dir, "preview-stdout.txt"), runResult.stdout);
  await writeFile(join(entry.output_dir, "preview-stderr.txt"), runResult.stderr);
  let parsed = null;
  try {
    parsed = JSON.parse(runResult.stdout);
    await writeJson(join(entry.output_dir, "preview-output.json"), parsed);
  } catch {
    // Keep raw stdout/stderr for debugging failed or partial runs.
  }
  return parsed;
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const runRoot = await resolveRunRoot(args);
  const manifest = await readJson(join(runRoot, "golden-set.json"));
  const entries = parseGoldenRange(args, manifest.entries ?? []);
  if (entries.length === 0) throw new Error("No entries selected for this batch/range.");
  const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createReadOnlySupabase()
    : null;
  const resultsPath = join(runRoot, "golden-results.json");
  const results = await readJson(resultsPath, { updated_at: null, entries: {} });

  for (const entry of entries) {
    console.log(JSON.stringify({ action: "start", golden_id: entry.golden_id, input: basename(entry.local_file) }));
    const startedAt = new Date().toISOString();
    try {
      await mkdir(entry.output_dir, { recursive: true });
      const download = await downloadSource(supabase, entry);
      const runResult = await runPreview(entry);
      const previewOutput = await writePreviewOutput(entry, runResult);
      const status = runResult.code === 0 && previewOutput ? "completed" : "failed";
      results.entries[entry.golden_id] = {
        golden_id: entry.golden_id,
        status,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: runResult.duration_ms,
        download,
        output_dir: entry.output_dir,
        preview_output_path: previewOutput ? join(entry.output_dir, "preview-output.json") : null,
        error: status === "failed" ? (runResult.stderr || runResult.stdout).slice(0, 2000) : null,
      };
      await writeJson(join(entry.output_dir, "run.json"), results.entries[entry.golden_id]);
      await writeJson(resultsPath, { ...results, updated_at: new Date().toISOString() });
      console.log(JSON.stringify({ action: "done", golden_id: entry.golden_id, status, duration_ms: runResult.duration_ms }));
    } catch (error) {
      results.entries[entry.golden_id] = {
        golden_id: entry.golden_id,
        status: "failed",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        output_dir: entry.output_dir,
        error: error instanceof Error ? error.message : String(error),
      };
      await mkdir(entry.output_dir, { recursive: true });
      await writeJson(join(entry.output_dir, "run.json"), results.entries[entry.golden_id]);
      await writeJson(resultsPath, { ...results, updated_at: new Date().toISOString() });
      console.log(JSON.stringify({ action: "done", golden_id: entry.golden_id, status: "failed", error: results.entries[entry.golden_id].error }));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
