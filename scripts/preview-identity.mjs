#!/usr/bin/env node

/**
 * Fail-closed identity contract for the one hosted XOT Preview plane.
 *
 * This module is deliberately dependency-free. It only validates values that
 * have already been selected by a caller; it never links, deploys, contacts a
 * provider, or reads a secret store. Callers must run it before any
 * deploy-capable or network-capable command.
 */

export const PREVIEW_ENVIRONMENT = "preview";
export const PREVIEW_DEPLOYMENT_TARGET = "preview";
export const PRODUCTION_SUPABASE_PROJECT_REF = "jzirqfzzvlbxwfzndaer";

export const PREVIEW_IDENTITY_FIELDS = Object.freeze([
  "environment",
  "supabaseProjectRef",
  "supabaseUrlHost",
  "previewBranch",
  "vercelDeploymentTarget",
  "previewOrigin",
]);

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PRODUCTION_BRANCHES = new Set(["main", "master", "production", "prod"]);
const PRODUCTION_ORIGIN_HOSTS = new Set(["xot.iraneyes.com", "xot.vercel.app"]);
const MAX_ORIGIN_LENGTH = 512;
const BRANCH_ORIGIN_ALIASES = Object.freeze(["VERCEL_BRANCH_URL", "VITE_VERCEL_BRANCH_URL"]);
const HOST_ONLY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+\.?$/;

const FIELD_ALIASES = Object.freeze({
  environment: ["environment", "xotEnvironment", "XOT_ENVIRONMENT", "APP_ENVIRONMENT", "ENVIRONMENT", "VERCEL_ENV"],
  supabaseProjectRef: [
    "supabaseProjectRef",
    "projectRef",
    "SUPABASE_PROJECT_REF",
    "VITE_SUPABASE_PROJECT_ID",
  ],
  supabaseUrl: ["supabaseUrl", "SUPABASE_URL", "VITE_SUPABASE_URL"],
  supabaseUrlHost: ["supabaseUrlHost", "SUPABASE_URL_HOST", "VITE_SUPABASE_URL_HOST"],
  previewBranch: ["previewBranch", "branch", "XOT_PREVIEW_BRANCH", "PREVIEW_BRANCH", "VERCEL_GIT_COMMIT_REF"],
  vercelDeploymentTarget: [
    "vercelDeploymentTarget",
    "deploymentTarget",
    "VERCEL_DEPLOYMENT_TARGET",
    "VERCEL_TARGET_ENV",
    "VERCEL_ENV",
  ],
  previewOrigin: ["previewOrigin", "origin", "XOT_PREVIEW_ORIGIN", "PREVIEW_ORIGIN", "PUBLIC_APP_ORIGIN"],
});

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstValue(input, names) {
  for (const name of names) {
    const value = stringValue(input?.[name]);
    if (value) return value;
  }
  return "";
}

function hasAliasConflict(input, names) {
  const values = names.map((name) => stringValue(input?.[name])).filter(Boolean);
  return new Set(values).size > 1;
}

/** Normalize object and process.env-style names without exposing raw values. */
export function readPreviewIdentity(input = process.env) {
  const explicitOrigin = firstValue(input, FIELD_ALIASES.previewOrigin);
  return Object.freeze({
    environment: firstValue(input, FIELD_ALIASES.environment),
    supabaseProjectRef: firstValue(input, FIELD_ALIASES.supabaseProjectRef),
    supabaseUrl: firstValue(input, FIELD_ALIASES.supabaseUrl),
    supabaseUrlHost: firstValue(input, FIELD_ALIASES.supabaseUrlHost),
    previewBranch: firstValue(input, FIELD_ALIASES.previewBranch),
    vercelDeploymentTarget: firstValue(input, FIELD_ALIASES.vercelDeploymentTarget),
    previewOrigin: explicitOrigin || derivedPreviewOrigin(input),
  });
}

function maskIdentifier(value) {
  const text = stringValue(value);
  if (!text) return "[missing]";
  if (text.length < 8) return "[masked]";
  return `${text.slice(0, 3)}…${text.slice(-3)}`;
}

function maskOrigin(value) {
  const text = stringValue(value);
  if (!text) return "[missing]";
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${maskIdentifier(parsed.hostname)}`;
  } catch {
    return "[masked]";
  }
}

function error(field, code, message) {
  return Object.freeze({ field, code, message });
}

function parseSupabaseUrl(value) {
  if (!value || value.length > 256) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
      || !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseSupabaseHost(value) {
  const host = stringValue(value).toLowerCase();
  return /^[a-z0-9]{20}\.supabase\.co$/.test(host) ? host : null;
}

function parsePreviewOrigin(value) {
  if (!value || value.length > MAX_ORIGIN_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
      || (parsed.pathname !== "" && parsed.pathname !== "/")
      || parsed.search !== ""
      || parsed.hash !== ""
      || !parsed.hostname
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Vercel's branch URL metadata is a host-only value. Keep this parser strict
 * so a value cannot smuggle credentials, a port, a path, or a URL scheme into
 * the origin used by the Preview identity contract.
 */
function parseBranchOrigin(value) {
  const host = stringValue(value);
  if (!host || host.length > MAX_ORIGIN_LENGTH || !HOST_ONLY_RE.test(host)) return null;
  try {
    const parsed = new URL(`https://${host}`);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function branchOriginInputs(input) {
  return BRANCH_ORIGIN_ALIASES
    .map((name) => ({ name, value: stringValue(input?.[name]) }))
    .filter(({ value }) => value);
}

