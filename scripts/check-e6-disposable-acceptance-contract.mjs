import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const runnerPath = join(root, "scripts/run-e6-disposable-acceptance.mjs");
const helperPath = join(root, "scripts/e6DisposableReadiness.mjs");
const sqlPath = join(root, "scripts/e6-disposable-fixture.sql");
const denoPath = join(root, "supabase/functions/_shared/e6DisposableAcceptance.test.ts");
const b2bMigrationPath = join(root, "supabase/migrations/20260806123000_media_object_cleanup_claims.sql");
const b2bSuccessorMigrationPath = join(root, "supabase/migrations/20260808133000_b2b_media_object_deletion_token_uuid.sql");
const migrationPath = join(root, "supabase/migrations/20260806143000_b3_job_x_claim_fencing.sql");
const b3aSuccessorMigrationPath = join(root, "supabase/migrations/20260808143000_b3a_reconcile_expired_job_claims_fix.sql");
const b3aFailSuccessorMigrationPath = join(root, "supabase/migrations/20260808153000_b3a_fail_x_post_delivery_null_fix.sql");
const b3aClaimSuccessorMigrationPath = join(root, "supabase/migrations/20260808163000_b3a_claim_x_ambiguous_retry_fix.sql");
const b3aClaimHistorySuccessorMigrationPath = join(root, "supabase/migrations/20260808173000_b3a_claim_x_ambiguous_history_fix.sql");
const runner = readFileSync(runnerPath, "utf8");
const helper = readFileSync(helperPath, "utf8");
const sql = readFileSync(sqlPath, "utf8");
const deno = readFileSync(denoPath, "utf8");
const b2bMigration = readFileSync(b2bMigrationPath, "utf8");
let b2bSuccessorMigration = "";
try { b2bSuccessorMigration = readFileSync(b2bSuccessorMigrationPath, "utf8"); } catch { /* RED until successor exists */ }
const migration = readFileSync(migrationPath, "utf8");
let b3aSuccessorMigration = "";
try { b3aSuccessorMigration = readFileSync(b3aSuccessorMigrationPath, "utf8"); } catch { /* RED until successor exists */ }
let b3aFailSuccessorMigration = "";
try { b3aFailSuccessorMigration = readFileSync(b3aFailSuccessorMigrationPath, "utf8"); } catch { /* RED until successor exists */ }
let b3aClaimSuccessorMigration = "";
try { b3aClaimSuccessorMigration = readFileSync(b3aClaimSuccessorMigrationPath, "utf8"); } catch { /* RED until successor exists */ }
let b3aClaimHistorySuccessorMigration = "";
try { b3aClaimHistorySuccessorMigration = readFileSync(b3aClaimHistorySuccessorMigrationPath, "utf8"); } catch { /* RED until successor exists */ }

const EXPECTED_B2B_MIGRATION_SHA256 = "f830ed38a7b190ef01aa747f5cefbb315963d304fd097154b35c293ad8abf4ef";
const EXPECTED_B3A_MIGRATION_SHA256 = "024dc8569aa490d9050d63b4507e584a9ffba5cb255bc3df9e76e24a64b84ecd";
const EXPECTED_B3A_CLAIM_SUCCESSOR_SHA256 = "ad4d0e56f652f7df0b5d40b8258643b099e76ea5cb51b8b4d9d42fe380184807";

function fail(message) {
  throw new Error(`E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL ${message}`);
}

// These small lexical helpers keep source contracts tied to executable
// declarations/bodies.  A marker in a comment, a string, or an unrelated
// function must not satisfy a readiness contract.
function stripComments(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "lineComment") {
      if (current === "\n") { state = "code"; output += current; } else output += " ";
      continue;
    }
    if (state === "blockComment") {
      if (current === "*" && next === "/") { state = "code"; output += "  "; index += 1; } else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      output += current;
      if (current === "\\") { output += source[index + 1] ?? ""; index += 1; }
      else if ((state === "single" && current === "'") || (state === "double" && current === '"') || (state === "template" && current === "`")) state = "code";
      continue;
    }
    if (current === "/" && next === "/") { state = "lineComment"; output += "  "; index += 1; continue; }
    if (current === "/" && next === "*") { state = "blockComment"; output += "  "; index += 1; continue; }
    if (current === "'") { state = "single"; output += current; continue; }
    if (current === '"') { state = "double"; output += current; continue; }
    if (current === "`") { state = "template"; output += current; continue; }
    output += current;
  }
  return output;
}

function stripCommentsAndStrings(source) {
  const comments = stripComments(source);
  let output = "";
  let state = "code";
  for (let index = 0; index < comments.length; index += 1) {
    const current = comments[index];
    if (state === "single" || state === "double" || state === "template") {
      if (current === "\\") { output += "  "; index += 1; }
      else if ((state === "single" && current === "'") || (state === "double" && current === '"') || (state === "template" && current === "`")) { state = "code"; output += " "; }
      else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (current === "'") { state = "single"; output += " "; continue; }
    if (current === '"') { state = "double"; output += " "; continue; }
    if (current === "`") { state = "template"; output += " "; continue; }
    output += current;
  }
  return output;
}

function scanBalanced(source, openIndex, open = "{", close = "}") {
  let depth = 0;
  let state = "code";
  for (let index = openIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "lineComment") { if (current === "\n") state = "code"; continue; }
    if (state === "blockComment") { if (current === "*" && next === "/") { state = "code"; index += 1; } continue; }
    if (state === "single" || state === "double" || state === "template") {
      if (current === "\\") index += 1;
      else if ((state === "single" && current === "'") || (state === "double" && current === '"') || (state === "template" && current === "`")) state = "code";
      continue;
    }
    if (current === "/" && next === "/") { state = "lineComment"; index += 1; continue; }
    if (current === "/" && next === "*") { state = "blockComment"; index += 1; continue; }
    if (current === "'") { state = "single"; continue; }
    if (current === '"') { state = "double"; continue; }
    if (current === "`") { state = "template"; continue; }
    if (current === open) depth += 1;
    if (current === close) {
      depth -= 1;
      if (depth === 0) return { start: openIndex, end: index, body: source.slice(openIndex + 1, index) };
    }
  }
  return null;
}

function functionBody(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\b`));
  if (!match || match.index === undefined) return null;
  const parameterStart = source.indexOf("(", match.index + match[0].length);
  if (parameterStart < 0) return null;
  const parameters = scanBalanced(source, parameterStart, "(", ")");
  if (!parameters) return null;
  const openIndex = source.indexOf("{", parameters.end + 1);
  if (openIndex < 0) return null;
  return scanBalanced(source, openIndex);
}

function firstBlockAfter(source, pattern) {
  const match = source.match(pattern);
  if (!match || match.index === undefined) return null;
  const openIndex = match.index + match[0].length - 1;
  return scanBalanced(source, openIndex);
}

function declarationInitializer(source, name) {
  const code = stripComments(source);
  const match = code.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*`));
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  let state = "code";
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let index = start; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "single" || state === "double" || state === "template") {
      if (current === "\\") index += 1;
      else if ((state === "single" && current === "'") || (state === "double" && current === '"') || (state === "template" && current === "`")) state = "code";
      continue;
    }
    if (current === "'") { state = "single"; continue; }
    if (current === '"') { state = "double"; continue; }
    if (current === "`") { state = "template"; continue; }
    if (current === "(") paren += 1;
    else if (current === ")") paren -= 1;
    else if (current === "[") bracket += 1;
    else if (current === "]") bracket -= 1;
    else if (current === "{") brace += 1;
    else if (current === "}") brace -= 1;
    else if (current === ";" && paren === 0 && bracket === 0 && brace === 0) return source.slice(start, index).trim();
  }
  return source.slice(start).trim();
}

function callBodies(source, name) {
  const bodies = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const openIndex = source.indexOf("(", match.index + match[0].length - 1);
    const call = scanBalanced(source, openIndex, "(", ")");
    if (call) bodies.push(source.slice(call.start, call.end + 1));
    pattern.lastIndex = Math.max(pattern.lastIndex, openIndex + 1);
  }
  return bodies;
}

function requireFunction(source, name, label) {
  const result = functionBody(source, name);
  if (!result) fail(`${label}: ${name} function body missing`);
  return result.body;
}

function requireBlock(source, pattern, label) {
  const result = firstBlockAfter(source, pattern);
  if (!result) fail(`${label}: required control block missing`);
  return result.body;
}

