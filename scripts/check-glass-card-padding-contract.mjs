import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cssPath = path.join(repoRoot, "src/index.css");
const srcRoot = path.join(repoRoot, "src");

function fail(message) {
  throw new Error(`GLASS_CARD_PADDING_SOURCE_CONTRACT_FAIL ${message}`);
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
  });
}

function assertContract({ css, sources }, label = "current source") {
  const glassCard = css.match(/\.glass-card\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  if (!glassCard.includes("@apply glass-panel;")) {
    fail(`${label}: glass-card must retain the shared glass-panel surface`);
  }
  if (/\bp-6\b/.test(glassCard) || /\bp-8\b/.test(glassCard)) {
    fail(`${label}: glass-card must not add outer padding to CardHeader/CardContent-owned spacing`);
  }
  if (!glassCard.includes("background: var(--gradient-glass);")) {
    fail(`${label}: glass-card must retain the semantic gradient surface`);
  }

  let callerCount = 0;
  for (const [filePath, source] of Object.entries(sources)) {
    const callerMatches = source.match(/<Card\b[^>]*glass-card/g) ?? [];
    callerCount += callerMatches.length;
    if (/<(?!Card\b)[A-Za-z][^>]*glass-card/.test(source)) {
      fail(`${label}: ${path.relative(repoRoot, filePath)} has a non-Card glass-card caller`);
    }
  }
  if (callerCount < 1) fail(`${label}: expected active Card glass-card callers`);
  return { callerCount };
}

const current = {
  css: fs.readFileSync(cssPath, "utf8"),
  sources: Object.fromEntries(sourceFiles(srcRoot).map((filePath) => [
    filePath,
    fs.readFileSync(filePath, "utf8"),
  ])),
};

const result = assertContract(current);

if (process.env.MUTATION_TEST === "1") {
  const mutants = [
    ["outer-padding-reintroduced", { ...current, css: current.css.replace("@apply glass-panel;", "@apply glass-panel p-6;") }],
    ["surface-removed", { ...current, css: current.css.replace("@apply glass-panel;", "") }],
    [
      "non-card-caller",
      {
        ...current,
        sources: {
          ...current.sources,
          [cssPath]: `${current.sources[cssPath] ?? ""}\n<div className="glass-card" />`,
        },
      },
    ],
  ];
  for (const [name, mutant] of mutants) {
    let rejected = false;
    try {
      assertContract(mutant, `mutant ${name}`);
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`mutation ${name} was accepted`);
  }
}

console.log(
  `GLASS_CARD_PADDING_SOURCE_CONTRACT_PASS callers=${result.callerCount} selfTest=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`,
);
