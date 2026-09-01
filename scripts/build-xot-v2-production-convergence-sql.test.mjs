import assert from "node:assert/strict";
import { basename } from "node:path";
import test from "node:test";

import {
  ACTIVATION_ONLY_X_RETIREMENT,
  BUNDLE_PHASES,
  EXPECTED_INCLUSION_COUNT,
  EXPECTED_MIGRATION_ORDER,
  RUNTIME_CONTROLS_BRIDGE,
  buildProductionConvergenceSql,
  extractSourceBodies,
  extractSourceOrder,
  findTopLevelTransactionStatements,
  stripSourceTransactionWrapper,
  validateProductionConvergenceSql,
} from "./build-xot-v2-production-convergence-sql.mjs";

function migrationSource(filename) {
  return `-- fixture for ${filename}\nBEGIN;\nSELECT '${filename}';\nCOMMIT;\n`;
}

function buildFixture() {
  return buildProductionConvergenceSql({
    root: "/fixture",
    readFileImpl: (path) => migrationSource(basename(path)),
  });
}

test("production convergence order matches the 15 prerequisites and eight repairs/successors", () => {
  assert.equal(BUNDLE_PHASES.length, 9);
  assert.equal(EXPECTED_INCLUSION_COUNT, 23);
  assert.equal(EXPECTED_MIGRATION_ORDER.length, EXPECTED_INCLUSION_COUNT);
  assert.deepEqual(EXPECTED_MIGRATION_ORDER.slice(0, 15), BUNDLE_PHASES[0].migrations);
  assert.equal(EXPECTED_MIGRATION_ORDER.filter((name) => name === RUNTIME_CONTROLS_BRIDGE).length, 2);
  assert.equal(EXPECTED_MIGRATION_ORDER.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
  assert.equal(
    EXPECTED_MIGRATION_ORDER[20],
    "20260828140000_runtime_control_claim_release_race_guards.sql",
  );
  assert.equal(
    EXPECTED_MIGRATION_ORDER[21],
    "20260829120000_reconcile_historical_delivery_jobs.sql",
  );
  assert.equal(
    EXPECTED_MIGRATION_ORDER[22],
    "20260830120000_enforce_historical_delivery_zero_write.sql",
  );
});

test("builder emits deterministic phase-marked SQL in one outer transaction", () => {
  const first = buildFixture();
  const second = buildFixture();

  assert.equal(first, second);
  assert.deepEqual(extractSourceOrder(first), EXPECTED_MIGRATION_ORDER);
  assert.equal(first.match(/^-- Phase \d:/gm)?.length, 9);
  assert.equal(first.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
  assert.deepEqual(findTopLevelTransactionStatements(first).map(({ statement }) => statement), [
    "BEGIN;",
    "COMMIT;",
  ]);
  assert.equal(first.startsWith("BEGIN;\n"), true);
  assert.equal(first.endsWith("COMMIT;\n"), true);
  assert.equal(validateProductionConvergenceSql(first).inclusionCount, EXPECTED_INCLUSION_COUNT);
});

test("source wrapper removal strips only exact top-level BEGIN and COMMIT lines", () => {
  const source = `BEGIN;\nDO $$\nBEGIN;\n  PERFORM 'COMMIT;';\nEND;\n$$;\nCOMMIT;\n`;
  assert.equal(
    stripSourceTransactionWrapper(source, "nested.sql"),
    `DO $$\nBEGIN;\n  PERFORM 'COMMIT;';\nEND;\n$$;\n`,
  );
  assert.throws(
    () => stripSourceTransactionWrapper(" BEGIN;\nSELECT 1;\nCOMMIT;\n", "indented.sql"),
    /unexpected top-level transaction statement/,
  );
  assert.throws(
    () => stripSourceTransactionWrapper("BEGIN;\nROLLBACK;\n", "rollback.sql"),
    /unexpected top-level transaction statement/,
  );
});

test("validator rejects source removal, reordering, nested control, and X retirement", () => {
  const sql = buildFixture();
  const firstMarker = `-- Source: ${EXPECTED_MIGRATION_ORDER[0]}`;
  const secondMarker = `-- Source: ${EXPECTED_MIGRATION_ORDER[1]}`;

  assert.throws(
    () => validateProductionConvergenceSql(sql.replace(firstMarker, "-- Source: omitted.sql")),
    /inclusion count|source order/,
  );
  assert.throws(
    () => validateProductionConvergenceSql(
      sql.replace(firstMarker, "-- Source: swap-placeholder.sql")
        .replace(secondMarker, firstMarker)
        .replace("-- Source: swap-placeholder.sql", secondMarker),
    ),
    /source order/,
  );
  assert.throws(
    () => validateProductionConvergenceSql(sql.replace("\nCOMMIT;\n", "\nROLLBACK;\nCOMMIT;\n")),
    /one outer BEGIN\/COMMIT/,
  );
  assert.throws(
    () => validateProductionConvergenceSql(sql.replace(
      "-- XOT V2 atomic production convergence bundle.",
      `-- XOT V2 atomic production convergence bundle.\n-- ${ACTIVATION_ONLY_X_RETIREMENT}`,
    )),
    /activation-only X retirement/,
  );
  assert.throws(
    () => validateProductionConvergenceSql(sql.replace(
      `-- Source: ${EXPECTED_MIGRATION_ORDER[0]}`,
      `-- Source: ${EXPECTED_MIGRATION_ORDER[0]}\nDROP FUNCTION IF EXISTS public.complete_x_post_delivery(uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text);`,
    )),
    /activation-only X retirement/,
  );
});

test("validator rejects missing and whitespace-only source bodies", () => {
  const sql = buildFixture();
  const bodies = extractSourceBodies(sql);
  assert.equal(bodies.length, EXPECTED_INCLUSION_COUNT);
  assert.ok(bodies.every(({ body }) => body.trim().length > 0));
  const firstSource = EXPECTED_MIGRATION_ORDER[0];
  const secondSource = EXPECTED_MIGRATION_ORDER[1];
  const firstBody = new RegExp(
    `(\\-\\- Source: ${firstSource}\\n)[\\s\\S]*?(?=\\-\\- Source: ${secondSource})`,
  );

  assert.throws(
    () => validateProductionConvergenceSql(sql.replace(firstBody, "$1\n\n")),
    /source body.*empty|missing.*body/i,
  );
  assert.throws(
    () => validateProductionConvergenceSql(sql.replace(firstBody, "$1-- comments only\n\n")),
    /source body.*empty|missing.*body/i,
  );
});