function canonicalOrigin(parsed) {
  return `${parsed.protocol}//${canonicalOriginHost(parsed.hostname)}`;
}

function derivedPreviewOrigin(input) {
  const candidates = branchOriginInputs(input);
  if (candidates.length === 0) return "";
  const parsed = parseBranchOrigin(candidates[0].value);
  return parsed ? `${parsed.protocol}//${parsed.hostname}/` : "";
}

function canonicalOriginHost(hostname) {
  const host = stringValue(hostname).toLowerCase();
  // WHATWG URL canonicalizes percent-encoded dots in a host and preserves an
  // absolute-DNS trailing dot. Treat both as the same DNS name for the
  // production-origin denylist.
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

function isProductionOriginHost(hostname) {
  return PRODUCTION_ORIGIN_HOSTS.has(canonicalOriginHost(hostname));
}

function resultWithSummary(identity, errors) {
  const normalizedErrors = Object.freeze(errors);
  return Object.freeze({
    ok: normalizedErrors.length === 0,
    errors: Object.freeze(normalizedErrors.map(({ field, code, message }) => `${field}: ${message}`)),
    errorCodes: Object.freeze(normalizedErrors.map(({ field, code }) => `${field}.${code}`)),
    diagnostics: normalizedErrors,
    identity: Object.freeze({
      environment: identity.environment || "[missing]",
      supabaseProjectRef: maskIdentifier(identity.supabaseProjectRef),
      supabaseUrlHost: maskIdentifier(identity.supabaseUrlHost),
      previewBranch: maskIdentifier(identity.previewBranch),
      vercelDeploymentTarget: identity.vercelDeploymentTarget || "[missing]",
      previewOrigin: maskOrigin(identity.previewOrigin),
    }),
  });
}

/**
 * Validate the complete Preview tuple. Every rejected value has a stable,
 * value-free diagnostic. The returned identity summary is masked as well.
 */
export function validatePreviewIdentity(input = process.env, options = {}) {
  const identity = readPreviewIdentity(input);
  const errors = [];
  const requireOrigin = options.requireOrigin !== false;

  for (const field of PREVIEW_IDENTITY_FIELDS) {
    if (hasAliasConflict(input, FIELD_ALIASES[field])) {
      errors.push(error(field, "aliases_conflict", "conflicting identity sources were supplied"));
    }
  }

  const explicitOrigin = firstValue(input, FIELD_ALIASES.previewOrigin);
  const branchOriginInputsList = branchOriginInputs(input);
  const parsedBranchOrigins = branchOriginInputsList.map(({ value }) => parseBranchOrigin(value));
  if (parsedBranchOrigins.some((parsed) => !parsed)) {
    errors.push(error("previewOrigin", "malformed_branch_url", "Vercel branch URL must be a host-only value without credentials, a port, or a path"));
  } else if (parsedBranchOrigins.length > 1
    && new Set(parsedBranchOrigins.map((parsed) => canonicalOrigin(parsed))).size > 1) {
    errors.push(error("previewOrigin", "aliases_conflict", "conflicting Vercel branch URL aliases were supplied"));
  }

  const parsedExplicitOrigin = explicitOrigin ? parsePreviewOrigin(explicitOrigin) : null;
  const parsedDerivedOrigin = parsedBranchOrigins[0] ?? null;
  if (parsedExplicitOrigin && parsedDerivedOrigin && canonicalOrigin(parsedExplicitOrigin) !== canonicalOrigin(parsedDerivedOrigin)) {
    errors.push(error("previewOrigin", "aliases_conflict", "explicit origin conflicts with the Vercel branch URL"));
  }

  if (identity.environment !== PREVIEW_ENVIRONMENT) {
    errors.push(error("environment", identity.environment ? "must_be_preview" : "missing", "must be exactly preview"));
  }

  const projectRef = identity.supabaseProjectRef;
  if (!projectRef) {
    errors.push(error("supabaseProjectRef", "missing", "is required"));
  } else if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push(error("supabaseProjectRef", "is_production", "must not identify production"));
  } else if (!PROJECT_REF_RE.test(projectRef)) {
    errors.push(error("supabaseProjectRef", "malformed", "has an invalid format"));
  }

  const parsedSupabaseUrl = identity.supabaseUrl ? parseSupabaseUrl(identity.supabaseUrl) : null;
  const parsedSupabaseHost = identity.supabaseUrlHost ? parseSupabaseHost(identity.supabaseUrlHost) : null;
  if (!identity.supabaseUrl && !identity.supabaseUrlHost) {
    errors.push(error("supabaseUrlHost", "missing", "requires a Supabase URL or URL host"));
  } else {
    if (identity.supabaseUrl && !parsedSupabaseUrl) {
      errors.push(error("supabaseUrlHost", "malformed_url", "has an invalid Supabase URL"));
    }
    if (identity.supabaseUrlHost && !parsedSupabaseHost) {
      errors.push(error("supabaseUrlHost", "malformed_host", "has an invalid Supabase URL host"));
    }
    if (parsedSupabaseUrl && parsedSupabaseHost && parsedSupabaseUrl.hostname !== parsedSupabaseHost) {
      errors.push(error("supabaseUrlHost", "url_host_mismatch", "URL and host do not match"));
    }
    const effectiveHost = parsedSupabaseHost ?? parsedSupabaseUrl?.hostname ?? "";
    if (projectRef && PROJECT_REF_RE.test(projectRef) && effectiveHost && effectiveHost !== `${projectRef}.supabase.co`) {
      errors.push(error("supabaseUrlHost", "ref_host_mismatch", "does not match the project ref"));
    }
  }

  const branch = identity.previewBranch;
  if (!branch) {
    errors.push(error("previewBranch", "missing", "is required"));
  } else if (!BRANCH_RE.test(branch)) {
    errors.push(error("previewBranch", "malformed", "has an invalid format"));
  } else if (PRODUCTION_BRANCHES.has(branch.toLowerCase())) {
    errors.push(error("previewBranch", "is_production", "must not be a production branch"));
  }

  if (identity.vercelDeploymentTarget !== PREVIEW_DEPLOYMENT_TARGET) {
    errors.push(error(
      "vercelDeploymentTarget",
      identity.vercelDeploymentTarget ? "must_be_preview" : "missing",
      "must be exactly preview",
    ));
  }

  const parsedOrigin = identity.previewOrigin ? parsePreviewOrigin(identity.previewOrigin) : null;
  if (requireOrigin && !identity.previewOrigin) {
    errors.push(error("previewOrigin", "missing", "is required"));
  } else if (identity.previewOrigin && !parsedOrigin) {
    errors.push(error("previewOrigin", "malformed", "must be an HTTPS origin without credentials or a path"));
  } else if (parsedOrigin && isProductionOriginHost(parsedOrigin.hostname)) {
    errors.push(error("previewOrigin", "is_production", "must not identify production"));
  }

  return resultWithSummary(identity, errors);
}

