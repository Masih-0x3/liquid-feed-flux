import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const paths = {
  packageJson: join(repoRoot, 'package.json'),
  preCommit: join(repoRoot, '.husky/pre-commit'),
  ci: join(repoRoot, '.github/workflows/ci.yml'),
  strictConfig: join(repoRoot, 'tsconfig.strict.json'),
};
const REVIEWED_STRICT_INCLUDE = [
  'src/**/*.ts',
  'src/**/*.tsx',
];
const REVIEWED_STRICT_EXCLUDE = ['src/test'];

function sources() {
  return Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, 'utf8')]));
}

function fail(message) {
  throw new Error(`STRICT_PROJECT_SOURCE_CONTRACT_FAIL ${message}`);
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} is missing: ${expected}`);
}

function assertNotIncludes(source, unexpected, label) {
  if (source.includes(unexpected)) fail(`${label} must not include: ${unexpected}`);
}

function assertContract(source) {
  const packageJson = JSON.parse(source.packageJson);
  assert.equal(
    packageJson.scripts?.['check:strict'],
    'tsc --noEmit -p tsconfig.strict.json',
    'check:strict must name the strict project config',
  );
  assert.equal(
    packageJson.scripts?.['check:strict-project-contract'],
    'node scripts/check-strict-project-contract.mjs',
    'package script must retain the strict-project source contract',
  );
  assert.deepEqual(
    packageJson['lint-staged']?.['*.{ts,tsx}'],
    ['eslint --fix', "bash -c 'npm run check:strict'"],
    'staged TypeScript must run the named strict project command',
  );

  assertIncludes(source.preCommit, 'npm run check:strict', 'pre-commit strict check');
  assertNotIncludes(source.preCommit, 'npx tsc --noEmit', 'bare pre-commit tsc');
  assertNotIncludes(source.packageJson, "bash -c 'tsc --noEmit'", 'bare lint-staged tsc');
  assertIncludes(source.ci, '- run: npm run check:strict-project-contract', 'hosted CI strict-project contract');
  assertIncludes(source.ci, '- run: npm run check:strict\n', 'hosted CI strict project check');

  const strictConfig = JSON.parse(source.strictConfig);
  assert.equal(strictConfig.extends, './tsconfig.app.json', 'strict project must extend the reviewed app config');
  assert.equal(strictConfig.compilerOptions?.strict, true, 'strict project must enable strict');
  assert.equal(strictConfig.compilerOptions?.noImplicitAny, true, 'strict project must enable noImplicitAny');
  assert.equal(strictConfig.compilerOptions?.strictNullChecks, true, 'strict project must enable strictNullChecks');
  assert.deepEqual(strictConfig.include, REVIEWED_STRICT_INCLUDE, 'strict project include must match the reviewed manifest');
  assert.deepEqual(strictConfig.exclude, REVIEWED_STRICT_EXCLUDE, 'strict project exclude must protect only the reviewed test boundary');
}

function assertRejects(mutator, label) {
  try {
    assertContract(mutator(sources()));
  } catch {
    return;
  }
  fail(`mutation survived: ${label}`);
}

assertContract(sources());

if (process.env.MUTATION_TEST === '1') {
  assertRejects((source) => ({
    ...source,
    packageJson: source.packageJson.replace('"check:strict": "tsc --noEmit -p tsconfig.strict.json"', '"check:strict": "tsc --noEmit"'),
  }), 'strict project script');
  assertRejects((source) => ({
    ...source,
    packageJson: source.packageJson.replace("bash -c 'npm run check:strict'", "bash -c 'tsc --noEmit'"),
  }), 'staged bare tsc');
  assertRejects((source) => ({
    ...source,
    preCommit: source.preCommit.replace('npm run check:strict', 'npx tsc --noEmit'),
  }), 'pre-commit bare tsc');
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:strict-project-contract\n', ''),
  }), 'hosted CI strict-project contract');
  assertRejects((source) => ({
    ...source,
    ci: source.ci.replace('      - run: npm run check:strict\n', ''),
  }), 'hosted CI strict project check');
  assertRejects((source) => ({
    ...source,
    strictConfig: source.strictConfig.replace('    "src/**/*.ts",\n', ''),
  }), 'strict include omission');
  assertRejects((source) => ({
    ...source,
    strictConfig: source.strictConfig.replace('  "exclude": ["src/test"]\n', ''),
  }), 'strict test exclusion removal');
  assertRejects((source) => ({
    ...source,
    strictConfig: source.strictConfig.replace('"strictNullChecks": true', '"strictNullChecks": false'),
  }), 'strict null checking');
}

console.log(`STRICT_PROJECT_SOURCE_CONTRACT_PASS include=${JSON.parse(sources().strictConfig).include.length} selfTest=${process.env.MUTATION_TEST === '1' ? 'pass' : 'skipped'}`);
