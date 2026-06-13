#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  chunk,
  compactText,
  createReadOnlySupabase,
  createRunRoot,
  extensionForMedia,
  goldenId,
  loadLocalEnv,
  parseArgs,
  readJson,
  safeFileName,
  writeJson,
} from "./lib.js";

const execFileAsync = promisify(execFile);

function textFor(row) {
  return [
    row.post?.text_original,
    row.post?.text_translated,
    row.post?.url,
    row.post?.author_handle,
  ].filter(Boolean).join(" ");
}

function classifyCandidate(row) {
  const text = textFor(row);
  const lower = text.toLowerCase();
  const labels = new Set();
  const width = Number(row.width ?? 0);
  const height = Number(row.height ?? 0);
  const duration = Number(row.duration_ms ?? 0);

  if (height > width * 1.12) labels.add("vertical");
  if (width > height * 1.12) labels.add("horizontal");
  if (duration > 0 && duration <= 12000) labels.add("short");
  if (duration >= 45000) labels.add("long");
  if (duration > 0 && duration <= 9000) labels.add("no_speech_or_ambiguous_likely");

  const hasPersianSpecific = /[پچژگک‌ی]/.test(text);
  const hasArabicScript = /[\u0600-\u06FF]/.test(text);
  const hasHebrewScript = /[\u0590-\u05FF]/.test(text);
  if (hasPersianSpecific || /^fa\b/i.test(String(row.post?.lang_original ?? ""))) labels.add("likely_persian_speech");
  if (
    hasHebrewScript ||
    hasArabicScript ||
    /\b(arabic|hebrew|turkish|israel|israeli|idf|gaza|lebanon|beirut|hezbollah|houthi|yemen|iran|katz|netanyahu|erdogan)\b/i.test(text)
  ) labels.add("likely_mixed_or_other_language");
  if (/[A-Za-z]/.test(text) && !hasPersianSpecific) labels.add("likely_english_non_persian");
  if (/\b(news|broadcast|lower[-\s]?third|caption|subtitle|ticker|teletext|chyron|unclassified|centcom|fox|cnn|bbc|press|statement|interview|speaks|said|says)\b/i.test(text)) {
    labels.add("visible_text_likely");
  }
  if (/\b(tiktok|telegram|instagram|repost|watermark|via|source|clip|footage)\b/i.test(text) || /@\w{3,}/.test(text)) {
    labels.add("watermark_likely");
  }
  if (/\b(footage|video shows|shows|seen|appears|explosion|missile|rocket|drone|intercept|strike|sirens|music|no audio)\b/i.test(lower)) {
    labels.add("no_speech_or_ambiguous_likely");
  }
  if (labels.size === 0) labels.add("general");
  return [...labels].sort();
}

function candidateScore(row) {
  const downloaded = row.storage_path ? 5 : 0;
  const dimensions = row.width && row.height ? 2 : 0;
  const duration = row.duration_ms ? 2 : 0;
  const postDate = Date.parse(row.post?.tweeted_at ?? row.created_at ?? 0) || 0;
  return downloaded + dimensions + duration + postDate / 1e14;
}

function candidateDateMs(row) {
  const value = row.post?.tweeted_at ?? row.created_at ?? row.post?.created_at ?? "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateBoundary(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid date: ${raw}`);
  return parsed;
}

function filterByDateWindow(rows, args) {
  const fromMs = parseDateBoundary(args["date-from"] ?? args.dateFrom, "date-from");
  const toMs = parseDateBoundary(args["date-to"] ?? args.dateTo, "date-to");
  if (fromMs === null && toMs === null) return rows;
  return rows.filter((row) => {
    const value = candidateDateMs(row);
    if (value === null) return false;
    if (fromMs !== null && value < fromMs) return false;
    if (toMs !== null && value >= toMs) return false;
    return true;
  });
}

