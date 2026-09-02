import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tailwindConfigPath = join(repoRoot, "tailwind.config.ts");
const cssPath = join(repoRoot, "src/index.css");
const authPagePath = join(repoRoot, "src/pages/AuthPage.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [path];
  }).filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

const tailwindConfig = readFileSync(tailwindConfigPath, "utf8");
const css = readFileSync(cssPath, "utf8");
const authPage = readFileSync(authPagePath, "utf8");
const gradientCallers = sourceFiles(join(repoRoot, "src")).filter((path) =>
  readFileSync(path, "utf8").includes("bg-gradient-primary"),
);

assert.match(
  tailwindConfig,
  /backgroundImage:\s*\{\s*'gradient-primary':\s*'var\(--gradient-primary\)',?\s*\}/s,
  "Tailwind must emit bg-gradient-primary from the semantic CSS gradient token",
);
assert.match(
  css,
  /--gradient-primary:\s*linear-gradient\([^;]*hsl\(var\(--primary\)\)[^;]*hsl\(var\(--primary-glow\)\)[^;]*\);/,
  "the primary gradient must continue to derive from the shared primary tokens",
);
assert.match(
  authPage,
  /className="[^"]*\bbg-gradient-primary\b[^"]*"/,
  "the login primary action must retain the shared gradient utility",
);
assert.ok(
  gradientCallers.length > 1,
  "the shared utility must retain more than one active caller",
);

const transpile = typescript.transpileModule(tailwindConfig, {
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: tailwindConfigPath,
  reportDiagnostics: true,
});
const syntaxDiagnostics = (transpile.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
);
assert.equal(syntaxDiagnostics.length, 0, "Tailwind config must transpile without TypeScript diagnostics");

console.log(`PRIMARY_GRADIENT_SOURCE_CONTRACT_PASS 5 callers=${gradientCallers.length}`);
