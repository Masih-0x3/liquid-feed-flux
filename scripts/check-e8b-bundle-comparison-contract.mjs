#!/usr/bin/env node

import { runBuilderCli } from "./build-e8b-bundle-comparison.mjs";

try {
  await runBuilderCli();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
