#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_PATH = "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json";

const SOURCE_CONTRACT_PATHS = [
  "package.json",
  "package-lock.json",
  "services/video-renderer/package.json",
  "services/video-renderer/package-lock.json",
  "deno.lock",
  "services/video-renderer/Dockerfile",
  ".github/workflows/ci.yml",
  "docs/operations/supply-chain-exceptions.json",
  "scripts/check-supply-chain-contract.mjs",
  "scripts/check-supply-chain-contract.test.mjs",
  "scripts/collect-supply-chain-evidence.mjs",
  "scripts/collect-supply-chain-evidence.test.mjs",
  "scripts/build-e8-local-supply-build-inventory.test.mjs",
  "scripts/check-vite-env.mjs",
  "scripts/check-vite-env.test.mjs",
];

const VITE_ENV_CONTRACT_PATH = "scripts/check-vite-env.mjs";

const PACKAGE_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const IMPORT_RE = /(?:^\s*import\s+|from\s+|import\s*\(\s*)(['"`])((?:https:\/\/|npm:|jsr:)[^'"`]+)\1/gm;
const VITE_ENV_RE = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;

function declaredViteNames(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) throw new Error(`Vite public env contract declaration is missing: ${declaration}`);
  return [...match[1].matchAll(/"(VITE_[A-Z0-9_]+)"/g)].map((entry) => entry[1]);
}

function publicViteAllowlist(source) {
  const required = declaredViteNames(source, "REQUIRED_VITE_ENV_NAMES");
  const optional = declaredViteNames(source, "OPTIONAL_VITE_ENV_NAMES");
  const exportMatch = source.match(/export const PUBLIC_VITE_ENV_NAMES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!exportMatch) throw new Error("Vite public env export composition is missing");
  const composition = exportMatch[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.replace(/,$/, ""));
  const expectedComposition = ["...REQUIRED_VITE_ENV_NAMES", "...OPTIONAL_VITE_ENV_NAMES"];
  if (JSON.stringify(composition) !== JSON.stringify(expectedComposition)) {
    throw new Error("Vite public env export composition must be exactly the required and optional declaration spreads");
  }
  const names = [...required, ...optional].sort();
  if (names.length !== 9 || new Set(names).size !== names.length) throw new Error("Vite public env contract must derive exactly nine unique names");
  return names;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readText(root, path) {
  assertSafePath(root, path);
  return readFileSync(join(root, path), "utf8");
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function hashFile(root, path) {
  assertSafePath(root, path);
  return sha256(readFileSync(join(root, path)));
}

function sourceFile(root, path) {
  assertSafePath(root, path);
  return { path, sha256: hashFile(root, path) };
}

function assertSafePath(root, path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`repository path is invalid or traverses outside the repository: ${path}`);
  }
  const rootAbsolute = resolve(root);
  const targetAbsolute = resolve(rootAbsolute, path);
  if (targetAbsolute !== rootAbsolute && !targetAbsolute.startsWith(`${rootAbsolute}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`repository path resolves outside the repository: ${path}`);
  }
  let stat;
  try {
    stat = lstatSync(targetAbsolute);
  } catch (error) {
    throw new Error(`repository path is missing: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (stat.isSymbolicLink()) throw new Error(`repository path may not be a symlink: ${path}`);
  const rootReal = realpathSync(rootAbsolute);
  const targetReal = realpathSync(targetAbsolute);
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`repository path resolves outside the repository: ${path}`);
  }
}

function isPresent(root, path) {
  try {
    assertSafePath(root, path);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("repository path is missing:")) return false;
    throw error;
  }
}

function walkFiles(root, directory) {
  assertSafePath(root, directory);
  const absolute = join(root, directory);
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      assertSafePath(root, path);
      if (entry.isSymbolicLink()) throw new Error(`walked repository path may not be a symlink: ${path}`);
      return entry.isDirectory() ? walkFiles(root, path) : [path];
    })
    .sort((a, b) => a.localeCompare(b));
}

export function parsePackageRef(ref) {
  const at = ref.indexOf("@", ref.startsWith("@") ? 1 : 0);
  if (at <= 0) return { name: ref, version: null };
  return { name: ref.slice(0, at), version: ref.slice(at + 1).split("_", 1)[0] };
}

export function packageNameFromLockPath(path) {
  if (path === "") return "";
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : path;
}

