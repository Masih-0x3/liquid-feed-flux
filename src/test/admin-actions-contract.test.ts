import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_NAMES } from "../../supabase/functions/_shared/adminActionNames";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const actionNameSet = new Set<string>(ADMIN_ACTION_NAMES);

function repoPath(...parts: string[]) {
  return join(repoRoot, ...parts);
}

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === repoPath("src", "test")) return [];
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort();
}

function duplicates(values: Iterable<string>) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return Array.from(repeated).sort();
}

function extractActions(source: string) {
  return uniqueSorted(Array.from(source.matchAll(/case\s+['"]([a-z0-9_]+)['"]\s*:/g), (match) => match[1]));
}

function extractActionOccurrences(source: string) {
  return Array.from(source.matchAll(/case\s+['"]([a-z0-9_]+)['"]\s*:/g), (match) => match[1]);
}

function sliceBalancedBlock(source: string, start: number) {
  const openBrace = source.indexOf("{", start);
  expect(openBrace).toBeGreaterThan(start);

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }

  throw new Error("Could not find matching closing brace");
}

function backendSwitchSource() {
  const source = readFileSync(repoPath("supabase", "functions", "admin-actions", "index.ts"), "utf8");
  const switchStart = source.indexOf("switch (action)");
  expect(switchStart).toBeGreaterThan(-1);
  return sliceBalancedBlock(source, switchStart);
}

function backendSwitchActions() {
  return extractActions(backendSwitchSource());
}

function backendSwitchActionOccurrences() {
  return extractActionOccurrences(backendSwitchSource());
}

function adminActionModuleFiles() {
  const rootEntrypoint = repoPath("supabase", "functions", "admin-actions", "index.ts");
  return sourceFiles(repoPath("supabase", "functions", "admin-actions"))
    .filter((file) => file !== rootEntrypoint)
    .filter((file) => !file.endsWith(".test.ts"));
}

function frontendAdminActionLiterals() {
  const actions: Array<{ file: string; action: string }> = [];
  const directInvokePattern = /supabase\.functions\.invoke\(\s*['"]admin-actions['"]/g;

  for (const file of sourceFiles(repoPath("src"))) {
    const source = readFileSync(file, "utf8");
    const wrappedInvokes = source.matchAll(/(?:adminAction|invokeAdminAction)(?:<[^>]+>)?\(\s*\{([\s\S]*?)\}\s*\)/g);

    for (const invoke of source.matchAll(directInvokePattern)) {
      const close = source.indexOf(");", invoke.index);
      const block = source.slice(invoke.index, close > invoke.index ? close : undefined);
      for (const match of block.matchAll(/action:\s*['"]([a-z0-9_]+)['"]/g)) {
        actions.push({ file: relative(repoRoot, file), action: match[1] });
      }
    }

    for (const block of wrappedInvokes) {
      for (const match of block[1].matchAll(/action:\s*['"]([a-z0-9_]+)['"]/g)) {
        actions.push({ file: relative(repoRoot, file), action: match[1] });
      }
    }
  }

  return actions;
}

describe("admin action contract", () => {
  it("keeps canonical and backend action names unique", () => {
    expect(duplicates(ADMIN_ACTION_NAMES)).toEqual([]);
    expect(duplicates(backendSwitchActionOccurrences())).toEqual([]);
  });

  it("keeps the canonical action list aligned with the backend switch", () => {
    expect(uniqueSorted(ADMIN_ACTION_NAMES)).toEqual(backendSwitchActions());
  });

  it("keeps HTTP, CORS, and admin-role checks in the entrypoint", () => {
    const indexSource = readFileSync(repoPath("supabase", "functions", "admin-actions", "index.ts"), "utf8");
    expect(indexSource.match(/\bserve\s*\(/g)?.length).toBe(1);
    expect(indexSource).toContain("Access-Control-Allow-Origin");
    expect(indexSource).toContain("async function requireAdmin");

    const boundaryOffenders = adminActionModuleFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const findings: string[] = [];
      if (/\b(?:Deno\.)?serve\s*\(/.test(source)) findings.push("HTTP server");
      if (/Access-Control-Allow-/.test(source)) findings.push("CORS header");
      if (/\brequireAdmin\s*\(/.test(source) || /\.from\(['"]user_roles['"]\)/.test(source)) {
        findings.push("admin auth");
      }
      return findings.map((finding) => `${relative(repoRoot, file)}: ${finding}`);
    });

    expect(boundaryOffenders).toEqual([]);
  });

  it("keeps static frontend admin-actions calls in the canonical action list", () => {
    const unknown = frontendAdminActionLiterals()
      .filter(({ action }) => !actionNameSet.has(action))
      .map(({ file, action }) => `${file}: ${action}`);

    expect(unknown).toEqual([]);
  });

  it("keeps the shared module importable from both app tests and Deno functions", () => {
    expect(existsSync(repoPath("supabase", "functions", "_shared", "adminActionNames.ts"))).toBe(true);
    expect(actionNameSet.has("get_dashboard_summary")).toBe(true);
    expect(actionNameSet.has("retry_x_post")).toBe(true);
  });
});
