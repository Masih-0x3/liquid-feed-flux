import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  playground: join(repoRoot, "src/components/settings/TranslationPlayground.tsx"),
  select: join(repoRoot, "src/components/ui/select.tsx"),
  switch: join(repoRoot, "src/components/ui/switch.tsx"),
};
const sources = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]));
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function assertTranspiles(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

for (const [name, source] of Object.entries(sources)) assertTranspiles(paths[name], source);

function parse(path, source) {
  return typescript.createSourceFile(path, source, typescript.ScriptTarget.ES2022, true, typescript.ScriptKind.TSX);
}

function collectOpenings(file) {
  const openings = [];
  const visit = (node) => {
    if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) openings.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(file);
  return openings;
}

function findNodes(root, predicate) {
  const nodes = [];
  const visit = (node) => {
    if (predicate(node)) nodes.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
}

function tagName(opening, file) {
  return opening.tagName.getText(file);
}

function attribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => typescript.isJsxAttribute(property) && property.name.text === name,
  );
}

function attributeText(opening, name, file) {
  const result = attribute(opening, name);
  if (!result || !result.initializer) return null;
  if (typescript.isStringLiteral(result.initializer)) return result.initializer.text;
  if (typescript.isJsxExpression(result.initializer)) return result.initializer.expression?.getText(file).trim() ?? "";
  return null;
}

function hasPropsSpread(opening, file) {
  return opening.attributes.properties.some(
    (property) => typescript.isJsxSpreadAttribute(property) && property.expression.getText(file).trim() === "props",
  );
}

function assertSingle(items, message) {
  assert.equal(items.length, 1, message);
  return items[0];
}

const playgroundFile = parse(paths.playground, sources.playground);
const selectFile = parse(paths.select, sources.select);
const switchFile = parse(paths.switch, sources.switch);
const playgroundOpenings = collectOpenings(playgroundFile);
const selectOpenings = collectOpenings(selectFile);
const switchOpenings = collectOpenings(switchFile);

function playgroundBy(tag, name, value) {
  return playgroundOpenings.filter(
    (opening) => tagName(opening, playgroundFile) === tag && attributeText(opening, name, playgroundFile) === value,
  );
}

function assertNativePair(id, labelText, controlTag) {
  const label = assertSingle(playgroundBy("Label", "htmlFor", id), `expected Label[htmlFor=${id}]`);
  assert.ok(label.parent.getText(playgroundFile).includes(labelText), `${id} must retain visible label ${labelText}`);
  const control = assertSingle(playgroundBy(controlTag, "id", id), `expected ${controlTag}#${id}`);
  assert.notEqual(attributeText(control, "onChange", playgroundFile), null, `${id} must retain its change handler`);
}

const labels = playgroundOpenings.filter((opening) => tagName(opening, playgroundFile) === "Label");
assert.equal(labels.length, 4, "Translation Playground must retain only its four actual control labels");
assertNativePair("playground_text", "Test text (English)", "Textarea");
assertNativePair("author_handle", "Author handle (optional)", "Input");

const sampleTrigger = assertSingle(
  playgroundBy("SelectTrigger", "aria-label", "Load sample tweet"),
  "the sample Select must be named independently of its placeholder",
);
assert.equal(attributeText(sampleTrigger, "className", playgroundFile), "w-48 h-8 text-xs", "sample Select must preserve its compact layout class");
const sampleSelect = assertSingle(
  playgroundOpenings.filter(
    (opening) => tagName(opening, playgroundFile) === "Select" && attributeText(opening, "onValueChange", playgroundFile) === "loadSample",
  ),
  "sample Select must retain its loadSample handler",
);
assert.ok(
  findNodes(sampleSelect.parent, (node) =>
    (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) &&
    tagName(node, playgroundFile) === "SelectTrigger" &&
    attributeText(node, "aria-label", playgroundFile) === "Load sample tweet",
  ).length === 1,
  "sample Select handler and programmatic name must remain in the same Select subtree",
);

