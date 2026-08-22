import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { parseOutputDirArgs, runBuild, selectBuildOutput } from "./run-vite-build.mjs";

const EXPECTED = "abcdefghijklmnopqrst";
const WRAPPER = join(process.cwd(), "scripts", "run-vite-build.mjs");
const BASE_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  VITE_SUPABASE_PROJECT_ID: EXPECTED,
  VITE_SUPABASE_URL: `https://${EXPECTED}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.synthetic-public-payload.synthetic-signature",
};

function fixture() {
  return mkdtempSync(join(tmpdir(), "xot-run-vite-build-"));
}

function fakeVite(root, mode = "pass") {
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "vite");
  writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.XOT_VITE_ARGS_FILE, JSON.stringify(args));
if (${JSON.stringify(mode)} === "fail") process.exit(17);
const outIndex = args.indexOf("--outDir");
const output = args[outIndex + 1];
fs.mkdirSync(path.join(output, "assets"), { recursive: true });
fs.writeFileSync(path.join(output, "index.html"), "synthetic");
  fs.writeFileSync(path.join(output, "assets", "app.js"), "${EXPECTED}");
`);
  chmodSync(script, 0o755);
  return script;
}

test("default output is dist and Vite receives one canonical emptying output flag", () => {
  const root = fixture();
  try {
    const result = selectBuildOutput([], {}, root);
    assert.equal(result.outputDir, resolve(root, "dist"));
    assert.deepEqual(result.viteArgs, ["build", "--outDir", "dist", "--emptyOutDir"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit environment output is passed to Vite without shell interpolation", () => {
  const root = fixture();
  const output = join(root, "out $(touch should-not-exist)");
  try {
    const result = selectBuildOutput([], { XOT_BUILD_OUTPUT_DIR: output }, root);
    assert.equal(result.outputDir, resolve(output));
    assert.deepEqual(result.viteArgs, ["build", "--outDir", output, "--emptyOutDir"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("any CLI argument is rejected before Vite starts", () => {
  const root = fixture();
  try {
    for (const argv of [
      ["--outDir", "custom", "--"],
      ["--out-dir=custom"],
      ["--mode", "production"],
      ["--"],
      ["src"],
      ["output $(touch should-not-exist)"],
    ]) {
      assert.throws(() => selectBuildOutput(argv, { XOT_BUILD_OUTPUT_DIR: join(root, "isolated") }, root), /does not accept CLI arguments/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the parser rejects output flags, equals forms, and end sentinels", () => {
  for (const argv of [["--outDir", "one"], ["--out-dir=two"], ["--"]]) {
    assert.throws(() => parseOutputDirArgs(argv), /does not accept CLI arguments/);
  }
});

test("the real wrapper rejects --outDir custom -- before Vite starts", () => {
  const root = fixture();
  try {
    const result = spawnSync(process.execPath, [WRAPPER, "--outDir", "custom", "--"], {
      cwd: root,
      env: { ...BASE_ENV, XOT_BUILD_OUTPUT_DIR: join(root, "isolated") },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /does not accept CLI arguments/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Vite failure prevents identity scanning", () => {
  const root = fixture();
  const output = join(root, "output");
  const argsFile = join(root, "args.json");
  fakeVite(root, "fail");
  try {
    let scans = 0;
    assert.throws(
      () => runBuild({
        cwd: root,
        argv: [],
        env: { ...BASE_ENV, XOT_VITE_ARGS_FILE: argsFile, XOT_BUILD_OUTPUT_DIR: output },
        validate: () => { scans += 1; return { ok: true }; },
        execute: (file, args, options) => execFileSync(file, args, options),
      }),
      /Command failed/,
    );
    assert.equal(scans, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("identity failure propagates after the same-directory Vite command", () => {
  const root = fixture();
  const output = join(root, "output");
  const argsFile = join(root, "args.json");
  fakeVite(root);
  try {
    assert.throws(
      () => runBuild({
        cwd: root,
        argv: [],
        env: { ...BASE_ENV, XOT_VITE_ARGS_FILE: argsFile, XOT_BUILD_OUTPUT_DIR: output },
        validate: (directory) => {
          assert.equal(directory, resolve(output));
          return { ok: false, errors: ["synthetic identity failure"] };
        },
        execute: (file, args, options) => execFileSync(file, args, options),
      }),
      /synthetic identity failure/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
