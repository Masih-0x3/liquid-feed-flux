import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const RECONCILIATION_MIGRATIONS = Object.freeze([
  "20260722162000_video_render_feedback_revision.sql",
  "20260723173100_lock_down_video_render_raw_tables.sql",
  "20260724183000_add_current_user_is_admin_rpc.sql",
  "20260730070000_telegram_delivery_claims.sql",
  "20260806123000_media_object_cleanup_claims.sql",
  "20260806143000_b3_job_x_claim_fencing.sql",
  "20260806153000_b3b1_rss_webhook_receipts.sql",
  "20260808110000_b3b2_digest_checkpoints.sql",
  "20260808123000_b4_video_render_claim_fencing.sql",
  "20260808133000_b2b_media_object_deletion_token_uuid.sql",
  "20260808143000_b3a_reconcile_expired_job_claims_fix.sql",
  "20260808153000_b3a_fail_x_post_delivery_null_fix.sql",
  "20260808163000_b3a_claim_x_ambiguous_retry_fix.sql",
  "20260808173000_b3a_claim_x_ambiguous_history_fix.sql",
  "20260811090000_revoke_public_default_privileges.sql",
]);

export const RUNTIME_CONTROLS_BRIDGE =
  "20260825220124_xot_v2_runtime_controls_activation_bridge.sql";
export const E10_RUNTIME_CONTROLS =
  "20260812100000_e10_preview_runtime_controls_and_roles.sql";
export const RENDER_ONLY_AUTOMATION_CUTOVER =
  "20260825024826_render_only_automation_cutover.sql";
export const V1_DELIVERY_CONTINUITY_CUTOVER =
  "20260825091418_v1_delivery_continuity_cutover.sql";
export const EFFECTIVE_CLAIM_REPAIR =
  "20260827064509_repair_effective_claim_fence_and_delivery_cutover.sql";
export const EFFECTIVE_X_CLAIM_REPAIR =
  "20260828120000_repair_effective_x_claim_cutover.sql";
export const ACTIVATION_ONLY_X_RETIREMENT =
  "20260828130000_retire_legacy_x_delivery_overloads.sql";

export const CONVERGENCE_GUARD_TABLE = "xot_v2_production_convergence_guard";
export const CONVERGENCE_GUARD_KEY = "xot-v2-production-convergence-v1";
export const REQUIRED_TARGET_OBJECTS = Object.freeze([
  Object.freeze({
    kind: "table",
    name: "public.delivery_cutover",
    sqlNeedle: "to_regclass('public.delivery_cutover')",
  }),
  Object.freeze({
    kind: "table",
    name: "public.runtime_controls",
    sqlNeedle: "to_regclass('public.runtime_controls')",
  }),
  Object.freeze({
    kind: "table",
    name: "public.runtime_activation_epochs",
    sqlNeedle: "to_regclass('public.runtime_activation_epochs')",
  }),
  Object.freeze({
    kind: "function",
    name: "public.claim_jobs(integer,text[],text)",
    sqlNeedle: "to_regprocedure('public.claim_jobs(integer,text[],text)')",
  }),
  Object.freeze({
    kind: "function",
    name: "public.claim_x_post_delivery(text,text,boolean,integer)",
    sqlNeedle: "to_regprocedure('public.claim_x_post_delivery(text,text,boolean,integer)')",
  }),
  Object.freeze({
    kind: "function",
    name: "public.claim_x_post_delivery_v2(text,timestamptz,bigint,text,boolean,integer)",
    sqlNeedle: "to_regprocedure('public.claim_x_post_delivery_v2(text,timestamptz,bigint,text,boolean,integer)')",
  }),
  Object.freeze({
    kind: "function",
    name: "public.claim_video_render_after(timestamptz,text)",
    sqlNeedle: "to_regprocedure('public.claim_video_render_after(timestamptz,text)')",
  }),
  Object.freeze({
    kind: "function",
    name: "public.delivery_cutover_allows_post(text)",
    sqlNeedle: "to_regprocedure('public.delivery_cutover_allows_post(text)')",
  }),
]);

