#!/usr/bin/env node

import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  validatePreviewIdentity,
} from "./preview-identity.mjs";

const REQUIRED_VITE_ENV_NAMES = Object.freeze([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
]);

const OPTIONAL_VITE_ENV_NAMES = Object.freeze([
  "VITE_SENTRY_DSN",
  "VITE_SENTRY_ENVIRONMENT",
  "VITE_SENTRY_TRACES_SAMPLE_RATE",
  "VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
  "VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE",
  "VITE_FOGLAMP_HUD",
]);

export const PUBLIC_VITE_ENV_NAMES = Object.freeze([
  ...REQUIRED_VITE_ENV_NAMES,
  ...OPTIONAL_VITE_ENV_NAMES,
]);

/**
 * Vercel injects these exact VITE_* names as platform-provided public metadata.
 * They are not application config and are not required or validated as values.
 * Any other VITE_VERCEL_ name remains unknown/secret-like and fail-closed.
 */
const VERCEL_SYSTEM_VITE_ENV_NAMES = Object.freeze([
  "VITE_VERCEL_DEPLOYMENT_ID",
  "VITE_VERCEL_ENV",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VITE_VERCEL_GIT_COMMIT_MESSAGE",
  "VITE_VERCEL_GIT_COMMIT_REF",
  "VITE_VERCEL_GIT_COMMIT_SHA",
  "VITE_VERCEL_GIT_PREVIOUS_SHA",
  "VITE_VERCEL_GIT_PROVIDER",
  "VITE_VERCEL_GIT_PULL_REQUEST_ID",
  "VITE_VERCEL_GIT_REPO_ID",
  "VITE_VERCEL_GIT_REPO_OWNER",
  "VITE_VERCEL_GIT_REPO_SLUG",
  "VITE_VERCEL_BRANCH_URL",
  "VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG",
  "VITE_VERCEL_PROJECT_ID",
  "VITE_VERCEL_PROJECT_PRODUCTION_URL",
  "VITE_VERCEL_TARGET_ENV",
  "VITE_VERCEL_URL",
]);

export const MAX_PUBLIC_VALUE_LENGTH = 4096;
export const MAX_SUPABASE_URL_LENGTH = 256;
export const MAX_PUBLISHABLE_KEY_SEGMENT_LENGTH = 2048;
export const MAX_SENTRY_DSN_LENGTH = 256;
export const MAX_SENTRY_DSN_USERNAME_LENGTH = 64;
export const MAX_SENTRY_PROJECT_ID_LENGTH = 20;

