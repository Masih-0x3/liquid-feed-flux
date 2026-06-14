import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GOLDEN_DIR = dirname(fileURLToPath(import.meta.url));
export const SERVICE_ROOT = resolve(GOLDEN_DIR, "..");
export const REPO_ROOT = resolve(SERVICE_ROOT, "../..");
export const DEFAULT_GOLDEN_BASE = "/Users/stevmq/Downloads/xot-video-golden";
export const TEMP_MEDIA_BUCKET = "temp-media";

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      (out._ ??= []).push(arg);
      continue;
    }
    const rawKey = arg.slice(2);
    const [key, inlineValue] = rawKey.split("=", 2);
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export async function loadLocalEnv() {
  const paths = [
    join(REPO_ROOT, ".env.local"),
    join(SERVICE_ROOT, ".env.local"),
  ];
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    const text = await readFile(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      if (process.env[key]) continue;
      let value = rest.join("=").trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createReadOnlySupabase() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function timestampId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function goldenId(index) {
  return `G${String(index + 1).padStart(3, "0")}`;
}

export function safeFileName(value, fallback = "video") {
  const text = String(value ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return text || fallback;
}

export function extensionForMedia(row) {
  const mime = String(row?.mime_type ?? "").toLowerCase();
  const srcExt = extname(String(row?.src_url ?? "").split("?")[0]).toLowerCase();
  if (srcExt && srcExt.length <= 6) return srcExt;
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  return ".mp4";
}

export async function createRunRoot(baseDir = DEFAULT_GOLDEN_BASE, runId = timestampId()) {
  const runRoot = resolve(baseDir, runId);
  await mkdir(join(runRoot, "sources"), { recursive: true });
  await mkdir(join(runRoot, "outputs"), { recursive: true });
  return runRoot;
}

export async function latestRunRoot(baseDir = DEFAULT_GOLDEN_BASE) {
  const entries = await readdir(baseDir).catch(() => []);
  const dirs = [];
  for (const entry of entries) {
    const path = join(baseDir, entry);
    try {
      const info = await stat(path);
      if (info.isDirectory() && existsSync(join(path, "golden-set.json"))) dirs.push(path);
    } catch {
      // Ignore entries deleted while scanning.
    }
  }
  dirs.sort();
  return dirs.at(-1) ?? null;
}

export async function resolveRunRoot(args = {}) {
  if (args.run) return resolve(String(args.run));
  const latest = await latestRunRoot(String(args.base || DEFAULT_GOLDEN_BASE));
  if (!latest) throw new Error("No golden run found. Run golden:select first or pass --run /path/to/run.");
  return latest;
}

export function chunk(values, size = 100) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

export function compactText(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function markdownLink(label, path) {
  if (!path) return "";
  const escaped = String(path).includes(" ") ? `<${path}>` : path;
  return `[${label}](${escaped})`;
}

export function parseGoldenRange(args = {}, entries = []) {
  if (args.only) {
    const ids = new Set(String(args.only).split(",").map((item) => item.trim()).filter(Boolean));
    return entries.filter((entry) => ids.has(entry.golden_id));
  }
  const batch = Number(args.batch ?? 1);
  const batchSize = Number(args.batchSize ?? args["batch-size"] ?? 10);
  const fromId = args.from ? String(args.from) : goldenId((batch - 1) * batchSize);
  const toId = args.to ? String(args.to) : goldenId((batch * batchSize) - 1);
  return entries.filter((entry) => entry.golden_id >= fromId && entry.golden_id <= toId);
}
