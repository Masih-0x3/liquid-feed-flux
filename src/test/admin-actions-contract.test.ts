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

function extractActions(source: string) {
  return uniqueSorted(Array.from(source.matchAll(/case\s+['"]([a-z0-9_]+)['"]\s*:/g), (match) => match[1]));
}

function backendSwitchActions() {
  const source = readFileSync(repoPath("supabase", "functions", "admin-actions", "index.ts"), "utf8");
  const switchStart = source.indexOf("switch (action)");
  const defaultStart = source.indexOf("default:", switchStart);
  expect(switchStart).toBeGreaterThan(-1);
  expect(defaultStart).toBeGreaterThan(switchStart);
  return extractActions(source.slice(switchStart, defaultStart));
}

function frontendAdminActionLiterals() {
  const actions: Array<{ file: string; action: string }> = [];
  const directInvokePattern = /supabase\.functions\.invoke\(\s*['"]admin-actions['"]/g;

  for (const file of sourceFiles(repoPath("src"))) {
    const source = readFileSync(file, "utf8");
    const wrappedInvokes = source.matchAll(/adminAction(?:<[^>]+>)?\(\s*\{([\s\S]*?)\}\s*\)/g);

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
  it("keeps the canonical action list aligned with the backend switch", () => {
    expect(uniqueSorted(ADMIN_ACTION_NAMES)).toEqual(backendSwitchActions());
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
