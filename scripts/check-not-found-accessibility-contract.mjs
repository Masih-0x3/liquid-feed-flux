import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const notFoundPath = join(repoRoot, "src/pages/NotFound.tsx");
const buttonPath = join(repoRoot, "src/components/ui/button.tsx");
const cssPath = join(repoRoot, "src/index.css");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const notFound = readFileSync(notFoundPath, "utf8");
const button = readFileSync(buttonPath, "utf8");
const css = readFileSync(cssPath, "utf8");

function readHslToken(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%`));
  assert.ok(match, `expected --${name} HSL token`);
  return match.slice(1).map(Number);
}

function hslToRgb([hue, saturation, lightness]) {
  const s = saturation / 100;
  const l = lightness / 100;
  const normalizedHue = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((normalizedHue / 60) % 2 - 1));
  const m = l - c / 2;
  const channels = normalizedHue < 60
    ? [c, x, 0]
    : normalizedHue < 120
    ? [x, c, 0]
    : normalizedHue < 180
    ? [0, c, x]
    : normalizedHue < 240
    ? [0, x, c]
    : normalizedHue < 300
    ? [x, 0, c]
    : [c, 0, x];
  return channels.map((channel) => channel + m);
}

function relativeLuminance(rgb) {
  return rgb
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(left, right) {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

assert.match(
  notFound,
  /<main className="[^"]*\bbg-background\b[^"]*\btext-foreground\b[^"]*"/,
  "NotFound must use the semantic background and foreground tokens",
);
assert.match(
  notFound,
  /className="[^"]*\btext-muted-foreground\b[^"]*"/,
  "NotFound explanatory copy must use the shared muted-foreground token",
);
assert.match(
  notFound,
  /className="[^"]*\btext-primary\b[^"]*"/,
  "NotFound status must use the shared primary token",
);
assert.doesNotMatch(
  notFound,
  /(?:bg|text)-(?:gray|blue)-/,
  "NotFound must not bypass semantic contrast tokens with raw gray/blue utilities",
);
assert.match(
  notFound,
  /console\.error\([\s\S]*location\.pathname[\s\S]*\);/s,
  "NotFound must retain pathname logging",
);
assert.match(
  notFound,
  /<section aria-labelledby="not-found-title"/,
  "NotFound must expose a labelled recovery section",
);
assert.match(
  notFound,
  /<Button asChild variant="outline" className="[^"]*\btext-primary\b[^"]*\bhover:border-primary\b[^"]*\bhover:bg-background\b[^"]*\bhover:text-primary\b[^"]*">\s*<Link to="\/">Return to Home<\/Link>/s,
  "NotFound must preserve the return-home destination through an AA-safe outlined Button treatment",
);
assert.doesNotMatch(
  notFound,
  /hover:bg-primary\/10/,
  "NotFound must not use the translucent primary hover fill that reduces text contrast below AA",
);
assert.match(
  button,
  /focus-visible:ring-2[\s\S]*focus-visible:ring-ring[\s\S]*focus-visible:ring-offset-2/,
  "the shared Button primitive must retain visible keyboard focus styling",
);
const background = hslToRgb(readHslToken("background"));
const card = hslToRgb(readHslToken("card"));
const mutedForeground = hslToRgb(readHslToken("muted-foreground"));
const primary = hslToRgb(readHslToken("primary"));
assert.ok(
  contrastRatio(primary, card) >= 4.5,
  "primary status text must meet AA contrast against the NotFound card",
);
assert.ok(
  contrastRatio(mutedForeground, card) >= 4.5,
  "muted explanatory text must meet AA contrast against the NotFound card",
);
assert.ok(
  contrastRatio(primary, background) >= 4.5,
  "outlined return-home text must meet AA contrast against its background",
);

const transpile = typescript.transpileModule(notFound, {
  compilerOptions: {
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: notFoundPath,
  reportDiagnostics: true,
});
const syntaxDiagnostics = (transpile.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
);
assert.equal(syntaxDiagnostics.length, 0, "NotFound must transpile without TypeScript diagnostics");

console.log("NOT_FOUND_A11Y_SOURCE_CONTRACT_PASS 11");
