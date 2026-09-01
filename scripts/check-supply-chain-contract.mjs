#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_SUPPLY_INVENTORY_PATH = "docs/plans/2026-08-11-xot-e8d-local-supply-build-inventory.json";
const INVENTORY_SOURCE_PATHS = [
  "package.json", "package-lock.json", "services/video-renderer/package.json",
  "services/video-renderer/package-lock.json", "deno.lock", "services/video-renderer/Dockerfile",
  ".github/workflows/ci.yml", "docs/operations/supply-chain-exceptions.json",
  "scripts/check-supply-chain-contract.mjs", "scripts/check-supply-chain-contract.test.mjs",
  "scripts/build-e8-local-supply-build-inventory.test.mjs",
  "scripts/check-vite-env.mjs", "scripts/check-vite-env.test.mjs",
];
const VITE_ENV_CONTRACT_PATH = "scripts/check-vite-env.mjs";
const INVENTORY_IMPORT_RE = /(?:^\s*import\s+|from\s+|import\s*\(\s*)(['"`])((?:https:\/\/|npm:|jsr:)[^'"`]+)\1/gm;
const INVENTORY_VITE_RE = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;

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

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_CI_RUNS = [
  "node scripts/check-supply-chain-contract.mjs",
  "npm ci --ignore-scripts",
  "node scripts/check-supply-chain-contract.mjs",
  "npm --prefix services/video-renderer ci --ignore-scripts",
  "npm audit --omit=dev --audit-level=high",
  "npm --prefix services/video-renderer audit --omit=dev --audit-level=high",
  "node scripts/check-runtime-contract.mjs",
  "node --test scripts/check-runtime-contract.test.mjs",
  "node --test scripts/check-build-output-identity.test.mjs scripts/run-vite-build.test.mjs",
  "node --test scripts/check-supply-chain-contract.test.mjs",
];

const REQUIRED_CI_PREFIX_BLOCKS = [
  [
    "      - uses: actions/checkout@v4",
    "        with:",
    "          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  ],
  [
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: '20'",
    "          cache: 'npm'",
  ],
  ...REQUIRED_CI_RUNS.map((run) => [`      - run: ${run}`]),
];

const WAIVER_COLLECTIONS = [
  "production_waivers",
  "development_build_waivers",
  "license_waivers",
];
const REVIEWED_INVENTORY_COUNTS = Object.freeze({
  rootPackageEntries: 654,
  rendererPackageEntries: 32,
  denoRemoteImports: 41,
});
const REVIEWED_WAIVER_IDS = Object.freeze({
  production_waivers: [],
  development_build_waivers: [],
  license_waivers: [],
});
const PACKAGE_MANIFEST_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function assertCondition(errors, condition, message) {
  if (!condition) errors.push(message);
}

function readJson(root, path, errors) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    errors.push(`${path} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function collectCiRunSteps(source, jobName, errors) {
  const lines = source.split(/\r?\n/);
  const header = `  ${jobName}:`;
  const headerIndexes = lines.flatMap((line, index) => line === header ? [index] : []);
  assertCondition(errors, headerIndexes.length === 1, `CI job ${jobName} must appear exactly once`);
  const start = headerIndexes[0] ?? -1;
  if (start < 0 || headerIndexes.length !== 1) return { jobLines: [], steps: [] };

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const jobLines = lines.slice(start + 1, end);
  const stepStarts = [];
  for (let index = 0; index < jobLines.length; index += 1) {
    if (/^      -\s+/.test(jobLines[index])) stepStarts.push(index);
  }

  const steps = stepStarts.map((stepStart, position) => {
    const stepEnd = stepStarts[position + 1] ?? jobLines.length;
    const block = jobLines.slice(stepStart, stepEnd);
    const run = block[0].match(/^      - run:\s*(.*?)\s*$/)?.[1] ?? null;
    return { run, block };
  });
  return { jobLines, steps };
}

function validateCi(root, errors) {
  let source;
  try {
    source = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  } catch (error) {
    errors.push(`CI workflow must be readable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const lines = source.split(/\r?\n/);
  const topLevelProperties = lines.filter((line) => /^\S/.test(line) && !line.startsWith("#"));
  assertCondition(
    errors,
    topLevelProperties.length === 3
      && topLevelProperties[0] === "name: CI"
      && topLevelProperties[1] === "on:"
      && topLevelProperties[2] === "jobs:",
    "CI workflow must retain only the reviewed name, on, and jobs top-level properties",
  );
  const onIndex = lines.indexOf("on:");
  const jobsIndex = lines.indexOf("jobs:");
  const triggerLines = onIndex >= 0 && jobsIndex > onIndex
    ? lines.slice(onIndex, jobsIndex).filter((line) => line.trim() && !line.trim().startsWith("#"))
    : [];
  assertCondition(
    errors,
    JSON.stringify(triggerLines) === JSON.stringify([
      "on:",
      "  pull_request:",
      "    branches: [main]",
      "  push:",
      "    branches: [main]",
    ]),
    "CI workflow must retain the reviewed pull_request and push trigger block",
  );
  const { jobLines, steps } = collectCiRunSteps(source, "lint-build", errors);
  const directJobProperties = jobLines.filter((line) => /^    \S/.test(line));
  assertCondition(
    errors,
    directJobProperties.length === 2
      && directJobProperties[0] === "    runs-on: ubuntu-latest"
      && directJobProperties[1] === "    steps:",
    "CI lint-build job must retain only the reviewed runs-on and steps properties",
  );
  assertCondition(
    errors,
    steps.length >= REQUIRED_CI_PREFIX_BLOCKS.length
      && REQUIRED_CI_PREFIX_BLOCKS.every(
        (expectedBlock, index) => JSON.stringify(steps[index]?.block) === JSON.stringify(expectedBlock),
      ),
    "CI must begin with the reviewed checkout, setup-node, runtime, and supply-chain prefix",
  );
  const requiredRunCounts = new Map();
  for (const run of REQUIRED_CI_RUNS) requiredRunCounts.set(run, (requiredRunCounts.get(run) ?? 0) + 1);
  for (const [run, expectedCount] of requiredRunCounts) {
    const matchingSteps = steps.filter((step) => step.run === run);
    assertCondition(errors, matchingSteps.length === expectedCount, `CI must contain exactly ${expectedCount} bare ${JSON.stringify(run)} step${expectedCount === 1 ? "" : "s"} in lint-build`);
    for (const step of matchingSteps) {
      assertCondition(errors, step.block.length === 1, `CI ${JSON.stringify(run)} step must be a bare, non-conditional command`);
    }
  }

  assertCondition(
    errors,
    REQUIRED_CI_RUNS.every((run, index) => steps[index + 2]?.run === run),
    "CI must complete direct supply-chain preflights before both lifecycle-suppressed install/audit phases, before any mutable Node contract or test command",
  );
}

function validateNpmLock(root, packagePath, lockPath, label, errors) {
  const packageJson = readJson(root, packagePath, errors);
  const lockfile = readJson(root, lockPath, errors);
  if (!packageJson || !lockfile) return { directDependencies: 0, packageEntries: 0 };

  assertCondition(errors, lockfile.lockfileVersion === 3, `${label} lockfile must use npm lockfileVersion 3`);
  assertCondition(errors, lockfile.name === packageJson.name, `${label} package and lock names must match`);
  assertCondition(errors, lockfile.version === packageJson.version, `${label} package and lock versions must match`);
  const rootPackage = lockfile.packages?.[""];
  assertCondition(errors, rootPackage && typeof rootPackage === "object", `${label} lockfile must contain a root package entry`);

  const directDependencies = packageJson.dependencies ?? {};
  for (const section of PACKAGE_MANIFEST_SECTIONS) {
    const expected = packageJson[section] ?? {};
    const observed = rootPackage?.[section] ?? {};
    const stable = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
    assertCondition(errors, stable(observed) === stable(expected), `${label} lock root ${section} must match package.json`);
  }
  for (const [name, range] of Object.entries(directDependencies)) {
    assertCondition(errors, rootPackage?.dependencies?.[name] === range, `${label} lockfile root dependency ${name} must match package.json`);
    assertCondition(errors, Boolean(lockfile.packages?.[`node_modules/${name}`]), `${label} lockfile must resolve direct dependency ${name}`);
  }

  for (const [path, metadata] of Object.entries(lockfile.packages ?? {})) {
    if (!path || !metadata || typeof metadata !== "object") continue;
    assertCondition(errors, !metadata.link, `${label} lock entry ${path} may not use a local link because the production audit must cover a registry-resolved package`);
    if (metadata.link) continue;
    assertCondition(errors, typeof metadata.version === "string" && metadata.version.length > 0, `${label} lock entry ${path} must have a resolved version`);
    assertCondition(errors, typeof metadata.resolved === "string" && metadata.resolved.startsWith("https://registry.npmjs.org/"), `${label} lock entry ${path} must resolve through the reviewed HTTPS npm registry`);
    assertCondition(errors, typeof metadata.integrity === "string" && /^sha(?:1|512)-/.test(metadata.integrity), `${label} registry lock entry ${path} must have an integrity value`);
  }

  return { directDependencies: Object.keys(directDependencies).length, packageEntries: Object.keys(lockfile.packages ?? {}).length };
}

function validateNpmConfiguration(root, errors) {
  for (const path of [".npmrc", "services/video-renderer/.npmrc"]) {
    assertCondition(errors, !existsSync(join(root, path)), `${path} is not permitted because it can redirect audited registry/configuration behavior`);
  }
}

function validateDenoLock(root, errors) {
  const lock = readJson(root, "deno.lock", errors);
  if (!lock) return { remoteImports: 0, npmPackages: 0, jsrPackages: 0 };

  assertCondition(errors, lock.version === "5", "Deno lock must remain at reviewed version 5");
  const remoteEntries = Object.entries(lock.remote ?? {});
  assertCondition(errors, remoteEntries.length > 0, "Deno lock must retain checksum-backed remote imports");
  for (const [specifier, checksum] of remoteEntries) {
    assertCondition(errors, specifier.startsWith("https://"), `Deno remote import must use HTTPS: ${specifier}`);
    assertCondition(errors, /^[a-f0-9]{64}$/.test(checksum), `Deno remote import must have a SHA-256 checksum: ${specifier}`);
  }
  for (const [packageName, metadata] of Object.entries(lock.npm ?? {})) {
    assertCondition(errors, typeof metadata?.integrity === "string" && /^sha(?:1|512)-/.test(metadata.integrity), `Deno npm package must have an integrity value: ${packageName}`);
  }
  for (const [packageName, metadata] of Object.entries(lock.jsr ?? {})) {
    assertCondition(errors, /^[a-f0-9]{64}$/.test(metadata?.integrity ?? ""), `Deno JSR package must have a SHA-256 integrity value: ${packageName}`);
  }

  return { remoteImports: remoteEntries.length, npmPackages: Object.keys(lock.npm ?? {}).length, jsrPackages: Object.keys(lock.jsr ?? {}).length };
}

function validateRendererDockerfile(root, errors) {
  let dockerfile;
  try {
    dockerfile = readFileSync(join(root, "services/video-renderer/Dockerfile"), "utf8");
  } catch (error) {
    errors.push(`renderer Dockerfile must be readable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const baseImage = dockerfile.match(/^FROM\s+(\S+)\s*$/m)?.[1] ?? null;
  assertCondition(errors, baseImage === "node:20-bookworm-slim", "renderer Docker base selector must stay aligned with the reviewed runtime contract");
  assertCondition(errors, dockerfile.includes("apt-get install -y --no-install-recommends"), "renderer Dockerfile must retain its explicit APT package installation boundary");
  assertCondition(errors, dockerfile.includes("rm -rf /var/lib/apt/lists/*"), "renderer Dockerfile must clear transient APT metadata");
  assertCondition(errors, dockerfile.includes("COPY package.json package-lock.json ./"), "renderer Dockerfile must install from its lockfile");
  assertCondition(errors, dockerfile.includes("RUN npm ci --omit=dev"), "renderer Dockerfile must retain production lockfile installation");
  return baseImage;
}

function validateExceptionLedger(root, errors, now) {
  const ledger = readJson(root, "docs/operations/supply-chain-exceptions.json", errors);
  if (!ledger) return { waiverCount: 0, status: "unreadable" };

  assertCondition(errors, ledger.schema_version === "xot-supply-chain-exceptions-v1", "supply-chain exception ledger schema must be reviewed");
  assertCondition(errors, ["awaiting_fresh_scan_evidence", "current_scan_evidence_recorded"].includes(ledger.status), "supply-chain exception ledger status must be explicit");

  let waiverCount = 0;
  for (const collection of WAIVER_COLLECTIONS) {
    const waivers = ledger[collection];
    assertCondition(errors, Array.isArray(waivers), `${collection} must be an array`);
    if (!Array.isArray(waivers)) continue;
    const observedIds = waivers.map((waiver) => waiver?.id ?? null);
    assertCondition(
      errors,
      JSON.stringify(observedIds) === JSON.stringify(REVIEWED_WAIVER_IDS[collection]),
      `${collection} waiver inventory must match the reviewed manifest`,
    );
    waiverCount += waivers.length;
    for (const waiver of waivers) {
      const requiredFields = ["id", "scope", "advisory", "severity", "exploitability", "impact", "owner", "evidence", "expires_at"];
      for (const field of requiredFields) {
        assertCondition(errors, typeof waiver?.[field] === "string" && waiver[field].trim().length > 0, `${collection} waiver must include ${field}`);
      }
      const expiresAt = Date.parse(waiver?.expires_at ?? "");
      assertCondition(errors, Number.isFinite(expiresAt) && expiresAt > now, `${collection} waiver ${waiver?.id ?? "<unknown>"} must have a future expiry`);
    }
  }

  if (ledger.status === "awaiting_fresh_scan_evidence") {
    assertCondition(errors, ledger.last_scan_receipt === null, "an awaiting-scan ledger may not claim a scan receipt");
    assertCondition(errors, waiverCount === 0, "an awaiting-scan ledger may not contain waivers without fresh scan evidence");
  } else {
    const receipt = ledger.last_scan_receipt;
    assertCondition(errors, receipt && typeof receipt === "object" && !Array.isArray(receipt), "a current-scan ledger must contain a scan receipt object");
    for (const field of ["sha", "source", "completed_at", "root_production_audit", "renderer_production_audit"]) {
      assertCondition(errors, typeof receipt?.[field] === "string" && receipt[field].trim().length > 0, `current scan receipt must include ${field}`);
    }
    assertCondition(errors, /^[a-f0-9]{40}$/.test(receipt?.sha ?? ""), "current scan receipt sha must be a full lowercase Git SHA");
    assertCondition(errors, /^(?:github-actions|local):[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(receipt?.source ?? ""), "current scan receipt source must identify a reviewed github-actions or local evidence origin");
    for (const field of ["root_production_audit", "renderer_production_audit"]) {
      assertCondition(errors, ["passed", "failed"].includes(receipt?.[field]), `current scan receipt ${field} must be explicitly passed or failed`);
    }
    const completedAt = Date.parse(receipt?.completed_at ?? "");
    assertCondition(errors, Number.isFinite(completedAt), "current scan receipt completed_at must be an ISO date");
    if (Number.isFinite(completedAt)) {
      assertCondition(errors, completedAt <= now + FUTURE_TIMESTAMP_TOLERANCE_MS, "current scan receipt completed_at cannot be materially in the future");
    }
  }

  return { waiverCount, status: ledger.status };
}

function inventorySha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inventoryPath(root, path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`invalid repository path ${path}`);
  }
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}/`)) throw new Error(`path outside repository ${path}`);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`symlink is not permitted ${path}`);
  const realRoot = realpathSync(absoluteRoot);
  const realTarget = realpathSync(absolute);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}/`)) throw new Error(`path resolves outside repository ${path}`);
  return absolute;
}

function inventoryText(root, path) {
  return readFileSync(inventoryPath(root, path), "utf8");
}

function inventoryHashFile(root, path) {
  return inventorySha256(readFileSync(inventoryPath(root, path)));
}

function inventorySourceFile(root, path) {
  return { path, sha256: inventoryHashFile(root, path) };
}

function inventoryJson(root, path) {
  return JSON.parse(inventoryText(root, path));
}

function inventoryWalk(root, directory) {
  inventoryPath(root, directory);
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    inventoryPath(root, path);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not permitted ${path}`);
    return entry.isDirectory() ? inventoryWalk(root, path) : [path];
  }).sort((a, b) => a.localeCompare(b));
}