function selectStratified(candidates, count) {
  const selected = [];
  const selectedIds = new Set();
  const quotas = [
    ["likely_english_non_persian", 10],
    ["likely_persian_speech", 8],
    ["likely_mixed_or_other_language", 8],
    ["visible_text_likely", 8],
    ["watermark_likely", 8],
    ["no_speech_or_ambiguous_likely", 8],
    ["vertical", 8],
    ["horizontal", 8],
    ["short", 6],
    ["long", 6],
  ];

  const add = (candidate) => {
    if (!candidate || selectedIds.has(candidate.id) || selected.length >= count) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    return true;
  };
  const selectedLabelCount = (label) => selected.filter((candidate) => candidate.bucket_labels.includes(label)).length;
  const ranked = candidates.slice().sort((a, b) => candidateScore(b) - candidateScore(a));

  for (const [label, quota] of quotas) {
    for (const candidate of ranked) {
      if (selected.length >= count || selectedLabelCount(label) >= quota) break;
      if (candidate.bucket_labels.includes(label)) add(candidate);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= count) break;
    add(candidate);
  }
  return selected.slice(0, count);
}

function selectLatest(candidates, count) {
  return candidates
    .slice()
    .sort((a, b) => candidateScore(b) - candidateScore(a))
    .slice(0, count);
}