const filterLabel = assertSingle(
  playgroundBy("Label", "id", "translation-playground-filter-mode-label"),
  "Filter mode must retain a visible label id",
);
assert.ok(filterLabel.parent.getText(playgroundFile).includes("Filter mode"), "Filter mode visible label must remain intact");
const filterTrigger = assertSingle(
  playgroundBy("SelectTrigger", "aria-labelledby", "translation-playground-filter-mode-label"),
  "Filter mode Select must be named by its visible label",
);
assert.equal(attributeText(filterTrigger, "className", playgroundFile), "h-9", "Filter mode Select must preserve its layout class");
const filterSelect = assertSingle(
  playgroundOpenings.filter(
    (opening) => tagName(opening, playgroundFile) === "Select" &&
    (attributeText(opening, "onValueChange", playgroundFile) ?? "").includes("setForceFilter"),
  ),
  "Filter mode Select must retain its force-filter handler",
);
assert.ok(
  findNodes(filterSelect.parent, (node) =>
    (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) &&
    tagName(node, playgroundFile) === "SelectTrigger" &&
    attributeText(node, "aria-labelledby", playgroundFile) === "translation-playground-filter-mode-label",
  ).length === 1,
  "Filter mode handler and visible-label reference must remain in the same Select subtree",
);

const compareLabel = assertSingle(
  playgroundBy("Label", "id", "translation-playground-ab-compare-label"),
  "A/B compare must retain a visible label id",
);
assert.ok(compareLabel.parent.getText(playgroundFile).includes("A/B compare"), "A/B compare visible label must remain intact");
const compareSwitch = assertSingle(
  playgroundBy("Switch", "aria-labelledby", "translation-playground-ab-compare-label"),
  "A/B compare Switch must be named by its visible label",
);
assert.equal(
  attributeText(compareSwitch, "aria-describedby", playgroundFile),
  "translation-playground-ab-compare-description",
  "A/B compare Switch must expose its helper text",
);
assert.equal(attributeText(compareSwitch, "checked", playgroundFile), "keepPrevious", "A/B compare Switch must retain its checked state");
assert.equal(attributeText(compareSwitch, "onCheckedChange", playgroundFile), "setKeepPrevious", "A/B compare Switch must retain its state handler");
assertSingle(
  playgroundBy("span", "id", "translation-playground-ab-compare-description"),
  "A/B compare helper text must retain its description id",
);

const copyButton = assertSingle(
  playgroundBy("Button", "aria-label", "Copy translated text"),
  "the icon-only copy action must expose a durable name",
);
assert.equal(attributeText(copyButton, "title", playgroundFile), "Copy translated text", "copy action must retain an operator-visible tooltip");
assert.equal(attributeText(copyButton, "type", playgroundFile), "button", "copy action must remain a non-submit button");
assert.match(attributeText(copyButton, "onClick", playgroundFile) ?? "", /copyText\(res\.translated_text\)/, "copy action must retain its clipboard handler");

for (const text of ["Translated text", "AI reasoning"]) {
  assert.equal(
    playgroundOpenings.filter((opening) =>
      tagName(opening, playgroundFile) === "Label" && opening.parent.getText(playgroundFile).includes(text),
    ).length,
    0,
    `${text} must not remain an orphan Label`,
  );
  assert.equal(
    findNodes(playgroundFile, (node) =>
      typescript.isJsxElement(node) &&
      tagName(node.openingElement, playgroundFile) === "p" &&
      node.children.some((child) => child.getText(playgroundFile).trim() === text),
    ).length,
    1,
    `${text} must remain present as display text`,
  );
}

const primitiveContracts = [
  [selectOpenings, selectFile, "SelectPrimitive.Trigger", "SelectTrigger"],
  [switchOpenings, switchFile, "SwitchPrimitives.Root", "Switch"],
];
for (const [openings, file, primitiveTag, label] of primitiveContracts) {
  const primitive = assertSingle(
    openings.filter((opening) => tagName(opening, file) === primitiveTag),
    `${label} wrapper must retain one ${primitiveTag} boundary`,
  );
  assert.ok(hasPropsSpread(primitive, file), `${label} wrapper must forward standard consumer props to its Radix root`);
}

console.log("TRANSLATION_PLAYGROUND_A11Y_SOURCE_CONTRACT_PASS controls=6 labels=4 display-headings=2");
