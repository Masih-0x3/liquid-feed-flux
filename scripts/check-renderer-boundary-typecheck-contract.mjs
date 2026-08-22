import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const paths = {
  packageJson: join(repoRoot, "package.json"),
  ci: join(repoRoot, ".github/workflows/ci.yml"),
  config: join(repoRoot, "tsconfig.renderer-boundary.json"),
};
const REVIEWED_INCLUDE = [
  "services/video-renderer/src/rendererRequestPolicy.js",
  "services/video-renderer/src/rendererCapacity.js",
  "services/video-renderer/src/processRunner.js",
];

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]));
}

function assertContract(source) {
  const config = JSON.parse(source.config);
  assert.equal(config.compilerOptions?.allowJs, true, "renderer boundary must allow JavaScript");
  assert.equal(config.compilerOptions?.checkJs, true, "renderer boundary must enable checkJs");
  assert.equal(config.compilerOptions?.module, "NodeNext", "renderer boundary must use NodeNext module semantics");
  assert.equal(config.compilerOptions?.moduleResolution, "NodeNext", "renderer boundary must resolve NodeNext modules");
  assert.deepEqual(config.include, REVIEWED_INCLUDE, "renderer boundary include must match the reviewed manifest");
  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.["check:renderer-boundary-typecheck"],
    "tsc --noEmit -p tsconfig.renderer-boundary.json",
    "package renderer boundary typecheck must name the reviewed project",
  );
  assert.match(source.ci, /- run: npm run check:renderer-boundary-typecheck\n/, "CI must run renderer boundary typecheck");
}

assertContract(sources());

if (process.env.MUTATION_TEST === "1") {
  assert.throws(() => assertContract({
    ...sources(),
    config: sources().config.replace('"checkJs": true', '"checkJs": false'),
  }), /checkJs/, "checkJs weakening mutation must fail");
  assert.throws(() => assertContract({
    ...sources(),
    config: sources().config.replace(REVIEWED_INCLUDE[2], ""),
  }), /reviewed manifest/, "renderer include omission mutation must fail");
  assert.throws(() => assertContract({
    ...sources(),
    ci: sources().ci.replace("      - run: npm run check:renderer-boundary-typecheck\n", ""),
  }), /CI must run renderer boundary typecheck/, "CI renderer typecheck omission mutation must fail");
}

console.log(`RENDERER_BOUNDARY_TYPECHECK_SOURCE_CONTRACT_PASS files=${REVIEWED_INCLUDE.length} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
