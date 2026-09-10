import assert from "node:assert/strict";
import test from "node:test";
import { compareCurrentReleaseCatalogs, stableValue } from "./currentReleaseSchemaComparison.mjs";

function catalog() {
  return { relations: [], columns: [], functions: [{ identity: "example()", owner: "postgres", definition: "SELECT 'A  B';" }],
    constraints: [], indexes: [], policies: [], triggers: [], views: [], sequences: [], enum_values: [] };
}

test("schema comparison normalizes JSON keys but preserves every SQL-string byte and array order", () => {
  assert.deepEqual(stableValue({ b: 1, a: 2 }), stableValue({ a: 2, b: 1 }));
  assert.notDeepEqual(stableValue(["a", "b"]), stableValue(["b", "a"]));
  const left = catalog();
  const right = catalog();
  right.functions[0] = { definition: "SELECT 'A  B';", owner: "postgres", identity: "example()" };
  assert.equal(compareCurrentReleaseCatalogs(left, right).functions.changed.length, 0);
  right.functions[0].definition = "SELECT 'a b';";
  const differences = compareCurrentReleaseCatalogs(left, right).functions.changed;
  assert.equal(differences.length, 1);
  assert.deepEqual(differences[0].fields, ["definition"]);
  assert.ok(!JSON.stringify(differences).includes("SELECT"));
});

test("schema comparison rejects missing categories and duplicate identities, and identifies missing objects", () => {
  const left = catalog();
  const right = catalog();
  delete right.policies;
  assert.throws(() => compareCurrentReleaseCatalogs(left, right), /category absent/);
  right.policies = [];
  right.functions.push(right.functions[0]);
  assert.throws(() => compareCurrentReleaseCatalogs(left, right), /duplicate/);
  right.functions = [];
  assert.deepEqual(compareCurrentReleaseCatalogs(left, right).functions.replay_only, ["example()"]);
});
