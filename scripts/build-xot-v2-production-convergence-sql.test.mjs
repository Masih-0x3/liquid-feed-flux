import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { join } from "node:path";
import test from "node:test";

import {
  ACTIVATION_ONLY_X_RETIREMENT,
  BUNDLE_PHASES,
  CONVERGENCE_GUARD_KEY,
  CONVERGENCE_GUARD_TABLE,
  EXPECTED_INCLUSION_COUNT,
  EXPECTED_MIGRATION_ORDER,
  REQUIRED_TARGET_OBJECTS,
  RUNTIME_CONTROLS_BRIDGE,
  buildProductionConvergenceSql,
  extractSourceBodies,
  extractSourceOrder,
  findTopLevelTransactionStatements,
  stripSourceTransactionWrapper,
  validateProductionConvergenceSql,
} from "./build-xot-v2-production-convergence-sql.mjs";

const RETIREMENT_MIGRATION = readFileSync(
  join(import.meta.dirname, "../supabase/migrations/20260828130000_retire_legacy_x_delivery_overloads.sql"),
  "utf8",
);
const E6_FIXTURE = readFileSync(
  join(import.meta.dirname, "e6-disposable-fixture.sql"),
  "utf8",
);

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
  assert.equal(BUNDLE_PHASES.length, 7);
  assert.equal(EXPECTED_INCLUSION_COUNT, 22);
  assert.equal(EXPECTED_MIGRATION_ORDER.length, EXPECTED_INCLUSION_COUNT);
  assert.deepEqual(EXPECTED_MIGRATION_ORDER.slice(0, 15), BUNDLE_PHASES[0].migrations);
  assert.deepEqual(BUNDLE_PHASES[1].migrations, [
    "20260825024826_render_only_automation_cutover.sql",
    "20260825091418_v1_delivery_continuity_cutover.sql",
  ]);
  assert.equal(EXPECTED_MIGRATION_ORDER.filter((name) => name === RUNTIME_CONTROLS_BRIDGE).length, 2);
  assert.equal(EXPECTED_MIGRATION_ORDER.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
});

test("builder emits deterministic phase-marked SQL in one outer transaction", () => {
  const first = buildFixture();
  const second = buildFixture();

  assert.equal(first, second);
  assert.deepEqual(extractSourceOrder(first), EXPECTED_MIGRATION_ORDER);
  assert.equal(first.match(/^-- Phase \d:/gm)?.length, 7);
  assert.equal(first.includes(ACTIVATION_ONLY_X_RETIREMENT), false);
  assert.match(first, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${CONVERGENCE_GUARD_TABLE}`));
  assert.equal(first.includes(CONVERGENCE_GUARD_KEY), true);
  for (const object of REQUIRED_TARGET_OBJECTS) assert.equal(first.includes(object.sqlNeedle), true);
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

test("activation-only X retirement is gated on V2 activation and drained claims", () => {
  assert.match(RETIREMENT_MIGRATION, /xot_v2_retirement_requires_activation/);
  assert.match(RETIREMENT_MIGRATION, /runtime_activation_epochs[\s\S]*NOT EXISTS\s*\(SELECT 1 FROM public\.runtime_activation_epochs\)/);
  assert.match(RETIREMENT_MIGRATION, /claim_x_post_delivery_v2\(text,timestamptz,bigint,text,boolean,integer\)/);
  assert.match(RETIREMENT_MIGRATION, /xot_v2_retirement_requires_v2_x_caller/);
  assert.match(RETIREMENT_MIGRATION, /claim_state IN \('preparing', 'posting'\)/);
  assert.match(RETIREMENT_MIGRATION, /xot_v2_retirement_requires_drained_x_claims/);
  assert.match(RETIREMENT_MIGRATION, /DROP FUNCTION IF EXISTS public\.complete_x_post_delivery/);
  assert.match(RETIREMENT_MIGRATION, /DROP FUNCTION IF EXISTS public\.fail_x_post_delivery/);
});

test("E6 initializes the immutable delivery floor before post seeds", () => {
  const initializeAt = E6_FIXTURE.indexOf("public.initialize_delivery_cutover('e6-disposable-fixture')");
  const postsAt = E6_FIXTURE.indexOf("INSERT INTO public.posts");
  assert.ok(initializeAt >= 0);
  assert.ok(postsAt > initializeAt);
  assert.match(E6_FIXTURE, /SELECT count\(\*\) FROM public\.delivery_cutover/);
});
