import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(repoRoot, "supabase/functions/digest-compiler/index.ts");
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/20260808110000_b3b2_digest_checkpoints.sql",
);
const packagePath = path.join(repoRoot, "package.json");
const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");

function fail(message) {
  throw new Error(`DIGEST_CHECKPOINT_CONTRACT_FAIL ${message}`);
}

function parseTypeScript(source) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) fail("digest compiler parse diagnostics");
}

function assertSqlFunctionFence(migration, signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM public, anon, authenticated;`).test(migration) ||
      !new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role;`).test(migration)) {
    fail(`${signature} must be service-role-only`);
  }
}

function assertContract({ source, migration, packageJson, ci }, label = "current source") {
  parseTypeScript(source);

  const requiredMigrationFragments = [
    "CREATE TABLE public.digest_runs",
    "run_key text PRIMARY KEY",
    "input_fingerprint text NOT NULL",
    "state text NOT NULL",
    "provider_started_at timestamptz",
    "output_digest_id uuid REFERENCES public.digests(id)",
    "delivery_state text NOT NULL DEFAULT 'disabled'",
    "CREATE UNIQUE INDEX digests_run_key_unique",
    "CREATE UNIQUE INDEX digests_output_key_unique",
    "CREATE OR REPLACE FUNCTION public.reserve_digest_run(",
    "CREATE OR REPLACE FUNCTION public.mark_digest_provider_started(",
    "CREATE OR REPLACE FUNCTION public.persist_digest_output(",
    "CREATE OR REPLACE FUNCTION public.persist_skipped_digest(",
    "CREATE OR REPLACE FUNCTION public.fail_digest_run(",
    "CREATE OR REPLACE FUNCTION public.checkpoint_digest_delivery_disabled(",
    "provider_started_at IS NOT NULL",
    "state = 'ambiguous'",
    "ON CONFLICT (run_key) DO NOTHING",
  ];
  for (const fragment of requiredMigrationFragments) {
    if (!migration.includes(fragment)) fail(`${label}: migration missing ${fragment}`);
  }

  for (const signature of [
    "reserve_digest_run(text,text,timestamptz,timestamptz,text[],text,integer)",
    "mark_digest_provider_started(text,uuid,bigint)",
    "persist_digest_output(text,uuid,bigint,text,text,jsonb,text)",
    "persist_skipped_digest(text,uuid,bigint,text,text)",
    "fail_digest_run(text,uuid,bigint,text)",
    "checkpoint_digest_delivery_disabled(text,text)",
  ]) {
    assertSqlFunctionFence(migration, signature);
  }

  const requiredRuntimeFragments = [
    "const runKey = `digest:${periodEnd.toISOString()}`;",
    "const inputFingerprint = await sha256Hex(",
    "prompt_version: DIGEST_PROMPT_VERSION,",
    "timeZone: \"UTC\"",
    "await sb.rpc(\"reserve_digest_run\"",
    "await sb.rpc(\"mark_digest_provider_started\"",
    "await sb.rpc(\"persist_digest_output\"",
    "await sb.rpc(\"persist_skipped_digest\"",
    "await sb.rpc(\"fail_digest_run\"",
    "await sb.rpc(\"checkpoint_digest_delivery_disabled\"",
    "reserveReason === \"already_completed\"",
    "reserveReason === \"output_ready\"",
    "reserveReason === \"ambiguous\"",
    "digest_checkpoint_failed:provider_marker",
    "digest_checkpoint_failed:output",
    "digest_checkpoint_failed:delivery_disabled",
  ];
  for (const fragment of requiredRuntimeFragments) {
    if (!source.includes(fragment)) fail(`${label}: runtime missing ${fragment}`);
  }

  for (const forbidden of [
    "https://api.x.com/2/tweets",
    "TWITTER_CONSUMER_KEY",
    "TWITTER_CONSUMER_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
    "async function postTweet(",
  ]) {
    if (source.includes(forbidden)) fail(`${label}: compiler still contains forbidden provider path ${forbidden}`);
  }

  const packageData = JSON.parse(packageJson);
  if (packageData.scripts?.["check:b3b2-digest-checkpoint"] !==
    "node scripts/check-digest-checkpoint-contract.mjs") {
    fail(`${label}: package script is missing`);
  }
  if (!ci.includes("- run: npm run check:b3b2-digest-checkpoint")) {
    fail(`${label}: hosted CI contract is missing`);
  }
}

function sources() {
  return {
    source: fs.readFileSync(sourcePath, "utf8"),
    migration: fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "",
    packageJson: fs.readFileSync(packagePath, "utf8"),
    ci: fs.readFileSync(ciPath, "utf8"),
  };
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()), label);
  } catch (error) {
    if (String(error).includes("DIGEST_CHECKPOINT_CONTRACT_FAIL")) return;
    throw error;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assertRejects((input) => ({
    ...input,
    migration: input.migration.replaceAll("provider_started_at IS NOT NULL", "provider_started_at IS NULL"),
  }), "post-provider expiry auto-retry mutant");
  assertRejects((input) => ({
    ...input,
    migration: input.migration.replaceAll("ON CONFLICT (run_key) DO NOTHING", ""),
  }), "canonical output conflict mutant");
  assertRejects((input) => ({
    ...input,
    source: `${input.source}\nasync function postTweet() { return fetch(\"https://api.x.com/2/tweets\"); }\n`,
  }), "direct provider path mutant");
  assertRejects((input) => ({
    ...input,
    source: input.source.replace(
      "await sb.rpc(\"persist_digest_output\"",
      "await Promise.resolve",
    ),
  }), "output checkpoint bypass mutant");
}

console.log(
  `DIGEST_CHECKPOINT_CONTRACT_PASS deterministicRun=one canonicalOutput=one downstreamJobs=zero selfTest=${
    process.env.MUTATION_TEST === "1" ? "pass" : "skipped"
  }`,
);
