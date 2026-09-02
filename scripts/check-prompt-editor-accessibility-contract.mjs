import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const promptEditorPath = join(repoRoot, "src/components/settings/PromptEditor.tsx");
const settingsPath = join(repoRoot, "src/pages/Settings.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const promptEditor = readFileSync(promptEditorPath, "utf8");
const settings = readFileSync(settingsPath, "utf8");

assert.match(
  promptEditor,
  /className="[^"]*\bfocus-within:border-ring\b[^"]*\bfocus-within:ring-2\b[^"]*\bfocus-within:ring-ring\b[^"]*\bfocus-within:ring-offset-2\b[^"]*\bfocus-within:ring-offset-background\b[^"]*"/,
  "PromptEditor must expose a visible focus-within frame for keyboard focus",
);
assert.doesNotMatch(
  promptEditor,
  /focus-visible:ring-0|focus-visible:ring-offset-0/,
  "PromptEditor must not suppress the shared Textarea keyboard focus indicator",
);
assert.match(
  promptEditor,
  /<Textarea\s+id=\{id\}/,
  "PromptEditor must continue to forward its optional id to the inline textarea",
);
assert.match(
  promptEditor,
  /onClick=\{copy\}\s+title="Copy"\s+aria-label="Copy prompt"/,
  "the icon-only copy action must retain its handler and have an explicit accessible name",
);
assert.match(
  promptEditor,
  /onClick=\{\(\) => setFullscreen\(true\)\}\s+title="Expand"\s+aria-label="Expand prompt editor"/,
  "the icon-only expand action must retain its handler and have an explicit accessible name",
);
assert.match(
  settings,
  /<Label htmlFor="system_prompt">System Prompt<\/Label>\s*<PromptEditor\s+id="system_prompt"/s,
  "Settings must retain the System Prompt label-to-editor id relationship",
);
assert.match(
  settings,
  /<PromptEditor\s+id="user_prompt_template"/,
  "Settings must retain the user prompt template editor id",
);

const transpile = typescript.transpileModule(promptEditor, {
  compilerOptions: {
    jsx: typescript.JsxEmit.ReactJSX,
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: promptEditorPath,
  reportDiagnostics: true,
});
const syntaxDiagnostics = (transpile.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
);
assert.equal(syntaxDiagnostics.length, 0, "PromptEditor must transpile without TypeScript diagnostics");

console.log("PROMPT_EDITOR_A11Y_SOURCE_CONTRACT_PASS 7");