const PUBLIC_VITE_ENV_NAME_SET = new Set(PUBLIC_VITE_ENV_NAMES);
const VERCEL_SYSTEM_VITE_ENV_NAME_SET = new Set(VERCEL_SYSTEM_VITE_ENV_NAMES);
const PREVIEW_MODE_NAMES = Object.freeze([
  "XOT_ENVIRONMENT",
  "APP_ENVIRONMENT",
  "ENVIRONMENT",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_DEPLOYMENT_TARGET",
]);
const PREVIEW_IDENTITY_ONLY_NAMES = Object.freeze([
  "SUPABASE_PROJECT_REF",
  "SUPABASE_URL",
  "SUPABASE_URL_HOST",
  "XOT_PREVIEW_BRANCH",
  "PREVIEW_BRANCH",
  "XOT_PREVIEW_ORIGIN",
  "PREVIEW_ORIGIN",
  "PUBLIC_APP_ORIGIN",
  "VERCEL_BRANCH_URL",
]);
const PREVIEW_ONLY_SIGNALS = Object.freeze([
  "XOT_PREVIEW_BRANCH",
  "PREVIEW_BRANCH",
  "XOT_PREVIEW_ORIGIN",
  "PREVIEW_ORIGIN",
  "PUBLIC_APP_ORIGIN",
  "VERCEL_BRANCH_URL",
]);
const SERVER_SUPABASE_REF_NAMES = Object.freeze(["SUPABASE_PROJECT_REF"]);
const SERVER_SUPABASE_URL_NAMES = Object.freeze(["SUPABASE_URL"]);
const SERVER_SUPABASE_HOST_NAMES = Object.freeze(["SUPABASE_URL_HOST"]);
const OBSERVABILITY_ENVIRONMENT_NAMES = Object.freeze([
  "VITE_SENTRY_ENVIRONMENT",
  "SENTRY_ENVIRONMENT",
  "ENVIRONMENT",
]);
const SECRET_LIKE_PUBLIC_NAME_RE = /(?:SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE[_-]?ROLE|SIGN(?:ING|ATURE)|ADMIN|ROOT|MASTER|CREDENTIAL|API[_-]?KEY|ACCESS[_-]?KEY|AUTH)/i;
const PLACEHOLDER_VALUE_RE = /^(?:your[-_]|<.*>|.*(?:placeholder|example|changeme|replace[-_]?me|anon[-_]?key|project[-_]?id).*)$/i;
const PROJECT_ID_RE = /^[a-z0-9]{20}$/;
const SAMPLE_RATE_RE = /^(?:0(?:\.[0-9]{1,6})?|1(?:\.0{1,6})?)$/;
const ENVIRONMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const JWT_PUBLIC_KEY_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SB_PUBLISHABLE_KEY_RE = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const PRODUCTION_SUPABASE_URL_HOST = `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

function valueOf(env, name) {
  return typeof env?.[name] === "string" ? env[name].trim() : "";
}

function hasPlaceholder(value) {
  return PLACEHOLDER_VALUE_RE.test(value);
}

function isSupabaseUrl(value) {
  if (!value || value.length > MAX_SUPABASE_URL_LENGTH || hasPlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port === ""
      && /^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
      && (parsed.pathname === "" || parsed.pathname === "/")
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function isSupabasePublishableKey(value) {
  if (!value || value.length > MAX_PUBLIC_VALUE_LENGTH || hasPlaceholder(value)) return false;
  if (JWT_PUBLIC_KEY_RE.test(value)) {
    return value.split(".").every((segment) => segment.length <= MAX_PUBLISHABLE_KEY_SEGMENT_LENGTH);
  }
  if (!SB_PUBLISHABLE_KEY_RE.test(value)) return false;
  return value.slice("sb_publishable_".length).length <= MAX_PUBLISHABLE_KEY_SEGMENT_LENGTH;
}

function isSentryDsn(value) {
  if (!value || value.length > MAX_SENTRY_DSN_LENGTH || hasPlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username.length <= MAX_SENTRY_DSN_USERNAME_LENGTH
      && /^[A-Za-z0-9._~-]{8,128}$/.test(parsed.username)
      && parsed.password === ""
      && parsed.port === ""
      && /(?:^|\.)sentry\.io$/.test(parsed.hostname)
      && new RegExp(`^\\/[0-9]{1,${MAX_SENTRY_PROJECT_ID_LENGTH}}\\/?$`).test(parsed.pathname)
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function isValidPublicValue(name, value) {
  if (!value) return false;
  if (value.length > MAX_PUBLIC_VALUE_LENGTH) return false;
  if (name === "VITE_SUPABASE_URL") return isSupabaseUrl(value);
  if (name === "VITE_SUPABASE_PUBLISHABLE_KEY") return isSupabasePublishableKey(value);
  if (name === "VITE_SUPABASE_PROJECT_ID") return !hasPlaceholder(value) && PROJECT_ID_RE.test(value);
  if (name === "VITE_SENTRY_DSN") return isSentryDsn(value);
  if (name === "VITE_SENTRY_ENVIRONMENT") return !hasPlaceholder(value) && ENVIRONMENT_RE.test(value);
  if (name.endsWith("_SAMPLE_RATE")) return SAMPLE_RATE_RE.test(value);
  if (name === "VITE_FOGLAMP_HUD") return value === "0" || value === "1";
  return false;
}

function presentViteNames(env) {
  return Object.keys(env ?? {}).filter((name) => name.startsWith("VITE_")).sort();
}

export function validatePublicViteEnv(env = process.env) {
  const errors = [];
  const present = presentViteNames(env);
  const unknown = present.filter((name) => !PUBLIC_VITE_ENV_NAME_SET.has(name) && !VERCEL_SYSTEM_VITE_ENV_NAME_SET.has(name));
  const secretLike = unknown.filter((name) => SECRET_LIKE_PUBLIC_NAME_RE.test(name));
  const ordinaryUnknown = unknown.filter((name) => !SECRET_LIKE_PUBLIC_NAME_RE.test(name));

  if (secretLike.length > 0) errors.push(`Rejected secret-like public Vite env name(s): ${secretLike.join(", ")}`);
  if (ordinaryUnknown.length > 0) errors.push(`Unknown public Vite env name(s): ${ordinaryUnknown.join(", ")}`);

  const missing = REQUIRED_VITE_ENV_NAMES.filter((name) => !valueOf(env, name));
  if (missing.length > 0) errors.push(`Missing required frontend env: ${missing.join(", ")}`);

  const invalid = PUBLIC_VITE_ENV_NAMES
    .filter((name) => valueOf(env, name) && !isValidPublicValue(name, valueOf(env, name)));
  if (invalid.length > 0) errors.push(`Invalid frontend env format: ${invalid.join(", ")}`);

  return errors;
}

function normalizedValues(env, names) {
  return names.map((name) => valueOf(env, name)).filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function isSupabaseHost(value) {
  return /^[a-z0-9]{20}\.supabase\.co$/.test(value);
}

function addAliasConflict(errors, env, field, names) {
  const values = normalizedValues(env, names);
  if (uniqueValues(values).length > 1) {
    errors.push(`${field}: conflicting aliases were supplied (${names.join(", ")})`);
  }
}

/**
 * Preview identity is required only when the caller explicitly selects the
 * Preview route (or supplies Preview-only identity inputs). This preserves
 * the existing format-only production route while making a partial/mixed
 * Preview tuple fail closed.
 */
export function isPreviewValidationRoute(env = process.env) {
  const modeValues = normalizedValues(env, PREVIEW_MODE_NAMES).map((value) => value.toLowerCase());
  if (modeValues.includes("preview")) return true;
  if (modeValues.some((value) => ["production", "prod"].includes(value))) {
    return normalizedValues(env, PREVIEW_ONLY_SIGNALS).length > 0;
  }
  if (normalizedValues(env, PREVIEW_IDENTITY_ONLY_NAMES).length > 0) return true;
  return modeValues.length > 0;
}

function isProductionValidationRoute(env = process.env) {
  const modeValues = normalizedValues(env, PREVIEW_MODE_NAMES).map((value) => value.toLowerCase());
  return modeValues.includes("production") || modeValues.includes("prod");
}

function validateModeAliases(env) {
  const values = normalizedValues(env, PREVIEW_MODE_NAMES)
    .map((value) => value.toLowerCase())
    .map((value) => value === "prod" ? "production" : value);
  return uniqueValues(values).length > 1
    ? ["Deployment mode: conflicting environment/target aliases were supplied"]
    : [];
}

function serverSupabaseHost(env) {
  const url = valueOf(env, "SUPABASE_URL");
  if (url && isSupabaseUrl(url)) return new URL(url).hostname;
  return valueOf(env, "SUPABASE_URL_HOST");
}

function validateProductionIdentity(env) {
  const errors = [];
  addAliasConflict(errors, env, "Production identity project ref", SERVER_SUPABASE_REF_NAMES);
  addAliasConflict(errors, env, "Production identity URL", SERVER_SUPABASE_URL_NAMES);
  addAliasConflict(errors, env, "Production identity URL host", SERVER_SUPABASE_HOST_NAMES);

  const publicRef = valueOf(env, "VITE_SUPABASE_PROJECT_ID");
  const publicUrl = valueOf(env, "VITE_SUPABASE_URL");
  const serverRef = valueOf(env, "SUPABASE_PROJECT_REF");
  const serverUrl = valueOf(env, "SUPABASE_URL");
  const serverHost = valueOf(env, "SUPABASE_URL_HOST");

  if (publicRef && publicRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push("Production identity: public Supabase project ref does not match production");
  }
  if (publicUrl && isSupabaseUrl(publicUrl) && new URL(publicUrl).hostname !== PRODUCTION_SUPABASE_URL_HOST) {
    errors.push("Production identity: public Supabase URL does not match production");
  }
  if (serverRef && serverRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
    errors.push("Production identity: server Supabase project ref does not match production");
  }
  if (serverUrl && !isSupabaseUrl(serverUrl)) {
    errors.push("Production identity: server Supabase URL is malformed");
  }
  if (serverHost && !isSupabaseHost(serverHost)) {
    errors.push("Production identity: server Supabase URL host is malformed");
  }
  if (serverUrl && isSupabaseUrl(serverUrl) && serverHost && isSupabaseHost(serverHost)
    && new URL(serverUrl).hostname !== serverHost) {
    errors.push("Production identity: server Supabase URL and host aliases do not match");
  }

  const effectiveServerHost = serverSupabaseHost(env);
  if (effectiveServerHost && effectiveServerHost !== PRODUCTION_SUPABASE_URL_HOST) {
    errors.push("Production identity: server Supabase URL does not match production");
  }
  if (serverRef && effectiveServerHost && effectiveServerHost !== `${serverRef}.supabase.co`) {
    errors.push("Production identity: server Supabase ref and URL do not match");
  }
  if (publicRef && publicRef === PRODUCTION_SUPABASE_PROJECT_REF && publicUrl && isSupabaseUrl(publicUrl)
    && new URL(publicUrl).hostname !== `${publicRef}.supabase.co`) {
    errors.push("Production identity: public Supabase ref and URL do not match");
  }

  return errors;
}

function validateObservabilityEnvironment(env, previewRoute, productionRoute) {
  const errors = [];
  const values = normalizedValues(env, OBSERVABILITY_ENVIRONMENT_NAMES);
  if (uniqueValues(values).length > 1) {
    errors.push("Observability environment: conflicting client/server aliases were supplied");
  }
  if (previewRoute && values.some((value) => value.toLowerCase() !== "preview")) {
    errors.push("Observability environment: must be exactly preview for the Preview route");
  }
  if (productionRoute && values.some((value) => value.toLowerCase() !== "production")) {
    errors.push("Observability environment: must be exactly production for the Production route");
  }
  return errors;
}

export function validateViteEnvironment(env = process.env) {
  const errors = [...validatePublicViteEnv(env), ...validateModeAliases(env)];
  const previewRoute = isPreviewValidationRoute(env);
  const productionRoute = !previewRoute && isProductionValidationRoute(env);
  if (previewRoute) {
    const identity = validatePreviewIdentity(env);
    errors.push(...identity.errors.map((message) => `Preview identity: ${message}`));
  } else if (productionRoute) {
    errors.push(...validateProductionIdentity(env));
  }
  errors.push(...validateObservabilityEnvironment(env, previewRoute, productionRoute));
  return errors;
}

function syntheticValidEnv() {
  return {
    VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.synthetic-public-payload.synthetic-signature",
    VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst",
    VITE_SENTRY_DSN: "https://publickey123@synthetic.ingest.sentry.io/12345",
    VITE_SENTRY_ENVIRONMENT: "production",
    VITE_SENTRY_TRACES_SAMPLE_RATE: "0.1",
    VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: "0",
    VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE: "1",
    VITE_FOGLAMP_HUD: "1",
  };
}

function runMutationSelfTest() {
  const valid = syntheticValidEnv();
  if (validatePublicViteEnv(valid).length > 0) throw new Error("valid synthetic public env was rejected");

  const vercelAccepted = { ...valid };
  for (const name of VERCEL_SYSTEM_VITE_ENV_NAMES) vercelAccepted[name] = "synthetic";
  if (validatePublicViteEnv(vercelAccepted).length > 0) throw new Error("reviewed Vercel system Vite env name was rejected");

  const cases = [
    ["missing required", (() => { const env = { ...valid }; delete env.VITE_SUPABASE_URL; return env; })()],
    ["unknown public name", { ...valid, VITE_UNREVIEWED_PUBLIC_NAME: "synthetic" }],
    ["secret-like name", { ...valid, VITE_SERVICE_ROLE_KEY: "synthetic" }],
    ["malformed URL", { ...valid, VITE_SUPABASE_URL: "http://bad.invalid" }],
    ["malformed project id", { ...valid, VITE_SUPABASE_PROJECT_ID: "bad" }],
    ["malformed sample rate", { ...valid, VITE_SENTRY_TRACES_SAMPLE_RATE: "2" }],
    ["unknown VITE_VERCEL name", { ...valid, VITE_VERCEL_UNREVIEWED_NAME: "synthetic" }],
    ["secret-like VITE_VERCEL name", { ...valid, VITE_VERCEL_SECRET_TOKEN: "synthetic" }],
  ];
  for (const [label, env] of cases) {
    const errors = validatePublicViteEnv(env);
    if (errors.length === 0) throw new Error(`mutation was accepted: ${label}`);
  }

  const routeCases = [
    ["mixed production identity", {
      ...valid,
      VERCEL_ENV: "production",
      SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
      SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/`,
    }],
    ["Preview production observability", {
      ...valid,
      ...{
        XOT_ENVIRONMENT: "preview",
        SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
        SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/",
        XOT_PREVIEW_BRANCH: "preview/e10-p2",
        VERCEL_DEPLOYMENT_TARGET: "preview",
        XOT_PREVIEW_ORIGIN: "https://preview.example.test/",
      },
      VITE_SENTRY_ENVIRONMENT: "production",
    }],
    ["production staging mode aliases", {
      ...valid,
      XOT_ENVIRONMENT: "staging",
      VERCEL_ENV: "production",
    }],
  ];
  for (const [label, env] of routeCases) {
    if (validateViteEnvironment(env).length === 0) throw new Error(`mutation was accepted: ${label}`);
  }

  const productionPreviewObservability = {
    ...valid,
    VITE_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    VITE_SUPABASE_PROJECT_ID: PRODUCTION_SUPABASE_PROJECT_REF,
    VERCEL_ENV: "production",
    SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co/`,
    VITE_SENTRY_ENVIRONMENT: "preview",
    SENTRY_ENVIRONMENT: "preview",
  };
  if (!validateViteEnvironment(productionPreviewObservability)
    .some((message) => message.startsWith("Observability environment:"))) {
    throw new Error("mutation was accepted: production Preview observability");
  }
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (isMain) {
  const actualErrors = validateViteEnvironment(process.env);
  if (actualErrors.length > 0) {
    for (const error of actualErrors) console.error(error);
    console.error("Set reviewed public frontend env names in Vercel Project Settings or the invoking process environment.");
    process.exit(1);
  }
  if (process.env.MUTATION_TEST === "1") {
    runMutationSelfTest();
    console.log("VITE_ENV_SOURCE_CONTRACT_PASS selfTest=pass");
    process.exit(0);
  }
  console.log(`Frontend env contract OK names=${PUBLIC_VITE_ENV_NAMES.join(",")}`);
}