function inventoryPackageRef(ref) {
  const at = ref.indexOf("@", ref.startsWith("@") ? 1 : 0);
  return at <= 0 ? { name: ref, version: null } : { name: ref.slice(0, at), version: ref.slice(at + 1).split("_", 1)[0] };
}

function inventoryPackageName(path) {
  if (path === "") return "";
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : path;
}

function inventoryPackages(root, lockPath) {
  const lock = inventoryJson(root, lockPath);
  const sourceHash = inventoryHashFile(root, lockPath);
  return Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([path, metadata]) => ({
    name: path === "" ? lock.name : inventoryPackageName(path),
    path,
    version_or_ref: metadata.version ?? lock.version ?? null,
    integrity_or_source_hash: metadata.integrity ?? null,
    source_file_sha256: sourceHash,
  }));
}

function inventoryDeno(root) {
  const lock = inventoryJson(root, "deno.lock");
  const sourceHash = inventoryHashFile(root, "deno.lock");
  const packageEntries = (section, prefix) => Object.entries(lock[section] ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([ref, metadata]) => {
    const parsed = inventoryPackageRef(ref);
    return { name: parsed.name, path: `${prefix}:${ref}`, version_or_ref: parsed.version, integrity_or_source_hash: metadata?.integrity ?? null, source_file_sha256: sourceHash };
  });
  return {
    lock,
    npm_packages: packageEntries("npm", "npm"),
    jsr_packages: packageEntries("jsr", "jsr"),
    remote_imports: Object.entries(lock.remote ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([specifier, checksum]) => ({ name: specifier, path: specifier, version_or_ref: specifier, integrity_or_source_hash: checksum, source_file_sha256: sourceHash })),
  };
}

