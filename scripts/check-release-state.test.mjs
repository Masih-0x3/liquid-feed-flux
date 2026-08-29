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
name="$(basename "$0")"
call="$0 $*"
# redact any Postgres connection string before persisting the fake CLI call log
call="$(printf '%s' "$call" | sed -E 's,(postgres(ql)?://[^ ]+),[masked-db-url],g')"
printf '%s\n' "$call" >> "$XOT_FAKE_CALLS"
if [ "$name" = "npx" ]; then
  # simulate the unpinned npx hang/prompt by rejecting anything but the repository pin
  if ! printf '%s' "$*" | grep -q 'supabase@2\\.111\\.0'; then
    printf 'npx rejected unpinned supabase invocation\n' >&2
    exit 42
  fi
  # reproduce the obsolete --project-ref failure on db/migration/advisors in CLI 2.111.0
  if printf '%s' "$*" | grep -qE 'db query .*--project-ref|migration list .*--project-ref|db advisors .*--project-ref'; then
    printf 'Unrecognized flag: --project-ref\n' >&2
    exit 1
  fi
  if printf '%s' "$*" | grep -q 'secrets list'; then
    printf '%s\n' '{"secrets":[]}'
  fi
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
      XOT_RELEASE_STATE_DB_URL: "",
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

const PREVIEW_DB_URL = "postgresql://postgres:fake-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";

test("Preview execute fails closed without the nonproduction database connection contract", () => {
  const result = run(["--target", "preview", "--mode", "execute"]);
  assert.match(result.output, /XOT_RELEASE_STATE_DB_URL|connection contract|rejected/i);
  assert.equal(result.calls, "");
});

test("Preview execute rejects a nonproduction connection contract that does not match the identity", () => {
  const result = run(["--target", "preview", "--mode", "execute"], {
    XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:fake-password@db.zyxwvutsrqponmlkjihg.supabase.co:5432/postgres",
  });
  assert.match(result.output, /XOT_RELEASE_STATE_DB_URL|connection contract|rejected/i);
  assert.equal(result.calls, "");
});

test("Preview execute rejects the production database host before any command", () => {
  const result = run(["--target", "preview", "--mode", "execute"], {
    XOT_RELEASE_STATE_DB_URL: "postgresql://postgres:fake-password@db.jzirqfzzvlbxwfzndaer.supabase.co:5432/postgres",
  });
  assert.match(result.output, /XOT_RELEASE_STATE_DB_URL|connection contract|rejected/i);
  assert.equal(result.calls, "");
});

test("Preview execution uses explicit project ref and never linked or production flags", () => {
  const result = run(["--target", "preview", "--mode", "execute"], { XOT_RELEASE_STATE_DB_URL: PREVIEW_DB_URL });
  assert.match(result.calls, /npx --yes supabase@2\.111\.0/);
  assert.match(result.calls, /--project-ref abcdefghijklmnopqrst/);
  assert.doesNotMatch(result.calls, /db query .*--project-ref|migration list .*--project-ref|db advisors .*--project-ref/);
  assert.match(result.calls, /--db-url \[masked-db-url\]/);
  assert.doesNotMatch(result.calls, /fake-password|postgresql:\/\/|db\.abcdefghijklmnopqrst\.supabase\.co/);
  assert.doesNotMatch(result.calls, /--linked|--prod/);
  assert.doesNotMatch(result.output, /!!|npx rejected|Unrecognized flag/);
  assert.doesNotMatch(result.output, /fake-password|db\.abcdefghijklmnopqrst\.supabase\.co|postgresql:\/\//);
  assert.doesNotMatch(result.output, /jzirqfzzvlbxwfzndaer|xot\.iraneyes\.com|xot\.vercel\.app/);
});

test("Preview execution asserts production-targeted cron schedules are inactive", () => {
  const result = run(["--target", "preview", "--mode", "execute"], { XOT_RELEASE_STATE_DB_URL: PREVIEW_DB_URL });
  assert.match(result.calls, /active IS DISTINCT FROM false/);
  assert.match(result.calls, /production-targeted cron schedule/);
});

test("every Supabase call is routed through the pinned CLI array", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /SUPABASE_CLI=\(npx --yes supabase@2\.111\.0\)/);
  const unpinnedCalls = source
    .split("\n")
    .filter((line) => /\bnpx\s+supabase\b/.test(line) && !line.includes("SUPABASE_CLI=("));
  assert.deepEqual(unpinnedCalls, []);
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

test("release-state context can invoke the preview cron isolation helper", () => {
  const output = execFileSync("node", [join(repoRoot, "scripts", "preview-cron-isolation.mjs"), "--check"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(output, /PREVIEW_CRON_ISOLATION_SOURCE_CONTRACT_PASS/);
});
