import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const functionsRoot = join(repoRoot, "supabase/functions");
const REVIEWED_SUPPRESSION_COUNT = 73;
const SUPPRESSION_PATTERN = /deno-lint-ignore|@ts-(?:ignore|expect-error|nocheck)/g;

function functionFiles(directory = functionsRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return functionFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function sources() {
  const files = functionFiles();
  return {
    files,
    contents: Object.fromEntries(files.map((path) => [relative(repoRoot, path), readFileSync(path, "utf8")])),
    deno: readFileSync(join(repoRoot, "deno.json"), "utf8"),
    packageJson: readFileSync(join(repoRoot, "package.json"), "utf8"),
    ci: readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
  };
}

function suppressionCount(source) {
  return [...source.matchAll(SUPPRESSION_PATTERN)].length;
}

function fail(message) {
  throw new Error(`EDGE_SUPPRESSION_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertContract(source) {
  const count = Object.values(source.contents).reduce((total, content) => total + suppressionCount(content), 0);
  if (count > REVIEWED_SUPPRESSION_COUNT) {
    fail(`suppression baseline grew: reviewed=${REVIEWED_SUPPRESSION_COUNT} actual=${count}`);
  }
  const deno = JSON.parse(source.deno);
  assert.equal(typeof deno.tasks?.["check:functions"], "string", "Deno function check task must remain defined");
  assert.equal(typeof deno.tasks?.["lint:functions"], "string", "Deno function lint task must remain defined");
  assert.equal(typeof deno.tasks?.["test:functions"], "string", "Deno function test task must remain defined");
  const packageJson = JSON.parse(source.packageJson);
  assert.equal(packageJson.scripts?.["lint:functions"], "deno task lint:functions", "package Deno lint task must remain named");
  assert.equal(packageJson.scripts?.["check:functions"], "deno task check:functions", "package Deno check task must remain named");
  assert.match(source.ci, /- run: npm run lint:functions\n/, "CI must run Deno lint");
  assert.match(source.ci, /- run: npm run check:functions\n/, "CI must run Deno check");
  return count;
}

const source = sources();
const count = assertContract(source);

if (process.env.MUTATION_TEST === "1") {
  const firstFile = source.files[0];
  const relativePath = relative(repoRoot, firstFile);
  assert.throws(() => assertContract({
    ...source,
    contents: { ...source.contents, [relativePath]: `${source.contents[relativePath]}\n// deno-lint-ignore no-explicit-any\n` },
  }), /suppression baseline grew/, "suppression growth mutation must fail");
  assert.throws(() => assertContract({
    ...source,
    deno: source.deno.replace('"lint:functions": "deno lint supabase/functions",', ""),
  }), /Deno function lint task/, "Deno task omission mutation must fail");
  assert.throws(() => assertContract({
    ...source,
    ci: source.ci.replace("      - run: npm run check:functions\n", ""),
  }), /CI must run Deno check/, "CI Deno check omission mutation must fail");
}

console.log(`EDGE_SUPPRESSION_SOURCE_CONTRACT_PASS suppressions=${count} reviewedMax=${REVIEWED_SUPPRESSION_COUNT} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