function inventorySourceImports(root, deno) {
  const files = inventoryWalk(root, "supabase/functions").filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
  const refs = new Map();
  for (const path of files) {
    for (const match of inventoryText(root, path).matchAll(INVENTORY_IMPORT_RE)) {
      const paths = refs.get(match[2]) ?? [];
      paths.push(path);
      refs.set(match[2], paths);
    }
  }
  const integrity = (specifier) => {
    if (specifier.startsWith("https://")) return deno.lock.remote?.[specifier] ?? null;
    const ref = specifier.replace(/^(?:npm:|jsr:)/, "");
    if (specifier.startsWith("npm:")) {
      if (deno.lock.npm?.[ref]?.integrity) return deno.lock.npm[ref].integrity;
      const at = ref.lastIndexOf("@");
      const slash = at >= 0 ? ref.indexOf("/", at) : -1;
      const base = slash > at ? ref.slice(0, slash) : ref;
      return Object.entries(deno.lock.npm ?? {}).find(([key]) => key.startsWith(`${base}_`))?.[1]?.integrity ?? null;
    }
    if (specifier.startsWith("jsr:")) {
      const match = Object.entries(deno.lock.jsr ?? {}).find(([key]) => {
        const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
        const packageName = at > 0 ? key.slice(0, at) : key;
        return ref === packageName || ref.startsWith(`${packageName}/`);
      });
      return match?.[1]?.integrity ?? null;
    }
    return null;
  };
  return [...refs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([specifier, paths]) => {
    const ordered = paths.sort();
    const lockIntegrity = integrity(specifier);
    if (!lockIntegrity) throw new Error(`Deno source import missing lock integrity: ${specifier}`);
    return { name: specifier, path: ordered.join(","), version_or_ref: specifier, integrity_or_source_hash: lockIntegrity, source_file_sha256: inventorySha256(ordered.map((path) => `${path}:${inventoryHashFile(root, path)}`).join("\n")) };
  });
}