function packageEntries(root, lockPath) {
  const lock = readJson(root, lockPath);
  const lockSha = hashFile(root, lockPath);
  return Object.entries(lock.packages ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, metadata]) => {
      const name = path === "" ? lock.name : packageNameFromLockPath(path);
      return {
        name,
        path,
        version_or_ref: metadata.version ?? lock.version ?? null,
        integrity_or_source_hash: metadata.integrity ?? null,
        source_file_sha256: lockSha,
      };
    });
}

function denoEntries(root) {
  const lockPath = "deno.lock";
  const lock = readJson(root, lockPath);
  const lockSha = hashFile(root, lockPath);
  const npmPackages = Object.entries(lock.npm ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([ref, metadata]) => {
    const parsed = parsePackageRef(ref);
    return {
      name: parsed.name,
      path: `npm:${ref}`,
      version_or_ref: parsed.version,
      integrity_or_source_hash: metadata?.integrity ?? null,
      source_file_sha256: lockSha,
    };
  });
  const jsrPackages = Object.entries(lock.jsr ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([ref, metadata]) => {
    const parsed = parsePackageRef(ref);
    return {
      name: parsed.name,
      path: `jsr:${ref}`,
      version_or_ref: parsed.version,
      integrity_or_source_hash: metadata?.integrity ?? null,
      source_file_sha256: lockSha,
    };
  });
  const remoteImports = Object.entries(lock.remote ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([specifier, checksum]) => ({
    name: specifier,
    path: specifier,
    version_or_ref: specifier,
    integrity_or_source_hash: checksum,
    source_file_sha256: lockSha,
  }));
  return { npmPackages, jsrPackages, remoteImports };
}

export function resolveDenoImportIntegrity(specifier, denoLock) {
  if (specifier.startsWith("https://")) {
    const integrity = denoLock.remote?.[specifier];
    if (!integrity) throw new Error(`Deno source import missing lock integrity: ${specifier}`);
    return integrity;
  }
  if (specifier.startsWith("npm:")) {
    const ref = specifier.slice(4);
    const exact = denoLock.npm?.[ref];
    if (exact?.integrity) return exact.integrity;
    const at = ref.lastIndexOf("@");
    const slashAfterVersion = at >= 0 ? ref.indexOf("/", at) : -1;
    const base = slashAfterVersion > at ? ref.slice(0, slashAfterVersion) : ref;
    const integrity = Object.entries(denoLock.npm ?? {}).find(([key]) => key.startsWith(`${base}_`))?.[1]?.integrity;
    if (integrity) return integrity;
  }
  if (specifier.startsWith("jsr:")) {
    const ref = specifier.slice(4);
    const match = Object.entries(denoLock.jsr ?? {}).find(([key]) => {
      const packageRef = parsePackageRef(key).name;
      return ref === packageRef || ref.startsWith(`${packageRef}/`);
    });
    if (match?.[1]?.integrity) return match[1].integrity;
  }
  throw new Error(`Deno source import missing lock integrity: ${specifier}`);
}

export function collectSourceImports(root, explicitFiles = null) {
  const files = (explicitFiles ?? walkFiles(root, "supabase/functions").filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path)))
    .map((path) => {
      assertSafePath(root, path);
      return path;
    });
  const imports = new Map();
  for (const path of files) {
    const source = readText(root, path);
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[2];
      const paths = imports.get(specifier) ?? [];
      paths.push(path);
      imports.set(specifier, paths);
    }
  }
  return [...imports.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([specifier, paths]) => ({
    specifier,
    paths: paths.sort(),
  }));
}

function sourceImports(root, denoLock) {
  const imports = collectSourceImports(root);
  return imports.map(({ specifier, paths }) => ({
    name: specifier,
    path: paths.sort().join(","),
    version_or_ref: specifier,
    integrity_or_source_hash: resolveDenoImportIntegrity(specifier, denoLock),
    source_file_sha256: sha256(paths.sort().map((path) => `${path}:${hashFile(root, path)}`).join("\n")),
  }));
}