export function assertPreviewIdentity(input = process.env, options = {}) {
  const result = validatePreviewIdentity(input, options);
  if (!result.ok) throw new Error(`Preview identity rejected: ${result.errors.join("; ")}`);
  return result;
}

function syntheticValidIdentity() {
  return {
    environment: "preview",
    supabaseProjectRef: "abcdefghijklmnopqrst",
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co/",
    previewBranch: "preview/e10-p2",
    vercelDeploymentTarget: "preview",
    previewOrigin: "https://preview.example.test/",
  };
}

function runMutationSelfTest() {
  const valid = syntheticValidIdentity();
  if (!validatePreviewIdentity(valid).ok) throw new Error("valid synthetic Preview identity was rejected");
  const cases = [
    ["missing environment", { ...valid, environment: undefined }],
    ["missing project ref", { ...valid, supabaseProjectRef: undefined }],
    ["production project ref", { ...valid, supabaseProjectRef: PRODUCTION_SUPABASE_PROJECT_REF }],
    ["malformed URL", { ...valid, supabaseUrl: "http://bad.invalid" }],
    ["mismatched URL", { ...valid, supabaseUrl: "https://zyxwvutsrqponmlkjihg.supabase.co/" }],
    ["missing branch", { ...valid, previewBranch: undefined }],
    ["production target", { ...valid, vercelDeploymentTarget: "production" }],
    ["missing origin", { ...valid, previewOrigin: undefined }],
    ["production origin", { ...valid, previewOrigin: "https://xot.iraneyes.com/" }],
    ["production origin trailing dot", { ...valid, previewOrigin: "https://xot.iraneyes.com./" }],
    ["production origin encoded dot", { ...valid, previewOrigin: "https://xot.iraneyes.com%2e/" }],
    ["production Vercel origin trailing dot", { ...valid, previewOrigin: "https://xot.vercel.app." }],
  ];
  for (const [label, candidate] of cases) {
    if (validatePreviewIdentity(candidate).ok) throw new Error(`mutation was accepted: ${label}`);
  }
  return cases.length + 1;
}

function isMain() {
  return process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
}

if (isMain()) {
  const result = validatePreviewIdentity(process.env);
  if (!result.ok) {
    for (const message of result.errors) console.error(message);
    console.error("Preview identity contract rejected the target before any deploy or network-capable command.");
    process.exit(1);
  }
  if (process.env.MUTATION_TEST === "1") {
    const count = runMutationSelfTest();
    console.log(`PREVIEW_IDENTITY_SOURCE_CONTRACT_PASS selfTest=pass cases=${count}`);
  } else {
    console.log(`PREVIEW_IDENTITY_PASS environment=${result.identity.environment} project=${result.identity.supabaseProjectRef} host=${result.identity.supabaseUrlHost} branch=${result.identity.previewBranch} target=${result.identity.vercelDeploymentTarget} origin=${result.identity.previewOrigin}`);
  }
}
