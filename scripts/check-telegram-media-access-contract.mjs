import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "supabase/functions/worker/telegramDelivery.ts");
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`TELEGRAM_MEDIA_ACCESS_SOURCE_CONTRACT_FAIL ${message}`);
}

function parseSource(source) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail("telegram delivery parse diagnostics");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
    fileName: sourcePath,
  });
  if ((transpiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail("telegram delivery transpilation diagnostics");
  }
}

function section(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`${label} section markers are missing`);
  return source.slice(startIndex, endIndex);
}

function assertContract({ source, packageJson, ci }, label = "current source") {
  parseSource(source);
  for (const marker of [
    "type TelegramStorageObjectApi = {",
    "type TelegramStorageBucketApi = {",
    "type TelegramSupabaseClient = {",
    "supabase: TelegramSupabaseClient,",
  ]) {
    if (!source.includes(marker)) fail(`${label}: typed Telegram storage boundary is missing ${marker}`);
  }
  if (source.includes("deno-lint-ignore no-explicit-any") || /supabase:\s*any\b/.test(source)) {
    fail(`${label}: Telegram storage helpers must not retain an any client boundary`);
  }
  const helper = section(source, "export async function getMediaUrl(", "async function mapLimit", `${label} getMediaUrl`);
  if (!helper.includes("if (error || !data?.signedUrl) {")) fail(`${label}: signed URL result error is not inspected`);
  if (!helper.includes('throw new Error("telegram_signed_media_url_unavailable");')) {
    fail(`${label}: stored media access must fail closed when signing fails`);
  }
  if (helper.includes("return media.src_url as string")) {
    fail(`${label}: stored media must not fall back to raw source URL`);
  }
  const storedPathSection = section(helper, "if (media.storage_path)", "if (typeof media.src_url", `${label} stored media path`);
  if (storedPathSection.includes("return media.src_url")) {
    fail(`${label}: stored media must not fall back to raw source URL`);
  }
  if (!helper.includes('throw new Error("telegram_media_source_url_missing");')) {
    fail(`${label}: source URL shape must be validated when no storage path exists`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:telegram-media-access"] !==
    "node scripts/check-telegram-media-access-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:telegram-media-access")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("TELEGRAM_MEDIA_ACCESS_SOURCE_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("type TelegramSupabaseClient = {", "type TelegramSupabaseClient = any;"),
  }), "Telegram storage any boundary mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("supabase: TelegramSupabaseClient,", "supabase: any,"),
  }), "Telegram helper any parameter mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('return data.signedUrl;', "return media.src_url;"),
  }), "stored media raw URL fallback mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace("if (error || !data?.signedUrl) {", "if (false) {"),
  }), "signed URL result guard removal mutant");
  assertRejects((source) => ({
    ...source,
    source: source.source.replace('throw new Error("telegram_media_source_url_missing");', "return media.src_url as string;"),
  }), "missing source URL validation mutant");
}

console.log(
  `TELEGRAM_MEDIA_ACCESS_SOURCE_CONTRACT_PASS storedPath=signedOnly rawFallback=blocked sourceUrl=validated selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
