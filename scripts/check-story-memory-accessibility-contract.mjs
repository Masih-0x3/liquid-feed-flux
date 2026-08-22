import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "src/components/settings/StoryMemoryCard.tsx");
const source = readFileSync(sourcePath, "utf8");
const sliderPath = join(repoRoot, "src/components/ui/slider.tsx");
const sliderSource = readFileSync(sliderPath, "utf8");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

function assertTranspiles(path, value) {
  const transpile = typescript.transpileModule(value, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (transpile.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

assertTranspiles(sourcePath, source);
assertTranspiles(sliderPath, sliderSource);

const file = typescript.createSourceFile(
  sourcePath,
  source,
  typescript.ScriptTarget.ES2022,
  true,
  typescript.ScriptKind.TSX,
);
const sliderFile = typescript.createSourceFile(
  sliderPath,
  sliderSource,
  typescript.ScriptTarget.ES2022,
  true,
  typescript.ScriptKind.TSX,
);

const openings = [];
const visit = (node) => {
  if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) openings.push(node);
  typescript.forEachChild(node, visit);
};
visit(file);

const sliderOpenings = [];
const visitSlider = (node) => {
  if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node)) sliderOpenings.push(node);
  typescript.forEachChild(node, visitSlider);
};
visitSlider(sliderFile);

function tagName(opening) {
  return opening.tagName.getText(file);
}

function attribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => typescript.isJsxAttribute(property) && property.name.text === name,
  );
}

function attributeText(opening, name) {
  const result = attribute(opening, name);
  if (!result || !result.initializer) return null;
  if (typescript.isStringLiteral(result.initializer)) return result.initializer.text;
  if (typescript.isJsxExpression(result.initializer)) return result.initializer.expression?.getText(file).trim() ?? "";
  return null;
}

function sliderAttributeText(opening, name) {
  const result = attribute(opening, name);
  if (!result || !result.initializer) return null;
  if (typescript.isStringLiteral(result.initializer)) return result.initializer.text;
  if (typescript.isJsxExpression(result.initializer)) return result.initializer.expression?.getText(sliderFile).trim() ?? "";
  return null;
}

function byTagAndAttribute(tag, name, value) {
  return openings.filter((opening) => tagName(opening) === tag && attributeText(opening, name) === value);
}

function assertSingle(items, message) {
  assert.equal(items.length, 1, message);
  return items[0];
}

const sliderRoot = assertSingle(
  sliderOpenings.filter((opening) => opening.tagName.getText(sliderFile) === "SliderPrimitive.Root"),
  "the local Slider wrapper must retain one Radix root",
);
for (const ariaName of ["aria-label", "aria-labelledby", "aria-describedby", "aria-valuetext"]) {
  assert.equal(attribute(sliderRoot, ariaName), undefined, `${ariaName} must not remain on the non-interactive Slider root`);
}
assert.ok(
  sliderRoot.attributes.properties.some(
    (property) => typescript.isJsxSpreadAttribute(property) && property.expression.getText(sliderFile) === "props",
  ),
  "the Slider root must retain the non-semantic props spread",
);
const sliderThumb = assertSingle(
  sliderOpenings.filter((opening) => opening.tagName.getText(sliderFile) === "SliderPrimitive.Thumb"),
  "the local Slider wrapper must retain one interactive Radix thumb",
);
for (const [ariaName, value] of [
  ["aria-label", "ariaLabel"],
  ["aria-labelledby", "ariaLabelledBy"],
  ["aria-describedby", "ariaDescribedBy"],
  ["aria-valuetext", "ariaValueText"],
]) {
  assert.equal(sliderAttributeText(sliderThumb, ariaName), value, `${ariaName} must be forwarded to the interactive Slider thumb`);
}
const forwardRefCall = assertSingle(
  (() => {
    const calls = [];
    const findForwardRef = (node) => {
      if (
        typescript.isCallExpression(node) &&
        typescript.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sliderFile) === "React" &&
        node.expression.name.text === "forwardRef"
      ) calls.push(node);
      typescript.forEachChild(node, findForwardRef);
    };
    findForwardRef(sliderFile);
    return calls;
  })(),
  "the local Slider wrapper must remain a React.forwardRef component",
);
const renderFunction = assertSingle(
  forwardRefCall.arguments.filter(typescript.isArrowFunction),
  "Slider forwardRef must retain one render function",
);
assert.ok(typescript.isObjectBindingPattern(renderFunction.parameters[0]?.name), "Slider render props must destructure semantic ARIA attributes before the root spread");
const bindingPattern = renderFunction.parameters[0].name;
for (const [sourceName, alias] of [
  ["aria-label", "ariaLabel"],
  ["aria-labelledby", "ariaLabelledBy"],
  ["aria-describedby", "ariaDescribedBy"],
  ["aria-valuetext", "ariaValueText"],
]) {
  const binding = assertSingle(
    bindingPattern.elements.filter((element) =>
      typescript.isBindingElement(element) &&
      element.propertyName &&
      (typescript.isIdentifier(element.propertyName) || typescript.isStringLiteral(element.propertyName)) &&
      element.propertyName.text === sourceName,
    ),
    `Slider must destructure ${sourceName} before spreading root props`,
  );
  assert.equal(binding.name.getText(sliderFile), alias, `${sourceName} must retain its explicit thumb-prop alias`);
}

function assertLabel(id, text) {
  const label = assertSingle(byTagAndAttribute("Label", "id", id), `expected one Label#${id}`);
  assert.ok(label.parent.getText(file).includes(text), `Label#${id} must retain visible text ${text}`);
}

function assertDescription(id) {
  assertSingle(byTagAndAttribute("p", "id", id), `expected one description #${id}`);
}

