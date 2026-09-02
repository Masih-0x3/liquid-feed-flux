import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const paths = {
  vercel: path.join(repoRoot, "vercel.json"),
  staticHeaders: path.join(repoRoot, "public/_headers"),
  index: path.join(repoRoot, "index.html"),
};

const EXPECTED = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob: https://*.supabase.co https://*.twimg.com https://*.x.com https://*.twitter.com; media-src 'self' blob: https://*.supabase.co https://*.twimg.com https://*.x.com https://*.twitter.com;",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

function fail(message) {
  throw new Error(`SECURITY_HEADERS_SOURCE_CONTRACT_FAIL ${message}`);
}

function extractVercelHeaders(input) {
  let config;
  try {
    config = JSON.parse(input);
  } catch {
    fail("vercel.json is not valid JSON");
  }
  const headers = config.headers?.find((entry) => entry.source === "/(.*)")?.headers ?? [];
  return Object.fromEntries(headers.map((entry) => [entry.key, entry.value]));
}

function extractStaticHeaders(input) {
  return Object.fromEntries(input.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s{2}([^:]+):\s*(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function assertContract(sources, label = "current source") {
  if (!sources.staticHeaders.startsWith("/*\n")) {
    fail(`${label}: static headers must retain the /* route pattern`);
  }
  const vercel = extractVercelHeaders(sources.vercel);
  const staticHeaders = extractStaticHeaders(sources.staticHeaders);
  for (const [key, value] of Object.entries(EXPECTED)) {
    assert.equal(vercel[key], value, `${label}: Vercel ${key} must retain the reviewed value`);
    assert.equal(staticHeaders[key], value, `${label}: static ${key} must retain the reviewed value`);
  }
  if (!sources.index.includes(`frame-ancestors 'none'`)) {
    fail(`${label}: index CSP meta must retain frame-ancestors 'none'`);
  }
  return { headers: Object.keys(EXPECTED).length };
}

const source = Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [
  name,
  fs.readFileSync(filePath, "utf8"),
]));
const result = assertContract(source);

if (process.env.MUTATION_TEST === "1") {
  const mutants = [
    ["vercel-hsts-removed", { ...source, vercel: source.vercel.replace(/\n\s*\{\n\s*\"key\": \"Strict-Transport-Security\"[\s\S]*?\n\s*\}/, "") }],
    ["static-csp-removed", { ...source, staticHeaders: source.staticHeaders.replace("frame-ancestors 'none';", "") }],
    ["static-route-removed", { ...source, staticHeaders: source.staticHeaders.replace("/*\n", "") }],
    ["index-frame-ancestors-removed", { ...source, index: source.index.replace("frame-ancestors 'none'; ", "") }],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, `mutant ${name}`);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `mutation ${name} must be rejected`);
  }
}

console.log(`SECURITY_HEADERS_SOURCE_CONTRACT_PASS headers=${result.headers} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