function assertRequiredGeneration(source, functionName) {
  const signature = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(([\\s\\S]*?)\\)\\nRETURNS`))?.[1];
  if (!signature || !/p_claim_generation bigint,\s*\n/.test(signature) || /p_claim_generation bigint DEFAULT/.test(signature)) {
    fail(`${functionName}: required generation signature missing or optional`);
  }
}

function validatePort8080(source, label) {
  const body = requireFunction(source, "port8080", label);
  if (!/(?:execFileSync|spawnSync)\(\s*"lsof"[\s\S]*?"-iTCP:8080"[\s\S]*?"-sTCP:LISTEN"/.test(body)) fail(`${label}: port8080 must probe the exact lsof listener query`);
  if (!/timeout\s*:/.test(body)) fail(`${label}: port8080 lsof probe must be bounded`);
  if (!/stdio\s*:\s*\[\s*"ignore"\s*,\s*"pipe"\s*,\s*"pipe"\s*\]/.test(body)) fail(`${label}: port8080 must capture stdout/stderr for fail-closed classification`);
  if (!/if\s*\([^)]*result\.error\b[^)]*(?:\|\||\?\?)[^)]*result\.signal\b[^)]*\)/.test(body)) fail(`${label}: lsof errors and signals must fail closed`);
  if (!/status[\s\S]*===\s*1/.test(body) || !/signal/.test(body)) fail(`${label}: only status 1 without a signal may mean no listener`);
  if (!/\bstdout\b/.test(body) || !/\bstderr\b/.test(body) || !/(?:\bstdout\b|\bstderr\b)[\s\S]*(?:length\s*===\s*0|trim\(\)\s*===\s*["']["']|===\s*["']["'])/.test(body)) fail(`${label}: lsof stdout/stderr must both be empty for no-match`);
  if (!/if\s*\([\s\S]*status[\s\S]*===\s*1[\s\S]*\)\s*(?:\{\s*)?return\s*["']unbound["']/.test(body)) fail(`${label}: exact no-match branch must return unbound`);
  if (!/status\s*===\s*0[\s\S]*return\s*["']bound["']/.test(body)) fail(`${label}: only a clean lsof success may report bound`);
  if (!/throw\s+new\s+Error/.test(body) || !/redactedDiagnostic\s*\(\s*(?:error|result\.(?:error|signal|status|stdout|stderr))/.test(body)) fail(`${label}: unexpected lsof outcomes must throw bounded redacted diagnostics`);
}

function validateImageCommand(source, label) {
  const expected = declarationInitializer(source, "EXPECTED_IMAGE_CMD");
  if (!/Object\.freeze\(\s*\[\s*["']postgres["']\s*,\s*["']-D["']\s*,\s*["']\/etc\/postgresql["']\s*\]\s*\)/.test(expected ?? "")) {
    fail(`${label}: exact frozen image command is missing`);
  }
  if ((source.match(/\bEXPECTED_IMAGE_CMD\b/g) ?? []).length < 3) {
    fail(`${label}: frozen image command must be used by both preflight and run`);
  }
  const imageInspect = source.indexOf("const imageInspect");
  const spawn = source.indexOf('dockerWithBootstrap("run"');
  if (imageInspect < 0 || spawn < 0 || imageInspect > spawn) fail(`${label}: image command preflight ordering is invalid`);
  const preflight = source.slice(imageInspect, spawn);
  if (!/imageInspect\??\.Config\??\.Cmd/.test(preflight) || !/JSON\.stringify\(\s*imageInspect\??\.Config\??\.Cmd\s*\)\s*!==\s*JSON\.stringify\(\s*EXPECTED_IMAGE_CMD\s*\)/.test(preflight)) {
    fail(`${label}: image Config.Cmd is not compared exactly before start`);
  }
  const run = source.slice(spawn);
  if (!/IMAGE\s*,\s*\.\.\.EXPECTED_IMAGE_CMD\s*,\s*["']-c["']\s*,\s*["']cron\.database_name=postgres["']\s*,\s*["']-c["']\s*,\s*["']cron\.launch_active_jobs=off["']/.test(run)) {
    fail(`${label}: exact image command is not passed before cron settings`);
  }
}

function validateMigrationDiagnostics(source, label) {
  const body = requireFunction(source, "applyMigrations", label);
  const extractor = requireFunction(source, "extractSqlEvidence", label);
  const extractorCode = stripComments(extractor);
  if (!/error\?\.stderr/.test(extractorCode) || !/error\?\.stdout/.test(extractorCode) || !/error\?\.message/.test(extractorCode)) {
    fail(`${label}: SQL diagnostic extractor inputs are incomplete`);
  }
  if (!/ERROR\|CONTEXT\|STATEMENT\|DETAIL\|HINT/.test(extractorCode)) {
    fail(`${label}: SQL diagnostic evidence categories are incomplete`);
  }
  if (!/redactedDiagnostic\(detail\)/.test(extractorCode)) fail(`${label}: SQL diagnostic extractor is not bounded/redacted`);
  if (!/try\s*\{\s*runPsql\(prelude\(\)\);\s*\}\s*catch\s*\(error\)\s*\{\s*throw\s+new\s+Error\(`E6_REPLAY_FAIL stage=prelude detail=\$\{extractSqlEvidence\(error\)\}`\);\s*\}/.test(body)) {
    fail(`${label}: prelude failure is not distinctly attributed with bounded evidence`);
  }
  const migrationLoop = body.indexOf("for (const [index, migration] of migrations.entries())");
  const migrationCode = migrationLoop >= 0 ? body.slice(migrationLoop) : "";
  if (!/migration=\$\{migration\.name\}/.test(migrationCode) || !/index=\$\{index \+ 1\}/.test(migrationCode) || !/sha256=\$\{sha256\(migration\.body\)\}/.test(migrationCode)) {
    fail(`${label}: per-migration attribution is missing`);
  }
  if (!/extractSqlEvidence\(error\)/.test(migrationCode)) fail(`${label}: migration failures do not use bounded SQL evidence`);
}

function validateCronScalarStages(source, label) {
  const wrapper = requireFunction(source, "runPsqlScalarStage", label);
  if (!/try\s*\{\s*return\s+runPsqlScalar\(sql\);\s*\}\s*catch\s*\(error\)\s*\{\s*throw\s+new\s+Error\(`E6_REPLAY_FAIL stage=\$\{stage\} detail=\$\{extractSqlEvidence\(error\)\}`\);\s*\}/.test(wrapper)) {
    fail(`${label}: scalar stage wrapper is not bounded/redacted`);
  }
  const databaseCall = /runPsqlScalarStage\(\s*["']cron-database-name["']\s*,\s*["']SHOW cron\.database_name;["']\s*\)/;
  const launchCall = /runPsqlScalarStage\(\s*["']cron-launch-active-jobs["']\s*,\s*["']SHOW cron\.launch_active_jobs;["']\s*\)/;
  if (!databaseCall.test(source) || !launchCall.test(source)) fail(`${label}: distinct cron scalar stages are missing or swapped`);
  if ((source.match(/\brunPsqlScalarStage\s*\(/g) ?? []).length !== 3) fail(`${label}: cron scalar stages contain duplicate or dead calls`);
  if (/runPsqlScalar\(\s*["']SHOW cron\./.test(source)) fail(`${label}: cron scalar probes bypass the stage wrapper`);
  if (!/cronDatabaseName\s*!==\s*["']postgres["']/.test(source) || !/cronLaunchSetting\s*!==\s*["']off["']/.test(source)) {
    fail(`${label}: exact cron scalar value comparisons are missing`);
  }
}

function validateSqlFixtureStage(source, label) {
  const splitter = requireFunction(source, "splitSqlFixtureSections", label);
  const splitterCode = stripComments(splitter);
  if (!/sql\.slice\(/.test(splitterCode) || !/sections\.push\(/.test(splitterCode) || !/dollar/i.test(splitterCode)) {
    fail(`${label}: SQL fixture section splitter must preserve bounded SQL slices and dollar-quoted blocks`);
  }
  const tracer = requireFunction(source, "runSqlFixture", label);
  if (!/splitSqlFixtureSections\(sql\)/.test(tracer) || !/sections\.entries\(\)/.test(tracer)) {
    fail(`${label}: SQL fixture section tracer is missing bounded section iteration`);
  }
  if (!/try\s*\{\s*runPsql\(section\);\s*\}\s*catch\s*\(error\)/.test(tracer)) {
    fail(`${label}: SQL fixture section tracer does not execute each exact section with bounded capture`);
  }
  if (!/fixture-section=\$\{index \+ 1\}/.test(tracer) || !/extractSqlEvidence\(error\)/.test(tracer)) {
    fail(`${label}: SQL fixture section failures lack bounded section attribution/evidence`);
  }
  const fixtureCall = /try\s*\{\s*runSqlFixture\(readFileSync\(SQL_FIXTURE,\s*["']utf8["']\)\);\s*\}\s*catch\s*\(error\)\s*\{\s*throw\s+new\s+Error\(`E6_REPLAY_FAIL stage=sql-fixture detail=\$\{extractSqlEvidence\(error\)\}`\);\s*\}/;
  if (!fixtureCall.test(source)) fail(`${label}: SQL fixture failure is not distinctly attributed with bounded evidence`);
  if (source.split("runSqlFixture(readFileSync(SQL_FIXTURE").length - 1 !== 1 || !/readFileSync\(SQL_FIXTURE,\s*["']utf8["']\)/.test(source)) {
    fail(`${label}: SQL fixture bytes are not preserved exactly`);
  }
  const migration = source.indexOf("migrationReceipt = applyMigrations();");
  const fixture = source.indexOf("runSqlFixture(readFileSync(SQL_FIXTURE, \"utf8\"));");
  const deno = source.indexOf('execFileSync("npm"');
  if (migration < 0 || fixture < 0 || deno < 0 || !(migration < fixture && fixture < deno)) {
    fail(`${label}: SQL fixture ordering is not migrations then fixture then Deno`);
  }
}

function validateDenoCommand(source, label) {
  if ((source.match(/execFileSync\("npm"/g) ?? []).length !== 1) {
    fail(`${label}: Deno test must have exactly one npm exec invocation`);
  }
  const call = source.match(/execFileSync\("npm",\s*\[([\s\S]*?)\],\s*\{\s*cwd:\s*ROOT,\s*stdio:\s*"inherit",\s*timeout:\s*TIMEOUTS\.denoMs,/)
    ?. [1] ?? "";
  if (!call) fail(`${label}: bounded offline Deno test command is missing`);
  const required = [
    '"exec"', '"--offline"', '"--yes"', '"deno"', '"--"', '"test"',
    '"--cached-only"', '"--frozen"', '"--deny-net"', '"--no-check"', "DENO_FIXTURE",
  ];
  let previous = -1;
  for (const token of required) {
    const position = call.indexOf(token);
    if (position < 0 || position <= previous) fail(`${label}: Deno command cache/offline flags are missing or reordered at ${token}`);
    if ((call.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) fail(`${label}: Deno command token ${token} is duplicated or decoyed`);
    previous = position;
  }
  if (call.includes('"npx"') || call.includes('"deno", "test"')) fail(`${label}: Deno test bypasses npm offline execution`);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function validateB2BOriginalImmutable(source, label) {
  if (sha256(source) !== EXPECTED_B2B_MIGRATION_SHA256) {
    fail(`${label}: accepted B2B migration SHA drifted`);
  }
}

function validateB2BSuccessor(source, label) {
  const uuidPattern = "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$";
  if (!/DO\s*\$\$[\s\S]*IF\s+EXISTS\s*\([\s\S]*deletion_token\s+IS\s+NOT\s+NULL[\s\S]*deletion_token\s+!~\s*'\^\[0-9A-Fa-f\]\{8\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{12\}\$'[\s\S]*\)\s*THEN[\s\S]*RAISE\s+EXCEPTION/.test(source)) {
    fail(`${label}: fail-closed UUID guard for existing deletion_token values is missing`);
  }
  if (!source.includes(`deletion_token !~ '${uuidPattern}'`)) {
    fail(`${label}: UUID guard regex is weak or bypassable`);
  }
  if (!/RAISE\s+EXCEPTION\s+'E6_B2B invalid deletion_token values prevent UUID conversion'/.test(source)) {
    fail(`${label}: bounded invalid-token exception is missing`);
  }
  if (!/USING\s+ERRCODE\s*=\s*'check_violation'/.test(source)) {
    fail(`${label}: invalid-token exception code is not bounded`);
  }
  if (!/ALTER TABLE\s+public\.media_objects\s+ALTER COLUMN\s+deletion_token\s+TYPE\s+uuid\s+USING\s+deletion_token::uuid\s*;/.test(source)) {
    fail(`${label}: deletion_token uuid ALTER with explicit cast is missing or wrong`);
  }
}

function extractReconcileFunction(source, label) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.reconcile_expired_job_claims(");
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0) fail(`${label}: reconcile_expired_job_claims function is missing or unterminated`);
  return source.slice(start, end + "\n$$;".length);
}

function validateB3AOriginalImmutable(source, label) {
  if (sha256(source) !== EXPECTED_B3A_MIGRATION_SHA256) fail(`${label}: accepted B3A migration SHA drifted`);
}

function validateB3ASuccessor(original, successor, label) {
  if (!successor) fail(`${label}: additive B3A reconcile successor migration is missing`);
  const originalFunction = extractReconcileFunction(original, `${label} original`);
  const expectedFunction = originalFunction.replace("FROM requeue r", "FROM requeueable r");
  const successorFunction = extractReconcileFunction(successor, label);
  if (successorFunction !== expectedFunction) fail(`${label}: successor must copy the accepted reconcile function with only the CTE reference corrected`);
  if ((successor.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length !== 1) fail(`${label}: successor changes more than the reconcile function`);
  if ((successor.match(/FROM requeue r/g) ?? []).length !== 0) fail(`${label}: successor retains the broken FROM requeue reference`);
  if ((successorFunction.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length !== 1 || !/LIMIT\s+GREATEST\(1,\s*COALESCE\(p_max_claims, 100\)\)[\s\S]*FOR UPDATE SKIP LOCKED/.test(successorFunction)) {
    fail(`${label}: limited SKIP LOCKED requeue selection is missing or changed`);
  }
  if (!/SELECT count\(\*\) INTO v_requeued FROM do_requeue;/.test(successorFunction) || !/RETURNING j\.id/.test(successorFunction)) {
    fail(`${label}: requeue update/return count behavior is missing`);
  }
  if (!/v_ambiguous[\s\S]*AND j\.provider_started_at IS NOT NULL/.test(successorFunction) || !/jsonb_build_object\([\s\S]*'requeued'[\s\S]*v_requeued[\s\S]*'ambiguous'[\s\S]*v_ambiguous[\s\S]*'reconciled_at'[\s\S]*v_now/.test(successorFunction)) {
    fail(`${label}: ambiguity accounting or JSON behavior is missing`);
  }
  if (!/SET search_path TO public, pg_catalog/.test(successorFunction)) fail(`${label}: successor search_path is not closed`);
  if (!/REVOKE ALL ON FUNCTION public\.reconcile_expired_job_claims\(integer\) FROM public, anon, authenticated;/.test(successor) || !/GRANT EXECUTE ON FUNCTION public\.reconcile_expired_job_claims\(integer\) TO service_role;/.test(successor)) {
    fail(`${label}: successor reconcile grants are missing or widened`);
  }
}

function extractFailXFunction(source, label) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.fail_x_post_delivery(");
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0) fail(`${label}: fail_x_post_delivery function is missing or unterminated`);
  return source.slice(start, end + "\n$$;".length);
}

function validateB3AFailSuccessor(original, successor, label) {
  if (!successor) fail(`${label}: additive B3A fail_x successor migration is missing`);
  const originalFunction = extractFailXFunction(original, `${label} original`);
  const brokenExpression = "claim_expires_at = CASE WHEN v_ambiguous THEN NULL ELSE NULL END,";
  if ((originalFunction.match(new RegExp(brokenExpression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) {
    fail(`${label}: accepted fail_x function no longer contains the receipt-bound broken expression`);
  }
  const expectedFunction = originalFunction.replace(brokenExpression, "claim_expires_at = NULL,");
  const successorFunction = extractFailXFunction(successor, label);
  if (successorFunction !== expectedFunction) fail(`${label}: successor must copy fail_x exactly with only the claim_expires_at expression corrected`);
  if ((successor.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length !== 1) fail(`${label}: successor changes more than fail_x_post_delivery`);
  if (successor.includes(brokenExpression)) fail(`${label}: successor retains the text-typed CASE NULL expression`);
  if (!/claim_expires_at\s*=\s*NULL,/.test(successorFunction)) fail(`${label}: fail_x successor must clear claim_expires_at with a typed NULL`);
  if (!/REVOKE ALL ON FUNCTION public\.fail_x_post_delivery\(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text\) FROM public, anon, authenticated;/.test(successor) || !/GRANT EXECUTE ON FUNCTION public\.fail_x_post_delivery\(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text\) TO service_role;/.test(successor)) {
    fail(`${label}: fail_x successor grants are missing or widened`);
  }
}

function extractClaimXFunction(source, label) {
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.claim_x_post_delivery(");
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0) fail(`${label}: claim_x_post_delivery function is missing or unterminated`);
  return source.slice(start, end + "\n$$;".length);
}

function validateB3AClaimSuccessor(original, successor, label) {
  if (!successor) fail(`${label}: additive B3A claim successor migration is missing`);
  const originalFunction = extractClaimXFunction(original, `${label} original`);
  const forceRetryGate = "IF FOUND AND NOT COALESCE(p_force_retry, false) THEN";
  if ((originalFunction.match(new RegExp(forceRetryGate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) {
    fail(`${label}: accepted claim function no longer contains the receipt-bound force-retry gate`);
  }
  const expectedFunction = originalFunction.replace(
    forceRetryGate,
    "IF FOUND AND (v_existing.claim_state = 'ambiguous' OR NOT COALESCE(p_force_retry, false)) THEN",
  );
  const successorFunction = extractClaimXFunction(successor, label);
  if (successorFunction !== expectedFunction) fail(`${label}: successor must copy claim_x exactly with only the durable ambiguity force-retry guard added`);
  if ((successor.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length !== 1) fail(`${label}: successor changes more than claim_x_post_delivery`);
  if (successor.includes(forceRetryGate)) fail(`${label}: successor retains the force-retry ambiguity bypass`);
  if (!/v_existing\.claim_state\s*=\s*'ambiguous'\s+OR\s+NOT COALESCE\(p_force_retry, false\)/.test(successorFunction)) fail(`${label}: ambiguous claim_state is not durable-blocked before force retry`);
  if (!/IF FOUND AND[\s\S]*NOT COALESCE\(p_force_retry, false\)/.test(successorFunction)) fail(`${label}: ordinary failed/skipped force-retry gate is missing`);
  if (!/REVOKE ALL ON FUNCTION public\.claim_x_post_delivery\(text,text,boolean,integer\) FROM public, anon, authenticated;/.test(successor) || !/GRANT EXECUTE ON FUNCTION public\.claim_x_post_delivery\(text,text,boolean,integer\) TO service_role;/.test(successor)) {
    fail(`${label}: claim_x successor grants are missing or widened`);
  }
}

function validateB3AClaimSuccessorImmutable(source, label) {
  if (sha256(source) !== EXPECTED_B3A_CLAIM_SUCCESSOR_SHA256) fail(`${label}: accepted 1630 claim successor SHA drifted`);
}

function validateB3AClaimHistorySuccessor(predecessor, successor, label) {
  if (!successor) fail(`${label}: additive B3A claim-history successor migration is missing`);
  validateB3AClaimSuccessorImmutable(predecessor, `${label} predecessor`);
  const predecessorFunction = extractClaimXFunction(predecessor, `${label} predecessor`);
  const declaration = "  v_existing record;\n";
  if ((predecessorFunction.match(new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 1) {
    fail(`${label}: predecessor claim function declaration anchor is missing`);
  }
  const historyBlock = "  SELECT EXISTS (\n    SELECT 1\n    FROM public.x_deliveries h\n    WHERE h.post_id = v_post_id\n      AND h.status <> 'posted'\n      AND (h.claim_state = 'ambiguous' OR h.provider_started_at IS NOT NULL)\n  ) INTO v_has_ambiguous_history;\n  IF v_has_ambiguous_history THEN\n    RETURN jsonb_build_object('claimed', false, 'reason', 'ambiguous');\n  END IF;\n\n";
  const withHistoryVariable = predecessorFunction.replace(declaration, `${declaration}  v_has_ambiguous_history boolean;\n`);
  const historyAnchor = withHistoryVariable.indexOf("  -- SF4:");
  if (historyAnchor < 0) fail(`${label}: predecessor SF4 history anchor is missing`);
  const expectedFunction = `${withHistoryVariable.slice(0, historyAnchor)}${historyBlock}${withHistoryVariable.slice(historyAnchor)}`;
  const successorFunction = extractClaimXFunction(successor, label);
  if (successorFunction !== expectedFunction) fail(`${label}: successor must add only the history-wide ambiguity gate to the accepted claim function`);
  if ((successor.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length !== 1) fail(`${label}: successor changes more than claim_x_post_delivery`);
  if (!/SELECT EXISTS\s*\([\s\S]*h\.post_id\s*=\s*v_post_id[\s\S]*h\.status\s*<>\s*'posted'[\s\S]*h\.claim_state\s*=\s*'ambiguous'[\s\S]*h\.provider_started_at\s+IS\s+NOT\s+NULL[\s\S]*\)\s+INTO\s+v_has_ambiguous_history/.test(successorFunction)) {
    fail(`${label}: history-wide ambiguous/provider-started ANY predicate is missing or narrowed`);
  }
  if (!/IF v_has_ambiguous_history THEN\s*RETURN jsonb_build_object\('claimed', false, 'reason', 'ambiguous'\);/.test(successorFunction)) {
    fail(`${label}: stable ambiguous history reason is missing`);
  }
  if (!/REVOKE ALL ON FUNCTION public\.claim_x_post_delivery\(text,text,boolean,integer\) FROM public, anon, authenticated;/.test(successor) || !/GRANT EXECUTE ON FUNCTION public\.claim_x_post_delivery\(text,text,boolean,integer\) TO service_role;/.test(successor)) {
    fail(`${label}: claim-history successor grants are missing or widened`);
  }
}

function validateB2BFinalizeDiagnostic(source, label) {
  const finalSection = source.slice(source.indexOf("-- The claim/finalize path is exact-token only"));
  const finalBlock = finalSection.match(/IF NOT public\.media_objects_finalize_delete\([\s\S]*?e6\/token\.jpg[\s\S]*?token_old\s*\n\s*\)\s*THEN([\s\S]*?)END IF;/)?.[0] ?? "";
  if (!finalBlock || (finalBlock.match(/media_objects_finalize_delete/g) ?? []).length !== 1) {
    fail(`${label}: final token finalize call is missing, duplicated, or not guarded`);
  }
  for (const required of [
    "object_present", "finalize_status", "finalize_token_match", "finalize_lease_live",
    "pending_jobs", "running_jobs", "pending_deliveries", "running_deliveries",
    "pending_x_deliveries", "running_x_deliveries", "unsafe_video_gif",
  ]) {
    if (!new RegExp(`\\b${required}\\b`).test(finalBlock)) fail(`${label}: safe finalization diagnostic field ${required} is missing or detached`);
  }
  if (!/SELECT\s+EXISTS\s*\([\s\S]*media_objects[\s\S]*e6\/token\.jpg[\s\S]*\)\s+INTO\s+object_present/.test(finalBlock)) {
    fail(`${label}: object presence diagnostic query is missing`);
  }
  if (!/SELECT\s+mo\.status[\s\S]*deletion_token[\s\S]*claim_expires_at[\s\S]*INTO\s+finalize_status\s*,\s*finalize_token_match\s*,\s*finalize_lease_live/.test(finalBlock)) {
    fail(`${label}: status/token-match/lease diagnostic query is missing`);
  }
  if (!/SELECT\s+count\(\*\)\s+FILTER\s*\(WHERE\s+j\.status\s*=\s*'pending'\)[\s\S]*count\(\*\)\s+FILTER\s*\(WHERE\s+j\.status\s*=\s*'running'\)[\s\S]*INTO\s+pending_jobs\s*,\s*running_jobs/.test(finalBlock)) {
    fail(`${label}: pending/running job counts are missing`);
  }
  if (!/SELECT\s+count\(\*\)\s+FILTER\s*\(WHERE\s+d\.status\s*=\s*'pending'\)[\s\S]*count\(\*\)\s+FILTER\s*\(WHERE\s+d\.status\s*=\s*'running'\)[\s\S]*INTO\s+pending_deliveries\s*,\s*running_deliveries/.test(finalBlock)) {
    fail(`${label}: pending/running delivery counts are missing`);
  }
  if (!/SELECT\s+count\(\*\)\s+FILTER\s*\(WHERE\s+xd\.status\s*=\s*'pending'\)[\s\S]*count\(\*\)\s+FILTER\s*\(WHERE\s+xd\.status\s*=\s*'running'\)[\s\S]*INTO\s+pending_x_deliveries\s*,\s*running_x_deliveries/.test(finalBlock)) {
    fail(`${label}: pending/running X-delivery counts are missing`);
  }
  if (!/SELECT\s+count\(\*\)\s+INTO\s+unsafe_video_gif[\s\S]*kind\s+IN\s*\('video'\s*,\s*'gif'\)[\s\S]*mime_type\s+IS\s+NULL[\s\S]*NOT LIKE\s*'video\/%'/.test(finalBlock)) {
    fail(`${label}: unsafe video/gif diagnostic count is missing`);
  }
  const message = finalBlock.match(/RAISE EXCEPTION\s+'E6_B2B token finalization failed[^']*'/)?.[0] ?? "";
  if (!/object_present=%[\s\S]*status=%[\s\S]*token_match=%[\s\S]*lease_live=%[\s\S]*pending_jobs=%[\s\S]*running_jobs=%[\s\S]*pending_deliveries=%[\s\S]*running_deliveries=%[\s\S]*pending_x_deliveries=%[\s\S]*running_x_deliveries=%[\s\S]*unsafe_video_gif=%/.test(message)) {
    fail(`${label}: deterministic bounded E6_B2B diagnostic message is incomplete`);
  }
  if (/token_old|\btoken\s*=%|e6\/token\.jpg|storage_path|payload|deletion_token/.test(message)) {
    fail(`${label}: finalization diagnostic message leaks token/path/payload values`);
  }
}

function validateB2BFixtureOrder(source, label) {
  const tokenSeed = source.match(/\('00000000-0000-0000-0000-000000000631',\s*'e6-token-a',[\s\S]*?\),/i)?.[0] ?? "";
  if (!/\('00000000-0000-0000-0000-000000000631',\s*'e6-token-a',\s*'image',\s*'e6\/token\.jpg',\s*now\(\)\s*-\s*interval\s*'2 days'/i.test(tokenSeed)) {
    fail(`${label}: e6-token-a must start fresh and outside the 30-day claim cutoff`);
  }

  const duplicateFinalize = source.indexOf("IF NOT public.media_objects_finalize_delete(object_id, token_new)");
  const tokenClaim = source.indexOf("FROM public.media_objects_claim_old('temp-media', 100, 30)\n   WHERE storage_path = 'e6/token.jpg'");
  const transitionMatch = source.match(/UPDATE\s+public\.media\s+SET\s+downloaded_at\s*=\s*now\(\)\s*-\s*interval\s*'45 days'/i);
  const transitionStart = transitionMatch?.index ?? -1;
  if (duplicateFinalize < 0 || tokenClaim < 0 || transitionStart < 0 || transitionStart <= duplicateFinalize || transitionStart >= tokenClaim) {
    fail(`${label}: token age transition is missing or outside duplicate-finalize/token-claim ordering`);
  }
  const transitionEnd = source.indexOf("SELECT deletion_token INTO token_old", transitionStart);
  const transition = source.slice(transitionStart, transitionEnd < 0 ? tokenClaim : transitionEnd);
  if (!/UPDATE\s+public\.media\s+SET\s+downloaded_at\s*=\s*now\(\)\s*-\s*interval\s*'45 days'/i.test(transition)) {
    fail(`${label}: exact token age transition is missing`);
  }
  if (!/WHERE\s+id\s*=\s*'00000000-0000-0000-0000-000000000631'\s+AND\s+tweet_id\s*=\s*'e6-token-a'\s+AND\s+storage_path\s*=\s*'e6\/token\.jpg'/i.test(transition)) {
    fail(`${label}: token age transition is broader than the fixed fixture row`);
  }
  if (!/GET\s+DIAGNOSTICS\s+token_aged_count\s*=\s*ROW_COUNT/i.test(transition)) {
    fail(`${label}: token age transition row count is not captured`);
  }
  if (!/IF\s+token_aged_count\s*<>\s*1\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+'E6_B2B token age transition expected one row'/i.test(transition)) {
    fail(`${label}: token age transition does not fail closed on a non-single-row update`);
  }
}

function validateB3AHistoryFixture(source, label) {
  const section = source.slice(source.indexOf("-- X claim/provider-start/complete/fail generation fences and ambiguity."));
  const maskingStart = section.indexOf("-- A newer ordinary receipt must not mask the real provider-started history.");
  const markerStart = section.indexOf("-- The durable marker is authoritative");
  const ordinaryStart = section.indexOf("-- A true pre-provider failure remains operator-force-retryable.");
  if (maskingStart < 0 || markerStart <= maskingStart || ordinaryStart <= markerStart) {
    fail(`${label}: X ambiguity fixture sections are missing or reordered`);
  }
  const original = section.slice(0, maskingStart);
  const masking = section.slice(maskingStart, markerStart);
  const markerOnly = section.slice(markerStart, ordinaryStart);
  const ordinary = section.slice(ordinaryStart);
  if (!/second->>'claimed'\s*<>\s*'false'\s*OR\s*second->>'reason'\s*<>\s*'ambiguous'/.test(original)) {
    fail(`${label}: original ambiguous receipt does not assert the stable ambiguous reason`);
  }
  if (!/INSERT INTO public\.x_deliveries\s*\(id, post_id, status, claim_state, provider_started_at, created_at, updated_at\)[\s\S]*'e6-x-post',\s*'failed',\s*'failed',\s*NULL/.test(masking) || !/claim_x_post_delivery\('e6-x-post',\s*'e6',\s*true,\s*1800\)[\s\S]*reason'\s*<>\s*'ambiguous'/.test(masking)) {
    fail(`${label}: newer ordinary receipt does not exercise history masking`);
  }
  const markerClaim = markerOnly.indexOf("claim_x_post_delivery('e6-x-marker-only', 'e6', false, 1800)");
  const markerBoundary = markerOnly.indexOf("mark_x_delivery_provider_started(did, tok, gen)");
  const markerFail = markerOnly.indexOf("fail_x_post_delivery(did, tok, gen, 'failed', 'e6-provider-retriable', NULL, now() + interval '15 minutes', 'x_api_retriable'");
  const markerRetry = markerOnly.indexOf("claim_x_post_delivery('e6-x-marker-only', 'e6', true, 1800)");
  if (markerClaim < 0 || markerBoundary <= markerClaim || markerFail <= markerBoundary || markerRetry <= markerFail) {
    fail(`${label}: marker-only claim/marker/fail/retry lifecycle is missing or reordered`);
  }
  if (!/provider_started_at\s+IS\s+NOT\s+NULL\s+AND\s+claim_state\s*=\s*'failed'/.test(markerOnly) || !/second->>'reason'\s*<>\s*'ambiguous'/.test(markerOnly)) {
    fail(`${label}: marker-only persisted state or stable ambiguity rejection is missing`);
  }
  const ordinaryClaim = ordinary.indexOf("claim_x_post_delivery('e6-x-ordinary', 'e6', false, 1800)");
  const ordinaryFail = ordinary.indexOf("fail_x_post_delivery(did, tok, gen, 'failed', 'e6-pre-provider', NULL, NULL, 'pre_provider'");
  const ordinaryRetry = ordinary.indexOf("claim_x_post_delivery('e6-x-ordinary', 'e6', true, 1800)");
  if (ordinaryClaim < 0 || ordinaryFail <= ordinaryClaim || ordinaryRetry <= ordinaryFail || ordinary.includes("mark_x_delivery_provider_started")) {
    fail(`${label}: ordinary pre-provider claim/fail/retry lifecycle is missing, reordered, or provider-marked`);
  }
  if (!/provider_started_at\s+IS\s+NULL\s+AND\s+claim_state\s*=\s*'failed'/.test(ordinary) || !/first->>'claimed'\s*<>\s*'true'/.test(ordinary)) {
    fail(`${label}: ordinary pre-provider state or successful force retry assertion is missing`);
  }
}

function validateReadinessHelper(source, label) {
  const markerInitializer = declarationInitializer(source, "UPSTREAM_INIT_COMPLETE_MARKER");
  const marker = /^(['"])PostgreSQL init process complete; ready for start up\.\1$/.test(markerInitializer ?? "");
  if (!marker) fail(`${label}: exact upstream init-complete marker missing`);

  const query = declarationInitializer(source, "BASE_CATALOG_GATE_QUERY");
  if (!query) fail(`${label}: base catalog query declaration missing`);
  if (/graphql/i.test(query)) fail(`${label}: optional GraphQL catalog prerequisite present`);
  for (const required of [
    "pg_postmaster_start_time", "current_database", "version()", "pg_namespace",
    "nspname = 'extensions'", "pg_extension", "extname = 'plpgsql'", "pg_database",
    "datname = 'postgres'", "pg_roles", "rolname = 'postgres'", "rolname = 'supabase_admin'",
  ]) if (!new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(query)) fail(`${label}: base catalog query missing ${required}`);

  const fields = declarationInitializer(source, "SAMPLE_FIELDS");
  if (!fields || (fields.match(/['"]/g) ?? []).length < 16 || !/postmasterStartTime[\s\S]*supabaseAdminRoleOid/.test(fields)) fail(`${label}: complete catalog sample field list missing`);
  const helperBody = requireFunction(source, "waitForDisposableReadiness", label);
  const helperCode = stripCommentsAndStrings(helperBody);
  const gate = requireBlock(helperBody, /if\s*\(\s*initComplete\s*\)\s*\{/, label);
  const gateCode = stripCommentsAndStrings(gate);
  const gateStart = helperCode.indexOf("if (initComplete)");
  if (!/let\s+initComplete\s*=\s*false/.test(helperCode) || gateStart < 0) fail(`${label}: init-complete state gate missing`);
  const beforeGate = helperCode.slice(0, gateStart);
  if (!/readLogs\s*\(\)/.test(beforeGate) || !/\.trim\(\)\s*===\s*UPSTREAM_INIT_COMPLETE_MARKER/.test(beforeGate)) fail(`${label}: upstream marker is not checked as an exact trimmed line before readiness`);
  if (/\.includes\(\s*UPSTREAM_INIT_COMPLETE_MARKER\s*\)/.test(beforeGate)) fail(`${label}: embedded init marker decoy is accepted`);
  if (/assertReady\s*\(|readSample\s*\(/.test(beforeGate)) fail(`${label}: readiness/sample probe is not marker-gated`);
  if (!/assertReady\s*\(\)/.test(gateCode) || !/parseCatalogSample\s*\(\s*readSample\s*\(\)\s*\)/.test(gateCode)) fail(`${label}: pg_isready/sample are outside the init gate`);
  if (/readSample\s*\(/.test(helperCode.slice(gateStart + gate.length + 30))) fail(`${label}: sample probe appears outside the init gate`);

  const parseBody = requireFunction(source, "parseCatalogSample", label);
  const parseCode = stripComments(parseBody);
  if (!/parts\.length\s*!==\s*SAMPLE_FIELDS\.length/.test(parseCode) || !/values\.some\(\s*\(value\)\s*=>\s*!value\s*\)/.test(parseCode)) fail(`${label}: incomplete catalog samples are not rejected`);
  if (!/Object\.fromEntries\(SAMPLE_FIELDS\.map/.test(parseCode)) fail(`${label}: complete sample normalization missing`);
  const sameBody = requireFunction(source, "sameSample", label);
  if (!/left\s*&&\s*right\s*&&\s*SAMPLE_FIELDS\.every\(\s*\(field\)\s*=>\s*left\[field\]\s*===\s*right\[field\]\s*\)/.test(stripComments(sameBody))) fail(`${label}: complete sample equality missing`);
  const compare = helperBody.indexOf("if (sameSample(previousSample, sample))");
  const previous = helperBody.indexOf("previousSample = sample;");
  if (compare < 0 || previous < 0 || previous < compare || !/if\s*\(sameSample\(previousSample, sample\)\)\s*return sample;/.test(helperBody)) fail(`${label}: two identical complete samples are not required in order`);

  const timeout = declarationInitializer(source, "DEFAULT_TIMEOUT_MS");
  const timeoutMs = Number(timeout.replace(/_/g, ""));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) fail(`${label}: readiness timeout is missing or unbounded`);
  const deadlineBody = requireFunction(source, "getDeadline", label);
  if (!/now\(\)\s*\+\s*DEFAULT_TIMEOUT_MS/.test(stripComments(deadlineBody))) fail(`${label}: default readiness deadline is not bounded`);
  if (!/while\s*\(\s*now\(\)\s*<\s*end\s*\)/.test(helperCode) || (helperCode.match(/while\s*\(/g) ?? []).length !== 1) fail(`${label}: bounded readiness loop missing`);
  const callbackNames = ["readLogs", "assertReady", "readSample", "sleep"];
  for (const callbackName of callbackNames) {
    const callbackCount = (helperCode.match(new RegExp(`\\b${callbackName}\\s*\\(`, "g")) ?? []).length;
    if (callbackCount < 1) fail(`${label}: ${callbackName} callback missing`);
  }
  const deadlineFunctions = [...helperCode.matchAll(/function\s+(\w*Deadline\w*)\s*\(/g)].map((match) => match[1]);
  const deadlineToken = /now\(\)\s*>=\s*end|assert(?:Within)?Deadline|checkDeadline|ensureDeadline|deadlineGuard|deadlineCheck/;
  const deadlineChecks = (helperBody.match(/now\(\)\s*>=\s*end|assert(?:Within)?Deadline|checkDeadline|ensureDeadline|deadlineGuard|deadlineCheck/g) ?? []).length;
  if (deadlineChecks < 8) fail(`${label}: readiness callback deadline checks before/after each callback missing count=${deadlineChecks}`);
  const callbackPositions = callbackNames.map((name) => ({ name, index: helperCode.search(new RegExp(`\\b${name}\\s*\\(`)) })).sort((left, right) => left.index - right.index);
  for (let index = 0; index < callbackPositions.length; index += 1) {
    const current = callbackPositions[index];
    const previousBoundary = index === 0 ? 0 : callbackPositions[index - 1].index + callbackPositions[index - 1].name.length;
    const nextBoundary = index + 1 < callbackPositions.length ? callbackPositions[index + 1].index : helperCode.length;
    if (!deadlineToken.test(helperCode.slice(previousBoundary, current.index)) || !deadlineToken.test(helperCode.slice(current.index, nextBoundary))) fail(`${label}: ${current.name} callback lacks before/after deadline checks`);
  }

  const diagnostic = requireFunction(source, "redactedDiagnostic", label);
  const diagnosticCode = stripComments(diagnostic);
  if (!/\.replace\(/.test(diagnosticCode) || !/(?:password|passwd|secret|token|key)/i.test(diagnosticCode) || !/REDACTED/.test(diagnostic) || !/MAX_DIAGNOSTIC_LENGTH/.test(diagnosticCode) || !/text\.slice\(/.test(diagnosticCode)) fail(`${label}: diagnostic redaction/length bound missing`);
  const bounded = requireFunction(source, "boundedSample", label);
  if (!/MAX_SAMPLE_LENGTH/.test(stripComments(bounded)) || !/text\.slice\(/.test(stripComments(bounded))) fail(`${label}: sample diagnostic length bound missing`);
  const timeoutError = requireFunction(source, "timeoutError", label);
  if (!/boundedSample\(sample\)/.test(timeoutError) || !/redactedDiagnostic\(lastError\)/.test(timeoutError)) fail(`${label}: timeout diagnostics are not sanitized and bounded`);
}

function validateRunner(source, label) {
  const code = stripComments(source);
  if (!/import\s*\{[\s\S]*BASE_CATALOG_GATE_QUERY[\s\S]*waitForDisposableReadiness[\s\S]*\}\s*from\s*["']\.\/e6DisposableReadiness\.mjs["']/.test(code)) fail(`${label}: readiness helper imports missing`);
  if (!/"--pull=never"/.test(source)) fail(`${label}: pull policy missing`);
  if (!/"--network",\s*"none"/.test(source)) fail(`${label}: network policy missing`);
  if (!/"--restart=no"/.test(source)) fail(`${label}: restart policy missing`);
  if (!/function runPsqlScalar[\s\S]*?"-At"/.test(source)) fail(`${label}: scalar psql output missing`);
  const wrapper = requireFunction(source, "requireStableCatalogReady", label);
  validatePort8080(source, label);
  validateImageCommand(source, label);
  validateMigrationDiagnostics(source, label);
  validateCronScalarStages(source, label);
  validateSqlFixtureStage(source, label);
  validateDenoCommand(source, label);
  const wrapperCode = stripComments(wrapper);
  if (!/waitForDisposableReadiness\s*\(\s*\{/.test(wrapperCode)) fail(`${label}: readiness helper call missing`);
  if (!/readLogs:\s*\(\)\s*=>\s*dockerText\(\["logs",\s*CONTAINER\]\)/.test(wrapper)) fail(`${label}: docker logs readiness callback missing`);
  if (!/assertReady:\s*\(\)\s*=>\s*docker\(\s*"exec",\s*CONTAINER,\s*"pg_isready"/.test(wrapper)) fail(`${label}: pg_isready readiness callback missing`);
  if (!/readSample:\s*\(\)\s*=>\s*runPsqlScalar\(BASE_CATALOG_GATE_QUERY\)/.test(wrapper)) fail(`${label}: base catalog sample callback missing`);
  if (!/sleep:\s*\(\)\s*=>\s*docker\(\s*"exec",\s*CONTAINER,\s*"sh",\s*"-c",\s*"sleep 1"\)/.test(wrapper)) fail(`${label}: bounded readiness sleep callback missing`);
  const execCalls = callBodies(source, "execFileSync");
  if (execCalls.length < 4 || execCalls.some((call) => !/\btimeout\s*(?::|,)/.test(call))) fail(`${label}: every execFileSync call must have an explicit timeout`);
  if (/\/proc\/1\/comm|pid1/.test(code)) fail(`${label}: PID1 assumption present`);
  if (/catalog_changed/.test(code)) fail(`${label}: first catalog change is fatal`);
  const gate = code.indexOf("requireStableCatalogReady();");
  const spawn = code.indexOf('dockerWithBootstrap("run"');
  const cleanupOwnership = code.indexOf("cleanupRequired = true;");
  const migration = code.indexOf("migrationReceipt = applyMigrations();");
  if (gate < 0 || spawn < 0 || migration < 0 || gate < spawn || gate > migration) fail(`${label}: readiness gate ordering invalid`);
  if (!/cron\.database_name=postgres/.test(code)) fail(`${label}: cron database missing`);
  if (!/cron\.launch_active_jobs=off/.test(code)) fail(`${label}: cron launch policy missing`);
  if (!/SHOW cron\.database_name;/.test(code)) fail(`${label}: cron database scalar check missing`);
  if (!/SHOW cron\.launch_active_jobs;/.test(code)) fail(`${label}: cron scalar check missing`);
  if (spawn < 0 || cleanupOwnership < 0 || cleanupOwnership > spawn || !/if \(cleanupRequired\) cleanup\(\);/.test(code)) fail(`${label}: fail-safe cleanup ownership missing`);
  const skillmap = requireFunction(source, "skillmapInvariant", label);
  if (!/inspection\.Image/.test(skillmap) || !/inspection\.NetworkSettings\?\.Networks/.test(skillmap) || !/inspection\.Mounts/.test(skillmap)) fail(`${label}: bounded skillmap invariant incomplete`);
  if (!/(?:inspection\.State\?\.|state\??\.|state\??\[?["']?)Status/.test(skillmap) || !/(?:inspection\.State\?\.|state\??\.|state\??\[?["']?)Running/.test(skillmap) || !/(?:inspection\.State\?\.|state\??\.|state\??\[?["']?)Paused/.test(skillmap) || !/(?:inspection\.State\?\.|inspection\.)Health["']?\]?\??\.?(?:Status|status)/.test(skillmap)) fail(`${label}: SkillMap status/running/paused/health fields missing`);
  if (/Config\.Env|LogPath/.test(code)) fail(`${label}: secret-bearing skillmap inspection present`);
  if (!/skillmapInvariantBounded=true/.test(code)) fail(`${label}: bounded invariant label missing`);
  if (!/\.sort\(\)/.test(requireFunction(source, "resourceLines", label))) fail(`${label}: resource inventories are not sorted`);
  const imageInspect = code.indexOf("const imageInspect");
  if (imageInspect < 0 || !/imageInspect[\s\S]*?Config\??\.Volumes/.test(code.slice(imageInspect, spawn < 0 ? undefined : spawn))) fail(`${label}: image Config.Volumes preflight missing before container start`);
  if (!/docker\("rm",\s*"-f",\s*"-v",\s*"--",\s*CONTAINER\)/.test(source)) fail(`${label}: exact rm -f -v cleanup missing`);
  const importedRedactor = /import\s*\{[\s\S]*\bredactedDiagnostic\b[\s\S]*\}\s*from\s*["']\.\/e6DisposableReadiness\.mjs["']/.test(code);
  const diagnosticFunctions = [...source.matchAll(/function\s+(\w+)\s*\(/g)];
  const diagnosticNames = diagnosticFunctions.filter((match) => {
    const body = functionBody(source, match[1]);
    return body && /\.replace\(/.test(body.body) && /\.slice\(/.test(body.body) && /(?:password|passwd|secret|token|key)/i.test(body.body);
  }).map((match) => match[1]);
  if (diagnosticNames.length === 0 && !importedRedactor) fail(`${label}: bounded redacted top-level diagnostic helper missing`);
  const catchBodies = [...code.matchAll(/catch\s*\([^)]*\)\s*\{/g)].map((match) => {
    const block = firstBlockAfter(code.slice(match.index ?? 0), /catch\s*\([^)]*\)\s*\{/);
    return block?.body ?? "";
  });
  if (!catchBodies.some((body) => diagnosticNames.some((name) => new RegExp(`console\\.error\\([\\s\\S]*\\b${name}\\s*\\(`).test(body)) || (importedRedactor && /console\.error\([\s\S]*\bredactedDiagnostic\s*\(/.test(body)))) fail(`${label}: top-level diagnostics are not bounded/redacted`);
  const noPortFunctions = [...source.matchAll(/function\s+(\w+)\s*\(/g)].filter((match) => {
    const body = functionBody(source, match[1]);
    return body && /dockerText\(/.test(body.body) && /Ports/.test(body.body) && /(?:host|publish|bind|port)/i.test(body.body) && /throw/.test(body.body);
  }).map((match) => match[1]);
  if (noPortFunctions.length === 0) fail(`${label}: no-host-port-bindings runtime assertion missing`);
  if (!noPortFunctions.some((name) => (code.match(new RegExp(`\\b${name}\\s*\\(`, "g")) ?? []).length >= 2)) fail(`${label}: no-host-port-bindings assertion is not applied at runtime`);
  if (spawn < 0 || migration < 0 || spawn > migration) fail(`${label}: spawn ordering invalid`);
  if (/["']-p["']|["']-P["']|["']--publish["']|["']--publish-all["']|["']--volume/.test(code)) fail(`${label}: host exposure present`);
  if (!/docker\("rm",\s*"-f",\s*"-v",\s*"--",\s*CONTAINER\)/.test(source)) fail(`${label}: exact cleanup missing`);
}

validateReadinessHelper(helper, "current helper");
validateRunner(runner, "current source");
validateB2BOriginalImmutable(b2bMigration, "current B2B migration");
validateB2BSuccessor(b2bSuccessorMigration, "current B2B successor migration");
validateB3AOriginalImmutable(migration, "current B3A migration");
validateB3ASuccessor(migration, b3aSuccessorMigration, "current B3A successor migration");
validateB3AFailSuccessor(migration, b3aFailSuccessorMigration, "current B3A fail_x successor migration");
validateB3AClaimSuccessor(migration, b3aClaimSuccessorMigration, "current B3A claim_x successor migration");
validateB3AClaimHistorySuccessor(b3aClaimSuccessorMigration, b3aClaimHistorySuccessorMigration, "current B3A claim-history successor migration");
validateB2BFinalizeDiagnostic(sql, "current SQL fixture");
validateB2BFixtureOrder(sql, "current SQL fixture");
validateB3AHistoryFixture(sql, "current SQL fixture");
assert.match(runner, /CONTEXT\s*=\s*"orbstack"/);
assert.match(runner, /"--pull=never"/);
assert.match(runner, /"--network",\s*"none"/);
assert.match(runner, /--restart=no/);
assert.match(runner, /randomBytes\(48\)/);
assert.match(runner, /dockerWithBootstrap\("run"/);
assert.match(runner, /"-e",\s*"POSTGRES_PASSWORD"/);
assert.doesNotMatch(runner, /POSTGRES_PASSWORD=[A-Za-z0-9]/);
assert.match(runner, /xot-e6-disposable-acceptance-20260810/);
assert.doesNotMatch(runner, /(?:\s-p\s|\s-P\s|--publish|--publish-all|--volumes-from|\s-v\s|--volume)/);
assert.match(runner, /pg_isready/);
assert.match(runner, /ON_ERROR_STOP/);
assert.match(runner, /function runPsqlScalar[\s\S]*?"-At"/);
assert.doesNotMatch(runner, /\/proc\/1\/comm|pid1/);
assert.doesNotMatch(runner, /catalog_changed/);
assert.match(runner, /cron\.database_name=postgres/);
assert.match(runner, /cron\.launch_active_jobs=off/);
assert.match(runner, /finally/);
assert.match(runner, /docker\("rm",\s*"-f",\s*"-v",\s*"--",\s*CONTAINER\)/);
assert.match(runner, /"network",\s*"ls"/);
assert.match(runner, /"volume",\s*"ls"/);
assert.match(runner, /skillmap/);
assert.match(runner, /inspection\.State\?\.StartedAt/);
assert.match(runner, /RestartCount/);
assert.match(runner, /inspection\.Image/);
assert.match(runner, /inspection\.NetworkSettings\?\.Networks/);
assert.match(runner, /inspection\.Mounts/);
assert.doesNotMatch(runner, /Config\.Env|LogPath/);
assert.match(runner, /skillmapInvariantBounded=true/);
assert.match(sql, /E6_SQL_ASSERTIONS_PASS/);
for (const marker of [
  "mixed-age", "duplicate old", "preview", "wrong token", "expired token",
  "rotate token", "late attachment", "pre-provider expiry", "provider-started expiry",
  "generation", "ambiguous",
]) assert.match(sql, new RegExp(marker, "i"));
for (const marker of [
  "runMediaObjectCleanup", "injected_storage_failure", "providerCalls", "marker_rejected", "ambiguous",
]) assert.match(deno, new RegExp(marker));
for (const functionName of ["complete_x_post_delivery", "fail_x_post_delivery"]) assertRequiredGeneration(migration, functionName);

function assertMutation(label, mutate) {
  let rejected = false;
  try { validateRunner(mutate(runner), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertHelperMutation(label, mutate) {
  let rejected = false;
  try { validateReadinessHelper(mutate(helper), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB2BOriginalMutation(label, mutate) {
  let rejected = false;
  try { validateB2BOriginalImmutable(mutate(b2bMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB2BSuccessorMutation(label, mutate) {
  let rejected = false;
  try { validateB2BSuccessor(mutate(b2bSuccessorMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB3AOriginalMutation(label, mutate) {
  let rejected = false;
  try { validateB3AOriginalImmutable(mutate(migration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB3ASuccessorMutation(label, mutate) {
  let rejected = false;
  try { validateB3ASuccessor(migration, mutate(b3aSuccessorMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB3AFailSuccessorMutation(label, mutate) {
  let rejected = false;
  try { validateB3AFailSuccessor(migration, mutate(b3aFailSuccessorMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB3AClaimSuccessorMutation(label, mutate) {
  let rejected = false;
  try { validateB3AClaimSuccessor(migration, mutate(b3aClaimSuccessorMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertB3AClaimHistorySuccessorMutation(label, mutate) {
  let rejected = false;
  try { validateB3AClaimHistorySuccessor(b3aClaimSuccessorMigration, mutate(b3aClaimHistorySuccessorMigration), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertFixtureMutation(label, mutate) {
  let rejected = false;
  try { validateB2BFinalizeDiagnostic(mutate(sql), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertFixtureOrderMutation(label, mutate) {
  let rejected = false;
  try { validateB2BFixtureOrder(mutate(sql), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

function assertFixtureHistoryMutation(label, mutate) {
  let rejected = false;
  try { validateB3AHistoryFixture(mutate(sql), label); } catch (error) {
    if (String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) rejected = true;
    else throw error;
  }
  if (!rejected) fail(`${label} mutation survived`);
}

if (process.env.MUTATION_TEST === "1") {
  assertMutation("helper import", (source) => source.replace("  BASE_CATALOG_GATE_QUERY,\n", ""));
  assertMutation("helper call", (source) => source.replace("waitForDisposableReadiness({", "waitForStableCatalogReady({"));
  assertMutation("pull policy", (source) => source.replace("--pull=never", "--pull=always"));
  assertMutation("network policy", (source) => source.replace("--network", "--publish"));
  assertMutation("cleanup", (source) => source.replace('docker("rm", "-f", "-v", "--", CONTAINER);', "// cleanup bypass"));
  assertMutation("cleanup ownership", (source) => source.replace("cleanupRequired = true;", "cleanupRequired = false;"));
  assertMutation("scalar psql output", (source) => source.replace('"-At"', '"-A"'));
  assertMutation("readiness logs callback", (source) => source.replace('readLogs: () => dockerText(["logs", CONTAINER])', "readLogs: () => ''"));
  assertMutation("readiness sample callback", (source) => source.replace("runPsqlScalar(BASE_CATALOG_GATE_QUERY)", "runPsqlScalar('SELECT 1')"));
  assertMutation("readiness gate ordering", (source) => source.replace("requireStableCatalogReady();", "").replace("migrationReceipt = applyMigrations();", "migrationReceipt = applyMigrations();\n  requireStableCatalogReady();"));
  assertMutation("PID1 decoy", (source) => source.replace("function requireStableCatalogReady", "const pid1 = '/proc/1/comm';\nfunction requireStableCatalogReady"));
  assertMutation("cron database", (source) => source.replace("cron.database_name=postgres", "cron.database_name=template1"));
  assertMutation("cron launch policy", (source) => source.replace("cron.launch_active_jobs=off", "cron.launch_active_jobs=on"));
  assertMutation("skillmap image decoy", (source) => source.replace("inspection.Image", "inspection.Id"));
  assertMutation("skillmap mount decoy", (source) => source.replace("inspection.Mounts", "[]"));
  assertMutation("lsof status weakening", (source) => source.replace(/status\s*===\s*1/, "status === 0"));
  assertMutation("lsof signal weakening", (source) => source.replace(/(?:error\.)?signal/, "signal_removed"));
  assertMutation("lsof stdout classification removal", (source) => source.replace(/stdout/g, "stdout_removed"));
  assertMutation("lsof stderr classification removal", (source) => source.replace(/stderr/g, "stderr_removed"));
  assertMutation("lsof catch-all unbound", (source) => source.replace('if (result.status === 1 && stdout === "" && stderr === "") return "unbound";', 'return "unbound";'));
  assertMutation("image command removal", (source) => source.replace(/const EXPECTED_IMAGE_CMD\s*=\s*Object\.freeze\(\[[\s\S]*?\]\);/, "const EXPECTED_IMAGE_CMD_REMOVED = [];"));
  assertMutation("image command change", (source) => source.replace("/etc/postgresql", "/etc/postgresql-mutant"));
  assertMutation("image command reorder", (source) => source.replace('["postgres", "-D", "/etc/postgresql"]', '["postgres", "/etc/postgresql", "-D"]'));
  assertMutation("image command preflight removal", (source) => source.replace("JSON.stringify(imageInspect?.Config?.Cmd) !== JSON.stringify(EXPECTED_IMAGE_CMD)", "false"));
  assertMutation("image command dead decoy", (source) => source.replace("...EXPECTED_IMAGE_CMD", "...DEAD_IMAGE_CMD"));
  assertMutation("image command cron ordering", (source) => source.replace('...EXPECTED_IMAGE_CMD, "-c", "cron.database_name=postgres", "-c", "cron.launch_active_jobs=off"', '...EXPECTED_IMAGE_CMD, "-c", "cron.launch_active_jobs=off", "-c", "cron.database_name=postgres"'));
  assertMutation("prelude wrapper removal", (source) => source.replace(/  try \{\n    runPsql\(prelude\(\)\);\n  \} catch \(error\) \{\n    throw new Error\(`E6_REPLAY_FAIL stage=prelude detail=\$\{extractSqlEvidence\(error\)\}`\);\n  \}/, "  runPsql(prelude());"));
  assertMutation("prelude raw diagnostic", (source) => source.replace("stage=prelude detail=${extractSqlEvidence(error)}", "stage=prelude detail=${error.message}"));
  assertMutation("prelude diagnostic dead decoy", (source) => source.replace("stage=prelude detail=${extractSqlEvidence(error)}", "stage=prelude detail=${preludeEvidence}"));
  assertMutation("SQL evidence categories", (source) => source.replace("ERROR|CONTEXT|STATEMENT|DETAIL|HINT", "ERROR|CONTEXT"));
  assertMutation("SQL extractor removal", (source) => source.replace("function extractSqlEvidence", "function extractSqlEvidenceRemoved"));
  assertMutation("cron scalar wrapper removal", (source) => source.replace('runPsqlScalarStage("cron-database-name", "SHOW cron.database_name;")', 'runPsqlScalar("SHOW cron.database_name;")'));
  assertMutation("cron scalar stage swap", (source) => source.replace('runPsqlScalarStage("cron-database-name", "SHOW cron.database_name;")', 'runPsqlScalarStage("cron-launch-active-jobs", "SHOW cron.database_name;")'));
  assertMutation("cron scalar duplicate stage", (source) => source.replace('runPsqlScalarStage("cron-launch-active-jobs", "SHOW cron.launch_active_jobs;")', 'runPsqlScalarStage("cron-database-name", "SHOW cron.launch_active_jobs;")'));
  assertMutation("cron scalar raw diagnostic", (source) => source.replace("E6_REPLAY_FAIL stage=${stage} detail=${extractSqlEvidence(error)}", "E6_REPLAY_FAIL stage=${stage} detail=${error.message}"));
  assertMutation("cron scalar dead decoy", (source) => source.replace('runPsqlScalarStage("cron-database-name", "SHOW cron.database_name;")', 'runPsqlScalarStage("cron-database-name-dead", "SHOW cron.database_name;")'));
  assertMutation("cron database comparison", (source) => source.replace('cronDatabaseName !== "postgres"', 'cronDatabaseName !== "template1"'));
  assertMutation("cron launch comparison", (source) => source.replace('cronLaunchSetting !== "off"', 'cronLaunchSetting !== "on"'));
  assertMutation("SQL fixture wrapper removal", (source) => source.replace(/  try \{\n    runSqlFixture\(readFileSync\(SQL_FIXTURE, "utf8"\)\);\n  \} catch \(error\) \{\n    throw new Error\(`E6_REPLAY_FAIL stage=sql-fixture detail=\$\{extractSqlEvidence\(error\)\}`\);\n  \}/, '  runPsql(readFileSync(SQL_FIXTURE, "utf8"));'));
  assertMutation("SQL fixture tracer removal", (source) => source.replace(/function runSqlFixture\([\s\S]*?\n\}\n\nfunction inspectMounts/, "function inspectMounts"));
  assertMutation("SQL fixture section trace removal", (source) => source.replace("fixture-section=${index + 1}", "fixture-section=unknown"));
  assertMutation("SQL fixture section call decoy", (source) => source.replace("runPsql(section);", "runPsql(deadSection);"));
  assertMutation("SQL fixture raw diagnostic", (source) => source.replace("stage=sql-fixture detail=${extractSqlEvidence(error)}", "stage=sql-fixture detail=${error.message}"));
  assertMutation("SQL fixture dead decoy", (source) => source.replace("stage=sql-fixture detail=${extractSqlEvidence(error)}", "stage=sql-fixture detail=${fixtureEvidence}"));
  assertMutation("SQL fixture stage weakening", (source) => source.replace("stage=sql-fixture", "stage=fixture"));
  assertMutation("SQL fixture bytes weakening", (source) => source.replace('readFileSync(SQL_FIXTURE, "utf8")', 'readFileSync(SQL_FIXTURE, "ascii")'));
  assertMutation("SQL fixture order weakening", (source) => source.replace("migrationReceipt = applyMigrations();\n  try {", "try {").replace("  } catch (error) {\n    throw new Error(`E6_REPLAY_FAIL stage=sql-fixture detail=${extractSqlEvidence(error)}`);\n  }\n  execFileSync", "  } catch (error) {\n    throw new Error(`E6_REPLAY_FAIL stage=sql-fixture detail=${extractSqlEvidence(error)}`);\n  }\n  migrationReceipt = applyMigrations();\n  execFileSync"));
  assertMutation("Deno cached-only removal", (source) => source.replace('"--cached-only", ', ""));
  assertMutation("Deno frozen removal", (source) => source.replace('"--frozen", ', ""));
  assertMutation("Deno deny-net removal", (source) => source.replace('"--deny-net", ', ""));
  assertMutation("Deno cache/deny/frozen reorder", (source) => source.replace('"--cached-only", "--frozen", "--deny-net"', '"--deny-net", "--cached-only", "--frozen"'));
  assertMutation("Deno frozen/deny reorder", (source) => source.replace('"--frozen", "--deny-net"', '"--deny-net", "--frozen"'));
  assertMutation("Deno npm offline removal", (source) => source.replace('"--offline", ', ""));
  assertMutation("Deno npm offline bypass", (source) => source.replace('execFileSync("npm"', 'execFileSync("npx"'));
  assertB2BOriginalMutation("B2B original SHA drift", (source) => source.replace("media_objects_claim_old", "media_objects_claim_old_mutant"));
  assertB2BSuccessorMutation("B2B successor guard removal", (source) => source.replace(/DO\s*\$\$[\s\S]*?\$\$;\n\n/, ""));
  assertB2BSuccessorMutation("B2B successor weak UUID regex", (source) => source.replace("^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$", "^[0-9a-f-]+$"));
  assertB2BSuccessorMutation("B2B successor cast bypass", (source) => source.replace("USING deletion_token::uuid", "USING deletion_token::text"));
  assertB2BSuccessorMutation("B2B successor ALTER removal", (source) => source.replace(/ALTER TABLE\s+public\.media_objects[\s\S]*?USING\s+deletion_token::uuid\s*;\n?/, ""));
  assertB2BSuccessorMutation("B2B successor wrong ALTER", (source) => source.replace("TYPE uuid", "TYPE text"));
  assertB3AOriginalMutation("B3A original SHA drift", (source) => source.replace("FROM requeue r", "FROM requeueable r"));
  assertB3ASuccessorMutation("B3A successor FROM requeue", (source) => source.replace("FROM requeueable r", "FROM requeue r"));
  assertB3ASuccessorMutation("B3A successor CTE rename", (source) => source.replace("requeueable AS", "requeueable_mutant AS"));
  assertB3ASuccessorMutation("B3A successor missing update count", (source) => source.replace("SELECT count(*) INTO v_requeued FROM do_requeue;", "-- missing requeue count"));
  assertB3ASuccessorMutation("B3A successor missing return count", (source) => source.replace("RETURNING j.id", "-- missing returned id"));
  assertB3ASuccessorMutation("B3A successor weak search_path", (source) => source.replace("SET search_path TO public, pg_catalog", "SET search_path TO public"));
  assertB3ASuccessorMutation("B3A successor limited SKIP LOCKED", (source) => source.replace("FOR UPDATE SKIP LOCKED", "FOR UPDATE"));
  assertB3ASuccessorMutation("B3A successor ambiguity JSON", (source) => source.replace("'ambiguous',", "'ambiguous_mutant',"));
  assertB3ASuccessorMutation("B3A successor missing grants", (source) => source.replace("GRANT EXECUTE ON FUNCTION public.reconcile_expired_job_claims(integer) TO service_role;", "-- missing grant"));
  assertB3AFailSuccessorMutation("B3A fail_x CASE regression", (source) => source.replace("claim_expires_at = NULL,", "claim_expires_at = CASE WHEN v_ambiguous THEN NULL ELSE NULL END,"));
  assertB3AFailSuccessorMutation("B3A fail_x lease clear removal", (source) => source.replace("    claim_expires_at = NULL,\n", ""));
  assertB3AFailSuccessorMutation("B3A fail_x signature drift", (source) => source.replace("p_claim_generation bigint,", "p_claim_generation bigint DEFAULT 0,"));
  assertB3AFailSuccessorMutation("B3A fail_x body drift", (source) => source.replace("claim_release_reason = 'retired'", "claim_release_reason = 'mutant'"));
  assertB3AFailSuccessorMutation("B3A fail_x missing grants", (source) => source.replace("GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamptz,text,integer,bigint,text) TO service_role;", "-- missing grant"));
  assertB3AClaimSuccessorMutation("B3A claim_x ambiguity bypass", (source) => source.replace("IF FOUND AND (v_existing.claim_state = 'ambiguous' OR NOT COALESCE(p_force_retry, false)) THEN", "IF FOUND AND NOT COALESCE(p_force_retry, false) THEN"));
  assertB3AClaimSuccessorMutation("B3A claim_x ambiguity guard removal", (source) => source.replace("v_existing.claim_state = 'ambiguous' OR ", ""));
  assertB3AClaimSuccessorMutation("B3A claim_x force retry regression", (source) => source.replace("NOT COALESCE(p_force_retry, false)", "true"));
  assertB3AClaimSuccessorMutation("B3A claim_x function body drift", (source) => source.replace("'previous_x_' || v_existing.status", "'claim_conflict'"));
  assertB3AClaimSuccessorMutation("B3A claim_x missing grants", (source) => source.replace("GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;", "-- missing grant"));
  assertB3AClaimHistorySuccessorMutation("B3A claim history variable removal", (source) => source.replace("  v_has_ambiguous_history boolean;\n", ""));
  assertB3AClaimHistorySuccessorMutation("B3A claim history ANY predicate removal", (source) => source.replace("  SELECT EXISTS (", "  SELECT false AND EXISTS ("));
  assertB3AClaimHistorySuccessorMutation("B3A claim history provider marker removal", (source) => source.replace(" OR h.provider_started_at IS NOT NULL", ""));
  assertB3AClaimHistorySuccessorMutation("B3A claim history status widening", (source) => source.replace("      AND h.status <> 'posted'\n", ""));
  assertB3AClaimHistorySuccessorMutation("B3A claim history reason weakening", (source) => source.replace("RETURN jsonb_build_object('claimed', false, 'reason', 'ambiguous');", "RETURN jsonb_build_object('claimed', false, 'reason', 'previous_x_failed');"));
  assertB3AClaimHistorySuccessorMutation("B3A claim history missing grants", (source) => source.replace("GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery(text,text,boolean,integer) TO service_role;", "-- missing grant"));
  assertFixtureHistoryMutation("B3A history stable reason weakening", (source) => source.replace("second->>'reason' <> 'ambiguous'", "second->>'reason' <> 'previous_x_failed'"));
  assertFixtureHistoryMutation("B3A history masking row retargeted", (source) => source.replace("'00000000-0000-0000-0000-000000000731', 'e6-x-post'", "'00000000-0000-0000-0000-000000000731', 'e6-x-mask'"));
  assertFixtureHistoryMutation("B3A marker lifecycle boundary removal", (source) => source.replace(
    "IF NOT public.mark_x_delivery_provider_started(did, tok, gen) THEN RAISE EXCEPTION 'E6_B3A X marker-only provider marker rejected'; END IF;",
    "IF NOT public.mark_x_delivery_provider_started_removed(did, tok, gen) THEN RAISE EXCEPTION 'E6_B3A X marker-only provider marker rejected'; END IF;",
  ));
  assertFixtureHistoryMutation("B3A marker lifecycle skip reason removal", (source) => source.replace("'x_api_retriable', 0, 0, NULL", "NULL, 0, 0, NULL"));
  assertFixtureHistoryMutation("B3A ordinary lifecycle skip reason removal", (source) => source.replace("'pre_provider', 0, 0, NULL", "NULL, 0, 0, NULL"));
  assertFixtureHistoryMutation("B3A ordinary state marker inversion", (source) => source.replace("id = did AND provider_started_at IS NULL AND claim_state = 'failed'", "id = did AND provider_started_at IS NOT NULL AND claim_state = 'failed'"));
  assertFixtureHistoryMutation("B3A ordinary force retry disabled", (source) => source.replace("claim_x_post_delivery('e6-x-ordinary', 'e6', true, 1800)", "claim_x_post_delivery('e6-x-ordinary', 'e6', false, 1800)"));
  assertFixtureMutation("B2B final diagnostic removal", (source) => source.replace(/\n\s*SELECT EXISTS\s*\([\s\S]*?RAISE EXCEPTION 'E6_B2B token finalization failed[^;]*;/, ""));
  assertFixtureMutation("B2B final diagnostic raw token", (source) => source.replace("status=% token_match=", "status=% token=% token_match="));
  assertFixtureMutation("B2B final diagnostic raw path", (source) => source.replace("status=% token_match=", "status=% path=e6/token.jpg token_match="));
  assertFixtureMutation("B2B final diagnostic raw payload", (source) => source.replace("status=% token_match=", "status=% payload=% token_match="));
  assertFixtureMutation("B2B final diagnostic detached decoy", (source) => source.replace("IF NOT public.media_objects_finalize_delete(\n    (SELECT id FROM public.media_objects WHERE storage_path = 'e6/token.jpg'), token_old", "IF false THEN\n    PERFORM public.media_objects_finalize_delete(\n    (SELECT id FROM public.media_objects WHERE storage_path = 'e6/token.jpg'), token_old"));
  assertFixtureOrderMutation("B2B token seed stale", (source) => source.replace("('00000000-0000-0000-0000-000000000631', 'e6-token-a', 'image', 'e6/token.jpg', now() - interval '2 days'", "('00000000-0000-0000-0000-000000000631', 'e6-token-a', 'image', 'e6/token.jpg', now() - interval '45 days'"));
  assertFixtureOrderMutation("B2B token age transition removal", (source) => source.replace(/\n  UPDATE\s+public\.media\s+SET\s+downloaded_at\s*=\s*now\(\)\s*-\s*interval\s*'45 days'[\s\S]*?\n  END IF;\n\n(?=  -- A claimed deleting object)/, "\n"));
  assertFixtureOrderMutation("B2B token age transition broad", (source) => source.replace("WHERE id = '00000000-0000-0000-0000-000000000631'\n     AND tweet_id = 'e6-token-a'\n     AND storage_path = 'e6/token.jpg';", "WHERE storage_path = 'e6/token.jpg';"));
  assertFixtureOrderMutation("B2B token age transition dead decoy", (source) => source.replace("UPDATE public.media\n     SET downloaded_at = now() - interval '45 days'", "UPDATE public.media_archive\n     SET downloaded_at = now() - interval '45 days'"));
  assertFixtureOrderMutation("B2B token age transition ordering", (source) => {
    const transition = source.match(/\n  UPDATE\s+public\.media\s+SET\s+downloaded_at\s*=\s*now\(\)\s*-\s*interval\s*'45 days'[\s\S]*?\n  END IF;\n\n/)?.[0] ?? "";
    return source.replace(transition, "\n").replace("  IF NOT public.media_objects_finalize_delete(object_id, token_new) THEN", `${transition}  IF NOT public.media_objects_finalize_delete(object_id, token_new) THEN`);
  });
  assertMutation("exec timeout", (source) => source.replace(/\btimeout\s*:\s*[^,}\n]+,?/, ""));
  assertMutation("sorted inventories", (source) => source.replace(/(function\s+resourceLines[\s\S]*?)\.sort\(\)/, "$1"));
  assertMutation("SkillMap running field", (source) => source.replace(/((?:inspection\.State\?\.|state\??\.)Running)\b/, "$1_disabled").replace("Running_disabled", "StartedAt"));
  assertMutation("image volumes preflight", (source) => source.replace(/if\s*\([\s\S]*?Config\??\.Volumes[\s\S]*?\n/, ""));
  assertMutation("cleanup volume removal", (source) => source.replace('docker("rm", "-f", "-v",', 'docker("rm", "-f",'));
  assertMutation("top-level diagnostic bypass", (source) => source.replaceAll("redactedDiagnostic(error)", "error?.message"));
  assertMutation("host-port assertion removal", (source) => source.replace(/function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?Ports[\s\S]*?\n\}/, "function $1() { return []; }"));
  assertHelperMutation("init marker", (source) => source.replace("PostgreSQL init process complete; ready for start up.", "PostgreSQL init process complete; ready for shutdown."));
  assertHelperMutation("embedded init marker", (source) => source.replace(/\.trim\(\)\s*===\s*UPSTREAM_INIT_COMPLETE_MARKER/g, ".includes(UPSTREAM_INIT_COMPLETE_MARKER)"));
  assertHelperMutation("GraphQL catalog prerequisite", (source) => source.replace("current_database(),", "current_database(), (SELECT extname FROM pg_extension WHERE extname = 'pg_graphql'),"));
  assertHelperMutation("marker gate", (source) => source.replace("if (initComplete) {", "if (false) {"));
  assertHelperMutation("catalog consecutive match", (source) => source.replace("sameSample(previousSample, sample)", "sameSample(previousSample, otherSample)"));
  assertHelperMutation("catalog reset and continue", (source) => source.replace("previousSample = sample;", "previousSample = null;"));
  assertHelperMutation("catalog timeout", (source) => source.replace("while (now() < end)", "while (true)"));
  assertHelperMutation("callback deadline bypass", (source) => source.replace(/(?:\w*Deadline\w*|checkDeadline|ensureDeadline|deadlineGuard|deadlineCheck)\(\)/g, "true"));
  assertHelperMutation("diagnostic redaction", (source) => source.replace("password|passwd|secret|token|key", "never-redact").replaceAll("[REDACTED]", "[RAW]"));
  for (const functionName of ["complete_x_post_delivery", "fail_x_post_delivery"]) {
    const signaturePattern = new RegExp(`(CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?)p_claim_generation bigint,`);
    const withoutGeneration = migration.replace(signaturePattern, "$1");
    try { assertRequiredGeneration(withoutGeneration, functionName); fail(`${functionName} missing-generation mutant survived`); } catch (error) {
      if (!String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) throw error;
    }
    const optionalGeneration = migration.replace(signaturePattern, "$1p_claim_generation bigint DEFAULT 0,");
    try { assertRequiredGeneration(optionalGeneration, functionName); fail(`${functionName} optional-generation mutant survived`); } catch (error) {
      if (!String(error).includes("E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_FAIL")) throw error;
    }
  }
}

console.log(`E6_DISPOSABLE_ACCEPTANCE_SOURCE_CONTRACT_PASS isolation=exact offline=required sqlAssertions=true appBoundary=true readiness=marker-stable-two-samples selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