function inventoryDocker(root) {
  const path = "services/video-renderer/Dockerfile";
  const source = inventoryText(root, path);
  const sourceHash = inventoryHashFile(root, path);
  const baseImages = [...source.matchAll(/^FROM\s+(\S+)\s*$/gm)].map((match) => ({ name: match[1].split("@")[0], path, version_or_ref: match[1].includes("@") ? match[1].slice(match[1].indexOf("@") + 1) : match[1], integrity_or_source_hash: null, source_file_sha256: sourceHash }));
  const aptBlock = source.match(/apt-get install -y --no-install-recommends\s+([\s\S]*?)\n\s*&& rm -rf/m)?.[1] ?? "";
  const aptPackages = aptBlock.split(/\r?\n/).map((line) => line.replace(/\\\s*$/, "").trim()).filter(Boolean).map((name) => ({ name, path, version_or_ref: null, integrity_or_source_hash: null, source_file_sha256: sourceHash }));
  return { source_file: { path, sha256: sourceHash }, base_images: baseImages, apt_packages: aptPackages };
}

function inventoryCi(root) {
  const path = ".github/workflows/ci.yml";
  const sourceHash = inventoryHashFile(root, path);
  const actionRefs = [...inventoryText(root, path).matchAll(/^\s*- uses:\s*([^\s#]+)\s*$/gm)].map((match) => {
    const at = match[1].lastIndexOf("@");
    return { name: at > 0 ? match[1].slice(0, at) : match[1], path, version_or_ref: at > 0 ? match[1].slice(at + 1) : null, integrity_or_source_hash: null, source_file_sha256: sourceHash };
  });
  return { source_file: { path, sha256: sourceHash }, action_refs: actionRefs };
}

function inventoryExceptions(root) {
  const path = "docs/operations/supply-chain-exceptions.json";
  const ledger = inventoryJson(root, path);
  const sourceHash = inventoryHashFile(root, path);
  const waiverIds = Object.fromEntries(["production_waivers", "development_build_waivers", "license_waivers"].map((collection) => [collection, (ledger[collection] ?? []).map((waiver) => ({ name: waiver?.id ?? null, path: `${path}#${collection}`, version_or_ref: null, integrity_or_source_hash: null, source_file_sha256: sourceHash }))]));
  return { source_file: { path, sha256: sourceHash }, status: ledger.status ?? null, waiver_ids: waiverIds };
}

function inventoryVite(root) {
  const files = ["index.html", "vite.config.ts", ...inventoryWalk(root, "src")].filter((path) => /\.(?:html|ts|tsx|js|jsx)$/.test(path) && existsSync(join(root, path)));
  const names = new Map();
  const sourceFiles = [];
  for (const path of files) {
    const found = [...inventoryText(root, path).matchAll(INVENTORY_VITE_RE)].map((match) => match[1]);
    if (!found.length) continue;
    sourceFiles.push(inventorySourceFile(root, path));
    for (const name of found) names.set(name, [...(names.get(name) ?? []), path]);
  }
  const contractSource = inventoryText(root, VITE_ENV_CONTRACT_PATH);
  const publicAllowlist = publicViteAllowlist(contractSource);
  const contractPaths = [...new Set([...sourceFiles.map(({ path }) => path), VITE_ENV_CONTRACT_PATH])].sort();
  return {
    source_files: contractPaths.map((path) => inventorySourceFile(root, path)),
    public_allowlist: publicAllowlist,
    variable_names: publicAllowlist.map((name) => {
      const paths = [...new Set([...(names.get(name) ?? []), VITE_ENV_CONTRACT_PATH])].sort();
      return { name, path: paths.join(","), version_or_ref: null, integrity_or_source_hash: null, source_file_sha256: inventorySha256(paths.map((path) => `${path}:${inventoryHashFile(root, path)}`).join("\n")) };
    }),
  };
}

export function independentInventorySurfaces(root) {
  const deno = inventoryDeno(root);
  const sourceImports = inventorySourceImports(root, deno);
  const denoSourceFiles = [...new Set(sourceImports.flatMap((entry) => entry.path.split(",")))].sort().map((path) => inventorySourceFile(root, path));
  const vite = inventoryVite(root);
  const sourceFiles = [...INVENTORY_SOURCE_PATHS.map((path) => inventorySourceFile(root, path)), ...denoSourceFiles, ...vite.source_files]
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.path === entry.path) === index)
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    source_files: sourceFiles,
    root_npm: { package_manifest: inventorySourceFile(root, "package.json"), lockfile: inventorySourceFile(root, "package-lock.json"), package_entries: inventoryPackages(root, "package-lock.json").length, packages: inventoryPackages(root, "package-lock.json") },
    renderer_npm: { package_manifest: inventorySourceFile(root, "services/video-renderer/package.json"), lockfile: inventorySourceFile(root, "services/video-renderer/package-lock.json"), package_entries: inventoryPackages(root, "services/video-renderer/package-lock.json").length, packages: inventoryPackages(root, "services/video-renderer/package-lock.json") },
    deno: { lockfile: inventorySourceFile(root, "deno.lock"), npm_packages: deno.npm_packages, jsr_packages: deno.jsr_packages, remote_imports: deno.remote_imports, source_imports: sourceImports },
    docker: inventoryDocker(root),
    ci: inventoryCi(root),
    exceptions: inventoryExceptions(root),
    vite_env: vite,
  };
}

