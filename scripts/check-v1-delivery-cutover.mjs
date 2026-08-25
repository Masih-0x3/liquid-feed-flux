import { readFile } from "node:fs/promises";

const migrationPath = new URL(
  "../supabase/migrations/20260825091418_v1_delivery_continuity_cutover.sql",
  import.meta.url,
);
const sql = await readFile(migrationPath, "utf8");
const adminRetry = await readFile(
  new URL("../supabase/functions/admin-retry/index.ts", import.meta.url),
  "utf8",
);
const digestCompiler = await readFile(
  new URL("../supabase/functions/digest-compiler/index.ts", import.meta.url),
  "utf8",
);

const required = [
  ["separate singleton", "CREATE TABLE IF NOT EXISTS public.delivery_cutover"],
  ["immutable cutoff trigger", "trg_delivery_cutover_immutable"],
  ["one-time DB clock initialization", "clock_timestamp()"],
  ["strict post-T admission", "p.created_at > v_cutover"],
  ["ambiguous lineage fail-closed", "missing_or_historical_lineage"],
  ["transactional job claim guard", "delivery_cutover_allows_job"],
  ["X start floor binding", "x_start_posting_from_mismatch"],
  ["historical row protection", "historical_telegram_mutation"],
  ["historical X protection", "historical_x_mutation"],
  ["retry RPC protection", "PERFORM public.assert_delivery_cutover_post(tweet_id)"],
  ["deliver type transition protection", "IF TG_OP = 'UPDATE' AND NEW.type = 'deliver'"],
];

const missing = required.filter(([, marker]) => !sql.includes(marker));
if (missing.length > 0) {
  throw new Error(`missing cutover contract markers: ${missing.map(([name]) => name).join(", ")}`);
}

if (!/p\.created_at\s*>\s*v_cutover/.test(sql)) {
  throw new Error("cutover candidate guard is not strict > T");
}

if (!adminRetry.includes("historical_skipped") || !adminRetry.includes("retryJobs.map")) {
  throw new Error("admin retry path does not prove historical rows are skipped");
}
if (!digestCompiler.includes("digest_compiler_preview_only") || /api\.x\.com/.test(digestCompiler)) {
  throw new Error("digest compiler still exposes a direct X provider path");
}

console.log(`v1 delivery cutover SQL contract PASS (${required.length + 2} markers)`);
