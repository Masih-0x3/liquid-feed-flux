#!/usr/bin/env node

import fs from "node:fs";

function loadDotEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvFile(".env");
loadDotEnvFile(".env.local");

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
];

const placeholderPatterns = [
  /^$/,
  /^your-/i,
  /^<.*>$/,
  /placeholder/i,
  /example/i,
  /anon-key/i,
  /project-id/i,
];

const missing = [];
const invalid = [];

for (const key of required) {
  const value = process.env[key]?.trim() ?? "";
  if (!value) {
    missing.push(key);
    continue;
  }
  if (placeholderPatterns.some((pattern) => pattern.test(value))) {
    invalid.push(key);
  }
}

const url = process.env.VITE_SUPABASE_URL?.trim();
if (url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
      invalid.push("VITE_SUPABASE_URL");
    }
  } catch {
    invalid.push("VITE_SUPABASE_URL");
  }
}

if (missing.length || invalid.length) {
  if (missing.length) {
    console.error(`Missing required frontend env: ${missing.join(", ")}`);
  }
  if (invalid.length) {
    console.error(`Invalid or placeholder frontend env: ${[...new Set(invalid)].join(", ")}`);
  }
  console.error("Set these in Vercel Project Settings and in local .env before running a production build.");
  process.exit(1);
}

console.log("Frontend env contract OK");