function viteEnv(root) {
  const files = ["index.html", "vite.config.ts", ...walkFiles(root, "src")]
    .filter((path) => isPresent(root, path) && /\.(?:html|ts|tsx|js|jsx)$/.test(path));
  const usages = new Map();
  const sourcePaths = [];
  for (const path of files) {
    const source = readText(root, path);
    const names = [...source.matchAll(VITE_ENV_RE)].map((match) => match[1]);
    if (names.length === 0) continue;
    sourcePaths.push(path);
    for (const name of names) {
      const paths = usages.get(name) ?? [];
      paths.push(path);
      usages.set(name, paths);
    }
  }
  const contractSource = readText(root, VITE_ENV_CONTRACT_PATH);
  const publicAllowlist = publicViteAllowlist(contractSource);
  const contractPaths = [...new Set([...sourcePaths, VITE_ENV_CONTRACT_PATH])].sort();
  return {
    source_files: contractPaths.map((path) => sourceFile(root, path)),
    public_allowlist: publicAllowlist,
    variable_names: publicAllowlist.map((name) => {
      const paths = [...new Set([...(usages.get(name) ?? []), VITE_ENV_CONTRACT_PATH])].sort();
      return {
        name,
        path: paths.join(","),
        version_or_ref: null,
        integrity_or_source_hash: null,
        source_file_sha256: sha256(paths.map((path) => `${path}:${hashFile(root, path)}`).join("\n")),
      };
    }),
  };
}

function dockerSurface(root) {
  const path = "services/video-renderer/Dockerfile";
  const source = readText(root, path);
  const baseImages = [...source.matchAll(/^FROM\s+(\S+)\s*$/gm)].map((match) => ({
    name: match[1].split("@")[0],
    path,
    version_or_ref: match[1].includes("@") ? match[1].slice(match[1].indexOf("@") + 1) : match[1],
    integrity_or_source_hash: null,
    source_file_sha256: hashFile(root, path),
  }));
  const aptBlock = source.match(/apt-get install -y --no-install-recommends\s+([\s\S]*?)\n\s*&& rm -rf/m)?.[1] ?? "";
  const aptPackages = aptBlock.split(/\r?\n/).map((line) => line.replace(/\\\s*$/, "").trim()).filter(Boolean).map((name) => ({
    name,
    path,
    version_or_ref: null,
    integrity_or_source_hash: null,
    source_file_sha256: hashFile(root, path),
  }));
  return { source_file: sourceFile(root, path), base_images: baseImages, apt_packages: aptPackages };
}

function ciSurface(root) {
  const path = ".github/workflows/ci.yml";
  const source = readText(root, path);
  const actionRefs = [...source.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)].map((match) => {
    const at = match[1].lastIndexOf("@");
    return {
      name: at > 0 ? match[1].slice(0, at) : match[1],
      path,
      version_or_ref: at > 0 ? match[1].slice(at + 1) : null,
      integrity_or_source_hash: null,
      source_file_sha256: hashFile(root, path),
    };
  });
  return { source_file: sourceFile(root, path), action_refs: actionRefs };
}

function exceptionSurface(root) {
  const path = "docs/operations/supply-chain-exceptions.json";
  const ledger = readJson(root, path);
  const sourceSha = hashFile(root, path);
  const collections = ["production_waivers", "development_build_waivers", "license_waivers"];
  const waiverIds = Object.fromEntries(collections.map((collection) => [collection, (ledger[collection] ?? []).map((waiver) => ({
    name: waiver?.id ?? null,
    path: `${path}#${collection}`,
    version_or_ref: null,
    integrity_or_source_hash: null,
    source_file_sha256: sourceSha,
  }))]));
  return { source_file: sourceFile(root, path), status: ledger.status ?? null, waiver_ids: waiverIds };
}

function validateNoSecretValueFields(value, path = "inventory") {
  const errors = [];
  const prohibited = /(?:^|_)(?:value|values|raw|secret|secrets|token|tokens|password|passwords|credential|credentials|authorization|bearer|api[_-]?key|private[_-]?key)(?:$|_)/i;
  function visit(node, currentPath) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (prohibited.test(key) && key !== "version_or_ref") errors.push(`secret/env value fields are prohibited: ${currentPath}.${key}`);
      visit(child, `${currentPath}.${key}`);
    }
  }
  visit(value, path);
  return errors;
}

export function validateInventoryDocument(inventory) {
  const errors = validateNoSecretValueFields(inventory);
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return ["inventory must be an object", ...errors];
  if (inventory.schema !== "xot-e8d-local-supply-build-inventory-v1") errors.push("inventory schema must be the reviewed E8d contract");
  if (inventory.status !== "ACCEPTED_LOCAL_T0_T1") errors.push("inventory status must remain ACCEPTED_LOCAL_T0_T1");
  if (inventory.release !== "CLOSED") errors.push("inventory release must remain CLOSED");
  if (inventory.release_gate !== "CLOSED") errors.push("inventory release gate must remain CLOSED");
  if (inventory.exception_state !== "awaiting_fresh_scan_evidence") errors.push("inventory exception state must remain awaiting_fresh_scan_evidence");
  if (inventory.no_live_contact !== true) errors.push("inventory no_live_contact must remain true");
  if (inventory.evidence?.external_scans !== "deferred") errors.push("inventory external scans must remain deferred");
  if (inventory.evidence?.waivers !== "deferred") errors.push("inventory waivers must remain deferred");
  const expectedEvidence = { tier: "T0/T1", external_scans: "deferred", waivers: "deferred", audit_fetches: "not_run", sbom: "not_run", image_scan: "not_run", dependency_update: "not_run" };
  if (JSON.stringify(inventory.evidence) !== JSON.stringify(expectedEvidence)) errors.push("inventory external evidence claims must remain conservative and non-audited");
  return errors;
}

