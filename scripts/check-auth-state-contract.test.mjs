import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = path.join(repoRoot, 'scripts', 'check-auth-state-contract.mjs');

test('auth state contract passes current source and mutation checks', () => {
  const output = execFileSync(process.execPath, [contract, '--self-test'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(output, /AUTH_STATE_SOURCE_CONTRACT_PASS states=7 protectedShellStates=2 selfTest=pass/);
});

