import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const script = join(repoRoot, "scripts", "check-release-state.sh");
const realPath = process.env.PATH;

function fixture(extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "xot-release-state-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const calls = join(root, "calls.log");
  const marker = join(root, "injection-marker");
  const fake = `#!/bin/sh
printf '%s\n' "$0 $*" >> "$XOT_FAKE_CALLS"
if [ "$(basename "$0")" = "npx" ] && printf '%s' "$*" | grep -q 'secrets list'; then
  printf '%s\n' '{"secrets":[]}'
fi
exit 0
`;
  for (const name of ["npx", "vercel", "curl", "git", "gh"]) {
    writeFileSync(join(bin, name), fake, { mode: 0o755 });
  }
  mkdirSync(join(root, ".supabase"));
  writeFileSync(join(root, ".supabase", "config.toml"), 'project_id = "jzirqfzzvlbxwfzndaer"\n');
  return {
    root,
    calls,
    marker,
    env: {
      ...process.env,
      PATH: `${bin}:${realPath}`,
      XOT_FAKE_CALLS: calls,
      XOT_ENVIRONMENT: "preview",
      SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
      XOT_PREVIEW_BRANCH: "preview/e10-p2",
      VERCEL_ENV: "preview",
      XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
      ...extraEnv,
    },
  };
}

function run(args, extraEnv = {}) {
  const f = fixture(extraEnv);
  let result;
  try {
    result = execFileSync("bash", [script, ...args], {
      cwd: f.root,
      env: f.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    result = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  return {
    ...f,
    output: String(result),
    calls: existsSync(f.calls) ? readFileSync(f.calls, "utf8") : "",
  };
}

test("missing target and mode fail closed before any provider-shaped CLI", () => {
  const result = run([]);
  assert.match(result.output, /target|mode/i);
  assert.equal(result.calls, "");
});

test("mixed identity aliases fail closed before any provider-shaped CLI", () => {
  const result = run(["--target", "preview", "--mode", "render"], {
    VITE_SUPABASE_PROJECT_ID: "zyxwvutsrqponmlkjihg",
  });
  assert.match(result.output, /identity|conflict|reject/i);
  assert.equal(result.calls, "");
});

test("production identity cannot enter Preview checks", () => {
  const result = run(["--target", "preview", "--mode", "render"], {
    SUPABASE_PROJECT_REF: "jzirqfzzvlbxwfzndaer",
    SUPABASE_URL: "https://jzirqfzzvlbxwfzndaer.supabase.co/",
    XOT_PREVIEW_ORIGIN: "https://xot.iraneyes.com/",
  });
  assert.match(result.output, /identity|production|reject/i);
  assert.equal(result.calls, "");
});

for (const mode of ["render", "dry-run"]) {
  test(`valid synthetic Preview ${mode} emits a plan without network calls`, () => {
    const result = run(["--target", "preview", "--mode", mode]);
    assert.match(result.output, /preview/i);
    assert.doesNotMatch(result.output, /abcdefghijklmnopqrst|preview\.example\.test/);
    assert.equal(result.calls, "");
  });
}

test("Preview execution uses explicit project ref and never linked or production flags", () => {
  const result = run(["--target", "preview", "--mode", "execute"]);
  assert.match(result.calls, /--project-ref abcdefghijklmnopqrst/);
  assert.doesNotMatch(result.calls, /--linked|--prod/);
  assert.doesNotMatch(result.calls, /jzirqfzzvlbxwfzndaer|xot\.iraneyes\.com|xot\.vercel\.app/);
});

test("shell metacharacters are rejected without execution or output disclosure", () => {
  const result = run(["--target", "preview", "--mode", "render"], {
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst;touch /tmp/xot-release-state-injected",
    XOT_PREVIEW_BRANCH: "preview/ok;touch /tmp/xot-release-state-injected",
  });
  assert.match(result.output, /reject|invalid|malformed|identity/i);
  assert.equal(result.calls, "");
  assert.doesNotMatch(result.output, /abcdefghijklmnopqrst;touch|xot-release-state-injected/);
  assert.equal(existsSync("/tmp/xot-release-state-injected"), false);
});

test("production execution requires a separate acknowledgement and identity contract", () => {
  const missing = run(["--target", "production", "--mode", "execute"]);
  assert.match(missing.output, /production|acknowledg|identity/i);
  assert.equal(missing.calls, "");
});
