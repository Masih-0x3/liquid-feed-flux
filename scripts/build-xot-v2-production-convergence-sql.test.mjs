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

test("production convergence order matches the 15 prerequisites and four repairs", () => {
  assert.equal(BUNDLE_PHASES.length, 6);
  assert.equal(EXPECTED_INCLUSION_COUNT, 20);
  assert.equal(EXPECTED_MIGRATION_ORDER.length, EXPECTED_INCLUSION_COUNT);
  assert.deepEqual(EXPECTED_MIGRATION_ORDER.slice(0, 15), BUNDLE_PHASES[0].migrations);
  assert.equal(EXPECTED_MIGRATION_ORDER.filter((name) => name === RUNTIME_CONTROLS_BRIDGE).length, 2);
  assert.equal(EXPECTED_MIGRATION_ORDER.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
});

test("builder emits deterministic phase-marked SQL in one outer transaction", () => {
  const first = buildFixture();
  const second = buildFixture();

  assert.equal(first, second);
  assert.deepEqual(extractSourceOrder(first), EXPECTED_MIGRATION_ORDER);
  assert.equal(first.match(/^-- Phase \d:/gm)?.length, 6);
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
});
