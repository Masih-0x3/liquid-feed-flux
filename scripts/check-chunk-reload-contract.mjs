import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "src/lib/chunkReloadRecovery.ts");
const appPath = join(repoRoot, "src/App.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

const helperSource = readFileSync(helperPath, "utf8");
const appSource = readFileSync(appPath, "utf8");
const requiredHelperExports = [
  "chunkReloadKey",
  "claimChunkReloadAttempt",
  "clearChunkReloadAttempt",
  "loadChunkWithRecovery",
];

for (const exportedName of requiredHelperExports) {
  assert.match(
    helperSource,
    new RegExp(`export (?:async )?function ${exportedName}\\b`),
    `missing helper export: ${exportedName}`,
  );
}

assert.match(
  appSource,
  /const chunkReloadBuildSha =\s*typeof __APP_VERSION_SHA__ === "string"[\s\S]*?__APP_VERSION_SHA__/,
  "the reload identity must derive from the Vite build SHA",
);
assert.match(
  appSource,
  /const chunkReloadRuntime = \{\s*buildSha: chunkReloadBuildSha,\s*getStorage: \(\) => sessionStorage,\s*reload: \(\) => window\.location\.reload\(\),\s*\};/,
  "App must defer browser storage and reload access through the build-scoped runtime adapter",
);
assert.match(
  appSource,
  /return lazy\(\(\) => loadChunkWithRecovery\(factory, chunkReloadRuntime\)\);/,
  "lazy routes must use the directly executable recovery transition",
);
assert.doesNotMatch(
  appSource,
  /const reloadKey = "xot_chunk_reloaded";/,
  "the old global reload marker must not remain",
);
assert.doesNotMatch(
  appSource,
  /sessionStorage\.(?:getItem|setItem|removeItem)\(/,
  "App must not keep an untestable direct storage state transition",
);

const transpile = typescript.transpileModule(helperSource, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: helperPath,
  reportDiagnostics: true,
});
const syntaxDiagnostics = (transpile.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
);
assert.equal(syntaxDiagnostics.length, 0, "helper must transpile without TypeScript diagnostics");

const appTranspile = typescript.transpileModule(appSource, {
  compilerOptions: {
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: appPath,
  reportDiagnostics: true,
});
const appSyntaxDiagnostics = (appTranspile.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
);
assert.equal(appSyntaxDiagnostics.length, 0, "App must transpile without TypeScript diagnostics");

const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpile.outputText).toString("base64")}`
);

class MemoryStorage {
  #entries = new Map();

  getItem(key) {
    return this.#entries.get(key) ?? null;
  }

  setItem(key, value) {
    this.#entries.set(key, value);
  }

  removeItem(key) {
    this.#entries.delete(key);
  }
}

const storage = new MemoryStorage();
assert.equal(helperModule.chunkReloadKey("build-a"), "xot_chunk_reloaded:build-a");
assert.equal(helperModule.chunkReloadKey("  "), "xot_chunk_reloaded:unknown");
assert.equal(helperModule.claimChunkReloadAttempt(storage, "build-a"), true);
assert.equal(helperModule.claimChunkReloadAttempt(storage, "build-a"), false);
assert.equal(
  helperModule.claimChunkReloadAttempt(storage, "build-b"),
  true,
  "a later build must have its own one-time recovery attempt",
);
helperModule.clearChunkReloadAttempt(storage, "build-a");
assert.equal(
  helperModule.claimChunkReloadAttempt(storage, "build-a"),
  true,
  "a successful import clear must allow a later retry for the same build",
);

const successfulImportStorage = new MemoryStorage();
helperModule.claimChunkReloadAttempt(successfulImportStorage, "build-success");
const successfulModule = { default: "loaded" };
const loadedModule = await helperModule.loadChunkWithRecovery(
  () => Promise.resolve(successfulModule),
  {
    buildSha: "build-success",
    getStorage: () => successfulImportStorage,
    reload: () => {
      throw new Error("successful imports must not reload");
    },
  },
);
assert.equal(loadedModule, successfulModule);
assert.equal(
  helperModule.claimChunkReloadAttempt(successfulImportStorage, "build-success"),
  true,
  "a successful import must clear only its current build marker",
);

const storageFailureOriginalError = new Error("original storage-path import failure");
await assert.rejects(
  () => helperModule.loadChunkWithRecovery(
    () => Promise.reject(storageFailureOriginalError),
    {
      buildSha: "build-storage-failure",
      getStorage: () => {
        throw new Error("storage unavailable");
      },
      reload: () => {
        throw new Error("reload must not run when storage is unavailable");
      },
    },
  ),
  (error) => error === storageFailureOriginalError,
  "unavailable storage must preserve the same original import error object",
);

const reloadFailureOriginalError = new Error("original reload-path import failure");
const reloadFailureStorage = new MemoryStorage();
await assert.rejects(
  () => helperModule.loadChunkWithRecovery(
    () => Promise.reject(reloadFailureOriginalError),
    {
      buildSha: "build-reload-failure",
      getStorage: () => reloadFailureStorage,
      reload: () => {
        throw new Error("reload unavailable");
      },
    },
  ),
  (error) => error === reloadFailureOriginalError,
  "failed reload must preserve the same original import error object",
);

const retryStorage = new MemoryStorage();
const retryOriginalError = new Error("stale chunk");
let reloadCalls = 0;
helperModule.loadChunkWithRecovery(
  () => Promise.reject(retryOriginalError),
  {
    buildSha: "build-retry-a",
    getStorage: () => retryStorage,
    reload: () => {
      reloadCalls += 1;
    },
  },
);
await Promise.resolve();
await Promise.resolve();
assert.equal(reloadCalls, 1, "the first failure may reload once");
await assert.rejects(
  () => helperModule.loadChunkWithRecovery(
    () => Promise.reject(retryOriginalError),
    {
      buildSha: "build-retry-a",
      getStorage: () => retryStorage,
      reload: () => {
        reloadCalls += 1;
      },
    },
  ),
  (error) => error === retryOriginalError,
  "the same build must not reload twice",
);
assert.equal(reloadCalls, 1);
helperModule.loadChunkWithRecovery(
  () => Promise.reject(retryOriginalError),
  {
    buildSha: "build-retry-b",
    getStorage: () => retryStorage,
    reload: () => {
      reloadCalls += 1;
    },
  },
);
await Promise.resolve();
await Promise.resolve();
assert.equal(
  reloadCalls,
  2,
  "a later build must have an independent one-time recovery attempt",
);

const unavailableStorage = {
  getItem() {
    throw new Error("storage unavailable");
  },
  setItem() {
    throw new Error("storage unavailable");
  },
  removeItem() {
    throw new Error("storage unavailable");
  },
};
assert.throws(
  () => helperModule.claimChunkReloadAttempt(unavailableStorage, "build-c"),
  /storage unavailable/,
  "the caller must be able to preserve the original import error when storage is unavailable",
);

console.log("CHUNK_RELOAD_SOURCE_CONTRACT_PASS 20 scenarios=8");