function validateInventoryNoSecretFields(value, path = "inventory") {
  const errors = [];
  const prohibited = /(?:^|_)(?:value|values|raw|secret|secrets|token|tokens|password|passwords|credential|credentials|authorization|bearer|api[_-]?key|private[_-]?key)(?:$|_)/i;
  const visit = (node, currentPath) => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (prohibited.test(key) && key !== "version_or_ref") errors.push(`secret/env value fields are prohibited: ${currentPath}.${key}`);
      visit(child, `${currentPath}.${key}`);
    }
  };
  visit(value, path);
  return errors;
}

function validateLocalSupplyBuildInventory(root, errors) {
  let inventory;
  try {
    inventory = JSON.parse(readFileSync(join(root, LOCAL_SUPPLY_INVENTORY_PATH), "utf8"));
  } catch (error) {
    errors.push(`local supply/build inventory must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  errors.push(...validateInventoryNoSecretFields(inventory));
  if (inventory?.schema !== "xot-e8d-local-supply-build-inventory-v1") errors.push("local supply/build inventory schema is not reviewed");
  if (inventory?.status !== "ACCEPTED_LOCAL_T0_T1") errors.push("local supply/build inventory status must remain ACCEPTED_LOCAL_T0_T1");
  if (inventory?.release !== "CLOSED" || inventory?.release_gate !== "CLOSED") errors.push("local supply/build inventory release must remain CLOSED");
  if (inventory?.exception_state !== "awaiting_fresh_scan_evidence") errors.push("local supply/build inventory exception state must remain awaiting_fresh_scan_evidence");
  if (inventory?.no_live_contact !== true) errors.push("local supply/build inventory no_live_contact must remain true");
  if (inventory?.evidence?.external_scans !== "deferred" || inventory?.evidence?.waivers !== "deferred") errors.push("local supply/build inventory external evidence must remain deferred");
  const expectedEvidence = { tier: "T0/T1", external_scans: "deferred", waivers: "deferred", audit_fetches: "not_run", sbom: "not_run", image_scan: "not_run", dependency_update: "not_run" };
  if (JSON.stringify(inventory?.evidence) !== JSON.stringify(expectedEvidence)) errors.push("local supply/build inventory external evidence claims must remain conservative and non-audited");
  try {
    const expected = independentInventorySurfaces(root);
    if (JSON.stringify(inventory?.source_files) !== JSON.stringify(expected.source_files)) errors.push("local supply/build inventory source-file coverage/hash binding differs from repository");
    for (const surface of ["root_npm", "renderer_npm", "deno", "docker", "ci", "exceptions", "vite_env"]) {
      if (JSON.stringify(inventory?.surfaces?.[surface]) !== JSON.stringify(expected[surface])) errors.push(`local supply/build inventory ${surface} coverage/hash binding differs from repository`);
    }
  } catch (error) {
    errors.push(`local supply/build inventory independent source projection failed closed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateSupplyChainContract({ root = REPO_ROOT, now = Date.now() } = {}) {
  const errors = [];
  validateCi(root, errors);
  validateNpmConfiguration(root, errors);
  const rootLock = validateNpmLock(root, "package.json", "package-lock.json", "root", errors);
  const rendererLock = validateNpmLock(root, "services/video-renderer/package.json", "services/video-renderer/package-lock.json", "renderer", errors);
  const denoLock = validateDenoLock(root, errors);
  assertCondition(errors, rootLock.packageEntries === REVIEWED_INVENTORY_COUNTS.rootPackageEntries, "root package inventory must match the reviewed manifest");
  assertCondition(errors, rendererLock.packageEntries === REVIEWED_INVENTORY_COUNTS.rendererPackageEntries, "renderer package inventory must match the reviewed manifest");
  assertCondition(errors, denoLock.remoteImports === REVIEWED_INVENTORY_COUNTS.denoRemoteImports, "Deno remote-import inventory must match the reviewed manifest");
  const rendererDockerBase = validateRendererDockerfile(root, errors);
  const exceptionLedger = validateExceptionLedger(root, errors, now);
  validateLocalSupplyBuildInventory(root, errors);
  return { errors, rootLock, rendererLock, denoLock, rendererDockerBase, exceptionLedger };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = validateSupplyChainContract();
  if (result.errors.length > 0) {
    console.error(`Supply-chain contract FAIL:\n- ${result.errors.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    `SUPPLY_CHAIN_SOURCE_CONTRACT_PASS rootPackages=${result.rootLock.packageEntries} rendererPackages=${result.rendererLock.packageEntries} denoRemote=${result.denoLock.remoteImports} waivers=${result.exceptionLedger.waiverCount} scanStatus=${result.exceptionLedger.status}`,
  );
}