function excludeRunArgs(args) {
  return [
    args["exclude-run"],
    args["exclude-runs"],
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function excludedIdsFromRun(runRoot) {
  if (!runRoot) return new Set();
  const manifest = await readJson(join(String(runRoot), "golden-set.json"));
  const ids = new Set();
  for (const entry of manifest.entries ?? []) {
    if (entry.media_id) ids.add(String(entry.media_id));
  }
  return ids;
}

async function excludedIdsFromRuns(runRoots) {
  const ids = new Set();
  for (const runRoot of runRoots) {
    const runIds = await excludedIdsFromRun(runRoot);
    for (const id of runIds) ids.add(id);
  }
  return ids;
}

async function fetchPosts(supabase, tweetIds) {
  const map = new Map();
  for (const ids of chunk(tweetIds, 100)) {
    const { data, error } = await supabase
      .from("posts")
      .select("tweet_id,url,text_original,text_translated,lang_original,tweeted_at,created_at,author_handle,delivery_decision,final_score,importance_score")
      .in("tweet_id", ids);
    if (error) throw new Error(`posts query failed: ${error.message}`);
    for (const row of data ?? []) map.set(row.tweet_id, row);
  }
  return map;
}

function parseSupabaseCliJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Supabase CLI returned non-JSON output: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

async function fetchCandidatesWithCli(candidateLimit) {
  const query = `
    select
      m.id,
      m.tweet_id,
      m.kind,
      m.src_url,
      m.width,
      m.height,
      m.duration_ms,
      m.ordering,
      m.created_at,
      m.storage_path,
      m.downloaded_at,
      m.file_size,
      m.mime_type,
      p.url as post_url,
      p.text_original,
      p.text_translated,
      p.lang_original,
      p.tweeted_at,
      p.created_at as post_created_at,
      p.author_handle,
      p.delivery_decision,
      p.final_score,
      p.importance_score
    from public.media m
    left join public.posts p on p.tweet_id = m.tweet_id
    where m.kind = 'video'
      and (m.storage_path is not null or m.src_url is not null)
    order by coalesce(p.tweeted_at, m.created_at) desc nulls last
    limit ${Math.max(1, Math.min(2000, Number(candidateLimit) || 500))};
  `;
  const { stdout } = await execFileAsync("npx", ["supabase", "db", "query", "--linked", "-o", "json", query], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    maxBuffer: 1024 * 1024 * 16,
  });
  const parsed = parseSupabaseCliJson(stdout);
  return (parsed.rows ?? []).map((row) => ({
    id: row.id,
    tweet_id: row.tweet_id,
    kind: row.kind,
    src_url: row.src_url,
    width: row.width,
    height: row.height,
    duration_ms: row.duration_ms,
    ordering: row.ordering,
    created_at: row.created_at,
    storage_path: row.storage_path,
    downloaded_at: row.downloaded_at,
    file_size: row.file_size,
    mime_type: row.mime_type,
    post: {
      tweet_id: row.tweet_id,
      url: row.post_url,
      text_original: row.text_original,
      text_translated: row.text_translated,
      lang_original: row.lang_original,
      tweeted_at: row.tweeted_at,
      created_at: row.post_created_at,
      author_handle: row.author_handle,
      delivery_decision: row.delivery_decision,
      final_score: row.final_score,
      importance_score: row.importance_score,
    },
  }));
}

async function fetchCandidatesWithSupabase(candidateLimit) {
  const supabase = createReadOnlySupabase();
  const { data: mediaRows, error } = await supabase
    .from("media")
    .select("id,tweet_id,kind,src_url,width,height,duration_ms,ordering,created_at,storage_path,downloaded_at,file_size,mime_type")
    .eq("kind", "video")
    .or("storage_path.not.is.null,src_url.not.is.null")
    .order("created_at", { ascending: false })
    .limit(candidateLimit);
  if (error) throw new Error(`media query failed: ${error.message}`);

  const postsByTweet = await fetchPosts(supabase, [...new Set((mediaRows ?? []).map((row) => row.tweet_id).filter(Boolean))]);
  return (mediaRows ?? []).map((media) => ({ ...media, post: postsByTweet.get(media.tweet_id) ?? null }));
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const count = Number(args.count ?? 50);
  const candidateLimit = Number(args["candidate-limit"] ?? 500);
  const strategy = String(args.strategy ?? "stratified");
  const excludedRuns = excludeRunArgs(args);
  const excludedIds = await excludedIdsFromRuns(excludedRuns);
  const runRoot = await createRunRoot(args.base ? String(args.base) : undefined, args["run-id"] ? String(args["run-id"]) : undefined);
  const rawCandidates = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? await fetchCandidatesWithSupabase(candidateLimit)
    : await fetchCandidatesWithCli(candidateLimit);
  const candidates = rawCandidates
    .filter((row) => filterByDateWindow([row], args).length > 0)
    .filter((row) => row.storage_path || row.src_url)
    .filter((row) => !excludedIds.has(String(row.id)))
    .map((row) => ({ ...row, bucket_labels: classifyCandidate(row) }));
  const selected = strategy === "latest"
    ? selectLatest(candidates, count)
    : selectStratified(candidates, count);

  await mkdir(join(runRoot, "sources"), { recursive: true });
  await mkdir(join(runRoot, "outputs"), { recursive: true });
  const entries = selected.map((row, index) => {
    const id = goldenId(index);
    const handle = row.post?.author_handle ? String(row.post.author_handle).replace(/^@/, "") : "unknown";
    const sourceName = `${id}_${safeFileName(`${handle}_${row.tweet_id}`)}${extensionForMedia(row)}`;
    return {
      golden_id: id,
      media_id: row.id,
      tweet_id: row.tweet_id,
      post_url: row.post?.url ?? row.tweet_id,
      author_handle: row.post?.author_handle ?? null,
      text_preview: compactText(row.post?.text_original ?? row.post?.text_translated ?? "", 500),
      storage_path: row.storage_path ?? null,
      src_url: row.src_url ?? null,
      duration_ms: row.duration_ms ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
      mime_type: row.mime_type ?? null,
      file_size: row.file_size ?? null,
      media_created_at: row.created_at ?? null,
      tweeted_at: row.post?.tweeted_at ?? null,
      delivery_decision: row.post?.delivery_decision ?? null,
      final_score: row.post?.final_score ?? row.post?.importance_score ?? null,
      bucket_labels: row.bucket_labels,
      local_file: join(runRoot, "sources", sourceName),
      output_dir: join(runRoot, "outputs", id),
    };
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    run_root: runRoot,
    strategy,
    excluded_run: excludedRuns[0] ?? null,
    excluded_runs: excludedRuns,
    date_window: {
      from: args["date-from"] ?? args.dateFrom ?? null,
      to: args["date-to"] ?? args.dateTo ?? null,
    },
    count: entries.length,
    requested_count: count,
    candidate_count: candidates.length,
    entries,
    bucket_counts: entries.reduce((acc, entry) => {
      for (const label of entry.bucket_labels) acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  };
  await writeJson(join(runRoot, "golden-set.json"), manifest);
  await writeJson(join(runRoot, "manifest.json"), entries);
  console.log(JSON.stringify({
    run_root: runRoot,
    count: entries.length,
    candidate_count: candidates.length,
    bucket_counts: manifest.bucket_counts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
