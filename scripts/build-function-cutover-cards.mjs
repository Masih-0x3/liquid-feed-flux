#!/usr/bin/env node

/**
 * Build deterministic deployment/rollback cards for the ten pre-activation
 * cutover functions. Read-only: validates the exact live inventory record,
 * derives candidate/rollback argv for Supabase CLI 2.111.0, hashes the local
 * dependency graph of every function at both the prior and candidate roots via
 * local `deno info --json` (cache-only), and binds the prior archive
 * (path/bytes/SHA-256). Never contacts Supabase, Preview, providers, or
 * production; never invokes the Supabase CLI.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SCHEMA = "xot-function-cutover-cards-v1";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI_VERSION = "2.111.0";
export const PROJECT_REF = "jzirqfzzvlbxwfzndaer";
export const ARCHIVE_PATH = "docs/plans/artifacts/xot-production-functions-prior-2026-08-31.tar.gz";
export const INVENTORY_PATH = "docs/plans/2026-08-31-xot-production-function-inventory.json";
export const CLI_BIN = `npx --yes supabase@${CLI_VERSION}`;

const FIXED_TEN = Object.freeze([
  ["webhooks-rssapp", false],
  ["media-processor", false],
  ["digest-compiler", false],
  ["db-cleanup", false],
  ["media-cleanup", false],
  ["x-followers-snapshot", false],
  ["admin-retry", true],
  ["admin-actions", true],
  ["x-poster", false],
  ["worker", false],
]);

export const FUNCTION_NAMES = Object.freeze(FIXED_TEN.map(([name]) => name));
export const FUNCTION_VERIFY_JWT = Object.freeze(Object.fromEntries(FIXED_TEN));

const PROBES = Object.freeze({
  "webhooks-rssapp": ["POST /webhooks-rssapp with a forged RSS.app signature", "invalid signature rejected; queue/provider delta 0"],
  "media-processor": ["POST /media-processor with an unauthorized internal auth header", "invalid internal auth rejected; delivery/provider delta 0"],
  "digest-compiler": ["POST /digest-compiler with no Authorization header", "unauthorized probe rejected; checkpoint/delivery delta 0"],
  "db-cleanup": ["POST /db-cleanup with no Authorization header", "unauthorized probe rejected; row-count delta 0"],
  "media-cleanup": ["POST /media-cleanup with no Authorization header", "unauthorized probe rejected; media-object delta 0"],
  "x-followers-snapshot": ["POST /x-followers-snapshot with no Authorization header", "unauthorized probe rejected; X/provider request 0"],
  "admin-retry": ["POST /admin-retry signed-out and as read_only", "signed-out rejected; read_only cannot mutate"],
  "admin-actions": ["POST /admin-actions signed-out and as read_only", "signed-out rejected; read_only cannot mutate"],
  "x-poster": ["POST /x-poster guarded probe with posting blocked and X held", "probe stops before provider; active claims/provider delta 0"],
  "worker": ["POST /worker safe zero-work probe with schedule held", "safe zero-work probe; historical rows/attempts/provider delta 0"],
});
export const FUNCTION_PROBES = Object.freeze(Object.fromEntries(FUNCTION_NAMES.map((name) => {
  const [probe, expected] = PROBES[name];
  return [name, { probe, expectedResult: expected }];
})));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSafeRepoPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`repository path is invalid or traverses outside the repository: ${path}`);
  }
}

export function hashFile(root, path) {
  assertSafeRepoPath(path);
  return sha256(readFileSync(join(root, path)));
}

export function parseInventory(inventory) {
  const errors = [];
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return { ok: false, errors: ["inventory must be an object"] };
  if (inventory.schema !== "xot-production-function-inventory-v1") errors.push("inventory schema must be xot-production-function-inventory-v1");
  if (inventory.projectRef !== PROJECT_REF) errors.push("inventory projectRef must be the exact production ref");
  if (inventory.supabaseCli !== CLI_VERSION) errors.push(`inventory supabaseCli must be ${CLI_VERSION}`);
  if (inventory.productionMutated !== false) errors.push("inventory productionMutated must be false");
  const records = inventory.functions;
  if (!Array.isArray(records) || records.length !== FUNCTION_NAMES.length) {
    errors.push("inventory functions must contain exactly the ten production functions");
    return { ok: false, errors };
  }
  const seen = new Set();
  records.forEach((record, index) => {
    const name = record?.name;
    if (name !== FUNCTION_NAMES[index]) {
      errors.push(`inventory function ${index} must be ${FUNCTION_NAMES[index]}`);
      return;
    }
    if (seen.has(name)) {
      errors.push(`inventory contains a duplicate record for ${name}`);
      return;
    }
    seen.add(name);
    if (typeof record.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.id)) errors.push(`${name} id must be a lowercase uuid`);
    if (!Number.isInteger(record.version) || record.version <= 0) errors.push(`${name} version must be a positive integer`);
    if (record.status !== "ACTIVE") errors.push(`${name} status must be ACTIVE`);
    if (typeof record.ezbr_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.ezbr_sha256)) errors.push(`${name} ezbr_sha256 must be a hex sha256`);
    if (record.verify_jwt !== FUNCTION_VERIFY_JWT[name]) errors.push(`${name} verify_jwt must be ${FUNCTION_VERIFY_JWT[name]}`);
  });
  return { ok: errors.length === 0, errors };
}

export function verifyJwt(name) {
  if (!Object.hasOwn(FUNCTION_VERIFY_JWT, name)) throw new Error(`unknown function: ${name}`);
  return FUNCTION_VERIFY_JWT[name];
}

export function deployArgv(name) {
  const argv = ["functions", "deploy", name, "--project-ref", PROJECT_REF, "--use-api"];
  if (!verifyJwt(name)) argv.push("--no-verify-jwt");
  return argv;
}

export function entrypointPath(name) {
  return `supabase/functions/${name}/index.ts`;
}

export function resolveEntrypoint(root, name) {
  assertSafeRepoPath(entrypointPath(name));
  const entrypoint = resolve(root, entrypointPath(name));
  if (statSync(entrypoint).isFile() === false) throw new Error(`entrypoint is not a file: ${entrypoint}`);
  return entrypoint;
}

export function bindArchive(root, archivePath) {
  assertSafeRepoPath(archivePath);
  const path = archivePath;
  return { path, bytes: statSync(join(root, path)).size, sha256: hashFile(root, path) };
}

function canonicalizeSpecifier(specifier) {
  if (specifier.startsWith("file://")) {
    const parts = fileURLToPath(specifier).split(/[\\/]/).filter(Boolean);
    const index = parts.lastIndexOf("functions");
    return index >= 0 ? parts.slice(index).join("/") : specifier;
  }
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    try {
      return new URL(specifier).href;
    } catch {
      return specifier;
    }
  }
  return specifier;
}

export function graphFingerprint(denoInfo, { root, hashLocal = (path) => hashFile(root, path) } = {}) {
  if (!denoInfo || !Array.isArray(denoInfo.modules)) throw new Error("deno info graph must contain a modules array");
  const base = root ?? REPO_ROOT;
  const modules = [...denoInfo.modules]
    .filter((module) => module?.kind === "esm" && typeof module?.specifier === "string")
    .map((module) => {
      const absoluteLocal = module.local ? resolve(base, module.local) : null;
      const localRelative = absoluteLocal && absoluteLocal.startsWith(`${resolve(base)}/`) ? relative(base, absoluteLocal) : null;
      return {
        specifier: canonicalizeSpecifier(module.specifier),
        dependencies: (module.dependencies ?? [])
          .map((dependency) => ({
            specifier: canonicalizeSpecifier(dependency?.specifier ?? ""),
            code: dependency?.code?.specifier ? canonicalizeSpecifier(dependency.code.specifier) : null,
            type: dependency?.type?.specifier ? canonicalizeSpecifier(dependency.type.specifier) : null,
          }))
          .sort((a, b) => a.specifier.localeCompare(b.specifier) || String(a.code).localeCompare(String(b.code)) || String(a.type).localeCompare(String(b.type))),
        contentSha256: localRelative ? hashLocal(localRelative) : null,
      };
    })
    .sort((a, b) => a.specifier.localeCompare(b.specifier));
  return sha256(JSON.stringify(modules));
}

export function readDenoInfo(entrypoint, { cwd = REPO_ROOT, lockfile } = {}) {
  const result = spawnSync("deno", ["info", "--json", "--allow-import=none.invalid", "--frozen", entrypoint], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...(lockfile ? { DENO_LOCK_FILE: lockfile } : {}) },
  });
  if (result.error) throw new Error(`deno info failed for ${entrypoint}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`deno info failed for ${entrypoint}: ${result.stderr?.trim() || `exit ${result.status}`}`);
  return JSON.parse(result.stdout);
}

export function functionCard(name, record, archive, { priorRoot, candidateRoot, denoInfoProvider } = {}) {
  const priorEntrypoint = resolveEntrypoint(priorRoot, name);
  const candidateEntrypoint = resolveEntrypoint(candidateRoot, name);
  return {
    name,
    entrypoint: entrypointPath(name),
    prior: {
      entrypoint: priorEntrypoint,
      entrypointBytes: statSync(priorEntrypoint).size,
      entrypointSha256: sha256(readFileSync(priorEntrypoint)),
      dependencyGraphSha256: denoInfoProvider ? graphFingerprint(denoInfoProvider(priorEntrypoint), { root: priorRoot }) : null,
    },
    candidate: {
      command: "deploy",
      cli: CLI_BIN,
      argv: deployArgv(name),
      workingDirectory: candidateRoot,
      entrypoint: candidateEntrypoint,
      entrypointBytes: statSync(candidateEntrypoint).size,
      entrypointSha256: sha256(readFileSync(candidateEntrypoint)),
      dependencyGraphSha256: denoInfoProvider ? graphFingerprint(denoInfoProvider(candidateEntrypoint), { root: candidateRoot }) : null,
    },
    inventory: {
      id: record.id,
      version: record.version,
      ezbr_sha256: record.ezbr_sha256,
      status: record.status,
      verify_jwt: record.verify_jwt,
    },
    rollback: {
      command: "deploy",
      cli: CLI_BIN,
      argv: deployArgv(name),
      workingDirectory: priorRoot,
      archive,
    },
    probe: FUNCTION_PROBES[name],
  };
}

export function buildFunctionCutoverCards({
  root = REPO_ROOT,
  inventoryPath = INVENTORY_PATH,
  archivePath = ARCHIVE_PATH,
  priorRoot,
  candidateRoot,
  denoInfoProvider,
} = {}) {
  if (!priorRoot || !candidateRoot) throw new Error("priorRoot and candidateRoot are required");
  assertSafeRepoPath(inventoryPath);
  assertSafeRepoPath(archivePath);
  const inventory = JSON.parse(readFileSync(join(root, inventoryPath), "utf8"));
  const validation = parseInventory(inventory);
  if (!validation.ok) throw new Error(`live function inventory is not the exact production record: ${validation.errors.join("; ")}`);
  const archive = bindArchive(root, archivePath);
  const functions = FUNCTION_NAMES.map((name, index) => functionCard(name, inventory.functions[index], archive, {
    priorRoot,
    candidateRoot,
    denoInfoProvider,
  }));
  return {
    schema: SCHEMA,
    event: "function_cutover_cards_prep",
    status: "CANDIDATE_READY_LOCAL_ONLY",
    productionMutated: false,
    supabaseCli: CLI_VERSION,
    projectRef: PROJECT_REF,
    priorRoot,
    candidateRoot,
    archive,
    functions,
  };
}

export function serializeCards(cards) {
  if (cards?.schema !== SCHEMA) throw new Error(`cards schema must be ${SCHEMA}`);
  if (cards.productionMutated !== false) throw new Error("cards productionMutated must be false");
  if (!Array.isArray(cards.functions) || cards.functions.length !== FUNCTION_NAMES.length) throw new Error("cards must contain exactly the ten functions");
  return `${JSON.stringify(cards, null, 2)}\n`;
}

function parseArgs(args) {
  const FLAG_KEYS = { "--inventory": "inventoryPath", "--prior-root": "priorRoot", "--candidate-root": "candidateRoot", "--archive": "archivePath", "--output": "outputPath" };
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const key = FLAG_KEYS[flag];
    if (!key) throw new Error(`unknown flag: ${flag}`);
    options[key] = args[++index];
  }
  for (const [flag, key] of Object.entries(FLAG_KEYS)) {
    if (!options[key]) throw new Error(`missing required flag: ${flag}`);
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const { inventoryPath, priorRoot, candidateRoot, archivePath, outputPath } = options;
  const cards = buildFunctionCutoverCards({
    inventoryPath,
    archivePath,
    priorRoot,
    candidateRoot,
    denoInfoProvider: (entrypoint) => readDenoInfo(entrypoint),
  });
  const json = serializeCards(cards);
  assertSafeRepoPath(outputPath);
  writeFileSync(join(REPO_ROOT, outputPath), json);
  console.log(`FUNCTION_CUTOVER_CARDS_WRITTEN functions=${cards.functions.length} path=${outputPath}`);
}