export function buildLocalSupplyBuildInventory({ root = REPO_ROOT } = {}) {
  const sourceFiles = SOURCE_CONTRACT_PATHS.map((path) => sourceFile(root, path));
  const rootLock = readJson(root, "package-lock.json");
  const rendererLock = readJson(root, "services/video-renderer/package-lock.json");
  const deno = denoEntries(root);
  const imports = sourceImports(root, readJson(root, "deno.lock"));
  const vite = viteEnv(root);
  const docker = dockerSurface(root);
  const ci = ciSurface(root);
  const exceptions = exceptionSurface(root);
  const rootPackages = packageEntries(root, "package-lock.json");
  const rendererPackages = packageEntries(root, "services/video-renderer/package-lock.json");
  const denoSourceFiles = [...new Set(imports.flatMap((entry) => entry.path.split(",")))].sort().map((path) => sourceFile(root, path));
  const allSourceFiles = [...sourceFiles, ...denoSourceFiles]
    .concat(vite.source_files)
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.path === entry.path) === index)
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: "xot-e8d-local-supply-build-inventory-v1",
    event: "e8d_local_supply_build_inventory",
    phase: "d0-local-only",
    status: "ACCEPTED_LOCAL_T0_T1",
    release: "CLOSED",
    release_gate: "CLOSED",
    exception_state: exceptions.status,
    no_live_contact: true,
    source_files: allSourceFiles,
    surfaces: {
      root_npm: {
        package_manifest: sourceFile(root, "package.json"),
        lockfile: sourceFile(root, "package-lock.json"),
        package_entries: Object.keys(rootLock.packages ?? {}).length,
        packages: rootPackages,
      },
      renderer_npm: {
        package_manifest: sourceFile(root, "services/video-renderer/package.json"),
        lockfile: sourceFile(root, "services/video-renderer/package-lock.json"),
        package_entries: Object.keys(rendererLock.packages ?? {}).length,
        packages: rendererPackages,
      },
      deno: {
        lockfile: sourceFile(root, "deno.lock"),
        npm_packages: deno.npmPackages,
        jsr_packages: deno.jsrPackages,
        remote_imports: deno.remoteImports,
        source_imports: imports,
      },
      docker,
      ci,
      exceptions,
      vite_env: vite,
    },
    evidence: {
      tier: "T0/T1",
      external_scans: "deferred",
      waivers: "deferred",
      audit_fetches: "not_run",
      sbom: "not_run",
      image_scan: "not_run",
      dependency_update: "not_run",
    },
  };
}

export function inventoryToJson(inventory) {
  const errors = validateInventoryDocument(inventory);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function validateInventoryAgainstRepository(inventory, { root = REPO_ROOT } = {}) {
  const errors = validateInventoryDocument(inventory);
  let expected;
  try {
    expected = buildLocalSupplyBuildInventory({ root });
  } catch (error) {
    errors.push(`repository supply/build surfaces must be readable: ${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) {
    errors.push("local supply/build inventory must provide complete deterministic coverage of every runtime surface");
  }
  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inventory = buildLocalSupplyBuildInventory();
  const outputPath = join(REPO_ROOT, OUTPUT_PATH);
  writeFileSync(outputPath, inventoryToJson(inventory));
  console.log(`E8D_LOCAL_SUPPLY_BUILD_INVENTORY_WRITTEN path=${OUTPUT_PATH} sourceFiles=${inventory.source_files.length} rootPackages=${inventory.surfaces.root_npm.package_entries} rendererPackages=${inventory.surfaces.renderer_npm.package_entries} denoNpm=${inventory.surfaces.deno.npm_packages.length} denoJsr=${inventory.surfaces.deno.jsr_packages.length} denoRemote=${inventory.surfaces.deno.remote_imports.length}`);
}