export const BUNDLE_PHASES = Object.freeze([
  Object.freeze({
    comment: "Phase 1: production reconciliation prerequisites (migrations 1-15)",
    migrations: RECONCILIATION_MIGRATIONS,
  }),
  Object.freeze({
    comment: "Phase 2: render-only and V1 delivery cutover prerequisites",
    migrations: Object.freeze([
      RENDER_ONLY_AUTOMATION_CUTOVER,
      V1_DELIVERY_CONTINUITY_CUTOVER,
    ]),
  }),
  Object.freeze({
    comment: "Phase 3: pre-E10 runtime_controls convergence",
    migrations: Object.freeze([RUNTIME_CONTROLS_BRIDGE]),
  }),
  Object.freeze({
    comment: "Phase 4: E10 runtime_controls and role shape",
    migrations: Object.freeze([E10_RUNTIME_CONTROLS]),
  }),
  Object.freeze({
    comment: "Phase 5: restore the final dual-shape runtime_controls invariant",
    migrations: Object.freeze([RUNTIME_CONTROLS_BRIDGE]),
  }),
  Object.freeze({
    comment: "Phase 6: restore the effective claim and delivery-cutover fences",
    migrations: Object.freeze([EFFECTIVE_CLAIM_REPAIR]),
  }),
  Object.freeze({
    comment: "Phase 7: restore the effective X claim cutoff fence",
    migrations: Object.freeze([EFFECTIVE_X_CLAIM_REPAIR]),
  }),
]);

export const EXPECTED_MIGRATION_ORDER = Object.freeze(
  BUNDLE_PHASES.flatMap(({ migrations }) => migrations),
);
export const EXPECTED_INCLUSION_COUNT = 22;

const TRANSACTION_STATEMENT = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE(?:\s+SAVEPOINT)?|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED|SET\s+TRANSACTION)\b.*;$/i;

