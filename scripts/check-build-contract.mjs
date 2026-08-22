#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
for (const script of ["check-runtime-contract.mjs", "check-vite-env.mjs"]) {
  execFileSync(process.execPath, [join(scriptsDir, script)], {
    env: process.env,
    stdio: "inherit",
  });
}