function assertNativeInput(labelId, text) {
  const label = assertSingle(byTagAndAttribute("Label", "htmlFor", labelId), `expected Label[htmlFor=${labelId}]`);
  assert.ok(label.parent.getText(file).includes(text), `${labelId} must retain visible label ${text}`);
  const input = assertSingle(byTagAndAttribute("Input", "id", labelId), `expected Input#${labelId}`);
  assert.notEqual(attributeText(input, "onChange"), null, `${labelId} must retain its change handler`);
}

function assertSlider({ labelId, valueText, descriptionId }) {
  const slider = assertSingle(
    byTagAndAttribute("Slider", "aria-labelledby", labelId),
    `expected one Slider labelled by ${labelId}`,
  );
  assert.equal(attributeText(slider, "aria-valuetext"), valueText, `Slider ${labelId} must expose its current value text`);
  assert.notEqual(attributeText(slider, "value"), null, `Slider ${labelId} must retain its value binding`);
  assert.notEqual(attributeText(slider, "onValueChange"), null, `Slider ${labelId} must retain its update handler`);
  if (descriptionId) {
    assert.equal(attributeText(slider, "aria-describedby"), descriptionId, `Slider ${labelId} must expose its help text`);
    assertDescription(descriptionId);
  }
}

const labels = openings.filter((opening) => tagName(opening) === "Label");
assert.equal(labels.length, 11, "Duplicate Gate must retain exactly eleven visible field labels in this scoped reference card");
for (const label of labels) {
  assert.ok(
    attributeText(label, "id") || attributeText(label, "htmlFor"),
    "every visible Duplicate Gate label must programmatically name a control",
  );
}

assertLabel("story-memory-enabled-label", "Enable Duplicate Gate");
assertDescription("story-memory-enabled-description");
const enabledCheckbox = assertSingle(
  byTagAndAttribute("Checkbox", "aria-labelledby", "story-memory-enabled-label"),
  "Duplicate Gate checkbox must be named by its visible label",
);
assert.equal(
  attributeText(enabledCheckbox, "aria-describedby"),
  "story-memory-enabled-description",
  "Duplicate Gate checkbox must expose its effect description",
);
assert.notEqual(attributeText(enabledCheckbox, "onCheckedChange"), null, "Duplicate Gate checkbox must retain its update handler");

for (const [labelId, labelText] of [
  ["story-memory-window-hours-label", "Lookback window"],
  ["story-memory-candidate-floor-label", "Candidate floor"],
  ["story-memory-auto-duplicate-label", "Auto-duplicate threshold"],
  ["story-memory-adjudicator-confidence-label", "AI confidence required"],
  ["story-memory-semantic-threshold-label", "Semantic-only threshold"],
]) {
  assertLabel(labelId, labelText);
}
for (const slider of [
  {
    labelId: "story-memory-window-hours-label",
    valueText: "`${cfg.window_hours} hours`",
    descriptionId: "story-memory-window-hours-description",
  },
  {
    labelId: "story-memory-candidate-floor-label",
    valueText: "`${cfg.candidate_min_similarity.toFixed(2)} similarity`",
    descriptionId: "story-memory-candidate-floor-description",
  },
  {
    labelId: "story-memory-auto-duplicate-label",
    valueText: "`${cfg.auto_duplicate_similarity.toFixed(2)} similarity`",
    descriptionId: "story-memory-auto-duplicate-description",
  },
  {
    labelId: "story-memory-adjudicator-confidence-label",
    valueText: "`${cfg.adjudicator_confidence_threshold.toFixed(2)} confidence`",
    descriptionId: "story-memory-adjudicator-confidence-description",
  },
  {
    labelId: "story-memory-semantic-threshold-label",
    valueText: "`${cfg.similarity_threshold.toFixed(2)} similarity`",
  },
]) {
  assertSlider(slider);
}

for (const [labelId, labelText] of [
  ["story-memory-mode-label", "Mode"],
  ["story-memory-reasoning-effort-label", "Reasoning effort"],
  ["story-memory-duplicate-action-label", "When duplicate found"],
]) {
  assertLabel(labelId, labelText);
  assertSingle(
    byTagAndAttribute("SelectTrigger", "aria-labelledby", labelId),
    `expected one SelectTrigger labelled by ${labelId}`,
  );
}

assertNativeInput("story-memory-adjudicator-model", "Adjudicator model");
assertNativeInput("story-memory-bypass-author", "Bypass authors");

const addAuthor = assertSingle(
  byTagAndAttribute("Button", "aria-label", "Add bypass author"),
  "the icon-only add author action must expose a durable name",
);
assert.equal(attributeText(addAuthor, "type"), "button", "the add author action must stay a non-submit button");
assert.equal(attributeText(addAuthor, "onClick"), "addAuthor", "the add author action must retain its handler");

const removeAuthor = assertSingle(
  openings.filter(
    (opening) => tagName(opening) === "Button" && attributeText(opening, "aria-label") === "`Remove @${a} from bypass authors`",
  ),
  "the icon-only remove author action must expose a per-author name",
);
assert.equal(attributeText(removeAuthor, "type"), "button", "the remove author action must stay a non-submit button");
assert.match(attributeText(removeAuthor, "onClick") ?? "", /updateCfg\(/, "the remove author action must retain its draft update handler");
assert.equal(
  openings.filter((opening) => tagName(opening) === "X" && attribute(opening, "onClick")).length,
  0,
  "the decorative X icon must not itself be the only clickable removal control",
);

console.log("STORY_MEMORY_A11Y_SOURCE_CONTRACT_PASS controls=13 labels=11 sliders=5");