function maskNonTopLevelSql(line, state) {
  let masked = "";
  let index = 0;

  while (index < line.length) {
    if (state.dollarTag !== null) {
      if (line.startsWith(state.dollarTag, index)) {
        masked += " ".repeat(state.dollarTag.length);
        index += state.dollarTag.length;
        state.dollarTag = null;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }

    if (state.blockCommentDepth > 0) {
      if (line.startsWith("/*", index)) {
        state.blockCommentDepth += 1;
        masked += "  ";
        index += 2;
      } else if (line.startsWith("*/", index)) {
        state.blockCommentDepth -= 1;
        masked += "  ";
        index += 2;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }

    if (state.singleQuoted) {
      if (line[index] === "'" && line[index + 1] === "'") {
        masked += "  ";
        index += 2;
      } else if (line[index] === "'") {
        state.singleQuoted = false;
        masked += " ";
        index += 1;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }

    if (state.doubleQuoted) {
      if (line[index] === '"' && line[index + 1] === '"') {
        masked += "  ";
        index += 2;
      } else if (line[index] === '"') {
        state.doubleQuoted = false;
        masked += " ";
        index += 1;
      } else {
        masked += " ";
        index += 1;
      }
      continue;
    }

    if (line.startsWith("--", index)) {
      masked += " ".repeat(line.length - index);
      break;
    }
    if (line.startsWith("/*", index)) {
      state.blockCommentDepth = 1;
      masked += "  ";
      index += 2;
      continue;
    }
    if (line[index] === "'") {
      state.singleQuoted = true;
      masked += " ";
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      state.doubleQuoted = true;
      masked += " ";
      index += 1;
      continue;
    }
    if (line[index] === "$") {
      const tag = line.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        state.dollarTag = tag;
        masked += " ".repeat(tag.length);
        index += tag.length;
        continue;
      }
    }

    masked += line[index];
    index += 1;
  }

  return masked;
}

export function stripSourceTransactionWrapper(source, filename = "migration.sql") {
  if (typeof source !== "string") throw new TypeError(`${filename}: source must be text`);

  const state = {
    blockCommentDepth: 0,
    dollarTag: null,
    doubleQuoted: false,
    singleQuoted: false,
  };
  const retained = [];

  for (const line of source.split("\n")) {
    const masked = maskNonTopLevelSql(line, state);
    const statement = masked.trim();
    const isExactWrapper = (line === "BEGIN;" || line === "COMMIT;")
      && statement === line;

    if (isExactWrapper) continue;
    if (TRANSACTION_STATEMENT.test(statement)) {
      throw new Error(`${filename}: unexpected top-level transaction statement: ${statement}`);
    }
    retained.push(line);
  }

  return retained.join("\n");
}

export function extractSourceOrder(sql) {
  return [...String(sql).matchAll(/^-- Source: (\d{14}_.+\.sql)$/gm)]
    .map((match) => match[1]);
}

export function extractSourceBodies(sql) {
  const bodies = [];
  let current = null;
  for (const line of String(sql).split("\n")) {
    const source = line.match(/^-- Source: (\d{14}_.+\.sql)$/);
    if (source) {
      if (current) bodies.push(current);
      current = { filename: source[1], lines: [] };
      continue;
    }
    if (/^-- Phase \d+:/.test(line) || /^COMMIT;$/.test(line)) {
      if (current) {
        bodies.push(current);
        current = null;
      }
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) bodies.push(current);
  return bodies.map(({ filename, lines }) => Object.freeze({
    filename,
    body: lines.join("\n"),
  }));
}

export function findTopLevelTransactionStatements(sql) {
  const state = {
    blockCommentDepth: 0,
    dollarTag: null,
    doubleQuoted: false,
    singleQuoted: false,
  };
  const statements = [];

  for (const [lineIndex, line] of String(sql).split("\n").entries()) {
    const statement = maskNonTopLevelSql(line, state).trim();
    if (TRANSACTION_STATEMENT.test(statement)) {
      statements.push({ line: lineIndex + 1, statement });
    }
  }
  return statements;
}

function hasExecutableSql(source) {
  const state = {
    blockCommentDepth: 0,
    dollarTag: null,
    doubleQuoted: false,
    singleQuoted: false,
  };
  return String(source).split("\n").some((line) => maskNonTopLevelSql(line, state).trim() !== "");
}

const LEGACY_X_OVERLOAD_RETIREMENT_SOURCE =
  "20260806143000_b3_job_x_claim_fencing.sql";
const LEGACY_X_OVERLOAD_DROP = /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.(?:complete|fail)_x_post_delivery\s*\(/i;

function unattributedSql(sql) {
  const lines = [];
  let insideSource = false;
  for (const line of String(sql).split("\n")) {
    if (/^-- Source: \d{14}_.+\.sql$/.test(line)) {
      insideSource = true;
      continue;
    }
    if (/^-- Phase \d+:/.test(line) || /^COMMIT;$/.test(line)) {
      insideSource = false;
      continue;
    }
    if (!insideSource) lines.push(line);
  }
  return lines.join("\n");
}

export function validateProductionConvergenceSql(sql) {
  const sourceOrder = extractSourceOrder(sql);
  if (sourceOrder.length !== EXPECTED_INCLUSION_COUNT) {
    throw new Error(`migration inclusion count=${sourceOrder.length}; expected=${EXPECTED_INCLUSION_COUNT}`);
  }
  if (JSON.stringify(sourceOrder) !== JSON.stringify(EXPECTED_MIGRATION_ORDER)) {
    throw new Error("migration source order does not match the production convergence contract");
  }
  if (sourceOrder.includes(ACTIVATION_ONLY_X_RETIREMENT)
    || String(sql).includes(ACTIVATION_ONLY_X_RETIREMENT)) {
    throw new Error("activation-only X retirement migration is excluded from this bundle");
  }

  const sourceBodies = extractSourceBodies(sql);
  if (sourceBodies.length !== sourceOrder.length) {
    throw new Error("every migration source must have an attributed body");
  }
  for (const { filename, body } of sourceBodies) {
    if (!hasExecutableSql(body)) {
      throw new Error(`${filename}: source body is missing or empty`);
    }
    if (LEGACY_X_OVERLOAD_DROP.test(body) && filename !== LEGACY_X_OVERLOAD_RETIREMENT_SOURCE) {
      throw new Error("activation-only X retirement SQL is not allowed in this bundle");
    }
  }
  if (LEGACY_X_OVERLOAD_DROP.test(unattributedSql(sql))) {
    throw new Error("activation-only X retirement SQL is not attributed to an allowed source");
  }

  if (!String(sql).includes(`public.${CONVERGENCE_GUARD_TABLE}`)
    || !String(sql).includes(CONVERGENCE_GUARD_KEY)) {
    throw new Error("one-shot convergence guard is missing");
  }
  for (const { sqlNeedle, name } of REQUIRED_TARGET_OBJECTS) {
    if (!String(sql).includes(sqlNeedle)) {
      throw new Error(`required target object assertion is missing: ${name}`);
    }
  }

  const transactionStatements = findTopLevelTransactionStatements(sql);
  if (transactionStatements.length !== 2
    || transactionStatements[0]?.statement !== "BEGIN;"
    || transactionStatements[1]?.statement !== "COMMIT;") {
    throw new Error("bundle must contain one outer BEGIN/COMMIT and no nested transaction control");
  }
  if (!String(sql).startsWith("BEGIN;\n") || !String(sql).endsWith("COMMIT;\n")) {
    throw new Error("outer transaction must wrap the complete generated bundle");
  }

  return Object.freeze({
    inclusionCount: sourceOrder.length,
    sourceOrder: Object.freeze(sourceOrder),
    transactionStatements: Object.freeze(transactionStatements),
  });
}

export function buildProductionConvergenceSql({
  root = REPO_ROOT,
  readFileImpl = readFileSync,
} = {}) {
  const sections = [
    "BEGIN;",
    "",
    "-- XOT V2 atomic production convergence bundle.",
    "-- This output is deterministic and does not include the activation-only X overload retirement.",
    "",
    `CREATE TABLE IF NOT EXISTS public.${CONVERGENCE_GUARD_TABLE} (`,
    "  bundle_key text PRIMARY KEY,",
    "  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()",
    ");",
    "DO $xot_v2_convergence_guard$",
    "BEGIN",
    `  INSERT INTO public.${CONVERGENCE_GUARD_TABLE} (bundle_key)`,
    `  VALUES ('${CONVERGENCE_GUARD_KEY}')`,
    "  ON CONFLICT (bundle_key) DO NOTHING;",
    "  IF NOT FOUND THEN",
    "    RAISE EXCEPTION 'xot_v2_production_convergence_already_applied';",
    "  END IF;",
    "END",
    "$xot_v2_convergence_guard$;",
  ];

  for (const { comment, migrations } of BUNDLE_PHASES) {
    sections.push("", `-- ${comment}`);
    for (const filename of migrations) {
      const sourcePath = join(root, "supabase/migrations", filename);
      const source = readFileImpl(sourcePath, "utf8");
      const body = stripSourceTransactionWrapper(source, filename);
      sections.push(`-- Source: ${filename}`, body);
    }
  }

  sections.push(
    "",
    "DO $xot_v2_target_state$",
    "BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM public.${CONVERGENCE_GUARD_TABLE} WHERE bundle_key = '${CONVERGENCE_GUARD_KEY}') THEN`,
    "    RAISE EXCEPTION 'xot_v2_production_convergence_guard_missing';",
    "  END IF;",
    ...REQUIRED_TARGET_OBJECTS.map(({ kind, name }) => {
      const lookup = kind === "table"
        ? `to_regclass('${name}')`
        : `to_regprocedure('${name}')`;
      return `  IF ${lookup} IS NULL THEN RAISE EXCEPTION 'xot_v2_required_target_missing: ${name}'; END IF;`;
    }),
    "END",
    "$xot_v2_target_state$;",
    "",
    "COMMIT;",
    "",
  );
  const sql = sections.join("\n");
  validateProductionConvergenceSql(sql);
  return sql;
}

function runCli(argv) {
  const unknown = argv.filter((argument) => argument !== "--check");
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);

  const sql = buildProductionConvergenceSql();
  if (argv.includes("--check")) {
    const result = validateProductionConvergenceSql(sql);
    process.stdout.write(
      `PASS: atomic XOT V2 convergence SQL includes ${result.inclusionCount} ordered sources in one transaction\n`,
    );
    return;
  }
  process.stdout.write(sql);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
